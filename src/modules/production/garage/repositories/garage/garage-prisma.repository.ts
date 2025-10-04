// repositories/garage-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Garage } from '../../../../../types';
import {
  GarageCreateFormData,
  GarageUpdateFormData,
  GarageInclude,
  GarageOrderBy,
  GarageWhere,
} from '../../../../../schemas/garage';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { GarageRepository } from './garage.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class GaragePrismaRepository
  extends BaseStringPrismaRepository<
    Garage,
    GarageCreateFormData,
    GarageUpdateFormData,
    GarageInclude,
    GarageOrderBy,
    GarageWhere,
    Prisma.GarageGetPayload<{ include: any }>,
    Prisma.GarageCreateInput,
    Prisma.GarageUpdateInput,
    Prisma.GarageInclude,
    Prisma.GarageOrderByWithRelationInput,
    Prisma.GarageWhereInput
  >
  implements GarageRepository
{
  protected readonly logger = new Logger(GaragePrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Garage {
    return databaseEntity as Garage;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: GarageCreateFormData,
  ): Prisma.GarageCreateInput {
    return formData as Prisma.GarageCreateInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: GarageUpdateFormData,
  ): Prisma.GarageUpdateInput {
    return formData as Prisma.GarageUpdateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: GarageInclude): Prisma.GarageInclude | undefined {
    return include as Prisma.GarageInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: GarageOrderBy,
  ): Prisma.GarageOrderByWithRelationInput | undefined {
    return orderBy as Prisma.GarageOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: GarageWhere): Prisma.GarageWhereInput | undefined {
    return where as Prisma.GarageWhereInput;
  }

  protected getDefaultInclude(): Prisma.GarageInclude {
    return {
      lanes: {
        include: {
          parkingSpots: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      trucks: {
        include: {
          task: true,
        },
      },
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: GarageCreateFormData,
    options?: CreateOptions<GarageInclude>,
  ): Promise<Garage> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await transaction.garage.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar garagem', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<GarageInclude>,
  ): Promise<Garage | null> {
    try {
      const result = await transaction.garage.findUnique({
        where: { id },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar garagem por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<GarageInclude>,
  ): Promise<Garage[]> {
    try {
      const results = await transaction.garage.findMany({
        where: { id: { in: ids } },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar garagens por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<GarageOrderBy, GarageWhere, GarageInclude>,
  ): Promise<FindManyResult<Garage>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, garages] = await Promise.all([
      transaction.garage.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.garage.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: garages.map(garage => this.mapDatabaseEntityToEntity(garage)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: GarageUpdateFormData,
    options?: UpdateOptions<GarageInclude>,
  ): Promise<Garage> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await transaction.garage.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar garagem ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Garage> {
    try {
      const result = await transaction.garage.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar garagem ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: GarageWhere): Promise<number> {
    try {
      return await transaction.garage.count({
        where: this.mapWhereToDatabaseWhere(where),
      });
    } catch (error) {
      this.logError('contar garagens', error, { where });
      throw error;
    }
  }
}
