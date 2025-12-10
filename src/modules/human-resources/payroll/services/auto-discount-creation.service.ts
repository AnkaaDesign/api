import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PayrollDiscountType, Prisma } from '@prisma/client';
import { CompletePayrollCalculation } from '../utils/complete-payroll-calculator.service';
import { roundCurrency } from '@utils/currency-precision.util';

/**
 * ============================================================================
 * AUTO-DISCOUNT CREATION SERVICE
 * ============================================================================
 * Automatically creates tax and legal discounts based on payroll calculations.
 * These discounts are auto-generated each month and linked to tax tables.
 *
 * Auto-created discounts:
 * - INSS (Progressive)
 * - IRRF (Progressive)
 * - FGTS (8% - tracked as employer contribution)
 * - Union contribution (March only, if authorized)
 * - Absences (hours-based)
 * - Late arrivals
 * ============================================================================
 */

export interface CreateAutoDiscountsParams {
  payrollId: string;
  employeeId: string;
  year: number;
  month: number;
  calculation: CompletePayrollCalculation;
  transaction?: Prisma.TransactionClient; // Optional transaction support
}

@Injectable()
export class AutoDiscountCreationService {
  private readonly logger = new Logger(AutoDiscountCreationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ========================================================================
   * CREATE ALL AUTO-DISCOUNTS FOR PAYROLL
   * ========================================================================
   * Creates all automatic discounts based on the complete payroll calculation.
   * Returns array of created discount IDs.
   */
  async createAutoDiscountsForPayroll(
    params: CreateAutoDiscountsParams,
  ): Promise<string[]> {
    const { payrollId, employeeId, year, month, calculation, transaction } = params;

    // Use transaction if provided, otherwise use regular prisma client
    const prisma = transaction || this.prisma;

    this.logger.log(
      `Creating auto-discounts for payroll ${payrollId} - ${year}/${month}`,
    );

    const createdDiscountIds: string[] = [];

    // ========================================================================
    // 1. INSS DISCOUNT
    // ========================================================================
    if (calculation.taxDeductions.inssAmount > 0) {
      const inssDiscount = await this.createINSSDiscount(prisma, {
        payrollId,
        employeeId,
        year,
        month,
        amount: calculation.taxDeductions.inssAmount,
        base: calculation.taxDeductions.inssBase,
        rate: calculation.taxDeductions.inssEffectiveRate,
        grossSalary: calculation.grossSalary,
      });
      createdDiscountIds.push(inssDiscount.id);
    }

    // ========================================================================
    // 2. IRRF DISCOUNT
    // ========================================================================
    if (calculation.taxDeductions.irrfAmount > 0) {
      const irrfDiscount = await this.createIRRFDiscount(prisma, {
        payrollId,
        employeeId,
        year,
        month,
        amount: calculation.taxDeductions.irrfAmount,
        base: calculation.taxDeductions.irrfBase,
        rate: calculation.taxDeductions.irrfEffectiveRate,
        grossSalary: calculation.grossSalary,
        inssAmount: calculation.taxDeductions.inssAmount,
      });
      createdDiscountIds.push(irrfDiscount.id);
    }

    // ========================================================================
    // 3. FGTS (Employer contribution - tracked for transparency)
    // ========================================================================
    if (calculation.employerContributions.fgtsAmount > 0) {
      const fgtsDiscount = await this.createFGTSDiscount(prisma, {
        payrollId,
        employeeId,
        year,
        month,
        amount: calculation.employerContributions.fgtsAmount,
        rate: calculation.employerContributions.fgtsRate,
        grossSalary: calculation.grossSalary,
      });
      createdDiscountIds.push(fgtsDiscount.id);
    }

    // ========================================================================
    // 4. UNION CONTRIBUTION (if applicable)
    // ========================================================================
    if (calculation.legalDeductions.unionContribution > 0) {
      const unionDiscount = await this.createUnionDiscount(prisma, {
        payrollId,
        employeeId,
        year,
        month,
        amount: calculation.legalDeductions.unionContribution,
        baseSalary: calculation.baseSalary,
      });
      createdDiscountIds.push(unionDiscount.id);
    }

    // ========================================================================
    // 5. ABSENCE DEDUCTION
    // ========================================================================
    if (calculation.absenceDeductions.absenceAmount > 0) {
      const absenceDiscount = await this.createAbsenceDiscount(prisma, {
        payrollId,
        employeeId,
        year,
        month,
        amount: calculation.absenceDeductions.absenceAmount,
        absenceHours: calculation.absenceDeductions.absenceHours,
        absenceDays: calculation.absenceDeductions.absenceDays,
      });
      createdDiscountIds.push(absenceDiscount.id);
    }

    // ========================================================================
    // 6. LATE ARRIVAL DEDUCTION
    // ========================================================================
    if (calculation.absenceDeductions.lateArrivalAmount > 0) {
      const lateDiscount = await this.createLateArrivalDiscount(prisma, {
        payrollId,
        employeeId,
        year,
        month,
        amount: calculation.absenceDeductions.lateArrivalAmount,
        lateMinutes: calculation.absenceDeductions.lateArrivalMinutes,
      });
      createdDiscountIds.push(lateDiscount.id);
    }

    this.logger.log(
      `Created ${createdDiscountIds.length} auto-discounts for payroll ${payrollId}`,
    );

    return createdDiscountIds;
  }

  /**
   * ========================================================================
   * CREATE INSS DISCOUNT
   * ========================================================================
   */
  private async createINSSDiscount(prisma: any, params: {
    payrollId: string;
    employeeId: string;
    year: number;
    month: number;
    amount: number;
    base: number;
    rate: number;
    grossSalary: number;
  }) {
    const { payrollId, year, amount, base } = params;

    // Get INSS tax table for the year
    const taxTable = await prisma.taxTable.findFirst({
      where: {
        taxType: 'INSS',
        year,
        isActive: true,
      },
    });

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.INSS,
        value: roundCurrency(amount),
        percentage: null, // Progressive, not a fixed percentage
        reference: 'I.N.S.S.',
        isPersistent: false,
        isActive: true,
        taxYear: year,
        taxTableId: taxTable?.id,
        baseValue: roundCurrency(base),
      },
    });
  }

  /**
   * ========================================================================
   * CREATE IRRF DISCOUNT
   * ========================================================================
   */
  private async createIRRFDiscount(prisma: any, params: {
    payrollId: string;
    employeeId: string;
    year: number;
    month: number;
    amount: number;
    base: number;
    rate: number;
    grossSalary: number;
    inssAmount: number;
  }) {
    const { payrollId, year, amount, base } = params;

    // Get IRRF tax table for the year
    const taxTable = await prisma.taxTable.findFirst({
      where: {
        taxType: 'IRRF',
        year,
        isActive: true,
      },
    });

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.IRRF,
        value: roundCurrency(amount),
        percentage: null, // Progressive, not a fixed percentage
        reference: 'I.R.R.F.',
        isPersistent: false,
        isActive: true,
        taxYear: year,
        taxTableId: taxTable?.id,
        baseValue: roundCurrency(base),
      },
    });
  }

  /**
   * ========================================================================
   * CREATE FGTS DISCOUNT (Employer contribution - tracked)
   * ========================================================================
   */
  private async createFGTSDiscount(prisma: any, params: {
    payrollId: string;
    employeeId: string;
    year: number;
    month: number;
    amount: number;
    rate: number;
    grossSalary: number;
  }) {
    const { payrollId, year, amount, rate, grossSalary } = params;

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.FGTS,
        value: roundCurrency(amount),
        percentage: rate,
        reference: 'FGTS (Empregador)',
        isPersistent: false,
        isActive: true,
        taxYear: year,
        baseValue: roundCurrency(grossSalary),
      },
    });
  }

  /**
   * ========================================================================
   * CREATE UNION DISCOUNT
   * ========================================================================
   */
  private async createUnionDiscount(prisma: any, params: {
    payrollId: string;
    employeeId: string;
    year: number;
    month: number;
    amount: number;
    baseSalary: number;
  }) {
    const { payrollId, year, amount, baseSalary } = params;

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.UNION,
        value: roundCurrency(amount),
        percentage: null,
        reference: 'Contribuição Sindical',
        isPersistent: false,
        isActive: true,
        baseValue: roundCurrency(baseSalary),
        taxYear: year,
      },
    });
  }

  /**
   * ========================================================================
   * CREATE ABSENCE DISCOUNT
   * ========================================================================
   */
  private async createAbsenceDiscount(prisma: any, params: {
    payrollId: string;
    employeeId: string;
    year: number;
    month: number;
    amount: number;
    absenceHours: number;
    absenceDays: number;
  }) {
    const { payrollId, amount, absenceHours } = params;

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.ABSENCE,
        value: roundCurrency(amount),
        percentage: null,
        reference: 'Faltas',
        isPersistent: false,
        isActive: true,
        baseValue: absenceHours, // Store hours for display formatting
      },
    });
  }

  /**
   * ========================================================================
   * CREATE LATE ARRIVAL DISCOUNT
   * ========================================================================
   */
  private async createLateArrivalDiscount(prisma: any, params: {
    payrollId: string;
    employeeId: string;
    year: number;
    month: number;
    amount: number;
    lateMinutes: number;
  }) {
    const { payrollId, amount, lateMinutes } = params;

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.LATE_ARRIVAL,
        value: roundCurrency(amount),
        percentage: null,
        reference: 'Atrasos',
        isPersistent: false,
        isActive: true,
        baseValue: lateMinutes / 60, // Store as decimal hours for consistent formatting
      },
    });
  }

  /**
   * ========================================================================
   * DELETE AUTO-GENERATED DISCOUNTS
   * ========================================================================
   * Deletes all auto-generated discounts for a payroll.
   * Auto-generated discounts are: INSS, IRRF, FGTS, ABSENCE, LATE_ARRIVAL, UNION
   * Useful when recalculating payroll.
   */
  async deleteAutoGeneratedDiscounts(payrollId: string): Promise<number> {
    // These are the discount types that are auto-calculated each month
    const autoGeneratedTypes = [
      PayrollDiscountType.INSS,
      PayrollDiscountType.IRRF,
      PayrollDiscountType.FGTS,
      PayrollDiscountType.ABSENCE,
      PayrollDiscountType.LATE_ARRIVAL,
      PayrollDiscountType.UNION,
      PayrollDiscountType.PARTIAL_ABSENCE,
      PayrollDiscountType.DSR_ABSENCE,
    ];

    const result = await this.prisma.payrollDiscount.deleteMany({
      where: {
        payrollId,
        discountType: { in: autoGeneratedTypes },
        isPersistent: false, // Only delete non-persistent discounts
      },
    });

    this.logger.log(
      `Deleted ${result.count} auto-generated discounts for payroll ${payrollId}`,
    );

    return result.count;
  }

  /**
   * ========================================================================
   * GENERATE AUTO-DISCOUNT OBJECTS FOR LIVE CALCULATION
   * ========================================================================
   * Creates discount objects (not database records) for live payroll display.
   * Returns array of discount objects that match the structure expected by frontend.
   */
  async generateAutoDiscountObjectsForLivePayroll(
    params: Omit<CreateAutoDiscountsParams, 'payrollId' | 'transaction'>,
  ): Promise<Array<{
    id: string;
    discountType: PayrollDiscountType;
    value: number | null;
    percentage: number | null;
    reference: string;
    isPersistent: boolean;
    isActive: boolean;
    taxYear?: number;
    taxTableId?: string | null;
    baseValue?: number | null;
  }>> {
    const { employeeId, year, month, calculation } = params;

    this.logger.log(
      `Generating auto-discount objects for live payroll - ${year}/${month}`,
    );

    const discountObjects: Array<{
      id: string;
      discountType: PayrollDiscountType;
      value: number | null;
      percentage: number | null;
      reference: string;
      isPersistent: boolean;
      isActive: boolean;
      taxYear?: number;
      taxTableId?: string | null;
      baseValue?: number | null;
    }> = [];

    // ========================================================================
    // 1. INSS DISCOUNT
    // ========================================================================
    if (calculation.taxDeductions.inssAmount > 0) {
      const taxTable = await this.prisma.taxTable.findFirst({
        where: {
          taxType: 'INSS',
          year,
          isActive: true,
        },
      });

      // Calculate effective rate for display (same as seed script)
      const inssEffectiveRate = calculation.taxDeductions.inssBase > 0
        ? roundCurrency((calculation.taxDeductions.inssAmount / calculation.taxDeductions.inssBase) * 100)
        : null;

      discountObjects.push({
        id: `live-inss-${employeeId}-${year}-${month}`,
        discountType: PayrollDiscountType.INSS,
        value: roundCurrency(calculation.taxDeductions.inssAmount),
        percentage: inssEffectiveRate, // Effective rate for display
        reference: 'INSS',
        isPersistent: false,
        isActive: true,
        taxYear: year,
        taxTableId: taxTable?.id || null,
        baseValue: roundCurrency(calculation.taxDeductions.inssBase),
      });
    }

    // ========================================================================
    // 2. IRRF DISCOUNT
    // ========================================================================
    if (calculation.taxDeductions.irrfAmount > 0) {
      const taxTable = await this.prisma.taxTable.findFirst({
        where: {
          taxType: 'IRRF',
          year,
          isActive: true,
        },
      });

      // Calculate effective rate for display (same as seed script)
      const irrfEffectiveRate = calculation.taxDeductions.irrfBase > 0
        ? roundCurrency((calculation.taxDeductions.irrfAmount / calculation.taxDeductions.irrfBase) * 100)
        : null;

      discountObjects.push({
        id: `live-irrf-${employeeId}-${year}-${month}`,
        discountType: PayrollDiscountType.IRRF,
        value: roundCurrency(calculation.taxDeductions.irrfAmount),
        percentage: irrfEffectiveRate, // Effective rate for display
        reference: 'I.R.R.F.',
        isPersistent: false,
        isActive: true,
        taxYear: year,
        taxTableId: taxTable?.id || null,
        baseValue: roundCurrency(calculation.taxDeductions.irrfBase),
      });
    }

    // ========================================================================
    // 3. FGTS - NOT included in discounts for live calculation
    // ========================================================================
    // FGTS is an employer contribution, not deducted from employee salary.
    // It's already included in the payroll response via employerContributions.fgtsAmount
    // so we don't add it to the discounts array to avoid duplicate display.

    // ========================================================================
    // 4. UNION CONTRIBUTION
    // ========================================================================
    if (calculation.legalDeductions.unionContribution > 0) {
      discountObjects.push({
        id: `live-union-${employeeId}-${year}-${month}`,
        discountType: PayrollDiscountType.UNION,
        value: roundCurrency(calculation.legalDeductions.unionContribution),
        percentage: null,
        reference: 'Contribuição Sindical',
        isPersistent: false,
        isActive: true,
        baseValue: roundCurrency(calculation.baseSalary),
        taxYear: year,
      });
    }

    // ========================================================================
    // 5. ABSENCE DEDUCTION
    // ========================================================================
    if (calculation.absenceDeductions.absenceAmount > 0) {
      discountObjects.push({
        id: `live-absence-${employeeId}-${year}-${month}`,
        discountType: PayrollDiscountType.ABSENCE,
        value: roundCurrency(calculation.absenceDeductions.absenceAmount),
        percentage: null,
        reference: 'Faltas',
        isPersistent: false,
        isActive: true,
        baseValue: calculation.absenceDeductions.absenceHours, // Store hours for display formatting
      });
    }

    // ========================================================================
    // 6. LATE ARRIVAL DEDUCTION
    // ========================================================================
    if (calculation.absenceDeductions.lateArrivalAmount > 0) {
      discountObjects.push({
        id: `live-late-${employeeId}-${year}-${month}`,
        discountType: PayrollDiscountType.LATE_ARRIVAL,
        value: roundCurrency(calculation.absenceDeductions.lateArrivalAmount),
        percentage: null,
        reference: 'Atrasos',
        isPersistent: false,
        isActive: true,
        baseValue: calculation.absenceDeductions.lateArrivalMinutes / 60, // Store as decimal hours for consistent formatting
      });
    }

    this.logger.log(
      `Generated ${discountObjects.length} auto-discount objects for live payroll`,
    );

    return discountObjects;
  }
}
