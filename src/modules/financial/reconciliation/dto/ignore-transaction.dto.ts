import { z } from 'zod';

export const ignoreTransactionSchema = z.object({
  reason: z.string().min(10, 'Motivo deve ter ao menos 10 caracteres').max(500),
});

export type IgnoreTransactionDto = z.infer<typeof ignoreTransactionSchema>;
