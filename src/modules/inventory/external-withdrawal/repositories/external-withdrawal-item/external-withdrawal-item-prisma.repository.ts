// repositories/external-withdrawal-item/external-withdrawal-item-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ExternalWithdrawalItem } from '../../../../../types';
import {
  ExternalWithdrawalItemCreateFormData,
  ExternalWithdrawalItemUpdateFormData,
  ExternalWithdrawalItemInclude,
  ExternalWithdrawalItemOrderBy,
  ExternalWithdrawalItemWhere,
} from '../../../../../schemas';
import { ExternalWithdrawalItemRepository } from './external-withdrawal-item.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { Prisma, ExternalWithdrawalItem as PrismaExternalWithdrawalItem } from '@prisma/client';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';

@Injectable()
export class ExternalWithdrawalItemPrismaRepository
  extends BaseStringPrismaRepository<
    ExternalWithdrawalItem,
    ExternalWithdrawalItemCreateFormData,
    ExternalWithdrawalItemUpdateFormData,
    ExternalWithdrawalItemInclude,
    ExternalWithdrawalItemOrderBy,
    ExternalWithdrawalItemWhere,
    PrismaExternalWithdrawalItem,
    Prisma.ExternalWithdrawalItemCreateInput,
    Prisma.ExternalWithdrawalItemUpdateInput,
    Prisma.ExternalWithdrawalItemInclude,
    Prisma.ExternalWithdrawalItemOrderByWithRelationInput,
    Prisma.ExternalWithdrawalItemWhereInput
  >
  implements ExternalWithdrawalItemRepository
{
  protected readonly logger = new Logger(ExternalWithdrawalItemPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  protected getDefaultInclude(): Prisma.ExternalWithdrawalItemInclude {
    return {
      item: true,
      externalWithdrawal: true,
    };
  }

  protected mapIncludeToDatabaseInclude(
    include?: ExternalWithdrawalItemInclude,
  ): Prisma.ExternalWithdrawalItemInclude | undefined {
    if (!include) return undefined;

    return {
      item: include.item,
      externalWithdrawal: include.externalWithdrawal,
    };
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: ExternalWithdrawalItemOrderBy): any {
    return orderBy || { createdAt: 'desc' };
  }

  protected mapWhereToDatabaseWhere(
    where?: ExternalWithdrawalItemWhere,
  ): Prisma.ExternalWithdrawalItemWhereInput | undefined {
    if (!where) return undefined;

    return where as any;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ExternalWithdrawalItemCreateFormData,
  ): Prisma.ExternalWithdrawalItemCreateInput {
    return {
      withdrawedQuantity: formData.withdrawedQuantity,
      returnedQuantity: 0,
      price: formData.price,
      item: { connect: { id: formData.itemId } },
      externalWithdrawal: { connect: { id: formData.externalWithdrawalId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ExternalWithdrawalItemUpdateFormData,
  ): Prisma.ExternalWithdrawalItemUpdateInput {
    const updateInput: Prisma.ExternalWithdrawalItemUpdateInput = {};

    if (formData.returnedQuantity !== undefined) {
      updateInput.returnedQuantity = formData.returnedQuantity;
    }
    if (formData.price !== undefined) {
      updateInput.price = formData.price;
    }

    return updateInput;
  }

  protected mapDatabaseEntityToEntity(databaseEntity: any): ExternalWithdrawalItem {
    return {
      id: databaseEntity.id,
      externalWithdrawalId: databaseEntity.externalWithdrawalId,
      itemId: databaseEntity.itemId,
      withdrawedQuantity: databaseEntity.withdrawedQuantity,
      returnedQuantity: databaseEntity.returnedQuantity,
      price: databaseEntity.price,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      ...(databaseEntity.item && { item: databaseEntity.item }),
      ...(databaseEntity.externalWithdrawal && {
        externalWithdrawal: databaseEntity.externalWithdrawal,
      }),
    };
  }

  // WithTransaction method implementations

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ExternalWithdrawalItemCreateFormData,
    options?: CreateOptions<ExternalWithdrawalItemInclude>,
  ): Promise<ExternalWithdrawalItem> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalWithdrawalItem.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar item de retirada externa', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ExternalWithdrawalItemInclude>,
  ): Promise<ExternalWithdrawalItem | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalWithdrawalItem.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item de retirada externa por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ExternalWithdrawalItemInclude>,
  ): Promise<ExternalWithdrawalItem[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.externalWithdrawalItem.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens de retirada externa por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      ExternalWithdrawalItemOrderBy,
      ExternalWithdrawalItemWhere,
      ExternalWithdrawalItemInclude
    >,
  ): Promise<FindManyResult<ExternalWithdrawalItem>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, items] = await Promise.all([
      transaction.externalWithdrawalItem.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.externalWithdrawalItem.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: items.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ExternalWithdrawalItemUpdateFormData,
    options?: UpdateOptions<ExternalWithdrawalItemInclude>,
  ): Promise<ExternalWithdrawalItem> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalWithdrawalItem.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar item de retirada externa ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<ExternalWithdrawalItem> {
    try {
      const result = await transaction.externalWithdrawalItem.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar item de retirada externa ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ExternalWithdrawalItemWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.externalWithdrawalItem.count({ where: whereInput });
    } catch (error) {
      this.logError('contar itens de retirada externa', error, { where });
      throw error;
    }
  }
}
