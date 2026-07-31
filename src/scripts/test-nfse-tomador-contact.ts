/**
 * LIVE TEST (autorizado pelo usuário): emite uma NFS-e de R$ 2,00 para o cliente Kennedy
 * usando EXATAMENTE o mapeamento de produção (NFSE_CUSTOMER_SELECT + buildNfseCustomer),
 * confere o que a prefeitura gravou e imprimiu no tomador (telefone, e-mail, inscrição
 * municipal e estadual) e em seguida CANCELA a nota.
 *
 * A inscrição municipal/estadual do cadastro é preenchida temporariamente com os valores
 * passados na linha de comando (só para esta nota de teste, que é cancelada em seguida) e
 * restaurada ao final — é a única forma de provar que os dois campos saem impressos.
 *
 * Run: NODE_ENV=production DOTENV_CONFIG_PATH=.env.production \
 *        npx ts-node -r dotenv/config -r tsconfig-paths/register --transpile-only \
 *        src/scripts/test-nfse-tomador-contact.ts [--im=123456] [--ie=1234567890] [--keep]
 */
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';
import {
  buildNfseCustomer,
  NFSE_CUSTOMER_SELECT,
} from '../modules/integrations/nfse/nfse-tomador.mapper';

const KENNEDY_CUSTOMER_ID = 'b593f440-9f00-4c85-93ef-54bf5a9eef37';

// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

function arg(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const testIm = arg('im');
  const testIe = arg('ie');
  const keep = process.argv.includes('--keep');
  const pdfPath = arg('pdf');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const elotech = app.get(ElotechOxyNfseService);

  let invoiceId: string | null = null;
  let restored = false;
  const original = await prisma.customer.findUniqueOrThrow({
    where: { id: KENNEDY_CUSTOMER_ID },
    select: { municipalRegistration: true, stateRegistration: true },
  });

  const restore = async () => {
    if (restored) return;
    restored = true;
    if (testIm !== undefined || testIe !== undefined) {
      await prisma.customer.update({
        where: { id: KENNEDY_CUSTOMER_ID },
        data: {
          municipalRegistration: original.municipalRegistration,
          stateRegistration: original.stateRegistration,
        },
      });
      out(`Cadastro do cliente restaurado (IM=${original.municipalRegistration}, IE=${original.stateRegistration})`);
    }
  };

  try {
    if (testIm !== undefined || testIe !== undefined) {
      await prisma.customer.update({
        where: { id: KENNEDY_CUSTOMER_ID },
        data: {
          ...(testIm !== undefined ? { municipalRegistration: testIm } : {}),
          ...(testIe !== undefined ? { stateRegistration: testIe } : {}),
        },
      });
      out(`Cadastro do cliente marcado para teste: IM=${testIm ?? '(inalterado)'} IE=${testIe ?? '(inalterado)'}`);
    }

    // 1) Carrega o cliente com o MESMO select da emissão de produção
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: KENNEDY_CUSTOMER_ID },
      select: NFSE_CUSTOMER_SELECT,
    });
    out(
      `Cliente: ${customer.fantasyName}\n` +
        `  Customer.email=${JSON.stringify(customer.email)} Customer.phones=${JSON.stringify(customer.phones)}\n` +
        `  responsáveis=${JSON.stringify(customer.responsibles)}`,
    );

    const tomador = buildNfseCustomer(customer as any);
    out(
      `Tomador resolvido -> email=${JSON.stringify(tomador.email)} phone=${JSON.stringify(tomador.phone)} ` +
        `IM=${JSON.stringify(tomador.municipalRegistration)} IE=${JSON.stringify(tomador.stateRegistration)}`,
    );

    // 2) Invoice descartável (alvo da FK do NfseDocument)
    const invoice = await prisma.invoice.create({
      data: {
        customerId: KENNEDY_CUSTOMER_ID,
        totalAmount: 2,
        status: 'DRAFT',
        notes: 'TESTE AUTOMATIZADO - contato/inscrições do tomador na NFS-e. Será removido.',
      },
      select: { id: true },
    });
    invoiceId = invoice.id;

    // 3) Emite R$ 2,00
    const emitResult: any = await elotech.emitNfse({
      id: invoiceId,
      totalAmount: 2,
      customer: tomador,
      task: { id: 'test-tomador', name: 'TESTE INTEGRACAO', serialNumber: 'TEST-TOMADOR' },
      services: [{ description: 'Servico de teste de integracao', amount: 2 }],
      description: 'TESTE de integracao - dados do tomador. Valor simbolico R$ 2,00.',
    });
    out(`EMIT RESULT: ${JSON.stringify(emitResult)}`);
    if (emitResult?.status !== 'AUTHORIZED') {
      throw new Error(`Emissão não autorizada: ${JSON.stringify(emitResult)}`);
    }

    const doc = await prisma.nfseDocument.findFirstOrThrow({
      where: { invoiceId },
      select: { id: true, nfseNumber: true, elotechNfseId: true },
    });
    out(`NF #${doc.nfseNumber} (elotechId ${doc.elotechNfseId})`);

    // 4) O que a prefeitura GRAVOU
    const detail = await elotech.getNfseDetail(doc.elotechNfseId!);
    const t = detail?.formTomador ?? {};
    out('\n=== TOMADOR GRAVADO NA PREFEITURA ===');
    out(
      JSON.stringify(
        {
          telefone: t.telefone,
          email: t.email,
          inscricaoMunicipal: t.inscricaoMunicipal,
          inscricaoEstadual: t.inscricaoEstadual,
        },
        null,
        2,
      ),
    );

    // 5) O que a prefeitura IMPRIMIU
    if (pdfPath) {
      const pdf = await elotech.getNfsePdf(doc.elotechNfseId!);
      writeFileSync(pdfPath, pdf);
      out(`PDF salvo em ${pdfPath}`);
    }

    // 6) Cancela a nota de teste
    if (!keep) {
      const cancelResult = await elotech.cancelNfse(
        doc.id,
        'Nota de teste de integracao - servico nao prestado, cancelamento imediato.',
        2,
      );
      out(`CANCEL RESULT: ${JSON.stringify(cancelResult)}`);
    }
  } finally {
    await restore();
    if (invoiceId && !keep) {
      await prisma.invoice
        .delete({ where: { id: invoiceId } })
        .catch(e => out(`Falha ao limpar invoice ${invoiceId}: ${e?.message ?? e}`));
    }
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
