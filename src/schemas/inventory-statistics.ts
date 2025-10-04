// packages/schemas/src/inventory-statistics.ts

import { z } from "zod";
import { ACTIVITY_OPERATION, PERIOD_TYPE, CHART_TYPE } from '@constants';

// =====================
// Consumption Statistics Schemas
// =====================

export const inventoryConsumptionStatsSchema = z
  .object({
    // Date range filter
    period: z
      .object({
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
      })
      .refine((data) => data.endDate >= data.startDate, {
        message: "Data final deve ser posterior à data inicial",
        path: ["endDate"],
      }),

    // Group by options
    groupBy: z.enum(["sector", "user", "item", "category"], {
      errorMap: () => ({ message: "Agrupamento deve ser: sector, user, item ou category" }),
    }),

    // Filter options
    itemIds: z.array(z.string().uuid()).optional(),
    sectorIds: z.array(z.string().uuid()).optional(),
    userIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    brandIds: z.array(z.string().uuid()).optional(),

    // Chart configuration
    chartType: z.nativeEnum(CHART_TYPE).default(CHART_TYPE.BAR),

    // Operation filter
    operations: z.array(z.nativeEnum(ACTIVITY_OPERATION)).default([ACTIVITY_OPERATION.OUTBOUND]),

    // Comparison mode
    compareMode: z.boolean().default(false),

    // Aggregation period
    aggregationPeriod: z.nativeEnum(PERIOD_TYPE).default(PERIOD_TYPE.MONTHLY),

    // Limit results
    limit: z.coerce.number().int().positive().max(100).default(20),

    // Include monetary values
    includePricing: z.boolean().default(true),
  })
  .transform((data) => {
    // Ensure valid date range (max 2 years)
    const timeDiff = data.period.endDate.getTime() - data.period.startDate.getTime();
    const maxRange = 2 * 365 * 24 * 60 * 60 * 1000; // 2 years in milliseconds

    if (timeDiff > maxRange) {
      throw new Error("Período não pode exceder 2 anos");
    }

    return data;
  });

// =====================
// Response Types
// =====================

export const consumptionDataPointSchema = z.object({
  x: z.string(), // Entity name (sector/user/item name)
  y: z.number(), // Quantity consumed
  totalPrice: z.number().optional(), // Total monetary value
  entityId: z.string().uuid(), // Entity ID for reference
  entityType: z.string(), // sector/user/item/category
  metadata: z.object({
    activityCount: z.number(),
    averagePerDay: z.number().optional(),
    trend: z.string().optional(),
  }).optional(),
});

export const consumptionStatsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    points: z.array(consumptionDataPointSchema),
    summary: z.object({
      totalQuantity: z.number(),
      totalValue: z.number().optional(),
      totalActivities: z.number(),
      periodDays: z.number(),
      averagePerDay: z.number(),
    }),
    period: z.object({
      startDate: z.date(),
      endDate: z.date(),
      groupBy: z.string(),
      chartType: z.string(),
    }),
    filters: z.object({
      itemIds: z.array(z.string()).optional(),
      sectorIds: z.array(z.string()).optional(),
      userIds: z.array(z.string()).optional(),
      operations: z.array(z.string()),
    }),
  }),
});

// =====================
// Type Inference
// =====================

export type InventoryConsumptionStatsFormData = z.infer<typeof inventoryConsumptionStatsSchema>;
export type ConsumptionDataPoint = z.infer<typeof consumptionDataPointSchema>;
export type ConsumptionStatsResponse = z.infer<typeof consumptionStatsResponseSchema>;