// repositories/service-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Service } from '../../../../../types';
import {
  ServiceCreateFormData,
  ServiceUpdateFormData,
  ServiceInclude,
  ServiceOrderBy,
  ServiceWhere,
} from '../../../../../schemas/service';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';
import { ServiceRepository } from './service.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class ServicePrismaRepository
  extends BaseStringPrismaRepository<
    Service,
    ServiceCreateFormData,
    ServiceUpdateFormData,
    ServiceInclude,
    ServiceOrderBy,
    ServiceWhere,
    Prisma.ServiceGetPayload<any>,
    Prisma.ServiceCreateInput,
    Prisma.ServiceUpdateInput,
    never, // Service has no relations
    Prisma.ServiceOrderByWithRelationInput,
    Prisma.ServiceWhereInput
  >
  implements ServiceRepository
{
  protected readonly logger = new Logger(ServicePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Service {
    return {
      id: databaseEntity.id,
      description: databaseEntity.description,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
    };
  }

  // Mapping methods
  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ServiceCreateFormData,
  ): Prisma.ServiceCreateInput {
    // Validate required fields
    if (!formData.description) {
      throw new Error('Description is required for creating a service');
    }

    return {
      description: formData.description,
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ServiceUpdateFormData,
  ): Prisma.ServiceUpdateInput {
    const updateInput: Prisma.ServiceUpdateInput = {};

    if (formData.description !== undefined) {
      updateInput.description = formData.description;
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(_include?: ServiceInclude): never {
    // Service has no relations to include
    return undefined as never;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ServiceOrderBy,
  ): Prisma.ServiceOrderByWithRelationInput | undefined {
    return orderBy as Prisma.ServiceOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: ServiceWhere): Prisma.ServiceWhereInput | undefined {
    return where as Prisma.ServiceWhereInput;
  }

  protected getDefaultInclude(): never {
    // Service has no relations to include
    return undefined as never;
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ServiceCreateFormData,
    options?: CreateOptions<ServiceInclude>,
  ): Promise<Service> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await transaction.service.create({
        data: createInput,
        // Service has no relations to include
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar serviço', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ServiceInclude>,
  ): Promise<Service | null> {
    try {
      const result = await transaction.service.findUnique({
        where: { id },
        // Service has no relations to include
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar serviço por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ServiceInclude>,
  ): Promise<Service[]> {
    try {
      const results = await transaction.service.findMany({
        where: { id: { in: ids } },
        // Service has no relations to include
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar serviços por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ServiceOrderBy, ServiceWhere, ServiceInclude>,
  ): Promise<FindManyResult<Service>> {
    // Map 'limit' to 'take' for compatibility with schema
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, services] = await Promise.all([
      transaction.service.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.service.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        // Service has no relations to include
      }),
    ]);

    return {
      data: services.map(service => this.mapDatabaseEntityToEntity(service)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ServiceUpdateFormData,
    options?: UpdateOptions<ServiceInclude>,
  ): Promise<Service> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await transaction.service.update({
        where: { id },
        data: updateInput,
        // Service has no relations to include
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar serviço ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Service> {
    try {
      const result = await transaction.service.delete({
        where: { id },
        // Service has no relations to include
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar serviço ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ServiceWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.service.count({ where: whereInput });
    } catch (error) {
      this.logError('contar serviços', error, { where });
      throw error;
    }
  }
}
