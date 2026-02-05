// repositories/service-order-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ServiceOrder } from '../../../../../types';
import {
  ServiceOrderCreateFormData,
  ServiceOrderUpdateFormData,
  ServiceOrderInclude,
  ServiceOrderOrderBy,
  ServiceOrderWhere,
} from '../../../../../schemas/serviceOrder';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';
import { ServiceOrderRepository } from './service-order.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, ServiceOrderStatus } from '@prisma/client';
import { SERVICE_ORDER_STATUS } from '../../../../../constants/enums';
import {
  getServiceOrderStatusOrder,
  mapServiceOrderStatusToPrisma,
  mapWhereClause,
} from '../../../../../utils';

@Injectable()
export class ServiceOrderPrismaRepository
  extends BaseStringPrismaRepository<
    ServiceOrder,
    ServiceOrderCreateFormData,
    ServiceOrderUpdateFormData,
    ServiceOrderInclude,
    ServiceOrderOrderBy,
    ServiceOrderWhere,
    Prisma.ServiceOrderGetPayload<{ include: any }>,
    Prisma.ServiceOrderCreateInput,
    Prisma.ServiceOrderUpdateInput,
    Prisma.ServiceOrderInclude,
    Prisma.ServiceOrderOrderByWithRelationInput,
    Prisma.ServiceOrderWhereInput
  >
  implements ServiceOrderRepository
{
  protected readonly logger = new Logger(ServiceOrderPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): ServiceOrder {
    return {
      id: databaseEntity.id,
      status: databaseEntity.status,
      statusOrder: databaseEntity.statusOrder,
      description: databaseEntity.description,
      observation: databaseEntity.observation,
      position: databaseEntity.position,
      type: databaseEntity.type,
      taskId: databaseEntity.taskId,
      assignedToId: databaseEntity.assignedToId,
      startedById: databaseEntity.startedById,
      approvedById: databaseEntity.approvedById,
      completedById: databaseEntity.completedById,
      startedAt: databaseEntity.startedAt,
      approvedAt: databaseEntity.approvedAt,
      finishedAt: databaseEntity.finishedAt,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      // Relations
      task: databaseEntity.task,
      assignedTo: databaseEntity.assignedTo,
      createdBy: databaseEntity.createdBy,
      startedBy: databaseEntity.startedBy,
      approvedBy: databaseEntity.approvedBy,
      completedBy: databaseEntity.completedBy,
    };
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ServiceOrderCreateFormData,
  ): Prisma.ServiceOrderCreateInput {
    // Extract relation IDs and fields that need special handling
    const {
      taskId,
      status,
      type,
      createdById,
      assignedToId,
      startedById,
      approvedById,
      completedById,
      ...rest
    } = formData as ServiceOrderCreateFormData & { createdById?: string };

    // Validate required fields
    if (!formData.description) {
      throw new Error('Description is required for creating a service order');
    }
    if (!taskId) {
      throw new Error('Task ID is required for creating a service order');
    }
    if (!createdById) {
      throw new Error('CreatedById is required for creating a service order');
    }

    const createInput: Prisma.ServiceOrderCreateInput = {
      ...rest,
      description: formData.description || '', // Ensure description is provided
      status: mapServiceOrderStatusToPrisma(status || SERVICE_ORDER_STATUS.PENDING),
      statusOrder: getServiceOrderStatusOrder(status || SERVICE_ORDER_STATUS.PENDING),
      ...(type !== undefined && { type: type as any }),
      task: {
        connect: { id: taskId },
      },
      createdBy: {
        connect: { id: createdById },
      },
      // Handle optional user relations - only connect if ID is provided and not null
      ...(assignedToId && { assignedTo: { connect: { id: assignedToId } } }),
      ...(startedById && { startedBy: { connect: { id: startedById } } }),
      ...(approvedById && { approvedBy: { connect: { id: approvedById } } }),
      ...(completedById && { completedBy: { connect: { id: completedById } } }),
    };

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ServiceOrderUpdateFormData,
  ): Prisma.ServiceOrderUpdateInput {
    const { taskId, status, type, ...rest } = formData;

    const updateInput: Prisma.ServiceOrderUpdateInput = {
      ...rest,
      ...(type !== undefined && { type: type as any }),
    };

    if (status) {
      updateInput.status = mapServiceOrderStatusToPrisma(status);
      updateInput.statusOrder = getServiceOrderStatusOrder(status);
    }

    if (taskId) {
      updateInput.task = {
        connect: { id: taskId },
      };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ServiceOrderInclude,
  ): Prisma.ServiceOrderInclude | undefined {
    return include as Prisma.ServiceOrderInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ServiceOrderOrderBy,
  ): Prisma.ServiceOrderOrderByWithRelationInput | undefined {
    return orderBy as Prisma.ServiceOrderOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: ServiceOrderWhere,
  ): Prisma.ServiceOrderWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.ServiceOrderWhereInput;
  }

  protected getDefaultInclude(): Prisma.ServiceOrderInclude {
    return {
      task: {
        select: {
          id: true,
          name: true,
          status: true,
          serialNumber: true,
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ServiceOrderCreateFormData,
    options?: CreateOptions<ServiceOrderInclude>,
  ): Promise<ServiceOrder> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.serviceOrder.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar ordem de serviço', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ServiceOrderInclude>,
  ): Promise<ServiceOrder | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.serviceOrder.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar ordem de serviço por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ServiceOrderInclude>,
  ): Promise<ServiceOrder[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.serviceOrder.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar ordens de serviço por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ServiceOrderOrderBy, ServiceOrderWhere, ServiceOrderInclude>,
  ): Promise<FindManyResult<ServiceOrder>> {
    // Map 'limit' to 'take' for compatibility with schema
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, serviceOrders] = await Promise.all([
      transaction.serviceOrder.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.serviceOrder.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [
          { type: 'asc' },
          { position: 'asc' },
        ],
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: serviceOrders.map(serviceOrder => this.mapDatabaseEntityToEntity(serviceOrder)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ServiceOrderUpdateFormData,
    options?: UpdateOptions<ServiceOrderInclude>,
  ): Promise<ServiceOrder> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.serviceOrder.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar ordem de serviço ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<ServiceOrder> {
    try {
      const result = await transaction.serviceOrder.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar ordem de serviço ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ServiceOrderWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.serviceOrder.count({ where: whereInput });
    } catch (error) {
      this.logError('contar ordens de serviço', error, { where });
      throw error;
    }
  }
}
