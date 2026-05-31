import { z } from 'zod';

export const changeCategorySchema = z.object({
  // Full authoritative set of category ids the transaction should carry. Tags
  // not in the list are removed; AUTO tags in it are promoted to MANUAL. Empty
  // array clears all category tags.
  categoryIds: z.array(z.string().uuid()).default([]),
  // Optional per-category amount split (when a transaction spans multiple
  // categories the user can say how much goes to each). Stored as
  // BankTransactionCategory.allocatedAmount so statistics never double-count.
  // categoryIds without an entry here get null (the stats fallback splits the
  // remainder evenly).
  allocations: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        allocatedAmount: z.number().nonnegative(),
      }),
    )
    .optional(),
  // When true, persists a ReconciliationAlias mapping (memo fingerprint +
  // counterparty CNPJ) → category, so future imports auto-classify.
  saveAlias: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
});

export type ChangeCategoryDto = z.infer<typeof changeCategorySchema>;
