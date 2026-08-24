import { Test } from '@nestjs/testing';
import { ReconciliationSource, ReconciliationStatus } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionCategoryService } from '../transaction-category.service';
import { CategoryFusionService } from './category-fusion.service';
import { CATEGORY_LEARNERS, DecisionTier, FusedDecision } from './category-signal';

/**
 * `applyDecision` is where a category is allowed to CLOSE a bank line, and the
 * one rule it must never break: a category closes a payment only when nothing
 * else is tracking it. A PARTIAL row already carries a live match that falls
 * short of the payment — stamping RECONCILED there does not reconcile it, it
 * erases the gap. Regression pinned after a R$212,27 Claro debit matched at
 * R$13,00 was silently promoted to RECONCILED in production.
 */

const AUTO_RESOLVING: FusedDecision = {
  tier: DecisionTier.AUTO_APPLY,
  categoryId: 'internet-telefone',
  expectsFiscalDocument: false,
  confidence: 0.97,
  shouldReconcile: true,
  breakdown: [],
  winners: [],
  conflicts: [],
  reason: 'test',
};

function buildPrismaMock(tx: {
  reconciliationStatus: ReconciliationStatus;
  categorySource?: ReconciliationSource | null;
}) {
  const update = jest.fn().mockResolvedValue({});
  const db = {
    bankTransaction: {
      findUnique: jest.fn().mockResolvedValue({
        reconciliationStatus: tx.reconciliationStatus,
        categorySource: tx.categorySource ?? null,
      }),
      update,
    },
    bankTransactionCategory: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    categoryDecisionLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return {
    prisma: {
      ...db,
      $transaction: (cb: (client: unknown) => unknown) => cb(db),
    },
    update,
  };
}

async function buildService(prisma: unknown): Promise<CategoryFusionService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      CategoryFusionService,
      { provide: PrismaService, useValue: prisma },
      { provide: TransactionCategoryService, useValue: { snapshot: jest.fn(), resolveBySlug: jest.fn() } },
      { provide: CATEGORY_LEARNERS, useValue: [] },
    ],
  }).compile();
  return moduleRef.get(CategoryFusionService);
}

describe('CategoryFusionService.applyDecision', () => {
  it('closes a PENDING row when the winning category is resolving', async () => {
    const { prisma, update } = buildPrismaMock({
      reconciliationStatus: ReconciliationStatus.PENDING,
    });
    const service = await buildService(prisma);

    await service.applyDecision('tx-1', AUTO_RESOLVING);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toMatchObject({
      reconciliationStatus: ReconciliationStatus.RECONCILED,
      reconciliationSource: ReconciliationSource.AUTO,
    });
  });

  it('classifies a PARTIAL row but never closes it — the allocation gap survives', async () => {
    const { prisma, update } = buildPrismaMock({
      reconciliationStatus: ReconciliationStatus.PARTIAL,
    });
    const service = await buildService(prisma);

    await service.applyDecision('tx-2', AUTO_RESOLVING);

    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    // The tag still lands (the Vínculo column needs it) …
    expect(data.categorySource).toBe(ReconciliationSource.AUTO);
    expect(prisma.bankTransactionCategory.upsert).toHaveBeenCalled();
    // … but the status is left alone.
    expect(data).not.toHaveProperty('reconciliationStatus');
    expect(data).not.toHaveProperty('reconciliationSource');
  });

  it('leaves a RECONCILED row entirely alone', async () => {
    const { prisma, update } = buildPrismaMock({
      reconciliationStatus: ReconciliationStatus.RECONCILED,
    });
    const service = await buildService(prisma);

    await service.applyDecision('tx-3', AUTO_RESOLVING);

    expect(update).not.toHaveBeenCalled();
  });

  it('never overwrites a hand-set category', async () => {
    const { prisma, update } = buildPrismaMock({
      reconciliationStatus: ReconciliationStatus.PENDING,
      categorySource: ReconciliationSource.MANUAL,
    });
    const service = await buildService(prisma);

    await service.applyDecision('tx-4', AUTO_RESOLVING);

    expect(update).not.toHaveBeenCalled();
  });
});
