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
import {
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  USER_STATUS,
  ACTIVE_USER_STATUSES,
} from '../../../constants';
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import {
  calculateNetSalary,
  getPayrollCalculationBreakdown,
  getPayrollPeriod
} from '../../../utils';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import type {
  PayrollCreateFormData,
  PayrollUpdateFormData,
  PayrollGetManyParams,
  PayrollInclude,
} from '../../../schemas';
import type { Payroll, PayrollGetManyResponse } from '../../../types';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollRepository: PayrollRepository,
    private readonly bonusService: BonusService,
    private readonly userService: UserService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Find payroll by ID
   */
  async findById(id: string, include?: PayrollInclude): Promise<Payroll | null> {
    try {
      const payroll = await this.payrollRepository.findById(id, include ? { include } : undefined);

      if (!payroll) {
        return null; // Return null instead of throwing error for missing payroll
      }

      // If no bonus exists, calculate live data
      if (!payroll.bonus) {
        const liveBonus = await this.calculateLiveBonusData(
          payroll.userId,
          payroll.year,
          payroll.month,
        );
        return { ...payroll, bonus: liveBonus };
      }

      return payroll;
    } catch (error) {
      this.logger.error('Error finding payroll by ID:', error);
      throw new InternalServerErrorException('Erro ao buscar folha de pagamento.');
    }
  }

  /**
   * Find many payrolls with pagination and optional live calculations
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
            tasks: {
              include: {
                customer: true,
                createdBy: true,
                sector: true,
                services: true,
              },
            },
            users: true,
          },
        },
        discounts: true,
      };

      // Check if querying for a specific period to generate live payrolls
      const year = params.where?.year;
      const month = params.where?.month;

      // Log for debugging

      const isSpecificPeriod = year !== undefined && month !== undefined;

      if (isSpecificPeriod) {
        // Ensure we have numbers for the period calculation
        const yearNum = typeof year === 'number' ? year : parseInt(year as any);
        const monthNum = typeof month === 'number' ? month : parseInt(month as any);

        if (!isNaN(yearNum) && !isNaN(monthNum)) {
          return this.findManyForPeriod(yearNum, monthNum, defaultInclude, params);
        }
      }

      // Standard repository query for non-period queries
      const result = await this.payrollRepository.findMany({
        where: params.where,
        include: defaultInclude,
        orderBy: params.orderBy || { createdAt: 'desc' },
        page: params.page,
        take: params.limit,
      });

      // Add live bonus data for payrolls without bonuses
      if (result.data && Array.isArray(result.data)) {
        result.data = await Promise.all(
          result.data.map(async (payroll) => {
            if (!payroll.bonus) {
              const liveBonus = await this.calculateLiveBonusData(
                payroll.userId,
                payroll.year,
                payroll.month,
              );
              return { ...payroll, bonus: liveBonus };
            }
            return payroll;
          })
        );
      }

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
   * Find payroll by user and month
   */
  async findByUserAndMonth(
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll | null> {
    try {
      let payroll = await this.payrollRepository.findByUserAndPeriod(
        userId,
        year,
        month,
        include,
      );

      // If no payroll exists, create a temporary one with live calculations
      if (!payroll) {
        const userResponse = await this.userService.findById(userId, {
          position: {
            include: {
              remunerations: true,
            },
          },
        });

        if (!userResponse.data || userResponse.data.status === USER_STATUS.DISMISSED) {
          return null;
        }

        const user = userResponse.data;
        const baseRemuneration = user.position?.remunerations?.[0]?.value || 0;
        const liveBonus = await this.calculateLiveBonusData(userId, year, month);

        // Use a UUID-like format for temporary IDs to avoid validation issues
        // Include year and month in the ID to ensure uniqueness
        const yearMonth = `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}`;
        const tempId = `00000000-${yearMonth}-0000-0000-${userId.substring(0, 12)}`;

        payroll = {
          id: tempId,
          userId,
          year,
          month,
          baseRemuneration,
          positionId: user.position?.id || null,
          user,
          bonus: liveBonus,
          discounts: [],
          isLive: true,  // Mark as live calculation
          isTemporary: true, // Additional flag for clarity
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Payroll;
      } else if (!payroll.bonus) {
        // Add live bonus data if payroll exists but has no bonus
        const liveBonus = await this.calculateLiveBonusData(userId, year, month);
        payroll = { ...payroll, bonus: liveBonus };
      }

      return payroll;
    } catch (error) {
      this.logger.error('Error finding payroll by user and month:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar folha de pagamento do usuário.',
      );
    }
  }

  /**
   * Create a new payroll
   */
  async create(data: PayrollCreateFormData, userId: string): Promise<Payroll> {
    try {
      // Validate user exists and is not dismissed
      const userResponse = await this.userService.findById(data.userId);
      if (!userResponse.data || userResponse.data.status === USER_STATUS.DISMISSED) {
        throw new BadRequestException('Usuário não encontrado ou desligado.');
      }

      // Check for duplicate payroll
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
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar folha de pagamento.');
    }
  }

  /**
   * Update an existing payroll
   */
  async update(
    id: string,
    data: PayrollUpdateFormData,
    userId: string,
  ): Promise<Payroll> {
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
        updatedPayroll = await this.payrollRepository.updateWithTransaction(
          tx,
          id,
          data,
          {
            include: {
              user: true,
              discounts: true,
              bonus: true,
            },
          },
        );

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
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar folha de pagamento.',
      );
    }
  }

  /**
   * Delete a payroll
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

  /**
   * Generate payrolls for all active users for a specific month
   */
  async generateForMonth(
    year: number,
    month: number,
    userId: string,
  ): Promise<{ created: number; skipped: number }> {
    try {

      const created = await this.payrollRepository.createManyForMonth(year, month);

      // Calculate skipped payrolls
      const totalActiveUsers = await this.prisma.user.count({
        where: { status: { not: USER_STATUS.DISMISSED } },
      });

      const skipped = Math.max(0, totalActiveUsers - created);

      this.logger.log(
        `Payroll generation completed: ${created} created, ${skipped} skipped`,
      );

      return { created, skipped };
    } catch (error) {
      this.logger.error('Error generating payrolls for month:', error);
      throw new InternalServerErrorException(
        'Erro ao gerar folhas de pagamento do mês.',
      );
    }
  }

  /**
   * Batch create payrolls
   */
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

  /**
   * Batch update payrolls
   */
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

  /**
   * Batch delete payrolls
   */
  async batchDelete(
    ids: string[],
    userId: string,
  ): Promise<{ success: string[]; failed: any[] }> {
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

  /**
   * Calculate live payroll data including net salary
   */
  async calculateLivePayrollData(
    userId: string,
    year: number,
    month: number,
  ): Promise<any> {
    try {
      const payroll = await this.findByUserAndMonth(userId, year, month, {
        discounts: true,
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
      });

      if (!payroll) {
        throw new NotFoundException('Usuário não encontrado ou inativo.');
      }

      const bonusValue = payroll.bonus?.baseBonus ? Number(payroll.bonus.baseBonus) : 0;
      const discounts = payroll.discounts?.map(d => ({
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
        message: 'Cálculo da folha de pagamento obtido com sucesso.',
        data: {
          payroll: {
            id: payroll.id,
            userId: payroll.userId,
            year: payroll.year,
            month: payroll.month,
            baseRemuneration: payroll.baseRemuneration,
            user: payroll.user,
            discounts: payroll.discounts || [],
          },
          bonus: {
            value: bonusValue,
          },
          calculations: breakdown,
          calculatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error('Error calculating live payroll data:', error);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao calcular folha de pagamento.');
    }
  }

  /**
   * Find many payrolls for a specific period with live calculations
   * @private
   */
  private async findManyForPeriod(
    year: number,
    month: number,
    defaultInclude: any,
    params: PayrollGetManyParams,
  ): Promise<PayrollGetManyResponse> {

    // Get all non-dismissed users with their positions
    const allActiveUsers = await this.prisma.user.findMany({
      where: {
        status: { not: USER_STATUS.DISMISSED },
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


    // Get existing payrolls for this period
    const existingPayrolls = await this.payrollRepository.findMany({
      where: {
        year,
        month,
      },
      include: defaultInclude,
      orderBy: params.orderBy || { createdAt: 'desc' },
      page: 1,
      take: 1000, // Get all for this period
    });

    // Create a map of existing payrolls by userId
    const existingPayrollMap = new Map(
      existingPayrolls.data.map(p => [p.userId, p])
    );

    // Check if the bonus period is closed
    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Period closes on day 26 of the month
    const isPeriodClosed = (
      year < currentYear ||
      (year === currentYear && month < currentMonth) ||
      (year === currentYear && month === currentMonth && currentDay >= 26)
    );


    // Generate payrolls for all active users
    const allPayrolls = await Promise.all(
      allActiveUsers.map(async (user) => {
        // Check if user is eligible for bonus
        const isEligibleForBonus = user.performanceLevel > 0 && user.position?.bonifiable === true;

        // If payroll exists, use it (adding live bonus if needed)
        if (existingPayrollMap.has(user.id)) {
          const existingPayroll = existingPayrollMap.get(user.id)!;

          // If no bonus but eligible, calculate live data
          if (!existingPayroll.bonus && isEligibleForBonus) {
            const liveBonus = await this.calculateLiveBonusData(
              user.id,
              year,
              month,
            );
            return {
              ...existingPayroll,
              bonus: liveBonus,
              isLive: false, // Payroll is saved, only bonus is live
            };
          }

          return {
            ...existingPayroll,
            isLive: false, // Saved payroll
          };
        }

        // No saved payroll exists - create temporary one
        const baseRemuneration = user.position?.remunerations?.[0]?.value || 0;

        // Calculate live bonus only if eligible
        const liveBonus = isEligibleForBonus
          ? await this.calculateLiveBonusData(user.id, year, month)
          : null;

        // Use a UUID-like format for temporary IDs to avoid validation issues
        // Include year and month in the ID to ensure uniqueness
        const yearMonth = `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}`;
        const userIdPrefix = user.id.substring(0, 12);
        const tempId = `00000000-${yearMonth}-0000-0000-${userIdPrefix}`;

        return {
          id: tempId,
          userId: user.id,
          year,
          month,
          baseRemuneration,
          positionId: user.position?.id || null,
          user,
          bonus: liveBonus,
          discounts: [],
          isLive: true,  // Mark as live calculation
          isTemporary: true, // Additional flag for clarity
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      })
    );

    const totalRecords = allPayrolls.length;
    const page = 1;
    const take = totalRecords;
    const totalPages = 1;

    return {
      success: true,
      message: 'Folhas de pagamento obtidas com sucesso.',
      data: allPayrolls as any,
      meta: {
        totalRecords,
        page,
        take,
        totalPages,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }

  /**
   * Calculate live bonus data for a user when no bonus exists
   * @private
   */
  private async calculateLiveBonusData(
    userId: string,
    year: number,
    month: number,
  ): Promise<any> {
    try {

      // Calculate live bonus using bonus service directly
      const payrollData = await this.bonusService.getPayrollData({
        year: year.toString(),
        month: month.toString(),
      });

      const userBonus = payrollData.bonuses.find(b => b.userId === userId);
      const bonusValue = userBonus?.bonusValue || 0;

      // Get user details for performance level
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { performanceLevel: true },
      });


      // Also get the actual tasks for this period to show in UI
      const startDate = new Date(year, month - 2, 26); // Previous month 26th
      const endDate = new Date(year, month - 1, 25, 23, 59, 59); // Current month 25th

      const tasks = await this.prisma.task.findMany({
        where: {
          commission: {
            in: ['FULL_COMMISSION', 'PARTIAL_COMMISSION'],
          },
          finishedAt: {
            gte: startDate,
            lte: endDate,
          },
          status: 'COMPLETED',
          createdById: userId, // Filter tasks for this specific user only
        },
        include: {
          customer: true,
          createdBy: true,
          sector: true,
          services: true,
        },
        orderBy: {
          finishedAt: 'desc', // Order by completion date for better display
        },
      });

      return {
        id: `live-${userId}-${year}-${month}`,
        year,
        month,
        userId,
        baseBonus: bonusValue,
        performanceLevel: user?.performanceLevel || 0,
        tasks: tasks || [],
        users: [],
        isLive: true,
        totalTasks: userBonus?.totalTasks || 0,
        weightedTaskCount: userBonus?.weightedTaskCount || 0,
        totalUsers: payrollData.totalActiveUsers || 0, // Total eligible users (EFFECTED + bonifiable + performance > 0)
      };
    } catch (error) {
      this.logger.error('Error calculating live bonus data:', error);

      // Return minimal structure on error
      return {
        id: `live-${userId}-${year}-${month}`,
        year,
        month,
        userId,
        baseBonus: 0,
        performanceLevel: 0,
        tasks: [],
        users: [],
        isLive: true,
        totalTasks: 0,
        weightedTaskCount: 0,
        totalUsers: 0,
      };
    }
  }

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
      const { year, month, taskQuantity, sectorIds = [], excludeUserIds = [] } = params;


      // Get all payroll data for the period
      // This returns live calculations with bonuses already calculated
      const payrollData = await this.bonusService.getPayrollData({
        year: year.toString(),
        month: month.toString(),
      });

      // Get all users from the bonus calculation to add their full details
      const userIds = payrollData.bonuses.map((b: any) => b.userId);

      const users = await this.prisma.user.findMany({
        where: {
          id: { in: userIds },
        },
        include: {
          position: {
            select: {
              id: true,
              name: true,
              remunerations: {
                orderBy: {
                  createdAt: 'desc',
                },
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

      // Apply filters AFTER getting all bonus data (for display purposes only)
      let filteredBonuses = payrollData.bonuses;

      if (sectorIds.length > 0) {
        filteredBonuses = filteredBonuses.filter((bonus: any) => {
          const user = users.find(u => u.id === bonus.userId);
          return user && sectorIds.includes(user.sector?.id || '');
        });
      }

      if (excludeUserIds.length > 0) {
        filteredBonuses = filteredBonuses.filter((bonus: any) => {
          return !excludeUserIds.includes(bonus.userId);
        });
      }

      // Map the filtered bonuses to include full user details
      const usersWithBonuses = filteredBonuses.map((bonus: any) => {
        const user = users.find(u => u.id === bonus.userId);
        if (!user) return null;

        // Get the latest remuneration value
        const latestRemuneration = user.position?.remunerations?.[0]?.value || 0;

        return {
          userId: user.id,
          userName: user.name,
          userEmail: user.email || '',
          sectorId: user.sector?.id || '',
          sectorName: user.sector?.name || 'Sem setor',
          positionId: user.position?.id || '',
          positionName: user.position?.name || 'Sem cargo',
          remuneration: latestRemuneration,
          performanceLevel: user.performanceLevel,
          bonusAmount: bonus.bonusValue || 0,
          totalTasks: bonus.totalTasks || 0,
          weightedTaskCount: bonus.weightedTaskCount || 0,
        };
      }).filter(Boolean);

      // Calculate summary statistics
      // IMPORTANT: Calculate from ALL bonuses (payrollData.bonuses), not just filtered ones
      // This gives the true totals regardless of frontend filters
      const allBonusesData = payrollData.bonuses.map((bonus: any) => {
        const user = users.find(u => u.id === bonus.userId);
        return {
          bonusAmount: bonus.bonusValue || 0,
          weightedTaskCount: bonus.weightedTaskCount || 0,
        };
      });

      const totalBonusAmount = allBonusesData.reduce((sum, b: any) => sum + b.bonusAmount, 0);
      const averageBonusAmount = allBonusesData.length > 0 ? totalBonusAmount / allBonusesData.length : 0;

      // The weightedTaskCount is the same for all users (sector-wide average)
      const averageTasksPerUser = allBonusesData.length > 0 && allBonusesData[0]?.weightedTaskCount
        ? allBonusesData[0].weightedTaskCount
        : 0;

      // For filtered results, calculate their specific totals
      const filteredTotalBonus = usersWithBonuses.reduce((sum, user: any) => sum + (user.bonusAmount || 0), 0);
      const filteredAverageBonus = usersWithBonuses.length > 0 ? filteredTotalBonus / usersWithBonuses.length : 0;

      return {
        success: true,
        message: 'Simulação de bonificação realizada com sucesso.',
        data: {
          users: usersWithBonuses,
          summary: {
            // Global summary (all eligible users)
            totalUsers: allBonusesData.length,
            totalBonusAmount,
            averageBonusAmount,
            averageTasksPerUser,
            // Filtered summary (visible users)
            filteredUsers: usersWithBonuses.length,
            filteredTotalBonus,
            filteredAverageBonus,
          },
          parameters: {
            year,
            month,
            taskQuantity: taskQuantity || 0,
            userQuantity: allBonusesData.length,
            filteredUserQuantity: usersWithBonuses.length,
            sectorFilter: sectorIds.length > 0 ? sectorIds : null,
            excludedUsers: excludeUserIds.length > 0 ? excludeUserIds : null,
            averageTasksPerUser,
          },
        },
      };
    } catch (error) {
      this.logger.error('Error simulating bonuses:', error);
      throw new InternalServerErrorException('Erro ao simular bonificações.');
    }
  }

}