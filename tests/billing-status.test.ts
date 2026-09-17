/**
 * A REGRA DO ESTADO DO FATURAMENTO, sem banco e sem rede.
 *
 * `BillingStatusCascadeService.resolve()` é pura de propósito: ela recebe o
 * faturamento já carregado e devolve o estado. Isto aqui é o que prova que a
 * separação faz o que promete — inclusive o caso que o modelo antigo não sabia
 * representar: duas cobranças do MESMO orçamento em estados diferentes.
 */
import { BillingStatusCascadeService } from '../src/modules/financial/billing/billing-status-cascade.service';
import { BILLING_STATUS, TASK_QUOTE_STATUS } from '../src/constants';

const svc = new BillingStatusCascadeService(null as any);

let ok = 0;
let fail = 0;
function check(nome: string, real: unknown, esperado: unknown) {
  if (real === esperado) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome} — esperado ${esperado}, veio ${real}`);
  }
}

const HOJE = new Date();
const ONTEM = new Date(HOJE.getTime() - 3 * 24 * 60 * 60 * 1000);
const AMANHA = new Date(HOJE.getTime() + 30 * 24 * 60 * 60 * 1000);

type Parcela = { status: string; dueDate: Date };
const billing = (
  parcelas: Parcela[],
  opts: { approvedAt?: Date | null; quoteStatus?: string; status?: string } = {},
) => ({
  status: opts.status ?? BILLING_STATUS.PENDING,
  approvedAt: opts.approvedAt ?? null,
  quote: { status: opts.quoteStatus ?? TASK_QUOTE_STATUS.APPROVED },
  customerConfigs: [{ installments: parcelas }],
});

// ── sem parcela: quem responde é a aprovação ────────────────────────────────
check('sem parcela e sem aprovação → PENDENTE', svc.resolve(billing([])), BILLING_STATUS.PENDING);
check(
  'sem parcela e aprovado → APROVADO',
  svc.resolve(billing([], { approvedAt: HOJE })),
  BILLING_STATUS.APPROVED,
);

// ── com parcela ─────────────────────────────────────────────────────────────
check(
  'aprovado, nada pago, nada vencido → APROVADO (e NÃO "a vencer", que não existe mais)',
  svc.resolve(billing([{ status: 'PENDING', dueDate: AMANHA }], { approvedAt: HOJE })),
  BILLING_STATUS.APPROVED,
);
check(
  'todas pagas → LIQUIDADO',
  svc.resolve(
    billing([{ status: 'PAID', dueDate: ONTEM }, { status: 'PAID', dueDate: ONTEM }], {
      approvedAt: HOJE,
    }),
  ),
  BILLING_STATUS.SETTLED,
);
check(
  'uma paga, outra a vencer → PARCIAL',
  svc.resolve(
    billing([{ status: 'PAID', dueDate: ONTEM }, { status: 'PENDING', dueDate: AMANHA }], {
      approvedAt: HOJE,
    }),
  ),
  BILLING_STATUS.PARTIAL,
);
check(
  'uma vencida não paga → VENCIDO',
  svc.resolve(billing([{ status: 'PENDING', dueDate: ONTEM }], { approvedAt: HOJE })),
  BILLING_STATUS.OVERDUE,
);
check(
  'VENCIDO tem precedência sobre PARCIAL (uma paga, uma vencida)',
  svc.resolve(
    billing([{ status: 'PAID', dueDate: ONTEM }, { status: 'PENDING', dueDate: ONTEM }], {
      approvedAt: HOJE,
    }),
  ),
  BILLING_STATUS.OVERDUE,
);

// ── as regras que existem por causa de um defeito real ──────────────────────
check(
  'parcela que vence HOJE não está vencida (comparação por dia, não por instante)',
  svc.resolve(billing([{ status: 'PENDING', dueDate: HOJE }], { approvedAt: HOJE })),
  BILLING_STATUS.APPROVED,
);
check(
  'canceladas não contam: paga + cancelada → LIQUIDADO',
  svc.resolve(
    billing([{ status: 'PAID', dueDate: ONTEM }, { status: 'CANCELLED', dueDate: ONTEM }], {
      approvedAt: HOJE,
    }),
  ),
  BILLING_STATUS.SETTLED,
);
check(
  'TODAS canceladas preserva o estado (não apaga um pagamento que houve)',
  svc.resolve(
    billing([{ status: 'CANCELLED', dueDate: ONTEM }], {
      approvedAt: HOJE,
      status: BILLING_STATUS.SETTLED,
    }),
  ),
  BILLING_STATUS.SETTLED,
);
check(
  'todas canceladas E carimbo levantado → volta a PENDENTE (cancelar a última fatura desaprova)',
  svc.resolve(
    billing([{ status: 'CANCELLED', dueDate: ONTEM }], {
      approvedAt: null,
      status: BILLING_STATUS.APPROVED,
    }),
  ),
  BILLING_STATUS.PENDING,
);
check(
  'LIQUIDADO sem parcela nenhuma é PRESERVADO (liquidação por conciliação)',
  svc.resolve(billing([], { approvedAt: null, status: BILLING_STATUS.SETTLED })),
  BILLING_STATUS.SETTLED,
);
check(
  'mas PENDENTE sem parcela continua PENDENTE (cobrança que não saiu do papel)',
  svc.resolve(billing([], { approvedAt: null, status: BILLING_STATUS.PENDING })),
  BILLING_STATUS.PENDING,
);
check(
  'e APROVADO sem parcela segue a aprovação, não o estado gravado',
  svc.resolve(billing([], { approvedAt: HOJE, status: BILLING_STATUS.PENDING })),
  BILLING_STATUS.APPROVED,
);
check(
  'orçamento cancelado cancela a cobrança',
  svc.resolve(
    billing([{ status: 'PAID', dueDate: ONTEM }], {
      approvedAt: HOJE,
      quoteStatus: TASK_QUOTE_STATUS.CANCELLED,
    }),
  ),
  BILLING_STATUS.CANCELLED,
);

// ── O CASO QUE O MODELO ANTIGO NÃO SABIA REPRESENTAR ────────────────────────
//
// Mesmo orçamento, duas cobranças: a do caminhão 1 paga, a do caminhão 2
// vencida. Com o estado em `TaskQuote.status` havia UM campo para as duas, e
// quem escrevesse por último ganhava.
const fatia1 = billing([{ status: 'PAID', dueDate: ONTEM }], { approvedAt: HOJE });
const fatia2 = billing([{ status: 'PENDING', dueDate: ONTEM }], { approvedAt: HOJE });
check('fatia paga → LIQUIDADO', svc.resolve(fatia1), BILLING_STATUS.SETTLED);
check('fatia vencida, no MESMO orçamento → VENCIDO', svc.resolve(fatia2), BILLING_STATUS.OVERDUE);

// ── uma fatia paga NÃO liquida o contrato ───────────────────────────────────
//
// A guarda "LIQUIDADO exige que TUDO esteja faturado" existia no modelo antigo
// porque `pagas === ativas` dava verdadeiro quando o caminhão 1 de 60 era pago:
// os outros 59 não tinham parcela para contrapor. Aqui a pergunta nem se faz —
// a fatia responde por si, e o contrato é a conjunção delas.
const todasLiquidadas = [fatia1, fatia1].every(
  b => svc.resolve(b) === BILLING_STATUS.SETTLED,
);
const misturado = [fatia1, fatia2].every(b => svc.resolve(b) === BILLING_STATUS.SETTLED);
check('duas fatias pagas → contrato quitado', todasLiquidadas, true);
check('uma paga e uma vencida → contrato NÃO quitado', misturado, false);

console.log(`\n${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
