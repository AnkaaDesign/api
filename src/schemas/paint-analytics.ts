import { z } from 'zod';

export const paintAnalyticsFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  paintTypeIds: z.array(z.string()).optional(),
  paintBrandIds: z.array(z.string()).optional(),
  sortBy: z.enum(['volume', 'count', 'cost', 'name']).optional().default('volume'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  groupBy: z.enum(['month', 'week']).optional().default('month'),
});

export type PaintAnalyticsFilters = z.infer<typeof paintAnalyticsFiltersSchema>;
