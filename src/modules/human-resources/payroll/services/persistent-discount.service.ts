import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PayrollDiscountType, Prisma } from '@prisma/client';
import { roundCurrency } from '@utils/currency-precision.util';

/**
 * ============================================================================
 * PERSISTENT DISCOUNT SERVICE
 * ============================================================================
 * Manages recurring discounts that persist month-to-month:
 * - Alimony (court-ordered)
 * - Health insurance
 * - Dental insurance
 * - Meal vouchers
 * - Transport vouchers
 * - Loans (installments)
 * - Advances (repayment)
 * - Garnishments (judicial)
 * - Custom recurring deductions
 *
 * Persistent discounts are copied from the previous month's payroll
 * or from a master list of active persistent discounts for the employee.
 * ============================================================================
 */

export interface PersistentDiscountTemplate {
  type: PayrollDiscountType;
  value?: number;
  percentage?: number;
  reference: string;
  expirationDate?: Date;
}

@Injectable()
export class PersistentDiscountService {
  private readonly logger = new Logger(PersistentDiscountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ========================================================================
   * COPY PERSISTENT DISCOUNTS FROM PREVIOUS MONTH
   * ========================================================================
   * Copies all active persistent discounts from the previous month's payroll
   * to the new payroll. Returns array of created discount IDs.
   */
  async copyPersistentDiscountsFromPreviousMonth(params: {
    employeeId: string;
    newPayrollId: string;
    currentYear: number;
    currentMonth: number;
  }): Promise<string[]> {
    const { employeeId, newPayrollId, currentYear, currentMonth } = params;

    this.logger.log(
      `Copying persistent discounts for employee ${employeeId} - ${currentYear}/${currentMonth}`,
    );

    // Get previous month
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;

    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = currentYear - 1;
    }

    // Find previous month's payroll
    const previousPayroll = await this.prisma.payroll.findFirst({
      where: {
        userId: employeeId,
        year: prevYear,
        month: prevMonth,
      },
      include: {
        discounts: {
          where: {
            isPersistent: true,
            isActive: true,
          },
        },
      },
    });

    if (!previousPayroll || previousPayroll.discounts.length === 0) {
      this.logger.log(
        `No persistent discounts found for previous month (${prevYear}/${prevMonth})`,
      );
      return [];
    }

    const createdDiscountIds: string[] = [];
    const currentDate = new Date();

    // Copy each persistent discount
    for (const discount of previousPayroll.discounts) {
      // Check if discount has expired
      if (discount.expirationDate && discount.expirationDate < currentDate) {
        this.logger.log(`Skipping expired persistent discount: ${discount.reference}`);
        continue;
      }

      // Copy persistent discount
      const copiedDiscount = await this.copyDiscountToNewPayroll({
        originalDiscount: discount,
        newPayrollId,
        currentMonth,
        currentYear,
      });

      createdDiscountIds.push(copiedDiscount.id);
    }

    this.logger.log(
      `Copied ${createdDiscountIds.length} persistent discounts to new payroll ${newPayrollId}`,
    );

    return createdDiscountIds;
  }

  /**
   * ========================================================================
   * COPY DISCOUNT TO NEW PAYROLL
   * ========================================================================
   */
  private async copyDiscountToNewPayroll(params: {
    originalDiscount: any;
    newPayrollId: string;
    currentMonth: number;
    currentYear: number;
    overrides?: Partial<Prisma.PayrollDiscountCreateInput>;
  }) {
    const { originalDiscount, newPayrollId, overrides } = params;

    return this.prisma.payrollDiscount.create({
      data: {
        payrollId: newPayrollId,
        discountType: originalDiscount.discountType,
        value: originalDiscount.value,
        percentage: originalDiscount.percentage,
        reference: overrides?.reference || originalDiscount.reference,
        isPersistent: true,
        isActive: true,
        expirationDate: originalDiscount.expirationDate,
        baseValue: originalDiscount.baseValue,
      },
    });
  }

  /**
   * ========================================================================
   * CREATE PERSISTENT DISCOUNT TEMPLATE
   * ========================================================================
   * Creates a new persistent discount that will be copied to future payrolls.
   * This is used when HR adds a new recurring deduction (like health insurance).
   */
  async createPersistentDiscountTemplate(params: {
    employeeId: string;
    payrollId: string;
    template: PersistentDiscountTemplate;
  }) {
    const { employeeId, payrollId, template } = params;

    this.logger.log(
      `Creating persistent discount template for employee ${employeeId}: ${template.type}`,
    );

    // Validate that either value or percentage is provided
    if (!template.value && !template.percentage) {
      throw new Error('Either value or percentage must be provided for persistent discount');
    }

    const discount = await this.prisma.payrollDiscount.create({
      data: {
        payrollId,
        discountType: template.type,
        value: template.value ? roundCurrency(template.value) : null,
        percentage: template.percentage,
        reference: template.reference,
        isPersistent: true,
        isActive: true,
        expirationDate: template.expirationDate,
      },
    });

    this.logger.log(`Created persistent discount: ${discount.id}`);

    return discount;
  }

  /**
   * ========================================================================
   * UPDATE PERSISTENT DISCOUNT
   * ========================================================================
   * Updates a persistent discount.
   */
  async updatePersistentDiscount(params: {
    discountId: string;
    updates: Partial<PersistentDiscountTemplate>;
  }) {
    const { discountId, updates } = params;

    this.logger.log(`Updating persistent discount ${discountId}`);

    const discount = await this.prisma.payrollDiscount.update({
      where: { id: discountId },
      data: {
        value: updates.value ? roundCurrency(updates.value) : undefined,
        percentage: updates.percentage,
        reference: updates.reference,
        expirationDate: updates.expirationDate,
      },
    });

    return discount;
  }

  /**
   * ========================================================================
   * DEACTIVATE PERSISTENT DISCOUNT
   * ========================================================================
   * Deactivates a persistent discount so it won't be copied to future months.
   */
  async deactivatePersistentDiscount(discountId: string) {
    this.logger.log(`Deactivating persistent discount ${discountId}`);

    return this.prisma.payrollDiscount.update({
      where: { id: discountId },
      data: {
        isActive: false,
        expirationDate: new Date(), // Set expiration to now
      },
    });
  }

  /**
   * ========================================================================
   * GET ACTIVE PERSISTENT DISCOUNTS
   * ========================================================================
   * Gets all active persistent discounts for an employee.
   */
  async getActivePersistentDiscounts(employeeId: string) {
    return this.prisma.payrollDiscount.findMany({
      where: {
        payroll: {
          userId: employeeId,
        },
        isPersistent: true,
        isActive: true,
        OR: [{ expirationDate: null }, { expirationDate: { gt: new Date() } }],
      },
      orderBy: {
        discountType: 'asc',
      },
    });
  }

  /**
   * ========================================================================
   * GET PERSISTENT DISCOUNTS FOR LIVE CALCULATION
   * ========================================================================
   * Gets persistent discounts from the previous month for live payroll.
   * Returns discount objects (not database records) for display.
   */
  async getPersistentDiscountsForLivePayroll(params: {
    employeeId: string;
    currentYear: number;
    currentMonth: number;
  }): Promise<
    Array<{
      id: string;
      discountType: PayrollDiscountType;
      value: number | null;
      percentage: number | null;
      reference: string;
      isPersistent: boolean;
      isActive: boolean;
      expirationDate?: Date | null;
      baseValue?: number | null;
    }>
  > {
    const { employeeId, currentYear, currentMonth } = params;

    this.logger.log(
      `Getting persistent discounts for live payroll - ${employeeId} - ${currentYear}/${currentMonth}`,
    );

    // Get previous month
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;

    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = currentYear - 1;
    }

    // Find previous month's payroll
    const previousPayroll = await this.prisma.payroll.findFirst({
      where: {
        userId: employeeId,
        year: prevYear,
        month: prevMonth,
      },
      include: {
        discounts: {
          where: {
            isPersistent: true,
            isActive: true,
          },
        },
      },
    });

    if (!previousPayroll || previousPayroll.discounts.length === 0) {
      this.logger.log(
        `No persistent discounts found for previous month (${prevYear}/${prevMonth})`,
      );
      return [];
    }

    const currentDate = new Date();
    const liveDiscounts: Array<{
      id: string;
      discountType: PayrollDiscountType;
      value: number | null;
      percentage: number | null;
      reference: string;
      isPersistent: boolean;
      isActive: boolean;
      expirationDate?: Date | null;
      baseValue?: number | null;
    }> = [];

    // Convert database discounts to discount objects
    for (const discount of previousPayroll.discounts) {
      // Check if discount has expired
      if (discount.expirationDate && discount.expirationDate < currentDate) {
        this.logger.log(`Skipping expired persistent discount: ${discount.reference}`);
        continue;
      }

      // Clean up reference - remove value from reference if it's duplicated there
      // e.g., "Empréstimo Funcionário - Crédito Trabalhador R$ 569,30" -> "Empréstimo Funcionário"
      let cleanReference = discount.reference;
      if (discount.discountType === 'LOAN' || discount.discountType === 'ADVANCE') {
        // Remove " - Crédito Trabalhador R$ XXX,XX" pattern
        cleanReference = cleanReference.replace(/ - Crédito Trabalhador R\$ [\d.,]+/gi, '');
        // Remove any trailing " - Total: R$ XXX,XX (Xx)" pattern
        cleanReference = cleanReference.replace(/ - Total: R\$ [\d.,]+ \(\d+x\)/gi, '');
      }

      liveDiscounts.push({
        id: `live-${discount.discountType}-${employeeId}-${currentYear}-${currentMonth}`,
        discountType: discount.discountType,
        value: discount.value ? Number(discount.value) : null,
        percentage: discount.percentage ? Number(discount.percentage) : null,
        reference: cleanReference,
        isPersistent: true,
        isActive: true,
        expirationDate: discount.expirationDate,
        baseValue: discount.baseValue ? Number(discount.baseValue) : null,
      });
    }

    this.logger.log(`Found ${liveDiscounts.length} persistent discounts for live payroll`);

    return liveDiscounts;
  }

  /**
   * ========================================================================
   * CREATE LOAN DISCOUNT
   * ========================================================================
   * Creates a loan discount with installment tracking.
   */
  async createLoanDiscount(params: {
    employeeId: string;
    payrollId: string;
    totalAmount: number;
    installments: number;
    reference: string;
  }) {
    const { employeeId, payrollId, totalAmount, installments, reference } = params;

    const installmentAmount = roundCurrency(totalAmount / installments);

    return this.createPersistentDiscountTemplate({
      employeeId,
      payrollId,
      template: {
        type: PayrollDiscountType.LOAN,
        value: installmentAmount,
        reference: `${reference} - Total: R$ ${totalAmount.toFixed(2)} (${installments}x)`,
      },
    });
  }

  /**
   * ========================================================================
   * CREATE ALIMONY DISCOUNT
   * ========================================================================
   * Creates a court-ordered alimony discount.
   */
  async createAlimonyDiscount(params: {
    employeeId: string;
    payrollId: string;
    value?: number;
    percentage?: number;
    reference: string;
  }) {
    const { employeeId, payrollId, value, percentage, reference } = params;

    return this.createPersistentDiscountTemplate({
      employeeId,
      payrollId,
      template: {
        type: PayrollDiscountType.ALIMONY,
        value,
        percentage,
        reference,
      },
    });
  }

  /**
   * ========================================================================
   * CREATE HEALTH INSURANCE DISCOUNT
   * ========================================================================
   * Creates a health insurance discount.
   */
  async createHealthInsuranceDiscount(params: {
    employeeId: string;
    payrollId: string;
    value: number;
    reference: string;
  }) {
    const { employeeId, payrollId, value, reference } = params;

    return this.createPersistentDiscountTemplate({
      employeeId,
      payrollId,
      template: {
        type: PayrollDiscountType.HEALTH_INSURANCE,
        value,
        reference,
      },
    });
  }
}
