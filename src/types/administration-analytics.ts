export interface AdministrationAnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  sortBy?: 'count' | 'name' | 'date';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  groupBy?: 'month' | 'week';
}

export interface CustomerAcquisitionItem {
  period: string;
  periodLabel: string;
  newCustomers: number;
  totalCustomers: number;
}

export interface TaskTrendItem {
  period: string;
  periodLabel: string;
  tasksCreated: number;
  tasksCompleted: number;
}

export interface AdministrationSummary {
  totalCustomers: number;
  newCustomersThisMonth: number;
  activeUsers: number;
  tasksThisMonth: number;
}

export interface AdministrationAnalyticsData {
  summary: AdministrationSummary;
  customerAcquisition: CustomerAcquisitionItem[];
  taskTrends: TaskTrendItem[];
}
