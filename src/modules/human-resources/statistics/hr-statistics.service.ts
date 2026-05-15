import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { USER_STATUS } from '../../../constants/enums';
import {
  businessMonthKey,
  businessPeriodEnd,
  businessPeriodStart,
} from '../../../utils/business-period';
import type {
  HeadcountResult,
  HeadcountSectorBreakdown,
  HeadcountPositionBreakdown,
  HeadcountTimeseriesItem,
  HeadcountSummary,
  TurnoverResult,
  TurnoverItem,
  TurnoverSectorBreakdown,
  TurnoverSummary,
} from '../../../types/hr-analytics';
import type {
  HeadcountFilters,
  TurnoverFilters,
} from '../../../schemas/hr-analytics';

const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const UNASSIGNED_LABEL = 'Sem setor';
const UNASSIGNED_POSITION_LABEL = 'Sem cargo';

type UserRow = {
  id: string;
  status: string;
  sectorId: string | null;
  positionId: string | null;
  createdAt: Date;
  effectedAt: Date | null;
  exp1EndAt: Date | null;
  exp2EndAt: Date | null;
  dismissedAt: Date | null;
};

type PeriodBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

@Injectable()
export class HrStatisticsService {
  private readonly logger = new Logger(HrStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // HEADCOUNT (Equipe)
  // =========================================================================

  async getHeadcount(filters: HeadcountFilters): Promise<HeadcountResult> {
    const dateRange = this.resolveDateRange(filters);
    const snapshotDate = filters.snapshotDate ?? new Date();
    const useBusinessPeriod = filters.useBusinessPeriod ?? true;
    const includeInactive = filters.includeInactive ?? false;
    const includeUnassigned = filters.includeUnassigned ?? true;

    const userWhere: any = {};
    if (filters.sectorIds?.length) userWhere.sectorId = { in: filters.sectorIds };
    if (filters.positionIds?.length) userWhere.positionId = { in: filters.positionIds };

    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        status: true,
        sectorId: true,
        positionId: true,
        createdAt: true,
        effectedAt: true,
        exp1EndAt: true,
        exp2EndAt: true,
        dismissedAt: true,
      },
    });

    const [sectors, positions] = await Promise.all([
      this.prisma.sector.findMany({ select: { id: true, name: true } }),
      this.prisma.position.findMany({ select: { id: true, name: true, hierarchy: true } }),
    ]);

    const sectorMap = new Map(sectors.map(s => [s.id, s.name]));
    const positionMap = new Map(positions.map(p => [p.id, p.name]));

    // ----- Snapshot: "currently active" at snapshotDate
    const snapshotActive = users.filter(u => this.isActiveAt(u, snapshotDate));
    const considered = includeInactive ? users : snapshotActive;

    // Sector breakdown
    const sectorBuckets = new Map<
      string,
      {
        active: number;
        inactive: number;
        positions: Map<string, { active: number; inactive: number }>;
      }
    >();

    for (const u of users) {
      const sectorKey = u.sectorId ?? '__unassigned__';
      if (!includeUnassigned && sectorKey === '__unassigned__') continue;
      if (!sectorBuckets.has(sectorKey)) {
        sectorBuckets.set(sectorKey, { active: 0, inactive: 0, positions: new Map() });
      }
      const bucket = sectorBuckets.get(sectorKey)!;
      const isActive = this.isActiveAt(u, snapshotDate);
      if (isActive) bucket.active++;
      else bucket.inactive++;

      const positionKey = u.positionId ?? '__unassigned__';
      if (!bucket.positions.has(positionKey)) {
        bucket.positions.set(positionKey, { active: 0, inactive: 0 });
      }
      const posBucket = bucket.positions.get(positionKey)!;
      if (isActive) posBucket.active++;
      else posBucket.inactive++;
    }

    const totalActiveAll = considered.filter(u => this.isActiveAt(u, snapshotDate)).length;

    const sectorBreakdown: HeadcountSectorBreakdown[] = Array.from(sectorBuckets.entries())
      .map(([sectorKey, bucket]) => {
        const isUnassigned = sectorKey === '__unassigned__';
        const sectorName = isUnassigned
          ? UNASSIGNED_LABEL
          : sectorMap.get(sectorKey) ?? sectorKey;
        const count = includeInactive ? bucket.active + bucket.inactive : bucket.active;
        const newHires = users.filter(u =>
          (u.sectorId ?? '__unassigned__') === sectorKey &&
          this.joinDate(u) >= dateRange.start &&
          this.joinDate(u) <= dateRange.end,
        ).length;
        const dismissals = users.filter(u =>
          (u.sectorId ?? '__unassigned__') === sectorKey &&
          u.dismissedAt &&
          u.dismissedAt >= dateRange.start &&
          u.dismissedAt <= dateRange.end,
        ).length;

        const positionList: HeadcountPositionBreakdown[] = Array.from(bucket.positions.entries())
          .map(([positionKey, pos]) => {
            const positionName = positionKey === '__unassigned__'
              ? UNASSIGNED_POSITION_LABEL
              : positionMap.get(positionKey) ?? positionKey;
            const posCount = includeInactive ? pos.active + pos.inactive : pos.active;
            return {
              positionId: positionKey === '__unassigned__' ? '' : positionKey,
              positionName,
              count: posCount,
              active: pos.active,
              inactive: pos.inactive,
            };
          })
          .filter(p => includeInactive ? true : p.active > 0)
          .sort((a, b) => b.count - a.count);

        return {
          sectorId: isUnassigned ? null : sectorKey,
          sectorName,
          count,
          active: bucket.active,
          inactive: bucket.inactive,
          newHires,
          dismissals,
          percentOfTotal: totalActiveAll > 0
            ? Math.round((bucket.active / totalActiveAll) * 1000) / 10
            : 0,
          positions: positionList,
        };
      })
      .filter(s => includeInactive ? true : s.active > 0)
      .sort((a, b) => b.count - a.count);

    // Position breakdown (cross-cutting across all selected sectors)
    const positionBuckets = new Map<string, { active: number; inactive: number }>();
    for (const u of users) {
      const positionKey = u.positionId ?? '__unassigned__';
      if (!positionBuckets.has(positionKey)) {
        positionBuckets.set(positionKey, { active: 0, inactive: 0 });
      }
      const bucket = positionBuckets.get(positionKey)!;
      if (this.isActiveAt(u, snapshotDate)) bucket.active++;
      else bucket.inactive++;
    }

    const positionBreakdown: HeadcountPositionBreakdown[] = Array.from(positionBuckets.entries())
      .map(([positionKey, bucket]) => {
        const positionName = positionKey === '__unassigned__'
          ? UNASSIGNED_POSITION_LABEL
          : positionMap.get(positionKey) ?? positionKey;
        const count = includeInactive ? bucket.active + bucket.inactive : bucket.active;
        return {
          positionId: positionKey === '__unassigned__' ? '' : positionKey,
          positionName,
          count,
          active: bucket.active,
          inactive: bucket.inactive,
        };
      })
      .filter(p => includeInactive ? true : p.active > 0)
      .sort((a, b) => b.count - a.count);

    // Timeseries
    const buckets = this.buildPeriodBuckets(dateRange.start, dateRange.end, useBusinessPeriod);
    const timeseries: HeadcountTimeseriesItem[] = buckets.map(b => {
      const activeUsers = users.filter(u => this.isActiveDuring(u, b.start, b.end));
      const inExperience = activeUsers.filter(
        u => u.status === USER_STATUS.EXPERIENCE_PERIOD_1 || u.status === USER_STATUS.EXPERIENCE_PERIOD_2,
      ).length;
      const newHires = users.filter(u => {
        const j = this.joinDate(u);
        return j >= b.start && j <= b.end;
      }).length;
      const dismissals = users.filter(
        u => u.dismissedAt && u.dismissedAt >= b.start && u.dismissedAt <= b.end,
      ).length;
      return {
        period: b.key,
        label: b.label,
        headcount: activeUsers.length,
        active: activeUsers.length,
        inExperience,
        newHires,
        dismissals,
        netChange: newHires - dismissals,
      };
    });

    // Summary
    const totalEmployees = users.length;
    const totalActive = snapshotActive.length;
    const totalInactive = totalEmployees - totalActive;
    const totalSectors = sectorBreakdown.filter(s => s.sectorId !== null && s.active > 0).length;
    const unassignedSector = sectorBuckets.get('__unassigned__')?.active ?? 0;

    const sortedSectorsByActive = [...sectorBreakdown]
      .filter(s => s.sectorId !== null)
      .sort((a, b) => b.active - a.active);
    const largestSector = sortedSectorsByActive[0]
      ? { id: sortedSectorsByActive[0].sectorId!, name: sortedSectorsByActive[0].sectorName, count: sortedSectorsByActive[0].active }
      : null;
    const smallestSector = sortedSectorsByActive[sortedSectorsByActive.length - 1] && sortedSectorsByActive.length > 1
      ? { id: sortedSectorsByActive[sortedSectorsByActive.length - 1].sectorId!, name: sortedSectorsByActive[sortedSectorsByActive.length - 1].sectorName, count: sortedSectorsByActive[sortedSectorsByActive.length - 1].active }
      : null;

    const newHiresInPeriod = users.filter(u => {
      const j = this.joinDate(u);
      return j >= dateRange.start && j <= dateRange.end;
    }).length;
    const dismissalsInPeriod = users.filter(
      u => u.dismissedAt && u.dismissedAt >= dateRange.start && u.dismissedAt <= dateRange.end,
    ).length;

    const inExperience = snapshotActive.filter(
      u => u.status === USER_STATUS.EXPERIENCE_PERIOD_1 || u.status === USER_STATUS.EXPERIENCE_PERIOD_2,
    ).length;
    const effected = snapshotActive.filter(u => u.status === USER_STATUS.EFFECTED).length;

    const summary: HeadcountSummary = {
      totalActive,
      totalInactive,
      totalEmployees,
      totalSectors,
      averageBySector: totalSectors > 0 ? Math.round((totalActive / totalSectors) * 10) / 10 : 0,
      largestSector,
      smallestSector,
      unassignedSector,
      newHiresInPeriod,
      dismissalsInPeriod,
      netChange: newHiresInPeriod - dismissalsInPeriod,
      inExperiencePeriod: inExperience,
      effected,
    };

    return {
      summary,
      sectorBreakdown,
      positionBreakdown,
      timeseries,
      snapshotDate,
    };
  }

  // =========================================================================
  // TURNOVER (Rotatividade)
  // =========================================================================

  async getTurnover(filters: TurnoverFilters): Promise<TurnoverResult> {
    const dateRange = this.resolveDateRange(filters);
    const useBusinessPeriod = filters.useBusinessPeriod ?? true;
    const isComparisonBySector = (filters.sectorIds?.length ?? 0) >= 2;

    const userWhere: any = {};
    if (filters.sectorIds?.length) userWhere.sectorId = { in: filters.sectorIds };
    if (filters.positionIds?.length) userWhere.positionId = { in: filters.positionIds };

    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        status: true,
        sectorId: true,
        positionId: true,
        createdAt: true,
        effectedAt: true,
        exp1EndAt: true,
        exp2EndAt: true,
        dismissedAt: true,
      },
    });

    const sectors = isComparisonBySector
      ? await this.prisma.sector.findMany({
          where: { id: { in: filters.sectorIds! } },
          select: { id: true, name: true },
        })
      : await this.prisma.sector.findMany({ select: { id: true, name: true } });
    const sectorMap = new Map(sectors.map(s => [s.id, s.name]));

    const buckets = this.buildPeriodBuckets(dateRange.start, dateRange.end, useBusinessPeriod);

    const items: TurnoverItem[] = buckets.map(b => {
      const headcountStart = users.filter(u => this.isActiveAt(u, b.start)).length;
      const headcountEnd = users.filter(u => this.isActiveAt(u, b.end)).length;
      const newHires = users.filter(u => {
        const j = this.joinDate(u);
        return j >= b.start && j <= b.end;
      }).length;
      const dismissals = users.filter(
        u => u.dismissedAt && u.dismissedAt >= b.start && u.dismissedAt <= b.end,
      ).length;
      const averageHeadcount = (headcountStart + headcountEnd) / 2;
      const turnoverRate = averageHeadcount > 0
        ? Math.round((dismissals / averageHeadcount) * 1000) / 10
        : 0;

      const item: TurnoverItem = {
        period: b.key,
        label: b.label,
        newHires,
        dismissals,
        netChange: newHires - dismissals,
        headcountStart,
        headcountEnd,
        averageHeadcount: Math.round(averageHeadcount * 10) / 10,
        turnoverRate,
        voluntaryRate: 0,
      };

      if (isComparisonBySector) {
        item.comparisons = filters.sectorIds!.map(sectorId => {
          const sectorUsers = users.filter(u => u.sectorId === sectorId);
          const sNewHires = sectorUsers.filter(u => {
            const j = this.joinDate(u);
            return j >= b.start && j <= b.end;
          }).length;
          const sDismissals = sectorUsers.filter(
            u => u.dismissedAt && u.dismissedAt >= b.start && u.dismissedAt <= b.end,
          ).length;
          const sHcStart = sectorUsers.filter(u => this.isActiveAt(u, b.start)).length;
          const sHcEnd = sectorUsers.filter(u => this.isActiveAt(u, b.end)).length;
          const sAvg = (sHcStart + sHcEnd) / 2;
          const sRate = sAvg > 0 ? Math.round((sDismissals / sAvg) * 1000) / 10 : 0;
          return {
            sectorId,
            sectorName: sectorMap.get(sectorId) ?? sectorId,
            newHires: sNewHires,
            dismissals: sDismissals,
            avgHeadcount: Math.round(sAvg * 10) / 10,
            turnoverRate: sRate,
          };
        });
      }

      return item;
    });

    // Sector breakdown (always returned, but limited to filter when set)
    const breakdownSectorIds = filters.sectorIds?.length
      ? filters.sectorIds
      : Array.from(new Set(users.map(u => u.sectorId).filter((s): s is string => s !== null)));

    const sectorBreakdown: TurnoverSectorBreakdown[] = breakdownSectorIds.map(sectorId => {
      const sectorUsers = users.filter(u => u.sectorId === sectorId);
      const sNewHires = sectorUsers.filter(u => {
        const j = this.joinDate(u);
        return j >= dateRange.start && j <= dateRange.end;
      }).length;
      const sDismissals = sectorUsers.filter(
        u => u.dismissedAt && u.dismissedAt >= dateRange.start && u.dismissedAt <= dateRange.end,
      ).length;
      const sHcStart = sectorUsers.filter(u => this.isActiveAt(u, dateRange.start)).length;
      const sHcEnd = sectorUsers.filter(u => this.isActiveAt(u, dateRange.end)).length;
      const sAvg = (sHcStart + sHcEnd) / 2;
      const sRate = sAvg > 0 ? Math.round((sDismissals / sAvg) * 1000) / 10 : 0;
      return {
        sectorId,
        sectorName: sectorMap.get(sectorId) ?? sectorId,
        newHires: sNewHires,
        dismissals: sDismissals,
        avgHeadcount: Math.round(sAvg * 10) / 10,
        turnoverRate: sRate,
        netChange: sNewHires - sDismissals,
      };
    }).sort((a, b) => b.turnoverRate - a.turnoverRate);

    // Summary
    const totalAdmissions = users.filter(u => {
      const j = this.joinDate(u);
      return j >= dateRange.start && j <= dateRange.end;
    }).length;
    const totalDismissals = users.filter(
      u => u.dismissedAt && u.dismissedAt >= dateRange.start && u.dismissedAt <= dateRange.end,
    ).length;
    const avgHeadcount = items.length > 0
      ? items.reduce((s, i) => s + i.averageHeadcount, 0) / items.length
      : 0;
    const turnoverRate = avgHeadcount > 0
      ? Math.round((totalDismissals / avgHeadcount) * 1000) / 10
      : 0;

    // Tenure stats for dismissed in period
    const dismissedInPeriod = users.filter(
      u => u.dismissedAt && u.dismissedAt >= dateRange.start && u.dismissedAt <= dateRange.end,
    );
    const tenures = dismissedInPeriod.map(u => {
      const j = this.joinDate(u);
      return Math.max(0, Math.floor((u.dismissedAt!.getTime() - j.getTime()) / (1000 * 60 * 60 * 24)));
    });
    const averageTenureDays = tenures.length > 0
      ? Math.round(tenures.reduce((s, t) => s + t, 0) / tenures.length)
      : 0;
    const shortestTenureDays = tenures.length > 0 ? Math.min(...tenures) : null;
    const longestTenureDays = tenures.length > 0 ? Math.max(...tenures) : null;

    const experienceFailures = dismissedInPeriod.filter(u => {
      const tenureDays = Math.floor((u.dismissedAt!.getTime() - this.joinDate(u).getTime()) / (1000 * 60 * 60 * 24));
      return tenureDays <= 90;
    }).length;
    const experienceFailureRate = totalDismissals > 0
      ? Math.round((experienceFailures / totalDismissals) * 1000) / 10
      : 0;

    const summary: TurnoverSummary = {
      totalAdmissions,
      totalDismissals,
      netChange: totalAdmissions - totalDismissals,
      averageHeadcount: Math.round(avgHeadcount * 10) / 10,
      turnoverRate,
      averageTenureDays,
      shortestTenureDays,
      longestTenureDays,
      experienceFailureRate,
    };

    return { summary, items, sectorBreakdown };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * "Join date" = effectedAt if present, else createdAt. Same convention as
   * UserAnalyticsService.getTeamPerformance to keep semantics consistent.
   */
  private joinDate(u: UserRow): Date {
    return u.effectedAt ?? u.createdAt;
  }

  /**
   * Active *at a specific moment* — used for snapshots and headcount-end /
   * headcount-start of a period. A user counts as active if they had joined
   * by `when` and either weren't dismissed or were dismissed strictly after.
   */
  private isActiveAt(u: UserRow, when: Date): boolean {
    if (this.joinDate(u) > when) return false;
    if (u.dismissedAt && u.dismissedAt < when) return false;
    return true;
  }

  /**
   * Active during the interval [start, end] — for period-bucket aggregation.
   * Mid-period dismissals still count for that period.
   */
  private isActiveDuring(u: UserRow, start: Date, end: Date): boolean {
    if (this.joinDate(u) > end) return false;
    if (u.dismissedAt && u.dismissedAt < start) return false;
    return true;
  }

  private buildPeriodBuckets(start: Date, end: Date, useBusiness: boolean): PeriodBucket[] {
    const buckets: PeriodBucket[] = [];
    if (useBusiness) {
      const startKey = businessMonthKey(start);
      const endKey = businessMonthKey(end);
      const [startYear, startMonth] = startKey.split('-').map(n => parseInt(n, 10));
      const [endYear, endMonth] = endKey.split('-').map(n => parseInt(n, 10));
      let year = startYear;
      let month = startMonth;
      while (year < endYear || (year === endYear && month <= endMonth)) {
        const pStart = businessPeriodStart(year, month);
        const pEnd = businessPeriodEnd(year, month);
        buckets.push({
          key: `${year}-${String(month).padStart(2, '0')}`,
          label: `${MONTH_NAMES_PT[month - 1]} ${year}`,
          start: pStart,
          end: pEnd,
        });
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    } else {
      const current = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (current <= endMonth) {
        const y = current.getFullYear();
        const m = current.getMonth();
        buckets.push({
          key: `${y}-${String(m + 1).padStart(2, '0')}`,
          label: `${MONTH_NAMES_PT[m]} ${y}`,
          start: new Date(y, m, 1, 0, 0, 0, 0),
          end: new Date(y, m + 1, 0, 23, 59, 59, 999),
        });
        current.setMonth(current.getMonth() + 1);
      }
    }
    return buckets;
  }

  private resolveDateRange(filters: {
    startDate?: Date;
    endDate?: Date;
    periods?: Array<{ startDate?: Date; endDate?: Date }>;
  }): { start: Date; end: Date } {
    if (filters.periods && filters.periods.length > 0) {
      const starts = filters.periods
        .map(p => p.startDate?.getTime())
        .filter((t): t is number => t !== undefined);
      const ends = filters.periods
        .map(p => p.endDate?.getTime())
        .filter((t): t is number => t !== undefined);
      if (starts.length > 0 && ends.length > 0) {
        return { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) };
      }
    }
    if (filters.startDate && filters.endDate) {
      return { start: filters.startDate, end: filters.endDate };
    }
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    return { start, end };
  }
}
