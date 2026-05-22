import { Test } from '@nestjs/testing';
import {
  BankTransactionSubtype,
  BankTransactionType,
  ReconciliationCategory,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ReconciliationAliasService } from './reconciliation-alias.service';
import { ReconciliationClassifierService } from './reconciliation-classifier.service';

// Memo strings collected verbatim from production OFX imports. Each row exercises
// one classification rule. New patterns observed in the field belong here.
const PROD_SAMPLES: Array<{
  memo: string;
  subtype: BankTransactionSubtype;
  type: BankTransactionType;
  counterpartyCnpjCpf: string | null;
  expected: ReconciliationCategory;
  note: string;
}> = [
  {
    memo: 'TARIFA BAIXA DE TITULOS-COB000004',
    subtype: BankTransactionSubtype.TARIFA,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TARIFA_BANCARIA,
    note: 'TARIFA subtype short-circuits',
  },
  {
    memo: 'TARIFA COM R LIQUIDACAO-COB000001',
    subtype: BankTransactionSubtype.TARIFA,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TARIFA_BANCARIA,
    note: 'Sicredi cob fee variant',
  },
  {
    memo: 'MANUTENCAO DE TITULOS-COB000001',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TARIFA_BANCARIA,
    note: 'subtype=OUTROS but memo matches MANUTENCAO',
  },
  {
    memo: 'DEBITO ARRECADACAO-DARFC0385 00394460005887 DARFC0385',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TRIBUTO,
    note: 'DARF arrecadação',
  },
  {
    memo: 'DEB. FOLHA PAGTO-2V5W---04',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.FOLHA,
    note: 'Sicredi folha de pagamento',
  },
  {
    memo: 'APLIC.FINANC.AVISO PREVIO-CAPTACAO',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TRANSFERENCIA,
    note: 'Investment outbound',
  },
  {
    memo: 'RESG.APLIC.FIN.AVISO PREV-CAPTACAO',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.CREDIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TRANSFERENCIA,
    note: 'Investment redemption',
  },
  {
    memo: 'APLIC FUNDOS DE INVEST-DEB_FCO',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TRANSFERENCIA,
    note: 'Fund investment',
  },
  {
    memo: 'RESG FUNDOS DE INVEST-FUND.DIG  RESG FUNDOS CONTA E ORDEM',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.CREDIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TRANSFERENCIA,
    note: 'Fund redemption',
  },
  {
    memo: 'PLANO INT CAPITAL-CAPITA',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.TRANSFERENCIA,
    note: 'Capital plan adjustment',
  },
  {
    memo: 'DEBITO CONVENIOS-SAMAEIB ID 00280286 SAMAE IBIPORA 78079639000100',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: '78079639000100',
    expected: ReconciliationCategory.CONVENIO,
    note: 'SAMAE water utility convênio',
  },
  {
    memo: 'DEBITO CONVENIOS-COPEL ID 0000113926715 COPEL DISTRIBUICAO 04368898000106',
    subtype: BankTransactionSubtype.OUTROS,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: '04368898000106',
    expected: ReconciliationCategory.CONVENIO,
    note: 'COPEL electric utility convênio',
  },
  {
    memo: 'DEVOLUCAO PIX-PIX_CRED 10573521000191 PIX Marketplace',
    subtype: BankTransactionSubtype.PIX,
    type: BankTransactionType.CREDIT,
    counterpartyCnpjCpf: '10573521000191',
    expected: ReconciliationCategory.ESTORNO,
    note: 'PIX refund',
  },
  {
    memo: 'PAGAMENTO PIX-PIX_DEB 85111441000113 FARBEN SA INDUSTRIA QUIMICA',
    subtype: BankTransactionSubtype.PIX,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: '85111441000113',
    expected: ReconciliationCategory.NF,
    note: 'Regular supplier PIX — falls through to NF',
  },
  {
    memo: 'LIQUIDACAO BOLETO-          75222224000147 UNIMED DE LONDRINA',
    subtype: BankTransactionSubtype.BOLETO,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: '75222224000147',
    expected: ReconciliationCategory.NF,
    note: 'Supplier boleto — NF match path',
  },
  {
    memo: 'COMPRAS NACIONAIS-VE0593231 EMPORIO CENTRAL IBIPORA BR',
    subtype: BankTransactionSubtype.CARTAO,
    type: BankTransactionType.DEBIT,
    counterpartyCnpjCpf: null,
    expected: ReconciliationCategory.UNCLASSIFIED,
    note: 'Debit card purchase without parseable CNPJ',
  },
];

describe('ReconciliationClassifierService', () => {
  let service: ReconciliationClassifierService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationClassifierService,
        {
          provide: ReconciliationAliasService,
          useValue: {
            // Alias lookup always misses in this test — we're isolating the
            // regex + subtype + fallthrough rules. Alias-driven tests live in
            // reconciliation-alias.service.spec.ts.
            resolve: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = moduleRef.get(ReconciliationClassifierService);
  });

  describe('classify() pure rules', () => {
    for (const sample of PROD_SAMPLES) {
      it(`classifies "${sample.note}"`, async () => {
        const result = await service.classify({
          id: 'test',
          memo: sample.memo,
          subtype: sample.subtype,
          type: sample.type,
          counterpartyCnpjCpf: sample.counterpartyCnpjCpf,
          reconciliationStatus: ReconciliationStatus.PENDING,
          category: ReconciliationCategory.UNCLASSIFIED,
        });
        expect(result.category).toBe(sample.expected);
      });
    }
  });

  it('shouldReconcile=true for self-justifying categories', async () => {
    const result = await service.classify({
      id: 'x',
      memo: 'TARIFA BAIXA',
      subtype: BankTransactionSubtype.TARIFA,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: null,
      reconciliationStatus: ReconciliationStatus.PENDING,
      category: ReconciliationCategory.UNCLASSIFIED,
    });
    expect(result.shouldReconcile).toBe(true);
  });

  it('shouldReconcile=false for NF category', async () => {
    const result = await service.classify({
      id: 'x',
      memo: 'PAGAMENTO PIX-PIX_DEB 85111441000113 FARBEN',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '85111441000113',
      reconciliationStatus: ReconciliationStatus.PENDING,
      category: ReconciliationCategory.UNCLASSIFIED,
    });
    expect(result.category).toBe(ReconciliationCategory.NF);
    expect(result.shouldReconcile).toBe(false);
  });

  it('owner CPF auto-classifies as PRO_LABORE', async () => {
    const result = await service.classify({
      id: 'x',
      memo: 'PAGAMENTO PIX-PIX_DEB Sergio Rodrigues',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '06856214995', // Sergio
      reconciliationStatus: ReconciliationStatus.PENDING,
      category: ReconciliationCategory.UNCLASSIFIED,
    });
    expect(result.category).toBe(ReconciliationCategory.PRO_LABORE);
    expect(result.shouldReconcile).toBe(true);
  });

  it('owner CPF takes precedence over memo regex', async () => {
    // Even if Genivaldo's memo accidentally hits a memo rule, the CPF wins.
    const result = await service.classify({
      id: 'x',
      memo: 'PAGAMENTO PIX-PIX_DEB DEBITO ARRECADACAO Genivaldo',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '07332960923', // Genivaldo
      reconciliationStatus: ReconciliationStatus.PENDING,
      category: ReconciliationCategory.UNCLASSIFIED,
    });
    expect(result.category).toBe(ReconciliationCategory.PRO_LABORE);
  });

  it('alias with category wins over regex', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationClassifierService,
        {
          provide: ReconciliationAliasService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              id: 'a',
              category: ReconciliationCategory.PRO_LABORE,
              confirmedCount: 3,
              counterpartyCnpjCpf: '06856214995',
            }),
          },
        },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    const aliasAware = moduleRef.get(ReconciliationClassifierService);

    const result = await aliasAware.classify({
      id: 'x',
      memo: 'PAGAMENTO PIX-PIX_DEB 06856214995 Sergio Rodrigues',
      subtype: BankTransactionSubtype.PIX,
      type: BankTransactionType.DEBIT,
      counterpartyCnpjCpf: '06856214995',
      reconciliationStatus: ReconciliationStatus.PENDING,
      category: ReconciliationCategory.UNCLASSIFIED,
    });
    expect(result.category).toBe(ReconciliationCategory.PRO_LABORE);
    expect(result.shouldReconcile).toBe(true);
  });
});
