// packages/utils/src/dateUtils.ts

import { WEEK_DAY, MONTH } from '@constants';

// =====================
// Date Formatting
// =====================

export const formatDate = (date: Date | string | null | undefined, _locale: string = "pt-BR"): string => {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Data inválida";

  return new Intl.DateTimeFormat(_locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
};

export const formatDateTime = (date: Date | string | null | undefined, _locale: string = "pt-BR"): string => {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Data inválida";

  return new Intl.DateTimeFormat(_locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export const formatTime = (date: Date | string, _locale: string = "pt-BR"): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Hora inválida";

  return new Intl.DateTimeFormat(_locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export const formatDateLong = (date: Date | string, _locale: string = "pt-BR"): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Data inválida";

  return new Intl.DateTimeFormat(_locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
};

export const formatRelativeTime = (date: Date | string, _locale: string = "pt-BR"): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Data inválida";

  const now = new Date();
  const diffMs = d.getTime() - now.getTime(); // Changed: future - now (positive for future, negative for past)
  const isFuture = diffMs > 0;
  const absDiffMs = Math.abs(diffMs);

  const diffSeconds = Math.floor(absDiffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  const prefix = isFuture ? "daqui" : "há";
  const suffix = isFuture ? "" : "";

  if (diffSeconds < 60) return "agora mesmo";
  if (diffMinutes < 60) return `${prefix} ${diffMinutes} ${diffMinutes === 1 ? "minuto" : "minutos"}${suffix}`;
  if (diffHours < 24) return `${prefix} ${diffHours} ${diffHours === 1 ? "hora" : "horas"}${suffix}`;
  if (diffDays < 7) return `${prefix} ${diffDays} ${diffDays === 1 ? "dia" : "dias"}${suffix}`;
  if (diffDays < 30) return `${prefix} ${diffWeeks} ${diffWeeks === 1 ? "semana" : "semanas"}${suffix}`;
  if (diffMonths < 12) return `${prefix} ${diffMonths} ${diffMonths === 1 ? "mês" : "meses"}${suffix}`;
  return `${prefix} ${diffYears} ${diffYears === 1 ? "ano" : "anos"}${suffix}`;
};

// =====================
// Date Calculations
// =====================

export const addDays = (date: Date | string, days: number): Date => {
  const d = new Date(typeof date === "string" ? new Date(date) : date);
  d.setDate(d.getDate() + days);
  return d;
};

export const addWeeks = (date: Date | string, weeks: number): Date => {
  return addDays(date, weeks * 7);
};

export const addMonths = (date: Date | string, months: number): Date => {
  const d = new Date(typeof date === "string" ? new Date(date) : date);
  d.setMonth(d.getMonth() + months);
  return d;
};

export const addYears = (date: Date | string, years: number): Date => {
  const d = new Date(typeof date === "string" ? new Date(date) : date);
  d.setFullYear(d.getFullYear() + years);
  return d;
};

export const subtractDays = (date: Date | string, days: number): Date => {
  return addDays(date, -days);
};

export const subtractWeeks = (date: Date | string, weeks: number): Date => {
  return addWeeks(date, -weeks);
};

export const subtractMonths = (date: Date | string, months: number): Date => {
  return addMonths(date, -months);
};

export const subtractYears = (date: Date | string, years: number): Date => {
  return addYears(date, -years);
};

// =====================
// Date Comparisons
// =====================

export const isSameDay = (date1: Date | string, date2: Date | string): boolean => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
};

export const isSameWeek = (date1: Date | string, date2: Date | string): boolean => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  const startOfWeek1 = getStartOfWeek(d1);
  const startOfWeek2 = getStartOfWeek(d2);

  return isSameDay(startOfWeek1, startOfWeek2);
};

export const isSameMonth = (date1: Date | string, date2: Date | string): boolean => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
};

export const isSameYear = (date1: Date | string, date2: Date | string): boolean => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return d1.getFullYear() === d2.getFullYear();
};

export const isAfter = (date1: Date | string, date2: Date | string): boolean => {
  return new Date(date1).getTime() > new Date(date2).getTime();
};

export const isBefore = (date1: Date | string, date2: Date | string): boolean => {
  return new Date(date1).getTime() < new Date(date2).getTime();
};

export const isToday = (date: Date | string): boolean => {
  return isSameDay(date, new Date());
};

export const isYesterday = (date: Date | string): boolean => {
  const yesterday = subtractDays(new Date(), 1);
  return isSameDay(date, yesterday);
};

export const isTomorrow = (date: Date | string): boolean => {
  const tomorrow = addDays(new Date(), 1);
  return isSameDay(date, tomorrow);
};

export const isThisWeek = (date: Date | string): boolean => {
  return isSameWeek(date, new Date());
};

export const isThisMonth = (date: Date | string): boolean => {
  return isSameMonth(date, new Date());
};

export const isThisYear = (date: Date | string): boolean => {
  return isSameYear(date, new Date());
};

// =====================
// Date Range Helpers
// =====================

export const isDateInRange = (date: Date | string, startDate: Date | string, endDate: Date | string): boolean => {
  const d = new Date(date);
  const start = new Date(startDate);
  const end = new Date(endDate);

  return d >= start && d <= end;
};

export const getDaysBetween = (startDate: Date | string, endDate: Date | string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const getWeeksBetween = (startDate: Date | string, endDate: Date | string): number => {
  return Math.floor(getDaysBetween(startDate, endDate) / 7);
};

export const getMonthsBetween = (startDate: Date | string, endDate: Date | string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const yearsDiff = end.getFullYear() - start.getFullYear();
  const monthsDiff = end.getMonth() - start.getMonth();

  return yearsDiff * 12 + monthsDiff;
};

export const getYearsBetween = (startDate: Date | string, endDate: Date | string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  return end.getFullYear() - start.getFullYear();
};

// =====================
// Date Period Helpers
// =====================

export const getStartOfDay = (date: Date | string): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const getEndOfDay = (date: Date | string): Date => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

export const getStartOfWeek = (date: Date | string, startDay: number = 0): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day < startDay ? 7 : 0) + day - startDay;

  d.setDate(d.getDate() - diff);
  return getStartOfDay(d);
};

export const getEndOfWeek = (date: Date | string, startDay: number = 0): Date => {
  const startOfWeek = getStartOfWeek(date, startDay);
  return getEndOfDay(addDays(startOfWeek, 6));
};

export const getStartOfMonth = (date: Date | string): Date => {
  const d = new Date(date);
  d.setDate(1);
  return getStartOfDay(d);
};

export const getEndOfMonth = (date: Date | string): Date => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1, 0);
  return getEndOfDay(d);
};

export const getStartOfYear = (date: Date | string): Date => {
  const d = new Date(date);
  d.setMonth(0, 1);
  return getStartOfDay(d);
};

export const getEndOfYear = (date: Date | string): Date => {
  const d = new Date(date);
  d.setMonth(11, 31);
  return getEndOfDay(d);
};

// =====================
// Business Days
// =====================

export const isWeekend = (date: Date | string): boolean => {
  const d = new Date(date);
  const day = d.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

export const isWeekday = (date: Date | string): boolean => {
  return !isWeekend(date);
};

export const getNextWorkday = (date: Date | string): Date => {
  let nextDay = addDays(date, 1);

  while (isWeekend(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }

  return nextDay;
};

export const getPreviousWorkday = (date: Date | string): Date => {
  let prevDay = subtractDays(date, 1);

  while (isWeekend(prevDay)) {
    prevDay = subtractDays(prevDay, 1);
  }

  return prevDay;
};

export const getWorkdaysBetween = (startDate: Date | string, endDate: Date | string, excludeHolidays: Date[] = []): number => {
  let count = 0;
  let current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    if (isWeekday(current) && !excludeHolidays.some((holiday) => isSameDay(current, holiday))) {
      count++;
    }
    current = addDays(current, 1);
  }

  return count;
};

// =====================
// Age Calculations
// =====================

export const getAge = (birthDate: Date | string): number => {
  const birth = new Date(birthDate);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
};

export const getDetailedAge = (
  birthDate: Date | string,
): {
  years: number;
  months: number;
  days: number;
} => {
  const birth = new Date(birthDate);
  const today = new Date();

  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  let days = today.getDate() - birth.getDate();

  if (days < 0) {
    months--;
    const lastDayOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    days += lastDayOfPrevMonth;
  }

  if (months < 0) {
    years--;
    months += 12;
  }

  return { years, months, days };
};

// =====================
// Date Validation
// =====================

export const isValidDate = (date: unknown): date is Date => {
  if (!date) return false;
  const d = new Date(date as string | number | Date);
  return d instanceof Date && !isNaN(d.getTime());
};

export const isDateInPast = (date: Date | string): boolean => {
  return isBefore(date, new Date());
};

export const isDateInFuture = (date: Date | string): boolean => {
  return isAfter(date, new Date());
};

export const isLeapYear = (year: number): boolean => {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
};

// =====================
// Date Range Helpers
// =====================

export interface DateRange {
  gte?: Date;
  lte?: Date;
}

export const createDateRange = (startDate?: Date | string, endDate?: Date | string): DateRange => {
  const range: DateRange = {};

  if (startDate) {
    range.gte = typeof startDate === "string" ? new Date(startDate) : startDate;
  }

  if (endDate) {
    range.lte = typeof endDate === "string" ? new Date(endDate) : endDate;
  }

  return range;
};

export const createMonthRange = (year: number, month: number): DateRange => {
  return {
    gte: new Date(year, month - 1, 1),
    lte: new Date(year, month, 0, 23, 59, 59, 999),
  };
};

export const createYearRange = (year: number): DateRange => {
  return {
    gte: new Date(year, 0, 1),
    lte: new Date(year, 11, 31, 23, 59, 59, 999),
  };
};

export const createLastNDaysRange = (days: number): DateRange => {
  const now = new Date();
  return {
    gte: subtractDays(now, days),
    lte: now,
  };
};

export const createTodayRange = (): DateRange => {
  return {
    gte: getStartOfDay(new Date()),
    lte: getEndOfDay(new Date()),
  };
};

export const createThisWeekRange = (): DateRange => {
  return {
    gte: getStartOfWeek(new Date()),
    lte: getEndOfWeek(new Date()),
  };
};

export const createThisMonthRange = (): DateRange => {
  return {
    gte: getStartOfMonth(new Date()),
    lte: getEndOfMonth(new Date()),
  };
};

export const createThisYearRange = (): DateRange => {
  return {
    gte: getStartOfYear(new Date()),
    lte: getEndOfYear(new Date()),
  };
};

// =====================
// Date Parsing
// =====================

export const parseDate = (dateString: string, format: string = "DD/MM/YYYY"): Date | null => {
  try {
    if (format === "DD/MM/YYYY") {
      const [day, month, year] = dateString.split("/");
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    if (format === "MM/DD/YYYY") {
      const [month, day, year] = dateString.split("/");
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    if (format === "YYYY-MM-DD") {
      const [year, month, day] = dateString.split("-");
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    return new Date(dateString);
  } catch {
    return null;
  }
};

// =====================
// Timezone Helpers
// =====================

export const formatDateInTimezone = (date: Date | string, timezone: string = "America/Sao_Paulo"): string => {
  const d = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export const getTimezoneOffset = (timezone: string = "America/Sao_Paulo"): number => {
  const now = new Date();
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  const targetTime = new Date(utc.toLocaleString("en-US", { timeZone: timezone }));
  return (targetTime.getTime() - utc.getTime()) / (1000 * 60 * 60);
};

export const getDaysAgo = (date: Date | string): number => {
  return dateUtils.getDaysBetween(date, new Date());
};

export const getHoursAgo = (date: Date | string): number => {
  const now = new Date();
  const targetDate = new Date(date);
  const diffMs = now.getTime() - targetDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60));
};

export const getMinutesAgo = (date: Date | string): number => {
  const now = new Date();
  const targetDate = new Date(date);
  const diffMs = now.getTime() - targetDate.getTime();
  return Math.floor(diffMs / (1000 * 60));
};

export const getHoursBetween = (startDate: Date | string, endDate: Date | string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = Math.abs(end.getTime() - start.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60));
};

export const getWeekOfYear = (date: Date | string): number => {
  const d = new Date(date);
  const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
  const pastDaysOfYear = dateUtils.getDaysBetween(firstDayOfYear, d);
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
};

export const getTimeAgo = (date: Date | string): string => {
  return dateUtils.formatRelativeTime(date);
};

export const getDurationBetweenDates = (startDate: Date | string | null, endDate: Date | string | null): string => {
  if (!startDate || !endDate) return "-";

  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = end.getTime() - start.getTime();

  if (diff < 0) return "-";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
};

export const dayOfWeekToNumber = (day: WEEK_DAY): number => {
  const mapping: Record<WEEK_DAY, number> = {
    [WEEK_DAY.SUNDAY]: 0,
    [WEEK_DAY.MONDAY]: 1,
    [WEEK_DAY.TUESDAY]: 2,
    [WEEK_DAY.WEDNESDAY]: 3,
    [WEEK_DAY.THURSDAY]: 4,
    [WEEK_DAY.FRIDAY]: 5,
    [WEEK_DAY.SATURDAY]: 6,
  };
  return mapping[day];
};

export const monthToNumber = (month: MONTH): number => {
  const mapping: Record<MONTH, number> = {
    [MONTH.JANUARY]: 0,
    [MONTH.FEBRUARY]: 1,
    [MONTH.MARCH]: 2,
    [MONTH.APRIL]: 3,
    [MONTH.MAY]: 4,
    [MONTH.JUNE]: 5,
    [MONTH.JULY]: 6,
    [MONTH.AUGUST]: 7,
    [MONTH.SEPTEMBER]: 8,
    [MONTH.OCTOBER]: 9,
    [MONTH.NOVEMBER]: 10,
    [MONTH.DECEMBER]: 11,
  };
  return mapping[month];
};

// =====================
// Additional Time/Date Utilities
// =====================

export const formatDateToDayOfWeek = (date: Date | string, _locale: string = "pt-BR"): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Data inválida";

  return new Intl.DateTimeFormat(_locale, {
    weekday: "long",
  }).format(d);
};

export const parseTime = (timeString: string): Date | null => {
  if (!timeString || typeof timeString !== "string") {
    return null;
  }

  // Handle various time formats: "HH:MM", "HH:MM:SS", "HHMM", etc.
  const cleaned = timeString.replace(/\D/g, "");

  if (cleaned.length < 3) {
    return null;
  }

  let hours: number;
  let minutes: number;
  let seconds = 0;

  if (cleaned.length === 3) {
    // "HMM" format
    hours = parseInt(cleaned.substring(0, 1), 10);
    minutes = parseInt(cleaned.substring(1, 3), 10);
  } else if (cleaned.length === 4) {
    // "HHMM" format
    hours = parseInt(cleaned.substring(0, 2), 10);
    minutes = parseInt(cleaned.substring(2, 4), 10);
  } else if (cleaned.length === 5) {
    // "HMMSS" format
    hours = parseInt(cleaned.substring(0, 1), 10);
    minutes = parseInt(cleaned.substring(1, 3), 10);
    seconds = parseInt(cleaned.substring(3, 5), 10);
  } else if (cleaned.length === 6) {
    // "HHMMSS" format
    hours = parseInt(cleaned.substring(0, 2), 10);
    minutes = parseInt(cleaned.substring(2, 4), 10);
    seconds = parseInt(cleaned.substring(4, 6), 10);
  } else {
    return null;
  }

  // Validate time components
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  // Create a date object with today's date but the parsed time
  const result = new Date();
  result.setHours(hours, minutes, seconds, 0);

  return result;
};

// =====================
// Export all utilities
// =====================

// =====================
// Payroll Period Utilities
// =====================

/**
 * Get the current payroll period based on today's date.
 *
 * Ankaa uses a 26th-to-25th monthly cycle for payroll:
 * - If today is the 26th or later, the current period is for NEXT month
 * - If today is before the 26th, the current period is for CURRENT month
 *
 * Examples:
 * - September 25th → Period: September (Aug 26 - Sep 25)
 * - September 26th → Period: October (Sep 26 - Oct 25)
 * - September 30th → Period: October (Sep 26 - Oct 25)
 * - October 1st → Period: October (Sep 26 - Oct 25)
 *
 * @param referenceDate - Optional date to check (defaults to today)
 * @returns Object with year and month for the current payroll period
 */
export const getCurrentPayrollPeriod = (referenceDate?: Date): { year: number; month: number } => {
  const date = referenceDate || new Date();
  const day = date.getDate();
  let year = date.getFullYear();
  let month = date.getMonth() + 1; // getMonth() is 0-based, we want 1-based

  // If today is the 26th or later, the period is for the next month
  if (day >= 26) {
    month += 1;
    // Handle year rollover
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return { year, month };
};

export const dateUtils = {
  // Formatting
  formatDate,
  formatDateTime,
  formatTime,
  formatDateLong,
  formatRelativeTime,

  // Calculations
  addDays,
  addWeeks,
  addMonths,
  addYears,
  subtractDays,
  subtractWeeks,
  subtractMonths,
  subtractYears,

  // Comparisons
  isSameDay,
  isSameWeek,
  isSameMonth,
  isSameYear,
  isAfter,
  isBefore,
  isToday,
  isYesterday,
  isTomorrow,
  isThisWeek,
  isThisMonth,
  isThisYear,

  // Ranges
  isDateInRange,
  getDaysBetween,
  getWeeksBetween,
  getMonthsBetween,
  getYearsBetween,

  // Periods
  getStartOfDay,
  getEndOfDay,
  getStartOfWeek,
  getEndOfWeek,
  getStartOfMonth,
  getEndOfMonth,
  getStartOfYear,
  getEndOfYear,

  // Business days
  isWeekend,
  isWeekday,
  getNextWorkday,
  getPreviousWorkday,
  getWorkdaysBetween,

  // Age
  getAge,
  getDetailedAge,

  // Validation
  isValidDate,
  isDateInPast,
  isDateInFuture,
  isLeapYear,

  // Parsing
  parseDate,

  // Timezone
  formatDateInTimezone,
  getTimezoneOffset,

  getDaysAgo,
  getHoursAgo,
  getMinutesAgo,
  getHoursBetween,
  getWeekOfYear,
  getTimeAgo,
  getDurationBetweenDates,

  // Additional utilities
  formatDateToDayOfWeek,
  parseTime,

  // Payroll period utilities
  getCurrentPayrollPeriod,
};
