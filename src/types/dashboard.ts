import type { VACATION_STATUS, ACTIVITY_REASON, ACTIVITY_OPERATION } from '@constants';

// Date filter type for dashboard queries
export interface DateFilter {
  gte?: Date;
  lte?: Date;
}

// Dashboard repository method parameter types
export interface DashboardActivityWhere {
  createdAt?: DateFilter;
  item?: any;
}

export interface DashboardOrderWhere {
  createdAt?: DateFilter;
  supplierId?: string;
  status?: any;
  supplier?: { id: string };
}

export interface DashboardUserWhere {
  sectorId?: string;
  positionId?: string;
  status?: any;
}

export interface DashboardTaskWhere {
  createdBy?: any;
  createdAt?: DateFilter;
  sectorId?: string;
  status?: any;
}

export interface DashboardNotificationWhere {
  createdAt?: DateFilter;
}

// Export format types
export enum ExportFormat {
  CSV = 'csv',
  EXCEL = 'excel',
  PDF = 'pdf',
  JSON = 'json',
}

export interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  fields?: string[];
  dateRange?: DateFilter;
}

// Aggregation result types
export interface AggregationResult<T> {
  _count?: { [K in keyof T]?: number };
  _sum?: { [K in keyof T]?: number };
  _avg?: { [K in keyof T]?: number };
  _min?: { [K in keyof T]?: T[K] };
  _max?: { [K in keyof T]?: T[K] };
}

export interface GroupByResult<T> {
  _count: { id: number };
  _sum?: Partial<T>;
  _avg?: Partial<T>;
  [key: string]: any; // Additional group by fields
}

// Enhanced dashboard types for reports
export interface ReportDateRange {
  startDate: Date;
  endDate: Date;
}

export interface ReportExportRequest {
  reportType: string;
  dateRange?: ReportDateRange;
  filters?: Record<string, any>;
  format: ExportFormat;
  includeCharts?: boolean;
}

export interface ReportGenerationResult {
  success: boolean;
  fileUrl?: string;
  error?: string;
  generatedAt: Date;
}

// Common dashboard types
export interface DashboardMetric {
  label: string;
  value: number;
  change?: number;
  changePercent?: number;
  trend?: 'up' | 'down' | 'stable';
  unit?: string;
}

export interface DashboardChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
  }[];
}

export interface DashboardListItem {
  id: string;
  name: string;
  value: number;
  percentage?: number;
  metadata?: Record<string, any>;
}

export interface TimeSeriesDataPoint {
  date: string;
  value: number;
  label?: string;
}

// Inventory Dashboard
export interface InventoryDashboardData {
  overview: {
    totalItems: DashboardMetric;
    totalValue: DashboardMetric; // sum of quantity * latest price
    negativeStockItems: DashboardMetric; // quantity < 0
    outOfStockItems: DashboardMetric; // quantity = 0
    criticalItems: DashboardMetric; // quantity <= 90% of reorderPoint
    lowStockItems: DashboardMetric; // 90% < quantity <= 110% of reorderPoint
    optimalItems: DashboardMetric; // 110% < quantity <= maxQuantity (or no max)
    overstockedItems: DashboardMetric; // quantity > maxQuantity
    itemsNeedingReorder: DashboardMetric; // NEGATIVE_STOCK + OUT_OF_STOCK + CRITICAL + LOW
  };
  stockMovements: {
    totalInbound: DashboardMetric;
    totalOutbound: DashboardMetric;
    movementsByReason: DashboardChartData;
    movementsByOperation: DashboardChartData;
    recentActivities: Array<{
      id: string;
      itemName: string;
      quantity: number;
      operation: ACTIVITY_OPERATION;
      reason: ACTIVITY_REASON;
      userName?: string;
      createdAt: Date;
    }>;
  };
  topItems: {
    byValue: DashboardListItem[]; // quantity * price
    byActivityCount: DashboardListItem[]; // most activities
    byLowStockPercentage: DashboardListItem[]; // (minQuantity - quantity) / minQuantity
  };
  categoryBreakdown: {
    itemsByCategory: DashboardChartData;
    valueByCategory: DashboardChartData;
    itemsByBrand: DashboardChartData;
  };
  supplierMetrics: {
    itemsPerSupplier: DashboardListItem[];
    pendingOrdersCount: number;
    overdueOrdersCount: number; // forecast < now && status != RECEIVED
  };
}

export interface InventoryDashboardResponse {
  success: boolean;
  message: string;
  data?: InventoryDashboardData;
}

// HR Dashboard
export interface HRDashboardData {
  overview: {
    totalEmployees: DashboardMetric;
    activeEmployees: DashboardMetric; // status = ACTIVE
    inactiveEmployees: DashboardMetric; // status = INACTIVE
    newHires: DashboardMetric; // hireDate in last 30 days
    employeesByPerformanceLevel: DashboardChartData; // grouped by performanceLevel
  };
  sectorAnalysis: {
    employeesBySector: DashboardChartData;
    employeesByPosition: DashboardChartData;
    averagePositionLevel: DashboardMetric;
  };
  vacationMetrics: {
    onVacationNow: DashboardMetric; // current date between start and end
    upcomingVacations: DashboardMetric; // next 30 days
    approvedVacations: DashboardMetric;
    vacationSchedule: Array<{
      id: string;
      userName: string;
      startAt: Date;
      endAt: Date;
      status: VACATION_STATUS;
      isCollective: boolean;
    }>;
  };
  taskMetrics: {
    totalTasksCreated: DashboardMetric; // tasks where createdById = userId
    tasksByStatus: DashboardChartData;
    tasksCompleted: DashboardMetric; // status = COMPLETED
    tasksInProgress: DashboardMetric; // status = IN_PRODUCTION
    averageTasksPerUser: DashboardMetric;
    taskProductivityTrend: 'up' | 'down' | 'stable';
  };
  positionMetrics?: {
    totalPositions: number;
    employeesByPosition: DashboardChartData;
  };
  holidayMetrics?: {
    totalHolidays: number;
    upcomingHolidays: number;
  };
  noticeMetrics?: {
    totalNotices: number;
    activeNotices: number;
    newNotices: number;
  };
  ppeMetrics?: {
    totalPPE: number;
    deliveriesToday: number;
    pendingDeliveries: number;
    deliveredThisMonth: number;
    deliveryTrend?: 'up' | 'down' | 'stable';
    deliveryPercent?: number;
  };
  sectorMetrics?: {
    totalSectors: number;
    employeesBySector: DashboardListItem[];
  };
  employeeMetrics?: {
    totalEmployees: number;
    employeeGrowthTrend?: 'up' | 'down' | 'stable';
    employeeGrowthPercent?: number;
    satisfactionRate?: number;
    employeesByDepartment?: DashboardListItem[];
  };
  recentActivities?: Array<{
    id: string;
    employeeName?: string;
    entity?: string;
    action?: string;
    user?: string;
    type?: string;
    createdAt: Date | string;
  }>;
}

export interface HRDashboardResponse {
  success: boolean;
  message: string;
  data?: HRDashboardData;
}

// Administration Dashboard
export interface AdministrationDashboardData {
  orderOverview: {
    totalOrders: DashboardMetric;
    ordersByStatus: DashboardChartData; // grouped by status
    pendingOrders: DashboardMetric; // status != RECEIVED
    overdueOrders: DashboardMetric; // forecast < now && status != RECEIVED
    ordersWithSchedule: DashboardMetric; // has orderScheduleId
  };
  nfeTracking: {
    ordersWithoutNfe: DashboardListItem[]; // nfeId is null
    tasksWithoutNfe: DashboardListItem[]; // nfeId is null
    ordersWithNfe: DashboardMetric;
    tasksWithNfe: DashboardMetric;
  };
  customerAnalysis: {
    totalCustomers: DashboardMetric;
    customersByType: DashboardChartData; // has cnpj vs cpf
    topCustomersByTasks: DashboardListItem[]; // by task count
    customersByCity: DashboardChartData;
    customersWithTags: DashboardMetric;
  };
  supplierAnalysis: {
    totalSuppliers: DashboardMetric;
    suppliersWithOrders: DashboardMetric;
    ordersBySupplier: DashboardListItem[];
    suppliersByState: DashboardChartData;
  };
  taskOverview: {
    totalTasks: DashboardMetric;
    tasksByStatus: DashboardChartData;
    tasksWithPrice: DashboardMetric; // tasks with budget information
    totalRevenue: DashboardMetric; // sum of task budget values
    tasksBySector: DashboardChartData;
  };
  notificationMetrics: {
    totalNotifications: DashboardMetric;
    notificationsByImportance: DashboardChartData;
    sentNotifications: DashboardMetric; // sentAt is not null
    notificationsByType: DashboardChartData;
  };
  userMetrics: {
    totalUsers: DashboardMetric;
    activeUsers: DashboardMetric;
    inactiveUsers: DashboardMetric;
    experiencePeriod1Users: DashboardMetric;
    experiencePeriod2Users: DashboardMetric;
    effectedUsers: DashboardMetric;
    dismissedUsers: DashboardMetric;
    pendingUsers: DashboardMetric;
    newUsersThisWeek: DashboardMetric;
    newUsersToday: DashboardMetric;
    userGrowthTrend: 'up' | 'down' | 'stable';
    userGrowthPercent: number;
    monthlyGrowth: Array<{ month: string; count: number }>;
  };
  taskMetrics: {
    totalTasks: DashboardMetric;
    tasksInProgress: DashboardMetric;
    tasksCompleted: DashboardMetric;
    tasksBySector: DashboardChartData;
    averageTasksPerUser: DashboardMetric;
  };
  sectorMetrics: {
    totalSectors: DashboardMetric;
    usersBySector: DashboardChartData;
  };
  budgetMetrics: {
    totalBudgets: DashboardMetric;
    budgetGrowthTrend: 'up' | 'down' | 'stable';
    budgetGrowthPercent: number;
  };
  fileMetrics: {
    totalFiles: DashboardMetric;
    fileTypeDistribution?: Array<{ type: string; count: number }>;
  };
  userActivity: {
    byRole: DashboardChartData;
    byPosition?: DashboardChartData;
    bySector?: DashboardChartData;
  };
  recentActivities: Array<{
    id: string;
    title: string;
    description: string;
    icon?: string;
    type?: string;
    timestamp: Date | string;
  }>;
}

export interface AdministrationDashboardResponse {
  success: boolean;
  message: string;
  data?: AdministrationDashboardData;
}

// Paint Dashboard Types
export interface PaintProductionOverview {
  totalProductions: number;
  totalVolumeLiters: number;
  totalWeightKg: number;
  averageVolumePerProduction: number;
  productionsByMonth: Array<{
    month: string;
    count: number;
    volumeLiters: number;
    weightKg: number;
  }>;
}

export interface PaintFormulaMetrics {
  totalFormulas: number;
  averageDensity: number;
  averagePricePerLiter: number;
  mostUsedFormulas: Array<{
    id: string;
    paintName: string;
    paintCode: string;
    paintTypeName: string;
    productionCount: number;
    totalVolumeLiters: number;
  }>;
  formulasWithoutProduction: Array<{
    id: string;
    paintName: string;
    paintCode: string;
  }>;
}

export interface PaintComponentInventory {
  totalComponents: number;
  lowStockComponents: Array<{
    id: string;
    name: string;
    code: string | null;
    currentQuantity: number;
    requiredQuantity: number;
    shortageQuantity: number;
  }>;
  componentUsageByType: Array<{
    paintTypeName: string;
    componentCount: number;
    components: Array<{
      itemName: string;
      usageCount: number;
    }>;
  }>;
}

export interface PaintColorAnalysis {
  totalColors: number;
  colorsByFinish: Array<{
    finish: string;
    count: number;
    percentage: number;
  }>;
  colorsByManufacturer: Array<{
    manufacturer: string;
    count: number;
    percentage: number;
  }>;
}

export interface PaintEfficiencyMetrics {
  averageProductionTime: number | null;
  productionEfficiency: number;
  wastePercentage: number;
  formulaUtilizationRate: number;
}

export interface PaintTrends {
  monthlyProduction: Array<{
    month: string;
    productions: number;
    volumeLiters: number;
  }>;
  popularColors: Array<{
    paintName: string;
    paintCode: string;
    productionCount: number;
  }>;
  recentPaintUsageInTasks: Array<{
    paintId: string;
    paintName: string;
    taskId: string;
    taskName: string;
    taskPlate?: string;
    taskSerialNumber?: string;
    createdAt: Date;
  }>;
  seasonalPatterns: Array<{
    paintTypeName: string;
    monthlyData: Array<{
      month: string;
      count: number;
    }>;
  }>;
}

// Paint Dashboard
export interface PaintDashboardData {
  productionOverview: PaintProductionOverview;
  formulaMetrics: PaintFormulaMetrics;
  componentInventory: PaintComponentInventory;
  colorAnalysis: PaintColorAnalysis;
  efficiencyMetrics: PaintEfficiencyMetrics;
  trends: PaintTrends;
}

export interface PaintDashboardResponse {
  success: boolean;
  message: string;
  data?: PaintDashboardData;
}

// Production Dashboard
export interface ProductionDashboardData {
  overview: {
    totalTasks: DashboardMetric;
    tasksInProduction: DashboardMetric;
    tasksCompleted: DashboardMetric;
    tasksCancelled: DashboardMetric;
    tasksInPreparation: DashboardMetric;
    tasksPending: DashboardMetric;
    averageCompletionTime: DashboardMetric; // in hours
  };
  serviceOrders: {
    totalServiceOrders: DashboardMetric;
    pendingServiceOrders: DashboardMetric;
    completedServiceOrders: DashboardMetric;
    serviceOrdersByType: DashboardChartData;
    averageServicesPerOrder: DashboardMetric;
  };
  customerMetrics: {
    activeCustomers: DashboardMetric; // customers with tasks
    topCustomersByTasks: DashboardListItem[];
    topCustomersByRevenue: DashboardListItem[];
    customersByType: DashboardChartData; // CPF vs CNPJ
    customersByCity: DashboardChartData;
  };
  garageUtilization: {
    totalGarages: DashboardMetric;
    totalLanes: DashboardMetric;
    totalParkingSpots: DashboardMetric;
    occupiedSpots: DashboardMetric;
    utilizationRate: DashboardMetric; // percentage
    spotsByGarage: DashboardChartData;
  };
  truckMetrics: {
    totalTrucks: DashboardMetric;
    trucksInProduction: DashboardMetric;
    trucksByManufacturer: DashboardChartData;
    trucksByPosition: DashboardListItem[]; // current garage positions
  };
  cuttingOperations: {
    totalCuts: DashboardMetric;
    pendingCuts: DashboardMetric;
    completedCuts: DashboardMetric;
    cutsByType: DashboardChartData; // VINYL vs STENCIL
    averageCutTime: DashboardMetric;
  };
  airbrushingMetrics: {
    totalAirbrushJobs: DashboardMetric;
    pendingAirbrushJobs: DashboardMetric;
    completedAirbrushJobs: DashboardMetric;
    airbrushByType: DashboardChartData;
    averageAirbrushTime: DashboardMetric;
  };
  revenueAnalysis: {
    totalRevenue: DashboardMetric; // sum of task prices
    averageTaskValue: DashboardMetric;
    revenueByMonth: TimeSeriesDataPoint[];
    revenueBySector: DashboardChartData;
    revenueByCustomerType: DashboardChartData;
  };
  productivityMetrics: {
    tasksPerDay: DashboardMetric;
    averageTasksPerUser: DashboardMetric;
    tasksBySector: DashboardChartData;
    tasksByShift: DashboardChartData; // morning, afternoon, night
    efficiency: DashboardMetric; // completed vs total
  };
}

export interface ProductionDashboardResponse {
  success: boolean;
  message: string;
  data?: ProductionDashboardData;
}

// Unified Dashboard - combines key metrics from all modules
export interface UnifiedDashboardData {
  inventory: {
    overview: InventoryDashboardData['overview'];
    criticalAlerts: Array<{
      itemId: string;
      itemName: string;
      alertType: 'critical' | 'low_stock' | 'overstock';
      currentQuantity: number;
      threshold: number;
    }>;
  };
  hr: {
    overview: Pick<HRDashboardData['overview'], 'totalEmployees' | 'activeEmployees'>;
    vacationsToday: number;
    tasksInProgress: number;
  };
  administration: {
    orderSummary: Pick<
      AdministrationDashboardData['orderOverview'],
      'totalOrders' | 'pendingOrders' | 'overdueOrders'
    >;
    revenue: number; // sum of task prices
    missingNfe: number; // count of orders + tasks without nfe
  };
  paint: {
    productionSummary: Pick<
      PaintDashboardData['productionOverview'],
      'totalProductions' | 'totalVolumeLiters'
    >;
    activeFormulas: number;
  };
  production: {
    taskSummary: Pick<
      ProductionDashboardData['overview'],
      'totalTasks' | 'tasksInProduction' | 'tasksCompleted'
    >;
    garageUtilization: number; // percentage
    activeServiceOrders: number;
  };
}

export interface UnifiedDashboardResponse {
  success: boolean;
  message: string;
  data?: UnifiedDashboardData;
}
