// repositories/order-item-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { OrderItem } from '../../../../../types';
import {
  OrderItemCreateFormData,
  OrderItemUpdateFormData,
  OrderItemInclude,
  OrderItemWhere,
  OrderItemOrderBy,
} from '../../../../../schemas/order';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { OrderItemRepository } from './order-item.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrderItemPrismaRepository
  extends BaseStringPrismaRepository<
    OrderItem,
    OrderItemCreateFormData,
    OrderItemUpdateFormData,
    OrderItemInclude,
    OrderItemOrderBy,
    OrderItemWhere,
    any,
    Prisma.OrderItemCreateInput,
    Prisma.OrderItemUpdateInput,
    Prisma.OrderItemInclude,
    Prisma.OrderItemOrderByWithRelationInput[] | Prisma.OrderItemOrderByWithRelationInput,
    Prisma.OrderItemWhereInput
  >
  implements OrderItemRepository
{
  protected readonly logger = new Logger(OrderItemPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // =====================
  // REQUIRED MAPPING METHODS FROM BASE CLASS
  // =====================

  protected mapDatabaseEntityToEntity(databaseEntity: any): OrderItem {
    const result: OrderItem = {
      id: databaseEntity.id,
      orderId: databaseEntity.orderId,
      itemId: databaseEntity.itemId,
      temporaryItemDescription: databaseEntity.temporaryItemDescription,
      orderedQuantity: databaseEntity.orderedQuantity,
      receivedQuantity: databaseEntity.receivedQuantity,
      price: databaseEntity.price,
      icms: databaseEntity.icms,
      ipi: databaseEntity.ipi,
      receivedAt: databaseEntity.receivedAt,
      fulfilledAt: databaseEntity.fulfilledAt,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
    };

    // Handle optional relations
    if (
      databaseEntity.item &&
      typeof databaseEntity.item === 'object' &&
      !Array.isArray(databaseEntity.item)
    ) {
      result.item = databaseEntity.item as any;
    }

    if (
      databaseEntity.order &&
      typeof databaseEntity.order === 'object' &&
      !Array.isArray(databaseEntity.order)
    ) {
      result.order = databaseEntity.order as any;
    }

    if (databaseEntity.activities && Array.isArray(databaseEntity.activities)) {
      result.activities = databaseEntity.activities as any;
    }

    return result;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: OrderItemCreateFormData,
  ): Prisma.OrderItemCreateInput {
    const createInput: Prisma.OrderItemCreateInput = {
      orderedQuantity: formData.orderedQuantity,
      receivedQuantity: 0,
      price: formData.price,
      icms: formData.icms,
      ipi: formData.ipi,
      order: { connect: { id: formData.orderId } },
    };

    // Connect to inventory item if itemId is provided (inventory item)
    if (formData.itemId) {
      createInput.item = { connect: { id: formData.itemId } };
    }

    // Set temporary item description if provided (temporary item)
    if (formData.temporaryItemDescription) {
      createInput.temporaryItemDescription = formData.temporaryItemDescription;
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: OrderItemUpdateFormData,
  ): Prisma.OrderItemUpdateInput {
    const updateData = { ...formData };

    // Auto-set fulfilledAt when receivedQuantity > 0 and fulfilledAt is not already set
    // (Items must be fulfilled before they can be received)
    if (
      updateData.receivedQuantity !== undefined &&
      updateData.receivedQuantity > 0 &&
      !updateData.fulfilledAt
    ) {
      updateData.fulfilledAt = new Date();
    }

    // Auto-set receivedAt when receivedQuantity > 0 and receivedAt is not already set
    if (
      updateData.receivedQuantity !== undefined &&
      updateData.receivedQuantity > 0 &&
      !updateData.receivedAt
    ) {
      updateData.receivedAt = new Date();
    }

    // Clear receivedAt when receivedQuantity becomes 0
    if (updateData.receivedQuantity === 0) {
      updateData.receivedAt = undefined;
    }

    return updateData;
  }

  protected mapIncludeToDatabaseInclude(
    include?: OrderItemInclude,
  ): Prisma.OrderItemInclude | undefined {
    if (!include) {
      return this.getDefaultInclude();
    }

    const databaseInclude: Prisma.OrderItemInclude = {};

    Object.keys(include).forEach(key => {
      const value = include[key as keyof OrderItemInclude];

      if (typeof value === 'boolean') {
        databaseInclude[key as keyof Prisma.OrderItemInclude] = value;
      } else if (typeof value === 'object' && value !== null && 'include' in value) {
        databaseInclude[key as keyof Prisma.OrderItemInclude] = { include: value.include };
      }
    });

    return databaseInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: OrderItemOrderBy,
  ):
    | Prisma.OrderItemOrderByWithRelationInput[]
    | Prisma.OrderItemOrderByWithRelationInput
    | undefined {
    if (!orderBy) return [{ createdAt: 'desc' }];

    // Convert OrderItemOrderBy to Prisma OrderByWithRelationInput
    const mappedOrderBy = orderBy as any as Prisma.OrderItemOrderByWithRelationInput;
    return Array.isArray(mappedOrderBy) ? mappedOrderBy : mappedOrderBy;
  }

  protected mapWhereToDatabaseWhere(
    where?: OrderItemWhere,
  ): Prisma.OrderItemWhereInput | undefined {
    return where as Prisma.OrderItemWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.OrderItemInclude | undefined {
    return {
      item: { select: { id: true, name: true, uniCode: true } },
      order: { select: { id: true, description: true, status: true } },
    };
  }

  // =====================
  // Override required transaction methods from base class
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: OrderItemCreateFormData,
    options?: CreateOptions<OrderItemInclude>,
  ): Promise<OrderItem> {
    try {
      const createData = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.orderItem.create({
        data: createData,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar item de pedido', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: OrderItemUpdateFormData,
    options?: UpdateOptions<OrderItemInclude>,
  ): Promise<OrderItem> {
    try {
      const updateData = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.orderItem.update({
        where: { id },
        data: updateData,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar item de pedido ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<OrderItem> {
    try {
      const result = await transaction.orderItem.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar item de pedido ${id}`, error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<OrderItemInclude>,
  ): Promise<OrderItem | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.orderItem.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item de pedido por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<OrderItemInclude>,
  ): Promise<OrderItem[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.orderItem.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens de pedido por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<OrderItemOrderBy, OrderItemWhere, OrderItemInclude>,
  ): Promise<FindManyResult<OrderItem>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, orderItems] = await Promise.all([
      transaction.orderItem.count({ where: this.mapWhereToDatabaseWhere(where) }),
      transaction.orderItem.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy),
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: orderItems.map((item: any) => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: OrderItemWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.orderItem.count({ where: whereInput });
    } catch (error) {
      this.logError('contar itens de pedido', error, { where });
      throw error;
    }
  }
}
