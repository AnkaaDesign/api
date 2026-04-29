import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { AdministrationAnalyticsFilters } from '../../../types/administration-analytics';

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

@Injectable()
export class AdministrationAnalyticsService {
  private readonly logger = new Logger(AdministrationAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverviewAnalytics(filters: AdministrationAnalyticsFilters) {
    const dateRange = this.resolveDateRange(filters);
    const { groupBy = 'month' } = filters;

    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    // Fetch customers created within the date range
    const customers = await this.prisma.customer.findMany({
      where: {
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    // Total customer count (all time)
    const totalCustomers = await this.prisma.customer.count();

    // Customer acquisition by period
    const customersByPeriod = new Map<string, number>();
    for (const customer of customers) {
      const key = keyFn(customer.createdAt);
      customersByPeriod.set(key, (customersByPeriod.get(key) || 0) + 1);
    }

    // Build cumulative customer acquisition
    const customerKeys = Array.from(customersByPeriod.keys()).sort();

    // Count customers before the date range to get a running total
    const customersBefore = await this.prisma.customer.count({
      where: {
        createdAt: { lt: dateRange.start },
      },
    });

    let runningTotal = customersBefore;
    const customerAcquisition = customerKeys.map(key => {
      const newCustomers = customersByPeriod.get(key) || 0;
      runningTotal += newCustomers;
      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        newCustomers,
        totalCustomers: runningTotal,
      };
    });

    // Fetch tasks created within the date range
    const tasks = await this.prisma.task.findMany({
      where: {
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        finishedAt: true,
      },
    });

    // Task trends by period
    const taskCreatedByPeriod = new Map<string, number>();
    const taskCompletedByPeriod = new Map<string, number>();

    for (const task of tasks) {
      const createdKey = keyFn(task.createdAt);
      taskCreatedByPeriod.set(createdKey, (taskCreatedByPeriod.get(createdKey) || 0) + 1);

      if (task.finishedAt) {
        const completedKey = keyFn(task.finishedAt);
        taskCompletedByPeriod.set(completedKey, (taskCompletedByPeriod.get(completedKey) || 0) + 1);
      }
    }

    const allTaskKeys = new Set([...taskCreatedByPeriod.keys(), ...taskCompletedByPeriod.keys()]);
    const sortedTaskKeys = Array.from(allTaskKeys).sort();

    const taskTrends = sortedTaskKeys.map(key => ({
      period: key,
      periodLabel: groupBy === 'week' ? key : monthLabel(key),
      tasksCreated: taskCreatedByPeriod.get(key) || 0,
      tasksCompleted: taskCompletedByPeriod.get(key) || 0,
    }));

    // Active users
    const activeUsers = await this.prisma.user.count({
      where: { isActive: true },
    });

    // New customers this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const newCustomersThisMonth = await this.prisma.customer.count({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    // Tasks this month
    const tasksThisMonth = await this.prisma.task.count({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    return {
      summary: {
        totalCustomers,
        newCustomersThisMonth,
        activeUsers,
        tasksThisMonth,
      },
      customerAcquisition,
      taskTrends,
    };
  }

  private resolveDateRange(filters: AdministrationAnalyticsFilters): {
    start: Date;
    end: Date;
  } {
    if (filters.startDate && filters.endDate) {
      return { start: new Date(filters.startDate), end: new Date(filters.endDate) };
    }

    // Default: last 12 months
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    return { start, end };
  }
}
