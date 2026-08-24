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
