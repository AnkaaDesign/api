import { AIRBRUSHING_STATUS_LABELS } from '@constants';
import { AIRBRUSHING_DUE_DATE_RULE, AIRBRUSHING_STATUS } from '@constants';
import type { AirbrushingStatus } from '@prisma/client';

/**
 * Map AIRBRUSHING_STATUS enum to Prisma AirbrushingStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapAirbrushingStatusToPrisma(
  status: AIRBRUSHING_STATUS | string,
): AirbrushingStatus {
  return status as AirbrushingStatus;
}

export function getAirbrushingStatusLabel(status: AIRBRUSHING_STATUS): string {
  return AIRBRUSHING_STATUS_LABELS[status] || status;
}

/**
 * Prazo histórico concedido ao pintor depois que a aerografia é concluída. É o
 * fallback de `paymentTermDays` — uma aerografia que nunca configurou prazo
 * continua vencendo exatamente onde vencia antes desta feature existir.
 */
export const AIRBRUSHING_DEFAULT_PAYMENT_TERM_DAYS = 7;

export interface AirbrushingDueDateConfig {
  dueDateRule?: AIRBRUSHING_DUE_DATE_RULE | string | null;
  paymentTermDays?: number | null;
  dueDayOfMonth?: number | null;
  dueDate?: Date | string | null;
}

/**
 * Data-calendário em São Paulo de um instante. O Brasil não tem horário de verão
 * desde 2019, então SP é -03:00 fixo, mas derivar a data via `en-CA` mantém a
 * conversão correta mesmo que isso mude.
 */
function spCalendarDate(value: Date | string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  const [y, m, d] = date
    .toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    .split('-')
    .map(Number);
  return [y, m, d];
}

/** 18:00 em São Paulo = 21:00 UTC — mesma convenção de OrderService.payableDueFromCreatedAt. */
function spDueInstant(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day, 21, 0, 0));
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Vencimento de uma aerografia em Contas a Pagar.
 *
 * `finish` é o término de referência — o REAL (`finishedAt`) quando a aerografia
 * já foi concluída, caindo no PLANEJADO (`finishDate`) para que um serviço ainda
 * em andamento já apareça com uma previsão de vencimento. Devolve null quando não
 * há nenhuma das duas datas, ou quando a regra depende de um campo não preenchido.
 *
 * O resultado é materializado em `Airbrushing.dueDate` a cada escrita; esta função
 * é a única fonte da verdade, usada tanto na materialização quanto no fallback em
 * memória para linhas antigas.
 */
export function resolveAirbrushingDueDate(
  config: AirbrushingDueDateConfig,
  finish: Date | string | null | undefined,
): Date | null {
  const rule = config.dueDateRule ?? AIRBRUSHING_DUE_DATE_RULE.DAYS_AFTER_FINISH;

  // Data escolhida à mão: é o próprio valor, não uma função do término.
  if (rule === AIRBRUSHING_DUE_DATE_RULE.FIXED_DATE) {
    if (!config.dueDate) return null;
    const fixed = new Date(config.dueDate);
    return isNaN(fixed.getTime()) ? null : fixed;
  }

  const reference = spCalendarDate(finish);
  if (!reference) return null;
  const [year, month, day] = reference;

  if (rule === AIRBRUSHING_DUE_DATE_RULE.DAY_OF_MONTH) {
    const wanted = config.dueDayOfMonth;
    if (!wanted || wanted < 1) return null;

    // Próxima ocorrência do dia em/depois do término. "Dia 30" com término no dia
    // 25 vence neste mês; com término no dia 31 rola para o mês seguinte. O dia é
    // truncado ao último do mês (30 em fevereiro vira 28/29), mesma regra de
    // RecurrentPayableService.dueDateForCompetence.
    let dueYear = year;
    let dueMonth = month;
    let dueDay = Math.min(wanted, lastDayOfMonth(dueYear, dueMonth));

    if (dueDay < day) {
      dueMonth += 1;
      if (dueMonth > 12) {
        dueMonth = 1;
        dueYear += 1;
      }
      dueDay = Math.min(wanted, lastDayOfMonth(dueYear, dueMonth));
    }

    return spDueInstant(dueYear, dueMonth, dueDay);
  }

  // DAYS_AFTER_FINISH — Date.UTC normaliza o estouro de dia/mês sozinho.
  const term = config.paymentTermDays ?? AIRBRUSHING_DEFAULT_PAYMENT_TERM_DAYS;
  return spDueInstant(year, month, day + term);
}
