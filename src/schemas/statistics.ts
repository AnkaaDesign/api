// packages/schemas/src/statistics.ts

import { z } from "zod";
import {
  STATISTICS_GROUP_BY,
  STATISTICS_METRIC,
  STATISTICS_PERIOD,
  CHART_TYPE,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
} from '@constants';
import {
  dateRangeSchema,
  createUuidSchema,
  uuidArraySchema,
  optionalPositiveNumber,
  optionalNonNegativeNumber,
} from "./common";

// =====================
// Base Statistics Schemas
// =====================

export const statisticsGroupBySchema = z.enum(
  Object.values(STATISTICS_GROUP_BY) as [string, ...string[]]
);

export const statisticsMetricSchema = z.enum(
  Object.values(STATISTICS_METRIC) as [string, ...string[]]
);

export const statisticsPeriodSchema = z.enum(
  Object.values(STATISTICS_PERIOD) as [string, ...string[]]
);

export const chartTypeSchema = z.enum(
  Object.values(CHART_TYPE) as [string, ...string[]]
);

export const activityOperationSchema = z.enum(
  Object.values(ACTIVITY_OPERATION) as [string, ...string[]]
);

export const activityReasonSchema = z.enum(
  Object.values(ACTIVITY_REASON) as [string, ...string[]]
);

// =====================
// Core Filter Schemas
// =====================

const statisticsFilterSchemaObject = z.object({
  dateRange: dateRangeSchema,
  period: statisticsPeriodSchema,
  groupBy: statisticsGroupBySchema.optional(),
  metric: statisticsMetricSchema.optional(),
  chartType: chartTypeSchema.optional(),

  // Entity filters (arrays)
  categoryIds: uuidArraySchema("categoria").optional(),
  brandIds: uuidArraySchema("marca").optional(),
  supplierIds: uuidArraySchema("fornecedor").optional(),
  userIds: uuidArraySchema("usuário").optional(),
  sectorIds: uuidArraySchema("setor").optional(),
  itemIds: uuidArraySchema("item").optional(),

  // Activity filters (arrays)
  activityReasons: z.array(activityReasonSchema).optional(),
  activityOperations: z.array(activityOperationSchema).optional(),

  // Value filters
  minValue: optionalNonNegativeNumber,
  maxValue: optionalPositiveNumber,

  // Pagination
  limit: z.number().int().min(1).max(1000).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),

  // Options
  includeEmpty: z.boolean().optional().default(false),
  includeTotals: z.boolean().optional().default(true),
  includePercentages: z.boolean().optional().default(true),
});

// =====================
// Export the base schema with refinements
// =====================

export const statisticsFilterSchema = statisticsFilterSchemaObject
  .refine(
    (data) => {
      // Validate that maxValue is greater than minValue
      if (data.minValue !== undefined && data.minValue !== null &&
          data.maxValue !== undefined && data.maxValue !== null) {
        return data.maxValue > data.minValue;
      }
      return true;
    },
    {
      message: "Valor máximo deve ser maior que o valor mínimo",
      path: ["maxValue"],
    }
  )
  .refine(
    (data) => {
      // Validate date range for custom period
      if (data.period === STATISTICS_PERIOD.CUSTOM) {
        return data.dateRange.gte && data.dateRange.lte;
      }
      return true;
    },
    {
      message: "Período customizado requer data inicial e final",
      path: ["dateRange"],
    }
  );

// =====================
// Query Schemas
// =====================

export const consumptionFilterSchema = statisticsFilterSchemaObject.extend({
  // Extend with consumption-specific filters
  includeInactive: z.boolean().optional().default(false),
  minConsumption: optionalNonNegativeNumber,
  maxConsumption: optionalPositiveNumber,
  consumptionThreshold: optionalPositiveNumber,
})
  .refine(
    (data) => {
      // Validate that maxValue is greater than minValue
      if (data.minValue !== undefined && data.minValue !== null &&
          data.maxValue !== undefined && data.maxValue !== null) {
        return data.maxValue > data.minValue;
      }
      return true;
    },
    {
      message: "Valor máximo deve ser maior que o valor mínimo",
      path: ["maxValue"],
    }
  )
  .refine(
    (data) => {
      // Validate date range for custom period
      if (data.period === STATISTICS_PERIOD.CUSTOM) {
        return data.dateRange.gte && data.dateRange.lte;
      }
      return true;
    },
    {
      message: "Período customizado requer data inicial e final",
      path: ["dateRange"],
    }
  )
  .refine(
    (data) => {
      if (data.minConsumption !== undefined && data.minConsumption !== null &&
          data.maxConsumption !== undefined && data.maxConsumption !== null) {
        return data.maxConsumption > data.minConsumption;
      }
      return true;
    },
    {
      message: "Consumo máximo deve ser maior que o consumo mínimo",
      path: ["maxConsumption"],
    }
  );

export const consumptionQuerySchema = z.object({
  filters: consumptionFilterSchema,
  options: z.object({
    includeChartData: z.boolean().optional().default(true),
    includeRankings: z.boolean().optional().default(true),
    includePatterns: z.boolean().optional().default(true),
    includeInsights: z.boolean().optional().default(true),
    includeRecommendations: z.boolean().optional().default(false),
  }).optional(),
});

export const activityAnalyticsQuerySchema = z.object({
  filters: statisticsFilterSchema,
  options: z.object({
    includeHourlyDistribution: z.boolean().optional().default(true),
    includeDailyDistribution: z.boolean().optional().default(true),
    includeUserRanking: z.boolean().optional().default(true),
    includeSectorComparison: z.boolean().optional().default(true),
    includePeakTimes: z.boolean().optional().default(true),
    includeTrends: z.boolean().optional().default(true),
    includeEfficiency: z.boolean().optional().default(false),
  }).optional(),
});

export const stockMetricsQuerySchema = z.object({
  filters: statisticsFilterSchema,
  options: z.object({
    includeStockHealth: z.boolean().optional().default(true),
    includeDistribution: z.boolean().optional().default(true),
    includeTopItems: z.boolean().optional().default(true),
    includeRiskAnalysis: z.boolean().optional().default(true),
    includeTurnoverMetrics: z.boolean().optional().default(false),
    includeABCAnalysis: z.boolean().optional().default(false),
  }).optional(),
});

const forecastingFilterSchema = statisticsFilterSchemaObject.extend({
  horizon: z.number().int().min(1).max(365).optional().default(30), // days
  confidence: z.number().min(0.5).max(0.99).optional().default(0.95), // 95% confidence
  includeSeasonality: z.boolean().optional().default(true),
  includeTrends: z.boolean().optional().default(true),
});

export const forecastingQuerySchema = z.object({
  filters: forecastingFilterSchema,
  options: z.object({
    includeDemandForecast: z.boolean().optional().default(true),
    includeRecommendations: z.boolean().optional().default(true),
    includeConfidenceIntervals: z.boolean().optional().default(false),
    includeScenarios: z.boolean().optional().default(false),
  }).optional(),
});

export const performanceQuerySchema = z.object({
  filters: statisticsFilterSchema,
  options: z.object({
    includeStockTurnover: z.boolean().optional().default(true),
    includeOrderPerformance: z.boolean().optional().default(true),
    includeEfficiency: z.boolean().optional().default(true),
    includeCostAnalysis: z.boolean().optional().default(true),
    includeBenchmarks: z.boolean().optional().default(false),
    includeTargets: z.boolean().optional().default(false),
  }).optional(),
});

// =====================
// Response Data Schemas
// =====================

export const consumptionDataPointSchema = z.object({
  id: createUuidSchema("ID"),
  label: z.string().min(1, "Label é obrigatório"),
  value: z.number().min(0, "Valor deve ser não-negativo"),
  quantity: optionalNonNegativeNumber,
  totalPrice: optionalNonNegativeNumber,
  unitPrice: optionalNonNegativeNumber,
  percentage: z.number().min(0).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Cor deve estar no formato hexadecimal").optional(),
  metadata: z.record(z.any()).optional(),
  date: z.coerce.date().optional(),
  period: z.string().optional(),
});

export const consumptionChartDataSchema = z.object({
  chartType: chartTypeSchema,
  groupBy: statisticsGroupBySchema,
  metric: statisticsMetricSchema,
  period: statisticsPeriodSchema,

  dataPoints: z.array(consumptionDataPointSchema).min(1, "Deve conter pelo menos um ponto de dados"),

  summary: z.object({
    totalValue: z.number().min(0),
    totalQuantity: z.number().min(0),
    averageValue: z.number().min(0),
    dataPointCount: z.number().int().min(0),
    topPerformer: consumptionDataPointSchema.optional(),
    lowestPerformer: consumptionDataPointSchema.optional(),
  }),

  labels: z.array(z.string()).min(1, "Deve conter pelo menos um rótulo"),
  colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).optional(),

  trends: z.object({
    isGrowing: z.boolean(),
    growthRate: z.number(),
    direction: z.enum(["up", "down", "stable"]),
  }).optional(),

  filters: statisticsFilterSchema,
  generatedAt: z.coerce.date(),
});

// =====================
// Analytics Response Schemas
// =====================

export const activityTypeSchema = z.object({
  type: activityReasonSchema,
  count: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
  totalQuantity: z.number().min(0),
  totalValue: optionalNonNegativeNumber,
});

export const operationTypeSchema = z.object({
  operation: activityOperationSchema,
  count: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
  totalQuantity: z.number().min(0),
  totalValue: optionalNonNegativeNumber,
});

export const hourlyDistributionSchema = z.object({
  hour: z.number().int().min(0).max(23),
  count: z.number().int().min(0),
  avgQuantity: z.number().min(0),
  avgValue: optionalNonNegativeNumber,
});

export const dailyDistributionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
  count: z.number().int().min(0),
  totalQuantity: z.number().min(0),
  totalValue: optionalNonNegativeNumber,
  incoming: z.number().int().min(0),
  outgoing: z.number().int().min(0),
  adjustments: z.number().int().min(0),
});

export const userRankingSchema = z.object({
  userId: createUuidSchema("Usuário inválido"),
  userName: z.string().min(1, "Nome do usuário é obrigatório"),
  activityCount: z.number().int().min(0),
  totalQuantity: z.number().min(0),
  totalValue: optionalNonNegativeNumber,
  efficiency: z.number().min(0).max(100),
  sectorName: z.string().min(1, "Nome do setor é obrigatório"),
  avgDailyActivities: z.number().min(0),
});

export const sectorComparisonSchema = z.object({
  sectorId: createUuidSchema("Setor inválido"),
  sectorName: z.string().min(1, "Nome do setor é obrigatório"),
  activityCount: z.number().int().min(0),
  totalQuantity: z.number().min(0),
  totalValue: optionalNonNegativeNumber,
  avgEfficiency: z.number().min(0).max(100),
  userCount: z.number().int().min(0),
  avgActivitiesPerUser: z.number().min(0),
});

export const peakTimeSchema = z.object({
  timeSlot: z.string().min(1, "Slot de tempo é obrigatório"),
  averageActivities: z.number().min(0),
  description: z.string().min(1, "Descrição é obrigatória"),
  dayOfWeek: z.string().optional(),
});

export const weeklyPatternSchema = z.object({
  dayOfWeek: z.string().min(1, "Dia da semana é obrigatório"),
  averageActivities: z.number().min(0),
  peakHour: z.string().min(1, "Hora de pico é obrigatória"),
  totalQuantity: z.number().min(0),
});

export const monthlyGrowthSchema = z.object({
  currentMonth: z.number().min(0),
  previousMonth: z.number().min(0),
  growthRate: z.number(),
  quantityGrowthRate: z.number(),
});

export const activityAnalyticsSchema = z.object({
  totalActivities: z.number().int().min(0),
  period: statisticsPeriodSchema,
  dateRange: dateRangeSchema,

  activityTypes: z.array(activityTypeSchema),
  operationTypes: z.array(operationTypeSchema),
  hourlyDistribution: z.array(hourlyDistributionSchema),
  dailyDistribution: z.array(dailyDistributionSchema),
  userRanking: z.array(userRankingSchema),
  sectorComparison: z.array(sectorComparisonSchema),
  peakTimes: z.array(peakTimeSchema),

  trends: z.object({
    weeklyPattern: z.array(weeklyPatternSchema),
    monthlyGrowth: monthlyGrowthSchema,
    seasonalPatterns: z.array(z.object({
      season: z.string(),
      averageActivities: z.number().min(0),
      pattern: z.enum(["increasing", "decreasing", "stable"]),
    })).optional(),
  }),
});

// =====================
// Stock Metrics Schemas
// =====================

export const stockHealthSchema = z.object({
  healthy: z.number().int().min(0),
  lowStock: z.number().int().min(0),
  criticalStock: z.number().int().min(0),
  overstock: z.number().int().min(0),
  outOfStock: z.number().int().min(0),
});

export const stockDistributionSchema = z.object({
  category: z.string().min(1, "Categoria é obrigatória"),
  count: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
  totalValue: z.number().min(0),
  avgStockLevel: z.number().min(0),
});

export const topItemSchema = z.object({
  itemId: createUuidSchema("Item inválido"),
  itemName: z.string().min(1, "Nome do item é obrigatório"),
  value: z.number().min(0),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0),
  categoryName: z.string().optional(),
  brandName: z.string().optional(),
});

export const topActivityItemSchema = z.object({
  itemId: createUuidSchema("Item inválido"),
  itemName: z.string().min(1, "Nome do item é obrigatório"),
  activityCount: z.number().int().min(0),
  totalQuantityMoved: z.number().min(0),
  lastActivityDate: z.coerce.date(),
});

export const topConsumptionItemSchema = z.object({
  itemId: createUuidSchema("Item inválido"),
  itemName: z.string().min(1, "Nome do item é obrigatório"),
  consumptionRate: z.number().min(0),
  monthlyConsumption: z.number().min(0),
  projectedRunoutDate: z.coerce.date().optional(),
});

export const criticalItemSchema = z.object({
  itemId: createUuidSchema("Item inválido"),
  itemName: z.string().min(1, "Nome do item é obrigatório"),
  currentStock: z.number().min(0),
  minStock: z.number().min(0),
  riskLevel: z.enum(["critical", "high", "medium", "low"]),
  daysUntilStockout: z.number().int().min(0).optional(),
  recommendedAction: z.string().min(1, "Ação recomendada é obrigatória"),
});

export const overstockItemSchema = z.object({
  itemId: createUuidSchema("Item inválido"),
  itemName: z.string().min(1, "Nome do item é obrigatório"),
  currentStock: z.number().min(0),
  maxStock: z.number().min(0),
  excessQuantity: z.number().min(0),
  tiedCapital: z.number().min(0),
});

export const stockMetricsSchema = z.object({
  totalItems: z.number().int().min(0),
  totalValue: z.number().min(0),
  averageStockLevel: z.number().min(0),

  stockHealth: stockHealthSchema,
  stockDistribution: z.array(stockDistributionSchema),

  topItems: z.object({
    byValue: z.array(topItemSchema),
    byActivity: z.array(topActivityItemSchema),
    byConsumption: z.array(topConsumptionItemSchema),
  }),

  riskAnalysis: z.object({
    criticalItems: z.array(criticalItemSchema),
    overstockItems: z.array(overstockItemSchema),
  }),
});

// =====================
// Transform Functions
// =====================

/**
 * Transform searchingFor parameter for multi-field search
 */
const statisticsTransform = (data: any) => {
  // Handle searchingFor for entity filtering
  if (data.searchingFor && typeof data.searchingFor === "string") {
    // Add searchingFor to multiple filter arrays
    data.categoryIds = data.categoryIds || [];
    data.brandIds = data.brandIds || [];
    data.supplierIds = data.supplierIds || [];
    data.userIds = data.userIds || [];
    data.sectorIds = data.sectorIds || [];

    // Note: In a real implementation, you would search by name/description
    // and convert to IDs through the API
    delete data.searchingFor;
  }

  // Auto-calculate date range for predefined periods
  if (data.period && data.period !== STATISTICS_PERIOD.CUSTOM && !data.dateRange) {
    const now = new Date();
    let startDate: Date;
    let endDate = new Date(now);

    switch (data.period) {
      case STATISTICS_PERIOD.DAILY:
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case STATISTICS_PERIOD.WEEKLY:
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case STATISTICS_PERIOD.MONTHLY:
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      case STATISTICS_PERIOD.QUARTERLY:
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 3);
        break;
      case STATISTICS_PERIOD.YEARLY:
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case STATISTICS_PERIOD.LAST_7_DAYS:
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case STATISTICS_PERIOD.LAST_30_DAYS:
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
        break;
      case STATISTICS_PERIOD.LAST_90_DAYS:
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 90);
        break;
      case STATISTICS_PERIOD.LAST_YEAR:
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
    }

    data.dateRange = {
      gte: startDate,
      lte: endDate,
    };
  }

  return data;
};

// Apply transform to main schemas
export const statisticsFilterSchemaWithTransform = statisticsFilterSchema.transform(statisticsTransform);
export const consumptionFilterSchemaWithTransform = consumptionFilterSchema.transform(statisticsTransform);

// =====================
// Type Inference
// =====================

export type StatisticsFilterFormData = z.infer<typeof statisticsFilterSchema>;
export type ConsumptionFilterFormData = z.infer<typeof consumptionFilterSchema>;
export type ConsumptionQueryFormData = z.infer<typeof consumptionQuerySchema>;
export type ActivityAnalyticsQueryFormData = z.infer<typeof activityAnalyticsQuerySchema>;
export type StockMetricsQueryFormData = z.infer<typeof stockMetricsQuerySchema>;
export type ForecastingQueryFormData = z.infer<typeof forecastingQuerySchema>;
export type PerformanceQueryFormData = z.infer<typeof performanceQuerySchema>;

export type ConsumptionDataPointFormData = z.infer<typeof consumptionDataPointSchema>;
export type ConsumptionChartDataFormData = z.infer<typeof consumptionChartDataSchema>;
export type ActivityAnalyticsFormData = z.infer<typeof activityAnalyticsSchema>;
export type StockMetricsFormData = z.infer<typeof stockMetricsSchema>;

// =====================
// Helper Schemas for Forms
// =====================

export const statisticsDateRangePickerSchema = z.object({
  period: statisticsPeriodSchema,
  customRange: dateRangeSchema.optional(),
}).refine(
  (data) => {
    if (data.period === STATISTICS_PERIOD.CUSTOM) {
      return data.customRange?.gte && data.customRange?.lte;
    }
    return true;
  },
  {
    message: "Período customizado requer seleção de data",
    path: ["customRange"],
  }
);

export const statisticsChartConfigSchema = z.object({
  chartType: chartTypeSchema,
  groupBy: statisticsGroupBySchema,
  metric: statisticsMetricSchema,
  showPercentages: z.boolean().optional().default(true),
  showTotals: z.boolean().optional().default(true),
  maxDataPoints: z.number().int().min(5).max(50).optional().default(20),
  colorScheme: z.enum(["default", "vibrant", "pastel", "monochrome"]).optional().default("default"),
});

export const statisticsExportSchema = z.object({
  filters: statisticsFilterSchema,
  format: z.enum(["csv", "excel", "pdf", "json"]),
  includeCharts: z.boolean().optional().default(false),
  includeMetadata: z.boolean().optional().default(true),
  filename: z.string().min(1).max(100).optional(),
});

// =====================
// Map Functions
// =====================

export const mapStatisticsFilterToFormData = (filter: any): StatisticsFilterFormData => {
  return statisticsFilterSchema.parse(filter);
};

export const mapConsumptionFilterToFormData = (filter: any): ConsumptionFilterFormData => {
  return consumptionFilterSchema.parse(filter);
};

// =====================
// Export All
// =====================

// All schemas are already exported individually above