import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { LoanKind, PayrollDiscountType, Prisma } from '@prisma/client';
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
  /** Parcelamento (ex.: empréstimo CLT): total de parcelas contratadas */
  totalInstallments?: number;
  /** Parcela corrente (1-based). Avança a cada folha mensal. */
  currentInstallment?: number;
}

/**
 * Próxima parcela ao copiar um desconto parcelado para a folha do mês seguinte.
 * Retorna null quando o parcelamento foi quitado (não copiar mais).
 */
function nextInstallment(discount: {
  totalInstallments?: number | null;
  currentInstallment?: number | null;
}): { totalInstallments: number; currentInstallment: number } | null {
  if (!discount.totalInstallments) return null; // não parcelado — chamador deve guardar
  const next = (discount.currentInstallment ?? 1) + 1;
  if (next > discount.totalInstallments) return null;
  return { totalInstallments: discount.totalInstallments, currentInstallment: next };
}

/** Competência "YYYY-MM" a partir de ano/mês (mês 1-based). */
function toCompetence(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Diferença em meses entre duas competências "YYYY-MM" (b − a).
 * Ex.: ('2026-01', '2026-03') => 2. Negativo quando b é anterior a a.
 * Retorna null para entradas malformadas.
 */
function monthsBetweenCompetences(a: string, b: string): number | null {
  const ma = /^(\d{4})-(\d{2})$/.exec(a);
  const mb = /^(\d{4})-(\d{2})$/.exec(b);
  if (!ma || !mb) return null;
  const ai = Number(ma[1]) * 12 + (Number(ma[2]) - 1);
  const bi = Number(mb[1]) * 12 + (Number(mb[2]) - 1);
  return bi - ai;
}

/** Tipos de desconto que representam empréstimos/adiantamentos parcelados. */
const LOAN_DISCOUNT_TYPES: PayrollDiscountType[] = [
  PayrollDiscountType.LOAN,
  PayrollDiscountType.ADVANCE,
];

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
    // Optional transaction client. When payroll generation runs inside a
    // $transaction, installment advancement MUST be atomic with the payroll
    // create — otherwise a rolled-back payroll still advances/deactivates
    // discounts. Threaded from payroll.service.ts. Falls back to this.prisma.
    tx?: Prisma.TransactionClient;
  }): Promise<string[]> {
    const { employeeId, newPayrollId, currentYear, currentMonth, tx } = params;
    const db = tx ?? this.prisma;

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
    const previousPayroll = await db.payroll.findFirst({
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

      // DEDUP: loan/advance lines that originate from an employee-anchored MASTER
      // discount (they carry a startCompetence) are materialized exclusively by
      // materializeMasterLoans(). Skipping them here prevents double-application
      // when both paths run during payroll generation.
      if (
        (discount as any).startCompetence &&
        LOAN_DISCOUNT_TYPES.includes(discount.discountType)
      ) {
        this.logger.log(
          `Skipping master-anchored loan in previous-month copy (handled by master path): ${discount.reference}`,
        );
        continue;
      }

      // Installment-tracked discounts (loans): advance the installment and
      // auto-deactivate when the contracted installments are exhausted.
      let installmentFields: { totalInstallments: number; currentInstallment: number } | null =
        null;
      if (discount.totalInstallments) {
        installmentFields = nextInstallment(discount);
        if (!installmentFields) {
          this.logger.log(
            `Persistent discount fully paid (${discount.currentInstallment}/${discount.totalInstallments}), deactivating: ${discount.reference}`,
          );
          await db.payrollDiscount.update({
            where: { id: discount.id },
            data: { isActive: false },
          });
          continue;
        }
      }

      // Copy persistent discount
      const copiedDiscount = await this.copyDiscountToNewPayroll({
        originalDiscount: discount,
        newPayrollId,
        currentMonth,
        currentYear,
        installmentFields,
        tx,
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
    installmentFields?: { totalInstallments: number; currentInstallment: number } | null;
    tx?: Prisma.TransactionClient;
  }) {
    const { originalDiscount, newPayrollId, overrides, installmentFields, tx } = params;
    const db = tx ?? this.prisma;

    return db.payrollDiscount.create({
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
        totalInstallments: installmentFields?.totalInstallments ?? originalDiscount.totalInstallments ?? null,
        currentInstallment: installmentFields?.currentInstallment ?? originalDiscount.currentInstallment ?? null,
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

    if (
      template.totalInstallments &&
      template.currentInstallment &&
      template.currentInstallment > template.totalInstallments
    ) {
      throw new Error('Current installment cannot exceed total installments');
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
        totalInstallments: template.totalInstallments ?? null,
        currentInstallment: template.totalInstallments
          ? (template.currentInstallment ?? 1)
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
        totalInstallments: updates.totalInstallments,
        currentInstallment: updates.currentInstallment,
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
      totalInstallments?: number | null;
      currentInstallment?: number | null;
      loanKind?: LoanKind | null;
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
      totalInstallments?: number | null;
      currentInstallment?: number | null;
      loanKind?: LoanKind | null;
    }> = [];

    // Convert database discounts to discount objects
    for (const discount of previousPayroll.discounts) {
      // Check if discount has expired
      if (discount.expirationDate && discount.expirationDate < currentDate) {
        this.logger.log(`Skipping expired persistent discount: ${discount.reference}`);
        continue;
      }

      // Installment-tracked discounts (loans): skip when fully paid; otherwise
      // expose the installment this month would correspond to.
      let installmentFields: { totalInstallments: number; currentInstallment: number } | null =
        null;
      if (discount.totalInstallments) {
        installmentFields = nextInstallment(discount);
        if (!installmentFields) {
          this.logger.log(
            `Skipping fully paid persistent discount (${discount.currentInstallment}/${discount.totalInstallments}): ${discount.reference}`,
          );
          continue;
        }
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
        totalInstallments: installmentFields?.totalInstallments ?? discount.totalInstallments ?? null,
        currentInstallment: installmentFields?.currentInstallment ?? discount.currentInstallment ?? null,
        loanKind: discount.loanKind ?? null,
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
    expirationDate?: Date;
  }) {
    const { employeeId, payrollId, totalAmount, installments, reference, expirationDate } = params;

    const installmentAmount = roundCurrency(totalAmount / installments);

    return this.createPersistentDiscountTemplate({
      employeeId,
      payrollId,
      template: {
        type: PayrollDiscountType.LOAN,
        value: installmentAmount,
        reference: `${reference} - Total: R$ ${totalAmount.toFixed(2)} (${installments}x)`,
        totalInstallments: installments,
        currentInstallment: 1,
        expirationDate,
      },
    });
  }

  /**
   * ========================================================================
   * CREATE EMPLOYEE-ANCHORED MASTER LOAN
   * ========================================================================
   * Registers a loan/advance ONCE per employee (payrollId=null, userId set).
   * The master row is the single source of truth: it is materialized into each
   * future folha by materializeMasterLoans() during payroll generation, with
   * installment advancement driven by competência math (gap-tolerant).
   *
   * `value` é o VALOR DA PARCELA mensal. `totalInstallments` é o número de
   * parcelas. A primeira parcela vale a partir de `startCompetence` (YYYY-MM).
   */
  async createMasterLoan(params: {
    userId: string;
    value: number;
    totalInstallments: number;
    startCompetence: string;
    discountType?: PayrollDiscountType;
    loanKind?: LoanKind;
    lenderName?: string;
    description?: string;
  }) {
    const {
      userId,
      value,
      totalInstallments,
      startCompetence,
      discountType = PayrollDiscountType.LOAN,
      loanKind = LoanKind.COMPANY,
      lenderName,
      description,
    } = params;

    if (!LOAN_DISCOUNT_TYPES.includes(discountType)) {
      throw new Error('Tipo de desconto deve ser LOAN ou ADVANCE para empréstimo-mestre');
    }
    if (!/^\d{4}-\d{2}$/.test(startCompetence)) {
      throw new Error('Competência inicial inválida (esperado YYYY-MM)');
    }
    if (!(totalInstallments >= 1)) {
      throw new Error('Total de parcelas deve ser pelo menos 1');
    }
    if (!(value > 0)) {
      throw new Error('Valor da parcela deve ser maior que zero');
    }

    const baseLabel =
      description && description.trim().length > 0
        ? description.trim()
        : loanKind === LoanKind.PAYROLL_CONSIGNED
          ? lenderName && lenderName.trim().length > 0
            ? `Consignado - ${lenderName.trim()}`
            : 'Consignado'
          : discountType === PayrollDiscountType.ADVANCE
            ? 'Adiantamento'
            : 'Empréstimo';

    const master = await this.prisma.payrollDiscount.create({
      data: {
        payrollId: null,
        userId,
        discountType,
        loanKind,
        lenderName: lenderName && lenderName.trim().length > 0 ? lenderName.trim() : null,
        value: roundCurrency(value),
        reference: `${baseLabel} - Parcela de R$ ${roundCurrency(value).toFixed(2)} (${totalInstallments}x)`,
        isPersistent: true,
        isActive: true,
        totalInstallments,
        currentInstallment: 1,
        startCompetence,
      },
    });

    this.logger.log(
      `Created master loan ${master.id} for user ${userId}: ${totalInstallments}x R$ ${value.toFixed(2)} from ${startCompetence}`,
    );

    return master;
  }

  /**
   * ========================================================================
   * GET ACTIVE MASTER LOANS
   * ========================================================================
   * Active employee-anchored loans (payrollId=null) whose start competence is
   * already due for the given competência.
   */
  async getActiveMasterLoans(params: {
    userId: string;
    currentCompetence: string;
    tx?: Prisma.TransactionClient;
  }) {
    const { userId, currentCompetence, tx } = params;
    const db = tx ?? this.prisma;

    const masters = await db.payrollDiscount.findMany({
      where: {
        payrollId: null,
        userId,
        isPersistent: true,
        isActive: true,
        discountType: { in: LOAN_DISCOUNT_TYPES },
        startCompetence: { not: null, lte: currentCompetence },
      },
      orderBy: { createdAt: 'asc' },
    });

    return masters;
  }

  /**
   * Resolve, for a master loan and a target competência, which installment
   * number applies and whether it is still within the contracted installments.
   *
   * Gap-tolerant: the installment is derived purely from competência math
   * (monthsBetween(startCompetence, current) + 1), NOT from "previous month
   * exists". A skipped month therefore does not desync the schedule.
   */
  private resolveMasterInstallment(
    master: { startCompetence?: string | null; totalInstallments?: number | null },
    currentCompetence: string,
  ): { installment: number; totalInstallments: number } | null {
    if (!master.startCompetence || !master.totalInstallments) return null;
    const offset = monthsBetweenCompetences(master.startCompetence, currentCompetence);
    if (offset === null || offset < 0) return null; // not yet due / malformed
    const installment = offset + 1; // 1-based
    if (installment > master.totalInstallments) return null; // fully paid
    return { installment, totalInstallments: master.totalInstallments };
  }

  /**
   * ========================================================================
   * MATERIALIZE MASTER LOANS INTO A FOLHA
   * ========================================================================
   * For each active master loan due at `currentCompetence`, creates a per-folha
   * copy (payrollId set) carrying the right type/installment so the calculator's
   * 35% margem consignável clamp applies, then advances the master's
   * currentInstallment. Auto-deactivates the master once installments are
   * exhausted. Idempotent per folha: if a copy for this competência already
   * exists on the folha, it is skipped.
   */
  async materializeMasterLoans(params: {
    employeeId: string;
    newPayrollId: string;
    currentYear: number;
    currentMonth: number;
    // Optional transaction client — see copyPersistentDiscountsFromPreviousMonth.
    // Master loan installment advancement MUST be atomic with payroll creation.
    tx?: Prisma.TransactionClient;
  }): Promise<string[]> {
    const { employeeId, newPayrollId, currentYear, currentMonth, tx } = params;
    const db = tx ?? this.prisma;
    const currentCompetence = toCompetence(currentYear, currentMonth);

    const masters = await this.getActiveMasterLoans({ userId: employeeId, currentCompetence, tx });
    if (masters.length === 0) return [];

    const createdIds: string[] = [];

    for (const master of masters) {
      const resolved = this.resolveMasterInstallment(master, currentCompetence);

      if (!resolved) {
        // Fully paid (or not yet due, but getActiveMasterLoans already filtered
        // start <= current). Deactivate exhausted masters so they stop matching.
        const offset = monthsBetweenCompetences(master.startCompetence ?? '', currentCompetence);
        if (
          master.totalInstallments &&
          offset !== null &&
          offset + 1 > master.totalInstallments
        ) {
          await db.payrollDiscount.update({
            where: { id: master.id },
            data: { isActive: false },
          });
          this.logger.log(`Master loan ${master.id} fully paid — deactivated`);
        }
        continue;
      }

      // Idempotency: avoid a second copy on the same folha for this master.
      const existingCopy = await db.payrollDiscount.findFirst({
        where: {
          payrollId: newPayrollId,
          userId: employeeId,
          discountType: master.discountType,
          startCompetence: master.startCompetence,
        },
      });
      if (existingCopy) {
        this.logger.log(
          `Master loan ${master.id} already materialized on folha ${newPayrollId} — skipping`,
        );
        continue;
      }

      const copy = await db.payrollDiscount.create({
        data: {
          payrollId: newPayrollId,
          userId: employeeId,
          discountType: master.discountType,
          value: master.value,
          percentage: master.percentage,
          reference: master.reference,
          isPersistent: true,
          isActive: true,
          baseValue: master.baseValue,
          totalInstallments: master.totalInstallments,
          currentInstallment: resolved.installment,
          // Carry the master's startCompetence so the previous-month copy path
          // recognizes this line as master-anchored and does NOT re-copy it.
          startCompetence: master.startCompetence,
          // Carry the loan modality so the calculator applies the 35% margem
          // consignável ONLY to PAYROLL_CONSIGNED loans (COMPANY loans deduct
          // in full, still floored at net ≥ 0).
          loanKind: master.loanKind,
          lenderName: master.lenderName,
        },
      });
      createdIds.push(copy.id);

      // Advance the master so its currentInstallment tracks the latest folha and
      // auto-deactivate when the contracted installments are exhausted.
      const isLast = resolved.installment >= resolved.totalInstallments;
      await db.payrollDiscount.update({
        where: { id: master.id },
        data: {
          currentInstallment: resolved.installment,
          ...(isLast ? { isActive: false } : {}),
        },
      });
      if (isLast) {
        this.logger.log(
          `Master loan ${master.id} reached final installment ${resolved.installment}/${resolved.totalInstallments} — deactivated`,
        );
      }
    }

    this.logger.log(
      `Materialized ${createdIds.length} master loans onto folha ${newPayrollId} (${currentCompetence})`,
    );
    return createdIds;
  }

  /**
   * ========================================================================
   * GET MASTER LOANS FOR LIVE CALCULATION
   * ========================================================================
   * Returns the loan installments due at the given competência (from MASTER
   * rows) as plain discount objects for the live calculator — mirrors
   * getPersistentDiscountsForLivePayroll but sourced from the master, not the
   * previous month. Does NOT mutate any row.
   */
  async getMasterLoansForLivePayroll(params: {
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
      totalInstallments: number | null;
      currentInstallment: number | null;
      loanKind: LoanKind | null;
    }>
  > {
    const { employeeId, currentYear, currentMonth } = params;
    const currentCompetence = toCompetence(currentYear, currentMonth);

    const masters = await this.getActiveMasterLoans({ userId: employeeId, currentCompetence });
    const result: Array<{
      id: string;
      discountType: PayrollDiscountType;
      value: number | null;
      percentage: number | null;
      reference: string;
      isPersistent: boolean;
      isActive: boolean;
      totalInstallments: number | null;
      currentInstallment: number | null;
      loanKind: LoanKind | null;
    }> = [];

    for (const master of masters) {
      const resolved = this.resolveMasterInstallment(master, currentCompetence);
      if (!resolved) continue;
      result.push({
        id: `live-master-${master.id}`,
        discountType: master.discountType,
        value: master.value !== null && master.value !== undefined ? Number(master.value) : null,
        percentage:
          master.percentage !== null && master.percentage !== undefined
            ? Number(master.percentage)
            : null,
        reference: master.reference,
        isPersistent: true,
        isActive: true,
        totalInstallments: resolved.totalInstallments,
        currentInstallment: resolved.installment,
        loanKind: master.loanKind ?? null,
      });
    }

    return result;
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
