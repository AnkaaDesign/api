// api/src/schemas/order-analytics.ts

import { z } from 'zod';

// =====================
// Order Analytics Request Schema
// =====================

export const orderAnalyticsSchema = z
  .object({
    // Time filtering (required)
    startDate: z.coerce.date({
      errorMap: () => ({ message: 'Data inicial é obrigatória' }),
    }),
    endDate: z.coerce.date({
      errorMap: () => ({ message: 'Data final é obrigatória' }),
    }),

    // Entity filtering (optional)
    supplierIds: z
      .array(z.string().uuid({ message: 'ID de fornecedor inválido' }))
      .optional()
      .default([]),

    // Limits
    topSuppliersLimit: z.coerce.number().int().positive().max(50).default(10).optional(),
    topItemsLimit: z.coerce.number().int().positive().max(50).default(10).optional(),

    // Trend grouping
    trendGroupBy: z.enum(['day', 'week', 'month']).default('month').optional(),
  })
  .refine(
    data => {
      return data.endDate >= data.startDate;
    },
    {
      message: 'Data final deve ser maior ou igual à data inicial',
      path: ['endDate'],
    },
  );

// =====================
// Type Inference
// =====================

export type OrderAnalyticsFormData = z.infer<typeof orderAnalyticsSchema>;
