import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ItemBrand } from '../../../../../types';
import {
  ItemBrandCreateFormData,
  ItemBrandUpdateFormData,
  ItemBrandInclude,
  ItemBrandOrderBy,
  ItemBrandWhere,
} from '../../../../../schemas/item';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';
import { ItemBrandRepository } from './item-brand.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ItemBrand as PrismaItemBrand, Prisma } from '@prisma/client';

@Injectable()
export class ItemBrandPrismaRepository
  extends BaseStringPrismaRepository<
    ItemBrand,
    ItemBrandCreateFormData,
    ItemBrandUpdateFormData,
    ItemBrandInclude,
    ItemBrandOrderBy,
    ItemBrandWhere,
    PrismaItemBrand,
    Prisma.ItemBrandCreateInput,
    Prisma.ItemBrandUpdateInput,
    Prisma.ItemBrandInclude,
    Prisma.ItemBrandOrderByWithRelationInput,
    Prisma.ItemBrandWhereInput
  >
  implements ItemBrandRepository
{
  protected readonly logger = new Logger(ItemBrandPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaItemBrand): ItemBrand {
    return databaseEntity as ItemBrand;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ItemBrandCreateFormData,
  ): Prisma.ItemBrandCreateInput {
    return {
      ...formData,
      name: formData.name || 'Unnamed Brand', // Ensure name is provided
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ItemBrandUpdateFormData,
  ): Prisma.ItemBrandUpdateInput {
    return formData;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ItemBrandInclude,
  ): Prisma.ItemBrandInclude | undefined {
    return include as Prisma.ItemBrandInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ItemBrandOrderBy,
  ): Prisma.ItemBrandOrderByWithRelationInput | undefined {
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
          } as Prisma.ItemBrandOrderByWithRelationInput;
        }
        return order as Prisma.ItemBrandOrderByWithRelationInput;
      }) as any;
    }

    // Handle single orderBy object
    // Handle items._count sorting
    if (orderBy.items?._count && typeof orderBy.items._count === 'string') {
      return {
        items: {
          _count: orderBy.items._count,
        },
      } as Prisma.ItemBrandOrderByWithRelationInput;
    }

    return orderBy as Prisma.ItemBrandOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: ItemBrandWhere,
  ): Prisma.ItemBrandWhereInput | undefined {
    return where as Prisma.ItemBrandWhereInput;
  }

  protected getDefaultInclude(): Prisma.ItemBrandInclude {
    return {
      _count: {
        select: {
          items: true,
        },
      },
    };
  }

  // WithTransaction method implementations

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ItemBrandCreateFormData,
    options?: CreateOptions<ItemBrandInclude>,
  ): Promise<ItemBrand> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.itemBrand.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar marca', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ItemBrandInclude>,
  ): Promise<ItemBrand | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.itemBrand.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar marca por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ItemBrandInclude>,
  ): Promise<ItemBrand[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.itemBrand.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar marcas por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ItemBrandOrderBy, ItemBrandWhere, ItemBrandInclude>,
  ): Promise<FindManyResult<ItemBrand>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, brands] = await Promise.all([
      transaction.itemBrand.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.itemBrand.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: brands.map(brand => this.mapDatabaseEntityToEntity(brand)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ItemBrandUpdateFormData,
    options?: UpdateOptions<ItemBrandInclude>,
  ): Promise<ItemBrand> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.itemBrand.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar marca ${id}`, error, { data });
      throw error;
    }
  }

  async findByName(name: string, include?: ItemBrandInclude): Promise<ItemBrand | null> {
    try {
      const result = await this.prisma.itemBrand.findUnique({
        where: { name },
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar marca por nome ${name}`, error);
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<ItemBrand> {
    try {
      const result = await transaction.itemBrand.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar marca ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ItemBrandWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.itemBrand.count({ where: whereInput });
    } catch (error) {
      this.logError('contar marcas', error, { where });
      throw error;
    }
  }
}
