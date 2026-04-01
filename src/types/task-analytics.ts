export interface TaskAnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  sectorIds?: string[];
  customerIds?: string[];
  status?: string[];
  periods?: Array<{ id: string; label: string; startDate: Date; endDate: Date }>;
  sortBy?: 'completionTime' | 'count' | 'forecastAccuracy' | 'value' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// Throughput endpoint response
export interface ThroughputAnalyticsData {
  summary: {
    totalCompleted: number;
    avgCompletionDays: number;
    onTimeDeliveryRate: number;
    tasksPerWeek: number;
  };
  items: ThroughputItem[];
  pagination: { hasMore: boolean; offset: number; limit: number; total: number };
}

export interface ThroughputItem {
  period: string; // "2025-01" format
  periodLabel: string; // "Janeiro 2025"
  completedCount: number;
  plannedCount: number; // tasks that had forecastDate in this period
  avgCompletionDays: number;
  forecastAccuracy: number; // % on-time
  comparisons?: ThroughputComparison[];
}

export interface ThroughputComparison {
  entityId: string;
  entityName: string;
  completedCount: number;
  plannedCount: number;
  avgCompletionDays: number;
}

// Bottleneck endpoint response
export interface BottleneckAnalyticsData {
  summary: {
    currentUtilization: number; // garage %
    avgQueueDays: number;
    bottleneckStage: string;
    recutRate: number;
  };
  stageDistribution: Array<{
    stage: string;
    stageLabel: string;
    count: number;
    avgDays: number;
  }>;
  garageUtilization: Array<{
    period: string;
    periodLabel: string;
    utilizationPercent: number;
    occupiedSpots: number;
    totalSpots: number;
    byGarage?: Array<{ garage: string; occupied: number }>;
  }>;
  recutTrend: Array<{
    period: string;
    periodLabel: string;
    totalCuts: number;
    recuts: number;
    recutRate: number;
  }>;
}

// Revenue endpoint response
export interface RevenueAnalyticsData {
  summary: {
    totalRevenue: number;
    avgTaskValue: number;
    monthOverMonthGrowth: number;
    topCustomer: string;
  };
  items: RevenueItem[];
  pagination: { hasMore: boolean; offset: number; limit: number; total: number };
}

export interface RevenueItem {
  id: string;
  name: string; // sector name, customer name, or month label
  revenue: number;
  taskCount: number;
  avgValue: number;
  comparisons?: Array<{
    entityId: string;
    entityName: string;
    revenue: number;
    taskCount: number;
  }>;
}
