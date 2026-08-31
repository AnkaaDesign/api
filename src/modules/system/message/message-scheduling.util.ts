import type { MessageStatus } from '@prisma/client';

/**
 * Janela de exibição das mensagens/comunicados.
 *
 * O composer da web e do app escolhe DATAS (um `DateRangePicker`), não instantes.
 * Uma data escolhida chegava aqui como a meia-noite LOCAL do dia — então "Término
 * 29/08" era gravado como `2026-08-29T03:00:00Z` (00:00 em São Paulo) e a mensagem
 * morria na virada PARA o dia 29, um dia antes do que o autor pediu.
 *
 * A regra passa a ser explícita e vale para qualquer cliente: o início é o
 * PRIMEIRO instante do dia em São Paulo e o término é o ÚLTIMO. Normalizar é
 * idempotente — reenviar um valor já normalizado devolve o mesmo instante.
 */
const SAO_PAULO = 'America/Sao_Paulo';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: SAO_PAULO,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Quanto o UTC está à frente do relógio de parede de São Paulo, neste instante (ms). */
function saoPauloOffsetMs(instant: Date): number {
  const parts = Object.fromEntries(
    PARTS.formatToParts(instant).map(p => [p.type, p.value]),
  ) as Record<string, string>;
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  // `formatToParts` não expõe milissegundos: descontá-los evita que a fração de
  // segundo do instante de referência vaze para dentro do deslocamento.
  return instant.getTime() - instant.getMilliseconds() - wallClockAsUtc;
}

/** Data-calendário (ano/mês/dia) do instante, lida em São Paulo. */
function saoPauloYMD(instant: Date): [number, number, number] {
  const [y, m, d] = instant.toLocaleDateString('en-CA', { timeZone: SAO_PAULO }).split('-');
  return [Number(y), Number(m), Number(d)];
}

/**
 * Materializa um horário de parede de São Paulo como instante UTC.
 * Duas passadas porque o deslocamento é medido NO instante — a segunda converge
 * caso o Brasil volte a ter horário de verão e o dia caia na virada.
 */
function saoPauloWallClock(
  [year, month, day]: [number, number, number],
  h: number,
  min: number,
  s: number,
  ms: number,
  reference: Date,
): Date {
  const base = Date.UTC(year, month - 1, day, h, min, s, ms);
  let instant = new Date(base + saoPauloOffsetMs(reference));
  instant = new Date(base + saoPauloOffsetMs(instant));
  return instant;
}

/** Primeiro instante (00:00:00.000 SP) do dia-calendário a que o valor pertence. */
export function startOfDisplayDay(value: Date | string): Date {
  const instant = new Date(value);
  return saoPauloWallClock(saoPauloYMD(instant), 0, 0, 0, 0, instant);
}

/** Último instante (23:59:59.999 SP) do dia-calendário a que o valor pertence. */
export function endOfDisplayDay(value: Date | string): Date {
  const instant = new Date(value);
  return saoPauloWallClock(saoPauloYMD(instant), 23, 59, 59, 999, instant);
}

// =====================================================================
// Dia-calendário como VALOR, para atravessar o motor de recorrência
// =====================================================================

/**
 * Um dia do calendário, sem fuso: `[ano, mês 1-12, dia]`.
 *
 * Existe porque o motor `@utils/schedule-recurrence` faz a matemática de datas
 * no relógio DO PROCESSO (`date-fns` `startOfDay`/`getDay`) — o cabeçalho dele
 * avisa que só produz a data certa com `TZ=America/Sao_Paulo`. A API de produção
 * roda em UTC, e a conta então passava por São Paulo duas vezes com sinais
 * diferentes: o motor devolvia meia-noite UTC de "segunda 07/09" e
 * `startOfDisplayDay` relia aquele instante em São Paulo, onde ele é 21h de
 * DOMINGO 06/09. Toda ocorrência saía um dia antes do dia configurado.
 *
 * A correção não é depender do fuso do processo: é nunca deixar um dia-calendário
 * viajar como instante. Converte-se explicitamente na entrada e na saída do
 * motor, e o resultado é o mesmo com TZ=UTC, SP ou qualquer outro.
 */
export type CalendarDay = [year: number, month: number, day: number];

/** O dia-calendário a que o instante pertence, lido em São Paulo. */
export function saoPauloCalendarDay(value: Date | string): CalendarDay {
  return saoPauloYMD(new Date(value));
}

/**
 * O dia-calendário como meia-noite no relógio DO PROCESSO — a única forma que o
 * motor de recorrência entende, porque é assim que ele constrói e lê datas.
 */
export function toProcessLocalDay([year, month, day]: CalendarDay): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/** O caminho de volta: o dia-calendário que uma data do motor representa. */
export function fromProcessLocalDay(date: Date): CalendarDay {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

/** Soma dias-calendário. A conta é em UTC de propósito: lá o dia tem 24h sempre. */
export function addCalendarDays([year, month, day]: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000);
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()];
}

/** Ordem cronológica entre dois dias-calendário (`<0`, `0`, `>0`). */
export function compareCalendarDays(a: CalendarDay, b: CalendarDay): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** O instante em que `hour:00` de São Paulo acontece neste dia-calendário. */
export function atSaoPauloHour(day: CalendarDay, hour: number): Date {
  return saoPauloWallClock(day, hour, 0, 0, 0, midday(day));
}

/** Último instante (23:59:59.999 SP) deste dia-calendário. */
export function endOfSaoPauloDay(day: CalendarDay): Date {
  return saoPauloWallClock(day, 23, 59, 59, 999, midday(day));
}

/**
 * Instante de referência para medir o deslocamento do fuso: meio-dia UTC do dia
 * pedido. Longe das duas viradas, então cai no dia certo em São Paulo qualquer
 * que seja o deslocamento — inclusive se o horário de verão voltar.
 */
function midday([year, month, day]: CalendarDay): Date {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

/** Normaliza a janela recebida do cliente; `null`/`undefined` passam intactos. */
export function normalizeDisplayWindow(startsAt?: unknown, endsAt?: unknown) {
  return {
    startDate: startsAt ? startOfDisplayDay(startsAt as string) : null,
    endDate: endsAt ? endOfDisplayDay(endsAt as string) : null,
  };
}

/**
 * Situação de uma mensagem PUBLICADA, derivada só da janela de exibição.
 *
 * `DRAFT` e `ARCHIVED` são decisões humanas e nunca saem daqui — quem chama só
 * consulta esta função quando a mensagem está (ou vai ficar) no ar. É a mesma
 * regra usada no create/update/activate e no agendador de ciclo de vida, para que
 * a coluna STATUS jamais discorde do que o usuário final enxerga.
 */
export function resolveLifecycleStatus(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  now: Date = new Date(),
): Extract<MessageStatus, 'SCHEDULED' | 'ACTIVE' | 'EXPIRED'> {
  if (endDate && endDate.getTime() < now.getTime()) return 'EXPIRED';
  if (startDate && startDate.getTime() > now.getTime()) return 'SCHEDULED';
  return 'ACTIVE';
}

/** A mensagem está visível para o usuário final agora? */
export function isVisibleNow(
  status: MessageStatus,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return status === 'ACTIVE' && resolveLifecycleStatus(startDate, endDate, now) === 'ACTIVE';
}
