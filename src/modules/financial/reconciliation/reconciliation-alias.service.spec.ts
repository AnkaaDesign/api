import { Test, TestingModule } from '@nestjs/testing';
import {
  BankTransactionType,
  ReconciliationAlias,
  ReconciliationAliasSource,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  inferCounterpartyCnpj,
  ReconciliationAliasService,
} from './reconciliation-alias.service';

function makeAlias(overrides: Partial<ReconciliationAlias> = {}): ReconciliationAlias {
  return {
    id: 'a1',
    memoFingerprint: 'acme tintas',
    counterpartyCnpjCpf: '12345678000190',
    txType: BankTransactionType.DEBIT,
    source: ReconciliationAliasSource.AUTO_MATCH,
    confirmedCount: 1,
    rejectedCount: 0,
    firstObservedAt: new Date('2026-01-01'),
    lastConfirmedAt: new Date('2026-01-01'),
    disabledAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ReconciliationAliasService', () => {
  let service: ReconciliationAliasService;
  let prisma: { reconciliationAlias: any };

  beforeEach(async () => {
    prisma = {
      reconciliationAlias: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationAliasService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ReconciliationAliasService);
  });

  describe('aliasConfidence', () => {
    it('returns 0 for disabled aliases regardless of source', () => {
      expect(
        service.aliasConfidence(
          makeAlias({ disabledAt: new Date(), source: ReconciliationAliasSource.MANUAL_MATCH, confirmedCount: 10 }),
        ),
      ).toBe(0);
    });

    it('returns 1.0 for MANUAL_MATCH with ≥3 confirmations', () => {
      expect(
        service.aliasConfidence(
          makeAlias({ source: ReconciliationAliasSource.MANUAL_MATCH, confirmedCount: 3 }),
        ),
      ).toBe(1.0);
    });

    it('returns 0.9 for MANUAL_MATCH below 3 confirmations', () => {
      expect(
        service.aliasConfidence(
          makeAlias({ source: ReconciliationAliasSource.MANUAL_MATCH, confirmedCount: 1 }),
        ),
      ).toBe(0.9);
    });

    it('returns 0.95 for ADMIN_SEEDED', () => {
      expect(
        service.aliasConfidence(
          makeAlias({ source: ReconciliationAliasSource.ADMIN_SEEDED, confirmedCount: 1 }),
        ),
      ).toBe(0.95);
    });

    it('returns 0.85 for AUTO_MATCH with ≥5 confirmations', () => {
      expect(
        service.aliasConfidence(
          makeAlias({ source: ReconciliationAliasSource.AUTO_MATCH, confirmedCount: 5 }),
        ),
      ).toBe(0.85);
    });

    it('returns 0.75 for AUTO_MATCH with 2-4 confirmations', () => {
      expect(
        service.aliasConfidence(
          makeAlias({ source: ReconciliationAliasSource.AUTO_MATCH, confirmedCount: 2 }),
        ),
      ).toBe(0.75);
    });

    it('returns 0 for single AUTO_MATCH (never auto-bootstrap)', () => {
      expect(
        service.aliasConfidence(
          makeAlias({ source: ReconciliationAliasSource.AUTO_MATCH, confirmedCount: 1 }),
        ),
      ).toBe(0);
    });
  });

  describe('resolve', () => {
    it('returns null when memo doesnt fingerprint', async () => {
      const result = await service.resolve('PIX TED DOC', BankTransactionType.CREDIT);
      expect(result).toBeNull();
      expect(prisma.reconciliationAlias.findMany).not.toHaveBeenCalled();
    });

    it('returns the top-ranked alias', async () => {
      const top = makeAlias({
        source: ReconciliationAliasSource.MANUAL_MATCH,
        confirmedCount: 5,
      });
      prisma.reconciliationAlias.findMany.mockResolvedValue([top]);
      const result = await service.resolve('ACME TINTAS', BankTransactionType.DEBIT);
      expect(result).toBe(top);
    });

    it('prefers manual over auto regardless of count', async () => {
      const manual = makeAlias({
        id: 'manual',
        source: ReconciliationAliasSource.MANUAL_MATCH,
        confirmedCount: 1,
        counterpartyCnpjCpf: '11111111000111',
      });
      const auto = makeAlias({
        id: 'auto',
        source: ReconciliationAliasSource.AUTO_MATCH,
        confirmedCount: 10,
        counterpartyCnpjCpf: '22222222000122',
      });
      // Note: the service re-sorts in code, so order returned by DB doesn't matter.
      prisma.reconciliationAlias.findMany.mockResolvedValue([auto, manual]);
      const result = await service.resolve('ACME TINTAS', BankTransactionType.DEBIT);
      expect(result?.id).toBe('manual');
    });

    it('returns null when two aliases of the same rank tie within 2x ratio', async () => {
      const a = makeAlias({
        id: 'a',
        source: ReconciliationAliasSource.MANUAL_MATCH,
        confirmedCount: 2,
        counterpartyCnpjCpf: '11111111000111',
      });
      const b = makeAlias({
        id: 'b',
        source: ReconciliationAliasSource.MANUAL_MATCH,
        confirmedCount: 2,
        counterpartyCnpjCpf: '22222222000122',
      });
      prisma.reconciliationAlias.findMany.mockResolvedValue([a, b]);
      const result = await service.resolve('ACME TINTAS', BankTransactionType.DEBIT);
      expect(result).toBeNull();
    });

    it('resolves cleanly when both aliases map to the same CNPJ', async () => {
      const a = makeAlias({
        id: 'a',
        source: ReconciliationAliasSource.MANUAL_MATCH,
        confirmedCount: 2,
        counterpartyCnpjCpf: '11111111000111',
      });
      const b = makeAlias({
        id: 'b',
        source: ReconciliationAliasSource.MANUAL_MATCH,
        confirmedCount: 2,
        counterpartyCnpjCpf: '11111111000111',
      });
      prisma.reconciliationAlias.findMany.mockResolvedValue([a, b]);
      const result = await service.resolve('ACME TINTAS', BankTransactionType.DEBIT);
      expect(result).not.toBeNull();
      expect(result?.counterpartyCnpjCpf).toBe('11111111000111');
    });
  });

  describe('recordReversal', () => {
    it('does nothing when alias does not exist', async () => {
      prisma.reconciliationAlias.findUnique.mockResolvedValue(null);
      await service.recordReversal({
        memo: 'ACME TINTAS',
        txType: BankTransactionType.DEBIT,
        counterpartyCnpjCpf: '12345678000190',
      });
      expect(prisma.reconciliationAlias.update).not.toHaveBeenCalled();
    });

    it('soft-disables AUTO_MATCH alias when rejections cross threshold and overtake confirms', async () => {
      prisma.reconciliationAlias.findUnique.mockResolvedValue(
        makeAlias({
          source: ReconciliationAliasSource.AUTO_MATCH,
          confirmedCount: 1,
          rejectedCount: 1, // next reversal will make it 2 >= threshold (2) and > confirmed (1)
        }),
      );
      await service.recordReversal({
        memo: 'ACME TINTAS',
        txType: BankTransactionType.DEBIT,
        counterpartyCnpjCpf: '12345678000190',
      });
      const call = prisma.reconciliationAlias.update.mock.calls[0][0];
      expect(call.data.rejectedCount).toBe(2);
      expect(call.data.disabledAt).toBeInstanceOf(Date);
    });

    it('never disables a MANUAL_MATCH alias', async () => {
      prisma.reconciliationAlias.findUnique.mockResolvedValue(
        makeAlias({
          source: ReconciliationAliasSource.MANUAL_MATCH,
          confirmedCount: 1,
          rejectedCount: 5,
        }),
      );
      await service.recordReversal({
        memo: 'ACME TINTAS',
        txType: BankTransactionType.DEBIT,
        counterpartyCnpjCpf: '12345678000190',
      });
      const call = prisma.reconciliationAlias.update.mock.calls[0][0];
      expect(call.data.disabledAt).toBeUndefined();
    });
  });
});

describe('inferCounterpartyCnpj', () => {
  const owner = '99888777000166';

  it('returns destCnpj when emitter is us', () => {
    expect(
      inferCounterpartyCnpj(
        { emitCnpj: owner, destCnpj: '11111111000111', destCpf: null },
        owner,
      ),
    ).toBe('11111111000111');
  });

  it('falls back to destCpf when destCnpj is null', () => {
    expect(
      inferCounterpartyCnpj(
        { emitCnpj: owner, destCnpj: null, destCpf: '12345678901' },
        owner,
      ),
    ).toBe('12345678901');
  });

  it('returns emitCnpj when destination is us', () => {
    expect(
      inferCounterpartyCnpj(
        { emitCnpj: '11111111000111', destCnpj: owner, destCpf: null },
        owner,
      ),
    ).toBe('11111111000111');
  });

  it('returns null when neither side is the owner', () => {
    expect(
      inferCounterpartyCnpj(
        { emitCnpj: '11111111000111', destCnpj: '22222222000122', destCpf: null },
        owner,
      ),
    ).toBeNull();
  });

  it('returns null without an owner CNPJ', () => {
    expect(
      inferCounterpartyCnpj(
        { emitCnpj: '11111111000111', destCnpj: '22222222000122', destCpf: null },
        null,
      ),
    ).toBeNull();
  });

  it('handles formatted CNPJ comparison via digit stripping', () => {
    expect(
      inferCounterpartyCnpj(
        { emitCnpj: '99.888.777/0001-66', destCnpj: '11111111000111', destCpf: null },
        '99888777000166',
      ),
    ).toBe('11111111000111');
  });
});
