import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BankTransactionType,
  FiscalDocumentOperation,
  ReconciliationCategory,
  ReconciliationMatchType,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ReconciliationAliasService } from './reconciliation-alias.service';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';

const COMPANY_CNPJ = '13636938000144';
// Mercado Pago's CNPJ — the payment intermediary that shows up in the bank memo
// instead of the store that actually emitted the NF.
const INTERMEDIARY_CNPJ = '10573521000191';

/** Builds a marketplace PIX debit like the ones Sicredi exports. */
function marketplaceTx(overrides: Partial<any> = {}) {
  return {
    id: 'tx-1',
    postedAt: new Date('2026-05-20T12:00:00Z'),
    amount: -460.0,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: INTERMEDIARY_CNPJ,
    counterpartyName: 'PIX Marketplace',
    memo: 'PAGAMENTO PIX-PIX_DEB 10573521000191 PIX Marketplace',
    bankSlipId: null,
    reconciliationStatus: ReconciliationStatus.PENDING,
    category: ReconciliationCategory.NF,
    ...overrides,
  };
}

/** A purchase NF (ENTRADA) addressed to our company. */
function purchaseDoc(overrides: Partial<any> = {}) {
  return {
    id: 'doc-1',
    totalValue: 460.0,
    issueDate: new Date('2026-05-19T12:00:00Z'),
    emitCnpj: '99999999000199',
    emitName: 'ATACADAO DA PECA LTDA',
    ...overrides,
  };
}

describe('ReconciliationMatcherService — marketplace value-only matching', () => {
  let service: ReconciliationMatcherService;
  let findMany: jest.Mock;
  let txUpdate: jest.Mock;
  let matchCreate: jest.Mock;

  async function build(findManyImpl: (args: any) => Promise<any[]>) {
    findMany = jest.fn(findManyImpl);
    txUpdate = jest.fn().mockResolvedValue({});
    matchCreate = jest.fn().mockResolvedValue({});

    const prisma = {
      // tryMarketplaceValueMatch queries fiscalDocument.findMany once.
      fiscalDocument: { findMany },
      bankSlip: { findMany: jest.fn().mockResolvedValue([]) },
      // $transaction runs the callback with a client exposing the two writes.
      $transaction: jest.fn(async (cb: any) =>
        cb({
          bankTransaction: { update: txUpdate },
          reconciliationMatch: { create: matchCreate },
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationMatcherService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ReconciliationAliasService,
          useValue: { resolve: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(COMPANY_CNPJ) },
        },
      ],
    }).compile();

    service = moduleRef.get(ReconciliationMatcherService);
  }

  it('auto-confirms when exactly one equal-value purchase exists', async () => {
    await build(async () => [purchaseDoc()]);

    const result = await service.matchTransaction(marketplaceTx() as any);

    expect(result).toBe(true);
    // Scoped to our own purchases, by value, in the date window.
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.operationType).toBe(FiscalDocumentOperation.ENTRADA);
    expect(where.destCnpj).toBe(COMPANY_CNPJ);
    expect(where.status).toBe('AUTHORIZED');
    expect(where.matches).toEqual({ none: {} });
    // Linked as a value/date match, not EXACT (no CNPJ corroboration).
    expect(matchCreate).toHaveBeenCalledTimes(1);
    expect(matchCreate.mock.calls[0][0].data.matchType).toBe(
      ReconciliationMatchType.VALUE_DATE,
    );
    expect(txUpdate.mock.calls[0][0].data.reconciliationStatus).toBe(
      ReconciliationStatus.RECONCILED,
    );
  });

  it('absorbs centavo rounding within the perfect-value tolerance', async () => {
    // Paid 479,98 against an NF total of 480,00 (2 centavos of rounding).
    await build(async () => [purchaseDoc({ id: 'doc-r', totalValue: 480.0 })]);

    const result = await service.matchTransaction(
      marketplaceTx({ amount: -479.98 }) as any,
    );

    expect(result).toBe(true);
    expect(matchCreate).toHaveBeenCalledTimes(1);
  });

  it('defers to manual when two equal-value purchases are ambiguous', async () => {
    await build(async () => [
      purchaseDoc({ id: 'doc-a' }),
      purchaseDoc({ id: 'doc-b', issueDate: new Date('2026-05-18T12:00:00Z') }),
    ]);

    const result = await service.matchTransaction(marketplaceTx() as any);

    expect(result).toBe(false);
    expect(matchCreate).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when no purchase matches the value', async () => {
    await build(async () => []);

    const result = await service.matchTransaction(marketplaceTx() as any);

    expect(result).toBe(false);
    expect(matchCreate).not.toHaveBeenCalled();
  });

  it('also handles the no-CNPJ memo variant', async () => {
    await build(async () => [purchaseDoc()]);

    const result = await service.matchTransaction(
      marketplaceTx({
        counterpartyCnpjCpf: null,
        memo: 'PAGAMENTO PIX-PIX_DEB PIX Marketplace',
      }) as any,
    );

    expect(result).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('skips non-NF transactions entirely', async () => {
    await build(async () => [purchaseDoc()]);

    const result = await service.matchTransaction(
      marketplaceTx({ category: ReconciliationCategory.ESTORNO }) as any,
    );

    expect(result).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });
});
