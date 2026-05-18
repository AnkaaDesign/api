// Working-day arithmetic for stock-management math (spec §2.4).
// Builds on the static constants in constants/working-days-config.ts.

import {
  WORKDAYS_BASELINE,
  WORKDAYS_MIN,
  WORKDAYS_MAX,
  SATURDAY_SHIFT_DETECTION_THRESHOLD,
  isInVacationPeriod,
  getVacationDaysInMonth,
} from '@/constants/working-days-config';
import { differenceInCalendarDays } from 'date-fns';

/** Re-export the vacation predicate so callers don't need two import sources. */
export { isInVacationPeriod, getVacationDaysInMonth };

interface ActivityLike {
  operation: string;
  reason: string;
  createdAt: Date | string;
}

/** Counts Mon–Fri workdays between `start` and `end` inclusive, subtracting
 *  any day that falls within the collective vacation window.
 *  `holidaysFn` allows callers to inject a sector holiday list. */
export function countWorkdaysInRange(
  start: Date,
  end: Date,
  holidaysFn?: (date: Date) => boolean,
): number {
  if (start > end) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (cursor <= last) {
    const dow = cursor.getDay();
    const isWeekday = dow >= 1 && dow <= 5;
    const isHoliday = holidaysFn?.(cursor) ?? false;
    if (isWeekday && !isInVacationPeriod(cursor) && !isHoliday) {
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/** Detects months in which Saturday work was the norm (≥ N Saturdays carry
 *  qualifying OUTBOUND activity). Returns a Map keyed by `YYYY-MM`. */
export function detectSaturdayShifts(
  activities: ActivityLike[],
  qualifyingReasons: ReadonlyArray<string>,
): Map<string, number> {
  const saturdayByMonth = new Map<string, Set<string>>(); // YYYY-MM → set of distinct Saturday dates

  for (const a of activities) {
    if (a.operation !== 'OUTBOUND') continue;
    if (!qualifyingReasons.includes(a.reason)) continue;
    const d = new Date(a.createdAt);
    if (d.getDay() !== 6) continue; // 6 = Saturday
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dayKey = d.toISOString().slice(0, 10);
    if (!saturdayByMonth.has(key)) saturdayByMonth.set(key, new Set());
    saturdayByMonth.get(key)!.add(dayKey);
  }

  const result = new Map<string, number>();
  for (const [key, set] of saturdayByMonth) {
    if (set.size >= SATURDAY_SHIFT_DETECTION_THRESHOLD) {
      result.set(key, set.size);
    }
  }
  return result;
}

/** Effective working-day count for a given calendar month, applying the
 *  spec's vacation reduction and Saturday-shift bonus, clamped to
 *  [WORKDAYS_MIN, WORKDAYS_MAX]. */
export function workingDaysForMonth(
  year: number,
  month: number, // 0-indexed
  saturdayShiftMonths: Map<string, number>,
  holidaysFn?: (date: Date) => boolean,
): number {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  let base = countWorkdaysInRange(start, end, holidaysFn);

  // Soft floor on months whose business calendar collapses (e.g. ankaa data gaps):
  // never go below WORKDAYS_BASELINE minus the actual vacation days for the month.
  const vacationDays = getVacationDaysInMonth(month, year);
  const fallback = Math.max(0, WORKDAYS_BASELINE - vacationDays);
  if (base < fallback) base = fallback;

  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const saturdayBonus = saturdayShiftMonths.get(key) ?? 0;
  const adjusted = base + saturdayBonus;
  return Math.min(WORKDAYS_MAX, Math.max(WORKDAYS_MIN, adjusted));
}

/** Reprojects a per-month consumption observation that happened during a
 *  partial-workday month back onto the WORKDAYS_BASELINE month so cross-month
 *  comparisons are apples-to-apples. */
export function normalizeToWorkdays(consumption: number, actualWorkdays: number): number {
  if (actualWorkdays <= 0) return consumption;
  if (actualWorkdays >= WORKDAYS_BASELINE) return consumption;
  return consumption * (WORKDAYS_BASELINE / actualWorkdays);
}

/** Convenience: returns months-ago between two dates, fractional. */
export function monthsBetween(a: Date, b: Date): number {
  return differenceInCalendarDays(b, a) / 30;
}
