import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ItemCategory } from '../../../../../types';
import {
  ItemCategoryCreateFormData,
  ItemCategoryUpdateFormData,
  ItemCategoryInclude,
  ItemCategoryOrderBy,
  ItemCategoryWhere,
  ItemInclude,
} from '../../../../../schemas/item';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';
import { ItemCategoryRepository } from './item-category.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ItemCategory as PrismaItemCategory, Prisma } from '@prisma/client';
import { ITEM_CATEGORY_TYPE_ORDER } from '../../../../../constants';

@Injectable()
export class ItemCategoryPrismaRepository
  extends BaseStringPrismaRepository<
    ItemCategory,
    ItemCategoryCreateFormData,
    ItemCategoryUpdateFormData,
    ItemCategoryInclude,
    ItemCategoryOrderBy,
    ItemCategoryWhere,
    PrismaItemCategory,
    Prisma.ItemCategoryCreateInput,
    Prisma.ItemCategoryUpdateInput,
    Prisma.ItemCategoryInclude,
    Prisma.ItemCategoryOrderByWithRelationInput,
    Prisma.ItemCategoryWhereInput
  >
  implements ItemCategoryRepository
{
  protected readonly logger = new Logger(ItemCategoryPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaItemCategory): ItemCategory {
    return databaseEntity as ItemCategory;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ItemCategoryCreateFormData,
  ): Prisma.ItemCategoryCreateInput {
    const { type, ...restData } = formData;

    return {
      ...restData,
      name: formData.name || 'Unnamed Category', // Ensure name is provided
      type,
      typeOrder: type ? ITEM_CATEGORY_TYPE_ORDER[type] : ITEM_CATEGORY_TYPE_ORDER.REGULAR,
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ItemCategoryUpdateFormData,
  ): Prisma.ItemCategoryUpdateInput {
    const { type, ...restData } = formData;

    const updateInput: Prisma.ItemCategoryUpdateInput = {
      ...restData,
    };

    if (type !== undefined) {
      updateInput.type = type;
      updateInput.typeOrder = ITEM_CATEGORY_TYPE_ORDER[type];
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ItemCategoryInclude,
  ): Prisma.ItemCategoryInclude | undefined {
    return include as Prisma.ItemCategoryInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ItemCategoryOrderBy,
  ): Prisma.ItemCategoryOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;

    // Handle array of orderBy objects
    if (Array.isArray(orderBy)) {
      return orderBy.map(order => {
        // Handle items._count sorting
        if (order.items?._count && typeof order.items._count === 'string') {
          return {
            items: {
              _count: order.items._count,
            },
          } as Prisma.ItemCategoryOrderByWithRelationInput;
        }
        return order as Prisma.ItemCategoryOrderByWithRelationInput;
      }) as any;
    }

    // Handle single orderBy object
    // Handle items._count sorting
    if (orderBy.items?._count && typeof orderBy.items._count === 'string') {
      return {
        items: {
          _count: orderBy.items._count,
        },
      } as Prisma.ItemCategoryOrderByWithRelationInput;
    }

    return orderBy as Prisma.ItemCategoryOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: ItemCategoryWhere,
  ): Prisma.ItemCategoryWhereInput | undefined {
    return where as Prisma.ItemCategoryWhereInput;
  }

  protected getDefaultInclude(): Prisma.ItemCategoryInclude {
    return {
      _count: {
        select: {
          items: true,
        },
      },
    };
  }

  // Override findMany to ensure proper default ordering by typeOrder
  async findMany(
    options?: FindManyOptions<ItemCategoryOrderBy, ItemCategoryWhere, ItemCategoryInclude>,
  ): Promise<FindManyResult<ItemCategory>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, categories] = await Promise.all([
      this.prisma.itemCategory.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      this.prisma.itemCategory.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [
          { typeOrder: 'asc' },
          { name: 'asc' },
        ],
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: categories.map(category => this.mapDatabaseEntityToEntity(category)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async findByName(
    name: string,
    options?: { include?: ItemInclude },
  ): Promise<ItemCategory | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await this.prisma.itemCategory.findUnique({
        where: { name },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar categoria por nome ${name}`, error);
      throw error;
    }
  }

  // WithTransaction method implementations

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ItemCategoryCreateFormData,
    options?: CreateOptions<ItemCategoryInclude>,
  ): Promise<ItemCategory> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.itemCategory.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar categoria', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ItemCategoryInclude>,
  ): Promise<ItemCategory | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.itemCategory.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar categoria por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ItemCategoryInclude>,
  ): Promise<ItemCategory[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.itemCategory.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar categorias por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ItemCategoryOrderBy, ItemCategoryWhere, ItemCategoryInclude>,
  ): Promise<FindManyResult<ItemCategory>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, categories] = await Promise.all([
      transaction.itemCategory.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.itemCategory.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [
          { typeOrder: 'asc' },
          { name: 'asc' },
        ],
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: categories.map(category => this.mapDatabaseEntityToEntity(category)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ItemCategoryUpdateFormData,
    options?: UpdateOptions<ItemCategoryInclude>,
  ): Promise<ItemCategory> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.itemCategory.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar categoria ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<ItemCategory> {
    try {
      const result = await transaction.itemCategory.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar categoria ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ItemCategoryWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.itemCategory.count({ where: whereInput });
    } catch (error) {
      this.logError('contar categorias', error, { where });
      throw error;
    }
  }
}
