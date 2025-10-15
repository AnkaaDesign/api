// repositories/order-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Order } from '../../../../../types';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
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
import { ORDER_STATUS } from '../../../../../constants/enums';
import { Prisma, Order as PrismaOrder } from '@prisma/client';
import { getOrderStatusOrder, mapOrderStatusToPrisma, mapWhereClause } from '../../../../../utils';

// Removed OrderIncludeProfile - using direct include parameters instead

// Default include for order repository
const DEFAULT_ORDER_INCLUDE: Prisma.OrderInclude = {
  budgets: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  invoices: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
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
  reimbursements: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  invoiceReimbursements: {
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
    const createData: Prisma.OrderCreateInput = {
      description: orderData.description,
      status: mapOrderStatusToPrisma(status),
      statusOrder: getOrderStatusOrder(status),
      forecast: orderData.forecast || null,
      notes: orderData.notes || null,
      orderRuleId: orderData.orderRuleId || null,
    };

    // Handle optional relations using connect syntax
    if (orderData.supplierId) {
      createData.supplier = { connect: { id: orderData.supplierId } };
    }
    if (orderData.orderScheduleId) {
      createData.orderSchedule = { connect: { id: orderData.orderScheduleId } };
    }
    if (orderData.ppeScheduleId) {
      createData.ppeSchedule = { connect: { id: orderData.ppeScheduleId } };
    }

    // Handle many-to-many file relations
    if (orderData.budgetIds && orderData.budgetIds.length > 0) {
      createData.budgets = { connect: orderData.budgetIds.map(id => ({ id })) };
    }
    if (orderData.invoiceIds && orderData.invoiceIds.length > 0) {
      createData.invoices = { connect: orderData.invoiceIds.map(id => ({ id })) };
    }
    if (orderData.receiptIds && orderData.receiptIds.length > 0) {
      createData.receipts = { connect: orderData.receiptIds.map(id => ({ id })) };
    }
    if (orderData.reimbursementIds && orderData.reimbursementIds.length > 0) {
      createData.reimbursements = { connect: orderData.reimbursementIds.map(id => ({ id })) };
    }
    if (orderData.reimbursementInvoiceIds && orderData.reimbursementInvoiceIds.length > 0) {
      createData.invoiceReimbursements = { connect: orderData.reimbursementInvoiceIds.map(id => ({ id })) };
    }

    // Handle nested items creation
    if (items && items.length > 0) {
      createData.items = {
        create: items.map(item => ({
          orderedQuantity: item.orderedQuantity,
          receivedQuantity: 0,
          price: item.price,
          tax: item.tax || 0,
          item: { connect: { id: item.itemId } },
        })),
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
    if (formData.orderRuleId !== undefined) updateData.orderRuleId = formData.orderRuleId;

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
    if (formData.budgetIds !== undefined) {
      updateData.budgets = { set: formData.budgetIds.map(id => ({ id })) };
    }
    if (formData.invoiceIds !== undefined) {
      updateData.invoices = { set: formData.invoiceIds.map(id => ({ id })) };
    }
    if (formData.receiptIds !== undefined) {
      updateData.receipts = { set: formData.receiptIds.map(id => ({ id })) };
    }
    if (formData.reimbursementIds !== undefined) {
      updateData.reimbursements = { set: formData.reimbursementIds.map(id => ({ id })) };
    }
    if (formData.reimbursementInvoiceIds !== undefined) {
      updateData.invoiceReimbursements = { set: formData.reimbursementInvoiceIds.map(id => ({ id })) };
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

  private mapDatabaseOrderToOrder(databaseOrder: PrismaOrder & Record<string, unknown>): Order {
    return {
      id: databaseOrder.id,
      description: databaseOrder.description,
      forecast: databaseOrder.forecast,
      status: databaseOrder.status as ORDER_STATUS,
      statusOrder: databaseOrder.statusOrder,
      budgetIds: (databaseOrder.budgets as any)?.map((budget: any) => budget.id),
      invoiceIds: (databaseOrder.invoices as any)?.map((invoice: any) => invoice.id),
      receiptIds: (databaseOrder.receipts as any)?.map((receipt: any) => receipt.id),
      reimbursementIds: (databaseOrder.reimbursements as any)?.map((reimbursement: any) => reimbursement.id),
      reimbursementInvoiceIds: (databaseOrder.invoiceReimbursements as any)?.map((reimbursementInvoice: any) => reimbursementInvoice.id),
      supplierId: databaseOrder.supplierId,
      orderScheduleId: databaseOrder.orderScheduleId,
      orderRuleId: databaseOrder.orderRuleId,
      ppeScheduleId: databaseOrder.ppeScheduleId,
      notes: databaseOrder.notes,
      budgets: databaseOrder.budgets as any,
      invoices: databaseOrder.invoices as any,
      receipts: databaseOrder.receipts as any,
      reimbursements: databaseOrder.reimbursements as any,
      invoiceReimbursements: databaseOrder.invoiceReimbursements as any,
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
    };
  }

  private mapDatabaseOrderItemToOrderItem(
    databaseOrderItem: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      id: databaseOrderItem.id,
      orderId: databaseOrderItem.orderId,
      itemId: databaseOrderItem.itemId,
      orderedQuantity: databaseOrderItem.orderedQuantity,
      receivedQuantity: databaseOrderItem.receivedQuantity,
      price: databaseOrderItem.price,
      tax: databaseOrderItem.tax,
      receivedAt: databaseOrderItem.receivedAt,
      item: databaseOrderItem.item,
      order: databaseOrderItem.order,
      activities: databaseOrderItem.activities,
      createdAt: databaseOrderItem.createdAt,
      updatedAt: databaseOrderItem.updatedAt,
    };
  }
}
