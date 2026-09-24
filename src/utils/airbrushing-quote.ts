import { AIRBRUSHING_QUOTE_STATUS, AIRBRUSHING_STATUS, EXECUTION_TIME_UNIT } from '@constants';

/**
 * =============================================================================
 * COTAÇÃO DA AEROGRAFIA — regras puras da negociação
 * =============================================================================
 *
 * Uma aerografia criada sem aerografista nasce em QUOTING. Cada aerografista
 * abre (no máximo) UMA negociação com ela — um AirbrushingQuote — e a conversa
 * alterna de lado:
 *
 *   aerografista PROPÕE ─────────────► PROPOSED   (vez do comercial)
 *   comercial CONTRAPROPÕE ──────────► COUNTERED  (vez do aerografista)
 *   aerografista ACEITA ─────────────► ACCEPTED   (vez do comercial)
 *   aerografista CONTRAPROPÕE ───────► PROPOSED
 *   aerografista RECUSA ─────────────► DECLINED
 *   comercial SELECIONA ─────────────► SELECTED   (todas as outras: NOT_SELECTED)
 *
 * ACEITAR NÃO É SER ESCOLHIDO. Um aerografista que aceita a contraproposta só
 * diz "faço por esse valor"; quem decide entre os que aceitaram é o comercial.
 * Por isso nunca há dois aerografistas no mesmo serviço: a única transição que
 * grava o aerografista na aerografia é SELECT, e ela encerra as demais.
 *
 * O valor selecionado nunca é digitado: é o `amount` da negociação, que em
 * PROPOSED é o último lance do aerografista e em ACCEPTED é a contraproposta
 * que ele aceitou.
 *
 * CONDIÇÕES = VALOR + TEMPO DE EXECUÇÃO (24/09/2026)
 *   Toda proposta traz as duas coisas; uma contraproposta muda uma, a outra ou
 *   as duas — a que não mudou continua a da negociação. Selecionar grava as
 *   duas na aerografia, e o término previsto sai do início + tempo.
 *
 * ORÇAMENTO DE ABERTURA
 *   A empresa pode abrir a cotação já com um valor (e, se quiser, um tempo).
 *   Para quem ainda não negociou, ele aparece como OFFER_RECEIVED: aceitar,
 *   contrapropor ou recusar. Aceitar um orçamento COM tempo é aceitar as
 *   condições da empresa (ACCEPTED); SEM tempo, ele informa o próprio prazo e
 *   isso é uma proposta (PROPOSED) — o comercial ainda precisa concordar.
 *
 * CONTRAPROPOSTA PARA TODOS
 *   A contraproposta é uma ação da COTAÇÃO: vale para todas as negociações em
 *   que é a vez da empresa responder a um lance (PROPOSED) ou em que ela revisa
 *   a própria (COUNTERED). Quem já aceitou fica de fora.
 * =============================================================================
 */

type QuoteStatus = AIRBRUSHING_QUOTE_STATUS | `${AIRBRUSHING_QUOTE_STATUS}`;

/** Negociações que ainda podem terminar em seleção. */
export const OPEN_AIRBRUSHING_QUOTE_STATUSES: readonly AIRBRUSHING_QUOTE_STATUS[] = [
  AIRBRUSHING_QUOTE_STATUS.PROPOSED,
  AIRBRUSHING_QUOTE_STATUS.COUNTERED,
  AIRBRUSHING_QUOTE_STATUS.ACCEPTED,
];

/** Negociações em que a próxima jogada é do comercial. */
export const COMPANY_TURN_AIRBRUSHING_QUOTE_STATUSES: readonly AIRBRUSHING_QUOTE_STATUS[] = [
  AIRBRUSHING_QUOTE_STATUS.PROPOSED,
  AIRBRUSHING_QUOTE_STATUS.ACCEPTED,
];

/** Negociações que podem ser selecionadas — o valor em jogo é do aerografista ou foi aceito por ele. */
export const SELECTABLE_AIRBRUSHING_QUOTE_STATUSES = COMPANY_TURN_AIRBRUSHING_QUOTE_STATUSES;

export function isAirbrushingQuoting(status: string | null | undefined): boolean {
  return status === AIRBRUSHING_STATUS.QUOTING;
}

/**
 * O aerografista pode enviar (ou revisar) uma proposta: primeira proposta,
 * revisão enquanto o comercial não respondeu, resposta a uma contraproposta
 * ou reconsideração depois de ter recusado. Depois de ACEITAR, o valor está
 * combinado — para mudar, ele recusa.
 *
 * SELECTED/NOT_SELECTED só coexistem com uma aerografia em QUOTING quando a
 * cotação foi REABERTA: a negociação antiga terminou e ele pode propor de novo.
 * (Quem garante que a aerografia está em cotação é o serviço, não esta regra.)
 */
export function canPainterPropose(status: QuoteStatus | null | undefined): boolean {
  return status !== AIRBRUSHING_QUOTE_STATUS.ACCEPTED;
}

/**
 * Onde a negociação está, do ponto de vista do aerografista — é o que o app
 * mostra no cartão e o que decide os botões. Calculado na API para que o app
 * não reimplemente a combinação status-da-aerografia × status-da-negociação.
 */
export type PainterQuoteStage =
  /** Em cotação e sem proposta ativa dele: "Envie seu valor". */
  | 'AWAITING_PROPOSAL'
  /** Em cotação, sem proposta dele, e a empresa abriu com um orçamento. */
  | 'OFFER_RECEIVED'
  /** Proposta enviada, aguardando o comercial. */
  | 'AWAITING_COMPANY'
  /** Contraproposta recebida: aceitar, recusar ou contrapropor. */
  | 'COUNTER_RECEIVED'
  /** Aceitou a contraproposta; aguardando a seleção. */
  | 'ACCEPTED'
  /** Recusou. Enquanto a cotação estiver aberta, pode reconsiderar. */
  | 'DECLINED'
  /** Foi selecionado — o serviço é dele. */
  | 'SELECTED'
  /** Outra proposta foi selecionada ou o serviço foi cancelado. */
  | 'NOT_SELECTED';

export function painterQuoteStage(
  airbrushingStatus: string | null | undefined,
  quoteStatus: QuoteStatus | null | undefined,
  /** A aerografia tem orçamento de abertura (quotationOfferAmount). */
  hasOffer = false,
): PainterQuoteStage {
  if (isAirbrushingQuoting(airbrushingStatus)) {
    switch (quoteStatus) {
      case AIRBRUSHING_QUOTE_STATUS.PROPOSED:
        return 'AWAITING_COMPANY';
      case AIRBRUSHING_QUOTE_STATUS.COUNTERED:
        return 'COUNTER_RECEIVED';
      case AIRBRUSHING_QUOTE_STATUS.ACCEPTED:
        return 'ACCEPTED';
      case AIRBRUSHING_QUOTE_STATUS.DECLINED:
        return 'DECLINED';
      default:
        // Nenhuma, ou uma negociação encerrada de uma cotação que foi reaberta.
        return hasOffer ? 'OFFER_RECEIVED' : 'AWAITING_PROPOSAL';
    }
  }
  if (quoteStatus === AIRBRUSHING_QUOTE_STATUS.SELECTED) return 'SELECTED';
  if (quoteStatus === AIRBRUSHING_QUOTE_STATUS.DECLINED) return 'DECLINED';
  return 'NOT_SELECTED';
}

/**
 * Há o que aceitar quando o comercial fez uma contraproposta, ou quando a
 * cotação abriu com orçamento e ele ainda não tem negociação ativa (nenhuma,
 * ou uma encerrada de cotação reaberta).
 */
export function canPainterAccept(
  status: QuoteStatus | null | undefined,
  hasOffer = false,
): boolean {
  if (status === AIRBRUSHING_QUOTE_STATUS.COUNTERED) return true;
  return hasOffer && isOfferPending(status);
}

/** O orçamento de abertura ainda está "na mesa" para este aerografista. */
export function isOfferPending(status: QuoteStatus | null | undefined): boolean {
  return (
    !status ||
    status === AIRBRUSHING_QUOTE_STATUS.SELECTED ||
    status === AIRBRUSHING_QUOTE_STATUS.NOT_SELECTED
  );
}

/**
 * Recusar vale sem proposta ("não tenho interesse"), em qualquer negociação aberta
 * e numa cotação reaberta. Só não se recusa duas vezes.
 */
export function canPainterDecline(status: QuoteStatus | null | undefined): boolean {
  return status !== AIRBRUSHING_QUOTE_STATUS.DECLINED;
}

/**
 * O comercial contrapõe uma proposta do aerografista ou revisa a própria
 * contraproposta. Depois que ele ACEITOU, o valor está combinado: o que resta é
 * selecionar (ou não) — contrapor de novo seria renegociar o que já fechou.
 */
export function canCompanyCounter(status: QuoteStatus | null | undefined): boolean {
  return (
    status === AIRBRUSHING_QUOTE_STATUS.PROPOSED || status === AIRBRUSHING_QUOTE_STATUS.COUNTERED
  );
}

/**
 * Selecionar exige um valor que o aerografista sustenta: o lance dele (PROPOSED)
 * ou a contraproposta que ele aceitou (ACCEPTED). Uma contraproposta ainda sem
 * resposta (COUNTERED) não pode ser selecionada — ele não disse que faz por ela.
 */
export function canCompanySelect(status: QuoteStatus | null | undefined): boolean {
  return (
    !!status && SELECTABLE_AIRBRUSHING_QUOTE_STATUSES.includes(status as AIRBRUSHING_QUOTE_STATUS)
  );
}

/** Valor monetário de um lance: positivo, finito, arredondado a centavos. */
export function normalizeQuoteAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Status inicial de uma aerografia NOVA. Sem aerografista, ela entra em cotação
 * — é o fluxo normal de criação. Com aerografista (cópia de tarefa, atribuição
 * direta), o status pedido é mantido.
 *
 * Só o status "padrão" (PREPARATION, ou nenhum) vira QUOTING: um status
 * explícito diferente (ex.: CANCELLED) é respeitado.
 */
export function resolveNewAirbrushingStatus(
  status: string | null | undefined,
  painterId: string | null | undefined,
): AIRBRUSHING_STATUS {
  if (painterId) {
    // QUOTING com aerografista é contraditório: ele já foi escolhido.
    if (!status || status === AIRBRUSHING_STATUS.QUOTING) return AIRBRUSHING_STATUS.PREPARATION;
    return status as AIRBRUSHING_STATUS;
  }
  if (!status || status === AIRBRUSHING_STATUS.PREPARATION || status === 'PENDING') {
    return AIRBRUSHING_STATUS.QUOTING;
  }
  return status as AIRBRUSHING_STATUS;
}

// =============================================================================
// Tempo de execução
// =============================================================================

type ExecutionUnit = EXECUTION_TIME_UNIT | `${EXECUTION_TIME_UNIT}`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Término previsto a partir do início previsto e do tempo de execução.
 *
 * DIAS contam o dia do início ("começa dia 29, 2 dias → termina dia 30"), que é
 * como o chão de fábrica fala; HORAS somam ao horário do início. Sem início ou
 * sem tempo, não há o que derivar.
 */
export function computeExpectedFinishDate(
  startDate: Date | string | null | undefined,
  executionTime: number | null | undefined,
  unit: ExecutionUnit | null | undefined,
): Date | null {
  if (!startDate || !executionTime || executionTime <= 0 || !unit) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  if (unit === EXECUTION_TIME_UNIT.HOURS)
    return new Date(start.getTime() + executionTime * HOUR_MS);
  return new Date(start.getTime() + (executionTime - 1) * DAY_MS);
}

/** "1 dia", "3 dias", "1 hora", "8 horas". */
export function formatExecutionTime(
  executionTime: number | null | undefined,
  unit: ExecutionUnit | null | undefined,
): string {
  if (!executionTime || !unit) return '';
  const hours = unit === EXECUTION_TIME_UNIT.HOURS;
  const word = hours
    ? executionTime === 1
      ? 'hora'
      : 'horas'
    : executionTime === 1
      ? 'dia'
      : 'dias';
  return `${executionTime} ${word}`;
}

/** Condições de uma negociação para texto de notificação: "R$ 820,00 em 2 dias". */
export function formatQuoteTerms(
  amount: number | null | undefined,
  executionTime: number | null | undefined,
  unit: ExecutionUnit | null | undefined,
): string {
  const money =
    amount === null || amount === undefined || !Number.isFinite(amount)
      ? ''
      : amount.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const time = formatExecutionTime(executionTime, unit);
  if (money && time) return `${money} em ${time}`;
  return money || time;
}

/**
 * Condições de uma contraproposta aplicadas a uma negociação: o que a empresa
 * mandou vence, o que ela não mandou continua o que estava em jogo.
 */
export function mergeCounterTerms(
  current: {
    amount: number | null;
    executionTime: number | null;
    executionTimeUnit: string | null;
  },
  counter: {
    amount?: number | null;
    executionTime?: number | null;
    executionTimeUnit?: string | null;
  },
): { amount: number | null; executionTime: number | null; executionTimeUnit: string | null } {
  const changesTime = counter.executionTime != null && counter.executionTimeUnit != null;
  return {
    amount: counter.amount != null ? normalizeQuoteAmount(counter.amount) : current.amount,
    executionTime: changesTime ? counter.executionTime! : current.executionTime,
    executionTimeUnit: changesTime ? counter.executionTimeUnit! : current.executionTimeUnit,
  };
}
