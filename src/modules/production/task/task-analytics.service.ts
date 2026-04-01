import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TASK_STATUS, CUT_ORIGIN } from '../../../constants/enums';

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const DAY_MS = 1000 * 60 * 60 * 24;

function diffDays(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES_PT[parseInt(month, 10) - 1]} ${year}`;
}

function weekKey(date: Date): string {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((date.getTime() - startOfYear.getTime()) / DAY_MS + startOfYear.getDay() + 1) / 7,
  );
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

interface PeriodRange {
  start: Date;
  end: Date;
}

interface AnalyticsFilters {
  sectorIds?: string[];
  customerIds?: string[];
  periods?: PeriodRange[];
  startDate?: Date;
  endDate?: Date;
  groupBy?: string;
}

interface RevenueFilters extends AnalyticsFilters {
  groupBy?: 'month' | 'sector' | 'customer';
}

@Injectable()
export class TaskAnalyticsService {
  private readonly logger = new Logger(TaskAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // 1. Throughput Analytics
  // ---------------------------------------------------------------------------

  async getThroughputAnalytics(filters: AnalyticsFilters) {
    const { sectorIds, startDate, endDate, periods, groupBy = 'month' } = filters;

    const dateRange = this.resolveDateRange(filters);
    const isComparisonBySector = sectorIds && sectorIds.length >= 2;
    const isComparisonByPeriod = periods && periods.length >= 2;

    const baseWhere: any = {
      status: TASK_STATUS.COMPLETED,
      cleared: false,
      ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
    };

    // Fetch completed tasks within the date range
    const completedTasks = await this.prisma.task.findMany({
      where: {
        ...baseWhere,
        finishedAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      select: {
        id: true,
        entryDate: true,
        finishedAt: true,
        forecastDate: true,
        sectorId: true,
        startedAt: true,
      },
    });

    // Fetch planned tasks (forecastDate in range, any status)
    const plannedTasks = await this.prisma.task.findMany({
      where: {
        cleared: false,
        ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
        forecastDate: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        status: { not: TASK_STATUS.CANCELLED },
      },
      select: {
        id: true,
        forecastDate: true,
        sectorId: true,
      },
    });

    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    // Build period buckets
    const completedByPeriod = new Map<string, typeof completedTasks>();
    for (const task of completedTasks) {
      const key = keyFn(task.finishedAt!);
      if (!completedByPeriod.has(key)) completedByPeriod.set(key, []);
      completedByPeriod.get(key)!.push(task);
    }

    const plannedByPeriod = new Map<string, typeof plannedTasks>();
    for (const task of plannedTasks) {
      const key = keyFn(task.forecastDate!);
      if (!plannedByPeriod.has(key)) plannedByPeriod.set(key, []);
      plannedByPeriod.get(key)!.push(task);
    }

    const allKeys = new Set([...completedByPeriod.keys(), ...plannedByPeriod.keys()]);
    const sortedKeys = Array.from(allKeys).sort();

    const items = sortedKeys.map((key) => {
      const completed = completedByPeriod.get(key) || [];
      const planned = plannedByPeriod.get(key) || [];

      const completionDays = completed
        .filter((t) => t.entryDate && t.finishedAt)
        .map((t) => diffDays(t.entryDate!, t.finishedAt!));

      const avgCompletionDays =
        completionDays.length > 0
          ? Math.round(
              (completionDays.reduce((a, b) => a + b, 0) / completionDays.length) * 10,
            ) / 10
          : 0;

      const onTime = completed.filter(
        (t) => t.forecastDate && t.finishedAt && t.finishedAt <= t.forecastDate,
      ).length;

      const forecastAccuracy =
        completed.length > 0 ? Math.round((onTime / completed.length) * 1000) / 10 : 0;

      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        completedCount: completed.length,
        plannedCount: planned.length,
        avgCompletionDays,
        forecastAccuracy,
      };
    });

    // Summary
    const allCompletionDays = completedTasks
      .filter((t) => t.entryDate && t.finishedAt)
      .map((t) => diffDays(t.entryDate!, t.finishedAt!));

    const totalCompleted = completedTasks.length;
    const avgCompletionDays =
      allCompletionDays.length > 0
        ? Math.round(
            (allCompletionDays.reduce((a, b) => a + b, 0) / allCompletionDays.length) * 10,
          ) / 10
        : 0;

    const totalOnTime = completedTasks.filter(
      (t) => t.forecastDate && t.finishedAt && t.finishedAt <= t.forecastDate,
    ).length;
    const onTimeDeliveryRate =
      totalCompleted > 0 ? Math.round((totalOnTime / totalCompleted) * 1000) / 10 : 0;

    const totalWeeks = Math.max(1, diffDays(dateRange.start, dateRange.end) / 7);
    const tasksPerWeek = Math.round((totalCompleted / totalWeeks) * 10) / 10;

    const result: any = {
      items,
      summary: {
        totalCompleted,
        avgCompletionDays,
        onTimeDeliveryRate,
        tasksPerWeek,
      },
    };

    // Comparison by sector
    if (isComparisonBySector) {
      const sectors = await this.prisma.sector.findMany({
        where: { id: { in: sectorIds } },
        select: { id: true, name: true },
      });

      const sectorMap = new Map(sectors.map((s) => [s.id, s.name]));

      result.comparison = sectorIds.map((sectorId) => {
        const sectorTasks = completedTasks.filter((t) => t.sectorId === sectorId);
        const sectorPlanned = plannedTasks.filter((t) => t.sectorId === sectorId);

        const days = sectorTasks
          .filter((t) => t.entryDate && t.finishedAt)
          .map((t) => diffDays(t.entryDate!, t.finishedAt!));

        const avg = days.length > 0
          ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10
          : 0;

        const onTime = sectorTasks.filter(
          (t) => t.forecastDate && t.finishedAt && t.finishedAt <= t.forecastDate,
        ).length;

        return {
          sectorId,
          sectorName: sectorMap.get(sectorId) || sectorId,
          totalCompleted: sectorTasks.length,
          totalPlanned: sectorPlanned.length,
          avgCompletionDays: avg,
          onTimeDeliveryRate:
            sectorTasks.length > 0
              ? Math.round((onTime / sectorTasks.length) * 1000) / 10
              : 0,
        };
      });
    }

    // Comparison by period
    if (isComparisonByPeriod) {
      result.periodComparison = await Promise.all(
        periods.map(async (period) => {
          const periodTasks = completedTasks.filter(
            (t) => t.finishedAt && t.finishedAt >= period.start && t.finishedAt <= period.end,
          );

          const days = periodTasks
            .filter((t) => t.entryDate && t.finishedAt)
            .map((t) => diffDays(t.entryDate!, t.finishedAt!));

          const avg = days.length > 0
            ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10
            : 0;

          const onTime = periodTasks.filter(
            (t) => t.forecastDate && t.finishedAt && t.finishedAt <= t.forecastDate,
          ).length;

          return {
            start: period.start,
            end: period.end,
            label: `${monthLabel(monthKey(period.start))} - ${monthLabel(monthKey(period.end))}`,
            totalCompleted: periodTasks.length,
            avgCompletionDays: avg,
            onTimeDeliveryRate:
              periodTasks.length > 0
                ? Math.round((onTime / periodTasks.length) * 1000) / 10
                : 0,
          };
        }),
      );
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // 2. Bottleneck Analytics
  // ---------------------------------------------------------------------------

  async getBottleneckAnalytics(filters: AnalyticsFilters) {
    const { sectorIds, startDate, endDate } = filters;
    const now = new Date();

    const baseWhere: any = {
      cleared: false,
      status: {
        in: [
          TASK_STATUS.PREPARATION,
          TASK_STATUS.WAITING_PRODUCTION,
          TASK_STATUS.IN_PRODUCTION,
        ],
      },
      ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
    };

    // Stage distribution: current active tasks grouped by status
    const activeTasks = await this.prisma.task.findMany({
      where: baseWhere,
      select: {
        id: true,
        status: true,
        entryDate: true,
        startedAt: true,
        createdAt: true,
      },
    });

    const stageDistribution = [
      TASK_STATUS.PREPARATION,
      TASK_STATUS.WAITING_PRODUCTION,
      TASK_STATUS.IN_PRODUCTION,
    ].map((status) => {
      const tasksInStage = activeTasks.filter((t) => t.status === status);

      const daysInStage = tasksInStage.map((t) => {
        switch (status) {
          case TASK_STATUS.IN_PRODUCTION:
            return t.startedAt ? diffDays(t.startedAt, now) : 0;
          case TASK_STATUS.WAITING_PRODUCTION:
            return diffDays(t.entryDate || t.createdAt, now);
          case TASK_STATUS.PREPARATION:
            return diffDays(t.createdAt, now);
          default:
            return 0;
        }
      });

      const avgDays =
        daysInStage.length > 0
          ? Math.round(
              (daysInStage.reduce((a, b) => a + b, 0) / daysInStage.length) * 10,
            ) / 10
          : 0;

      const stageLabels: Record<string, string> = {
        PREPARATION: 'Preparação',
        WAITING_PRODUCTION: 'Aguardando Produção',
        IN_PRODUCTION: 'Em Produção',
      };

      return {
        stage: status,
        stageLabel: stageLabels[status] || status,
        count: tasksInStage.length,
        avgDays: avgDays,
      };
    });

    // Garage utilization: trucks with active tasks occupying spots
    const trucksInGarage = await this.prisma.truck.findMany({
      where: {
        spot: { not: null },
        task: {
          cleared: false,
          entryDate: { not: null },
          status: {
            in: [
              TASK_STATUS.PREPARATION,
              TASK_STATUS.WAITING_PRODUCTION,
              TASK_STATUS.IN_PRODUCTION,
            ],
          },
          ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
        },
      },
      select: {
        id: true,
        spot: true,
      },
    });

    const spotPrefixes = ['B1', 'B2', 'B3', 'YARD'];
    const spotCapacities: Record<string, number> = {
      B1: 9,
      B2: 9,
      B3: 9,
      YARD: 2,
    };

    const garageUtilization = spotPrefixes.map((prefix) => {
      const trucksInArea = trucksInGarage.filter((t) => {
        if (!t.spot) return false;
        if (prefix === 'YARD') return t.spot.startsWith('YARD');
        return t.spot.startsWith(`${prefix}_`);
      });

      const capacity = spotCapacities[prefix];

      return {
        period: prefix,
        periodLabel: prefix === 'YARD' ? 'Pátio' : `Barracão ${prefix.replace('B', '')}`,
        occupiedSpots: trucksInArea.length,
        totalSpots: capacity,
        utilizationPercent:
          capacity > 0 ? Math.round((trucksInArea.length / capacity) * 1000) / 10 : 0,
      };
    });

    // Recut trend: monthly cut vs recut rates
    const dateRange = this.resolveDateRange(filters);

    const cuts = await this.prisma.cut.findMany({
      where: {
        task: {
          cleared: false,
          ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
        },
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      select: {
        id: true,
        origin: true,
        parentCutId: true,
        createdAt: true,
      },
    });

    const cutsByMonth = new Map<string, { total: number; recuts: number }>();

    for (const cut of cuts) {
      const key = monthKey(cut.createdAt);
      if (!cutsByMonth.has(key)) cutsByMonth.set(key, { total: 0, recuts: 0 });
      const bucket = cutsByMonth.get(key)!;
      bucket.total++;

      const isRecut = cut.parentCutId !== null || cut.origin === CUT_ORIGIN.REQUEST;
      if (isRecut) bucket.recuts++;
    }

    const recutTrend = Array.from(cutsByMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => ({
        period: key,
        periodLabel: monthLabel(key),
        totalCuts: data.total,
        recuts: data.recuts,
        recutRate:
          data.total > 0 ? Math.round((data.recuts / data.total) * 1000) / 10 : 0,
      }));

    // Summary
    const totalOccupied = garageUtilization.reduce((sum, g) => sum + g.occupiedSpots, 0);
    const totalCapacity = garageUtilization.reduce((sum, g) => sum + g.totalSpots, 0);
    const currentUtilization =
      totalCapacity > 0
        ? Math.round((totalOccupied / totalCapacity) * 1000) / 10
        : 0;

    const waitingTasks = stageDistribution.find(
      (s) => s.stage === TASK_STATUS.WAITING_PRODUCTION,
    );
    const avgQueueDays = waitingTasks?.avgDays || 0;

    const bottleneckStage = stageDistribution.reduce((max, s) =>
      s.count > max.count ? s : max,
    );

    const totalCuts = cuts.length;
    const totalRecuts = cuts.filter(
      (c) => c.parentCutId !== null || c.origin === CUT_ORIGIN.REQUEST,
    ).length;
    const recutRate =
      totalCuts > 0 ? Math.round((totalRecuts / totalCuts) * 1000) / 10 : 0;

    return {
      stageDistribution,
      garageUtilization,
      recutTrend,
      summary: {
        currentUtilization,
        avgQueueDays,
        bottleneckStage: bottleneckStage.stageLabel,
        recutRate,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Revenue Analytics
  // ---------------------------------------------------------------------------

  async getRevenueAnalytics(filters: RevenueFilters) {
    const { sectorIds, customerIds, periods, groupBy = 'month' } = filters;

    const dateRange = this.resolveDateRange(filters);
    const isComparisonBySector = sectorIds && sectorIds.length >= 2;
    const isComparisonByPeriod = periods && periods.length >= 2;

    const completedTasks = await this.prisma.task.findMany({
      where: {
        status: TASK_STATUS.COMPLETED,
        cleared: false,
        finishedAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
        ...(customerIds?.length && { customerId: { in: customerIds } }),
      },
      select: {
        id: true,
        finishedAt: true,
        sectorId: true,
        customerId: true,
        quote: {
          select: {
            total: true,
          },
        },
        customer: {
          select: {
            id: true,
            fantasyName: true,
          },
        },
        sector: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Filter tasks that have a quote with a total
    const tasksWithRevenue = completedTasks.filter((t) => t.quote?.total != null);

    let items: any[];

    if (groupBy === 'sector') {
      const bySector = new Map<string, { name: string; revenue: number; count: number }>();

      for (const task of tasksWithRevenue) {
        const sectorId = task.sectorId;
        if (!sectorId) continue;
        const existing = bySector.get(sectorId) || {
          name: task.sector?.name || sectorId,
          revenue: 0,
          count: 0,
        };
        existing.revenue += Number(task.quote!.total);
        existing.count++;
        bySector.set(sectorId, existing);
      }

      items = Array.from(bySector.entries()).map(([sectorId, data]) => ({
        id: sectorId,
        name: data.name,
        revenue: Math.round(data.revenue * 100) / 100,
        taskCount: data.count,
        avgValue:
          data.count > 0 ? Math.round((data.revenue / data.count) * 100) / 100 : 0,
      }));
    } else if (groupBy === 'customer') {
      const byCustomer = new Map<string, { name: string; revenue: number; count: number }>();

      for (const task of tasksWithRevenue) {
        const customerId = task.customerId;
        if (!customerId) continue;
        const existing = byCustomer.get(customerId) || {
          name: task.customer?.fantasyName || customerId,
          revenue: 0,
          count: 0,
        };
        existing.revenue += Number(task.quote!.total);
        existing.count++;
        byCustomer.set(customerId, existing);
      }

      items = Array.from(byCustomer.entries())
        .map(([customerId, data]) => ({
          id: customerId,
          name: data.name,
          revenue: Math.round(data.revenue * 100) / 100,
          taskCount: data.count,
          avgValue:
            data.count > 0 ? Math.round((data.revenue / data.count) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);
    } else {
      // Default: group by month
      const byMonth = new Map<string, { revenue: number; count: number }>();

      for (const task of tasksWithRevenue) {
        const key = monthKey(task.finishedAt!);
        const existing = byMonth.get(key) || { revenue: 0, count: 0 };
        existing.revenue += Number(task.quote!.total);
        existing.count++;
        byMonth.set(key, existing);
      }

      const sortedKeys = Array.from(byMonth.keys()).sort();

      items = sortedKeys.map((key) => {
        const data = byMonth.get(key)!;
        return {
          id: key,
          name: monthLabel(key),
          revenue: Math.round(data.revenue * 100) / 100,
          taskCount: data.count,
          avgValue:
            data.count > 0 ? Math.round((data.revenue / data.count) * 100) / 100 : 0,
        };
      });
    }

    // Summary
    const totalRevenue =
      Math.round(
        tasksWithRevenue.reduce((sum, t) => sum + Number(t.quote!.total), 0) * 100,
      ) / 100;

    const avgTaskValue =
      tasksWithRevenue.length > 0
        ? Math.round((totalRevenue / tasksWithRevenue.length) * 100) / 100
        : 0;

    // Month-over-month growth
    const revenueByMonth = new Map<string, number>();
    for (const task of tasksWithRevenue) {
      const key = monthKey(task.finishedAt!);
      revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + Number(task.quote!.total));
    }
    const sortedMonths = Array.from(revenueByMonth.keys()).sort();
    let monthOverMonthGrowth = 0;
    if (sortedMonths.length >= 2) {
      const lastMonth = revenueByMonth.get(sortedMonths[sortedMonths.length - 1])!;
      const prevMonth = revenueByMonth.get(sortedMonths[sortedMonths.length - 2])!;
      if (prevMonth > 0) {
        monthOverMonthGrowth =
          Math.round(((lastMonth - prevMonth) / prevMonth) * 1000) / 10;
      }
    }

    // Top customer
    const customerRevenue = new Map<string, { name: string; revenue: number }>();
    for (const task of tasksWithRevenue) {
      if (!task.customerId || !task.customer) continue;
      const existing = customerRevenue.get(task.customerId) || {
        name: task.customer.fantasyName,
        revenue: 0,
      };
      existing.revenue += Number(task.quote!.total);
      customerRevenue.set(task.customerId, existing);
    }

    let topCustomer: string | null = null;
    let topCustomerRevenue = 0;
    for (const [, data] of customerRevenue) {
      if (data.revenue > topCustomerRevenue) {
        topCustomer = data.name;
        topCustomerRevenue = data.revenue;
      }
    }

    const result: any = {
      items,
      summary: {
        totalRevenue,
        avgTaskValue,
        monthOverMonthGrowth,
        topCustomer,
      },
    };

    // Comparison by sector
    if (isComparisonBySector) {
      const sectors = await this.prisma.sector.findMany({
        where: { id: { in: sectorIds } },
        select: { id: true, name: true },
      });
      const sectorMap = new Map(sectors.map((s) => [s.id, s.name]));

      result.comparison = sectorIds.map((sectorId) => {
        const sectorTasks = tasksWithRevenue.filter((t) => t.sectorId === sectorId);
        const revenue =
          Math.round(
            sectorTasks.reduce((sum, t) => sum + Number(t.quote!.total), 0) * 100,
          ) / 100;

        return {
          sectorId,
          sectorName: sectorMap.get(sectorId) || sectorId,
          totalRevenue: revenue,
          taskCount: sectorTasks.length,
          avgTaskValue:
            sectorTasks.length > 0
              ? Math.round((revenue / sectorTasks.length) * 100) / 100
              : 0,
        };
      });
    }

    // Comparison by period
    if (isComparisonByPeriod) {
      result.periodComparison = periods.map((period) => {
        const periodTasks = tasksWithRevenue.filter(
          (t) =>
            t.finishedAt &&
            t.finishedAt >= period.start &&
            t.finishedAt <= period.end,
        );
        const revenue =
          Math.round(
            periodTasks.reduce((sum, t) => sum + Number(t.quote!.total), 0) * 100,
          ) / 100;

        return {
          start: period.start,
          end: period.end,
          label: `${monthLabel(monthKey(period.start))} - ${monthLabel(monthKey(period.end))}`,
          totalRevenue: revenue,
          taskCount: periodTasks.length,
          avgTaskValue:
            periodTasks.length > 0
              ? Math.round((revenue / periodTasks.length) * 100) / 100
              : 0,
        };
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveDateRange(filters: AnalyticsFilters): { start: Date; end: Date } {
    if (filters.periods && filters.periods.length > 0) {
      // Use the full span across all periods
      const starts = filters.periods.map((p) => p.start.getTime());
      const ends = filters.periods.map((p) => p.end.getTime());
      return {
        start: new Date(Math.min(...starts)),
        end: new Date(Math.max(...ends)),
      };
    }

    if (filters.startDate && filters.endDate) {
      return { start: filters.startDate, end: filters.endDate };
    }

    // Default: last 12 months
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    return { start, end };
  }
}
