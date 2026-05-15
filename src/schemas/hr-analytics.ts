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
  sortBy: z
    .enum(['grossSalary', 'netSalary', 'totalDiscounts', 'bonuses', 'headcount'])
    .optional()
    .default('grossSalary'),
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
  sortBy: z
    .enum(['headcount', 'performance', 'warnings'])
    .optional()
    .default('headcount'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type TeamPerformanceFilters = z.infer<typeof teamPerformanceFiltersSchema>;

// ---------------------------------------------------------------------------
// Headcount / Turnover / Absenteeism filters
// ---------------------------------------------------------------------------

const hrBaseFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sectorIds: z.array(z.string()).optional(),
  positionIds: z.array(z.string()).optional(),
  periods: z.array(periodSchema).optional(),
});

export const headcountFiltersSchema = hrBaseFiltersSchema.extend({
  groupBy: z.enum(['sector', 'position']).optional().default('sector'),
  includeInactive: z.boolean().optional().default(false),
  snapshotDate: z.coerce.date().optional(),
  useBusinessPeriod: z.boolean().optional().default(true),
  includeUnassigned: z.boolean().optional().default(true),
});

export type HeadcountFilters = z.infer<typeof headcountFiltersSchema>;

export const turnoverFiltersSchema = hrBaseFiltersSchema.extend({
  groupBy: z.enum(['month', 'sector']).optional().default('month'),
  useBusinessPeriod: z.boolean().optional().default(true),
  includeExperienceFailures: z.boolean().optional().default(true),
});

export type TurnoverFilters = z.infer<typeof turnoverFiltersSchema>;

export const absenteeismFiltersSchema = hrBaseFiltersSchema.extend({
  groupBy: z.enum(['month', 'sector', 'user']).optional().default('month'),
  absenceType: z.enum(['all', 'justified', 'unjustified', 'medical', 'lateness']).optional().default('all'),
  topN: z.number().int().min(1).max(50).optional().default(10),
});

export type AbsenteeismFilters = z.infer<typeof absenteeismFiltersSchema>;
