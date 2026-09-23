/**
 * A LENTE DO "FATURAR PARA", sem banco.
 *
 * Caso real (orçamento 269): UMA cobrança, DOIS pagadores — a Ibiporã
 * (R$ 14.306,00) e a RKO (R$ 13.850,60). Filtrar pela RKO tem de perguntar só à
 * RKO: faixa de valor, vencimento e estado. Aqui um Prisma de mentira grava o
 * `where` que o serviço monta e devolve as linhas de um acervo fixo.
 */
import { BillingService } from '../src/modules/financial/billing/billing.service';
import { BillingStatusCascadeService } from '../src/modules/financial/billing/billing-status-cascade.service';
import { BILLING_STATUS, TASK_QUOTE_STATUS } from '../src/constants';

let ok = 0;
let fail = 0;
function check(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome} — esperado ${b}, veio ${a}`);
  }
}

const IBIPORA = 'cust-ibipora';
const RKO = 'cust-rko';
const HOJE = new Date();
const ATRASADA = new Date(HOJE.getTime() - 10 * 24 * 60 * 60 * 1000);

// A Ibiporã pagou a parte dela; a da RKO venceu e não foi paga. A cobrança lê
// VENCIDO (é o pior dos dois), mas cada parte tem o seu estado.
const b269 = {
  id: 'billing-269',
  status: BILLING_STATUS.OVERDUE,
  approvedAt: ATRASADA,
  quote: { status: TASK_QUOTE_STATUS.APPROVED },
  customerConfigs: [
    {
      customerId: IBIPORA,
      total: 14306,
      installments: [{ status: 'PAID', dueDate: ATRASADA, amount: 14306, paidAmount: 14306 }],
    },
    {
      customerId: RKO,
      total: 13850.6,
      installments: [{ status: 'OVERDUE', dueDate: ATRASADA, amount: 13850.6, paidAmount: 0 }],
    },
  ],
};

type Call = { op: string; args: any };
function fakePrisma(rows: any[]) {
  const calls: Call[] = [];
  const idsFrom = (where: any): string[] | null => {
    const clause = (where?.AND ?? []).find((c: any) => c?.id?.in);
    return clause ? clause.id.in : null;
  };
  const pick = (where: any) => {
    const ids = idsFrom(where);
    return ids ? rows.filter(r => ids.includes(r.id)) : rows;
  };
  return {
    calls,
    billing: {
      findMany: async (args: any) => {
        calls.push({ op: 'findMany', args });
        if (args.select) {
          // A passada dos candidatos: devolve só os pagadores do `where` do select.
          const inLens: string[] = args.select.customerConfigs.where?.customerId?.in ?? [];
          return rows.map(r => ({
            ...r,
            customerConfigs: r.customerConfigs.filter(
              (c: any) => inLens.length === 0 || inLens.includes(c.customerId),
            ),
          }));
        }
        return pick(args.where);
      },
      count: async (args: any) => {
        calls.push({ op: 'count', args });
        return pick(args.where).length;
      },
    },
  };
}

const svcWith = (rows: any[]) => {
  const prisma = fakePrisma(rows);
  const svc = new BillingService(prisma as any, new BillingStatusCascadeService(null as any));
  return { svc, prisma };
};

const andOf = (prisma: ReturnType<typeof fakePrisma>) =>
  prisma.calls.filter(c => c.op === 'findMany' && c.args.include).at(-1)!.args.where.AND ?? [];

(async () => {
  // ── sem lente: nada muda ─────────────────────────────────────────────────
  {
    const { svc, prisma } = svcWith([b269]);
    const res = await svc.findMany({
      statuses: [BILLING_STATUS.OVERDUE],
      totalRange: { min: 14000 },
    });
    const page = prisma.calls.find(c => c.op === 'findMany' && c.args.include)!.args.where;
    check('sem lente: o estado filtrado é o da cobrança', page.status, {
      in: [BILLING_STATUS.OVERDUE],
    });
    check('sem lente: a faixa de valor olha qualquer pagador', page.AND[0], {
      customerConfigs: { some: { total: { gte: 14000 } } },
    });
    check(
      'sem lente: não há passada de candidatos',
      prisma.calls.filter(c => c.args.select).length,
      0,
    );
    check('sem lente: a linha não ganha payerStatus', 'payerStatus' in (res.data[0] as any), false);
  }

  // ── lente RKO: faixa de valor e vencimento perguntam só à RKO ────────────
  {
    const { prisma, svc } = svcWith([b269]);
    await svc.findMany({
      customerIds: [RKO],
      totalRange: { min: 14000, max: 14500 },
      dueDateRange: { from: ATRASADA, to: HOJE },
    });
    const and = andOf(prisma);
    check('lente: a faixa de valor entra no MESMO `some` do cliente', and[0], {
      customerConfigs: { some: { customerId: { in: [RKO] }, total: { gte: 14000, lte: 14500 } } },
    });
    check(
      'lente: o vencimento (existe em aberto na faixa) é só da RKO',
      and[1].customerConfigs.some.customerId,
      {
        in: [RKO],
      },
    );
    check(
      'lente: o vencimento (nenhuma mais antiga) é só da RKO',
      and[2].customerConfigs.none.customerId,
      {
        in: [RKO],
      },
    );
  }

  // ── o estado da PARTE ────────────────────────────────────────────────────
  {
    const { svc } = svcWith([b269]);
    const res = await svc.findMany({ customerIds: [RKO] });
    check(
      'lente RKO: a parte dela está VENCIDA',
      (res.data[0] as any).payerStatus,
      BILLING_STATUS.OVERDUE,
    );
  }
  {
    const { svc } = svcWith([b269]);
    const res = await svc.findMany({ customerIds: [IBIPORA] });
    check(
      'lente Ibiporã: a parte dela está LIQUIDADA',
      (res.data[0] as any).payerStatus,
      BILLING_STATUS.SETTLED,
    );
    check(
      'o estado da cobrança continua o dela',
      (res.data[0] as any).status,
      BILLING_STATUS.OVERDUE,
    );
  }
  {
    const { svc, prisma } = svcWith([b269]);
    const res = await svc.findMany({ customerIds: [IBIPORA], statuses: [BILLING_STATUS.OVERDUE] });
    const page = prisma.calls.find(c => c.op === 'findMany' && c.args.include)!.args.where;
    check('lente + estado: o filtro NÃO é o `Billing.status`', page.status, undefined);
    check(
      '"vencidos da Ibiporã" não traz o 269 — a parte dela está paga',
      res.meta.totalRecords,
      0,
    );
  }
  {
    const { svc } = svcWith([b269]);
    const res = await svc.findMany({ customerIds: [RKO], statuses: [BILLING_STATUS.OVERDUE] });
    check(
      '"vencidos da RKO" traz o 269',
      res.data.map((b: any) => b.id),
      ['billing-269'],
    );
  }
  {
    const { svc } = svcWith([b269]);
    const res = await svc.findMany({
      customerIds: [IBIPORA, RKO],
      statuses: [BILLING_STATUS.OVERDUE],
    });
    check(
      'lente com os DOIS pagadores = o estado da cobrança inteira',
      (res.data[0] as any).payerStatus,
      BILLING_STATUS.OVERDUE,
    );
  }
  {
    const { svc } = svcWith([b269]);
    const res = await svc.findMany({ customerId: RKO });
    check(
      '`customerId` (singular) é a mesma lente',
      (res.data[0] as any).payerStatus,
      BILLING_STATUS.OVERDUE,
    );
  }

  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
})();
