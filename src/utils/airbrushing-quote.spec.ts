// airbrushing-quote.spec.ts
// Regras puras da cotação da aerografia. Roda com jest ou com
// `npx tsx --test src/utils/airbrushing-quote.spec.ts` (shim abaixo).

import { AIRBRUSHING_QUOTE_STATUS as Q, AIRBRUSHING_STATUS as S } from '@constants';
import {
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

    it('counters any open negotiation', () => {
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
});
