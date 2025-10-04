// repositories/position-remuneration-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { PositionRemuneration } from '../../../../../types';
import {
  PositionRemunerationCreateFormData,
  PositionRemunerationUpdateFormData,
  PositionRemunerationInclude,
  PositionRemunerationOrderBy,
  PositionRemunerationWhere,
} from '../../../../../schemas/position';
import { PositionRemunerationRepository } from './position-remuneration.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';

@Injectable()
export class PositionRemunerationPrismaRepository
  extends BaseStringPrismaRepository<
    PositionRemuneration,
    PositionRemunerationCreateFormData,
    PositionRemunerationUpdateFormData,
    PositionRemunerationInclude,
    PositionRemunerationOrderBy,
    PositionRemunerationWhere,
    Prisma.PositionRemunerationGetPayload<{ include: any }>,
    Prisma.PositionRemunerationCreateInput,
    Prisma.PositionRemunerationUpdateInput,
    Prisma.PositionRemunerationInclude,
    Prisma.PositionRemunerationOrderByWithRelationInput,
    Prisma.PositionRemunerationWhereInput
  >
  implements PositionRemunerationRepository
{
  protected readonly logger = new Logger(PositionRemunerationPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(
    databaseEntity: Prisma.PositionRemunerationGetPayload<{ include: any }>,
  ): PositionRemuneration {
    // Simple cast approach similar to position repository
    return databaseEntity as PositionRemuneration;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PositionRemunerationCreateFormData,
  ): Prisma.PositionRemunerationCreateInput {
    const { positionId, ...rest } = formData;

    const createInput: Prisma.PositionRemunerationCreateInput = {
      ...rest,
      value: formData.value || 0, // Ensure value is provided
      position: { connect: { id: positionId } },
    };

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PositionRemunerationUpdateFormData,
  ): Prisma.PositionRemunerationUpdateInput {
    const { positionId, ...rest } = formData;

    const updateInput: Prisma.PositionRemunerationUpdateInput = {
      ...rest,
    };

    if (positionId !== undefined) {
      updateInput.position = { connect: { id: positionId } };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PositionRemunerationInclude,
  ): Prisma.PositionRemunerationInclude | undefined {
    return include as Prisma.PositionRemunerationInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PositionRemunerationOrderBy,
  ): Prisma.PositionRemunerationOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PositionRemunerationOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: PositionRemunerationWhere,
  ): Prisma.PositionRemunerationWhereInput | undefined {
    return where as Prisma.PositionRemunerationWhereInput;
  }

  protected getDefaultInclude(): Prisma.PositionRemunerationInclude {
    return {
      position: {
        include: {
          users: {
            include: {
              sector: true,
            },
          },
        },
      },
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PositionRemunerationCreateFormData,
    options?: CreateOptions<PositionRemunerationInclude>,
  ): Promise<PositionRemuneration> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.positionRemuneration.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result as any);
    } catch (error) {
      this.logError('criar remuneração de cargo', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PositionRemunerationInclude>,
  ): Promise<PositionRemuneration | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.positionRemuneration.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result as any) : null;
    } catch (error) {
      this.logError(`buscar remuneração de cargo por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PositionRemunerationInclude>,
  ): Promise<PositionRemuneration[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.positionRemuneration.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result as any));
    } catch (error) {
      this.logError('buscar remunerações de cargo por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      PositionRemunerationOrderBy,
      PositionRemunerationWhere,
      PositionRemunerationInclude
    >,
  ): Promise<FindManyResult<PositionRemuneration>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, remunerations] = await Promise.all([
      transaction.positionRemuneration.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.positionRemuneration.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: remunerations.map(remuneration => this.mapDatabaseEntityToEntity(remuneration as any)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PositionRemunerationUpdateFormData,
    options?: UpdateOptions<PositionRemunerationInclude>,
  ): Promise<PositionRemuneration> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.positionRemuneration.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result as any);
    } catch (error) {
      this.logError(`atualizar remuneração de cargo ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<PositionRemuneration> {
    try {
      const result = await transaction.positionRemuneration.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result as any);
    } catch (error) {
      this.logError(`deletar remuneração de cargo ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PositionRemunerationWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.positionRemuneration.count({ where: whereInput });
    } catch (error) {
      this.logError('contar remunerações de cargo', error, { where });
      throw error;
    }
  }
}
