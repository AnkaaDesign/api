// repositories/garage-lane-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { GarageLane } from '../../../../../types';
import {
  GarageLaneCreateFormData,
  GarageLaneUpdateFormData,
  GarageLaneInclude,
  GarageLaneOrderBy,
  GarageLaneWhere,
} from '../../../../../schemas/garage';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { GarageLaneRepository } from './garage-lane.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class GarageLanePrismaRepository
  extends BaseStringPrismaRepository<
    GarageLane,
    GarageLaneCreateFormData,
    GarageLaneUpdateFormData,
    GarageLaneInclude,
    GarageLaneOrderBy,
    GarageLaneWhere,
    Prisma.GarageLaneGetPayload<{ include: any }>,
    Prisma.GarageLaneCreateInput,
    Prisma.GarageLaneUpdateInput,
    Prisma.GarageLaneInclude,
    Prisma.GarageLaneOrderByWithRelationInput,
    Prisma.GarageLaneWhereInput
  >
  implements GarageLaneRepository
{
  protected readonly logger = new Logger(GarageLanePrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): GarageLane {
    return databaseEntity as GarageLane;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: GarageLaneCreateFormData,
  ): Prisma.GarageLaneCreateInput {
    const { garageId, name, ...rest } = formData;

    const createInput: Prisma.GarageLaneCreateInput = {
      ...rest,
      width: formData.width || 0, // Ensure width is provided
      length: formData.length || 0, // Ensure length is provided
      xPosition: formData.xPosition || 0, // Ensure xPosition is provided
      yPosition: formData.yPosition || 0, // Ensure yPosition is provided
      garage: {
        connect: { id: garageId },
      },
    };

    // Only add name if it's provided and exists in the Prisma schema
    if (name) {
      (createInput as any).name = name;
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: GarageLaneUpdateFormData,
  ): Prisma.GarageLaneUpdateInput {
    return formData as Prisma.GarageLaneUpdateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: GarageLaneInclude,
  ): Prisma.GarageLaneInclude | undefined {
    return include as Prisma.GarageLaneInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: GarageLaneOrderBy,
  ): Prisma.GarageLaneOrderByWithRelationInput | undefined {
    return orderBy as Prisma.GarageLaneOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: GarageLaneWhere,
  ): Prisma.GarageLaneWhereInput | undefined {
    return where as Prisma.GarageLaneWhereInput;
  }

  protected getDefaultInclude(): Prisma.GarageLaneInclude {
    return {
      garage: {
        select: {
          id: true,
          name: true,
          width: true,
          length: true,
        },
      },
      parkingSpots: {
        orderBy: { createdAt: 'asc' },
      },
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: GarageLaneCreateFormData,
    options?: CreateOptions<GarageLaneInclude>,
  ): Promise<GarageLane> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await transaction.garageLane.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar pista de garagem', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<GarageLaneInclude>,
  ): Promise<GarageLane | null> {
    try {
      const result = await transaction.garageLane.findUnique({
        where: { id },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar pista de garagem por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<GarageLaneInclude>,
  ): Promise<GarageLane[]> {
    try {
      const results = await transaction.garageLane.findMany({
        where: { id: { in: ids } },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar pistas de garagem por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<GarageLaneOrderBy, GarageLaneWhere, GarageLaneInclude>,
  ): Promise<FindManyResult<GarageLane>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, garageLanes] = await Promise.all([
      transaction.garageLane.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.garageLane.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: garageLanes.map(lane => this.mapDatabaseEntityToEntity(lane)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: GarageLaneUpdateFormData,
    options?: UpdateOptions<GarageLaneInclude>,
  ): Promise<GarageLane> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await transaction.garageLane.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar pista de garagem ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<GarageLane> {
    try {
      const result = await transaction.garageLane.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar pista de garagem ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: GarageLaneWhere,
  ): Promise<number> {
    try {
      return await transaction.garageLane.count({
        where: this.mapWhereToDatabaseWhere(where),
      });
    } catch (error) {
      this.logError('contar pistas de garagem', error, { where });
      throw error;
    }
  }
}
