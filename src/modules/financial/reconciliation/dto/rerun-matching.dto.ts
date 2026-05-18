import { z } from 'zod';

export const rerunMatchingSchema = z
  .object({
    statementId: z.string().uuid().optional(),
    transactionIds: z.array(z.string().uuid()).optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
  })
  .refine(d => d.statementId || d.transactionIds || d.dateStart || d.dateEnd, {
    message: 'Informe ao menos um critério de escopo',
  });

export type RerunMatchingDto = z.infer<typeof rerunMatchingSchema>;
