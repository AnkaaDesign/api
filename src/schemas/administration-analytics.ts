import { z } from 'zod';

export const administrationAnalyticsFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sortBy: z.enum(['count', 'name', 'date']).optional().default('count'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  groupBy: z.enum(['month', 'week']).optional().default('month'),
});

export type AdministrationAnalyticsFilters = z.infer<typeof administrationAnalyticsFiltersSchema>;
