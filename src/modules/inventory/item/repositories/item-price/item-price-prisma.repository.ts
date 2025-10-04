import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Price } from '../../../../../types';
import {
  PriceCreateFormData,
  PriceUpdateFormData,
  PriceInclude,
  PriceOrderBy,
  PriceWhere,
} from '../../../../../schemas/item';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { ItemPriceRepository } from './item-price.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Price as PrismaPrice, Prisma } from '@prisma/client';

@Injectable()
export class ItemPricePrismaRepository
  extends BaseStringPrismaRepository<
    Price,
    PriceCreateFormData,
    PriceUpdateFormData,
    PriceInclude,
    PriceOrderBy,
    PriceWhere,
    PrismaPrice,
    Prisma.PriceCreateInput,
    Prisma.PriceUpdateInput,
    Prisma.PriceInclude,
    Prisma.PriceOrderByWithRelationInput,
    Prisma.PriceWhereInput
  >
  implements ItemPriceRepository
{
  protected readonly logger = new Logger(ItemPricePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaPrice): Price {
    return databaseEntity as Price;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PriceCreateFormData,
  ): Prisma.PriceCreateInput {
    const { itemId, ...rest } = formData;
    return {
      ...rest,
      value: formData.value || 0, // Ensure value is provided
      item: { connect: { id: itemId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PriceUpdateFormData,
  ): Prisma.PriceUpdateInput {
    const updateInput: Prisma.PriceUpdateInput = formData;

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: PriceInclude): Prisma.PriceInclude | undefined {
    return include as Prisma.PriceInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PriceOrderBy,
  ): Prisma.PriceOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PriceOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: PriceWhere): Prisma.PriceWhereInput | undefined {
    return where as Prisma.PriceWhereInput;
  }

  protected getDefaultInclude(): Prisma.PriceInclude {
    return {
      item: true,
    };
  }

  // WithTransaction method implementations

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PriceCreateFormData,
    options?: CreateOptions<PriceInclude>,
  ): Promise<Price> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const result = await transaction.price.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });
      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar preço', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PriceUpdateFormData,
    options?: UpdateOptions<PriceInclude>,
  ): Promise<Price> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const result = await transaction.price.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });
      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar preço ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Price> {
    try {
      const result = await transaction.price.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });
      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar preço ${id}`, error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PriceInclude>,
  ): Promise<Price | null> {
    try {
      const result = await transaction.price.findUnique({
        where: { id },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });
      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar preço ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PriceInclude>,
  ): Promise<Price[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.price.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar preços por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PriceOrderBy, PriceWhere, PriceInclude>,
  ): Promise<FindManyResult<Price>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, prices] = await Promise.all([
      transaction.price.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.price.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: prices.map(price => this.mapDatabaseEntityToEntity(price)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: PriceWhere): Promise<number> {
    try {
      return await transaction.price.count({
        where: this.mapWhereToDatabaseWhere(where),
      });
    } catch (error) {
      this.logError('contar preços', error, { where });
      throw error;
    }
  }
}
