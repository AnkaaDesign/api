/**
 * Read-only audit of locally-CANCELLED boletos against Sicredi.
 *
 * Three cancellation paths (invoice.controller cancelBoleto / markBoletoAsPaid,
 * task-quote settleManually) call Sicredi fire-and-forget: they log a warning on
 * failure and write status = CANCELLED regardless. A boleto can therefore be dead
 * locally and perfectly alive at the bank — collectible, and (until the webhook fix
 * of 2026-08-09) able to be paid with the liquidation silently discarded.
 *
 * This script only ASKS Sicredi what the real situação is. It writes nothing.
 * Run: pnpm exec ts-node -r tsconfig-paths/register --transpile-only src/scripts/audit-cancelled-boletos.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SicrediService } from '../modules/integrations/sicredi/sicredi.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const sicredi = app.get(SicrediService);

  const slips = await prisma.bankSlip.findMany({
    where: { status: 'CANCELLED' },
    select: {
      id: true,
      nossoNumero: true,
      amount: true,
      dueDate: true,
      sicrediStatus: true,
      installment: {
        select: {
          id: true,
          status: true,
          paidAt: true,
          invoice: { select: { customer: { select: { fantasyName: true } } } },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  const rows: Record<string, unknown>[] = [];
  for (const s of slips) {
    // Placeholder numbers written by a failed registration are not real titles.
    if (!/^\d+$/.test(s.nossoNumero)) {
      rows.push({ nossoNumero: s.nossoNumero, situacao: 'NAO_CONSULTAVEL (nossoNumero invalido)' });
      continue;
    }
    try {
      const r = await sicredi.queryBoleto(s.nossoNumero);
      rows.push({
        nossoNumero: s.nossoNumero,
        cliente: s.installment?.invoice?.customer?.fantasyName ?? null,
        valor: Number(s.amount),
        vencimento: s.dueDate.toISOString().slice(0, 10),
        parcela: s.installment?.status ?? null,
        situacaoSicredi: r.situacao,
        dataBaixa: r.dataBaixa ?? null,
        dataLiquidacao: r.dataLiquidacao ?? null,
        valorLiquidacao: r.valorLiquidacao ?? null,
      });
    } catch (err) {
      rows.push({
        nossoNumero: s.nossoNumero,
        cliente: s.installment?.invoice?.customer?.fantasyName ?? null,
        valor: Number(s.amount),
        situacaoSicredi: `ERRO: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    await new Promise(r => setTimeout(r, 250)); // be polite to the bank API
  }

  console.log(JSON.stringify(rows, null, 2));
  await app.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
