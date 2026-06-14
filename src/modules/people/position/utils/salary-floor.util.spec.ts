// salary-floor.util.spec.ts
// Pure-function tests for piso/salário-mínimo enforcement (Part F).
// Salário-mínimo nacional 2026 = R$ 1.621,00 (Decreto 12.797/2025).

import {
  NATIONAL_MINIMUM_WAGE,
  getNationalMinimumWage,
  checkSalaryFloor,
  toNumberOrNull,
} from './salary-floor.util';

describe('salary-floor.util (piso / salário-mínimo)', () => {
  it('uses R$ 1.621,00 as the current (2026) national minimum wage', () => {
    expect(NATIONAL_MINIMUM_WAGE).toBe(1621.0);
    expect(getNationalMinimumWage()).toBe(1621.0);
  });

  it('resolves the minimum wage by competence year', () => {
    expect(getNationalMinimumWage(new Date(2025, 5, 1))).toBe(1518.0);
    expect(getNationalMinimumWage(new Date(2026, 0, 1))).toBe(1621.0);
    // future year falls back to the latest known
    expect(getNationalMinimumWage(new Date(2030, 0, 1))).toBe(1621.0);
    // year before first known entry falls back to current
    expect(getNationalMinimumWage(new Date(2000, 0, 1))).toBe(1621.0);
  });

  describe('checkSalaryFloor', () => {
    it('flags below national minimum when no category floor', () => {
      const r = checkSalaryFloor(1500, null, new Date(2026, 0, 1));
      expect(r.belowFloor).toBe(true);
      expect(r.effectiveFloor).toBe(1621.0);
      expect(r.minimumWage).toBe(1621.0);
      expect(r.categoryFloor).toBeNull();
      expect(r.message).toContain('salário-mínimo');
    });

    it('accepts a value at or above the minimum wage', () => {
      expect(checkSalaryFloor(1621.0, null, new Date(2026, 0, 1)).belowFloor).toBe(false);
      expect(checkSalaryFloor(2000, null, new Date(2026, 0, 1)).belowFloor).toBe(false);
    });

    it('uses the category floor when it is higher than the minimum wage', () => {
      const r = checkSalaryFloor(1800, 2500, new Date(2026, 0, 1));
      expect(r.effectiveFloor).toBe(2500);
      expect(r.belowFloor).toBe(true);
      expect(r.message).toContain('piso da categoria');
    });

    it('ignores a category floor below the minimum wage (minimum wins)', () => {
      const r = checkSalaryFloor(1600, 1200, new Date(2026, 0, 1));
      expect(r.effectiveFloor).toBe(1621.0);
      expect(r.belowFloor).toBe(true);
      expect(r.message).toContain('salário-mínimo');
    });

    it('accepts a value at the higher category floor', () => {
      expect(checkSalaryFloor(2500, 2500, new Date(2026, 0, 1)).belowFloor).toBe(false);
    });
  });

  describe('toNumberOrNull', () => {
    it('converts Prisma Decimal-like and numbers, passes through null', () => {
      expect(toNumberOrNull(null)).toBeNull();
      expect(toNumberOrNull(undefined)).toBeNull();
      expect(toNumberOrNull(1234.56)).toBe(1234.56);
      expect(toNumberOrNull({ toString: () => '1500.00' })).toBe(1500);
    });
  });
});
