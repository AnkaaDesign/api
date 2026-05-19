import { z } from 'zod';

const periodSchema = z.object({
  id: z.string(),
  label: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const taskThroughputFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sectorIds: z.array(z.string()).optional(),
  customerIds: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  periods: z.array(periodSchema).optional(),
  sortBy: z
    .enum(['completionTime', 'count', 'completedCount', 'forecastAccuracy', 'value', 'name'])
    .optional()
    .default('count'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  groupBy: z.enum(['month', 'week']).optional().default('month'),
});

export type TaskThroughputFilters = z.infer<typeof taskThroughputFiltersSchema>;

export const taskBottleneckFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sectorIds: z.array(z.string()).optional(),
  garageId: z.string().optional(),
  groupBy: z.enum(['month', 'week']).optional().default('month'),
});

export type TaskBottleneckFilters = z.infer<typeof taskBottleneckFiltersSchema>;

export const taskRevenueFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sectorIds: z.array(z.string()).optional(),
  customerIds: z.array(z.string()).optional(),
  periods: z.array(periodSchema).optional(),
  sortBy: z.enum(['value', 'revenue', 'count', 'name']).optional().default('value'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  groupBy: z.enum(['sector', 'customer', 'month']).optional().default('month'),
});

export type TaskRevenueFilters = z.infer<typeof taskRevenueFiltersSchema>;

export const taskProductionStatsSchema = z.object({
  // Legacy: explicit ISO dates from the frontend. Browser-local-TZ means a UTC
  // server reads BRT midnight as 03:00 UTC, shifting the window 3h vs bonus.
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  // Preferred: pass year + months and let the backend compute the date range
  // via businessPeriodStart/End — same helpers the bonus uses. Guarantees
  // identical UTC moments to bonus regardless of browser or server TZ.
  bonusPeriodYear: z.number().int().optional(),
  bonusPeriodMonths: z.array(z.number().int().min(1).max(12)).optional(),
  sectorIds: z.array(z.string()).optional(),
  commissionStatuses: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  xAxisMode: z.enum(['day', 'month', 'year']).optional().default('month'),
  yAxisMode: z.enum(['count', 'avgPerUser', 'both']).optional().default('count'),
  compareMode: z.enum(['combined', 'separated', 'separatedWithTotal']).optional().default('combined'),
});

export type TaskProductionStatsFilters = z.infer<typeof taskProductionStatsSchema>;

// Performance statistics — productivity, position-adjusted.
//   - Working days only (Mon–Fri minus national holidays, capped at today).
//   - Per-user contribution = weight × occupancy where weight = base + step ×
//     rank (positions ranked globally by Position.hierarchy ascending) and
//     occupancy = user's working days / period's working days.
//   - avgPerformance = T / Σ contribution — lives on productivity's T/N
//     scale, compresses the gap between sectors with different position
//     compositions.
export const taskPerformanceStatsSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  bonusPeriodYear: z.number().int().optional(),
  bonusPeriodMonths: z.array(z.number().int().min(1).max(12)).optional(),
  sectorIds: z.array(z.string()).optional(),
  xAxisMode: z.enum(['month', 'year']).optional().default('month'),
  yAxisMode: z.enum(['count', 'performance', 'both']).optional().default('performance'),
  compareMode: z.enum(['combined', 'separated', 'separatedWithTotal']).optional().default('combined'),
  positionStep: z.number().min(0).optional().default(0.6),
  positionBase: z.number().min(0).optional().default(1.0),
});

export type TaskPerformanceStatsFilters = z.infer<typeof taskPerformanceStatsSchema>;
