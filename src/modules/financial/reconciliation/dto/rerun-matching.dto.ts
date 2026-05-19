import { z } from 'zod';

export const rerunMatchingSchema = z
  .object({
    transactionIds: z.array(z.string().uuid()).optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
  })
  .refine(d => d.transactionIds?.length || d.dateStart || d.dateEnd, {
    message: 'Informe ao menos um critério de escopo',
  });

export type RerunMatchingDto = z.infer<typeof rerunMatchingSchema>;
