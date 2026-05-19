import { z } from 'zod';

export const rerunMatchingSchema = z.object({
  transactionIds: z.array(z.string().uuid()).optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  // When true (or all others omitted), re-runs matching for ALL UNMATCHED transactions.
  runAll: z.boolean().optional(),
});

export type RerunMatchingDto = z.infer<typeof rerunMatchingSchema>;
