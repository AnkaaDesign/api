// payroll-calculator.ts
// Comprehensive payroll calculation utility - Single source of truth for all payroll calculations

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ExactBonusCalculationService } from '../../bonus/exact-bonus-calculation.service';
import {
  USER_STATUS,
  TASK_STATUS,
  COMMISSION_STATUS,
  BONUS_STATUS,
  ACTIVE_USER_STATUSES,
} from '../../../../constants';
import type { Position, MonetaryValue, User, Payroll, Discount } from '../../../../types';
import { roundAverage, roundCurrency } from '../../../../utils/currency-precision.util';

/**
 * PayrollPeriod represents the date range for a payroll calculation period
 * Ankaa uses 26th to 25th monthly cycles for payroll calculations
 */
export interface PayrollPeriod {
  startDate: Date;
  endDate: Date;
  year: number;
  month: number;
  displayPeriod: string; // e.g., "26/09/2024 - 25/10/2024"
}

/**
 * PayrollCalculationData represents the input data needed for payroll calculations
 */
export interface PayrollCalculationData {
  user: User & {
    position?: Position & {
      remunerations?: MonetaryValue[];
    };
  };
  payroll?: Payroll & {
    discounts?: Discount[];
  };
  period: PayrollPeriod;
  bonusValue?: number;
  absenceDays?: number;
  additionalDeductions?: number;
}

/**
 * PayrollCalculationResult represents the complete payroll calculation breakdown
 */
export interface PayrollCalculationResult {
  // Basic salary components
  baseSalary: number;
  bonusValue: number;
  grossSalary: number;

  // Deductions breakdown
  totalDeductions: number;
  deductionBreakdown: Array<{
    reference: string;
    type: 'percentage' | 'fixed' | 'absence' | 'additional';
    value: number;
    amount: number;
    calculationOrder: number;
  }>;

  // Final calculation
  netSalary: number;

  // Additional information
  absenceDays: number;
  absenceDeduction: number;
  workingDaysInMonth: number;
  effectiveWorkingDays: number;

  // Meta information
  period: PayrollPeriod;
  calculatedAt: Date;
  isLive: boolean; // Whether this is a live calculation or saved data
}

/**
 * LivePayrollData represents a complete live payroll calculation when no record exists
 */
export interface LivePayrollData {
  id: string; // Temporary ID in format "live-{userId}-{year}-{month}"
  userId: string;
  year: number;
  month: number;
  period: PayrollPeriod;
  user: User;
  calculation: PayrollCalculationResult;
  bonus?: {
    id: string;
    baseBonus: number;
    performanceLevel: number;
    weightedTaskCount: number;
    taskCount: number;
    isLive: boolean;
  };
}

@Injectable()
export class PayrollCalculatorService {
  private readonly logger = new Logger(PayrollCalculatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exactBonusCalculationService: ExactBonusCalculationService,
  ) {}

  /**
   * Calculate payroll period dates for given month/year
   * Ankaa uses 26th to 25th monthly cycles
   *
   * @param month - Month (1-12)
   * @param year - Year (e.g., 2024)
   * @returns PayrollPeriod with start/end dates and display format
   */
  calculatePayrollPeriod(month: number, year: number): PayrollPeriod {
    if (month < 1 || month > 12) {
      throw new Error('Month must be between 1 and 12');
    }
    if (year < 2020 || year > 2100) {
      throw new Error('Year must be between 2020 and 2100');
    }

    // Start date: 26th of previous month
    let startDate: Date;
    if (month === 1) {
      // January: starts on December 26th of previous year
      startDate = new Date(year - 1, 11, 26, 0, 0, 0, 0);
    } else {
      // Other months: starts on 26th of previous month
      startDate = new Date(year, month - 2, 26, 0, 0, 0, 0);
    }

    // End date: 25th of current month
    const endDate = new Date(year, month - 1, 25, 23, 59, 59, 999);

    // Display period in Brazilian format
    const formatDate = (date: Date): string => {
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    };

    const displayPeriod = `${formatDate(startDate)} - ${formatDate(endDate)}`;

    return {
      startDate,
      endDate,
      year,
      month,
      displayPeriod,
    };
  }

  /**
   * Calculate base salary from user's position
   * Gets the most recent remuneration value from the position
   *
   * @param position - Position with remunerations
   * @returns Base salary amount or 0 if no remuneration found
   */
  calculateBaseSalary(position?: Position & { remunerations?: MonetaryValue[] }): number {
    if (!position || !position.remunerations || position.remunerations.length === 0) {
      this.logger.warn('No position or remunerations found for base salary calculation');
      return 0;
    }

    // Get the most recent remuneration (sorted by createdAt desc)
    const latestRemuneration = position.remunerations.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    const baseSalary = latestRemuneration?.value || 0;

    this.logger.debug(`Calculated base salary: R$ ${baseSalary} for position: ${position.name}`);

    // CRITICAL: Use centralized rounding utility for consistency
    return roundCurrency(baseSalary);
  }

  /**
   * Calculate total deductions including absences and discounts
   * Applies discounts in order of calculationOrder
   *
   * @param baseSalary - Base salary amount
   * @param bonusValue - Bonus amount to include in gross calculation
   * @param absenceDays - Number of absence days
   * @param workingDaysInMonth - Total working days in the month
   * @param discounts - Array of discount records
   * @param additionalDeductions - Additional fixed deductions
   * @returns Object with total deductions and breakdown
   */
  calculateDeductions(
    baseSalary: number,
    bonusValue: number = 0,
    absenceDays: number = 0,
    workingDaysInMonth: number = 30,
    discounts: Discount[] = [],
    additionalDeductions: number = 0,
  ): {
    totalDeductions: number;
    absenceDeduction: number;
    deductionBreakdown: Array<{
      reference: string;
      type: 'percentage' | 'fixed' | 'absence' | 'additional';
      value: number;
      amount: number;
      calculationOrder: number;
    }>;
  } {
    const grossSalary = baseSalary + bonusValue;
    let remainingSalary = grossSalary;
    let totalDeductions = 0;
    const deductionBreakdown: Array<{
      reference: string;
      type: 'percentage' | 'fixed' | 'absence' | 'additional';
      value: number;
      amount: number;
      calculationOrder: number;
    }> = [];

    // 1. Calculate absence deduction first (based on base salary only)
    // CRITICAL: Use centralized rounding utility for consistency
    const absenceDeduction =
      absenceDays > 0 && workingDaysInMonth > 0
        ? roundCurrency((baseSalary / workingDaysInMonth) * absenceDays)
        : 0;

    if (absenceDeduction > 0) {
      totalDeductions = roundCurrency(totalDeductions + absenceDeduction);
      remainingSalary = roundCurrency(remainingSalary - absenceDeduction);
      deductionBreakdown.push({
        reference: 'Faltas',
        type: 'absence',
        value: absenceDays,
        amount: absenceDeduction,
        calculationOrder: 0,
      });
    }

    // 2. Apply discounts in the order received (sorted by createdAt from DB)
    const filteredDiscounts = discounts
      .filter(discount => discount.percentage !== null || discount.value !== null);

    for (let i = 0; i < filteredDiscounts.length; i++) {
      const discount = filteredDiscounts[i];
      let discountAmount = 0;

      if (discount.percentage !== null && discount.percentage > 0) {
        // Percentage discount applied to remaining salary
        // CRITICAL: Use centralized rounding utility for consistency
        discountAmount = roundCurrency(remainingSalary * (discount.percentage / 100));
        deductionBreakdown.push({
          reference: discount.reference,
          type: 'percentage',
          value: discount.percentage,
          amount: discountAmount,
          calculationOrder: i + 1,
        });
      } else if (discount.value !== null && discount.value > 0) {
        // Fixed value discount
        // CRITICAL: Use centralized rounding utility for consistency
        discountAmount = roundCurrency(Math.min(discount.value, remainingSalary)); // Don't exceed remaining salary
        deductionBreakdown.push({
          reference: discount.reference,
          type: 'fixed',
          value: discount.value,
          amount: discountAmount,
          calculationOrder: i + 1,
        });
      }

      totalDeductions = roundCurrency(totalDeductions + discountAmount);
      remainingSalary = roundCurrency(remainingSalary - discountAmount);

      // Stop if salary reaches zero
      if (remainingSalary <= 0) {
        remainingSalary = 0;
        break;
      }
    }

    // 3. Apply additional deductions
    if (additionalDeductions > 0) {
      // CRITICAL: Use centralized rounding utility for consistency
      const additionalAmount = roundCurrency(Math.min(additionalDeductions, remainingSalary));
      totalDeductions = roundCurrency(totalDeductions + additionalAmount);
      deductionBreakdown.push({
        reference: 'Deduções Adicionais',
        type: 'additional',
        value: additionalDeductions,
        amount: additionalAmount,
        calculationOrder: 999,
      });
    }

    this.logger.debug(
      `Calculated total deductions: R$ ${totalDeductions} (${deductionBreakdown.length} items)`,
    );

    return {
      totalDeductions: roundCurrency(totalDeductions),
      absenceDeduction,
      deductionBreakdown,
    };
  }

  /**
   * Calculate final net salary after all deductions
   *
   * @param baseSalary - Base salary amount
   * @param bonusValue - Bonus amount
   * @param totalDeductions - Total deductions amount
   * @returns Net salary (never below 0)
   */
  calculateNetSalary(baseSalary: number, bonusValue: number, totalDeductions: number): number {
    const grossSalary = baseSalary + bonusValue;
    const netSalary = Math.max(0, grossSalary - totalDeductions);

    this.logger.debug(
      `Net salary calculation: R$ ${baseSalary} + R$ ${bonusValue} - R$ ${totalDeductions} = R$ ${netSalary}`,
    );

    // CRITICAL: Use centralized rounding utility for consistency
    return roundCurrency(netSalary);
  }

  /**
   * Calculate working days in a month (excluding weekends)
   *
   * @param year - Year
   * @param month - Month (1-12)
   * @returns Number of working days (Monday-Friday)
   */
  calculateWorkingDaysInMonth(year: number, month: number): number {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of the month

    let workingDays = 0;
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      // Monday = 1, Tuesday = 2, ..., Friday = 5
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        workingDays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return workingDays;
  }

  /**
   * Generate a complete live payroll calculation when no record exists
   * This creates a comprehensive payroll calculation including bonus data
   *
   * @param userId - User ID to generate payroll for
   * @param month - Month (1-12)
   * @param year - Year
   * @returns Complete live payroll data
   */
  async generateLivePayroll(userId: string, month: number, year: number): Promise<LivePayrollData> {
    try {
      this.logger.log(`Generating live payroll for user ${userId}, period ${month}/${year}`);

      // 1. Calculate period dates
      const period = this.calculatePayrollPeriod(month, year);

      // 2. Get user with position and remuneration data
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          position: {
            include: {
              remunerations: {
                orderBy: { createdAt: 'desc' },
                take: 1, // Get only the latest remuneration
              },
            },
          },
          sector: true,
        },
      });

      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      if (!ACTIVE_USER_STATUSES.includes(user.status as any)) {
        throw new Error(`User is not active: ${userId}`);
      }

      // 3. Calculate base salary
      const baseSalary = this.calculateBaseSalary(user.position);

      // 4. Calculate bonus for the period
      const bonusData = await this.calculateLiveBonusForPeriod(userId, year, month, period);

      // 5. Get working days for the month
      const workingDaysInMonth = this.calculateWorkingDaysInMonth(year, month);

      // 6. Calculate deductions (no existing discounts for live calculation)
      const deductionResult = this.calculateDeductions(
        baseSalary,
        bonusData.baseBonus,
        0, // No absence days for live calculation
        workingDaysInMonth,
        [], // No existing discounts
        0, // No additional deductions
      );

      // 7. Calculate net salary
      const netSalary = this.calculateNetSalary(
        baseSalary,
        bonusData.baseBonus,
        deductionResult.totalDeductions,
      );

      // 8. Build complete calculation result
      const calculation: PayrollCalculationResult = {
        baseSalary,
        bonusValue: bonusData.baseBonus,
        grossSalary: roundCurrency(baseSalary + bonusData.baseBonus),
        totalDeductions: deductionResult.totalDeductions,
        deductionBreakdown: deductionResult.deductionBreakdown,
        netSalary,
        absenceDays: 0,
        absenceDeduction: deductionResult.absenceDeduction,
        workingDaysInMonth,
        effectiveWorkingDays: workingDaysInMonth,
        period,
        calculatedAt: new Date(),
        isLive: true,
      };

      // 9. Build complete live payroll data
      const livePayrollData: LivePayrollData = {
        id: `live-${userId}-${year}-${month}`,
        userId,
        year,
        month,
        period,
        user: user as any,
        calculation,
        bonus: {
          id: bonusData.id,
          baseBonus: bonusData.baseBonus,
          performanceLevel: bonusData.performanceLevel,
          weightedTaskCount: bonusData.weightedTaskCount,
          taskCount: bonusData.taskCount,
          isLive: true,
        },
      };

      this.logger.log(
        `Generated live payroll for ${user.name}: ` +
          `Base R$ ${baseSalary}, Bonus R$ ${bonusData.baseBonus}, Net R$ ${netSalary}`,
      );

      return livePayrollData;
    } catch (error) {
      this.logger.error(`Error generating live payroll for user ${userId}:`, error);
      throw new Error(`Failed to generate live payroll: ${error.message}`);
    }
  }

  /**
   * Calculate live bonus data for a specific user and period
   * This replicates the bonus calculation logic from the existing service
   */
  private async calculateLiveBonusForPeriod(
    userId: string,
    year: number,
    month: number,
    period: PayrollPeriod,
  ): Promise<{
    id: string;
    baseBonus: number;
    performanceLevel: number;
    weightedTaskCount: number;
    taskCount: number;
  }> {
    try {
      // Get all completed tasks in the period
      const allTasks = await this.prisma.task.findMany({
        where: {
          status: TASK_STATUS.COMPLETED,
          finishedAt: {
            gte: period.startDate,
            lte: period.endDate,
          },
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
        },
      });

      // Get all eligible users for bonus calculation
      const eligibleUsers = await this.prisma.user.findMany({
        where: {
          status: { not: USER_STATUS.DISMISSED },
          performanceLevel: { gt: 0 },
          position: {
            bonifiable: true,
          },
        },
        select: {
          id: true,
          performanceLevel: true,
        },
      });

      // Calculate weighted task count
      const totalWeightedTasks = allTasks.reduce((sum, task) => {
        return sum + (task.commission === COMMISSION_STATUS.FULL_COMMISSION ? 1.0 : 0.5);
      }, 0);

      // Calculate average tasks per eligible user
      // CRITICAL: Use centralized rounding utility for consistency
      const averageTasksPerUser =
        eligibleUsers.length > 0 ? roundAverage(totalWeightedTasks / eligibleUsers.length) : 0;

      // Get current user's details
      const currentUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          performanceLevel: true,
          position: {
            select: {
              name: true,
              bonifiable: true,
            },
          },
        },
      });

      const performanceLevel = currentUser?.performanceLevel || 0;
      const positionName = currentUser?.position?.name || 'Pleno I';
      const isBonifiable = currentUser?.position?.bonifiable || false;

      // Calculate bonus using exact calculation service
      let bonusValue = 0;
      if (performanceLevel > 0 && isBonifiable && averageTasksPerUser > 0) {
        bonusValue = this.exactBonusCalculationService.calculateBonus(
          positionName,
          performanceLevel,
          averageTasksPerUser,
        );
      }

      return {
        id: `live-bonus-${userId}-${year}-${month}`,
        baseBonus: bonusValue,
        performanceLevel,
        weightedTaskCount: averageTasksPerUser,
        taskCount: allTasks.length,
      };
    } catch (error) {
      this.logger.error('Error calculating live bonus:', error);

      // Return minimal data on error
      return {
        id: `live-bonus-${userId}-${year}-${month}`,
        baseBonus: 0,
        performanceLevel: 0,
        weightedTaskCount: 0,
        taskCount: 0,
      };
    }
  }

  /**
   * Perform a complete payroll calculation with existing data
   *
   * @param data - PayrollCalculationData containing user, payroll, and period info
   * @returns Complete PayrollCalculationResult
   */
  async performCompleteCalculation(
    data: PayrollCalculationData,
  ): Promise<PayrollCalculationResult> {
    try {
      // Calculate base salary
      const baseSalary = this.calculateBaseSalary(data.user.position);

      // Use provided bonus or calculate live bonus
      let bonusValue = data.bonusValue || 0;
      if (bonusValue === 0 && !data.payroll) {
        const liveBonusData = await this.calculateLiveBonusForPeriod(
          data.user.id,
          data.period.year,
          data.period.month,
          data.period,
        );
        bonusValue = liveBonusData.baseBonus;
      }

      // Get working days
      const workingDaysInMonth = this.calculateWorkingDaysInMonth(
        data.period.year,
        data.period.month,
      );

      // Calculate effective working days (total - absences)
      const absenceDays = data.absenceDays || 0;
      const effectiveWorkingDays = Math.max(0, workingDaysInMonth - absenceDays);

      // Calculate deductions
      const deductionResult = this.calculateDeductions(
        baseSalary,
        bonusValue,
        absenceDays,
        workingDaysInMonth,
        data.payroll?.discounts || [],
        data.additionalDeductions || 0,
      );

      // Calculate net salary
      const netSalary = this.calculateNetSalary(
        baseSalary,
        bonusValue,
        deductionResult.totalDeductions,
      );

      return {
        baseSalary,
        bonusValue,
        grossSalary: roundCurrency(baseSalary + bonusValue),
        totalDeductions: deductionResult.totalDeductions,
        deductionBreakdown: deductionResult.deductionBreakdown,
        netSalary,
        absenceDays,
        absenceDeduction: deductionResult.absenceDeduction,
        workingDaysInMonth,
        effectiveWorkingDays,
        period: data.period,
        calculatedAt: new Date(),
        isLive: !data.payroll, // Live if no saved payroll exists
      };
    } catch (error) {
      this.logger.error('Error performing complete payroll calculation:', error);
      throw new Error(`Payroll calculation failed: ${error.message}`);
    }
  }

  /**
   * Validate payroll calculation inputs
   *
   * @param userId - User ID
   * @param month - Month (1-12)
   * @param year - Year
   * @returns void (throws error if validation fails)
   */
  private validateInputs(userId: string, month: number, year: number): void {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Valid user ID is required');
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error('Month must be an integer between 1 and 12');
    }

    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error('Year must be an integer between 2020 and 2100');
    }
  }

  /**
   * Get a formatted summary of payroll calculation
   *
   * @param calculation - PayrollCalculationResult
   * @returns Formatted string summary
   */
  getCalculationSummary(calculation: PayrollCalculationResult): string {
    const formatCurrency = (value: number): string => {
      return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
    };

    return [
      `=== RESUMO DA FOLHA DE PAGAMENTO ===`,
      `Período: ${calculation.period.displayPeriod}`,
      ``,
      `SALÁRIO BASE: ${formatCurrency(calculation.baseSalary)}`,
      `BONIFICAÇÃO: ${formatCurrency(calculation.bonusValue)}`,
      `SALÁRIO BRUTO: ${formatCurrency(calculation.grossSalary)}`,
      ``,
      `DEDUÇÕES:`,
      ...calculation.deductionBreakdown.map(
        deduction => `  ${deduction.reference}: ${formatCurrency(deduction.amount)}`,
      ),
      `TOTAL DEDUÇÕES: ${formatCurrency(calculation.totalDeductions)}`,
      ``,
      `SALÁRIO LÍQUIDO: ${formatCurrency(calculation.netSalary)}`,
      ``,
      `Dias úteis no mês: ${calculation.workingDaysInMonth}`,
      `Dias efetivos trabalhados: ${calculation.effectiveWorkingDays}`,
      `Calculado em: ${calculation.calculatedAt.toLocaleString('pt-BR')}`,
      `Tipo: ${calculation.isLive ? 'Cálculo em tempo real' : 'Dados salvos'}`,
    ].join('\n');
  }
}
