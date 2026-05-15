import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SecullumService } from './secullum.service';
import type {
  AbsenteeismResult,
  AbsenteeismItem,
  AbsenteeismSectorBreakdown,
  AbsenteeismUserBreakdown,
  AbsenteeismSummary,
} from '../../../types/hr-analytics';
import type { AbsenteeismFilters } from '../../../schemas/hr-analytics';

const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Cap concurrent /Calculos calls so a wide sector filter doesn't fan out
// hundreds of simultaneous requests against the upstream Secullum API.
const SECULLUM_FETCH_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

type PeriodBucket = { key: string; label: string; start: Date; end: Date };

type PerUserAggregate = {
  userId: string;
  userName: string;
  sectorId: string | null;
  sectorName: string | null;
  scheduledMinutes: number;
  absenceMinutes: number;
  atrasosMinutes: number;
  faltasJustified: number;
  faltasUnjustified: number;
  atestados: number;
  perMonth: Map<string, {
    scheduledMinutes: number;
    absenceMinutes: number;
    atrasosMinutes: number;
    faltasJustified: number;
    faltasUnjustified: number;
    atestados: number;
  }>;
};

@Injectable()
export class SecullumStatisticsService {
  private readonly logger = new Logger(SecullumStatisticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secullumService: SecullumService,
  ) {}

  async getAbsenteeism(filters: AbsenteeismFilters): Promise<AbsenteeismResult> {
    const dateRange = this.resolveDateRange(filters);
    // Honour explicit business-period buckets from the frontend (26→25) when
    // provided, so the chart's x-axis matches the other statistics pages.
    // Without them we'd fall back to calendar-month bucketing and leak a stub
    // "Dezembro Y-1" column whenever the period start lands on day 26.
    const buckets = this.resolveBuckets(filters, dateRange);

    const userWhere: any = { isActive: true, secullumEmployeeId: { not: null } };
    if (filters.sectorIds?.length) userWhere.sectorId = { in: filters.sectorIds };
    if (filters.positionIds?.length) userWhere.positionId = { in: filters.positionIds };

    const [linkedUsers, allMatchingUsersCount] = await Promise.all([
      this.prisma.user.findMany({
        where: userWhere,
        select: {
          id: true,
          name: true,
          sectorId: true,
          secullumEmployeeId: true,
          sector: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({
        where: (() => {
          const w: any = { isActive: true };
          if (filters.sectorIds?.length) w.sectorId = { in: filters.sectorIds };
          if (filters.positionIds?.length) w.positionId = { in: filters.positionIds };
          return w;
        })(),
      }),
    ]);

    const unmappedUsers = allMatchingUsersCount - linkedUsers.length;

    if (linkedUsers.length === 0) {
      return this.emptyResult(buckets, 0, unmappedUsers);
    }

    const startStr = this.formatDateForSecullum(dateRange.start);
    const endStr = this.formatDateForSecullum(dateRange.end);

    const settled = await mapWithConcurrency(
      linkedUsers,
      SECULLUM_FETCH_CONCURRENCY,
      async (u): Promise<PerUserAggregate | null> => {
        const empId = u.secullumEmployeeId!;
        try {
          const response = await this.secullumService.getCalculations({
            employeeId: String(empId),
            startDate: startStr,
            endDate: endStr,
          });
          if (!response.success || !response.data) return null;
          return this.aggregateUser(u, response.data, buckets);
        } catch (err) {
          this.logger.warn(`Absenteeism /Calculos failed for user ${u.id}: ${this.errMsg(err)}`);
          return null;
        }
      },
    );

    const aggregates: PerUserAggregate[] = settled
      .filter((r): r is PromiseFulfilledResult<PerUserAggregate> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    // Timeseries items
    const items: AbsenteeismItem[] = buckets.map(b => {
      let scheduledMin = 0;
      let absenceMin = 0;
      let atrasosMin = 0;
      let faltasJust = 0;
      let faltasUnjust = 0;
      let atestados = 0;
      const affectedUserSet = new Set<string>();
      for (const agg of aggregates) {
        const monthBucket = agg.perMonth.get(b.key);
        if (!monthBucket) continue;
        scheduledMin += monthBucket.scheduledMinutes;
        absenceMin += monthBucket.absenceMinutes;
        atrasosMin += monthBucket.atrasosMinutes;
        faltasJust += monthBucket.faltasJustified;
        faltasUnjust += monthBucket.faltasUnjustified;
        atestados += monthBucket.atestados;
        if (monthBucket.absenceMinutes > 0 || monthBucket.faltasJustified > 0 || monthBucket.faltasUnjustified > 0) {
          affectedUserSet.add(agg.userId);
        }
      }
      const scheduledHours = scheduledMin / 60;
      const absenceHours = absenceMin / 60;
      const rate = scheduledHours > 0
        ? Math.round((absenceHours / scheduledHours) * 1000) / 10
        : 0;
      return {
        period: b.key,
        label: b.label,
        absenceHours: Math.round(absenceHours * 10) / 10,
        scheduledHours: Math.round(scheduledHours * 10) / 10,
        rate,
        faltasJustified: faltasJust,
        faltasUnjustified: faltasUnjust,
        atestados,
        atrasosMinutes: atrasosMin,
        affectedUsers: affectedUserSet.size,
      };
    });

    // Sector breakdown
    const sectorAggMap = new Map<string, {
      sectorName: string;
      scheduledMin: number;
      absenceMin: number;
      atrasosMin: number;
      faltasJust: number;
      faltasUnjust: number;
      atestados: number;
      affected: Set<string>;
      headcount: Set<string>;
    }>();
    for (const agg of aggregates) {
      const sectorId = agg.sectorId ?? '__unassigned__';
      if (!sectorAggMap.has(sectorId)) {
        sectorAggMap.set(sectorId, {
          sectorName: agg.sectorName ?? 'Sem setor',
          scheduledMin: 0,
          absenceMin: 0,
          atrasosMin: 0,
          faltasJust: 0,
          faltasUnjust: 0,
          atestados: 0,
          affected: new Set(),
          headcount: new Set(),
        });
      }
      const s = sectorAggMap.get(sectorId)!;
      s.scheduledMin += agg.scheduledMinutes;
      s.absenceMin += agg.absenceMinutes;
      s.atrasosMin += agg.atrasosMinutes;
      s.faltasJust += agg.faltasJustified;
      s.faltasUnjust += agg.faltasUnjustified;
      s.atestados += agg.atestados;
      s.headcount.add(agg.userId);
      if (agg.absenceMinutes > 0 || agg.faltasJustified > 0 || agg.faltasUnjustified > 0) {
        s.affected.add(agg.userId);
      }
    }

    const sectorBreakdown: AbsenteeismSectorBreakdown[] = Array.from(sectorAggMap.entries())
      .filter(([sectorId]) => sectorId !== '__unassigned__')
      .map(([sectorId, s]) => {
        const scheduledHours = s.scheduledMin / 60;
        const absenceHours = s.absenceMin / 60;
        return {
          sectorId,
          sectorName: s.sectorName,
          absenceHours: Math.round(absenceHours * 10) / 10,
          scheduledHours: Math.round(scheduledHours * 10) / 10,
          rate: scheduledHours > 0
            ? Math.round((absenceHours / scheduledHours) * 1000) / 10
            : 0,
          faltasJustified: s.faltasJust,
          faltasUnjustified: s.faltasUnjust,
          atestados: s.atestados,
          atrasosMinutes: s.atrasosMin,
          affectedUsers: s.affected.size,
          headcount: s.headcount.size,
        };
      })
      .sort((a, b) => b.rate - a.rate);

    // Top absentees
    const userBreakdown: AbsenteeismUserBreakdown[] = aggregates
      .map(a => {
        const scheduledHours = a.scheduledMinutes / 60;
        const absenceHours = a.absenceMinutes / 60;
        return {
          userId: a.userId,
          userName: a.userName,
          sectorName: a.sectorName,
          absenceHours: Math.round(absenceHours * 10) / 10,
          scheduledHours: Math.round(scheduledHours * 10) / 10,
          rate: scheduledHours > 0
            ? Math.round((absenceHours / scheduledHours) * 1000) / 10
            : 0,
          faltasJustified: a.faltasJustified,
          faltasUnjustified: a.faltasUnjustified,
          atestados: a.atestados,
          atrasosMinutes: a.atrasosMinutes,
        };
      })
      .filter(u => u.absenceHours > 0 || u.atrasosMinutes > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, filters.topN ?? 10);

    // Summary
    const totalScheduledMin = aggregates.reduce((s, a) => s + a.scheduledMinutes, 0);
    const totalAbsenceMin = aggregates.reduce((s, a) => s + a.absenceMinutes, 0);
    const totalAtrasosMin = aggregates.reduce((s, a) => s + a.atrasosMinutes, 0);
    const totalJust = aggregates.reduce((s, a) => s + a.faltasJustified, 0);
    const totalUnjust = aggregates.reduce((s, a) => s + a.faltasUnjustified, 0);
    const totalAtestados = aggregates.reduce((s, a) => s + a.atestados, 0);
    const affectedUserCount = aggregates.filter(
      a => a.absenceMinutes > 0 || a.faltasJustified > 0 || a.faltasUnjustified > 0,
    ).length;

    const scheduledHours = totalScheduledMin / 60;
    const absenceHours = totalAbsenceMin / 60;

    const summary: AbsenteeismSummary = {
      absenceHours: Math.round(absenceHours * 10) / 10,
      scheduledHours: Math.round(scheduledHours * 10) / 10,
      rate: scheduledHours > 0 ? Math.round((absenceHours / scheduledHours) * 1000) / 10 : 0,
      faltasJustified: totalJust,
      faltasUnjustified: totalUnjust,
      atestados: totalAtestados,
      atrasosMinutes: totalAtrasosMin,
      affectedUsers: affectedUserCount,
      totalUsersTracked: aggregates.length,
      unmappedUsers,
    };

    return { summary, items, sectorBreakdown, topAbsentees: userBreakdown };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Aggregates one user's /Calculos response into our shape. Mirrors the
   * column-lookup tolerance already proven in `getUnjustifiedAbsences` — Secullum's
   * Nome/NomeExibicao casing is inconsistent across configurations.
   */
  private aggregateUser(
    user: { id: string; name: string; sectorId: string | null; sector: { id: string; name: string } | null },
    data: any,
    buckets: PeriodBucket[],
  ): PerUserAggregate {
    const colunas: Array<{ Nome?: string; NomeExibicao?: string }> = Array.isArray(data?.Colunas) ? data.Colunas : [];
    const linhas: any[][] = Array.isArray(data?.Linhas) ? data.Linhas : [];

    const findColIdx = (...terms: string[]): number => {
      const lc = terms.map(t => t.toLowerCase());
      for (let i = 0; i < colunas.length; i++) {
        const c = colunas[i] || {};
        const nome = (c.Nome ?? '').toLowerCase();
        const ne = (c.NomeExibicao ?? '').toLowerCase();
        if (lc.some(t => nome === t || ne === t)) return i;
      }
      for (let i = 0; i < colunas.length; i++) {
        const c = colunas[i] || {};
        const nome = (c.Nome ?? '').toLowerCase();
        const ne = (c.NomeExibicao ?? '').toLowerCase();
        if (lc.some(t => nome.includes(t) || ne.includes(t))) return i;
      }
      return -1;
    };

    const dataIdx = findColIdx('data', 'dia');
    const faltasIdx = findColIdx('faltas', 'falta');
    const cargaIdx = findColIdx('carga');
    const normaisIdx = findColIdx('normais', 'horas normais', 'horas trabalhadas');
    const atrasosIdx = findColIdx('atrasos', 'atraso');
    const abonoIdxs: number[] = [];
    for (let i = 0; i < colunas.length; i++) {
      const c = colunas[i] || {};
      const nome = (c.Nome ?? '').toLowerCase();
      const ne = (c.NomeExibicao ?? '').toLowerCase();
      if (/^abono\s*\d*$/.test(nome) || /^abono\s*\d*$/.test(ne)) abonoIdxs.push(i);
    }
    // Atestado-specific column is rare; rely on abono containing "atestad" instead.
    const atestadoSentinelRegex = /atestad/i;

    const agg: PerUserAggregate = {
      userId: user.id,
      userName: user.name,
      sectorId: user.sectorId,
      sectorName: user.sector?.name ?? null,
      scheduledMinutes: 0,
      absenceMinutes: 0,
      atrasosMinutes: 0,
      faltasJustified: 0,
      faltasUnjustified: 0,
      atestados: 0,
      perMonth: new Map(),
    };

    for (const row of linhas) {
      const dateStr = dataIdx >= 0 ? row[dataIdx] : row[0];
      const rowDate = this.parseDateToDate(dateStr);
      // Bucket by actual date range (works for both calendar months and
      // arbitrary 26→25 business periods). Rows outside every bucket — e.g.
      // dates that slipped through the Secullum filter — are skipped.
      const monthKey = rowDate ? this.findBucketKey(rowDate, buckets) : null;
      if (!monthKey) continue;

      const cargaMin = cargaIdx >= 0 ? this.parseDurationMinutes(row[cargaIdx]) : null;
      const faltasMin = faltasIdx >= 0 ? this.parseDurationMinutes(row[faltasIdx]) : null;
      const normaisMin = normaisIdx >= 0 ? this.parseDurationMinutes(row[normaisIdx]) : null;
      const atrasosMin = atrasosIdx >= 0 ? this.parseDurationMinutes(row[atrasosIdx]) : null;

      // Effective absence minutes: prefer explicit Faltas column, else derive
      // from Carga - Normais (Secullum sometimes leaves Faltas blank).
      let effectiveAbsence = 0;
      if (faltasMin != null && faltasMin > 0) {
        effectiveAbsence = faltasMin;
      } else if (
        cargaMin != null && cargaMin > 0 &&
        (normaisMin == null || normaisMin < cargaMin)
      ) {
        effectiveAbsence = cargaMin - (normaisMin ?? 0);
      }

      const hasAbono = abonoIdxs.some(i => {
        const v = row[i];
        return v != null && String(v).trim() !== '';
      });
      const isAtestado = abonoIdxs.some(i => {
        const v = row[i];
        if (v == null) return false;
        return atestadoSentinelRegex.test(String(v));
      });

      const scheduledForRow = cargaMin && cargaMin > 0 ? cargaMin : 0;
      const atrasosForRow = atrasosMin && atrasosMin > 0 ? atrasosMin : 0;
      const justifiedDay = effectiveAbsence > 0 && hasAbono ? 1 : 0;
      const unjustifiedDay = effectiveAbsence > 0 && !hasAbono ? 1 : 0;
      const atestadoDay = effectiveAbsence > 0 && isAtestado ? 1 : 0;

      agg.scheduledMinutes += scheduledForRow;
      agg.absenceMinutes += effectiveAbsence;
      agg.atrasosMinutes += atrasosForRow;
      agg.faltasJustified += justifiedDay;
      agg.faltasUnjustified += unjustifiedDay;
      agg.atestados += atestadoDay;

      if (!agg.perMonth.has(monthKey)) {
        agg.perMonth.set(monthKey, {
          scheduledMinutes: 0,
          absenceMinutes: 0,
          atrasosMinutes: 0,
          faltasJustified: 0,
          faltasUnjustified: 0,
          atestados: 0,
        });
      }
      const m = agg.perMonth.get(monthKey)!;
      m.scheduledMinutes += scheduledForRow;
      m.absenceMinutes += effectiveAbsence;
      m.atrasosMinutes += atrasosForRow;
      m.faltasJustified += justifiedDay;
      m.faltasUnjustified += unjustifiedDay;
      m.atestados += atestadoDay;
    }

    return agg;
  }

  // Parse "HH:MM" / "-HH:MM" / "HH:MM:SS" durations to minutes (signed).
  // Mirrors getUnjustifiedAbsences' parser; sign matters since Ajuste/Saldo
  // columns can be negative.
  private parseDurationMinutes(v: unknown): number | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const m = s.match(/^(-?)(\d+):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }

  // Secullum returns dates as "DD/MM/YYYY - Qua" or "YYYY-MM-DD". Both supported.
  // Parse a row's date string (Secullum returns either DD/MM/YYYY or
  // YYYY-MM-DD) into a JS Date positioned at noon to dodge DST edge cases.
  private parseDateToDate(dateStr: unknown): Date | null {
    if (dateStr == null) return null;
    const s = String(dateStr).trim();
    const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    let y: number, m: number, d: number;
    if (br) {
      d = parseInt(br[1], 10);
      m = parseInt(br[2], 10);
      y = parseInt(br[3], 10);
    } else if (iso) {
      y = parseInt(iso[1], 10);
      m = parseInt(iso[2], 10);
      d = parseInt(iso[3], 10);
    } else {
      return null;
    }
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  // Find the bucket whose [start, end] range contains `date`. Buckets are
  // disjoint by construction (either calendar months or 26→25 business
  // periods), so the first match is the only match.
  private findBucketKey(date: Date, buckets: PeriodBucket[]): string | null {
    const t = date.getTime();
    for (const b of buckets) {
      if (t >= b.start.getTime() && t <= b.end.getTime()) return b.key;
    }
    return null;
  }

  // Choose between explicit business-period buckets (passed from the
  // frontend) and calendar-month buckets (legacy default).
  private resolveBuckets(
    filters: { periods?: Array<{ id?: string; label?: string; startDate?: Date; endDate?: Date }> },
    range: { start: Date; end: Date },
  ): PeriodBucket[] {
    if (filters.periods?.length) {
      const out: PeriodBucket[] = [];
      for (const p of filters.periods) {
        if (!p.startDate || !p.endDate || !p.id || !p.label) continue;
        out.push({
          key: p.id,
          label: p.label,
          start: new Date(p.startDate),
          end: new Date(p.endDate),
        });
      }
      if (out.length) return out;
    }
    return this.buildCalendarMonths(range.start, range.end);
  }

  private formatDateForSecullum(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private buildCalendarMonths(start: Date, end: Date): PeriodBucket[] {
    const buckets: PeriodBucket[] = [];
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
    start.setMonth(start.getMonth() - 6);
    return { start, end };
  }

  private emptyResult(buckets: PeriodBucket[], tracked: number, unmapped: number): AbsenteeismResult {
    return {
      summary: {
        absenceHours: 0,
        scheduledHours: 0,
        rate: 0,
        faltasJustified: 0,
        faltasUnjustified: 0,
        atestados: 0,
        atrasosMinutes: 0,
        affectedUsers: 0,
        totalUsersTracked: tracked,
        unmappedUsers: unmapped,
      },
      items: buckets.map(b => ({
        period: b.key,
        label: b.label,
        absenceHours: 0,
        scheduledHours: 0,
        rate: 0,
        faltasJustified: 0,
        faltasUnjustified: 0,
        atestados: 0,
        atrasosMinutes: 0,
        affectedUsers: 0,
      })),
      sectorBreakdown: [],
      topAbsentees: [],
    };
  }

  private errMsg(err: any): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
