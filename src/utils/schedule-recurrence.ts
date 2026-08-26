import { SCHEDULE_FREQUENCY, WEEK_DAY, MONTH, MONTH_OCCURRENCE } from '@constants';
import { addDays, addMonths, addWeeks, addYears } from './date';
import { startOfDay, getDay, setDate, setMonth, getDaysInMonth } from 'date-fns';

/**
 * Motor de recorrência COMPARTILHADO — "toda segunda", "primeira segunda do mês",
 * "todo dia 5", "última sexta de dezembro".
 *
 * Este arquivo é a extração VERBATIM do bloco que vivia em `utils/order.ts` e que
 * já era o mais completo dos três quase-iguais espalhados pela base (a cópia
 * privada de `maintenance-schedule.service.ts` e a de
 * `ppe-delivery-schedule.service.ts` continuam onde estão). `utils/order.ts`
 * passou a reexportar daqui, então o comportamento dos agendamentos de PEDIDO é
 * idêntico ao de antes — nada foi reescrito, só mudou de casa.
 *
 * A única mudança de tipo: a assinatura pública deixou de exigir um
 * `OrderSchedule` e passou a aceitar QUALQUER coisa com a forma de agendamento
 * (`RecurringSchedule`), para que `MessageSchedule` — e quem vier depois — possa
 * usar o mesmo motor sem herdar o modelo de pedido.
 *
 * ⚠️ DEPENDÊNCIA DE FUSO: a matemática usa `date-fns` no relógio LOCAL DO
 * PROCESSO (`startOfDay`, `getDay`, `setDate`). Isso só produz a data certa
 * porque a API roda com `TZ="America/Sao_Paulo"` (ver `.env.example`). Num
 * processo em UTC, "primeira segunda" pode cair no dia errado perto da
 * meia-noite. Quem materializa a ocorrência é que converte a data-calendário em
 * instante — ver `message-scheduling.util.ts`.
 */

/** Dias da semana ligados num agendamento SEMANAL. */
export interface RecurringWeeklyConfig {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

/**
 * Agendamento MENSAL, em uma de duas gramáticas mutuamente exclusivas:
 *   - `dayOfMonth` → "todo dia 5" (aparado para o último dia do mês curto);
 *   - `occurrence` + `dayOfWeek` → "primeira segunda", "última sexta".
 * `dayOfMonth` tem precedência quando os dois vêm preenchidos.
 */
export interface RecurringMonthlyConfig {
  dayOfMonth?: number | null;
  occurrence?: string | null;
  dayOfWeek?: string | null;
}

/** Agendamento ANUAL: um mês fixo + a mesma escolha de dia do mensal. */
export interface RecurringYearlyConfig {
  month: string;
  dayOfMonth?: number | null;
  occurrence?: string | null;
  dayOfWeek?: string | null;
}

/**
 * A forma mínima que o motor precisa enxergar. Deliberadamente estrutural: uma
 * linha do Prisma (`OrderSchedule`, `MessageSchedule`, …) satisfaz isto sem
 * cast, e nenhum modelo concreto entra como dependência deste arquivo.
 */
export interface RecurringSchedule {
  isActive: boolean;
  frequency: string;
  frequencyCount?: number | null;
  /** Só consultado por ONCE: agendamento de uma vez só não tem "próxima". */
  lastRun?: Date | null;
  /** Dia do mês da frequência CUSTOM (as demais leem do `monthlyConfig`). */
  dayOfMonth?: number | null;
  /** Meses ligados na frequência CUSTOM. */
  customMonths?: string[] | null;
  weeklyConfig?: RecurringWeeklyConfig | null;
  monthlyConfig?: RecurringMonthlyConfig | null;
  yearlyConfig?: RecurringYearlyConfig | null;
  /**
   * O que fazer com "todo dia 31" num mês que não tem dia 31.
   *
   *   - `false` (padrão): o mês curto é PULADO por inteiro — dia 31 dispara em
   *     jan, mar, mai… e nunca em fevereiro. É o comportamento histórico, e os
   *     agendamentos de PEDIDO/EPI/MANUTENÇÃO dependem dele; mudá-lo por baixo
   *     deles não é decisão deste código.
   *   - `true`: o dia é APARADO para o último do mês (31/jan → 28/fev). É o que
   *     um comunicado quer — pular fevereiro deixaria o quadro sem aviso um mês
   *     inteiro, em silêncio.
   *
   * O `calculateNextCustomRun` logo abaixo já aparava, e o comentário dele
   * ("avoids the setDate-overflow loop bug in calculateNextMonthlyRun") sempre
   * apontou para este mesmo defeito.
   */
  clampDayOfMonth?: boolean;
}

// Apelidos locais para que o bloco extraído abaixo permaneça literalmente igual
// ao que estava em `utils/order.ts` — as assinaturas internas continuam citando
// os nomes originais.
type WeeklyScheduleConfig = RecurringWeeklyConfig;
type MonthlyScheduleConfig = RecurringMonthlyConfig;
type YearlyScheduleConfig = RecurringYearlyConfig;

/**
 * Calculate next run date for a schedule
 */
export function calculateNextRunDate(
  schedule: RecurringSchedule,
  fromDate: Date = new Date(),
): Date | null {
  if (!schedule.isActive) return null;

  const baseDate = startOfDay(fromDate);

  // Step multipliers for the "long-cycle" frequencies. BIWEEKLY is week-based;
  // the rest reduce to MONTHLY with a fixed month step. Labels (per web/src/
  // constants/enum-labels.ts): BIWEEKLY=Quinzenal (2 weeks), BIMONTHLY=
  // Bimestral (2 months), QUARTERLY=Trimestral (3 months), TRIANNUAL/
  // QUADRIMESTRAL=Quadrimestral (4 months — both enum values mean the same
  // thing; both labels resolve to "Quadrimestral"), SEMI_ANNUAL=Semestral
  // (6 months). frequencyCount further scales this (e.g. BIMONTHLY × 2 = every
  // 4 months) but is typically left at 1 for these derived frequencies.
  // Clamp to >= 1: a 0 or negative count would make the "next" run equal to
  // (or before) the base date, causing the schedule to fire every tick forever.
  const count = Math.max(1, Math.floor(schedule.frequencyCount ?? 1));
  const clamp = schedule.clampDayOfMonth === true;

  switch (schedule.frequency as SCHEDULE_FREQUENCY) {
    case SCHEDULE_FREQUENCY.ONCE:
      // One-time schedules don't have a next run after execution
      return schedule.lastRun ? null : baseDate;

    case SCHEDULE_FREQUENCY.DAILY:
      return calculateNextDailyRun(baseDate, count);

    case SCHEDULE_FREQUENCY.WEEKLY:
      return calculateNextWeeklyRun(baseDate, schedule.weeklyConfig, count);

    case SCHEDULE_FREQUENCY.BIWEEKLY:
      return calculateNextWeeklyRun(baseDate, schedule.weeklyConfig, 2 * count);

    case SCHEDULE_FREQUENCY.MONTHLY:
      return calculateNextMonthlyRun(baseDate, schedule.monthlyConfig, count, clamp);

    case SCHEDULE_FREQUENCY.BIMONTHLY:
      return calculateNextMonthlyRun(baseDate, schedule.monthlyConfig, 2 * count, clamp);

    case SCHEDULE_FREQUENCY.QUARTERLY:
      return calculateNextMonthlyRun(baseDate, schedule.monthlyConfig, 3 * count, clamp);

    case SCHEDULE_FREQUENCY.TRIANNUAL:
    case SCHEDULE_FREQUENCY.QUADRIMESTRAL:
      return calculateNextMonthlyRun(baseDate, schedule.monthlyConfig, 4 * count, clamp);

    case SCHEDULE_FREQUENCY.SEMI_ANNUAL:
      return calculateNextMonthlyRun(baseDate, schedule.monthlyConfig, 6 * count, clamp);

    case SCHEDULE_FREQUENCY.ANNUAL:
      return calculateNextYearlyRun(baseDate, schedule.yearlyConfig, count);

    case SCHEDULE_FREQUENCY.CUSTOM:
      return calculateNextCustomRun(baseDate, schedule.customMonths, schedule.dayOfMonth);

    default:
      return null;
  }
}

/**
 * Custom-frequency next run: fires on `dayOfMonth` of the next month in
 * `customMonths` (a list of Month enum values). When `dayOfMonth` is missing
 * we default to the 1st. Day is clamped to the target month's last day so
 * day-31-in-February becomes the 28th/29th. Returns null if no months are
 * configured.
 */
function calculateNextCustomRun(
  fromDate: Date,
  customMonths: string[] | null | undefined,
  dayOfMonth: number | null | undefined,
): Date | null {
  if (!customMonths || customMonths.length === 0) return null;

  const targetDay = dayOfMonth ?? 1;
  const monthNumbers = customMonths
    .map(m => getMonthNumber(m))
    .filter((n): n is number => Number.isInteger(n))
    .sort((a, b) => a - b);
  if (monthNumbers.length === 0) return null;

  const currentMonth = fromDate.getMonth();
  const currentDay = fromDate.getDate();
  const currentYear = fromDate.getFullYear();

  // Clamp day-of-month to the month's actual last day (avoids the
  // setDate-overflow loop bug in calculateNextMonthlyRun).
  const candidate = (year: number, month: number): Date => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return startOfDay(new Date(year, month, Math.min(targetDay, lastDay)));
  };

  // Next configured month that hasn't fired yet in the current year.
  for (const m of monthNumbers) {
    if (m > currentMonth || (m === currentMonth && currentDay < targetDay)) {
      return candidate(currentYear, m);
    }
  }

  // Wrap to first configured month next year.
  return candidate(currentYear + 1, monthNumbers[0]);
}

/**
 * Calculate next daily run
 */
function calculateNextDailyRun(fromDate: Date, frequencyCount: number = 1): Date | null {
  return addDays(fromDate, frequencyCount);
}

/**
 * Calculate next weekly run
 */
function calculateNextWeeklyRun(
  fromDate: Date,
  weeklyConfig?: WeeklyScheduleConfig | null,
  frequencyCount: number = 1,
): Date | null {
  if (!weeklyConfig) return null;

  const weekDays = [
    { day: 0, enabled: weeklyConfig.sunday },
    { day: 1, enabled: weeklyConfig.monday },
    { day: 2, enabled: weeklyConfig.tuesday },
    { day: 3, enabled: weeklyConfig.wednesday },
    { day: 4, enabled: weeklyConfig.thursday },
    { day: 5, enabled: weeklyConfig.friday },
    { day: 6, enabled: weeklyConfig.saturday },
  ];

  const enabledDays = weekDays.filter(d => d.enabled).map(d => d.day);
  if (enabledDays.length === 0) return null;

  let nextDate = new Date(fromDate);
  const currentDayOfWeek = getDay(nextDate);

  // Find next enabled day in current week
  for (const dayOfWeek of enabledDays) {
    if (dayOfWeek > currentDayOfWeek) {
      return addDays(nextDate, dayOfWeek - currentDayOfWeek);
    }
  }

  // If no enabled days left in current week, go to next week cycle
  nextDate = addWeeks(nextDate, frequencyCount);
  const firstEnabledDay = Math.min(...enabledDays);
  return addDays(nextDate, firstEnabledDay - getDay(nextDate));
}

/**
 * Calculate next monthly run
 */
function calculateNextMonthlyRun(
  fromDate: Date,
  monthlyConfig?: MonthlyScheduleConfig | null,
  frequencyCount: number = 1,
  clampDayOfMonth: boolean = false,
): Date | null {
  if (!monthlyConfig) return null;

  let nextDate = new Date(fromDate);

  if (monthlyConfig.dayOfMonth !== null && monthlyConfig.dayOfMonth !== undefined) {
    // Fixed day of month
    const targetDay = monthlyConfig.dayOfMonth;

    // Modo APARA: o dia é limitado ao tamanho real do mês, de forma que 31 vire
    // 28/29 em fevereiro em vez de sumir. É o mesmo remendo que
    // `calculateNextCustomRun` já aplicava logo acima.
    //
    // ⚠️ A aritmética aqui é feita sobre o ÍNDICE do mês, e não com `addMonths`,
    // porque o `addMonths` de `utils/date.ts` é um `setMonth` cru e TRANSBORDA:
    // 31/jan + 1 mês devolve 3 de MARÇO, não 28 de fevereiro. Usá-lo aqui era
    // justamente o que fazia o modo APARA reproduzir o defeito que ele existe
    // para corrigir.
    if (clampDayOfMonth) {
      const build = (year: number, monthIndex: number): Date => {
        // Dia 0 do mês seguinte = último dia deste mês; serve de teto.
        const lastDay = new Date(year, monthIndex + 1, 0).getDate();
        return startOfDay(new Date(year, monthIndex, Math.min(targetDay, lastDay)));
      };

      let year = fromDate.getFullYear();
      let monthIndex = fromDate.getMonth();
      let candidate = build(year, monthIndex);
      let guard = 0;

      // Avança ciclos inteiros até passar ESTRITAMENTE de `fromDate`,
      // reaparando a cada mês (o tamanho do mês muda).
      while (candidate <= fromDate && guard < 120) {
        monthIndex += frequencyCount;
        year += Math.floor(monthIndex / 12);
        monthIndex = ((monthIndex % 12) + 12) % 12;
        candidate = build(year, monthIndex);
        guard++;
      }
      return candidate;
    }

    if (fromDate.getDate() < targetDay) {
      // Target day hasn't passed this month
      nextDate = setDate(nextDate, targetDay);
    } else {
      // Move to next month cycle
      nextDate = addMonths(nextDate, frequencyCount);
      nextDate = setDate(nextDate, targetDay);
    }

    // Handle months with fewer days
    while (nextDate.getDate() !== targetDay) {
      nextDate = setDate(nextDate, 0); // Last day of previous month
    }

    return nextDate;
  } else if (monthlyConfig.occurrence && monthlyConfig.dayOfWeek) {
    // Occurrence pattern (e.g., "first Monday").
    // Check if the current month's occurrence is still in the future.
    // If so, return it — don't skip to the next cycle. This handles the case
    // where a schedule is created (or recomputed) before the target day within
    // the same month, e.g. created June 1 for "first Tuesday of month" → June 2.
    const thisMonthOccurrence = calculateOccurrenceDate(
      nextDate,
      monthlyConfig.occurrence,
      monthlyConfig.dayOfWeek,
      0,
    );
    if (thisMonthOccurrence > nextDate) {
      return thisMonthOccurrence;
    }
    // This month's occurrence has already passed (or is today); advance by the
    // configured number of months.
    return calculateOccurrenceDate(
      nextDate,
      monthlyConfig.occurrence,
      monthlyConfig.dayOfWeek,
      frequencyCount,
    );
  }

  return null;
}

/**
 * Calculate next yearly run
 */
function calculateNextYearlyRun(
  fromDate: Date,
  yearlyConfig?: YearlyScheduleConfig | null,
  frequencyCount: number = 1,
): Date | null {
  if (!yearlyConfig || !yearlyConfig.month) return null;

  let nextDate = new Date(fromDate);
  const targetMonth = getMonthNumber(yearlyConfig.month);

  if (yearlyConfig.dayOfMonth !== null && yearlyConfig.dayOfMonth !== undefined) {
    // Fixed day of month — build per-year and clamp to the month length so a
    // dayOfMonth=29 in February doesn't overflow into March on non-leap years.
    const dayOfMonth = yearlyConfig.dayOfMonth;
    const buildForYear = (year: number): Date => {
      const lastDay = getDaysInMonth(new Date(year, targetMonth, 1));
      return startOfDay(new Date(year, targetMonth, Math.min(dayOfMonth, lastDay)));
    };

    let candidate = buildForYear(fromDate.getFullYear());
    let guard = 0;
    // Advance whole cycles until strictly after fromDate (re-clamping each year).
    while (candidate <= fromDate && guard < 50) {
      candidate = buildForYear(candidate.getFullYear() + frequencyCount);
      guard++;
    }
    return candidate;
  }

  // Set to target month for the occurrence-pattern branch
  nextDate = setMonth(nextDate, targetMonth);

  if (yearlyConfig.occurrence && yearlyConfig.dayOfWeek) {
    // Occurrence pattern
    nextDate = calculateOccurrenceDate(
      nextDate,
      yearlyConfig.occurrence,
      yearlyConfig.dayOfWeek,
      0,
    );

    // If date has passed this year, move to next year cycle
    if (nextDate <= fromDate) {
      nextDate = addYears(nextDate, frequencyCount);
      nextDate = setMonth(nextDate, targetMonth);
      nextDate = calculateOccurrenceDate(
        nextDate,
        yearlyConfig.occurrence,
        yearlyConfig.dayOfWeek,
        0,
      );
    }
  }

  return nextDate;
}

/**
 * Calculate date for occurrence pattern (e.g., "first Monday of month")
 */
function calculateOccurrenceDate(
  baseDate: Date,
  occurrence: string,
  dayOfWeek: string,
  monthsToAdd: number = 0,
): Date {
  let targetDate = new Date(baseDate);

  if (monthsToAdd > 0) {
    targetDate = addMonths(targetDate, monthsToAdd);
  }

  // Start from first day of month
  targetDate = setDate(targetDate, 1);

  const targetDayNumber = getDayOfWeekNumber(dayOfWeek);
  const occurrenceNumber = getOccurrenceNumber(occurrence);

  // Find first occurrence of target day
  while (getDay(targetDate) !== targetDayNumber) {
    targetDate = addDays(targetDate, 1);
  }

  // Move to the nth occurrence
  if (occurrenceNumber === -1) {
    // Last occurrence - find all occurrences in month
    const occurrences: Date[] = [new Date(targetDate)];
    let nextOccurrence = addWeeks(targetDate, 1);

    while (nextOccurrence.getMonth() === targetDate.getMonth()) {
      occurrences.push(new Date(nextOccurrence));
      nextOccurrence = addWeeks(nextOccurrence, 1);
    }

    return occurrences[occurrences.length - 1];
  } else {
    // Specific occurrence (1st, 2nd, 3rd, 4th)
    return addWeeks(targetDate, occurrenceNumber - 1);
  }
}

/**
 * Get day of week number from enum
 */
function getDayOfWeekNumber(dayOfWeek: string): number {
  const dayMap: Record<string, number> = {
    [WEEK_DAY.SUNDAY]: 0,
    [WEEK_DAY.MONDAY]: 1,
    [WEEK_DAY.TUESDAY]: 2,
    [WEEK_DAY.WEDNESDAY]: 3,
    [WEEK_DAY.THURSDAY]: 4,
    [WEEK_DAY.FRIDAY]: 5,
    [WEEK_DAY.SATURDAY]: 6,
  };
  return dayMap[dayOfWeek] ?? 1;
}

/**
 * Get occurrence number from enum
 */
function getOccurrenceNumber(occurrence: string): number {
  const occurrenceMap: Record<string, number> = {
    [MONTH_OCCURRENCE.FIRST]: 1,
    [MONTH_OCCURRENCE.SECOND]: 2,
    [MONTH_OCCURRENCE.THIRD]: 3,
    [MONTH_OCCURRENCE.FOURTH]: 4,
    [MONTH_OCCURRENCE.LAST]: -1,
  };
  return occurrenceMap[occurrence] ?? 1;
}

/**
 * Get month number from enum
 */
function getMonthNumber(month: string): number {
  const monthMap: Record<string, number> = {
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
  return monthMap[month] ?? 0;
}
