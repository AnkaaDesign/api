// repositories/activity-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Activity } from '../../../../types';
import {
  ActivityCreateFormData,
  ActivityUpdateFormData,
  ActivityInclude,
  ActivityOrderBy,
  ActivityWhere,
} from '../../../../schemas/activity';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { ActivityRepository } from './activity.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  Prisma,
  Activity as PrismaActivity,
  ActivityOperation,
  ActivityReason,
} from '@prisma/client';
import { getActivityReasonOrder } from '../../../../utils';

@Injectable()
export class ActivityPrismaRepository
  extends BaseStringPrismaRepository<
    Activity,
    ActivityCreateFormData,
    ActivityUpdateFormData,
    ActivityInclude,
    ActivityOrderBy,
    ActivityWhere,
    PrismaActivity,
    Prisma.ActivityCreateInput,
    Prisma.ActivityUpdateInput,
    Prisma.ActivityInclude,
    Prisma.ActivityOrderByWithRelationInput,
    Prisma.ActivityWhereInput
  >
  implements ActivityRepository
{
  protected readonly logger = new Logger(ActivityPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaActivity): Activity {
    return databaseEntity as Activity;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ActivityCreateFormData,
  ): Prisma.ActivityCreateInput {
    const { userId, itemId, reason, orderId, orderItemId, ...rest } = formData;

    const createInput: Prisma.ActivityCreateInput = {
      ...rest,
      quantity: formData.quantity, // Explicitly set required field
      item: { connect: { id: itemId } },
      operation: formData.operation as ActivityOperation,
      ...(reason && { reason: reason as ActivityReason }),
    };

    // Set reasonOrder based on reason
    if (reason) {
      createInput.reasonOrder = getActivityReasonOrder(reason);
    }

    if (userId) {
      createInput.user = { connect: { id: userId } };
    }

    if (orderId) {
      createInput.order = { connect: { id: orderId } };
    }

    if (orderItemId) {
      createInput.orderItem = { connect: { id: orderItemId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ActivityUpdateFormData,
  ): Prisma.ActivityUpdateInput {
    const { userId, itemId, reason, ...rest } = formData;

    const updateInput: Prisma.ActivityUpdateInput = {
      ...rest,
      operation: formData.operation as ActivityOperation,
      ...(reason !== undefined && {
        reason: reason === null ? undefined : (reason as ActivityReason),
      }),
    };

    // Update reasonOrder if reason is being changed
    if (reason !== undefined) {
      updateInput.reasonOrder = reason ? getActivityReasonOrder(reason) : null;
    }

    if (userId !== undefined) {
      updateInput.user = userId ? { connect: { id: userId } } : { disconnect: true };
    }

    if (itemId !== undefined) {
      updateInput.item = { connect: { id: itemId } };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ActivityInclude,
  ): Prisma.ActivityInclude | undefined {
    if (!include) return undefined;

    // Properly handle nested includes with orderBy and take
    const mappedInclude: any = {};

    for (const [key, value] of Object.entries(include)) {
      if (value === true || value === false) {
        mappedInclude[key] = value;
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested include with options
        if (
          'include' in value ||
          'orderBy' in value ||
          'take' in value ||
          'where' in value ||
          'skip' in value
        ) {
          mappedInclude[key] = {
            ...value,
            include: (value as any).include
              ? this.mapNestedInclude((value as any).include)
              : undefined,
          };
        } else {
          mappedInclude[key] = value;
        }
      }
    }

    return mappedInclude as Prisma.ActivityInclude;
  }

  private mapNestedInclude(include: any): any {
    if (typeof include === 'boolean') return include;

    const mapped: any = {};
    for (const [key, value] of Object.entries(include)) {
      if (value === true || value === false) {
        mapped[key] = value;
      } else if (typeof value === 'object' && value !== null) {
        mapped[key] = value;
      }
    }
    return mapped;
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: ActivityOrderBy): any {
    if (!orderBy) return undefined;

    // If orderBy is an array, return it as is
    if (Array.isArray(orderBy)) {
      return orderBy;
    }

    // If orderBy is an object with multiple keys, convert to array
    const keys = Object.keys(orderBy);
    if (keys.length > 1) {
      // Create an array of orderBy objects
      return keys.map(key => ({ [key]: orderBy[key] }));
    }

    // Otherwise return as single object
    return orderBy;
  }

  protected mapWhereToDatabaseWhere(where?: ActivityWhere): Prisma.ActivityWhereInput | undefined {
    return where as Prisma.ActivityWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.ActivityInclude {
    return {
      item: {
        include: {
          prices: true,
          supplier: true,
          category: true,
          brand: true,
        },
      },
      user: {
        include: {
          position: true,
          sector: true,
        },
      },
      order: true,
      orderItem: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ActivityCreateFormData,
    options?: CreateOptions<ActivityInclude>,
  ): Promise<Activity> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.activity.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar atividade', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ActivityInclude>,
  ): Promise<Activity | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.activity.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar atividade por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ActivityInclude>,
  ): Promise<Activity[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.activity.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar atividades por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ActivityOrderBy, ActivityWhere, ActivityInclude>,
  ): Promise<FindManyResult<Activity>> {
    // Map 'limit' to 'take' for compatibility with schema
    const optionsWithTake = options
      ? { ...options, take: (options as any).limit || options.take }
      : {};

    const { where, orderBy, page = 1, take = 20, include } = optionsWithTake as any;
    const skip = Math.max(0, (page - 1) * take);

    const [total, activities] = await Promise.all([
      transaction.activity.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.activity.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      } as any),
    ]);

    return {
      data: activities.map(activity => this.mapDatabaseEntityToEntity(activity)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ActivityUpdateFormData,
    options?: UpdateOptions<ActivityInclude>,
  ): Promise<Activity> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.activity.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar atividade ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Activity> {
    try {
      const result = await transaction.activity.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar atividade ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ActivityWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.activity.count({ where: whereInput });
    } catch (error) {
      this.logError('contar atividades', error, { where });
      throw error;
    }
  }

  // Utility methods
  protected logError(operation: string, error: any, context?: any): void {
    this.logger.error(`Erro ao ${operation}:`, error, context);
  }

  protected calculatePagination(total: number, page: number, take: number) {
    return {
      totalRecords: total,
      page,
      take,
      totalPages: Math.ceil(total / take),
      hasNextPage: page * take < total,
      hasPreviousPage: page > 1,
    };
  }
}
