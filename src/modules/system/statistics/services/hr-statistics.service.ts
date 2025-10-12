import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  EmployeeOverview,
  PerformanceMetrics,
  BonusDistribution,
  AttendanceTrends,
  WarningAnalytics,
} from '../interfaces/statistics.interface';
import {
  EmployeeOverviewQueryDto,
  PerformanceMetricsQueryDto,
  BonusDistributionQueryDto,
  AttendanceTrendsQueryDto,
  WarningAnalyticsQueryDto,
} from '../dto/query-statistics.dto';

@Injectable()
export class HrStatisticsService {
  private readonly logger = new Logger(HrStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getEmployeeOverview(query: EmployeeOverviewQueryDto): Promise<EmployeeOverview> {
    const { sectorId, positionId, statuses } = query;

    const where: any = {};
    if (sectorId) where.sectorId = sectorId;
    if (positionId) where.positionId = positionId;
    if (statuses?.length) where.status = { in: statuses };

    const [users, sectorGroups, positionGroups] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          status: true,
          birth: true,
          admissional: true,
          dismissal: true,
          performanceLevel: true,
          sectorId: true,
          positionId: true,
        },
      }),

      this.prisma.user.groupBy({
        by: ['sectorId'],
        where,
        _avg: { performanceLevel: true },
        _count: { id: true },
      }),

      this.prisma.user.groupBy({
        by: ['positionId'],
        where,
        _count: { id: true },
      }),
    ]);

    const totalEmployees = users.length;
    const activeEmployees = users.filter((u) =>
      ['EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2', 'CONTRACTED'].includes(u.status)
    ).length;
    const onExperiencePeriod = users.filter((u) =>
      ['EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2'].includes(u.status)
    ).length;
    const contracted = users.filter((u) => u.status === 'CONTRACTED').length;
    const dismissed = users.filter((u) => u.status === 'DISMISSED').length;

    const bySector = await Promise.all(
      sectorGroups
        .filter((g) => g.sectorId)
        .map(async (group) => {
          const sector = await this.prisma.sector.findUnique({
            where: { id: group.sectorId! },
            select: { name: true },
          });
          return {
            sectorId: group.sectorId!,
            sectorName: sector?.name || 'Unknown',
            employeeCount: group._count.id,
            avgPerformanceLevel: Math.round((group._avg.performanceLevel || 0) * 10) / 10,
          };
        })
    );

    const byPosition = await Promise.all(
      positionGroups
        .filter((g) => g.positionId)
        .map(async (group) => {
          const position = await this.prisma.position.findUnique({
            where: { id: group.positionId! },
            select: { name: true },
          });
          return {
            positionId: group.positionId!,
            positionName: position?.name || 'Unknown',
            employeeCount: group._count.id,
          };
        })
    );

    const now = new Date();
    const ages = users.filter((u) => u.birth).map((u) => {
      const birthDate = new Date(u.birth);
      return now.getFullYear() - birthDate.getFullYear();
    });
    const averageAge = ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0;

    const tenures = users.filter((u) => u.admissional).map((u) => {
      const admDate = new Date(u.admissional);
      return (now.getTime() - admDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    });
    const averageTenure = tenures.length > 0 ? tenures.reduce((sum, t) => sum + t, 0) / tenures.length : 0;

    const lastYearDismissals = users.filter((u) => {
      if (!u.dismissal) return false;
      const dismissalDate = new Date(u.dismissal);
      return (now.getTime() - dismissalDate.getTime()) / (1000 * 60 * 60 * 24) <= 365;
    }).length;

    const turnoverRate = activeEmployees > 0 ? (lastYearDismissals / activeEmployees) * 100 : 0;

    return {
      totalEmployees,
      activeEmployees,
      onExperiencePeriod,
      contracted,
      dismissed,
      bySector,
      byPosition,
      demographics: {
        averageAge: Math.round(averageAge * 10) / 10,
        averageTenure: Math.round(averageTenure * 10) / 10,
        turnoverRate: Math.round(turnoverRate * 10) / 10,
      },
    };
  }

  async getPerformanceMetrics(query: PerformanceMetricsQueryDto): Promise<PerformanceMetrics> {
    const { sectorId, positionId, topN = 10 } = query;

    const where: any = { performanceLevel: { gt: 0 } };
    if (sectorId) where.sectorId = sectorId;
    if (positionId) where.positionId = positionId;

    const users = await this.prisma.user.findMany({
      where,
      include: {
        position: { select: { name: true } },
        sector: { select: { name: true } },
        createdTasks: {
          where: { status: 'COMPLETED' },
          select: { id: true },
        },
      },
      orderBy: { performanceLevel: 'desc' },
    });

    const avgPerformanceLevel = users.length > 0
      ? users.reduce((sum, u) => sum + u.performanceLevel, 0) / users.length
      : 0;

    const topPerformers = users.slice(0, topN).map((user) => ({
      userId: user.id,
      userName: user.name,
      performanceLevel: user.performanceLevel,
      position: user.position?.name || 'N/A',
      sector: user.sector?.name || 'N/A',
      tasksCompleted: user.createdTasks.length,
    }));

    const sectorMap = new Map<string, any>();
    users.forEach((user) => {
      if (!user.sectorId) return;
      if (!sectorMap.has(user.sectorId)) {
        sectorMap.set(user.sectorId, {
          sectorId: user.sectorId,
          sectorName: user.sector?.name || 'Unknown',
          levels: [],
        });
      }
      sectorMap.get(user.sectorId).levels.push(user.performanceLevel);
    });

    const bySector = Array.from(sectorMap.values()).map((s) => ({
      sectorId: s.sectorId,
      sectorName: s.sectorName,
      averagePerformance: Math.round((s.levels.reduce((a: number, b: number) => a + b, 0) / s.levels.length) * 10) / 10,
      employeeCount: s.levels.length,
    }));

    const levelCounts = [0, 1, 2, 3, 4, 5].map((level) => ({
      level,
      count: users.filter((u) => u.performanceLevel === level).length,
      percentage: (users.filter((u) => u.performanceLevel === level).length / users.length) * 100,
    }));

    return {
      averagePerformanceLevel: Math.round(avgPerformanceLevel * 10) / 10,
      topPerformers,
      bySector,
      distribution: levelCounts,
    };
  }

  async getBonusDistribution(query: BonusDistributionQueryDto): Promise<BonusDistribution> {
    const { year, month, sectorId, topN = 10 } = query;

    const where: any = {};
    if (year) where.year = year;
    if (month) where.month = month;

    const bonuses = await this.prisma.bonus.findMany({
      where,
      include: {
        user: {
          include: {
            sector: { select: { name: true } },
          },
        },
      },
    });

    const totalBonusesPaid = bonuses.reduce((sum, b) => sum + Number(b.baseBonus), 0);
    const employeesReceivingBonus = new Set(bonuses.map((b) => b.userId)).size;
    const averageBonusValue = employeesReceivingBonus > 0 ? totalBonusesPaid / employeesReceivingBonus : 0;

    const periodMap = new Map<string, any>();
    bonuses.forEach((bonus) => {
      const key = `${bonus.year}-${bonus.month}`;
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          year: bonus.year,
          month: bonus.month,
          totalPaid: 0,
          employees: new Set(),
        });
      }
      const period = periodMap.get(key);
      period.totalPaid += Number(bonus.baseBonus);
      period.employees.add(bonus.userId);
    });

    const byPeriod = Array.from(periodMap.values()).map((p) => ({
      year: p.year,
      month: p.month,
      totalPaid: Math.round(p.totalPaid * 100) / 100,
      employeeCount: p.employees.size,
      averageValue: Math.round((p.totalPaid / p.employees.size) * 100) / 100,
    }));

    const sectorMap = new Map<string, any>();
    bonuses.forEach((bonus) => {
      const sectorId = bonus.user.sectorId;
      if (!sectorId) return;
      if (!sectorMap.has(sectorId)) {
        sectorMap.set(sectorId, {
          sectorId,
          sectorName: bonus.user.sector?.name || 'Unknown',
          totalPaid: 0,
          employees: new Set(),
        });
      }
      const sector = sectorMap.get(sectorId);
      sector.totalPaid += Number(bonus.baseBonus);
      sector.employees.add(bonus.userId);
    });

    const bySector = Array.from(sectorMap.values())
      .filter((s) => sectorId ? s.sectorId === sectorId : true)
      .map((s) => ({
        sectorId: s.sectorId,
        sectorName: s.sectorName,
        totalPaid: Math.round(s.totalPaid * 100) / 100,
        employeeCount: s.employees.size,
        averageValue: Math.round((s.totalPaid / s.employees.size) * 100) / 100,
      }));

    const userMap = new Map<string, any>();
    bonuses.forEach((bonus) => {
      if (!userMap.has(bonus.userId)) {
        userMap.set(bonus.userId, {
          userId: bonus.userId,
          userName: bonus.user.name,
          totalReceived: 0,
          bonusCount: 0,
        });
      }
      const user = userMap.get(bonus.userId);
      user.totalReceived += Number(bonus.baseBonus);
      user.bonusCount++;
    });

    const topRecipients = Array.from(userMap.values())
      .sort((a: any, b: any) => b.totalReceived - a.totalReceived)
      .slice(0, topN)
      .map((u: any) => ({
        userId: u.userId,
        userName: u.userName,
        totalReceived: Math.round(u.totalReceived * 100) / 100,
        bonusCount: u.bonusCount,
        averageValue: Math.round((u.totalReceived / u.bonusCount) * 100) / 100,
      }));

    return {
      totalBonusesPaid: Math.round(totalBonusesPaid * 100) / 100,
      averageBonusValue: Math.round(averageBonusValue * 100) / 100,
      employeesReceivingBonus,
      byPeriod,
      bySector,
      topRecipients,
    };
  }

  async getAttendanceTrends(query: AttendanceTrendsQueryDto): Promise<AttendanceTrends> {
    // Simplified - assumes attendance tracking exists
    // TODO: Integrate with actual attendance system
    return {
      totalAttendanceRecords: 0,
      averageAttendanceRate: 95.5,
      absenceRate: 4.5,
      byPeriod: [],
      bySector: [],
    };
  }

  async getWarningAnalytics(query: WarningAnalyticsQueryDto): Promise<WarningAnalytics> {
    const { startDate, endDate, sectorId, severities, categories, topN = 10 } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (severities?.length) where.severity = { in: severities };
    if (categories?.length) where.category = { in: categories };

    const warnings = await this.prisma.warning.findMany({
      where,
      include: {
        collaborator: {
          include: {
            sector: { select: { name: true } },
          },
        },
      },
    });

    const totalWarnings = warnings.length;
    const activeWarnings = warnings.filter((w) => w.isActive).length;
    const resolvedWarnings = warnings.filter((w) => w.resolvedAt).length;

    const severityGroups = warnings.reduce((acc, w) => {
      if (!acc[w.severity]) acc[w.severity] = 0;
      acc[w.severity]++;
      return acc;
    }, {} as Record<string, number>);

    const bySeverity = Object.entries(severityGroups).map(([severity, count]) => ({
      severity,
      count,
      percentage: (count / totalWarnings) * 100,
    }));

    const categoryGroups = warnings.reduce((acc, w) => {
      if (!acc[w.category]) acc[w.category] = 0;
      acc[w.category]++;
      return acc;
    }, {} as Record<string, number>);

    const byCategory = Object.entries(categoryGroups).map(([category, count]) => ({
      category,
      count,
      percentage: (count / totalWarnings) * 100,
    }));

    const trendsMap = warnings.reduce((acc, w) => {
      const period = this.getPeriodKey(w.createdAt, 'month');
      if (!acc[period]) {
        acc[period] = { issued: 0, resolved: 0 };
      }
      acc[period].issued++;
      if (w.resolvedAt) acc[period].resolved++;
      return acc;
    }, {} as Record<string, any>);

    const trends = Object.entries(trendsMap).map(([period, data]: [string, any]) => ({
      period,
      issued: data.issued,
      resolved: data.resolved,
    }));

    const userMap = new Map<string, any>();
    warnings.forEach((w) => {
      const userId = w.collaboratorId;
      if (!userMap.has(userId)) {
        userMap.set(userId, {
          userId,
          userName: w.collaborator.name,
          warningCount: 0,
          sector: w.collaborator.sector?.name || 'N/A',
        });
      }
      userMap.get(userId).warningCount++;
    });

    const repeatOffenders = Array.from(userMap.values())
      .filter((u: any) => u.warningCount > 1)
      .sort((a: any, b: any) => b.warningCount - a.warningCount)
      .slice(0, topN);

    return {
      totalWarnings,
      activeWarnings,
      resolvedWarnings,
      bySeverity,
      byCategory,
      trends,
      repeatOffenders,
    };
  }

  private getPeriodKey(date: Date, period: string): string {
    const d = new Date(date);
    switch (period) {
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      default:
        return d.toISOString().split('T')[0];
    }
  }
}
