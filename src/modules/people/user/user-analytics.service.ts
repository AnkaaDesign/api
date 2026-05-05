import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { USER_STATUS, WARNING_CATEGORY } from '../../../constants/enums';
import type {
  TeamPerformanceItem,
  TeamPerformanceSummary,
  TeamPerformanceResult,
  TeamSectorComparison,
} from '../../../types/hr-analytics';

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

function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES_PT[parseInt(month, 10) - 1]} ${year}`;
}

interface AnalyticsFilters {
  sectorIds?: string[];
  positionIds?: string[];
  periods?: Array<{ start: Date; end: Date }>;
  startDate?: Date;
  endDate?: Date;
  groupBy?: string;
}

@Injectable()
export class UserAnalyticsService {
  private readonly logger = new Logger(UserAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Team Performance
  // ---------------------------------------------------------------------------

  async getTeamPerformance(filters: AnalyticsFilters): Promise<TeamPerformanceResult> {
    const { sectorIds, positionIds } = filters;
    const dateRange = this.resolveDateRange(filters);
    const isComparisonBySector = sectorIds && sectorIds.length >= 2;
    const now = new Date();

    const userWhere: any = {
      ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
      ...(positionIds?.length && { positionId: { in: positionIds } }),
    };

    // Fetch all users (including dismissed) for headcount over time
    const allUsers = await this.prisma.user.findMany({
      where: {
        ...userWhere,
        createdAt: { lte: dateRange.end },
      },
      select: {
        id: true,
        status: true,
        performanceLevel: true,
        sectorId: true,
        effectedAt: true,
        dismissedAt: true,
        createdAt: true,
      },
    });

    // Fetch warnings in date range
    const warnings = await this.prisma.warning.findMany({
      where: {
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        collaborator: userWhere,
      },
      select: {
        id: true,
        category: true,
        createdAt: true,
        collaborator: {
          select: {
            sectorId: true,
          },
        },
      },
    });

    // Vacation analytics deprecated — vacation tracking moved to Secullum (FuncionariosAfastamentos).
    // For HR analytics this would require aggregating Secullum absences per sector/user;
    // returning empty list keeps the rest of the analytics functional.
    const vacations: Array<{
      id: string;
      startAt: Date;
      endAt: Date;
      createdAt: Date;
      user?: { sectorId: string | null } | null;
    }> = [];

    // Build monthly items
    const monthKeys = this.generateMonthKeys(dateRange.start, dateRange.end);

    const items: TeamPerformanceItem[] = monthKeys.map(key => {
      const [yearStr, monthStr] = key.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      const periodStart = new Date(year, month - 1, 1);
      const periodEnd = new Date(year, month, 0, 23, 59, 59);

      // Headcount: users who were active during this period
      const activeUsers = allUsers.filter(u => {
        const joined = u.effectedAt || u.createdAt;
        if (joined > periodEnd) return false;
        if (u.status === USER_STATUS.DISMISSED && u.dismissedAt && u.dismissedAt < periodStart)
          return false;
        return true;
      });

      // New hires this month
      const newHires = allUsers.filter(u => {
        const joined = u.effectedAt || u.createdAt;
        return joined >= periodStart && joined <= periodEnd;
      }).length;

      // Dismissals this month
      const dismissals = allUsers.filter(u => {
        return u.dismissedAt && u.dismissedAt >= periodStart && u.dismissedAt <= periodEnd;
      }).length;

      const headcount = activeUsers.length;
      const turnoverRate = headcount > 0 ? Math.round((dismissals / headcount) * 1000) / 10 : 0;

      // Performance distribution
      const performanceDistribution: Record<number, number> = {};
      for (const user of activeUsers) {
        if (user.performanceLevel != null) {
          performanceDistribution[user.performanceLevel] =
            (performanceDistribution[user.performanceLevel] || 0) + 1;
        }
      }

      // Warnings this month
      const monthWarnings = warnings.filter(w => {
        return w.createdAt >= periodStart && w.createdAt <= periodEnd;
      });

      const warningsByCategory: Record<string, number> = {};
      for (const w of monthWarnings) {
        const cat = w.category as string;
        warningsByCategory[cat] = (warningsByCategory[cat] || 0) + 1;
      }

      // Vacations overlapping this month
      const vacationCount = vacations.filter(v => {
        return v.startAt <= periodEnd && v.endAt >= periodStart;
      }).length;

      return {
        period: key,
        label: monthLabel(key),
        headcount,
        newHires,
        dismissals,
        turnoverRate,
        performanceDistribution,
        warningsByCategory,
        totalWarnings: monthWarnings.length,
        vacationCount,
      };
    });

    // Summary: current state
    const activeNow = allUsers.filter(u => {
      return u.status !== USER_STATUS.DISMISSED;
    });

    const performanceLevels = activeNow
      .filter(u => u.performanceLevel != null)
      .map(u => u.performanceLevel!);

    const avgPerformanceLevel =
      performanceLevels.length > 0
        ? Math.round(
            (performanceLevels.reduce((a, b) => a + b, 0) / performanceLevels.length) * 10,
          ) / 10
        : 0;

    // Currently on vacation
    const onVacationCount = vacations.filter(v => {
      return v.startAt <= now && v.endAt >= now;
    }).length;

    const totalWarnings = warnings.length;

    // Total turnover for the period
    const totalDismissals = allUsers.filter(u => {
      return u.dismissedAt && u.dismissedAt >= dateRange.start && u.dismissedAt <= dateRange.end;
    }).length;
    const avgHeadcount =
      items.length > 0 ? items.reduce((sum, i) => sum + i.headcount, 0) / items.length : 0;
    const turnoverRate =
      avgHeadcount > 0 ? Math.round((totalDismissals / avgHeadcount) * 1000) / 10 : 0;

    const summary: TeamPerformanceSummary = {
      currentHeadcount: activeNow.length,
      avgPerformanceLevel,
      totalWarnings,
      onVacationCount,
      turnoverRate,
    };

    const result: TeamPerformanceResult = { items, summary };

    // Comparison by sector
    if (isComparisonBySector) {
      const sectors = await this.prisma.sector.findMany({
        where: { id: { in: sectorIds } },
        select: { id: true, name: true },
      });
      const sectorMap = new Map(sectors.map(s => [s.id, s.name]));

      result.comparison = sectorIds.map((sectorId): TeamSectorComparison => {
        const sectorUsers = activeNow.filter(u => u.sectorId === sectorId);
        const sectorPerf = sectorUsers
          .filter(u => u.performanceLevel != null)
          .map(u => u.performanceLevel!);

        const avgPerf =
          sectorPerf.length > 0
            ? Math.round((sectorPerf.reduce((a, b) => a + b, 0) / sectorPerf.length) * 10) / 10
            : 0;

        const sectorWarnings = warnings.filter(w => w.collaborator?.sectorId === sectorId).length;

        const sectorVacations = vacations.filter(
          v => v.user?.sectorId === sectorId && v.startAt <= now && v.endAt >= now,
        ).length;

        return {
          sectorId,
          sectorName: sectorMap.get(sectorId) || sectorId,
          headcount: sectorUsers.length,
          avgPerformanceLevel: avgPerf,
          totalWarnings: sectorWarnings,
          onVacationCount: sectorVacations,
        };
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateMonthKeys(start: Date, end: Date): string[] {
    const keys: string[] = [];
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

    while (current <= endMonth) {
      keys.push(monthKey(current));
      current.setMonth(current.getMonth() + 1);
    }

    return keys;
  }

  private resolveDateRange(filters: AnalyticsFilters): { start: Date; end: Date } {
    if (filters.periods && filters.periods.length > 0) {
      const starts = filters.periods.map(p => p.start.getTime());
      const ends = filters.periods.map(p => p.end.getTime());
      return {
        start: new Date(Math.min(...starts)),
        end: new Date(Math.max(...ends)),
      };
    }

    if (filters.startDate && filters.endDate) {
      return {
        start: new Date(filters.startDate),
        end: new Date(filters.endDate),
      };
    }

    // Default: last 12 months
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    return { start, end };
  }
}
