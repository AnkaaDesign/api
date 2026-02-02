import { Injectable, Logger } from '@nestjs/common';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
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
  dailyBreakdown: DayAnalysis[];
  holidaysCount: number; // NEW: Number of holidays in period
  // Secullum calculated totals (from /Calculos endpoint)
  secullumFaltasTotal: string | null;
  secullumAtrasosTotal: string | null;
}

// Standard workday duration in hours
const WORKDAY_HOURS = 8;

@Injectable()
export class SecullumBonusIntegrationService {
  private readonly logger = new Logger(SecullumBonusIntegrationService.name);

  constructor(
    private readonly secullumService: SecullumService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Analyze all bonifiable users' Secullum time entries for bonus extras/discounts.
   */
  async analyzeAllUsers(
    year: number,
    month: number,
    users: Array<{ id: string; name: string; cpf?: string; pis?: string; payrollNumber?: number }>,
  ): Promise<Map<string, SecullumBonusAnalysis>> {
    const results = new Map<string, SecullumBonusAnalysis>();

    const periodStart = getBonusPeriodStart(year, month);
    const periodEnd = getBonusPeriodEnd(year, month);

    // Format dates for Secullum API (yyyy-MM-dd)
    const startDate = this.formatDateForSecullum(periodStart);
    const endDate = this.formatDateForSecullum(periodEnd);

    this.logger.log(
      `Analyzing Secullum time entries for ${users.length} users, period ${startDate} to ${endDate}`,
    );

    // Pre-fetch all Secullum employees once (avoid N+1 API calls)
    let secullumEmployees: any[] = [];
    try {
      const employeesResponse = await this.secullumService.getEmployees();
      if (employeesResponse.success && Array.isArray(employeesResponse.data)) {
        secullumEmployees = employeesResponse.data;
        this.logger.log(`Loaded ${secullumEmployees.length} Secullum employees for matching`);
      } else {
        this.logger.error('Failed to fetch Secullum employees list');
        return results;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch Secullum employees: ${error?.message || error}`);
      return results;
    }

    // Fetch holidays for the period from Secullum
    const holidays = await this.getHolidaysForPeriod(periodStart, periodEnd);
    this.logger.log(`Loaded ${holidays.length} holidays for period ${startDate} to ${endDate}`);

    for (const user of users) {
      try {
        const analysis = await this.analyzeUser(user, startDate, endDate, secullumEmployees, holidays);
        if (analysis) {
          results.set(user.id, analysis);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to analyze Secullum data for user ${user.name} (${user.id}): ${error?.message || error}`,
        );
      }
    }

    this.logger.log(`Secullum analysis completed: ${results.size}/${users.length} users analyzed`);
    return results;
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
      const normalizeCpf = (cpf: string) => cpf ? cpf.replace(/[.-]/g, '') : '';
      const userCpf = user.cpf ? normalizeCpf(user.cpf) : '';
      const userPis = user.pis || '';
      const userPayroll = user.payrollNumber?.toString() || '';

      const match = secullumEmployees.find((emp: any) => {
        const empCpf = normalizeCpf(emp.Cpf || '');
        const empPis = emp.NumeroPis || '';
        const empPayroll = (emp.NumeroFolha || '').toString();
        return (userCpf && empCpf === userCpf) ||
               (userPis && empPis === userPis) ||
               (userPayroll && empPayroll === userPayroll);
      });

      if (!match) {
        this.logger.warn(`No Secullum employee match for ${user.name} (cpf=${user.cpf}, pis=${user.pis}, payroll=${user.payrollNumber})`);
        return null;
      }
      secullumEmployeeId = match.Id;
      this.logger.debug(`Matched ${user.name} → Secullum employee ${match.Nome} (ID=${match.Id})`);
    }

    if (!secullumEmployeeId) {
      return null;
    }

    // Fetch time entries (Batidas) for electronic stamp detection
    let entries: any[] = [];
    try {
      entries = await this.secullumService.getTimeEntriesBySecullumId(
        secullumEmployeeId,
        startDate,
        endDate,
      );
    } catch (error) {
      this.logger.warn(`Batidas API failed for ${user.name} (secullumId=${secullumEmployeeId}): ${error?.message || error}`);
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

    // Parse Faltas and Atrasos from Calculos endpoint
    const { faltasHours, atrasosHours, faltasTotal, atrasosTotal, dailyCargaHours } = this.parseCalculationTotals(calculationData);

    // Determine actual workday hours from Carga (e.g., 8:45 = 8.75h instead of assumed 8h)
    const actualWorkdayHours = dailyCargaHours > 0 ? dailyCargaHours : WORKDAY_HOURS;

    this.logger.log(`User ${user.name}: Secullum Calculos → Faltas=${faltasTotal}, Atrasos=${atrasosTotal} (parsed: faltasH=${faltasHours}, atrasosH=${atrasosHours}, workdayH=${actualWorkdayHours})`);

    // Analyze each day from Batidas for electronic stamp detection
    const dailyBreakdown: DayAnalysis[] = [];
    let totalWorkingDays = 0;
    let daysWithFullElectronicStamps = 0;
    let atestadoDayEquivalent = 0; // sum of proportions (0.5 for half-day, 1 for full-day)
    let manualUnjustifiedHours = 0;

    for (const entry of entries) {
      const dayAnalysis = this.analyzeDay(entry, holidays);
      dailyBreakdown.push(dayAnalysis);

      // Only count working days (Mon-Fri, excluding holidays)
      if (dayAnalysis.isWorkingDay) {
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
    const atestadoDiscountPercentage = this.getAtestadoDiscountPercentage(totalAtestadoHours);
    const unjustifiedDiscountPercentage = this.getUnjustifiedDiscountPercentage(totalUnjustifiedAbsenceHours);

    // Get tier labels for display
    const atestadoTierLabel = this.getAtestadoTierLabel(totalAtestadoHours);
    const unjustifiedTierLabel = this.getUnjustifiedTierLabel(totalUnjustifiedAbsenceHours);

    // Determine if user loses extra
    const losesExtraFromAtestado = this.doesAtestadoLoseExtra(totalAtestadoHours);
    const losesExtraFromUnjustified = totalUnjustifiedAbsenceHours > 0;
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
      dailyBreakdown,
      holidaysCount: holidays.length,
      secullumFaltasTotal: faltasTotal,
      secullumAtrasosTotal: atrasosTotal,
    };
  }

  /**
   * Parse Faltas and Atrasos totals from Secullum Calculos response.
   * The response has Colunas[] (column definitions) and Totais[] (total values).
   * We find the column index for "Faltas" and "Atras." and read their totals.
   */
  private parseCalculationTotals(data: SecullumCalculationData | null): {
    faltasHours: number;
    atrasosHours: number;
    faltasTotal: string | null;
    atrasosTotal: string | null;
    dailyCargaHours: number;
  } {
    if (!data || !data.Colunas || !data.Totais) {
      return { faltasHours: 0, atrasosHours: 0, faltasTotal: null, atrasosTotal: null, dailyCargaHours: 0 };
    }

    let faltasIndex = -1;
    let atrasosIndex = -1;
    let cargaIndex = -1;

    for (let i = 0; i < data.Colunas.length; i++) {
      const col = data.Colunas[i];
      const nome = (col.Nome || '').toLowerCase();
      const nomeExibicao = (col.NomeExibicao || '').toLowerCase();

      if (nome === 'faltas' || nomeExibicao === 'faltas') {
        faltasIndex = i;
      }
      if (nome === 'atras.' || nomeExibicao === 'atras.' || nome === 'atrasos' || nomeExibicao === 'atrasos') {
        atrasosIndex = i;
      }
      if (nome === 'carga' || nomeExibicao === 'carga') {
        cargaIndex = i;
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

    return {
      faltasHours: this.parseTimeToHours(faltasTotal),
      atrasosHours: this.parseTimeToHours(atrasosTotal),
      faltasTotal,
      atrasosTotal,
      dailyCargaHours,
    };
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
    const isValidStamp = (s: any) => s && typeof s === 'string' && s.trim() !== '' && /\d{1,2}:\d{2}/.test(s);

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

    // Check if this day is a holiday
    const entryDate = new Date(date);
    const isHoliday = holidays.some(holiday =>
      holiday.getFullYear() === entryDate.getFullYear() &&
      holiday.getMonth() === entryDate.getMonth() &&
      holiday.getDate() === entryDate.getDate()
    );

    // Working day = Monday-Friday, not a holiday, not vacation
    const isWorkingDay = this.isWorkingDay(tipoDoDia, date) && !isFerias && !isHoliday;

    const hasAllFourStamps = isValidStamp(entrada1) && isValidStamp(saida1) && isValidStamp(entrada2) && isValidStamp(saida2) && !isAtestado;

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

    const allStampsElectronic = hasAllFourStamps && this.allOriginsElectronic([
      origemEntrada1,
      origemSaida1,
      origemEntrada2,
      origemSaida2,
    ]);

    let atestadoHours = 0;
    let unjustifiedAbsenceHours = 0;

    if (isWorkingDay && isAtestado) {
      atestadoHours = WORKDAY_HOURS * atestadoProportion;
    } else if (isWorkingDay && !hasAllFourStamps && !isAtestado) {
      const hasSomeStamps = isValidStamp(entrada1) || isValidStamp(saida1) || isValidStamp(entrada2) || isValidStamp(saida2);
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
      isUnjustifiedAbsence: isWorkingDay && !hasAllFourStamps && !isAtestado && unjustifiedAbsenceHours > 0,
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
      return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
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
