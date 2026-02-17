import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { isWeekend } from '../../../utils/date';

/**
 * Interface for the Secullum holiday data shape
 */
interface SecullumHoliday {
  Id: number;
  Data: string;
  Descricao: string;
  Tipo?: string;
}

/**
 * Interface for holiday fetch service — decoupled from SecullumService to avoid circular deps
 */
export interface HolidayProvider {
  getHolidays(params?: { year?: number }): Promise<{
    success: boolean;
    data?: SecullumHoliday[];
  }>;
}

/**
 * Injection token for the holiday provider
 */
export const HOLIDAY_PROVIDER = 'HOLIDAY_PROVIDER';

/**
 * WorkScheduleService
 *
 * Centralized service for checking working days and work hours.
 * Used by all notification services to enforce the rule:
 * "Never send notifications outside work hours, on weekends, or on holidays."
 *
 * Caches holiday data per day to avoid repeated API calls to Secullum.
 */
@Injectable()
export class WorkScheduleService {
  private readonly logger = new Logger(WorkScheduleService.name);

  // Work hours in São Paulo timezone
  private readonly WORK_START_HOUR = 7.5; // 7:30 AM
  private readonly WORK_END_HOUR = 18.5; // 6:30 PM (allows time entry reminders at 18:15 to be processed)

  // Holiday cache — stores holiday date strings (YYYY-MM-DD) for the current year
  private cachedHolidays: Set<string> | null = null;
  private cachedHolidayYear: number | null = null;
  private lastHolidayFetch: number = 0;
  private readonly HOLIDAY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  constructor(
    @Optional()
    @Inject(HOLIDAY_PROVIDER)
    private readonly holidayProvider: HolidayProvider | null,
  ) {}

  /**
   * Check if notifications can be sent right now.
   * Returns false if:
   * - It's a weekend (Saturday/Sunday)
   * - It's a holiday (from Secullum)
   * - It's outside work hours (before 7:30 or after 18:00 São Paulo time)
   */
  async canSendNow(): Promise<boolean> {
    const now = new Date();
    const saoPauloTime = this.toSaoPauloTime(now);

    // 1. Weekend check (fast, no API call)
    const day = saoPauloTime.getDay();
    if (day === 0 || day === 6) {
      this.logger.debug('Blocked: weekend');
      return false;
    }

    // 2. Holiday check (cached, occasional API call)
    const isHoliday = await this.isHoliday(saoPauloTime);
    if (isHoliday) {
      this.logger.debug('Blocked: holiday');
      return false;
    }

    // 3. Work hours check
    const hours = saoPauloTime.getHours();
    const minutes = saoPauloTime.getMinutes();
    const currentTimeInHours = hours + minutes / 60;

    if (currentTimeInHours < this.WORK_START_HOUR || currentTimeInHours >= this.WORK_END_HOUR) {
      this.logger.debug(
        `Blocked: outside work hours (${hours}:${minutes.toString().padStart(2, '0')})`,
      );
      return false;
    }

    return true;
  }

  /**
   * Calculate the next time notifications can be sent.
   * Skips weekends and holidays, returns next working day at 7:30 AM São Paulo time.
   */
  async getNextSendableTime(): Promise<Date> {
    const now = new Date();
    const saoPauloTime = this.toSaoPauloTime(now);
    const currentHours = saoPauloTime.getHours() + saoPauloTime.getMinutes() / 60;

    // Start candidate: today at 7:30 if before 7:30, otherwise tomorrow at 7:30
    const candidate = new Date(saoPauloTime);
    if (currentHours < this.WORK_START_HOUR) {
      // Today might still be valid — check if it's a working day
      candidate.setHours(7, 30, 0, 0);
    } else {
      // Already past work start, move to tomorrow
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(7, 30, 0, 0);
    }

    // Skip weekends and holidays (max 10 days to prevent infinite loop)
    for (let i = 0; i < 10; i++) {
      const day = candidate.getDay();
      if (day !== 0 && day !== 6) {
        const isHoliday = await this.isHoliday(candidate);
        if (!isHoliday) {
          break; // Found a working day
        }
      }
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(7, 30, 0, 0);
    }

    this.logger.debug(`Next sendable time: ${candidate.toISOString()}`);
    return candidate;
  }

  /**
   * Check if a given date (in São Paulo time) is a holiday
   */
  private async isHoliday(saoPauloDate: Date): Promise<boolean> {
    if (!this.holidayProvider) {
      return false; // No holiday provider available — fail open
    }

    try {
      const year = saoPauloDate.getFullYear();
      const holidays = await this.getHolidaysForYear(year);
      const dateStr = this.formatDateStr(saoPauloDate);
      return holidays.has(dateStr);
    } catch (error) {
      this.logger.warn(`Failed to check holidays: ${error.message}. Assuming working day.`);
      return false; // Fail open — don't block notifications if Secullum is down
    }
  }

  /**
   * Get cached holidays for a given year, refreshing if needed
   */
  private async getHolidaysForYear(year: number): Promise<Set<string>> {
    const now = Date.now();
    const cacheValid =
      this.cachedHolidays !== null &&
      this.cachedHolidayYear === year &&
      now - this.lastHolidayFetch < this.HOLIDAY_CACHE_TTL_MS;

    if (cacheValid) {
      return this.cachedHolidays!;
    }

    // Fetch from Secullum
    const response = await this.holidayProvider!.getHolidays({ year });
    const holidays = new Set<string>();

    if (response.success && response.data) {
      for (const holiday of response.data) {
        const dateStr = holiday.Data.split('T')[0]; // YYYY-MM-DD
        holidays.add(dateStr);
      }
    }

    // Update cache
    this.cachedHolidays = holidays;
    this.cachedHolidayYear = year;
    this.lastHolidayFetch = now;

    this.logger.log(`Cached ${holidays.size} holidays for year ${year}`);
    return holidays;
  }

  /**
   * Convert a Date to São Paulo local time (as a new Date object)
   */
  private toSaoPauloTime(date: Date): Date {
    return new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  }

  /**
   * Format a date as YYYY-MM-DD string
   */
  private formatDateStr(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
