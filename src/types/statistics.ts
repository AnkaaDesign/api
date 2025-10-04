// packages/types/src/statistics.ts

import type {
  STATISTICS_GROUP_BY,
  STATISTICS_METRIC,
  STATISTICS_PERIOD,
  CHART_TYPE,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
} from '@constants';
import type { BaseGetUniqueResponse } from "./common";

// =====================
// Chart Group By and Metric Enums
// =====================

export enum ChartGroupBy {
  SECTOR = "SECTOR",
  USER = "USER",
  CATEGORY = "CATEGORY",
  BRAND = "BRAND",
  SUPPLIER = "SUPPLIER",
  ITEM = "ITEM",
  DATE = "DATE",
  ACTIVITY_REASON = "ACTIVITY_REASON",
  ACTIVITY_OPERATION = "ACTIVITY_OPERATION",
}

export enum ChartMetric {
  QUANTITY = "QUANTITY",
  TOTAL_PRICE = "TOTAL_PRICE",
  UNIT_PRICE = "UNIT_PRICE",
  COUNT = "COUNT",
  FREQUENCY = "FREQUENCY",
  PERCENTAGE = "PERCENTAGE",
  AVERAGE = "AVERAGE",
}

// =====================
// Core Statistics Types
// =====================

export interface StatisticsFilter {
  dateRange: {
    from: Date;
    to: Date;
  };
  period: STATISTICS_PERIOD;
  groupBy?: STATISTICS_GROUP_BY;
  metric?: STATISTICS_METRIC;
  chartType?: CHART_TYPE;

  // Entity filters
  categoryIds?: string[];
  brandIds?: string[];
  supplierIds?: string[];
  userIds?: string[];
  sectorIds?: string[];
  itemIds?: string[];

  // Activity filters
  activityReasons?: ACTIVITY_REASON[];
  activityOperations?: ACTIVITY_OPERATION[];

  // Additional filters
  minValue?: number;
  maxValue?: number;
  limit?: number;
  offset?: number;

  // Aggregate options
  includeEmpty?: boolean;
  includeTotals?: boolean;
  includePercentages?: boolean;
}

export interface ConsumptionDataPoint {
  id: string;
  label: string;
  value: number;
  quantity?: number;
  totalPrice?: number;
  unitPrice?: number;
  percentage?: number;
  color?: string;
  metadata?: Record<string, any>;
  date?: Date;
  period?: string;
}

export interface ConsumptionChartData {
  chartType: CHART_TYPE;
  groupBy: STATISTICS_GROUP_BY;
  metric: STATISTICS_METRIC;
  period: STATISTICS_PERIOD;

  dataPoints: ConsumptionDataPoint[];

  summary: {
    totalValue: number;
    totalQuantity: number;
    averageValue: number;
    dataPointCount: number;
    topPerformer?: ConsumptionDataPoint;
    lowestPerformer?: ConsumptionDataPoint;
  };

  labels: string[];
  colors?: string[];

  trends?: {
    isGrowing: boolean;
    growthRate: number;
    direction: "up" | "down" | "stable";
  };

  filters: StatisticsFilter;
  generatedAt: Date;
}

// =====================
// Activity Analytics Types
// =====================

export interface ActivityAnalytics {
  totalActivities: number;
  period: STATISTICS_PERIOD;
  dateRange: {
    from: Date;
    to: Date;
  };

  activityTypes: Array<{
    type: ACTIVITY_REASON;
    count: number;
    percentage: number;
    totalQuantity: number;
    totalValue?: number;
  }>;

  operationTypes: Array<{
    operation: ACTIVITY_OPERATION;
    count: number;
    percentage: number;
    totalQuantity: number;
    totalValue?: number;
  }>;

  hourlyDistribution: Array<{
    hour: number;
    count: number;
    avgQuantity: number;
    avgValue?: number;
  }>;

  dailyDistribution: Array<{
    date: string;
    count: number;
    totalQuantity: number;
    totalValue?: number;
    incoming: number;
    outgoing: number;
    adjustments: number;
  }>;

  userRanking: Array<{
    userId: string;
    userName: string;
    activityCount: number;
    totalQuantity: number;
    totalValue?: number;
    efficiency: number;
    sectorName: string;
    avgDailyActivities: number;
  }>;

  sectorComparison: Array<{
    sectorId: string;
    sectorName: string;
    activityCount: number;
    totalQuantity: number;
    totalValue?: number;
    avgEfficiency: number;
    userCount: number;
    avgActivitiesPerUser: number;
  }>;

  peakTimes: Array<{
    timeSlot: string;
    averageActivities: number;
    description: string;
    dayOfWeek?: string;
  }>;

  trends: {
    weeklyPattern: Array<{
      dayOfWeek: string;
      averageActivities: number;
      peakHour: string;
      totalQuantity: number;
    }>;

    monthlyGrowth: {
      currentMonth: number;
      previousMonth: number;
      growthRate: number;
      quantityGrowthRate: number;
    };

    seasonalPatterns?: Array<{
      season: string;
      averageActivities: number;
      pattern: "increasing" | "decreasing" | "stable";
    }>;
  };
}

// =====================
// Stock Metrics Types
// =====================

export interface StockMetrics {
  totalItems: number;
  totalValue: number;
  averageStockLevel: number;

  stockHealth: {
    healthy: number;
    lowStock: number;
    criticalStock: number;
    overstock: number;
    outOfStock: number;
  };

  stockDistribution: Array<{
    category: string;
    count: number;
    percentage: number;
    totalValue: number;
    avgStockLevel: number;
  }>;

  topItems: {
    byValue: Array<{
      itemId: string;
      itemName: string;
      value: number;
      quantity: number;
      unitPrice: number;
      categoryName?: string;
      brandName?: string;
    }>;

    byActivity: Array<{
      itemId: string;
      itemName: string;
      activityCount: number;
      totalQuantityMoved: number;
      lastActivityDate: Date;
    }>;

    byConsumption: Array<{
      itemId: string;
      itemName: string;
      consumptionRate: number;
      monthlyConsumption: number;
      projectedRunoutDate?: Date;
    }>;
  };

  riskAnalysis: {
    criticalItems: Array<{
      itemId: string;
      itemName: string;
      currentStock: number;
      minStock: number;
      riskLevel: "critical" | "high" | "medium" | "low";
      daysUntilStockout?: number;
      recommendedAction: string;
    }>;

    overstockItems: Array<{
      itemId: string;
      itemName: string;
      currentStock: number;
      maxStock: number;
      excessQuantity: number;
      tiedCapital: number;
    }>;
  };
}

// =====================
// Forecasting Types
// =====================

export interface ForecastingMetrics {
  period: STATISTICS_PERIOD;
  horizon: number; // days
  confidence: number; // percentage

  demandForecast: Array<{
    itemId: string;
    itemName: string;
    currentStock: number;
    forecastedDemand: number;
    recommendedOrder: number;
    predictedStockoutDate?: Date;
    seasonalityFactor?: number;
    trendFactor?: number;
  }>;

  aggregatedForecast: {
    totalForecastedDemand: number;
    totalRecommendedOrders: number;
    estimatedCost: number;
    riskLevel: "low" | "medium" | "high";
  };

  seasonality: Array<{
    period: string;
    factor: number;
    description: string;
  }>;

  trends: Array<{
    itemId: string;
    itemName: string;
    trend: "increasing" | "decreasing" | "stable";
    trendStrength: number;
    volatility: number;
  }>;
}

// =====================
// Performance Metrics Types
// =====================

export interface PerformanceMetrics {
  period: STATISTICS_PERIOD;

  stockTurnover: {
    overall: number;
    byCategory: Array<{
      categoryId: string;
      categoryName: string;
      turnoverRate: number;
      avgInventoryValue: number;
      costOfGoodsSold: number;
    }>;
  };

  orderPerformance: {
    averageLeadTime: number;
    orderAccuracy: number;
    onTimeDelivery: number;
    supplierPerformance: Array<{
      supplierId: string;
      supplierName: string;
      avgLeadTime: number;
      accuracy: number;
      onTimeRate: number;
      totalOrders: number;
    }>;
  };

  inventoryEfficiency: {
    stockoutRate: number;
    overstockRate: number;
    carryingCostPercentage: number;
    inventoryAccuracy: number;
    writeOffRate: number;
  };

  costAnalysis: {
    totalCarryingCost: number;
    totalOrderingCost: number;
    totalStockoutCost: number;
    costPerTransaction: number;
    costEfficiencyTrend: "improving" | "declining" | "stable";
  };
}

// =====================
// Consumption Statistics
// =====================

export interface ConsumptionStatistics {
  period: STATISTICS_PERIOD;
  groupBy: STATISTICS_GROUP_BY;
  metric: STATISTICS_METRIC;

  totalConsumption: {
    quantity: number;
    value: number;
    transactionCount: number;
    avgTransactionSize: number;
  };

  topConsumers: Array<{
    id: string;
    name: string;
    type: "user" | "sector" | "category" | "item";
    consumption: {
      quantity: number;
      value: number;
      percentage: number;
    };
    efficiency?: number;
    trend?: "increasing" | "decreasing" | "stable";
  }>;

  consumptionPatterns: {
    hourly: Array<{
      hour: number;
      avgConsumption: number;
      peakConsumption: number;
    }>;

    daily: Array<{
      dayOfWeek: string;
      avgConsumption: number;
      pattern: "high" | "medium" | "low";
    }>;

    monthly: Array<{
      month: string;
      totalConsumption: number;
      growthRate: number;
    }>;
  };

  insights: {
    mostActiveDay: string;
    mostActiveSector?: string;
    mostActiveUser?: string;
    peakHour: number;
    efficiency: {
      score: number;
      recommendations: string[];
    };
    trends: {
      direction: "up" | "down" | "stable";
      strength: number;
      confidence: number;
    };
  };
}

// =====================
// Response Types
// =====================

export interface ConsumptionChartResponse extends BaseGetUniqueResponse<ConsumptionChartData> {}

export interface ActivityAnalyticsResponse extends BaseGetUniqueResponse<ActivityAnalytics> {}

export interface StockMetricsResponse extends BaseGetUniqueResponse<StockMetrics> {}

export interface ForecastingMetricsResponse extends BaseGetUniqueResponse<ForecastingMetrics> {}

export interface PerformanceMetricsResponse extends BaseGetUniqueResponse<PerformanceMetrics> {}

export interface ConsumptionStatisticsResponse extends BaseGetUniqueResponse<ConsumptionStatistics> {}

// =====================
// Combined Analytics Dashboard
// =====================

export interface InventoryAnalyticsDashboard {
  overview: {
    totalItems: number;
    totalValue: number;
    healthScore: number;
    efficiencyScore: number;
    riskScore: number;
  };

  consumption: ConsumptionStatistics;
  activity: ActivityAnalytics;
  stock: StockMetrics;
  performance: PerformanceMetrics;
  forecasting: ForecastingMetrics;

  alerts: Array<{
    id: string;
    type: "critical" | "warning" | "info";
    title: string;
    description: string;
    actionRequired: boolean;
    relatedEntityId?: string;
    relatedEntityType?: string;
  }>;

  recommendations: Array<{
    id: string;
    priority: "high" | "medium" | "low";
    category: "stock" | "ordering" | "efficiency" | "cost";
    title: string;
    description: string;
    estimatedImpact?: string;
    estimatedCost?: number;
  }>;

  generatedAt: Date;
  filters: StatisticsFilter;
}

export interface InventoryAnalyticsDashboardResponse extends BaseGetUniqueResponse<InventoryAnalyticsDashboard> {}