import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import type { ChangeLog } from '../../../../types';
import type {
  ChangeLogCreateFormData,
  ChangeLogUpdateFormData,
  ChangeLogInclude,
  ChangeLogOrderBy,
  ChangeLogWhere,
} from '../../../../schemas';
import { ChangeLogRepository } from './changelog.repository';
import type {
  ChangeLog as PrismaChangeLog,
  Prisma,
  ChangeLogEntityType,
  ChangeLogAction,
  ChangeLogTriggeredByType,
} from '@prisma/client';
import type {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../types';
import {
  mapChangeLogEntityTypeToPrisma,
  mapChangeLogActionToPrisma,
  mapChangeLogTriggeredByTypeToPrisma,
  mapWhereClause,
} from '../../../../utils';
import { serializeChangelogValue } from '../../../../utils/serialize-changelog-value';

@Injectable()
export class ChangeLogPrismaRepository
  extends BaseStringPrismaRepository<
    ChangeLog,
    ChangeLogCreateFormData,
    ChangeLogUpdateFormData,
    ChangeLogInclude,
    ChangeLogOrderBy,
    ChangeLogWhere,
    PrismaChangeLog,
    Prisma.ChangeLogCreateInput,
    Prisma.ChangeLogUpdateInput,
    Prisma.ChangeLogInclude,
    Prisma.ChangeLogOrderByWithRelationInput,
    Prisma.ChangeLogWhereInput
  >
  implements ChangeLogRepository
{
  protected readonly logger = new Logger(ChangeLogPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaChangeLog): ChangeLog {
    return databaseEntity as unknown as ChangeLog;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ChangeLogCreateFormData,
  ): Prisma.ChangeLogCreateInput {
    return {
      entityType: mapChangeLogEntityTypeToPrisma(formData.entityType),
      action: mapChangeLogActionToPrisma(formData.action),
      entityId: formData.entityId,
      field: formData.field || null,
      oldValue: serializeChangelogValue(formData.oldValue),
      newValue: serializeChangelogValue(formData.newValue),
      reason: formData.reason || null,
      triggeredBy: formData.triggeredBy
        ? mapChangeLogTriggeredByTypeToPrisma(formData.triggeredBy)
        : null,
      triggeredById: formData.triggeredById || null,
      metadata: formData.metadata || {
        timestamp: new Date().toISOString(),
      },
      user: formData.userId ? { connect: { id: formData.userId } } : undefined,
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ChangeLogUpdateFormData,
  ): Prisma.ChangeLogUpdateInput {
    const { triggeredBy, ...rest } = formData;
    const updateInput: Prisma.ChangeLogUpdateInput = {
      ...rest,
      entityType: formData.entityType
        ? mapChangeLogEntityTypeToPrisma(formData.entityType)
        : undefined,
      action: formData.action ? mapChangeLogActionToPrisma(formData.action) : undefined,
      oldValue:
        formData.oldValue !== undefined ? serializeChangelogValue(formData.oldValue) : undefined,
      newValue:
        formData.newValue !== undefined ? serializeChangelogValue(formData.newValue) : undefined,
      triggeredBy: triggeredBy ? mapChangeLogTriggeredByTypeToPrisma(triggeredBy) : undefined,
    };

    if (formData.userId !== undefined) {
      updateInput.user = formData.userId
        ? { connect: { id: formData.userId } }
        : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ChangeLogInclude,
  ): Prisma.ChangeLogInclude | undefined {
    return include as Prisma.ChangeLogInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ChangeLogOrderBy,
  ): Prisma.ChangeLogOrderByWithRelationInput | undefined {
    return orderBy as Prisma.ChangeLogOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: ChangeLogWhere,
  ): Prisma.ChangeLogWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.ChangeLogWhereInput;
  }

  protected getDefaultInclude(): Prisma.ChangeLogInclude {
    return {
      user: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ChangeLogCreateFormData,
    options?: CreateOptions<ChangeLogInclude>,
  ): Promise<ChangeLog> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.changeLog.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar changelog', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ChangeLogInclude>,
  ): Promise<ChangeLog | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.changeLog.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar changelog por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ChangeLogInclude>,
  ): Promise<ChangeLog[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.changeLog.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar changelogs por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ChangeLogOrderBy, ChangeLogWhere, ChangeLogInclude>,
  ): Promise<FindManyResult<ChangeLog>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, changeLogs] = await Promise.all([
      transaction.changeLog.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.changeLog.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: changeLogs.map(changeLog => this.mapDatabaseEntityToEntity(changeLog)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ChangeLogUpdateFormData,
    options?: UpdateOptions<ChangeLogInclude>,
  ): Promise<ChangeLog> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.changeLog.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar changelog ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<ChangeLog> {
    try {
      const result = await transaction.changeLog.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar changelog ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ChangeLogWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.changeLog.count({ where: whereInput });
    } catch (error) {
      this.logError('contar changelogs', error, { where });
      throw error;
    }
  }
}
