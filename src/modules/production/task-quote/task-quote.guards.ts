// api/src/modules/production/task-quote/task-quote.guards.ts
//
// Shared TaskQuote write-guards. Extracted from TaskQuoteService.update so the
// nested quote write path (PUT /tasks/:id and PUT /tasks/batch via TaskService)
// enforces the SAME rules without duplicating them.
//
// IMPORTANT (user decision 2026-05, reconfirmed 2026-06-10): quote approval
// "pinning" is intended — editing values must NOT reset approval when the
// client pins the status (sends `status`, even as a no-op). Nothing here may
// change that semantics; these guards only add role/lock enforcement.

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BILLING_STATUS, SECTOR_PRIVILEGES, TASK_QUOTE_STATUS } from '@constants';

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

/**
 * UMA COBRANÇA ESTÁ CONGELADA? — o predicado, para UMA cobrança.
 *
 * Extraído de `isQuoteMoneyLocked` porque existiam QUATRO definições de
 * "congelado" espalhadas (a trava do orçamento, a reconciliação de pagadores, a
 * guarda de troca de modo e a exclusão do orçamento) e três delas não conheciam
 * o estado pós-aprovação SEM CARIMBO. Há duas cobranças reais assim no acervo
 * (orçamentos 309 e 216): liquidadas por conciliação bancária, sem fatura de
 * onde derivar `approvedAt`. Para as três definições antigas elas eram
 * editáveis.
 *
 * Quatro leituras de "o dinheiro já saiu?" são quatro respostas diferentes
 * esperando para divergir. Agora é uma, e quem pergunta em SQL usa
 * `BILLING_FROZEN_WHERE`, que diz o mesmo.
 */
export function isBillingFrozen(billing: {
  approvedAt: Date | string | null;
  status?: string | null;
}): boolean {
  return !!billing.approvedAt || isPostApprovalBillingStatus(billing.status);
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
 * O MESMO predicado, em `where` do Prisma — para quem conta em vez de carregar.
 *
 * Aplica-se sobre um `Billing`. Quem filtra PAGADORES o encaixa em
 * `{ billing: BILLING_FROZEN_WHERE }`.
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
  'status',
  'guaranteeYears',
  'customForecastDays',
  'simultaneousTasks',
]);

/**
 * Role-gates an EXPLICIT quote status change made through a generic update
 * (PUT /task-quotes/:id or a nested quote write through the task endpoints),
 * mirroring the roles of the dedicated transition endpoints
 * (task-quote.controller.ts):
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
