import { z } from 'zod';

/**
 * Conciliate a bank credit against one or more Tasks, minting whatever billing
 * spine each task is missing.
 *
 * `allocations` is an array because one lump-sum PIX routinely pays several
 * jobs. The same task may not appear twice — the caller sums instead, so the
 * amount written to `ReconciliationMatch.allocatedAmount` per (transaction,
 * installment) is unambiguous.
 */
export const taskMatchSchema = z.object({
  transactionId: z.string().uuid(),
  allocations: z
    .array(
      z.object({
        taskId: z.string().uuid(),
        amount: z.number().positive('Valor alocado deve ser positivo'),
        /** Billing customer. Required only when the task has no quote and no customer. */
        customerId: z.string().uuid().optional(),
        /** Due date for any parcela created. Defaults to finishedAt, then the credit's date. */
        dueDate: z.coerce.date().optional(),
        description: z.string().trim().min(1).max(400).optional(),
      }),
    )
    .min(1, 'Selecione pelo menos uma tarefa'),
  notes: z.string().max(500).optional(),
});

export type TaskMatchDto = z.infer<typeof taskMatchSchema>;

/** Query for the task candidate list. `search` overrides identity resolution. */
export const taskCandidatesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export type TaskCandidatesQueryDto = z.infer<typeof taskCandidatesQuerySchema>;
