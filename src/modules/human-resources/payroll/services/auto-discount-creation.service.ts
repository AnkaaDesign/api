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
    const { payrollId, employeeId, year, month, amount, base, rate, grossSalary } = params;

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
        calculationOrder: 1, // INSS is always first
        isAutoGenerated: true,
        isPersistent: false,
        isActive: true,
        taxYear: year,
        taxTableId: taxTable?.id,
        baseValue: roundCurrency(base),
        calculationDetails: {
          taxType: 'INSS',
          calculationMethod: 'PROGRESSIVE',
          grossSalary: roundCurrency(grossSalary),
          taxableBase: roundCurrency(base),
          effectiveRate: rate,
          amount: roundCurrency(amount),
          year,
          month,
        },
        observations: `Desconto INSS ${year} (${rate.toFixed(2)}% efetivo sobre R$ ${base.toFixed(2)})`,
        legalBasis: 'Lei 8.212/91 - Contribuição Previdenciária',
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
    const { payrollId, employeeId, year, month, amount, base, rate, grossSalary, inssAmount } =
      params;

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
        calculationOrder: 2, // IRRF is after INSS
        isAutoGenerated: true,
        isPersistent: false,
        isActive: true,
        taxYear: year,
        taxTableId: taxTable?.id,
        baseValue: roundCurrency(base),
        calculationDetails: {
          taxType: 'IRRF',
          calculationMethod: 'PROGRESSIVE',
          grossSalary: roundCurrency(grossSalary),
          inssDeduction: roundCurrency(inssAmount),
          taxableBase: roundCurrency(base),
          effectiveRate: rate,
          amount: roundCurrency(amount),
          year,
          month,
        },
        observations: `Imposto de Renda ${year} (${rate.toFixed(2)}% efetivo sobre R$ ${base.toFixed(2)})`,
        legalBasis: 'Lei 7.713/88 - Imposto de Renda Retido na Fonte',
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
    const { payrollId, employeeId, year, month, amount, rate, grossSalary } = params;

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.FGTS,
        value: roundCurrency(amount),
        percentage: rate,
        reference: 'FGTS (Empregador)',
        calculationOrder: 10, // FGTS doesn't affect net salary (employer-paid)
        isAutoGenerated: true,
        isPersistent: false,
        isActive: true,
        taxYear: year,
        baseValue: roundCurrency(grossSalary),
        calculationDetails: {
          taxType: 'FGTS',
          rate,
          grossSalary: roundCurrency(grossSalary),
          amount: roundCurrency(amount),
          paidByEmployer: true,
          year,
          month,
        },
        observations: `FGTS ${rate}% - Depósito em conta vinculada (pago pelo empregador, não deduzido do salário)`,
        legalBasis: 'Lei 8.036/90 - Fundo de Garantia do Tempo de Serviço',
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
    const { payrollId, employeeId, year, month, amount, baseSalary } = params;

    // Get employee authorization date
    const employee = await prisma.user.findUnique({
      where: { id: employeeId },
      select: { unionAuthorizationDate: true },
    });

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.UNION,
        value: roundCurrency(amount),
        percentage: null,
        reference: 'Contribuição Sindical',
        calculationOrder: 5,
        isAutoGenerated: true,
        isPersistent: false,
        isActive: true,
        requiresAuthorization: true,
        employeeAuthorizationDate: employee?.unionAuthorizationDate,
        baseValue: roundCurrency(baseSalary),
        calculationDetails: {
          baseSalary: roundCurrency(baseSalary),
          amount: roundCurrency(amount),
          month,
          year,
        },
        observations: `Contribuição sindical mensal (março/${year}) - Autorizada pelo empregado`,
        legalBasis: 'CLT Art. 578 - Contribuição Sindical (facultativa)',
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
    const { payrollId, employeeId, year, month, amount, absenceHours, absenceDays } = params;

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.ABSENCE,
        value: roundCurrency(amount),
        percentage: null,
        reference: 'Faltas',
        calculationOrder: 3,
        isAutoGenerated: true,
        isPersistent: false,
        isActive: true,
        calculationDetails: {
          absenceHours,
          absenceDays,
          amount: roundCurrency(amount),
          month,
          year,
        },
        observations: `Desconto de ${absenceHours.toFixed(2)} horas (${absenceDays} dia${absenceDays !== 1 ? 's' : ''}) de faltas injustificadas`,
        legalBasis: 'CLT Art. 130 - Desconto proporcional às faltas',
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
    const { payrollId, employeeId, year, month, amount, lateMinutes } = params;

    return prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: PayrollDiscountType.LATE_ARRIVAL,
        value: roundCurrency(amount),
        percentage: null,
        reference: 'Atrasos',
        calculationOrder: 4,
        isAutoGenerated: true,
        isPersistent: false,
        isActive: true,
        calculationDetails: {
          lateMinutes,
          amount: roundCurrency(amount),
          month,
          year,
        },
        observations: `Desconto de ${lateMinutes} minutos de atrasos`,
        legalBasis: 'CLT Art. 58 - Desconto proporcional aos atrasos',
      },
    });
  }

  /**
   * ========================================================================
   * DELETE AUTO-GENERATED DISCOUNTS
   * ========================================================================
   * Deletes all auto-generated discounts for a payroll.
   * Useful when recalculating payroll.
   */
  async deleteAutoGeneratedDiscounts(payrollId: string): Promise<number> {
    const result = await this.prisma.payrollDiscount.deleteMany({
      where: {
        payrollId,
        isAutoGenerated: true,
      },
    });

    this.logger.log(
      `Deleted ${result.count} auto-generated discounts for payroll ${payrollId}`,
    );

    return result.count;
  }
}
