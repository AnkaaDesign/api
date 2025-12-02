import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BrazilianTaxCalculatorService } from './brazilian-tax-calculator.service';
import {
  SecullumPayrollIntegrationService,
  SecullumPayrollData,
} from '../services/secullum-payroll-integration.service';
import { PayrollDiscountType, Prisma } from '@prisma/client';
import { roundCurrency } from '@utils/currency-precision.util';

/**
 * ============================================================================
 * COMPLETE PAYROLL CALCULATOR SERVICE
 * ============================================================================
 * Orchestrates FULL Brazilian payroll calculation including:
 *
 * EARNINGS:
 * - Base salary
 * - Overtime 50% (Mon-Sat)
 * - Overtime 100% (Sundays/Holidays)
 * - Night shift differential (20%)
 * - DSR on overtime and commissions
 * - Bonuses
 *
 * DEDUCTIONS:
 * - INSS (Progressive)
 * - IRRF (Progressive)
 * - Absences (hours)
 * - Late arrivals
 * - Advance payments
 * - Meal vouchers
 * - Transport vouchers
 * - Health/Dental insurance
 * - Union contribution
 * - Alimony
 * - Loans
 * - Garnishments
 * - Custom deductions
 *
 * EMPLOYER CONTRIBUTIONS (tracked):
 * - FGTS (8%)
 * ============================================================================
 */

export interface CompletePayrollCalculation {
  // Employee info
  employeeId: string;
  year: number;
  month: number;

  // ========== EARNINGS ==========
  baseSalary: number;
  overtimeEarnings: {
    overtime50Hours: number;
    overtime50Amount: number;
    overtime100Hours: number;
    overtime100Amount: number;
    nightHours: number;
    nightDifferentialAmount: number;
  };
  dsrEarnings: {
    dsrOnOvertime: number;
    dsrOnCommissions: number;
    totalDSR: number;
    dsrDays: number;
  };
  bonusAmount: number;
  otherEarnings: number;
  grossSalary: number; // Total before deductions

  // ========== DEDUCTIONS ==========
  taxDeductions: {
    inssBase: number;
    inssAmount: number;
    inssEffectiveRate: number;
    irrfBase: number;
    irrfAmount: number;
    irrfEffectiveRate: number;
  };
  absenceDeductions: {
    absenceHours: number;
    absenceDays: number;
    absenceAmount: number;
    lateArrivalMinutes: number;
    lateArrivalAmount: number;
  };
  benefitDeductions: {
    mealVoucher: number;
    transportVoucher: number;
    healthInsurance: number;
    dentalInsurance: number;
  };
  legalDeductions: {
    unionContribution: number;
    alimony: number;
    garnishment: number;
  };
  loanDeductions: {
    loans: number;
    advances: number;
  };
  customDeductions: number;
  totalDeductions: number;

  // ========== NET SALARY ==========
  netSalary: number;

  // ========== EMPLOYER CONTRIBUTIONS ==========
  employerContributions: {
    fgtsAmount: number;
    fgtsRate: number;
  };

  // ========== SECULLUM DATA ==========
  secullumData?: SecullumPayrollData;

  // ========== CALCULATION METADATA ==========
  calculationDate: Date;
  workingDaysInMonth: number;
  workedDays: number;
  isLive: boolean; // Is this a live calculation or saved?
}

export interface CalculatePayrollParams {
  employeeId: string;
  year: number;
  month: number;
  baseSalary: number;
  bonusAmount?: number;

  // Employee data for Secullum mapping (use CPF, PIS, or payrollNumber)
  cpf?: string;
  pis?: string;
  payrollNumber?: string;
  dependentsCount?: number;
  useSimplifiedDeduction?: boolean;
  unionMember?: boolean;
  isApprentice?: boolean;

  // Optional: Override Secullum data (for testing/manual entry)
  overrideSecullumData?: Partial<SecullumPayrollData>;

  // Persistent discounts (alimony, health insurance, etc.)
  persistentDiscounts?: Array<{
    type: PayrollDiscountType;
    value?: number;
    percentage?: number;
    reference: string;
  }>;
}

@Injectable()
export class CompletePayrollCalculatorService {
  private readonly logger = new Logger(CompletePayrollCalculatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculator: BrazilianTaxCalculatorService,
    private readonly secullumIntegration: SecullumPayrollIntegrationService,
  ) {}

  /**
   * ========================================================================
   * CALCULATE COMPLETE PAYROLL
   * ========================================================================
   * Main orchestrator - calculates everything
   */
  async calculateCompletePayroll(
    params: CalculatePayrollParams,
  ): Promise<CompletePayrollCalculation> {
    const {
      employeeId,
      year,
      month,
      baseSalary,
      bonusAmount = 0,
      cpf,
      pis,
      payrollNumber,
      dependentsCount = 0,
      useSimplifiedDeduction = true,
      unionMember = false,
      isApprentice = false,
      overrideSecullumData,
      persistentDiscounts = [],
    } = params;

    this.logger.log(
      `Calculating complete payroll for employee ${employeeId} - ${year}/${month}`,
    );

    // ========================================================================
    // STEP 1: GET SECULLUM DATA (hours, overtime, absences)
    // ========================================================================
    let secullumData: SecullumPayrollData | undefined;

    // Try to fetch Secullum data if we have CPF, PIS, or Payroll Number
    if (cpf || pis || payrollNumber) {
      try {
        secullumData = await this.secullumIntegration.getPayrollDataFromSecullum({
          employeeId,
          cpf,
          pis,
          payrollNumber,
          year,
          month,
        });

        // Apply overrides if provided
        if (overrideSecullumData) {
          secullumData = { ...secullumData, ...overrideSecullumData };
        }
      } catch (error) {
        this.logger.error(`Error fetching Secullum data for ${employeeId}:`, error);
      }
    } else {
      this.logger.warn(
        `No CPF, PIS, or Payroll Number provided for employee ${employeeId} - skipping Secullum integration`,
      );
    }

    // ========================================================================
    // STEP 2: CALCULATE EARNINGS
    // ========================================================================

    // Base salary (already provided)
    const base = baseSalary;

    // Calculate hourly rate (for overtime calculation)
    // CRITICAL: Brazilian CLT standard is 220 hours/month (44 hours/week ÷ 6 days × 30 days)
    // Formula: Monthly Salary ÷ 220 hours = Hourly Rate
    const workingDaysInMonth = secullumData?.workingDaysInMonth || 22;
    const workedDays = secullumData?.workedDays || workingDaysInMonth;
    const monthlyHours = 220; // CLT Article 7, XIII - 220 hours/month standard
    const hourlyRate = base / monthlyHours;

    this.logger.debug(
      `Hourly rate calculation: R$ ${base.toFixed(2)} ÷ ${monthlyHours} hrs = R$ ${hourlyRate.toFixed(4)}/hr`,
    );

    // Overtime calculations
    const overtime50Hours = secullumData?.overtime50 || 0;
    const overtime50Amount = roundCurrency(overtime50Hours * hourlyRate * 1.5);

    const overtime100Hours = secullumData?.overtime100 || 0;
    const overtime100Amount = roundCurrency(overtime100Hours * hourlyRate * 2.0);

    // Night shift differential (20% adicional noturno - Art. 73 CLT)
    const nightHours = secullumData?.nightHours || 0;
    const nightDifferentialAmount = roundCurrency(nightHours * hourlyRate * 0.2);

    // DSR on overtime (required by law)
    const totalOvertimeAmount = overtime50Amount + overtime100Amount;
    const sundays = secullumData?.sundays || 4;
    const holidays = secullumData?.holidays || 0;
    const dsrDays = sundays + holidays;
    const dsrOnOvertime =
      workingDaysInMonth > 0
        ? roundCurrency((totalOvertimeAmount / workingDaysInMonth) * dsrDays)
        : 0;

    // DSR on commissions (if applicable - future feature)
    const dsrOnCommissions = 0;
    const totalDSR = dsrOnOvertime + dsrOnCommissions;

    // Bonus (from bonus calculation)
    const bonus = bonusAmount;

    // Other earnings (future: hazard pay, etc.)
    const otherEarnings = 0;

    // GROSS SALARY
    const grossSalary = roundCurrency(
      base +
        overtime50Amount +
        overtime100Amount +
        nightDifferentialAmount +
        totalDSR +
        bonus +
        otherEarnings,
    );

    // ========================================================================
    // STEP 3: CALCULATE TAX DEDUCTIONS
    // ========================================================================

    // INSS (Progressive)
    const inssResult = await this.taxCalculator.calculateINSS(grossSalary, year);
    const inssAmount = roundCurrency(inssResult.amount);
    const inssBase = grossSalary;
    const inssEffectiveRate = inssResult.rate || 0;

    // IRRF (Progressive, after INSS)
    const irrfResult = await this.taxCalculator.calculateIRRF(
      grossSalary,
      inssAmount,
      dependentsCount,
      useSimplifiedDeduction,
      year,
    );
    const irrfAmount = roundCurrency(irrfResult.amount);
    const irrfBase = irrfResult.base;
    const irrfEffectiveRate = irrfResult.rate || 0;

    // ========================================================================
    // STEP 4: CALCULATE ABSENCE DEDUCTIONS
    // ========================================================================

    const absenceHours = secullumData?.unjustifiedAbsenceHours || 0;
    const absenceDays = secullumData?.absenceDays || 0;
    const absenceAmount = roundCurrency((absenceHours * hourlyRate));

    // Late arrivals
    const lateMinutes = secullumData?.lateArrivalMinutes || 0;
    const lateArrivalAmount = roundCurrency((lateMinutes / 60) * hourlyRate);

    // ========================================================================
    // STEP 5: CALCULATE BENEFIT DEDUCTIONS
    // ========================================================================

    // These come from persistent discounts or defaults
    const mealVoucher = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.MEAL_VOUCHER,
      0,
    );
    const transportVoucher = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.TRANSPORT_VOUCHER,
      0,
    );
    const healthInsurance = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.HEALTH_INSURANCE,
      0,
    );
    const dentalInsurance = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.DENTAL_INSURANCE,
      0,
    );

    // ========================================================================
    // STEP 6: CALCULATE LEGAL DEDUCTIONS
    // ========================================================================

    // Union contribution (only in March if member)
    const unionResult = this.taxCalculator.calculateUnionContribution({
      monthlySalary: baseSalary,
      workingDaysInMonth,
      hasAuthorization: unionMember,
      currentMonth: month,
    });
    const unionContribution = roundCurrency(unionResult.amount);

    // Alimony (court-ordered) - calculated as percentage of gross salary
    const alimony = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.ALIMONY,
      0,
      grossSalary, // Base value for percentage calculation
    );

    // Garnishment (judicial)
    const garnishment = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.GARNISHMENT,
      0,
    );

    // ========================================================================
    // STEP 7: CALCULATE LOAN DEDUCTIONS
    // ========================================================================

    const loans = this.getDiscountAmount(persistentDiscounts, PayrollDiscountType.LOAN, 0);
    const advances = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.ADVANCE,
      0,
    );

    // ========================================================================
    // STEP 8: CALCULATE CUSTOM DEDUCTIONS
    // ========================================================================

    const customDeductions = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.CUSTOM,
      0,
    );

    // ========================================================================
    // STEP 9: TOTAL DEDUCTIONS
    // ========================================================================

    const totalDeductions = roundCurrency(
      inssAmount +
        irrfAmount +
        absenceAmount +
        lateArrivalAmount +
        mealVoucher +
        transportVoucher +
        healthInsurance +
        dentalInsurance +
        unionContribution +
        alimony +
        garnishment +
        loans +
        advances +
        customDeductions,
    );

    // ========================================================================
    // STEP 10: NET SALARY
    // ========================================================================

    const netSalary = roundCurrency(grossSalary - totalDeductions);

    // ========================================================================
    // STEP 11: EMPLOYER CONTRIBUTIONS (for tracking)
    // ========================================================================

    const fgtsResult = this.taxCalculator.calculateFGTS(grossSalary, isApprentice);
    const fgtsAmount = roundCurrency(fgtsResult.amount);
    const fgtsRate = fgtsResult.rate || 8.0;

    // ========================================================================
    // RETURN COMPLETE CALCULATION
    // ========================================================================

    return {
      employeeId,
      year,
      month,
      baseSalary: base,
      overtimeEarnings: {
        overtime50Hours,
        overtime50Amount,
        overtime100Hours,
        overtime100Amount,
        nightHours,
        nightDifferentialAmount,
      },
      dsrEarnings: {
        dsrOnOvertime,
        dsrOnCommissions,
        totalDSR,
        dsrDays,
      },
      bonusAmount: bonus,
      otherEarnings,
      grossSalary,
      taxDeductions: {
        inssBase,
        inssAmount,
        inssEffectiveRate,
        irrfBase,
        irrfAmount,
        irrfEffectiveRate,
      },
      absenceDeductions: {
        absenceHours,
        absenceDays,
        absenceAmount,
        lateArrivalMinutes: lateMinutes,
        lateArrivalAmount,
      },
      benefitDeductions: {
        mealVoucher,
        transportVoucher,
        healthInsurance,
        dentalInsurance,
      },
      legalDeductions: {
        unionContribution,
        alimony,
        garnishment,
      },
      loanDeductions: {
        loans,
        advances,
      },
      customDeductions,
      totalDeductions,
      netSalary,
      employerContributions: {
        fgtsAmount,
        fgtsRate,
      },
      secullumData,
      calculationDate: new Date(),
      workingDaysInMonth,
      workedDays,
      isLive: true,
    };
  }

  /**
   * ========================================================================
   * HELPER: GET DISCOUNT AMOUNT
   * ========================================================================
   */
  private getDiscountAmount(
    discounts: Array<{ type: PayrollDiscountType; value?: number; percentage?: number }>,
    type: PayrollDiscountType,
    defaultValue: number = 0,
    baseValueForPercentage?: number,
  ): number {
    const discount = discounts.find(d => d.type === type);
    if (!discount) return defaultValue;

    // If discount has a fixed value, use it
    if (discount.value && discount.value > 0) {
      return discount.value;
    }

    // If discount has a percentage and we have a base value, calculate it
    if (discount.percentage && discount.percentage > 0 && baseValueForPercentage) {
      return roundCurrency((baseValueForPercentage * discount.percentage) / 100);
    }

    return defaultValue;
  }
}
