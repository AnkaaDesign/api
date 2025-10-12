import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ProductionTasksOverview,
  CompletionRates,
  CycleTimeAnalysis,
  BottleneckAnalysis,
  SectorPerformance,
  PaintUsageStatistics,
} from '../interfaces/statistics.interface';
import {
  ProductionTasksOverviewQueryDto,
  CompletionRatesQueryDto,
  CycleTimeAnalysisQueryDto,
  BottleneckAnalysisQueryDto,
  SectorPerformanceQueryDto,
  PaintUsageQueryDto,
} from '../dto/query-statistics.dto';

@Injectable()
export class ProductionStatisticsService {
  private readonly logger = new Logger(ProductionStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getTasksOverview(query: ProductionTasksOverviewQueryDto): Promise<ProductionTasksOverview> {
    this.logger.log('Getting production tasks overview');

    const { startDate, endDate, sectorId, customerId, statuses } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (sectorId) where.sectorId = sectorId;
    if (customerId) where.customerId = customerId;
    if (statuses?.length) where.status = { in: statuses };

    const [tasks, statusGroups, sectorGroups] = await Promise.all([
      this.prisma.task.findMany({
        where,
        select: {
          id: true,
          status: true,
          price: true,
          startedAt: true,
          finishedAt: true,
          sectorId: true,
        },
      }),

      this.prisma.task.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
      }),

      this.prisma.task.groupBy({
        by: ['sectorId'],
        where,
        _count: { id: true },
      }),
    ]);

    const totalTasks = tasks.length;
    const activeTasks = tasks.filter((t) => t.status === 'IN_PRODUCTION').length;
    const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
    const cancelledTasks = tasks.filter((t) => t.status === 'CANCELLED').length;
    const onHoldTasks = tasks.filter((t) => t.status === 'ON_HOLD').length;

    const completedTasksWithDuration = tasks.filter(
      (t) => t.status === 'COMPLETED' && t.startedAt && t.finishedAt,
    );

    const averageCompletionTime =
      completedTasksWithDuration.length > 0
        ? completedTasksWithDuration.reduce((sum, task) => {
            const duration =
              (new Date(task.finishedAt!).getTime() - new Date(task.startedAt!).getTime()) /
              (1000 * 60 * 60 * 24);
            return sum + duration;
          }, 0) / completedTasksWithDuration.length
        : 0;

    const totalRevenue = tasks.reduce((sum, task) => sum + Number(task.price || 0), 0);

    const byStatus = statusGroups.map((group) => ({
      status: group.status,
      count: group._count.id,
      percentage: (group._count.id / totalTasks) * 100,
    }));

    const sectorDetails = await Promise.all(
      sectorGroups
        .filter((g) => g.sectorId)
        .map(async (group) => {
          const sectorTasks = tasks.filter((t) => t.sectorId === group.sectorId);
          const completed = sectorTasks.filter((t) => t.status === 'COMPLETED');

          const sector = await this.prisma.sector.findUnique({
            where: { id: group.sectorId! },
            select: { name: true },
          });

          const completedWithTime = completed.filter((t) => t.startedAt && t.finishedAt);
          const avgCompletionTime =
            completedWithTime.length > 0
              ? completedWithTime.reduce((sum, task) => {
                  const duration =
                    (new Date(task.finishedAt!).getTime() - new Date(task.startedAt!).getTime()) /
                    (1000 * 60 * 60 * 24);
                  return sum + duration;
                }, 0) / completedWithTime.length
              : 0;

          return {
            sectorId: group.sectorId!,
            sectorName: sector?.name || 'Unknown',
            taskCount: group._count.id,
            completedCount: completed.length,
            avgCompletionTime: Math.round(avgCompletionTime * 10) / 10,
          };
        }),
    );

    return {
      totalTasks,
      activeTasks,
      completedTasks,
      cancelledTasks,
      onHoldTasks,
      averageCompletionTime: Math.round(averageCompletionTime * 10) / 10,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      byStatus,
      bySector: sectorDetails,
    };
  }

  async getCompletionRates(query: CompletionRatesQueryDto): Promise<CompletionRates> {
    this.logger.log('Getting completion rates');

    const { startDate, endDate, sectorId, userId, period = 'month' } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (sectorId) where.sectorId = sectorId;

    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        term: true,
        createdAt: true,
      },
    });

    const totalStarted = tasks.filter((t) => t.startedAt).length;
    const totalCompleted = tasks.filter((t) => t.status === 'COMPLETED').length;
    const completionRate = totalStarted > 0 ? (totalCompleted / totalStarted) * 100 : 0;

    const onTimeCompletions = tasks.filter((t) => {
      if (t.status !== 'COMPLETED' || !t.finishedAt || !t.term) return false;
      return new Date(t.finishedAt) <= new Date(t.term);
    }).length;

    const lateCompletions = totalCompleted - onTimeCompletions;
    const onTimeRate = totalCompleted > 0 ? (onTimeCompletions / totalCompleted) * 100 : 0;

    // Group by period for trends
    const trendsMap = tasks.reduce((acc, task) => {
      const periodKey = this.getPeriodKey(task.createdAt, period as any);
      if (!acc[periodKey]) {
        acc[periodKey] = { started: 0, completed: 0 };
      }

      if (task.startedAt) acc[periodKey].started++;
      if (task.status === 'COMPLETED') acc[periodKey].completed++;

      return acc;
    }, {} as Record<string, any>);

    const trends = Object.entries(trendsMap).map(([date, data]: [string, any]) => ({
      date,
      started: data.started,
      completed: data.completed,
      rate: data.started > 0 ? (data.completed / data.started) * 100 : 0,
    }));

    return {
      period: period as string,
      totalStarted,
      totalCompleted,
      completionRate: Math.round(completionRate * 10) / 10,
      onTimeCompletions,
      lateCompletions,
      onTimeRate: Math.round(onTimeRate * 10) / 10,
      trends,
    };
  }

  async getCycleTimeAnalysis(query: CycleTimeAnalysisQueryDto): Promise<CycleTimeAnalysis> {
    this.logger.log('Getting cycle time analysis');

    const { startDate, endDate, sectorId, customerId } = query;

    const where: any = {
      status: 'COMPLETED',
      startedAt: { not: null },
      finishedAt: { not: null },
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (sectorId) where.sectorId = sectorId;
    if (customerId) where.customerId = customerId;

    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        sectorId: true,
        sector: { select: { name: true } },
      },
    });

    const cycleTimes = tasks.map((task) => {
      const duration =
        (new Date(task.finishedAt!).getTime() - new Date(task.startedAt!).getTime()) /
        (1000 * 60 * 60 * 24);
      return { taskId: task.id, duration, sectorId: task.sectorId, sectorName: task.sector?.name };
    });

    const sortedTimes = cycleTimes.map((ct) => ct.duration).sort((a, b) => a - b);
    const averageCycleTime =
      sortedTimes.length > 0 ? sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length : 0;
    const medianCycleTime =
      sortedTimes.length > 0
        ? sortedTimes[Math.floor(sortedTimes.length / 2)]
        : 0;
    const minCycleTime = sortedTimes.length > 0 ? sortedTimes[0] : 0;
    const maxCycleTime = sortedTimes.length > 0 ? sortedTimes[sortedTimes.length - 1] : 0;

    // Group by sector
    const sectorMap = cycleTimes.reduce((acc, ct) => {
      if (!ct.sectorId) return acc;
      if (!acc[ct.sectorId]) {
        acc[ct.sectorId] = {
          sectorId: ct.sectorId,
          sectorName: ct.sectorName || 'Unknown',
          times: [],
        };
      }
      acc[ct.sectorId].times.push(ct.duration);
      return acc;
    }, {} as Record<string, any>);

    const bySector = Object.values(sectorMap).map((sector: any) => ({
      sectorId: sector.sectorId,
      sectorName: sector.sectorName,
      averageCycleTime:
        Math.round((sector.times.reduce((a: number, b: number) => a + b, 0) / sector.times.length) * 10) / 10,
      taskCount: sector.times.length,
    }));

    // Distribution ranges
    const ranges = [
      { range: '0-7 days', min: 0, max: 7 },
      { range: '8-14 days', min: 8, max: 14 },
      { range: '15-30 days', min: 15, max: 30 },
      { range: '31-60 days', min: 31, max: 60 },
      { range: '60+ days', min: 61, max: Infinity },
    ];

    const distribution = ranges.map((r) => {
      const count = sortedTimes.filter((t) => t >= r.min && t <= r.max).length;
      return {
        range: r.range,
        count,
        percentage: sortedTimes.length > 0 ? (count / sortedTimes.length) * 100 : 0,
      };
    });

    return {
      averageCycleTime: Math.round(averageCycleTime * 10) / 10,
      medianCycleTime: Math.round(medianCycleTime * 10) / 10,
      minCycleTime: Math.round(minCycleTime * 10) / 10,
      maxCycleTime: Math.round(maxCycleTime * 10) / 10,
      byPhase: [], // TODO: Implement phase tracking
      bySector,
      distribution,
    };
  }

  async getBottlenecks(query: BottleneckAnalysisQueryDto): Promise<BottleneckAnalysis> {
    this.logger.log('Getting bottleneck analysis');

    // This is a simplified bottleneck analysis
    // In production, implement more sophisticated analysis

    const sectors = await this.prisma.sector.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            tasks: {
              where: {
                status: 'IN_PRODUCTION',
              },
            },
          },
        },
        users: {
          select: { id: true },
        },
      },
    });

    const workloadDistribution = sectors.map((sector) => {
      const activeTasks = sector._count.tasks;
      const employeeCount = sector.users.length;
      const capacity = employeeCount * 5; // Assume 5 tasks per employee capacity
      const utilizationRate = capacity > 0 ? (activeTasks / capacity) * 100 : 0;

      return {
        sectorId: sector.id,
        sectorName: sector.name,
        activeTasks,
        capacity,
        utilizationRate: Math.round(utilizationRate * 10) / 10,
      };
    });

    const identifiedBottlenecks = workloadDistribution
      .filter((w) => w.utilizationRate > 80)
      .map((w) => ({
        type: 'sector' as const,
        identifier: w.sectorId,
        name: w.sectorName,
        averageWaitTime: 0, // TODO: Calculate from actual data
        tasksAffected: w.activeTasks,
        impact: (w.utilizationRate > 100 ? 'high' : w.utilizationRate > 90 ? 'medium' : 'low') as any,
        recommendations: [
          'Consider hiring additional staff',
          'Review task distribution',
          'Optimize workflow processes',
        ],
      }));

    return {
      identifiedBottlenecks,
      workloadDistribution,
    };
  }

  async getSectorPerformance(query: SectorPerformanceQueryDto): Promise<SectorPerformance[]> {
    this.logger.log('Getting sector performance');

    const { startDate, endDate, sectorId } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (sectorId) where.sectorId = sectorId;

    const sectors = await this.prisma.sector.findMany({
      where: sectorId ? { id: sectorId } : undefined,
      select: {
        id: true,
        name: true,
        tasks: {
          where,
          select: {
            id: true,
            status: true,
            price: true,
            startedAt: true,
            finishedAt: true,
          },
        },
        users: {
          select: { id: true },
        },
      },
    });

    return sectors.map((sector) => {
      const totalTasks = sector.tasks.length;
      const completedTasks = sector.tasks.filter((t) => t.status === 'COMPLETED').length;
      const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      const completedWithDuration = sector.tasks.filter(
        (t) => t.status === 'COMPLETED' && t.startedAt && t.finishedAt,
      );

      const averageCompletionTime =
        completedWithDuration.length > 0
          ? completedWithDuration.reduce((sum, task) => {
              const duration =
                (new Date(task.finishedAt!).getTime() - new Date(task.startedAt!).getTime()) /
                (1000 * 60 * 60 * 24);
              return sum + duration;
            }, 0) / completedWithDuration.length
          : 0;

      const revenue = sector.tasks.reduce((sum, task) => sum + Number(task.price || 0), 0);
      const employeeCount = sector.users.length;
      const tasksPerEmployee = employeeCount > 0 ? totalTasks / employeeCount : 0;
      const efficiency = completionRate > 0 ? (completedTasks / averageCompletionTime) : 0;

      return {
        sectorId: sector.id,
        sectorName: sector.name,
        totalTasks,
        completedTasks,
        completionRate: Math.round(completionRate * 10) / 10,
        averageCompletionTime: Math.round(averageCompletionTime * 10) / 10,
        efficiency: Math.round(efficiency * 10) / 10,
        revenue: Math.round(revenue * 100) / 100,
        employeeCount,
        tasksPerEmployee: Math.round(tasksPerEmployee * 10) / 10,
      };
    });
  }

  async getPaintUsage(query: PaintUsageQueryDto): Promise<PaintUsageStatistics> {
    this.logger.log('Getting paint usage statistics');

    const { startDate, endDate, paintTypeId, paintBrandId, topN = 10 } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    const productions = await this.prisma.paintProduction.findMany({
      where,
      select: {
        id: true,
        volumeLiters: true,
        createdAt: true,
        formula: {
          select: {
            id: true,
            pricePerLiter: true,
            paint: {
              select: {
                id: true,
                name: true,
                hex: true,
                paintType: { select: { id: true, name: true } },
                paintBrand: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const totalLitersProduced = productions.reduce((sum, p) => sum + p.volumeLiters, 0);
    const totalCost = productions.reduce((sum, p) => {
      const pricePerLiter = Number(p.formula.pricePerLiter) || 0;
      return sum + p.volumeLiters * pricePerLiter;
    }, 0);

    // Group by paint
    const paintMap = productions.reduce((acc, p) => {
      const paintId = p.formula.paint.id;
      if (!acc[paintId]) {
        acc[paintId] = {
          paintId,
          paintName: p.formula.paint.name,
          hex: p.formula.paint.hex,
          liters: 0,
          times: 0,
          cost: 0,
        };
      }
      acc[paintId].liters += p.volumeLiters;
      acc[paintId].times += 1;
      acc[paintId].cost += p.volumeLiters * Number(p.formula.pricePerLiter || 0);
      return acc;
    }, {} as Record<string, any>);

    const topColors = Object.values(paintMap)
      .sort((a: any, b: any) => b.liters - a.liters)
      .slice(0, topN)
      .map((p: any) => ({
        paintId: p.paintId,
        paintName: p.paintName,
        hex: p.hex,
        litersProduced: Math.round(p.liters * 100) / 100,
        timesUsed: p.times,
        cost: Math.round(p.cost * 100) / 100,
      }));

    // Group by type
    const typeMap = productions.reduce((acc, p) => {
      const typeName = p.formula.paint.paintType.name;
      if (!acc[typeName]) {
        acc[typeName] = { liters: 0, formulaCount: 0, cost: 0 };
      }
      acc[typeName].liters += p.volumeLiters;
      acc[typeName].formulaCount += 1;
      acc[typeName].cost += p.volumeLiters * Number(p.formula.pricePerLiter || 0);
      return acc;
    }, {} as Record<string, any>);

    const byType = Object.entries(typeMap).map(([paintType, data]: [string, any]) => ({
      paintType,
      litersProduced: Math.round(data.liters * 100) / 100,
      formulaCount: data.formulaCount,
      cost: Math.round(data.cost * 100) / 100,
    }));

    // Group by brand
    const brandMap = productions.reduce((acc, p) => {
      const brandName = p.formula.paint.paintBrand?.name || 'Unknown';
      if (!acc[brandName]) {
        acc[brandName] = { liters: 0, cost: 0 };
      }
      acc[brandName].liters += p.volumeLiters;
      acc[brandName].cost += p.volumeLiters * Number(p.formula.pricePerLiter || 0);
      return acc;
    }, {} as Record<string, any>);

    const byBrand = Object.entries(brandMap).map(([brandName, data]: [string, any]) => ({
      brandName,
      litersProduced: Math.round(data.liters * 100) / 100,
      cost: Math.round(data.cost * 100) / 100,
    }));

    // Trends by period
    const trendsMap = productions.reduce((acc, p) => {
      const period = this.getPeriodKey(p.createdAt, 'month');
      if (!acc[period]) {
        acc[period] = { liters: 0, cost: 0 };
      }
      acc[period].liters += p.volumeLiters;
      acc[period].cost += p.volumeLiters * Number(p.formula.pricePerLiter || 0);
      return acc;
    }, {} as Record<string, any>);

    const trends = Object.entries(trendsMap).map(([period, data]: [string, any]) => ({
      period,
      litersProduced: Math.round(data.liters * 100) / 100,
      cost: Math.round(data.cost * 100) / 100,
    }));

    return {
      totalLitersProduced: Math.round(totalLitersProduced * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      formulaCount: productions.length,
      topColors,
      byType,
      byBrand,
      trends,
    };
  }

  private getPeriodKey(date: Date, period: string): string {
    const d = new Date(date);
    switch (period) {
      case 'day':
        return d.toISOString().split('T')[0];
      case 'week':
        const weekStart = new Date(d.setDate(d.getDate() - d.getDay()));
        return weekStart.toISOString().split('T')[0];
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      case 'quarter':
        const quarter = Math.floor(d.getMonth() / 3) + 1;
        return `${d.getFullYear()}-Q${quarter}`;
      case 'year':
        return String(d.getFullYear());
      default:
        return d.toISOString().split('T')[0];
    }
  }
}
