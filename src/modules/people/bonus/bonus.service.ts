// bonus.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BonusRepository, PrismaTransaction } from './repositories/bonus/bonus.repository';
import { ExactBonusCalculationService } from '@modules/human-resources/bonus/exact-bonus-calculation.service';
import type {
  Bonus,
  BonusBatchResponse,
  BonusCreateResponse,
  BonusDeleteResponse,
  BonusGetManyResponse,
  BonusGetUniqueResponse,
  BonusUpdateResponse,
  FindManyOptions,
} from '../../../types';
import type {
  BonusCreateFormData,
  BonusUpdateFormData,
  BonusGetManyFormData,
  BonusBatchCreateFormData,
  BonusBatchUpdateFormData,
  BonusBatchDeleteFormData,
  BonusInclude,
  PayrollGetParams,
} from '../../../schemas/bonus';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  BONUS_STATUS,
  TASK_STATUS,
  COMMISSION_STATUS,
} from '../../../constants/enums';
import { BONUS_STATUS_ORDER } from '../../../constants/sortOrders';
import {
  getBonusPeriodStart,
  getBonusPeriodEnd,
  calculateBonusForPosition,
} from '../../../utils/bonus';

@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusRepository: BonusRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly bonusCalculationService: ExactBonusCalculationService,
  ) {}

  /**
   * Validate bonus data with comprehensive business rules
   */
  private async validateBonusData(
    data: Partial<BonusCreateFormData | BonusUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    const isUpdate = !!existingId;

    // Validate required fields for creation
    if (!isUpdate) {
      if (data.year === undefined || data.year === null) {
        throw new BadRequestException('Ano é obrigatório.');
      }
      if (data.month === undefined || data.month === null) {
        throw new BadRequestException('Mês é obrigatório.');
      }
      if (!data.userId) {
        throw new BadRequestException('ID do usuário é obrigatório.');
      }
      if (data.performanceLevel === undefined || data.performanceLevel === null) {
        throw new BadRequestException('Nível de performance é obrigatório.');
      }
      if (data.baseBonus === undefined || data.baseBonus === null) {
        throw new BadRequestException('Valor base do bônus é obrigatório.');
      }
    }

    // Validate year range
    if (data.year !== undefined) {
      if (data.year < 2000 || data.year > 2099) {
        throw new BadRequestException('Ano deve estar entre 2000 e 2099.');
      }
    }

    // Validate month range
    if (data.month !== undefined) {
      if (data.month < 1 || data.month > 12) {
        throw new BadRequestException('Mês deve estar entre 1 e 12.');
      }
    }

    // Validate performance level
    if (data.performanceLevel !== undefined) {
      if (data.performanceLevel < 1 || data.performanceLevel > 5) {
        throw new BadRequestException('Nível de performance deve estar entre 1 e 5.');
      }
    }

    // Validate bonus value
    if (data.baseBonus !== undefined) {
      if (data.baseBonus < 0) {
        throw new BadRequestException('Valor do bônus deve ser maior ou igual a zero.');
      }
      if (data.baseBonus > 999999.99) {
        throw new BadRequestException('Valor do bônus não pode ser maior que R$ 999.999,99.');
      }
    }

    // Validate user exists and is eligible for bonus
    if (data.userId !== undefined) {
      const user = await transaction.user.findUnique({
        where: { id: data.userId },
        include: {
          position: true,
        },
      });

      if (!user) {
        throw new BadRequestException('Usuário não encontrado.');
      }

      if (!user.position?.bonifiable) {
        throw new BadRequestException('Usuário não está em uma posição elegível para bônus.');
      }
    }

    // Check for duplicate bonus in same period (only for creation or when changing period/user)
    if (data.year !== undefined && data.month !== undefined && data.userId !== undefined) {
      const existingBonus = await this.bonusRepository.findByUserAndPeriod(
        data.userId,
        data.year,
        data.month,
        tx
      );

      if (existingBonus && (!isUpdate || existingBonus.id !== existingId)) {
        throw new BadRequestException('Já existe um bônus para este usuário neste período.');
      }
    }
  }

  /**
   * Calculate live bonus value for a user in a specific period
   */
  private async calculateLiveBonus(
    userId: string,
    year: number,
    month: number,
    performanceLevel: number,
    tx?: PrismaTransaction
  ): Promise<number> {
    const transaction = tx || this.prisma;

    try {
      // Get user with position details
      const user = await transaction.user.findUnique({
        where: { id: userId },
        include: {
          position: true,
        },
      });

      if (!user || !user.position) {
        this.logger.warn(`User ${userId} not found or has no position`);
        return 0;
      }

      if (!user.position.bonifiable) {
        this.logger.debug(`User ${userId} position is not bonifiable`);
        return 0;
      }

      // Get period dates
      const periodStart = getBonusPeriodStart(year, month);
      const periodEnd = getBonusPeriodEnd(year, month);

      // Query ALL tasks in the period (no user filter)
      // Bonus is calculated from company-wide average, not per-user tasks
      const allTasks = await transaction.task.findMany({
        where: {
          status: {
            in: [TASK_STATUS.COMPLETED, TASK_STATUS.INVOICED, TASK_STATUS.SETTLED],
          },
          finishedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
        },
      });

      // Calculate total weighted tasks from ALL tasks (company-wide)
      let totalWeightedTasks = 0;
      for (const task of allTasks) {
        // Full commission tasks count as 1, partial commission tasks count as 0.5
        if (task.commission === COMMISSION_STATUS.FULL_COMMISSION) {
          totalWeightedTasks += 1;
        } else if (task.commission === COMMISSION_STATUS.PARTIAL_COMMISSION) {
          totalWeightedTasks += 0.5;
        }
      }

      // Get all eligible users for this period to calculate average
      const eligibleUsers = await transaction.user.findMany({
        where: {
          performanceLevel: { gt: 0 },
          position: {
            bonifiable: true,
          },
        },
        include: {
          position: true,
        },
      });

      // Calculate average tasks per user
      const averageTasksPerUser = eligibleUsers.length > 0 ? totalWeightedTasks / eligibleUsers.length : 0;

      // Calculate bonus using the exact calculation service
      const calculatedBonus = this.bonusCalculationService.calculateBonus(
        user.position.name,
        performanceLevel,
        averageTasksPerUser
      );

      this.logger.debug(`Live bonus calculation for user ${userId}: ${calculatedBonus}`, {
        positionName: user.position.name,
        performanceLevel,
        averageTasksPerUser,
        totalWeightedTasks,
        totalEligibleUsers: eligibleUsers.length,
      });

      return calculatedBonus;

    } catch (error) {
      this.logger.error('Error calculating live bonus', { error, userId, year, month });
      return 0;
    }
  }

  /**
   * Find many bonuses with pagination
   */
  async findMany(
    params: BonusGetManyFormData,
    include?: BonusInclude,
    userId?: string
  ): Promise<BonusGetManyResponse> {
    try {
      const options: FindManyOptions<any, any, any> = {
        page: params.page || 1,
        take: params.limit || 10,
        where: params.where,
        orderBy: params.orderBy || { year: 'desc', month: 'desc', createdAt: 'desc' },
        include: include || params.include,
      };

      const result = await this.bonusRepository.findMany(options);

      return {
        success: true,
        message: 'Bônus encontrados com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Error finding bonuses', { error, params });
      throw new InternalServerErrorException('Erro interno do servidor ao buscar bônus.');
    }
  }

  /**
   * Find bonus by user and period, return live calculation if not exists
   */
  async findByUserAndPeriod(
    userId: string,
    year: number,
    month: number,
    performanceLevel: number = 3,
    include?: BonusInclude,
    currentUserId?: string
  ): Promise<BonusGetUniqueResponse> {
    try {
      // First try to find existing bonus record
      const existingBonus = await this.bonusRepository.findByUserAndPeriod(
        userId,
        year,
        month
      );

      if (existingBonus) {
        return {
          success: true,
          message: 'Bônus encontrado.',
          data: existingBonus,
        };
      }

      // If no record exists, calculate live bonus
      const liveBonus = await this.calculateLiveBonus(userId, year, month, performanceLevel);

      // Calculate period dates
      const periodStart = new Date(year, month - 1, 1);
      const periodEnd = new Date(year, month, 0, 23, 59, 59);

      // Return calculated bonus as virtual entity
      const virtualBonus: Bonus = {
        id: `live-${userId}-${year}-${month}`,
        userId: userId,
        payrollId: null, // Will be set when payroll is generated
        year: year,
        month: month,
        performanceLevel: performanceLevel,
        baseBonus: liveBonus,
        ponderedTaskCount: 0, // Will be calculated if needed
        averageTasksPerUser: 0, // Will be calculated if needed
        calculationPeriodStart: periodStart,
        calculationPeriodEnd: periodEnd,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return {
        success: true,
        message: 'Bônus calculado dinamicamente.',
        data: virtualBonus,
      };
    } catch (error) {
      this.logger.error('Error finding bonus by user and period', { error, userId, year, month });
      throw new InternalServerErrorException('Erro interno do servidor ao buscar bônus.');
    }
  }

  /**
   * Find bonus by ID
   */
  async findById(id: string, include?: BonusInclude, userId?: string): Promise<BonusGetUniqueResponse> {
    try {
      const bonus = await this.bonusRepository.findById(id, { include });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      return {
        success: true,
        message: 'Bônus encontrado com sucesso.',
        data: bonus,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error finding bonus by ID', { error, id });
      throw new InternalServerErrorException('Erro interno do servidor ao buscar bônus.');
    }
  }

  /**
   * Create a new bonus
   */
  async create(data: BonusCreateFormData, include?: BonusInclude, userId?: string): Promise<BonusCreateResponse> {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Validate data
        await this.validateBonusData(data, undefined, tx);

        // If no explicit bonus value provided, calculate it
        if (data.baseBonus === 0 || data.baseBonus === undefined) {
          data.baseBonus = await this.calculateLiveBonus(
            data.userId,
            data.year,
            data.month,
            data.performanceLevel,
            tx
          );
        }

        // Create bonus
        const bonus = await this.bonusRepository.createWithTransaction(tx, data, { include });

        // Log change
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityId: bonus.id,
          entity: bonus,
          entityType: ENTITY_TYPE.BONUS,
          action: CHANGE_ACTION.CREATE,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return {
          success: true,
          message: 'Bônus criado com sucesso.',
          data: bonus,
        };
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        this.logger.error('Error creating bonus', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor ao criar bônus.');
      }
    });
  }

  /**
   * Update a bonus
   */
  async update(
    id: string,
    data: BonusUpdateFormData,
    include?: BonusInclude,
    userId?: string
  ): Promise<BonusUpdateResponse> {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Check if bonus exists
        const existingBonus = await this.bonusRepository.findByIdWithTransaction(tx, id, {});
        if (!existingBonus) {
          throw new NotFoundException('Bônus não encontrado.');
        }

        // Validate data
        await this.validateBonusData(data, id, tx);

        // Update bonus
        const updatedBonus = await this.bonusRepository.updateWithTransaction(tx, id, data, { include });

        // Track and log field changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: id,
          oldEntity: existingBonus,
          newEntity: updatedBonus,
          fieldsToTrack: ['year', 'month', 'userId', 'performanceLevel', 'baseBonus'],
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return {
          success: true,
          message: 'Bônus atualizado com sucesso.',
          data: updatedBonus,
        };
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        this.logger.error('Error updating bonus', { error, id, data });
        throw new InternalServerErrorException('Erro interno do servidor ao atualizar bônus.');
      }
    });
  }

  /**
   * Delete a bonus
   */
  async delete(id: string, userId?: string): Promise<BonusDeleteResponse> {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Check if bonus exists
        const existingBonus = await this.bonusRepository.findByIdWithTransaction(tx, id, {});
        if (!existingBonus) {
          throw new NotFoundException('Bônus não encontrado.');
        }

        // Check if bonus can be deleted (not confirmed or in payroll)
        // Delete bonus (this will cascade delete discounts)
        await this.bonusRepository.deleteWithTransaction(tx, id);

        // Log change
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityId: existingBonus.id,
          entity: existingBonus,
          entityType: ENTITY_TYPE.BONUS,
          action: CHANGE_ACTION.DELETE,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return {
          success: true,
          message: 'Bônus deletado com sucesso.',
        };
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof BadRequestException) {
          throw error;
        }
        this.logger.error('Error deleting bonus', { error, id });
        throw new InternalServerErrorException('Erro interno do servidor ao deletar bônus.');
      }
    });
  }

  /**
   * Generate bonuses for all eligible users in a specific period
   */
  async generateForPeriod(
    year: number,
    month: number,
    defaultPerformanceLevel: number = 3,
    userId?: string
  ): Promise<BonusBatchResponse<BonusCreateFormData>> {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Get all eligible users (with bonifiable positions)
        const eligibleUsers = await tx.user.findMany({
          where: {
            position: {
              bonifiable: true,
            },
          },
          include: {
            position: true,
          },
        });

        // Check if bonuses already exist for this period
        const existingBonuses = await this.bonusRepository.findByPeriod(
          year,
          month,
          undefined,
          tx
        );

        if (existingBonuses.length > 0) {
          throw new BadRequestException(`Já existem bônus para o período ${month}/${year}.`);
        }

        const results = [];
        const errors = [];

        // Generate bonus for each eligible user
        for (let i = 0; i < eligibleUsers.length; i++) {
          try {
            const user = eligibleUsers[i];

            // Calculate bonus for this user
            const bonusValue = await this.calculateLiveBonus(
              user.id,
              year,
              month,
              defaultPerformanceLevel,
              tx
            );

            const bonusData: BonusCreateFormData = {
              userId: user.id,
              year: year,
              month: month,
              performanceLevel: defaultPerformanceLevel,
              baseBonus: bonusValue,
            };

            // Validate and create bonus
            await this.validateBonusData(bonusData, undefined, tx);

            const bonus = await this.bonusRepository.createWithTransaction(tx, bonusData, {});

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityId: bonus.id,
              entity: bonus,
              entityType: ENTITY_TYPE.BONUS,
              action: CHANGE_ACTION.BATCH_CREATE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
              transaction: tx,
            });

            results.push({ success: true, data: bonus });

          } catch (error) {
            errors.push({
              index: i,
              error: error.message || 'Erro desconhecido',
              data: eligibleUsers[i],
            });
          }
        }

        return {
          success: true,
          message: `${results.length} bônus gerados para o período ${month}/${year}.`,
          totalSuccess: results.length,
          totalFailed: errors.length,
          results,
          errors,
        };

      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        this.logger.error('Error generating bonuses for period', { error, year, month });
        throw new InternalServerErrorException('Erro interno do servidor ao gerar bônus para o período.');
      }
    });
  }

  /**
   * Batch create bonuses
   */
  async batchCreate(
    data: BonusBatchCreateFormData,
    include?: BonusInclude,
    userId?: string
  ): Promise<BonusBatchResponse<BonusCreateFormData>> {
    return this.prisma.$transaction(async (tx) => {
      try {
        const results = [];
        const errors = [];

        for (let i = 0; i < data.bonuses.length; i++) {
          try {
            const bonusData = data.bonuses[i];

            // Validate data
            await this.validateBonusData(bonusData, undefined, tx);

            // Calculate bonus if not provided
            if (bonusData.baseBonus === 0 || bonusData.baseBonus === undefined) {
              bonusData.baseBonus = await this.calculateLiveBonus(
                bonusData.userId,
                bonusData.year,
                bonusData.month,
                bonusData.performanceLevel,
                tx
              );
            }

            // Create bonus
            const bonus = await this.bonusRepository.createWithTransaction(tx, bonusData, { include });

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityId: bonus.id,
              entity: bonus,
              entityType: ENTITY_TYPE.BONUS,
              action: CHANGE_ACTION.BATCH_CREATE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_OPERATION,
              transaction: tx,
            });

            results.push({ success: true, data: bonus });
          } catch (error) {
            errors.push({
              index: i,
              error: error.message || 'Erro desconhecido',
              data: data.bonuses[i],
            });
          }
        }

        return {
          success: true,
          message: `${results.length} bônus criados com sucesso.`,
          totalSuccess: results.length,
          totalFailed: errors.length,
          results,
          errors,
        };
      } catch (error) {
        this.logger.error('Error in batch create bonuses', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor na criação em lote de bônus.');
      }
    });
  }

  /**
   * Batch update bonuses
   */
  async batchUpdate(
    data: BonusBatchUpdateFormData,
    include?: BonusInclude,
    userId?: string
  ): Promise<BonusBatchResponse<BonusUpdateFormData>> {
    return this.prisma.$transaction(async (tx) => {
      try {
        const results = [];
        const errors = [];

        for (let i = 0; i < data.bonuses.length; i++) {
          try {
            const { id, data: updateData } = data.bonuses[i];

            // Check if bonus exists
            const existingBonus = await this.bonusRepository.findByIdWithTransaction(tx, id, {});
            if (!existingBonus) {
              throw new NotFoundException(`Bônus com ID ${id} não encontrado.`);
            }

            // Validate data
            await this.validateBonusData(updateData, id, tx);

            // Update bonus
            const updatedBonus = await this.bonusRepository.updateWithTransaction(tx, id, updateData, { include });

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityId: updatedBonus.id,
              entity: updatedBonus,
              entityType: ENTITY_TYPE.BONUS,
              action: CHANGE_ACTION.BATCH_UPDATE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_OPERATION,
              transaction: tx,
            });

            results.push({ success: true, data: updatedBonus });
          } catch (error) {
            errors.push({
              index: i,
              error: error.message || 'Erro desconhecido',
              data: data.bonuses[i],
            });
          }
        }

        return {
          success: true,
          message: `${results.length} bônus atualizados com sucesso.`,
          totalSuccess: results.length,
          totalFailed: errors.length,
          results,
          errors,
        };
      } catch (error) {
        this.logger.error('Error in batch update bonuses', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor na atualização em lote de bônus.');
      }
    });
  }

  /**
   * Batch delete bonuses
   */
  async batchDelete(data: BonusBatchDeleteFormData, userId?: string): Promise<BonusBatchResponse<string>> {
    return this.prisma.$transaction(async (tx) => {
      try {
        const results = [];
        const errors = [];

        for (let i = 0; i < data.ids.length; i++) {
          try {
            const bonusId = data.ids[i];

            // Check if bonus exists
            const existingBonus = await this.bonusRepository.findByIdWithTransaction(tx, bonusId, {});
            if (!existingBonus) {
              throw new NotFoundException(`Bônus com ID ${bonusId} não encontrado.`);
            }

            // Delete bonus
            await this.bonusRepository.deleteWithTransaction(tx, bonusId);

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityId: existingBonus.id,
              entity: existingBonus,
              entityType: ENTITY_TYPE.BONUS,
              action: CHANGE_ACTION.BATCH_DELETE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_OPERATION,
              transaction: tx,
            });

            results.push({ success: true, data: bonusId });
          } catch (error) {
            errors.push({
              index: i,
              error: error.message || 'Erro desconhecido',
              data: data.ids[i],
            });
          }
        }

        return {
          success: true,
          message: `${results.length} bônus deletados com sucesso.`,
          totalSuccess: results.length,
          totalFailed: errors.length,
          results,
          errors,
        };
      } catch (error) {
        this.logger.error('Error in batch delete bonuses', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor na exclusão em lote de bônus.');
      }
    });
  }

  /**
   * Get payroll data with bonus calculations
   */
  async getPayrollData(params: PayrollGetParams, userId?: string): Promise<any> {
    try {
      const payrollData = await this.bonusRepository.getPayrollData(
        params.year,
        params.month,
        params.userId,
        params.sectorId
      );

      // Calculate summary
      const summary = {
        totalBonus: payrollData.reduce((sum, item) => sum + (item.bonus || 0), 0),
        totalRemuneration: payrollData.reduce((sum, item) => sum + (item.baseRemuneration || 0), 0),
        totalEarnings: payrollData.reduce((sum, item) => sum + (item.totalEarnings || 0), 0),
        employeeCount: payrollData.length,
        averageBonus: payrollData.length > 0 ?
          payrollData.reduce((sum, item) => sum + (item.bonus || 0), 0) / payrollData.length : 0,
      };

      return {
        success: true,
        message: 'Dados da folha de pagamento obtidos com sucesso.',
        data: payrollData,
        summary,
      };
    } catch (error) {
      this.logger.error('Error getting payroll data', { error, params });
      throw new InternalServerErrorException('Erro interno do servidor ao obter dados da folha de pagamento.');
    }
  }

  /**
   * Get tasks for a bonus by calculation period
   * Used when tasks are not linked via many-to-many relation
   * This query MUST match the exact bonus calculation logic to show the same tasks that were counted
   */
  async getTasksForBonus(
    userId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<any[]> {
    try {
      this.logger.log(`Getting tasks for bonus - userId: ${userId}, period: ${periodStart} to ${periodEnd}`);

      // Query ALL tasks in the period that match bonus calculation criteria
      // This MUST match the query in calculateLiveBonus() method (lines 196-209)
      const tasks = await this.bonusRepository.prisma.task.findMany({
        where: {
          // Use same status filter as bonus calculation
          status: {
            in: [TASK_STATUS.COMPLETED, TASK_STATUS.INVOICED, TASK_STATUS.SETTLED],
          },
          finishedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
          // Only show tasks that contributed to the bonus (with commission)
          commission: {
            in: [COMMISSION_STATUS.FULL_COMMISSION, COMMISSION_STATUS.PARTIAL_COMMISSION],
          },
        },
        orderBy: {
          finishedAt: 'desc',
        },
        // Only select fields needed for commission display
        select: {
          id: true,
          name: true,
          commission: true,
          status: true,
          finishedAt: true,
          createdById: true,
          sectorId: true,
        },
      });

      this.logger.log(`Found ${tasks.length} tasks matching bonus calculation criteria`);

      return tasks;
    } catch (error) {
      this.logger.error('Error getting tasks for bonus', { error, userId, periodStart, periodEnd });
      return []; // Return empty array instead of throwing
    }
  }
}