// activity.service.ts

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { EventEmitter } from 'events';
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
  EXTERNAL_OPERATION_STATUS,
  ACTIVE_USER_STATUSES,
  SECTOR_PRIVILEGES,
} from '../../../constants/enums';
import {
  REGULAR_CONSUMPTION_REASONS,
} from '../../../constants/inventory-config';
import { getStatusOrder } from '../../../utils/order';
import { EXTERNAL_OPERATION_STATUS_ORDER } from '../../../constants/sortOrders';
import { OrderItemEnteredInventoryEvent } from '../order/order.events';
import { ItemRecomputeService } from '../services/item-recompute.service';
import { StockNotificationService } from '../services/stock-notification.service';
import { ItemCategoryRepository } from '../item/repositories/item-category/item-category.repository';
import type { StockCalculationResult } from '../services/atomic-stock-calculator.service';
import { determineStockLevel } from '../../../utils';

/** Per-item-write snapshot captured inside the transaction for post-commit
 *  stock-threshold notification evaluation. */
interface StockNotificationSnapshot {
  itemId: string;
  itemName: string;
  oldQuantity: number;
  newQuantity: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  stockModel: string | null;
  fixedTargetQuantity: number | null;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly prisma: PrismaService,
    private readonly activityRepository: ActivityRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly itemRecomputeService: ItemRecomputeService,
    private readonly stockNotificationService: StockNotificationService,
    private readonly itemCategoryRepository: ItemCategoryRepository,
  ) {}

  /**
   * Expand any `item.categoryId { in: [...] }` filter (produced by the activity
   * where-schema transform from selected categoryIds) to include each selected
   * category's descendant ids. Items attach to leaf categories, so without this a
   * level-1 parent categoryId would match no activities. The transform runs
   * synchronously at the DTO layer and cannot call a repository, so the expansion
   * is applied here at the service layer just before querying.
   */
  private async expandCategoryFilter(query: ActivityGetManyFormData): Promise<void> {
    const andConditions = (query as any)?.where?.AND;
    if (!Array.isArray(andConditions)) {
      return;
    }
    for (const condition of andConditions) {
      const inClause = condition?.item?.categoryId?.in;
      if (Array.isArray(inClause) && inClause.length > 0) {
        const expanded = new Set<string>(inClause);
        for (const id of inClause) {
          try {
            const descendants = await this.itemCategoryRepository.listDescendantIds(id);
            for (const descendantId of descendants) {
              expanded.add(descendantId);
            }
          } catch (error) {
            this.logger.warn(`Falha ao expandir descendentes da categoria ${id}: ${error}`);
          }
        }
        condition.item.categoryId.in = Array.from(expanded);
      }
    }
  }

  /**
   * Snapshot captured inside the transaction by updateItemQuantity so that
   * stock-threshold notifications can be evaluated AFTER the transaction
   * commits (never on a rollback). One entry per quantity-changing item write.
   */
  private buildStockNotificationCalculation(
    snap: StockNotificationSnapshot,
  ): StockCalculationResult {
    const stockLevel = determineStockLevel({
      quantity: snap.newQuantity,
      reorderPoint: snap.reorderPoint,
      maxQuantity: snap.maxQuantity,
      hasActiveOrder: false,
      stockModel: snap.stockModel,
      fixedTargetQuantity: snap.fixedTargetQuantity,
    });

    // Shape mirrors AtomicStockCalculatorService output so we can reuse
    // StockNotificationService.processStockNotifications unchanged. Only the
    // fields consumed by its determineEventType/hydrateAndFilter are meaningful.
    return {
      itemId: snap.itemId,
      itemName: snap.itemName,
      currentQuantity: snap.oldQuantity,
      finalQuantity: snap.newQuantity,
      quantityChange: snap.newQuantity - snap.oldQuantity,
      isValid: true,
      errors: [],
      warnings: [],
      stockLevel,
      hasActiveOrders: false,
      reorderPoint: snap.reorderPoint,
      maxQuantity: snap.maxQuantity,
      operations: [],
    };
  }

  /**
   * Evaluate stock thresholds for items touched by an activity write and
   * dispatch low/out/reorder/overstock notifications. MUST be called AFTER the
   * surrounding transaction commits (uses this.prisma, not the tx) so we never
   * notify on a rolled-back change. Wrapped so a failure never breaks the flow.
   */
  private async dispatchStockNotificationsAfterCommit(
    snapshots: StockNotificationSnapshot[],
  ): Promise<void> {
    if (!snapshots.length) return;

    // Collapse multiple writes to the same item to its final state (latest snap
    // wins) so a reverse+apply pair in update() yields a single evaluation.
    const latestByItem = new Map<string, StockNotificationSnapshot>();
    for (const snap of snapshots) {
      latestByItem.set(snap.itemId, snap);
    }

    try {
      const calculations = Array.from(latestByItem.values()).map(snap =>
        this.buildStockNotificationCalculation(snap),
      );
      await this.stockNotificationService.processStockNotifications(
        calculations,
        this.prisma as any,
      );
    } catch (error) {
      this.logger.error('Erro ao despachar notificações de estoque:', error);
    }
  }

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
      await this.expandCategoryFilter(query);
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
  private async hasExternalOperationItemsToReturn(
    tx: PrismaTransaction,
    itemId: string,
  ): Promise<boolean> {
    const externalOperationItems = await tx.externalOperationItem.findMany({
      where: {
        itemId,
        externalOperation: {
          status: {
            in: [
              EXTERNAL_OPERATION_STATUS.PENDING as any,
              EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED as any,
            ],
          },
        },
      },
    });

    return externalOperationItems.some(item => item.returnedQuantity < item.withdrawedQuantity);
  }

  /**
   * Determine activity reason based on operation, user, and context
   * Business Rules:
   * - If operation is OUTBOUND → reason should be PRODUCTION_USAGE
   * - If operation is INBOUND:
   *   - If there are external withdrawal items to return → EXTERNAL_OPERATION_RETURN
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
      const hasExternalOperations = await this.hasExternalOperationItemsToReturn(tx, itemId);

      if (hasExternalOperations) {
        return ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN;
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
   * Side-door gate: activities with reason EXTERNAL_OPERATION_RETURN mutate
   * ExternalOperationItem.returnedQuantity and the operation status (via
   * syncExternalOperationItemReturned). ExternalOperation is ADMIN-only, so only
   * ADMIN actors may use this reason from the HTTP-originated paths.
   * Internal/system calls don't thread a privilege (userPrivilege === undefined)
   * and are not gated.
   */
  private assertExternalOperationReturnReasonAllowed(
    reason: string | null | undefined,
    userPrivilege?: string,
  ): void {
    if (
      userPrivilege !== undefined &&
      userPrivilege !== SECTOR_PRIVILEGES.ADMIN &&
      reason === ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN
    ) {
      throw new ForbiddenException(
        'Apenas administradores podem registrar movimentações com o motivo "Devolução de Operação Externa"',
      );
    }
  }

  /**
   * Criar uma nova atividade
   */
  async create(
    data: ActivityCreateFormData,
    include?: ActivityInclude,
    userId?: string,
    options?: { skipSync?: boolean },
    userPrivilege?: string,
  ): Promise<ActivityCreateResponse> {
    try {
      this.assertExternalOperationReturnReasonAllowed(data.reason, userPrivilege);
      const stockSnapshots: StockNotificationSnapshot[] = [];
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
          stockSnapshots,
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
        if (data.reason === ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN && !options?.skipSync) {
          await this.syncExternalOperationItemReturned(
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

        return { activity: newActivity, orderId, orderItemId, determinedReason };
      });

      // Evaluate stock thresholds AFTER commit (never on rollback).
      await this.dispatchStockNotificationsAfterCommit(stockSnapshots);

      // Emit event outside the transaction for order item entering inventory
      if (
        activity.determinedReason === ACTIVITY_REASON.ORDER_RECEIVED &&
        data.operation === ACTIVITY_OPERATION.INBOUND &&
        activity.orderId &&
        activity.orderItemId
      ) {
        try {
          this.eventEmitter.emit(
            'order.item.entered_inventory',
            new OrderItemEnteredInventoryEvent(
              activity.orderId,
              activity.orderItemId,
              data.itemId,
              data.quantity,
              activity.activity.id,
              userId,
            ),
          );
        } catch (error) {
          this.logger.error('Error emitting order item entered inventory event:', error);
        }
      }

      return {
        success: true,
        message: 'Atividade criada com sucesso',
        data: activity.activity,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar atividade:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
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
    userPrivilege?: string,
  ): Promise<ActivityUpdateResponse> {
    try {
      this.assertExternalOperationReturnReasonAllowed(data.reason, userPrivilege);
      const stockSnapshots: StockNotificationSnapshot[] = [];
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
            undefined,
            undefined,
            stockSnapshots,
          );
        } else {
          await this.updateItemQuantity(
            tx,
            existingActivity.itemId,
            oldQuantity,
            ACTIVITY_OPERATION.INBOUND,
            userId,
            undefined,
            undefined,
            stockSnapshots,
          );
        }

        // Aplicar a nova operação
        await this.updateItemQuantity(
          tx,
          itemId,
          newQuantity,
          newOperation,
          userId,
          {
            ...existingActivity,
            ...data,
          },
          undefined,
          stockSnapshots,
        );

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
        const isExternalOperationRelated =
          existingActivity.reason === ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN ||
          data.reason === ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN;

        if (isExternalOperationRelated) {
          // Sync with external withdrawals - handle the old state first
          if (
            oldOperation === ACTIVITY_OPERATION.INBOUND &&
            existingActivity.reason === ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN
          ) {
            // Reverse the old return
            await this.syncExternalOperationItemReturned(
              tx,
              existingActivity.itemId,
              ACTIVITY_OPERATION.OUTBOUND,
              oldQuantity,
              id,
              userId,
            );
          }

          // Apply new sync for external withdrawals if the new reason is external withdrawal return
          if (data.reason === ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN) {
            await this.syncExternalOperationItemReturned(
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

      // Evaluate stock thresholds AFTER commit (never on rollback).
      await this.dispatchStockNotificationsAfterCommit(stockSnapshots);

      return {
        success: true,
        message: 'Atividade atualizada com sucesso',
        data: updatedActivity,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar atividade:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
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
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`Pedido ${activity.orderId} não encontrado para atividade ${activity.id}`);
      }
      return;
    }

    const orderItem = order.items[0];
    if (!orderItem) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `Item do pedido ${activity.orderItemId} não encontrado para atividade ${activity.id}`,
        );
      }
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

    // Bloquear exclusão de atividades de recebimento de pedido (ORDER_RECEIVED) vinculadas
    // a pedidos. Essas atividades representam uma entrada formal de mercadoria; removê-las
    // zeraria a quantidade recebida e reverteria automaticamente o status do pedido de
    // RECEIVED para FULFILLED, causando inconsistência de estoque.
    if (
      activity.reason === ACTIVITY_REASON.ORDER_RECEIVED &&
      activity.operation === ACTIVITY_OPERATION.INBOUND
    ) {
      throw new BadRequestException(
        `Não é possível excluir esta atividade pois ela representa o recebimento formal do pedido. ` +
          `Para corrigir a quantidade recebida, utilize a funcionalidade de gerenciamento do pedido. ` +
          `Item: "${orderItem.item.name}", quantidade recebida: ${orderItem.receivedQuantity}.`,
      );
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
      const stockSnapshots: StockNotificationSnapshot[] = [];
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
            undefined,
            undefined,
            stockSnapshots,
          );
        } else {
          await this.updateItemQuantity(
            tx,
            activityInTransaction.itemId,
            activityInTransaction.quantity,
            ACTIVITY_OPERATION.INBOUND,
            userId,
            undefined,
            undefined,
            stockSnapshots,
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
        if (activityInTransaction.reason === ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN) {
          // Sync with external withdrawals - reverse the operation
          if (activityInTransaction.operation === ACTIVITY_OPERATION.INBOUND) {
            // If it was a return (INBOUND), reverse it by treating as OUTBOUND
            await this.syncExternalOperationItemReturned(
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

      // Evaluate stock thresholds AFTER commit (never on rollback).
      await this.dispatchStockNotificationsAfterCommit(stockSnapshots);

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
    userPrivilege?: string,
  ): Promise<ActivityBatchCreateResponse<ActivityCreateFormData>> {
    for (const activity of data.activities) {
      this.assertExternalOperationReturnReasonAllowed(activity.reason, userPrivilege);
    }
    try {
      const stockSnapshots: StockNotificationSnapshot[] = [];
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

        // Correlate each created activity back to its source input by index.
        // createManyWithTransaction iterates inputs in order and pushes successes
        // in that same order (skipping failed indices), so we walk the inputs
        // skipping the failed ones to pair them 1:1 with result.success. Using
        // `.find(itemId)` here would mis-correlate when a batch has 2+ activities
        // for the same item.
        const repoFailedIndices = new Set(result.failed.map(f => f.index));
        const successOriginalData: ActivityCreateFormData[] = [];
        for (let inputIndex = 0; inputIndex < processedActivities.length; inputIndex++) {
          if (!repoFailedIndices.has(inputIndex)) {
            successOriginalData.push(processedActivities[inputIndex]);
          }
        }

        // Add validation errors to the failed list
        result.failed.push(...validationErrors);
        result.totalFailed += validationErrors.length;

        // Process successful activities - update item quantities and log changes
        for (let successIndex = 0; successIndex < result.success.length; successIndex++) {
          const activity = result.success[successIndex];
          // Original input data correlated by index (not by itemId match).
          const originalData = successOriginalData[successIndex];
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
              stockSnapshots,
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

      // Evaluate stock thresholds AFTER commit (never on rollback).
      await this.dispatchStockNotificationsAfterCommit(stockSnapshots);

      // Emit events for order items that entered inventory (outside transaction)
      for (const activity of result.success) {
        if (
          activity.reason === ACTIVITY_REASON.ORDER_RECEIVED &&
          activity.operation === ACTIVITY_OPERATION.INBOUND &&
          activity.orderId &&
          activity.orderItemId
        ) {
          try {
            this.eventEmitter.emit(
              'order.item.entered_inventory',
              new OrderItemEnteredInventoryEvent(
                activity.orderId,
                activity.orderItemId,
                activity.itemId,
                activity.quantity,
                activity.id,
                userId,
              ),
            );
          } catch (error) {
            this.logger.error('Error emitting order item entered inventory event:', error);
          }
        }
      }

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
    userPrivilege?: string,
  ): Promise<ActivityBatchUpdateResponse<ActivityUpdateFormData>> {
    for (const activity of data.activities) {
      this.assertExternalOperationReturnReasonAllowed(activity.data.reason, userPrivilege);
    }
    try {
      const stockSnapshots: StockNotificationSnapshot[] = [];
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
          const batchItemId = activity.data.itemId ?? existingActivity.itemId;

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

          // Adjust item stock: reverse the previous effect, then apply the new one.
          // Without this, batch-editing an activity's quantity/operation/item leaves
          // Item.quantity stale (the single-record update() does this; batch must too).
          const oldQuantity = existingActivity.quantity;
          const oldOperation = existingActivity.operation;
          const newQuantity = activity.data.quantity ?? existingActivity.quantity;

          await this.updateItemQuantity(
            tx,
            existingActivity.itemId,
            oldQuantity,
            oldOperation === ACTIVITY_OPERATION.INBOUND
              ? ACTIVITY_OPERATION.OUTBOUND
              : ACTIVITY_OPERATION.INBOUND,
            userId,
            undefined,
            undefined,
            stockSnapshots,
          );

          await this.updateItemQuantity(
            tx,
            batchItemId,
            newQuantity,
            newOperation,
            userId,
            { ...existingActivity, ...activity.data, reason: determinedReason },
            undefined,
            stockSnapshots,
          );

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

      // Evaluate stock thresholds AFTER commit (never on rollback).
      await this.dispatchStockNotificationsAfterCommit(stockSnapshots);

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
      const stockSnapshots: StockNotificationSnapshot[] = [];
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar atividades antes de excluir para o changelog
        const activities = await this.activityRepository.findByIdsWithTransaction(
          tx,
          data.activityIds,
        );

        // Reverter o efeito de cada atividade no estoque antes de excluir.
        // Sem isso, excluir atividades em lote deixa Item.quantity defasado
        // (o delete() de registro único faz essa reversão; o batch também deve).
        for (const activity of activities) {
          await this.updateItemQuantity(
            tx,
            activity.itemId,
            activity.quantity,
            activity.operation === ACTIVITY_OPERATION.INBOUND
              ? ACTIVITY_OPERATION.OUTBOUND
              : ACTIVITY_OPERATION.INBOUND,
            userId,
            undefined,
            undefined,
            stockSnapshots,
          );
        }

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

      // Evaluate stock thresholds AFTER commit (never on rollback).
      await this.dispatchStockNotificationsAfterCommit(stockSnapshots);

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
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `Atenção: Item ${item.name} ficará abaixo do ponto de reposição (${item.reorderPoint})`,
          );
        }
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
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `INBOUND activity will exceed suggested max quantity for item ${item.name}. Max: ${item.maxQuantity}, Current: ${item.quantity}, Adding: ${effectiveQuantity}`,
          );
        }
      }
    }

    // Verificar se o usuário existe (se fornecido)
    if (data.userId !== undefined && data.userId !== null) {
      const user = await tx.user.findUnique({
        where: { id: data.userId },
        select: { id: true, isActive: true },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      // Verificar se o usuário está ativo
      if (!user.isActive) {
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

        case ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN:
          if (operation !== ACTIVITY_OPERATION.INBOUND) {
            throw new BadRequestException(
              'Devolução de operação externa deve ser uma operação de entrada',
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
    stockEvalSink?: StockNotificationSnapshot[],
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
        stockModel: true,
        fixedTargetQuantity: true,
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

    // Atualizar o item de forma atômica (increment) para evitar lost-update sob
    // concorrência. delta é assinado: positivo para INBOUND, negativo para OUTBOUND.
    const delta = operation === ACTIVITY_OPERATION.INBOUND ? quantity : -quantity;
    const updateData: any = { quantity: { increment: delta } };

    // Update lastUsedAt for consumption outbound activities
    if (
      operation === ACTIVITY_OPERATION.OUTBOUND &&
      data?.reason &&
      REGULAR_CONSUMPTION_REASONS.includes(data.reason as any)
    ) {
      updateData.lastUsedAt = new Date();
    }

    const updatedItem = await tx.item.update({
      where: { id: itemId },
      data: updateData,
      select: { quantity: true },
    });

    // Re-check the atomically computed quantity to roll back the transaction if a
    // concurrent write drove stock negative (pre-read guard above can be stale).
    if (updatedItem.quantity < 0) {
      throw new BadRequestException(
        `Operação resultaria em quantidade negativa. Disponível: ${item.quantity}, Tentando remover: ${quantity}`,
      );
    }

    // Capture a snapshot for post-commit stock-threshold notification eval.
    // The actual dispatch happens AFTER the transaction commits (never on
    // rollback) — see dispatchStockNotificationsAfterCommit.
    if (stockEvalSink) {
      stockEvalSink.push({
        itemId,
        itemName: item.name,
        oldQuantity,
        newQuantity,
        reorderPoint: item.reorderPoint ?? null,
        maxQuantity: item.maxQuantity ?? null,
        stockModel: item.stockModel ?? null,
        fixedTargetQuantity: item.fixedTargetQuantity ?? null,
      });
    }

    // Activity-write-time recompute (mc / rp / max / reorderQty / leadTime).
    // The canonical math lives in stock-health utilities; nightly cron is the
    // authoritative recompute for ABC/XYZ ranking.
    if (
      operation === ACTIVITY_OPERATION.OUTBOUND ||
      (operation === ACTIVITY_OPERATION.INBOUND &&
        data?.reason === ACTIVITY_REASON.ORDER_RECEIVED)
    ) {
      try {
        await this.itemRecomputeService.recomputeItemMetrics(itemId, tx);
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          this.logger.error(`Error recomputing metrics for item ${itemId}:`, error);
        }
      }
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
        receivedAt: newReceivedQuantity > 0 ? (orderItem.receivedAt ?? new Date()) : null,
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
    } else if (noneReceived && order.status === ORDER_STATUS.PARTIALLY_RECEIVED) {
      // All partial receipts were reversed — go back to FULFILLED (no items received at all).
      newStatus = ORDER_STATUS.FULFILLED;
    }
    // NOTE: we intentionally do NOT downgrade from RECEIVED to FULFILLED via activity sync.
    // If an order reached RECEIVED it was explicitly confirmed by a user; removing a stock
    // activity should not silently undo that confirmation. Use the order management UI to
    // reverse a receipt if truly needed.

    // Atualizar o status se mudou
    if (newStatus !== order.status) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          statusOrder: getStatusOrder(newStatus as ORDER_STATUS),
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
  private async syncExternalOperationItemReturned(
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
      const externalOperationItems = await tx.externalOperationItem.findMany({
        where: {
          itemId,
          returnedQuantity: { gt: 0 },
          externalOperation: {
            status: {
              in: [
                EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED,
                EXTERNAL_OPERATION_STATUS.FULLY_RETURNED,
              ],
            },
          },
        },
        include: {
          externalOperation: true,
        },
        orderBy: {
          createdAt: 'desc', // Process newest returns first when reversing
        },
      });

      if (externalOperationItems.length === 0) {
        return;
      }

      // Distribute the reversed quantity across withdrawal items
      let remainingQuantity = quantity;

      for (const withdrawalItem of externalOperationItems) {
        if (remainingQuantity <= 0) break;

        const quantityToReverse = Math.min(remainingQuantity, withdrawalItem.returnedQuantity);
        const newReturnedQuantity = withdrawalItem.returnedQuantity - quantityToReverse;

        // Update the withdrawal item
        await tx.externalOperationItem.update({
          where: { id: withdrawalItem.id },
          data: {
            returnedQuantity: newReturnedQuantity,
          },
        });

        // Log the change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
          entityId: withdrawalItem.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'returnedQuantity',
          oldValue: withdrawalItem.returnedQuantity,
          newValue: newReturnedQuantity,
          reason: `Quantidade devolvida revertida por exclusão/atualização de atividade ${activityId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_SYNC,
          triggeredById: activityId,
          userId: userId || null,
          transaction: tx,
        });

        remainingQuantity -= quantityToReverse;

        // Check if this withdrawal status needs update
        await this.checkAndUpdateExternalOperationStatus(
          tx,
          withdrawalItem.externalOperationId,
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
    const externalOperationItems = await tx.externalOperationItem.findMany({
      where: {
        itemId,
        externalOperation: {
          status: {
            in: [
              EXTERNAL_OPERATION_STATUS.PENDING as any,
              EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED as any,
            ],
          },
        },
      },
      include: {
        externalOperation: true,
      },
      orderBy: {
        createdAt: 'asc', // Process oldest withdrawals first
      },
    });

    if (externalOperationItems.length === 0) {
      return;
    }

    // Distribute the returned quantity across withdrawal items
    let remainingQuantity = quantity;

    for (const withdrawalItem of externalOperationItems) {
      if (remainingQuantity <= 0) break;

      const pendingReturn = withdrawalItem.withdrawedQuantity - withdrawalItem.returnedQuantity;
      if (pendingReturn <= 0) continue;

      const quantityToReturn = Math.min(remainingQuantity, pendingReturn);
      const newReturnedQuantity = withdrawalItem.returnedQuantity + quantityToReturn;

      // Update the withdrawal item
      await tx.externalOperationItem.update({
        where: { id: withdrawalItem.id },
        data: {
          returnedQuantity: newReturnedQuantity,
        },
      });

      // Log the change
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
        entityId: withdrawalItem.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'returnedQuantity',
        oldValue: withdrawalItem.returnedQuantity,
        newValue: newReturnedQuantity,
        reason: `Quantidade devolvida atualizada por atividade ${activityId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_SYNC,
        triggeredById: activityId,
        userId: userId || null,
        transaction: tx,
      });

      remainingQuantity -= quantityToReturn;

      // Check if this withdrawal is now fully returned
      await this.checkAndUpdateExternalOperationStatus(
        tx,
        withdrawalItem.externalOperationId,
        userId,
      );
    }
  }

  /**
   * Check and update external withdrawal status based on returned quantities
   */
  private async checkAndUpdateExternalOperationStatus(
    tx: PrismaTransaction,
    externalOperationId: string,
    userId?: string,
  ): Promise<void> {
    // Get all items for this withdrawal
    const withdrawalItems = await tx.externalOperationItem.findMany({
      where: { externalOperationId },
    });

    const withdrawal = await tx.externalOperation.findUnique({
      where: { id: externalOperationId },
    });

    if (!withdrawal) {
      throw new NotFoundException('Operação externa não encontrada');
    }

    // Calculate the status based on returned quantities
    const allReturned = withdrawalItems.every(
      item => item.returnedQuantity >= item.withdrawedQuantity,
    );
    const someReturned = withdrawalItems.some(item => item.returnedQuantity > 0);
    const noneReturned = withdrawalItems.every(item => item.returnedQuantity === 0);

    let newStatus = withdrawal.status;

    if (allReturned) {
      newStatus = EXTERNAL_OPERATION_STATUS.FULLY_RETURNED;
    } else if (someReturned) {
      newStatus = EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED;
    } else if (
      noneReturned &&
      withdrawal.status === EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED
    ) {
      // If was partially returned and now nothing is returned, go back to active
      newStatus = EXTERNAL_OPERATION_STATUS.PENDING as any;
    }

    // Update status if changed
    if (newStatus !== withdrawal.status) {
      const oldStatus = withdrawal.status;

      await tx.externalOperation.update({
        where: { id: externalOperationId },
        data: {
          status: newStatus as any,
          statusOrder: EXTERNAL_OPERATION_STATUS_ORDER[newStatus as string],
        },
      });

      // Log the status change
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
        entityId: externalOperationId,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: oldStatus,
        newValue: newStatus,
        reason: 'Status atualizado automaticamente baseado nas quantidades devolvidas',
        triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_SYNC,
        triggeredById: externalOperationId,
        userId: userId || null,
        transaction: tx,
      });
    }
  }

}
