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
import { SECTOR_PRIVILEGES, TASK_QUOTE_STATUS } from '@constants';

/**
 * Statuses where the quote is financially locked-in (BILLING_APPROVED and the
 * billing lifecycle after it). Money/line-item edits are forbidden; status
 * changes must go through the dedicated status endpoints.
 */
export const QUOTE_STATUS_LOCKED: TASK_QUOTE_STATUS[] = [
  TASK_QUOTE_STATUS.BILLING_APPROVED,
  TASK_QUOTE_STATUS.UPCOMING,
  TASK_QUOTE_STATUS.DUE,
  TASK_QUOTE_STATUS.PARTIAL,
  TASK_QUOTE_STATUS.SETTLED,
];

/**
 * Approval stages where a value-affecting edit auto-reverts the quote to
 * PENDING (unless the client pinned a status — the designed escape hatch).
 */
export const QUOTE_VALUE_REVERTABLE_STATUSES: TASK_QUOTE_STATUS[] = [
  TASK_QUOTE_STATUS.BUDGET_APPROVED,
];

/** Fields that remain editable after the quote is locked (non-financial metadata). */
export const QUOTE_SAFE_AFTER_BILLING_FIELDS = new Set<string>([
  'expiresAt',
  'customGuaranteeText',
  'layoutFileId',
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
 * - BILLING_APPROVED      → never via generic update; only internalApprove (ADMIN/FINANCIAL).
 * - BUDGET_APPROVED       → ADMIN, COMMERCIAL  (PUT /:id/budget-approve)
 * - all other statuses    → ADMIN, FINANCIAL, COMMERCIAL (PUT /:id/status)
 *
 * Unknown/missing actor privilege = deny (least privilege).
 */
export function validateQuoteStatusChangeRole(
  targetStatus: TASK_QUOTE_STATUS,
  actorPrivilege?: SECTOR_PRIVILEGES | string,
): void {
  if (targetStatus === TASK_QUOTE_STATUS.BILLING_APPROVED) {
    throw new BadRequestException(
      'A aprovação de faturamento deve ser realizada pelo endpoint dedicado.',
    );
  }

  const commercialStages: TASK_QUOTE_STATUS[] = [
    TASK_QUOTE_STATUS.BUDGET_APPROVED,
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
