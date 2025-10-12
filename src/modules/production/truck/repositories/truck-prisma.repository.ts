// repositories/truck-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Truck } from '../../../../types';
import {
  TruckCreateFormData,
  TruckUpdateFormData,
  TruckInclude,
  TruckOrderBy,
  TruckWhere,
} from '../../../../schemas/truck';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { TruckRepository } from './truck.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class TruckPrismaRepository
  extends BaseStringPrismaRepository<
    Truck,
    TruckCreateFormData,
    TruckUpdateFormData,
    TruckInclude,
    TruckOrderBy,
    TruckWhere,
    Prisma.TruckGetPayload<{ include: Prisma.TruckInclude }>,
    Prisma.TruckCreateInput,
    Prisma.TruckUpdateInput,
    Prisma.TruckInclude,
    Prisma.TruckOrderByWithRelationInput,
    Prisma.TruckWhereInput
  >
  implements TruckRepository
{
  protected readonly logger = new Logger(TruckPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(
    databaseEntity: Prisma.TruckGetPayload<{ include: Prisma.TruckInclude }>,
  ): Truck {
    // Convert Decimal to number for price field
    const entity = { ...databaseEntity } as any;
    if (entity.task?.price) {
      entity.task.price = Number(entity.task.price);
    }
    return entity as Truck;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: TruckCreateFormData,
  ): Prisma.TruckCreateInput {
    const { taskId, garageId, ...rest } = formData;

    const createInput: Prisma.TruckCreateInput = {
      ...rest,
      task: { connect: { id: taskId } },
    };

    if (garageId) {
      createInput.garage = { connect: { id: garageId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: TruckUpdateFormData,
  ): Prisma.TruckUpdateInput {
    const { taskId, garageId, ...rest } = formData;

    const updateInput: Prisma.TruckUpdateInput = {
      ...rest,
    };

    if (taskId !== undefined) {
      updateInput.task = { connect: { id: taskId } };
    }

    if (garageId !== undefined) {
      updateInput.garage = garageId ? { connect: { id: garageId } } : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: TruckInclude): Prisma.TruckInclude | undefined {
    return include as Prisma.TruckInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: TruckOrderBy,
  ): Prisma.TruckOrderByWithRelationInput | undefined {
    return orderBy as Prisma.TruckOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: TruckWhere): Prisma.TruckWhereInput | undefined {
    return where as Prisma.TruckWhereInput;
  }

  protected getDefaultInclude(): Prisma.TruckInclude {
    return {
      task: {
        select: {
          id: true,
          name: true,
          status: true,
          serialNumber: true,
          plate: true, // Always needed (source of truth for truck plate)
          customer: {  // Used in 95%+ of queries (list views, search, garage display)
            select: {
              id: true,
              fantasyName: true,
              corporateName: true,
            },
          },
        },
      },
      garage: {
        select: {
          id: true,
          name: true,
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: TruckCreateFormData,
    options?: CreateOptions<TruckInclude>,
  ): Promise<Truck> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.truck.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar caminhão', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<TruckInclude>,
  ): Promise<Truck | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.truck.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar caminhão por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<TruckInclude>,
  ): Promise<Truck[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.truck.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar caminhões por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<TruckOrderBy, TruckWhere, TruckInclude>,
  ): Promise<FindManyResult<Truck>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, trucks] = await Promise.all([
      transaction.truck.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.truck.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: trucks.map(truck => this.mapDatabaseEntityToEntity(truck)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: TruckUpdateFormData,
    options?: UpdateOptions<TruckInclude>,
  ): Promise<Truck> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.truck.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar caminhão ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Truck> {
    try {
      const result = await transaction.truck.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar caminhão ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: TruckWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.truck.count({ where: whereInput });
    } catch (error) {
      this.logError('contar caminhões', error, { where });
      throw error;
    }
  }

  async findByLicensePlate(
    plate: string,
    options?: { include?: TruckInclude; transaction?: PrismaTransaction },
  ): Promise<Truck | null> {
    try {
      const transaction = options?.transaction || this.prisma;
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.truck.findFirst({
        where: {
          task: {
            plate: plate,
          },
        },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar caminhão por placa ${plate}`, error);
      throw error;
    }
  }

  async findByChassis(
    chassis: string,
    options?: { include?: TruckInclude; transaction?: PrismaTransaction },
  ): Promise<Truck | null> {
    try {
      // Note: Since chassis field doesn't exist in the Task model according to the schema,
      // this method returns null. If chassis is added to Task model, update this implementation.
      this.logger.warn(`findByChassis chamado mas campo chassis não existe no modelo Task`);
      return null;
    } catch (error) {
      this.logError(`buscar caminhão por chassis ${chassis}`, error);
      throw error;
    }
  }

  async findByLicensePlateWithTransaction(
    transaction: PrismaTransaction,
    plate: string,
    options?: { include?: TruckInclude },
  ): Promise<Truck | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.truck.findFirst({
        where: {
          task: {
            plate: plate,
          },
        },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar caminhão por placa ${plate} com transação`, error);
      throw error;
    }
  }

  async findByChassisWithTransaction(
    transaction: PrismaTransaction,
    chassis: string,
    options?: { include?: TruckInclude },
  ): Promise<Truck | null> {
    try {
      // Note: Since chassis field doesn't exist in the Task model according to the schema,
      // this method returns null. If chassis is added to Task model, update this implementation.
      this.logger.warn(
        `findByChassisWithTransaction chamado mas campo chassis não existe no modelo Task`,
      );
      return null;
    } catch (error) {
      this.logError(`buscar caminhão por chassis ${chassis} com transação`, error);
      throw error;
    }
  }
}
