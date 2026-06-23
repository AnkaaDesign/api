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

import {
  Order,
  OrderItem,
  User,
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
  OrderPaymentSummaryResponse,
  OrderPaymentSummaryData,
  PayableRow,
  PayablesResponse,
  PayablesSummary,
} from '../../../types';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ORDER_STATUS,
  ORDER_PAYMENT_STATUS,
  ORDER_INSTALLMENT_STATUS,
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  ACTIVITY_REASON,
  ACTIVITY_OPERATION,
  CHANGE_ACTION,
  SECTOR_PRIVILEGES,
} from '../../../constants/enums';
import { ORDER_PAYMENT_STATUS_ORDER } from '../../../constants/sortOrders';
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
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  OrderItemReceivedEvent,
  OrderCancelledEvent,
} from './order.events';

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
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
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

      // NOTE: A purchase order (pedido) BUYS goods from a supplier to ADD them to stock —
      // it never consumes stock. So we must NOT validate "stock availability" here (that
      // belongs to outgoing flows: withdrawals, external operations, paint production,
      // borrows). A previous version blocked fulfilling an order whenever the warehouse
      // didn't already hold the ordered quantity ("Estoque insuficiente: ... Disponível: X,
      // Solicitado: Y"), which is exactly backwards — you order precisely because you're low.

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
      throw new BadRequestException(`Quantidade para o item "${itemName}" deve ser positiva.`);
    }

    // Validar preço unitário não negativo
    if (item.price < 0) {
      throw new BadRequestException(
        `Preço unitário para o item "${itemName}" não pode ser negativo.`,
      );
    }

    // Validar ICMS se fornecido
    if (item.icms !== undefined && item.icms < 0) {
      throw new BadRequestException(`ICMS para o item "${itemName}" não pode ser negativo.`);
    }

    // Validar IPI se fornecido
    if (item.ipi !== undefined && item.ipi < 0) {
      throw new BadRequestException(`IPI para o item "${itemName}" não pode ser negativo.`);
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
   * Predict the order number the next created order will receive, so forms can show
   * it before saving (e.g. in the order-form PDF). This is the highest assigned
   * orderNumber + 1 (1 when there are no numbered orders yet). It's a best-effort
   * preview — the authoritative number is assigned by the DB sequence at insert time.
   */
  async getNextOrderNumber(): Promise<number> {
    const { _max } = await this.prisma.order.aggregate({ _max: { orderNumber: true } });
    return (_max.orderNumber ?? 0) + 1;
  }

  /**
   * Create a new order with complete changelog tracking
   */
  async create(
    data: OrderCreateFormData,
    include?: OrderInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
    },
  ): Promise<OrderCreateResponse> {
    try {
      const order = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar pedido completo (já inclui validação de estoque para status FULFILLED/PARTIALLY_FULFILLED)
        await this.validateOrder(data, undefined, tx);

        // Ensure statusOrder is set correctly
        const orderData: any = {
          ...data,
          statusOrder: getStatusOrder((data.status as ORDER_STATUS) || ORDER_STATUS.CREATED),
        };

        // Auto-set paymentAssignedById when paymentResponsibleId is provided
        if (orderData.paymentResponsibleId && userId) {
          orderData.paymentAssignedById = userId;
        }

        // Create the order with items
        const newOrder = await this.orderRepository.createWithTransaction(tx, orderData);

        // Boleto installment schedule (2x/3x). Single-payment PIX / cartão settle at
        // the order level, so no installment rows are generated for them.
        const installmentCount = (orderData.installmentCount as number) || 1;
        if (orderData.paymentMethod === 'BANK_SLIP' && installmentCount > 1) {
          let goodsSubtotal = 0;
          let itemsTotal = 0;
          for (const item of (orderData.items || []) as any[]) {
            const subtotal = (item.orderedQuantity || 0) * (item.price || 0);
            goodsSubtotal += subtotal;
            itemsTotal += subtotal * (1 + (item.icms || 0) / 100 + (item.ipi || 0) / 100);
          }
          const discountAmount =
            orderData.discount > 0 ? goodsSubtotal * (orderData.discount / 100) : 0;
          const total = itemsTotal - discountAmount + (orderData.freight || 0);
          await this.generateInstallmentsForOrder(tx, newOrder.id, {
            total,
            count: installmentCount,
            intervalDays: orderData.paymentDueDays ?? null,
            firstDueDate: (orderData.paymentFirstDueDate as Date) ?? null,
          });
          await this.recomputeOrderPaymentRollup(tx, newOrder.id);
        }

        // Purchase orders don't deduct stock when created as FULFILLED
        // Stock is only added when items are RECEIVED from the supplier

        // Log order creation using helper. Orders generated by the schedule
        // cron/trigger carry an orderScheduleId and usually no userId — attribute
        // those to the SCHEDULE rather than mislabeling them as a USER_ACTION.
        const isScheduleOrigin = !!orderData.orderScheduleId;
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER,
          entityId: newOrder.id,
          action: CHANGE_ACTION.CREATE,
          entity: newOrder,
          reason: isScheduleOrigin
            ? 'Pedido criado automaticamente pelo agendamento'
            : 'Novo pedido criado no sistema',
          userId: userId || null,
          triggeredBy:
            isScheduleOrigin && !userId
              ? CHANGE_TRIGGERED_BY.SCHEDULE
              : CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Stamp lastAutoOrderDate on the ordered items for schedule-generated
        // orders so downstream auto-order / PPE-window logic has a real anchor
        // (this column was previously never written by any code path).
        if (isScheduleOrigin && Array.isArray(orderData.items)) {
          const itemIds = orderData.items
            .map((i: any) => i.itemId)
            .filter((id: unknown): id is string => typeof id === 'string');
          if (itemIds.length > 0) {
            await tx.item.updateMany({
              where: { id: { in: itemIds } },
              data: { lastAutoOrderDate: new Date() },
            });
          }
        }

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

      // Emit order created event
      try {
        // Get the user who created the order. Schedule/cron-created orders have no
        // acting user — emit with the 'system' actor (dispatcher convention) so
        // automatic recurring orders still fire order.created.
        const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
        const actor = (user as User) || ({ id: 'system', name: 'Sistema' } as unknown as User);

        this.eventEmitter.emit('order.created', new OrderCreatedEvent(order, actor));

        // Emit payment assigned event if paymentResponsibleId was set
        if ((data as any).paymentResponsibleId && userId) {
          this.eventEmitter.emit('order.payment.assigned', {
            order,
            paymentResponsibleId: (data as any).paymentResponsibleId,
            assignedById: userId,
          });
        }
      } catch (error) {
        this.logger.error('Error emitting order created event:', error);
        // Don't fail the order creation if event emission fails
      }

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
   * Process file uploads for an order and save to storage
   */
  private async processOrderFileUploads(
    orderId: string,
    files: {
      receipts?: Express.Multer.File[];
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

      // Process receipts
      if (files.receipts && files.receipts.length > 0) {
        for (const file of files.receipts) {
          await this.saveFileTostorage(
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

      this.logger.log(`Successfully processed file uploads for order ${orderId}`);
    } catch (error) {
      this.logger.error(`Error processing file uploads for order ${orderId}:`, error);
      throw error;
    }
  }

  /**
   * Save a file to storage and create file record
   */
  private async saveFileTostorage(
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
          ...(fileContext === 'orderReceipts' && {
            orderReceipts: { connect: { id: entityId } },
          }),
        },
      });

      this.logger.log(`Saved and linked file ${file.originalname} to order ${entityId}`);
      return fileRecord;
    } catch (error) {
      this.logger.error(`Error saving file to storage:`, error);
      throw error;
    }
  }

  /**
   * Clean up uploaded files if order creation failed
   */
  private async cleanupFailedUploads(files: {
    receipts?: Express.Multer.File[];
  }): Promise<void> {
    const allFiles = [
      ...(files.receipts || []),
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
      receipts?: Express.Multer.File[];
    },
    userSector?: string,
  ): Promise<OrderUpdateResponse> {
    try {
      // Declare variables outside transaction so they're accessible after
      let existingOrder: any;
      let actualUpdateData: any;

      const updatedOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing order
        existingOrder = await this.orderRepository.findByIdWithTransaction(tx, id, {
          include: {
            items: true,
            supplier: true,
          },
        });

        if (!existingOrder) {
          throw new NotFoundException('Pedido não encontrado. Verifique se o ID está correto.');
        }

        // WAREHOUSE sector cannot mark orders as received — only ADMIN can close orders.
        if (data.status === ORDER_STATUS.RECEIVED && userSector === SECTOR_PRIVILEGES.WAREHOUSE) {
          throw new ForbiddenException(
            'O setor de Almoxarifado não pode marcar pedidos como recebidos. Apenas administradores podem concluir pedidos.',
          );
        }

        // Handle special case: CREATED → RECEIVED should go through FULFILLED first
        const currentStatus = existingOrder.status as ORDER_STATUS;
        actualUpdateData = { ...data };

        // Auto-set paymentAssignedById when paymentResponsibleId changes
        if ((actualUpdateData as any).paymentResponsibleId !== undefined) {
          if ((actualUpdateData as any).paymentResponsibleId && userId) {
            // Assigning a responsible: set the assigner
            (actualUpdateData as any).paymentAssignedById = userId;
          } else if (!(actualUpdateData as any).paymentResponsibleId) {
            // Unassigning: clear the assigner too
            (actualUpdateData as any).paymentAssignedById = null;
          }
        }

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

          // NOTE: a scheduled order's recurrence is driven solely by the cron
          // (OrderScheduleScheduler), which advances `nextRun` in place and
          // fires the next order on the schedule's calendar cadence. We do NOT
          // auto-create the next order on receipt — that would be a second,
          // competing recurrence driver (consumption-based, not calendar-based)
          // and could double-order.
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

          // Separate inventory items (with itemId) from temporary items (without itemId)
          const existingInventoryItems = existingItems.filter(item => item.itemId);
          const existingTemporaryItems = existingItems.filter(item => !item.itemId);

          const requestedInventoryItems = requestedItems.filter(item => item.itemId);
          const requestedTemporaryItems = requestedItems.filter(item => !item.itemId);

          // Create maps for inventory items lookup (by itemId)
          const requestedInventoryMap = new Map(
            requestedInventoryItems.map(item => [item.itemId, item]),
          );
          const existingInventoryMap = new Map(
            existingInventoryItems.map(item => [item.itemId, item]),
          );

          // Determine inventory items to delete, add, update
          const inventoryItemsToDelete = existingInventoryItems.filter(
            item => !requestedInventoryMap.has(item.itemId),
          );
          const inventoryItemsToAdd = requestedInventoryItems.filter(
            item => !existingInventoryMap.has(item.itemId),
          );
          const inventoryItemsToUpdate = requestedInventoryItems.filter(item =>
            existingInventoryMap.has(item.itemId),
          );

          // For temporary items: delete all existing and recreate from request
          // This is the safest approach since temporary items don't have a stable identifier
          const temporaryItemsToDelete = existingTemporaryItems;
          const temporaryItemsToAdd = requestedTemporaryItems;

          // Delete removed inventory items
          for (const item of inventoryItemsToDelete) {
            await tx.orderItem.delete({
              where: { id: item.id },
            });
            this.logger.log(`Deleted inventory order item ${item.id} (itemId: ${item.itemId})`);
          }

          // Delete all existing temporary items (will be recreated)
          for (const item of temporaryItemsToDelete) {
            await tx.orderItem.delete({
              where: { id: item.id },
            });
            this.logger.log(
              `Deleted temporary order item ${item.id} (description: ${item.temporaryItemDescription})`,
            );
          }

          // Add new inventory items
          for (const item of inventoryItemsToAdd) {
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
            this.logger.log(`Added inventory order item for itemId: ${item.itemId}`);
          }

          // Add temporary items (including temporaryItemDescription)
          for (const item of temporaryItemsToAdd) {
            await tx.orderItem.create({
              data: {
                orderId: id,
                temporaryItemDescription: item.temporaryItemDescription,
                orderedQuantity: item.orderedQuantity,
                price: item.price,
                icms: item.icms || 0,
                ipi: item.ipi || 0,
              },
            });
            this.logger.log(`Added temporary order item: ${item.temporaryItemDescription}`);
          }

          // Alias for inventory items to update (keeping variable name for changelog logic below)
          const itemsToUpdate = inventoryItemsToUpdate;

          // Update existing items
          for (const item of itemsToUpdate) {
            const existingItem = existingInventoryMap.get(item.itemId) as any;
            if (existingItem) {
              // Track changes for changelog
              const hasOrderedQuantityChange =
                existingItem.orderedQuantity !== item.orderedQuantity;
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
          const hasItemChanges =
            inventoryItemsToDelete.length > 0 ||
            inventoryItemsToAdd.length > 0 ||
            temporaryItemsToDelete.length > 0 ||
            itemsToUpdate.length > 0 ||
            temporaryItemsToAdd.length > 0;
          if (hasItemChanges) {
            this.logger.log(
              `Checking order received status after item modifications for order ${id}`,
            );
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

          // Payment is decoupled from fulfillment: reaching a settled status no
          // longer auto-marks the order paid. Payment is settled explicitly via the
          // contas a pagar workflow (AWAITING_PAYMENT → PARTIALLY_PAID → PAID).
        }

        // Track field-level changes (excluding status which is handled separately)
        const fieldsToTrack = [
          // 'status' is handled separately with status_transition for better context
          'supplierId',
          'description',
          'forecast',
          'notes',
          'freight',
          'discount',
          'isRecurring',
          'recurringEndDate',
          'scheduledFor',
          'orderScheduleId',
          'receiptId',
          'paymentMethod',
          'paymentPix',
          'paymentDueDays',
          'paymentFirstDueDate',
          'paymentResponsibleId',
          'paymentAssignedById',
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

        // Boleto installment-schedule upkeep: regenerate parcelas when a boleto
        // order's count/total/method changed — but only while nothing has been
        // settled yet, so we never clobber paid parcelas. Single-payment PIX /
        // cartão drop any stale schedule.
        const postUpdate = await tx.order.findUnique({
          where: { id },
          select: {
            status: true,
            paymentMethod: true,
            installmentCount: true,
            paymentDueDays: true,
            paymentFirstDueDate: true,
            freight: true,
            discount: true,
            items: { select: { orderedQuantity: true, price: true, icms: true, ipi: true } },
            installments: {
              select: { number: true, dueDate: true, status: true, paidAmount: true },
              orderBy: { number: 'asc' as const },
            },
          },
        });
        if (postUpdate) {
          const anySettled = (postUpdate.installments || []).some(
            i => i.status === ORDER_INSTALLMENT_STATUS.PAID || (i.paidAmount || 0) > 0,
          );
          const wantCount = postUpdate.installmentCount || 1;
          const isBoleto = postUpdate.paymentMethod === 'BANK_SLIP';
          if (postUpdate.status === ORDER_STATUS.CANCELLED) {
            // Order cancelled: cancel any open parcelas so a dead order can't keep
            // resurfacing in Contas a Pagar at the installment level. Already-paid
            // parcelas are left intact (real money stays recorded). Never regenerate.
            if ((postUpdate.installments || []).length > 0) {
              await tx.orderInstallment.updateMany({
                where: { orderId: id, status: { not: ORDER_INSTALLMENT_STATUS.PAID } },
                data: { status: ORDER_INSTALLMENT_STATUS.CANCELLED },
              });
            }
          } else if (!anySettled) {
            if (isBoleto && wantCount > 1) {
              // Only regenerate parcelas when a payment-relevant field actually
              // changed vs the pre-update order. Regenerating unconditionally on
              // every edit (e.g. notes/description/status) churns installment IDs
              // — breaking cached "marcar parcela paga" actions — and wipes manual
              // schedule edits. Be conservative: any items in the update payload
              // count as a potential total change (item-level diff is not cheap).
              const prevCount = existingOrder.installmentCount ?? 1;
              const prevMethod = existingOrder.paymentMethod ?? null;
              const prevDueDays = existingOrder.paymentDueDays ?? null;
              const prevFirstDue = existingOrder.paymentFirstDueDate
                ? new Date(existingOrder.paymentFirstDueDate).getTime()
                : null;
              const nextFirstDue = postUpdate.paymentFirstDueDate
                ? new Date(postUpdate.paymentFirstDueDate).getTime()
                : null;
              const hasNoSchedule = (postUpdate.installments || []).length === 0;
              const paymentFieldChanged =
                hasNoSchedule ||
                prevCount !== wantCount ||
                prevMethod !== postUpdate.paymentMethod ||
                prevDueDays !== (postUpdate.paymentDueDays ?? null) ||
                prevFirstDue !== nextFirstDue ||
                (existingOrder.freight ?? 0) !== (postUpdate.freight ?? 0) ||
                (existingOrder.discount ?? 0) !== (postUpdate.discount ?? 0) ||
                actualUpdateData.items !== undefined;

              if (paymentFieldChanged) {
                const total = this.computeOrderPayableTotal(postUpdate);
                // Keep the schedule stable across unrelated updates (e.g. receiving an
                // unpaid order). Anchor the 1st parcela to the chosen first due date,
                // else the existing schedule's first parcela, else (legacy) now+interval.
                const existingFirstDue =
                  (postUpdate.installments || []).find(i => i.number === 1)?.dueDate ?? null;
                await this.generateInstallmentsForOrder(tx, id, {
                  total,
                  count: wantCount,
                  intervalDays: postUpdate.paymentDueDays ?? null,
                  firstDueDate: postUpdate.paymentFirstDueDate ?? existingFirstDue ?? null,
                });
                await this.recomputeOrderPaymentRollup(tx, id);
              }
            } else if ((postUpdate.installments || []).length > 0) {
              // No longer an installment boleto — drop the stale schedule.
              await tx.orderInstallment.deleteMany({ where: { orderId: id } });
            }
          }
        }

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

      // Emit order status changed event
      try {
        if (
          actualUpdateData.status &&
          (actualUpdateData.status as ORDER_STATUS) !== (existingOrder.status as ORDER_STATUS)
        ) {
          const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;

          if (user) {
            this.eventEmitter.emit(
              'order.status.changed',
              new OrderStatusChangedEvent(
                updatedOrder,
                existingOrder.status as ORDER_STATUS,
                actualUpdateData.status as ORDER_STATUS,
                user as User,
              ),
            );

            // Emit order cancelled event if status changed to CANCELLED
            if (actualUpdateData.status === ORDER_STATUS.CANCELLED) {
              this.eventEmitter.emit(
                'order.cancelled',
                new OrderCancelledEvent(
                  updatedOrder,
                  user as User,
                  actualUpdateData.notes || 'Pedido cancelado',
                ),
              );
            }
          }
        }
      } catch (error) {
        this.logger.error('Error emitting order status changed event:', error);
        // Don't fail the order update if event emission fails
      }

      // Emit payment responsible events
      try {
        const newPaymentResponsibleId = (actualUpdateData as any).paymentResponsibleId;
        const oldPaymentResponsibleId = existingOrder.paymentResponsibleId;

        // Payment was newly assigned or changed
        if (
          newPaymentResponsibleId &&
          newPaymentResponsibleId !== oldPaymentResponsibleId &&
          userId
        ) {
          this.eventEmitter.emit('order.payment.assigned', {
            order: updatedOrder,
            paymentResponsibleId: newPaymentResponsibleId,
            assignedById: userId,
          });
        }

        // Order status changed to FULFILLED and has a paymentAssignedById — notify the assigner
        if (
          actualUpdateData.status === ORDER_STATUS.FULFILLED &&
          (existingOrder.status as ORDER_STATUS) !== ORDER_STATUS.FULFILLED &&
          updatedOrder.paymentAssignedById
        ) {
          this.eventEmitter.emit('order.payment.fulfilled', {
            order: updatedOrder,
            paymentAssignedById: updatedOrder.paymentAssignedById,
            paymentResponsibleId: updatedOrder.paymentResponsibleId,
          });
        }
      } catch (error) {
        this.logger.error('Error emitting payment events:', error);
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
          // Build OR conditions dynamically to handle temporary items (itemId = null)
          const orConditions: any[] = [
            {
              orderItemId: item.id,
              reason: ACTIVITY_REASON.ORDER_RECEIVED,
            },
          ];

          // Only add the itemId condition for inventory items (not temporary items)
          if (item.itemId) {
            orConditions.push({
              itemId: item.itemId,
              orderId: existingOrder.id,
              orderItemId: null, // Legacy activities that might not have orderItemId set
              reason: ACTIVITY_REASON.ORDER_RECEIVED,
            });
          }

          const existingActivities = await tx.activity.findMany({
            where: {
              OR: orConditions,
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
          // Skip this for temporary items (items without itemId) since they don't have inventory
          if (quantityToAddToStock > 0 && item.itemId) {
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
                // Attribute the auto-generated INBOUND to the acting user (audit trail)
                userId: userId || null,
              },
            });

            // Update item stock atomically (increment) to avoid lost-update under
            // concurrency.
            await tx.item.update({
              where: { id: item.itemId },
              data: { quantity: { increment: quantityToAddToStock } },
            });
          } else if (!item.itemId) {
            this.logger.debug(
              `Item ${item.id}: Skipping activity and stock update for temporary item (no itemId)`,
            );
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

      // Emit order.created per created order AFTER the transaction commits,
      // mirroring the single-create path (:403). Used by auto-order too.
      // Best-effort: never break the batch flow.
      try {
        const user = userId
          ? await this.prisma.user.findUnique({ where: { id: userId } })
          : null;
        if (user) {
          for (const createdOrder of results.success) {
            try {
              this.eventEmitter.emit(
                'order.created',
                new OrderCreatedEvent(createdOrder, user as User),
              );

              // Mirror single-create: notify payment responsible if assigned
              if ((createdOrder as any).paymentResponsibleId) {
                this.eventEmitter.emit('order.payment.assigned', {
                  order: createdOrder,
                  paymentResponsibleId: (createdOrder as any).paymentResponsibleId,
                  assignedById: userId,
                });
              }
            } catch (err) {
              this.logger.error('Error emitting order.created (batch):', err);
            }
          }
        }
      } catch (error) {
        this.logger.error('Error emitting batch order created events:', error);
      }

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

      // Captured for post-commit notification emits (mirrors single-update :1063).
      const statusTransitions: Array<{
        order: Order;
        oldStatus: ORDER_STATUS;
        newStatus: ORDER_STATUS;
        cancelReason?: string;
      }> = [];

      // Captured for post-commit payment notification emits (mirrors single-update :1112).
      const paymentAssignedEvents: Array<{ order: Order; paymentResponsibleId: string }> = [];
      const paymentFulfilledEvents: Array<{
        order: Order;
        paymentAssignedById: string;
        paymentResponsibleId: string | null;
      }> = [];

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
              'freight',
              'discount',
              'isRecurring',
              'recurringEndDate',
              'scheduledFor',
              'orderScheduleId',
              'receiptId',
              'paymentMethod',
              'paymentPix',
              'paymentDueDays',
              'paymentFirstDueDate',
              'paymentResponsibleId',
              'paymentAssignedById',
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

            // Record status transition for post-commit notification emit
            if (
              updateData.data.status &&
              (updateData.data.status as ORDER_STATUS) !==
                (existingOrder.status as ORDER_STATUS)
            ) {
              statusTransitions.push({
                order: (finalOrder || updatedOrder) as Order,
                oldStatus: existingOrder.status as ORDER_STATUS,
                newStatus: updateData.data.status as ORDER_STATUS,
                cancelReason: (updateData.data as any).notes || 'Pedido cancelado',
              });
            }

            // Record payment assignment for post-commit notification emit
            const newPaymentResponsibleId = (updateData.data as any).paymentResponsibleId;
            if (
              newPaymentResponsibleId &&
              newPaymentResponsibleId !== existingOrder.paymentResponsibleId
            ) {
              paymentAssignedEvents.push({
                order: (finalOrder || updatedOrder) as Order,
                paymentResponsibleId: newPaymentResponsibleId,
              });
            }

            // Record payment fulfillment (→FULFILLED with an assigner) for post-commit emit
            if (
              (updateData.data.status as ORDER_STATUS) === ORDER_STATUS.FULFILLED &&
              (existingOrder.status as ORDER_STATUS) !== ORDER_STATUS.FULFILLED &&
              (updatedOrder as any).paymentAssignedById
            ) {
              paymentFulfilledEvents.push({
                order: (finalOrder || updatedOrder) as Order,
                paymentAssignedById: (updatedOrder as any).paymentAssignedById,
                paymentResponsibleId: (updatedOrder as any).paymentResponsibleId ?? null,
              });
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

      // Emit order.status.changed / order.cancelled per order whose status
      // changed, AFTER the transaction commits. Mirrors single-update (:1063).
      // Best-effort: never break the batch flow.
      try {
        const user = userId
          ? await this.prisma.user.findUnique({ where: { id: userId } })
          : null;
        if (user) {
          for (const t of statusTransitions) {
            try {
              this.eventEmitter.emit(
                'order.status.changed',
                new OrderStatusChangedEvent(t.order, t.oldStatus, t.newStatus, user as User),
              );

              if (t.newStatus === ORDER_STATUS.CANCELLED) {
                this.eventEmitter.emit(
                  'order.cancelled',
                  new OrderCancelledEvent(t.order, user as User, t.cancelReason),
                );
              }
            } catch (err) {
              this.logger.error('Error emitting order.status.changed (batch):', err);
            }
          }
        }
      } catch (error) {
        this.logger.error('Error emitting batch order status events:', error);
      }

      // Emit payment events per order, AFTER the transaction commits.
      // Mirrors single-update (:1112 assigned / :1135 fulfilled). Best-effort.
      try {
        if (userId) {
          for (const p of paymentAssignedEvents) {
            try {
              this.eventEmitter.emit('order.payment.assigned', {
                order: p.order,
                paymentResponsibleId: p.paymentResponsibleId,
                assignedById: userId,
              });
            } catch (err) {
              this.logger.error('Error emitting order.payment.assigned (batch):', err);
            }
          }
        }

        for (const p of paymentFulfilledEvents) {
          try {
            this.eventEmitter.emit('order.payment.fulfilled', {
              order: p.order,
              paymentAssignedById: p.paymentAssignedById,
              paymentResponsibleId: p.paymentResponsibleId,
            });
          } catch (err) {
            this.logger.error('Error emitting order.payment.fulfilled (batch):', err);
          }
        }
      } catch (error) {
        this.logger.error('Error emitting batch order payment events:', error);
      }

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
   * Update an order item.
   *
   * @deprecated DEAD CODE — no route/caller reaches this. The live per-item update is
   * `OrderItemService.update`, which (unlike this method) also recomputes the parent
   * order's fulfillment/received status via checkAndUpdateOrder*Status. Do NOT wire this
   * method to a controller: it adjusts stock but leaves the order status stale. Use
   * `OrderItemService.update` instead. Kept only to avoid a large unrelated diff.
   */
  async updateOrderItem(
    id: string,
    data: OrderItemUpdateFormData,
    userId?: string,
  ): Promise<OrderItemUpdateResponse> {
    try {
      // Declare variable outside transaction so it's accessible after
      let existingItem: any;

      const updatedItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing order item
        existingItem = await tx.orderItem.findUnique({
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
            },
          });

          // Calculate net quantity already added to stock (INBOUND adds, OUTBOUND
          // corrections subtract) so reversals aren't double-counted.
          const alreadyInStock = existingActivities.reduce((sum, activity) => {
            if (activity.operation === ACTIVITY_OPERATION.INBOUND) {
              return sum + activity.quantity;
            } else if (activity.operation === ACTIVITY_OPERATION.OUTBOUND) {
              return sum - activity.quantity;
            }
            return sum;
          }, 0);

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

            // Update item stock atomically (increment) to avoid lost-update under
            // concurrency. stockAdjustment is signed (negative on reversal).
            const updatedStockItem = await tx.item.update({
              where: { id: existingItem.itemId },
              data: { quantity: { increment: stockAdjustment } },
              select: { quantity: true },
            });

            // Preserve the non-negative clamp: if a concurrent write drove the
            // result below zero, floor it back to 0.
            if (updatedStockItem.quantity < 0) {
              await tx.item.update({
                where: { id: existingItem.itemId },
                data: { quantity: 0 },
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

      // Emit order item received event if receivedQuantity increased
      try {
        if (
          data.receivedQuantity !== undefined &&
          data.receivedQuantity > (existingItem.receivedQuantity || 0)
        ) {
          // Get the order for the event
          const order = await this.prisma.order.findUnique({
            where: { id: existingItem.orderId },
          });

          if (order) {
            const quantityIncrease = data.receivedQuantity - (existingItem.receivedQuantity || 0);
            this.eventEmitter.emit(
              'order.item.received',
              new OrderItemReceivedEvent(order as Order, updatedItem, quantityIncrease),
            );
          }
        }
      } catch (error) {
        this.logger.error('Error emitting order item received event:', error);
        // Don't fail the update if event emission fails
      }

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

        // Payment decoupled from fulfillment: no auto-settle on status change.
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
        // All items fully received — but only auto-complete an order that has
        // actually been placed/fulfilled. A CREATED draft must be fulfilled
        // before it can be received (receiving never targets a draft).
        if (
          currentOrder.status !== ORDER_STATUS.RECEIVED &&
          currentOrder.status !== ORDER_STATUS.CREATED
        ) {
          newStatus = ORDER_STATUS.RECEIVED;
        }
      } else if (fullyReceivedItems > 0 || partiallyReceivedItems > 0) {
        // Some items received - only update to PARTIALLY_RECEIVED if not already in a higher received state
        if (
          currentOrder.status !== ORDER_STATUS.PARTIALLY_RECEIVED &&
          currentOrder.status !== ORDER_STATUS.RECEIVED
        ) {
          // Make sure we're coming from an already-fulfilled state. A CREATED
          // draft is intentionally excluded so receipts can't land on a draft.
          if (
            [
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

        // Payment decoupled from fulfillment: no auto-settle on status change.
      }
    } catch (error) {
      this.logger.error(`Error checking order received status for order ${orderId}:`, error);
      // Don't throw - this is a background process
    }
  }

  // =====================
  // Payment workflow (contas a pagar)
  // =====================

  // Payment workflow is method-aware and decoupled from fulfillment along two flows:
  //   - PIX / CREDIT_CARD → pay-first. A single obligation settled manually
  //     ("Marcar como pago"), stamping paidAt + paidById. Fulfillment follows later
  //     (after the comprovante is sent to the supplier) — no auto-fulfill on payment.
  //   - BANK_SLIP (boleto) → fulfill-first. N installments (2x/3x...) that settle
  //     over time, normally via reconciliation as each parcela's bank transaction is
  //     matched to the order's fiscal document. The order's paymentStatus rolls up
  //     from its installments.
  //
  // paymentStatus axis (no "request" step): AWAITING_PAYMENT → PARTIALLY_PAID → PAID.
  // Contas a Pagar shows an order (or each open installment) until payment is settled;
  // fulfillment no longer affects payable visibility.

  private static readonly PAYMENT_STATUS_LABELS_PT: Record<string, string> = {
    [ORDER_PAYMENT_STATUS.AWAITING_PAYMENT]: 'Aguardando pagamento',
    [ORDER_PAYMENT_STATUS.PARTIALLY_PAID]: 'Parcialmente pago',
    [ORDER_PAYMENT_STATUS.PAID]: 'Pago',
  };

  /**
   * Core payment-status transition (single order, inside an existing transaction).
   * Updates paymentStatus/paymentStatusOrder + paidAt/paidById, cascades to the
   * order's installments (settle all on PAID, reopen on AWAITING_PAYMENT) and logs
   * the change.
   */
  private async updatePaymentStatusWithTransaction(
    tx: PrismaTransaction,
    orderId: string,
    targetStatus: ORDER_PAYMENT_STATUS,
    userId?: string,
    triggeredBy: CHANGE_TRIGGERED_BY = CHANGE_TRIGGERED_BY.USER_ACTION,
  ): Promise<Order> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, paymentStatus: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado.');
    }

    // A cancelled order is a dead obligation: never mutate its payment status (no
    // marcar como pago / reabrir). Cancellation already cancels its open parcelas.
    if (order.status === ORDER_STATUS.CANCELLED) {
      throw new BadRequestException(
        'Não é possível alterar o status de pagamento de um pedido cancelado.',
      );
    }

    // No-op transition: target already current. Bail out before re-stamping
    // paidAt/paidById (which would overwrite the original payment timestamp/author).
    if ((order.paymentStatus as ORDER_PAYMENT_STATUS) === targetStatus) {
      return (await tx.order.findUnique({ where: { id: orderId } })) as unknown as Order;
    }

    const now = new Date();
    const isPaid = targetStatus === ORDER_PAYMENT_STATUS.PAID;
    const isReopen = targetStatus === ORDER_PAYMENT_STATUS.AWAITING_PAYMENT;

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: targetStatus as any,
        paymentStatusOrder: ORDER_PAYMENT_STATUS_ORDER[targetStatus] ?? 1,
        paidAt: isPaid ? now : isReopen ? null : undefined,
        paidById: isPaid ? userId ?? null : isReopen ? null : undefined,
      },
    });

    // Cascade to installments so the order and its parcelas stay consistent.
    if (isPaid) {
      // Blanket "marcar como pago": close every open parcela. We intentionally do NOT
      // touch paidAmount here — a PAID parcela with paidAmount 0 is the marker of a
      // manual blanket settle (vs. a reconciled one with a real paidAmount). The
      // non-destructive reopen below relies on this distinction. No code sums
      // OrderInstallment.paidAmount, so reports are unaffected (PAID parcelas are
      // excluded from Contas a Pagar regardless).
      await tx.orderInstallment.updateMany({
        where: { orderId, status: { not: ORDER_INSTALLMENT_STATUS.PAID } },
        data: { status: ORDER_INSTALLMENT_STATUS.PAID, paidAt: now, paidById: userId ?? null },
      });
    } else if (isReopen) {
      // Reopen ("Desfazer pagamento"): fully revert every MANUAL settle to PENDING. Only
      // parcelas backed by a real bank reconciliation (a ReconciliationMatch) are kept —
      // those are re-derived from their reconciled paidAmount so a matched payment is never
      // wiped. paidAmount on its own is NOT a reliable "real payment" signal (manual
      // settles / seeds can carry it), which is why we key off the match, not the amount.
      const insts = await tx.orderInstallment.findMany({
        where: { orderId },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          paidAt: true,
          paidById: true,
          _count: { select: { reconciliationMatches: true } },
        },
      });
      for (const inst of insts) {
        const isReconciled = inst._count.reconciliationMatches > 0;
        if (isReconciled) {
          const paid = inst.paidAmount || 0;
          const fullyPaid = paid >= inst.amount - 0.005;
          const status = fullyPaid
            ? ORDER_INSTALLMENT_STATUS.PAID
            : paid > 0
              ? ORDER_INSTALLMENT_STATUS.PARTIALLY_PAID
              : ORDER_INSTALLMENT_STATUS.PENDING;
          await tx.orderInstallment.update({
            where: { id: inst.id },
            data: {
              status,
              paidAt: fullyPaid ? inst.paidAt : null,
              paidById: fullyPaid ? inst.paidById : null,
            },
          });
        } else {
          // Manual / blanket settle (no reconciliation) → revert completely.
          await tx.orderInstallment.update({
            where: { id: inst.id },
            data: {
              status: ORDER_INSTALLMENT_STATUS.PENDING,
              paidAmount: 0,
              paidAt: null,
              paidById: null,
            },
          });
        }
      }
      // Re-derive the order rollup: with the manual settles reverted it drops to
      // AWAITING_PAYMENT; if real reconciled parcelas remain it stays PARTIALLY_PAID/PAID.
      await this.recomputeOrderPaymentRollup(tx, orderId);
    }

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.ORDER,
      entityId: orderId,
      action: CHANGE_ACTION.UPDATE,
      field: 'paymentStatus',
      oldValue: order.paymentStatus,
      newValue: targetStatus,
      reason: `Status de pagamento alterado para ${
        OrderService.PAYMENT_STATUS_LABELS_PT[targetStatus] || targetStatus
      }`,
      triggeredBy,
      triggeredById: orderId,
      userId: userId || null,
      transaction: tx,
    });

    // Reopen re-derives the rollup from installments, so the order row may differ from
    // the optimistic update above — return the authoritative final state.
    if (isReopen) {
      const fresh = await tx.order.findUnique({ where: { id: orderId } });
      if (fresh) return fresh as unknown as Order;
    }
    return updated as unknown as Order;
  }

  private async changePaymentStatus(
    orderId: string,
    targetStatus: ORDER_PAYMENT_STATUS,
    successMessage: string,
    userId?: string,
  ): Promise<OrderUpdateResponse> {
    try {
      const order = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
        this.updatePaymentStatusWithTransaction(tx, orderId, targetStatus, userId),
      );

      return {
        success: true,
        message: successMessage,
        data: order,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao alterar status de pagamento do pedido:', error);
      throw new InternalServerErrorException(
        'Erro ao alterar status de pagamento. Por favor, tente novamente.',
      );
    }
  }

  private async batchChangePaymentStatus(
    orderIds: string[],
    targetStatus: ORDER_PAYMENT_STATUS,
    entityLabel: { singular: string; plural: string },
    userId?: string,
  ): Promise<OrderBatchUpdateResponse<{ id: string }>> {
    try {
      const success: Order[] = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, orderId] of orderIds.entries()) {
          try {
            const updated = await this.updatePaymentStatusWithTransaction(
              tx,
              orderId,
              targetStatus,
              userId,
              CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            );
            success.push(updated);
          } catch (error: any) {
            failed.push({
              index,
              id: orderId,
              error: error?.message || 'Erro ao alterar status de pagamento.',
              data: { id: orderId },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? `1 pedido ${entityLabel.singular}`
          : `${success.length} pedidos ${entityLabel.plural}`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na alteração de status de pagamento em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao alterar status de pagamento em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Single source of truth for an order's payable total (Contas a Pagar / summary
   * cards / parcela schedule). Semantics: items (price×qty) grossed up by ICMS/IPI,
   * minus discount% applied to the PRE-TAX goods subtotal, plus freight. The result
   * is rounded once to centavos (and floored at 0) so the payables list, summary
   * cards and the sum of parcelas all reconcile to the same value.
   */
  private computeOrderPayableTotal(order: {
    freight?: number | null;
    discount?: number | null;
    items: Array<{ orderedQuantity: number; price: number; icms?: number | null; ipi?: number | null }>;
  }): number {
    let itemsTotal = 0;
    let goodsSubtotal = 0;
    for (const item of order.items) {
      const subtotal = item.orderedQuantity * item.price;
      goodsSubtotal += subtotal;
      itemsTotal += subtotal * (1 + (item.icms || 0) / 100 + (item.ipi || 0) / 100);
    }
    const discount = order.discount || 0;
    const discountAmount = discount > 0 ? goodsSubtotal * (discount / 100) : 0;
    const total = itemsTotal - discountAmount + (order.freight || 0);
    return Math.max(0, Math.round(total * 100) / 100);
  }

  /**
   * Lightweight per-paymentStatus aggregates for the Contas a Pagar summary
   * cards. Avoids shipping every payable order to the client: totals are
   * computed server-side with the same payable convention used by the web
   * (items price×qty + ICMS/IPI − discount% on goods subtotal + freight).
   * The PAID bucket is windowed to the last 90 days (unbounded otherwise).
   */
  async getPaymentSummary(): Promise<OrderPaymentSummaryResponse> {
    try {
      const paidWindowStart = new Date();
      paidWindowStart.setDate(paidWindowStart.getDate() - 90);
      paidWindowStart.setHours(0, 0, 0, 0);

      const orders = await this.prisma.order.findMany({
        where: {
          OR: [
            // Open obligations: money owed = not cancelled and not paid. Payability is
            // decoupled from fulfillment (payable from creation until actually paid).
            {
              status: { not: ORDER_STATUS.CANCELLED },
              paymentStatus: { not: ORDER_PAYMENT_STATUS.PAID },
            },
            // Recently settled (explicitly paid) within the window.
            { paymentStatus: ORDER_PAYMENT_STATUS.PAID, paidAt: { gte: paidWindowStart } },
          ],
        },
        select: {
          paymentStatus: true,
          freight: true,
          discount: true,
          items: {
            select: { orderedQuantity: true, price: true, icms: true, ipi: true },
          },
          installments: {
            select: { amount: true, paidAmount: true, status: true },
          },
        },
      });

      const emptyBucket = () => ({ count: 0, total: 0 });
      const summary: OrderPaymentSummaryData = {
        AWAITING_PAYMENT: emptyBucket(),
        PARTIALLY_PAID: emptyBucket(),
        PAID_LAST_90_DAYS: emptyBucket(),
      };

      for (const order of orders) {
        const fullTotal = this.computeOrderPayableTotal(order);

        const isPaidBucket = order.paymentStatus === ORDER_PAYMENT_STATUS.PAID;
        const bucket = isPaidBucket
          ? summary.PAID_LAST_90_DAYS
          : summary[order.paymentStatus as keyof Omit<OrderPaymentSummaryData, 'PAID_LAST_90_DAYS'>];
        if (!bucket) continue;

        // Reconcile with getPayables: for orders with an installment schedule that
        // are not fully paid, the open obligation is the sum of unpaid parcelas
        // (full amount − settled paidAmount), not the whole order total.
        const installments = order.installments || [];
        let payableTotal = fullTotal;
        if (!isPaidBucket && installments.length > 0) {
          const settled = installments.reduce((acc, inst) => {
            if (inst.status === ORDER_INSTALLMENT_STATUS.PAID) return acc + inst.amount;
            return acc + (inst.paidAmount || 0);
          }, 0);
          payableTotal = Math.max(0, Math.round((fullTotal - settled) * 100) / 100);
        }

        bucket.count += 1;
        bucket.total += payableTotal;
      }

      return {
        success: true,
        message: 'Resumo de pagamentos carregado com sucesso.',
        data: summary,
      };
    } catch (error: any) {
      this.logger.error('Erro ao carregar resumo de pagamentos:', error);
      throw new InternalServerErrorException(
        'Erro ao carregar resumo de pagamentos. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Unified payables list (Contas a Pagar). Unions three sources into normalized rows
   * grouped by payee, each carrying its own payment state. Payment is DECOUPLED from
   * fulfillment: an obligation is payable iff `status != CANCELLED && paymentStatus != PAID`
   * (there is no auto-settle on fulfillment):
   *   - open ORDERS (status ≠ CANCELLED, paymentStatus ≠ PAID)
   *   - AIRBRUSHING painter payments (price set, paymentStatus ≠ PAID)
   *   - SCHEDULED/expected recurring outflows (active OrderSchedule due, via expected totals)
   */
  async getPayables(): Promise<PayablesResponse> {
    try {
      // "Paid this month" window — orders/airbrushing settled in the current
      // competence month are surfaced alongside the open obligations.
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const orderSelect = {
        id: true,
        description: true,
        forecast: true,
        paymentMethod: true,
        paymentFirstDueDate: true,
        paymentStatus: true,
        paidAt: true,
        freight: true,
        discount: true,
        installmentCount: true,
        supplierId: true,
        supplier: { select: { id: true, fantasyName: true } },
        items: { select: { orderedQuantity: true, price: true, icms: true, ipi: true } },
        installments: {
          select: {
            id: true,
            number: true,
            dueDate: true,
            amount: true,
            paidAmount: true,
            status: true,
            paidAt: true,
          },
          orderBy: { number: 'asc' as const },
        },
      } as const;
      const airbrushingSelect = {
        id: true,
        price: true,
        paymentStatus: true,
        paidAt: true,
        finishDate: true,
        taskId: true,
        painterId: true,
        painter: { select: { id: true, name: true } },
        task: { select: { name: true } },
      } as const;

      const [orders, airbrushings, schedules, paidOrders, paidAirbrushings] = await Promise.all([
        this.prisma.order.findMany({
          where: {
            // Open obligation = money is owed, i.e. not cancelled and not yet paid.
            // Payability is decoupled from fulfillment: an order is payable from the
            // moment it is created (CREATED) and stays payable through FULFILLED/
            // RECEIVED until it is actually paid. Receiving goods no longer settles
            // payment (the "Pago = Recebido" auto-settle was removed) — the two axes
            // (fulfillment vs payment) are independent.
            status: { not: ORDER_STATUS.CANCELLED },
            paymentStatus: { not: ORDER_PAYMENT_STATUS.PAID },
          },
          select: orderSelect,
        }),
        this.prisma.airbrushing.findMany({
          where: {
            // Only owed once the work is COMPLETED (and not already fully paid).
            status: 'COMPLETED',
            paymentStatus: { not: 'PAID' },
            price: { not: null, gt: 0 },
          },
          select: airbrushingSelect,
        }),
        this.prisma.orderSchedule.findMany({
          where: { isActive: true, finishedAt: null, nextRun: { not: null } },
          select: {
            id: true,
            nextRun: true,
            supplierId: true,
            supplier: { select: { id: true, fantasyName: true } },
          },
        }),
        // Paid this month — orders settled (paidAt) in the current month.
        this.prisma.order.findMany({
          where: { paymentStatus: ORDER_PAYMENT_STATUS.PAID, paidAt: { gte: monthStart, lt: monthEnd } },
          select: orderSelect,
        }),
        // Paid this month — airbrushing settled (paidAt) in the current month.
        this.prisma.airbrushing.findMany({
          where: { paymentStatus: 'PAID', paidAt: { gte: monthStart, lt: monthEnd }, price: { not: null, gt: 0 } },
          select: airbrushingSelect,
        }),
      ]);

      const rows: PayableRow[] = [];

      // --- ORDER rows ---
      // Boleto (BANK_SLIP) orders settle through reconciliation; everything else
      // (PIX / cartão) settles through the order lifecycle ("Marcar como pago").
      // Boleto orders with a parcela schedule emit one payable row per open
      // installment so finance sees each upcoming due date and amount.
      for (const order of orders) {
        const amount = this.computeOrderPayableTotal(order);

        const isBoleto = order.paymentMethod === 'BANK_SLIP';
        const settleVia: PayableRow['settleVia'] = isBoleto ? 'RECONCILIATION' : 'ORDER_LIFECYCLE';
        const openInstallments = (order.installments || []).filter(i => i.status !== 'PAID');

        if (openInstallments.length > 0) {
          const total = order.installments.length;
          for (const inst of openInstallments) {
            const remaining = Math.max(0, inst.amount - (inst.paidAmount || 0));
            rows.push({
              source: 'ORDER',
              id: order.id,
              installmentId: inst.id,
              payeeId: order.supplierId ?? null,
              payeeName: order.supplier?.fantasyName ?? 'Sem fornecedor',
              description: order.description,
              amount: remaining > 0 ? remaining : inst.amount,
              paymentState: inst.status === 'PARTIALLY_PAID' ? 'PARTIALLY_PAID' : 'AWAITING_PAYMENT',
              dueDate: inst.dueDate ?? order.forecast ?? null,
              method: order.paymentMethod ?? null,
              settleVia,
              subtype: total > 1 ? `${inst.number}ª parcela de ${total}` : null,
            });
          }
        } else {
          rows.push({
            source: 'ORDER',
            id: order.id,
            payeeId: order.supplierId ?? null,
            payeeName: order.supplier?.fantasyName ?? 'Sem fornecedor',
            description: order.description,
            amount,
            paymentState: order.paymentStatus as PayableRow['paymentState'],
            // Boleto à vista (1x) uses the chosen first due date; non-boleto falls back to forecast.
            dueDate: order.paymentFirstDueDate ?? order.forecast ?? null,
            method: order.paymentMethod ?? null,
            settleVia,
          });
        }
      }

      // --- AIRBRUSHING rows ---
      for (const ab of airbrushings) {
        rows.push({
          source: 'AIRBRUSHING',
          id: ab.id,
          payeeId: ab.painterId ?? null,
          payeeName: ab.painter?.name ?? 'Aerografia (sem pintor)',
          description: ab.task?.name ? `Aerografia — ${ab.task.name}` : 'Aerografia',
          amount: ab.price ?? 0,
          paymentState: ab.paymentStatus === 'PARTIALLY_PAID' ? 'PARTIALLY_PAID' : 'AWAITING_PAYMENT',
          dueDate: ab.finishDate ?? null,
          method: null,
          taskId: ab.taskId,
        });
      }

      // --- SCHEDULED/expected rows ---
      if (schedules.length > 0) {
        const expected = await this.orderScheduleService.getExpectedTotals(
          schedules.map(s => s.id),
        );
        const expectedById = new Map(expected.map(e => [e.id, e]));
        for (const schedule of schedules) {
          const exp = expectedById.get(schedule.id);
          const amount = exp?.expectedTotal ?? 0;
          if (amount <= 0) continue;
          rows.push({
            source: 'SCHEDULED',
            id: schedule.id,
            payeeId: schedule.supplierId ?? null,
            payeeName: schedule.supplier?.fantasyName ?? 'Sem fornecedor',
            description: 'Pedido programado (recorrente)',
            amount,
            paymentState: 'EXPECTED',
            dueDate: exp?.nextRun ?? schedule.nextRun ?? null,
            method: null,
          });
        }
      }

      // --- PAID this month (orders + airbrushing settled in the current month) ---
      const orderAmount = (order: (typeof paidOrders)[number]) =>
        this.computeOrderPayableTotal(order);
      for (const order of paidOrders) {
        rows.push({
          source: 'ORDER',
          id: order.id,
          payeeId: order.supplierId ?? null,
          payeeName: order.supplier?.fantasyName ?? 'Sem fornecedor',
          description: order.description,
          amount: orderAmount(order),
          paymentState: 'PAID',
          dueDate: order.forecast ?? null,
          method: order.paymentMethod ?? null,
          settleVia: order.paymentMethod === 'BANK_SLIP' ? 'RECONCILIATION' : 'ORDER_LIFECYCLE',
          paidAt: order.paidAt ?? null,
        });
      }
      for (const ab of paidAirbrushings) {
        rows.push({
          source: 'AIRBRUSHING',
          id: ab.id,
          payeeId: ab.painterId ?? null,
          payeeName: ab.painter?.name ?? 'Aerografia (sem pintor)',
          description: ab.task?.name ? `Aerografia — ${ab.task.name}` : 'Aerografia',
          amount: ab.price ?? 0,
          paymentState: 'PAID',
          dueDate: ab.finishDate ?? null,
          method: null,
          paidAt: ab.paidAt ?? null,
          taskId: ab.taskId,
        });
      }

      // --- summary buckets ---
      const emptyBucket = () => ({ count: 0, total: 0 });
      const summary: PayablesSummary = {
        AWAITING_PAYMENT: emptyBucket(),
        OVERDUE: emptyBucket(),
        PARTIALLY_PAID: emptyBucket(),
        EXPECTED: emptyBucket(),
        PAID: emptyBucket(),
      };
      for (const row of rows) {
        const bucket = summary[row.paymentState];
        if (!bucket) continue;
        bucket.count += 1;
        bucket.total += row.amount;
      }

      return {
        success: true,
        message: 'Contas a pagar carregadas com sucesso.',
        data: { rows, summary },
      };
    } catch (error: any) {
      this.logger.error('Erro ao carregar contas a pagar:', error);
      throw new InternalServerErrorException(
        'Erro ao carregar contas a pagar. Por favor, tente novamente.',
      );
    }
  }

  /** Revert payment to AWAITING_PAYMENT (undo a settle); reopens installments. */
  async markAwaitingPayment(orderId: string, userId?: string): Promise<OrderUpdateResponse> {
    return this.changePaymentStatus(
      orderId,
      ORDER_PAYMENT_STATUS.AWAITING_PAYMENT,
      'Pagamento do pedido revertido para aguardando pagamento.',
      userId,
    );
  }

  /** AWAITING_PAYMENT|PARTIALLY_PAID → PAID (stamps paidAt + paidById, settles installments). */
  async markPaid(orderId: string, userId?: string): Promise<OrderUpdateResponse> {
    return this.changePaymentStatus(
      orderId,
      ORDER_PAYMENT_STATUS.PAID,
      'Pedido marcado como pago.',
      userId,
    );
  }

  async batchMarkAwaitingPayment(
    orderIds: string[],
    userId?: string,
  ): Promise<OrderBatchUpdateResponse<{ id: string }>> {
    return this.batchChangePaymentStatus(
      orderIds,
      ORDER_PAYMENT_STATUS.AWAITING_PAYMENT,
      { singular: 'revertido para aguardando pagamento', plural: 'revertidos para aguardando pagamento' },
      userId,
    );
  }

  async batchMarkPaid(
    orderIds: string[],
    userId?: string,
  ): Promise<OrderBatchUpdateResponse<{ id: string }>> {
    return this.batchChangePaymentStatus(
      orderIds,
      ORDER_PAYMENT_STATUS.PAID,
      { singular: 'marcado como pago', plural: 'marcados como pagos' },
      userId,
    );
  }

  // =====================
  // Payment installments (boleto 2x/3x)
  // =====================

  /**
   * Recompute an order's payment rollup from its installments:
   * all PAID → PAID; any settled/partial → PARTIALLY_PAID; none → AWAITING_PAYMENT.
   * No-op for orders without installments (single-payment PIX / cartão).
   */
  private async recomputeOrderPaymentRollup(
    tx: PrismaTransaction,
    orderId: string,
  ): Promise<void> {
    const installments = await tx.orderInstallment.findMany({
      where: { orderId },
      select: { status: true, paidAmount: true, paidAt: true },
    });
    if (installments.length === 0) return;

    const allPaid = installments.every(i => i.status === ORDER_INSTALLMENT_STATUS.PAID);
    const anySettled = installments.some(
      i => i.status === ORDER_INSTALLMENT_STATUS.PAID || (i.paidAmount || 0) > 0,
    );
    const target = allPaid
      ? ORDER_PAYMENT_STATUS.PAID
      : anySettled
        ? ORDER_PAYMENT_STATUS.PARTIALLY_PAID
        : ORDER_PAYMENT_STATUS.AWAITING_PAYMENT;

    const lastPaidAt = installments
      .map(i => i.paidAt)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: target as any,
        paymentStatusOrder: ORDER_PAYMENT_STATUS_ORDER[target] ?? 1,
        paidAt: target === ORDER_PAYMENT_STATUS.PAID ? lastPaidAt ?? new Date() : null,
      },
    });
  }

  /**
   * Flip past-due, still-open boleto parcelas to OVERDUE (run daily by the cron).
   * Only PENDING parcelas are flipped — PARTIALLY_PAID keeps its richer state, and PAID
   * is untouched. OVERDUE is treated as "open" by every downstream path (payables show
   * it, reconciliation/markPaid can still settle it, the rollup never counts it as paid),
   * so the flip is safe and purely informational/filterable. Cancelled orders excluded.
   */
  async markOverdueInstallments(asOf?: Date): Promise<number> {
    const now = asOf ?? new Date();
    const res = await this.prisma.orderInstallment.updateMany({
      where: {
        dueDate: { not: null, lt: now },
        status: ORDER_INSTALLMENT_STATUS.PENDING,
        order: { status: { not: ORDER_STATUS.CANCELLED } },
      },
      data: { status: ORDER_INSTALLMENT_STATUS.OVERDUE },
    });
    return res.count;
  }

  /** Mark a single installment paid (manual) and roll up the parent order. */
  async markInstallmentPaid(installmentId: string, userId?: string): Promise<OrderUpdateResponse> {
    try {
      const order = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const inst = await tx.orderInstallment.findUnique({
          where: { id: installmentId },
          select: { id: true, orderId: true, amount: true },
        });
        if (!inst) throw new NotFoundException('Parcela não encontrada.');
        // Manual settle: mark PAID without stamping paidAmount. A non-zero paidAmount is
        // reserved for REAL (reconciled) payments — the order-level "Desfazer pagamento"
        // reopen preserves those but reverts manual settles (paidAmount 0) to PENDING.
        // Stamping the full amount here made manual marks look reconciled, so Desfazer
        // could never revert a per-parcela settle. The rollup keys off status, not amount.
        await tx.orderInstallment.update({
          where: { id: installmentId },
          data: {
            status: ORDER_INSTALLMENT_STATUS.PAID,
            paidAt: new Date(),
            paidById: userId ?? null,
          },
        });
        await this.recomputeOrderPaymentRollup(tx, inst.orderId);
        return tx.order.findUnique({ where: { id: inst.orderId } });
      });
      return {
        success: true,
        message: 'Parcela marcada como paga.',
        data: order as unknown as Order,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error('Erro ao marcar parcela como paga:', error);
      throw new InternalServerErrorException(
        'Erro ao marcar parcela como paga. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Generate a payment-installment schedule for an order, based on its method/count.
   * PIX / CREDIT_CARD (or count <= 1) → no installment rows (settled at order level).
   * BANK_SLIP with N > 1 → N parcelas. The 1st parcela is due on `firstDueDate`
   * (the user-picked "primeiro vencimento"); when absent it falls back to
   * `from + intervalDays` (legacy behaviour). Each subsequent parcela is spaced by
   * `intervalDays` (the chosen "intervalo entre parcelas", defaults to 30).
   * Amounts split evenly with the last absorbing the rounding remainder. Idempotent:
   * clears any prior schedule first.
   */
  async generateInstallmentsForOrder(
    tx: PrismaTransaction,
    orderId: string,
    opts: {
      total: number;
      count: number;
      intervalDays?: number | null;
      firstDueDate?: Date | null;
      from?: Date;
    },
  ): Promise<void> {
    const count = Math.max(1, Math.floor(opts.count || 1));
    await tx.orderInstallment.deleteMany({ where: { orderId } });
    if (count <= 1) return;

    const interval = opts.intervalDays && opts.intervalDays > 0 ? opts.intervalDays : 30;
    const base = opts.from ?? new Date();
    // Anchor of the 1st parcela: the user-chosen first due date, or (legacy) base + interval.
    const firstDue = opts.firstDueDate
      ? new Date(opts.firstDueDate)
      : (() => {
          const d = new Date(base);
          d.setDate(d.getDate() + interval);
          return d;
        })();
    const cents = Math.max(0, Math.round((opts.total || 0) * 100));
    const per = Math.floor(cents / count);
    const rows: Array<{
      orderId: string;
      number: number;
      amount: number;
      dueDate: Date;
      status: any;
    }> = [];
    for (let n = 1; n <= count; n++) {
      const amountCents = n === count ? cents - per * (count - 1) : per;
      const due = new Date(firstDue);
      due.setDate(due.getDate() + interval * (n - 1));
      rows.push({
        orderId,
        number: n,
        amount: amountCents / 100,
        dueDate: due,
        status: ORDER_INSTALLMENT_STATUS.PENDING,
      });
    }
    await tx.orderInstallment.createMany({ data: rows });
  }

  /** Link (replace) the fiscal documents (NFe) associated with an order, enabling
   *  boleto installments to auto-settle when those NFs are reconciled. */
  async linkFiscalDocuments(
    orderId: string,
    fiscalDocumentIds: string[],
  ): Promise<OrderUpdateResponse> {
    try {
      const order = await this.prisma.order.update({
        where: { id: orderId },
        data: { fiscalDocuments: { set: (fiscalDocumentIds || []).map(id => ({ id })) } },
      });
      return {
        success: true,
        message: 'Documentos fiscais vinculados ao pedido.',
        data: order as unknown as Order,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao vincular documentos fiscais ao pedido:', error);
      throw new InternalServerErrorException(
        'Erro ao vincular documentos fiscais. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Settle a boleto order's installments when one of its fiscal documents is
   * reconciled against a bank transaction. Applies `allocatedAmount` across the
   * order's open installments oldest-first (full or partial) and rolls up the
   * order's payment status. Safe no-op when no boleto order is linked to the NF.
   * Meant to be called post-commit; callers should wrap it in try/catch so a
   * settle failure never breaks reconciliation.
   */
  async settleInstallmentsForFiscalDocument(
    fiscalDocumentId: string,
    allocatedAmount: number,
    userId?: string,
  ): Promise<void> {
    const amount = Math.abs(Number(allocatedAmount) || 0);
    if (amount <= 0) return;

    const orders = await this.prisma.order.findMany({
      where: {
        paymentMethod: 'BANK_SLIP',
        fiscalDocuments: { some: { id: fiscalDocumentId } },
        installments: { some: { status: { not: ORDER_INSTALLMENT_STATUS.PAID } } },
      },
      select: { id: true },
    });

    for (const o of orders) {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        let remaining = amount;
        const open = await tx.orderInstallment.findMany({
          where: { orderId: o.id, status: { not: ORDER_INSTALLMENT_STATUS.PAID } },
          orderBy: { number: 'asc' },
          select: { id: true, amount: true, paidAmount: true },
        });
        const now = new Date();
        for (const inst of open) {
          if (remaining <= 0.005) break;
          const due = Math.max(0, inst.amount - (inst.paidAmount || 0));
          const applied = Math.min(due, remaining);
          if (applied <= 0) continue;
          remaining -= applied;
          const newPaid = (inst.paidAmount || 0) + applied;
          const fullyPaid = newPaid >= inst.amount - 0.005;
          await tx.orderInstallment.update({
            where: { id: inst.id },
            data: {
              paidAmount: newPaid,
              status: fullyPaid
                ? ORDER_INSTALLMENT_STATUS.PAID
                : ORDER_INSTALLMENT_STATUS.PARTIALLY_PAID,
              paidAt: fullyPaid ? now : null,
              paidById: fullyPaid ? userId ?? null : null,
            },
          });
        }
        await this.recomputeOrderPaymentRollup(tx, o.id);
      });
    }
  }
}
