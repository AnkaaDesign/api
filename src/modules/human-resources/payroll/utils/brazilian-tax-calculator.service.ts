import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  PayrollDiscountType,
  TaxType,
  Prisma,
  TaxTable,
  TaxBracket,
} from '@prisma/client';

/**
 * ============================================================================
 * BRAZILIAN TAX CALCULATOR SERVICE
 * ============================================================================
 * Complete implementation of Brazilian payroll taxes and deductions:
 * - INSS (Progressive Social Security)
 * - IRRF (Progressive Income Tax)
 * - FGTS (Severance Fund - 8%)
 * - DSR (Weekly Rest Pay)
 * - Union Contributions
 * - Absences
 * - Other deductions
 *
 * All calculations follow CLT (Consolidação das Leis do Trabalho) and
 * current 2025 tax tables.
 * ============================================================================
 */

export interface TaxCalculationResult {
  taxType: PayrollDiscountType;
  base: number; // Base value for calculation
  rate?: number; // Rate applied (if applicable)
  amount: number; // Final tax amount
  details: any; // Detailed breakdown
}

export interface INSSCalculationDetails {
  brackets: Array<{
    bracketOrder: number;
    minValue: number;
    maxValue: number | null;
    rate: number;
    incomeInBracket: number; // How much income falls in this bracket
    taxOnBracket: number; // Tax on this bracket portion
  }>;
  totalTax: number;
  effectiveRate: number; // Actual percentage paid
  baseValue: number;
}

export interface IRRFCalculationDetails {
  grossIncome: number;
  inssDeduction: number;
  dependentsDeduction: number;
  simplifiedDeduction?: number;
  taxableIncome: number;
  brackets: Array<{
    bracketOrder: number;
    minValue: number;
    maxValue: number | null;
    rate: number;
    deduction: number;
    applicableTax: number;
  }>;
  totalTax: number;
  effectiveRate: number;
}

export interface DSRCalculationDetails {
  workType: 'MONTHLY' | 'HOURLY' | 'COMMISSION' | 'OVERTIME';
  baseValue: number; // Total commissions, hourly pay, or overtime in the month
  workingDaysInMonth: number;
  sundays: number;
  holidays: number;
  dsrAmount: number;
  formula: string;
}

export interface AbsenceCalculationDetails {
  absenceDays: number;
  dailyRate: number;
  deductionAmount: number;
  affectsDSR: boolean; // Unjustified absences affect DSR
  dsrLoss?: number;
}

@Injectable()
export class BrazilianTaxCalculatorService {
  private readonly logger = new Logger(BrazilianTaxCalculatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ========================================================================
   * INSS PROGRESSIVE CALCULATOR
   * ========================================================================
   * Calculates INSS using progressive brackets.
   * Each rate applies only to the income portion within that bracket.
   *
   * Example for R$ 3.000,00:
   * - Bracket 1 (até 1.518,00): 1.518,00 × 7,5% = R$ 113,85
   * - Bracket 2 (1.518,01 - 2.793,88): 1.275,88 × 9% = R$ 114,83
   * - Bracket 3 (2.793,89 - 3.000,00): 206,12 × 12% = R$ 24,73
   * Total: R$ 253,41 (8,45% effective rate)
   */
  async calculateINSS(
    grossSalary: number,
    year: number = 2025,
  ): Promise<TaxCalculationResult> {
    try {
      // Get active INSS tax table for the year
      const taxTable = await this.getActiveTaxTable(TaxType.INSS, year);

      if (!taxTable || !taxTable.brackets || taxTable.brackets.length === 0) {
        this.logger.warn(`No INSS tax table found for year ${year}`);
        return {
          taxType: PayrollDiscountType.INSS,
          base: grossSalary,
          amount: 0,
          details: { error: 'Tax table not found' },
        };
      }

      // Calculate INSS progressively
      let totalTax = 0;
      const bracketDetails: INSSCalculationDetails['brackets'] = [];

      for (const bracket of taxTable.brackets) {
        const minValue = bracket.minValue.toNumber();
        const maxValue = bracket.maxValue?.toNumber() || Infinity;
        const rate = bracket.rate.toNumber();

        // Calculate how much income falls in this bracket
        // CRITICAL: Progressive calculation - each bracket only taxes the portion within its range
        // Example: For R$ 3000 in bracket 2 (1518.01 to 2793.88):
        //   Income in bracket = min(3000, 2793.88) - max(0, 1518.01 - 0.01) = 2793.88 - 1518.00 = 1275.88
        const incomeInBracket = Math.max(
          0,
          Math.min(grossSalary, maxValue) - Math.max(0, minValue - 0.01),
        );

        const taxOnBracket = (incomeInBracket * rate) / 100;
        totalTax += taxOnBracket;

        bracketDetails.push({
          bracketOrder: bracket.bracketOrder,
          minValue,
          maxValue: bracket.maxValue?.toNumber() || null,
          rate,
          incomeInBracket,
          taxOnBracket,
        });

        this.logger.debug(
          `INSS Bracket ${bracket.bracketOrder}: R$ ${incomeInBracket.toFixed(2)} × ${rate}% = R$ ${taxOnBracket.toFixed(2)}`,
        );

        // Stop if we've reached the salary limit
        if (grossSalary <= maxValue) break;
      }

      const effectiveRate = grossSalary > 0 ? (totalTax / grossSalary) * 100 : 0;

      const details: INSSCalculationDetails = {
        brackets: bracketDetails,
        totalTax,
        effectiveRate,
        baseValue: grossSalary,
      };

      return {
        taxType: PayrollDiscountType.INSS,
        base: grossSalary,
        rate: effectiveRate,
        amount: totalTax,
        details,
      };
    } catch (error) {
      this.logger.error('Error calculating INSS:', error);
      return {
        taxType: PayrollDiscountType.INSS,
        base: grossSalary,
        amount: 0,
        details: { error: error.message },
      };
    }
  }

  /**
   * ========================================================================
   * IRRF PROGRESSIVE CALCULATOR
   * ========================================================================
   * Calculates Income Tax Withheld at Source using progressive brackets.
   *
   * Calculation order:
   * 1. Gross Salary
   * 2. - INSS (deductible)
   * 3. - Dependents (R$ 189,59 per dependent)
   * 4. - Simplified Deduction (25% up to R$ 607,20) OR Itemized
   * 5. = Taxable Base
   * 6. Apply progressive brackets with deductions
   */
  async calculateIRRF(
    grossSalary: number,
    inssAmount: number,
    dependentsCount: number = 0,
    useSimplifiedDeduction: boolean = true,
    year: number = 2025,
  ): Promise<TaxCalculationResult> {
    try {
      // Get active IRRF tax table for the year
      const taxTable = await this.getActiveTaxTable(TaxType.IRRF, year);

      if (!taxTable || !taxTable.brackets || taxTable.brackets.length === 0) {
        this.logger.warn(`No IRRF tax table found for year ${year}`);
        return {
          taxType: PayrollDiscountType.IRRF,
          base: grossSalary,
          amount: 0,
          details: { error: 'Tax table not found' },
        };
      }

      // Extract settings from tax table
      const settings = taxTable.settings as any;
      const dependentDeduction = settings?.deducaoPorDependente || 189.59;
      const simplifiedDeductionMax = settings?.descontoSimplificado || 607.2;

      // Calculate deductions
      const inssDeduction = inssAmount;
      const dependentsDeduction = dependentsCount * dependentDeduction;

      let simplifiedDeduction = 0;
      if (useSimplifiedDeduction) {
        // 25% of (gross - INSS), limited to R$ 607,20
        simplifiedDeduction = Math.min(
          (grossSalary - inssDeduction) * 0.25,
          simplifiedDeductionMax,
        );
      }

      // Taxable income
      const taxableIncome = Math.max(
        0,
        grossSalary - inssDeduction - dependentsDeduction - simplifiedDeduction,
      );

      // Find applicable bracket
      let totalTax = 0;
      const bracketDetails: IRRFCalculationDetails['brackets'] = [];

      for (const bracket of taxTable.brackets) {
        const minValue = bracket.minValue.toNumber();
        const maxValue = bracket.maxValue?.toNumber() || Infinity;
        const rate = bracket.rate.toNumber();
        const deduction = bracket.deduction?.toNumber() || 0;

        if (taxableIncome >= minValue && taxableIncome <= maxValue) {
          // Apply simplified formula: (Taxable Income × Rate) - Deduction
          totalTax = Math.max(0, (taxableIncome * rate) / 100 - deduction);

          bracketDetails.push({
            bracketOrder: bracket.bracketOrder,
            minValue,
            maxValue: bracket.maxValue?.toNumber() || null,
            rate,
            deduction,
            applicableTax: totalTax,
          });

          break;
        }
      }

      const effectiveRate = grossSalary > 0 ? (totalTax / grossSalary) * 100 : 0;

      const details: IRRFCalculationDetails = {
        grossIncome: grossSalary,
        inssDeduction,
        dependentsDeduction,
        simplifiedDeduction: useSimplifiedDeduction ? simplifiedDeduction : undefined,
        taxableIncome,
        brackets: bracketDetails,
        totalTax,
        effectiveRate,
      };

      return {
        taxType: PayrollDiscountType.IRRF,
        base: taxableIncome,
        rate: effectiveRate,
        amount: totalTax,
        details,
      };
    } catch (error) {
      this.logger.error('Error calculating IRRF:', error);
      return {
        taxType: PayrollDiscountType.IRRF,
        base: grossSalary,
        amount: 0,
        details: { error: error.message },
      };
    }
  }

  /**
   * ========================================================================
   * FGTS CALCULATOR
   * ========================================================================
   * FGTS is 8% of gross salary, paid by EMPLOYER (not deducted from employee).
   * We track it for transparency and compliance reporting.
   *
   * Exception: Young apprentices = 2%, Domestic workers = 11.2%
   */
  calculateFGTS(grossSalary: number, isApprentice: boolean = false): TaxCalculationResult {
    const rate = isApprentice ? 2.0 : 8.0;
    const amount = (grossSalary * rate) / 100;

    return {
      taxType: PayrollDiscountType.FGTS,
      base: grossSalary,
      rate,
      amount,
      details: {
        rate,
        grossSalary,
        fgtsAmount: amount,
        paidByEmployer: true,
        note: 'FGTS is not deducted from employee salary - paid by employer',
      },
    };
  }

  /**
   * ========================================================================
   * DSR (DESCANSO SEMANAL REMUNERADO) CALCULATOR
   * ========================================================================
   * Weekly rest pay - required by Brazilian law.
   *
   * Rules:
   * - MONTHLY WORKERS: DSR is already included in monthly salary
   * - HOURLY WORKERS: (Total hours in month / Working days) × (Sundays + Holidays)
   * - COMMISSION WORKERS: (Total commissions / Working days) × (Sundays + Holidays)
   * - OVERTIME: (Total overtime / Working days) × (Sundays + Holidays)
   */
  calculateDSR(params: {
    workType: 'MONTHLY' | 'HOURLY' | 'COMMISSION' | 'OVERTIME';
    baseValue: number; // Total amount for the month
    workingDaysInMonth: number; // Mon-Sat (Saturdays count as working days)
    sundaysInMonth: number;
    holidaysInMonth: number;
  }): TaxCalculationResult {
    const { workType, baseValue, workingDaysInMonth, sundaysInMonth, holidaysInMonth } = params;

    // Monthly workers: DSR already included
    if (workType === 'MONTHLY') {
      return {
        taxType: PayrollDiscountType.CUSTOM,
        base: baseValue,
        amount: 0,
        details: {
          workType,
          baseValue,
          workingDaysInMonth,
          sundays: sundaysInMonth,
          holidays: holidaysInMonth,
          dsrAmount: 0,
          formula: 'DSR já incluído no salário mensal',
        },
      };
    }

    // For hourly, commission, and overtime: calculate DSR
    const dsrDays = sundaysInMonth + holidaysInMonth;
    const dsrAmount = workingDaysInMonth > 0 ? (baseValue / workingDaysInMonth) * dsrDays : 0;

    const formula =
      workType === 'HOURLY'
        ? `(Total horas × Valor hora / Dias úteis) × (Domingos + Feriados)`
        : workType === 'COMMISSION'
          ? `(Total comissões / Dias úteis) × (Domingos + Feriados)`
          : `(Total HE / Dias úteis) × (Domingos + Feriados)`;

    return {
      taxType: PayrollDiscountType.CUSTOM,
      base: baseValue,
      amount: dsrAmount,
      details: {
        workType,
        baseValue,
        workingDaysInMonth,
        sundays: sundaysInMonth,
        holidays: holidaysInMonth,
        dsrAmount,
        formula,
      } as DSRCalculationDetails,
    };
  }

  /**
   * ========================================================================
   * ABSENCE DEDUCTION CALCULATOR
   * ========================================================================
   * Calculates salary deduction for absences.
   *
   * Rules:
   * - Justified absences: No deduction (medical certificate, etc.)
   * - Unjustified absences: Deduct daily rate AND proportional DSR
   */
  calculateAbsenceDeduction(params: {
    monthlySalary: number;
    workingDaysInMonth: number;
    unjustifiedAbsenceDays: number;
    sundaysInMonth: number;
    holidaysInMonth: number;
  }): TaxCalculationResult {
    const { monthlySalary, workingDaysInMonth, unjustifiedAbsenceDays, sundaysInMonth, holidaysInMonth } = params;

    if (unjustifiedAbsenceDays === 0 || workingDaysInMonth === 0) {
      return {
        taxType: PayrollDiscountType.ABSENCE,
        base: monthlySalary,
        amount: 0,
        details: {
          absenceDays: 0,
          dailyRate: 0,
          deductionAmount: 0,
          affectsDSR: false,
        } as AbsenceCalculationDetails,
      };
    }

    // Calculate daily rate
    const dailyRate = monthlySalary / workingDaysInMonth;

    // Deduction for absence days
    const absenceDeduction = dailyRate * unjustifiedAbsenceDays;

    // DSR loss (proportional to absences)
    const dsrDays = sundaysInMonth + holidaysInMonth;
    const dsrLoss = (dailyRate * dsrDays * unjustifiedAbsenceDays) / workingDaysInMonth;

    const totalDeduction = absenceDeduction + dsrLoss;

    return {
      taxType: PayrollDiscountType.ABSENCE,
      base: monthlySalary,
      amount: totalDeduction,
      details: {
        absenceDays: unjustifiedAbsenceDays,
        dailyRate,
        deductionAmount: totalDeduction,
        affectsDSR: true,
        dsrLoss,
      } as AbsenceCalculationDetails,
    };
  }

  /**
   * ========================================================================
   * UNION CONTRIBUTION CALCULATOR
   * ========================================================================
   * Since 2017 labor reform, union contribution is VOLUNTARY.
   * Requires written authorization from employee.
   *
   * Amount: 1 day of work (deducted in March annually)
   */
  calculateUnionContribution(params: {
    monthlySalary: number;
    workingDaysInMonth: number;
    hasAuthorization: boolean;
    currentMonth: number; // 1-12
  }): TaxCalculationResult {
    const { monthlySalary, workingDaysInMonth, hasAuthorization, currentMonth } = params;

    // Only deduct in March AND if employee authorized
    if (currentMonth !== 3 || !hasAuthorization || workingDaysInMonth === 0) {
      return {
        taxType: PayrollDiscountType.UNION,
        base: monthlySalary,
        amount: 0,
        details: {
          authorized: hasAuthorization,
          month: currentMonth,
          note: currentMonth !== 3 ? 'Union contribution only in March' : 'No authorization',
        },
      };
    }

    // One day of work
    const dailyRate = monthlySalary / workingDaysInMonth;

    return {
      taxType: PayrollDiscountType.UNION,
      base: monthlySalary,
      amount: dailyRate,
      details: {
        authorized: true,
        month: currentMonth,
        dailyRate,
        contributionAmount: dailyRate,
        note: 'Contribuição sindical anual (Lei 13.467/2017 - voluntário)',
      },
    };
  }

  /**
   * ========================================================================
   * HELPER: GET ACTIVE TAX TABLE
   * ========================================================================
   */
  private async getActiveTaxTable(
    taxType: TaxType,
    year: number,
  ): Promise<(TaxTable & { brackets: TaxBracket[] }) | null> {
    return this.prisma.taxTable.findFirst({
      where: {
        taxType,
        year,
        isActive: true,
      },
      include: {
        brackets: {
          orderBy: {
            bracketOrder: 'asc',
          },
        },
      },
    });
  }

  /**
   * ========================================================================
   * HELPER: GET WORKING DAYS IN MONTH
   * ========================================================================
   * Counts Mon-Sat (Saturdays are working days in Brazil unless holiday)
   */
  getWorkingDaysInMonth(year: number, month: number): {
    workingDays: number;
    sundays: number;
    saturdays: number;
  } {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    let workingDays = 0;
    let sundays = 0;
    let saturdays = 0;

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday

      if (dayOfWeek === 0) {
        sundays++;
      } else if (dayOfWeek === 6) {
        saturdays++;
        workingDays++; // Saturdays count as working days
      } else {
        workingDays++; // Mon-Fri
      }
    }

    return { workingDays, sundays, saturdays };
  }
}
