import { Test } from '@nestjs/testing';
import {
  BankTransactionSubtype,
  BankTransactionType,
  ReconciliationStatus,
  TransactionCategoryKind,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ReconciliationAliasService } from './reconciliation-alias.service';
import { ReconciliationClassifierService } from './reconciliation-classifier.service';
import { TransactionCategoryService } from './transaction-category.service';

// Fake transaction-only taxonomy: slug → category row. Mirrors what the
// migration seeds (all transaction-only, isResolving=true).
const TX_ONLY_SLUGS = [
  'tributo',
  'folha',
  'transferencia',
  'tarifa-bancaria',
  'convenio',
  'pro-labore',
  'aluguel',
  'estorno',
  'outros',
];

function fakeCategory(slug: string) {
  return {
    id: slug,
    name: slug,
    slug,
    kind: TransactionCategoryKind.TRANSACTION_ONLY,
    itemCategoryId: null,
    isResolving: true,
    isRecurring: false,
    color: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fakeCategoryService(): Pick<
  TransactionCategoryService,
  'resolveBySlug' | 'snapshot'
> {
  const byId = new Map(TX_ONLY_SLUGS.map(s => [s, fakeCategory(s)]));
  const bySlug = new Map(TX_ONLY_SLUGS.map(s => [s, fakeCategory(s)]));
  return {
    resolveBySlug: (async (slug: string) => bySlug.get(slug)) as never,
    snapshot: (async () => ({
      all: [...byId.values()],
      bySlug,
      byId,
      byItemCategoryId: new Map(),
      byNameKey: new Map(),
    })) as never,
  };
}

// "NF" → expects a fiscal document; "UNCLASSIFIED" → neither category nor NF;
// any other value is the expected transaction-only category slug.
const PROD_SAMPLES: Array<{
  memo: string;
  subtype: BankTransactionSubtype;
  type: BankTransactionType;
  counterpartyCnpjCpf: string | null;
  expected: string;
  note: string;
}> = [
  { memo: 'TARIFA BAIXA DE TITULOS-COB000004', subtype: BankTransactionSubtype.TARIFA, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: null, expected: 'tarifa-bancaria', note: 'TARIFA subtype short-circuits' },
  { memo: 'MANUTENCAO DE TITULOS-COB000001', subtype: BankTransactionSubtype.OUTROS, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: null, expected: 'tarifa-bancaria', note: 'subtype=OUTROS but memo matches MANUTENCAO' },
  { memo: 'DEBITO ARRECADACAO-DARFC0385 00394460005887', subtype: BankTransactionSubtype.OUTROS, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: null, expected: 'tributo', note: 'DARF arrecadação' },
  { memo: 'DEB. FOLHA PAGTO-2V5W---04', subtype: BankTransactionSubtype.OUTROS, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: null, expected: 'folha', note: 'Sicredi folha de pagamento' },
  { memo: 'APLIC.FINANC.AVISO PREVIO-CAPTACAO', subtype: BankTransactionSubtype.OUTROS, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: null, expected: 'transferencia', note: 'Investment outbound' },
  { memo: 'RESG FUNDOS DE INVEST-FUND.DIG', subtype: BankTransactionSubtype.OUTROS, type: BankTransactionType.CREDIT, counterpartyCnpjCpf: null, expected: 'transferencia', note: 'Fund redemption' },
  { memo: 'DEBITO CONVENIOS-COPEL ID 0000113926715 04368898000106', subtype: BankTransactionSubtype.OUTROS, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: '04368898000106', expected: 'convenio', note: 'COPEL electric utility convênio' },
  { memo: 'DEVOLUCAO PIX-PIX_CRED 10573521000191 PIX Marketplace', subtype: BankTransactionSubtype.PIX, type: BankTransactionType.CREDIT, counterpartyCnpjCpf: '10573521000191', expected: 'estorno', note: 'PIX refund' },
  { memo: 'PAGAMENTO PIX-PIX_DEB 85111441000113 FARBEN SA', subtype: BankTransactionSubtype.PIX, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: '85111441000113', expected: 'NF', note: 'Regular supplier PIX — expects NF' },
  { memo: 'PAGAMENTO PIX-PIX_DEB PIX Marketplace', subtype: BankTransactionSubtype.PIX, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: null, expected: 'NF', note: 'Marketplace payment (no CNPJ) — expects NF (value-only matcher)' },
  { memo: 'COMPRAS NACIONAIS-VE0593231 EMPORIO CENTRAL', subtype: BankTransactionSubtype.CARTAO, type: BankTransactionType.DEBIT, counterpartyCnpjCpf: null, expected: 'UNCLASSIFIED', note: 'Debit card purchase without parseable CNPJ' },
];

async function buildService(
  aliasResolve: jest.Mock = jest.fn().mockResolvedValue(null),
): Promise<ReconciliationClassifierService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ReconciliationClassifierService,
      { provide: ReconciliationAliasService, useValue: { resolve: aliasResolve } },
      { provide: PrismaService, useValue: {} },
      { provide: TransactionCategoryService, useValue: fakeCategoryService() },
    ],
  }).compile();
  return moduleRef.get(ReconciliationClassifierService);
}

const baseInput = {
  id: 'test',
  reconciliationStatus: ReconciliationStatus.PENDING,
};

describe('ReconciliationClassifierService', () => {
  let service: ReconciliationClassifierService;

  beforeEach(async () => {
    service = await buildService();
  });

  describe('classify() pure rules', () => {
    for (const sample of PROD_SAMPLES) {
      it(`classifies "${sample.note}"`, async () => {
        const result = await service.classify({
          ...baseInput,
          memo: sample.memo,
          subtype: sample.subtype,
          type: sample.type,
          counterpartyCnpjCpf: sample.counterpartyCnpjCpf,
        });
        if (sample.expected === 'NF') {
          expect(result.expectsFiscalDocument).toBe(true);
          expect(result.category).toBeNull();
        } else if (sample.expected === 'UNCLASSIFIED') {
          expect(result.expectsFiscalDocument).toBe(false);
          expect(result.category).toBeNull();
        } else {
          expect(result.category?.slug).toBe(sample.expected);
        }
      });
    }
  });

  it('shouldReconcile=true for a transaction-only category', async () => {
    const result = await service.classify({
      ...baseInput,
      memo: 'TARIFA BAIXA',
      subtype: BankTransactionSubtype.TARIFA,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: null,
    });
    expect(result.shouldReconcile).toBe(true);
  });

  it('shouldReconcile=false when it expects an NF', async () => {
    const result = await service.classify({
      ...baseInput,
      memo: 'PAGAMENTO PIX-PIX_DEB 85111441000113 FARBEN',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '85111441000113',
    });
    expect(result.expectsFiscalDocument).toBe(true);
    expect(result.shouldReconcile).toBe(false);
  });

  it('owner CPF auto-classifies as pró-labore', async () => {
    const result = await service.classify({
      ...baseInput,
      memo: 'PAGAMENTO PIX-PIX_DEB Sergio Rodrigues',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '06856214995',
    });
    expect(result.category?.slug).toBe('pro-labore');
    expect(result.shouldReconcile).toBe(true);
  });

  it('landlord CPF auto-classifies as aluguel (never falls through to NF)', async () => {
    const result = await service.classify({
      ...baseInput,
      memo: 'PAGAMENTO PIX-PIX_DEB 70564949949 SANDRO FURLAN BOCHI',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '70564949949',
    });
    expect(result.category?.slug).toBe('aluguel');
    expect(result.expectsFiscalDocument).toBe(false);
  });

  it('owner CPF takes precedence over memo regex', async () => {
    const result = await service.classify({
      ...baseInput,
      memo: 'PAGAMENTO PIX-PIX_DEB DEBITO ARRECADACAO Genivaldo',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '07332960923',
    });
    expect(result.category?.slug).toBe('pro-labore');
  });

  it('alias with a learned category wins over regex', async () => {
    const aliasAware = await buildService(
      jest.fn().mockResolvedValue({
        id: 'a',
        categoryId: 'pro-labore',
        confirmedCount: 3,
        counterpartyCnpjCpf: '06856214995',
      }),
    );
    const result = await aliasAware.classify({
      ...baseInput,
      memo: 'PAGAMENTO PIX-PIX_DEB 06856214995 Sergio Rodrigues',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '85111441000113', // different CNPJ so the hardcoded rule misses
    });
    expect(result.category?.slug).toBe('pro-labore');
    expect(result.shouldReconcile).toBe(true);
  });
});
