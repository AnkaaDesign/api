// benefit-discount.spec.ts
// Part H — VT-unknown-salary guard + share/split invariants.

import {
  calculateBenefitSplit,
  calculateEmployeeShare,
  employeeShareDependsOnSalary,
  isSalaryUnknownForShare,
  SALARY_BASED_DISCOUNT_KIND,
} from './benefit-discount';

describe('benefit-discount — VT-unknown-salary guard', () => {
  const vtPercentRule = {
    monthlyValue: 300,
    employeeDiscountPercent: 6,
    benefitKind: SALARY_BASED_DISCOUNT_KIND, // TRANSPORT_VOUCHER
  };

  it('flags salaryUnknownWarning when VT % rule has no/zero base salary', () => {
    expect(isSalaryUnknownForShare(vtPercentRule, null)).toBe(true);
    expect(isSalaryUnknownForShare(vtPercentRule, undefined)).toBe(true);
    expect(isSalaryUnknownForShare(vtPercentRule, 0)).toBe(true);

    const split = calculateBenefitSplit(vtPercentRule, null);
    expect(split.dependsOnSalary).toBe(true);
    expect(split.salaryUnknownWarning).toBe(true);
    // The share computes 0 — but the warning makes clear it is NOT a real 0.
    expect(split.employeeShare).toBe(0);
    expect(split.companyShare).toBe(300);
  });

  it('does NOT flag when the salary is known', () => {
    expect(isSalaryUnknownForShare(vtPercentRule, 2000)).toBe(false);
    const split = calculateBenefitSplit(vtPercentRule, 2000);
    expect(split.salaryUnknownWarning).toBe(false);
    expect(split.employeeShare).toBeCloseTo(120, 2); // 6% of 2000
    expect(split.companyShare).toBeCloseTo(180, 2);
  });

  it('does NOT flag for fixed-value VT (no salary dependency)', () => {
    const fixed = {
      monthlyValue: 300,
      employeeDiscountValue: 50,
      benefitKind: SALARY_BASED_DISCOUNT_KIND,
    };
    expect(employeeShareDependsOnSalary(fixed)).toBe(false);
    expect(isSalaryUnknownForShare(fixed, null)).toBe(false);
    expect(calculateBenefitSplit(fixed, null).salaryUnknownWarning).toBe(false);
    expect(calculateEmployeeShare(fixed, null)).toBe(50);
  });

  it('does NOT flag for non-salary-based percent benefits (e.g. VR)', () => {
    const vr = { monthlyValue: 500, employeeDiscountPercent: 20, benefitKind: 'MEAL_VOUCHER' };
    expect(isSalaryUnknownForShare(vr, null)).toBe(false);
    const split = calculateBenefitSplit(vr, null);
    expect(split.salaryUnknownWarning).toBe(false);
    expect(split.employeeShare).toBeCloseTo(100, 2); // 20% of cost
  });

  it('caps the VT share at the benefit cost even with a high salary', () => {
    const share = calculateEmployeeShare(vtPercentRule, 100000);
    expect(share).toBe(300); // 6% of 100k = 6000, clamped to monthlyValue
  });
});
