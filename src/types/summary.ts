// packages/interfaces/src/summary.ts

import type { BaseSummaryResponse } from "./common";
import type { TREND_DIRECTION, TREND_TYPE, WORKLOAD_LEVEL, STOCK_LEVEL, PERFORMANCE_LEVEL, HEALTH_STATUS } from '@constants';

// =====================
// Stock Module Summaries
// =====================

export interface StockDashboardSummary {
  // Overview metrics
  totalItems: number;
  totalItemsLabel: string;
  totalValue: number;
  totalValueLabel: string;
  turnoverRate: number;
  turnoverRateLabel: string;
  turnoverTrend: TREND_DIRECTION;

  // Critical metrics
  criticalItems: number;
  criticalItemsLabel: string;
  overdueOrders: number;
  overdueOrdersLabel: string;
  pendingBorrows: number;
  pendingBorrowsLabel: string;
  lostToolsRate: number;
  lostToolsRateLabel: string;

  // Charts data
  stockLevels: Array<{
    level: STOCK_LEVEL;
    count: number;
    percentage: number;
  }>;

  categoryDistribution: Array<{
    category: string;
    itemCount: number;
    value: number;
  }>;

  recentActivities: Array<{
    id: string;
    item: string;
    operation: string;
    quantity: number;
    user: string;
    timestamp: Date;
  }>;

  topMovingItems: Array<{
    id: string;
    name: string;
    movementCount: number;
    trend: TREND_DIRECTION;
  }>;
}

export interface ItemDashboardSummary {
  // Item analytics
  totalActive: number;
  totalInactive: number;
  averagePrice: number;
  totalMonthlyConsumption: number;

  // Stock health
  stockHealth: Array<{
    status: STOCK_LEVEL;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      minQuantity: number | null;
      category: string;
    }>;
  }>;

  // Supplier performance
  supplierPerformance: Array<{
    supplier: string;
    itemCount: number;
    averageLeadTime: number;
    onTimeDeliveryRate: number;
  }>;

  // Consumption trends
  consumptionTrends: Array<{
    period: string;
    consumption: number;
    trend: TREND_DIRECTION;
  }>;
}

export interface OrderDashboardSummary {
  // Order metrics
  totalOrders: number;
  pendingOrders: number;
  completedOrders: number;
  cancelledOrders: number;

  // Performance metrics
  averageCompletionTime: number;
  onTimeDeliveryRate: number;
  orderAccuracyRate: number;

  // Financial metrics
  totalOrderValue: number;
  averageOrderValue: number;
  monthlyOrderValue: number;

  // Charts data
  ordersByStatus: Array<{
    status: string;
    count: number;
    value: number;
  }>;

  orderTrends: Array<{
    period: string;
    orderCount: number;
    value: number;
    trend: TREND_DIRECTION;
  }>;

  supplierOrders: Array<{
    supplier: string;
    orderCount: number;
    totalValue: number;
    avgCompletionTime: number;
  }>;
}

// =====================
// HUMAN_RESOURCES Module Summaries
// =====================

export interface HRDashboardSummary {
  // Employee metrics
  totalEmployees: number;
  totalEmployeesLabel: string;
  activeEmployees: number;
  activeEmployeesLabel: string;
  inactiveEmployees: number;
  inactiveEmployeesLabel: string;

  // Performance metrics
  turnoverRate: number;
  turnoverRateLabel: string;
  turnoverTrend: TREND_DIRECTION;
  absenteeismRate: number;
  absenteeismRateLabel: string;
  averageTenure: number;
  averageTenureLabel: string;

  // Current status
  vacationsActive: number;
  vacationsActiveLabel: string;
  upcomingHolidays: number;
  upcomingHolidaysLabel: string;
  recentWarnings: number;
  recentWarningsLabel: string;

  // Charts data
  employeesByPosition: Array<{
    position: string;
    count: number;
    percentage: number;
  }>;

  employeesBySector: Array<{
    sector: string;
    count: number;
    workload: WORKLOAD_LEVEL;
  }>;

  tenureDistribution: Array<{
    range: string;
    count: number;
    percentage: number;
  }>;
}

export interface VacationDashboardSummary {
  // Vacation metrics
  totalVacationDays: number;
  usedVacationDays: number;
  remainingVacationDays: number;
  averageDaysPerEmployee: number;

  // Current status
  onVacation: number;
  upcomingVacations: number;
  pendingApprovals: number;

  // Charts data
  vacationsByType: Array<{
    type: string;
    count: number;
    days: number;
  }>;

  vacationCalendar: Array<{
    month: string;
    employees: Array<{
      id: string;
      name: string;
      startDate: Date;
      endDate: Date;
      type: string;
    }>;
  }>;

  vacationTrends: Array<{
    period: string;
    count: number;
    trend: TREND_DIRECTION;
  }>;
}

export interface WarningDashboardSummary {
  // Warning metrics
  totalWarnings: number;
  activeWarnings: number;
  resolvedWarnings: number;
  repeatOffenders: number;

  // Severity distribution
  severityDistribution: Array<{
    severity: string;
    count: number;
    percentage: number;
  }>;

  // Category analysis
  categoryBreakdown: Array<{
    category: string;
    count: number;
    trend: TREND_DIRECTION;
  }>;

  // Department analysis
  departmentAnalysis: Array<{
    department: string;
    warningCount: number;
    employeeCount: number;
    rate: number;
  }>;

  // Recent activity
  recentWarnings: Array<{
    id: string;
    employee: string;
    supervisor: string;
    category: string;
    severity: string;
    date: Date;
  }>;
}

// =====================
// Work Module Summaries
// =====================

export interface TaskDashboardSummary {
  // Task metrics
  totalTasks: number;
  totalTasksLabel: string;
  activeTasks: number;
  activeTasksLabel: string;
  completedTasks: number;
  completedTasksLabel: string;
  overdueTasks: number;
  overdueTasksLabel: string;

  // Performance metrics
  averageCompletionTime: number;
  averageCompletionTimeLabel: string;
  onTimeCompletionRate: number;
  onTimeCompletionRateLabel: string;
  customerSatisfactionRate: number;
  customerSatisfactionRateLabel: string;

  // Charts data
  tasksByStatus: Array<{
    status: string;
    count: number;
    percentage: number;
  }>;

  tasksBySector: Array<{
    sector: string;
    count: number;
    avgCompletionTime: number;
    performance: PERFORMANCE_LEVEL;
  }>;

  taskTimeline: Array<{
    period: string;
    created: number;
    completed: number;
    trend: TREND_TYPE;
  }>;

  topCustomers: Array<{
    id: string;
    name: string;
    taskCount: number;
    revenue: number;
  }>;
}

export interface CustomerDashboardSummary {
  // Customer metrics
  totalCustomers: number;
  activeCustomers: number;
  newCustomersThisMonth: number;
  customerRetentionRate: number;

  // Revenue metrics
  totalRevenue: number;
  averageRevenuePerCustomer: number;
  monthlyRecurringRevenue: number;

  // Activity metrics
  averageTasksPerCustomer: number;
  customerSatisfactionScore: number;

  // Charts data
  customersByActivity: Array<{
    level: string;
    count: number;
    revenue: number;
  }>;

  revenueByCustomer: Array<{
    customer: string;
    revenue: number;
    taskCount: number;
    lastActivity: Date;
  }>;

  customerGrowth: Array<{
    period: string;
    newCustomers: number;
    totalCustomers: number;
    trend: TREND_DIRECTION;
  }>;
}

export interface GarageDashboardSummary {
  // Garage metrics
  totalGarages: number;
  totalCapacity: number;
  currentOccupancy: number;
  occupancyRate: number;

  // Efficiency metrics
  averageStayDuration: number;
  turnoverRate: number;
  utilizationRate: number;

  // Charts data
  occupancyByGarage: Array<{
    garage: string;
    totalSpots: number;
    occupiedSpots: number;
    rate: number;
  }>;

  occupancyTrends: Array<{
    period: string;
    occupancyRate: number;
    trend: TREND_DIRECTION;
  }>;

  currentTrucks: Array<{
    id: string;
    taskId: string;
    garage: string;
    position: string;
    entryTime: Date;
    estimatedExit: Date | null;
  }>;
}

// =====================
// Notification Module Summaries
// =====================

export interface NotificationDashboardSummary {
  // Notification metrics
  totalNotifications: number;
  totalNotificationsLabel: string;
  sentNotifications: number;
  sentNotificationsLabel: string;
  pendingNotifications: number;
  pendingNotificationsLabel: string;
  failedNotifications: number;
  failedNotificationsLabel: string;

  // Performance metrics
  deliveryRate: number;
  deliveryRateLabel: string;
  engagementRate: number;
  engagementRateLabel: string;
  averageResponseTime: number;
  averageResponseTimeLabel: string;

  // Channel distribution
  channelPerformance: Array<{
    channel: string;
    sent: number;
    delivered: number;
    read: number;
    deliveryRate: number;
    readRate: number;
  }>;

  // Type distribution
  notificationsByType: Array<{
    type: string;
    count: number;
    importance: string;
    engagementRate: number;
  }>;

  // User preferences
  preferencesSummary: Array<{
    notificationType: string;
    enabledCount: number;
    disabledCount: number;
    preferredChannels: string[];
  }>;
}

// =====================
// Aggregated Dashboard Summary
// =====================

export interface DashboardAggregatedSummary {
  // Module health scores
  moduleHealth: {
    stock: HEALTH_STATUS;
    hr: HEALTH_STATUS;
    work: HEALTH_STATUS;
    notifications: HEALTH_STATUS;
    paint: HEALTH_STATUS;
  };

  // Key metrics across modules
  keyMetrics: {
    totalRevenue: number;
    totalExpenses: number;
    profitMargin: number;
    employeeProductivity: number;
    customerSatisfaction: number;
    operationalEfficiency: number;
  };

  // Alerts and notifications
  criticalAlerts: Array<{
    type: string;
    module: string;
    message: string;
    severity: string;
    timestamp: Date;
  }>;

  // Trends
  businessTrends: {
    revenue: TREND_DIRECTION;
    costs: TREND_DIRECTION;
    productivity: TREND_DIRECTION;
    quality: TREND_DIRECTION;
  };
}

// =====================
// Summary Response Types
// =====================

// Stock Module Responses
export interface StockSummaryResponse extends BaseSummaryResponse<StockDashboardSummary> {}
export interface ItemSummaryResponse extends BaseSummaryResponse<ItemDashboardSummary> {}
export interface OrderSummaryResponse extends BaseSummaryResponse<OrderDashboardSummary> {}

// HUMAN_RESOURCES Module Responses
export interface HRSummaryResponse extends BaseSummaryResponse<HRDashboardSummary> {}
export interface VacationSummaryResponse extends BaseSummaryResponse<VacationDashboardSummary> {}
export interface WarningSummaryResponse extends BaseSummaryResponse<WarningDashboardSummary> {}

// Work Module Responses
export interface TaskSummaryResponse extends BaseSummaryResponse<TaskDashboardSummary> {}
export interface CustomerSummaryResponse extends BaseSummaryResponse<CustomerDashboardSummary> {}
export interface GarageSummaryResponse extends BaseSummaryResponse<GarageDashboardSummary> {}

// Notification Module Response
export interface NotificationSummaryResponse extends BaseSummaryResponse<NotificationDashboardSummary> {}

// Aggregated Response
export interface DashboardAggregatedResponse extends BaseSummaryResponse<DashboardAggregatedSummary> {}
