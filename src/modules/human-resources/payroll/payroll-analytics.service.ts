import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type {
  PayrollTrendItem,
  PayrollTrendsSummary,
  PayrollTrendsResult,
  PayrollSectorComparison,
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

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
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
export class PayrollAnalyticsService {
  private readonly logger = new Logger(PayrollAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Payroll Trends
  // ---------------------------------------------------------------------------

  async getPayrollTrends(filters: AnalyticsFilters): Promise<PayrollTrendsResult> {
    const { sectorIds, positionIds, periods } = filters;
    const dateRange = this.resolveDateRange(filters);
    const isComparisonBySector = sectorIds && sectorIds.length >= 2;

    // Convert date range to year/month integers
    const startYear = dateRange.start.getFullYear();
    const startMonth = dateRange.start.getMonth() + 1;
    const endYear = dateRange.end.getFullYear();
    const endMonth = dateRange.end.getMonth() + 1;

    // Build user filter for sector/position
    const userWhere: any = {};
    if (sectorIds?.length) userWhere.sectorId = { in: sectorIds };
    if (positionIds?.length) userWhere.positionId = { in: positionIds };

    // Get users matching filters to get their IDs
    let userIds: string[] | undefined;
    if (sectorIds?.length || positionIds?.length) {
      const users = await this.prisma.user.findMany({
        where: userWhere,
        select: { id: true, sectorId: true },
      });
      userIds = users.map((u) => u.id);
    }

    // Fetch payroll records
    const payrollWhere: any = {
      OR: this.buildYearMonthRange(startYear, startMonth, endYear, endMonth),
      ...(userIds && { userId: { in: userIds } }),
    };

    const payrolls = await this.prisma.payroll.findMany({
      where: payrollWhere,
      select: {
        id: true,
        userId: true,
        year: true,
        month: true,
        baseRemuneration: true,
        grossSalary: true,
        netSalary: true,
        inssAmount: true,
        irrfAmount: true,
        fgtsAmount: true,
        totalDiscounts: true,
        overtime50Amount: true,
        overtime100Amount: true,
        nightDifferentialAmount: true,
        user: {
          select: {
            id: true,
            sectorId: true,
          },
        },
      },
    });

    // Fetch bonuses for the same period
    const bonuses = await this.prisma.bonus.findMany({
      where: {
        OR: this.buildYearMonthRange(startYear, startMonth, endYear, endMonth),
        ...(userIds && { userId: { in: userIds } }),
      },
      select: {
        userId: true,
        year: true,
        month: true,
        baseBonus: true,
        netBonus: true,
        user: {
          select: {
            sectorId: true,
          },
        },
      },
    });

    // Group payroll by period
    const byPeriod = new Map<string, typeof payrolls>();
    for (const p of payrolls) {
      const key = monthKey(p.year, p.month);
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key)!.push(p);
    }

    // Group bonuses by period
    const bonusByPeriod = new Map<string, typeof bonuses>();
    for (const b of bonuses) {
      const key = monthKey(b.year, b.month);
      if (!bonusByPeriod.has(key)) bonusByPeriod.set(key, []);
      bonusByPeriod.get(key)!.push(b);
    }

    const allKeys = new Set([...byPeriod.keys(), ...bonusByPeriod.keys()]);
    const sortedKeys = Array.from(allKeys).sort();

    const items: PayrollTrendItem[] = sortedKeys.map((key) => {
      const periodPayrolls = byPeriod.get(key) || [];
      const periodBonuses = bonusByPeriod.get(key) || [];

      const grossSalary = this.sumDecimal(periodPayrolls, 'grossSalary');
      const netSalary = this.sumDecimal(periodPayrolls, 'netSalary');
      const totalDiscounts = this.sumDecimal(periodPayrolls, 'totalDiscounts');
      const inssAmount = this.sumDecimal(periodPayrolls, 'inssAmount');
      const irrfAmount = this.sumDecimal(periodPayrolls, 'irrfAmount');
      const fgtsAmount = this.sumDecimal(periodPayrolls, 'fgtsAmount');
      const overtime50Amount = this.sumDecimal(periodPayrolls, 'overtime50Amount');
      const overtime100Amount = this.sumDecimal(periodPayrolls, 'overtime100Amount');
      const nightDifferentialAmount = this.sumDecimal(periodPayrolls, 'nightDifferentialAmount');
      const bonusTotal = this.sumDecimal(periodBonuses, 'netBonus');

      return {
        period: key,
        label: monthLabel(key),
        grossSalary: this.round2(grossSalary),
        netSalary: this.round2(netSalary),
        totalDiscounts: this.round2(totalDiscounts),
        inssAmount: this.round2(inssAmount),
        irrfAmount: this.round2(irrfAmount),
        fgtsAmount: this.round2(fgtsAmount),
        overtime50Amount: this.round2(overtime50Amount),
        overtime100Amount: this.round2(overtime100Amount),
        nightDifferentialAmount: this.round2(nightDifferentialAmount),
        bonusTotal: this.round2(bonusTotal),
        headcount: periodPayrolls.length,
      };
    });

    // Summary
    const totalGrossSalary = this.round2(this.sumDecimal(payrolls, 'grossSalary'));
    const totalNetSalary = this.round2(this.sumDecimal(payrolls, 'netSalary'));
    const totalDiscounts = this.round2(this.sumDecimal(payrolls, 'totalDiscounts'));
    const totalBonuses = this.round2(this.sumDecimal(bonuses, 'netBonus'));
    const avgGrossSalary = payrolls.length > 0 ? this.round2(totalGrossSalary / payrolls.length) : 0;
    const taxBurdenPercent =
      totalGrossSalary > 0
        ? Math.round((totalDiscounts / totalGrossSalary) * 1000) / 10
        : 0;

    // Month over month growth
    let monthOverMonthGrowth = 0;
    if (items.length >= 2) {
      const lastGross = items[items.length - 1].grossSalary;
      const prevGross = items[items.length - 2].grossSalary;
      if (prevGross > 0) {
        monthOverMonthGrowth = Math.round(((lastGross - prevGross) / prevGross) * 1000) / 10;
      }
    }

    const summary: PayrollTrendsSummary = {
      totalGrossSalary,
      avgGrossSalary,
      taxBurdenPercent,
      totalBonuses,
      monthOverMonthGrowth,
    };

    const result: PayrollTrendsResult = { items, summary };

    // Comparison by sector
    if (isComparisonBySector) {
      const sectors = await this.prisma.sector.findMany({
        where: { id: { in: sectorIds } },
        select: { id: true, name: true },
      });
      const sectorMap = new Map(sectors.map((s) => [s.id, s.name]));

      result.comparison = sectorIds.map((sectorId): PayrollSectorComparison => {
        const sectorPayrolls = payrolls.filter((p) => p.user?.sectorId === sectorId);
        const sectorBonuses = bonuses.filter((b) => b.user?.sectorId === sectorId);

        const gross = this.round2(this.sumDecimal(sectorPayrolls, 'grossSalary'));
        const net = this.round2(this.sumDecimal(sectorPayrolls, 'netSalary'));
        const disc = this.round2(this.sumDecimal(sectorPayrolls, 'totalDiscounts'));
        const bon = this.round2(this.sumDecimal(sectorBonuses, 'netBonus'));

        return {
          sectorId,
          sectorName: sectorMap.get(sectorId) || sectorId,
          totalGrossSalary: gross,
          totalNetSalary: net,
          totalDiscounts: disc,
          totalBonuses: bon,
          headcount: sectorPayrolls.length,
          avgGrossSalary: sectorPayrolls.length > 0 ? this.round2(gross / sectorPayrolls.length) : 0,
        };
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildYearMonthRange(
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number,
  ): any[] {
    const conditions: any[] = [];

    for (let y = startYear; y <= endYear; y++) {
      const mStart = y === startYear ? startMonth : 1;
      const mEnd = y === endYear ? endMonth : 12;
      conditions.push({
        year: y,
        month: { gte: mStart, lte: mEnd },
      });
    }

    return conditions;
  }

  private sumDecimal(records: any[], field: string): number {
    return records.reduce((sum, r) => sum + (r[field] ? Number(r[field]) : 0), 0);
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private resolveDateRange(filters: AnalyticsFilters): { start: Date; end: Date } {
    if (filters.periods && filters.periods.length > 0) {
      const starts = filters.periods.map((p) => p.start.getTime());
      const ends = filters.periods.map((p) => p.end.getTime());
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
