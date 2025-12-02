// payroll.service.ts
// Clean implementation with separation of concerns:
// - Regular CRUD operations (like any other entity)
// - Live calculation service (only when current period is requested)
// - Uses BonusService for bonus calculations (no duplication)

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PayrollRepository } from './repositories/payroll/payroll.repository';
import { BonusService } from '../bonus/bonus.service';
import { UserService } from '@modules/people/user/user.service';
import { CompletePayrollCalculatorService } from './utils/complete-payroll-calculator.service';
import { AutoDiscountCreationService } from './services/auto-discount-creation.service';
import { PersistentDiscountService } from './services/persistent-discount.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY, USER_STATUS } from '../../../constants';
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import {
  calculateNetSalary,
  getPayrollCalculationBreakdown,
  getCurrentPeriod,
  isCurrentPeriod,
  filterIncludesCurrentPeriod,
} from '../../../utils';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import type {
  PayrollCreateFormData,
  PayrollUpdateFormData,
  PayrollGetManyParams,
  PayrollInclude,
} from '../../../schemas';
import type { Payroll, PayrollGetManyResponse } from '../../../types';

// =====================
// Types
// =====================

interface LivePayrollData {
  id: string;
  userId: string;
  year: number;
  month: number;
  baseRemuneration: number;
  positionId: string | null;
  user: any;
  bonus: any | null;
  discounts: any[];
  isLive: true;
  isTemporary: true;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollRepository: PayrollRepository,
    private readonly bonusService: BonusService,
    private readonly userService: UserService,
    private readonly changeLogService: ChangeLogService,
    private readonly completeCalculator: CompletePayrollCalculatorService,
    private readonly autoDiscountService: AutoDiscountCreationService,
    private readonly persistentDiscountService: PersistentDiscountService,
  ) {}

  // =====================
  // Regular CRUD Operations (like any other entity)
  // =====================

  /**
   * Find payroll by ID - standard entity retrieval
   */
  async findById(id: string, include?: PayrollInclude): Promise<Payroll | null> {
    try {
      const defaultInclude = include || {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        bonus: {
          include: {
            tasks: true,
            bonusDiscounts: true,
          },
        },
        discounts: {
          orderBy: {
            calculationOrder: 'asc',
          },
        },
      };

      const payroll = await this.payrollRepository.findById(id, { include: defaultInclude });

      if (!payroll) {
        return null;
      }

      return payroll;
    } catch (error) {
      this.logger.error('Error finding payroll by ID:', error);
      throw new InternalServerErrorException('Erro ao buscar folha de pagamento.');
    }
  }

  /**
   * Find payroll by ID or calculate live payroll if ID is a composite live ID
   * Supports both database UUIDs and composite live IDs (live-{userId}-{year}-{month})
   */
  async findByIdOrLive(id: string, include?: PayrollInclude): Promise<any> {
    const { isLiveId, parseLiveId } = await import('../../../utils/bonus');

    // Check if this is a live ID
    if (isLiveId(id)) {
      const parsed = parseLiveId(id);
      if (!parsed) {
        throw new BadRequestException(
          'Invalid live payroll ID format. Expected: live-{userId}-{year}-{month}',
        );
      }

      // Calculate live payroll data
      const livePayroll = await this.calculateLivePayrollData(
        parsed.userId,
        parsed.year,
        parsed.month,
      );

      if (!livePayroll || !livePayroll.data) {
        throw new NotFoundException(
          'Unable to calculate live payroll for the specified user and period.',
        );
      }

      // Return the payroll data with the composite ID
      return {
        ...livePayroll.data.payroll,
        id,
        bonus: livePayroll.data.bonus,
        calculations: livePayroll.data.calculations,
        isLive: true,
      };
    }

    // Regular UUID - fetch from database
    return this.findById(id, include);
  }

  /**
   * Find many payrolls - standard entity list
   * Returns data directly from database without live calculations
   */
  async findMany(params: PayrollGetManyParams): Promise<PayrollGetManyResponse> {
    try {
      const defaultInclude = params.include || {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        bonus: {
          include: {
            tasks: true,
            bonusDiscounts: true,
          },
        },
        discounts: {
          orderBy: {
            calculationOrder: 'asc',
          },
        },
      };

      // Normalize orderBy to array format for Prisma
      let orderBy = params.orderBy;
      if (orderBy && !Array.isArray(orderBy)) {
        // If orderBy is an object with multiple keys, convert to array of single-key objects
        const keys = Object.keys(orderBy);
        if (keys.length > 1) {
          orderBy = keys.map(key => ({ [key]: (orderBy as any)[key] }));
        }
      }

      const result = await this.payrollRepository.findMany({
        where: params.where,
        include: defaultInclude,
        orderBy: orderBy || [{ createdAt: 'desc' }],
        page: params.page,
        take: params.limit,
      });

      return {
        success: true,
        message: 'Folhas de pagamento encontradas com sucesso',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Error finding payrolls:', error);
      throw new InternalServerErrorException('Erro ao buscar folhas de pagamento.');
    }
  }

  /**
   * Find payroll by user and month - supports live calculations
   * If payroll doesn't exist in database and period is current, calculates live
   */
  async findByUserAndMonth(
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll | null> {
    try {
      // First, try to find saved payroll in database
      const payroll = await this.payrollRepository.findByUserAndPeriod(
        userId,
        year,
        month,
        include,
      );

      // If found, return it
      if (payroll) {
        return payroll;
      }

      // If not found, check if this is the current period
      const currentPeriod = getCurrentPeriod();
      const isCurrentPeriod = year === currentPeriod.year && month === currentPeriod.month;

      if (!isCurrentPeriod) {
        // Not current period and no saved data - return null
        return null;
      }

      // Current period with no saved data - calculate live payroll
      this.logger.log(`Calculating live payroll for user ${userId} for ${month}/${year}`);

      const livePayroll = await this.calculateLivePayrollData(userId, year, month);

      return livePayroll || null;
    } catch (error) {
      this.logger.error('Error finding payroll by user and month:', error);
      throw new InternalServerErrorException('Erro ao buscar folha de pagamento do usuário.');
    }
  }

  /**
   * Create a new payroll - standard entity creation
   */
  async create(data: PayrollCreateFormData, userId: string): Promise<Payroll> {
    try {
      const userResponse = await this.userService.findById(data.userId);
      if (!userResponse.data || userResponse.data.status === USER_STATUS.DISMISSED) {
        throw new BadRequestException('Usuário não encontrado ou desligado.');
      }

      const existingPayroll = await this.payrollRepository.findByUserAndPeriod(
        data.userId,
        data.year,
        data.month,
      );

      if (existingPayroll) {
        throw new BadRequestException(
          `Folha de pagamento já existe para este usuário no período ${data.month}/${data.year}.`,
        );
      }

      let payroll: Payroll;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        payroll = await this.payrollRepository.createWithTransaction(tx, data, {
          include: {
            user: true,
            discounts: true,
            bonus: true,
          },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAYROLL,
          entityId: payroll.id,
          action: CHANGE_ACTION.CREATE,
          entity: payroll,
          reason: `Folha de pagamento criada para ${data.month}/${data.year}`,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      return payroll!;
    } catch (error) {
      this.logger.error('Error creating payroll:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar folha de pagamento.');
    }
  }

  /**
   * Update an existing payroll - standard entity update
   */
  async update(id: string, data: PayrollUpdateFormData, userId: string): Promise<Payroll> {
    try {
      const existingPayroll = await this.payrollRepository.findById(id, {
        include: {
          user: true,
          discounts: true,
          bonus: true,
        },
      });

      if (!existingPayroll) {
        throw new NotFoundException('Folha de pagamento não encontrada.');
      }

      let updatedPayroll: Payroll;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        updatedPayroll = await this.payrollRepository.updateWithTransaction(tx, id, data, {
          include: {
            user: true,
            discounts: true,
            bonus: true,
          },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAYROLL,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          entity: updatedPayroll,
          reason: 'Folha de pagamento atualizada',
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      return updatedPayroll!;
    } catch (error) {
      this.logger.error('Error updating payroll:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar folha de pagamento.');
    }
  }

  /**
   * Delete a payroll - standard entity deletion
   */
  async delete(id: string, userId: string): Promise<void> {
    try {
      const payroll = await this.payrollRepository.findById(id);

      if (!payroll) {
        throw new NotFoundException('Folha de pagamento não encontrada.');
      }

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.payrollRepository.deleteWithTransaction(tx, id);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAYROLL,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          entity: payroll,
          reason: 'Folha de pagamento removida',
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });
    } catch (error) {
      this.logger.error('Error deleting payroll:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao remover folha de pagamento.');
    }
  }

  // =====================
  // Batch Operations
  // =====================

  async batchCreate(
    payrolls: PayrollCreateFormData[],
    userId: string,
  ): Promise<{ success: Payroll[]; failed: any[] }> {
    const success: Payroll[] = [];
    const failed: any[] = [];

    for (const payrollData of payrolls) {
      try {
        const payroll = await this.create(payrollData, userId);
        success.push(payroll);
      } catch (error) {
        failed.push({
          data: payrollData,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    return { success, failed };
  }

  async batchUpdate(
    updates: { id: string; data: PayrollUpdateFormData }[],
    userId: string,
  ): Promise<{ success: Payroll[]; failed: any[] }> {
    const success: Payroll[] = [];
    const failed: any[] = [];

    for (const update of updates) {
      try {
        const payroll = await this.update(update.id, update.data, userId);
        success.push(payroll);
      } catch (error) {
        failed.push({
          id: update.id,
          data: update.data,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    return { success, failed };
  }

  async batchDelete(ids: string[], userId: string): Promise<{ success: string[]; failed: any[] }> {
    const success: string[] = [];
    const failed: any[] = [];

    for (const id of ids) {
      try {
        await this.delete(id, userId);
        success.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    return { success, failed };
  }

  // =====================
  // Generate Payrolls
  // =====================

  /**
   * Generate payrolls for all active users for a specific month
   * Now uses CompletePayrollCalculatorService for full Brazilian payroll calculation
   */
  async generateForMonth(
    year: number,
    month: number,
    userId: string,
  ): Promise<{ created: number; skipped: number; errors: any[] }> {
    try {
      this.logger.log(`Starting payroll generation for ${year}/${month}`);

      // Get all active users with payroll number
      const activeUsers = await this.prisma.user.findMany({
        where: {
          status: { not: USER_STATUS.DISMISSED },
          payrollNumber: { not: null },
        },
        include: {
          position: {
            include: {
              remunerations: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      });

      let created = 0;
      let skipped = 0;
      const errors: any[] = [];

      for (const user of activeUsers) {
        try {
          // Check if payroll already exists
          const existingPayroll = await this.payrollRepository.findByUserAndPeriod(
            user.id,
            year,
            month,
          );

          if (existingPayroll) {
            this.logger.log(`Payroll already exists for user ${user.id} - ${year}/${month}`);
            skipped++;
            continue;
          }

          // Get base salary
          const baseSalary = user.position?.remunerations?.[0]?.value || 0;

          if (baseSalary === 0) {
            this.logger.warn(`User ${user.id} has no base salary - skipping`);
            skipped++;
            continue;
          }

          // Get bonus from BonusService (if already calculated for this period)
          const savedBonus = await this.prisma.bonus.findFirst({
            where: {
              userId: user.id,
              year,
              month,
            },
          });

          const bonusAmount = savedBonus ? Number(savedBonus.baseBonus) : 0;

          // Calculate complete payroll using CompletePayrollCalculatorService
          const calculation = await this.completeCalculator.calculateCompletePayroll({
            employeeId: user.id,
            year,
            month,
            baseSalary,
            bonusAmount,
            // Use CPF, PIS, and Payroll Number for Secullum mapping (no secullumId needed)
            cpf: user.cpf || undefined,
            pis: user.pis || undefined,
            payrollNumber: user.payrollNumber?.toString() || undefined,
            dependentsCount: (user as any).dependentsCount || 0,
            useSimplifiedDeduction: (user as any).hasSimplifiedDeduction ?? true,
            unionMember: (user as any).unionMember || false,
            isApprentice: false, // TODO: Add apprentice flag to User model if needed
          });

          // Create payroll with calculated values
          let newPayroll: any;

          await this.prisma.$transaction(async (tx: PrismaTransaction) => {
            // Create payroll
            newPayroll = await tx.payroll.create({
              data: {
                userId: user.id,
                year,
                month,
                baseRemuneration: baseSalary,
                positionId: user.positionId,
                workingDaysInMonth: calculation.workingDaysInMonth,
                workedDaysInMonth: calculation.workedDays,
                absenceHours: calculation.absenceDeductions.absenceHours,
                // Earnings breakdown
                overtime50Hours: calculation.overtimeEarnings.overtime50Hours,
                overtime50Amount: calculation.overtimeEarnings.overtime50Amount,
                overtime100Hours: calculation.overtimeEarnings.overtime100Hours,
                overtime100Amount: calculation.overtimeEarnings.overtime100Amount,
                nightHours: calculation.overtimeEarnings.nightHours,
                nightDifferentialAmount: calculation.overtimeEarnings.nightDifferentialAmount,
                dsrAmount: calculation.dsrEarnings.totalDSR,
                dsrDays: calculation.dsrEarnings.dsrDays,
                // Totals
                grossSalary: calculation.grossSalary,
                inssBase: calculation.taxDeductions.inssBase,
                inssAmount: calculation.taxDeductions.inssAmount,
                irrfBase: calculation.taxDeductions.irrfBase,
                irrfAmount: calculation.taxDeductions.irrfAmount,
                fgtsAmount: calculation.employerContributions.fgtsAmount,
                totalDiscounts: calculation.totalDeductions,
                netSalary: calculation.netSalary,
              },
            });

            // Copy persistent discounts from previous month
            await this.persistentDiscountService.copyPersistentDiscountsFromPreviousMonth({
              employeeId: user.id,
              newPayrollId: newPayroll.id,
              currentYear: year,
              currentMonth: month,
            });

            // Create auto-generated discounts (INSS, IRRF, FGTS, Union, Absences, Late arrivals)
            await this.autoDiscountService.createAutoDiscountsForPayroll({
              payrollId: newPayroll.id,
              employeeId: user.id,
              year,
              month,
              calculation,
              transaction: tx, // Pass transaction to avoid foreign key constraint errors
            });

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PAYROLL,
              entityId: newPayroll.id,
              action: CHANGE_ACTION.CREATE,
              entity: newPayroll,
              reason: `Folha de pagamento gerada automaticamente para ${month}/${year}`,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              transaction: tx,
            });
          });

          created++;
          this.logger.log(
            `Created payroll for ${user.name} (${user.id}): Gross R$ ${calculation.grossSalary.toFixed(2)}, Net R$ ${calculation.netSalary.toFixed(2)}`,
          );
        } catch (error) {
          this.logger.error(`Error creating payroll for user ${user.id}:`, error);
          errors.push({
            userId: user.id,
            userName: user.name,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
          skipped++;
        }
      }

      this.logger.log(
        `Payroll generation completed: ${created} created, ${skipped} skipped, ${errors.length} errors`,
      );

      return { created, skipped, errors };
    } catch (error) {
      this.logger.error('Error generating payrolls for month:', error);
      throw new InternalServerErrorException('Erro ao gerar folhas de pagamento do mês.');
    }
  }

  // =====================
  // Live Calculation Service (NEW - Clean Implementation)
  // =====================

  /**
   * Calculate live payroll data for a single user.
   * Now uses CompletePayrollCalculatorService for full Brazilian payroll calculation.
   */
  async calculateLivePayrollData(userId: string, year: number, month: number): Promise<any> {
    try {
      // Try to get saved payroll first
      let payroll = await this.findByUserAndMonth(userId, year, month, {
        discounts: true,
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        bonus: {
          include: {
            tasks: true,
          },
        },
      });

      // If saved payroll exists, return it with calculations
      if (payroll) {
        const bonusValue = payroll.bonus?.baseBonus ? Number(payroll.bonus.baseBonus) : 0;
        const discounts =
          payroll.discounts?.map((d: any) => ({
            percentage: d.percentage,
            fixedValue: d.value,
            calculationOrder: d.calculationOrder,
          })) || [];

        const breakdown = getPayrollCalculationBreakdown(
          Number(payroll.baseRemuneration),
          discounts,
          bonusValue,
        );

        return {
          success: true,
          message: 'Cálculo da folha de pagamento obtido com sucesso (salvo).',
          data: {
            payroll: {
              id: payroll.id,
              userId: payroll.userId,
              year: payroll.year,
              month: payroll.month,
              baseRemuneration: payroll.baseRemuneration,
              grossSalary: (payroll as any).grossSalary,
              netSalary: (payroll as any).netSalary,
              totalDiscounts: (payroll as any).totalDiscounts,
              user: payroll.user,
              discounts: payroll.discounts || [],
              isLive: false,
            },
            bonus: payroll.bonus
              ? {
                  id: payroll.bonus.id,
                  baseBonus: bonusValue,
                  performanceLevel: payroll.bonus.performanceLevel,
                  tasks: payroll.bonus.tasks || [],
                  isLive: false,
                }
              : null,
            calculations: breakdown,
            calculatedAt: new Date(),
          },
        };
      }

      // No saved payroll - calculate live
      const userResponse = await this.userService.findById(userId, {
        position: {
          include: {
            remunerations: true,
          },
        },
      });

      if (!userResponse.data || userResponse.data.status === USER_STATUS.DISMISSED) {
        throw new NotFoundException('Usuário não encontrado ou inativo.');
      }

      const user = userResponse.data;
      const baseSalary = user.position?.remunerations?.[0]?.value || 0;

      if (baseSalary === 0) {
        throw new BadRequestException('Usuário não possui remuneração base.');
      }

      // Calculate live bonus if needed (for current period)
      let bonus: any = null;
      let bonusAmount = 0;

      if (isCurrentPeriod(year, month)) {
        bonus = await this.bonusService.calculateLiveBonusForUser(userId, year, month);
        bonusAmount = bonus?.baseBonus ? Number(bonus.baseBonus) : 0;
      }

      // Calculate complete payroll using CompletePayrollCalculatorService
      const calculation = await this.completeCalculator.calculateCompletePayroll({
        employeeId: userId,
        year,
        month,
        baseSalary,
        bonusAmount,
        payrollNumber: user.secullumId || undefined,
        dependentsCount: (user as any).dependentsCount || 0,
        useSimplifiedDeduction: (user as any).hasSimplifiedDeduction ?? true,
        unionMember: (user as any).unionMember || false,
        isApprentice: false,
      });

      // Build detailed calculations breakdown
      const calculationsBreakdown = {
        // EARNINGS
        baseRemuneration: calculation.baseSalary,
        overtime: {
          overtime50: {
            hours: calculation.overtimeEarnings.overtime50Hours,
            amount: calculation.overtimeEarnings.overtime50Amount,
          },
          overtime100: {
            hours: calculation.overtimeEarnings.overtime100Hours,
            amount: calculation.overtimeEarnings.overtime100Amount,
          },
          nightDifferential: {
            hours: calculation.overtimeEarnings.nightHours,
            amount: calculation.overtimeEarnings.nightDifferentialAmount,
          },
        },
        dsr: {
          onOvertime: calculation.dsrEarnings.dsrOnOvertime,
          onCommissions: calculation.dsrEarnings.dsrOnCommissions,
          total: calculation.dsrEarnings.totalDSR,
        },
        bonus: bonusAmount,
        grossSalary: calculation.grossSalary,

        // DEDUCTIONS
        taxes: {
          inss: {
            base: calculation.taxDeductions.inssBase,
            amount: calculation.taxDeductions.inssAmount,
            rate: calculation.taxDeductions.inssEffectiveRate,
          },
          irrf: {
            base: calculation.taxDeductions.irrfBase,
            amount: calculation.taxDeductions.irrfAmount,
            rate: calculation.taxDeductions.irrfEffectiveRate,
          },
        },
        absences: {
          hours: calculation.absenceDeductions.absenceHours,
          days: calculation.absenceDeductions.absenceDays,
          amount: calculation.absenceDeductions.absenceAmount,
          lateMinutes: calculation.absenceDeductions.lateArrivalMinutes,
          lateAmount: calculation.absenceDeductions.lateArrivalAmount,
        },
        benefits: calculation.benefitDeductions,
        legal: calculation.legalDeductions,
        loans: calculation.loanDeductions,
        customDeductions: calculation.customDeductions,
        totalDeductions: calculation.totalDeductions,

        // NET SALARY
        netSalary: calculation.netSalary,

        // EMPLOYER CONTRIBUTIONS
        employerContributions: calculation.employerContributions,

        // METADATA
        workingDaysInMonth: calculation.workingDaysInMonth,
        workedDays: calculation.workedDays,
      };

      return {
        success: true,
        message: 'Cálculo da folha de pagamento obtido com sucesso (ao vivo).',
        data: {
          payroll: {
            id: `live-${userId}-${year}-${month}`,
            userId,
            year,
            month,
            baseRemuneration: baseSalary,
            grossSalary: calculation.grossSalary,
            netSalary: calculation.netSalary,
            totalDiscounts: calculation.totalDeductions,
            user,
            discounts: [], // Live calculation doesn't have saved discounts
            isLive: true,
          },
          bonus: bonus
            ? {
                id: bonus.id,
                baseBonus: bonusAmount,
                performanceLevel: bonus.performanceLevel,
                tasks: bonus.tasks || [],
                isLive: true,
              }
            : null,
          calculations: calculationsBreakdown,
          calculatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error('Error calculating live payroll data:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao calcular folha de pagamento.');
    }
  }

  /**
   * Get payrolls with live calculation for current period.
   * This is the main method for the frontend - combines saved data with live calculations.
   *
   * Logic:
   * 1. If filter does NOT include current period: Return saved data only
   * 2. If filter includes current period: Generate live payrolls, then merge with saved data
   */
  async getPayrollsWithLiveCalculation(
    params: PayrollGetManyParams,
  ): Promise<PayrollGetManyResponse> {
    try {
      const currentPeriod = getCurrentPeriod();
      const filterYear = params.where?.year;
      const filterMonth = params.where?.month;

      // Parse filter values
      const yearNum =
        typeof filterYear === 'number'
          ? filterYear
          : filterYear
            ? parseInt(filterYear as any)
            : undefined;
      const monthNum =
        typeof filterMonth === 'number'
          ? filterMonth
          : filterMonth
            ? parseInt(filterMonth as any)
            : undefined;

      // Check if filter includes current period
      const includesCurrentPeriod = filterIncludesCurrentPeriod(
        yearNum,
        monthNum ? [monthNum] : undefined,
      );

      // If not querying current period, just return saved data
      if (!includesCurrentPeriod) {
        return this.findMany(params);
      }

      // For current period, generate live payrolls for all active users with payroll number
      const allActiveUsers = await this.prisma.user.findMany({
        where: {
          status: { not: USER_STATUS.DISMISSED },
          payrollNumber: { not: null }, // Only users with payroll number
        },
        include: {
          position: {
            include: {
              remunerations: true,
            },
          },
          sector: true,
        },
      });

      // Get saved payrolls for this period
      const savedPayrolls = await this.payrollRepository.findMany({
        where: {
          year: yearNum || currentPeriod.year,
          month: monthNum || currentPeriod.month,
        },
        include: {
          user: {
            include: {
              position: true,
              sector: true,
            },
          },
          bonus: {
            include: {
              tasks: true,
            },
          },
          discounts: true,
        },
        page: 1,
        take: 1000,
      });

      // Create map of saved payrolls by userId
      const savedPayrollMap = new Map(savedPayrolls.data.map(p => [p.userId, p]));

      // Get live bonus data for current period
      const liveBonusData = await this.bonusService.calculateLiveBonuses(
        yearNum || currentPeriod.year,
        monthNum || currentPeriod.month,
      );
      const liveBonusMap = new Map(liveBonusData.bonuses.map(b => [b.userId, b]));

      // Generate payrolls for all active users
      const allPayrolls = allActiveUsers.map(user => {
        const savedPayroll = savedPayrollMap.get(user.id);
        const liveBonus = liveBonusMap.get(user.id);

        if (savedPayroll) {
          // Use saved payroll, but add live bonus if no saved bonus
          return {
            ...savedPayroll,
            bonus:
              savedPayroll.bonus ||
              (liveBonus
                ? {
                    id: `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
                    userId: user.id,
                    year: currentPeriod.year,
                    month: currentPeriod.month,
                    baseBonus: liveBonus.baseBonus,
                    performanceLevel: liveBonus.performanceLevel,
                    tasks: liveBonus.tasks,
                    bonusDiscounts: [],
                    isLive: true,
                  }
                : null),
            isLive: false,
          };
        }

        // No saved payroll - create live one
        const baseRemuneration = user.position?.remunerations?.[0]?.value || 0;
        const liveId = `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`;

        return {
          id: liveId,
          userId: user.id,
          year: yearNum || currentPeriod.year,
          month: monthNum || currentPeriod.month,
          baseRemuneration,
          positionId: user.position?.id || null,
          user,
          bonus: liveBonus
            ? {
                id: `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
                userId: user.id,
                year: currentPeriod.year,
                month: currentPeriod.month,
                baseBonus: liveBonus.baseBonus,
                performanceLevel: liveBonus.performanceLevel,
                tasks: liveBonus.tasks,
                bonusDiscounts: [],
                isLive: true,
              }
            : null,
          discounts: [],
          isLive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      return {
        success: true,
        message: 'Folhas de pagamento obtidas com sucesso (incluindo cálculos ao vivo).',
        data: allPayrolls as any,
        meta: {
          totalRecords: allPayrolls.length,
          page: 1,
          take: allPayrolls.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
          currentPeriod,
          isLiveCalculationIncluded: true,
          liveCalculationStats: {
            totalActiveUsers: liveBonusData.totalActiveUsers,
            averageTasksPerEmployee: liveBonusData.averageTasksPerEmployee,
            totalWeightedTasks: liveBonusData.totalWeightedTasks,
          },
        } as any,
      };
    } catch (error) {
      this.logger.error('Error getting payrolls with live calculation:', error);
      throw new InternalServerErrorException('Erro ao buscar folhas de pagamento.');
    }
  }

  // =====================
  // Bonus Simulation
  // =====================

  /**
   * Simulate bonuses for all users with optional filters
   * Used by the bonus simulation UI to preview calculations
   */
  async simulateBonuses(params: {
    year: number;
    month: number;
    taskQuantity?: number;
    sectorIds?: string[];
    excludeUserIds?: string[];
  }): Promise<any> {
    try {
      const { year, month, sectorIds = [], excludeUserIds = [] } = params;

      // Get live bonus data from BonusService
      const liveBonusData = await this.bonusService.calculateLiveBonuses(year, month);

      // Get all user details
      const userIds = liveBonusData.bonuses.map(b => b.userId);
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        include: {
          position: {
            select: {
              id: true,
              name: true,
              remunerations: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Apply filters
      let filteredBonuses = liveBonusData.bonuses;

      if (sectorIds.length > 0) {
        filteredBonuses = filteredBonuses.filter(bonus => {
          const user = users.find(u => u.id === bonus.userId);
          return user && sectorIds.includes(user.sector?.id || '');
        });
      }

      if (excludeUserIds.length > 0) {
        filteredBonuses = filteredBonuses.filter(bonus => {
          return !excludeUserIds.includes(bonus.userId);
        });
      }

      // Map bonuses to include full user details
      const usersWithBonuses = filteredBonuses
        .map(bonus => {
          const user = users.find(u => u.id === bonus.userId);
          if (!user) return null;

          const latestRemuneration = user.position?.remunerations?.[0]?.value || 0;

          return {
            userId: user.id,
            userName: user.name,
            sectorId: user.sector?.id || '',
            sectorName: user.sector?.name || 'Sem setor',
            positionId: user.position?.id || '',
            positionName: user.position?.name || 'Sem cargo',
            remuneration: latestRemuneration,
            performanceLevel: user.performanceLevel,
            bonusAmount: bonus.baseBonus,
            weightedTaskCount: bonus.tasks.reduce((sum: number, t: any) => {
              if (t.commission === 'FULL_COMMISSION') return sum + 1.0;
              if (t.commission === 'PARTIAL_COMMISSION') return sum + 0.5;
              return sum;
            }, 0),
          };
        })
        .filter(Boolean);

      // Calculate summary
      const totalBonusAmount = liveBonusData.bonuses.reduce((sum, b) => sum + b.baseBonus, 0);
      const averageBonusAmount =
        liveBonusData.bonuses.length > 0 ? totalBonusAmount / liveBonusData.bonuses.length : 0;
      const filteredTotalBonus = usersWithBonuses.reduce(
        (sum, u: any) => sum + (u.bonusAmount || 0),
        0,
      );
      const filteredAverageBonus =
        usersWithBonuses.length > 0 ? filteredTotalBonus / usersWithBonuses.length : 0;

      return {
        success: true,
        message: 'Simulação de bonificação realizada com sucesso.',
        data: {
          users: usersWithBonuses,
          summary: {
            totalUsers: liveBonusData.totalActiveUsers,
            totalBonusAmount,
            averageBonusAmount,
            averageTasksPerUser: liveBonusData.averageTasksPerEmployee,
            filteredUsers: usersWithBonuses.length,
            filteredTotalBonus,
            filteredAverageBonus,
          },
          parameters: {
            year,
            month,
            userQuantity: liveBonusData.totalActiveUsers,
            filteredUserQuantity: usersWithBonuses.length,
            sectorFilter: sectorIds.length > 0 ? sectorIds : null,
            excludedUsers: excludeUserIds.length > 0 ? excludeUserIds : null,
            averageTasksPerUser: liveBonusData.averageTasksPerEmployee,
          },
        },
      };
    } catch (error) {
      this.logger.error('Error simulating bonuses:', error);
      throw new InternalServerErrorException('Erro ao simular bonificações.');
    }
  }
}
