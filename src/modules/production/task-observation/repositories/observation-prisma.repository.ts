// repositories/observations-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Observation } from '../../../../types';
import {
  ObservationCreateFormData,
  ObservationUpdateFormData,
  ObservationInclude,
  ObservationOrderBy,
  ObservationWhere,
} from '../../../../schemas/observation';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { ObservationRepository } from './observation.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class ObservationPrismaRepository
  extends BaseStringPrismaRepository<
    Observation,
    ObservationCreateFormData,
    ObservationUpdateFormData,
    ObservationInclude,
    ObservationOrderBy,
    ObservationWhere,
    Prisma.ObservationGetPayload<{ include: any }>,
    Prisma.ObservationCreateInput,
    Prisma.ObservationUpdateInput,
    Prisma.ObservationInclude,
    Prisma.ObservationOrderByWithRelationInput,
    Prisma.ObservationWhereInput
  >
  implements ObservationRepository
{
  protected readonly logger = new Logger(ObservationPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Observation {
    return databaseEntity as Observation;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ObservationCreateFormData,
  ): Prisma.ObservationCreateInput {
    const { taskId, fileIds, ...rest } = formData;

    const createInput: Prisma.ObservationCreateInput = {
      ...rest,
      description: formData.description || '', // Ensure description is provided
      task: { connect: { id: taskId } },
    };

    // Handle file relations
    if (fileIds && fileIds.length > 0) {
      createInput.files = { connect: fileIds.map(id => ({ id })) };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ObservationUpdateFormData,
  ): Prisma.ObservationUpdateInput {
    const { taskId, fileIds, ...rest } = formData;

    const updateInput: Prisma.ObservationUpdateInput = {
      ...rest,
    };

    // Handle task relation update if provided
    if (taskId !== undefined) {
      updateInput.task = { connect: { id: taskId } };
    }

    // Handle file relations with set operation (replaces all files)
    if (fileIds !== undefined) {
      updateInput.files = { set: fileIds.map(id => ({ id })) };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ObservationInclude,
  ): Prisma.ObservationInclude | undefined {
    return include as Prisma.ObservationInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ObservationOrderBy,
  ): Prisma.ObservationOrderByWithRelationInput | undefined {
    return orderBy as Prisma.ObservationOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: ObservationWhere,
  ): Prisma.ObservationWhereInput | undefined {
    return where as Prisma.ObservationWhereInput;
  }

  protected getDefaultInclude(): Prisma.ObservationInclude {
    return {
      files: {
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimetype: true,
          path: true,
          size: true,
          thumbnailUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      task: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ObservationCreateFormData,
    options?: CreateOptions<ObservationInclude>,
  ): Promise<Observation> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.observation.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar observação', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ObservationInclude>,
  ): Promise<Observation | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.observation.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar observação por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ObservationInclude>,
  ): Promise<Observation[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.observation.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar observações por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ObservationOrderBy, ObservationWhere, ObservationInclude>,
  ): Promise<FindManyResult<Observation>> {
    // Handle both ObservationGetManyFormData format (with limit) and FindManyOptions format (with take)
    const queryOptions = (options as any) || {};
    const { where, orderBy, page = 1, include } = queryOptions;
    const take = queryOptions.take || queryOptions.limit || 20;
    const skip = Math.max(0, (page - 1) * take);

    const [total, observations] = await Promise.all([
      transaction.observation.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.observation.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: observations.map(observation => this.mapDatabaseEntityToEntity(observation)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ObservationUpdateFormData,
    options?: UpdateOptions<ObservationInclude>,
  ): Promise<Observation> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.observation.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar observação ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Observation> {
    try {
      const result = await transaction.observation.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar observação ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ObservationWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.observation.count({ where: whereInput });
    } catch (error) {
      this.logError('contar observações', error, { where });
      throw error;
    }
  }
}
