// bonus-discount.service.ts

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
import { BonusDiscountRepository } from './repositories/bonus-discount/bonus-discount.repository';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  BonusDiscountCreateFormData,
  BonusDiscountUpdateFormData,
  BonusDiscountGetManyFormData,
  BonusDiscountGetByIdFormData,
  BonusDiscountBatchCreateFormData,
  BonusDiscountBatchUpdateFormData,
  BonusDiscountBatchDeleteFormData,
} from '../../../schemas';
import {
  BonusDiscount,
  BonusDiscountIncludes,
  FindManyResult,
  BatchOperationResult,
  Task,
} from '../../../types';

// Enhanced discount data type for calculations
interface DiscountCalculationData {
  id: string;
  percentage: number | null;
  value: number | null;
  reference: string;
  calculationOrder: number;
  suspendedTasks?: Task[];
}

// Interface for bonus calculation context
interface BonusCalculationContext {
  bonusId: string;
  userId: string;
  year: number;
  month: number;
  suspendedTaskIds?: string[];
}

@Injectable()
export class BonusDiscountService {
  private readonly logger = new Logger(BonusDiscountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly bonusDiscountRepository: BonusDiscountRepository,
  ) {}

  /**
   * Validate that either percentage or value is provided, but not both
   * @param data The discount data to validate
   * @throws BadRequestException if validation fails
   */
  private validateDiscountData(
    data: BonusDiscountCreateFormData | BonusDiscountUpdateFormData,
  ): void {
    const hasPercentage = data.percentage !== null && data.percentage !== undefined;
    const hasValue = data.value !== null && data.value !== undefined;

    // For create operations, we need either percentage or value
    if (!('reference' in data)) {
      // This is an update operation
      if (hasPercentage && hasValue) {
        throw new BadRequestException(
          'Não é possível fornecer tanto percentual quanto valor. Escolha apenas um',
        );
      }
    } else {
      // This is a create operation, we need exactly one discount type
      if (!hasPercentage && !hasValue) {
        throw new BadRequestException(
          'É necessário fornecer um percentual ou um valor para o desconto',
        );
      }

      if (hasPercentage && hasValue) {
        throw new BadRequestException(
          'Não é possível fornecer tanto percentual quanto valor. Escolha apenas um',
        );
      }
    }

    // Additional validation for percentage
    if (hasPercentage && (data.percentage! < 0 || data.percentage! > 100)) {
      throw new BadRequestException('O percentual deve estar entre 0% e 100%');
    }

    // Additional validation for value
    if (hasValue && data.value! < 0) {
      throw new BadRequestException('O valor do desconto deve ser maior ou igual a zero');
    }
  }

  /**
   * Validate that bonus exists and is accessible
   * @param bonusId The bonus ID to validate
   * @param userId The user ID for changelog
   * @throws NotFoundException if bonus doesn't exist
   */
  private async validateBonusExists(bonusId: string, userId?: string): Promise<void> {
    const bonus = await this.prisma.bonus.findUnique({
      where: { id: bonusId },
      select: { id: true },
    });

    if (!bonus) {
      throw new NotFoundException(`Bônus com ID ${bonusId} não foi encontrado`);
    }
  }

  /**
   * Get next calculation order for a bonus
   * @param bonusId The bonus ID
   * @param transaction Optional transaction
   * @returns Next calculation order number
   */
  private async getNextCalculationOrder(
    bonusId: string,
    transaction?: PrismaTransaction,
  ): Promise<number> {
    const client = transaction || this.prisma;

    const maxOrder = await client.bonusDiscount.aggregate({
      where: { bonusId },
      _max: { calculationOrder: true },
    });

    return (maxOrder._max.calculationOrder || 0) + 1;
  }

  /**
   * Calculate discounted value by applying discounts in order
   * @param bonusValue The original bonus value
   * @param discounts Array of discount objects sorted by calculationOrder
   * @param context Optional context for bonus calculation including suspended tasks
   * @returns Final discounted value and calculation steps
   */
  calculateDiscountedValue(
    bonusValue: number,
    discounts: DiscountCalculationData[],
    context?: BonusCalculationContext,
  ): {
    finalValue: number;
    calculationSteps: Array<{
      step: number;
      operation: string;
      value: number;
      result: number;
      suspendedTasksCount?: number;
      reference: string;
    }>;
    totalSuspendedTasksCount: number;
  } {
    if (!discounts || discounts.length === 0) {
      return {
        finalValue: bonusValue,
        calculationSteps: [],
        totalSuspendedTasksCount: 0,
      };
    }

    // Sort discounts by calculationOrder to ensure correct sequence
    const sortedDiscounts = [...discounts].sort((a, b) => a.calculationOrder - b.calculationOrder);

    let currentValue = bonusValue;
    const calculationSteps: Array<{
      step: number;
      operation: string;
      value: number;
      result: number;
      suspendedTasksCount?: number;
      reference: string;
    }> = [];
    let totalSuspendedTasksCount = 0;

    sortedDiscounts.forEach((discount, index) => {
      let operation: string;
      let discountAmount: number;
      const suspendedTasksCount = discount.suspendedTasks?.length || 0;
      totalSuspendedTasksCount += suspendedTasksCount;

      // Build operation description with suspended tasks info
      let baseOperation = '';
      if (discount.percentage !== null) {
        discountAmount = currentValue * (discount.percentage / 100);
        baseOperation = `${discount.reference}: -${discount.percentage}% (R$ ${discountAmount.toFixed(2)})`;
      } else if (discount.value !== null) {
        discountAmount = Math.min(discount.value, currentValue); // Can't discount more than current value
        baseOperation = `${discount.reference}: -R$ ${discountAmount.toFixed(2)}`;
      } else {
        this.logger.warn(`Discount ${discount.id} has neither percentage nor value`);
        return;
      }

      // Add suspended tasks information to operation description
      if (suspendedTasksCount > 0) {
        operation = `${baseOperation} [${suspendedTasksCount} tarefa(s) suspensa(s)]`;
      } else {
        operation = baseOperation;
      }

      const previousValue = currentValue;
      currentValue = Math.max(0, currentValue - discountAmount); // Ensure value doesn't go negative

      calculationSteps.push({
        step: index + 1,
        operation,
        value: discountAmount,
        result: currentValue,
        suspendedTasksCount,
        reference: discount.reference,
      });

      this.logger.debug(
        `Applied discount ${discount.id}: ${operation}, Previous: R$ ${previousValue.toFixed(2)}, Result: R$ ${currentValue.toFixed(2)}${suspendedTasksCount > 0 ? `, Suspended Tasks: ${suspendedTasksCount}` : ''}`,
      );
    });

    return {
      finalValue: currentValue,
      calculationSteps,
      totalSuspendedTasksCount,
    };
  }

  /**
   * Calculate bonus value considering suspended tasks for each discount
   * @param bonusId The bonus ID
   * @param originalBonusValue The original bonus value before discounts
   * @param include Optional relations to include in discount data
   * @returns Calculated bonus with detailed steps including suspended task information
   */
  async calculateBonusWithSuspendedTasks(
    bonusId: string,
    originalBonusValue: number,
    include?: BonusDiscountIncludes,
  ): Promise<{
    finalValue: number;
    calculationSteps: Array<{
      step: number;
      operation: string;
      value: number;
      result: number;
      suspendedTasksCount?: number;
      reference: string;
    }>;
    totalSuspendedTasksCount: number;
    originalValue: number;
    discountsApplied: number;
  }> {
    try {
      // Get all discounts for the bonus with suspended tasks
      const discounts = await this.bonusDiscountRepository.findByBonusId(bonusId, {
        include: {
          suspendedTasks: true,
          ...include,
        },
      });

      // Convert to calculation data format
      const calculationData: DiscountCalculationData[] = discounts.map(discount => ({
        id: discount.id,
        percentage: discount.percentage,
        value: discount.value,
        reference: discount.reference,
        calculationOrder: discount.calculationOrder,
        suspendedTasks: discount.suspendedTasks,
      }));

      // Calculate with suspended task consideration
      const result = this.calculateDiscountedValue(originalBonusValue, calculationData);

      return {
        ...result,
        originalValue: originalBonusValue,
        discountsApplied: discounts.length,
      };
    } catch (error) {
      this.logger.error(
        `Error calculating bonus with suspended tasks for bonus ${bonusId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Erro interno ao calcular bônus com tarefas suspensas',
      );
    }
  }

  /**
   * Create a new bonus discount
   * @param data The discount creation data
   * @param userId The user ID for changelog
   * @returns Created bonus discount
   */
  async create(data: BonusDiscountCreateFormData, userId: string): Promise<BonusDiscount> {
    // Validate discount data
    this.validateDiscountData(data);

    // Validate bonus exists
    await this.validateBonusExists(data.bonusId, userId);

    // Extract suspendedTasks if provided
    const { suspendedTaskIds, ...discountData } = data as BonusDiscountCreateFormData & {
      suspendedTaskIds?: string[];
    };

    return this.prisma.$transaction(async transaction => {
      try {
        // Validate suspended tasks if provided
        if (suspendedTaskIds && suspendedTaskIds.length > 0) {
          await this.validateSuspendedTasksForBonus(data.bonusId, suspendedTaskIds, userId);
        }

        // Get next calculation order
        const calculationOrder = await this.getNextCalculationOrder(data.bonusId, transaction);

        // Prepare creation data
        const createData = {
          ...discountData,
          calculationOrder: discountData.calculationOrder ?? calculationOrder,
          // Ensure proper null values for database
          percentage: discountData.percentage ?? null,
          value: discountData.value ?? null,
        };

        // Create the discount
        const discount = await this.bonusDiscountRepository.createWithTransaction(
          transaction,
          createData as any,
        );

        // Connect suspended tasks if provided
        if (suspendedTaskIds && suspendedTaskIds.length > 0) {
          await transaction.task.updateMany({
            where: {
              id: { in: suspendedTaskIds },
            },
            data: {
              bonusDiscountId: discount.id,
            },
          });
        }

        // Log the creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          transaction,
          entityType: ENTITY_TYPE.BONUS, // Using BONUS since BONUS_DISCOUNT doesn't exist yet
          entityId: discount.id,
          action: CHANGE_ACTION.CREATE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          newData: {
            ...discount,
            suspendedTaskIds: suspendedTaskIds || [],
          },
        });

        this.logger.log(
          `Created bonus discount ${discount.id} for bonus ${data.bonusId}${suspendedTaskIds && suspendedTaskIds.length > 0 ? ` with ${suspendedTaskIds.length} suspended tasks` : ''}`,
        );

        // Return discount with suspended tasks
        return this.findByIdOrThrow(discount.id, {
          bonus: true,
          suspendedTasks: true,
        });
      } catch (error) {
        this.logger.error('Error creating bonus discount:', error);
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        throw new InternalServerErrorException('Erro interno ao criar desconto do bônus');
      }
    });
  }

  /**
   * Update an existing bonus discount
   * @param id The discount ID
   * @param data The update data
   * @param userId The user ID for changelog
   * @param include Optional relations to include
   * @returns Updated bonus discount
   */
  async update(
    id: string,
    data: BonusDiscountUpdateFormData,
    userId: string,
    include?: BonusDiscountIncludes,
  ): Promise<BonusDiscount> {
    // Validate discount data
    this.validateDiscountData(data);

    // Extract suspendedTasks if provided
    const { suspendedTaskIds, ...discountData } = data as BonusDiscountUpdateFormData & {
      suspendedTaskIds?: string[];
    };

    return this.prisma.$transaction(async transaction => {
      try {
        // Get current discount
        const currentDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(
          transaction,
          id,
          {
            include: {
              ...include,
              bonus: true,
              suspendedTasks: true,
            },
          },
        );

        if (!currentDiscount) {
          throw new NotFoundException(`Desconto com ID ${id} não foi encontrado`);
        }

        // Handle suspended tasks updates
        let suspendedTasksChanged = false;
        if (suspendedTaskIds !== undefined) {
          // Validate new suspended tasks
          const bonusId = currentDiscount.bonusId;
          if (suspendedTaskIds.length > 0) {
            await this.validateSuspendedTasksForBonus(bonusId, suspendedTaskIds, userId);
          }

          // Get current suspended task IDs
          const currentSuspendedTaskIds = currentDiscount.suspendedTasks?.map(t => t.id) || [];

          // Check if suspended tasks changed
          const newTaskIds = new Set(suspendedTaskIds);
          const currentTaskIds = new Set(currentSuspendedTaskIds);

          suspendedTasksChanged =
            newTaskIds.size !== currentTaskIds.size ||
            [...newTaskIds].some(id => !currentTaskIds.has(id));

          if (suspendedTasksChanged) {
            // Remove all current connections
            await transaction.task.updateMany({
              where: {
                bonusDiscountId: id,
              },
              data: {
                bonusDiscountId: null,
              },
            });

            // Add new connections
            if (suspendedTaskIds.length > 0) {
              await transaction.task.updateMany({
                where: {
                  id: { in: suspendedTaskIds },
                },
                data: {
                  bonusDiscountId: id,
                },
              });
            }
          }
        }

        // Prepare update data
        const updateData = {
          ...discountData,
          // Handle nullable fields properly
          percentage:
            discountData.percentage !== undefined ? (discountData.percentage ?? null) : undefined,
          value: discountData.value !== undefined ? (discountData.value ?? null) : undefined,
        };

        // Track field changes
        const changes = trackFieldChanges(currentDiscount, updateData);

        // Add suspended tasks changes if they changed
        if (suspendedTasksChanged) {
          changes.suspendedTasks = {
            from: currentDiscount.suspendedTasks?.map(t => t.id) || [],
            to: suspendedTaskIds || [],
          };
        }

        if (Object.keys(changes).length === 0) {
          this.logger.log(`No changes detected for bonus discount ${id}`);
          return currentDiscount;
        }

        // Update the discount
        const updatedDiscount = await this.bonusDiscountRepository.updateWithTransaction(
          transaction,
          id,
          updateData,
          { include },
        );

        // Log the update
        await logEntityChange({
          changeLogService: this.changeLogService,
          transaction,
          entityType: ENTITY_TYPE.BONUS, // Using BONUS since BONUS_DISCOUNT doesn't exist yet
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          oldData: currentDiscount,
          newData: {
            ...updatedDiscount,
            suspendedTaskIds: suspendedTaskIds,
          },
          changes,
        });

        this.logger.log(
          `Updated bonus discount ${id}${suspendedTasksChanged ? ` with ${suspendedTaskIds?.length || 0} suspended tasks` : ''}`,
        );

        // Return updated discount with suspended tasks
        return this.findByIdOrThrow(id, {
          bonus: true,
          suspendedTasks: true,
          ...include,
        });
      } catch (error) {
        this.logger.error(`Error updating bonus discount ${id}:`, error);
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        throw new InternalServerErrorException('Erro interno ao atualizar desconto do bônus');
      }
    });
  }

  /**
   * Find discount by ID
   * @param id The discount ID
   * @param include Optional relations to include
   * @returns Bonus discount or null
   */
  async findById(id: string, include?: BonusDiscountIncludes): Promise<BonusDiscount | null> {
    try {
      return await this.bonusDiscountRepository.findById(id, { include });
    } catch (error) {
      this.logger.error(`Error finding bonus discount ${id}:`, error);
      throw new InternalServerErrorException('Erro interno ao buscar desconto do bônus');
    }
  }

  /**
   * Find discount by ID (required)
   * @param id The discount ID
   * @param include Optional relations to include
   * @returns Bonus discount
   * @throws NotFoundException if not found
   */
  async findByIdOrThrow(id: string, include?: BonusDiscountIncludes): Promise<BonusDiscount> {
    const discount = await this.findById(id, include);
    if (!discount) {
      throw new NotFoundException(`Desconto com ID ${id} não foi encontrado`);
    }
    return discount;
  }

  /**
   * Find many discounts with filtering and pagination
   * @param params Query parameters
   * @returns Paginated discounts
   */
  async findMany(params: BonusDiscountGetManyFormData): Promise<FindManyResult<BonusDiscount>> {
    try {
      return await this.bonusDiscountRepository.findMany(params);
    } catch (error) {
      this.logger.error('Error finding bonus discounts:', error);
      throw new InternalServerErrorException('Erro interno ao buscar descontos dos bônus');
    }
  }

  /**
   * Find all discounts for a specific bonus
   * @param bonusId The bonus ID
   * @param include Optional relations to include
   * @returns Array of bonus discounts
   */
  async findByBonusId(bonusId: string, include?: BonusDiscountIncludes): Promise<BonusDiscount[]> {
    try {
      return await this.bonusDiscountRepository.findByBonusId(bonusId, { include });
    } catch (error) {
      this.logger.error(`Error finding discounts for bonus ${bonusId}:`, error);
      throw new InternalServerErrorException('Erro interno ao buscar descontos do bônus');
    }
  }

  /**
   * Delete a bonus discount
   * @param id The discount ID
   * @param userId The user ID for changelog
   * @returns Success confirmation
   */
  async delete(id: string, userId: string): Promise<{ success: boolean; message: string }> {
    return this.prisma.$transaction(async transaction => {
      try {
        // Get current discount for changelog
        const currentDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(
          transaction,
          id,
        );

        if (!currentDiscount) {
          throw new NotFoundException(`Desconto com ID ${id} não foi encontrado`);
        }

        // Delete the discount
        await this.bonusDiscountRepository.deleteWithTransaction(transaction, id);

        // Log the deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          transaction,
          entityType: ENTITY_TYPE.BONUS, // Using BONUS since BONUS_DISCOUNT doesn't exist yet
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          oldData: currentDiscount,
        });

        this.logger.log(`Deleted bonus discount ${id}`);

        return {
          success: true,
          message: 'Desconto do bônus excluído com sucesso',
        };
      } catch (error) {
        this.logger.error(`Error deleting bonus discount ${id}:`, error);
        if (error instanceof NotFoundException) {
          throw error;
        }
        throw new InternalServerErrorException('Erro interno ao excluir desconto do bônus');
      }
    });
  }

  /**
   * Batch create bonus discounts
   * @param data Array of creation data
   * @param userId The user ID for changelog
   * @returns Batch operation result
   */
  async batchCreate(
    data: BonusDiscountBatchCreateFormData,
    userId: string,
  ): Promise<BatchOperationResult<BonusDiscount>> {
    const results: BatchOperationResult<BonusDiscount> = {
      success: [],
      failed: [],
      totalProcessed: data.discounts.length,
      totalSuccess: 0,
      totalFailed: 0,
    };

    for (const [index, discountData] of data.discounts.entries()) {
      try {
        const discount = await this.create(discountData, userId);
        results.success.push(discount);
      } catch (error) {
        results.failed.push({
          index,
          data: discountData,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    results.totalSuccess = results.success.length;
    results.totalFailed = results.failed.length;

    this.logger.log(
      `Batch create completed: ${results.totalSuccess}/${results.totalProcessed} successful`,
    );

    return results;
  }

  /**
   * Batch update bonus discounts
   * @param data Array of update data
   * @param userId The user ID for changelog
   * @returns Batch operation result
   */
  async batchUpdate(
    data: BonusDiscountBatchUpdateFormData,
    userId: string,
  ): Promise<BatchOperationResult<BonusDiscount>> {
    const results: BatchOperationResult<BonusDiscount> = {
      success: [],
      failed: [],
      totalProcessed: data.discounts.length,
      totalSuccess: 0,
      totalFailed: 0,
    };

    for (const [index, { id, data: updateData }] of data.discounts.entries()) {
      try {
        const discount = await this.update(id, updateData, userId);
        results.success.push(discount);
      } catch (error) {
        results.failed.push({
          index,
          data: { id, data: updateData },
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    results.totalSuccess = results.success.length;
    results.totalFailed = results.failed.length;

    this.logger.log(
      `Batch update completed: ${results.totalSuccess}/${results.totalProcessed} successful`,
    );

    return results;
  }

  /**
   * Batch delete bonus discounts
   * @param data Array of discount IDs
   * @param userId The user ID for changelog
   * @returns Batch operation result
   */
  async batchDelete(
    data: BonusDiscountBatchDeleteFormData,
    userId: string,
  ): Promise<BatchOperationResult<string>> {
    const results: BatchOperationResult<string> = {
      success: [],
      failed: [],
      totalProcessed: data.discountIds.length,
      totalSuccess: 0,
      totalFailed: 0,
    };

    for (const [index, discountId] of data.discountIds.entries()) {
      try {
        await this.delete(discountId, userId);
        results.success.push(discountId);
      } catch (error) {
        results.failed.push({
          index,
          data: discountId,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    results.totalSuccess = results.success.length;
    results.totalFailed = results.failed.length;

    this.logger.log(
      `Batch delete completed: ${results.totalSuccess}/${results.totalProcessed} successful`,
    );

    return results;
  }

  /**
   * Update calculation order for multiple discounts
   * @param bonusId The bonus ID
   * @param orderUpdates Array of {id, newOrder}
   * @param userId The user ID for changelog
   * @returns Updated discounts
   */
  async updateCalculationOrder(
    bonusId: string,
    orderUpdates: Array<{ id: string; newOrder: number }>,
    userId: string,
  ): Promise<BonusDiscount[]> {
    return this.prisma.$transaction(async transaction => {
      try {
        // Validate that all discounts belong to the specified bonus
        const existingDiscounts = await this.bonusDiscountRepository.findByBonusIdWithTransaction(
          transaction,
          bonusId,
        );

        const existingIds = existingDiscounts.map(d => d.id);
        const updateIds = orderUpdates.map(u => u.id);
        const invalidIds = updateIds.filter(id => !existingIds.includes(id));

        if (invalidIds.length > 0) {
          throw new BadRequestException(
            `Os seguintes descontos não pertencem ao bônus especificado: ${invalidIds.join(', ')}`,
          );
        }

        // Update each discount's calculation order
        const updatedDiscounts: BonusDiscount[] = [];

        for (const { id, newOrder } of orderUpdates) {
          const currentDiscount = existingDiscounts.find(d => d.id === id)!;

          if (currentDiscount.calculationOrder !== newOrder) {
            const updatedDiscount = await this.bonusDiscountRepository.updateWithTransaction(
              transaction,
              id,
              { calculationOrder: newOrder },
            );

            // Log the change
            await logEntityChange({
              changeLogService: this.changeLogService,
              transaction,
              entityType: ENTITY_TYPE.BONUS, // Using BONUS since BONUS_DISCOUNT doesn't exist yet
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              triggeredBy: CHANGE_TRIGGERED_BY.USER,
              userId,
              oldData: currentDiscount,
              newData: updatedDiscount,
              changes: {
                calculationOrder: { from: currentDiscount.calculationOrder, to: newOrder },
              },
            });

            updatedDiscounts.push(updatedDiscount);
          } else {
            updatedDiscounts.push(currentDiscount);
          }
        }

        this.logger.log(
          `Updated calculation order for ${orderUpdates.length} discounts in bonus ${bonusId}`,
        );

        return updatedDiscounts;
      } catch (error) {
        this.logger.error(`Error updating calculation order for bonus ${bonusId}:`, error);
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw new InternalServerErrorException(
          'Erro interno ao atualizar ordem de cálculo dos descontos',
        );
      }
    });
  }

  /**
   * Add a task to the suspended tasks list for a bonus discount
   * @param bonusDiscountId The bonus discount ID
   * @param taskId The task ID to suspend
   * @param userId The user ID for changelog
   * @returns Updated bonus discount
   */
  async addSuspendedTask(
    bonusDiscountId: string,
    taskId: string,
    userId: string,
  ): Promise<BonusDiscount> {
    return this.prisma.$transaction(async transaction => {
      try {
        // Get current bonus discount
        const currentDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(
          transaction,
          bonusDiscountId,
          { include: { bonus: true, suspendedTasks: true } },
        );

        if (!currentDiscount) {
          throw new NotFoundException(`Desconto com ID ${bonusDiscountId} não foi encontrado`);
        }

        // Get the task to validate
        const task = await transaction.task.findUnique({
          where: { id: taskId },
          select: { id: true, createdById: true },
        });

        if (!task) {
          throw new NotFoundException(`Tarefa com ID ${taskId} não foi encontrada`);
        }

        // Validate that task belongs to the same user as the bonus
        if (task.createdById !== currentDiscount.bonus.userId) {
          throw new BadRequestException('A tarefa deve pertencer ao mesmo usuário do bônus');
        }

        // Check if task is already suspended in this discount
        const isAlreadySuspended = currentDiscount.suspendedTasks?.some(
          suspendedTask => suspendedTask.id === taskId,
        );

        if (isAlreadySuspended) {
          throw new BadRequestException('Tarefa já está suspensa para este desconto');
        }

        // Update the discount to connect the task
        const updatedDiscount = await this.bonusDiscountRepository.updateWithTransaction(
          transaction,
          bonusDiscountId,
          {},
          {
            include: {
              bonus: true,
              suspendedTasks: true,
            },
          },
        );

        // Connect the task to this bonus discount
        await transaction.task.update({
          where: { id: taskId },
          data: {
            bonusDiscount: {
              connect: { id: bonusDiscountId },
            },
          },
        });

        // Log the change
        await logEntityChange({
          changeLogService: this.changeLogService,
          transaction,
          entityType: ENTITY_TYPE.BONUS, // Using BONUS since BONUS_DISCOUNT doesn't exist yet
          entityId: bonusDiscountId,
          action: CHANGE_ACTION.UPDATE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          oldData: currentDiscount,
          newData: updatedDiscount,
          changes: {
            suspendedTasks: {
              from: currentDiscount.suspendedTasks?.map(t => t.id) || [],
              to: [...(currentDiscount.suspendedTasks?.map(t => t.id) || []), taskId],
            },
          },
        });

        this.logger.log(`Added suspended task ${taskId} to bonus discount ${bonusDiscountId}`);

        // Fetch updated discount with all relations
        return this.findByIdOrThrow(bonusDiscountId, {
          bonus: true,
          suspendedTasks: true,
        });
      } catch (error) {
        this.logger.error(
          `Error adding suspended task ${taskId} to bonus discount ${bonusDiscountId}:`,
          error,
        );
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        throw new InternalServerErrorException('Erro interno ao adicionar tarefa suspensa');
      }
    });
  }

  /**
   * Remove a task from the suspended tasks list for a bonus discount
   * @param bonusDiscountId The bonus discount ID
   * @param taskId The task ID to remove from suspension
   * @param userId The user ID for changelog
   * @returns Updated bonus discount
   */
  async removeSuspendedTask(
    bonusDiscountId: string,
    taskId: string,
    userId: string,
  ): Promise<BonusDiscount> {
    return this.prisma.$transaction(async transaction => {
      try {
        // Get current bonus discount
        const currentDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(
          transaction,
          bonusDiscountId,
          { include: { bonus: true, suspendedTasks: true } },
        );

        if (!currentDiscount) {
          throw new NotFoundException(`Desconto com ID ${bonusDiscountId} não foi encontrado`);
        }

        // Check if task is actually suspended
        const isSuspended = currentDiscount.suspendedTasks?.some(
          suspendedTask => suspendedTask.id === taskId,
        );

        if (!isSuspended) {
          throw new BadRequestException('Tarefa não está suspensa para este desconto');
        }

        // Disconnect the task from this bonus discount
        await transaction.task.update({
          where: { id: taskId },
          data: {
            bonusDiscount: {
              disconnect: true,
            },
          },
        });

        // Get updated discount
        const updatedDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(
          transaction,
          bonusDiscountId,
          {
            include: {
              bonus: true,
              suspendedTasks: true,
            },
          },
        );

        // Log the change
        await logEntityChange({
          changeLogService: this.changeLogService,
          transaction,
          entityType: ENTITY_TYPE.BONUS, // Using BONUS since BONUS_DISCOUNT doesn't exist yet
          entityId: bonusDiscountId,
          action: CHANGE_ACTION.UPDATE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          oldData: currentDiscount,
          newData: updatedDiscount,
          changes: {
            suspendedTasks: {
              from: currentDiscount.suspendedTasks?.map(t => t.id) || [],
              to: updatedDiscount.suspendedTasks?.map(t => t.id) || [],
            },
          },
        });

        this.logger.log(`Removed suspended task ${taskId} from bonus discount ${bonusDiscountId}`);

        return updatedDiscount!;
      } catch (error) {
        this.logger.error(
          `Error removing suspended task ${taskId} from bonus discount ${bonusDiscountId}:`,
          error,
        );
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        throw new InternalServerErrorException('Erro interno ao remover tarefa suspensa');
      }
    });
  }

  /**
   * Get all suspended tasks for a bonus discount
   * @param bonusDiscountId The bonus discount ID
   * @returns Array of suspended tasks
   */
  async getSuspendedTasks(bonusDiscountId: string): Promise<Task[]> {
    try {
      const discount = await this.bonusDiscountRepository.findById(bonusDiscountId, {
        include: {
          suspendedTasks: {
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                },
              },
              user: {
                select: {
                  id: true,
                  name: true,
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
        },
      });

      if (!discount) {
        throw new NotFoundException(`Desconto com ID ${bonusDiscountId} não foi encontrado`);
      }

      return discount.suspendedTasks || [];
    } catch (error) {
      this.logger.error(
        `Error getting suspended tasks for bonus discount ${bonusDiscountId}:`,
        error,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro interno ao buscar tarefas suspensas');
    }
  }

  /**
   * Validate that tasks can be suspended for a specific bonus discount
   * @param bonusDiscountId The bonus discount ID
   * @param taskIds Array of task IDs to validate
   * @param userId The user ID for validation
   * @private
   */
  private async validateSuspendedTasks(
    bonusDiscountId: string,
    taskIds: string[],
    userId?: string,
  ): Promise<void> {
    if (taskIds.length === 0) return;

    // Get the bonus discount with bonus info
    const discount = await this.bonusDiscountRepository.findById(bonusDiscountId, {
      include: {
        bonus: true,
      },
    });

    if (!discount) {
      throw new NotFoundException(`Desconto com ID ${bonusDiscountId} não foi encontrado`);
    }

    await this.validateTasksForBonus(discount.bonus, taskIds);
  }

  /**
   * Validate that tasks can be suspended for a specific bonus (by bonus ID)
   * @param bonusId The bonus ID
   * @param taskIds Array of task IDs to validate
   * @param userId The user ID for validation
   * @private
   */
  private async validateSuspendedTasksForBonus(
    bonusId: string,
    taskIds: string[],
    userId?: string,
  ): Promise<void> {
    if (taskIds.length === 0) return;

    // Get the bonus info
    const bonus = await this.prisma.bonus.findUnique({
      where: { id: bonusId },
      select: {
        id: true,
        userId: true,
        year: true,
        month: true,
      },
    });

    if (!bonus) {
      throw new NotFoundException(`Bônus com ID ${bonusId} não foi encontrado`);
    }

    await this.validateTasksForBonus(bonus, taskIds);
  }

  /**
   * Common validation logic for tasks against a bonus
   * @param bonus The bonus object with user and period info
   * @param taskIds Array of task IDs to validate
   * @private
   */
  private async validateTasksForBonus(
    bonus: { id: string; userId: string; year: number; month: number },
    taskIds: string[],
  ): Promise<void> {
    // Get tasks to validate
    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: taskIds },
      },
      select: {
        id: true,
        createdById: true,
        createdAt: true,
      },
    });

    // Check if all tasks exist
    const foundTaskIds = tasks.map(task => task.id);
    const missingTaskIds = taskIds.filter(id => !foundTaskIds.includes(id));
    if (missingTaskIds.length > 0) {
      throw new NotFoundException(
        `As seguintes tarefas não foram encontradas: ${missingTaskIds.join(', ')}`,
      );
    }

    // Check if all tasks belong to the same user as the bonus
    const invalidTasks = tasks.filter(task => task.createdById !== bonus.userId);
    if (invalidTasks.length > 0) {
      throw new BadRequestException(
        `As seguintes tarefas não pertencem ao usuário do bônus: ${invalidTasks.map(t => t.id).join(', ')}`,
      );
    }

    // Check if tasks belong to the same period (year/month) as the bonus
    const bonusYear = bonus.year;
    const bonusMonth = bonus.month;

    const tasksOutOfPeriod = tasks.filter(task => {
      const taskDate = new Date(task.createdAt);
      const taskYear = taskDate.getFullYear();
      const taskMonth = taskDate.getMonth() + 1; // JavaScript months are 0-indexed
      return taskYear !== bonusYear || taskMonth !== bonusMonth;
    });

    if (tasksOutOfPeriod.length > 0) {
      throw new BadRequestException(
        `As seguintes tarefas não pertencem ao período do bônus (${bonusMonth}/${bonusYear}): ${tasksOutOfPeriod.map(t => t.id).join(', ')}`,
      );
    }
  }

  /**
   * Delete all discounts for a bonus
   * @param bonusId The bonus ID
   * @param userId The user ID for changelog
   * @returns Number of deleted discounts
   */
  async deleteByBonusId(bonusId: string, userId: string): Promise<number> {
    return this.prisma.$transaction(async transaction => {
      try {
        // Get existing discounts for changelog
        const existingDiscounts = await this.bonusDiscountRepository.findByBonusIdWithTransaction(
          transaction,
          bonusId,
        );

        if (existingDiscounts.length === 0) {
          return 0;
        }

        // Delete all discounts
        const deletedCount = await this.bonusDiscountRepository.deleteByBonusIdWithTransaction(
          transaction,
          bonusId,
        );

        // Log deletions
        for (const discount of existingDiscounts) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            transaction,
            entityType: ENTITY_TYPE.BONUS, // Using BONUS since BONUS_DISCOUNT doesn't exist yet
            entityId: discount.id,
            action: CHANGE_ACTION.DELETE,
            triggeredBy: CHANGE_TRIGGERED_BY.USER,
            userId,
            oldData: discount,
          });
        }

        this.logger.log(`Deleted ${deletedCount} discounts for bonus ${bonusId}`);

        return deletedCount;
      } catch (error) {
        this.logger.error(`Error deleting discounts for bonus ${bonusId}:`, error);
        throw new InternalServerErrorException('Erro interno ao excluir descontos do bônus');
      }
    });
  }
}
