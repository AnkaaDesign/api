// api/src/modules/production/budget/budget.guards.ts
//
// Shared Budget write-guards. Extracted from BudgetService.update so the
// nested quote write path (PUT /tasks/:id and PUT /tasks/batch via TaskService)
// enforces the SAME rules without duplicating them.
//
// IMPORTANT (user decision 2026-05, reconfirmed 2026-06-10): quote approval
// "pinning" is intended — editing values must NOT reset approval when the
// client pins the status (sends `status`, even as a no-op). Nothing here may
// change that semantics; these guards only add role/lock enforcement.

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BILLING_STATUS, SECTOR_PRIVILEGES, TASK_QUOTE_STATUS } from '@constants';
import { hasLiveInvoice } from '@utils/billing-invoice';

/**
 * O ORÇAMENTO ESTÁ TRAVADO PELO DINHEIRO?
 *
 * Era uma lista de STATUS do orçamento (`BILLING_APPROVED` e o ciclo depois
 * dele). Não pode mais ser: esses estados saíram para o `Billing`, e — mais
 * importante — a trava nunca foi sobre o orçamento. É sobre ter saído fatura,
 * boleto e nota sobre o preço atual, e quem sabe disso é a COBRANÇA.
 *
 * Num orçamento faturado veículo a veículo, a lista antiga também respondia
 * errado por construção: o status era um só, então aprovar a primeira fatia
 * travava o orçamento inteiro — inclusive os cinquenta e nove veículos que ainda
 * não tinham sido cobrados e cujo preço ainda podia mudar.
 *
 * O critério está em `isBillingFrozen`, logo abaixo, e é UM SÓ para todo o
 * sistema: carimbo de aprovação OU estado pós-aprovação. O carimbo sozinho não
 * basta — ver a nota de `isPostApprovalBillingStatus`.
 *
 * ⚠️ Quem chama TEM de carregar `billings` — sem o include a função devolve
 * `false` e a trava do dinheiro simplesmente não acontece.
 */
export function isQuoteMoneyLocked(
  billings: Array<{ approvedAt: Date | string | null; status?: string | null }> | null | undefined,
): boolean {
  return !!billings && billings.some(isBillingFrozen);
}

/** A fatura, como as três formas de perguntar por ela a entregam. */
type InvoiceLike = { status: string } | null | undefined;

/** Um pagador, do qual só interessam as faturas. */
type BillingPayerLike = { invoices?: readonly InvoiceLike[] | null; [key: string]: unknown };

/**
 * O QUE `isBillingFrozen` PRECISA SABER — e as três formas de contar a fatura viva.
 *
 * Os dois primeiros braços se respondem com a linha do `Billing`. O terceiro
 * precisa das FATURAS, e quem pergunta as tem de três jeitos diferentes: já
 * contadas no banco (`hasLiveInvoice`), penduradas no PAGADOR
 * (`BudgetPayer.invoices`) ou nos pagadores do faturamento (`customerConfigs`).
 * Aceitar as três é o que permite haver um predicado só — a alternativa é cada
 * chamador escrever o seu `|| temFatura`, que foi exatamente como as definições
 * divergiram.
 *
 * ⚠️ NUNCA `invoice` no singular. `Invoice.customerConfigId` é único só entre as
 * NÃO canceladas (índice parcial), então a relação é 1:N e a to-one devolvia uma
 * linha arbitrária — ver `utils/billing-invoice.ts`.
 */
export type BillingFrozenInput = {
  approvedAt: Date | string | null;
  status?: string | null;
  /** Braço 3, já respondido: quem contou no banco passa o booleano. */
  hasLiveInvoice?: boolean | null;
  /** Braço 3, pelo PAGADOR: `BudgetPayer.invoices`. */
  invoices?: readonly InvoiceLike[] | null;
  /**
   * Braço 3, pelo FATURAMENTO: os pagadores, cada um com as suas faturas.
   *
   * A assinatura do índice existe porque quem passa `customerConfigs` quase sempre
   * o carrega para OUTRA coisa (os ids, o desconto) e traz campos a mais. Sem ela,
   * a detecção de "weak type" do TypeScript recusa `{ id: string }[]` por não ter
   * propriedade em comum — recusando o chamador certo pelo motivo errado.
   */
  customerConfigs?: readonly (BillingPayerLike | null | undefined)[] | null;
};

/** O braço 3 isolado: existe fatura viva pendurada neste faturamento? */
function billingHasLiveInvoice(billing: BillingFrozenInput): boolean {
  if (billing.hasLiveInvoice) return true;
  if (hasLiveInvoice({ invoices: billing.invoices as any })) return true;
  const configs = billing.customerConfigs;
  if (Array.isArray(configs)) {
    return configs.some(c => hasLiveInvoice({ invoices: (c?.invoices ?? null) as any }));
  }
  return false;
}

/**
 * ESTA COBRANÇA JÁ FOI APROVADA? — os dois braços que a linha do `Billing` responde.
 *
 * Carimbo OU estado pós-aprovação. É a pergunta que os gates de EMISSÃO fazem
 * (nota fiscal, boleto): "existe aprovação por trás disto?". O gêmeo em SQL é
 * `BILLING_FROZEN_WHERE`, e os dois TÊM de continuar dizendo o mesmo.
 *
 * ⚠️ NÃO inclui "tem fatura viva", e isso é decisão, não esquecimento: a fatura
 * pode existir SEM aprovação — é exatamente o resíduo que o rollback de
 * `internalApprove` deixa (fatura + `NfseDocument` PENDENTE + `approvedAt` nulo).
 * Um gate de emissão que aceitasse o braço da fatura emitiria nota municipal
 * sobre cobrança que a tela acabou de dizer que NÃO foi aprovada.
 */
export function isBillingApproved(billing: {
  approvedAt: Date | string | null;
  status?: string | null;
}): boolean {
  return !!billing.approvedAt || isPostApprovalBillingStatus(billing.status);
}

/**
 * UMA COBRANÇA ESTÁ CONGELADA? — o predicado, para UMA cobrança. TRÊS braços.
 *
 *   1. `approvedAt` — o carimbo;
 *   2. estado pós-aprovação — ver `isPostApprovalBillingStatus`;
 *   3. FATURA VIVA — o dinheiro saiu em documento, com ou sem carimbo.
 *
 * Extraído de `isQuoteMoneyLocked` porque existiam QUATRO definições de
 * "congelado" espalhadas (a trava do orçamento, a reconciliação de pagadores, a
 * guarda de troca de modo e a exclusão do orçamento) e três delas não conheciam
 * o estado pós-aprovação SEM CARIMBO. Há duas cobranças reais assim no acervo
 * (orçamentos 309 e 216): liquidadas por conciliação bancária, sem fatura de
 * onde derivar `approvedAt`. Para as três definições antigas elas eram
 * editáveis.
 *
 * O TERCEIRO BRAÇO entrou em 18/09/2026 e fechou a última divergência, que era a
 * pior porque escrevia: `GET /billings/:id/frozen` respondia pela fatura viva e
 * travava a tela, enquanto `recalcQuoteTotals` respondia só pelo carimbo e
 * REESCREVIA `BudgetPayer.subtotal`/`total` por cima de fatura já emitida, boleto
 * registrado e nota autorizada. As duas leituras discordavam exatamente no
 * resíduo do rollback de aprovação — fatura viva, carimbo nulo, estado PENDENTE.
 *
 * ⚠️ QUEM PERGUNTA PELO BRAÇO 3 TEM DE TRAZÊ-LO. Sem `invoices` /
 * `customerConfigs` / `hasLiveInvoice` no argumento, a função responde pelos dois
 * primeiros braços e a fatura viva simplesmente não é vista — é o mesmo contrato
 * de `isQuoteMoneyLocked` com o seu include.
 */
export function isBillingFrozen(billing: BillingFrozenInput): boolean {
  return isBillingApproved(billing) || billingHasLiveInvoice(billing);
}

/**
 * O ESTADO tranca mesmo sem carimbo — e isto não é redundância.
 *
 * Há cobrança no acervo com estado pós-aprovação e `approvedAt` nulo: orçamento
 * liquidado por CONCILIAÇÃO, sem fatura de onde derivar a data. Chavear só no
 * carimbo deixava essas editáveis, e uma delas tem duas parcelas vencidas. O
 * estado sabe o que o carimbo esqueceu.
 */
export function isPostApprovalBillingStatus(status?: string | null): boolean {
  return (
    status === BILLING_STATUS.APPROVED ||
    status === BILLING_STATUS.PARTIAL ||
    status === BILLING_STATUS.OVERDUE ||
    status === BILLING_STATUS.SETTLED
  );
}

/** Os estados de `Billing` que, sozinhos, já significam "o dinheiro saiu". */
export const POST_APPROVAL_BILLING_STATUSES = [
  BILLING_STATUS.APPROVED,
  BILLING_STATUS.PARTIAL,
  BILLING_STATUS.OVERDUE,
  BILLING_STATUS.SETTLED,
] as const;

/**
 * `isBillingApproved` em `where` do Prisma — para quem conta em vez de carregar.
 *
 * Aplica-se sobre um `Billing`. Quem filtra PAGADORES o encaixa em
 * `{ billing: BILLING_FROZEN_WHERE }`.
 *
 * ⚠️ SÃO OS DOIS PRIMEIROS BRAÇOS, de propósito — o gêmeo em SQL de
 * `isBillingApproved`, não de `isBillingFrozen`. O terceiro braço ("tem fatura
 * viva") existiria como
 * `{ customerConfigs: { some: { invoices: { some: { status: { not: 'CANCELLED' } } } } } }`,
 * e acrescentá-lo aqui reabriria o buraco que este filtro fecha nos gates de
 * emissão: o resíduo de uma aprovação que falhou no meio TEM fatura e NÃO tem
 * aprovação, e passaria a emitir nota fiscal e boleto sozinho. Quem precisa dos
 * três braços em SQL escreve o `OR` no seu próprio `where`, com esta nota à vista.
 */
export const BILLING_FROZEN_WHERE: {
  OR: Array<{ approvedAt?: { not: null } } | { status?: { in: BILLING_STATUS[] } }>;
} = {
  OR: [{ approvedAt: { not: null } }, { status: { in: [...POST_APPROVAL_BILLING_STATUSES] } }],
};

/** O include mínimo que `isQuoteMoneyLocked` exige. */
export const QUOTE_MONEY_LOCK_INCLUDE = {
  billings: { select: { approvedAt: true, status: true } },
} as const;

/**
 * Approval stages where a value-affecting edit auto-reverts the quote to
 * PENDING (unless the client pinned a status — the designed escape hatch).
 */
export const QUOTE_VALUE_REVERTABLE_STATUSES: TASK_QUOTE_STATUS[] = [
  TASK_QUOTE_STATUS.APPROVED,
  // SIGNED significa "o cliente assinou ISTO". Mexer no valor derruba o
  // envelope (a conferência do hash material invalida a coleta), então manter o
  // orçamento em SIGNED depois da edição seria a tela afirmando que existem
  // assinaturas válidas para um preço que ninguém viu.
  TASK_QUOTE_STATUS.SIGNED,
  // Vencido e reformulado é a razão de o estado existir: o comercial abre o
  // orçamento para rever o valor, e o ato de rever já o devolve à fila de
  // emissão. Sem isto ele ficaria "Aguardando Reanálise" depois de reanalisado.
  TASK_QUOTE_STATUS.EXPIRED,
];

/** Fields that remain editable after the quote is locked (non-financial metadata). */
export const QUOTE_SAFE_AFTER_BILLING_FIELDS = new Set<string>([
  'expiresAt',
  'customGuaranteeText',
  'layoutFileIds',
  // O layout aprovado por veículo é o MESMO dado de `layoutFileIds`, com a
  // cobertura junto: não mexe em valor, fatura, boleto nem nota. Ficar fora
  // desta lista travaria a troca de arte de um implemento já faturado — que é
  // justamente quando a produção ainda precisa dela.
  'layouts',
  'status',
  'guaranteeYears',
  'customForecastDays',
  'simultaneousTasks',
]);

/**
 * Role-gates an EXPLICIT quote status change made through a generic update
 * (PUT /budgets/:id or a nested quote write through the task endpoints),
 * mirroring the roles of the dedicated transition endpoints
 * (budget.controller.ts):
 * - APPROVED           → ADMIN, COMMERCIAL  (PUT /:id/budget-approve)
 * - todos os demais    → ADMIN, FINANCIAL, COMMERCIAL (PUT /:id/status)
 *
 * ⚠️ `BILLING_APPROVED` NÃO está nesta lista porque não é mais status de
 * orçamento: aprovar cobrança virou `PUT /billings/:id/approve` e mora em
 * `Billing.approvedAt`. Enumerá-lo aqui descrevia uma máquina de estados que o
 * zod já não aceita.
 *
 * Unknown/missing actor privilege = deny (least privilege).
 */
export function validateQuoteStatusChangeRole(
  targetStatus: TASK_QUOTE_STATUS,
  actorPrivilege?: SECTOR_PRIVILEGES | string,
): void {
  const commercialStages: TASK_QUOTE_STATUS[] = [
    TASK_QUOTE_STATUS.APPROVED,
  ];

  const allowed: string[] = commercialStages.includes(targetStatus)
    ? [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL]
    : [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL];

  if (!actorPrivilege || !allowed.includes(actorPrivilege)) {
    throw new ForbiddenException(
      'Seu setor não tem permissão para alterar o status do orçamento para este estágio.',
    );
  }
}
