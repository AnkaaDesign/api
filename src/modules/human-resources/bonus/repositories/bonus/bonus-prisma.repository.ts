// repositories/bonus-prisma.repository.ts

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  BonusRepository,
  Bonus,
  BonusCreateFormData,
  BonusUpdateFormData,
  BonusInclude,
  BonusOrderBy,
  BonusWhere,
} from './bonus.repository';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
  BatchCreateResult,
  CreateManyOptions,
  BatchError,
} from '../../../../../types';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, Bonus as PrismaBonus } from '@prisma/client';
import { ExactBonusCalculationService } from '../../exact-bonus-calculation.service';
import {
  COMMISSION_STATUS,
  TASK_STATUS,
  ACTIVE_USER_STATUSES,
} from '../../../../../constants/enums';

interface BonusPeriodFilter {
  year?: number;
  month?: number;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
}

interface LiveBonusData {
  userId: string;
  year: number;
  month: number;
  performanceLevel: number;
  baseBonus: number;
  tasks?: any[];
  payrollId?: string;
}

@Injectable()
export class BonusPrismaRepository
  extends BaseStringPrismaRepository<
    Bonus,
    BonusCreateFormData,
    BonusUpdateFormData,
    BonusInclude,
    BonusOrderBy,
    BonusWhere,
    PrismaBonus,
    Prisma.BonusCreateInput,
    Prisma.BonusUpdateInput,
    Prisma.BonusInclude,
    Prisma.BonusOrderByWithRelationInput,
    Prisma.BonusWhereInput
  >
  implements BonusRepository
{
  protected readonly logger = new Logger(BonusPrismaRepository.name);

  constructor(
    protected readonly prisma: PrismaService,
    private readonly bonusCalculationService: ExactBonusCalculationService,
  ) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaBonus): Bonus {
    return {
      ...databaseEntity,
      baseBonus: Number(databaseEntity.baseBonus),
      netBonus: Number(databaseEntity.netBonus),
      weightedTasks: Number(databaseEntity.weightedTasks),
      averageTaskPerUser: Number(databaseEntity.averageTaskPerUser),
    } as Bonus;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    data: BonusCreateFormData,
  ): Prisma.BonusCreateInput {
    return {
      year: data.year,
      month: data.month,
      performanceLevel: data.performanceLevel,
      baseBonus: data.baseBonus,
      user: {
        connect: { id: data.userId },
      },
      ...(data.payrollId && {
        payroll: {
          connect: { id: data.payrollId },
        },
      }),
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    data: BonusUpdateFormData,
  ): Prisma.BonusUpdateInput {
    return {
      ...(data.baseBonus !== undefined && { baseBonus: data.baseBonus }),
      ...(data.performanceLevel !== undefined && { performanceLevel: data.performanceLevel }),
      ...(data.payrollId !== undefined && {
        payroll: data.payrollId ? { connect: { id: data.payrollId } } : { disconnect: true },
      }),
    };
  }

  protected mapIncludeToDatabaseInclude(include?: BonusInclude): Prisma.BonusInclude | undefined {
    if (!include) return undefined;

    return {
      ...(include.user && {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            cpf: true,
            performanceLevel: true,
            position: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      }),
      ...(include.bonusDiscounts && {
        bonusDiscounts: {
          orderBy: { calculationOrder: 'asc' },
          select: {
            id: true,
            percentage: true,
            value: true,
            reference: true,
            calculationOrder: true,
            createdAt: true,
          },
        },
      }),
      ...(include.bonusExtras && {
        bonusExtras: {
          orderBy: { calculationOrder: 'asc' },
          select: {
            id: true,
            percentage: true,
            value: true,
            reference: true,
            calculationOrder: true,
            createdAt: true,
          },
        },
      }),
      ...(include.payroll && {
        payroll: {
          select: {
            id: true,
            year: true,
            month: true,
          },
        },
      }),
      ...(include.tasks && {
        tasks:
          typeof include.tasks === 'boolean'
            ? true // Simple include, get all task fields
            : include.tasks, // Pass through nested include structure from frontend
      }),
    };
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: BonusOrderBy,
  ): Prisma.BonusOrderByWithRelationInput | undefined {
    // Default ordering
    if (!orderBy) return { year: 'desc' };

    // If it's already an array, return first item
    if (Array.isArray(orderBy)) {
      return orderBy[0] as Prisma.BonusOrderByWithRelationInput;
    }

    // Build orderBy from input
    const result: Record<string, any> = {};
    if (orderBy.year) result.year = orderBy.year;
    if (orderBy.month) result.month = orderBy.month;
    if (orderBy.baseBonus) result.baseBonus = orderBy.baseBonus;
    if (orderBy.performanceLevel) result.performanceLevel = orderBy.performanceLevel;
    if (orderBy.createdAt) result.createdAt = orderBy.createdAt;
    if (orderBy.user) result.user = { name: orderBy.user.name };

    return result as Prisma.BonusOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: BonusWhere): Prisma.BonusWhereInput | undefined {
    if (!where) return undefined;

    return {
      ...(where.userId && { userId: where.userId }),
      ...(where.year && this.buildNumberFilter(where.year, 'year')),
      ...(where.month && this.buildNumberFilter(where.month, 'month')),
      ...(where.baseBonus && { baseBonus: where.baseBonus }),
      ...(where.performanceLevel &&
        this.buildNumberFilter(where.performanceLevel, 'performanceLevel')),
      ...(where.payrollId && { payrollId: where.payrollId }),
      ...(where.user && {
        user: {
          ...(where.user.name && {
            name: {
              contains: where.user.name.contains,
              mode: where.user.name.mode as 'insensitive' | undefined,
            },
          }),
        },
      }),
      ...(where.payroll && {
        payroll: {
          ...(where.payroll.id && { id: where.payroll.id }),
        },
      }),
    };
  }

  protected getDefaultInclude(): Prisma.BonusInclude | undefined {
    return undefined;
  }

  private buildNumberFilter(filter: number | { gte?: number; lte?: number }, field: string): any {
    if (typeof filter === 'number') {
      return { [field]: filter };
    }
    return {
      [field]: {
        ...(filter.gte !== undefined && { gte: filter.gte }),
        ...(filter.lte !== undefined && { lte: filter.lte }),
      },
    };
  }

  // Prisma model name for base repository
  protected get modelName() {
    return 'bonus' as const;
  }

  // Get the Prisma model delegate
  protected get model() {
    return this.prisma.bonus;
  }

  // Transaction-aware model delegate
  protected getModel(tx?: PrismaTransaction) {
    return tx ? tx.bonus : this.prisma.bonus;
  }

  /**
   * Find many bonuses with proper filtering by user, month, year, and period
   */
  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<BonusOrderBy, BonusWhere, BonusInclude>,
  ): Promise<FindManyResult<Bonus>> {
    try {
      const { where, include, orderBy, skip = 0, take = 50 } = options || {};

      const prismaWhere = this.mapWhereToDatabaseWhere(where);
      const prismaInclude = this.mapIncludeToDatabaseInclude(include);
      const prismaOrderBy = this.mapOrderByToDatabaseOrderBy(orderBy);

      const model = this.getModel(transaction);

      const [bonuses, total] = await Promise.all([
        model.findMany({
          where: prismaWhere,
          include: prismaInclude,
          orderBy: prismaOrderBy,
          skip,
          take,
        }),
        model.count({ where: prismaWhere }),
      ]);

      const mappedBonuses = bonuses.map(bonus => this.mapDatabaseEntityToEntity(bonus));

      return {
        data: mappedBonuses,
        meta: {
          totalRecords: total,
          page: Math.floor(skip / take) + 1,
          take,
          totalPages: Math.ceil(total / take),
          hasNextPage: skip + bonuses.length < total,
          hasPreviousPage: skip > 0,
        },
      };
    } catch (error) {
      this.logger.error('Error finding bonuses:', error);
      throw new BadRequestException('Erro ao buscar bônus.');
    }
  }

  /**
   * Find specific bonus for user and period
   */
  async findByUserAndPeriod(
    userId: string,
    year: string,
    month: string,
    include?: BonusInclude,
    tx?: PrismaTransaction,
  ): Promise<Bonus | null> {
    try {
      const model = this.getModel(tx);
      const prismaInclude = this.mapIncludeToDatabaseInclude(include);

      const bonus = await model.findFirst({
        where: {
          userId,
          year: parseInt(year, 10),
          month: parseInt(month, 10),
        },
        include: prismaInclude,
      });

      return bonus ? this.mapDatabaseEntityToEntity(bonus) : null;
    } catch (error) {
      this.logger.error(
        `Error finding bonus for user ${userId} and period ${month}/${year}:`,
        error,
      );
      throw new BadRequestException('Erro ao buscar bônus por usuário e período.');
    }
  }

  /**
   * Find all bonuses for a specific period
   */
  async findByPeriod(
    year: string,
    month: string,
    include?: BonusInclude,
    tx?: PrismaTransaction,
  ): Promise<Bonus[]> {
    try {
      const model = this.getModel(tx);
      const prismaInclude = this.mapIncludeToDatabaseInclude(include);

      const bonuses = await model.findMany({
        where: {
          year: parseInt(year, 10),
          month: parseInt(month, 10),
        },
        include: prismaInclude,
        orderBy: { createdAt: 'desc' },
      });

      return bonuses.map(bonus => this.mapDatabaseEntityToEntity(bonus));
    } catch (error) {
      this.logger.error(`Error finding bonuses for period ${month}/${year}:`, error);
      throw new BadRequestException('Erro ao buscar bônus por período.');
    }
  }

  /**
   * Create bonus with all calculated fields
   */
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: BonusCreateFormData,
    options?: CreateOptions<BonusInclude>,
  ): Promise<Bonus> {
    try {
      const { include } = options || {};
      const model = this.getModel(transaction);

      // Validate user exists and has performance level
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
        select: {
          id: true,
          name: true,
          performanceLevel: true,
          position: { select: { name: true } },
        },
      });

      if (!user) {
        throw new NotFoundException(`Usuário ${data.userId} não encontrado.`);
      }

      if (user.performanceLevel <= 0) {
        throw new BadRequestException(
          `Usuário ${user.name} não tem nível de performance válido para bônus.`,
        );
      }

      // Check for existing bonus in the same period
      const existingBonus = await this.findByUserAndPeriod(
        data.userId,
        data.year.toString(),
        data.month.toString(),
        undefined,
        transaction,
      );
      if (existingBonus) {
        throw new BadRequestException(
          `Bônus já existe para ${user.name} no período ${data.month}/${data.year}.`,
        );
      }

      // Calculate bonus using the calculation service if not provided
      let calculatedData = { ...data };
      if (!data.baseBonus || data.baseBonus === 0) {
        const { averageTasksPerUser } = await this.calculatePeriodMetrics(
          data.year,
          data.month,
          transaction,
        );

        const bonusValue = this.bonusCalculationService.calculateBonus(
          user.position?.name || 'DEFAULT',
          user.performanceLevel,
          averageTasksPerUser,
        );

        calculatedData = {
          ...data,
          baseBonus: bonusValue,
        };
      }

      const prismaCreateInput = this.mapCreateFormDataToDatabaseCreateInput(calculatedData);
      const prismaInclude = this.mapIncludeToDatabaseInclude(include);

      const createdBonus = await model.create({
        data: prismaCreateInput,
        include: prismaInclude,
      });

      this.logger.log(
        `Created bonus for user ${user.name} (${data.userId}) - ${data.month}/${data.year}: R$ ${calculatedData.baseBonus}`,
      );

      return this.mapDatabaseEntityToEntity(createdBonus);
    } catch (error) {
      this.logger.error('Error creating bonus:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao criar bônus.');
    }
  }

  /**
   * Update bonus record
   */
  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: BonusUpdateFormData,
    options?: UpdateOptions<BonusInclude>,
  ): Promise<Bonus> {
    try {
      const { include } = options || {};
      const model = this.getModel(transaction);

      // Verify bonus exists
      const existingBonus = await model.findUnique({
        where: { id },
        select: { id: true, userId: true, year: true, month: true },
      });

      if (!existingBonus) {
        throw new NotFoundException(`Bônus ${id} não encontrado.`);
      }

      const prismaUpdateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const prismaInclude = this.mapIncludeToDatabaseInclude(include);

      const updatedBonus = await model.update({
        where: { id },
        data: prismaUpdateInput,
        include: prismaInclude,
      });

      this.logger.log(
        `Updated bonus ${id} for period ${existingBonus.month}/${existingBonus.year}`,
      );

      return this.mapDatabaseEntityToEntity(updatedBonus);
    } catch (error) {
      this.logger.error('Error updating bonus:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Erro ao atualizar bônus.');
    }
  }

  /**
   * Delete bonus
   */
  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Bonus> {
    try {
      const model = this.getModel(transaction);

      const bonus = await model.findUnique({
        where: { id },
        select: { id: true, userId: true, year: true, month: true },
      });

      if (!bonus) {
        throw new NotFoundException(`Bônus ${id} não encontrado.`);
      }

      const deletedBonus = await model.delete({
        where: { id },
      });

      this.logger.log(`Deleted bonus ${id} for period ${bonus.month}/${bonus.year}`);

      return this.mapDatabaseEntityToEntity(deletedBonus);
    } catch (error) {
      this.logger.error('Error deleting bonus:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Erro ao deletar bônus.');
    }
  }

  /**
   * Find bonus by ID
   */
  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<BonusInclude>,
  ): Promise<Bonus | null> {
    try {
      const { include } = options || {};
      const model = this.getModel(transaction);
      const prismaInclude = this.mapIncludeToDatabaseInclude(include);

      const bonus = await model.findUnique({
        where: { id },
        include: prismaInclude,
      });

      return bonus ? this.mapDatabaseEntityToEntity(bonus) : null;
    } catch (error) {
      this.logger.error(`Error finding bonus by ID ${id}:`, error);
      throw new BadRequestException('Erro ao buscar bônus por ID.');
    }
  }

  /**
   * Find bonuses by IDs
   */
  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<BonusInclude>,
  ): Promise<Bonus[]> {
    try {
      const { include } = options || {};
      const model = this.getModel(transaction);
      const prismaInclude = this.mapIncludeToDatabaseInclude(include);

      const bonuses = await model.findMany({
        where: { id: { in: ids } },
        include: prismaInclude,
      });

      return bonuses.map(bonus => this.mapDatabaseEntityToEntity(bonus));
    } catch (error) {
      this.logger.error('Error finding bonuses by IDs:', error);
      throw new BadRequestException('Erro ao buscar bônus por IDs.');
    }
  }

  /**
   * Count bonuses
   */
  async countWithTransaction(transaction: PrismaTransaction, where?: BonusWhere): Promise<number> {
    try {
      const model = this.getModel(transaction);
      const prismaWhere = this.mapWhereToDatabaseWhere(where);

      return await model.count({ where: prismaWhere });
    } catch (error) {
      this.logger.error('Error counting bonuses:', error);
      throw new BadRequestException('Erro ao contar bônus.');
    }
  }

  /**
   * Returns existing bonus or generates live calculation
   */
  async findOrGenerateLive(
    userId: string,
    year: number,
    month: number,
    include?: BonusInclude,
    tx?: PrismaTransaction,
  ): Promise<Bonus> {
    try {
      // First, try to find existing bonus
      const existingBonus = await this.findByUserAndPeriod(
        userId,
        year.toString(),
        month.toString(),
        include,
        tx,
      );
      if (existingBonus) {
        return existingBonus;
      }

      // Generate live calculation
      const liveData = await this.generateLiveBonusData(userId, year, month, tx);

      // Return a live bonus object (not saved to database)
      // Period dates and task counts are computed from year/month and tasks relation
      return {
        id: `live-${userId}-${year}-${month}`,
        userId: liveData.userId,
        baseBonus: liveData.baseBonus,
        year: liveData.year,
        month: liveData.month,
        performanceLevel: liveData.performanceLevel,
        payrollId: liveData.payrollId,
        createdAt: new Date(),
        updatedAt: new Date(),
        tasks: liveData.tasks,
      } as Bonus;
    } catch (error) {
      this.logger.error('Error in findOrGenerateLive:', error);
      throw new BadRequestException('Erro ao buscar ou gerar bônus.');
    }
  }

  /**
   * Create multiple bonuses in transaction
   */
  async batchCreate(
    data: BonusCreateFormData[],
    options?: CreateManyOptions<BonusInclude>,
  ): Promise<BatchCreateResult<Bonus, BonusCreateFormData>> {
    const { include } = options || {};
    const results: Bonus[] = [];
    const errors: BatchError<BonusCreateFormData>[] = [];

    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (let i = 0; i < data.length; i++) {
          try {
            const bonus = await this.createWithTransaction(tx, data[i], { include });
            results.push(bonus);
          } catch (error) {
            this.logger.error(`Error creating bonus at index ${i}:`, error);
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Erro desconhecido',
              data: data[i],
            });
          }
        }

        if (errors.length === data.length) {
          throw new BadRequestException('Todos os bônus falharam ao ser criados.');
        }
      });

      this.logger.log(`Batch create completed: ${results.length} success, ${errors.length} errors`);

      return {
        success: results,
        failed: errors,
        totalCreated: results.length,
        totalFailed: errors.length,
      };
    } catch (error) {
      this.logger.error('Error in batch create:', error);
      throw new BadRequestException('Erro ao criar bônus em lote.');
    }
  }

  /**
   * Calculate period metrics for bonus calculation
   */
  private async calculatePeriodMetrics(
    year: number,
    month: number,
    tx?: PrismaTransaction,
  ): Promise<{ ponderedTaskCount: number; averageTasksPerUser: number }> {
    const startDate = this.getPeriodStartDate(year, month);
    const endDate = this.getPeriodEndDate(year, month);

    const model = tx ? tx : this.prisma;

    // Get all eligible tasks in the period
    const tasks = await model.task.findMany({
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
        commission: true,
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

    // Calculate weighted task count
    let ponderedTaskCount = 0;
    for (const task of tasks) {
      if (task.commission === COMMISSION_STATUS.FULL_COMMISSION) {
        ponderedTaskCount += 1.0;
      } else if (task.commission === COMMISSION_STATUS.PARTIAL_COMMISSION) {
        ponderedTaskCount += 0.5;
      }
    }

    // Get eligible users count
    const eligibleUsersCount = await model.user.count({
      where: {
        performanceLevel: { gt: 0 },
        status: { in: [...ACTIVE_USER_STATUSES] },
      },
    });

    const averageTasksPerUser = eligibleUsersCount > 0 ? ponderedTaskCount / eligibleUsersCount : 0;

    return {
      ponderedTaskCount,
      averageTasksPerUser,
    };
  }

  /**
   * Generate live bonus data for a specific user and period
   */
  private async generateLiveBonusData(
    userId: string,
    year: number,
    month: number,
    tx?: PrismaTransaction,
  ): Promise<LiveBonusData> {
    const model = tx ? tx : this.prisma;

    // Get user with performance level
    const user = await model.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        performanceLevel: true,
        position: { select: { name: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(`Usuário ${userId} não encontrado.`);
    }

    if (user.performanceLevel <= 0) {
      throw new BadRequestException(`Usuário ${user.name} não tem nível de performance válido.`);
    }

    // Calculate metrics for the period
    const { averageTasksPerUser } = await this.calculatePeriodMetrics(year, month, tx);

    // Calculate bonus
    const bonusValue = this.bonusCalculationService.calculateBonus(
      user.position?.name || 'DEFAULT',
      user.performanceLevel,
      averageTasksPerUser,
    );

    // Get payroll if exists
    const payroll = await model.payroll.findFirst({
      where: { year, month },
      select: { id: true },
    });

    // Get user's tasks for this period
    const startDate = this.getPeriodStartDate(year, month);
    const endDate = this.getPeriodEndDate(year, month);
    const userTasks = await model.task.findMany({
      where: {
        createdById: userId,
        commission: { in: ['FULL_COMMISSION', 'PARTIAL_COMMISSION'] },
        status: 'COMPLETED',
        finishedAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        name: true,
        commission: true,
        finishedAt: true,
      },
    });

    return {
      userId,
      year,
      month,
      performanceLevel: user.performanceLevel,
      baseBonus: bonusValue,
      tasks: userTasks,
      payrollId: payroll?.id,
    };
  }

  /**
   * Get start date for bonus calculation period (26th of previous month)
   */
  private getPeriodStartDate(year: number, month: number): Date {
    if (month === 1) {
      return new Date(year - 1, 11, 26); // December 26 of previous year
    }
    return new Date(year, month - 2, 26); // 26th of previous month (month-2 because JS months are 0-indexed)
  }

  /**
   * Get end date for bonus calculation period (25th of current month)
   */
  private getPeriodEndDate(year: number, month: number): Date {
    return new Date(year, month - 1, 25, 23, 59, 59, 999); // 25th of current month
  }
}
