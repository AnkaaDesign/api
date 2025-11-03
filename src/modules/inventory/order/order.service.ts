import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';

import {
  Order,
  OrderItem,
  OrderGetManyResponse,
  OrderGetUniqueResponse,
  OrderCreateResponse,
  OrderUpdateResponse,
  OrderDeleteResponse,
  OrderBatchCreateResponse,
  OrderBatchUpdateResponse,
  OrderBatchDeleteResponse,
  OrderItemGetManyResponse,
  OrderItemGetUniqueResponse,
  OrderItemCreateResponse,
  OrderItemUpdateResponse,
  OrderItemDeleteResponse,
} from '../../../types';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ORDER_STATUS,
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  ACTIVITY_REASON,
  ACTIVITY_OPERATION,
  CHANGE_ACTION,
} from '../../../constants/enums';
import { OrderRepository } from './repositories/order/order.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  getStatusOrder,
  isValidStatusTransition,
  getOrderStatusLabel,
  calculateOrderItemTotal,
} from '../../../utils/order';
import {
  OrderCreateFormData,
  OrderUpdateFormData,
  OrderGetManyFormData,
  OrderBatchCreateFormData,
  OrderBatchUpdateFormData,
  OrderBatchDeleteFormData,
  OrderInclude,
  OrderItemGetManyFormData,
  OrderItemCreateFormData,
  OrderItemUpdateFormData,
  OrderItemInclude,
} from '../../../schemas/order';
import { OrderItemRepository } from './repositories/order-item/order-item.repository';
import { ItemService } from '../item/item.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { OrderScheduleService } from './order-schedule.service';
import { FileService } from '@modules/common/file/file.service';
import { promises as fs } from 'fs';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderRepository: OrderRepository,
    private readonly orderItemRepository: OrderItemRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly itemService: ItemService,
    private readonly orderScheduleService: OrderScheduleService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Validar pedido completo
   */
  private async validateOrder(
    data: Partial<OrderCreateFormData | OrderUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar que o pedido tem pelo menos um item (apenas para criação)
    if (!existingId && 'items' in data && (!data.items || data.items.length === 0)) {
      throw new BadRequestException('O pedido deve conter pelo menos um item.');
    }

    // Validar fornecedor existe
    if (data.supplierId) {
      const supplier = await transaction.supplier.findUnique({
        where: { id: data.supplierId },
        select: { id: true, fantasyName: true },
      });

      if (!supplier) {
        throw new NotFoundException('Fornecedor não encontrado.');
      }
    }

    // Validar data de previsão (scheduledFor/forecast) para novos pedidos
    if (!existingId && data.forecast) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const forecastDate = new Date(data.forecast);
      forecastDate.setHours(0, 0, 0, 0);

      if (forecastDate < today) {
        throw new BadRequestException('A data de previsão deve ser futura ou hoje.');
      }
    }

    // Validar transições de status
    if (existingId && data.status) {
      const existingOrder = await transaction.order.findUnique({
        where: { id: existingId },
        select: { status: true },
      });

      if (
        existingOrder &&
        !isValidStatusTransition(existingOrder.status as ORDER_STATUS, data.status as ORDER_STATUS)
      ) {
        throw new BadRequestException(
          `Transição de status inválida: ${getOrderStatusLabel(existingOrder.status as ORDER_STATUS)} → ${getOrderStatusLabel(data.status as ORDER_STATUS)}`,
        );
      }
    }

    // Validar itens do pedido
    if ('items' in data && data.items && data.items.length > 0) {
      // Validar cada item individualmente
      for (const item of data.items) {
        await this.validateOrderItem(item, data.supplierId, tx);
      }

      // Validar preços contra o catálogo
      await this.validateItemPrices(data.items, tx);

      // Validar disponibilidade de estoque para pedidos imediatos (não agendados)
      if (
        data.status &&
        [ORDER_STATUS.PARTIALLY_FULFILLED, ORDER_STATUS.FULFILLED].includes(
          data.status as ORDER_STATUS,
        )
      ) {
        const stockValidation = await this.itemService.validateStockAvailability(
          data.items.map(item => ({
            itemId: item.itemId,
            quantity: item.orderedQuantity,
          })),
          tx,
        );

        if (!stockValidation.valid) {
          throw new BadRequestException(
            `Estoque insuficiente: ${stockValidation.errors.join(', ')}`,
          );
        }
      }

      // Calcular total do pedido para log/referência
      const calculatedTotal = this.calculateOrderTotal(data.items);
      this.logger.debug(`Total calculado para o pedido: R$ ${calculatedTotal.toFixed(2)}`);
    }
  }

  /**
   * Validar item individual do pedido
   */
  private async validateOrderItem(
    item: Omit<OrderItemCreateFormData, 'orderId'>,
    supplierId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    let itemName: string;
    const isTemporaryItem = !item.itemId && item.temporaryItemDescription;

    if (isTemporaryItem) {
      // For temporary items, use the description as the item name
      itemName = item.temporaryItemDescription;
    } else {
      // For inventory items, validate that the item exists in catalog
      const catalogItem = await transaction.item.findUnique({
        where: { id: item.itemId },
        select: {
          id: true,
          name: true,
          supplierId: true,
          isActive: true,
          supplier: {
            select: { fantasyName: true },
          },
        },
      });

      if (!catalogItem) {
        throw new NotFoundException(`Item com ID ${item.itemId} não encontrado.`);
      }

      itemName = catalogItem.name;
    }

    // Validar quantidade positiva
    if (item.orderedQuantity <= 0) {
      throw new BadRequestException(
        `Quantidade para o item "${itemName}" deve ser positiva.`,
      );
    }

    // Validar preço unitário não negativo
    if (item.price < 0) {
      throw new BadRequestException(
        `Preço unitário para o item "${itemName}" não pode ser negativo.`,
      );
    }

    // Validar ICMS se fornecido
    if (item.icms !== undefined && item.icms < 0) {
      throw new BadRequestException(
        `ICMS para o item "${itemName}" não pode ser negativo.`,
      );
    }

    // Validar IPI se fornecido
    if (item.ipi !== undefined && item.ipi < 0) {
      throw new BadRequestException(
        `IPI para o item "${itemName}" não pode ser negativo.`,
      );
    }
  }

  /**
   * Validar preços dos itens contra o catálogo
   */
  private async validateItemPrices(
    items: Omit<OrderItemCreateFormData, 'orderId'>[],
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    // Filter out temporary items (those without itemId)
    const inventoryItems = items.filter(item => item.itemId);
    const itemIds = inventoryItems.map(item => item.itemId);

    // Buscar todos os itens de uma vez com preços atuais
    const catalogItems = await transaction.item.findMany({
      where: { id: { in: itemIds } },
      include: {
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Criar mapa para acesso rápido
    const catalogItemMap = new Map(catalogItems.map(item => [item.id, item]));

    // Validar cada item de inventário (temporary items are skipped)
    for (const orderItem of inventoryItems) {
      const catalogItem = catalogItemMap.get(orderItem.itemId);

      if (!catalogItem) {
        throw new NotFoundException(`Item ${orderItem.itemId} não encontrado no catálogo.`);
      }

      // User can manually set the price, no validation against catalog price needed
      // This allows creating orders even when items don't have catalog prices

      // User can also manually set the ICMS and IPI, no validation against catalog values needed
    }
  }

  /**
   * Calcular total do pedido server-side
   * ICMS and IPI are percentages (0-100), not absolute values
   */
  private calculateOrderTotal(items: Omit<OrderItemCreateFormData, 'orderId'>[]): number {
    return items.reduce((total, item) => {
      const subtotal = item.orderedQuantity * item.price;
      const icmsAmount = subtotal * ((item.icms || 0) / 100);
      const ipiAmount = subtotal * ((item.ipi || 0) / 100);
      const itemTotal = subtotal + icmsAmount + ipiAmount;
      return total + itemTotal;
    }, 0);
  }

  // =====================
  // BASIC ORDER OPERATIONS
  // =====================

  /**
   * Create a new order with complete changelog tracking
   */
  async create(
    data: OrderCreateFormData,
    include?: OrderInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      reimbursements?: Express.Multer.File[];
      reimbursementInvoices?: Express.Multer.File[];
    },
  ): Promise<OrderCreateResponse> {
    try {
      const order = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar pedido completo (já inclui validação de estoque para status FULFILLED/PARTIALLY_FULFILLED)
        await this.validateOrder(data, undefined, tx);

        // Ensure statusOrder is set correctly
        const orderData = {
          ...data,
          statusOrder: getStatusOrder((data.status as ORDER_STATUS) || ORDER_STATUS.CREATED),
        };

        // Create the order with items
        const newOrder = await this.orderRepository.createWithTransaction(tx, orderData);

        // Purchase orders don't deduct stock when created as FULFILLED
        // Stock is only added when items are RECEIVED from the supplier

        // Log order creation using helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER,
          entityId: newOrder.id,
          action: CHANGE_ACTION.CREATE,
          entity: newOrder,
          reason: 'Novo pedido criado no sistema',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Process file uploads if provided
        if (files) {
          await this.processOrderFileUploads(newOrder.id, files, userId, tx);
        }

        // If include is specified, fetch the order with included relations
        if (include) {
          const orderWithIncludes = await this.orderRepository.findByIdWithTransaction(
            tx,
            newOrder.id,
            { include },
          );
          return orderWithIncludes || newOrder;
        }

        return newOrder;
      });

      return { success: true, message: 'Pedido criado com sucesso.', data: order };
    } catch (error) {
      this.logger.error('Erro ao criar pedido:', error);

      // Clean up any uploaded files if order creation failed
      if (files) {
        await this.cleanupFailedUploads(files);
      }

      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar o pedido. Tente novamente.',
      );
    }
  }

  /**
   * Process file uploads for an order and save to WebDAV
   */
  private async processOrderFileUploads(
    orderId: string,
    files: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      reimbursements?: Express.Multer.File[];
      reimbursementInvoices?: Express.Multer.File[];
    },
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    try {
      // Get order with supplier info for folder organization
      const order = await transaction.order.findUnique({
        where: { id: orderId },
        include: { supplier: true },
      });

      if (!order) {
        throw new NotFoundException('Pedido não encontrado');
      }

      const supplierName = order.supplier?.fantasyName;

      // Process budgets
      if (files.budgets && files.budgets.length > 0) {
        for (const file of files.budgets) {
          await this.saveFileToWebDAV(
            file,
            'orderBudgets',
            orderId,
            'order',
            supplierName,
            userId,
            transaction,
          );
        }
      }

      // Process invoices
      if (files.invoices && files.invoices.length > 0) {
        for (const file of files.invoices) {
          await this.saveFileToWebDAV(
            file,
            'orderInvoices',
            orderId,
            'order',
            supplierName,
            userId,
            transaction,
          );
        }
      }

      // Process receipts
      if (files.receipts && files.receipts.length > 0) {
        for (const file of files.receipts) {
          await this.saveFileToWebDAV(
            file,
            'orderReceipts',
            orderId,
            'order',
            supplierName,
            userId,
            transaction,
          );
        }
      }

      // Process reimbursements
      if (files.reimbursements && files.reimbursements.length > 0) {
        for (const file of files.reimbursements) {
          await this.saveFileToWebDAV(
            file,
            'orderReimbursements',
            orderId,
            'order',
            supplierName,
            userId,
            transaction,
          );
        }
      }

      // Process reimbursement invoices
      if (files.reimbursementInvoices && files.reimbursementInvoices.length > 0) {
        for (const file of files.reimbursementInvoices) {
          await this.saveFileToWebDAV(
            file,
            'orderNfeReimbursements',
            orderId,
            'order',
            supplierName,
            userId,
            transaction,
          );
        }
      }

      this.logger.log(`Successfully processed file uploads for order ${orderId}`);
    } catch (error) {
      this.logger.error(`Error processing file uploads for order ${orderId}:`, error);
      throw error;
    }
  }

  /**
   * Save a file to WebDAV and create file record
   */
  private async saveFileToWebDAV(
    file: Express.Multer.File,
    fileContext: string,
    entityId: string,
    entityType: string,
    supplierName?: string,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<any> {
    if (!tx) {
      throw new InternalServerErrorException('Transaction is required for file upload');
    }

    try {
      // Use centralized file service to create file with proper transaction handling
      const fileRecord = await this.fileService.createFromUploadWithTransaction(
        tx,
        file,
        fileContext as any,
        userId,
        {
          entityId,
          entityType,
          supplierName,
        },
      );

      // Now connect the file to the order using the appropriate relation
      await tx.file.update({
        where: { id: fileRecord.id },
        data: {
          // Connect file to order based on context
          ...(fileContext === 'orderBudgets' && {
            orderBudgets: { connect: { id: entityId } },
          }),
          ...(fileContext === 'orderInvoices' && {
            orderInvoices: { connect: { id: entityId } },
          }),
          ...(fileContext === 'orderReceipts' && {
            orderReceipts: { connect: { id: entityId } },
          }),
          ...(fileContext === 'orderReimbursements' && {
            orderReimbursements: { connect: { id: entityId } },
          }),
          ...(fileContext === 'orderNfeReimbursements' && {
            orderNfeReimbursements: { connect: { id: entityId } },
          }),
        },
      });

      this.logger.log(`Saved and linked file ${file.originalname} to order ${entityId}`);
      return fileRecord;
    } catch (error) {
      this.logger.error(`Error saving file to WebDAV:`, error);
      throw error;
    }
  }

  /**
   * Clean up uploaded files if order creation failed
   */
  private async cleanupFailedUploads(files: {
    budgets?: Express.Multer.File[];
    invoices?: Express.Multer.File[];
    receipts?: Express.Multer.File[];
    reimbursements?: Express.Multer.File[];
    reimbursementInvoices?: Express.Multer.File[];
  }): Promise<void> {
    const allFiles = [
      ...(files.budgets || []),
      ...(files.invoices || []),
      ...(files.receipts || []),
      ...(files.reimbursements || []),
      ...(files.reimbursementInvoices || []),
    ];

    for (const file of allFiles) {
      try {
        await fs.unlink(file.path);
      } catch (error) {
        this.logger.warn(`Failed to cleanup temp file: ${file.path}`);
      }
    }
  }

  /**
   * Update an existing order with comprehensive changelog tracking
   */
  async update(
    id: string,
    data: OrderUpdateFormData,
    include?: OrderInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      reimbursements?: Express.Multer.File[];
      reimbursementInvoices?: Express.Multer.File[];
    },
  ): Promise<OrderUpdateResponse> {
    try {
      const updatedOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing order
        const existingOrder = await this.orderRepository.findByIdWithTransaction(tx, id, {
          include: {
            items: true,
            supplier: true,
            budgets: true,
            invoices: true,
          },
        });

        if (!existingOrder) {
          throw new NotFoundException('Pedido não encontrado. Verifique se o ID está correto.');
        }

        // Handle special case: CREATED → RECEIVED should go through FULFILLED first
        const currentStatus = existingOrder.status as ORDER_STATUS;
        let actualUpdateData = { ...data };

        if (currentStatus === ORDER_STATUS.CREATED && data.status === ORDER_STATUS.RECEIVED) {
          // First, update to FULFILLED status with fulfilled dates
          const fulfilledData = {
            ...data,
            status: ORDER_STATUS.FULFILLED,
          };

          // Update order items with fulfilled dates set to order creation date
          if (existingOrder.items && existingOrder.items.length > 0) {
            const orderCreationDate = new Date(existingOrder.createdAt);

            for (const item of existingOrder.items) {
              await tx.orderItem.update({
                where: { id: item.id },
                data: {
                  fulfilledAt: orderCreationDate,
                },
              });
            }
          }

          // First validate and apply FULFILLED status
          await this.validateOrder(fulfilledData, id, tx);
          // Don't call handleOrderStatusInventoryChanges for FULFILLED - it doesn't do anything

          // Update the order to FULFILLED
          await this.orderRepository.updateWithTransaction(tx, id, {
            status: ORDER_STATUS.FULFILLED,
          });

          // Log the intermediate FULFILLED status change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ORDER,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'status_transition',
            oldValue: currentStatus,
            newValue: ORDER_STATUS.FULFILLED,
            reason: 'Status atualizado automaticamente para FULFILLED antes de RECEIVED',
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: null,
            userId: userId || null,
            transaction: tx,
          });

          // Update existingOrder status for the next validation
          existingOrder.status = ORDER_STATUS.FULFILLED;

          // Reload the order items to get the updated fulfilledAt values
          existingOrder.items = await tx.orderItem.findMany({
            where: { orderId: id },
          });

          this.logger.log(
            `After FULFILLED update: Reloaded ${existingOrder.items.length} items for order ${id}`,
          );
          for (const item of existingOrder.items) {
            this.logger.debug(
              `Reloaded item ${item.id}: orderedQty=${item.orderedQuantity}, receivedQty=${item.receivedQuantity}, itemId=${item.itemId}`,
            );
          }

          // Now proceed with RECEIVED status
          actualUpdateData = {
            ...data,
            status: ORDER_STATUS.RECEIVED,
          };
        }

        // Validate order update (já inclui validação de transição de status)
        await this.validateOrder(actualUpdateData, id, tx);

        // Handle inventory changes based on status transitions
        if (
          actualUpdateData.status &&
          (actualUpdateData.status as ORDER_STATUS) !== (existingOrder.status as ORDER_STATUS)
        ) {
          this.logger.log(
            `Calling handleOrderStatusInventoryChanges: existingOrder.status=${existingOrder.status}, newStatus=${actualUpdateData.status}, items.length=${existingOrder.items?.length}`,
          );
          await this.handleOrderStatusInventoryChanges(
            existingOrder,
            actualUpdateData.status as ORDER_STATUS,
            tx,
            userId,
          );

          // Handle auto-creation of next order if this order is from a schedule and is marked as RECEIVED
          if (actualUpdateData.status === ORDER_STATUS.RECEIVED && existingOrder.orderScheduleId) {
            await this.createNextOrderFromSchedule(existingOrder, userId, tx);
          }
        }

        // Update the order
        const updatedOrder = await this.orderRepository.updateWithTransaction(
          tx,
          id,
          actualUpdateData,
        );

        // Handle items updates if provided
        if (actualUpdateData.items !== undefined) {
          const requestedItems = actualUpdateData.items || [];
          const existingItems = existingOrder.items || [];

          // Create maps for easier lookup
          const requestedItemsMap = new Map(
            requestedItems.map(item => [item.itemId, item])
          );
          const existingItemsMap = new Map(
            existingItems.map(item => [item.itemId, item])
          );

          // Determine items to delete (existing items not in requested items)
          const itemsToDelete = existingItems.filter(
            item => !requestedItemsMap.has(item.itemId)
          );

          // Determine items to add (requested items not in existing items)
          const itemsToAdd = requestedItems.filter(
            item => !existingItemsMap.has(item.itemId)
          );

          // Determine items to update (requested items that exist in both)
          const itemsToUpdate = requestedItems.filter(
            item => existingItemsMap.has(item.itemId)
          );

          // Delete removed items
          for (const item of itemsToDelete) {
            await tx.orderItem.delete({
              where: { id: item.id },
            });
            this.logger.log(`Deleted order item ${item.id} (itemId: ${item.itemId})`);
          }

          // Add new items
          for (const item of itemsToAdd) {
            await tx.orderItem.create({
              data: {
                orderId: id,
                itemId: item.itemId,
                orderedQuantity: item.orderedQuantity,
                price: item.price,
                icms: item.icms || 0,
                ipi: item.ipi || 0,
              },
            });
            this.logger.log(`Added order item for itemId: ${item.itemId}`);
          }

          // Update existing items
          for (const item of itemsToUpdate) {
            const existingItem = existingItemsMap.get(item.itemId);
            if (existingItem) {
              // Track changes for changelog
              const hasOrderedQuantityChange = existingItem.orderedQuantity !== item.orderedQuantity;
              const hasPriceChange = existingItem.price !== item.price;
              const hasIcmsChange = existingItem.icms !== (item.icms || 0);
              const hasIpiChange = existingItem.ipi !== (item.ipi || 0);

              await tx.orderItem.update({
                where: { id: existingItem.id },
                data: {
                  orderedQuantity: item.orderedQuantity,
                  price: item.price,
                  icms: item.icms || 0,
                  ipi: item.ipi || 0,
                },
              });

              // Log quantity change
              if (hasOrderedQuantityChange) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ORDER_ITEM,
                  entityId: existingItem.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'orderedQuantity',
                  oldValue: existingItem.orderedQuantity,
                  newValue: item.orderedQuantity,
                  reason: `Quantidade pedida do item atualizada`,
                  triggeredBy: CHANGE_TRIGGERED_BY.ORDER_UPDATE,
                  triggeredById: id,
                  userId: userId || null,
                  transaction: tx,
                });
              }

              // Log price change
              if (hasPriceChange) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ORDER_ITEM,
                  entityId: existingItem.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'price',
                  oldValue: existingItem.price,
                  newValue: item.price,
                  reason: `Preço do item atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.ORDER_UPDATE,
                  triggeredById: id,
                  userId: userId || null,
                  transaction: tx,
                });
              }

              // Log ICMS change
              if (hasIcmsChange) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ORDER_ITEM,
                  entityId: existingItem.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'icms',
                  oldValue: existingItem.icms,
                  newValue: item.icms || 0,
                  reason: `ICMS do item atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.ORDER_UPDATE,
                  triggeredById: id,
                  userId: userId || null,
                  transaction: tx,
                });
              }

              // Log IPI change
              if (hasIpiChange) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ORDER_ITEM,
                  entityId: existingItem.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'ipi',
                  oldValue: existingItem.ipi,
                  newValue: item.ipi || 0,
                  reason: `IPI do item atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.ORDER_UPDATE,
                  triggeredById: id,
                  userId: userId || null,
                  transaction: tx,
                });
              }

              this.logger.log(`Updated order item ${existingItem.id} (itemId: ${item.itemId})`);
            }
          }

          // After modifying items, check if order status should be automatically updated
          // This handles the case where items are removed and all remaining items are received
          if (itemsToDelete.length > 0 || itemsToUpdate.length > 0) {
            this.logger.log(`Checking order received status after item modifications for order ${id}`);
            await this.checkAndUpdateOrderReceivedStatus(id, tx);
          }
        }

        // Log status transition separately with special field name for better UI display
        if (
          actualUpdateData.status &&
          (actualUpdateData.status as ORDER_STATUS) !== (existingOrder.status as ORDER_STATUS)
        ) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ORDER,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'status_transition',
            oldValue: existingOrder.status,
            newValue: actualUpdateData.status,
            reason: 'Status do pedido atualizado',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: null,
            userId: userId || null,
            transaction: tx,
          });
        }

        // Track field-level changes (excluding status which is handled separately)
        const fieldsToTrack = [
          // 'status' is handled separately with status_transition for better context
          'supplierId',
          'description',
          'forecast',
          'notes',
          'isRecurring',
          'recurringEndDate',
          'scheduledFor',
          'orderScheduleId',
          'budgetId',
          'nfeId',
          'receiptId',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER,
          entityId: id,
          oldEntity: existingOrder,
          newEntity: updatedOrder,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // If include is specified, fetch the order with included relations
        if (include) {
          const orderWithIncludes = await this.orderRepository.findByIdWithTransaction(tx, id, {
            include,
          });
          return orderWithIncludes || updatedOrder;
        }

        return updatedOrder;
      });

      // Handle file uploads after transaction
      if (files) {
        await this.processOrderFileUploads(updatedOrder.id, files, userId);
      }

      return { success: true, message: 'Pedido atualizado com sucesso.', data: updatedOrder };
    } catch (error) {
      this.logger.error('Erro ao atualizar pedido:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar o pedido. Tente novamente.',
      );
    }
  }

  /**
   * Delete an order
   */
  async delete(id: string, userId?: string): Promise<OrderDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const order = await this.orderRepository.findByIdWithTransaction(tx, id);

        if (!order) {
          throw new NotFoundException('Pedido não encontrado. Verifique se o ID está correto.');
        }

        // Log deletion using helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: order,
          reason: 'Pedido excluído do sistema',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.orderRepository.deleteWithTransaction(tx, id);
      });

      return { success: true, message: 'Pedido excluído com sucesso.' };
    } catch (error) {
      this.logger.error('Erro ao excluir pedido:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir o pedido. Tente novamente.',
      );
    }
  }

  /**
   * Find an order by ID
   */
  async findById(id: string, include?: OrderInclude): Promise<OrderGetUniqueResponse> {
    try {
      const order = await this.orderRepository.findById(id, { include });

      if (!order) {
        throw new NotFoundException('Pedido não encontrado. Verifique se o ID está correto.');
      }

      return { success: true, message: 'Pedido carregado com sucesso.', data: order };
    } catch (error) {
      this.logger.error('Erro ao buscar pedido por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar o pedido. Tente novamente.',
      );
    }
  }

  /**
   * Find many orders with filtering
   */
  async findMany(query: OrderGetManyFormData): Promise<OrderGetManyResponse> {
    try {
      const result = await this.orderRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Pedidos carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar pedidos:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar os pedidos. Tente novamente.',
      );
    }
  }

  // =====================
  // ORDER STATUS MANAGEMENT
  // =====================

  /**
   * Handle inventory changes based on order status transitions
   */
  private async handleOrderStatusInventoryChanges(
    existingOrder: Order,
    newStatus: ORDER_STATUS,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    const oldStatus = existingOrder.status as ORDER_STATUS;

    // Purchase orders (orders with suppliers) don't deduct stock when fulfilled
    // They only add stock when received. The FULFILLED status just means "order sent to supplier"
    // For other types of orders (internal/production), FULFILLED would mean stock deduction
    // Since all orders in this system have suppliers (purchase orders), we skip stock deduction on FULFILLED

    // NOTE: If this system ever handles internal orders without suppliers,
    // we would need to check if existingOrder.supplierId exists to determine the flow

    // If changing to RECEIVED, validate and create any missing activities
    if (newStatus === ORDER_STATUS.RECEIVED && oldStatus !== ORDER_STATUS.RECEIVED) {
      this.logger.log(
        `Changing order ${existingOrder.id} to RECEIVED. Processing ${existingOrder.items?.length || 0} items.`,
      );

      if (existingOrder.items && existingOrder.items.length > 0) {
        for (const item of existingOrder.items) {
          this.logger.debug(
            `Processing item ${item.id}: orderedQty=${item.orderedQuantity}, receivedQty=${item.receivedQuantity}`,
          );

          // Get existing ORDER_RECEIVED activities for this order item to check what was already processed
          // Query by both orderItemId and as a fallback by itemId+orderId to ensure we catch all activities
          const existingActivities = await tx.activity.findMany({
            where: {
              OR: [
                {
                  orderItemId: item.id,
                  reason: ACTIVITY_REASON.ORDER_RECEIVED,
                },
                {
                  itemId: item.itemId,
                  orderId: existingOrder.id,
                  orderItemId: null, // Legacy activities that might not have orderItemId set
                  reason: ACTIVITY_REASON.ORDER_RECEIVED,
                },
              ],
            },
          });

          // Calculate net quantity already processed (INBOUND adds, OUTBOUND subtracts)
          const alreadyProcessedQuantity = existingActivities.reduce((sum, activity) => {
            if (activity.operation === ACTIVITY_OPERATION.INBOUND) {
              return sum + activity.quantity;
            } else if (activity.operation === ACTIVITY_OPERATION.OUTBOUND) {
              return sum - activity.quantity;
            }
            return sum;
          }, 0);
          this.logger.debug(
            `Item ${item.id}: Found ${existingActivities.length} existing activities with net quantity ${alreadyProcessedQuantity}`,
          );

          // Determine the target received quantity
          // When marking order as RECEIVED, ALL items should reach their orderedQuantity
          // regardless of their current receivedQuantity
          const currentReceivedQuantity = item.receivedQuantity || 0;
          const targetReceivedQuantity = item.orderedQuantity; // Always use orderedQuantity as target when marking as RECEIVED

          this.logger.debug(
            `Item ${item.id}: currentReceived=${currentReceivedQuantity}, targetReceived=${targetReceivedQuantity}`,
          );

          // Calculate the quantity that needs to be added to stock
          // This is the difference between target and what was already processed
          const quantityToAddToStock = targetReceivedQuantity - alreadyProcessedQuantity;

          this.logger.debug(
            `Item ${item.id}: Need to add ${quantityToAddToStock} to stock (target=${targetReceivedQuantity}, already=${alreadyProcessedQuantity})`,
          );

          // Update the order item to ensure receivedQuantity and receivedAt are set
          // When marking as RECEIVED, always update receivedQuantity to orderedQuantity
          if (currentReceivedQuantity !== targetReceivedQuantity || !item.receivedAt) {
            this.logger.debug(
              `Item ${item.id}: Updating receivedQuantity from ${currentReceivedQuantity} to ${targetReceivedQuantity}`,
            );
            await tx.orderItem.update({
              where: { id: item.id },
              data: {
                receivedQuantity: targetReceivedQuantity,
                receivedAt: item.receivedAt || new Date(),
              },
            });
          }

          // Only create activity and add to stock if there's a positive quantity to add
          // This handles the case where activities weren't created during item updates
          if (quantityToAddToStock > 0) {
            this.logger.debug(
              `Item ${item.id}: Creating activity for ${quantityToAddToStock} units`,
            );
            // Create activity for the remaining quantity
            await tx.activity.create({
              data: {
                itemId: item.itemId,
                quantity: quantityToAddToStock,
                operation: ACTIVITY_OPERATION.INBOUND,
                reason: ACTIVITY_REASON.ORDER_RECEIVED,
                reasonOrder: 1, // Order received
                orderId: existingOrder.id,
                orderItemId: item.id,
                userId: null, // Order received activities are not assigned to the user making the request
              },
            });

            // Update item stock manually since we're using direct Prisma
            const currentItem = await tx.item.findUnique({
              where: { id: item.itemId },
            });

            if (currentItem) {
              const newQuantity = currentItem.quantity + quantityToAddToStock;
              await tx.item.update({
                where: { id: item.itemId },
                data: { quantity: newQuantity },
              });
            }
          }
        }
      }
    }
    // For purchase orders, cancelling FULFILLED orders doesn't require stock restoration
    // since no stock was deducted when the order was fulfilled
    // Only if items were already RECEIVED would we need to handle stock adjustments,
    // but that would be a separate business decision (return to supplier vs keep in stock)
  }

  // =====================
  // BATCH OPERATIONS
  // =====================

  /**
   * Batch create orders
   */
  async batchCreate(
    data: OrderBatchCreateFormData,
    include?: OrderInclude,
    userId?: string,
  ): Promise<OrderBatchCreateResponse<OrderCreateFormData>> {
    try {
      const results = {
        success: [] as Order[],
        failed: [] as {
          data: OrderCreateFormData;
          error: string;
          errorCode: string;
          index: number;
        }[],
        totalSuccess: 0,
        totalFailed: 0,
      };

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Process each order individually to capture specific errors
        for (const [index, orderData] of data.orders.entries()) {
          try {
            // Validate order completely
            await this.validateOrder(orderData, undefined, tx);

            // Ensure statusOrder is set correctly
            const orderDataWithStatus = {
              ...orderData,
              statusOrder: getStatusOrder(
                (orderData.status as ORDER_STATUS) || ORDER_STATUS.CREATED,
              ),
            };

            // Create the order
            const newOrder = await this.orderRepository.createWithTransaction(
              tx,
              orderDataWithStatus,
            );

            // Log order creation using helper
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ORDER,
              entityId: newOrder.id,
              action: CHANGE_ACTION.CREATE,
              entity: newOrder,
              reason: 'Pedido criado em operação de lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            // If include is specified, fetch the order with included relations
            const finalOrder = include
              ? await this.orderRepository.findByIdWithTransaction(tx, newOrder.id, { include })
              : newOrder;

            if (finalOrder) {
              results.success.push(finalOrder);
            }
            results.totalSuccess++;
          } catch (error) {
            results.failed.push({
              data: orderData,
              error: error instanceof Error ? error.message : 'Erro desconhecido ao criar pedido',
              errorCode:
                error instanceof BadRequestException
                  ? 'VALIDATION_ERROR'
                  : error instanceof NotFoundException
                    ? 'NOT_FOUND'
                    : 'UNKNOWN_ERROR',
              index,
            });
            results.totalFailed++;
          }
        }
      });

      const successMessage =
        results.totalSuccess === 1
          ? '1 pedido criado com sucesso'
          : `${results.totalSuccess} pedidos criados com sucesso`;
      const failureMessage = results.totalFailed > 0 ? `, ${results.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format
      const batchOperationResult = {
        success: results.success,
        failed: results.failed.map((error, idx) => ({
          index: error.index,
          id: undefined,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: results.totalSuccess + results.totalFailed,
        totalSuccess: results.totalSuccess,
        totalFailed: results.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na criação em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch update orders
   */
  async batchUpdate(
    data: OrderBatchUpdateFormData,
    include?: OrderInclude,
    userId?: string,
  ): Promise<OrderBatchUpdateResponse<OrderUpdateFormData>> {
    try {
      const results = {
        success: [] as Order[],
        failed: [] as {
          data: OrderUpdateFormData & { id: string };
          error: string;
          errorCode: string;
          index: number;
          id: string;
        }[],
        totalSuccess: 0,
        totalFailed: 0,
      };

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Process each update individually to capture specific errors
        for (const [index, updateData] of data.orders.entries()) {
          try {
            // Get existing order
            const existingOrder = await this.orderRepository.findByIdWithTransaction(
              tx,
              updateData.id,
              {
                include: {
                  items: true,
                  supplier: true,
                  budgets: true,
                  invoices: true,
                },
              },
            );

            if (!existingOrder) {
              results.failed.push({
                data: { ...updateData.data, id: updateData.id },
                error: 'Pedido não encontrado. Verifique se o ID está correto.',
                errorCode: 'NOT_FOUND',
                index,
                id: updateData.id,
              });
              results.totalFailed++;
              continue;
            }

            // Validate order update
            await this.validateOrder(updateData.data, updateData.id, tx);

            // Update the order
            const updatedOrder = await this.orderRepository.updateWithTransaction(
              tx,
              updateData.id,
              updateData.data,
            );

            // Track field-level changes
            const fieldsToTrack = [
              'status',
              'supplierId',
              'description',
              'forecast',
              'notes',
              'isRecurring',
              'recurringEndDate',
              'scheduledFor',
              'orderScheduleId',
              'budgetId',
              'nfeId',
              'receiptId',
            ];

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ORDER,
              entityId: updateData.id,
              oldEntity: existingOrder,
              newEntity: updatedOrder,
              fieldsToTrack,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // If include is specified, fetch the order with included relations
            const finalOrder = include
              ? await this.orderRepository.findByIdWithTransaction(tx, updateData.id, { include })
              : updatedOrder;

            if (finalOrder) {
              results.success.push(finalOrder);
            }
            results.totalSuccess++;
          } catch (error) {
            results.failed.push({
              data: { ...updateData.data, id: updateData.id },
              error:
                error instanceof Error ? error.message : 'Erro desconhecido ao atualizar pedido',
              errorCode:
                error instanceof BadRequestException
                  ? 'VALIDATION_ERROR'
                  : error instanceof NotFoundException
                    ? 'NOT_FOUND'
                    : 'UNKNOWN_ERROR',
              index,
              id: updateData.id,
            });
            results.totalFailed++;
          }
        }
      });

      const successMessage =
        results.totalSuccess === 1
          ? '1 pedido atualizado com sucesso'
          : `${results.totalSuccess} pedidos atualizados com sucesso`;
      const failureMessage = results.totalFailed > 0 ? `, ${results.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format
      const batchOperationResult = {
        success: results.success,
        failed: results.failed.map(error => ({
          index: error.index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: results.totalSuccess + results.totalFailed,
        totalSuccess: results.totalSuccess,
        totalFailed: results.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na atualização em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete orders
   */
  async batchDelete(
    data: OrderBatchDeleteFormData,
    include?: OrderInclude,
    userId?: string,
  ): Promise<OrderBatchDeleteResponse> {
    try {
      const results = {
        success: [] as { id: string; deleted: boolean }[],
        failed: [] as {
          id: string;
          error: string;
          errorCode: string;
          index: number;
          data: { id: string };
        }[],
        totalSuccess: 0,
        totalFailed: 0,
      };

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Process each deletion individually to capture specific errors
        for (const [index, orderId] of data.orderIds.entries()) {
          try {
            // Get order before deletion for logging
            const order = await this.orderRepository.findByIdWithTransaction(tx, orderId);

            if (!order) {
              results.failed.push({
                id: orderId,
                error: 'Pedido não encontrado. Verifique se o ID está correto.',
                errorCode: 'NOT_FOUND',
                index,
                data: { id: orderId },
              });
              results.totalFailed++;
              continue;
            }

            // Log deletion using helper
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ORDER,
              entityId: orderId,
              action: CHANGE_ACTION.DELETE,
              oldEntity: order,
              reason: 'Pedido excluído em operação de lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              transaction: tx,
            });

            // Delete the order
            await this.orderRepository.deleteWithTransaction(tx, orderId);
            results.success.push({ id: orderId, deleted: true });
            results.totalSuccess++;
          } catch (error) {
            results.failed.push({
              id: orderId,
              error: error instanceof Error ? error.message : 'Erro desconhecido ao excluir pedido',
              errorCode: error instanceof NotFoundException ? 'NOT_FOUND' : 'UNKNOWN_ERROR',
              index,
              data: { id: orderId },
            });
            results.totalFailed++;
          }
        }
      });

      const successMessage =
        results.totalSuccess === 1
          ? '1 pedido excluído com sucesso'
          : `${results.totalSuccess} pedidos excluídos com sucesso`;
      const failureMessage = results.totalFailed > 0 ? `, ${results.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format
      const batchOperationResult = {
        success: results.success,
        failed: results.failed,
        totalProcessed: results.totalSuccess + results.totalFailed,
        totalSuccess: results.totalSuccess,
        totalFailed: results.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  // =====================
  // ORDER ITEM OPERATIONS
  // =====================

  /**
   * Find many order items with filtering
   */
  async findManyOrderItems(query: OrderItemGetManyFormData): Promise<OrderItemGetManyResponse> {
    try {
      const params = {
        where: query.where || {},
        page: query.page || 1,
        take: query.limit || 20,
        orderBy: query.orderBy,
        include: query.include as OrderItemInclude,
      };

      const result = await this.orderItemRepository.findMany(params);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Itens do pedido carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar itens do pedido:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar os itens do pedido. Tente novamente.',
      );
    }
  }

  /**
   * Find an order item by ID
   */
  async findOrderItemById(
    id: string,
    include?: OrderItemInclude,
  ): Promise<OrderItemGetUniqueResponse> {
    try {
      const orderItem = await this.orderItemRepository.findById(id, { include });

      if (!orderItem) {
        throw new NotFoundException(
          'Item do pedido não encontrado. Verifique se o ID está correto.',
        );
      }

      return { success: true, message: 'Item do pedido carregado com sucesso.', data: orderItem };
    } catch (error) {
      this.logger.error('Erro ao buscar item do pedido por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar o item do pedido. Tente novamente.',
      );
    }
  }

  /**
   * Create an order item
   */
  async createOrderItem(
    data: OrderItemCreateFormData,
    userId?: string,
  ): Promise<OrderItemCreateResponse> {
    try {
      const orderItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar o pedido para obter o fornecedor
        const order = await tx.order.findUnique({
          where: { id: data.orderId },
          select: { id: true, supplierId: true, status: true },
        });

        if (!order) {
          throw new NotFoundException('Pedido não encontrado.');
        }

        // Não permitir adicionar itens a pedidos já recebidos ou cancelados
        if (
          [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED].includes(order.status as ORDER_STATUS)
        ) {
          throw new BadRequestException(
            `Não é possível adicionar itens a um pedido ${getOrderStatusLabel(order.status as ORDER_STATUS)}.`,
          );
        }

        // Validar o item individualmente
        await this.validateOrderItem(data, order.supplierId || undefined, tx);

        // Validar preço do item
        await this.validateItemPrices([data], tx);

        // Criar o item
        const newItem = await this.orderItemRepository.createWithTransaction(tx, data);

        // Log da criação using helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_ITEM,
          entityId: newItem.id,
          action: CHANGE_ACTION.CREATE,
          entity: newItem,
          reason: 'Item adicionado ao pedido',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return newItem;
      });

      return { success: true, message: 'Item do pedido criado com sucesso.', data: orderItem };
    } catch (error) {
      this.logger.error('Erro ao criar item do pedido:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar o item do pedido. Tente novamente.',
      );
    }
  }

  /**
   * Update an order item
   */
  async updateOrderItem(
    id: string,
    data: OrderItemUpdateFormData,
    userId?: string,
  ): Promise<OrderItemUpdateResponse> {
    try {
      const updatedItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing order item
        const existingItem = await tx.orderItem.findUnique({
          where: { id },
          include: {
            order: true,
          },
        });

        if (!existingItem) {
          throw new NotFoundException('Item do pedido não encontrado.');
        }

        // Não permitir editar itens de pedidos já recebidos ou cancelados
        if (
          [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED].includes(
            existingItem.order.status as ORDER_STATUS,
          )
        ) {
          throw new BadRequestException(
            `Não é possível editar itens de um pedido ${getOrderStatusLabel(existingItem.order.status as ORDER_STATUS)}.`,
          );
        }

        // Se a quantidade está sendo atualizada, validar
        if (data.orderedQuantity !== undefined) {
          const itemToValidate = {
            itemId: existingItem.itemId,
            orderedQuantity: data.orderedQuantity,
            price: data.price !== undefined ? data.price : existingItem.price,
            icms: data.icms !== undefined ? data.icms : existingItem.icms,
            ipi: data.ipi !== undefined ? data.ipi : existingItem.ipi,
          };

          // Validar o item com a nova quantidade
          await this.validateOrderItem(
            itemToValidate,
            existingItem.order.supplierId || undefined,
            tx,
          );
        }

        // Se o preço está sendo atualizado, validar
        if (data.price !== undefined || data.icms !== undefined || data.ipi !== undefined) {
          // Validar o novo preço
          await this.validateItemPrices(
            [
              {
                itemId: existingItem.itemId,
                orderedQuantity:
                  data.orderedQuantity !== undefined
                    ? data.orderedQuantity
                    : existingItem.orderedQuantity,
                price: data.price !== undefined ? data.price : existingItem.price,
                icms: data.icms !== undefined ? data.icms : existingItem.icms,
                ipi: data.ipi !== undefined ? data.ipi : existingItem.ipi,
              },
            ],
            tx,
          );
        }

        // Validar quantidade recebida
        if (data.receivedQuantity !== undefined) {
          const orderedQty =
            data.orderedQuantity !== undefined
              ? data.orderedQuantity
              : existingItem.orderedQuantity;
          if (data.receivedQuantity > orderedQty) {
            throw new BadRequestException(
              `Quantidade recebida (${data.receivedQuantity}) não pode exceder a quantidade pedida (${orderedQty}).`,
            );
          }
          if (data.receivedQuantity < 0) {
            throw new BadRequestException('Quantidade recebida não pode ser negativa.');
          }
        }

        // Handle received quantity updates - create activities when quantities change regardless of order status
        if (
          data.receivedQuantity !== undefined &&
          data.receivedQuantity !== existingItem.receivedQuantity
        ) {
          // Always update the receivedAt date based on quantity
          if (data.receivedQuantity > 0 && !existingItem.receivedAt) {
            data.receivedAt = new Date();
          } else if (data.receivedQuantity === 0) {
            data.receivedAt = undefined;
          }

          // Always handle inventory activities when received quantities change
          // Check if there are existing ORDER_RECEIVED activities for this item
          const existingActivities = await tx.activity.findMany({
            where: {
              orderItemId: id,
              reason: ACTIVITY_REASON.ORDER_RECEIVED,
              operation: ACTIVITY_OPERATION.INBOUND,
            },
          });

          // Calculate what was already added to stock
          const alreadyInStock = existingActivities.reduce(
            (sum, activity) => sum + activity.quantity,
            0,
          );

          // Calculate the difference between new received quantity and what's already in stock
          const stockAdjustment = data.receivedQuantity - alreadyInStock;

          if (stockAdjustment !== 0) {
            // Create activity for the adjustment
            // Use ORDER_RECEIVED reason since this represents actual receipt of items
            await tx.activity.create({
              data: {
                itemId: existingItem.itemId,
                quantity: Math.abs(stockAdjustment),
                operation:
                  stockAdjustment > 0 ? ACTIVITY_OPERATION.INBOUND : ACTIVITY_OPERATION.OUTBOUND,
                reason: ACTIVITY_REASON.ORDER_RECEIVED,
                reasonOrder: 1, // Order received
                orderId: existingItem.orderId,
                orderItemId: id,
                userId: null, // ORDER_RECEIVED activities don't have user assignment
              },
            });

            // Update item stock
            const currentItem = await tx.item.findUnique({
              where: { id: existingItem.itemId },
            });

            if (currentItem) {
              const newQuantity = currentItem.quantity + stockAdjustment;
              await tx.item.update({
                where: { id: existingItem.itemId },
                data: { quantity: Math.max(0, newQuantity) },
              });
            }
          }
        }

        // Update the order item using repository
        const updatedItem = await this.orderItemRepository.updateWithTransaction(tx, id, data);

        // Track field-level changes
        const fieldsToTrack = [
          'orderedQuantity',
          'receivedQuantity',
          'price',
          'icms',
          'ipi',
          'receivedAt',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_ITEM,
          entityId: id,
          oldEntity: existingItem,
          newEntity: updatedItem,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedItem;
      });

      return {
        success: true,
        message: 'Item do pedido atualizado com sucesso.',
        data: updatedItem,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar item do pedido:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar o item do pedido. Tente novamente.',
      );
    }
  }

  /**
   * Delete an order item
   */
  async deleteOrderItem(id: string, userId?: string): Promise<OrderItemDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get item before deletion for logging
        const orderItem = await this.orderItemRepository.findByIdWithTransaction(tx, id);

        if (!orderItem) {
          throw new NotFoundException('Item do pedido não encontrado.');
        }

        // Log deletion using helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_ITEM,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: orderItem,
          reason: 'Item removido do pedido',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.orderItemRepository.deleteWithTransaction(tx, id);
      });

      return { success: true, message: 'Item do pedido excluído com sucesso.' };
    } catch (error) {
      this.logger.error('Erro ao excluir item do pedido:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir o item do pedido. Tente novamente.',
      );
    }
  }

  /**
   * Create the next order from a schedule when the current order is marked as RECEIVED
   */
  /**
   * Check and update order status based on order items fulfillment
   */
  async checkAndUpdateOrderFulfillmentStatus(
    orderId: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    try {
      // Get all order items for this order
      const orderItems = await transaction.orderItem.findMany({
        where: { orderId },
        select: {
          id: true,
          orderedQuantity: true,
          fulfilledAt: true,
        },
      });

      if (!orderItems || orderItems.length === 0) {
        return; // No items, nothing to update
      }

      // Count fulfilled and partially fulfilled items
      const totalItems = orderItems.length;
      const fulfilledItems = orderItems.filter(item => item.fulfilledAt !== null).length;

      // Get current order status
      const currentOrder = await transaction.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });

      if (!currentOrder) {
        return;
      }

      let newStatus: ORDER_STATUS | null = null;

      // Determine new status based on fulfillment
      // Don't change status if already in a received state (PARTIALLY_RECEIVED or RECEIVED)
      if (
        currentOrder.status === ORDER_STATUS.PARTIALLY_RECEIVED ||
        currentOrder.status === ORDER_STATUS.RECEIVED
      ) {
        return; // Don't modify received statuses based on fulfillment
      }

      if (fulfilledItems === 0) {
        // No items fulfilled
        if (
          currentOrder.status === ORDER_STATUS.PARTIALLY_FULFILLED ||
          currentOrder.status === ORDER_STATUS.FULFILLED
        ) {
          newStatus = ORDER_STATUS.CREATED;
        }
      } else if (fulfilledItems === totalItems) {
        // All items fulfilled
        if (currentOrder.status !== ORDER_STATUS.FULFILLED) {
          newStatus = ORDER_STATUS.FULFILLED;
        }
      } else {
        // Some items fulfilled
        if (currentOrder.status !== ORDER_STATUS.PARTIALLY_FULFILLED) {
          newStatus = ORDER_STATUS.PARTIALLY_FULFILLED;
        }
      }

      // Update order status if needed
      if (newStatus && newStatus !== currentOrder.status) {
        const statusOrder = getStatusOrder(newStatus);
        await transaction.order.update({
          where: { id: orderId },
          data: {
            status: newStatus,
            statusOrder,
          },
        });

        // Log the status change with status_transition field for better UI display
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ORDER,
          entityId: orderId,
          action: CHANGE_ACTION.UPDATE,
          field: 'status_transition',
          oldValue: currentOrder.status,
          newValue: newStatus,
          reason: 'Status atualizado automaticamente baseado no cumprimento dos itens',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: null,
          userId: null,
          transaction,
        });
      }
    } catch (error) {
      this.logger.error(`Error checking order fulfillment status for order ${orderId}:`, error);
      // Don't throw - this is a background process
    }
  }

  /**
   * Check and update order status based on order items received status
   */
  async checkAndUpdateOrderReceivedStatus(orderId: string, tx?: PrismaTransaction): Promise<void> {
    const transaction = tx || this.prisma;

    try {
      // Get all order items for this order
      const orderItems = await transaction.orderItem.findMany({
        where: { orderId },
        select: {
          id: true,
          orderedQuantity: true,
          receivedQuantity: true,
          receivedAt: true,
          fulfilledAt: true,
        },
      });

      if (!orderItems || orderItems.length === 0) {
        return; // No items, nothing to update
      }

      // Count received items
      const totalItems = orderItems.length;
      const fullyReceivedItems = orderItems.filter(
        item => item.receivedQuantity >= item.orderedQuantity && item.receivedAt !== null,
      ).length;
      const partiallyReceivedItems = orderItems.filter(
        item => item.receivedQuantity > 0 && item.receivedQuantity < item.orderedQuantity,
      ).length;

      // Get current order status
      const currentOrder = await transaction.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });

      if (!currentOrder) {
        return;
      }

      let newStatus: ORDER_STATUS | null = null;

      // Determine new status based on received quantities
      if (fullyReceivedItems === totalItems) {
        // All items fully received
        if (currentOrder.status !== ORDER_STATUS.RECEIVED) {
          newStatus = ORDER_STATUS.RECEIVED;
        }
      } else if (fullyReceivedItems > 0 || partiallyReceivedItems > 0) {
        // Some items received - only update to PARTIALLY_RECEIVED if not already in a higher received state
        if (
          currentOrder.status !== ORDER_STATUS.PARTIALLY_RECEIVED &&
          currentOrder.status !== ORDER_STATUS.RECEIVED
        ) {
          // Make sure we're coming from a fulfilled state or lower
          if (
            [
              ORDER_STATUS.CREATED,
              ORDER_STATUS.PARTIALLY_FULFILLED,
              ORDER_STATUS.FULFILLED,
              ORDER_STATUS.OVERDUE,
            ].includes(currentOrder.status as ORDER_STATUS)
          ) {
            newStatus = ORDER_STATUS.PARTIALLY_RECEIVED;
          }
        }
      } else {
        // No items received - potentially revert to fulfilled state if items were un-received
        if (currentOrder.status === ORDER_STATUS.PARTIALLY_RECEIVED) {
          // Check if items are fulfilled
          const fulfilledOrderItems = orderItems.filter(item => item.fulfilledAt !== null);
          if (fulfilledOrderItems.length === totalItems) {
            newStatus = ORDER_STATUS.FULFILLED;
          } else if (fulfilledOrderItems.length > 0) {
            newStatus = ORDER_STATUS.PARTIALLY_FULFILLED;
          } else {
            newStatus = ORDER_STATUS.CREATED;
          }
        }
      }

      // Update order status if needed
      if (newStatus && newStatus !== currentOrder.status) {
        const statusOrder = getStatusOrder(newStatus);
        await transaction.order.update({
          where: { id: orderId },
          data: {
            status: newStatus,
            statusOrder,
          },
        });

        // Log the status change with status_transition field for better UI display
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ORDER,
          entityId: orderId,
          action: CHANGE_ACTION.UPDATE,
          field: 'status_transition',
          oldValue: currentOrder.status,
          newValue: newStatus,
          reason: 'Status atualizado automaticamente baseado no recebimento dos itens',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: null,
          userId: null,
          transaction,
        });
      }
    } catch (error) {
      this.logger.error(`Error checking order received status for order ${orderId}:`, error);
      // Don't throw - this is a background process
    }
  }

  private async createNextOrderFromSchedule(
    completedOrder: any,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      this.logger.log(
        `Processing automatic order creation from schedule ${completedOrder.orderScheduleId} after order ${completedOrder.id} completion`,
      );

      // Use the OrderScheduleService to create the next order with calculated quantities
      const orderData = await this.orderScheduleService.createOrderFromSchedule(
        completedOrder.orderScheduleId,
        userId,
        tx,
      );

      if (!orderData) {
        this.logger.log(
          `No order needed from schedule ${completedOrder.orderScheduleId} - stock levels are adequate`,
        );
        return;
      }

      // Add contextual information about the trigger
      orderData.description += ` (após recebimento do pedido ${completedOrder.id})`;

      // Create the new order using the calculated data
      if (!tx) {
        throw new Error('Transaction is required for creating order from schedule');
      }
      const newOrder = await this.orderRepository.createWithTransaction(tx, orderData);

      // Log the auto-creation
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.ORDER,
        entityId: newOrder.id,
        action: CHANGE_ACTION.CREATE,
        entity: newOrder,
        reason: `Pedido criado automaticamente pelo agendamento ${completedOrder.orderScheduleId} após conclusão do pedido ${completedOrder.id}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        userId: userId || 'system',
        transaction: tx,
      });

      // Update the order schedule to mark it as having created this order
      const nextRunDate = new Date(orderData.forecast);
      await tx?.orderSchedule.update({
        where: { id: completedOrder.orderScheduleId },
        data: {
          lastRun: new Date(),
          lastRunId: newOrder.id,
          nextRun: nextRunDate,
        },
      });

      // Log the schedule update
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ORDER_SCHEDULE,
        entityId: completedOrder.orderScheduleId,
        action: CHANGE_ACTION.UPDATE,
        field: 'lastRunId',
        oldValue: null,
        newValue: newOrder.id,
        reason: `Agendamento atualizado após criação automática do pedido ${newOrder.id}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: completedOrder.id,
        userId: userId || null,
        transaction: tx,
      });

      this.logger.log(
        `Successfully created next order ${newOrder.id} from schedule ${completedOrder.orderScheduleId} with ${orderData.items.length} items`,
      );
    } catch (error) {
      this.logger.error(`Failed to create next order from schedule: ${error.message}`, error.stack);
      // Don't throw the error to avoid breaking the main transaction
      // The auto-creation is a nice-to-have feature
    }
  }
}
