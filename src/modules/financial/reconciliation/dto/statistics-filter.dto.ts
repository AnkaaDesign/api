import { z } from 'zod';

export const statisticsFilterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  months: z.coerce.number().int().min(1).max(24).default(6),
});

export type StatisticsFilterDto = z.infer<typeof statisticsFilterSchema>;
