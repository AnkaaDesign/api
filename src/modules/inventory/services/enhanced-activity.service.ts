// apps/api/src/modules/inventory/services/enhanced-activity.service.ts

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  PrismaTransaction,
  ActivityRepository,
} from '../activity/repositories/activity.repository';
import {
  AtomicStockCalculatorService,
  StockUpdateOperation,
} from './atomic-stock-calculator.service';
import { AtomicStockUpdateService, StockUpdateResult } from './atomic-stock-update.service';
import { StockErrorHandlerService } from './stock-error-handler.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
} from '../../../constants/enums';
import type {
  ActivityCreateFormData,
  ActivityUpdateFormData,
  ActivityInclude,
} from '../../../schemas/activity';
import type {
  ActivityCreateResponse,
  ActivityUpdateResponse,
  ActivityDeleteResponse,
} from '../../../types';
import { ActivityService } from '../activity/activity.service';
import {
  ActivityReason as PrismaActivityReason,
  ActivityOperation as PrismaActivityOperation,
} from '@prisma/client';

export interface EnhancedActivityCreateData {
  itemId: string;
  quantity: number;
  operation: ACTIVITY_OPERATION;
  reason?: ACTIVITY_REASON | null;
  userId?: string | null;
  orderId?: string | null;
  orderItemId?: string | null;
}

export interface EnhancedActivityUpdateData {
  itemId?: string;
  quantity?: number;
  operation?: ACTIVITY_OPERATION;
  reason?: ACTIVITY_REASON | null;
  userId?: string | null;
  orderId?: string | null;
  orderItemId?: string | null;
}

export interface EnhancedActivityResult {
  activity: any;
  stockUpdate: StockUpdateResult;
  warnings: string[];
  executionTime: number;
}

export interface BatchActivityResult {
  activities: any[];
  stockUpdate: StockUpdateResult;
  warnings: string[];
  failures: Array<{
    index: number;
    data: any;
    error: string;
  }>;
  executionTime: number;
  totalProcessed: number;
  totalSuccess: number;
  totalFailed: number;
}

@Injectable()
export class EnhancedActivityService {
  private readonly logger = new Logger(EnhancedActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityRepository: ActivityRepository,
    private readonly stockCalculator: AtomicStockCalculatorService,
    private readonly stockUpdater: AtomicStockUpdateService,
    private readonly errorHandler: StockErrorHandlerService,
    private readonly changeLogService: ChangeLogService,
    @Inject(forwardRef(() => ActivityService))
    private readonly activityService: ActivityService,
  ) {}

  /**
   * Create activity with atomic stock update and comprehensive validation
   */
  async createActivityAtomic(
    data: EnhancedActivityCreateData,
    include?: ActivityInclude,
    userId?: string,
  ): Promise<EnhancedActivityResult> {
    const startTime = Date.now();

    return await this.prisma.$transaction(async tx => {
      try {
        // Step 1: Determine activity reason using business rules
        const determinedReason = this.determineActivityReason(
          data.operation,
          data.userId,
          data.reason,
        );

        // Step 2: Auto-assign order if not provided but reason indicates order operation
        let finalOrderId = data.orderId;
        let finalOrderItemId = data.orderItemId;

        if (!finalOrderId && determinedReason === ACTIVITY_REASON.ORDER_RECEIVED) {
          const orderAssignment = await this.findMatchingOrderForActivity(
            tx,
            data.itemId,
            data.operation,
            determinedReason,
          );
          finalOrderId = orderAssignment.orderId;
          finalOrderItemId = orderAssignment.orderItemId;
        }

        // Step 3: Prepare stock operation
        const stockOperation: StockUpdateOperation = {
          itemId: data.itemId,
          quantity: data.quantity,
          operation: data.operation,
          reason: determinedReason,
          orderId: finalOrderId,
          orderItemId: finalOrderItemId,
          userId: data.userId,
        };

        // Step 4: Calculate and validate stock changes
        const plan = await this.stockCalculator.calculateStockUpdates([stockOperation], tx);

        if (!plan.canProceed) {
          this.errorHandler.handleStockError(plan);
        }

        // Step 5: Apply atomic stock update
        const stockUpdateResult = await this.stockUpdater.executeAtomicUpdate(plan, tx, userId);

        // Step 6: Create activity record
        const activity = await tx.activity.create({
          data: {
            itemId: data.itemId,
            quantity: data.quantity,
            operation: data.operation as PrismaActivityOperation,
            reason: determinedReason ? (determinedReason as PrismaActivityReason) : undefined,
            userId: data.userId,
            orderId: finalOrderId,
            orderItemId: finalOrderItemId,
          },
          include: include as any,
        });

        // Step 7: Trigger monthly consumption recalculation for OUTBOUND activities
        if (data.operation === ACTIVITY_OPERATION.OUTBOUND) {
          try {
            await this.activityService['calculateAndUpdateItemMonthlyConsumption'](
              tx,
              data.itemId,
              userId,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to update monthly consumption for item ${data.itemId}:`,
              error,
            );
          }
        }

        // Step 8: Log activity creation
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ACTIVITY,
          entityId: activity.id,
          action: CHANGE_ACTION.CREATE,
          field: null,
          oldValue: null,
          newValue: activity,
          reason: `Atividade criada com atualização atômica: ${data.operation === ACTIVITY_OPERATION.INBOUND ? 'entrada' : 'saída'} de ${data.quantity} unidades${determinedReason ? ` (${determinedReason})` : ''}`,
          triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_CREATE,
          triggeredById: activity.id,
          userId: userId || '',
          transaction: tx,
        });

        const result: EnhancedActivityResult = {
          activity,
          stockUpdate: stockUpdateResult,
          warnings: stockUpdateResult.warnings,
          executionTime: Date.now() - startTime,
        };

        this.logger.log(
          `Activity created atomically: ${activity.id} (${data.operation} ${data.quantity} of item ${data.itemId}) ` +
            `in ${result.executionTime}ms with ${result.warnings.length} warnings`,
        );

        return result;
      } catch (error) {
        this.logger.error('Error creating activity atomically:', error);
        throw error; // Re-throw to trigger transaction rollback
      }
    });
  }

  /**
   * Update activity with atomic stock recalculation
   */
  async updateActivityAtomic(
    activityId: string,
    data: EnhancedActivityUpdateData,
    include?: ActivityInclude,
    userId?: string,
  ): Promise<EnhancedActivityResult> {
    const startTime = Date.now();

    return await this.prisma.$transaction(async tx => {
      try {
        // Step 1: Get existing activity
        const existingActivity = await tx.activity.findUnique({
          where: { id: activityId },
          include: {
            item: { select: { name: true } },
          },
        });

        if (!existingActivity) {
          throw new NotFoundException('Atividade não encontrada');
        }

        // Step 2: Determine new values and business rules
        const newOperation = data.operation ?? existingActivity.operation;
        const newUserId = data.userId !== undefined ? data.userId : existingActivity.userId;
        const determinedReason = this.determineActivityReason(
          newOperation as ACTIVITY_OPERATION,
          newUserId,
          data.reason,
        );

        // Step 3: Check if order assignment needs to be updated
        let newOrderId = data.orderId !== undefined ? data.orderId : existingActivity.orderId;
        let newOrderItemId =
          data.orderItemId !== undefined ? data.orderItemId : existingActivity.orderItemId;

        const itemChanged = data.itemId && data.itemId !== existingActivity.itemId;
        const operationChanged = newOperation !== existingActivity.operation;
        const reasonChanged = determinedReason !== existingActivity.reason;

        if (
          (itemChanged || operationChanged || reasonChanged) &&
          !newOrderId &&
          determinedReason === ACTIVITY_REASON.ORDER_RECEIVED
        ) {
          const orderAssignment = await this.findMatchingOrderForActivity(
            tx,
            data.itemId ?? existingActivity.itemId,
            newOperation as ACTIVITY_OPERATION,
            determinedReason,
          );
          newOrderId = orderAssignment.orderId;
          newOrderItemId = orderAssignment.orderItemId;
        }

        // Step 4: Prepare stock operation (includes reversal of old + application of new)
        const stockOperation: StockUpdateOperation = {
          itemId: data.itemId ?? existingActivity.itemId,
          quantity: data.quantity ?? existingActivity.quantity,
          operation: newOperation as ACTIVITY_OPERATION,
          reason: determinedReason,
          orderId: newOrderId,
          orderItemId: newOrderItemId,
          userId: newUserId,
          activityId: activityId, // This tells the calculator to reverse the existing operation first
        };

        // Step 5: Calculate and validate stock changes
        const plan = await this.stockCalculator.calculateStockUpdates([stockOperation], tx);

        if (!plan.canProceed) {
          this.errorHandler.handleStockError(plan);
        }

        // Step 6: Apply atomic stock update
        const stockUpdateResult = await this.stockUpdater.executeAtomicUpdate(plan, tx, userId);

        // Step 7: Update activity record
        const updatedActivity = await tx.activity.update({
          where: { id: activityId },
          data: {
            itemId: data.itemId,
            quantity: data.quantity,
            operation: data.operation as PrismaActivityOperation,
            reason: determinedReason ? (determinedReason as PrismaActivityReason) : undefined,
            userId: newUserId,
            orderId: newOrderId,
            orderItemId: newOrderItemId,
          },
          include: include as any,
        });

        // Step 8: Log field-level changes
        const fieldsToTrack = [
          'quantity',
          'operation',
          'reason',
          'itemId',
          'orderId',
          'orderItemId',
          'userId',
        ];

        for (const field of fieldsToTrack) {
          const oldValue = existingActivity[field as keyof typeof existingActivity];
          const newValue = updatedActivity[field as keyof typeof updatedActivity];

          if (this.hasValueChanged(oldValue, newValue)) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ACTIVITY,
              entityId: activityId,
              action: CHANGE_ACTION.UPDATE,
              field: field,
              oldValue: oldValue,
              newValue: newValue,
              reason: `Campo ${field} atualizado com recálculo atômico de estoque`,
              triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_UPDATE,
              triggeredById: activityId,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        const result: EnhancedActivityResult = {
          activity: updatedActivity,
          stockUpdate: stockUpdateResult,
          warnings: stockUpdateResult.warnings,
          executionTime: Date.now() - startTime,
        };

        this.logger.log(
          `Activity updated atomically: ${activityId} ` +
            `(${existingActivity.item.name}: ${existingActivity.quantity} → ${updatedActivity.quantity}) ` +
            `in ${result.executionTime}ms with ${result.warnings.length} warnings`,
        );

        return result;
      } catch (error) {
        this.logger.error('Error updating activity atomically:', error);
        throw error; // Re-throw to trigger transaction rollback
      }
    });
  }

  /**
   * Delete activity with atomic stock reversal
   */
  async deleteActivityAtomic(
    activityId: string,
    userId?: string,
  ): Promise<{ deleted: boolean; stockUpdate: StockUpdateResult; executionTime: number }> {
    const startTime = Date.now();

    return await this.prisma.$transaction(async tx => {
      try {
        // Step 1: Get existing activity
        const existingActivity = await tx.activity.findUnique({
          where: { id: activityId },
          include: {
            item: { select: { name: true } },
          },
        });

        if (!existingActivity) {
          throw new NotFoundException('Atividade não encontrada');
        }

        // Step 2: Prepare reversal operation
        const reversalOperation: StockUpdateOperation = {
          itemId: existingActivity.itemId,
          quantity: existingActivity.quantity,
          operation:
            existingActivity.operation === 'INBOUND'
              ? ACTIVITY_OPERATION.OUTBOUND
              : ACTIVITY_OPERATION.INBOUND,
          reason: existingActivity.reason ? (existingActivity.reason as ACTIVITY_REASON) : null,
          orderId: existingActivity.orderId,
          orderItemId: existingActivity.orderItemId,
          userId: existingActivity.userId,
        };

        // Step 3: Calculate and validate stock changes
        const plan = await this.stockCalculator.calculateStockUpdates([reversalOperation], tx);

        if (!plan.canProceed) {
          const allErrors = [...plan.globalErrors, ...plan.calculations.flatMap(c => c.errors)];
          throw new BadRequestException(
            `Não é possível excluir atividade: ${allErrors.join('; ')}`,
          );
        }

        // Step 4: Apply atomic stock update
        const stockUpdateResult = await this.stockUpdater.executeAtomicUpdate(plan, tx, userId);

        // Step 5: Log deletion before actually deleting
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ACTIVITY,
          entityId: activityId,
          action: CHANGE_ACTION.DELETE,
          field: null,
          oldValue: existingActivity,
          newValue: null,
          reason: `Atividade excluída com reversão atômica de estoque: ${existingActivity.operation} ${existingActivity.quantity} unidades do item ${existingActivity.item.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_DELETE,
          triggeredById: activityId,
          userId: userId || '',
          transaction: tx,
        });

        // Step 6: Delete activity record
        await tx.activity.delete({
          where: { id: activityId },
        });

        const result = {
          deleted: true,
          stockUpdate: stockUpdateResult,
          executionTime: Date.now() - startTime,
        };

        this.logger.log(
          `Activity deleted atomically: ${activityId} ` +
            `(reversed ${existingActivity.operation} ${existingActivity.quantity} of ${existingActivity.item.name}) ` +
            `in ${result.executionTime}ms`,
        );

        return result;
      } catch (error) {
        this.logger.error('Error deleting activity atomically:', error);
        throw error; // Re-throw to trigger transaction rollback
      }
    });
  }

  /**
   * Batch create activities with atomic stock updates
   */
  async batchCreateActivitiesAtomic(
    activities: EnhancedActivityCreateData[],
    include?: ActivityInclude,
    userId?: string,
  ): Promise<BatchActivityResult> {
    const startTime = Date.now();

    if (activities.length === 0) {
      throw new BadRequestException('Nenhuma atividade fornecida para criação em lote');
    }

    if (activities.length > 1000) {
      throw new BadRequestException('Número de atividades excede o limite máximo (1000)');
    }

    return await this.prisma.$transaction(async tx => {
      try {
        const result: BatchActivityResult = {
          activities: [],
          stockUpdate: {} as StockUpdateResult,
          warnings: [],
          failures: [],
          executionTime: 0,
          totalProcessed: activities.length,
          totalSuccess: 0,
          totalFailed: 0,
        };

        // Step 1: Prepare all stock operations with validation
        const stockOperations: StockUpdateOperation[] = [];
        const validActivities: (EnhancedActivityCreateData & { index: number })[] = [];

        for (let i = 0; i < activities.length; i++) {
          const activity = activities[i];
          try {
            // Basic validation
            if (
              !activity.itemId ||
              !activity.quantity ||
              activity.quantity <= 0 ||
              !activity.operation
            ) {
              throw new BadRequestException('Dados da atividade incompletos ou inválidos');
            }

            // Determine reason and order assignment
            const determinedReason = this.determineActivityReason(
              activity.operation,
              activity.userId,
              activity.reason,
            );

            let finalOrderId = activity.orderId;
            let finalOrderItemId = activity.orderItemId;

            if (!finalOrderId && determinedReason === ACTIVITY_REASON.ORDER_RECEIVED) {
              const orderAssignment = await this.findMatchingOrderForActivity(
                tx,
                activity.itemId,
                activity.operation,
                determinedReason,
              );
              finalOrderId = orderAssignment.orderId;
              finalOrderItemId = orderAssignment.orderItemId;
            }

            stockOperations.push({
              itemId: activity.itemId,
              quantity: activity.quantity,
              operation: activity.operation,
              reason: determinedReason,
              orderId: finalOrderId,
              orderItemId: finalOrderItemId,
              userId: activity.userId,
            });

            validActivities.push({ ...activity, index: i });
          } catch (error) {
            result.failures.push({
              index: i,
              data: activity,
              error: error instanceof Error ? error.message : 'Erro de validação',
            });
            result.totalFailed++;
          }
        }

        // Step 2: Calculate and validate all stock changes at once
        if (stockOperations.length > 0) {
          const plan = await this.stockCalculator.calculateStockUpdates(stockOperations, tx);

          if (!plan.canProceed) {
            // If the plan fails, add all operations to failures
            for (const validActivity of validActivities) {
              result.failures.push({
                index: validActivity.index,
                data: validActivity,
                error: 'Falha na validação do plano de estoque',
              });
              result.totalFailed++;
            }

            this.errorHandler.handleStockError(plan);
          }

          // Step 3: Apply atomic stock update for all items
          result.stockUpdate = await this.stockUpdater.executeAtomicUpdate(plan, tx, userId);
          result.warnings = result.stockUpdate.warnings;

          // Step 4: Create all activity records
          for (let i = 0; i < validActivities.length; i++) {
            const activityData = validActivities[i];
            const stockOp = stockOperations[i];

            try {
              const activity = await tx.activity.create({
                data: {
                  itemId: stockOp.itemId,
                  quantity: stockOp.quantity,
                  operation: stockOp.operation as PrismaActivityOperation,
                  reason: stockOp.reason ? (stockOp.reason as PrismaActivityReason) : undefined,
                  userId: stockOp.userId,
                  orderId: stockOp.orderId,
                  orderItemId: stockOp.orderItemId,
                },
                include: include as any,
              });

              // Log activity creation
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.ACTIVITY,
                entityId: activity.id,
                action: CHANGE_ACTION.CREATE,
                field: null,
                oldValue: null,
                newValue: activity,
                reason: 'Atividade criada em lote com atualização atômica',
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
                triggeredById: activity.id,
                userId: userId || '',
                transaction: tx,
              });

              result.activities.push(activity);
              result.totalSuccess++;
            } catch (error) {
              result.failures.push({
                index: activityData.index,
                data: activityData,
                error: `Erro ao criar atividade: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
              });
              result.totalFailed++;
            }
          }
        } else {
          result.totalFailed = activities.length;
        }

        result.executionTime = Date.now() - startTime;

        this.logger.log(
          `Batch activity creation completed: ${result.totalSuccess} created, ${result.totalFailed} failed, ` +
            `${result.warnings.length} warnings in ${result.executionTime}ms`,
        );

        return result;
      } catch (error) {
        this.logger.error('Error in batch activity creation:', error);
        throw error; // Re-throw to trigger transaction rollback
      }
    });
  }

  /**
   * Determine activity reason based on operation and user using business rules
   */
  private determineActivityReason(
    operation: ACTIVITY_OPERATION,
    userId?: string | null,
    providedReason?: ACTIVITY_REASON | null,
  ): ACTIVITY_REASON | null {
    // If reason is explicitly provided, use it
    if (providedReason) {
      // Only return if it's a valid Prisma enum value
      const validPrismaReasons = [
        ACTIVITY_REASON.ORDER_RECEIVED,
        ACTIVITY_REASON.PRODUCTION_USAGE,
        ACTIVITY_REASON.PPE_DELIVERY,
        ACTIVITY_REASON.BORROW,
        ACTIVITY_REASON.RETURN,
        ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
        ACTIVITY_REASON.INVENTORY_COUNT,
        ACTIVITY_REASON.MANUAL_ADJUSTMENT,
        ACTIVITY_REASON.MAINTENANCE,
        ACTIVITY_REASON.DAMAGE,
      ];

      if (validPrismaReasons.includes(providedReason)) {
        return providedReason;
      }
      // If it's not a valid Prisma reason, fall through to default logic
    }

    // Apply business rules for automatic reason determination
    if (operation === ACTIVITY_OPERATION.OUTBOUND) {
      return ACTIVITY_REASON.PRODUCTION_USAGE;
    }

    if (operation === ACTIVITY_OPERATION.INBOUND) {
      if (userId) {
        return ACTIVITY_REASON.RETURN;
      } else {
        return ACTIVITY_REASON.ORDER_RECEIVED;
      }
    }

    return null;
  }

  /**
   * Find a matching order for the activity based on the item
   */
  private async findMatchingOrderForActivity(
    tx: PrismaTransaction,
    itemId: string,
    operation: ACTIVITY_OPERATION,
    reason: ACTIVITY_REASON | null | undefined,
  ): Promise<{ orderId: string | null; orderItemId: string | null }> {
    // Only auto-assign for INBOUND activities with ORDER_RECEIVED reason
    if (operation !== ACTIVITY_OPERATION.INBOUND || reason !== ACTIVITY_REASON.ORDER_RECEIVED) {
      return { orderId: null, orderItemId: null };
    }

    // Find orders that have this item and are not fully received
    const orderItems = await tx.orderItem.findMany({
      where: {
        itemId,
        order: {
          status: {
            notIn: ['RECEIVED', 'CANCELLED'],
          },
        },
      },
      include: {
        order: true,
      },
      orderBy: {
        order: {
          createdAt: 'asc', // Prioritize older orders
        },
      },
    });

    // Find the first order item that still has quantity to receive
    const orderItem = orderItems.find(item => {
      const receivedQty = item.receivedQuantity || 0;
      return receivedQty < item.orderedQuantity;
    });

    if (orderItem) {
      return { orderId: orderItem.orderId, orderItemId: orderItem.id };
    }

    return { orderId: null, orderItemId: null };
  }

  /**
   * Check if a value has changed (for changelog tracking)
   */
  private hasValueChanged(oldValue: any, newValue: any): boolean {
    // Handle null/undefined cases
    if (oldValue === null && newValue === null) return false;
    if (oldValue === undefined && newValue === undefined) return false;
    if (oldValue === null && newValue === undefined) return false;
    if (oldValue === undefined && newValue === null) return false;

    // Handle primitive values
    if (typeof oldValue !== 'object' && typeof newValue !== 'object') {
      return oldValue !== newValue;
    }

    // For objects, do a simple JSON comparison (basic case)
    try {
      return JSON.stringify(oldValue) !== JSON.stringify(newValue);
    } catch {
      return true; // If serialization fails, assume changed
    }
  }

  /**
   * Validate activity data structure
   */
  private validateActivityData(data: any): void {
    if ('quantity' in data && data.quantity !== undefined) {
      if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
        throw new BadRequestException('Quantidade deve ser um número positivo');
      }
      if (data.quantity > 999999) {
        throw new BadRequestException('Quantidade excede o limite máximo (999,999)');
      }
      if (data.quantity !== Math.round(data.quantity * 100) / 100) {
        throw new BadRequestException('Quantidade deve ter no máximo 2 casas decimais');
      }
    }

    if ('operation' in data && data.operation) {
      const operationStr =
        typeof data.operation === 'string' ? data.operation : data.operation.toString();
      if (!Object.values(ACTIVITY_OPERATION).includes(operationStr as ACTIVITY_OPERATION)) {
        throw new BadRequestException('Tipo de operação inválido');
      }
    }

    if ('reason' in data && data.reason) {
      const reasonStr = typeof data.reason === 'string' ? data.reason : data.reason.toString();
      if (!Object.values(ACTIVITY_REASON).includes(reasonStr as ACTIVITY_REASON)) {
        throw new BadRequestException('Motivo da atividade inválido');
      }
    }
  }

  /**
   * Convert to standard activity service responses for backward compatibility
   */
  async createActivity(
    data: ActivityCreateFormData,
    include?: ActivityInclude,
    userId?: string,
  ): Promise<ActivityCreateResponse> {
    this.validateActivityData(data);

    const enhancedData: EnhancedActivityCreateData = {
      itemId: data.itemId,
      quantity: data.quantity,
      operation: data.operation as ACTIVITY_OPERATION,
      reason: data.reason ? (data.reason as ACTIVITY_REASON) : null,
      userId: data.userId || null,
    };

    const result = await this.createActivityAtomic(enhancedData, include, userId);

    return {
      success: true,
      message: `Atividade criada com sucesso. ${result.stockUpdate.message}`,
      data: result.activity,
    };
  }

  /**
   * Convert to standard activity service responses for backward compatibility
   */
  async updateActivity(
    id: string,
    data: ActivityUpdateFormData,
    include?: ActivityInclude,
    userId?: string,
  ): Promise<ActivityUpdateResponse> {
    this.validateActivityData(data);

    const enhancedData: EnhancedActivityUpdateData = {};
    if (data.itemId !== undefined) enhancedData.itemId = data.itemId;
    if (data.quantity !== undefined) enhancedData.quantity = data.quantity;
    if (data.operation !== undefined) enhancedData.operation = data.operation as ACTIVITY_OPERATION;
    if (data.reason !== undefined)
      enhancedData.reason = data.reason ? (data.reason as ACTIVITY_REASON) : null;
    if (data.userId !== undefined) enhancedData.userId = data.userId;

    const result = await this.updateActivityAtomic(id, enhancedData, include, userId);

    return {
      success: true,
      message: `Atividade atualizada com sucesso. ${result.stockUpdate.message}`,
      data: result.activity,
    };
  }

  /**
   * Convert to standard activity service responses for backward compatibility
   */
  async deleteActivity(id: string, userId?: string): Promise<ActivityDeleteResponse> {
    const result = await this.deleteActivityAtomic(id, userId);

    return {
      success: true,
      message: `Atividade excluída com sucesso. ${result.stockUpdate.message}`,
    };
  }
}
