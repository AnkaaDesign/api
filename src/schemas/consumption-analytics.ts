// packages/schemas/src/consumption-analytics.ts

import { z } from 'zod';
import { ACTIVITY_OPERATION } from '@constants';

// =====================
// Consumption Analytics Request Schema
// =====================

export const consumptionAnalyticsSchema = z
  .object({
    // Time filtering (required)
    startDate: z.coerce.date({
      errorMap: () => ({ message: 'Data inicial é obrigatória' }),
    }),
    endDate: z.coerce.date({
      errorMap: () => ({ message: 'Data final é obrigatória' }),
    }),

    // Entity filtering (optional)
    sectorIds: z
      .array(z.string().uuid({ message: 'ID de setor inválido' }))
      .optional()
      .default([]),
    userIds: z
      .array(z.string().uuid({ message: 'ID de usuário inválido' }))
      .optional()
      .default([]),
    itemIds: z
      .array(z.string().uuid({ message: 'ID de item inválido' }))
      .optional()
      .default([]),
    brandIds: z
      .array(z.string().uuid({ message: 'ID de marca inválida' }))
      .optional()
      .default([]),
    categoryIds: z
      .array(z.string().uuid({ message: 'ID de categoria inválida' }))
      .optional()
      .default([]),

    // Pagination
    offset: z.coerce.number().int().min(0).default(0).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Sorting
    sortBy: z.enum(['quantity', 'value', 'name']).default('quantity').optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),

    // Operation type
    operation: z
      .enum([ACTIVITY_OPERATION.OUTBOUND, ACTIVITY_OPERATION.INBOUND, 'ALL'])
      .default(ACTIVITY_OPERATION.OUTBOUND)
      .optional(),
  })
  .refine(
    (data) => {
      // Validate that end date is after start date
      return data.endDate >= data.startDate;
    },
    {
      message: 'Data final deve ser maior ou igual à data inicial',
      path: ['endDate'],
    },
  )
  .refine(
    (data) => {
      // Validate that we don't have both sector and user comparisons at the same time
      const hasSectorComparison = data.sectorIds && data.sectorIds.length >= 2;
      const hasUserComparison = data.userIds && data.userIds.length >= 2;

      return !(hasSectorComparison && hasUserComparison);
    },
    {
      message: 'Não é possível comparar setores e usuários simultaneamente',
      path: ['sectorIds', 'userIds'],
    },
  );

// =====================
// Time Series Request Schema
// =====================

export const consumptionTimeSeriesSchema = z
  .object({
    // Time filtering (required)
    startDate: z.coerce.date({
      errorMap: () => ({ message: 'Data inicial é obrigatória' }),
    }),
    endDate: z.coerce.date({
      errorMap: () => ({ message: 'Data final é obrigatória' }),
    }),

    // Entity filtering (optional)
    sectorIds: z
      .array(z.string().uuid({ message: 'ID de setor inválido' }))
      .optional()
      .default([]),
    userIds: z
      .array(z.string().uuid({ message: 'ID de usuário inválido' }))
      .optional()
      .default([]),
    itemIds: z
      .array(z.string().uuid({ message: 'ID de item inválido' }))
      .optional()
      .default([]),
    brandIds: z
      .array(z.string().uuid({ message: 'ID de marca inválida' }))
      .optional()
      .default([]),
    categoryIds: z
      .array(z.string().uuid({ message: 'ID de categoria inválida' }))
      .optional()
      .default([]),

    // Time grouping
    groupBy: z.enum(['day', 'week', 'month']).default('day').optional(),

    // Operation type
    operation: z
      .enum([ACTIVITY_OPERATION.OUTBOUND, ACTIVITY_OPERATION.INBOUND, 'ALL'])
      .default(ACTIVITY_OPERATION.OUTBOUND)
      .optional(),
  })
  .refine(
    (data) => {
      // Validate that end date is after start date
      return data.endDate >= data.startDate;
    },
    {
      message: 'Data final deve ser maior ou igual à data inicial',
      path: ['endDate'],
    },
  )
  .refine(
    (data) => {
      // Validate that we don't have both sector and user comparisons
      const hasSectorComparison = data.sectorIds && data.sectorIds.length >= 2;
      const hasUserComparison = data.userIds && data.userIds.length >= 2;

      return !(hasSectorComparison && hasUserComparison);
    },
    {
      message: 'Não é possível comparar setores e usuários simultaneamente',
      path: ['sectorIds', 'userIds'],
    },
  );

// =====================
// Type Inference
// =====================

export type ConsumptionAnalyticsFormData = z.infer<typeof consumptionAnalyticsSchema>;
export type ConsumptionTimeSeriesFormData = z.infer<typeof consumptionTimeSeriesSchema>;
