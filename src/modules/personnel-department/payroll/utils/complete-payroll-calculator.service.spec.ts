// complete-payroll-calculator.service.spec.ts
//
// Unit tests for the Part B monthly-payroll math:
//  - salário-família (wired earning, proportional in hire/term months)
//  - insalubridade (10/20/40% × salário-mínimo) / periculosidade (30% × base)
//  - justified-vs-unjustified absence split (day + DSR loss via the canonical
//    calculateAbsenceDeduction)
//  - pensão alimentícia + plano de saúde subtracted from the IRRF base
//  - margem consignável (LOAN+ADVANCE ≤ 35% líquido) clamp + warning
//  - mid-month proration (avos)
//  - net never negative
//
// Pure-ish: the calculator's external deps (Secullum, tax calculator, Prisma)
// are stubbed so the math is exercised without a Nest context or DB.
//
// Legal refs: NR-15/NR-16; Súmula 228 TST (insalubridade × mínimo);
// Portaria MPS/MF 13/2026 (INSS + salário-família R$ 67,54 ≤ R$ 1.980,38);
// Lei 9.250/95 art. 8º (plano de saúde dedutível); Lei 10.820/2003 + Dec.
// 11.150/2022 (margem consignável 35%).

import { CompletePayrollCalculatorService } from './complete-payroll-calculator.service';
import { BrazilianTaxCalculatorService } from './brazilian-tax-calculator.service';
import {
  computeSalarioFamilia,
  getSalarioFamiliaTableForYear,
} from './tax-tables';
import { InsalubrityDegree, PayrollDiscountType } from '@prisma/client';

// A real tax calculator (it only needs Prisma for the optional DB tax-table
// override; with a stub that returns null it falls back to the statutory tables).
const prismaStub: any = {
  taxTable: { findFirst: async () => null },
  userBenefit: { findMany: async () => [] },
};
const taxCalc = new BrazilianTaxCalculatorService(prismaStub);

// Secullum stub: returns a controllable payroll-data shape per test.
function makeSecullumStub(data: Partial<any>) {
  return {
    getPayrollDataFromSecullum: async () => ({
      employeeId: 'e',
      secullumId: '1',
      period: { year: 2026, month: 6, startDate: '', endDate: '' },
      normalHours: 0,
      nightHours: 0,
      overtime50: 0,
      overtime100: 0,
      absenceHours: 0,
      absenceDays: 0,
      justifiedAbsenceHours: 0,
      unjustifiedAbsenceHours: 0,
      dsrDays: 4,
      dsrHours: 0,
      lateArrivalMinutes: 0,
      earlyDepartureMinutes: 0,
      workingDaysInMonth: 26,
      workedDays: 26,
      sundays: 4,
      holidays: 0,
      rawCalculationData: null,
      ...data,
    }),
  } as any;
}

function makeService(secullumData: Partial<any> = {}) {
  return new CompletePayrollCalculatorService(
    prismaStub,
    taxCalc,
    makeSecullumStub(secullumData),
  );
}

const baseParams = {
  employeeId: 'e',
  year: 2026,
  month: 6,
  secullumEmployeeId: 1,
};

describe('tax-tables.computeSalarioFamilia', () => {
  const table = getSalarioFamiliaTableForYear(2026); // quota 67.54, limit 1980.38

  it('pays R$67,54 per eligible child below the remuneration limit', () => {
    expect(computeSalarioFamilia(1800, 2, table)).toBeCloseTo(135.08, 2);
  });

  it('pays nothing above the remuneration limit', () => {
    expect(computeSalarioFamilia(2500, 2, table)).toBe(0);
  });

  it('pays nothing with no eligible children', () => {
    expect(computeSalarioFamilia(1000, 0, table)).toBe(0);
  });
});

describe('BrazilianTaxCalculatorService.calculateAbsenceDeduction', () => {
  it('deducts the absent day(s) AND proportional DSR loss', () => {
    // R$ 2.600 / 26 working days = R$ 100/dia; 4 DSR days.
    // 1 falta → dia 100 + DSR (100 × 4 × 1 / 26 = 15,3846) = 115,38
    const r = taxCalc.calculateAbsenceDeduction({
      monthlySalary: 2600,
      workingDaysInMonth: 26,
      unjustifiedAbsenceDays: 1,
      sundaysInMonth: 4,
      holidaysInMonth: 0,
    });
    expect(r.amount).toBeCloseTo(115.38, 2);
    expect((r.details as any).dsrLoss).toBeCloseTo(15.38, 2);
  });

  it('deducts nothing when there are no unjustified absences', () => {
    const r = taxCalc.calculateAbsenceDeduction({
      monthlySalary: 2600,
      workingDaysInMonth: 26,
      unjustifiedAbsenceDays: 0,
      sundaysInMonth: 4,
      holidaysInMonth: 0,
    });
    expect(r.amount).toBe(0);
  });
});

describe('CompletePayrollCalculator — salário-família', () => {
  it('adds salário-família to net as an isento earning (not in gross)', async () => {
    const svc = makeService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 1800,
      salarioFamiliaChildren: 2,
    } as any);
    // 2 × 67,54 = 135,08
    expect(calc.additionalEarnings.familyAllowance).toBeCloseTo(135.08, 2);
    // gross is the salary only (família is isento, paid on top in net)
    expect(calc.grossSalary).toBeCloseTo(1800, 2);
    // INSS 2026 progressivo: 1621×7,5% + 179×9% = 121,575 + 16,11 = 137,69.
    // net = 1800 + 135,08 − 137,69 = 1797,39 (sem IRRF, base abaixo da isenção).
    expect(calc.netSalary).toBeCloseTo(1797.39, 2);
  });

  it('does not pay salário-família above the remuneration limit', async () => {
    const svc = makeService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 2500,
      salarioFamiliaChildren: 2,
    } as any);
    expect(calc.additionalEarnings.familyAllowance).toBe(0);
  });
});

describe('CompletePayrollCalculator — insalubridade / periculosidade', () => {
  it('insalubridade MED = 20% × salário-mínimo (R$ 1.621 em 2026)', async () => {
    const svc = makeService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 3000,
      insalubrityDegree: InsalubrityDegree.MED,
    } as any);
    // 1621 × 0,20 = 324,20
    expect(calc.additionalEarnings.insalubrity).toBeCloseTo(324.2, 2);
    expect(calc.additionalEarnings.hazardPay).toBe(0);
    expect(calc.grossSalary).toBeCloseTo(3324.2, 2);
  });

  it('periculosidade = 30% × salário-base', async () => {
    const svc = makeService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 3000,
      hazardPay: true,
    } as any);
    expect(calc.additionalEarnings.hazardPay).toBeCloseTo(900, 2);
    expect(calc.additionalEarnings.insalubrity).toBe(0);
  });

  it('mutually exclusive — insalubridade wins when both set', async () => {
    const svc = makeService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 3000,
      insalubrityDegree: InsalubrityDegree.MAX, // 40%
      hazardPay: true,
    } as any);
    expect(calc.additionalEarnings.insalubrity).toBeCloseTo(648.4, 2); // 1621 × 0,40
    expect(calc.additionalEarnings.hazardPay).toBe(0);
  });
});

describe('CompletePayrollCalculator — justified absence split', () => {
  it('does NOT deduct justified (atestado/abono) hours', async () => {
    // 16h total faltas, all justified → no deduction.
    const svc = makeService({
      absenceHours: 16,
      justifiedAbsenceHours: 16,
      unjustifiedAbsenceHours: 0,
    });
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 2600,
    } as any);
    expect(calc.absenceDeductions.absenceAmount).toBe(0);
    expect(calc.absenceDeductions.unjustifiedAbsenceDays).toBe(0);
  });

  it('deducts only the unjustified portion (day + DSR loss)', async () => {
    // workingDays 26 → dailyHours = 220/26 ≈ 8,4615; 8,4615h unjust = 1 dia.
    const svc = makeService({
      absenceHours: 16.923,
      justifiedAbsenceHours: 8.4615,
      unjustifiedAbsenceHours: 8.4615,
    });
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 2600,
    } as any);
    // ≈ 1 dia → 100 + DSR 15,38 = 115,38 (allow rounding slack)
    expect(calc.absenceDeductions.absenceAmount).toBeGreaterThan(110);
    expect(calc.absenceDeductions.absenceAmount).toBeLessThan(120);
  });
});

describe('CompletePayrollCalculator — pensão alimentícia + plano de saúde on IRRF base', () => {
  it('alimony and health plan reduce the IRRF base (lower IRRF)', async () => {
    const svc = makeService();
    const withDeduction = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 8000,
      useSimplifiedDeduction: false,
      healthPlanIrrfDeductible: 500,
      persistentDiscounts: [
        { type: PayrollDiscountType.ALIMONY, value: 1000, reference: 'Pensão' },
      ],
    } as any);
    const without = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 8000,
      useSimplifiedDeduction: false,
    } as any);
    // Same INSS, but IRRF lower with pensão+plano deducted from base.
    expect(withDeduction.taxDeductions.irrfAmount).toBeLessThan(
      without.taxDeductions.irrfAmount,
    );
    expect(withDeduction.taxDeductions.irrfBase).toBeLessThan(without.taxDeductions.irrfBase);
  });
});

describe('CompletePayrollCalculator — VT salário-desconhecido (warning, não silencia)', () => {
  // Prisma stub returning one ACTIVE VT enrollment with a %-of-salary discount.
  function makeVtPrisma(): any {
    return {
      taxTable: { findFirst: async () => null },
      userBenefit: {
        findMany: async () => [
          {
            id: 'ub-vt',
            monthlyValue: 200,
            employeeDiscountValue: null,
            employeeDiscountPercent: 6, // 6% do salário-base (regra VT)
            benefit: { kind: 'TRANSPORT_VOUCHER', name: 'Vale Transporte' },
          },
        ],
      },
    };
  }

  function makeVtService() {
    const prisma = makeVtPrisma();
    return new CompletePayrollCalculatorService(
      prisma,
      new BrazilianTaxCalculatorService(prisma),
      makeSecullumStub({}),
    );
  }

  it('emite warning e NÃO desconta VT quando o salário-base é 0/desconhecido', async () => {
    const svc = makeVtService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 0, // salário desconhecido → share = 6% × 0 = 0
    } as any);
    // O VT NÃO é descontado (share 0)…
    expect(calc.benefitDeductions.transportVoucher).toBe(0);
    // …mas a folha avisa em vez de silenciar.
    expect(
      calc.warnings.some(w => /salário-base desconhecido/i.test(w) && /VT/.test(w)),
    ).toBe(true);
  });

  it('desconta normalmente quando o salário-base é conhecido (sem warning de VT)', async () => {
    const svc = makeVtService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 2000, // 6% × 2000 = 120, limitado ao custo 200 → 120
    } as any);
    expect(calc.benefitDeductions.transportVoucher).toBeCloseTo(120, 2);
    expect(calc.warnings.some(w => /salário-base desconhecido/i.test(w))).toBe(false);
  });
});

describe('CompletePayrollCalculator — margem consignável (35%)', () => {
  it('clamps LOAN+ADVANCE above 35% of líquido and warns', async () => {
    const svc = makeService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 2000,
      persistentDiscounts: [
        { type: PayrollDiscountType.LOAN, value: 1500, reference: 'Consignado' },
      ],
    } as any);
    // INSS 2026 sobre 2000 = 1621×7,5% + 379×9% = 121,575 + 34,11 = 155,685 ≈ 155,69.
    // líquido-base = 2000 − 155,69 = 1844,31; margem 35% = 645,51.
    // 1500 solicitados → consignado limitado a 645,51; sobra do salário preservada.
    expect(calc.loanDeductions.loans).toBeCloseTo(645.51, 2);
    expect(calc.warnings.some(w => w.includes('consign'))).toBe(true);
    expect(calc.netSalary).toBeGreaterThan(0);
  });
});

describe('CompletePayrollCalculator — net never negative', () => {
  it('clamps net to 0 and warns when deductions exceed earnings', async () => {
    const svc = makeService();
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 2000,
      persistentDiscounts: [
        // garnishment is non-consignável so it is not capped by the 35% rule
        { type: PayrollDiscountType.GARNISHMENT, value: 5000, reference: 'Penhora' },
      ],
    } as any);
    expect(calc.netSalary).toBe(0);
    expect(calc.warnings.some(w => w.toLowerCase().includes('líquido') || w.includes('0,00'))).toBe(
      true,
    );
  });
});

describe('CompletePayrollCalculator — mid-month proration (avos)', () => {
  it('prorates base salary + salário-família by days covered', async () => {
    const svc = makeService();
    // June has 30 days; admitted on the 16th → 15 days covered.
    const calc = await svc.calculateCompletePayroll({
      ...baseParams,
      baseSalary: 1800,
      salarioFamiliaChildren: 2,
      daysCoveredInMonth: 15,
      daysInMonth: 30,
    } as any);
    expect(calc.prorationFactor).toBeCloseTo(0.5, 4);
    expect(calc.baseSalary).toBeCloseTo(900, 2); // 1800 × 0,5
    expect(calc.additionalEarnings.familyAllowance).toBeCloseTo(67.54, 2); // 135,08 × 0,5
  });
});
