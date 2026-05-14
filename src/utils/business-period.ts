// Business month period: runs from the 26th of the previous month at 00:00:00
// to the 25th of the current month at 23:59:59.999. All bonus / production
// analytics align to this calendar.

export function businessPeriodStart(year: number, month: number): Date {
  // month is 1-indexed; period starts on 26th of previous month
  if (month === 1) return new Date(year - 1, 11, 26, 0, 0, 0, 0);
  return new Date(year, month - 2, 26, 0, 0, 0, 0);
}

export function businessPeriodEnd(year: number, month: number): Date {
  // month is 1-indexed; period ends on 25th of current month
  return new Date(year, month - 1, 25, 23, 59, 59, 999);
}

export function businessMonthKey(date: Date): string {
  let year = date.getFullYear();
  let month = date.getMonth(); // 0-indexed
  if (date.getDate() > 25) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// "Effective colaborador" in a period [start, end] is a USER-timeline rule —
// independent of whether they completed any specific task:
//   - exp2EndAt IS NOT NULL AND exp2EndAt <= end  (became EFFECTED on or
//     before the period closed)
//   - dismissedAt IS NULL OR dismissedAt > start  (still active when the
//     period began — someone dismissed mid-period still counts)
export function wasEffectedDuring(
  u: { exp2EndAt: Date | null; dismissedAt: Date | null },
  bounds: { start: Date; end: Date },
): boolean {
  if (!u.exp2EndAt) return false;
  if (u.exp2EndAt > bounds.end) return false;
  if (u.dismissedAt && u.dismissedAt <= bounds.start) return false;
  return true;
}
