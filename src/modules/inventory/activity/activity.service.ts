// activity.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ActivityRepository, PrismaTransaction } from './repositories/activity.repository';
import type {
  ActivityBatchCreateResponse,
  ActivityBatchDeleteResponse,
  ActivityBatchUpdateResponse,
  ActivityCreateResponse,
  ActivityDeleteResponse,
  ActivityGetManyResponse,
  ActivityGetUniqueResponse,
  ActivityUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import type {
  ActivityCreateFormData,
  ActivityUpdateFormData,
  ActivityGetManyFormData,
  ActivityBatchCreateFormData,
  ActivityBatchUpdateFormData,
  ActivityBatchDeleteFormData,
  ActivityInclude,
} from '../../../schemas/activity';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  CHANGE_TRIGGERED_BY,
  USER_STATUS,
  ENTITY_TYPE,
  CHANGE_ACTION,
  ORDER_STATUS,
  EXTERNAL_WITHDRAWAL_STATUS,
  ACTIVE_USER_STATUSES,
} from '../../../constants/enums';
import {
  calculateMonthlyConsumption,
  calculateConsumptionTrend,
  calculateSuggestedQuantities,
} from '../../../utils';
import { EXTERNAL_WITHDRAWAL_STATUS_ORDER } from '../../../constants/sortOrders';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityRepository: ActivityRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Find a matching order for the activity based on the item
   * For INBOUND activities with ORDER_RECEIVED reason, find an order that:
   * - Contains the item
   * - Is not fully received yet
   * - Has remaining quantity to receive
   */
  private async findMatchingOrderForActivity(
    tx: PrismaTransaction,
    itemId: string,
    operation: ACTIVITY_OPERATION,
    reason: string | null | undefined,
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
            notIn: [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED],
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
   * Buscar muitas atividades com filtros
   */
  async findMany(query: ActivityGetManyFormData): Promise<ActivityGetManyResponse> {
    try {
      const result = await this.activityRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Atividades carregadas com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar atividades:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar atividades. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar uma atividade por ID
   */
  async findById(id: string, include?: ActivityInclude): Promise<ActivityGetUniqueResponse> {
    try {
      const activity = await this.activityRepository.findById(id, { include });

      if (!activity) {
        throw new NotFoundException('Atividade não encontrada');
      }

      return { success: true, data: activity, message: 'Atividade carregada com sucesso' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar atividade por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar atividade. Por favor, tente novamente',
      );
    }
  }

  /**
   * Check if an item has pending external withdrawal returns
   */
  private async hasExternalWithdrawalItemsToReturn(
    tx: PrismaTransaction,
    itemId: string,
  ): Promise<boolean> {
    const externalWithdrawalItems = await tx.externalWithdrawalItem.findMany({
      where: {
        itemId,
        externalWithdrawal: {
          status: {
            in: [
              EXTERNAL_WITHDRAWAL_STATUS.PENDING as any,
              EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED as any,
            ],
          },
        },
      },
    });

    return externalWithdrawalItems.some(item => item.returnedQuantity < item.withdrawedQuantity);
  }

  /**
   * Determine activity reason based on operation, user, and context
   * Business Rules:
   * - If operation is OUTBOUND → reason should be PRODUCTION_USAGE
   * - If operation is INBOUND:
   *   - If there are external withdrawal items to return → EXTERNAL_WITHDRAWAL_RETURN
   *   - If user is assigned → reason should be RETURN
   *   - If no user assigned → reason should be ORDER_RECEIVED
   *   - User assignment is optional for INBOUND operations
   */
  private async determineActivityReason(
    tx: PrismaTransaction,
    operation: ACTIVITY_OPERATION,
    itemId: string,
    userId?: string | null,
    providedReason?: string | null,
  ): Promise<ACTIVITY_REASON | null> {
    // If reason is explicitly provided, use it
    if (providedReason) {
      return providedReason as ACTIVITY_REASON;
    }

    // Apply business rules for automatic reason determination
    if (operation === ACTIVITY_OPERATION.OUTBOUND) {
      return ACTIVITY_REASON.PRODUCTION_USAGE;
    }

    if (operation === ACTIVITY_OPERATION.INBOUND) {
      // Check if this item has external withdrawal items that need to be returned
      const hasExternalWithdrawals = await this.hasExternalWithdrawalItemsToReturn(tx, itemId);

      if (hasExternalWithdrawals) {
        return ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN;
      }

      // User assignment is optional for INBOUND operations
      if (userId) {
        return ACTIVITY_REASON.RETURN;
      } else {
        return ACTIVITY_REASON.ORDER_RECEIVED;
      }
    }

    return null;
  }

  /**
   * Criar uma nova atividade
   */
  async create(
    data: ActivityCreateFormData,
    include?: ActivityInclude,
    userId?: string,
    options?: { skipSync?: boolean },
  ): Promise<ActivityCreateResponse> {
    try {
      const activity = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Determine reason based on business rules if not provided
        const determinedReason = await this.determineActivityReason(
          tx,
          data.operation,
          data.itemId,
          data.userId,
          data.reason,
        );

        // Validar a atividade
        await this.activityValidation({ ...data, reason: determinedReason }, tx);

        // Auto-assign order if not provided
        const { orderId, orderItemId } = await this.findMatchingOrderForActivity(
          tx,
          data.itemId,
          data.operation,
          determinedReason,
        );

        // Create activity data with auto-assigned order info and determined reason
        const activityData: any = {
          ...data,
          reason: determinedReason,
          orderId,
          orderItemId,
        };

        // Criar a atividade
        const newActivity = await this.activityRepository.createWithTransaction(tx, activityData, {
          include,
        });

        // Atualizar quantidade do item
        await this.updateItemQuantity(
          tx,
          data.itemId,
          data.quantity,
          data.operation,
          userId,
          data,
          orderId,
        );

        // Se a atividade está ligada a um pedido, sincronizar com o item do pedido
        if (orderId && orderItemId) {
          await this.syncOrderItemReceived(
            tx,
            orderId,
            orderItemId,
            data.operation,
            data.quantity,
            newActivity.id,
            userId,
          );
        }

        // Only sync with external withdrawals if this activity is specifically for external withdrawal returns
        // This avoids unnecessary database queries for unrelated activities
        // Skip sync if explicitly requested (e.g., from batch operations that already handle sync)
        if (data.reason === ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN && !options?.skipSync) {
          await this.syncExternalWithdrawalItemReturned(
            tx,
            data.itemId,
            data.operation,
            data.quantity,
            newActivity.id,
            userId,
          );
        }

        // Registrar no changelog usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ACTIVITY,
          entityId: newActivity.id,
          action: CHANGE_ACTION.CREATE,
          entity: newActivity,
          reason: `Nova atividade de estoque registrada: ${data.operation === ACTIVITY_OPERATION.INBOUND ? 'Entrada' : 'Saída'} de ${data.quantity} unidades${determinedReason && determinedReason !== data.reason ? ` (motivo determinado automaticamente: ${determinedReason})` : ''}`,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_CREATE,
          transaction: tx,
        });

        return newActivity;
      });

      return {
        success: true,
        message: 'Atividade criada com sucesso',
        data: activity,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar atividade:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar atividade. Por favor, tente novamente');
    }
  }

  /**
   * Atualizar uma atividade
   */
  async update(
    id: string,
    data: ActivityUpdateFormData,
    include?: ActivityInclude,
    userId?: string,
  ): Promise<ActivityUpdateResponse> {
    try {
      const updatedActivity = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar atividade existente
        const existingActivity = await this.activityRepository.findByIdWithTransaction(tx, id);

        if (!existingActivity) {
          throw new NotFoundException('Atividade não encontrada');
        }

        // Determine reason based on new or existing values
        const newOperation = data.operation ?? existingActivity.operation;
        const newUserId = data.userId !== undefined ? data.userId : existingActivity.userId;
        const itemId = data.itemId ?? existingActivity.itemId;

        // For updates, always recalculate reason based on new operation and user assignment
        // Only use provided reason if it's explicitly different from what would be auto-determined
        const autoReason = await this.determineActivityReason(
          tx,
          newOperation,
          itemId,
          newUserId,
          null,
        );
        const determinedReason =
          data.reason && data.reason !== autoReason ? (data.reason as ACTIVITY_REASON) : autoReason;

        // Validar os dados de atualização with determined reason and new operation
        await this.activityValidation(
          { ...data, reason: determinedReason, operation: newOperation },
          tx,
          existingActivity,
        );

        // Calcular a diferença para atualizar o estoque
        const oldQuantity = existingActivity.quantity;
        const oldOperation = existingActivity.operation;
        const newQuantity = data.quantity ?? existingActivity.quantity;

        // Reverter a operação anterior
        if (oldOperation === ACTIVITY_OPERATION.INBOUND) {
          await this.updateItemQuantity(
            tx,
            existingActivity.itemId,
            oldQuantity,
            ACTIVITY_OPERATION.OUTBOUND,
            userId,
          );
        } else {
          await this.updateItemQuantity(
            tx,
            existingActivity.itemId,
            oldQuantity,
            ACTIVITY_OPERATION.INBOUND,
            userId,
          );
        }

        // Aplicar a nova operação
        await this.updateItemQuantity(tx, itemId, newQuantity, newOperation, userId, {
          ...existingActivity,
          ...data,
        });

        // Check if we need to reassign order based on changed item, operation, or reason
        let newOrderId = existingActivity.orderId;
        let newOrderItemId = existingActivity.orderItemId;

        // If item, operation, or reason changed, we might need a new order assignment
        const itemChanged = itemId !== existingActivity.itemId;
        const operationChanged = newOperation !== oldOperation;
        const reasonChanged = determinedReason !== existingActivity.reason;

        if (itemChanged || operationChanged || reasonChanged) {
          // Find new matching order if applicable
          const { orderId, orderItemId } = await this.findMatchingOrderForActivity(
            tx,
            itemId,
            newOperation,
            determinedReason,
          );
          newOrderId = orderId;
          newOrderItemId = orderItemId;
        }

        // Update the activity with the new order assignment and determined reason
        const updateData = {
          ...data,
          reason: determinedReason,
          orderId: newOrderId,
          orderItemId: newOrderItemId,
        };

        // Atualizar a atividade
        const updatedActivity = await this.activityRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          { include },
        );

        // Se a atividade estava ligada a um pedido, reverter a sincronização anterior
        if (existingActivity.orderId && existingActivity.orderItemId) {
          // Reverter quantidade anterior
          await this.syncOrderItemReceived(
            tx,
            existingActivity.orderId,
            existingActivity.orderItemId,
            oldOperation === ACTIVITY_OPERATION.INBOUND
              ? ACTIVITY_OPERATION.OUTBOUND
              : ACTIVITY_OPERATION.INBOUND,
            oldQuantity,
            id,
            userId || undefined,
          );
        }

        // Aplicar nova sincronização se agora está ligada a um pedido
        if (newOrderId && newOrderItemId) {
          await this.syncOrderItemReceived(
            tx,
            newOrderId,
            newOrderItemId,
            newOperation,
            newQuantity,
            id,
            userId,
          );
        }

        // Only sync with external withdrawals if this activity is related to external withdrawal returns
        // Check both old and new reasons to handle updates properly
        const isExternalWithdrawalRelated =
          existingActivity.reason === ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN ||
          data.reason === ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN;

        if (isExternalWithdrawalRelated) {
          // Sync with external withdrawals - handle the old state first
          if (
            oldOperation === ACTIVITY_OPERATION.INBOUND &&
            existingActivity.reason === ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN
          ) {
            // Reverse the old return
            await this.syncExternalWithdrawalItemReturned(
              tx,
              existingActivity.itemId,
              ACTIVITY_OPERATION.OUTBOUND,
              oldQuantity,
              id,
              userId,
            );
          }

          // Apply new sync for external withdrawals if the new reason is external withdrawal return
          if (data.reason === ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN) {
            await this.syncExternalWithdrawalItemReturned(
              tx,
              itemId,
              newOperation,
              newQuantity,
              id,
              userId,
            );
          }
        }

        // Track field-level changes
        const fieldsToTrack = [
          'quantity',
          'operation',
          'reason',
          'itemId',
          'orderId',
          'orderItemId',
          'userId',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ACTIVITY,
          entityId: id,
          oldEntity: existingActivity,
          newEntity: updatedActivity,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_UPDATE,
          transaction: tx,
        });

        return updatedActivity;
      });

      return {
        success: true,
        message: 'Atividade atualizada com sucesso',
        data: updatedActivity,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar atividade:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar atividade. Por favor, tente novamente',
      );
    }
  }

  /**
   * Validar se a exclusão da atividade resultaria em quantidade negativa
   */
  private async validateActivityDeletion(activity: any): Promise<void> {
    // Buscar o item atual fora da transação para validação
    const item = await this.prisma.item.findUnique({
      where: { id: activity.itemId },
      select: { id: true, name: true, quantity: true },
    });

    if (!item) {
      throw new NotFoundException(`Item da atividade não encontrado`);
    }

    // Calcular o impacto da reversão da atividade
    let quantityAfterDeletion: number;

    if (activity.operation === ACTIVITY_OPERATION.INBOUND) {
      // Se foi uma entrada, reverter significa remover do estoque
      quantityAfterDeletion = item.quantity - activity.quantity;
    } else {
      // Se foi uma saída, reverter significa adicionar ao estoque
      quantityAfterDeletion = item.quantity + activity.quantity;
    }

    // Validar se a quantidade ficaria negativa
    if (quantityAfterDeletion < 0) {
      const operationDescription =
        activity.operation === ACTIVITY_OPERATION.INBOUND ? 'entrada' : 'saída';
      throw new BadRequestException(
        `Não é possível excluir esta atividade de ${operationDescription}. ` +
          `A reversão resultaria em estoque negativo para "${item.name}". ` +
          `Estoque atual: ${item.quantity}, ` +
          `Quantidade da atividade: ${activity.quantity}, ` +
          `Estoque após exclusão: ${quantityAfterDeletion}`,
      );
    }
  }

  /**
   * Validar impactos na sincronização de pedidos
   */
  private async validateOrderSyncImpact(activity: any): Promise<void> {
    if (!activity.orderId || !activity.orderItemId) {
      return; // Não há pedido associado
    }

    // Buscar informações do pedido e item do pedido
    const order = await this.prisma.order.findUnique({
      where: { id: activity.orderId },
      include: {
        items: {
          where: { id: activity.orderItemId },
          select: {
            id: true,
            orderedQuantity: true,
            receivedQuantity: true,
            item: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!order) {
      this.logger.warn(`Pedido ${activity.orderId} não encontrado para atividade ${activity.id}`);
      return;
    }

    const orderItem = order.items[0];
    if (!orderItem) {
      this.logger.warn(
        `Item do pedido ${activity.orderItemId} não encontrado para atividade ${activity.id}`,
      );
      return;
    }

    // Calcular impacto na quantidade recebida
    let newQuantityReceived: number;

    if (activity.operation === ACTIVITY_OPERATION.INBOUND) {
      // Se foi uma entrada, reverter significa diminuir a quantidade recebida
      newQuantityReceived = orderItem.receivedQuantity - activity.quantity;
    } else {
      // Se foi uma saída, reverter significa aumentar a quantidade recebida
      newQuantityReceived = orderItem.receivedQuantity + activity.quantity;
    }

    // Validar se a quantidade recebida ficaria negativa
    if (newQuantityReceived < 0) {
      throw new BadRequestException(
        `Não é possível excluir esta atividade. ` +
          `A reversão resultaria em quantidade recebida negativa para o item "${orderItem.item.name}" no pedido. ` +
          `Quantidade recebida atual: ${orderItem.receivedQuantity}, ` +
          `Quantidade da atividade: ${activity.quantity}, ` +
          `Quantidade recebida após exclusão: ${newQuantityReceived}`,
      );
    }

    // Validar se a quantidade recebida não excederia a quantidade pedida
    if (newQuantityReceived > orderItem.orderedQuantity) {
      throw new BadRequestException(
        `Não é possível excluir esta atividade. ` +
          `A reversão resultaria em quantidade recebida maior que a pedida para o item "${orderItem.item.name}". ` +
          `Quantidade pedida: ${orderItem.orderedQuantity}, ` +
          `Quantidade recebida após exclusão: ${newQuantityReceived}`,
      );
    }
  }

  /**
   * Excluir uma atividade
   */
  async delete(id: string, userId?: string): Promise<ActivityDeleteResponse> {
    try {
      // Primeiro, buscar a atividade para validação (fora da transação)
      const activity = await this.activityRepository.findById(id);

      if (!activity) {
        throw new NotFoundException('Atividade não encontrada');
      }

      // Validar se a exclusão é possível antes de iniciar a transação
      await this.validateActivityDeletion(activity);
      await this.validateOrderSyncImpact(activity);

      // Se passou na validação, executar a exclusão em transação
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar novamente dentro da transação para garantir consistência
        const activityInTransaction = await this.activityRepository.findByIdWithTransaction(tx, id);

        if (!activityInTransaction) {
          throw new NotFoundException('Atividade não encontrada');
        }

        // Reverter a operação da atividade no estoque
        if (activityInTransaction.operation === ACTIVITY_OPERATION.INBOUND) {
          await this.updateItemQuantity(
            tx,
            activityInTransaction.itemId,
            activityInTransaction.quantity,
            ACTIVITY_OPERATION.OUTBOUND,
            userId,
          );
        } else {
          await this.updateItemQuantity(
            tx,
            activityInTransaction.itemId,
            activityInTransaction.quantity,
            ACTIVITY_OPERATION.INBOUND,
            userId,
          );
        }

        // Se a atividade está ligada a um pedido, reverter a sincronização
        if (activityInTransaction.orderId && activityInTransaction.orderItemId) {
          await this.syncOrderItemReceived(
            tx,
            activityInTransaction.orderId,
            activityInTransaction.orderItemId,
            activityInTransaction.operation === ACTIVITY_OPERATION.INBOUND
              ? ACTIVITY_OPERATION.OUTBOUND
              : ACTIVITY_OPERATION.INBOUND,
            activityInTransaction.quantity,
            id,
            userId || undefined,
          );
        }

        // Only sync with external withdrawals if this activity was related to external withdrawal returns
        if (activityInTransaction.reason === ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN) {
          // Sync with external withdrawals - reverse the operation
          if (activityInTransaction.operation === ACTIVITY_OPERATION.INBOUND) {
            // If it was a return (INBOUND), reverse it by treating as OUTBOUND
            await this.syncExternalWithdrawalItemReturned(
              tx,
              activityInTransaction.itemId,
              ACTIVITY_OPERATION.OUTBOUND,
              activityInTransaction.quantity,
              id,
              userId || undefined,
            );
          }
        }

        // Registrar exclusão usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ACTIVITY,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: activityInTransaction,
          reason: 'Atividade de estoque excluída',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_DELETE,
          transaction: tx,
        });

        await this.activityRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Atividade excluída com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir atividade:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir atividade. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplas atividades
   */
  async batchCreate(
    data: ActivityBatchCreateFormData,
    include?: ActivityInclude,
    userId?: string,
  ): Promise<ActivityBatchCreateResponse<ActivityCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const processedActivities: ActivityCreateFormData[] = [];
        const validationErrors: any[] = [];

        // Process each activity individually to handle validation errors gracefully
        for (let index = 0; index < data.activities.length; index++) {
          const activity = data.activities[index];

          // Get item and user names for detailed feedback
          const item = await tx.item.findUnique({
            where: { id: activity.itemId },
            select: { name: true, uniCode: true },
          });

          let user: { name: string } | null = null;
          if (activity.userId) {
            user = await tx.user.findUnique({
              where: { id: activity.userId },
              select: { name: true },
            });
          }

          const itemName = item?.uniCode
            ? `${item.uniCode} - ${item.name}`
            : item?.name || 'Item desconhecido';
          const userName = user?.name || (activity.userId ? 'Usuário desconhecido' : 'Sem usuário');

          try {
            const determinedReason = await this.determineActivityReason(
              tx,
              activity.operation,
              activity.itemId,
              activity.userId,
              activity.reason,
            );

            // Auto-assign order if not provided
            const { orderId, orderItemId } = await this.findMatchingOrderForActivity(
              tx,
              activity.itemId,
              activity.operation,
              determinedReason,
            );

            const activityWithReason: any = {
              ...activity,
              reason: determinedReason,
              orderId: (activity as any).orderId || orderId,
              orderItemId: (activity as any).orderItemId || orderItemId,
            };

            // Validate the activity
            await this.activityValidation(activityWithReason, tx);

            processedActivities.push(activityWithReason);
          } catch (error: any) {
            validationErrors.push({
              index,
              error: error.message || 'Erro de validação',
              data: {
                ...(activity as any),
                itemName,
                userName,
              },
            });
          }
        }

        // Create activities that passed validation
        const result = await this.activityRepository.createManyWithTransaction(
          tx,
          processedActivities,
          { include },
        );

        // Add validation errors to the failed list
        result.failed.push(...validationErrors);
        result.totalFailed += validationErrors.length;

        // Process successful activities - update item quantities and log changes
        for (const activity of result.success) {
          // Find the original activity data to get the operation and quantity
          const originalData = processedActivities.find(a => a.itemId === activity.itemId);
          if (originalData) {
            // Update item quantity
            await this.updateItemQuantity(
              tx,
              activity.itemId,
              activity.quantity,
              activity.operation as ACTIVITY_OPERATION,
              userId || undefined,
              originalData,
              activity.orderId,
            );

            // If activity is linked to an order, sync with order item
            if (activity.orderId && activity.orderItemId) {
              await this.syncOrderItemReceived(
                tx,
                activity.orderId,
                activity.orderItemId,
                activity.operation as ACTIVITY_OPERATION,
                activity.quantity,
                activity.id,
                userId,
              );
            }
          }

          // Log the change
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ACTIVITY,
            entityId: activity.id,
            action: CHANGE_ACTION.CREATE,
            entity: activity,
            reason: 'Atividade criada em lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 atividade criada com sucesso'
          : `${result.totalCreated} atividades criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format with enhanced details
      const enhancedSuccessDetails = await Promise.all(
        result.success.map(async activity => {
          const item = await this.prisma.item.findUnique({
            where: { id: activity.itemId },
            select: { name: true, uniCode: true },
          });

          let user: { name: string } | null = null;
          if (activity.userId) {
            user = await this.prisma.user.findUnique({
              where: { id: activity.userId },
              select: { name: true },
            });
          }

          return {
            ...activity,
            itemName: item?.uniCode
              ? `${item.uniCode} - ${item.name}`
              : item?.name || 'Item desconhecido',
            userName: user?.name || (activity.userId ? 'Usuário desconhecido' : 'Sem usuário'),
          };
        }),
      );

      const batchOperationResult = {
        success: enhancedSuccessDetails,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data, // This already includes itemName and userName from the validation error
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na criação em lote:', error);

      // Always try to return partial results for validation errors
      // This ensures the frontend gets the batch result format instead of a generic error
      if (
        error.message?.includes('insuficiente') ||
        error.message?.includes('máximo') ||
        error.message?.includes('Invalid') ||
        error.message?.includes('não encontrado') ||
        error.message?.includes('validation')
      ) {
        // Return as successful response but with failed items
        return {
          success: true, // Important: Keep as true so frontend shows the modal
          message: 'Operação processada com erros de validação',
          data: {
            success: [],
            failed: [
              {
                index: 0,
                error: error.message,
                data: {
                  itemName: 'Item desconhecido',
                  userName: 'Sem usuário',
                } as any,
              },
            ],
            totalProcessed: 1,
            totalSuccess: 0,
            totalFailed: 1,
          },
        };
      }

      throw new InternalServerErrorException(
        'Erro ao criar atividades em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar múltiplas atividades
   */
  async batchUpdate(
    data: ActivityBatchUpdateFormData,
    include?: ActivityInclude,
    userId?: string,
  ): Promise<ActivityBatchUpdateResponse<ActivityUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing activities to determine proper reasons for updates
        const activityIds = data.activities.map(a => a.id);
        const existingActivities = await this.activityRepository.findByIdsWithTransaction(
          tx,
          activityIds,
        );

        // Create a map for quick lookup
        const existingActivitiesMap = new Map(existingActivities.map(a => [a.id, a]));

        // Apply reason determination logic to each update
        const updates: UpdateData<ActivityUpdateFormData>[] = [];

        for (const activity of data.activities) {
          const existingActivity = existingActivitiesMap.get(activity.id);
          if (!existingActivity) {
            updates.push({
              id: activity.id,
              data: activity.data,
            });
            continue;
          }

          // Determine new values for reason calculation
          const newOperation = activity.data.operation ?? existingActivity.operation;
          const newUserId =
            activity.data.userId !== undefined ? activity.data.userId : existingActivity.userId;
          const batchItemId = existingActivity.itemId; // Item ID doesn't change in batch updates

          // For updates, always recalculate reason based on new operation and user assignment
          const autoReason = await this.determineActivityReason(
            tx,
            newOperation,
            batchItemId,
            newUserId,
            null,
          );
          const determinedReason =
            activity.data.reason && activity.data.reason !== autoReason
              ? (activity.data.reason as ACTIVITY_REASON)
              : autoReason;

          updates.push({
            id: activity.id,
            data: {
              ...activity.data,
              reason: determinedReason,
            },
          });
        }

        const result = await this.activityRepository.updateManyWithTransaction(tx, updates, {
          include,
        });

        // Registrar atualizações bem-sucedidas
        for (const activity of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ACTIVITY,
            entityId: activity.id,
            action: CHANGE_ACTION.UPDATE,
            entity: activity,
            reason: 'Atividade atualizada em lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 atividade atualizada com sucesso'
          : `${result.totalUpdated} atividades atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar atividades em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir múltiplas atividades
   */
  async batchDelete(
    data: ActivityBatchDeleteFormData,
    _include?: ActivityInclude,
    userId?: string,
  ): Promise<ActivityBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar atividades antes de excluir para o changelog
        const activities = await this.activityRepository.findByIdsWithTransaction(
          tx,
          data.activityIds,
        );

        // Registrar exclusões
        for (const activity of activities) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ACTIVITY,
            entityId: activity.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: activity,
            reason: 'Atividade excluída em lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        return this.activityRepository.deleteManyWithTransaction(tx, data.activityIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 atividade excluída com sucesso'
          : `${result.totalDeleted} atividades excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir atividades em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Validar dados da atividade
   */
  private async activityValidation(
    data: Partial<ActivityCreateFormData | ActivityUpdateFormData>,
    tx: PrismaTransaction,
    existingActivity?: any,
  ): Promise<void> {
    const isUpdate = !!existingActivity;

    // Validar campos obrigatórios para criação
    if (!isUpdate) {
      if (!data.itemId) {
        throw new BadRequestException('ID do item é obrigatório');
      }
      if (!data.quantity) {
        throw new BadRequestException('Quantidade é obrigatória');
      }
      if (!data.operation) {
        throw new BadRequestException('Tipo de operação é obrigatória');
      }
    }

    // Validar quantidade
    if (data.quantity !== undefined) {
      if (!Number.isFinite(data.quantity)) {
        throw new BadRequestException('Quantidade deve ser um número válido');
      }
      if (data.quantity <= 0) {
        throw new BadRequestException('A quantidade deve ser maior que zero');
      }
      if (data.quantity > 999999) {
        throw new BadRequestException('Quantidade excede o limite máximo permitido');
      }
      // Validar precisão (máximo 2 casas decimais)
      if (data.quantity !== Math.round(data.quantity * 100) / 100) {
        throw new BadRequestException('Quantidade deve ter no máximo 2 casas decimais');
      }
    }

    // Validar tipo de operação
    if (data.operation !== undefined) {
      if (![ACTIVITY_OPERATION.INBOUND, ACTIVITY_OPERATION.OUTBOUND].includes(data.operation)) {
        throw new BadRequestException(
          'Operação inválida. Use INBOUND para entrada ou OUTBOUND para saída',
        );
      }
    }

    // Validar motivo
    if (data.reason !== undefined && data.reason !== null) {
      const validReasons = Object.values(ACTIVITY_REASON);
      if (!validReasons.includes(data.reason as ACTIVITY_REASON)) {
        throw new BadRequestException(
          'Motivo inválido. O motivo deve ser um dos valores permitidos',
        );
      }
    }

    // Determinar o itemId a ser usado
    const itemId = data.itemId || existingActivity?.itemId;
    if (!itemId) {
      throw new BadRequestException('Item não identificado para a atividade');
    }

    // Verificar se o item existe e obter informações atualizadas
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        name: true,
        uniCode: true,
        quantity: true,
        reorderPoint: true,
        maxQuantity: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Item não encontrado');
    }

    // Validações específicas por tipo de operação
    const operation = data.operation || existingActivity?.operation;
    const quantity = data.quantity || existingActivity?.quantity || 0;

    if (operation === ACTIVITY_OPERATION.OUTBOUND) {
      // Para atualização, considerar a diferença de quantidade
      let effectiveQuantity = quantity;

      if (isUpdate && existingActivity.operation === ACTIVITY_OPERATION.OUTBOUND) {
        // Se está atualizando uma saída existente, calcular a diferença
        effectiveQuantity = quantity - existingActivity.quantity;
      } else if (isUpdate && existingActivity.operation === ACTIVITY_OPERATION.INBOUND) {
        // Se está mudando de entrada para saída, considerar toda a quantidade mais o que foi adicionado
        effectiveQuantity = quantity + existingActivity.quantity;
      }

      // Verificar se o item tem quantidade suficiente
      if (effectiveQuantity > 0 && item.quantity < effectiveQuantity) {
        throw new BadRequestException(
          `Quantidade insuficiente em estoque. Disponível: ${item.quantity}, Necessário: ${effectiveQuantity}`,
        );
      }

      // Verificar se o item não está bloqueado
      // Note: Item entity doesn't have a status field

      // Verificar quantidade mínima de estoque
      const remainingAfterActivity = item.quantity - effectiveQuantity;
      if (item.reorderPoint && remainingAfterActivity < item.reorderPoint) {
        // Apenas avisar, não bloquear
        console.warn(
          `Atenção: Item ${item.name} ficará abaixo do ponto de reposição (${item.reorderPoint})`,
        );
      }
    }

    if (operation === ACTIVITY_OPERATION.INBOUND) {
      // Verificar limite máximo de estoque
      let effectiveQuantity = quantity;

      if (isUpdate && existingActivity.operation === ACTIVITY_OPERATION.INBOUND) {
        // Se está atualizando uma entrada existente, calcular a diferença
        effectiveQuantity = quantity - existingActivity.quantity;
      } else if (isUpdate && existingActivity.operation === ACTIVITY_OPERATION.OUTBOUND) {
        // Se está mudando de saída para entrada, considerar toda a quantidade mais o que foi removido
        effectiveQuantity = quantity + existingActivity.quantity;
      }

      // Note: maxQuantity is treated as a guideline/metric, not a hard limit
      // Allow entries to exceed maxQuantity for promotions, bulk purchases, etc.
      if (item.maxQuantity && item.quantity + effectiveQuantity > item.maxQuantity) {
        console.warn(
          `INBOUND activity will exceed suggested max quantity for item ${item.name}. Max: ${item.maxQuantity}, Current: ${item.quantity}, Adding: ${effectiveQuantity}`,
        );
      }
    }

    // Verificar se o usuário existe (se fornecido)
    if (data.userId !== undefined && data.userId !== null) {
      const user = await tx.user.findUnique({
        where: { id: data.userId },
        select: { id: true, status: true },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      // Verificar se o usuário está ativo
      if (!ACTIVE_USER_STATUSES.includes(user.status as any)) {
        throw new BadRequestException('Usuário não está ativo');
      }
    }

    // Note: Order validation is now handled automatically by the system
    // The orderId and orderItemId are assigned based on finding matching orders
    // that contain the item and are not fully received yet

    // Validações específicas por razão
    if (data.reason) {
      switch (data.reason) {
        case ACTIVITY_REASON.ORDER_RECEIVED:
          if (operation !== ACTIVITY_OPERATION.INBOUND) {
            throw new BadRequestException('Recebimento de pedido deve ser uma operação de entrada');
          }
          // Note: Order will be automatically assigned by the system
          break;

        case ACTIVITY_REASON.PRODUCTION_USAGE:
          if (operation !== ACTIVITY_OPERATION.OUTBOUND) {
            throw new BadRequestException('Uso em produção deve ser uma operação de saída');
          }
          break;

        case ACTIVITY_REASON.RETURN:
          if (operation !== ACTIVITY_OPERATION.INBOUND) {
            throw new BadRequestException('Retorno deve ser uma operação de entrada');
          }
          break;

        case ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN:
          if (operation !== ACTIVITY_OPERATION.INBOUND) {
            throw new BadRequestException(
              'Devolução de retirada externa deve ser uma operação de entrada',
            );
          }
          break;

        case ACTIVITY_REASON.BORROW:
          if (operation !== ACTIVITY_OPERATION.OUTBOUND) {
            throw new BadRequestException('Empréstimo deve ser uma operação de saída');
          }
          if (!data.userId) {
            throw new BadRequestException('Empréstimo deve ter um usuário associado');
          }
          break;

        case ACTIVITY_REASON.MANUAL_ADJUSTMENT:
          // Ajuste pode ser entrada ou saída
          break;
      }
    }
  }

  /**
   * Calculate weighted average monthly consumption for an item based on recent activities
   * Uses exponential decay: weight = 0.5^((currentMonth - activityMonth) / 3)
   */
  private async calculateAndUpdateItemMonthlyConsumption(
    tx: PrismaTransaction,
    itemId: string,
    userId?: string,
  ): Promise<void> {
    try {
      // Get activities from the last 12 months
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      // Verify item exists
      const item = await tx.item.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        return;
      }

      const oldMonthlyConsumption = parseFloat(item.monthlyConsumption.toString());

      // Get all OUTBOUND activities from the last 12 months
      const activities = await tx.activity.findMany({
        where: {
          itemId,
          operation: ACTIVITY_OPERATION.OUTBOUND,
          createdAt: {
            gte: twelveMonthsAgo,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activities.length === 0) {
        return;
      }

      // Group activities by month
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth();

      const monthlyConsumption = new Map<string, number>();

      activities.forEach(activity => {
        const activityDate = new Date(activity.createdAt);
        const year = activityDate.getFullYear();
        const month = activityDate.getMonth();
        const monthKey = `${year}-${month}`;

        // Calculate quantity consumed for this activity
        const consumedQuantity = activity.quantity;

        // Accumulate by month
        const currentMonthConsumption = monthlyConsumption.get(monthKey) || 0;
        monthlyConsumption.set(monthKey, currentMonthConsumption + consumedQuantity);
      });

      // Calculate weighted average
      let weightedSum = 0;
      let totalWeight = 0;

      monthlyConsumption.forEach((consumption, monthKey) => {
        const [year, month] = monthKey.split('-').map(Number);

        // Calculate months difference
        const monthsDiff = (currentYear - year) * 12 + (currentMonth - month);

        // Calculate weight: 0.5^(monthsDiff / 3)
        const weight = Math.pow(0.5, monthsDiff / 3);

        weightedSum += consumption * weight;
        totalWeight += weight;
      });

      // Calculate weighted average monthly consumption
      const newMonthlyConsumption = totalWeight > 0 ? weightedSum / totalWeight : 0;

      // Only update if the value changed significantly (more than 1%)
      const percentChange = Math.abs(
        (newMonthlyConsumption - oldMonthlyConsumption) / (oldMonthlyConsumption || 1),
      );
      if (percentChange > 0.01) {
        // Update the item
        await tx.item.update({
          where: { id: itemId },
          data: { monthlyConsumption: newMonthlyConsumption },
        });

        // Log the change
        if (userId) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: itemId,
            action: CHANGE_ACTION.UPDATE,
            field: 'monthlyConsumption',
            oldValue: oldMonthlyConsumption,
            newValue: newMonthlyConsumption,
            reason: `Consumo médio mensal atualizado baseado em consumo ponderado dos últimos 12 meses`,
            triggeredBy: CHANGE_TRIGGERED_BY.ITEM_MONTHLY_CONSUMPTION_UPDATE,
            triggeredById: itemId,
            userId: userId || null,
            transaction: tx,
          });
        }

        this.logger.log(
          `Updated monthly consumption for item ${itemId}: ${oldMonthlyConsumption.toFixed(2)} -> ${newMonthlyConsumption.toFixed(2)}`,
        );
      }
    } catch (error) {
      this.logger.error(`Erro ao calcular e atualizar consumo mensal do item ${itemId}:`, error);
      // Don't throw error to not affect the main operation
    }
  }

  /**
   * Atualizar quantidade do item baseado na operação da atividade
   */
  private async updateItemQuantity(
    tx: PrismaTransaction,
    itemId: string,
    quantity: number,
    operation: ACTIVITY_OPERATION,
    userId?: string,
    data?: Partial<ActivityCreateFormData>,
    orderId?: string | null,
  ): Promise<void> {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        name: true,
        uniCode: true,
        quantity: true,
        maxQuantity: true,
        reorderPoint: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Item não encontrado para atualização de quantidade');
    }

    const oldQuantity = item.quantity;
    let newQuantity: number;

    if (operation === ACTIVITY_OPERATION.INBOUND) {
      newQuantity = item.quantity + quantity;
    } else {
      newQuantity = item.quantity - quantity;
    }

    // Validar que a quantidade não fica negativa
    if (newQuantity < 0) {
      throw new BadRequestException(
        `Operação resultaria em quantidade negativa. Disponível: ${item.quantity}, Tentando remover: ${quantity}`,
      );
    }

    // Atualizar o item
    await tx.item.update({
      where: { id: itemId },
      data: {
        quantity: newQuantity,
      },
    });

    // Automatic min/max update for OUTBOUND operations
    if (operation === ACTIVITY_OPERATION.OUTBOUND) {
      await this.updateItemMinMaxQuantities(tx, itemId, userId);
      // Update item monthly consumption based on weighted average of recent activities
      await this.calculateAndUpdateItemMonthlyConsumption(tx, itemId, userId);
    }

    // Automatic lead time update for INBOUND operations with ORDER_RECEIVED reason
    if (
      operation === ACTIVITY_OPERATION.INBOUND &&
      data?.reason === ACTIVITY_REASON.ORDER_RECEIVED &&
      orderId
    ) {
      await this.updateItemLeadTime(tx, itemId, orderId, userId);
    }

    // Registrar a mudança de quantidade no changelog
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.ITEM,
      entityId: itemId,
      action: CHANGE_ACTION.UPDATE,
      field: 'quantity',
      oldValue: oldQuantity,
      newValue: newQuantity,
      reason: `Quantidade atualizada por atividade: ${operation === ACTIVITY_OPERATION.INBOUND ? 'entrada' : 'saída'} de ${quantity} unidades`,
      triggeredBy: CHANGE_TRIGGERED_BY.INVENTORY_ADJUSTMENT,
      triggeredById: itemId,
      userId: userId || null,
      transaction: tx,
    });
  }

  /**
   * Sincronizar quantidade recebida do item do pedido baseado na atividade
   */
  private async syncOrderItemReceived(
    tx: PrismaTransaction,
    orderId: string,
    orderItemId: string,
    operation: ACTIVITY_OPERATION,
    quantity: number,
    activityId: string,
    userId?: string,
  ): Promise<void> {
    // Buscar o item do pedido
    const orderItem = await tx.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        order: true,
      },
    });

    if (!orderItem) {
      throw new NotFoundException('Item do pedido não encontrado');
    }

    if (orderItem.orderId !== orderId) {
      throw new BadRequestException('Item do pedido não pertence ao pedido informado');
    }

    const oldReceivedQuantity = orderItem.receivedQuantity;
    let actualQuantityToProcess: number;
    let newReceivedQuantity: number;

    if (operation === ACTIVITY_OPERATION.INBOUND) {
      // For inbound activities, only mark as received up to the remaining quantity needed
      const remainingToReceive = orderItem.orderedQuantity - oldReceivedQuantity;

      // Only process up to what's needed for the order
      actualQuantityToProcess = Math.min(quantity, remainingToReceive);

      // If there's nothing left to receive for this order, don't process
      if (actualQuantityToProcess <= 0) {
        return;
      }

      newReceivedQuantity = oldReceivedQuantity + actualQuantityToProcess;
    } else {
      // For outbound activities, use the full quantity
      actualQuantityToProcess = quantity;
      newReceivedQuantity = oldReceivedQuantity - actualQuantityToProcess;

      // Validar que a quantidade recebida não fica negativa
      if (newReceivedQuantity < 0) {
        throw new BadRequestException(
          `Operação resultaria em quantidade recebida negativa. Recebido: ${oldReceivedQuantity}, Tentando remover: ${actualQuantityToProcess}`,
        );
      }
    }

    // Atualizar o item do pedido
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        receivedQuantity: newReceivedQuantity,
        receivedAt:
          operation === ACTIVITY_OPERATION.INBOUND && newReceivedQuantity > 0 ? new Date() : null,
      },
    });

    // Only log if there was an actual change
    if (oldReceivedQuantity !== newReceivedQuantity) {
      // Registrar a mudança no changelog
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ORDER_ITEM,
        entityId: orderItemId,
        action: CHANGE_ACTION.UPDATE,
        field: 'receivedQuantity',
        oldValue: oldReceivedQuantity,
        newValue: newReceivedQuantity,
        reason: `Quantidade recebida atualizada por atividade ${activityId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.ORDER_ITEM_SYNC,
        triggeredById: activityId,
        userId: userId || null,
        transaction: tx,
      });
    }

    // Verificar se precisa atualizar o status do pedido
    await this.checkAndUpdateOrderStatus(tx, orderId, userId);
  }

  /**
   * Verificar e atualizar o status do pedido baseado nas quantidades recebidas
   */
  private async checkAndUpdateOrderStatus(
    tx: PrismaTransaction,
    orderId: string,
    userId?: string,
  ): Promise<void> {
    // Buscar todos os itens do pedido
    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
    });

    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    // Calcular o status baseado nas quantidades recebidas
    const allReceived = orderItems.every(item => item.receivedQuantity >= item.orderedQuantity);
    const someReceived = orderItems.some(item => item.receivedQuantity > 0);
    const noneReceived = orderItems.every(item => item.receivedQuantity === 0);

    let newStatus = order.status;

    if (allReceived) {
      newStatus = ORDER_STATUS.RECEIVED;
    } else if (someReceived) {
      newStatus = ORDER_STATUS.PARTIALLY_RECEIVED;
    } else if (noneReceived && order.status === ORDER_STATUS.RECEIVED) {
      // Se estava recebido e agora não tem nada recebido, voltar para o status anterior
      newStatus = ORDER_STATUS.FULFILLED;
    }

    // Atualizar o status se mudou
    if (newStatus !== order.status) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          // Order completion is now tracked at the item level via fulfilledAt
        },
      });

      // Registrar a mudança de status
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ORDER,
        entityId: orderId,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: order.status,
        newValue: newStatus,
        reason: 'Status atualizado automaticamente pela sincronização de atividades',
        triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_SYNC,
        triggeredById: orderId,
        userId: userId || null,
        transaction: tx,
      });
    }
  }

  /**
   * Sync external withdrawal item returned quantity when activities are created/updated/deleted
   */
  private async syncExternalWithdrawalItemReturned(
    tx: PrismaTransaction,
    itemId: string,
    operation: ACTIVITY_OPERATION,
    quantity: number,
    activityId: string,
    userId?: string,
  ): Promise<void> {
    // Handle both INBOUND (returns) and OUTBOUND (reverse returns) operations
    if (operation === ACTIVITY_OPERATION.OUTBOUND) {
      // This is a reversal of a return - we need to decrease returnedQuantity
      const externalWithdrawalItems = await tx.externalWithdrawalItem.findMany({
        where: {
          itemId,
          returnedQuantity: { gt: 0 },
          externalWithdrawal: {
            status: {
              in: [
                EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED,
                EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED,
              ],
            },
          },
        },
        include: {
          externalWithdrawal: true,
        },
        orderBy: {
          createdAt: 'desc', // Process newest returns first when reversing
        },
      });

      if (externalWithdrawalItems.length === 0) {
        return;
      }

      // Distribute the reversed quantity across withdrawal items
      let remainingQuantity = quantity;

      for (const withdrawalItem of externalWithdrawalItems) {
        if (remainingQuantity <= 0) break;

        const quantityToReverse = Math.min(remainingQuantity, withdrawalItem.returnedQuantity);
        const newReturnedQuantity = withdrawalItem.returnedQuantity - quantityToReverse;

        // Update the withdrawal item
        await tx.externalWithdrawalItem.update({
          where: { id: withdrawalItem.id },
          data: {
            returnedQuantity: newReturnedQuantity,
          },
        });

        // Log the change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
          entityId: withdrawalItem.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'returnedQuantity',
          oldValue: withdrawalItem.returnedQuantity,
          newValue: newReturnedQuantity,
          reason: `Quantidade devolvida revertida por exclusão/atualização de atividade ${activityId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_SYNC,
          triggeredById: activityId,
          userId: userId || null,
          transaction: tx,
        });

        remainingQuantity -= quantityToReverse;

        // Check if this withdrawal status needs update
        await this.checkAndUpdateExternalWithdrawalStatus(
          tx,
          withdrawalItem.externalWithdrawalId,
          userId,
        );
      }

      return;
    }

    // Original INBOUND logic (returns)
    if (operation !== ACTIVITY_OPERATION.INBOUND) {
      return;
    }

    // Find active external withdrawals with this item
    const externalWithdrawalItems = await tx.externalWithdrawalItem.findMany({
      where: {
        itemId,
        externalWithdrawal: {
          status: {
            in: [
              EXTERNAL_WITHDRAWAL_STATUS.PENDING as any,
              EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED as any,
            ],
          },
        },
      },
      include: {
        externalWithdrawal: true,
      },
      orderBy: {
        createdAt: 'asc', // Process oldest withdrawals first
      },
    });

    if (externalWithdrawalItems.length === 0) {
      return;
    }

    // Distribute the returned quantity across withdrawal items
    let remainingQuantity = quantity;

    for (const withdrawalItem of externalWithdrawalItems) {
      if (remainingQuantity <= 0) break;

      const pendingReturn = withdrawalItem.withdrawedQuantity - withdrawalItem.returnedQuantity;
      if (pendingReturn <= 0) continue;

      const quantityToReturn = Math.min(remainingQuantity, pendingReturn);
      const newReturnedQuantity = withdrawalItem.returnedQuantity + quantityToReturn;

      // Update the withdrawal item
      await tx.externalWithdrawalItem.update({
        where: { id: withdrawalItem.id },
        data: {
          returnedQuantity: newReturnedQuantity,
        },
      });

      // Log the change
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
        entityId: withdrawalItem.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'returnedQuantity',
        oldValue: withdrawalItem.returnedQuantity,
        newValue: newReturnedQuantity,
        reason: `Quantidade devolvida atualizada por atividade ${activityId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_SYNC,
        triggeredById: activityId,
        userId: userId || null,
        transaction: tx,
      });

      remainingQuantity -= quantityToReturn;

      // Check if this withdrawal is now fully returned
      await this.checkAndUpdateExternalWithdrawalStatus(
        tx,
        withdrawalItem.externalWithdrawalId,
        userId,
      );
    }
  }

  /**
   * Check and update external withdrawal status based on returned quantities
   */
  private async checkAndUpdateExternalWithdrawalStatus(
    tx: PrismaTransaction,
    externalWithdrawalId: string,
    userId?: string,
  ): Promise<void> {
    // Get all items for this withdrawal
    const withdrawalItems = await tx.externalWithdrawalItem.findMany({
      where: { externalWithdrawalId },
    });

    const withdrawal = await tx.externalWithdrawal.findUnique({
      where: { id: externalWithdrawalId },
    });

    if (!withdrawal) {
      throw new NotFoundException('Retirada externa não encontrada');
    }

    // Calculate the status based on returned quantities
    const allReturned = withdrawalItems.every(
      item => item.returnedQuantity >= item.withdrawedQuantity,
    );
    const someReturned = withdrawalItems.some(item => item.returnedQuantity > 0);
    const noneReturned = withdrawalItems.every(item => item.returnedQuantity === 0);

    let newStatus = withdrawal.status;

    if (allReturned) {
      newStatus = EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED;
    } else if (someReturned) {
      newStatus = EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED;
    } else if (
      noneReturned &&
      withdrawal.status === EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED
    ) {
      // If was partially returned and now nothing is returned, go back to active
      newStatus = EXTERNAL_WITHDRAWAL_STATUS.PENDING as any;
    }

    // Update status if changed
    if (newStatus !== withdrawal.status) {
      const oldStatus = withdrawal.status;

      await tx.externalWithdrawal.update({
        where: { id: externalWithdrawalId },
        data: {
          status: newStatus as any,
          statusOrder: EXTERNAL_WITHDRAWAL_STATUS_ORDER[newStatus as string],
        },
      });

      // Log the status change
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
        entityId: externalWithdrawalId,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: oldStatus,
        newValue: newStatus,
        reason: 'Status atualizado automaticamente baseado nas quantidades devolvidas',
        triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_SYNC,
        triggeredById: externalWithdrawalId,
        userId: userId || null,
        transaction: tx,
      });
    }
  }

  /**
   * Automatically update item min/max quantities based on consumption patterns
   */
  private async updateItemMinMaxQuantities(
    tx: PrismaTransaction,
    itemId: string,
    userId?: string,
  ): Promise<void> {
    try {
      // Get the last 90 days of activities for this item
      const lookbackDays = 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

      const activities = (await tx.activity.findMany({
        where: {
          itemId,
          createdAt: {
            gte: cutoffDate,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })) as any as import('@types').Activity[];

      // Calculate monthly consumption
      const monthlyConsumption = calculateMonthlyConsumption(activities, lookbackDays);

      // Skip update if there's no meaningful consumption data
      if (monthlyConsumption === 0 || activities.length < 5) {
        return;
      }

      // Get the item's current data
      const item = await tx.item.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        return;
      }

      // Calculate consumption trend
      const consumptionTrend = calculateConsumptionTrend(activities, lookbackDays);

      // Calculate suggested quantities
      const leadTime = item.estimatedLeadTime || 30;
      const safetyStockDays = 7;
      const suggested = calculateSuggestedQuantities(
        monthlyConsumption,
        leadTime,
        safetyStockDays,
        consumptionTrend,
      );

      // Only update maxQuantity if it differs significantly from current value
      const maxDifference = Math.abs(
        (suggested.max - (item.maxQuantity || 0)) / (item.maxQuantity || 1),
      );

      // Update if difference is more than 10%
      if (maxDifference > 0.1) {
        const oldMaxQuantity = item.maxQuantity;

        await tx.item.update({
          where: { id: itemId },
          data: {
            maxQuantity: suggested.max,
          },
        });

        // Log max quantity change
        if (oldMaxQuantity !== suggested.max) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: itemId,
            action: CHANGE_ACTION.UPDATE,
            field: 'maxQuantity',
            oldValue: oldMaxQuantity,
            newValue: suggested.max,
            reason: `Quantidade máxima atualizada automaticamente baseada no consumo mensal de ${monthlyConsumption.toFixed(2)} unidades`,
            triggeredBy: CHANGE_TRIGGERED_BY.AUTOMATIC_MIN_MAX_UPDATE,
            triggeredById: itemId,
            userId: userId || null,
            transaction: tx,
          });
        }

        this.logger.log(
          `Updated max quantity for item ${itemId}: max=${suggested.max}, monthly consumption=${monthlyConsumption.toFixed(2)}`,
        );
      }
    } catch (error) {
      // Log error but don't fail the main operation
      this.logger.error(`Error updating min/max quantities for item ${itemId}:`, error);
    }
  }

  /**
   * Automatically update item lead time based on order fulfillment history
   */
  private async updateItemLeadTime(
    tx: PrismaTransaction,
    itemId: string,
    orderId: string,
    userId?: string,
  ): Promise<void> {
    try {
      // Get the order creation date
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { createdAt: true },
      });

      if (!order) {
        return;
      }

      // Get the current date (when the item was received)
      const receivedAt = new Date();

      // Calculate lead time in days
      const leadTimeDays = Math.ceil(
        (receivedAt.getTime() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Get historical lead times from recent orders (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const recentActivities = await tx.activity.findMany({
        where: {
          itemId,
          operation: ACTIVITY_OPERATION.INBOUND,
          reason: ACTIVITY_REASON.ORDER_RECEIVED,
          orderId: { not: null },
          createdAt: { gte: sixMonthsAgo },
        },
        include: {
          order: true,
        },
      });

      // Calculate average lead time
      const leadTimes: number[] = [leadTimeDays];

      for (const activity of recentActivities) {
        if (activity.order && activity.createdAt) {
          const activityLeadTime = Math.ceil(
            (activity.createdAt.getTime() - activity.order.createdAt.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          if (activityLeadTime > 0 && activityLeadTime < 365) {
            // Sanity check
            leadTimes.push(activityLeadTime);
          }
        }
      }

      // Calculate weighted average (more recent orders have more weight)
      let weightedSum = 0;
      let totalWeight = 0;

      leadTimes.forEach((leadTime, index) => {
        const weight = leadTimes.length - index; // Most recent has highest weight
        weightedSum += leadTime * weight;
        totalWeight += weight;
      });

      const averageLeadTime = Math.round(weightedSum / totalWeight);

      // Get current item data
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { estimatedLeadTime: true },
      });

      if (!item) {
        return;
      }

      // Only update if the new lead time differs significantly (more than 10% or 3 days)
      const currentLeadTime = item.estimatedLeadTime || 30;
      const difference = Math.abs(averageLeadTime - currentLeadTime);
      const percentDifference = difference / currentLeadTime;

      if (percentDifference > 0.1 || difference > 3) {
        await tx.item.update({
          where: { id: itemId },
          data: {
            estimatedLeadTime: averageLeadTime,
          },
        });

        // Log the change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: itemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'estimatedLeadTime',
          oldValue: currentLeadTime,
          newValue: averageLeadTime,
          reason: `Lead time atualizado automaticamente baseado em ${leadTimes.length} pedidos recentes`,
          triggeredBy: CHANGE_TRIGGERED_BY.AUTOMATIC_MIN_MAX_UPDATE,
          triggeredById: itemId,
          userId: userId || null,
          transaction: tx,
        });

        this.logger.log(
          `Updated lead time for item ${itemId}: ${currentLeadTime} -> ${averageLeadTime} days (based on ${leadTimes.length} orders)`,
        );
      }
    } catch (error) {
      // Log error but don't fail the main operation
      this.logger.error(`Error updating lead time for item ${itemId}:`, error);
    }
  }
}
