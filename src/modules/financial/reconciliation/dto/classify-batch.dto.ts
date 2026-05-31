import { z } from 'zod';
import { ReconciliationStatus } from '@prisma/client';

export const classifyBatchSchema = z.object({
  // Optional scoping. When omitted, the classifier runs against the
  // not-yet-classified / still-pending safe set.
  transactionIds: z.array(z.string()).optional(),
  reconciliationStatus: z.nativeEnum(ReconciliationStatus).optional(),
  dateFrom: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
  dateTo: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
});

export type ClassifyBatchDto = z.infer<typeof classifyBatchSchema>;
