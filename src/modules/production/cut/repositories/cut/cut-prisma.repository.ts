// apps/api/src/modules/production/cut/repositories/cut/cut-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cut } from '../../../../../types';
import {
  CutCreateFormData,
  CutUpdateFormData,
  CutInclude,
  CutOrderBy,
  CutWhere,
} from '../../../../../schemas/cut';
import { CutRepository } from './cut.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  CreateOptions,
  UpdateOptions,
  FindManyOptions,
  FindManyResult,
} from '../../../../../types';
import { Prisma } from '@prisma/client';

@Injectable()
export class CutPrismaRepository
  extends BaseStringPrismaRepository<
    Cut,
    CutCreateFormData,
    CutUpdateFormData,
    CutInclude,
    CutOrderBy,
    CutWhere,
    Prisma.CutGetPayload<{ include: any }>,
    Prisma.CutCreateInput,
    Prisma.CutUpdateInput,
    Prisma.CutInclude,
    Prisma.CutOrderByWithRelationInput,
    Prisma.CutWhereInput
  >
  implements CutRepository
{
  protected readonly logger = new Logger(CutPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  protected mapDatabaseEntityToEntity(databaseEntity: any): Cut {
    return databaseEntity as Cut;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: CutCreateFormData,
  ): Prisma.CutCreateInput {
    const input: Prisma.CutCreateInput = {
      file: { connect: { id: formData.fileId } },
      type: formData.type,
      origin: formData.origin,
    };

    // Optional fields
    if (formData.taskId) {
      input.task = { connect: { id: formData.taskId } };
    }

    if (formData.reason) {
      input.reason = formData.reason;
    }

    if (formData.parentCutId) {
      input.parentCut = { connect: { id: formData.parentCutId } };
    }

    if (formData.status) {
      input.status = formData.status;
    }

    if (formData.startedAt) {
      input.startedAt = formData.startedAt;
    }

    if (formData.completedAt) {
      input.completedAt = formData.completedAt;
    }

    return input;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: CutUpdateFormData,
  ): Prisma.CutUpdateInput {
    const updateInput: Prisma.CutUpdateInput = {};

    if (formData.fileId !== undefined) {
      updateInput.file = { connect: { id: formData.fileId } };
    }
    if (formData.type !== undefined) {
      updateInput.type = formData.type;
    }
    if (formData.origin !== undefined) {
      updateInput.origin = formData.origin;
    }
    if (formData.taskId !== undefined) {
      if (formData.taskId === null) {
        updateInput.task = { disconnect: true };
      } else {
        updateInput.task = { connect: { id: formData.taskId } };
      }
    }
    if (formData.reason !== undefined) {
      updateInput.reason = formData.reason;
    }
    if (formData.parentCutId !== undefined) {
      if (formData.parentCutId === null) {
        updateInput.parentCut = { disconnect: true };
      } else {
        updateInput.parentCut = { connect: { id: formData.parentCutId } };
      }
    }
    if (formData.status !== undefined) {
      updateInput.status = formData.status;
    }
    if (formData.startedAt !== undefined) {
      updateInput.startedAt = formData.startedAt;
    }
    if (formData.completedAt !== undefined) {
      updateInput.completedAt = formData.completedAt;
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: CutInclude): Prisma.CutInclude | undefined {
    return include as Prisma.CutInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: CutOrderBy,
  ): Prisma.CutOrderByWithRelationInput | undefined {
    return orderBy as Prisma.CutOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: CutWhere): Prisma.CutWhereInput | undefined {
    return where as Prisma.CutWhereInput;
  }

  protected getDefaultInclude(): Prisma.CutInclude {
    return {
      file: true,
      task: true,
      parentCut: true,
      childCuts: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: CutCreateFormData,
    options?: CreateOptions<CutInclude>,
  ): Promise<Cut> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.cut.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar corte', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<CutInclude>,
  ): Promise<Cut | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.cut.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar corte por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<CutInclude>,
  ): Promise<Cut[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.cut.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar cortes por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<CutOrderBy, CutWhere, CutInclude>,
  ): Promise<FindManyResult<Cut>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, cuts] = await Promise.all([
      transaction.cut.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.cut.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: cuts.map(cut => this.mapDatabaseEntityToEntity(cut)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: CutUpdateFormData,
    options?: UpdateOptions<CutInclude>,
  ): Promise<Cut> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.cut.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar corte ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Cut> {
    try {
      const result = await transaction.cut.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar corte ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: CutWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.cut.count({ where: whereInput });
    } catch (error) {
      this.logError('contar cortes', error, { where });
      throw error;
    }
  }
}
