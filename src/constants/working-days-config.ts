// Working-day calendar primitives for stock-management math.
// Pure constants + helpers; algorithmic routines that consume these
// (countWorkdaysInRange, detectSaturdayShifts, normalizeToWorkdays) live
// in src/utils/working-days.ts (Phase 3 deliverable).

/** Baseline working days per calendar month used as the normalization
 *  denominator. Clean-signal workshop month is Mon–Fri × 4 weeks ≈ 20. */
export const WORKDAYS_BASELINE = 20;

/** Clamp range for per-month working-day count after vacation/Saturday-shift
 *  adjustments (spec §2.4). */
export const WORKDAYS_MIN = 10;
export const WORKDAYS_MAX = 27;

/** Saturday-shift detection: a month is treated as having Saturday work if at
 *  least this many distinct Saturdays carry qualifying OUTBOUND activity. */
export const SATURDAY_SHIFT_DETECTION_THRESHOLD = 3;

/** Collective vacation window (spec §2.4). Months are 0-indexed (0 = January). */
export const VACATION_PERIOD = {
  startMonth: 11, // December
  startDay: 20,
  endMonth: 0, // January
  endDay: 10,
} as const;

/** Returns true if `date` falls inside the Dec 20 – Jan 10 vacation window. */
export function isInVacationPeriod(date: Date): boolean {
  const month = date.getMonth();
  const day = date.getDate();
  const { startMonth, startDay, endMonth, endDay } = VACATION_PERIOD;

  if (month === startMonth && day >= startDay) return true;
  if (month === endMonth && day <= endDay) return true;
  return false;
}

/** Number of vacation calendar-days inside the given month (0-indexed). */
export function getVacationDaysInMonth(month: number, year: number): number {
  const { startMonth, startDay, endMonth, endDay } = VACATION_PERIOD;

  if (month === startMonth) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return daysInMonth - startDay + 1;
  }
  if (month === endMonth) {
    return endDay;
  }
  return 0;
}

/** Effective working-day count for the given calendar month, before
 *  Saturday-shift adjustments. Subtracts vacation days from the 20-day
 *  baseline proportionally and clamps to [WORKDAYS_MIN, WORKDAYS_MAX]. */
export function getWorkingDaysInMonth(month: number, year: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const vacationDays = getVacationDaysInMonth(month, year);
  const proportion = (daysInMonth - vacationDays) / daysInMonth;
  const adjusted = Math.round(WORKDAYS_BASELINE * proportion);
  return Math.min(WORKDAYS_MAX, Math.max(WORKDAYS_MIN, adjusted));
}
