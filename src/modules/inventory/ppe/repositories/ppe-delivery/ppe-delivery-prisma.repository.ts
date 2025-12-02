// repositories/ppe-delivery-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { PpeDelivery } from '../../../../../types';
import {
  PpeDeliveryCreateFormData,
  PpeDeliveryUpdateFormData,
  PpeDeliveryInclude,
  PpeDeliveryOrderBy,
  PpeDeliveryWhere,
} from '../../../../../schemas';
import {
  BatchCreateResult,
  BatchUpdateResult,
  CreateOptions,
  FindManyOptions,
  FindManyResult,
  UpdateOptions,
} from '../../../../../types';
import { PpeDeliveryRepository } from './ppe-delivery.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, PpeDeliveryStatus } from '@prisma/client';

@Injectable()
export class PpeDeliveryPrismaRepository
  extends BaseStringPrismaRepository<
    PpeDelivery,
    PpeDeliveryCreateFormData,
    PpeDeliveryUpdateFormData,
    PpeDeliveryInclude,
    PpeDeliveryOrderBy,
    PpeDeliveryWhere,
    Prisma.PpeDeliveryGetPayload<{ include: any }>,
    Prisma.PpeDeliveryCreateInput,
    Prisma.PpeDeliveryUpdateInput,
    Prisma.PpeDeliveryInclude,
    Prisma.PpeDeliveryOrderByWithRelationInput | Prisma.PpeDeliveryOrderByWithRelationInput[],
    Prisma.PpeDeliveryWhereInput
  >
  implements PpeDeliveryRepository
{
  protected readonly logger = new Logger(PpeDeliveryPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): PpeDelivery {
    return databaseEntity as PpeDelivery;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PpeDeliveryCreateFormData,
  ): Prisma.PpeDeliveryCreateInput {
    const { itemId, userId, reviewedBy, ppeScheduleId, status, quantity, ...rest } = formData;

    // Filter out internal fields (those starting with underscore)
    const filteredRest = Object.keys(rest).reduce((acc, key) => {
      if (!key.startsWith('_')) {
        acc[key] = rest[key];
      }
      return acc;
    }, {} as any);

    const createInput: Prisma.PpeDeliveryCreateInput = {
      ...filteredRest,
      status: status as PpeDeliveryStatus,
      quantity,
      item: { connect: { id: itemId } },
      user: { connect: { id: userId } },
    };

    if (reviewedBy) {
      (createInput as any).reviewedByUser = { connect: { id: reviewedBy } };
    }

    if (ppeScheduleId) {
      createInput.ppeSchedule = { connect: { id: ppeScheduleId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PpeDeliveryUpdateFormData,
  ): Prisma.PpeDeliveryUpdateInput {
    const { reviewedBy, status, quantity, ...rest } = formData;

    // Filter out internal fields (those starting with underscore)
    const filteredRest = Object.keys(rest).reduce((acc, key) => {
      if (!key.startsWith('_')) {
        acc[key] = rest[key];
      }
      return acc;
    }, {} as any);

    const updateInput: Prisma.PpeDeliveryUpdateInput = {
      ...filteredRest,
      ...(status !== undefined && { status: status as PpeDeliveryStatus }),
      ...(quantity !== undefined && { quantity }),
    };

    if (reviewedBy !== undefined) {
      (updateInput as any).reviewedByUser = reviewedBy
        ? { connect: { id: reviewedBy } }
        : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PpeDeliveryInclude,
  ): Prisma.PpeDeliveryInclude | undefined {
    return include as Prisma.PpeDeliveryInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PpeDeliveryOrderBy,
  ):
    | Prisma.PpeDeliveryOrderByWithRelationInput
    | Prisma.PpeDeliveryOrderByWithRelationInput[]
    | undefined {
    if (!orderBy) return undefined;

    // Prisma expects an array for orderBy
    if (Array.isArray(orderBy)) {
      return orderBy as Prisma.PpeDeliveryOrderByWithRelationInput[];
    }

    // If it's an object with multiple fields, convert to array format
    // e.g., { status: "asc", scheduledDate: "desc" } becomes [{ status: "asc" }, { scheduledDate: "desc" }]
    if (typeof orderBy === 'object' && orderBy !== null) {
      const orderByArray: Prisma.PpeDeliveryOrderByWithRelationInput[] = [];
      for (const [key, value] of Object.entries(orderBy)) {
        orderByArray.push({ [key]: value } as Prisma.PpeDeliveryOrderByWithRelationInput);
      }
      return orderByArray;
    }

    // Fallback: wrap single value in array
    return [orderBy as Prisma.PpeDeliveryOrderByWithRelationInput];
  }

  protected mapWhereToDatabaseWhere(
    where?: PpeDeliveryWhere,
  ): Prisma.PpeDeliveryWhereInput | undefined {
    return where as Prisma.PpeDeliveryWhereInput;
  }

  protected getDefaultInclude(): Prisma.PpeDeliveryInclude {
    return {
      item: true,
      user: {
        include: {
          position: true,
          sector: true,
        },
      },
      reviewedByUser: true,
      ppeSchedule: true,
    };
  }

  protected getDatabaseModel(tx?: PrismaTransaction) {
    return tx ? tx.ppeDelivery : this.prisma.ppeDelivery;
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PpeDeliveryCreateFormData,
    options?: CreateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery> {
    try {
      // Validate stock availability before creating delivery
      await this.validateStockAvailability(transaction, data.itemId, data.quantity);

      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeDelivery.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar entrega PPE', error, { data });
      throw error;
    }
  }

  /**
   * Validates if there's enough stock available for a delivery
   * Takes into account existing pending/approved deliveries
   */
  private async validateStockAvailability(
    transaction: PrismaTransaction,
    itemId: string,
    requestedQuantity: number,
  ): Promise<void> {
    // Get the item with its current quantity
    const item = await transaction.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        name: true,
        quantity: true,
        uniCode: true,
      },
    });

    if (!item) {
      throw new Error(`Item não encontrado: ${itemId}`);
    }

    // Calculate reserved quantity from pending/approved deliveries (not yet delivered)
    const reservedQuantityResult = await transaction.ppeDelivery.aggregate({
      where: {
        itemId: itemId,
        status: {
          in: ['PENDING', 'APPROVED'], // Only count deliveries that haven't been delivered yet
        },
      },
      _sum: {
        quantity: true,
      },
    });

    const reservedQuantity = reservedQuantityResult._sum.quantity || 0;
    const availableQuantity = item.quantity - reservedQuantity;

    // Validate requested quantity against available (not total) stock
    if (requestedQuantity > availableQuantity) {
      const itemName = item.name || item.uniCode || itemId;
      throw new Error(
        `Quantidade solicitada (${requestedQuantity}) excede o estoque disponível (${availableQuantity}) para o item "${itemName}". ` +
          `Estoque total: ${item.quantity}, Reservado: ${reservedQuantity}`,
      );
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeDelivery.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar entrega PPE por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.ppeDelivery.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar entregas PPE por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PpeDeliveryOrderBy, PpeDeliveryWhere, PpeDeliveryInclude>,
  ): Promise<FindManyResult<PpeDelivery>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, deliveries] = await Promise.all([
      transaction.ppeDelivery.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.ppeDelivery.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [{ createdAt: 'desc' }],
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: deliveries.map(delivery => this.mapDatabaseEntityToEntity(delivery)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PpeDeliveryUpdateFormData,
    options?: UpdateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeDelivery.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar entrega PPE ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<PpeDelivery> {
    try {
      const result = await transaction.ppeDelivery.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar entrega PPE ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PpeDeliveryWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.ppeDelivery.count({ where: whereInput });
    } catch (error) {
      this.logError('contar entregas PPE', error, { where });
      throw error;
    }
  }

  // Non-transaction methods that delegate to transaction methods
  async create(
    data: PpeDeliveryCreateFormData,
    options?: CreateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery> {
    return this.createWithTransaction(this.prisma, data, options);
  }

  async findById(
    id: string,
    options?: CreateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery | null> {
    return this.findByIdWithTransaction(this.prisma, id, options);
  }

  async findByIds(
    ids: string[],
    options?: CreateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery[]> {
    return this.findByIdsWithTransaction(this.prisma, ids, options);
  }

  async findMany(
    options?: FindManyOptions<PpeDeliveryOrderBy, PpeDeliveryWhere, PpeDeliveryInclude>,
  ): Promise<FindManyResult<PpeDelivery>> {
    return this.findManyWithTransaction(this.prisma, options);
  }

  async update(
    id: string,
    data: PpeDeliveryUpdateFormData,
    options?: UpdateOptions<PpeDeliveryInclude>,
  ): Promise<PpeDelivery> {
    return this.updateWithTransaction(this.prisma, id, data, options);
  }

  async delete(id: string): Promise<PpeDelivery> {
    return this.deleteWithTransaction(this.prisma, id);
  }

  async count(where?: PpeDeliveryWhere): Promise<number> {
    return this.countWithTransaction(this.prisma, where);
  }
}
