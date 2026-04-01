import { z } from 'zod';

export const collectionAnalyticsFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  customerIds: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  groupBy: z.enum(['month', 'week']).optional().default('month'),
  sortBy: z.enum(['collectionRate', 'amount', 'overdueAmount']).optional().default('amount'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type CollectionAnalyticsFilters = z.infer<typeof collectionAnalyticsFiltersSchema>;

export const bankSlipPerformanceFiltersSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  customerIds: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  groupBy: z.enum(['month', 'week']).optional().default('month'),
  sortBy: z.enum(['conversionRate', 'totalSlips', 'avgDelay']).optional().default('totalSlips'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type BankSlipPerformanceFilters = z.infer<typeof bankSlipPerformanceFiltersSchema>;
