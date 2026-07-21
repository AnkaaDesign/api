import { Injectable, Logger } from '@nestjs/common';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { getBonusPeriodStart, getBonusPeriodEnd } from '../../../utils/bonus';
import { SecullumCalculationData } from '@modules/integrations/secullum/dto';

// =====================
// Types
// =====================

interface DayAnalysis {
  date: string;
  isWorkingDay: boolean;
  isHoliday: boolean; // NEW: Track if day is a holiday
  hasAllFourStamps: boolean;
  allStampsElectronic: boolean;
  // True when Entrada1 was punched more than 5 minutes after the scheduled start
  // (Secullum Horário). Such a day does not earn its +1% assiduidade.
  isLateEntry1: boolean;
  isAtestado: boolean;
  atestadoProportion: number; // 0, 0.5, or 1 (half-day or full-day atestado)
  isUnjustifiedAbsence: boolean;
  atestadoHours: number;
  unjustifiedAbsenceHours: number;
  stamps: {
    entrada1: string | null;
    saida1: string | null;
    entrada2: string | null;
    saida2: string | null;
  };
  origens: {
    origemEntrada1: number | null;
    origemSaida1: number | null;
    origemEntrada2: number | null;
    origemSaida2: number | null;
  };
}

export interface SecullumBonusAnalysis {
  userId: string;
  totalWorkingDays: number; // Working days in period (excluding holidays and weekends)
  daysWithFullElectronicStamps: number;
  incorrectlyStampedDays: number; // NEW: Days without correct stamps (working days - correct days)
  extraPercentage: number; // NEW LOGIC: totalWorkingDays - incorrectlyStampedDays
  atestadoHours: number;
  unjustifiedAbsenceHours: number;
  atestadoDiscountPercentage: number;
  unjustifiedDiscountPercentage: number;
  atestadoTierLabel: string;
  unjustifiedTierLabel: string;
  losesExtra: boolean;
  // First-offense forgiveness: true when this period's atestado penalty was waived
  // because the user had no atestado in the prior rolling 90 days.
  atestadoForgiven?: boolean;
  dailyBreakdown: DayAnalysis[];
  holidaysCount: number; // NEW: Number of holidays in period
  // Secullum calculated totals (from /Calculos endpoint)
  secullumFaltasTotal: string | null;
  secullumAtrasosTotal: string | null;
}

/**
 * Result envelope for analyzeAllUsers().
 *
 * Distinguishes between:
 *   - Service-wide failure (auth/network/total outage) — `secullumAvailable=false`,
 *     callers must NOT silently zero discounts.
 *   - Per-user failure (one user errored, but the API is up) — `secullumAvailable=true`
 *     with `failedUsers` populated. Callers may continue.
 *
 * The audit identified that swallowing a service-wide failure as "no discount"
 * over-pays employees on payroll. This shape forces callers to handle the
 * unavailable case explicitly.
 */
export interface AnalyzeAllUsersResult {
  perUser: Map<string, SecullumBonusAnalysis>;
  metadata: {
    secullumAvailable: boolean;
    failedUsers: string[];
    totalUsers: number;
    error?: string;
  };
}

// Standard workday duration in hours
const WORKDAY_HOURS = 8;

// Graded assiduidade-loss tiers. The accumulated +1%/day assiduidade extra is
// eroded by the worst absence in the period:
//   'none'        → keep the full extra
//   'perde-o-dia' → lose just that day's 1% (extra − 1)
//   'half'        → lose 50% of the accumulated extra
//   'full'        → lose all of it
type AssiduidadeLoss = 'none' | 'perde-o-dia' | 'half' | 'full';
const ASSIDUIDADE_LOSS_SEVERITY: Record<AssiduidadeLoss, number> = {
  none: 0,
  'perde-o-dia': 1,
  half: 2,
  full: 3,
};

@Injectable()
export class SecullumBonusIntegrationService {
  private readonly logger = new Logger(SecullumBonusIntegrationService.name);

  // In-memory circuit breaker. Three consecutive service-wide failures opens the
  // breaker for 60s — subsequent analyzeAllUsers() calls short-circuit without
  // hitting Secullum. Self-contained per-instance; resets on app restart.
  private breaker = { failures: 0, openUntil: 0 };

  constructor(
    private readonly secullumService: SecullumService,
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  private isBreakerOpen(): boolean {
    return Date.now() < this.breaker.openUntil;
  }

  private recordBreakerFailure(): void {
    this.breaker.failures += 1;
    if (this.breaker.failures >= 3) {
      this.breaker.openUntil = Date.now() + 60_000; // 1 minute open window
      this.breaker.failures = 0;
      this.logger.warn(
        'Secullum breaker OPEN for 60s — recent consecutive failures exceeded threshold',
      );
      // Alert HR/Financial/Admin that payroll-affecting Secullum data is
      // degraded. Emitting only on breaker-OPEN (not per failure) naturally
      // rate-limits this to at most once per 60s window, avoiding spam during
      // the frequent live-bonus pre-warm cron.
      this.emitDataDegraded(
        'A integração de bônus com a Secullum está indisponível (falhas consecutivas). Os cálculos de folha podem estar degradados.',
      );
    }
  }

  /** Fire-and-forget URGENT alert; never blocks the bonus calculation flow. */
  private emitDataDegraded(reason: string): void {
    void this.dispatchService
      .dispatchByConfiguration('secullum.payroll.dataDegraded', 'system', {
        entityType: 'SecullumPayroll',
        entityId: 'bonus-integration',
        action: 'data_degraded',
        data: { source: 'bonus', reason },
        overrides: {
          title: 'Dados de folha degradados (Secullum)',
          body: reason,
          webUrl: '/departamento-pessoal/bonus',
          mobileUrl: '/(tabs)/departamento-pessoal/folha-de-pagamento',
          relatedEntityType: 'SECULLUM_PAYROLL',
        },
      })
      .catch((err) =>
        this.logger.error(
          `Notification dispatch failed for "secullum.payroll.dataDegraded": ${(err as Error).message}`,
        ),
      );
  }

  private recordBreakerSuccess(): void {
    this.breaker.failures = 0;
    this.breaker.openUntil = 0;
  }

  /**
   * Analyze all bonifiable users' Secullum time entries for bonus extras/discounts.
   *
   * Returns a structured result so callers can distinguish:
   *   - Service-wide failure (auth/network/total outage) → `secullumAvailable=false`,
   *     `perUser` empty. Callers MUST refuse to persist payroll-affecting data.
   *   - Per-user failure → `secullumAvailable=true`, user listed in `failedUsers`.
   *     Callers may continue (that user simply has no Secullum-based discount).
   */
  async analyzeAllUsers(
    year: number,
    month: number,
    users: Array<{
      id: string;
      name: string;
      secullumEmployeeId: number;
    }>,
  ): Promise<AnalyzeAllUsersResult> {
    const results = new Map<string, SecullumBonusAnalysis>();
    const failedUsers: string[] = [];
    const totalUsers = users.length;

    // Short-circuit when breaker is open — avoids hammering a known-down service.
    if (this.isBreakerOpen()) {
      const msToOpen = this.breaker.openUntil - Date.now();
      const error = `Circuit open — recent failures, retrying in ${Math.ceil(msToOpen / 1000)}s`;
      this.logger.warn(`Secullum breaker open, skipping analyzeAllUsers (${error})`);
      return {
        perUser: results,
        metadata: { secullumAvailable: false, failedUsers, totalUsers, error },
      };
    }

    const periodStart = getBonusPeriodStart(year, month);
    const periodEnd = getBonusPeriodEnd(year, month);

    // Format dates for Secullum API (yyyy-MM-dd)
    const startDate = this.formatDateForSecullum(periodStart);
    const endDate = this.formatDateForSecullum(periodEnd);

    this.logger.log(
      `Analyzing Secullum time entries for ${users.length} users, period ${startDate} to ${endDate}`,
    );

    // Probe Secullum availability up front so callers can refuse to persist
    // payroll-affecting data when Secullum is down. A single cheap getEmployees()
    // call doubles as the breaker probe.
    let employeesData: any[] = [];
    try {
      const probe = await this.secullumService.getEmployees();
      if (!probe.success) {
        const error = 'Secullum unavailable (employees probe returned non-success)';
        this.logger.error(error);
        this.recordBreakerFailure();
        return {
          perUser: results,
          metadata: { secullumAvailable: false, failedUsers, totalUsers, error },
        };
      }
      employeesData = Array.isArray(probe.data) ? probe.data : [];
    } catch (error) {
      const message = `Secullum unavailable (employees probe failed): ${error?.message || error}`;
      this.logger.error(message);
      this.recordBreakerFailure();
      return {
        perUser: results,
        metadata: { secullumAvailable: false, failedUsers, totalUsers, error: message },
      };
    }

    // Fetch holidays for the period from Secullum
    const holidays = await this.getHolidaysForPeriod(periodStart, periodEnd);
    this.logger.log(`Loaded ${holidays.length} holidays for period ${startDate} to ${endDate}`);

    // Fetch the company-wide map of approved & justified time-adjustment requests
    // once per period. Used so a day fixed by a justified correction still earns
    // its +1% assiduidade. Fail-safe: an empty map (on error) grants no exemption.
    const justifiedCorrectionDaysByEmployee = await this.getJustifiedCorrectionDaysMap(
      startDate,
      endDate,
    );

    // Resolve each employee's scheduled Entrada1 (per weekday) from Secullum Horários
    // so we can detect an atraso on the first punch (> scheduled + 5 min).
    const expectedEntry1ByEmployee = await this.getExpectedEntry1Map(employeesData, users);

    for (const user of users) {
      try {
        const analysis = await this.analyzeUser(
          user,
          startDate,
          endDate,
          holidays,
          justifiedCorrectionDaysByEmployee.get(user.secullumEmployeeId) ?? new Set(),
          expectedEntry1ByEmployee.get(user.secullumEmployeeId) ?? new Map(),
        );
        if (analysis) {
          results.set(user.id, analysis);
        }
      } catch (error) {
        failedUsers.push(user.id);
        this.logger.warn(
          `Failed to analyze Secullum data for user ${user.name} (${user.id}): ${error?.message || error}`,
        );
      }
    }

    // Service-wide signal: if every user errored, treat as unavailable so callers
    // refuse to persist a payroll-affecting calculation. (Empty input list is a
    // no-op, not a failure — secullumAvailable stays true.)
    if (totalUsers > 0 && failedUsers.length === totalUsers) {
      const error = `All ${totalUsers} users failed Secullum analysis — treating service as unavailable`;
      this.logger.error(error);
      this.recordBreakerFailure();
      return {
        perUser: results,
        metadata: { secullumAvailable: false, failedUsers, totalUsers, error },
      };
    }

    this.recordBreakerSuccess();
    this.logger.log(`Secullum analysis completed: ${results.size}/${users.length} users analyzed`);
    return {
      perUser: results,
      metadata: { secullumAvailable: true, failedUsers, totalUsers },
    };
  }

  /**
   * Fetch holidays for the bonus period from Secullum API.
   */
  private async getHolidaysForPeriod(startDate: Date, endDate: Date): Promise<Date[]> {
    const holidays: Date[] = [];
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    // Fetch holidays for each year in the period (handles year transitions)
    for (let year = startYear; year <= endYear; year++) {
      try {
        const response = await this.secullumService.getHolidays({ year });

        if (response.success && Array.isArray(response.data)) {
          for (const holiday of response.data) {
            const holidayDate = new Date(holiday.Data);

            // Only include holidays within the bonus period
            if (holidayDate >= startDate && holidayDate <= endDate) {
              holidays.push(holidayDate);
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch holidays for year ${year}: ${error?.message || error}`);
        // Continue with other years - don't fail entire calculation
      }
    }

    return holidays;
  }

  /**
   * Build a per-employee set of calendar days (yyyy-MM-dd) that carry an
   * APPROVED and JUSTIFIED time-adjustment request (a stamp correction backed by
   * an atestado/foto or a written justificativa). Such a day, even though its
   * stamps are manual (not electronic), should still earn its +1% assiduidade —
   * the employee did the right thing and justified the correction.
   *
   * Fail-safe: any fetch error yields an EMPTY map so no exemption is granted
   * (mirrors the conservative posture of hasAtestadoInPriorNinetyDays). We never
   * silently hand out assiduidade for unjustified corrections on a Secullum
   * outage.
   */
  private async getJustifiedCorrectionDaysMap(
    startDate: string,
    endDate: string,
  ): Promise<Map<number, Set<string>>> {
    const map = new Map<number, Set<string>>();
    try {
      const response = await this.secullumService.getRequests(false, {
        startDate,
        endDate,
        quantidade: 1000,
      });
      if (!response.success || !Array.isArray(response.data)) {
        this.logger.warn(
          `Justified-correction fetch returned no usable data (${response.message ?? 'unknown'}) — no exemptions granted`,
        );
        return map;
      }

      for (const req of response.data) {
        // Estado 1 = APROVADA. Only approved corrections count.
        if (req?.Estado !== 1) continue;
        // Justified = an atestado/photo is attached OR a written justificativa/obs exists.
        const hasFoto = req?.SolicitacaoFotoId != null;
        const hasJustificativa = !!(req?.Justificativa?.trim() || req?.Observacoes?.trim());
        if (!hasFoto && !hasJustificativa) continue;

        const employeeId = Number(req?.FuncionarioId);
        const dayKey = this.normalizeDateKey(req?.Data);
        if (!employeeId || !dayKey) continue;
        // Only days inside the period.
        if (dayKey < startDate || dayKey > endDate) continue;

        let set = map.get(employeeId);
        if (!set) {
          set = new Set<string>();
          map.set(employeeId, set);
        }
        set.add(dayKey);
      }

      this.logger.log(
        `Loaded justified corrections for ${map.size} employees in period ${startDate}..${endDate}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to load justified corrections — no exemptions granted: ${error?.message || error}`,
      );
    }
    return map;
  }

  /**
   * Build a per-employee map of scheduled Entrada1 (minutes since midnight) keyed
   * by weekday (0=Sun..6=Sat), resolved from the employee's Secullum Horário. Used
   * to detect an atraso on the first punch (Entrada1 > scheduled + 5 min), which
   * costs that day's +1% assiduidade.
   *
   * `employeesData` is the already-fetched /Funcionarios probe payload (each item
   * carries Id + HorarioId), so no extra employee fetch is needed — only one
   * getHorarioRawById per DISTINCT schedule among the bonus users.
   *
   * Fail-safe: any error yields an empty inner map for the affected employees, so
   * lateness is simply not detected (the day is treated as on-time) rather than
   * wrongly penalized.
   */
  private async getExpectedEntry1Map(
    employeesData: any[],
    users: Array<{ secullumEmployeeId: number }>,
  ): Promise<Map<number, Map<number, number>>> {
    const result = new Map<number, Map<number, number>>();
    try {
      // empId → horarioId from the probe payload.
      const empToHorario = new Map<number, number>();
      for (const emp of Array.isArray(employeesData) ? employeesData : []) {
        const empId = Number(emp?.Id);
        const horarioId = Number(emp?.HorarioId);
        if (empId && horarioId) empToHorario.set(empId, horarioId);
      }

      // Distinct schedules actually needed for this period's users.
      const neededHorarioIds = new Set<number>();
      for (const u of users) {
        const hId = empToHorario.get(u.secullumEmployeeId);
        if (hId) neededHorarioIds.add(hId);
      }

      // Fetch each distinct schedule once → weekday → Entrada1 minutes.
      const horarioWeekday = new Map<number, Map<number, number>>();
      for (const horarioId of neededHorarioIds) {
        try {
          const raw = await this.secullumService.getHorarioRawById(horarioId);
          const byWeekday = new Map<number, number>();
          for (const dia of raw?.Dias ?? []) {
            const minutes = this.parseStampMinutes(dia?.Entrada1 ?? null);
            if (dia && typeof dia.DiaSemana === 'number' && minutes != null) {
              byWeekday.set(dia.DiaSemana, minutes);
            }
          }
          horarioWeekday.set(horarioId, byWeekday);
        } catch (err) {
          this.logger.warn(
            `Failed to load schedule ${horarioId} — entry-1 lateness not detected for it: ${err?.message || err}`,
          );
        }
      }

      // Project onto each employee.
      for (const u of users) {
        const hId = empToHorario.get(u.secullumEmployeeId);
        const byWeekday = hId ? horarioWeekday.get(hId) : undefined;
        if (byWeekday && byWeekday.size > 0) result.set(u.secullumEmployeeId, byWeekday);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to build expected Entrada1 map — entry-1 lateness not detected: ${error?.message || error}`,
      );
    }
    return result;
  }

  /**
   * Analyze a single user's time entries.
   */
  private async analyzeUser(
    user: {
      id: string;
      name: string;
      secullumEmployeeId: number;
    },
    startDate: string,
    endDate: string,
    holidays: Date[] = [],
    justifiedCorrectionDays: Set<string> = new Set(),
    expectedEntry1ByWeekday: Map<number, number> = new Map(),
  ): Promise<SecullumBonusAnalysis | null> {
    const secullumEmployeeId = user.secullumEmployeeId;

    // Fetch time entries (Batidas) for electronic stamp detection.
    // Uses the day-granular Redis cache — past days hit Redis instead of Secullum HTTPS.
    let entries: any[] = [];
    try {
      entries = await this.secullumService.getTimeEntriesBySecullumIdCached(
        secullumEmployeeId,
        startDate,
        endDate,
      );
    } catch (error) {
      this.logger.warn(
        `Batidas API failed for ${user.name} (secullumId=${secullumEmployeeId}): ${error?.message || error}`,
      );
      return null;
    }

    if (entries.length === 0) {
      this.logger.warn(`No time entries found for user ${user.name} (${user.id})`);
      return null;
    }

    // Fetch calculations (Calculos) for Faltas and Atrasos totals
    let calculationData: SecullumCalculationData | null = null;
    try {
      calculationData = await this.secullumService.getCalculationsBySecullumId(
        secullumEmployeeId,
        startDate,
        endDate,
      );
    } catch (error) {
      this.logger.warn(`Calculos API failed for ${user.name}: ${error?.message || error}`);
      // Continue — we'll fall back to manual counting if Calculos unavailable
    }

    // Parse Faltas and Atrasos from Calculos endpoint — plus per-day maps so we
    // can attribute the authoritative hours to specific calendar days below.
    const { faltasTotal, atrasosTotal, dailyCargaHours, perDayFaltas, perDayAtrasos, perDayAbono } =
      this.parseCalculationTotals(calculationData);

    // Secullum's Totais.Faltas includes today's partial-day shortfall — e.g. the user
    // clocked the morning (07:15-11:31) and is still in the afternoon break; Secullum
    // already attributes the open afternoon as Faltas against the schedule. Using
    // Totais as the discount basis would penalize a user for a day that hasn't closed.
    // Instead we sum only past-day entries from the per-day map, yielding a total that
    // matches the day list we display and the tiered discount we apply. Today/future
    // are naturally excluded.
    const _nowForTotals = new Date();
    const _todayKey = `${_nowForTotals.getFullYear()}-${String(
      _nowForTotals.getMonth() + 1,
    ).padStart(2, '0')}-${String(_nowForTotals.getDate()).padStart(2, '0')}`;
    let faltasHours = 0;
    let atrasosHours = 0;
    for (const [dateKey, hrs] of perDayFaltas.entries()) {
      if (dateKey < _todayKey) faltasHours += hrs;
    }
    for (const [dateKey, hrs] of perDayAtrasos.entries()) {
      if (dateKey < _todayKey) atrasosHours += hrs;
    }
    faltasHours = Math.round(faltasHours * 100) / 100;
    atrasosHours = Math.round(atrasosHours * 100) / 100;

    // Determine actual workday hours from Carga (e.g., 8:45 = 8.75h instead of assumed 8h)
    const actualWorkdayHours = dailyCargaHours > 0 ? dailyCargaHours : WORKDAY_HOURS;

    this.logger.log(
      `User ${user.name}: Secullum Calculos → Faltas=${faltasTotal}, Atrasos=${atrasosTotal} (parsed: faltasH=${faltasHours}, atrasosH=${atrasosHours}, workdayH=${actualWorkdayHours})`,
    );

    // Analyze each day from Batidas for electronic stamp detection
    const dailyBreakdown: DayAnalysis[] = [];
    let totalWorkingDays = 0;
    let daysWithFullElectronicStamps = 0;
    let atestadoDayEquivalent = 0; // sum of proportions (0.5 for half-day, 1 for full-day)
    let manualUnjustifiedHours = 0;

    // Any entry on or after today is today/future and must not be scored yet. We
    // keep those in the breakdown for display but exclude them from totals so e.g.
    // 23/04 doesn't shrink extra% on 22/04. Compared as 'YYYY-MM-DD' strings via
    // normalizeDateKey (which handles Secullum's DD/MM/YYYY too) so the guard
    // can't misfire on a date format that raw `new Date()` would reject.
    for (const entry of entries) {
      const dayAnalysis = this.analyzeDay(entry, holidays);

      const entryKey = this.normalizeDateKey(dayAnalysis.date);
      const entryDate = entryKey ? new Date(`${entryKey}T00:00:00`) : new Date(dayAnalysis.date);
      const isTodayOrFuture = entryKey ? entryKey >= _todayKey : false;

      // Reconcile the day against Secullum /Calculos, which authoritatively
      // decomposes it into worked / justified (abono) / unjustified (falta+atraso).
      // ONE day can carry BOTH a justified and an unjustified portion (e.g. morning
      // atestado + afternoon early-leave) — we surface each on its own line rather
      // than absorbing the whole day into a single bucket.
      if (!isTodayOrFuture && dayAnalysis.isWorkingDay) {
        const dateKey = this.normalizeDateKey(dayAnalysis.date);
        const abonoDay = dateKey ? (perDayAbono.get(dateKey) ?? 0) : 0;
        const faltaDay = dateKey
          ? Math.round(
              ((perDayFaltas.get(dateKey) ?? 0) + (perDayAtrasos.get(dateKey) ?? 0)) * 100,
            ) / 100
          : 0;

        if (calculationData) {
          // JUSTIFIED portion. A full-day atestado returns EMPTY /Batidas stamps
          // so analyzeDay missed it — flip the day to atestado when /Calculos
          // reports abono. For ANY atestado day (full-day reclassified here OR a
          // partial analyzeDay already caught via the code text), drive the hours
          // from the AUTHORITATIVE abono so the per-day display and the tier total
          // agree (analyzeDay's flat 8h × {0.5|1} estimate drifts from real Carga).
          if (abonoDay > 0) {
            dayAnalysis.isAtestado = true;
            dayAnalysis.atestadoProportion =
              actualWorkdayHours > 0 ? Math.min(1, abonoDay / actualWorkdayHours) : 1;
            dayAnalysis.atestadoHours = Math.round(abonoDay * 100) / 100;
          }
          // UNJUSTIFIED portion (independent of the above — a day can have both).
          // Secullum is authoritative: SET the real shortfall, else CLEAR any
          // local no-stamp false positive so the day list matches the discount
          // TOTAL (itself summed from perDayFaltas+perDayAtrasos).
          dayAnalysis.unjustifiedAbsenceHours = faltaDay;
          dayAnalysis.isUnjustifiedAbsence = faltaDay > 0;
        } else if (faltaDay > 0) {
          // No /Calculos (fallback): keep the override only when it adds signal;
          // never clear without an authoritative source.
          dayAnalysis.unjustifiedAbsenceHours = faltaDay;
          dayAnalysis.isUnjustifiedAbsence = true;
        }
      }

      dailyBreakdown.push(dayAnalysis);

      // Only count working days (Mon-Fri, excluding holidays) AND only if the
      // day has closed. Today/future are kept in the breakdown but skipped here.
      if (dayAnalysis.isWorkingDay && !isTodayOrFuture) {
        totalWorkingDays++;

        // Atraso on the first punch: Entrada1 punched > scheduled + 5 min. Resolved
        // from Secullum's Horário (only Entrada1 counts — not the post-lunch return).
        if (dayAnalysis.hasAllFourStamps && expectedEntry1ByWeekday.size > 0) {
          const weekday = entryDate.getDay();
          const expected = expectedEntry1ByWeekday.get(weekday);
          const actual = this.parseStampMinutes(dayAnalysis.stamps.entrada1);
          if (
            expected != null &&
            actual != null &&
            actual > expected + SecullumBonusIntegrationService.ENTRY1_LATE_TOLERANCE_MIN
          ) {
            dayAnalysis.isLateEntry1 = true;
          }
        }

        // A day earns its +1% when all 4 stamps are present, the first punch is on
        // time, AND the stamps are either fully electronic or fixed by an approved &
        // justified adjustment (atestado/justificative). A justified correction keeps
        // the assiduidade — it must not be counted wrongly against the employee.
        const dayKey = this.normalizeDateKey(dayAnalysis.date);
        const isJustifiedCorrection = !!dayKey && justifiedCorrectionDays.has(dayKey);
        // A day with a Secullum-reported atraso/falta (long lunch / early leave,
        // captured by the per-day Atrasos+Faltas override above as
        // `isUnjustifiedAbsence`) is NOT a clean day even when it carries 4
        // on-time electronic stamps. Excluding it here keeps the +1%/day reward
        // consistent with the `perde-o-dia` assiduidade tier — otherwise the day
        // would earn +1% that `perde-o-dia` (which subtracts nothing by design)
        // never removes, double-rewarding a day that actually had a delay. A
        // justified correction (approved Secullum request) still keeps the day.
        if (
          dayAnalysis.hasAllFourStamps &&
          ((dayAnalysis.allStampsElectronic &&
            !dayAnalysis.isLateEntry1 &&
            !dayAnalysis.isUnjustifiedAbsence) ||
            isJustifiedCorrection)
        ) {
          daysWithFullElectronicStamps++;
        }

        if (dayAnalysis.isAtestado) {
          atestadoDayEquivalent += dayAnalysis.atestadoProportion;
        } else if (dayAnalysis.unjustifiedAbsenceHours > 0) {
          manualUnjustifiedHours += dayAnalysis.unjustifiedAbsenceHours;
        }
      }
    }

    // ATESTADO hours: sum of day proportions × actual daily Carga
    // e.g., 2 half-days (0.5+0.5=1) × 8.75h = 8.75h
    const totalAtestadoHours = Math.round(atestadoDayEquivalent * actualWorkdayHours * 100) / 100;

    let totalUnjustifiedAbsenceHours: number;
    if (calculationData) {
      // Use Secullum's calculated Faltas + Atrasos as the authoritative unjustified total
      totalUnjustifiedAbsenceHours = Math.round((faltasHours + atrasosHours) * 100) / 100;
    } else {
      totalUnjustifiedAbsenceHours = manualUnjustifiedHours;
    }

    // Calculate discount percentages from tiers
    let atestadoDiscountPercentage = this.getAtestadoDiscountPercentage(totalAtestadoHours);
    const unjustifiedDiscountPercentage = this.getUnjustifiedDiscountPercentage(
      totalUnjustifiedAbsenceHours,
    );

    // Get tier labels for display
    const atestadoTierLabel = this.getAtestadoTierLabel(totalAtestadoHours);
    const unjustifiedTierLabel = this.getUnjustifiedTierLabel(totalUnjustifiedAbsenceHours);

    // Graded assiduidade-loss tiers per source (none / perde-o-dia / half / full).
    let atestadoAssiduidadeLoss = this.getAtestadoAssiduidadeLoss(totalAtestadoHours);
    const unjustifiedAssiduidadeLoss =
      this.getUnjustifiedAssiduidadeLoss(totalUnjustifiedAbsenceHours);

    // First-offense forgiveness — waive the atestado-derived penalty when the user had
    // no atestado in the rolling 90 days ending the day before periodStart. Unjustified
    // absences are unaffected. On Secullum fetch error, hasAtestadoInPriorNinetyDays
    // returns true (no forgiveness) — see that method's fail-safe behavior.
    let atestadoForgiven = false;
    if (totalAtestadoHours > 0) {
      const periodStartDate = new Date(startDate);
      const hadPriorAtestado = await this.hasAtestadoInPriorNinetyDays(
        secullumEmployeeId,
        periodStartDate,
      );
      if (!hadPriorAtestado) {
        atestadoForgiven = true;
        atestadoDiscountPercentage = 0;
        atestadoAssiduidadeLoss = 'none';
        this.logger.log(
          `Atestado forgiveness applied for user ${user.name} (${user.id}) — no atestado in prior 90 days`,
        );
      }
    }

    // The worst of the two sources drives the assiduidade loss.
    const assiduidadeLoss = this.worstAssiduidadeLoss(
      atestadoAssiduidadeLoss,
      unjustifiedAssiduidadeLoss,
    );
    const losesExtra = assiduidadeLoss !== 'none';

    // Assiduidade accrues +1% per closed working day with all 4 valid stamps —
    // either fully electronic, or manually corrected via an approved & justified
    // adjustment (atestado/justificative; see justifiedCorrectionDays). The graded
    // loss tier then erodes the accumulated extra.
    const incorrectlyStampedDays = totalWorkingDays - daysWithFullElectronicStamps;
    const fullExtra = Math.max(0, totalWorkingDays - incorrectlyStampedDays);
    const extraPercentage = this.applyAssiduidadeLoss(fullExtra, assiduidadeLoss);

    this.logger.log(
      `User ${user.name}: workingDays=${totalWorkingDays}, holidays=${holidays.length}, electronicDays=${daysWithFullElectronicStamps}, ` +
        `incorrectDays=${incorrectlyStampedDays}, fullExtra=${fullExtra}%, extraPct=${extraPercentage}% (loss=${assiduidadeLoss}), ` +
        `atestadoH=${totalAtestadoHours}, unjustifiedH=${totalUnjustifiedAbsenceHours}, ` +
        `atestadoDiscount=${atestadoDiscountPercentage}% (${atestadoTierLabel}), unjustifiedDiscount=${unjustifiedDiscountPercentage}% (${unjustifiedTierLabel}), losesExtra=${losesExtra}`,
    );

    return {
      userId: user.id,
      totalWorkingDays,
      daysWithFullElectronicStamps,
      incorrectlyStampedDays,
      extraPercentage,
      atestadoHours: totalAtestadoHours,
      unjustifiedAbsenceHours: totalUnjustifiedAbsenceHours,
      atestadoDiscountPercentage,
      unjustifiedDiscountPercentage,
      atestadoTierLabel,
      unjustifiedTierLabel,
      losesExtra,
      atestadoForgiven,
      dailyBreakdown,
      holidaysCount: holidays.length,
      secullumFaltasTotal: faltasTotal,
      secullumAtrasosTotal: atrasosTotal,
    };
  }

  // Bump this when the prior-window detection logic changes so all previously
  // cached verdicts (which may have been computed with the OLD logic — e.g.
  // ATEST-only, before DECL/óbito counted) are abandoned instead of served
  // stale. v2: periodStart-anchored window + /Calculos scan + DECL/óbito.
  private static readonly ATESTADO_90D_CACHE_VERSION = 'v2';

  /**
   * Whether the user had any JUSTIFIED absence (atestado / declaração / óbito)
   * in the 90 days before periodStart. First-offense forgiveness waives the
   * current period's atestado penalty only when this is FALSE.
   *
   * Window: [periodStart - 90d, periodStart - 1d] — anchored on periodStart (NOT
   * today) so the verdict is stable/reproducible and matches the periodStart-only
   * cache key.
   *
   * Detection uses BOTH Secullum sources, because neither alone is complete:
   *   • /Batidas — a PARTIAL justified absence carries the code text in its
   *     punch columns.
   *   • /Calculos — a FULL-DAY justified absence returns EMPTY /Batidas stamps,
   *     but surfaces here as ATEST/DECL/ÓBITO text / a positive Abono
   *     (perDayAbono). Without this, a full-day prior atestado is invisible and
   *     forgiveness is wrongly granted.
   *
   * Caching: a positive verdict (`true`) is memoized 12h (a prior absence won't
   * disappear). A negative verdict (`false`) is memoized only 5min, because a
   * justification entered/synced late must not keep an over-payment decision
   * frozen for 12h. The key is versioned so a logic change flushes old verdicts.
   *
   * Fail-safe: on total fetch failure, returns TRUE (no forgiveness) and does
   * NOT cache, so a transient Secullum error can't freeze a wrong verdict.
   */
  private async hasAtestadoInPriorNinetyDays(
    secullumFuncionarioId: number,
    periodStart: Date,
  ): Promise<boolean> {
    const periodStartStr = this.formatDateForSecullum(periodStart);
    const cacheKey = `bonus:atestado-90d:${SecullumBonusIntegrationService.ATESTADO_90D_CACHE_VERSION}:${secullumFuncionarioId}:${periodStartStr}`;

    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const windowEnd = new Date(periodStart);
    windowEnd.setDate(windowEnd.getDate() - 1);
    const windowStart = new Date(periodStart);
    windowStart.setDate(windowStart.getDate() - 90);

    // Invalid/empty window — don't grant forgiveness.
    if (windowStart.getTime() >= windowEnd.getTime()) {
      await this.cacheService.set(cacheKey, true, 43200);
      return true;
    }

    const windowStartStr = this.formatDateForSecullum(windowStart);
    const windowEndStr = this.formatDateForSecullum(windowEnd);

    let found = false;
    let fetchFailed = false;

    // 1) /Batidas — partial justified absences carry the code in their punches.
    try {
      const entries = await this.secullumService.getTimeEntriesBySecullumIdCached(
        secullumFuncionarioId,
        windowStartStr,
        windowEndStr,
      );
      const isJustified = (f: any) => this.isJustifiedAbsenceCode(f);
      found = (entries ?? []).some(
        e =>
          isJustified(e?.Entrada1) ||
          isJustified(e?.entrada1) ||
          isJustified(e?.Saida1) ||
          isJustified(e?.saida1) ||
          isJustified(e?.Entrada2) ||
          isJustified(e?.entrada2) ||
          isJustified(e?.Saida2) ||
          isJustified(e?.saida2) ||
          isJustified(e?.Entrada3) ||
          isJustified(e?.entrada3) ||
          isJustified(e?.Saida3) ||
          isJustified(e?.saida3),
      );
    } catch (error) {
      fetchFailed = true;
      this.logger.warn(
        `Prior-90d Batidas fetch failed (empId=${secullumFuncionarioId}): ${error?.message || error}`,
      );
    }

    // 2) /Calculos — catches FULL-DAY justified absences /Batidas returns empty
    // for (parseCalculationTotals.perDayAbono is populated from the ATEST/DECL/
    // ÓBITO column text and the Abono column).
    if (!found) {
      try {
        const calc = await this.secullumService.getCalculationsBySecullumId(
          secullumFuncionarioId,
          windowStartStr,
          windowEndStr,
        );
        const { perDayAbono } = this.parseCalculationTotals(calc);
        for (const h of perDayAbono.values()) {
          if (h > 0) {
            found = true;
            break;
          }
        }
      } catch (error) {
        fetchFailed = true;
        this.logger.warn(
          `Prior-90d Calculos fetch failed (empId=${secullumFuncionarioId}): ${error?.message || error}`,
        );
      }
    }

    if (found) {
      await this.cacheService.set(cacheKey, true, 43200); // 12h
      return true;
    }

    // Fail-safe: any fetch failed and nothing was found → deny forgiveness and
    // do NOT cache, so the next run re-checks with (hopefully) live data.
    if (fetchFailed) {
      return true;
    }

    // No prior justified absence — cache the negative verdict only briefly.
    await this.cacheService.set(cacheKey, false, 300); // 5 min
    return false;
  }

  /**
   * Parse Faltas and Atrasos from Secullum Calculos response.
   * Returns totals plus per-day maps keyed by 'YYYY-MM-DD' so the caller can
   * attribute the authoritative hours to specific calendar days. Secullum's
   * per-day numbers are schedule-aware (e.g. clocked in at 07:14 vs scheduled
   * 07:00 = 14 min Faltas) — our local calculateMissingHours can't infer that.
   */
  private parseCalculationTotals(data: SecullumCalculationData | null): {
    faltasHours: number;
    atrasosHours: number;
    faltasTotal: string | null;
    atrasosTotal: string | null;
    dailyCargaHours: number;
    perDayFaltas: Map<string, number>;
    perDayAtrasos: Map<string, number>;
    perDayAbono: Map<string, number>;
  } {
    const empty = {
      faltasHours: 0,
      atrasosHours: 0,
      faltasTotal: null,
      atrasosTotal: null,
      dailyCargaHours: 0,
      perDayFaltas: new Map<string, number>(),
      perDayAtrasos: new Map<string, number>(),
      perDayAbono: new Map<string, number>(),
    };
    if (!data || !data.Colunas || !data.Totais) return empty;

    let faltasIndex = -1;
    let atrasosIndex = -1;
    let cargaIndex = -1;
    let normaisIndex = -1;
    let dataIndex = -1;
    // Abono* columns (Abono, Abono1, Abono2, …) mark applied justifications.
    // A positive Abono duration on a scheduled workday is Secullum's signal that
    // the day was abonado (atestado / justified leave) — the same marker
    // getUnjustifiedAbsences() uses to skip a day.
    const abonoIndexes: number[] = [];
    // Entrada*/Saída* columns. For a FULL-DAY atestado Secullum sets Carga=0 and
    // often leaves the Abono column empty, so the only reliable per-day signal is
    // the literal "ATEST/DECL/ÓBITO" text these columns carry — exactly what the
    // Espelho de Ponto renders. We also pick out the first two pairs (morning
    // E1/S1, afternoon E2/S2) so a day can be split into justified vs unjustified
    // halves — the key to handling MIXED days (one half justified, the other a
    // real falta) instead of absorbing the whole day into one bucket.
    const entradaIndexes: number[] = [];
    let e1Index = -1;
    let s1Index = -1;
    let e2Index = -1;
    let s2Index = -1;

    for (let i = 0; i < data.Colunas.length; i++) {
      const col = data.Colunas[i];
      const nome = (col.Nome || '').toLowerCase();
      const nomeExibicao = (col.NomeExibicao || '').toLowerCase();
      const anyName = `${nome}|${nomeExibicao}`;

      if (/^abono\s*\d*$/.test(nome) || /^abono\s*\d*$/.test(nomeExibicao)) {
        abonoIndexes.push(i);
      }
      if (
        /^(entrada|saída|saida)\s*\d+$/.test(nome) ||
        /^(entrada|saída|saida)\s*\d+$/.test(nomeExibicao)
      ) {
        entradaIndexes.push(i);
      }
      if (/(^|\|)entrada\s*1$/.test(anyName)) e1Index = i;
      if (/(^|\|)(saída|saida)\s*1$/.test(anyName)) s1Index = i;
      if (/(^|\|)entrada\s*2$/.test(anyName)) e2Index = i;
      if (/(^|\|)(saída|saida)\s*2$/.test(anyName)) s2Index = i;
      if (nome === 'faltas' || nomeExibicao === 'faltas') {
        faltasIndex = i;
      }
      if (
        nome === 'atras.' ||
        nomeExibicao === 'atras.' ||
        nome === 'atrasos' ||
        nomeExibicao === 'atrasos'
      ) {
        atrasosIndex = i;
      }
      if (nome === 'carga' || nomeExibicao === 'carga') {
        cargaIndex = i;
      }
      if (nome === 'normais' || nomeExibicao === 'normais') {
        normaisIndex = i;
      }
      if (nome === 'data' || nomeExibicao === 'data' || nome === 'dia' || nomeExibicao === 'dia') {
        dataIndex = i;
      }
    }

    const faltasTotal = faltasIndex >= 0 ? data.Totais[faltasIndex] || null : null;
    const atrasosTotal = atrasosIndex >= 0 ? data.Totais[atrasosIndex] || null : null;

    // Extract daily Carga from the first row that has a non-zero Carga value
    let dailyCargaHours = 0;
    if (cargaIndex >= 0 && data.Linhas) {
      for (const row of data.Linhas) {
        const carga = row[cargaIndex];
        if (carga && carga !== '00:00') {
          dailyCargaHours = this.parseTimeToHours(carga);
          break;
        }
      }
    }

    // Per-day attribution — keyed by 'YYYY-MM-DD'.
    //
    // KEY INSIGHT from Secullum's real response shape: the per-row `Faltas` and
    // `Atras.` cells are almost always empty strings, yet the `Faltas` TOTAL is
    // non-zero. Secullum computes the total as `sum(Carga) − sum(Normais)` for
    // the period, not by summing a per-day Faltas column.
    //
    // To attribute the shortfall to specific days, we compute it ourselves:
    //
    //     perDayFaltas[date] = max(0, Carga_row − Normais_row)
    //
    // This naturally captures:
    //   • Full absences   (Normais="" → 0h, Carga="08:45" → shortfall 8.75h)
    //   • Partial days    (Normais="08:15", Carga="08:45" → shortfall 0.5h)
    //   • Full attendance (Normais = Carga → 0, not flagged)
    //   • Atestado days   (both empty → 0, correctly skipped)
    //   • Weekends/holidays (both empty → 0)
    //   • Overtime days   (Normais > Carga clamped to 0 by max)
    //
    // We also still honor an explicit per-day Faltas/Atras. value if Secullum
    // did populate it for a given row — that takes precedence over the diff.
    const perDayFaltas = new Map<string, number>();
    const perDayAtrasos = new Map<string, number>();
    const perDayAbono = new Map<string, number>();
    if (data.Linhas && dataIndex >= 0) {
      for (const row of data.Linhas) {
        const dateKey = this.normalizeDateKey(row[dataIndex]);
        if (!dateKey) continue;

        const cargaRow = cargaIndex >= 0 ? this.parseTimeToHours(row[cargaIndex]) : 0;
        const normaisRow = normaisIndex >= 0 ? this.parseTimeToHours(row[normaisIndex]) : 0;
        const standardCarga = dailyCargaHours > 0 ? dailyCargaHours : WORKDAY_HOURS;

        // Split the day into a justified fraction using the punch/code structure.
        // A half is "justified" when its Entrada/Saída carries a code
        // (ATEST/DECL/ÓBITO); otherwise it was worked or absent. This is what lets
        // a MIXED day (e.g. morning atestado + afternoon early-leave) attribute
        // each portion to the right bucket instead of absorbing the whole day.
        const isJust = (idx: number) => idx >= 0 && this.isJustifiedAbsenceCode(row[idx]);
        const morningJustified = isJust(e1Index) || isJust(s1Index);
        const afternoonJustified = isJust(e2Index) || isJust(s2Index);
        let justifiedFraction = 0;
        if (morningJustified && afternoonJustified) justifiedFraction = 1;
        else if (morningJustified || afternoonJustified) justifiedFraction = 0.5;
        // Fallback when the named pairs weren't resolved: scan every entry column
        // and infer full/half from the code:time ratio.
        if (justifiedFraction === 0 && e1Index < 0 && entradaIndexes.length > 0) {
          let codeCells = 0;
          let timeCells = 0;
          for (const idx of entradaIndexes) {
            const v = row[idx];
            if (typeof v !== 'string') continue;
            if (this.isJustifiedAbsenceCode(v)) codeCells++;
            else if (/\d{1,2}:\d{2}/.test(v)) timeCells++;
          }
          if (codeCells > 0) justifiedFraction = timeCells > 0 ? 0.5 : 1;
        }

        // Effective schedule length: the row's OWN Carga (correct even for
        // weekday-varying schedules) — only substitute the period standard when
        // Secullum zeroed Carga for a fully-abonado day.
        const effCarga = cargaRow > 0 ? cargaRow : justifiedFraction > 0 ? standardCarga : 0;

        // JUSTIFIED hours (abono): Secullum's explicit Abono column wins (exact);
        // otherwise the justified fraction of the effective Carga.
        let abonoColHrs = 0;
        for (const idx of abonoIndexes) {
          const a = this.parseTimeToHours(row[idx]);
          if (a > 0) abonoColHrs += a;
        }
        let abonoForDay =
          abonoColHrs > 0 ? abonoColHrs : Math.round(justifiedFraction * effCarga * 100) / 100;
        // Never let abono exceed the schedule.
        if (effCarga > 0) abonoForDay = Math.min(abonoForDay, effCarga);
        if (abonoForDay > 0) {
          abonoForDay = Math.round(abonoForDay * 100) / 100;
          perDayAbono.set(dateKey, (perDayAbono.get(dateKey) ?? 0) + abonoForDay);
        }

        // UNJUSTIFIED hours (falta): Secullum's explicit Faltas column wins;
        // otherwise the shortfall left after removing worked (Normais) and
        // justified (abono) time from the schedule. When the abono was ESTIMATED
        // from the half-day fraction (no exact Abono column), a tiny residual is
        // just rounding noise from the equal-halves assumption — ignore it. A
        // PURE day (no justification, no estimate) counts every minute (e.g. an
        // 11-minute atraso must still register).
        let faltasForDay = faltasIndex >= 0 ? this.parseTimeToHours(row[faltasIndex]) : 0;
        if (faltasForDay === 0 && effCarga > 0) {
          const diff = Math.round((effCarga - normaisRow - abonoForDay) * 100) / 100;
          const estimated = abonoColHrs === 0 && justifiedFraction > 0;
          const floor = estimated
            ? SecullumBonusIntegrationService.ABONO_ESTIMATE_TOLERANCE_HOURS
            : 0;
          if (diff > floor) faltasForDay = diff;
        }
        if (faltasForDay > 0) {
          perDayFaltas.set(dateKey, (perDayFaltas.get(dateKey) ?? 0) + faltasForDay);
        }

        if (atrasosIndex >= 0) {
          const a = this.parseTimeToHours(row[atrasosIndex]);
          if (a > 0) perDayAtrasos.set(dateKey, (perDayAtrasos.get(dateKey) ?? 0) + a);
        }
      }
    }

    return {
      faltasHours: this.parseTimeToHours(faltasTotal),
      atrasosHours: this.parseTimeToHours(atrasosTotal),
      faltasTotal,
      atrasosTotal,
      dailyCargaHours,
      perDayFaltas,
      perDayAtrasos,
      perDayAbono,
    };
  }

  /**
   * Normalize a raw date value (from Secullum Calculos Linhas or a DayAnalysis)
   * to a 'YYYY-MM-DD' key suitable for map lookups. Accepts ISO strings,
   * "DD/MM/YYYY" strings, and anything `new Date` can parse. Returns null when
   * the value can't be interpreted.
   */
  private normalizeDateKey(raw: any): string | null {
    if (raw === null || raw === undefined) return null;
    const s = typeof raw === 'string' ? raw : String(raw);
    const trimmed = s.trim();
    if (!trimmed) return null;
    const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(trimmed);
    if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return null;
  }

  /**
   * Parse a time string like "24:00" or "02:30" into decimal hours.
   */
  private parseTimeToHours(timeStr: string | null): number {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const cleaned = timeStr.trim();
    if (!cleaned) return 0;

    const match = cleaned.match(/^-?(\d+):(\d{2})$/);
    if (!match) return 0;

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const total = hours + minutes / 60;
    return cleaned.startsWith('-') ? -total : total;
  }

  /**
   * Extract the first "HH:MM" from a stamp/schedule string and return minutes
   * since midnight. Returns null when no time is present (blank, "ATESTADO", …).
   */
  private parseStampMinutes(raw: string | null | undefined): number | null {
    if (!raw || typeof raw !== 'string') return null;
    const m = raw.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return Number.isFinite(minutes) ? minutes : null;
  }

  // Entrada1 is "late" only when punched more than this many minutes after the
  // scheduled start. Sub-tolerance lateness does not cost the day's assiduidade.
  private static readonly ENTRY1_LATE_TOLERANCE_MIN = 5;

  // On a day whose abono was ESTIMATED from the half-day fraction (no exact Abono
  // column), a shortfall smaller than this is rounding noise from the
  // equal-halves assumption (the two schedule halves are rarely exactly equal),
  // not a real unjustified falta. ~10 min.
  private static readonly ABONO_ESTIMATE_TOLERANCE_HOURS = 0.17;

  /**
   * Whether a stamp/entry cell carries a JUSTIFIED-absence code. These are all
   * treated identically for the bonus: ATESTADO (medical certificate),
   * DECLARAÇÃO (declaração de comparecimento) and ATESTADO DE ÓBITO (bereavement).
   * Each lands on the "Faltas - Atestado" line, counts toward the same (lenient)
   * atestado tier, and counts for the first-offense forgiveness rule (a prior
   * one disqualifies it just the same). Diacritics are stripped before matching
   * so accented short codes ("ÓBITO") are caught, and the substring match
   * tolerates Secullum's short/long forms ("ATEST", "ATESTADO", "DECL",
   * "DECLARAÇÃO", "OBITO", "ÓBITO", …).
   */
  private isJustifiedAbsenceCode(v: unknown): boolean {
    if (!v || typeof v !== 'string') return false;
    const u = v
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return u.includes('ATEST') || u.includes('DECL') || u.includes('OBITO');
  }

  /**
   * Analyze a single day's time entry from Secullum Batidas response.
   */
  private analyzeDay(entry: any, holidays: Date[] = []): DayAnalysis {
    const date = entry.Data || entry.data || '';
    const tipoDoDia = entry.TipoDoDia ?? entry.tipoDoDia;

    const entrada1 = entry.Entrada1 || entry.entrada1 || null;
    const saida1 = entry.Saida1 || entry.saida1 || null;
    const entrada2 = entry.Entrada2 || entry.entrada2 || null;
    const saida2 = entry.Saida2 || entry.saida2 || null;

    const allTimeFields = [entrada1, saida1, entrada2, saida2];
    // Atestado AND declaração are both justified absences (treated identically).
    const isAtestad = (f: any) => this.isJustifiedAbsenceCode(f);
    const isValidStamp = (s: any) =>
      s && typeof s === 'string' && s.trim() !== '' && /\d{1,2}:\d{2}/.test(s);

    const morningAtestado = isAtestad(entrada1) || isAtestad(saida1);
    const afternoonAtestado = isAtestad(entrada2) || isAtestad(saida2);
    const isAtestado = morningAtestado || afternoonAtestado;

    // Determine atestado proportion: full day (1) or half day (0.5)
    let atestadoProportion = 0;
    if (morningAtestado && afternoonAtestado) {
      atestadoProportion = 1; // Full day atestado
    } else if (morningAtestado && (isValidStamp(entrada2) || isValidStamp(saida2))) {
      atestadoProportion = 0.5; // Morning atestado, afternoon worked
    } else if (afternoonAtestado && (isValidStamp(entrada1) || isValidStamp(saida1))) {
      atestadoProportion = 0.5; // Afternoon atestado, morning worked
    } else if (isAtestado) {
      // Atestado in one half with no stamps in the other half — count full day
      atestadoProportion = 1;
    }

    const isFerias = allTimeFields.some(
      f => f && typeof f === 'string' && f.toUpperCase().includes('FÉRIAS'),
    );
    // FOLGA = scheduled day off (weekly rest or comp day). Secullum tags all
    // stamp positions with "FOLGA" in that case. Treat identically to a holiday:
    // exclude from working-day tally so it doesn't inflate Faltas.
    const isFolga = allTimeFields.some(
      f => f && typeof f === 'string' && f.toUpperCase().includes('FOLGA'),
    );

    // Check if this day is a holiday
    const entryDate = new Date(date);
    const isHoliday = holidays.some(
      holiday =>
        holiday.getFullYear() === entryDate.getFullYear() &&
        holiday.getMonth() === entryDate.getMonth() &&
        holiday.getDate() === entryDate.getDate(),
    );

    // "Today or future" guard — an unfinished or not-yet-started day must never
    // be scored as an unjustified absence. Secullum returns empty entries for
    // future dates in the period; without this, 23/04 and 24/04 would be flagged
    // as full-day absences on 22/04 at 2 PM. Today is also protected because the
    // user may still clock in/out; we only judge days that have closed.
    let isTodayOrFuture = false;
    if (!isNaN(entryDate.getTime())) {
      const now = new Date();
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const entryMidnight = new Date(
        entryDate.getFullYear(),
        entryDate.getMonth(),
        entryDate.getDate(),
      ).getTime();
      isTodayOrFuture = entryMidnight >= todayMidnight;
    }

    // Working day = Monday-Friday, not a holiday, not vacation, not a scheduled folga
    const isWorkingDay = this.isWorkingDay(tipoDoDia, date) && !isFerias && !isHoliday && !isFolga;

    const hasAllFourStamps =
      isValidStamp(entrada1) &&
      isValidStamp(saida1) &&
      isValidStamp(entrada2) &&
      isValidStamp(saida2) &&
      !isAtestado;

    const getFonteDadosTipo = (fieldName: string): number | null => {
      const fd = entry[fieldName] || entry[fieldName.charAt(0).toLowerCase() + fieldName.slice(1)];
      if (fd && typeof fd === 'object' && fd.Tipo !== undefined) {
        return fd.Tipo;
      }
      return null;
    };

    const origemEntrada1 = getFonteDadosTipo('FonteDadosEntrada1');
    const origemSaida1 = getFonteDadosTipo('FonteDadosSaida1');
    const origemEntrada2 = getFonteDadosTipo('FonteDadosEntrada2');
    const origemSaida2 = getFonteDadosTipo('FonteDadosSaida2');

    const allStampsElectronic =
      hasAllFourStamps &&
      this.allOriginsElectronic([origemEntrada1, origemSaida1, origemEntrada2, origemSaida2]);

    let atestadoHours = 0;
    let unjustifiedAbsenceHours = 0;

    if (isWorkingDay && isAtestado) {
      // Atestado can still be reported for today or future (pre-authorized leave);
      // no guard needed.
      atestadoHours = WORKDAY_HOURS * atestadoProportion;
    } else if (isWorkingDay && !isAtestado && !isTodayOrFuture) {
      // Flag BOTH full-day absences (no stamps) AND partial-day shortfalls
      // (Atrasos — late arrival / early leave even with all 4 stamps present).
      // Secullum's Calculos endpoint is the authoritative source for the totals,
      // but we need a per-day view here so the UI can list which days contributed.
      const hasSomeStamps =
        isValidStamp(entrada1) ||
        isValidStamp(saida1) ||
        isValidStamp(entrada2) ||
        isValidStamp(saida2);
      if (!hasSomeStamps) {
        unjustifiedAbsenceHours = WORKDAY_HOURS;
      } else {
        unjustifiedAbsenceHours = this.calculateMissingHours(entrada1, saida1, entrada2, saida2);
      }
    }

    return {
      date,
      isWorkingDay,
      isHoliday,
      hasAllFourStamps,
      allStampsElectronic,
      // Resolved in analyzeUser once the day's scheduled start is known.
      isLateEntry1: false,
      isAtestado,
      atestadoProportion,
      // A day is flagged when ANY shortfall exists — full absence or just late/early.
      // hasAllFourStamps is intentionally NOT part of the condition anymore.
      isUnjustifiedAbsence:
        isWorkingDay && !isAtestado && !isTodayOrFuture && unjustifiedAbsenceHours > 0,
      atestadoHours,
      unjustifiedAbsenceHours,
      stamps: { entrada1, saida1, entrada2, saida2 },
      origens: { origemEntrada1, origemSaida1, origemEntrada2, origemSaida2 },
    };
  }

  private isWorkingDay(tipoDoDia: any, dateStr: string): boolean {
    if (tipoDoDia !== undefined && tipoDoDia !== null && tipoDoDia !== 0) {
      return false;
    }
    try {
      const date = new Date(dateStr);
      const dayOfWeek = date.getDay();
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    } catch {
      return false;
    }
  }

  private allOriginsElectronic(origins: (number | null)[]): boolean {
    return origins.every(o => o === 0);
  }

  private calculateMissingHours(
    entrada1: string | null,
    saida1: string | null,
    entrada2: string | null,
    saida2: string | null,
  ): number {
    let workedMinutes = 0;
    if (entrada1 && saida1) {
      workedMinutes += this.timeDiffMinutes(entrada1, saida1);
    }
    if (entrada2 && saida2) {
      workedMinutes += this.timeDiffMinutes(entrada2, saida2);
    }
    const workedHours = workedMinutes / 60;
    const missingHours = Math.max(0, WORKDAY_HOURS - workedHours);
    return Math.round(missingHours * 100) / 100;
  }

  private timeDiffMinutes(start: string, end: string): number {
    try {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      return Math.max(0, eh * 60 + em - (sh * 60 + sm));
    } catch {
      return 0;
    }
  }

  // =====================
  // Tier tables with labels
  // =====================

  // Two independent dimensions per absence source:
  //   • Bônus discount  — how much of the monthly bonus is cut.
  //   • Assiduidade loss — how much of the accumulated +1%/day extra is cut.
  // A valid atestado/justificative is more lenient than "sem justificativa":
  // every threshold shifts one band to the right.

  getAtestadoDiscountPercentage(hours: number): number {
    if (hours <= 4) return 0;
    if (hours <= 8) return 25;
    if (hours <= 25) return 50;
    return 100;
  }

  getAtestadoTierLabel(hours: number): string {
    if (hours <= 0) return '';
    return this.formatHoursDisplay(hours);
  }

  getUnjustifiedDiscountPercentage(hours: number): number {
    if (hours <= 2) return 0;
    if (hours <= 4) return 25;
    if (hours <= 8) return 50;
    return 100;
  }

  getUnjustifiedTierLabel(hours: number): string {
    if (hours <= 0) return '';
    return this.formatHoursDisplay(hours);
  }

  /**
   * Assiduidade-loss tier for an unjustified absence (sem justificativa).
   *   0h → none · 0–2h → perde o dia · 2–4h → 50% · >4h → 100%
   */
  getUnjustifiedAssiduidadeLoss(hours: number): AssiduidadeLoss {
    if (hours <= 0) return 'none';
    if (hours <= 2) return 'perde-o-dia';
    if (hours <= 4) return 'half';
    return 'full';
  }

  /**
   * Assiduidade-loss tier for an atestado. A short atestado (até 2h) keeps the
   * full +1%/day — a valid justificative does not cost assiduidade there.
   *   0–2h → none · 2–4h → perde o dia · 4–8h → 50% · >8h → 100%
   */
  getAtestadoAssiduidadeLoss(hours: number): AssiduidadeLoss {
    if (hours <= 2) return 'none';
    if (hours <= 4) return 'perde-o-dia';
    if (hours <= 8) return 'half';
    return 'full';
  }

  /** The more severe of two assiduidade-loss tiers wins. */
  private worstAssiduidadeLoss(a: AssiduidadeLoss, b: AssiduidadeLoss): AssiduidadeLoss {
    return ASSIDUIDADE_LOSS_SEVERITY[a] >= ASSIDUIDADE_LOSS_SEVERITY[b] ? a : b;
  }

  /**
   * Apply a graded assiduidade-loss tier to the accumulated +1%/day extra.
   *
   * Note 'perde-o-dia' makes NO extra reduction here: the day that triggered it
   * (a short absence/atraso) is already excluded from `fullExtra` by the per-day
   * clean-count, so subtracting again would double-penalize. Only the heavier
   * 'half'/'full' tiers scale the surviving total.
   */
  private applyAssiduidadeLoss(fullExtra: number, loss: AssiduidadeLoss): number {
    switch (loss) {
      case 'full':
        return 0;
      case 'half':
        return Math.max(0, Math.round(fullExtra / 2));
      case 'perde-o-dia':
      default:
        return Math.max(0, fullExtra);
    }
  }

  /**
   * Format decimal hours as HH:MM for display (e.g., 26.25 → "26:15").
   */
  private formatHoursDisplay(decimalHours: number): string {
    const h = Math.floor(decimalHours);
    const m = Math.round((decimalHours - h) * 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  private formatDateForSecullum(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
