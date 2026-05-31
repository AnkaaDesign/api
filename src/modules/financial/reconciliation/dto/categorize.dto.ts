import { z } from 'zod';

export const categorizeSchema = z.object({
  transactionIds: z.array(z.string()).optional(),
  dateFrom: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
  dateTo: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
});
export type CategorizeDto = z.infer<typeof categorizeSchema>;

export const forecastQuerySchema = z.object({
  // Inclusive date range (ISO strings). The recurring view sums what was
  // actually paid in [from, to].
  from: z.preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string()),
  to: z.preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string()),
});
export type ForecastQueryDto = z.infer<typeof forecastQuerySchema>;
