// order-item.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderItemRepository } from './repositories/order-item/order-item.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  OrderItemReceivedEvent,
  OrderStatusChangedEvent,
  OrderCancelledEvent,
} from './order.events';
import {
  Order,
  OrderItem,
  User,
  OrderItemBatchCreateResponse,
  OrderItemBatchDeleteResponse,
  OrderItemBatchUpdateResponse,
  OrderItemCreateResponse,
  OrderItemDeleteResponse,
  OrderItemGetManyResponse,
  OrderItemGetUniqueResponse,
  OrderItemUpdateResponse,
} from '../../../types';
import {
  OrderItemCreateFormData,
  OrderItemUpdateFormData,
  OrderItemGetManyFormData,
  OrderItemBatchCreateFormData,
  OrderItemBatchUpdateFormData,
  OrderItemBatchDeleteFormData,
  OrderItemInclude,
} from '../../../schemas/order';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  ORDER_STATUS,
  ACTIVITY_REASON,
} from '../../../constants/enums';
import { OrderService } from './order.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { ACTIVITY_OPERATION } from '../../../constants/enums';
import { nameSimilarity } from '../../financial/reconciliation/text-normalization';

@Injectable()
export class OrderItemService {
  private readonly logger = new Logger(OrderItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderItemRepository: OrderItemRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject(forwardRef(() => OrderService)) private readonly orderService: OrderService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Buscar muitos itens de pedido com filtros
   */
  async findMany(query: OrderItemGetManyFormData): Promise<OrderItemGetManyResponse> {
    try {
      const result = await this.orderItemRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Itens de pedido carregados com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar itens de pedido:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar itens de pedido. Por favor, tente novamente',
      );
    }
  }

  /**
   * Linhas temporárias (texto livre) ainda não vinculadas a um item do
   * catálogo, cada uma com os melhores candidatos por similaridade de tokens.
   * Linhas recebidas sem vínculo NUNCA entram no estoque — esta lista alimenta
   * a conversão via PUT /order-items/:id { itemId }.
   */
  async findTemporaryItemSuggestions(): Promise<{
    success: boolean;
    message: string;
    data: Array<{
      id: string;
      temporaryItemDescription: string | null;
      orderedQuantity: number;
      receivedQuantity: number;
      receivedAt: Date | null;
      order: { id: string; description: string | null; status: string };
      suggestions: Array<{ itemId: string; name: string; uniCode: string | null; score: number }>;
    }>;
  }> {
    try {
      const [tempLines, items] = await Promise.all([
        this.prisma.orderItem.findMany({
          where: { itemId: null, temporaryItemDescription: { not: null } },
          select: {
            id: true,
            temporaryItemDescription: true,
            orderedQuantity: true,
            receivedQuantity: true,
            receivedAt: true,
            order: { select: { id: true, description: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.item.findMany({
          where: { isActive: true },
          select: { id: true, name: true, uniCode: true },
        }),
      ]);

      const data = tempLines.map(line => ({
        ...line,
        suggestions: items
          .map(it => ({
            itemId: it.id,
            name: it.name,
            uniCode: it.uniCode,
            score: Math.round(nameSimilarity(line.temporaryItemDescription, it.name) * 100) / 100,
          }))
          .filter(s => s.score >= 0.5)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3),
      }));

      return {
        success: true,
        message: 'Sugestões de vinculação carregadas com sucesso',
        data,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar sugestões de itens temporários:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar sugestões de itens temporários. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar um item de pedido por ID
   */
  async findById(id: string, include?: OrderItemInclude): Promise<OrderItemGetUniqueResponse> {
    try {
      const orderItem = await this.orderItemRepository.findById(id, { include });

      if (!orderItem) {
        throw new NotFoundException('Item de pedido não encontrado');
      }

      return { success: true, data: orderItem, message: 'Item de pedido carregado com sucesso' };
    } catch (error) {
      this.logger.error('Erro ao buscar item de pedido por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar item de pedido. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar novo item de pedido
   */
  async create(
    data: OrderItemCreateFormData,
    include?: OrderItemInclude,
    userId?: string,
  ): Promise<OrderItemCreateResponse> {
    try {
      // Usar o método createOrderItem do OrderService que tem toda a validação robusta
      const result = await this.orderService.createOrderItem(data, userId);

      // Se include foi especificado, buscar o item com as relações incluídas
      if (include && result.data) {
        const orderItemWithIncludes = await this.orderItemRepository.findById(result.data.id, {
          include,
        });
        return { success: true, data: orderItemWithIncludes!, message: result.message };
      }

      return result;
    } catch (error) {
      this.logger.error('Erro ao criar item de pedido:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar item de pedido. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar item de pedido
   */
  async update(
    id: string,
    data: OrderItemUpdateFormData,
    include?: OrderItemInclude,
    userId?: string,
  ): Promise<OrderItemUpdateResponse> {
    try {
      // Capture state needed for post-commit notification emits (mirrors
      // OrderService.updateOrderItem which emits order.item.received, and the
      // order status auto-recompute which otherwise persists silently).
      let emitContext: {
        orderId: string;
        oldOrderStatus: string;
        oldReceivedQuantity: number;
        newReceivedQuantity: number;
      } | null = null;

      const result = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // Verificar se o item de pedido existe
          const existingOrderItem = await this.orderItemRepository.findByIdWithTransaction(tx, id);
          if (!existingOrderItem) {
            throw new NotFoundException('Item de pedido não encontrado');
          }

          // Quantidade recebida não pode exceder a quantidade pedida
          if (data.receivedQuantity !== undefined && data.receivedQuantity !== null) {
            const effectiveOrderedQuantity =
              data.orderedQuantity ?? existingOrderItem.orderedQuantity;
            if (data.receivedQuantity > effectiveOrderedQuantity) {
              throw new BadRequestException(
                `Quantidade recebida (${data.receivedQuantity}) não pode ser maior que a quantidade pedida (${effectiveOrderedQuantity})`,
              );
            }
          }

          // Conversão: vincular uma linha temporária (texto livre) a um item do
          // catálogo. Só a transição null→itemId é aceita — repontar uma linha
          // já vinculada (ou desvincular) é rejeitado. Vincular NÃO cria
          // atividade retroativa para quantidades já recebidas: o estoque
          // físico pode já tê-las absorvido via contagem; recebimentos FUTUROS
          // da linha vinculada seguem o fluxo normal de atividades abaixo.
          if (data.itemId !== undefined) {
            if (data.itemId === existingOrderItem.itemId) {
              delete data.itemId; // no-op
            } else if (existingOrderItem.itemId) {
              throw new BadRequestException(
                'Item de pedido já está vinculado a um item do estoque e não pode ser repontado',
              );
            } else {
              const targetItem = await tx.item.findUnique({
                where: { id: data.itemId },
                select: { id: true, name: true },
              });
              if (!targetItem) {
                throw new NotFoundException('Item do estoque não encontrado para vinculação');
              }
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.ORDER_ITEM,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'itemId',
                oldValue: null,
                newValue: data.itemId,
                reason: `Item temporário "${existingOrderItem.temporaryItemDescription ?? '-'}" vinculado ao item "${targetItem.name}"`,
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: id,
                userId: userId || null,
                transaction: tx,
              });
            }
          }

          // Snapshot the parent order status BEFORE any auto-recompute so we can
          // detect (and notify about) a status change after the transaction.
          const orderBeforeUpdate = await tx.order.findUnique({
            where: { id: existingOrderItem.orderId },
            select: { status: true },
          });

          // Atualizar o item de pedido
          const updatedOrderItem = await this.orderItemRepository.updateWithTransaction(
            tx,
            id,
            data,
            { include },
          );

          // Track field-level changes
          const fieldsToTrack = [
            'orderedQuantity',
            'receivedQuantity',
            'price',
            'icms',
            'ipi',
            'receivedAt',
            'fulfilledAt',
          ];

          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ORDER_ITEM,
            entityId: id,
            oldEntity: existingOrderItem,
            newEntity: updatedOrderItem,
            fieldsToTrack,
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          // Log significant order item changes on the ORDER entity for visibility
          // Similar to how external withdrawal logs item returns
          if (
            data.receivedQuantity !== undefined &&
            data.receivedQuantity !== existingOrderItem.receivedQuantity
          ) {
            // Get item details for better logging
            const orderItemWithDetails = await this.orderItemRepository.findByIdWithTransaction(
              tx,
              id,
              {
                include: { item: true },
              },
            );

            const itemName =
              orderItemWithDetails?.item?.name ||
              orderItemWithDetails?.temporaryItemDescription ||
              (existingOrderItem.itemId
                ? `Item ${existingOrderItem.itemId.slice(0, 8)}...`
                : 'Item temporário');

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ORDER,
              entityId: existingOrderItem.orderId,
              action: CHANGE_ACTION.UPDATE,
              field: itemName, // Use item name as field name for clarity
              oldValue: existingOrderItem.receivedQuantity,
              newValue: data.receivedQuantity,
              reason: `Quantidade recebida de "${itemName}" foi atualizada`,
              triggeredBy: CHANGE_TRIGGERED_BY.ORDER_ITEM_UPDATE,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }

          // Check and update order fulfillment status if fulfilledAt changed
          if (
            data.fulfilledAt !== undefined &&
            data.fulfilledAt !== existingOrderItem.fulfilledAt
          ) {
            await this.orderService.checkAndUpdateOrderFulfillmentStatus(
              existingOrderItem.orderId,
              tx,
            );
          }

          // Handle activity creation for received quantity changes INSIDE the transaction
          // Activities should be created whenever quantities change, regardless of order status
          // Skip activity creation for temporary items (items without itemId).
          // A line linked in THIS call (data.itemId) counts — link+receive in a
          // single update books stock for the delta like any normal receipt.
          const effectiveItemId = data.itemId ?? existingOrderItem.itemId;
          if (
            data.receivedQuantity !== undefined &&
            data.receivedQuantity !== existingOrderItem.receivedQuantity &&
            effectiveItemId
          ) {
            // Check existing activities to prevent duplicates
            const existingActivities = await tx.activity.findMany({
              where: {
                orderItemId: existingOrderItem.id,
                reason: ACTIVITY_REASON.ORDER_RECEIVED,
                operation: ACTIVITY_OPERATION.INBOUND,
              },
            });

            // Calculate what was already processed
            const alreadyInStock = existingActivities.reduce(
              (sum, activity) => sum + activity.quantity,
              0,
            );

            // Calculate the stock adjustment needed
            const stockAdjustment = data.receivedQuantity - alreadyInStock;

            if (stockAdjustment !== 0) {
              // Create activity INSIDE the transaction
              await tx.activity.create({
                data: {
                  itemId: effectiveItemId,
                  quantity: Math.abs(stockAdjustment),
                  operation:
                    stockAdjustment > 0 ? ACTIVITY_OPERATION.INBOUND : ACTIVITY_OPERATION.OUTBOUND,
                  reason: ACTIVITY_REASON.ORDER_RECEIVED,
                  reasonOrder: 1,
                  orderId: existingOrderItem.orderId,
                  orderItemId: existingOrderItem.id,
                  userId: null, // ORDER_RECEIVED activities don't have user
                },
              });

              // Update item stock INSIDE the transaction
              const currentItem = await tx.item.findUnique({
                where: { id: effectiveItemId },
              });

              if (currentItem) {
                const newQuantity = currentItem.quantity + stockAdjustment;
                await tx.item.update({
                  where: { id: effectiveItemId },
                  data: { quantity: Math.max(0, newQuantity) },
                });
              }
            }

            // Check and update order received status (only if fulfilledAt didn't change to avoid duplicate checks)
            if (
              !(
                data.fulfilledAt !== undefined && data.fulfilledAt !== existingOrderItem.fulfilledAt
              )
            ) {
              await this.orderService.checkAndUpdateOrderReceivedStatus(
                existingOrderItem.orderId,
                tx,
              );
            }
          }

          // Record context for post-commit notification emits
          if (
            data.receivedQuantity !== undefined &&
            data.receivedQuantity !== existingOrderItem.receivedQuantity
          ) {
            emitContext = {
              orderId: existingOrderItem.orderId,
              oldOrderStatus: (orderBeforeUpdate?.status as string) || '',
              oldReceivedQuantity: existingOrderItem.receivedQuantity || 0,
              newReceivedQuantity: data.receivedQuantity,
            };
          }

          return updatedOrderItem;
        },
        {
          timeout: 60000, // Increase timeout to 60 seconds for complex operations
        },
      );

      // Emit notifications AFTER the transaction commits. Mirrors the canonical
      // single-item path (OrderService.updateOrderItem -> order.item.received)
      // plus an order.status.changed emit for the silent auto-recompute that
      // checkAndUpdateOrderReceivedStatus performs. Best-effort: never breaks flow.
      if (emitContext) {
        await this.emitReceivedAndStatusEvents(result as OrderItem, emitContext, userId);
      }

      return { success: true, data: result, message: 'Item de pedido atualizado com sucesso' };
    } catch (error) {
      this.logger.error('Erro ao atualizar item de pedido:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar item de pedido. Por favor, tente novamente',
      );
    }
  }

  /**
   * Emit order.item.received (when receivedQuantity increased) and
   * order.status.changed (when the parent order status was auto-recomputed)
   * after a transaction commits. Mirrors the canonical single-item path in
   * OrderService so the existing OrderListener handles delivery. Best-effort.
   */
  private async emitReceivedAndStatusEvents(
    updatedOrderItem: OrderItem,
    ctx: {
      orderId: string;
      oldOrderStatus: string;
      oldReceivedQuantity: number;
      newReceivedQuantity: number;
    },
    userId?: string,
  ): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({ where: { id: ctx.orderId } });
      if (!order) {
        return;
      }

      const user = userId
        ? await this.prisma.user.findUnique({ where: { id: userId } })
        : null;

      // 1) order.item.received — only on a real received increase (mirror :2068 in order.service.ts)
      if (ctx.newReceivedQuantity > ctx.oldReceivedQuantity) {
        const quantityIncrease = ctx.newReceivedQuantity - ctx.oldReceivedQuantity;
        const eventPayload: any = new OrderItemReceivedEvent(
          order as Order,
          updatedOrderItem,
          quantityIncrease,
        );
        if (user) {
          eventPayload.receivedBy = { id: user.id, name: user.name };
        }
        this.eventEmitter.emit('order.item.received', eventPayload);
      }

      // 2) order.status.changed — checkAndUpdateOrderReceivedStatus persists the
      // new status silently; emit so listeners/notifications fire.
      if (
        ctx.oldOrderStatus &&
        order.status &&
        (order.status as string) !== ctx.oldOrderStatus &&
        user
      ) {
        this.eventEmitter.emit(
          'order.status.changed',
          new OrderStatusChangedEvent(
            order as Order,
            ctx.oldOrderStatus as any,
            order.status as any,
            user as User,
          ),
        );

        if ((order.status as string) === 'CANCELLED') {
          this.eventEmitter.emit(
            'order.cancelled',
            new OrderCancelledEvent(order as Order, user as User, 'Pedido cancelado'),
          );
        }
      }
    } catch (error) {
      this.logger.error('Erro ao emitir eventos de recebimento/status do item de pedido:', error);
    }
  }

  /**
   * Excluir item de pedido
   */
  async delete(id: string, userId?: string): Promise<OrderItemDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const orderItem = await this.orderItemRepository.findByIdWithTransaction(tx, id);
        if (!orderItem) {
          throw new NotFoundException('Item de pedido não encontrado');
        }

        // Log deletion using helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_ITEM,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: orderItem,
          reason: 'Item de pedido excluído',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.orderItemRepository.deleteWithTransaction(tx, id);
      });

      return { success: true, message: 'Item de pedido excluído com sucesso' };
    } catch (error) {
      this.logger.error('Erro ao excluir item de pedido:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir item de pedido. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar itens de pedido em lote
   */
  async batchCreate(
    data: OrderItemBatchCreateFormData,
    include?: OrderItemInclude,
    userId?: string,
  ): Promise<OrderItemBatchCreateResponse<OrderItemCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.orderItemRepository.createManyWithTransaction(
          tx,
          data.orderItems,
          { include },
        );

        // Log das criações bem-sucedidas
        for (const orderItem of batchResult.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ORDER_ITEM,
            entityId: orderItem.id,
            action: CHANGE_ACTION.CREATE,
            entity: orderItem,
            reason: 'Item de pedido criado em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            transaction: tx,
          });
        }

        return batchResult;
      });

      const message =
        result.totalCreated === 1
          ? '1 item de pedido criado com sucesso'
          : `${result.totalCreated} itens de pedido criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      return {
        success: true,
        message: `${message}${failureMessage}`,
        data: {
          success: result.success,
          failed: result.failed.map(f => ({
            index: f.index || 0,
            id: f.id || '',
            error: f.error,
            errorCode: f.errorCode,
            errorDetails: {},
            data: f.data,
            occurredAt: new Date(),
          })),
          totalProcessed: result.totalCreated + result.totalFailed,
          totalSuccess: result.totalCreated,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote de itens de pedido:', error);
      throw new InternalServerErrorException(
        'Erro ao criar itens de pedido em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar itens de pedido em lote
   */
  async batchUpdate(
    data: OrderItemBatchUpdateFormData,
    include?: OrderItemInclude,
    userId?: string,
  ): Promise<OrderItemBatchUpdateResponse<OrderItemUpdateFormData>> {
    try {
      // Captured for post-commit notification emits (mirrors single-item path).
      const receivedIncreases: Array<{
        orderId: string;
        orderItem: OrderItem;
        quantityIncrease: number;
      }> = [];
      const oldOrderStatuses = new Map<string, string>();

      const result = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // Fetch old values first for proper changelog tracking
          const itemIds = data.orderItems.map(item => item.id);
          const oldItems = await this.orderItemRepository.findByIdsWithTransaction(tx, itemIds);
          const oldItemsMap = new Map(oldItems.map(item => [item.id, item]));

          // Quantidade recebida não pode exceder a quantidade pedida (mesmo gate do update individual)
          for (const item of data.orderItems) {
            const incoming = item.data?.receivedQuantity;
            if (incoming === undefined || incoming === null) continue;

            const oldItem = oldItemsMap.get(item.id!);
            if (!oldItem) continue;

            const effectiveOrderedQuantity = item.data?.orderedQuantity ?? oldItem.orderedQuantity;
            if (incoming > effectiveOrderedQuantity) {
              throw new BadRequestException(
                `Quantidade recebida (${incoming}) não pode ser maior que a quantidade pedida (${effectiveOrderedQuantity})`,
              );
            }
          }

          // Snapshot parent order statuses BEFORE any auto-recompute so we can
          // detect status changes after the transaction commits.
          const affectedOrderIds = Array.from(
            new Set(oldItems.map(item => item.orderId).filter(Boolean)),
          );
          for (const orderId of affectedOrderIds) {
            const ord = await tx.order.findUnique({
              where: { id: orderId },
              select: { status: true },
            });
            if (ord) {
              oldOrderStatuses.set(orderId, ord.status as string);
            }
          }

          // Ensure all items have required id and data fields
          const validatedItems = data.orderItems.map(item => ({
            id: item.id!,
            data: item.data!,
          }));
          const batchResult = await this.orderItemRepository.updateManyWithTransaction(
            tx,
            validatedItems,
            { include },
          );

          // Track field changes for each successfully updated item
          const fieldsToTrack = [
            'orderedQuantity',
            'receivedQuantity',
            'price',
            'icms',
            'ipi',
            'receivedAt',
            'fulfilledAt',
          ];

          // Track which orders need status updates
          const ordersToCheckFulfillment = new Set<string>();
          const ordersToCheckReceived = new Set<string>();

          for (const orderItem of batchResult.success) {
            const oldItem = oldItemsMap.get(orderItem.id);

            if (oldItem) {
              // Track field-level changes
              await trackAndLogFieldChanges({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.ORDER_ITEM,
                entityId: orderItem.id,
                oldEntity: oldItem,
                newEntity: orderItem,
                fieldsToTrack,
                userId: userId || null,
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                transaction: tx,
              });

              // Log significant order item changes on the ORDER entity for visibility
              if (oldItem.receivedQuantity !== orderItem.receivedQuantity) {
                // Get item details for better logging
                const orderItemWithDetails = await this.orderItemRepository.findByIdWithTransaction(
                  tx,
                  orderItem.id,
                  {
                    include: { item: true },
                  },
                );

                const itemName =
                  orderItemWithDetails?.item?.name ||
                  orderItemWithDetails?.temporaryItemDescription ||
                  (orderItem.itemId
                    ? `Item ${orderItem.itemId.slice(0, 8)}...`
                    : 'Item temporário');

                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ORDER,
                  entityId: orderItem.orderId,
                  action: CHANGE_ACTION.UPDATE,
                  field: itemName,
                  oldValue: oldItem.receivedQuantity,
                  newValue: orderItem.receivedQuantity,
                  reason: `Quantidade recebida de "${itemName}" foi atualizada (lote)`,
                  triggeredBy: CHANGE_TRIGGERED_BY.ORDER_ITEM_UPDATE,
                  triggeredById: orderItem.id,
                  userId: userId || null,
                  transaction: tx,
                });
              }

              // Track which orders need status checks (but don't check yet)
              if (oldItem.fulfilledAt !== orderItem.fulfilledAt) {
                ordersToCheckFulfillment.add(orderItem.orderId);
              }
              if (oldItem.receivedQuantity !== orderItem.receivedQuantity) {
                ordersToCheckReceived.add(orderItem.orderId);

                // Record received increases for post-commit notification emit
                if (orderItem.receivedQuantity > (oldItem.receivedQuantity || 0)) {
                  receivedIncreases.push({
                    orderId: orderItem.orderId,
                    orderItem,
                    quantityIncrease:
                      orderItem.receivedQuantity - (oldItem.receivedQuantity || 0),
                  });
                }

                // Always create activities when received quantities change INSIDE the transaction
                // Skip activity creation for temporary items (items without itemId)
                if (orderItem.itemId) {
                  // Check existing activities to prevent duplicates
                  const existingActivities = await tx.activity.findMany({
                    where: {
                      orderItemId: orderItem.id,
                      reason: ACTIVITY_REASON.ORDER_RECEIVED,
                      operation: ACTIVITY_OPERATION.INBOUND,
                    },
                  });

                  // Calculate what was already processed
                  const alreadyInStock = existingActivities.reduce(
                    (sum, activity) => sum + activity.quantity,
                    0,
                  );

                  // Calculate the stock adjustment needed
                  const stockAdjustment = orderItem.receivedQuantity - alreadyInStock;

                  if (stockAdjustment !== 0) {
                    // Create activity INSIDE the transaction - this ensures it's always created
                    await tx.activity.create({
                      data: {
                        itemId: orderItem.itemId,
                        quantity: Math.abs(stockAdjustment),
                        operation:
                          stockAdjustment > 0
                            ? ACTIVITY_OPERATION.INBOUND
                            : ACTIVITY_OPERATION.OUTBOUND,
                        reason: ACTIVITY_REASON.ORDER_RECEIVED,
                        reasonOrder: 1,
                        orderId: orderItem.orderId,
                        orderItemId: orderItem.id,
                        userId: null, // ORDER_RECEIVED activities don't have user
                      },
                    });

                    // Update item stock INSIDE the transaction
                    const currentItem = await tx.item.findUnique({
                      where: { id: orderItem.itemId },
                    });

                    if (currentItem) {
                      const newQuantity = currentItem.quantity + stockAdjustment;
                      await tx.item.update({
                        where: { id: orderItem.itemId },
                        data: { quantity: Math.max(0, newQuantity) },
                      });
                    }
                  }
                }
              }
            } else {
              // If we couldn't find the old item, log a simple update
              await logEntityChange({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.ORDER_ITEM,
                entityId: orderItem.id,
                action: CHANGE_ACTION.UPDATE,
                entity: orderItem,
                reason: 'Item de pedido atualizado em lote',
                userId: userId || null,
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                transaction: tx,
              });
            }
          }

          // Now check order status updates only once per order
          for (const orderId of ordersToCheckFulfillment) {
            await this.orderService.checkAndUpdateOrderFulfillmentStatus(orderId, tx);
          }
          for (const orderId of ordersToCheckReceived) {
            await this.orderService.checkAndUpdateOrderReceivedStatus(orderId, tx);
          }

          return batchResult;
        },
        {
          timeout: 60000, // Increase timeout to 60 seconds for complex batch operations
        },
      );

      // Emit notifications AFTER the transaction commits, mirroring the
      // single-item path. Best-effort: failures never break the batch flow.
      try {
        const user = userId
          ? await this.prisma.user.findUnique({ where: { id: userId } })
          : null;

        // 1) order.item.received per item that increased
        for (const inc of receivedIncreases) {
          try {
            const order = await this.prisma.order.findUnique({ where: { id: inc.orderId } });
            if (!order) continue;
            const eventPayload: any = new OrderItemReceivedEvent(
              order as Order,
              inc.orderItem,
              inc.quantityIncrease,
            );
            if (user) {
              eventPayload.receivedBy = { id: user.id, name: user.name };
            }
            this.eventEmitter.emit('order.item.received', eventPayload);
          } catch (err) {
            this.logger.error('Erro ao emitir order.item.received (lote):', err);
          }
        }

        // 2) order.status.changed per order whose status was auto-recomputed
        if (user) {
          for (const [orderId, oldStatus] of oldOrderStatuses) {
            try {
              const order = await this.prisma.order.findUnique({ where: { id: orderId } });
              if (!order || !order.status || (order.status as string) === oldStatus) continue;

              this.eventEmitter.emit(
                'order.status.changed',
                new OrderStatusChangedEvent(
                  order as Order,
                  oldStatus as any,
                  order.status as any,
                  user as User,
                ),
              );

              if ((order.status as string) === 'CANCELLED') {
                this.eventEmitter.emit(
                  'order.cancelled',
                  new OrderCancelledEvent(order as Order, user as User, 'Pedido cancelado'),
                );
              }
            } catch (err) {
              this.logger.error('Erro ao emitir order.status.changed (lote):', err);
            }
          }
        }
      } catch (error) {
        this.logger.error('Erro ao emitir notificações de atualização em lote de itens:', error);
      }

      const message =
        result.totalUpdated === 1
          ? '1 item de pedido atualizado com sucesso'
          : `${result.totalUpdated} itens de pedido atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      return {
        success: true,
        message: `${message}${failureMessage}`,
        data: {
          success: result.success,
          failed: result.failed.map(f => ({
            index: f.index || 0,
            id: f.id || '',
            error: f.error,
            errorCode: f.errorCode,
            errorDetails: {},
            data: { ...f.data, id: f.id || '' },
            occurredAt: new Date(),
          })),
          totalProcessed: result.totalUpdated + result.totalFailed,
          totalSuccess: result.totalUpdated,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote de itens de pedido:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar itens de pedido em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir itens de pedido em lote
   */
  async batchDelete(
    data: OrderItemBatchDeleteFormData,
    userId?: string,
  ): Promise<OrderItemBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar itens antes da exclusão para log
        const items = await this.orderItemRepository.findByIdsWithTransaction(
          tx,
          data.orderItemIds,
        );

        // Log das exclusões
        for (const orderItem of items) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ORDER_ITEM,
            entityId: orderItem.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: orderItem,
            reason: 'Item de pedido excluído em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        return this.orderItemRepository.deleteManyWithTransaction(tx, data.orderItemIds);
      });

      const message =
        result.totalDeleted === 1
          ? '1 item de pedido excluído com sucesso'
          : `${result.totalDeleted} itens de pedido excluídos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      return {
        success: true,
        message: `${message}${failureMessage}`,
        data: {
          success: result.success,
          failed: result.failed.map(f => ({
            index: f.index || 0,
            id: f.id || '',
            error: f.error,
            errorCode: f.errorCode,
            errorDetails: {},
            data: f.data,
            occurredAt: new Date(),
          })),
          totalProcessed: result.totalDeleted + result.totalFailed,
          totalSuccess: result.totalDeleted,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote de itens de pedido:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir itens de pedido em lote. Por favor, tente novamente',
      );
    }
  }
}
