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
  requiresAuthorization?: boolean;
  authorizationDate?: Date;
  expirationDate?: Date;
  observations?: string;
  legalBasis?: string;
  installments?: number; // For loans
  currentInstallment?: number; // For loans
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
        this.logger.log(
          `Skipping expired persistent discount: ${discount.reference}`,
        );
        continue;
      }

      // Handle loan installments
      if (discount.discountType === PayrollDiscountType.LOAN) {
        const details = discount.calculationDetails as any;
        const currentInstallment = (details?.currentInstallment || 0) + 1;
        const totalInstallments = details?.totalInstallments || 1;

        // Check if loan is paid off
        if (currentInstallment > totalInstallments) {
          this.logger.log(
            `Loan fully paid: ${discount.reference} (${totalInstallments} installments)`,
          );
          continue;
        }

        // Copy loan with updated installment number
        const copiedDiscount = await this.copyDiscountToNewPayroll({
          originalDiscount: discount,
          newPayrollId,
          currentMonth,
          currentYear,
          overrides: {
            calculationDetails: {
              ...details,
              currentInstallment,
              totalInstallments,
            },
            reference: `${discount.reference} - Parcela ${currentInstallment}/${totalInstallments}`,
            observations: `Parcela ${currentInstallment} de ${totalInstallments} - ${discount.observations || ''}`,
          },
        });

        createdDiscountIds.push(copiedDiscount.id);
        continue;
      }

      // Copy regular persistent discount
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
    const { originalDiscount, newPayrollId, currentMonth, currentYear, overrides } = params;

    return this.prisma.payrollDiscount.create({
      data: {
        payrollId: newPayrollId,
        discountType: originalDiscount.discountType,
        value: originalDiscount.value,
        percentage: originalDiscount.percentage,
        reference: overrides?.reference || originalDiscount.reference,
        calculationOrder: originalDiscount.calculationOrder,
        isPersistent: true,
        isAutoGenerated: false,
        isActive: true,
        sourceDiscountId: originalDiscount.id, // Track original discount
        requiresAuthorization: originalDiscount.requiresAuthorization,
        employeeAuthorizationDate: originalDiscount.employeeAuthorizationDate,
        expirationDate: originalDiscount.expirationDate,
        observations: overrides?.observations || originalDiscount.observations,
        legalBasis: originalDiscount.legalBasis,
        baseValue: originalDiscount.baseValue,
        calculationDetails: overrides?.calculationDetails || originalDiscount.calculationDetails,
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
        calculationOrder: this.getDefaultCalculationOrder(template.type),
        isPersistent: true,
        isAutoGenerated: false,
        isActive: true,
        requiresAuthorization: template.requiresAuthorization || false,
        employeeAuthorizationDate: template.authorizationDate,
        expirationDate: template.expirationDate,
        observations: template.observations,
        legalBasis: template.legalBasis,
        calculationDetails:
          template.installments
            ? {
                totalInstallments: template.installments,
                currentInstallment: template.currentInstallment || 1,
              }
            : null,
      },
    });

    this.logger.log(`Created persistent discount: ${discount.id}`);

    return discount;
  }

  /**
   * ========================================================================
   * UPDATE PERSISTENT DISCOUNT
   * ========================================================================
   * Updates a persistent discount and optionally propagates changes to future months.
   */
  async updatePersistentDiscount(params: {
    discountId: string;
    updates: Partial<PersistentDiscountTemplate>;
    propagateToFuture?: boolean;
  }) {
    const { discountId, updates, propagateToFuture = false } = params;

    this.logger.log(`Updating persistent discount ${discountId}`);

    const discount = await this.prisma.payrollDiscount.update({
      where: { id: discountId },
      data: {
        value: updates.value ? roundCurrency(updates.value) : undefined,
        percentage: updates.percentage,
        reference: updates.reference,
        expirationDate: updates.expirationDate,
        observations: updates.observations,
        legalBasis: updates.legalBasis,
      },
    });

    // TODO: If propagateToFuture, update all future payrolls with this discount
    // This would require finding all future payrolls and updating their copied versions

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
        OR: [
          { expirationDate: null },
          { expirationDate: { gt: new Date() } },
        ],
      },
      orderBy: {
        calculationOrder: 'asc',
      },
    });
  }

  /**
   * ========================================================================
   * GET DEFAULT CALCULATION ORDER
   * ========================================================================
   * Returns the default calculation order for a discount type.
   * This ensures proper calculation sequence.
   */
  private getDefaultCalculationOrder(type: PayrollDiscountType): number {
    const orderMap: Record<PayrollDiscountType, number> = {
      [PayrollDiscountType.INSS]: 1,
      [PayrollDiscountType.IRRF]: 2,
      [PayrollDiscountType.ABSENCE]: 3,
      [PayrollDiscountType.LATE_ARRIVAL]: 4,
      [PayrollDiscountType.UNION]: 5,
      [PayrollDiscountType.ALIMONY]: 6,
      [PayrollDiscountType.GARNISHMENT]: 7,
      [PayrollDiscountType.HEALTH_INSURANCE]: 8,
      [PayrollDiscountType.DENTAL_INSURANCE]: 9,
      [PayrollDiscountType.FGTS]: 10,
      [PayrollDiscountType.MEAL_VOUCHER]: 11,
      [PayrollDiscountType.TRANSPORT_VOUCHER]: 12,
      [PayrollDiscountType.LOAN]: 13,
      [PayrollDiscountType.ADVANCE]: 14,
      [PayrollDiscountType.CUSTOM]: 15,
    };

    return orderMap[type] || 99;
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
    observations?: string;
  }) {
    const { employeeId, payrollId, totalAmount, installments, reference, observations } = params;

    const installmentAmount = roundCurrency(totalAmount / installments);

    return this.createPersistentDiscountTemplate({
      employeeId,
      payrollId,
      template: {
        type: PayrollDiscountType.LOAN,
        value: installmentAmount,
        reference: `${reference} - Parcela 1/${installments}`,
        observations: `Parcela 1 de ${installments} - Total: R$ ${totalAmount.toFixed(2)}. ${observations || ''}`,
        legalBasis: 'CLT Art. 462 - Desconto autorizado pelo empregado',
        requiresAuthorization: true,
        installments,
        currentInstallment: 1,
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
    courtOrder?: string;
  }) {
    const { employeeId, payrollId, value, percentage, reference, courtOrder } = params;

    return this.createPersistentDiscountTemplate({
      employeeId,
      payrollId,
      template: {
        type: PayrollDiscountType.ALIMONY,
        value,
        percentage,
        reference,
        observations: courtOrder ? `Processo: ${courtOrder}` : undefined,
        legalBasis: 'Lei 5.478/68 - Pensão Alimentícia (ordem judicial)',
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
    authorizationDate?: Date;
  }) {
    const { employeeId, payrollId, value, reference, authorizationDate } = params;

    return this.createPersistentDiscountTemplate({
      employeeId,
      payrollId,
      template: {
        type: PayrollDiscountType.HEALTH_INSURANCE,
        value,
        reference,
        requiresAuthorization: true,
        authorizationDate,
        observations: 'Plano de saúde - Desconto autorizado',
        legalBasis: 'CLT Art. 462 - Desconto autorizado pelo empregado',
      },
    });
  }
}
