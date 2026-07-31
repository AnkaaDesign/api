/**
 * DRY-RUN: build the emission payload for a customer and POST it to Elotech's
 * `calcular-valores-nota-fiscal` (which validates + echoes, but does NOT mint a note),
 * so we can see which tomador fields the server accepts/echoes — in particular
 * telefone, email and inscricaoMunicipal (whose expected shape is unknown).
 *
 * Run: NODE_ENV=production DOTENV_CONFIG_PATH=.env.production \
 *        npx ts-node -r dotenv/config -r tsconfig-paths/register --transpile-only \
 *        src/scripts/probe-nfse-dryrun.ts <customerId> [imShapeIndex]
 */
import { NestFactory } from '@nestjs/core';
import axios from 'axios';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyAuthService } from '../modules/integrations/nfse/elotech-oxy-auth.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

const IM_SHAPES: Array<{ label: string; patch: (t: Record<string, any>) => void }> = [
  { label: 'baseline (tudo null)', patch: () => {} },
  {
    label: 'IM objeto + IE string',
    patch: t => {
      t.inscricaoMunicipal = { inscricaoMunicipal: '53459' };
      t.inscricaoEstadual = '9074433990';
    },
  },
  {
    label: 'IE objeto',
    patch: t => {
      t.inscricaoEstadual = { inscricaoEstadual: '9074433990' };
    },
  },
  {
    label: 'IE numerica',
    patch: t => {
      t.inscricaoEstadual = 9074433990;
    },
  },
  {
    label: 'inscricaoOutroMunicipio string',
    patch: t => {
      t.inscricaoOutroMunicipio = '53459';
    },
  },
  {
    label: 'inscricaoOutroMunicipio objeto',
    patch: t => {
      t.inscricaoOutroMunicipio = { inscricaoMunicipal: '53459' };
    },
  },
];

async function main(): Promise<void> {
  const customerId = process.argv[2];
  const shapeIndex = process.argv[3] != null ? Number(process.argv[3]) : null;
  if (!customerId) {
    out('Uso: probe-nfse-dryrun.ts <customerId> [imShapeIndex]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const elotech = app.get(ElotechOxyNfseService) as any;
    const auth = app.get(ElotechOxyAuthService);

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: { responsibles: { where: { isActive: true } } },
    });
    if (!customer) throw new Error('Cliente não encontrado');

    out(
      `Cliente: ${customer.fantasyName} | email=${JSON.stringify(customer.email)} | phones=${JSON.stringify(customer.phones)}`,
    );
    for (const r of customer.responsibles) {
      out(`  responsável: ${r.name} | email=${JSON.stringify(r.email)} | phone=${r.phone}`);
    }

    const input = {
      id: 'dry-run',
      totalAmount: 2,
      customer: {
        cnpj: customer.cnpj || undefined,
        cpf: customer.cpf || undefined,
        name: customer.fantasyName,
        corporateName: customer.corporateName || undefined,
        email: customer.email || customer.responsibles.find(r => r.email)?.email || undefined,
        phone: customer.phones?.[0] || customer.responsibles.find(r => r.phone)?.phone || undefined,
        address: {
          cityName: customer.city || undefined,
          state: customer.state || undefined,
          zipCode: customer.zipCode || '',
          street: customer.address || '',
          number: customer.addressNumber || 'S/N',
          complement: customer.addressComplement || undefined,
          neighborhood: customer.neighborhood || '',
        },
      },
      task: { id: 'dry-run', name: 'Teste', serialNumber: undefined },
      services: [{ description: 'Teste de integracao', amount: 2 }],
    };

    await auth.getToken();
    const headers = auth.getAuthHeaders();
    const baseUrl = auth.baseUrl;

    const shapes = shapeIndex != null ? [IM_SHAPES[shapeIndex]] : IM_SHAPES;

    const view = (t: Record<string, any>) =>
      JSON.stringify({
        telefone: t.telefone,
        email: t.email,
        inscricaoMunicipal: t.inscricaoMunicipal,
        inscricaoEstadual: t.inscricaoEstadual,
        inscricaoOutroMunicipio: t.inscricaoOutroMunicipio,
      });

    for (const shape of shapes) {
      const payload = await elotech.buildPayload(input);
      shape.patch(payload.formTomador);

      out(`\n===== ${shape.label} =====`);
      out(`enviado -> ${view(payload.formTomador)}`);

      try {
        const res = await axios.post(
          `${baseUrl}/emissao-nfse/calcular-valores-nota-fiscal`,
          payload,
          { headers, timeout: 20000 },
        );
        const t = res.data?.formTomador;
        out(`recebido <- ${t ? view(t) : '(sem formTomador na resposta)'}`);
      } catch (err: any) {
        out(
          `ERRO ${err?.response?.status}: ${JSON.stringify(err?.response?.data ?? err?.message).slice(0, 600)}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
