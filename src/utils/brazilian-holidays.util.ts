/**
 * Brazilian National Holidays + business-day utilities.
 *
 * Used by the invoice-generation pipeline to roll bank-slip due dates forward
 * off Saturdays, Sundays, and federal holidays — banks won't process payments
 * on those days, so a boleto due on a non-business day cannot be paid.
 *
 * National holidays (fixed):
 *   - Jan  1 — Confraternização Universal
 *   - Apr 21 — Tiradentes
 *   - May  1 — Dia do Trabalhador
 *   - Sep  7 — Independência
 *   - Oct 12 — N. Sra. Aparecida
 *   - Nov  2 — Finados
 *   - Nov 15 — Proclamação da República
 *   - Dec 25 — Natal
 *
 * Easter-based (computed via Meeus/Gauss):
 *   - Carnival Monday  (Easter − 48 days)
 *   - Carnival Tuesday (Easter − 47 days)
 *   - Ash Wednesday    (Easter − 46 days) — bank half-day, treated as non-business for safety
 *   - Sexta-feira Santa / Good Friday (Easter − 2 days)
 *   - Corpus Christi   (Easter + 60 days)
 *
 * All comparisons are performed in UTC year/month/day so the result is
 * independent of server timezone — invoice due dates are stored at noon UTC.
 */

/**
 * Compute the Gregorian date of Easter Sunday for a given year using the
 * "Meeus/Jones/Butcher" anonymous Gregorian algorithm.
 * Returns a Date at midnight UTC on Easter Sunday.
 */
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

/** Return a new UTC-midnight Date `days` after (or before, if negative) the input. */
function addUtcDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Compare two Dates by their UTC year/month/day (ignoring time-of-day). */
function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Return the list of Brazilian national holidays for the given year.
 * Each entry is at midnight UTC on the holiday date.
 */
export function getBrazilianHolidays(year: number): Date[] {
  const easter = computeEaster(year);

  const fixed: Array<[number, number]> = [
    [0, 1], //  Jan  1 — Confraternização Universal
    [3, 21], // Apr 21 — Tiradentes
    [4, 1], //  May  1 — Dia do Trabalhador
    [8, 7], //  Sep  7 — Independência
    [9, 12], // Oct 12 — N. Sra. Aparecida
    [10, 2], // Nov  2 — Finados
    [10, 15], // Nov 15 — Proclamação da República
    [11, 25], // Dec 25 — Natal
  ];

  const fixedDates = fixed.map(([m, d]) => new Date(Date.UTC(year, m, d, 0, 0, 0)));

  return [
    ...fixedDates,
    addUtcDays(easter, -48), // Carnival Monday
    addUtcDays(easter, -47), // Carnival Tuesday
    addUtcDays(easter, -46), // Ash Wednesday (bank half-day → treat as holiday)
    addUtcDays(easter, -2), //  Good Friday
    addUtcDays(easter, 60), //  Corpus Christi
  ];
}

/**
 * True iff the given date (interpreted in UTC) is a Brazilian banking business day:
 * not Saturday, not Sunday, and not on the national-holiday list for that year.
 */
export function isBrazilianBusinessDay(date: Date): boolean {
  const dow = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (dow === 0 || dow === 6) return false;

  const holidays = getBrazilianHolidays(date.getUTCFullYear());
  return !holidays.some(h => sameUtcDay(h, date));
}

/**
 * If `date` is already a business day, return it unchanged. Otherwise advance
 * one day at a time (UTC) until a business day is reached.
 *
 * Crosses year boundaries safely: when rolling past Dec 31, holidays for the
 * new year are looked up via `isBrazilianBusinessDay`.
 *
 * Returns a new Date — does not mutate the input.
 */
export function nextBrazilianBusinessDay(date: Date): Date {
  let candidate = new Date(date);
  // Hard cap of 30 iterations — prevents infinite loop if data is corrupt.
  // Realistic max roll-forward is ~5 days (e.g. Carnival Tuesday + Ash Wed → Thu).
  for (let i = 0; i < 30; i++) {
    if (isBrazilianBusinessDay(candidate)) return candidate;
    candidate = addUtcDays(candidate, 1);
  }
  return candidate;
}
