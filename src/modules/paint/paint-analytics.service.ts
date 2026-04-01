import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { PaintAnalyticsFilters } from '../../types/paint-analytics';

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
export class PaintAnalyticsService {
  private readonly logger = new Logger(PaintAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverviewAnalytics(filters: PaintAnalyticsFilters) {
    const dateRange = this.resolveDateRange(filters);
    const { paintTypeIds, paintBrandIds, groupBy = 'month' } = filters;

    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    // Fetch paint productions within the date range
    const productions = await this.prisma.paintProduction.findMany({
      where: {
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        ...(paintTypeIds?.length || paintBrandIds?.length
          ? {
              formula: {
                paint: {
                  ...(paintTypeIds?.length && { paintTypeId: { in: paintTypeIds } }),
                  ...(paintBrandIds?.length && { paintBrandId: { in: paintBrandIds } }),
                },
              },
            }
          : {}),
      },
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
                finish: true,
              },
            },
          },
        },
      },
    });

    // Group by period for volume trend
    const byPeriod = new Map<
      string,
      { count: number; volume: number; totalCost: number }
    >();

    for (const prod of productions) {
      const key = keyFn(prod.createdAt);
      const existing = byPeriod.get(key) || { count: 0, volume: 0, totalCost: 0 };
      existing.count++;
      existing.volume += prod.volumeLiters;
      const pricePerLiter = prod.formula?.pricePerLiter
        ? Number(prod.formula.pricePerLiter)
        : 0;
      existing.totalCost += pricePerLiter * prod.volumeLiters;
      byPeriod.set(key, existing);
    }

    const sortedKeys = Array.from(byPeriod.keys()).sort();
    const items = sortedKeys.map((key) => {
      const data = byPeriod.get(key)!;
      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        productionCount: data.count,
        totalVolumeLiters: Math.round(data.volume * 100) / 100,
        avgCostPerLiter:
          data.volume > 0
            ? Math.round((data.totalCost / data.volume) * 100) / 100
            : 0,
      };
    });

    // Popular paints (top 15)
    const paintAgg = new Map<
      string,
      {
        paintId: string;
        paintName: string;
        hex: string;
        finish: string;
        count: number;
        volume: number;
      }
    >();

    for (const prod of productions) {
      const paint = prod.formula?.paint;
      if (!paint) continue;
      const existing = paintAgg.get(paint.id) || {
        paintId: paint.id,
        paintName: paint.name,
        hex: paint.hex || '',
        finish: paint.finish || '',
        count: 0,
        volume: 0,
      };
      existing.count++;
      existing.volume += prod.volumeLiters;
      paintAgg.set(paint.id, existing);
    }

    const popularPaints = Array.from(paintAgg.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
      .map((p) => ({
        paintId: p.paintId,
        paintName: p.paintName,
        hex: p.hex,
        finish: p.finish,
        productionCount: p.count,
        totalVolumeLiters: Math.round(p.volume * 100) / 100,
      }));

    // Summary
    const totalProductions = productions.length;
    const totalVolumeLiters =
      Math.round(
        productions.reduce((sum, p) => sum + p.volumeLiters, 0) * 100,
      ) / 100;

    const totalCost = productions.reduce((sum, p) => {
      const price = p.formula?.pricePerLiter
        ? Number(p.formula.pricePerLiter)
        : 0;
      return sum + price * p.volumeLiters;
    }, 0);

    const avgCostPerLiter =
      totalVolumeLiters > 0
        ? Math.round((totalCost / totalVolumeLiters) * 100) / 100
        : 0;

    const mostUsedPaint =
      popularPaints.length > 0 ? popularPaints[0].paintName : '-';

    return {
      summary: {
        totalProductions,
        totalVolumeLiters,
        avgCostPerLiter,
        mostUsedPaint,
      },
      items,
      popularPaints,
    };
  }

  private resolveDateRange(filters: PaintAnalyticsFilters): {
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
