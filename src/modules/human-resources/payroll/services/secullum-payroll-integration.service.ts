import { Injectable, Logger } from '@nestjs/common';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { SecullumCalculationData } from '@modules/integrations/secullum/dto';

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

  constructor(private readonly secullumService: SecullumService) {}

  /**
   * ========================================================================
   * GET PAYROLL DATA FROM SECULLUM (with automatic mapping)
   * ========================================================================
   * Fetches and parses Secullum calculation data for a specific employee/period
   * Automatically maps employee using CPF, PIS, or Payroll Number
   */
  async getPayrollDataFromSecullum(params: {
    employeeId: string; // Our system's user ID
    cpf?: string; // CPF for mapping
    pis?: string; // PIS for mapping
    payrollNumber?: string; // Payroll number for mapping
    year: number;
    month: number;
  }): Promise<SecullumPayrollData> {
    const { employeeId, cpf, pis, payrollNumber, year, month } = params;

    this.logger.log(
      `Fetching Secullum payroll data for employee ${employeeId} - ${year}/${month}`,
    );
    this.logger.log(
      `  Mapping criteria - CPF: ${cpf || 'N/A'}, PIS: ${pis || 'N/A'}, Payroll: ${payrollNumber || 'N/A'}`,
    );

    // Calculate payroll period (26th to 25th)
    const { startDate, endDate } = this.getPayrollPeriodDates(year, month);

    try {
      // Find Secullum employee using CPF, PIS, or Payroll Number
      const secullumEmployee = await this.secullumService.findSecullumEmployee({
        cpf: cpf || undefined,
        pis: pis || undefined,
        payrollNumber: payrollNumber ? parseInt(payrollNumber, 10) : undefined,
      });

      if (!secullumEmployee.success || !secullumEmployee.data) {
        this.logger.warn(
          `Could not find Secullum employee for ${employeeId} (CPF: ${cpf}, PIS: ${pis}, Payroll: ${payrollNumber})`,
        );
        return this.getEmptyPayrollData(employeeId, '', year, month);
      }

      const secullumId = secullumEmployee.data.secullumId.toString();
      this.logger.log(`  Mapped to Secullum employee ID: ${secullumId}`);

      // Get calculations from Secullum
      const calculationsResponse = await this.secullumService.getCalculations({
        employeeId: secullumId,
        startDate,
        endDate,
      });

      if (!calculationsResponse.success || !calculationsResponse.data) {
        this.logger.warn(`No calculation data from Secullum for employee ${secullumId}`);
        return this.getEmptyPayrollData(employeeId, secullumId, year, month);
      }

      const calcData = calculationsResponse.data;

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
      return this.getEmptyPayrollData(employeeId, '', year, month);
    }
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
        searchTerms.some(term =>
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
    const normalHoursIdx = findColumnIndex(['normais', 'horas trabalhadas', 'horas normais', 'trabalho normal']);
    const nightHoursIdx = findColumnIndex(['not.', 'noturnas', 'horas noturnas', 'adicional noturno', 'noturno']);
    const overtime50Idx = findColumnIndex(['ex50%', '50%', 'extra 50', 'he 50']);
    const overtime100Idx = findColumnIndex(['ex100%', '100%', 'extra 100', 'he 100']);
    const absenceIdx = findColumnIndex(['faltas', 'ausências', 'horas falta']);
    const dsrIdx = findColumnIndex(['dsr', 'descanso semanal']);
    const lateIdx = findColumnIndex(['atras', 'atrasos', 'atraso']);

    // Extract totals from the last row
    const normalHours = normalHoursIdx >= 0 ? parseTimeToDecimalHours(totals[normalHoursIdx]) : 0;
    const nightHours = nightHoursIdx >= 0 ? parseTimeToDecimalHours(totals[nightHoursIdx]) : 0;
    const overtime50 = overtime50Idx >= 0 ? parseTimeToDecimalHours(totals[overtime50Idx]) : 0;
    const overtime100 = overtime100Idx >= 0 ? parseTimeToDecimalHours(totals[overtime100Idx]) : 0;
    const absenceHours = absenceIdx >= 0 ? parseTimeToDecimalHours(totals[absenceIdx]) : 0;
    const dsrHours = dsrIdx >= 0 ? parseTimeToDecimalHours(totals[dsrIdx]) : 0;
    const lateMinutes = lateIdx >= 0 ? parseTimeToDecimalHours(totals[lateIdx]) * 60 : 0;

    // Calculate days
    const absenceDays = absenceHours > 0 ? Math.ceil(absenceHours / 8) : 0; // Assuming 8h workday
    const workedDays = this.countWorkedDays(calcData);

    // Get working days in month
    const { workingDays, sundays, holidays } = this.getWorkingDaysInMonth(year, month);

    // DSR days (usually Sundays)
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
      justifiedAbsenceHours: 0, // Secullum might have this in details, default 0
      unjustifiedAbsenceHours: absenceHours, // Assume all unjustified unless specified
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
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    let workingDays = 0;
    let sundays = 0;

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();

      if (dayOfWeek === 0) {
        sundays++;
      } else {
        workingDays++; // Mon-Sat count as working days
      }
    }

    return { workingDays, sundays, holidays: 0 }; // TODO: Get actual holidays from Secullum
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
