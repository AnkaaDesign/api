/**
 * A VALIDADE DA PROPOSTA, contada a partir de HOJE.
 *
 * `Budget.expiresAt` é um INSTANTE, mas quem o lê pensa num DIA: "vale até
 * 25/10". A tela sempre gravou o fim desse dia no fuso do navegador
 * (`setHours(23, 59, 59, 999)`), que em São Paulo é 02:59:59.999 UTC do dia
 * seguinte. Este arquivo grava o mesmo instante sem depender do fuso de quem
 * chama — a API roda em UTC, e `setHours` aqui encerraria a validade às 20:59 de
 * São Paulo, três horas antes do que o PDF promete.
 *
 * Os mesmos períodos do seletor da tela (15/30/60/90), e o mesmo padrão (30).
 */

import { saoPauloCalendarDayPlus } from './due-date.util';

export const QUOTE_VALIDITY_DEFAULT_DAYS = 30;
export const QUOTE_VALIDITY_MAX_DAYS = 365;

/**
 * O fim do dia (São Paulo) daqui a `days` dias de calendário.
 *
 * `saoPauloCalendarDayPlus` dá o dia ao meio-dia UTC; o fim desse dia em São
 * Paulo (UTC−3 o ano todo) é 02:59:59.999 UTC do dia SEGUINTE.
 */
export function quoteValidityEnd(days: number, now: Date = new Date()): Date {
  const day = saoPauloCalendarDayPlus(now, days);
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1, 2, 59, 59, 999),
  );
}

/** "25/10/2026", no calendário de São Paulo. */
export function formatQuoteValidity(expiresAt: Date): string {
  return expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
