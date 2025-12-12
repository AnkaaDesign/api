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
  netBonus?: number;
  weightedTasks: number;
  rawTaskCount: number; // Task count with suspended as 1.0
  suspendedTasksCount: number;
  suspendedTasksDiscount: number; // Discount from suspended tasks (baseBonus - netBonus)
  tasks: any[];
  averageTasksPerEmployee: number;
  rawAverageTasksPerEmployee: number; // Average with suspended as 1.0
  isLive: true;
}

interface LiveBonusCalculationResult {
  year: number;
  month: number;
  bonuses: LiveBonusData[];
  totalActiveUsers: number;
  totalEligibleUsersForAverage: number; // Users with performanceLevel > 0
  totalWeightedTasks: number;
  totalRawTaskCount: number; // Task count with suspended as 1.0
  totalSuspendedTasks: number;
  averageTasksPerEmployee: number;
  rawAverageTasksPerEmployee: number; // Average with suspended as 1.0
  calculatedAt: Date;
  isLive: true;
}

// =====================
// Utility Functions
// =====================

/**
 * Calculate weighted task count from tasks array
 * FULL_COMMISSION = 1.0, PARTIAL_COMMISSION = 0.5, SUSPENDED_COMMISSION = 0.0
 */
function calculatePonderedTaskCount(tasks: any[]): number {
  if (!tasks || tasks.length === 0) return 0;

  return tasks.reduce((sum, task) => {
    if (task.commission === COMMISSION_STATUS.FULL_COMMISSION) {
      return sum + 1.0;
    } else if (task.commission === COMMISSION_STATUS.PARTIAL_COMMISSION) {
      return sum + 0.5;
    }
    // SUSPENDED_COMMISSION and NO_COMMISSION = 0.0
    return sum;
  }, 0);
}

/**
 * Calculate raw task count for base bonus calculation
 * Treats SUSPENDED_COMMISSION as FULL_COMMISSION (1.0) for base value calculation
 * FULL_COMMISSION = 1.0, PARTIAL_COMMISSION = 0.5, SUSPENDED_COMMISSION = 1.0
 */
function calculateRawTaskCount(tasks: any[]): number {
  if (!tasks || tasks.length === 0) return 0;

  return tasks.reduce((sum, task) => {
    if (task.commission === COMMISSION_STATUS.FULL_COMMISSION) {
      return sum + 1.0;
    } else if (task.commission === COMMISSION_STATUS.PARTIAL_COMMISSION) {
      return sum + 0.5;
    } else if (task.commission === COMMISSION_STATUS.SUSPENDED_COMMISSION) {
      return sum + 1.0; // Suspended tasks count as full for base calculation
    }
    // NO_COMMISSION = 0.0
    return sum;
  }, 0);
}

/**
 * Count suspended tasks in the array
 */
function countSuspendedTasks(tasks: any[]): number {
  if (!tasks || tasks.length === 0) return 0;
  return tasks.filter(task => task.commission === COMMISSION_STATUS.SUSPENDED_COMMISSION).length;
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
   * Find bonus by ID or generate live calculation if composite ID
   * Supports both database UUIDs and composite live IDs (live-{userId}-{year}-{month})
   *
   * IMPORTANT: Returns the SAME data structure for both live and saved bonuses.
   * Frontend doesn't need to know if it's live or saved - data structure is identical.
   */
  async findByIdOrLive(id: string, include?: any, userId?: string): Promise<any> {
    const { isLiveId, parseLiveId } = await import('../../../utils/bonus');

    // Check if it's a live calculation ID
    if (isLiveId(id)) {
      const parsed = parseLiveId(id);
      if (!parsed) {
        throw new BadRequestException(
          'Invalid live bonus ID format. Expected: live-{userId}-{year}-{month}',
        );
      }

      // Calculate live bonus - returns data in EXACT SAME STRUCTURE as saved bonus
      const liveBonus = await this.calculateLiveBonusData(
        parsed.userId,
        parsed.year,
        parsed.month,
      );

      if (!liveBonus) {
        throw new NotFoundException(
          'Unable to calculate live bonus for the specified user and period.',
        );
      }

      // Return bonus directly - structure is identical to saved bonus
      return liveBonus;
    }

    // Regular UUID - fetch from database
    return this.findById(id, include, userId);
  }

  /**
   * Calculate live bonus data for a single user.
   * Returns data in the EXACT SAME STRUCTURE as a saved bonus from database.
   * This allows frontend to use the same code for both live and saved bonuses.
   */
  async calculateLiveBonusData(
    userId: string,
    year: number,
    month: number,
  ): Promise<any> {
    try {
      // First check if saved bonus exists (like payroll does)
      // Note: Bonus model doesn't have a direct position relation
      // Position comes from payroll.position (snapshot) or user.position (current)
      const savedBonus = await this.prisma.bonus.findFirst({
        where: {
          userId,
          year,
          month,
        },
        include: {
          user: {
            include: {
              position: true,
              sector: true,
            },
          },
          // Include payroll to get the position snapshot at bonus creation time
          payroll: {
            include: {
              position: true,
            },
          },
          tasks: {
            include: {
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
          },
          bonusDiscounts: {
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
        },
      });

      // If saved bonus exists, return it with position from payroll (snapshot) or user (fallback)
      if (savedBonus) {
        this.logger.log(`Returning saved bonus for user ${userId.slice(0, 8)}`);
        // Position priority: payroll.position (snapshot at bonus creation) > user.position (current)
        const position = savedBonus.payroll?.position || savedBonus.user?.position || null;
        return {
          ...savedBonus,
          // Add position field for frontend consistency
          position,
        };
      }

      // ========================================================================
      // NO SAVED BONUS - CALCULATE LIVE
      // Returns data in the EXACT SAME STRUCTURE as saved bonus from database
      // ========================================================================

      this.logger.log(`Calculating live bonus for user ${userId.slice(0, 8)} for ${month}/${year}`);

      // Fetch user with all required relations
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          position: true,
          sector: true,
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      // Check if user is bonifiable
      if (!user.position?.bonifiable) {
        throw new BadRequestException('Usuário não está em um cargo bonificável.');
      }

      // Get live calculation for all users to get period-level data
      const liveData = await this.calculateLiveBonuses(year, month);

      // Find this user's bonus in the calculated list
      const userLiveBonus = liveData.bonuses.find(b => b.userId === userId);

      // Format current date for createdAt/updatedAt (same as saved bonus)
      const now = new Date();

      // Get all eligible users for the users relation
      const allEligibleUsers = liveData.bonuses.map(b => ({
        id: b.userId,
        name: b.userName,
      }));

      // ========================================================================
      // BUILD LIVE BONUS IN EXACT SAME STRUCTURE AS SAVED BONUS
      // ========================================================================
      // This structure matches what Prisma returns for a saved bonus with includes
      // For live bonus, position comes from current user.position (real-time)
      // Note: Period dates are NOT stored - they can be calculated from year/month
      // Period is always: 26th of (month-1) to 25th of (month)

      // Build "Tarefas Suspensas" discount if applicable
      const suspendedTasksDiscount = userLiveBonus?.suspendedTasksDiscount || 0;
      const bonusDiscounts: any[] = [];

      if (suspendedTasksDiscount > 0 && liveData.totalSuspendedTasks > 0) {
        bonusDiscounts.push({
          id: `live-discount-suspended-${userId}-${year}-${month}`,
          bonusId: `live-${userId}-${year}-${month}`,
          reference: 'Tarefas Suspensas',
          value: suspendedTasksDiscount,
          percentage: null,
          calculationOrder: 1,
          suspendedTasks: (userLiveBonus?.tasks || []).filter(
            (t: any) => t.commission === COMMISSION_STATUS.SUSPENDED_COMMISSION,
          ),
        });
      }

      const liveBonus = {
        // Core bonus fields (same as database columns)
        id: `live-${userId}-${year}-${month}`,
        userId,
        year,
        month,
        performanceLevel: userLiveBonus?.performanceLevel || user.performanceLevel || 0,
        baseBonus: userLiveBonus?.baseBonus || 0,
        netBonus: userLiveBonus?.netBonus || userLiveBonus?.baseBonus || 0,
        weightedTasks: liveData.totalWeightedTasks,
        averageTaskPerUser: liveData.averageTasksPerEmployee,
        payrollId: null,

        // Timestamps (same structure as saved bonus)
        createdAt: now,
        updatedAt: now,

        // ========================================================================
        // RELATIONS (same structure as Prisma includes)
        // ========================================================================

        // User relation (same as saved bonus with include)
        user: {
          id: user.id,
          name: user.name,
          performanceLevel: user.performanceLevel,
          position: user.position,
          sector: user.sector,
        },

        // Position field for frontend consistency
        // For live bonus, use current user position (real-time value)
        position: user.position,

        // Tasks relation (same structure as saved bonus with include)
        // ALL users share the same task pool
        tasks: (userLiveBonus?.tasks || []).map((task: any) => ({
          id: task.id,
          name: task.name,
          status: task.status,
          finishedAt: task.finishedAt,
          commission: task.commission,
          customer: task.customer || null,
          sector: task.sector || null,
        })),

        // BonusDiscounts relation - includes "Tarefas Suspensas" if applicable
        bonusDiscounts,

        // Users relation (all bonifiable users for this period)
        users: allEligibleUsers,
      };

      this.logger.log(
        `Live bonus calculated for user ${userId.slice(0, 8)}: R$ ${liveBonus.baseBonus}`,
      );

      return liveBonus;
    } catch (error) {
      this.logger.error(`Error calculating live bonus data for user ${userId}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao calcular bônus.');
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

      if (filters?.year)
        where.year = typeof filters.year === 'string' ? parseInt(filters.year) : filters.year;
      if (filters?.month)
        where.month = typeof filters.month === 'string' ? parseInt(filters.month) : filters.month;
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
          orderBy: [{ year: 'desc' }, { month: 'desc' }, { user: { name: 'asc' } }],
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
   * Find many bonuses with proper Prisma where clause support
   * This method handles complex where clauses like { month: { in: [11] } }
   */
  async findManyWithWhere(filters: {
    where?: any;
    skip?: number;
    take?: number;
    include?: any;
    orderBy?: any;
  }): Promise<any> {
    try {
      const defaultInclude = filters?.include || {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        // Include payroll to get position snapshot at bonus creation time
        payroll: {
          include: {
            position: true,
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

      const skip = filters?.skip || 0;
      const take = filters?.take || 200; // Higher default for monthly views

      const [rawBonuses, total] = await Promise.all([
        this.prisma.bonus.findMany({
          where: filters.where,
          skip,
          take,
          include: defaultInclude,
          orderBy: filters.orderBy || [{ year: 'desc' }, { month: 'desc' }, { user: { name: 'asc' } }],
        }),
        this.prisma.bonus.count({ where: filters.where }),
      ]);

      // Add position field to each bonus (from payroll snapshot or user current)
      const bonuses = rawBonuses.map((bonus: any) => ({
        ...bonus,
        // Position priority: payroll.position (snapshot) > user.position (current)
        position: bonus.payroll?.position || bonus.user?.position || null,
      }));

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
      this.logger.error('Error finding bonuses with where:', error);
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
            netBonus: data.baseBonus, // Initially same, will be updated after discounts
            weightedTasks: 0, // Will be calculated/updated separately
            averageTaskPerUser: 0, // Will be calculated/updated separately
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
            netBonus: data.baseBonus, // Update netBonus when baseBonus changes
            performanceLevel: data.performanceLevel,
            payrollId: data.payrollId,
            // Note: weightedTasks and averageTaskByUser should be set via bulk calculation
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

  async batchUpdate(
    data: { updates: { id: string; data: any }[] },
    userId: string,
  ): Promise<{ totalSuccess: number; totalFailed: number; data: any[] }> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const update of data.updates) {
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

  // =====================
  // Discount Management
  // =====================

  async createDiscount(
    bonusId: string,
    data: { reason: string; percentage: number },
    userId?: string,
  ): Promise<any> {
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
   * NEW WORKFLOW:
   * 1. Get ALL tasks (including SUSPENDED_COMMISSION)
   * 2. Calculate RAW task count (suspended = 1.0) for BASE bonus calculation
   * 3. Calculate WEIGHTED task count (suspended = 0.0) for NET bonus calculation
   * 4. BASE bonus = calculated with raw average
   * 5. NET bonus = calculated with weighted average
   * 6. DISCOUNT "Tarefas Suspensas" = BASE - NET
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

      this.logger.log(
        `Calculating live bonuses for ${month}/${year} (${startDate.toISOString()} to ${endDate.toISOString()})`,
      );

      // Get ALL bonifiable users (including performanceLevel = 0)
      // We need all of them for display, but only those with performanceLevel > 0 count for the average
      const allBonifiableUsers = await this.prisma.user.findMany({
        where: {
          status: USER_STATUS.EFFECTED,
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

      // Get ALL tasks in the period (including SUSPENDED_COMMISSION for base calculation)
      const allTasks = await this.prisma.task.findMany({
        where: {
          commission: {
            in: [
              COMMISSION_STATUS.FULL_COMMISSION,
              COMMISSION_STATUS.PARTIAL_COMMISSION,
              COMMISSION_STATUS.SUSPENDED_COMMISSION,
            ],
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

      // Calculate RAW task count (suspended = 1.0) for BASE bonus
      const totalRawTaskCount = calculateRawTaskCount(allTasks);

      // Calculate WEIGHTED task count (suspended = 0.0) for NET bonus
      const totalWeightedTasks = calculatePonderedTaskCount(allTasks);

      // Count suspended tasks
      const totalSuspendedTasks = countSuspendedTasks(allTasks);

      // For average calculation, only count users with performanceLevel > 0
      // (this is the divisor in the bonus formula)
      const usersWithPerformance = allBonifiableUsers.filter(u => u.performanceLevel > 0);
      const totalEligibleUsers = usersWithPerformance.length;

      // Calculate RAW average (for BASE bonus - includes suspended as 1.0)
      const rawAverageTasksPerUser =
        totalEligibleUsers > 0 ? roundAverage(totalRawTaskCount / totalEligibleUsers) : 0;

      // Calculate WEIGHTED average (for NET bonus - suspended = 0.0)
      const averageTasksPerUser =
        totalEligibleUsers > 0 ? roundAverage(totalWeightedTasks / totalEligibleUsers) : 0;

      this.logger.log(
        `Period ${month}/${year}: RAW ${totalRawTaskCount} tasks (raw avg: ${rawAverageTasksPerUser.toFixed(2)}) | WEIGHTED ${totalWeightedTasks} tasks (weighted avg: ${averageTasksPerUser.toFixed(2)}) | ${totalSuspendedTasks} suspended tasks | ${totalEligibleUsers} eligible users`,
      );

      // Calculate bonus for ALL bonifiable users (including performanceLevel = 0)
      // Users with performanceLevel = 0 will get baseBonus = 0 but still have all other data
      // IMPORTANT: All users share the SAME pool of tasks - individual bonus is based on position/performance only
      const bonuses: LiveBonusData[] = allBonifiableUsers.map(user => {
        const positionName = user.position?.name || 'DEFAULT';

        // Calculate BASE bonus using RAW average (suspended = 1.0)
        const baseBonusValue = this.exactBonusCalculationService.calculateBonus(
          positionName,
          user.performanceLevel,
          rawAverageTasksPerUser,
        );

        // Calculate NET bonus using WEIGHTED average (suspended = 0.0)
        const calculatedNetBonus = this.exactBonusCalculationService.calculateBonus(
          positionName,
          user.performanceLevel,
          averageTasksPerUser,
        );

        // Net bonus should not exceed base bonus (edge case at very low averages due to polynomial)
        // Users should NOT benefit from suspended tasks
        const netBonusValue = Math.min(baseBonusValue, calculatedNetBonus);

        // Calculate discount from suspended tasks (always >= 0)
        const suspendedTasksDiscount = roundCurrency(
          Math.max(0, roundCurrency(baseBonusValue) - roundCurrency(netBonusValue)),
        );

        // ALL users share the same tasks pool - this is how the bonus system works
        // The weighted tasks and average are period-level, not user-level
        return {
          userId: user.id,
          userName: user.name,
          positionName,
          performanceLevel: user.performanceLevel,
          baseBonus: roundCurrency(baseBonusValue),
          netBonus: roundCurrency(netBonusValue),
          weightedTasks: totalWeightedTasks,
          rawTaskCount: totalRawTaskCount,
          suspendedTasksCount: totalSuspendedTasks,
          suspendedTasksDiscount,
          tasks: allTasks,
          averageTasksPerEmployee: averageTasksPerUser,
          rawAverageTasksPerEmployee: rawAverageTasksPerUser,
          isLive: true as const,
        };
      });

      return {
        year,
        month,
        bonuses,
        totalActiveUsers: allBonifiableUsers.length,
        totalEligibleUsersForAverage: totalEligibleUsers,
        totalWeightedTasks,
        totalRawTaskCount,
        totalSuspendedTasks,
        averageTasksPerEmployee: averageTasksPerUser,
        rawAverageTasksPerEmployee: rawAverageTasksPerUser,
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
   *
   * Now that calculateLiveBonuses includes ALL bonifiable users (including performanceLevel = 0),
   * this method simply finds the user in the calculated list.
   * Returns null only if user is not bonifiable or not found.
   */
  async calculateLiveBonusForUser(
    userId: string,
    year: number,
    month: number,
  ): Promise<LiveBonusData | null> {
    try {
      // Get all live calculations - now includes ALL bonifiable users
      const liveData = await this.calculateLiveBonuses(year, month);

      // Find this user's bonus in the calculated list
      const userBonus = liveData.bonuses.find(b => b.userId === userId);

      // Return the bonus (or null if user is not bonifiable/not found)
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
    where?: any;
    skip?: number;
    take?: number;
    include?: any;
    orderBy?: any;
  }): Promise<any> {
    try {
      const currentPeriod = getCurrentPeriod();
      const filterYear = filters.where?.year;
      const filterMonth = filters.where?.month;

      // Extract month values from filter (handles both { in: [11] } and direct number)
      const filterMonthValues = Array.isArray(filterMonth?.in)
        ? filterMonth.in
        : (typeof filterMonth === 'number' ? [filterMonth] : undefined);

      // Check if filter includes current period
      const includesCurrentPeriod = filterIncludesCurrentPeriod(
        filterYear,
        filterMonthValues,
      );

      // If not querying current period, just return saved data directly from repository
      if (!includesCurrentPeriod) {
        return this.findManyWithWhere(filters);
      }

      // Get saved bonuses from database using proper where clause
      const savedResult = await this.findManyWithWhere(filters);

      // Calculate live bonuses for current period
      const liveData = await this.calculateLiveBonuses(currentPeriod.year, currentPeriod.month);

      // Create a map of saved bonuses for current period by userId for quick lookup
      const savedBonusMap = new Map<string, any>();
      if (savedResult.data) {
        for (const bonus of savedResult.data) {
          if (bonus.year === currentPeriod.year && bonus.month === currentPeriod.month) {
            savedBonusMap.set(bonus.userId, bonus);
          }
        }
      }

      // Merge: combine saved data with live calculations for current period
      const mergedBonuses: any[] = [];

      // Add saved bonuses that are NOT for current period (for multi-period queries)
      // These are returned as-is from the database with proper filtering already applied
      if (savedResult.data) {
        for (const bonus of savedResult.data) {
          if (bonus.year !== currentPeriod.year || bonus.month !== currentPeriod.month) {
            mergedBonuses.push(bonus);
          }
        }
      }

      // Check if the filter specifically requests only the current period
      // If filtering for current period only, we don't add old bonuses
      const isFilteringOnlyCurrentPeriod =
        filterYear === currentPeriod.year &&
        filterMonthValues?.length === 1 &&
        filterMonthValues[0] === currentPeriod.month;

      // Get ALL users with bonifiable positions (like payroll does for all users)
      // This ensures we show data even for users with performanceLevel = 0
      const allBonifiableUsers = await this.prisma.user.findMany({
        where: {
          status: USER_STATUS.EFFECTED,
          position: { bonifiable: true },
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

      // Create a map of live bonuses by userId for quick lookup
      const liveBonusMap = new Map(liveData.bonuses.map(b => [b.userId, b]));

      // Extract filters from where clause
      const userFilters = filters.where?.user || {};
      const sectorFilter = userFilters.sectorId?.in || [];
      const positionFilter = userFilters.positionId?.in || [];

      // For current period: iterate over ALL bonifiable users (like payroll does)
      for (const user of allBonifiableUsers) {
        // Apply sector filter
        if (sectorFilter.length > 0 && !sectorFilter.includes(user.sector?.id)) {
          continue;
        }

        // Apply position filter
        if (positionFilter.length > 0 && !positionFilter.includes(user.position?.id)) {
          continue;
        }

        const savedBonus = savedBonusMap.get(user.id);
        const liveBonus = liveBonusMap.get(user.id);

        // Format current date for createdAt/updatedAt (same as saved bonus)
        const now = new Date();

        // Get all eligible user IDs for the users relation
        const allEligibleUserRefs = liveData.bonuses.map(b => ({
          id: b.userId,
          name: b.userName,
        }));

        if (savedBonus) {
          // User has saved bonus - use it
          // Position comes from payroll snapshot or user current (already added by findManyWithWhere)
          mergedBonuses.push({
            ...savedBonus,
            users: savedBonus.users || allEligibleUserRefs,
            // Ensure position is set (from payroll snapshot or user current)
            position: savedBonus.position || savedBonus.payroll?.position || savedBonus.user?.position || user.position,
          });
        } else if (liveBonus) {
          // No saved bonus but has live calculation
          // BUILD LIVE BONUS IN EXACT SAME STRUCTURE AS SAVED BONUS

          // Build "Tarefas Suspensas" discount if applicable
          const suspendedTasksDiscount = liveBonus.suspendedTasksDiscount || 0;
          const liveBonusDiscounts: any[] = [];

          if (suspendedTasksDiscount > 0) {
            liveBonusDiscounts.push({
              id: `live-discount-suspended-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
              bonusId: `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
              reference: 'Tarefas Suspensas',
              value: suspendedTasksDiscount,
              percentage: null,
              calculationOrder: 1,
            });
          }

          mergedBonuses.push({
            // Core bonus fields (same as database columns)
            id: `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
            userId: user.id,
            year: currentPeriod.year,
            month: currentPeriod.month,
            performanceLevel: liveBonus.performanceLevel,
            baseBonus: liveBonus.baseBonus,
            netBonus: liveBonus.netBonus || liveBonus.baseBonus, // Use calculated netBonus
            weightedTasks: liveData.totalWeightedTasks,
            averageTaskPerUser: liveData.averageTasksPerEmployee,
            payrollId: null,

            // Timestamps (same structure as saved bonus)
            createdAt: now,
            updatedAt: now,

            // Relations (same structure as Prisma includes)
            user: user,
            position: user.position,
            tasks: (liveBonus.tasks || []).map((task: any) => ({
              id: task.id,
              name: task.name,
              status: task.status,
              finishedAt: task.finishedAt,
              commission: task.commission,
              customer: task.customer || null,
              sector: task.sector || null,
            })),
            bonusDiscounts: liveBonusDiscounts,
            users: allEligibleUserRefs,
          });
        } else {
          // No saved bonus and no live calculation (performanceLevel = 0)
          // Still show the user with zero bonus - SAME STRUCTURE
          mergedBonuses.push({
            // Core bonus fields (same as database columns)
            id: `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
            userId: user.id,
            year: currentPeriod.year,
            month: currentPeriod.month,
            performanceLevel: user.performanceLevel || 0,
            baseBonus: 0,
            netBonus: 0,
            weightedTasks: liveData.totalWeightedTasks,
            averageTaskPerUser: liveData.averageTasksPerEmployee,
            payrollId: null,

            // Timestamps (same structure as saved bonus)
            createdAt: now,
            updatedAt: now,

            // Relations (same structure as Prisma includes)
            user: user,
            position: user.position,
            tasks: [], // No tasks for performanceLevel = 0
            bonusDiscounts: [],
            users: allEligibleUserRefs,
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

  /**
   * Calculate and save bonuses for a period.
   * Creates bonus records for ALL active users with payroll numbers.
   * Non-eligible users get bonus value 0 and performance level 0.
   *
   * NEW WORKFLOW:
   * 1. Get ALL tasks (including SUSPENDED_COMMISSION)
   * 2. Calculate RAW task count (suspended = 1.0) for BASE bonus calculation
   * 3. Calculate WEIGHTED task count (suspended = 0.0) for NET bonus calculation
   * 4. BASE bonus = calculated with raw average
   * 5. NET bonus = calculated with weighted average
   * 6. Create DISCOUNT "Tarefas Suspensas" = BASE - NET (as fixed value discount)
   */
  async calculateAndSaveBonuses(
    year: string,
    month: string,
    userId?: string,
  ): Promise<{ totalSuccess: number; totalFailed: number }> {
    try {
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);

      // Get live calculation data for eligible users (now includes suspended task calculations)
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

      // Get all tasks for this period (including suspended) - ALL users share the same task pool
      const allTasksForPeriod = await this.prisma.task.findMany({
        where: {
          commission: {
            in: [
              COMMISSION_STATUS.FULL_COMMISSION,
              COMMISSION_STATUS.PARTIAL_COMMISSION,
              COMMISSION_STATUS.SUSPENDED_COMMISSION,
            ],
          },
          finishedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
          status: TASK_STATUS.COMPLETED,
        },
        select: { id: true, commission: true },
      });

      // Get suspended task IDs for linking to discounts
      const suspendedTaskIds = allTasksForPeriod
        .filter(t => t.commission === COMMISSION_STATUS.SUSPENDED_COMMISSION)
        .map(t => t.id);

      // All task IDs for connecting to bonuses (same for all users)
      const allTaskIds = allTasksForPeriod.map(t => t.id);
      const allBonusUserIds = liveData.bonuses.map(b => b.userId);

      // Period-level values (same for all users)
      const totalWeightedTasks = liveData.totalWeightedTasks;
      const averageTasksPerUser = liveData.averageTasksPerEmployee;

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
              include: {
                bonusDiscounts: true,
              },
            });

            // Eligible users get calculated values, non-eligible get 0
            const baseBonus = isEligible ? eligibleBonus.baseBonus : 0;
            const netBonus = isEligible ? (eligibleBonus.netBonus || eligibleBonus.baseBonus) : 0;
            const suspendedTasksDiscount = isEligible ? eligibleBonus.suspendedTasksDiscount : 0;

            // All users share the same period-level data
            const bonusPayload = {
              userId: user.id,
              year: yearNum,
              month: monthNum,
              performanceLevel: isEligible ? eligibleBonus.performanceLevel : 0,
              baseBonus,
              netBonus, // Net bonus after suspended tasks discount
              weightedTasks: totalWeightedTasks,
              averageTaskPerUser: averageTasksPerUser,
            };

            let bonusId: string;

            if (existingBonus) {
              await tx.bonus.update({
                where: { id: existingBonus.id },
                data: {
                  ...bonusPayload,
                  // Connect ALL period tasks and ALL eligible users (same for all bonuses)
                  tasks: { set: allTaskIds.map(tid => ({ id: tid })) },
                  users: { set: allBonusUserIds.map(uid => ({ id: uid })) },
                },
              });
              bonusId = existingBonus.id;

              // Delete existing "Tarefas Suspensas" discount to recreate it
              await tx.bonusDiscount.deleteMany({
                where: {
                  bonusId: existingBonus.id,
                  reference: 'Tarefas Suspensas',
                },
              });
            } else {
              const newBonus = await tx.bonus.create({
                data: {
                  ...bonusPayload,
                  // Connect ALL period tasks and ALL eligible users (same for all bonuses)
                  tasks: { connect: allTaskIds.map(tid => ({ id: tid })) },
                  users: { connect: allBonusUserIds.map(uid => ({ id: uid })) },
                },
              });
              bonusId = newBonus.id;
            }

            // Create "Tarefas Suspensas" discount if there's a discount value and suspended tasks
            if (suspendedTasksDiscount > 0 && suspendedTaskIds.length > 0) {
              const discount = await tx.bonusDiscount.create({
                data: {
                  bonusId,
                  reference: 'Tarefas Suspensas',
                  value: suspendedTasksDiscount,
                  percentage: null,
                  calculationOrder: 1,
                },
              });

              // Link suspended tasks to this discount
              await tx.task.updateMany({
                where: {
                  id: { in: suspendedTaskIds },
                },
                data: {
                  bonusDiscountId: discount.id,
                },
              });

              this.logger.debug(
                `Created "Tarefas Suspensas" discount for user ${user.name}: R$ ${suspendedTasksDiscount.toFixed(2)} (${suspendedTaskIds.length} tasks)`,
              );
            }

            successCount++;
          } catch (error) {
            this.logger.error(`Error saving bonus for user ${user.id}:`, error);
            failedCount++;
          }
        }
      });

      this.logger.log(
        `Monthly bonus calculation completed: ${successCount} success, ${failedCount} failed (${allActiveUsers.length} total active users). Suspended tasks: ${suspendedTaskIds.length}`,
      );

      return { totalSuccess: successCount, totalFailed: failedCount };
    } catch (error) {
      this.logger.error('Error calculating and saving bonuses:', error);
      throw new InternalServerErrorException('Erro ao calcular e salvar bônus mensais.');
    }
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
