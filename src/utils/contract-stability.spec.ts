// contract-stability.spec.ts
// Pure unit tests for the estabilidade predicate + acidentária window helper (Part E).
// Style mirrors the other golden-value HR specs (pure functions, jest globals).

import { isUnderStability, computeAccidentStabilityWindow } from './contract-stability';
import { STABILITY_TYPE } from '@constants';

describe('contract-stability', () => {
  describe('computeAccidentStabilityWindow (art. 118 — 12 meses do retorno)', () => {
    it('sets ACCIDENT type and a 12-month window from the return date', () => {
      const ret = new Date(2026, 0, 15); // 2026-01-15
      const w = computeAccidentStabilityWindow(ret);
      expect(w.stabilityType).toBe(STABILITY_TYPE.ACCIDENT);
      expect(w.stabilityStart.getTime()).toBe(ret.getTime());
      expect(w.stabilityEnd.getFullYear()).toBe(2027);
      expect(w.stabilityEnd.getMonth()).toBe(0); // January
      expect(w.stabilityEnd.getDate()).toBe(15);
    });
  });

  describe('isUnderStability', () => {
    const ret = new Date(2026, 0, 15);
    const win = computeAccidentStabilityWindow(ret);
    const contract = {
      stabilityType: win.stabilityType,
      stabilityStart: win.stabilityStart,
      stabilityEnd: win.stabilityEnd,
    };

    it('returns false when there is no stabilityType', () => {
      expect(
        isUnderStability({ stabilityType: null, stabilityStart: ret, stabilityEnd: ret }, ret),
      ).toBe(false);
      expect(isUnderStability(null, ret)).toBe(false);
      expect(isUnderStability(undefined, ret)).toBe(false);
    });

    it('returns true on the start day (inclusive)', () => {
      expect(isUnderStability(contract, new Date(2026, 0, 15))).toBe(true);
    });

    it('returns true mid-window', () => {
      expect(isUnderStability(contract, new Date(2026, 6, 1))).toBe(true);
    });

    it('returns true on the end day (inclusive)', () => {
      expect(isUnderStability(contract, new Date(2027, 0, 15))).toBe(true);
    });

    it('returns false the day after the window ends', () => {
      expect(isUnderStability(contract, new Date(2027, 0, 16))).toBe(false);
    });

    it('returns false before the window starts', () => {
      expect(isUnderStability(contract, new Date(2026, 0, 14))).toBe(false);
    });

    it('treats a missing end as open-ended (e.g. union/CIPA mandate)', () => {
      const open = {
        stabilityType: STABILITY_TYPE.UNION,
        stabilityStart: new Date(2020, 0, 1),
        stabilityEnd: null,
      };
      expect(isUnderStability(open, new Date(2030, 0, 1))).toBe(true);
    });

    it('accepts ISO string dates', () => {
      const iso = {
        stabilityType: STABILITY_TYPE.ACCIDENT,
        stabilityStart: '2026-01-15T00:00:00.000Z',
        stabilityEnd: '2027-01-15T00:00:00.000Z',
      };
      expect(isUnderStability(iso, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
      expect(isUnderStability(iso, new Date('2027-02-01T00:00:00.000Z'))).toBe(false);
    });
  });
});
