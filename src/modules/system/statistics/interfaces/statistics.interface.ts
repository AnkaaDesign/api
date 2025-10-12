// Statistics interfaces for all business areas

export enum StatisticsPeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  QUARTER = 'quarter',
  YEAR = 'year',
  CUSTOM = 'custom',
}

export enum GroupByType {
  DATE = 'date',
  CATEGORY = 'category',
  STATUS = 'status',
  USER = 'user',
  SECTOR = 'sector',
  SUPPLIER = 'supplier',
  BRAND = 'brand',
  PAINT = 'paint',
  CUSTOMER = 'customer',
}

export enum ChartType {
  LINE = 'line',
  BAR = 'bar',
  PIE = 'pie',
  AREA = 'area',
  SCATTER = 'scatter',
}

export interface BaseStatisticsFilters {
  dateRange?: {
    from: Date;
    to: Date;
  };
  period?: StatisticsPeriod;
  groupBy?: GroupByType;
  chartType?: ChartType;
}

// =====================
// INVENTORY STATISTICS
// =====================

export interface InventoryOverview {
  totalItems: number;
  totalValue: number;
  totalQuantity: number;
  lowStockItems: number;
  criticalItems: number;
  outOfStockItems: number;
  averageStockLevel: number;
  stockTurnoverRate: number;
  categories: {
    total: number;
    withItems: number;
  };
  brands: {
    total: number;
    withItems: number;
  };
}

export interface StockLevelData {
  itemId: string;
  itemName: string;
  category: string;
  quantity: number;
  maxQuantity: number | null;
  reorderPoint: number | null;
  status: 'critical' | 'low' | 'adequate' | 'overstocked';
  daysUntilStockout: number | null;
  supplier: string | null;
}

export interface ConsumptionTrend {
  period: string;
  totalConsumption: number;
  itemCount: number;
  topItems: Array<{
    itemId: string;
    itemName: string;
    consumption: number;
    percentage: number;
  }>;
  byReason: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
}

export interface AbcXyzAnalysis {
  abcCategories: Array<{
    category: 'A' | 'B' | 'C';
    itemCount: number;
    totalValue: number;
    percentage: number;
    items: Array<{
      itemId: string;
      itemName: string;
      value: number;
      consumption: number;
    }>;
  }>;
  xyzCategories: Array<{
    category: 'X' | 'Y' | 'Z';
    itemCount: number;
    variability: number;
    items: Array<{
      itemId: string;
      itemName: string;
      variability: number;
      avgConsumption: number;
    }>;
  }>;
  matrix: Array<{
    combination: string; // e.g., 'AX', 'BY', 'CZ'
    itemCount: number;
    strategy: string;
  }>;
}

export interface ReorderPointAnalysis {
  needsReorder: number;
  adequateStock: number;
  items: Array<{
    itemId: string;
    itemName: string;
    currentQuantity: number;
    reorderPoint: number;
    reorderQuantity: number;
    estimatedLeadTime: number;
    dailyConsumption: number;
    daysOfStock: number;
    suggestedOrderQuantity: number;
    supplier: string | null;
  }>;
}

export interface SupplierPerformance {
  supplierId: string;
  supplierName: string;
  totalOrders: number;
  fulfilledOrders: number;
  partiallyFulfilledOrders: number;
  cancelledOrders: number;
  fulfillmentRate: number;
  averageDeliveryTime: number;
  totalSpent: number;
  itemsSupplied: number;
  onTimeDeliveryRate: number;
  qualityScore: number | null;
}

// =====================
// PRODUCTION STATISTICS
// =====================

export interface ProductionTasksOverview {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  cancelledTasks: number;
  onHoldTasks: number;
  averageCompletionTime: number;
  totalRevenue: number;
  byStatus: Array<{
    status: string;
    count: number;
    percentage: number;
  }>;
  bySector: Array<{
    sectorId: string;
    sectorName: string;
    taskCount: number;
    completedCount: number;
    avgCompletionTime: number;
  }>;
}

export interface CompletionRates {
  period: string;
  totalStarted: number;
  totalCompleted: number;
  completionRate: number;
  onTimeCompletions: number;
  lateCompletions: number;
  onTimeRate: number;
  trends: Array<{
    date: string;
    started: number;
    completed: number;
    rate: number;
  }>;
}

export interface CycleTimeAnalysis {
  averageCycleTime: number;
  medianCycleTime: number;
  minCycleTime: number;
  maxCycleTime: number;
  byPhase: Array<{
    phase: string;
    averageTime: number;
    percentage: number;
  }>;
  bySector: Array<{
    sectorId: string;
    sectorName: string;
    averageCycleTime: number;
    taskCount: number;
  }>;
  distribution: Array<{
    range: string;
    count: number;
    percentage: number;
  }>;
}

export interface BottleneckAnalysis {
  identifiedBottlenecks: Array<{
    type: 'sector' | 'process' | 'resource';
    identifier: string;
    name: string;
    averageWaitTime: number;
    tasksAffected: number;
    impact: 'high' | 'medium' | 'low';
    recommendations: string[];
  }>;
  workloadDistribution: Array<{
    sectorId: string;
    sectorName: string;
    activeTasks: number;
    capacity: number;
    utilizationRate: number;
  }>;
}

export interface SectorPerformance {
  sectorId: string;
  sectorName: string;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  averageCompletionTime: number;
  efficiency: number;
  revenue: number;
  employeeCount: number;
  tasksPerEmployee: number;
}

export interface PaintUsageStatistics {
  totalLitersProduced: number;
  totalCost: number;
  formulaCount: number;
  topColors: Array<{
    paintId: string;
    paintName: string;
    hex: string;
    litersProduced: number;
    timesUsed: number;
    cost: number;
  }>;
  byType: Array<{
    paintType: string;
    litersProduced: number;
    formulaCount: number;
    cost: number;
  }>;
  byBrand: Array<{
    brandName: string;
    litersProduced: number;
    cost: number;
  }>;
  trends: Array<{
    period: string;
    litersProduced: number;
    cost: number;
  }>;
}

// =====================
// ORDER STATISTICS
// =====================

export interface OrdersOverview {
  totalOrders: number;
  activeOrders: number;
  fulfilledOrders: number;
  cancelledOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  pendingValue: number;
  byStatus: Array<{
    status: string;
    count: number;
    value: number;
    percentage: number;
  }>;
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    orderCount: number;
    totalValue: number;
  }>;
}

export interface FulfillmentRates {
  period: string;
  totalOrders: number;
  fullyFulfilled: number;
  partiallyFulfilled: number;
  notFulfilled: number;
  fulfillmentRate: number;
  itemsFulfillmentRate: number;
  trends: Array<{
    date: string;
    ordered: number;
    fulfilled: number;
    rate: number;
  }>;
}

export interface SupplierComparison {
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    orderCount: number;
    totalSpent: number;
    averageOrderValue: number;
    fulfillmentRate: number;
    averageDeliveryTime: number;
    itemVariety: number;
    onTimeRate: number;
    ranking: number;
  }>;
  metrics: {
    bestFulfillmentRate: string;
    bestDeliveryTime: string;
    bestValue: string;
    mostOrders: string;
  };
}

export interface SpendingAnalysis {
  totalSpent: number;
  periodSpent: number;
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    amount: number;
    percentage: number;
    itemCount: number;
  }>;
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    amount: number;
    percentage: number;
    orderCount: number;
  }>;
  trends: Array<{
    period: string;
    amount: number;
    orderCount: number;
    averageOrderValue: number;
  }>;
  topItems: Array<{
    itemId: string;
    itemName: string;
    totalSpent: number;
    quantity: number;
    orderCount: number;
  }>;
}

export interface DeliveryPerformance {
  averageDeliveryTime: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  onTimeRate: number;
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    averageDeliveryTime: number;
    onTimeRate: number;
    deliveryCount: number;
  }>;
  trends: Array<{
    period: string;
    averageTime: number;
    onTimeRate: number;
  }>;
}

// =====================
// HR STATISTICS
// =====================

export interface EmployeeOverview {
  totalEmployees: number;
  activeEmployees: number;
  onExperiencePeriod: number;
  contracted: number;
  dismissed: number;
  bySector: Array<{
    sectorId: string;
    sectorName: string;
    employeeCount: number;
    avgPerformanceLevel: number;
  }>;
  byPosition: Array<{
    positionId: string;
    positionName: string;
    employeeCount: number;
  }>;
  demographics: {
    averageAge: number;
    averageTenure: number;
    turnoverRate: number;
  };
}

export interface PerformanceMetrics {
  averagePerformanceLevel: number;
  topPerformers: Array<{
    userId: string;
    userName: string;
    performanceLevel: number;
    position: string;
    sector: string;
    tasksCompleted: number;
  }>;
  bySector: Array<{
    sectorId: string;
    sectorName: string;
    averagePerformance: number;
    employeeCount: number;
  }>;
  distribution: Array<{
    level: number;
    count: number;
    percentage: number;
  }>;
}

export interface BonusDistribution {
  totalBonusesPaid: number;
  averageBonusValue: number;
  employeesReceivingBonus: number;
  byPeriod: Array<{
    year: number;
    month: number;
    totalPaid: number;
    employeeCount: number;
    averageValue: number;
  }>;
  bySector: Array<{
    sectorId: string;
    sectorName: string;
    totalPaid: number;
    employeeCount: number;
    averageValue: number;
  }>;
  topRecipients: Array<{
    userId: string;
    userName: string;
    totalReceived: number;
    bonusCount: number;
    averageValue: number;
  }>;
}

export interface AttendanceTrends {
  totalAttendanceRecords: number;
  averageAttendanceRate: number;
  absenceRate: number;
  byPeriod: Array<{
    date: string;
    presentCount: number;
    absentCount: number;
    attendanceRate: number;
  }>;
  bySector: Array<{
    sectorId: string;
    sectorName: string;
    attendanceRate: number;
    employeeCount: number;
  }>;
}

export interface WarningAnalytics {
  totalWarnings: number;
  activeWarnings: number;
  resolvedWarnings: number;
  bySeverity: Array<{
    severity: string;
    count: number;
    percentage: number;
  }>;
  byCategory: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  trends: Array<{
    period: string;
    issued: number;
    resolved: number;
  }>;
  repeatOffenders: Array<{
    userId: string;
    userName: string;
    warningCount: number;
    sector: string;
  }>;
}

// =====================
// FINANCIAL STATISTICS
// =====================

export interface RevenueTrends {
  totalRevenue: number;
  periodRevenue: number;
  growth: number;
  bySource: Array<{
    source: string;
    amount: number;
    percentage: number;
  }>;
  trends: Array<{
    period: string;
    revenue: number;
    taskCount: number;
    averageValue: number;
  }>;
  projections: Array<{
    period: string;
    projected: number;
    confidence: number;
  }>;
}

export interface CostAnalysis {
  totalCosts: number;
  periodCosts: number;
  byCategory: Array<{
    category: string;
    amount: number;
    percentage: number;
  }>;
  operationalCosts: {
    inventory: number;
    labor: number;
    materials: number;
    overhead: number;
  };
  trends: Array<{
    period: string;
    costs: number;
    breakdown: {
      inventory: number;
      labor: number;
      materials: number;
    };
  }>;
}

export interface ProfitabilityMetrics {
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
  returnOnInvestment: number;
  byTask: Array<{
    taskId: string;
    taskName: string;
    revenue: number;
    costs: number;
    profit: number;
    margin: number;
  }>;
  byCustomer: Array<{
    customerId: string;
    customerName: string;
    revenue: number;
    taskCount: number;
    averageProfit: number;
  }>;
}

export interface BudgetTracking {
  totalBudget: number;
  spent: number;
  remaining: number;
  utilizationRate: number;
  byCategory: Array<{
    category: string;
    budget: number;
    spent: number;
    remaining: number;
    utilizationRate: number;
    status: 'under' | 'on-track' | 'over';
  }>;
  trends: Array<{
    period: string;
    budgeted: number;
    spent: number;
    variance: number;
  }>;
  alerts: Array<{
    category: string;
    message: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
}

// =====================
// GENERIC RESPONSE TYPES
// =====================

export interface StatisticsResponse<T> {
  success: boolean;
  message: string;
  data: T;
  metadata?: {
    generatedAt: Date;
    period: {
      from: Date;
      to: Date;
    };
    filters?: Record<string, any>;
  };
}

export interface DataPoint {
  label: string;
  value: number;
  percentage?: number;
  metadata?: Record<string, any>;
}

export interface TrendPoint {
  period: string;
  value: number;
  change?: number;
  changePercentage?: number;
}

export interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    metadata?: Record<string, any>;
  }>;
  type: ChartType;
}
