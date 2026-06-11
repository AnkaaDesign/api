// repositories/external-operation-item/external-operation-item-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ExternalOperationItem } from '../../../../../types';
import {
  ExternalOperationItemCreateFormData,
  ExternalOperationItemUpdateFormData,
  ExternalOperationItemInclude,
  ExternalOperationItemOrderBy,
  ExternalOperationItemWhere,
} from '../../../../../schemas';
import { ExternalOperationItemRepository } from './external-operation-item.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { Prisma, ExternalOperationItem as PrismaExternalOperationItem } from '@prisma/client';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';

@Injectable()
export class ExternalOperationItemPrismaRepository
  extends BaseStringPrismaRepository<
    ExternalOperationItem,
    ExternalOperationItemCreateFormData,
    ExternalOperationItemUpdateFormData,
    ExternalOperationItemInclude,
    ExternalOperationItemOrderBy,
    ExternalOperationItemWhere,
    PrismaExternalOperationItem,
    Prisma.ExternalOperationItemCreateInput,
    Prisma.ExternalOperationItemUpdateInput,
    Prisma.ExternalOperationItemInclude,
    Prisma.ExternalOperationItemOrderByWithRelationInput,
    Prisma.ExternalOperationItemWhereInput
  >
  implements ExternalOperationItemRepository
{
  protected readonly logger = new Logger(ExternalOperationItemPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  protected getDefaultInclude(): Prisma.ExternalOperationItemInclude {
    return {
      item: true,
      externalOperation: true,
    };
  }

  protected mapIncludeToDatabaseInclude(
    include?: ExternalOperationItemInclude,
  ): Prisma.ExternalOperationItemInclude | undefined {
    if (!include) return undefined;

    return {
      item: include.item,
      externalOperation: include.externalOperation,
    };
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: ExternalOperationItemOrderBy): any {
    return orderBy || { createdAt: 'desc' };
  }

  protected mapWhereToDatabaseWhere(
    where?: ExternalOperationItemWhere,
  ): Prisma.ExternalOperationItemWhereInput | undefined {
    if (!where) return undefined;

    return where as any;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ExternalOperationItemCreateFormData,
  ): Prisma.ExternalOperationItemCreateInput {
    return {
      withdrawedQuantity: formData.withdrawedQuantity,
      returnedQuantity: 0,
      price: formData.price,
      item: { connect: { id: formData.itemId } },
      externalOperation: { connect: { id: formData.externalOperationId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ExternalOperationItemUpdateFormData,
  ): Prisma.ExternalOperationItemUpdateInput {
    const updateInput: Prisma.ExternalOperationItemUpdateInput = {};

    if (formData.returnedQuantity !== undefined) {
      updateInput.returnedQuantity = formData.returnedQuantity;
    }
    if (formData.price !== undefined) {
      updateInput.price = formData.price;
    }

    return updateInput;
  }

  protected mapDatabaseEntityToEntity(databaseEntity: any): ExternalOperationItem {
    return {
      id: databaseEntity.id,
      externalOperationId: databaseEntity.externalOperationId,
      itemId: databaseEntity.itemId,
      withdrawedQuantity: databaseEntity.withdrawedQuantity,
      returnedQuantity: databaseEntity.returnedQuantity,
      price: databaseEntity.price,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      ...(databaseEntity.item && { item: databaseEntity.item }),
      ...(databaseEntity.externalOperation && {
        externalOperation: databaseEntity.externalOperation,
      }),
    };
  }

  // WithTransaction method implementations

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ExternalOperationItemCreateFormData,
    options?: CreateOptions<ExternalOperationItemInclude>,
  ): Promise<ExternalOperationItem> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalOperationItem.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar item de operação externa', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ExternalOperationItemInclude>,
  ): Promise<ExternalOperationItem | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalOperationItem.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item de operação externa por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ExternalOperationItemInclude>,
  ): Promise<ExternalOperationItem[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.externalOperationItem.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens de operação externa por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      ExternalOperationItemOrderBy,
      ExternalOperationItemWhere,
      ExternalOperationItemInclude
    >,
  ): Promise<FindManyResult<ExternalOperationItem>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, items] = await Promise.all([
      transaction.externalOperationItem.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.externalOperationItem.findMany({
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
    data: ExternalOperationItemUpdateFormData,
    options?: UpdateOptions<ExternalOperationItemInclude>,
  ): Promise<ExternalOperationItem> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalOperationItem.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar item de operação externa ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<ExternalOperationItem> {
    try {
      const result = await transaction.externalOperationItem.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar item de operação externa ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ExternalOperationItemWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.externalOperationItem.count({ where: whereInput });
    } catch (error) {
      this.logError('contar itens de operação externa', error, { where });
      throw error;
    }
  }
}
