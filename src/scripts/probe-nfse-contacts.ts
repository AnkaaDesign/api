/**
 * READ-ONLY: for the last N authorized notes, compare the tomador contact data stored
 * at Elotech against what our Customer record holds. Shows whether telefone/email/
 * inscricaoMunicipal actually make the round trip.
 *
 * Run: NODE_ENV=production DOTENV_CONFIG_PATH=.env.production \
 *        npx ts-node -r dotenv/config -r tsconfig-paths/register --transpile-only \
 *        src/scripts/probe-nfse-contacts.ts [limit]
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

async function main(): Promise<void> {
  const limit = Number(process.argv[2] || 12);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const elotech = app.get(ElotechOxyNfseService);

    const docs = await prisma.nfseDocument.findMany({
      where: { status: 'AUTHORIZED', elotechNfseId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        invoice: {
          include: {
            customer: {
              select: { fantasyName: true, email: true, phones: true, cnpj: true, cpf: true },
            },
          },
        },
      },
    });

    for (const doc of docs) {
      const c = doc.invoice?.customer;
      let remote: any = {};
      try {
        const detail = await elotech.getNfseDetail(Number(doc.elotechNfseId));
        remote = detail?.formTomador ?? {};
      } catch (err: any) {
        remote = { erro: err?.message };
      }
      out(
        [
          `NF ${doc.nfseNumber} (${doc.elotechNfseId})`,
          `cliente=${c?.fantasyName}`,
          `db.phones=${JSON.stringify(c?.phones ?? [])}`,
          `remoto.telefone=${JSON.stringify(remote.telefone ?? null)}`,
          `db.email=${JSON.stringify(c?.email ?? null)}`,
          `remoto.email=${JSON.stringify(remote.email ?? null)}`,
          `remoto.inscricaoMunicipal=${JSON.stringify(remote.inscricaoMunicipal ?? null)}`,
        ].join(' | '),
      );
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
