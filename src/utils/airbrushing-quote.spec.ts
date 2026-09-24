// airbrushing-quote.spec.ts
// Regras puras da cotação da aerografia. Roda com jest ou com
// `npx tsx --test src/utils/airbrushing-quote.spec.ts` (shim abaixo).

import { AIRBRUSHING_QUOTE_STATUS as Q, AIRBRUSHING_STATUS as S } from '@constants';
import {
  computeExpectedFinishDate,
  formatExecutionTime,
  formatQuoteTerms,
  mergeCounterTerms,
  canCompanyCounter,
  canCompanySelect,
  canPainterAccept,
  canPainterDecline,
  canPainterPropose,
  normalizeQuoteAmount,
  painterQuoteStage,
  resolveNewAirbrushingStatus,
} from './airbrushing-quote';

describe('airbrushing-quote', () => {
  describe('resolveNewAirbrushingStatus', () => {
    it('sends a new airbrushing without painter to QUOTING', () => {
      expect(resolveNewAirbrushingStatus(undefined, null)).toBe(S.QUOTING);
      expect(resolveNewAirbrushingStatus(S.PREPARATION, null)).toBe(S.QUOTING);
      // Legacy default of the task repository.
      expect(resolveNewAirbrushingStatus('PENDING', undefined)).toBe(S.QUOTING);
    });

    it('keeps an explicit non-default status', () => {
      expect(resolveNewAirbrushingStatus(S.CANCELLED, null)).toBe(S.CANCELLED);
    });

    it('never keeps QUOTING when a painter is already assigned', () => {
      expect(resolveNewAirbrushingStatus(S.QUOTING, 'painter-1')).toBe(S.PREPARATION);
      expect(resolveNewAirbrushingStatus(undefined, 'painter-1')).toBe(S.PREPARATION);
      expect(resolveNewAirbrushingStatus(S.WAITING_PRODUCTION, 'painter-1')).toBe(
        S.WAITING_PRODUCTION,
      );
    });
  });

  describe('painter actions', () => {
    it('proposes from nothing, a revision, a counter, a decline or a reopened quotation', () => {
      for (const status of [undefined, Q.PROPOSED, Q.COUNTERED, Q.DECLINED, Q.NOT_SELECTED]) {
        expect(canPainterPropose(status)).toBe(true);
      }
    });

    it('does not re-propose after accepting the counter', () => {
      expect(canPainterPropose(Q.ACCEPTED)).toBe(false);
    });

    it('accepts only a pending counter', () => {
      expect(canPainterAccept(Q.COUNTERED)).toBe(true);
      for (const status of [undefined, Q.PROPOSED, Q.ACCEPTED, Q.DECLINED]) {
        expect(canPainterAccept(status)).toBe(false);
      }
    });

    it('declines anything except an existing decline', () => {
      expect(canPainterDecline(undefined)).toBe(true);
      expect(canPainterDecline(Q.ACCEPTED)).toBe(true);
      expect(canPainterDecline(Q.DECLINED)).toBe(false);
    });
  });

  describe('company actions', () => {
    it('selects only a value the painter stands behind', () => {
      expect(canCompanySelect(Q.PROPOSED)).toBe(true);
      expect(canCompanySelect(Q.ACCEPTED)).toBe(true);
      // Counter still unanswered: the painter never agreed to it.
      expect(canCompanySelect(Q.COUNTERED)).toBe(false);
      expect(canCompanySelect(Q.DECLINED)).toBe(false);
      expect(canCompanySelect(Q.NOT_SELECTED)).toBe(false);
    });

    it('counters every active negotiation, accepted ones included', () => {
      for (const status of [Q.PROPOSED, Q.COUNTERED, Q.ACCEPTED]) {
        expect(canCompanyCounter(status)).toBe(true);
      }
      for (const status of [Q.DECLINED, Q.SELECTED, Q.NOT_SELECTED, undefined]) {
        expect(canCompanyCounter(status)).toBe(false);
      }
    });
  });

  describe('painterQuoteStage', () => {
    it('maps an open quotation', () => {
      expect(painterQuoteStage(S.QUOTING, undefined)).toBe('AWAITING_PROPOSAL');
      expect(painterQuoteStage(S.QUOTING, Q.PROPOSED)).toBe('AWAITING_COMPANY');
      expect(painterQuoteStage(S.QUOTING, Q.COUNTERED)).toBe('COUNTER_RECEIVED');
      expect(painterQuoteStage(S.QUOTING, Q.ACCEPTED)).toBe('ACCEPTED');
      expect(painterQuoteStage(S.QUOTING, Q.DECLINED)).toBe('DECLINED');
      // Reopened quotation: the old outcome no longer matters.
      expect(painterQuoteStage(S.QUOTING, Q.NOT_SELECTED)).toBe('AWAITING_PROPOSAL');
    });

    it('maps a closed quotation', () => {
      expect(painterQuoteStage(S.PREPARATION, Q.SELECTED)).toBe('SELECTED');
      expect(painterQuoteStage(S.PREPARATION, Q.NOT_SELECTED)).toBe('NOT_SELECTED');
      expect(painterQuoteStage(S.CANCELLED, Q.DECLINED)).toBe('DECLINED');
    });
  });

  it('rounds amounts to cents', () => {
    expect(normalizeQuoteAmount(1234.567)).toBe(1234.57);
    expect(normalizeQuoteAmount(0.1 + 0.2)).toBe(0.3);
  });

  describe('opening offer', () => {
    it('shows OFFER_RECEIVED to a painter without a negotiation', () => {
      expect(painterQuoteStage(S.QUOTING, undefined, true)).toBe('OFFER_RECEIVED');
      expect(painterQuoteStage(S.QUOTING, Q.NOT_SELECTED, true)).toBe('OFFER_RECEIVED');
      // His own proposal outranks the offer.
      expect(painterQuoteStage(S.QUOTING, Q.PROPOSED, true)).toBe('AWAITING_COMPANY');
    });

    it('lets him accept the offer only while it is pending', () => {
      expect(canPainterAccept(undefined, true)).toBe(true);
      expect(canPainterAccept(undefined, false)).toBe(false);
      expect(canPainterAccept(Q.PROPOSED, true)).toBe(false);
      expect(canPainterAccept(Q.COUNTERED, false)).toBe(true);
    });
  });

  describe('execution time', () => {
    const start = new Date('2026-09-29T12:00:00.000Z');

    it('counts days including the start day', () => {
      expect(computeExpectedFinishDate(start, 1, 'DAYS')?.toISOString()).toBe(start.toISOString());
      expect(computeExpectedFinishDate(start, 2, 'DAYS')?.toISOString()).toBe(
        '2026-09-30T12:00:00.000Z',
      );
    });

    it('adds hours to the start time', () => {
      expect(computeExpectedFinishDate(start, 8, 'HOURS')?.toISOString()).toBe(
        '2026-09-29T20:00:00.000Z',
      );
    });

    it('derives nothing without start or time', () => {
      expect(computeExpectedFinishDate(null, 2, 'DAYS')).toBe(null);
      expect(computeExpectedFinishDate(start, null, 'DAYS')).toBe(null);
    });

    it('formats pt-BR', () => {
      expect(formatExecutionTime(1, 'DAYS')).toBe('1 dia');
      expect(formatExecutionTime(3, 'HOURS')).toBe('3 horas');
      expect(formatQuoteTerms(820, 2, 'DAYS')).toBe('R$\u00a0820,00 em 2 dias');
    });
  });

  describe('counter merges terms', () => {
    const current = { amount: 900, executionTime: 3, executionTimeUnit: 'DAYS' };
    it('changes only what the company sent', () => {
      const valueOnly = mergeCounterTerms(current, { amount: 820 });
      expect(valueOnly.amount).toBe(820);
      expect(valueOnly.executionTime).toBe(3);
      const timeOnly = mergeCounterTerms(current, {
        executionTime: 16,
        executionTimeUnit: 'HOURS',
      });
      expect(timeOnly.amount).toBe(900);
      expect(timeOnly.executionTimeUnit).toBe('HOURS');
    });
  });
});
