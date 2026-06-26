import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PayrollDiscountType, TaxType, Prisma, TaxTable, TaxBracket } from '@prisma/client';

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
  /** Imposto pela tabela progressiva antes do redutor (Lei 15.270/2025). */
  taxBeforeRedutor?: number;
  /** Redução aplicada pela Lei 15.270/2025 (2026+). */
  redutorAmount?: number;
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
  workType: 'MONTHLY' | 'HOURLY' | 'BONIFICATION' | 'OVERTIME';
  baseValue: number; // Total bonifications, hourly pay, or overtime in the month
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

// ============================================================================
// LEGAL CONSTANTS & STATUTORY TABLES
// ============================================================================
// As tabelas oficiais (INSS/IRRF/salário-família) vivem em ./tax-tables.ts,
// versionadas por vigência. Quando existir TaxTable ativa no banco para o
// ano, os brackets do banco têm precedência; o REDUTOR da Lei 15.270/2025
// vem SEMPRE das constantes estatutárias (o modelo TaxBracket não o
// representa), salvo override em taxTable.settings.redutor.

import {
  getInssTableForYear,
  getIrrfTableForYear,
  computeProgressiveINSS,
  computeIRRF,
  IRRF_DEPENDENT_DEDUCTION,
  IRRF_SIMPLIFIED_DEDUCTION,
  type IrrfRedutor,
  type ProgressiveBracket,
} from './tax-tables';

export { IRRF_DEPENDENT_DEDUCTION, IRRF_SIMPLIFIED_DEDUCTION } from './tax-tables';

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
    year: number = new Date().getFullYear(),
  ): Promise<TaxCalculationResult> {
    try {
      // Get active INSS tax table for the year (database has precedence)
      const taxTable = await this.getActiveTaxTable(TaxType.INSS, year);

      let brackets: ProgressiveBracket[];
      if (taxTable && taxTable.brackets && taxTable.brackets.length > 0) {
        brackets = taxTable.brackets.map(b => ({
          minValue: b.minValue.toNumber(),
          maxValue: b.maxValue?.toNumber() ?? null,
          rate: b.rate.toNumber(),
        }));
        this.logger.debug(`Using database INSS table for year ${year}`);
      } else {
        // Statutory table for the year (e.g. Portaria MPS/MF 13/2026 for 2026)
        const statutory = getInssTableForYear(year);
        this.logger.debug(
          `No INSS tax table in DB for year ${year}; using statutory table ${statutory.year} (${statutory.legalReference})`,
        );
        brackets = statutory.brackets;
      }

      // Progressive calculation by cumulative caps (ceiling-capped)
      const computation = computeProgressiveINSS(grossSalary, brackets);

      const details: INSSCalculationDetails = {
        brackets: computation.perBracket,
        totalTax: computation.total,
        effectiveRate: computation.effectiveRate,
        baseValue: grossSalary,
      };

      return {
        taxType: PayrollDiscountType.INSS,
        base: grossSalary,
        rate: computation.effectiveRate,
        amount: computation.total,
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
    year: number = new Date().getFullYear(),
    // Referência dos RENDIMENTOS brutos para o redutor da Lei 15.270/2025.
    // Quando o chamador subtrai deduções itemizadas (pensão/plano) de
    // grossSalary ANTES de chamar (path itemizado), deve passar aqui os
    // rendimentos brutos não reduzidos, para o redutor não ser super-concedido.
    // Omitido ⇒ usa grossSalary. PENDENTE sign-off contábil (Andressa).
    redutorReference?: number,
  ): Promise<TaxCalculationResult> {
    try {
      // Statutory table for the year — also the source of the Lei 15.270/2025
      // redutor, which the DB TaxBracket model cannot represent.
      const statutory = getIrrfTableForYear(year);

      // Database table (brackets/settings) has precedence when present
      const taxTable = await this.getActiveTaxTable(TaxType.IRRF, year);

      let brackets: ProgressiveBracket[];
      let dependentDeduction = statutory.dependentDeduction;
      let simplifiedDeductionMax = statutory.simplifiedDeduction;
      let redutor: IrrfRedutor | null = statutory.redutor;

      if (taxTable && taxTable.brackets && taxTable.brackets.length > 0) {
        brackets = taxTable.brackets.map(b => ({
          minValue: b.minValue.toNumber(),
          maxValue: b.maxValue?.toNumber() ?? null,
          rate: b.rate.toNumber(),
          deduction: b.deduction?.toNumber() || 0,
        }));
        const tableSettings = taxTable.settings as any;
        dependentDeduction = tableSettings?.deducaoPorDependente || dependentDeduction;
        simplifiedDeductionMax = tableSettings?.descontoSimplificado || simplifiedDeductionMax;
        // Optional settings override for the statutory redutor
        if (tableSettings?.redutor?.coefA != null) {
          redutor = tableSettings.redutor as IrrfRedutor;
        }
        this.logger.debug(`Using database IRRF table for year ${year}`);
      } else {
        this.logger.debug(
          `No IRRF tax table in DB for year ${year}; using statutory table ${statutory.year} (${statutory.legalReference})`,
        );
        brackets = statutory.brackets;
      }

      // Pure computation: maior dedução entre legais (INSS + dependentes) e
      // desconto simplificado; tabela progressiva; redutor Lei 15.270/2025
      // sobre os rendimentos tributáveis (2026+).
      const computation = computeIRRF({
        taxableGross: grossSalary,
        redutorReference: redutorReference ?? grossSalary,
        inssAmount,
        dependentsCount,
        allowSimplifiedDeduction: useSimplifiedDeduction,
        table: {
          year,
          effectiveFrom: statutory.effectiveFrom,
          legalReference: statutory.legalReference,
          brackets,
          dependentDeduction,
          simplifiedDeduction: simplifiedDeductionMax,
          redutor,
        },
      });

      const totalTax = computation.tax;
      const effectiveRate = grossSalary > 0 ? (totalTax / grossSalary) * 100 : 0;

      const details: IRRFCalculationDetails = {
        grossIncome: grossSalary,
        inssDeduction: computation.usedSimplifiedDeduction ? 0 : inssAmount,
        dependentsDeduction: computation.usedSimplifiedDeduction
          ? 0
          : computation.dependentsDeduction,
        simplifiedDeduction: computation.usedSimplifiedDeduction
          ? computation.simplifiedDeduction
          : undefined,
        taxBeforeRedutor: computation.taxBeforeRedutor,
        redutorAmount: computation.redutorAmount,
        taxableIncome: computation.taxableIncome,
        brackets: computation.appliedBracket
          ? [
              {
                bracketOrder: 1,
                minValue: computation.appliedBracket.minValue,
                maxValue: computation.appliedBracket.maxValue,
                rate: computation.appliedBracket.rate,
                deduction: computation.appliedBracket.deduction,
                applicableTax: totalTax,
              },
            ]
          : [],
        totalTax,
        effectiveRate,
      };

      return {
        taxType: PayrollDiscountType.IRRF,
        base: computation.taxableIncome,
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
   * - BONIFICATION WORKERS: (Total bonifications / Working days) × (Sundays + Holidays)
   * - OVERTIME: (Total overtime / Working days) × (Sundays + Holidays)
   */
  calculateDSR(params: {
    workType: 'MONTHLY' | 'HOURLY' | 'BONIFICATION' | 'OVERTIME';
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

    // For hourly, bonification, and overtime: calculate DSR
    const dsrDays = sundaysInMonth + holidaysInMonth;
    const dsrAmount = workingDaysInMonth > 0 ? (baseValue / workingDaysInMonth) * dsrDays : 0;

    const formula =
      workType === 'HOURLY'
        ? `(Total horas × Valor hora / Dias úteis) × (Domingos + Feriados)`
        : workType === 'BONIFICATION'
          ? `(Total bonificações / Dias úteis) × (Domingos + Feriados)`
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
    const {
      monthlySalary,
      workingDaysInMonth,
      unjustifiedAbsenceDays,
      sundaysInMonth,
      holidaysInMonth,
    } = params;

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
  getWorkingDaysInMonth(
    year: number,
    month: number,
  ): {
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
