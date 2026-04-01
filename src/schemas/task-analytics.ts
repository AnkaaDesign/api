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
  sortBy: z.enum(['completionTime', 'count', 'completedCount', 'forecastAccuracy', 'value', 'name']).optional().default('count'),
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
