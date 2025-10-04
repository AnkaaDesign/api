import { Injectable, Logger } from '@nestjs/common';
import {
  InventoryDashboardResponse,
  HRDashboardResponse,
  AdministrationDashboardResponse,
  PaintDashboardResponse,
  ProductionDashboardResponse,
  UnifiedDashboardResponse,
  DateFilter,
  DashboardActivityWhere,
  DashboardOrderWhere,
  DashboardUserWhere,
  DashboardTaskWhere,
} from '../../../types';
import {
  InventoryDashboardQueryFormData,
  HRDashboardQueryFormData,
  AdministrationDashboardQueryFormData,
  PaintDashboardQueryFormData,
  ProductionDashboardQueryFormData,
  UnifiedDashboardQueryFormData,
} from '../../../schemas';
import { DASHBOARD_TIME_PERIOD, ACTIVE_USER_STATUSES } from '../../../constants';
import {
  createTodayRange,
  createThisWeekRange,
  createThisMonthRange,
  createThisYearRange,
} from '../../../utils';
import { DashboardRepository } from './repositories/dashboard/dashboard.repository';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly dashboardRepository: DashboardRepository) {}

  /**
   * Get date filter based on time period or custom date range
   */
  private getDateFilter(query: {
    startDate?: Date;
    endDate?: Date;
    timePeriod?: string;
  }): DateFilter {
    // If custom dates are provided, use them
    if (query.startDate || query.endDate) {
      return {
        ...(query.startDate && { gte: query.startDate }),
        ...(query.endDate && { lte: query.endDate }),
      };
    }

    // Otherwise use the time period
    switch (query.timePeriod) {
      case DASHBOARD_TIME_PERIOD.THIS_WEEK:
        return createThisWeekRange();
      case DASHBOARD_TIME_PERIOD.THIS_MONTH:
        return createThisMonthRange();
      case DASHBOARD_TIME_PERIOD.THIS_YEAR:
        return createThisYearRange();
      case DASHBOARD_TIME_PERIOD.ALL_TIME:
        return {}; // No date filter for all time
      default:
        return createThisMonthRange(); // Default to this month
    }
  }

  async getInventoryDashboard(
    query: InventoryDashboardQueryFormData,
    userId: string,
  ): Promise<InventoryDashboardResponse> {
    try {
      this.logger.log('Fetching inventory dashboard data');

      // Date filter based on time period
      const dateFilter = this.getDateFilter(query);

      // Item filters
      const itemWhere = {
        ...(query.categoryId && { categoryId: query.categoryId }),
        ...(query.brandId && { brandId: query.brandId }),
        ...(query.supplierId && { supplierId: query.supplierId }),
        ...(!query.includeInactive && { isActive: true }),
      };

      // Get all metrics in parallel
      const [itemStats, activityStats, topItems, categoryBreakdown, supplierMetrics] =
        await Promise.all([
          this.getItemOverviewStats(itemWhere),
          this.getActivityStats(dateFilter, itemWhere),
          this.getTopItems(itemWhere),
          this.getCategoryBreakdown(itemWhere),
          this.getSupplierMetrics(itemWhere, dateFilter),
        ]);

      return {
        success: true,
        message: 'Dashboard de inventário carregado com sucesso',
        data: {
          overview: itemStats,
          stockMovements: activityStats,
          topItems,
          categoryBreakdown,
          supplierMetrics,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching inventory dashboard', error);
      throw error;
    }
  }

  async getHRDashboard(
    query: HRDashboardQueryFormData,
    userId: string,
  ): Promise<HRDashboardResponse> {
    try {
      this.logger.log('Fetching HR dashboard data');

      const dateFilter = this.getDateFilter(query);

      const userWhere: DashboardUserWhere = {
        ...(query.sectorId && { sectorId: query.sectorId }),
        ...(query.positionId && { positionId: query.positionId }),
        ...(!query.includeInactive && { status: { in: [...ACTIVE_USER_STATUSES] } }),
      };

      const [
        employeeStats,
        sectorAnalysis,
        vacationMetrics,
        taskMetrics,
        positionMetrics,
        holidayMetrics,
        noticeMetrics,
        ppeMetrics,
        sectorMetrics,
        recentActivities,
      ] = await Promise.all([
        this.getEmployeeOverview(userWhere, dateFilter),
        this.getSectorAnalysis(userWhere),
        this.getVacationMetrics(dateFilter),
        this.getTaskMetrics(userWhere, dateFilter),
        this.getPositionMetrics(userWhere),
        this.getHolidayMetrics(),
        this.getNoticeMetrics(dateFilter),
        this.getPPEMetrics(dateFilter),
        this.getSectorMetricsForHR(),
        this.getHRRecentActivities(dateFilter),
      ]);

      return {
        success: true,
        message: 'Dashboard de RH carregado com sucesso',
        data: {
          overview: employeeStats,
          sectorAnalysis,
          vacationMetrics,
          taskMetrics,
          positionMetrics,
          holidayMetrics,
          noticeMetrics,
          ppeMetrics,
          sectorMetrics,
          recentActivities,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching HR dashboard', error);
      throw error;
    }
  }

  async getAdministrationDashboard(
    query: AdministrationDashboardQueryFormData,
    userId: string,
  ): Promise<AdministrationDashboardResponse> {
    try {
      this.logger.log('Fetching administration dashboard data');

      const dateFilter = this.getDateFilter(query);

      const [
        orderOverview,
        nfeTracking,
        customerAnalysis,
        supplierAnalysis,
        taskOverview,
        notificationMetrics,
        userMetrics,
        sectorMetrics,
        budgetMetrics,
        fileMetrics,
        taskMetrics,
        userActivity,
        recentActivities,
      ] = await Promise.all([
        this.getOrderOverview(query.supplierId, dateFilter),
        this.getNfeTracking(),
        this.getCustomerAnalysis(query.customerId),
        this.getSupplierAnalysis(query.supplierId),
        this.getTaskOverview(query.sectorId, dateFilter),
        this.getNotificationMetrics(dateFilter),
        this.getUserMetrics(query.sectorId, dateFilter),
        this.getSectorMetrics(),
        this.getBudgetMetrics(dateFilter),
        this.getFileMetrics(),
        this.getTaskOverviewMetrics(query.sectorId, dateFilter),
        this.getUserActivity(),
        this.getRecentActivities(dateFilter),
      ]);

      return {
        success: true,
        message: 'Dashboard administrativo carregado com sucesso',
        data: {
          orderOverview,
          nfeTracking,
          customerAnalysis,
          supplierAnalysis,
          taskOverview,
          notificationMetrics,
          userMetrics,
          sectorMetrics,
          budgetMetrics,
          fileMetrics,
          taskMetrics,
          userActivity,
          recentActivities,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching administration dashboard', error);
      throw error;
    }
  }

  async getPaintDashboard(
    query: PaintDashboardQueryFormData,
    userId: string,
  ): Promise<PaintDashboardResponse> {
    try {
      this.logger.log('Fetching paint dashboard data');

      const dateFilter = this.getDateFilter(query);
      const baseWhere: any = {};
      if (dateFilter.gte || dateFilter.lte) {
        baseWhere.createdAt = dateFilter;
      }

      const [
        productionOverview,
        formulaMetrics,
        componentInventory,
        colorAnalysis,
        efficiencyMetrics,
        trends,
      ] = await Promise.all([
        this.dashboardRepository.getProductionOverview(baseWhere, query.paintIds),
        this.dashboardRepository.getFormulaMetrics(baseWhere, query.paintTypeIds, query.paintIds),
        this.dashboardRepository.getComponentInventory(query.paintTypeIds),
        this.dashboardRepository.getColorAnalysis(
          query.paintTypeIds,
          query.manufacturers,
          query.includeInactive,
        ),
        this.dashboardRepository.getEfficiencyMetrics(baseWhere),
        this.dashboardRepository.getTrends(baseWhere, query.paintTypeIds),
      ]);

      return {
        success: true,
        message: 'Dashboard de tintas carregado com sucesso',
        data: {
          productionOverview,
          formulaMetrics,
          componentInventory,
          colorAnalysis,
          efficiencyMetrics,
          trends,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching paint dashboard', error);
      throw error;
    }
  }

  async getProductionDashboard(
    query: ProductionDashboardQueryFormData,
    userId: string,
  ): Promise<ProductionDashboardResponse> {
    try {
      this.logger.log('Fetching production dashboard data');

      // Date filter based on time period
      const dateFilter = this.getDateFilter(query);

      // Base where conditions
      const baseWhere = {
        createdAt: dateFilter,
        ...(query.sectorId && { sectorId: query.sectorId }),
        ...(query.customerId && { customerId: query.customerId }),
      };

      // Special where clause for productivity metrics - filter by finishedAt for completed tasks
      const productivityWhere = {
        finishedAt: dateFilter, // Filter by completion date, not creation date
        status: 'COMPLETED', // Only completed tasks
        ...(query.sectorId && { sectorId: query.sectorId }),
        ...(query.customerId && { customerId: query.customerId }),
      };

      // Get all production metrics in parallel
      const [
        taskOverview,
        serviceOrderMetrics,
        customerMetrics,
        garageUtilization,
        truckMetrics,
        cuttingOperations,
        airbrushingMetrics,
        revenueAnalysis,
        productivityMetrics,
      ] = await Promise.all([
        this.getProductionTaskOverview(baseWhere),
        query.includeServiceOrders
          ? this.getProductionServiceOrderMetrics(baseWhere)
          : this.getEmptyServiceOrderMetrics(),
        this.getProductionCustomerMetrics(query.customerId),
        this.getProductionGarageUtilization(query.garageId),
        query.includeTrucks ? this.getProductionTruckMetrics() : this.getEmptyTruckMetrics(),
        query.includeCuts
          ? this.getProductionCuttingOperations(baseWhere)
          : this.getEmptyCuttingMetrics(),
        query.includeAirbrush
          ? this.getProductionAirbrushingMetrics(baseWhere)
          : this.getEmptyAirbrushMetrics(),
        this.getProductionRevenueAnalysis(baseWhere),
        this.getProductionProductivityMetrics(productivityWhere, query.timePeriod), // Pass the special where clause with finishedAt and timePeriod
      ]);

      return {
        success: true,
        message: 'Dashboard de produção carregado com sucesso',
        data: {
          overview: taskOverview,
          serviceOrders: serviceOrderMetrics,
          customerMetrics,
          garageUtilization,
          truckMetrics,
          cuttingOperations,
          airbrushingMetrics,
          revenueAnalysis,
          productivityMetrics,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching production dashboard', error);
      throw error;
    }
  }

  async getUnifiedDashboard(
    query: UnifiedDashboardQueryFormData,
    userId: string,
  ): Promise<UnifiedDashboardResponse> {
    try {
      this.logger.log('Fetching unified dashboard data');

      const [inventory, hr, administration, paint, production] = await Promise.all([
        this.getInventoryHighlights(query),
        this.getHRHighlights(query),
        this.getAdministrationHighlights(query),
        this.getPaintHighlights(query),
        this.getProductionHighlights(query),
      ]);

      return {
        success: true,
        message: 'Dashboard unificado carregado com sucesso',
        data: {
          inventory,
          hr,
          administration,
          paint,
          production,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching unified dashboard', error);
      throw error;
    }
  }

  // Private helper methods for HR dashboard
  private async getEmployeeOverview(userWhere: DashboardUserWhere, dateFilter: DateFilter) {
    const stats = await this.dashboardRepository.getEmployeeStatistics(userWhere, dateFilter);
    const levelDistribution = await this.dashboardRepository.getEmployeesByPerformanceLevel(userWhere);

    return {
      totalEmployees: {
        label: 'Total de Funcionários',
        value: stats.total,
      },
      activeEmployees: {
        label: 'Funcionários Ativos',
        value: stats.active,
      },
      inactiveEmployees: {
        label: 'Funcionários Inativos',
        value: stats.inactive,
      },
      newHires: {
        label: 'Novas Contratações',
        value: stats.newHires,
      },
      employeesByPerformanceLevel: levelDistribution,
    };
  }

  private async getSectorAnalysis(userWhere: any) {
    const [bySector, byPosition, avgLevel] = await Promise.all([
      this.dashboardRepository.getEmployeesBySector(userWhere),
      this.dashboardRepository.getEmployeesByPosition(userWhere),
      this.dashboardRepository.getAveragePerformanceLevel(userWhere),
    ]);

    return {
      employeesBySector: bySector,
      employeesByPosition: byPosition,
      averagePositionLevel: {
        label: 'Nível Médio',
        value: avgLevel,
      },
    };
  }

  private async getVacationMetrics(dateFilter: DateFilter) {
    const metrics = await this.dashboardRepository.getVacationStatistics(dateFilter);

    return {
      onVacationNow: {
        label: 'Em Férias Agora',
        value: metrics.onVacationNow,
      },
      upcomingVacations: {
        label: 'Próximas Férias',
        value: metrics.upcoming,
      },
      approvedVacations: {
        label: 'Férias Aprovadas',
        value: metrics.approved,
      },
      vacationSchedule: metrics.schedule,
    };
  }



  // Additional HR dashboard helper methods
  private async getPositionMetrics(userWhere: DashboardUserWhere) {
    const [totalPositions, byPosition] = await Promise.all([
      this.dashboardRepository.countPositions(),
      this.dashboardRepository.getEmployeesByPosition(userWhere),
    ]);

    return {
      totalPositions,
      employeesByPosition: byPosition,
    };
  }

  private async getHolidayMetrics() {
    const [totalHolidays, upcomingHolidays] = await Promise.all([
      this.dashboardRepository.countHolidays(),
      this.dashboardRepository.countUpcomingHolidays(),
    ]);

    return {
      totalHolidays,
      upcomingHolidays,
    };
  }

  private async getNoticeMetrics(dateFilter: DateFilter) {
    const [totalNotices, activeNotices, newNotices] = await Promise.all([
      this.dashboardRepository.countWarnings(dateFilter),
      this.dashboardRepository.countActiveWarnings(),
      this.dashboardRepository.countNewWarnings(dateFilter),
    ]);

    return {
      totalNotices,
      activeNotices,
      newNotices,
    };
  }

  private async getPPEMetrics(dateFilter: DateFilter) {
    const [totalPPE, deliveriesToday, pendingDeliveries, deliveredThisMonth] = await Promise.all([
      this.dashboardRepository.countPPETypes(),
      this.dashboardRepository.countPPEDeliveriesToday(),
      this.dashboardRepository.countPendingPPEDeliveries(),
      this.dashboardRepository.countPPEDeliveriesThisMonth(dateFilter),
    ]);

    return {
      totalPPE,
      deliveriesToday,
      pendingDeliveries,
      deliveredThisMonth,
      deliveryTrend: 'stable' as const,
      deliveryPercent: 0,
    };
  }

  private async getSectorMetricsForHR() {
    const [totalSectors, employeesBySector] = await Promise.all([
      this.dashboardRepository.countSectors(),
      this.dashboardRepository.getEmployeeCountBySector(),
    ]);

    return {
      totalSectors,
      employeesBySector,
    };
  }

  private async getHRRecentActivities(dateFilter: DateFilter) {
    const activities = await this.dashboardRepository.getRecentHRActivities(dateFilter, 10);

    return activities.map(activity => ({
      id: activity.id,
      employeeName: activity.user?.name,
      entity: activity.entityType,
      action: activity.action,
      user: activity.user?.name || 'Sistema',
      type: activity.action,
      createdAt: activity.createdAt,
    }));
  }

  // Private helper methods for inventory dashboard
  private async getItemOverviewStats(itemWhere: any) {
    const [totalItems, itemStats] = await Promise.all([
      this.dashboardRepository.countItems(itemWhere),
      this.dashboardRepository.getItemStatistics(itemWhere),
    ]);

    return {
      totalItems: {
        label: 'Total de Itens',
        value: totalItems,
      },
      totalValue: {
        label: 'Valor Total',
        value: itemStats.totalValue,
        unit: 'R$',
      },
      criticalItems: {
        label: 'Estoque Crítico',
        value: itemStats.criticalItems,
      },
      lowStockItems: {
        label: 'Estoque Baixo',
        value: itemStats.lowStockItems,
      },
      overstockedItems: {
        label: 'Excesso de Estoque',
        value: itemStats.overstockedItems,
      },
      itemsNeedingReorder: {
        label: 'Reposição Necessária',
        value: itemStats.itemsNeedingReorder,
      },
    };
  }

  private async getActivityStats(dateFilter: DateFilter, itemWhere: any) {
    const activityWhere: DashboardActivityWhere = {
      createdAt: dateFilter,
      item: itemWhere,
    };
    const activities = await this.dashboardRepository.getActivityStatistics(activityWhere);

    return {
      totalInbound: {
        label: 'Entradas',
        value: activities.totalInbound,
      },
      totalOutbound: {
        label: 'Saídas',
        value: activities.totalOutbound,
      },
      movementsByReason: activities.movementsByReason,
      movementsByOperation: activities.movementsByOperation,
      recentActivities: activities.recentActivities,
    };
  }

  private async getTopItems(itemWhere: any) {
    const [byValue, byActivity, byLowStock] = await Promise.all([
      this.dashboardRepository.getTopItemsByValue(itemWhere, 10),
      this.dashboardRepository.getTopItemsByActivityCount(itemWhere, 10),
      this.dashboardRepository.getItemsByLowStockPercentage(itemWhere, 10),
    ]);

    return {
      byValue,
      byActivityCount: byActivity,
      byLowStockPercentage: byLowStock,
    };
  }

  private async getCategoryBreakdown(itemWhere: any) {
    const [byCategory, byBrand] = await Promise.all([
      this.dashboardRepository.getItemsByCategory(itemWhere),
      this.dashboardRepository.getItemsByBrand(itemWhere),
    ]);

    return {
      itemsByCategory: byCategory.items,
      valueByCategory: byCategory.value,
      itemsByBrand: byBrand,
    };
  }

  private async getSupplierMetrics(itemWhere: any, dateFilter: DateFilter) {
    const [itemsPerSupplier, orderCounts] = await Promise.all([
      this.dashboardRepository.getItemsPerSupplier(itemWhere),
      this.dashboardRepository.getOrderCounts({
        // Don't filter pending orders by date - show ALL pending orders
        // createdAt: dateFilter,
        supplier: itemWhere.supplierId ? { id: itemWhere.supplierId } : undefined,
      }),
    ]);

    return {
      itemsPerSupplier,
      pendingOrdersCount: orderCounts.pending,
      overdueOrdersCount: orderCounts.overdue,
    };
  }

  // Private helper methods for HR dashboard
  private async getTaskMetrics(userWhere: DashboardUserWhere, dateFilter: DateFilter) {
    const tasks = await this.dashboardRepository.getTaskStatistics(userWhere, dateFilter);
    const tasksInProgress = await this.dashboardRepository.countTasksInProgress();

    // Calculate productivity trend - simplified for now
    const productivityTrend = tasks.completed > tasks.averagePerUser * 7 ? 'up' :
                               tasks.completed < tasks.averagePerUser * 7 ? 'down' : 'stable';

    return {
      totalTasksCreated: {
        label: 'Tarefas Criadas',
        value: tasks.created,
      },
      tasksByStatus: tasks.byStatus,
      tasksCompleted: {
        label: 'Tarefas Concluídas',
        value: tasks.completed,
      },
      tasksInProgress: {
        label: 'Tarefas em Produção',
        value: tasksInProgress,
      },
      averageTasksPerUser: {
        label: 'Média por Usuário',
        value: tasks.averagePerUser,
      },
      taskProductivityTrend: productivityTrend as 'up' | 'down' | 'stable',
    };
  }

  // Private helper methods for administration dashboard
  private async getOrderOverview(supplierId: string | undefined, dateFilter: DateFilter) {
    const stats = await this.dashboardRepository.getOrderStatistics({
      ...(supplierId && { supplierId }),
      createdAt: dateFilter,
    });

    return {
      totalOrders: {
        label: 'Total de Pedidos',
        value: stats.total,
      },
      ordersByStatus: stats.byStatus,
      pendingOrders: {
        label: 'Pedidos Pendentes',
        value: stats.pending,
      },
      overdueOrders: {
        label: 'Pedidos Atrasados',
        value: stats.overdue,
      },
      ordersWithSchedule: {
        label: 'Pedidos Agendados',
        value: stats.withSchedule,
      },
    };
  }

  private async getNfeTracking() {
    const [ordersWithoutNfe, tasksWithoutNfe, counts] = await Promise.all([
      this.dashboardRepository.getOrdersWithoutNfe(10),
      this.dashboardRepository.getTasksWithoutNfe(10),
      this.dashboardRepository.getNfeCounts(),
    ]);

    return {
      ordersWithoutNfe,
      tasksWithoutNfe,
      ordersWithNfe: {
        label: 'Pedidos com NFe',
        value: counts.ordersWithNfe,
      },
      tasksWithNfe: {
        label: 'Tarefas com NFe',
        value: counts.tasksWithNfe,
      },
    };
  }

  private async getCustomerAnalysis(customerId?: string) {
    const stats = await this.dashboardRepository.getCustomerStatistics(customerId);

    return {
      totalCustomers: {
        label: 'Total de Clientes',
        value: stats.total,
      },
      customersByType: stats.byType,
      topCustomersByTasks: stats.topByTasks,
      customersByCity: stats.byCity,
      customersWithTags: {
        label: 'Clientes com Tags',
        value: stats.withTags,
      },
    };
  }

  private async getSupplierAnalysis(supplierId?: string) {
    const stats = await this.dashboardRepository.getSupplierStatistics(supplierId);

    return {
      totalSuppliers: {
        label: 'Total de Fornecedores',
        value: stats.total,
      },
      suppliersWithOrders: {
        label: 'Fornecedores Ativos',
        value: stats.withOrders,
      },
      ordersBySupplier: stats.topByOrders,
      suppliersByState: stats.byState,
    };
  }

  private async getTaskOverview(sectorId: string | undefined, dateFilter: DateFilter) {
    const stats = await this.dashboardRepository.getTaskOverviewStatistics({
      ...(sectorId && { sectorId }),
      createdAt: dateFilter,
    });

    return {
      totalTasks: {
        label: 'Total de Tarefas',
        value: stats.total,
      },
      tasksByStatus: stats.byStatus,
      tasksWithPrice: {
        label: 'Tarefas com Preço',
        value: stats.withPrice,
      },
      totalRevenue: {
        label: 'Receita Total',
        value: stats.totalRevenue,
        unit: 'R$',
      },
      tasksBySector: stats.bySector,
    };
  }

  private async getNotificationMetrics(dateFilter: DateFilter) {
    const stats = await this.dashboardRepository.getNotificationStatistics(dateFilter);

    return {
      totalNotifications: {
        label: 'Total de Notificações',
        value: stats.total,
      },
      notificationsByImportance: stats.byImportance,
      sentNotifications: {
        label: 'Notificações Enviadas',
        value: stats.sent,
      },
      notificationsByType: stats.byType,
    };
  }

  private async getUserMetrics(sectorId: string | undefined, dateFilter: DateFilter) {
    const userWhere: DashboardUserWhere = {
      ...(sectorId && { sectorId }),
    };
    const stats = await this.dashboardRepository.getUserStatistics(userWhere, dateFilter);

    // Calculate growth trend
    const previousPeriod = await this.dashboardRepository.getUserStatistics(userWhere, {
      gte: new Date(new Date().setMonth(new Date().getMonth() - 2)),
      lte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
    });

    const growthPercent =
      previousPeriod.total > 0
        ? ((stats.newUsersThisMonth - previousPeriod.newUsersThisMonth) /
            previousPeriod.newUsersThisMonth) *
          100
        : 0;

    return {
      totalUsers: {
        label: 'Total de Usuários',
        value: stats.total,
      },
      activeUsers: {
        label: 'Usuários Ativos',
        value: stats.active,
      },
      inactiveUsers: {
        label: 'Usuários Inativos',
        value: stats.inactive,
      },
      pendingUsers: {
        label: 'Usuários Pendentes',
        value: 0, // Can be calculated if there's a pending status
      },
      newUsersThisWeek: {
        label: 'Novos Usuários (Semana)',
        value: stats.newUsersThisWeek,
      },
      newUsersToday: {
        label: 'Novos Usuários (Hoje)',
        value: stats.newUsersToday,
      },
      userGrowthTrend:
        growthPercent > 5
          ? 'up'
          : growthPercent < -5
            ? 'down'
            : ('stable' as 'up' | 'down' | 'stable'),
      userGrowthPercent: Math.abs(growthPercent),
      monthlyGrowth: stats.monthlyGrowth,
    };
  }

  private async getSectorMetrics() {
    const stats = await this.dashboardRepository.getSectorStatistics();

    return {
      totalSectors: {
        label: 'Total de Setores',
        value: stats.total,
      },
      usersBySector: stats.usersBySector,
    };
  }

  private async getBudgetMetrics(dateFilter: DateFilter) {
    const stats = await this.dashboardRepository.getBudgetStatistics(dateFilter);

    // Calculate growth trend
    const previousPeriod = await this.dashboardRepository.getBudgetStatistics({
      gte: new Date(new Date().setMonth(new Date().getMonth() - 2)),
      lte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
    });

    const growthPercent =
      previousPeriod.total > 0
        ? ((stats.total - previousPeriod.total) / previousPeriod.total) * 100
        : 0;

    return {
      totalBudgets: {
        label: 'Total de Orçamentos',
        value: stats.total,
      },
      budgetGrowthTrend:
        growthPercent > 5
          ? 'up'
          : growthPercent < -5
            ? 'down'
            : ('stable' as 'up' | 'down' | 'stable'),
      budgetGrowthPercent: Math.abs(growthPercent),
    };
  }

  private async getFileMetrics() {
    const stats = await this.dashboardRepository.getFileStatistics();

    return {
      totalFiles: {
        label: 'Total de Arquivos',
        value: stats.total,
      },
      fileTypeDistribution: stats.typeDistribution || [],
    };
  }

  private async getTaskOverviewMetrics(sectorId: string | undefined, dateFilter: DateFilter) {
    const userWhere: DashboardUserWhere = {
      ...(sectorId && { sectorId }),
    };

    const taskStats = await this.dashboardRepository.getTaskStatistics(userWhere, dateFilter);
    const tasksInProgress = await this.dashboardRepository.countTasksInProgress();

    return {
      totalTasks: {
        label: 'Total de Tarefas',
        value: taskStats.created,
        trend: 'stable' as 'up' | 'down' | 'stable',
        changePercent: 0,
      },
      tasksInProgress: {
        label: 'Em Produção',
        value: tasksInProgress,
      },
      tasksCompleted: {
        label: 'Concluídas',
        value: taskStats.completed,
      },
      tasksByStatus: taskStats.byStatus,
      tasksBySector: taskStats.byStatus, // Can be enhanced with sector-specific data
      averageTasksPerUser: {
        label: 'Média por Usuário',
        value: taskStats.averagePerUser,
      },
    };
  }

  private async getUserActivity() {
    const stats = await this.dashboardRepository.getUserActivityByRole();
    const byPosition = await this.dashboardRepository.getEmployeesByPosition();
    const bySector = await this.dashboardRepository.getEmployeesBySector();

    return {
      byRole: stats.byRole,
      byPosition: byPosition,
      bySector: bySector,
    };
  }

  private async getRecentActivities(dateFilter: DateFilter) {
    const changeLogs = await this.dashboardRepository.getRecentChangeLogs(dateFilter, 10);

    return changeLogs.map(log => ({
      id: log.id,
      title: this.formatChangeLogTitle(log.entityType, log.action),
      description: log.reason || this.formatChangeLogDescription(log),
      icon: this.getChangeLogIcon(log.entityType),
      type: log.action,
      timestamp: log.createdAt,
    }));
  }

  private formatChangeLogTitle(entityType: string, action: string): string {
    const entityLabels: Record<string, string> = {
      USER: 'Usuário',
      TASK: 'Tarefa',
      ORDER: 'Pedido',
      CUSTOMER: 'Cliente',
      ITEM: 'Item',
      COMMISSION: 'Comissão',
      // Add more as needed
    };

    const actionLabels: Record<string, string> = {
      CREATE: 'criado',
      UPDATE: 'atualizado',
      DELETE: 'removido',
      APPROVE: 'aprovado',
      REJECT: 'rejeitado',
      // Add more as needed
    };

    return `${entityLabels[entityType] || entityType} ${actionLabels[action] || action}`;
  }

  private formatChangeLogDescription(log: any): string {
    if (log.field) {
      return `Campo ${log.field} alterado`;
    }
    return `${log.entityType} ${log.action}`;
  }

  private getChangeLogIcon(entityType: string): string {
    const iconMap: Record<string, string> = {
      USER: 'Users',
      TASK: 'ClipboardList',
      ORDER: 'ShoppingCart',
      CUSTOMER: 'UserCircle',
      ITEM: 'Package',
      COMMISSION: 'DollarSign',
      // Add more as needed
    };

    return iconMap[entityType] || 'Activity';
  }

  // Private helper methods for unified dashboard
  private async getInventoryHighlights(query: UnifiedDashboardQueryFormData) {
    const itemWhere = { isActive: true };
    const [overview, alerts] = await Promise.all([
      this.getItemOverviewStats(itemWhere),
      this.dashboardRepository.getInventoryAlerts(5),
    ]);

    return {
      overview,
      criticalAlerts: alerts,
    };
  }

  private async getHRHighlights(query: UnifiedDashboardQueryFormData) {
    const now = new Date();
    const [employeeStats, vacationsToday, tasksInProgress] = await Promise.all([
      this.dashboardRepository.getEmployeeStatistics({ status: { in: [...ACTIVE_USER_STATUSES] } }, {}),
      this.dashboardRepository.countVacationsOnDate(now),
      this.dashboardRepository.countTasksInProgress(),
    ]);

    return {
      overview: {
        totalEmployees: {
          label: 'Total de Funcionários',
          value: employeeStats.total,
        },
        activeEmployees: {
          label: 'Funcionários Ativos',
          value: employeeStats.active,
        },
      },
      vacationsToday,
      tasksInProgress,
    };
  }

  private async getAdministrationHighlights(query: UnifiedDashboardQueryFormData) {
    const [orderStats, revenue, missingNfe] = await Promise.all([
      this.dashboardRepository.getOrderStatistics({}),
      this.dashboardRepository.getTotalRevenue(),
      this.dashboardRepository.countMissingNfe(),
    ]);

    return {
      orderSummary: {
        totalOrders: {
          label: 'Total de Pedidos',
          value: orderStats.total,
        },
        pendingOrders: {
          label: 'Pedidos Pendentes',
          value: orderStats.pending,
        },
        overdueOrders: {
          label: 'Pedidos Atrasados',
          value: orderStats.overdue,
        },
      },
      revenue,
      missingNfe,
    };
  }

  private async getPaintHighlights(query: UnifiedDashboardQueryFormData) {
    const dateFilter = this.getDateFilter(query);
    const baseWhere: any = {};
    if (dateFilter.gte || dateFilter.lte) {
      baseWhere.createdAt = dateFilter;
    }

    const [productionStats, formulaCount] = await Promise.all([
      this.dashboardRepository.getProductionOverview(baseWhere),
      this.dashboardRepository.countActiveFormulas(),
    ]);

    return {
      productionSummary: {
        totalProductions: productionStats.totalProductions,
        totalVolumeLiters: productionStats.totalVolumeLiters,
      },
      activeFormulas: formulaCount,
    };
  }

  // Private helper methods for production dashboard
  private async getProductionTaskOverview(baseWhere: any) {
    const stats = await this.dashboardRepository.getProductionTaskOverview(baseWhere);

    return {
      totalTasks: {
        label: 'Total de Tarefas',
        value: stats.total,
      },
      tasksInProduction: {
        label: 'Em Produção',
        value: stats.inProduction,
      },
      tasksCompleted: {
        label: 'Concluídas',
        value: stats.completed,
      },
      tasksCancelled: {
        label: 'Canceladas',
        value: stats.cancelled,
      },
      tasksOnHold: {
        label: 'Em Pausa',
        value: stats.onHold,
      },
      averageCompletionTime: {
        label: 'Tempo Médio de Conclusão',
        value: stats.averageCompletionHours,
        unit: 'h',
      },
    };
  }

  private async getProductionServiceOrderMetrics(baseWhere: any) {
    const stats = await this.dashboardRepository.getServiceOrderStatistics(baseWhere);

    return {
      totalServiceOrders: {
        label: 'Total de Ordens de Serviço',
        value: stats.total,
      },
      pendingServiceOrders: {
        label: 'Ordens Pendentes',
        value: stats.pending,
      },
      completedServiceOrders: {
        label: 'Ordens Concluídas',
        value: stats.completed,
      },
      serviceOrdersByType: stats.byType,
      byService: stats.byService, // Add service distribution data
      averageServicesPerOrder: {
        label: 'Média de Serviços por Ordem',
        value: stats.averageServicesPerOrder,
      },
    };
  }

  private async getProductionCustomerMetrics(customerId?: string) {
    const stats = await this.dashboardRepository.getProductionCustomerMetrics({ customerId });

    return {
      activeCustomers: {
        label: 'Clientes Ativos',
        value: stats.activeCustomers,
      },
      topCustomersByTasks: stats.topByTasks,
      topCustomersByRevenue: stats.topByRevenue,
      customersByType: stats.byType,
      customersByCity: stats.byCity,
    };
  }

  private async getProductionGarageUtilization(garageId?: string) {
    const stats = await this.dashboardRepository.getGarageUtilizationMetrics(garageId);
    const utilizationRate =
      stats.totalParkingSpots > 0 ? (stats.occupiedSpots / stats.totalParkingSpots) * 100 : 0;

    return {
      totalGarages: {
        label: 'Total de Garagens',
        value: stats.totalGarages,
      },
      totalLanes: {
        label: 'Total de Pistas',
        value: stats.totalLanes,
      },
      totalParkingSpots: {
        label: 'Total de Vagas',
        value: stats.totalParkingSpots,
      },
      occupiedSpots: {
        label: 'Vagas Ocupadas',
        value: stats.occupiedSpots,
      },
      utilizationRate: {
        label: 'Taxa de Utilização',
        value: utilizationRate,
        unit: '%',
      },
      spotsByGarage: stats.spotsByGarage,
    };
  }

  private async getProductionTruckMetrics() {
    const stats = await this.dashboardRepository.getTruckMetrics();

    return {
      totalTrucks: {
        label: 'Total de Caminhões',
        value: stats.total,
      },
      trucksInProduction: {
        label: 'Em Produção',
        value: stats.inProduction,
      },
      trucksByManufacturer: stats.byManufacturer,
      trucksByPosition: stats.byPosition,
    };
  }

  private async getProductionCuttingOperations(baseWhere: any) {
    const stats = await this.dashboardRepository.getCuttingOperationMetrics(baseWhere);

    return {
      totalCuts: {
        label: 'Total de Cortes',
        value: stats.totalCuts,
      },
      pendingCuts: {
        label: 'Cortes Pendentes',
        value: stats.pendingCuts,
      },
      completedCuts: {
        label: 'Cortes Concluídos',
        value: stats.completedCuts,
      },
      cutsByType: stats.byType,
      averageCutTime: {
        label: 'Tempo Médio de Corte',
        value: stats.averageCutTimeHours,
        unit: 'h',
      },
    };
  }

  private async getProductionAirbrushingMetrics(baseWhere: any) {
    const stats = await this.dashboardRepository.getAirbrushingMetrics(baseWhere);

    return {
      totalAirbrushJobs: {
        label: 'Total de Trabalhos de Aerógrafo',
        value: stats.totalJobs,
      },
      pendingAirbrushJobs: {
        label: 'Trabalhos Pendentes',
        value: stats.pendingJobs,
      },
      completedAirbrushJobs: {
        label: 'Trabalhos Concluídos',
        value: stats.completedJobs,
      },
      airbrushByType: stats.byType,
      averageAirbrushTime: {
        label: 'Tempo Médio de Aerógrafo',
        value: stats.averageTimeHours,
        unit: 'h',
      },
    };
  }

  private async getProductionRevenueAnalysis(baseWhere: any) {
    const stats = await this.dashboardRepository.getProductionRevenueAnalysis(baseWhere);

    return {
      totalRevenue: {
        label: 'Receita Total',
        value: stats.totalRevenue,
        unit: 'R$',
      },
      averageTaskValue: {
        label: 'Valor Médio por Tarefa',
        value: stats.averageTaskValue,
        unit: 'R$',
      },
      revenueByMonth: stats.byMonth,
      revenueBySector: stats.bySector,
      revenueByCustomerType: stats.byCustomerType,
    };
  }

  private async getProductionProductivityMetrics(baseWhere: any, timePeriod?: string) {
    const stats = await this.dashboardRepository.getProductionProductivityMetrics(
      baseWhere,
      timePeriod,
    );

    return {
      tasksPerDay: {
        label: 'Tarefas por Dia',
        value: stats.tasksPerDay,
      },
      averageTasksPerUser: {
        label: 'Média de Tarefas por Usuário',
        value: stats.averageTasksPerUser,
      },
      tasksBySector: stats.tasksBySector,
      tasksByShift: stats.tasksByShift,
      efficiency: {
        label: 'Eficiência',
        value: stats.efficiency,
        unit: '%',
      },
    };
  }

  // Empty metrics methods for when features are disabled
  private getEmptyServiceOrderMetrics() {
    return {
      totalServiceOrders: { label: 'Total de Ordens de Serviço', value: 0 },
      pendingServiceOrders: { label: 'Ordens Pendentes', value: 0 },
      completedServiceOrders: { label: 'Ordens Concluídas', value: 0 },
      serviceOrdersByType: { labels: [], datasets: [] },
      byService: [], // Add the missing byService field
      averageServicesPerOrder: { label: 'Média de Serviços por Ordem', value: 0 },
    };
  }

  private getEmptyTruckMetrics() {
    return {
      totalTrucks: { label: 'Total de Caminhões', value: 0 },
      trucksInProduction: { label: 'Em Produção', value: 0 },
      trucksByManufacturer: { labels: [], datasets: [] },
      trucksByPosition: [],
    };
  }

  private getEmptyCuttingMetrics() {
    return {
      totalCuts: { label: 'Total de Cortes', value: 0 },
      pendingCuts: { label: 'Cortes Pendentes', value: 0 },
      completedCuts: { label: 'Cortes Concluídos', value: 0 },
      cutsByType: { labels: [], datasets: [] },
      averageCutTime: { label: 'Tempo Médio de Corte', value: 0, unit: 'h' },
    };
  }

  private getEmptyAirbrushMetrics() {
    return {
      totalAirbrushJobs: { label: 'Total de Trabalhos de Aerógrafo', value: 0 },
      pendingAirbrushJobs: { label: 'Trabalhos Pendentes', value: 0 },
      completedAirbrushJobs: { label: 'Trabalhos Concluídos', value: 0 },
      airbrushByType: { labels: [], datasets: [] },
      averageAirbrushTime: { label: 'Tempo Médio de Aerógrafo', value: 0, unit: 'h' },
    };
  }

  private async getProductionHighlights(query: UnifiedDashboardQueryFormData) {
    const dateFilter = this.getDateFilter(query);
    const baseWhere: any = {};
    if (dateFilter.gte || dateFilter.lte) {
      baseWhere.createdAt = dateFilter;
    }

    const [taskStats, garageStats, serviceOrderCount] = await Promise.all([
      this.dashboardRepository.getProductionTaskOverview(baseWhere),
      this.dashboardRepository.getGarageUtilizationMetrics(),
      this.dashboardRepository.getServiceOrderStatistics(baseWhere),
    ]);

    const garageUtilization =
      garageStats.totalParkingSpots > 0
        ? (garageStats.occupiedSpots / garageStats.totalParkingSpots) * 100
        : 0;

    return {
      taskSummary: {
        totalTasks: {
          label: 'Total de Tarefas',
          value: taskStats.total,
        },
        tasksInProduction: {
          label: 'Em Produção',
          value: taskStats.inProduction,
        },
        tasksCompleted: {
          label: 'Concluídas',
          value: taskStats.completed,
        },
      },
      garageUtilization: garageUtilization,
      activeServiceOrders: serviceOrderCount.pending,
    };
  }
}
