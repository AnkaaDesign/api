// repositories/order-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Order } from '../../../../../types';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';
import {
  OrderCreateFormData,
  OrderUpdateFormData,
  OrderInclude,
  OrderWhere,
  OrderOrderBy,
} from '../../../../../schemas/order';
import { OrderRepository } from './order.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ORDER_STATUS, ORDER_PAYMENT_STATUS, PAYMENT_METHOD } from '../../../../../constants/enums';
import { Prisma, Order as PrismaOrder } from '@prisma/client';
import { getOrderStatusOrder, mapOrderStatusToPrisma, mapWhereClause } from '../../../../../utils';

// Removed OrderIncludeProfile - using direct include parameters instead

// Default include for order repository
const DEFAULT_ORDER_INCLUDE: Prisma.OrderInclude = {
  receipts: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  supplier: { select: { id: true, fantasyName: true, cnpj: true } },
  paymentResponsible: { select: { id: true, name: true, email: true } },
  paymentAssignedBy: { select: { id: true, name: true, email: true } },
  orderSchedule: true,
  ppeSchedule: true,
  items: {
    include: {
      item: { select: { id: true, name: true, uniCode: true } },
    },
  },
  activities: true,
  _count: {
    select: {
      items: true,
      activities: true,
    },
  },
};

@Injectable()
export class OrderPrismaRepository
  extends BaseStringPrismaRepository<
    Order,
    OrderCreateFormData,
    OrderUpdateFormData,
    OrderInclude,
    OrderOrderBy,
    OrderWhere,
    PrismaOrder,
    Prisma.OrderCreateInput,
    Prisma.OrderUpdateInput,
    Prisma.OrderInclude,
    Prisma.OrderOrderByWithRelationInput,
    Prisma.OrderWhereInput
  >
  implements OrderRepository
{
  protected readonly logger = new Logger(OrderPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // =====================
  // REQUIRED MAPPING METHODS FROM BASE CLASS
  // =====================

  protected mapDatabaseEntityToEntity(
    databaseEntity: PrismaOrder & Record<string, unknown>,
  ): Order {
    return this.mapDatabaseOrderToOrder(databaseEntity);
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: OrderCreateFormData,
  ): Prisma.OrderCreateInput {
    const { items, ...orderData } = formData;

    // Validate required fields
    if (!orderData.description) {
      throw new Error('Description is required for creating an order');
    }

    const status = orderData.status || ORDER_STATUS.CREATED;
    // Installments (and the boleto due-date scalars) only apply to BANK_SLIP. For any
    // other method, normalize to a single non-scheduled payment so non-boleto orders
    // never carry a phantom parcela plan.
    const isBoleto = orderData.paymentMethod === PAYMENT_METHOD.BANK_SLIP;
    const createData: Prisma.OrderCreateInput = {
      description: orderData.description,
      status: mapOrderStatusToPrisma(status),
      statusOrder: getOrderStatusOrder(status),
      forecast: orderData.forecast || null,
      notes: orderData.notes || null,
      freight: orderData.freight ?? 0,
      discount: orderData.discount ?? 0,
      // Manual grand-total override (Valor Total); null = use the computed total.
      totalOverride: (orderData as any).totalOverride ?? null,
      orderRuleId: orderData.orderRuleId || null,
      paymentMethod: (orderData.paymentMethod as any) || null,
      paymentPix: orderData.paymentPix || null,
      paymentDueDays: isBoleto ? orderData.paymentDueDays || null : null,
      paymentFirstDueDate: isBoleto ? (orderData as any).paymentFirstDueDate || null : null,
      // Persist the chosen installment count so boleto orders keep their parcela
      // schedule across later edits (the update path reads this back to decide
      // whether to regenerate parcelas — a missing value wrongly wiped them).
      // Non-boleto methods are forced to a single payment.
      installmentCount: isBoleto ? (orderData as any).installmentCount ?? 1 : 1,
      // Payment obligation is set up automatically at creation: every new order is
      // immediately payable in Contas a Pagar (AWAITING_PAYMENT), with no manual
      // "solicitar pagamento" step. Set explicitly rather than relying on the DB default.
      paymentStatus: ORDER_PAYMENT_STATUS.AWAITING_PAYMENT as any,
      paymentStatusOrder: 1,
    };

    // Handle optional relations using connect syntax
    if (orderData.supplierId) {
      createData.supplier = { connect: { id: orderData.supplierId } };
    }
    if ((orderData as any).paymentResponsibleId) {
      createData.paymentResponsible = { connect: { id: (orderData as any).paymentResponsibleId } };
    }
    if ((orderData as any).paymentAssignedById) {
      createData.paymentAssignedBy = { connect: { id: (orderData as any).paymentAssignedById } };
    }
    if (orderData.orderScheduleId) {
      createData.orderSchedule = { connect: { id: orderData.orderScheduleId } };
    }
    if (orderData.ppeScheduleId) {
      createData.ppeSchedule = { connect: { id: orderData.ppeScheduleId } };
    }

    // Handle many-to-many file relations
    if (orderData.receiptIds && orderData.receiptIds.length > 0) {
      createData.receipts = { connect: orderData.receiptIds.map(id => ({ id })) };
    }

    // Handle nested items creation
    if (items && items.length > 0) {
      createData.items = {
        create: items.map((item: any) => {
          const itemData: any = {
            orderedQuantity: item.orderedQuantity,
            receivedQuantity: 0,
            price: item.price,
            icms: item.icms || 0,
            ipi: item.ipi || 0,
          };

          // Connect to inventory item if itemId is provided (inventory item)
          if (item.itemId) {
            itemData.item = { connect: { id: item.itemId } };
          }

          // Set temporary item description if provided (temporary item)
          if (item.temporaryItemDescription) {
            itemData.temporaryItemDescription = item.temporaryItemDescription;
          }

          return itemData;
        }),
      };
    }

    return createData;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: OrderUpdateFormData,
  ): Prisma.OrderUpdateInput {
    const updateData: Prisma.OrderUpdateInput = {};

    // Map direct fields
    if (formData.description !== undefined) updateData.description = formData.description;
    if (formData.status !== undefined) {
      updateData.status = mapOrderStatusToPrisma(formData.status);
      updateData.statusOrder = getOrderStatusOrder(formData.status);
      // Order completion is now tracked at the item level via fulfilledAt
    }
    if (formData.forecast !== undefined) updateData.forecast = formData.forecast;
    if (formData.notes !== undefined) updateData.notes = formData.notes;
    if ((formData as any).freight !== undefined) updateData.freight = (formData as any).freight;
    if ((formData as any).discount !== undefined) updateData.discount = (formData as any).discount;
    // Manual grand-total override (Valor Total); null clears it / falls back to computed.
    if ((formData as any).totalOverride !== undefined)
      updateData.totalOverride = (formData as any).totalOverride;
    if (formData.orderRuleId !== undefined) updateData.orderRuleId = formData.orderRuleId;
    if (formData.paymentMethod !== undefined)
      updateData.paymentMethod = formData.paymentMethod as any;
    if (formData.paymentPix !== undefined) updateData.paymentPix = formData.paymentPix;
    if (formData.paymentDueDays !== undefined) updateData.paymentDueDays = formData.paymentDueDays;
    if ((formData as any).paymentFirstDueDate !== undefined)
      updateData.paymentFirstDueDate = (formData as any).paymentFirstDueDate;
    if ((formData as any).installmentCount !== undefined)
      updateData.installmentCount = (formData as any).installmentCount;

    // Boleto scalars are only meaningful for BANK_SLIP. When the order's payment
    // method is being switched to a non-boleto method, scrub the stale schedule
    // scalars so the payables due-date column (paymentFirstDueDate ?? forecast) and
    // installment count don't keep reflecting a boleto plan that no longer exists.
    if (formData.paymentMethod !== undefined && formData.paymentMethod !== PAYMENT_METHOD.BANK_SLIP) {
      updateData.paymentFirstDueDate = null;
      updateData.paymentDueDays = null;
      updateData.installmentCount = 1;
    }

    // Handle payment responsible relation
    if ((formData as any).paymentResponsibleId !== undefined) {
      updateData.paymentResponsible = (formData as any).paymentResponsibleId
        ? { connect: { id: (formData as any).paymentResponsibleId } }
        : { disconnect: true };
    }
    if ((formData as any).paymentAssignedById !== undefined) {
      updateData.paymentAssignedBy = (formData as any).paymentAssignedById
        ? { connect: { id: (formData as any).paymentAssignedById } }
        : { disconnect: true };
    }

    // Handle optional relations with connect/disconnect
    if (formData.supplierId !== undefined) {
      updateData.supplier = formData.supplierId
        ? { connect: { id: formData.supplierId } }
        : { disconnect: true };
    }
    if (formData.orderScheduleId !== undefined) {
      updateData.orderSchedule = formData.orderScheduleId
        ? { connect: { id: formData.orderScheduleId } }
        : { disconnect: true };
    }

    // Handle many-to-many file relations with set operation
    if (formData.receiptIds !== undefined) {
      updateData.receipts = { set: formData.receiptIds.map(id => ({ id })) };
    }
    if (formData.ppeScheduleId !== undefined) {
      updateData.ppeSchedule = formData.ppeScheduleId
        ? { connect: { id: formData.ppeScheduleId } }
        : { disconnect: true };
    }

    return updateData;
  }

  protected mapIncludeToDatabaseInclude(include?: OrderInclude): Prisma.OrderInclude | undefined {
    return include as Prisma.OrderInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: OrderOrderBy): any {
    if (!orderBy) return undefined;

    // Convert the orderBy to match the expected Prisma format
    // Prisma's findMany can accept either a single object or an array
    if (Array.isArray(orderBy)) {
      // If it's already an array, return as-is
      return orderBy;
    }

    // If it's a single object with multiple fields, convert to array format
    // This handles the case where orderBy is { statusOrder: "asc", createdAt: "desc" }
    const orderByArray: any[] = [];

    if (typeof orderBy === 'object' && orderBy !== null) {
      // Convert each property to a separate orderBy object
      Object.entries(orderBy).forEach(([key, value]) => {
        if (value !== undefined) {
          orderByArray.push({ [key]: value });
        }
      });
    }

    return orderByArray.length > 0 ? orderByArray : undefined;
  }

  protected mapWhereToDatabaseWhere(where?: OrderWhere): Prisma.OrderWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.OrderWhereInput;
  }

  protected getDefaultInclude(): Prisma.OrderInclude {
    return DEFAULT_ORDER_INCLUDE;
  }

  // =====================
  // Override required transaction methods from base class
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: OrderCreateFormData,
    options?: CreateOptions<OrderInclude>,
  ): Promise<Order> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      // Derive the forecast (expected delivery) from the average lead time of the
      // order's inventory items when no explicit forecast was provided. Applies to
      // every create path (manual, batch, schedule) since they all funnel here.
      // forecast = today + round(avg(Item.estimatedLeadTime in days)). Temporary
      // items (no itemId) carry no lead time and are ignored.
      if (createInput.forecast == null) {
        const computedForecast = await this.computeLeadTimeForecast(transaction, (data as any).items);
        if (computedForecast) {
          createInput.forecast = computedForecast;
        }
      }

      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.order.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logger.error('criar pedido', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: OrderUpdateFormData,
    options?: UpdateOptions<OrderInclude>,
  ): Promise<Order> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.order.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logger.error(`atualizar pedido ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Order> {
    try {
      const result = await transaction.order.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logger.error(`deletar pedido ${id}`, error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<OrderInclude>,
  ): Promise<Order | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.order.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logger.error(`buscar pedido por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<OrderInclude>,
  ): Promise<Order[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.order.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(order => this.mapDatabaseEntityToEntity(order));
    } catch (error) {
      this.logger.error('buscar pedidos por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<OrderOrderBy, OrderWhere, OrderInclude>,
  ): Promise<FindManyResult<Order>> {
    try {
      // Map 'limit' to 'take' for compatibility with schema

      const optionsWithTake = options
        ? { ...options, take: (options as any).limit || options.take }
        : {};

      const {
        where,
        orderBy,
        page = 1,
        take = 20,
        include,
      } = optionsWithTake as {
        where?: OrderWhere;
        orderBy?: OrderOrderBy;
        page?: number;
        take?: number;
        include?: OrderInclude;
      };
      const skip = Math.max(0, (page - 1) * take);

      const [total, orders] = await Promise.all([
        transaction.order.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.order.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [{ createdAt: 'desc' }],
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: orders.map(order => this.mapDatabaseEntityToEntity(order)),
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages: Math.ceil(total / take),
          hasNextPage: skip + take < total,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      this.logger.error('buscar múltiplos pedidos', error, { options });
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: OrderWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.order.count({ where: whereInput });
    } catch (error) {
      this.logger.error('contar pedidos', error, { where });
      throw error;
    }
  }

  // =====================
  // Private helper methods
  // =====================

  /**
   * Compute an order's forecast (expected delivery date) from the average lead time
   * of its inventory items: today + round(avg(Item.estimatedLeadTime)) days. Items
   * without an itemId (temporary items) are ignored. Returns null when there are no
   * inventory items to derive a lead time from.
   */
  private async computeLeadTimeForecast(
    transaction: PrismaTransaction,
    items?: Array<{ itemId?: string | null }>,
  ): Promise<Date | null> {
    if (!Array.isArray(items) || items.length === 0) return null;

    const itemIds = items.map(i => i?.itemId).filter((id): id is string => !!id);
    if (itemIds.length === 0) return null;

    const inventoryItems = await transaction.item.findMany({
      where: { id: { in: itemIds } },
      select: { estimatedLeadTime: true },
    });
    if (inventoryItems.length === 0) return null;

    // estimatedLeadTime defaults to 30 in the schema; treat nulls as 30 too.
    const leadTimes = inventoryItems.map(it => it.estimatedLeadTime ?? 30);
    const avgDays = Math.round(leadTimes.reduce((sum, n) => sum + n, 0) / leadTimes.length);

    const forecast = new Date();
    forecast.setDate(forecast.getDate() + avgDays);
    return forecast;
  }

  private mapDatabaseOrderToOrder(databaseOrder: PrismaOrder & Record<string, unknown>): Order {
    return {
      id: databaseOrder.id,
      orderNumber: (databaseOrder as any).orderNumber ?? null,
      description: databaseOrder.description,
      forecast: databaseOrder.forecast,
      status: databaseOrder.status as ORDER_STATUS,
      statusOrder: databaseOrder.statusOrder,
      receiptIds: (databaseOrder.receipts as any)?.map((receipt: any) => receipt.id),
      supplierId: databaseOrder.supplierId,
      orderScheduleId: databaseOrder.orderScheduleId,
      orderRuleId: databaseOrder.orderRuleId,
      ppeScheduleId: databaseOrder.ppeScheduleId,
      notes: databaseOrder.notes,
      freight: (databaseOrder as any).freight ?? 0,
      discount: (databaseOrder as any).discount ?? 0,
      totalOverride: (databaseOrder as any).totalOverride ?? null,
      paymentMethod: databaseOrder.paymentMethod as any,
      paymentPix: databaseOrder.paymentPix as any,
      paymentDueDays: databaseOrder.paymentDueDays as any,
      paymentFirstDueDate: (databaseOrder as any).paymentFirstDueDate as any,
      receipts: databaseOrder.receipts as any,
      supplier: databaseOrder.supplier as any,
      orderSchedule: databaseOrder.orderSchedule as any,
      ppeSchedule: databaseOrder.ppeSchedule as any,
      items:
        Array.isArray(databaseOrder.items) && databaseOrder.items.length > 0
          ? ((databaseOrder.items as any[]).map((item: any) =>
              this.mapDatabaseOrderItemToOrderItem(item),
            ) as any)
          : [],
      activities: databaseOrder.activities as any,
      _count: databaseOrder._count as any,
      createdAt: databaseOrder.createdAt,
      updatedAt: databaseOrder.updatedAt,
      paymentResponsibleId: databaseOrder.paymentResponsibleId as any,
      paymentAssignedById: databaseOrder.paymentAssignedById as any,
      paidById: (databaseOrder as any).paidById ?? null,
      installmentCount: (databaseOrder as any).installmentCount ?? 1,
      paymentResponsible: databaseOrder.paymentResponsible as any,
      paymentAssignedBy: databaseOrder.paymentAssignedBy as any,
      paidBy: (databaseOrder as any).paidBy as any,
      installments: (databaseOrder as any).installments as any,
      paymentStatus: (databaseOrder as any).paymentStatus,
      paymentStatusOrder: (databaseOrder as any).paymentStatusOrder ?? 1,
      paidAt: (databaseOrder as any).paidAt ?? null,
    };
  }

  private mapDatabaseOrderItemToOrderItem(
    databaseOrderItem: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      id: databaseOrderItem.id,
      orderId: databaseOrderItem.orderId,
      itemId: databaseOrderItem.itemId,
      temporaryItemDescription: databaseOrderItem.temporaryItemDescription,
      orderedQuantity: databaseOrderItem.orderedQuantity,
      receivedQuantity: databaseOrderItem.receivedQuantity,
      price: databaseOrderItem.price,
      icms: databaseOrderItem.icms,
      ipi: databaseOrderItem.ipi,
      receivedAt: databaseOrderItem.receivedAt,
      fulfilledAt: databaseOrderItem.fulfilledAt,
      item: databaseOrderItem.item,
      order: databaseOrderItem.order,
      activities: databaseOrderItem.activities,
      createdAt: databaseOrderItem.createdAt,
      updatedAt: databaseOrderItem.updatedAt,
    };
  }
}
