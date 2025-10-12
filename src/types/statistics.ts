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

// =====================
// Additional Entity-Specific Statistics Types
// =====================

/**
 * Statistics for task entities
 * Provides task completion rates, time tracking, and performance metrics
 */
export interface TaskStatistics {
  period: STATISTICS_PERIOD;
  dateRange: {
    from: Date;
    to: Date;
  };

  summary: {
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    inProductionTasks: number;
    cancelledTasks: number;
    onHoldTasks: number;
    completionRate: number;
    avgCompletionTime: number; // in hours
  };

  statusDistribution: Array<{
    status: string;
    count: number;
    percentage: number;
  }>;

  timeMetrics: {
    avgCompletionTime: number;
    medianCompletionTime: number;
    fastestCompletion: number;
    slowestCompletion: number;
  };

  userPerformance: Array<{
    userId: string;
    userName: string;
    tasksCompleted: number;
    avgCompletionTime: number;
    onTimeRate: number;
    efficiencyScore: number;
  }>;

  customerMetrics: Array<{
    customerId: string;
    customerName: string;
    totalTasks: number;
    completedTasks: number;
    avgCompletionTime: number;
    satisfactionScore?: number;
  }>;

  trends: {
    dailyCompletion: Array<{
      date: string;
      completed: number;
      created: number;
      net: number;
    }>;
    growthRate: number;
    projectedCompletion: number;
  };
}

/**
 * Statistics for order entities
 * Tracks order fulfillment, delivery times, and supplier performance
 */
export interface OrderStatistics {
  period: STATISTICS_PERIOD;
  dateRange: {
    from: Date;
    to: Date;
  };

  summary: {
    totalOrders: number;
    totalValue: number;
    avgOrderValue: number;
    fulfilledOrders: number;
    pendingOrders: number;
    overdueOrders: number;
    fulfillmentRate: number;
  };

  statusDistribution: Array<{
    status: string;
    count: number;
    percentage: number;
    totalValue: number;
  }>;

  supplierPerformance: Array<{
    supplierId: string;
    supplierName: string;
    totalOrders: number;
    totalValue: number;
    avgDeliveryTime: number;
    onTimeDeliveryRate: number;
    fulfillmentAccuracy: number;
    qualityScore?: number;
  }>;

  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    orderCount: number;
    totalValue: number;
    avgLeadTime: number;
  }>;

  trends: {
    monthlyOrders: Array<{
      month: string;
      orderCount: number;
      totalValue: number;
      avgValue: number;
    }>;
    valueGrowthRate: number;
    volumeGrowthRate: number;
  };
}

/**
 * Statistics for user entities
 * Monitors user activity, productivity, and engagement
 */
export interface UserStatistics {
  period: STATISTICS_PERIOD;
  dateRange: {
    from: Date;
    to: Date;
  };

  summary: {
    totalActiveUsers: number;
    avgActivitiesPerUser: number;
    totalActivities: number;
    mostActiveUser: {
      userId: string;
      userName: string;
      activityCount: number;
    };
  };

  userRanking: Array<{
    userId: string;
    userName: string;
    sectorName: string;
    activityCount: number;
    productivityScore: number;
    tasksCompleted: number;
    avgTaskCompletionTime: number;
    attendanceRate: number;
  }>;

  sectorComparison: Array<{
    sectorId: string;
    sectorName: string;
    userCount: number;
    totalActivities: number;
    avgActivitiesPerUser: number;
    productivityScore: number;
  }>;

  activityPatterns: {
    hourlyDistribution: Array<{
      hour: number;
      activityCount: number;
      userCount: number;
    }>;
    weeklyPattern: Array<{
      dayOfWeek: string;
      activityCount: number;
      avgUserCount: number;
    }>;
  };

  engagement: {
    highlyEngaged: number; // users with > threshold activities
    moderatelyEngaged: number;
    lowEngagement: number;
    inactive: number;
  };
}

/**
 * Statistics for paint entities
 * Tracks paint consumption, formula usage, and production metrics
 */
export interface PaintStatistics {
  period: STATISTICS_PERIOD;
  dateRange: {
    from: Date;
    to: Date;
  };

  summary: {
    totalProductions: number;
    totalVolume: number; // in liters
    totalValue: number;
    avgProductionVolume: number;
    uniqueColors: number;
  };

  typeDistribution: Array<{
    typeId: string;
    typeName: string;
    productionCount: number;
    totalVolume: number;
    percentage: number;
  }>;

  brandDistribution: Array<{
    brandId: string;
    brandName: string;
    productionCount: number;
    totalVolume: number;
    percentage: number;
  }>;

  finishDistribution: Array<{
    finish: string;
    count: number;
    percentage: number;
  }>;

  colorAnalysis: {
    topColors: Array<{
      paintId: string;
      colorName: string;
      colorCode: string;
      productionCount: number;
      totalVolume: number;
    }>;
    colorFamilies: Array<{
      family: string;
      count: number;
      percentage: number;
    }>;
  };

  consumptionTrends: {
    monthly: Array<{
      month: string;
      productionCount: number;
      totalVolume: number;
      growthRate: number;
    }>;
    seasonal: Array<{
      season: string;
      avgVolume: number;
      pattern: "increasing" | "decreasing" | "stable";
    }>;
  };
}

/**
 * Statistics for bonus/payroll entities
 * Analyzes compensation, bonuses, and payroll trends
 */
export interface BonusPayrollStatistics {
  period: STATISTICS_PERIOD;
  dateRange: {
    from: Date;
    to: Date;
  };

  summary: {
    totalBonusPaid: number;
    totalPayroll: number;
    avgBonusPerUser: number;
    avgSalary: number;
    bonusToPayrollRatio: number;
  };

  bonusDistribution: Array<{
    userId: string;
    userName: string;
    sectorName: string;
    totalBonus: number;
    bonusCount: number;
    avgBonus: number;
  }>;

  discountAnalysis: {
    totalDiscounts: number;
    discountReasons: Array<{
      reason: string;
      count: number;
      totalAmount: number;
      percentage: number;
    }>;
  };

  sectorComparison: Array<{
    sectorId: string;
    sectorName: string;
    userCount: number;
    totalPayroll: number;
    totalBonus: number;
    avgPayrollPerUser: number;
    avgBonusPerUser: number;
  }>;

  trends: {
    monthlyPayroll: Array<{
      month: string;
      totalPayroll: number;
      totalBonus: number;
      growthRate: number;
    }>;
    yearOverYearComparison: {
      currentYear: number;
      previousYear: number;
      growthRate: number;
    };
  };
}

/**
 * Aggregation types for statistics queries
 */
export enum AggregationType {
  SUM = "SUM",
  AVG = "AVG",
  COUNT = "COUNT",
  MIN = "MIN",
  MAX = "MAX",
  MEDIAN = "MEDIAN",
  MODE = "MODE",
  STDDEV = "STDDEV",
}

/**
 * Filter builder for complex statistics queries
 */
export interface FilterBuilder {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "contains" | "startsWith" | "endsWith";
  value: any;
  logicalOperator?: "AND" | "OR";
}

/**
 * Sort configuration for statistics results
 */
export interface SortConfig {
  field: string;
  direction: "asc" | "desc";
  nullsFirst?: boolean;
}

/**
 * Pagination configuration for statistics results
 */
export interface PaginationConfig {
  page: number;
  take: number;
  skip?: number;
}

/**
 * Advanced statistics query options
 */
export interface AdvancedQueryOptions {
  filters?: FilterBuilder[];
  sorts?: SortConfig[];
  pagination?: PaginationConfig;
  aggregations?: Array<{
    field: string;
    type: AggregationType;
    alias?: string;
  }>;
  groupBy?: string[];
  having?: FilterBuilder[];
}

/**
 * Chart data series for multi-series charts
 */
export interface ChartDataSeries {
  name: string;
  data: number[];
  color?: string;
  type?: CHART_TYPE;
  yAxisIndex?: number;
  stack?: string;
}

/**
 * Enhanced chart configuration with multiple series support
 */
export interface MultiSeriesChartConfig {
  chartType: CHART_TYPE;
  series: ChartDataSeries[];
  labels: string[];
  colors?: string[];

  xAxis?: {
    title?: string;
    type?: "category" | "value" | "time";
    categories?: string[];
  };

  yAxis?: Array<{
    title?: string;
    type?: "value" | "log";
    min?: number;
    max?: number;
    position?: "left" | "right";
  }>;

  legend?: {
    show: boolean;
    position?: "top" | "bottom" | "left" | "right";
  };

  tooltip?: {
    enabled: boolean;
    format?: string;
  };

  dataZoom?: {
    enabled: boolean;
    start?: number;
    end?: number;
  };
}

/**
 * Comparative statistics for period-over-period analysis
 */
export interface ComparativeStatistics<T> {
  current: T;
  previous: T;
  comparison: {
    absoluteChange: number;
    percentageChange: number;
    trend: "up" | "down" | "stable";
    isImprovement: boolean;
  };
}

/**
 * Real-time statistics update
 */
export interface RealtimeStatisticsUpdate {
  timestamp: Date;
  entityType: string;
  metric: string;
  value: number;
  change: number;
  changePercentage: number;
}

// =====================
// Response Types for New Statistics
// =====================

export interface TaskStatisticsResponse extends BaseGetUniqueResponse<TaskStatistics> {}

export interface OrderStatisticsResponse extends BaseGetUniqueResponse<OrderStatistics> {}

export interface UserStatisticsResponse extends BaseGetUniqueResponse<UserStatistics> {}

export interface PaintStatisticsResponse extends BaseGetUniqueResponse<PaintStatistics> {}

export interface BonusPayrollStatisticsResponse extends BaseGetUniqueResponse<BonusPayrollStatistics> {}