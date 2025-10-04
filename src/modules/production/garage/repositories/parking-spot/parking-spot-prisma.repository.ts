// repositories/parking-spot-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ParkingSpot } from '../../../../../types';
import {
  ParkingSpotCreateFormData,
  ParkingSpotUpdateFormData,
  ParkingSpotInclude,
  ParkingSpotOrderBy,
  ParkingSpotWhere,
} from '../../../../../schemas/garage';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { ParkingSpotRepository } from './parking-spot.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class ParkingSpotPrismaRepository
  extends BaseStringPrismaRepository<
    ParkingSpot,
    ParkingSpotCreateFormData,
    ParkingSpotUpdateFormData,
    ParkingSpotInclude,
    ParkingSpotOrderBy,
    ParkingSpotWhere,
    Prisma.ParkingSpotGetPayload<{ include: any }>,
    Prisma.ParkingSpotCreateInput,
    Prisma.ParkingSpotUpdateInput,
    Prisma.ParkingSpotInclude,
    Prisma.ParkingSpotOrderByWithRelationInput,
    Prisma.ParkingSpotWhereInput
  >
  implements ParkingSpotRepository
{
  protected readonly logger = new Logger(ParkingSpotPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): ParkingSpot {
    return databaseEntity as ParkingSpot;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ParkingSpotCreateFormData,
  ): Prisma.ParkingSpotCreateInput {
    const { garageLaneId, ...rest } = formData;

    const createInput: Prisma.ParkingSpotCreateInput = {
      ...rest,
      name: formData.name || 'Unnamed Parking Spot', // Ensure name is provided
      garageLane: {
        connect: { id: garageLaneId },
      },
    };

    if (garageLaneId) {
      createInput.garageLane = { connect: { id: garageLaneId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ParkingSpotUpdateFormData,
  ): Prisma.ParkingSpotUpdateInput {
    return formData as Prisma.ParkingSpotUpdateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ParkingSpotInclude,
  ): Prisma.ParkingSpotInclude | undefined {
    return include as Prisma.ParkingSpotInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ParkingSpotOrderBy,
  ): Prisma.ParkingSpotOrderByWithRelationInput | undefined {
    return orderBy as Prisma.ParkingSpotOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: ParkingSpotWhere,
  ): Prisma.ParkingSpotWhereInput | undefined {
    return where as Prisma.ParkingSpotWhereInput;
  }

  protected getDefaultInclude(): Prisma.ParkingSpotInclude {
    return {
      garageLane: {
        include: {
          garage: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ParkingSpotCreateFormData,
    options?: CreateOptions<ParkingSpotInclude>,
  ): Promise<ParkingSpot> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await transaction.parkingSpot.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar vaga de estacionamento', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ParkingSpotInclude>,
  ): Promise<ParkingSpot | null> {
    try {
      const result = await transaction.parkingSpot.findUnique({
        where: { id },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar vaga de estacionamento por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ParkingSpotInclude>,
  ): Promise<ParkingSpot[]> {
    try {
      const results = await transaction.parkingSpot.findMany({
        where: { id: { in: ids } },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar vagas de estacionamento por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ParkingSpotOrderBy, ParkingSpotWhere, ParkingSpotInclude>,
  ): Promise<FindManyResult<ParkingSpot>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, parkingSpots] = await Promise.all([
      transaction.parkingSpot.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.parkingSpot.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: parkingSpots.map(spot => this.mapDatabaseEntityToEntity(spot)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ParkingSpotUpdateFormData,
    options?: UpdateOptions<ParkingSpotInclude>,
  ): Promise<ParkingSpot> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await transaction.parkingSpot.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar vaga de estacionamento ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<ParkingSpot> {
    try {
      const result = await transaction.parkingSpot.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar vaga de estacionamento ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ParkingSpotWhere,
  ): Promise<number> {
    try {
      return await transaction.parkingSpot.count({
        where: this.mapWhereToDatabaseWhere(where),
      });
    } catch (error) {
      this.logError('contar vagas de estacionamento', error, { where });
      throw error;
    }
  }
}
