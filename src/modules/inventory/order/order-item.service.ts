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
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderItemRepository } from './repositories/order-item/order-item.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
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

@Injectable()
export class OrderItemService {
  private readonly logger = new Logger(OrderItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderItemRepository: OrderItemRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject(forwardRef(() => OrderService)) private readonly orderService: OrderService,
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
      const result = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // Verificar se o item de pedido existe
          const existingOrderItem = await this.orderItemRepository.findByIdWithTransaction(tx, id);
          if (!existingOrderItem) {
            throw new NotFoundException('Item de pedido não encontrado');
          }

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
            'tax',
            'isCritical',
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
              orderItemWithDetails?.item?.name || `Item ${existingOrderItem.itemId.slice(0, 8)}...`;

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
          // Skip activity creation for temporary items (items without itemId)
          if (
            data.receivedQuantity !== undefined &&
            data.receivedQuantity !== existingOrderItem.receivedQuantity &&
            existingOrderItem.itemId
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
                  itemId: existingOrderItem.itemId,
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
                where: { id: existingOrderItem.itemId },
              });

              if (currentItem) {
                const newQuantity = currentItem.quantity + stockAdjustment;
                await tx.item.update({
                  where: { id: existingOrderItem.itemId },
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

          return updatedOrderItem;
        },
        {
          timeout: 60000, // Increase timeout to 60 seconds for complex operations
        },
      );

      return { success: true, data: result, message: 'Item de pedido atualizado com sucesso' };
    } catch (error) {
      this.logger.error('Erro ao atualizar item de pedido:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar item de pedido. Por favor, tente novamente',
      );
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
      const result = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // Fetch old values first for proper changelog tracking
          const itemIds = data.orderItems.map(item => item.id);
          const oldItems = await this.orderItemRepository.findByIdsWithTransaction(tx, itemIds);
          const oldItemsMap = new Map(oldItems.map(item => [item.id, item]));

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
            'tax',
            'isCritical',
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
                  orderItemWithDetails?.item?.name || `Item ${orderItem.itemId.slice(0, 8)}...`;

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
