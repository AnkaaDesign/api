import { SCHEDULE_FREQUENCY } from '@constants';
import { addDays, addWeeks, addMonths, addYears, startOfDay } from "date-fns";

/**
 * Universal schedule calculation utility
 * Calculates the next run date based on frequency and interval
 */
export function calculateNextScheduleRun(
  frequency: SCHEDULE_FREQUENCY,
  interval: number = 1,
  fromDate: Date = new Date(),
  config?: {
    dayOfWeek?: string | null;
    dayOfMonth?: number | null;
    month?: string | null;
    specificDate?: Date | null;
  },
): Date | null {
  if (!frequency || interval < 1) return null;

  const baseDate = startOfDay(fromDate);
  let nextDate = new Date(baseDate);

  switch (frequency) {
    case SCHEDULE_FREQUENCY.ONCE:
      // One-time schedules should use specific date or immediate execution
      return config?.specificDate ? new Date(config.specificDate) : baseDate;

    case SCHEDULE_FREQUENCY.DAILY:
      // Daily with interval (every X days)
      return addDays(nextDate, interval);

    case SCHEDULE_FREQUENCY.WEEKLY:
      // Weekly with interval (every X weeks)
      nextDate = addWeeks(nextDate, interval);

      // Adjust to specific day of week if provided
      if (config?.dayOfWeek) {
        const targetDay = getDayOfWeekNumber(config.dayOfWeek);
        const currentDay = nextDate.getDay();
        const daysToAdd = (targetDay - currentDay + 7) % 7;
        nextDate = addDays(nextDate, daysToAdd);
      }
      return nextDate;

    case SCHEDULE_FREQUENCY.MONTHLY:
      // Monthly with interval (every X months)
      nextDate = addMonths(nextDate, interval);

      // Adjust to specific day of month if provided
      if (config?.dayOfMonth) {
        const targetDay = Math.min(config.dayOfMonth, getDaysInMonth(nextDate));
        nextDate.setDate(targetDay);
      }
      return nextDate;

    case SCHEDULE_FREQUENCY.ANNUAL:
      // Annual with interval (every X years)
      nextDate = addYears(nextDate, interval);

      // Adjust to specific month and day if provided
      if (config?.month) {
        const targetMonth = getMonthNumber(config.month);
        nextDate.setMonth(targetMonth);

        if (config?.dayOfMonth) {
          const targetDay = Math.min(config.dayOfMonth, getDaysInMonth(nextDate));
          nextDate.setDate(targetDay);
        }
      }
      return nextDate;

    case SCHEDULE_FREQUENCY.CUSTOM:
      // Custom frequency requires manual handling
      return null;

    default:
      return null;
  }
}

/**
 * Get day of week number (0 = Sunday, 1 = Monday, etc.)
 */
function getDayOfWeekNumber(dayOfWeek: string): number {
  const dayMap: Record<string, number> = {
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
  };
  return dayMap[dayOfWeek.toUpperCase()] ?? 1;
}

/**
 * Get month number (0-based for JS Date)
 */
function getMonthNumber(month: string): number {
  const monthMap: Record<string, number> = {
    JANUARY: 0,
    FEBRUARY: 1,
    MARCH: 2,
    APRIL: 3,
    MAY: 4,
    JUNE: 5,
    JULY: 6,
    AUGUST: 7,
    SEPTEMBER: 8,
    OCTOBER: 9,
    NOVEMBER: 10,
    DECEMBER: 11,
  };
  return monthMap[month.toUpperCase()] ?? 0;
}

/**
 * Get days in month
 */
function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Format schedule description with proper interval handling
 */
export function formatScheduleDescription(
  frequency: SCHEDULE_FREQUENCY,
  interval: number = 1,
  config?: {
    dayOfWeek?: string | null;
    dayOfMonth?: number | null;
    month?: string | null;
  },
): string {
  if (!frequency) return "";

  const parts: string[] = [];

  switch (frequency) {
    case SCHEDULE_FREQUENCY.ONCE:
      parts.push("Uma vez");
      break;

    case SCHEDULE_FREQUENCY.DAILY:
      if (interval === 1) {
        parts.push("Diariamente");
      } else {
        parts.push(`A cada ${interval} dias`);
      }
      break;

    case SCHEDULE_FREQUENCY.WEEKLY:
      if (interval === 1) {
        parts.push("Semanalmente");
      } else if (interval === 2) {
        parts.push("Quinzenalmente");
      } else {
        parts.push(`A cada ${interval} semanas`);
      }

      if (config?.dayOfWeek) {
        parts.push(`às ${getDayOfWeekLabel(config.dayOfWeek)}`);
      }
      break;

    case SCHEDULE_FREQUENCY.MONTHLY:
      if (interval === 1) {
        parts.push("Mensalmente");
      } else if (interval === 2) {
        parts.push("Bimestralmente");
      } else if (interval === 3) {
        parts.push("Trimestralmente");
      } else if (interval === 4) {
        parts.push("Quadrimestralmente");
      } else if (interval === 6) {
        parts.push("Semestralmente");
      } else {
        parts.push(`A cada ${interval} meses`);
      }

      if (config?.dayOfMonth) {
        parts.push(`no dia ${config.dayOfMonth}`);
      }
      break;

    case SCHEDULE_FREQUENCY.ANNUAL:
      if (interval === 1) {
        parts.push("Anualmente");
      } else {
        parts.push(`A cada ${interval} anos`);
      }

      if (config?.month) {
        parts.push(`em ${getMonthLabel(config.month)}`);
        if (config?.dayOfMonth) {
          parts.push(`dia ${config.dayOfMonth}`);
        }
      }
      break;

    default:
      parts.push(frequency);
  }

  return parts.join(" ");
}

/**
 * Get day of week label in Portuguese
 */
function getDayOfWeekLabel(dayOfWeek: string): string {
  const labels: Record<string, string> = {
    MONDAY: "segundas-feiras",
    TUESDAY: "terças-feiras",
    WEDNESDAY: "quartas-feiras",
    THURSDAY: "quintas-feiras",
    FRIDAY: "sextas-feiras",
    SATURDAY: "sábados",
    SUNDAY: "domingos",
  };
  return labels[dayOfWeek.toUpperCase()] ?? dayOfWeek;
}

/**
 * Get month label in Portuguese
 */
function getMonthLabel(month: string): string {
  const labels: Record<string, string> = {
    JANUARY: "Janeiro",
    FEBRUARY: "Fevereiro",
    MARCH: "Março",
    APRIL: "Abril",
    MAY: "Maio",
    JUNE: "Junho",
    JULY: "Julho",
    AUGUST: "Agosto",
    SEPTEMBER: "Setembro",
    OCTOBER: "Outubro",
    NOVEMBER: "Novembro",
    DECEMBER: "Dezembro",
  };
  return labels[month.toUpperCase()] ?? month;
}
