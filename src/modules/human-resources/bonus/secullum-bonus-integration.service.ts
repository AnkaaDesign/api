import { Injectable, Logger } from '@nestjs/common';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';
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
    }
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
    users: Array<{ id: string; name: string; cpf?: string; pis?: string; payrollNumber?: number }>,
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

    // Pre-fetch all Secullum employees once (avoid N+1 API calls).
    // Failure here is a service-wide signal — auth or network is broken.
    let secullumEmployees: any[] = [];
    try {
      const employeesResponse = await this.secullumService.getEmployees();
      if (employeesResponse.success && Array.isArray(employeesResponse.data)) {
        secullumEmployees = employeesResponse.data;
        this.logger.log(`Loaded ${secullumEmployees.length} Secullum employees for matching`);
      } else {
        const error = 'Failed to fetch Secullum employees list (response not successful)';
        this.logger.error(error);
        this.recordBreakerFailure();
        return {
          perUser: results,
          metadata: { secullumAvailable: false, failedUsers, totalUsers, error },
        };
      }
    } catch (error) {
      const message = `Failed to fetch Secullum employees: ${error?.message || error}`;
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

    for (const user of users) {
      try {
        const analysis = await this.analyzeUser(
          user,
          startDate,
          endDate,
          secullumEmployees,
          holidays,
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
   * Analyze a single user's time entries.
   */
  private async analyzeUser(
    user: { id: string; name: string; cpf?: string; pis?: string; payrollNumber?: number },
    startDate: string,
    endDate: string,
    secullumEmployees?: any[],
    holidays: Date[] = [],
  ): Promise<SecullumBonusAnalysis | null> {
    // Match user to Secullum employee
    let secullumEmployeeId: number | null = null;

    if (secullumEmployees) {
      const normalizeCpf = (cpf: string) => (cpf ? cpf.replace(/[.-]/g, '') : '');
      const userCpf = user.cpf ? normalizeCpf(user.cpf) : '';
      const userPis = user.pis || '';
      const userPayroll = user.payrollNumber?.toString() || '';

      const match = secullumEmployees.find((emp: any) => {
        const empCpf = normalizeCpf(emp.Cpf || '');
        const empPis = emp.NumeroPis || '';
        const empPayroll = (emp.NumeroFolha || '').toString();
        return (
          (userCpf && empCpf === userCpf) ||
          (userPis && empPis === userPis) ||
          (userPayroll && empPayroll === userPayroll)
        );
      });

      if (!match) {
        this.logger.warn(
          `No Secullum employee match for ${user.name} (cpf=${user.cpf}, pis=${user.pis}, payroll=${user.payrollNumber})`,
        );
        return null;
      }
      secullumEmployeeId = match.Id;
      this.logger.debug(`Matched ${user.name} → Secullum employee ${match.Nome} (ID=${match.Id})`);
    }

    if (!secullumEmployeeId) {
      return null;
    }

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
    const { faltasTotal, atrasosTotal, dailyCargaHours, perDayFaltas, perDayAtrasos } =
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

    // Today midnight (local) — any entry at or after this is today or future and
    // must not be scored yet. We keep those entries in the breakdown for display
    // but exclude them from totals so e.g. 23/04 doesn't shrink extra% on 22/04.
    const _now = new Date();
    const todayMidnightMs = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate()).getTime();

    for (const entry of entries) {
      const dayAnalysis = this.analyzeDay(entry, holidays);

      const entryDate = new Date(dayAnalysis.date);
      const isTodayOrFuture =
        !isNaN(entryDate.getTime()) &&
        new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate()).getTime() >=
          todayMidnightMs;

      // Override the local missing-hours estimate with Secullum's schedule-aware
      // per-day Faltas+Atrasos when available. This catches the "clocked in late
      // but worked past hours" case (Secullum counts the lateness; our local math
      // doesn't because total worked minutes ≥ 8h). Today/future stay at 0.
      if (!isTodayOrFuture && dayAnalysis.isWorkingDay && !dayAnalysis.isAtestado) {
        const dateKey = this.normalizeDateKey(dayAnalysis.date);
        if (dateKey) {
          const fDay = perDayFaltas.get(dateKey) ?? 0;
          const aDay = perDayAtrasos.get(dateKey) ?? 0;
          const total = Math.round((fDay + aDay) * 100) / 100;
          if (total > 0) {
            dayAnalysis.unjustifiedAbsenceHours = total;
            dayAnalysis.isUnjustifiedAbsence = true;
          }
        }
      }

      dailyBreakdown.push(dayAnalysis);

      // Only count working days (Mon-Fri, excluding holidays) AND only if the
      // day has closed. Today/future are kept in the breakdown but skipped here.
      if (dayAnalysis.isWorkingDay && !isTodayOrFuture) {
        totalWorkingDays++;

        if (dayAnalysis.hasAllFourStamps && dayAnalysis.allStampsElectronic) {
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

    // Determine if user loses extra
    let losesExtraFromAtestado = this.doesAtestadoLoseExtra(totalAtestadoHours);
    const losesExtraFromUnjustified = totalUnjustifiedAbsenceHours > 0;

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
        losesExtraFromAtestado = false;
        this.logger.log(
          `Atestado forgiveness applied for user ${user.name} (${user.id}) — no atestado in prior 90 days`,
        );
      }
    }

    const losesExtra = losesExtraFromAtestado || losesExtraFromUnjustified;

    // NEW REVERSED LOGIC: Start with total working days %, subtract 1% for each incorrectly stamped day
    // Incorrectly stamped days = working days without all 4 electronic stamps
    const incorrectlyStampedDays = totalWorkingDays - daysWithFullElectronicStamps;

    // Extra percentage: Start with working days %, lose 1% per incorrect day, but 0 if loses extra completely
    const extraPercentage = losesExtra ? 0 : Math.max(0, totalWorkingDays - incorrectlyStampedDays);

    this.logger.log(
      `User ${user.name}: workingDays=${totalWorkingDays}, holidays=${holidays.length}, electronicDays=${daysWithFullElectronicStamps}, ` +
        `incorrectDays=${incorrectlyStampedDays}, extraPct=${extraPercentage}% (reversed logic), ` +
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

  /**
   * Check whether the user had any atestado in the rolling 90 days ending
   * the day before periodStart. Used to decide first-offense forgiveness:
   * if no prior atestado exists in that window, the current period's
   * atestado-derived penalty is waived.
   *
   * Window: [today - 90 days, periodStart - 1 day].
   * Memoized in Redis for 12h at
   *   `bonus:atestado-90d:{secullumFuncionarioId}:{yyyy-MM-dd of periodStart}`.
   *
   * Fail-safe: on fetch error, returns TRUE so transient Secullum failures
   * do not accidentally waive discounts.
   */
  private async hasAtestadoInPriorNinetyDays(
    secullumFuncionarioId: number,
    periodStart: Date,
  ): Promise<boolean> {
    const periodStartStr = this.formatDateForSecullum(periodStart);
    const cacheKey = `bonus:atestado-90d:${secullumFuncionarioId}:${periodStartStr}`;

    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const today = new Date();
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - 90);

    const windowEnd = new Date(periodStart);
    windowEnd.setDate(windowEnd.getDate() - 1);

    // Invalid/empty window (e.g., calculating a future period or periodStart is in the
    // past more than 90 days beyond today) — don't grant forgiveness.
    if (windowStart.getTime() >= windowEnd.getTime()) {
      await this.cacheService.set(cacheKey, true, 43200);
      return true;
    }

    const windowStartStr = this.formatDateForSecullum(windowStart);
    const windowEndStr = this.formatDateForSecullum(windowEnd);

    let entries: any[] = [];
    try {
      entries = await this.secullumService.getTimeEntriesBySecullumIdCached(
        secullumFuncionarioId,
        windowStartStr,
        windowEndStr,
      );
    } catch (error) {
      this.logger.warn(
        `Prior-90d Batidas fetch failed (empId=${secullumFuncionarioId}): ${error?.message || error}. Defaulting to true (no forgiveness).`,
      );
      return true;
    }

    const isAtestad = (f: any) =>
      !!f && typeof f === 'string' && f.toUpperCase().includes('ATESTAD');

    for (const entry of entries) {
      if (
        isAtestad(entry?.Entrada1) ||
        isAtestad(entry?.entrada1) ||
        isAtestad(entry?.Saida1) ||
        isAtestad(entry?.saida1) ||
        isAtestad(entry?.Entrada2) ||
        isAtestad(entry?.entrada2) ||
        isAtestad(entry?.Saida2) ||
        isAtestad(entry?.saida2) ||
        isAtestad(entry?.Entrada3) ||
        isAtestad(entry?.entrada3) ||
        isAtestad(entry?.Saida3) ||
        isAtestad(entry?.saida3)
      ) {
        await this.cacheService.set(cacheKey, true, 43200);
        return true;
      }
    }

    await this.cacheService.set(cacheKey, false, 43200);
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
  } {
    const empty = {
      faltasHours: 0,
      atrasosHours: 0,
      faltasTotal: null,
      atrasosTotal: null,
      dailyCargaHours: 0,
      perDayFaltas: new Map<string, number>(),
      perDayAtrasos: new Map<string, number>(),
    };
    if (!data || !data.Colunas || !data.Totais) return empty;

    let faltasIndex = -1;
    let atrasosIndex = -1;
    let cargaIndex = -1;
    let normaisIndex = -1;
    let dataIndex = -1;

    for (let i = 0; i < data.Colunas.length; i++) {
      const col = data.Colunas[i];
      const nome = (col.Nome || '').toLowerCase();
      const nomeExibicao = (col.NomeExibicao || '').toLowerCase();

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
    if (data.Linhas && dataIndex >= 0) {
      for (const row of data.Linhas) {
        const dateKey = this.normalizeDateKey(row[dataIndex]);
        if (!dateKey) continue;

        let faltasForDay = 0;
        if (faltasIndex >= 0) {
          faltasForDay = this.parseTimeToHours(row[faltasIndex]);
        }
        // Fallback: derive from Carga − Normais when the explicit cell is empty.
        if (faltasForDay === 0 && cargaIndex >= 0 && normaisIndex >= 0) {
          const cargaHrs = this.parseTimeToHours(row[cargaIndex]);
          const normaisHrs = this.parseTimeToHours(row[normaisIndex]);
          if (cargaHrs > 0) {
            const diff = Math.round((cargaHrs - normaisHrs) * 100) / 100;
            if (diff > 0) faltasForDay = diff;
          }
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
    const isAtestad = (f: any) => f && typeof f === 'string' && f.toUpperCase().includes('ATESTAD');
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

  getAtestadoDiscountPercentage(hours: number): number {
    if (hours <= 2) return 0;
    if (hours <= 8) return 0;
    if (hours <= 16) return 25;
    if (hours <= 25) return 50;
    return 100;
  }

  getAtestadoTierLabel(hours: number): string {
    if (hours <= 0) return '';
    return this.formatHoursDisplay(hours);
  }

  private doesAtestadoLoseExtra(hours: number): boolean {
    return hours > 2;
  }

  getUnjustifiedDiscountPercentage(hours: number): number {
    if (hours <= 0) return 0;
    if (hours <= 2) return 25;
    if (hours <= 8) return 50;
    return 100;
  }

  getUnjustifiedTierLabel(hours: number): string {
    if (hours <= 0) return '';
    return this.formatHoursDisplay(hours);
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
