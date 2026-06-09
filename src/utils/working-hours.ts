/**
 * Working hours calculator for Ankaa Design.
 *
 * Business hours: Mon–Sat 08:00–18:00 (America/Sao_Paulo), excluding 12:00–13:00 lunch.
 * Brazil/SP has been UTC-3 year-round since DST was abolished in 2019.
 *
 * Used to accumulate totalActiveTimeSeconds on service orders so that overnight
 * and weekend gaps from forgotten pauses do not inflate the worked time.
 */

const SP_OFFSET_MS = -3 * 3600 * 1000; // UTC-3 → -10 800 000 ms

// Working periods in minutes from SP midnight, Mon–Sat
const WORKING_PERIODS_MIN: [number, number][] = [
  [8 * 60, 12 * 60],  // 08:00–12:00
  [13 * 60, 18 * 60], // 13:00–18:00
];

/**
 * Returns the number of actual working seconds that fall between `start` and
 * `end`, capped to business hours.  A forgotten pause overnight yields only the
 * minutes actually within working hours, not 15+ phantom hours.
 */
export function calculateWorkingSeconds(start: Date, end: Date): number {
  if (!start || !end || end.getTime() <= start.getTime()) return 0;

  // Express start as SP local time in ms-since-epoch (treating local time as if it were UTC).
  // SP local = UTC + offset  (offset = -3h)
  const startSpMs = start.getTime() + SP_OFFSET_MS;
  // Floor to SP midnight of the start day
  const startSpMidnightMs = startSpMs - (startSpMs % (24 * 3600 * 1000));

  const endSpMs = end.getTime() + SP_OFFSET_MS;

  let totalMs = 0;

  for (
    let spMidnightMs = startSpMidnightMs;
    spMidnightMs <= endSpMs;          // iterate while the SP day starts ≤ end
    spMidnightMs += 24 * 3600 * 1000
  ) {
    // Convert SP midnight back to real UTC.
    // SP midnight (00:00 SP) = 03:00 UTC because UTC = SP − offset = SP + 3h
    const dayMidnightUtcMs = spMidnightMs - SP_OFFSET_MS;

    // Day-of-week at SP midnight: since dayMidnightUtcMs = 03:00 UTC of the
    // same calendar day as the SP midnight, UTC day-of-week equals SP day-of-week.
    const dow = new Date(dayMidnightUtcMs).getUTCDay(); // 0 = Sun, 6 = Sat

    if (dow === 0) continue; // skip Sundays

    for (const [pStartMin, pEndMin] of WORKING_PERIODS_MIN) {
      const windowStartMs = dayMidnightUtcMs + pStartMin * 60_000;
      const windowEndMs   = dayMidnightUtcMs + pEndMin   * 60_000;

      const overlapStart = Math.max(start.getTime(), windowStartMs);
      const overlapEnd   = Math.min(end.getTime(),   windowEndMs);

      if (overlapEnd > overlapStart) {
        totalMs += overlapEnd - overlapStart;
      }
    }
  }

  return Math.round(totalMs / 1000);
}
