// bonus.service.ts
// Clean implementation with separation of concerns:
// - Regular CRUD operations (like any other entity)
// - Live calculation service (only when current period is requested)

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
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import { roundAverage, roundCurrency } from '../../../utils/currency-precision.util';
import {
  getCurrentPeriod,
  isCurrentPeriod,
  filterIncludesCurrentPeriod,
  getBonusPeriodStart,
  getBonusPeriodEnd,
} from '../../../utils/bonus';

// =====================
// Types
// =====================

interface LiveBonusData {
  userId: string;
  userName: string;
  positionName: string;
  performanceLevel: number;
  baseBonus: number;
  tasks: any[];
  isLive: true;
}

interface LiveBonusCalculationResult {
  year: number;
  month: number;
  bonuses: LiveBonusData[];
  totalActiveUsers: number;
  totalWeightedTasks: number;
  averageTasksPerEmployee: number;
  calculatedAt: Date;
  isLive: true;
}

// =====================
// Utility Functions
// =====================

/**
 * Calculate weighted task count from tasks array
 * FULL_COMMISSION = 1.0, PARTIAL_COMMISSION = 0.5
 */
function calculatePonderedTaskCount(tasks: any[]): number {
  if (!tasks || tasks.length === 0) return 0;

  return tasks.reduce((sum, task) => {
    if (task.commission === COMMISSION_STATUS.FULL_COMMISSION) {
      return sum + 1.0;
    } else if (task.commission === COMMISSION_STATUS.PARTIAL_COMMISSION) {
      return sum + 0.5;
    }
    return sum;
  }, 0);
}

/**
 * Get period start date (26th of previous month)
 */
function getPeriodStart(year: number, month: number): Date {
  if (month === 1) {
    return new Date(year - 1, 11, 26, 0, 0, 0, 0);
  }
  return new Date(year, month - 2, 26, 0, 0, 0, 0);
}

/**
 * Get period end date (25th of current month)
 */
function getPeriodEnd(year: number, month: number): Date {
  return new Date(year, month - 1, 25, 23, 59, 59, 999);
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

  // =====================
  // Regular CRUD Operations (like any other entity)
  // =====================

  /**
   * Find bonus by ID - standard entity retrieval
   */
  async findById(id: string, include?: any, userId?: string): Promise<any> {
    try {
      const defaultInclude = include || {
        user: {
          select: {
            id: true,
            name: true,
            performanceLevel: true,
            position: {
              select: {
                id: true,
                name: true,
                bonifiable: true,
              },
            },
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        tasks: {
          select: {
            id: true,
            name: true,
            status: true,
            finishedAt: true,
            commission: true,
            customer: {
              select: {
                id: true,
                fantasyName: true,
              },
            },
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
      throw new InternalServerErrorException('Erro ao buscar bônus.');
    }
  }

  /**
   * Find many bonuses - standard entity list with optional filters
   * Returns data directly from database without live calculations
   */
  async findMany(filters?: {
    year?: string | number;
    month?: string | number;
    userId?: string;
    skip?: number;
    take?: number;
    include?: any;
  }): Promise<any> {
    try {
      const where: any = {};

      if (filters?.year) where.year = typeof filters.year === 'string' ? parseInt(filters.year) : filters.year;
      if (filters?.month) where.month = typeof filters.month === 'string' ? parseInt(filters.month) : filters.month;
      if (filters?.userId) where.userId = filters.userId;

      const defaultInclude = filters?.include || {
        user: {
          select: {
            id: true,
            name: true,
            cpf: true,
            email: true,
            performanceLevel: true,
            position: {
              select: {
                id: true,
                name: true,
                bonifiable: true,
                remunerations: true,
              },
            },
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
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
        users: {
          select: {
            id: true,
            name: true,
          },
        },
      };

      const [bonuses, total] = await Promise.all([
        this.prisma.bonus.findMany({
          where,
          skip: filters?.skip || 0,
          take: filters?.take || 50,
          include: defaultInclude,
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
      throw new InternalServerErrorException('Erro ao buscar bônus.');
    }
  }

  /**
   * Create a new bonus - standard entity creation
   */
  async create(data: any, userId: string): Promise<any> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        throw new BadRequestException('Usuário não encontrado.');
      }

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
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar bônus.');
    }
  }

  /**
   * Update an existing bonus - standard entity update
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
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar bônus.');
    }
  }

  /**
   * Delete a bonus - standard entity deletion
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

  // =====================
  // Batch Operations
  // =====================

  async batchCreate(data: { bonuses: any[] }, userId: string): Promise<{ totalSuccess: number; totalFailed: number; data: any[] }> {
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

  async batchUpdate(data: { bonuses: { id: string; data: any }[] }, userId: string): Promise<{ totalSuccess: number; totalFailed: number; data: any[] }> {
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

  async batchDelete(data: { ids: string[] }, userId: string): Promise<{ totalSuccess: number; totalFailed: number }> {
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

  // =====================
  // Discount Management
  // =====================

  async createDiscount(bonusId: string, data: { reason: string; percentage: number }, userId?: string): Promise<any> {
    try {
      const bonus = await this.prisma.bonus.findUnique({
        where: { id: bonusId },
      });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

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
        entity: { discount },
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
      throw new InternalServerErrorException('Erro ao criar desconto de bônus.');
    }
  }

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
      throw new InternalServerErrorException('Erro ao remover desconto de bônus.');
    }
  }

  // =====================
  // Live Calculation Service (NEW - Clean Implementation)
  // =====================

  /**
   * Calculate live bonuses for a given period.
   * This is used when the current period is requested and we need real-time calculations.
   *
   * @param year The year
   * @param month The month (1-12)
   * @returns Live calculated bonus data for all eligible users
   */
  async calculateLiveBonuses(year: number, month: number): Promise<LiveBonusCalculationResult> {
    try {
      // Get period dates (26th to 25th) - computed from year/month
      const startDate = getPeriodStart(year, month);
      const endDate = getPeriodEnd(year, month);

      this.logger.log(`Calculating live bonuses for ${month}/${year} (${startDate.toISOString()} to ${endDate.toISOString()})`);

      // Get all eligible users: EFFECTED status, performance > 0, bonifiable position
      const eligibleUsers = await this.prisma.user.findMany({
        where: {
          status: USER_STATUS.EFFECTED,
          performanceLevel: { gt: 0 },
          position: {
            bonifiable: true,
          },
        },
        select: {
          id: true,
          name: true,
          performanceLevel: true,
          position: {
            select: {
              id: true,
              name: true,
              bonifiable: true,
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

      // Get all eligible tasks in the period
      const eligibleTasks = await this.prisma.task.findMany({
        where: {
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
          finishedAt: {
            gte: startDate,
            lte: endDate,
          },
          status: TASK_STATUS.COMPLETED,
        },
        select: {
          id: true,
          name: true,
          commission: true,
          finishedAt: true,
          createdById: true,
          customer: {
            select: {
              id: true,
              fantasyName: true,
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

      // Calculate weighted task count using utility function
      const totalWeightedTasks = calculatePonderedTaskCount(eligibleTasks);

      // Calculate average tasks per user (for bonus calculation formula)
      const totalEligibleUsers = eligibleUsers.length;
      const averageTasksPerUser = totalEligibleUsers > 0 ? roundAverage(totalWeightedTasks / totalEligibleUsers) : 0;

      this.logger.log(`Period ${month}/${year}: ${totalWeightedTasks} weighted tasks / ${totalEligibleUsers} eligible users = ${averageTasksPerUser.toFixed(2)} tasks per user`);

      // Calculate bonus for each eligible user
      const bonuses: LiveBonusData[] = eligibleUsers.map(user => {
        const positionName = user.position?.name || 'DEFAULT';
        const bonusValue = this.exactBonusCalculationService.calculateBonus(
          positionName,
          user.performanceLevel,
          averageTasksPerUser,
        );

        // Get tasks created by this user in the period
        const userTasks = eligibleTasks.filter(t => t.createdById === user.id);

        return {
          userId: user.id,
          userName: user.name,
          positionName,
          performanceLevel: user.performanceLevel,
          baseBonus: roundCurrency(bonusValue),
          tasks: userTasks,
          isLive: true as const,
        };
      });

      return {
        year,
        month,
        bonuses,
        totalActiveUsers: totalEligibleUsers,
        totalWeightedTasks,
        averageTasksPerEmployee: averageTasksPerUser,
        calculatedAt: new Date(),
        isLive: true,
      };
    } catch (error) {
      this.logger.error('Error calculating live bonuses:', error);
      throw new InternalServerErrorException('Erro ao calcular bônus ao vivo.');
    }
  }

  /**
   * Calculate live bonus for a single user.
   * Used when getting individual user data for the current period.
   */
  async calculateLiveBonusForUser(userId: string, year: number, month: number): Promise<LiveBonusData | null> {
    try {
      // Get all live calculations (we need the average which is shared across all users)
      const liveData = await this.calculateLiveBonuses(year, month);

      // Find this user's bonus
      const userBonus = liveData.bonuses.find(b => b.userId === userId);

      return userBonus || null;
    } catch (error) {
      this.logger.error(`Error calculating live bonus for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get bonuses with live calculation for current period.
   * This is the main method for the frontend - combines saved data with live calculations.
   *
   * Logic:
   * 1. If filter does NOT include current period: Return saved data only
   * 2. If filter includes current period: Calculate live bonuses first, then merge with saved data
   */
  async getBonusesWithLiveCalculation(filters: {
    year?: number;
    month?: number;
    userId?: string;
    skip?: number;
    take?: number;
    include?: any;
  }): Promise<any> {
    try {
      const currentPeriod = getCurrentPeriod();
      const filterYear = filters.year;
      const filterMonth = filters.month;

      // Check if filter includes current period
      const includesCurrentPeriod = filterIncludesCurrentPeriod(
        filterYear,
        filterMonth ? [filterMonth] : undefined
      );

      // If not querying current period, just return saved data
      if (!includesCurrentPeriod) {
        return this.findMany(filters);
      }

      // Get saved bonuses from database
      const savedResult = await this.findMany(filters);

      // Calculate live bonuses for current period
      const liveData = await this.calculateLiveBonuses(currentPeriod.year, currentPeriod.month);

      // Create a map of saved bonuses by userId for quick lookup
      const savedBonusMap = new Map<string, any>();
      if (savedResult.data) {
        for (const bonus of savedResult.data) {
          if (bonus.year === currentPeriod.year && bonus.month === currentPeriod.month) {
            savedBonusMap.set(bonus.userId, bonus);
          }
        }
      }

      // Merge: Use live data for current period users who don't have saved bonuses
      const mergedBonuses: any[] = [];

      // Add saved bonuses that are NOT for current period
      if (savedResult.data) {
        for (const bonus of savedResult.data) {
          if (bonus.year !== currentPeriod.year || bonus.month !== currentPeriod.month) {
            mergedBonuses.push(bonus);
          }
        }
      }

      // Get all eligible users with full data for live calculation
      const eligibleUsers = await this.prisma.user.findMany({
        where: {
          status: USER_STATUS.EFFECTED,
          performanceLevel: { gt: 0 },
          position: { bonifiable: true },
        },
        select: {
          id: true,
          name: true,
          cpf: true,
          email: true,
          performanceLevel: true,
          position: {
            select: {
              id: true,
              name: true,
              bonifiable: true,
              remunerations: true,
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

      // Create a map of users for quick lookup
      const userMap = new Map(eligibleUsers.map(u => [u.id, u]));

      // For current period: use saved if exists, otherwise use live
      for (const liveBonus of liveData.bonuses) {
        const savedBonus = savedBonusMap.get(liveBonus.userId);
        if (savedBonus) {
          // User has saved bonus - use it but mark as not live
          // Also add the users array for totalCollaborators
          mergedBonuses.push({
            ...savedBonus,
            users: eligibleUsers, // All eligible users in the period
            isLive: false,
          });
        } else {
          // No saved bonus - use live calculation
          const userData = userMap.get(liveBonus.userId);
          mergedBonuses.push({
            id: `live-${liveBonus.userId}-${currentPeriod.year}-${currentPeriod.month}`,
            userId: liveBonus.userId,
            year: currentPeriod.year,
            month: currentPeriod.month,
            baseBonus: liveBonus.baseBonus,
            performanceLevel: liveBonus.performanceLevel,
            user: userData || {
              id: liveBonus.userId,
              name: liveBonus.userName,
              performanceLevel: liveBonus.performanceLevel,
            },
            tasks: liveBonus.tasks,
            bonusDiscounts: [],
            users: eligibleUsers, // All eligible users in the period
            isLive: true,
          });
        }
      }

      // Sort by year, month desc, then by user name
      mergedBonuses.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        if (a.month !== b.month) return b.month - a.month;
        const nameA = a.user?.name || '';
        const nameB = b.user?.name || '';
        return nameA.localeCompare(nameB);
      });

      return {
        success: true,
        data: mergedBonuses,
        meta: {
          ...savedResult.meta,
          totalRecords: mergedBonuses.length,
          currentPeriod,
          isLiveCalculationIncluded: true,
          // Stats computed from live data for transparency
          liveCalculationStats: {
            totalActiveUsers: liveData.totalActiveUsers,
            totalWeightedTasks: liveData.totalWeightedTasks,
          },
        },
        message: 'Bônus carregados com sucesso (incluindo cálculos ao vivo).',
      };
    } catch (error) {
      this.logger.error('Error getting bonuses with live calculation:', error);
      throw new InternalServerErrorException('Erro ao buscar bônus.');
    }
  }

  // =====================
  // Legacy Methods (for backward compatibility)
  // =====================

  /**
   * Get payroll data with live calculated bonuses for the current period
   * @deprecated Use getBonusesWithLiveCalculation instead
   */
  async getPayrollData(
    filters?: {
      year?: string | number;
      month?: string | number | string[];
      includeInactive?: boolean;
    },
    userId?: string,
  ): Promise<any> {
    try {
      const now = new Date();
      let targetYear: number;
      let targetMonth: number;

      if (filters) {
        targetYear = typeof filters.year === 'string' ? parseInt(filters.year) : (filters.year || now.getFullYear());
        const monthValue = Array.isArray(filters.month) ? filters.month[0] : filters.month;
        targetMonth = typeof monthValue === 'string' ? parseInt(monthValue) : (monthValue || now.getMonth() + 1);
      } else {
        targetYear = now.getFullYear();
        targetMonth = now.getMonth() + 1;
      }

      const liveData = await this.calculateLiveBonuses(targetYear, targetMonth);

      // Transform to legacy format
      return {
        year: targetYear.toString(),
        month: targetMonth.toString(),
        bonuses: liveData.bonuses.map(b => ({
          userId: b.userId,
          userName: b.userName,
          positionName: b.positionName,
          performanceLevel: b.performanceLevel,
          bonusValue: b.baseBonus,
          totalTasks: b.tasks.length,
          weightedTaskCount: calculatePonderedTaskCount(b.tasks),
        })),
        totalActiveUsers: liveData.totalActiveUsers,
        averageTasksPerEmployee: liveData.averageTasksPerEmployee,
        calculatedAt: liveData.calculatedAt,
      };
    } catch (error) {
      this.logger.error('Error getting payroll data:', error);
      throw new InternalServerErrorException('Erro ao obter dados da folha de pagamento.');
    }
  }

  /**
   * Calculate and save bonuses for a period.
   * Creates bonus records for ALL active users with payroll numbers.
   * Non-eligible users get bonus value 0 and performance level 0.
   */
  async calculateAndSaveBonuses(
    year: string,
    month: string,
    userId?: string,
  ): Promise<{ totalSuccess: number; totalFailed: number }> {
    try {
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);

      // Get live calculation data for eligible users
      const liveData = await this.calculateLiveBonuses(yearNum, monthNum);

      // Get ALL active users with payroll numbers (not just eligible ones)
      const allActiveUsers = await this.prisma.user.findMany({
        where: {
          status: USER_STATUS.EFFECTED,
          payrollNumber: { not: null },
        },
        select: {
          id: true,
          name: true,
          performanceLevel: true,
          position: {
            select: {
              id: true,
              name: true,
              bonifiable: true,
            },
          },
        },
      });

      let successCount = 0;
      let failedCount = 0;

      // Create a map of eligible user bonuses for quick lookup
      const eligibleBonusMap = new Map<string, LiveBonusData>();
      for (const bonus of liveData.bonuses) {
        eligibleBonusMap.set(bonus.userId, bonus);
      }

      // Calculate period dates from year/month
      const periodStart = getPeriodStart(yearNum, monthNum);
      const periodEnd = getPeriodEnd(yearNum, monthNum);

      // Get all tasks for this period WITH createdById to link to correct user
      const allTasksForPeriod = await this.prisma.task.findMany({
        where: {
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
          finishedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
          status: TASK_STATUS.COMPLETED,
        },
        select: { id: true, createdById: true },
      });

      // Create a map of tasks by createdById for quick lookup
      const tasksByUserId = new Map<string, string[]>();
      for (const task of allTasksForPeriod) {
        if (task.createdById) {
          const userTasks = tasksByUserId.get(task.createdById) || [];
          userTasks.push(task.id);
          tasksByUserId.set(task.createdById, userTasks);
        }
      }

      const allBonusUserIds = liveData.bonuses.map(b => b.userId);

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Create/update bonus for ALL active users with payroll numbers
        for (const user of allActiveUsers) {
          try {
            const eligibleBonus = eligibleBonusMap.get(user.id);
            const isEligible = eligibleBonus !== undefined;

            const existingBonus = await tx.bonus.findFirst({
              where: {
                userId: user.id,
                year: yearNum,
                month: monthNum,
              },
            });

            // Get only this user's tasks
            const userTaskIds = tasksByUserId.get(user.id) || [];

            // Eligible users get calculated values, non-eligible get 0
            const bonusPayload = {
              userId: user.id,
              year: yearNum,
              month: monthNum,
              performanceLevel: isEligible ? eligibleBonus.performanceLevel : 0,
              baseBonus: isEligible ? eligibleBonus.baseBonus : 0,
            };

            if (existingBonus) {
              await tx.bonus.update({
                where: { id: existingBonus.id },
                data: {
                  ...bonusPayload,
                  // Connect only this user's tasks and all eligible users for reference
                  tasks: { set: userTaskIds.map(tid => ({ id: tid })) },
                  users: { set: allBonusUserIds.map(uid => ({ id: uid })) },
                },
              });
            } else {
              await tx.bonus.create({
                data: {
                  ...bonusPayload,
                  // Connect only this user's tasks and all eligible users for reference
                  tasks: { connect: userTaskIds.map(tid => ({ id: tid })) },
                  users: { connect: allBonusUserIds.map(uid => ({ id: uid })) },
                },
              });
            }

            successCount++;
          } catch (error) {
            this.logger.error(`Error saving bonus for user ${user.id}:`, error);
            failedCount++;
          }
        }
      });

      this.logger.log(`Monthly bonus calculation completed: ${successCount} success, ${failedCount} failed (${allActiveUsers.length} total active users)`);

      return { totalSuccess: successCount, totalFailed: failedCount };
    } catch (error) {
      this.logger.error('Error calculating and saving bonuses:', error);
      throw new InternalServerErrorException('Erro ao calcular e salvar bônus mensais.');
    }
  }

  /**
   * @deprecated Use calculateAndSaveBonuses instead
   */
  async saveMonthlyBonuses(year: string, month: string, userId?: string): Promise<{ totalSuccess: number; totalFailed: number }> {
    this.logger.warn('saveMonthlyBonuses is deprecated, redirecting to calculateAndSaveBonuses');
    return this.calculateAndSaveBonuses(year, month, userId);
  }

  /**
   * Get bonus calculation details for debugging/transparency
   */
  getBonusCalculationDetails(performanceLevel: number, weightedTaskCount?: number): any {
    return this.exactBonusCalculationService.getCalculationDetails(
      'DEFAULT',
      performanceLevel,
      weightedTaskCount || 0,
    );
  }
}
