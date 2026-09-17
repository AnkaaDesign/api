/**
 * Due-date utilities.
 *
 * Invoice/installment/bank-slip due dates are CALENDAR DATES, not instants. The
 * system stores them at **noon UTC** precisely so the calendar day is the same in
 * every timezone (São Paulo is UTC-3 year-round; noon UTC is 09:00 SP).
 *
 * The rule these helpers exist to enforce: never move a due date through a local
 * timezone. `new Date('2026-09-08')` is UTC midnight, which renders as 2026-09-07
 * in São Paulo — a silent D-1 shift that once rewrote every synced boleto due date
 * (and its parcela) one day back.
 */

const SAO_PAULO = 'America/Sao_Paulo';

/** Format a stored due date as YYYY-MM-DD using UTC components. */
export function formatDueDateYMD(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Parse a YYYY-MM-DD calendar date into a Date at noon UTC. */
export function parseDueDateYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/**
 * Today's São Paulo calendar date materialised at noon UTC, so it can be both
 * compared against and persisted as a stored due date.
 */
export function todayInSaoPauloAtNoonUtc(): Date {
  return saoPauloCalendarDayAtNoonUtc(new Date());
}

/**
 * O DIA DE CALENDÁRIO EM SÃO PAULO de um INSTANTE, materializado ao meio-dia UTC.
 *
 * É o conversor que faltava entre as duas metades deste arquivo: `parseDueDateYMD`
 * já sabe virar uma data de calendário em instante armazenável, e
 * `todayInSaoPauloAtNoonUtc` já sabia fazer isto para AGORA — mas não havia como
 * fazê-lo para um instante qualquer (o carimbo de aprovação de um faturamento, o
 * `finishedAt` de uma tarefa).
 *
 * ⚠️ POR QUE PRECISOU EXISTIR. Quem ancorava vencimento lia os COMPONENTES UTC do
 * instante — `Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)`.
 * São Paulo é UTC−3: das 21:00 à meia-noite o dia UTC já é o SEGUINTE. Aprovar um
 * faturamento às 22:10 de 30/09 ancorava em 01/10, e todo boleto saía com um dia a
 * mais do que a proposta prometeu — um erro que aparece em três horas do dia e some
 * nas outras vinte e uma, que é a forma mais cara de um defeito existir.
 */
export function saoPauloCalendarDayAtNoonUtc(instant: Date): Date {
  return parseDueDateYMD(instant.toLocaleDateString('en-CA', { timeZone: SAO_PAULO }));
}

/** O mesmo dia de calendário SP, deslocado em N dias inteiros. */
export function saoPauloCalendarDayPlus(instant: Date, days: number): Date {
  const base = saoPauloCalendarDayAtNoonUtc(instant);
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

/**
 * Whole-day difference between two stored due dates (both at noon UTC).
 * Positive = `date` is in the future relative to `reference`.
 */
export function daysBetweenDueDates(date: Date, reference: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const a = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const b = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  return Math.round((a - b) / MS_PER_DAY);
}

/**
 * Is this due date in the past, by CALENDAR DAY in São Paulo?
 *
 * A parcela/boleto due TODAY is not overdue — the customer has all day to pay. Comparing
 * raw instants (`dueDate < new Date()`) flips a due-today record to OVERDUE the moment
 * the clock passes the stored time-of-day (09:00 SP for a noon-UTC date), which then
 * cascades the whole quote to DUE on the very day it came due.
 */
export function isDueDateOverdue(dueDate: Date, reference?: Date): boolean {
  return daysBetweenDueDates(dueDate, reference ?? todayInSaoPauloAtNoonUtc()) < 0;
}

/**
 * Extract the calendar date (YYYY-MM-DD) from a bank/API date string, with NO timezone
 * conversion. Accepts "dd/MM/yyyy" and "yyyy-MM-dd", each optionally followed by a time
 * and/or offset. Returns null when the shape is unrecognised.
 *
 * A boleto's `dataVencimento` is a calendar date, not an instant. Round-tripping it
 * through `new Date(...)` and rendering it in São Paulo shifts it one day BACK whenever
 * the source carries no offset — JS reads a bare "2026-09-08" as UTC midnight, which is
 * 2026-09-07 21:00 in SP. Reading the digits directly is immune to both the source
 * format and the server timezone.
 */
export function bankDateToYMD(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();

  const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }

  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const [, yyyy, mm, dd] = isoDate;
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

/**
 * Normalise any stored/parsed date to the noon-UTC convention, keeping its UTC calendar
 * day. Use when persisting a date that may have come from a source storing midnight.
 */
export function normalizeDueDateToNoonUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0),
  );
}
