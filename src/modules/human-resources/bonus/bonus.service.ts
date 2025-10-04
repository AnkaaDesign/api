// bonus.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { ExactBonusCalculationService } from './exact-bonus-calculation.service';
import { BonusRepository } from './repositories/bonus/bonus.repository';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  COMMISSION_STATUS,
  TASK_STATUS,
  USER_STATUS,
} from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { roundAverage, roundCurrency } from '../../../utils/currency-precision.util';

// Types for bonus calculations
interface BonusCalculationData {
  userId: string;
  userName: string;
  positionName: string;
  performanceLevel: number;
  bonusValue: number;
  totalTasks: number;
  weightedTaskCount: number;
}

interface PayrollData {
  year: string;
  month: string;
  bonuses: BonusCalculationData[];
  totalActiveUsers: number;
  averageTasksPerEmployee: number;
  calculatedAt: Date;
}

@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly exactBonusCalculationService: ExactBonusCalculationService,
    private readonly bonusRepository: BonusRepository,
  ) {}

  /**
   * Calculate bonus for a user based on performance level and weighted task count
   * Uses the EXACT spreadsheet algorithm implementation with position-based matrix
   */
  private calculateBonus(
    performanceLevel: number,
    weightedTaskCount: number,
    positionName: string = 'DEFAULT',
  ): number {
    // Use the exact algorithm from the spreadsheet with the user's position
    return this.exactBonusCalculationService.calculateBonus(
      positionName,
      performanceLevel,
      weightedTaskCount,
    );
  }


  /**
   * Get bonus calculation details for debugging/transparency
   * Uses the EXACT spreadsheet algorithm for transparency
   */
  getBonusCalculationDetails(
    performanceLevel: number,
    weightedTaskCount?: number,
  ): any {
    return this.exactBonusCalculationService.getCalculationDetails(
      'DEFAULT',
      performanceLevel,
      weightedTaskCount || 0,
    );
  }


  /**
   * Get payroll data with live calculated bonuses for the current period
   */
  async getPayrollData(
    filters?: {
      year?: string | number;
      month?: string | number | string[];
      includeInactive?: boolean;
    },
    userId?: string,
  ): Promise<PayrollData>;
  async getPayrollData(year?: string | number, month?: string | number): Promise<PayrollData>;
  async getPayrollData(
    filtersOrYear?: string | number | { year?: string | number; month?: string | number | string[]; includeInactive?: boolean; },
    monthOrUserId?: string | number,
  ): Promise<PayrollData> {
    try {
      const now = new Date();

      // Handle overloaded parameters
      let targetYear: string;
      let targetMonth: string;
      let includeInactive = false;

      if (typeof filtersOrYear === 'string' || typeof filtersOrYear === 'number') {
        // Legacy call: getPayrollData(year?, month?)
        targetYear = filtersOrYear.toString() || now.getFullYear().toString();
        targetMonth = monthOrUserId?.toString() || (now.getMonth() + 1).toString().padStart(2, '0');
      } else {
        // New call: getPayrollData(filters?, userId?)
        const filters = filtersOrYear || {};
        targetYear = filters.year?.toString() || now.getFullYear().toString();

        if (Array.isArray(filters.month)) {
          targetMonth = filters.month[0] || (now.getMonth() + 1).toString().padStart(2, '0');
        } else {
          targetMonth = filters.month?.toString() || (now.getMonth() + 1).toString().padStart(2, '0');
        }

        includeInactive = filters.includeInactive || false;
      }

      // Get users with performance levels > 0
      const userWhereClause: any = {
        performanceLevel: {
          gt: 0,
        },
      };

      // Only filter by status if not including inactive
      if (!includeInactive) {
        // Only CONTRACTED users are eligible for bonuses (not experience periods)
        userWhereClause.status = USER_STATUS.CONTRACTED;
      }

      const users = await this.prisma.user.findMany({
        where: userWhereClause,
        select: {
          id: true,
          name: true,
          performanceLevel: true,
          position: {
            select: {
              name: true,
              bonifiable: true,
            },
          },
        },
      });

      // Filter to only users with bonifiable positions
      const eligibleUsers = users.filter(user => user.position?.bonifiable === true);

      const bonuses: BonusCalculationData[] = [];

      // Calculate sector-wide task distribution for all users
      // Get all eligible tasks in the period (not per user, but for the entire organization/sector)
      const startDate = this.getStartDate(parseInt(targetYear), parseInt(targetMonth));
      const endDate = this.getEndDate(parseInt(targetYear), parseInt(targetMonth));

      this.logger.log(`Looking for tasks between ${startDate.toISOString()} and ${endDate.toISOString()} for period ${targetMonth}/${targetYear}`);

      const allEligibleTasks = await this.prisma.task.findMany({
        where: {
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
          finishedAt: {
            gte: startDate, // Previous month 26th
            lte: endDate, // Current month 25th
          },
          status: TASK_STATUS.COMPLETED,
        },
        select: {
          id: true,
          commission: true,
          finishedAt: true,
          createdById: true,
          sectorId: true,
          customerId: true,
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
          customer: {
            select: {
              id: true,
              fantasyName: true,
            },
          },
        },
      });

      this.logger.log(`Found ${allEligibleTasks.length} eligible tasks for period ${targetMonth}/${targetYear}`);

      if (allEligibleTasks.length > 0) {
        this.logger.log(`Sample tasks found:`, allEligibleTasks.slice(0, 3).map(t => ({
          id: t.id,
          commission: t.commission,
          finishedAt: t.finishedAt
        })));
      }

      // Calculate weighted task count for the entire period
      let totalWeightedTasks = 0;
      for (const task of allEligibleTasks) {
        if (task.commission === COMMISSION_STATUS.FULL_COMMISSION) {
          totalWeightedTasks += 1.0;
        } else if (task.commission === COMMISSION_STATUS.PARTIAL_COMMISSION) {
          totalWeightedTasks += 0.5;
        }
      }

      // Calculate average tasks per user using ONLY eligible users (CONTRACTED + bonifiable + performance > 0)
      const totalEligibleUsers = eligibleUsers.length;
      // CRITICAL: Use centralized rounding utility for consistency
      const averageTasksPerUser = totalEligibleUsers > 0 ? roundAverage(totalWeightedTasks / totalEligibleUsers) : 0;

      this.logger.log(`Period ${targetMonth}/${targetYear}: ${totalWeightedTasks} weighted tasks ÷ ${totalEligibleUsers} eligible users = ${averageTasksPerUser.toFixed(2)} tasks per user`);

      // Calculate bonuses for each eligible user using the sector-wide average
      for (const user of eligibleUsers) {
        // Get position name for the calculation (uses position level in matrix)
        const positionName = user.position?.name || 'DEFAULT';

        // Calculate bonus using position name, performance level, and sector-wide average tasks
        const bonusValue = this.calculateBonus(
          user.performanceLevel,
          averageTasksPerUser,
          positionName,
        );

        bonuses.push({
          userId: user.id,
          userName: user.name,
          positionName,
          performanceLevel: user.performanceLevel,
          bonusValue,
          totalTasks: allEligibleTasks.length, // Total tasks in the period
          weightedTaskCount: averageTasksPerUser, // Average tasks per user (what's used in calculation)
        });
      }

      return {
        year: targetYear,
        month: targetMonth,
        bonuses,
        totalActiveUsers: eligibleUsers.length,
        averageTasksPerEmployee: averageTasksPerUser,
        calculatedAt: new Date(),
      };
    } catch (error) {
      this.logger.error('Error getting payroll data:', error);
      throw new InternalServerErrorException(
        'Erro ao obter dados da folha de pagamento.',
      );
    }
  }

  /**
   * Calculate and save bonuses - Auto-creates at month end (day 26)
   */
  async calculateAndSaveBonuses(
    year: string,
    month: string,
    userId?: string,
  ): Promise<{ totalSuccess: number; totalFailed: number }> {
    try {
      const payrollData = await this.getPayrollData(year, month);
      let successCount = 0;
      let failedCount = 0;

      // Collect all user IDs receiving bonuses this period
      const allBonusUserIds = payrollData.bonuses.map(b => b.userId);

      // Get all tasks for this period to connect to bonuses
      const allTasksForPeriod = await this.prisma.task.findMany({
        where: {
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
          finishedAt: {
            gte: this.getStartDate(parseInt(year), parseInt(month)),
            lte: this.getEndDate(parseInt(year), parseInt(month)),
          },
          status: TASK_STATUS.COMPLETED,
        },
        select: {
          id: true,
        },
      });
      const allTaskIds = allTasksForPeriod.map(t => t.id);

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const createdBonusIds: string[] = [];
        const updatedBonusIds: string[] = [];

        for (const bonusData of payrollData.bonuses) {
          try {
            // Verify user still exists
            const user = await tx.user.findUnique({
              where: { id: bonusData.userId },
            });

            if (!user) {
              this.logger.warn(`User ${bonusData.userId} not found`);
              failedCount++;
              continue;
            }

            // Check if bonus already exists for this period
            const existingBonus = await tx.bonus.findFirst({
              where: {
                userId: bonusData.userId,
                year: parseInt(year),
                month: parseInt(month),
              },
            });

            // Check for existing payroll
            const existingPayroll = await tx.payroll.findFirst({
              where: {
                year: parseInt(year),
                month: parseInt(month),
              },
            });

            const bonusData_new = {
              userId: bonusData.userId,
              year: parseInt(year),
              month: parseInt(month),
              performanceLevel: user.performanceLevel,
              baseBonus: bonusData.bonusValue,
              payrollId: existingPayroll?.id || null,
            };

            if (existingBonus) {
              // Update existing bonus
              await tx.bonus.update({
                where: { id: existingBonus.id },
                data: {
                  ...bonusData_new,
                  updatedAt: new Date(),
                },
              });

              updatedBonusIds.push(existingBonus.id);

              await logEntityChange({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.BONUS,
                entityId: existingBonus.id,
                action: CHANGE_ACTION.UPDATE,
                entity: bonusData_new,
                reason: `Bônus atualizado para ${month}/${year}`,
                userId: userId || null,
                triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
                transaction: tx,
              });
            } else {
              // Create new bonus
              const newBonus = await tx.bonus.create({
                data: bonusData_new,
              });

              createdBonusIds.push(newBonus.id);

              await logEntityChange({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.BONUS,
                entityId: newBonus.id,
                action: CHANGE_ACTION.CREATE,
                entity: newBonus,
                reason: `Bônus criado para ${month}/${year} via cron job`,
                userId: userId || null,
                triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
                transaction: tx,
              });
            }

            successCount++;
          } catch (error) {
            this.logger.error(`Error saving bonus for user ${bonusData.userId}:`, error);
            failedCount++;
          }
        }

        // After all bonuses are created/updated, connect them to all users and tasks for this period
        const allBonusIds = [...createdBonusIds, ...updatedBonusIds];
        if (allBonusIds.length > 0) {
          this.logger.log(`Linking ${allBonusUserIds.length} users and ${allTaskIds.length} tasks to ${allBonusIds.length} bonuses (${createdBonusIds.length} new, ${updatedBonusIds.length} updated) for ${month}/${year}`);

          for (const bonusId of allBonusIds) {
            try {
              const updateData: any = {};

              // For updated bonuses, we need to clear existing relations and reconnect
              const isUpdate = updatedBonusIds.includes(bonusId);

              if (isUpdate) {
                // Disconnect existing users and tasks
                if (allBonusUserIds.length > 0) {
                  updateData.users = {
                    set: allBonusUserIds.map(uid => ({ id: uid })),
                  };
                }
                if (allTaskIds.length > 0) {
                  updateData.tasks = {
                    set: allTaskIds.map(tid => ({ id: tid })),
                  };
                }
              } else {
                // For new bonuses, just connect
                if (allBonusUserIds.length > 0) {
                  updateData.users = {
                    connect: allBonusUserIds.map(uid => ({ id: uid })),
                  };
                }
                if (allTaskIds.length > 0) {
                  updateData.tasks = {
                    connect: allTaskIds.map(tid => ({ id: tid })),
                  };
                }
              }

              if (Object.keys(updateData).length > 0) {
                await tx.bonus.update({
                  where: { id: bonusId },
                  data: updateData,
                });
              }
            } catch (error) {
              this.logger.error(`Error linking users/tasks to bonus ${bonusId}:`, error);
            }
          }
        }
      });

      this.logger.log(
        `Monthly bonus calculation completed: ${successCount} success, ${failedCount} failed`,
      );

      return { totalSuccess: successCount, totalFailed: failedCount };
    } catch (error) {
      this.logger.error('Error calculating and saving bonuses:', error);
      throw new InternalServerErrorException(
        'Erro ao calcular e salvar bônus mensais.',
      );
    }
  }

  /**
   * Save monthly bonuses - DEPRECATED, use calculateAndSaveBonuses instead
   */
  async saveMonthlyBonuses(
    year: string,
    month: string,
    userId?: string,
  ): Promise<{ totalSuccess: number; totalFailed: number }> {
    this.logger.warn('saveMonthlyBonuses is deprecated, redirecting to calculateAndSaveBonuses');
    return this.calculateAndSaveBonuses(year, month, userId);
  }

  /**
   * Get bonus by ID with validation
   */
  async findById(id: string, include?: any, userId?: string): Promise<any> {
    try {
      const defaultInclude = include || {
        user: {
          select: {
            id: true,
            name: true,
            performanceLevel: true,
          },
        },
        tasks: {
          select: {
            id: true,
            name: true,
            status: true,
            finishedAt: true,
            commission: true,
          },
        },
        bonusDiscounts: {
          select: {
            id: true,
            percentage: true,
            value: true,
            reference: true,
            calculationOrder: true,
          },
          orderBy: {
            calculationOrder: 'asc',
          },
        },
      };

      const bonus = await this.prisma.bonus.findUnique({
        where: { id },
        include: defaultInclude,
      });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      return bonus;
    } catch (error) {
      this.logger.error('Error finding bonus by ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar bônus.',
      );
    }
  }

  /**
   * Get many bonuses with filters
   */
  async findMany(filters?: {
    year?: string | number;
    month?: string | number;
    userId?: string;
    skip?: number;
    take?: number;
  }): Promise<any> {
    try {
      const where: any = {};

      // Convert to numbers since Prisma expects integers
      if (filters?.year) where.year = typeof filters.year === 'string' ? parseInt(filters.year) : filters.year;
      if (filters?.month) where.month = typeof filters.month === 'string' ? parseInt(filters.month) : filters.month;
      if (filters?.userId) where.userId = filters.userId;

      const [bonuses, total] = await Promise.all([
        this.prisma.bonus.findMany({
          where,
          skip: filters?.skip || 0,
          take: filters?.take || 50,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                performanceLevel: true,
              },
            },
            tasks: {
              select: {
                id: true,
                name: true,
                status: true,
                finishedAt: true,
                commission: true,
              },
            },
            bonusDiscounts: {
              select: {
                id: true,
                percentage: true,
                value: true,
                reference: true,
                calculationOrder: true,
              },
              orderBy: {
                calculationOrder: 'asc',
              },
            },
          },
          orderBy: [
            { year: 'desc' },
            { month: 'desc' },
            { user: { name: 'asc' } },
          ],
        }),
        this.prisma.bonus.count({ where }),
      ]);

      const skip = filters?.skip || 0;
      const take = filters?.take || 50;
      const page = Math.floor(skip / take) + 1;
      const totalPages = Math.ceil(total / take);

      return {
        success: true,
        data: bonuses,
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: skip + bonuses.length < total,
          hasPreviousPage: page > 1,
        },
        message: 'Bônus carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error finding bonuses:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar bônus.',
      );
    }
  }

  /**
   * Calculate average tasks per employee for bonus calculation
   * Updated to use 26-25 period calculation
   */
  async calculateAverageTasksPerEmployee(): Promise<number> {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // Calculate period dates (26th to 25th)
      const startDate = this.getStartDate(year, month);
      const endDate = this.getEndDate(year, month);

      // Count total tasks with commission status
      const totalTasks = await this.prisma.task.count({
        where: {
          finishedAt: {
            gte: startDate,
            lte: endDate,
          },
          status: TASK_STATUS.COMPLETED,
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
        },
      });

      // Count users with performance > 0
      const performanceUsers = await this.prisma.user.count({
        where: {
          performanceLevel: { gt: 0 },
          status: { not: USER_STATUS.DISMISSED },
        },
      });

      if (performanceUsers === 0) {
        return 0;
      }

      return totalTasks / performanceUsers;
    } catch (error) {
      this.logger.error('Error calculating average tasks per employee:', error);
      throw new InternalServerErrorException(
        'Erro ao calcular média de tarefas por funcionário.',
      );
    }
  }

  /**
   * Create a new bonus
   */
  async create(data: any, userId: string): Promise<any> {
    try {
      // Verify user exists
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        throw new BadRequestException('Usuário não encontrado.');
      }

      // Check for duplicate bonus
      const existingBonus = await this.prisma.bonus.findFirst({
        where: {
          userId: data.userId,
          year: data.year,
          month: data.month,
        },
      });

      if (existingBonus) {
        throw new BadRequestException(
          `Bônus já existe para este usuário no período ${data.month}/${data.year}.`,
        );
      }

      let bonus: any;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        bonus = await tx.bonus.create({
          data: {
            userId: data.userId,
            year: data.year,
            month: data.month,
            performanceLevel: data.performanceLevel || user.performanceLevel,
            baseBonus: data.baseBonus,
            payrollId: data.payrollId || null,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                performanceLevel: true,
              },
            },
            bonusDiscounts: true,
            tasks: true,
          },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: bonus.id,
          action: CHANGE_ACTION.CREATE,
          entity: bonus,
          reason: `Bônus criado para ${data.month}/${data.year}`,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      return bonus;
    } catch (error) {
      this.logger.error('Error creating bonus:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar bônus.');
    }
  }

  /**
   * Update an existing bonus
   */
  async update(id: string, data: any, userId: string): Promise<any> {
    try {
      const existingBonus = await this.prisma.bonus.findUnique({
        where: { id },
      });

      if (!existingBonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      let updatedBonus: any;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        updatedBonus = await tx.bonus.update({
          where: { id },
          data: {
            baseBonus: data.baseBonus,
            performanceLevel: data.performanceLevel,
            payrollId: data.payrollId,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                performanceLevel: true,
              },
            },
            bonusDiscounts: true,
            tasks: true,
          },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          entity: updatedBonus,
          reason: 'Bônus atualizado',
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      return updatedBonus;
    } catch (error) {
      this.logger.error('Error updating bonus:', error);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar bônus.');
    }
  }

  /**
   * Delete a bonus
   */
  async delete(id: string, userId: string): Promise<void> {
    try {
      const bonus = await this.prisma.bonus.findUnique({
        where: { id },
      });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await tx.bonus.delete({
          where: { id },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          entity: bonus,
          reason: 'Bônus removido',
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });
    } catch (error) {
      this.logger.error('Error deleting bonus:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao remover bônus.');
    }
  }

  /**
   * Batch create bonuses
   */
  async batchCreate(
    data: { bonuses: any[] },
    userId: string,
  ): Promise<{ totalSuccess: number; totalFailed: number; data: any[] }> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const bonusData of data.bonuses) {
      try {
        const bonus = await this.create(bonusData, userId);
        success.push(bonus);
      } catch (error) {
        failed.push({
          data: bonusData,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    return {
      totalSuccess: success.length,
      totalFailed: failed.length,
      data: success,
    };
  }

  /**
   * Batch update bonuses
   */
  async batchUpdate(
    data: { bonuses: { id: string; data: any }[] },
    userId: string,
  ): Promise<{ totalSuccess: number; totalFailed: number; data: any[] }> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const update of data.bonuses) {
      try {
        const bonus = await this.update(update.id, update.data, userId);
        success.push(bonus);
      } catch (error) {
        failed.push({
          id: update.id,
          data: update.data,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    return {
      totalSuccess: success.length,
      totalFailed: failed.length,
      data: success,
    };
  }

  /**
   * Batch delete bonuses
   */
  async batchDelete(
    data: { ids: string[] },
    userId: string,
  ): Promise<{ totalSuccess: number; totalFailed: number }> {
    const success: string[] = [];
    const failed: any[] = [];

    for (const id of data.ids) {
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

    return {
      totalSuccess: success.length,
      totalFailed: failed.length,
    };
  }

  /**
   * Create bonus discount
   */
  async createDiscount(bonusId: string, data: { reason: string; percentage: number }, userId?: string): Promise<any> {
    try {
      // Verify bonus exists
      const bonus = await this.prisma.bonus.findUnique({
        where: { id: bonusId },
      });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      // Create discount
      const discount = await this.prisma.bonusDiscount.create({
        data: {
          bonusId,
          reference: data.reason,
          percentage: data.percentage,
          calculationOrder: 1,
        },
      });

      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.BONUS,
        entityId: bonusId,
        action: CHANGE_ACTION.UPDATE,
        entity: { discount: discount },
        reason: `Desconto adicionado: ${data.reason} (${data.percentage}%)`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
      });

      return {
        success: true,
        data: discount,
        message: 'Desconto adicionado com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error creating bonus discount:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar desconto de bônus.',
      );
    }
  }

  /**
   * Delete bonus discount
   */
  async deleteDiscount(discountId: string, userId?: string): Promise<void> {
    try {
      const discount = await this.prisma.bonusDiscount.findUnique({
        where: { id: discountId },
        include: { bonus: true },
      });

      if (!discount) {
        throw new NotFoundException('Desconto não encontrado.');
      }

      await this.prisma.bonusDiscount.delete({
        where: { id: discountId },
      });

      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.BONUS,
        entityId: discount.bonusId,
        action: CHANGE_ACTION.UPDATE,
        entity: { discountRemoved: discountId },
        reason: `Desconto removido: ${discount.reference}`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
      });
    } catch (error) {
      this.logger.error('Error deleting bonus discount:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao remover desconto de bônus.',
      );
    }
  }

  /**
   * Get start date for bonus calculation period (26th of previous month at start of day)
   */
  private getStartDate(year: number, month: number): Date {
    // Start is day 26 of previous month at 00:00:00
    if (month === 1) {
      // For January, start from December 26 of previous year
      return new Date(year - 1, 11, 26, 0, 0, 0, 0);
    }
    return new Date(year, month - 2, 26, 0, 0, 0, 0); // month-2 because JS months are 0-indexed
  }

  /**
   * Get end date for bonus calculation period (25th of current month)
   */
  private getEndDate(year: number, month: number): Date {
    // End is day 25 of current month
    return new Date(year, month - 1, 25, 23, 59, 59, 999);
  }

}