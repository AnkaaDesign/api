/**
 * backfill-marketplace-reconciliation.ts
 * ---------------------------------------------------------------------------
 * One-off backfill for marketplace PIX debits (Mercado Livre / Mercado Pago,
 * etc.) that predate the value-only marketplace matcher. These settle through a
 * payment intermediary, so their memo CNPJ never matches the NF emitter — the
 * old matcher could never reconcile them and they sat PENDING.
 *
 * Reuses the exact same engine as the OFX importer and the nightly scheduler —
 * NO matching logic is re-implemented here:
 *   1. ReconciliationClassifierService.classifyBatch() retags pending
 *      marketplace debits as NF (fixes the no-CNPJ variant that was previously
 *      UNCLASSIFIED, so the matcher will consider it at all).
 *   2. ReconciliationMatcherService.matchTransaction() runs the value-only
 *      marketplace pass on each one.
 *
 * Idempotent and conservative: matchTransaction only auto-confirms when there
 * is exactly one unmatched purchase (ENTRADA, destCnpj = COMPANY_CNPJ) within
 * R$0,50 of the payment in the date window. Ambiguous cases stay PENDING for
 * manual review. Re-running only ever matches more, never un-matches.
 *
 * Run in dev:   pnpm reconcile:marketplace
 * Run in prod:  NODE_ENV=production pnpm reconcile:marketplace
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  BankTransactionType,
  Prisma,
  ReconciliationStatus,
} from '@prisma/client';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ReconciliationClassifierService } from '../modules/financial/reconciliation/reconciliation-classifier.service';
import { ReconciliationMatcherService } from '../modules/financial/reconciliation/reconciliation-matcher.service';
import {
  isMarketplaceTransaction,
  MARKETPLACE_INTERMEDIARY_CNPJS,
} from '../modules/financial/reconciliation/marketplace';

// Scope every query to outbound marketplace payments. Refunds (CREDIT) are
// ESTORNO and never need an NF, so they're deliberately excluded. Detected by
// the intermediary CNPJ (Mercado Pago, Shopee) or the memo word — the latter
// catches the rare debit that carries no CNPJ.
const MARKETPLACE_PENDING: Prisma.BankTransactionWhereInput = {
  reconciliationStatus: ReconciliationStatus.PENDING,
  type: BankTransactionType.DEBIT,
  OR: [
    { counterpartyCnpjCpf: { in: [...MARKETPLACE_INTERMEDIARY_CNPJS] } },
    { memo: { contains: 'Marketplace', mode: 'insensitive' } },
    { memo: { contains: 'Shopee', mode: 'insensitive' } },
    { memo: { contains: 'SHPP', mode: 'insensitive' } },
  ],
};

const TX_SELECT = {
  id: true,
  postedAt: true,
  amount: true,
  type: true,
  counterpartyCnpjCpf: true,
  counterpartyName: true,
  memo: true,
  bankSlipId: true,
  reconciliationStatus: true,
  expectsFiscalDocument: true,
} satisfies Prisma.BankTransactionSelect;

function fmt(amount: Prisma.Decimal | number): string {
  return Math.abs(Number(amount)).toFixed(2);
}

async function main(): Promise<void> {
  const logger = new Logger('MarketplaceBackfill');
  logger.log(
    `Starting marketplace reconciliation backfill (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const prisma = app.get(PrismaService);
    const classifier = app.get(ReconciliationClassifierService);
    const matcher = app.get(ReconciliationMatcherService);

    const pendingBefore = await prisma.bankTransaction.count({
      where: MARKETPLACE_PENDING,
    });
    logger.log(`Found ${pendingBefore} pending marketplace debit(s).`);
    if (pendingBefore === 0) {
      logger.log('Nothing to do.');
      return;
    }

    // 1. Reclassify so both memo variants land in NF. classifyBatch skips rows
    //    already RECONCILED, so this only touches still-pending ones.
    const reclass = await classifier.classifyBatch(MARKETPLACE_PENDING);
    logger.log(
      `Reclassified ${reclass.processed} tx → ${JSON.stringify(reclass.byCategory)}`,
    );

    // 2. Run the value-only matcher on each pending marketplace NF tx.
    const txs = await prisma.bankTransaction.findMany({
      where: { ...MARKETPLACE_PENDING, expectsFiscalDocument: true },
      select: TX_SELECT,
      orderBy: { postedAt: 'asc' },
    });

    let matched = 0;
    for (const tx of txs) {
      // Guard against a non-marketplace row slipping through the SQL filter.
      if (!isMarketplaceTransaction(tx.memo, tx.counterpartyCnpjCpf)) continue;
      const day = tx.postedAt.toISOString().slice(0, 10);
      const ok = await matcher.matchTransaction(tx as any);
      if (ok) {
        matched += 1;
        logger.log(`  ✓ matched ${tx.id}  R$ ${fmt(tx.amount)}  ${day}`);
      } else {
        logger.log(
          `  · pending ${tx.id}  R$ ${fmt(tx.amount)}  ${day}  — no single unambiguous purchase NF`,
        );
      }
    }

    const pendingAfter = await prisma.bankTransaction.count({
      where: MARKETPLACE_PENDING,
    });
    logger.log('───────────────────────────────────────────────');
    logger.log(`Auto-matched : ${matched}/${txs.length}`);
    logger.log(`Still pending : ${pendingAfter} (need a fiscal document or manual review)`);
  } catch (err) {
    exitCode = 1;
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    new Logger('MarketplaceBackfill').error(`Backfill failed: ${msg}`);
  } finally {
    try {
      await app.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Logger('MarketplaceBackfill').warn(
        `Ignored error during app.close(): ${msg}`,
      );
    }
  }

  process.exit(exitCode);
}

void main();
