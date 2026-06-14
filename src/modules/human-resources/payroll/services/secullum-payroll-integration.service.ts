import { Injectable, Logger } from '@nestjs/common';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { SecullumCalculationData } from '@modules/integrations/secullum/dto';
import { getBrazilianHolidays } from '@utils/brazilian-holidays.util';

/** Round a quantity (days/hours) to 2 decimals for display/conversion. */
function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * ============================================================================
 * SECULLUM PAYROLL INTEGRATION SERVICE
 * ============================================================================
 * Extracts payroll-relevant data from Secullum's calculation endpoint.
 * Includes: worked hours, overtime, night shift, absences, DSR, etc.
 * ============================================================================
 */

export interface SecullumPayrollData {
  // Employee info
  employeeId: string;
  secullumId: string;
  period: {
    year: number;
    month: number;
    startDate: string;
    endDate: string;
  };

  // Worked hours
  normalHours: number; // Regular hours worked
  nightHours: number; // Night shift hours (22h-5h)

  // Overtime (Horas Extras)
  overtime50: number; // 50% overtime (normal days)
  overtime100: number; // 100% overtime (Sundays/holidays)

  // Absences
  absenceHours: number; // Total absence hours
  absenceDays: number; // Total absence days
  justifiedAbsenceHours: number; // With medical certificate
  unjustifiedAbsenceHours: number; // Without justification

  // DSR
  dsrDays: number; // Weekly rest days
  dsrHours: number; // DSR hours

  // Additional
  lateArrivalMinutes: number; // Atrasos
  earlyDepartureMinutes: number; // Saídas antecipadas

  // Working days
  workingDaysInMonth: number; // Total working days (Mon-Sat)
  workedDays: number; // Actually worked days
  sundays: number; // Sundays in month
  holidays: number; // Holidays in month

  // Raw data from Secullum
  rawCalculationData: SecullumCalculationData;
}

@Injectable()
export class SecullumPayrollIntegrationService {
  private readonly logger = new Logger(SecullumPayrollIntegrationService.name);

  // Per-period in-memory dedup so a single payroll-generation run that fails for
  // many employees emits at most ONE URGENT "data degraded" alert per period.
  // Cleared by TTL so a later run can re-alert. In-process only (best-effort).
  private readonly degradedAlertedPeriods = new Map<string, number>();
  private readonly DEGRADED_ALERT_TTL_MS = 60 * 60 * 1000; // 1h

  constructor(
    private readonly secullumService: SecullumService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Fetches and parses Secullum calculation data for a specific employee/period.
   * Resolution: `User.secullumEmployeeId` FK. Users without a linked Secullum
   * employee return the empty payroll shape so callers continue gracefully.
   */
  async getPayrollDataFromSecullum(params: {
    employeeId: string;
    secullumEmployeeId: number | null;
    year: number;
    month: number;
  }): Promise<SecullumPayrollData> {
    const { employeeId, secullumEmployeeId, year, month } = params;

    this.logger.log(`Fetching Secullum payroll data for employee ${employeeId} - ${year}/${month}`);

    const { startDate, endDate } = this.getPayrollPeriodDates(year, month);

    if (secullumEmployeeId == null) {
      this.logger.debug(`Skipping ${employeeId} — no secullumEmployeeId on User record`);
      return this.getEmptyPayrollData(employeeId, '', year, month);
    }

    const secullumId = secullumEmployeeId.toString();
    this.logger.log(`  Resolved to Secullum employee ID: ${secullumId}`);

    try {
      const calcData = await this.secullumService.getCalculationsBySecullumId(
        secullumEmployeeId,
        startDate,
        endDate,
      );

      if (!calcData) {
        this.logger.warn(`No calculation data from Secullum for employee ${secullumId}`);
        return this.getEmptyPayrollData(employeeId, secullumId, year, month);
      }

      // Parse Secullum calculation data
      const payrollData = this.parseSecullumCalculationData(
        employeeId,
        secullumId,
        year,
        month,
        calcData,
      );

      this.logger.log(
        `Successfully extracted payroll data for ${employeeId}: ` +
          `${payrollData.normalHours}h normal, ${payrollData.overtime50}h HE50%, ` +
          `${payrollData.absenceHours}h absences`,
      );

      return payrollData;
    } catch (error) {
      this.logger.error(`Error fetching Secullum data for employee ${employeeId}:`, error);
      // Falling back to empty payroll data means the saved payroll for this
      // employee is missing Secullum-derived hours/absences — i.e. degraded.
      // Alert HR/Financial/Admin once per period.
      this.emitDataDegradedOncePerPeriod(year, month, (error as Error)?.message);
      return this.getEmptyPayrollData(employeeId, secullumId, year, month);
    }
  }

  /**
   * Fire-and-forget URGENT "payroll data degraded" alert, deduped to one emit
   * per (year/month) per TTL window. Never blocks payroll generation.
   */
  private emitDataDegradedOncePerPeriod(year: number, month: number, reason?: string): void {
    const key = `${year}-${month}`;
    const now = Date.now();
    const last = this.degradedAlertedPeriods.get(key);
    if (last && now - last < this.DEGRADED_ALERT_TTL_MS) return;
    this.degradedAlertedPeriods.set(key, now);

    const body =
      `Os dados da Secullum para a folha de ${String(month).padStart(2, '0')}/${year} estão ` +
      `indisponíveis/degradados. Parte da folha pode ter sido gerada sem horas/ausências da Secullum.` +
      (reason ? ` Detalhe: ${reason}` : '');

    void this.dispatchService
      .dispatchByConfiguration('secullum.payroll.dataDegraded', 'system', {
        entityType: 'SecullumPayroll',
        entityId: key,
        action: 'data_degraded',
        data: { source: 'payroll', year, month, reason: reason ?? '' },
        overrides: {
          title: 'Dados de folha degradados (Secullum)',
          body,
          webUrl: '/recursos-humanos/folha-de-pagamento',
          relatedEntityType: 'SECULLUM_PAYROLL',
        },
      })
      .catch((err) =>
        this.logger.error(
          `Notification dispatch failed for "secullum.payroll.dataDegraded": ${(err as Error).message}`,
        ),
      );
  }

  /**
   * ========================================================================
   * PARSE SECULLUM CALCULATION DATA
   * ========================================================================
   * Extracts relevant payroll information from Secullum's column-based data
   */
  private parseSecullumCalculationData(
    employeeId: string,
    secullumId: string,
    year: number,
    month: number,
    calcData: SecullumCalculationData,
  ): SecullumPayrollData {
    // Secullum returns data in columns. Each column has a name and values.
    // Common columns (Portuguese):
    // - "Horas Trabalhadas" / "Horas Normais"
    // - "Horas Extras 50%"
    // - "Horas Extras 100%"
    // - "Horas Noturnas"
    // - "Faltas" / "Ausências"
    // - "DSR"
    // - "Atrasos"

    const columns = calcData.Colunas || [];
    const totals = calcData.Totais || [];

    // Helper function to find column index by name
    const findColumnIndex = (searchTerms: string[]): number => {
      return columns.findIndex(col =>
        searchTerms.some(
          term =>
            col.Nome?.toLowerCase().includes(term.toLowerCase()) ||
            col.NomeExibicao?.toLowerCase().includes(term.toLowerCase()),
        ),
      );
    };

    // Helper function to parse hours/minutes string (e.g., "08:30" or "08:30:00")
    const parseTimeToDecimalHours = (timeStr: string | null): number => {
      if (!timeStr || timeStr === '--:--' || timeStr === '00:00') return 0;

      // Handle formats: "HH:MM", "HH:MM:SS", or decimal "8.5"
      if (timeStr.includes(':')) {
        const parts = timeStr.split(':');
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        const seconds = parseInt(parts[2]) || 0;
        return hours + minutes / 60 + seconds / 3600;
      }

      // Already in decimal format
      return parseFloat(timeStr) || 0;
    };

    // Find column indexes
    // Note: Secullum column names are case-insensitive matched
    // Add exact column names from Secullum API first, then fallback terms
    const normalHoursIdx = findColumnIndex([
      'normais',
      'horas trabalhadas',
      'horas normais',
      'trabalho normal',
    ]);
    const nightHoursIdx = findColumnIndex([
      'not.',
      'noturnas',
      'horas noturnas',
      'adicional noturno',
      'noturno',
    ]);
    const overtime50Idx = findColumnIndex(['ex50%', '50%', 'extra 50', 'he 50']);
    const overtime100Idx = findColumnIndex(['ex100%', '100%', 'extra 100', 'he 100']);
    const absenceIdx = findColumnIndex(['faltas', 'ausências', 'horas falta']);
    const dsrIdx = findColumnIndex(['dsr', 'descanso semanal']);
    const lateIdx = findColumnIndex(['atras', 'atrasos', 'atraso']);
    // Justified absences / abono: Secullum carries these in a separate column
    // ("Abono", "Faltas Abonadas", "Faltas Justificadas", "Atestado"). Hours in
    // this column do NOT cause pay loss (atestado/abono ≠ desconto). When the
    // column is absent we conservatively treat ALL faltas as unjustified.
    const justifiedIdx = findColumnIndex([
      'abono',
      'abonad',
      'justificad',
      'atestad',
      'faltas just',
    ]);

    // Extract totals from the last row
    const normalHours = normalHoursIdx >= 0 ? parseTimeToDecimalHours(totals[normalHoursIdx]) : 0;
    const nightHours = nightHoursIdx >= 0 ? parseTimeToDecimalHours(totals[nightHoursIdx]) : 0;
    const overtime50 = overtime50Idx >= 0 ? parseTimeToDecimalHours(totals[overtime50Idx]) : 0;
    const overtime100 = overtime100Idx >= 0 ? parseTimeToDecimalHours(totals[overtime100Idx]) : 0;
    const absenceHours = absenceIdx >= 0 ? parseTimeToDecimalHours(totals[absenceIdx]) : 0;
    const justifiedAbsenceHours =
      justifiedIdx >= 0 ? parseTimeToDecimalHours(totals[justifiedIdx]) : 0;
    // Unjustified = total faltas menos as justificadas/abonadas (nunca negativo).
    const unjustifiedAbsenceHours = Math.max(0, absenceHours - justifiedAbsenceHours);
    const dsrHours = dsrIdx >= 0 ? parseTimeToDecimalHours(totals[dsrIdx]) : 0;
    const lateMinutes = lateIdx >= 0 ? parseTimeToDecimalHours(totals[lateIdx]) * 60 : 0;

    // Get working days in month (real holidays fed in below).
    const { workingDays, sundays, holidays } = this.getWorkingDaysInMonth(year, month);

    // Daily hours from the real working-day count (not a fixed 8h). Converte
    // horas de falta em dias-falta — substitui o ceil(/8) hardcode antigo.
    const dailyHours = workingDays > 0 ? 220 / workingDays : 8;
    const absenceDays = absenceHours > 0 ? roundToTwo(absenceHours / dailyHours) : 0;
    const workedDays = this.countWorkedDays(calcData);

    // DSR days (usually Sundays + holidays falling on what would be working days)
    const dsrDays = sundays;

    return {
      employeeId,
      secullumId,
      period: {
        year,
        month,
        ...this.getPayrollPeriodDates(year, month),
      },
      normalHours,
      nightHours,
      overtime50,
      overtime100,
      absenceHours,
      absenceDays,
      justifiedAbsenceHours,
      unjustifiedAbsenceHours,
      dsrDays,
      dsrHours,
      lateArrivalMinutes: lateMinutes,
      earlyDepartureMinutes: 0, // Could extract if available
      workingDaysInMonth: workingDays,
      workedDays,
      sundays,
      holidays,
      rawCalculationData: calcData,
    };
  }

  /**
   * ========================================================================
   * COUNT WORKED DAYS
   * ========================================================================
   */
  private countWorkedDays(calcData: SecullumCalculationData): number {
    // Count days where employee actually worked (has time entries)
    const situacoes = calcData.SituacaoDias || [];
    const infoDias = calcData.InformacoesDias || [];

    let workedDays = 0;

    for (let i = 0; i < infoDias.length; i++) {
      const dayInfo = infoDias[i];
      // Check if day has work (not blank, not before admission, not after dismissal, not DSR)
      if (
        dayInfo &&
        !dayInfo.DiaEmBranco &&
        !dayInfo.AntesAdmissao &&
        !dayInfo.DepoisDemissao &&
        !dayInfo.DSR &&
        !dayInfo.Folga
      ) {
        workedDays++;
      }
    }

    return workedDays;
  }

  /**
   * ========================================================================
   * GET PAYROLL PERIOD DATES (26th to 25th)
   * ========================================================================
   */
  private getPayrollPeriodDates(
    year: number,
    month: number,
  ): { startDate: string; endDate: string } {
    // Start: 26th of previous month
    const startMonth = month === 1 ? 12 : month - 1;
    const startYear = month === 1 ? year - 1 : year;
    const startDate = `${startYear}-${startMonth.toString().padStart(2, '0')}-26`;

    // End: 25th of current month
    const endDate = `${year}-${month.toString().padStart(2, '0')}-25`;

    return { startDate, endDate };
  }

  /**
   * ========================================================================
   * GET WORKING DAYS IN MONTH
   * ========================================================================
   */
  private getWorkingDaysInMonth(
    year: number,
    month: number,
  ): { workingDays: number; sundays: number; holidays: number } {
    const lastDay = new Date(year, month, 0);

    // Real Brazilian national holidays for the calendar year (fixed + Easter-based).
    const holidayDates = getBrazilianHolidays(year);
    const isHoliday = (m0: number, d: number): boolean =>
      holidayDates.some(
        h => h.getUTCFullYear() === year && h.getUTCMonth() === m0 && h.getUTCDate() === d,
      );

    let workingDays = 0;
    let sundays = 0;
    let holidays = 0; // holidays falling on a would-be working day (Mon-Sat)

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();
      const holiday = isHoliday(month - 1, day);

      if (dayOfWeek === 0) {
        sundays++; // Sundays are always DSR days
      } else if (holiday) {
        // Holiday on a working day: counts toward DSR days, not working days.
        holidays++;
      } else {
        workingDays++; // Mon-Sat count as working days
      }
    }

    return { workingDays, sundays, holidays };
  }

  /**
   * ========================================================================
   * GET EMPTY PAYROLL DATA (fallback)
   * ========================================================================
   */
  private getEmptyPayrollData(
    employeeId: string,
    secullumId: string,
    year: number,
    month: number,
  ): SecullumPayrollData {
    const { workingDays, sundays, holidays } = this.getWorkingDaysInMonth(year, month);

    return {
      employeeId,
      secullumId,
      period: {
        year,
        month,
        ...this.getPayrollPeriodDates(year, month),
      },
      normalHours: 0,
      nightHours: 0,
      overtime50: 0,
      overtime100: 0,
      absenceHours: 0,
      absenceDays: 0,
      justifiedAbsenceHours: 0,
      unjustifiedAbsenceHours: 0,
      dsrDays: sundays,
      dsrHours: 0,
      lateArrivalMinutes: 0,
      earlyDepartureMinutes: 0,
      workingDaysInMonth: workingDays,
      workedDays: 0,
      sundays,
      holidays,
      rawCalculationData: null as any,
    };
  }
}
