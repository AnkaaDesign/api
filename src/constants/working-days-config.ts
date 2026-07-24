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

/** Standard collective vacation window (spec §2.4). Months are 0-indexed (0 = January). */
export const VACATION_PERIOD = {
  startMonth: 11, // December
  startDay: 20,
  endMonth: 0, // January
  endDay: 10,
} as const;

/** Year-specific vacation overrides — used when the collective shutdown was
 *  extended beyond the standard Dec 20 – Jan 10 window. ISO date inclusive on
 *  both ends. Detected gaps from production data should be listed here. */
export const VACATION_PERIOD_OVERRIDES: ReadonlyArray<{
  readonly start: string;
  readonly end: string;
  readonly label: string;
}> = [
  {
    start: '2025-12-13',
    end: '2026-01-15',
    label: 'Férias coletivas estendidas 2025-2026 (migração)',
  },
];

/** Returns true if `date` falls inside the standard vacation window OR any
 *  year-specific extended override. */
export function isInVacationPeriod(date: Date): boolean {
  // Year-specific overrides take precedence (always checked).
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  for (const ov of VACATION_PERIOD_OVERRIDES) {
    if (iso >= ov.start && iso <= ov.end) return true;
  }

  const month = date.getMonth();
  const day = date.getDate();
  const { startMonth, startDay, endMonth, endDay } = VACATION_PERIOD;

  if (month === startMonth && day >= startDay) return true;
  if (month === endMonth && day <= endDay) return true;
  return false;
}

/** Number of vacation calendar-days inside the given month (0-indexed).
 *  Accounts for year-specific overrides by walking each day of the month. */
export function getVacationDaysInMonth(month: number, year: number): number {
  // If any override could overlap this month, count by walking days (cheap
  // for 28-31 iterations and exact).
  const hasOverlappingOverride = VACATION_PERIOD_OVERRIDES.some(ov => {
    const yyyymm = `${year}-${String(month + 1).padStart(2, '0')}`;
    return ov.start.startsWith(yyyymm) || ov.end.startsWith(yyyymm) ||
           (ov.start <= `${yyyymm}-01` && ov.end >= `${yyyymm}-31`);
  });

  if (hasOverlappingOverride) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (isInVacationPeriod(new Date(year, month, d))) count++;
    }
    return count;
  }

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

/** Calendar days of shutdown at/above which a month's `(total/workingDays)×20`
 *  normalization materially inflates it (the short working-day denominator).
 *  Such months are unrepresentative of steady demand and are excluded from the
 *  σ / coefficient-of-variation history that drives safety stock + XYZ. */
export const VACATION_MONTH_EXCLUDE_MIN_DAYS = 5;

/** True when `month` (0-indexed) of `year` loses enough weekdays to the annual
 *  shutdown that its normalized consumption should NOT feed σ/CV. */
export function isVacationDistortedMonth(year: number, month: number): boolean {
  return getVacationDaysInMonth(month, year) >= VACATION_MONTH_EXCLUDE_MIN_DAYS;
}

