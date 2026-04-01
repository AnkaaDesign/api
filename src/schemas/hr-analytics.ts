import { z } from 'zod';

const periodSchema = z.object({
  id: z.string(),
  label: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const payrollTrendsFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sectorIds: z.array(z.string()).optional(),
  positionIds: z.array(z.string()).optional(),
  periods: z.array(periodSchema).optional(),
  groupBy: z.enum(['month', 'sector']).optional().default('month'),
  sortBy: z.enum(['grossSalary', 'netSalary', 'totalDiscounts', 'bonuses', 'headcount']).optional().default('grossSalary'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type PayrollTrendsFilters = z.infer<typeof payrollTrendsFiltersSchema>;

export const teamPerformanceFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sectorIds: z.array(z.string()).optional(),
  positionIds: z.array(z.string()).optional(),
  periods: z.array(periodSchema).optional(),
  groupBy: z.enum(['month', 'sector']).optional().default('month'),
  sortBy: z.enum(['headcount', 'performance', 'warnings', 'vacations']).optional().default('headcount'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type TeamPerformanceFilters = z.infer<typeof teamPerformanceFiltersSchema>;
