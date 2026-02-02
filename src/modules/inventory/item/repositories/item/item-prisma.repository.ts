import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Item } from '@types';
import {
  ItemCreateFormData,
  ItemUpdateFormData,
  ItemInclude,
  ItemOrderBy,
  ItemWhere,
} from '@schemas/item';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '@types';
import { ItemRepository } from './item.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { Item as PrismaItem, Prisma } from '@prisma/client';
import { mapPpeTypeToPrisma, mapPpeSizeToPrisma, mapPpeDeliveryModeToPrisma } from '@utils';
import { PPE_SIZE, PPE_SIZE_ORDER } from '@constants';

@Injectable()
export class ItemPrismaRepository
  extends BaseStringPrismaRepository<
    Item,
    ItemCreateFormData,
    ItemUpdateFormData,
    ItemInclude,
    ItemOrderBy,
    ItemWhere,
    PrismaItem,
    Prisma.ItemCreateInput,
    Prisma.ItemUpdateInput,
    Prisma.ItemInclude,
    Prisma.ItemOrderByWithRelationInput,
    Prisma.ItemWhereInput
  >
  implements ItemRepository
{
  protected readonly logger = new Logger(ItemPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): Item {
    // Convert Decimal fields to numbers
    return {
      ...databaseEntity,
      monthlyConsumption: databaseEntity.monthlyConsumption
        ? Number(databaseEntity.monthlyConsumption)
        : 0,
      monthlyConsumptionTrendPercent: databaseEntity.monthlyConsumptionTrendPercent
        ? Number(databaseEntity.monthlyConsumptionTrendPercent)
        : null,
    } as Item;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ItemCreateFormData,
  ): Prisma.ItemCreateInput {
    const {
      brandId,
      categoryId,
      supplierId,
      ppeType,
      ppeSize,
      ppeDeliveryMode,
      price,
      barcodes,
      measures,
      ...rest
    } = formData;

    // Ensure barcodes is an array
    const barcodesArray = Array.isArray(barcodes) ? barcodes : [];

    // Extract PPE size from measures array if not provided directly
    let effectivePpeSize = ppeSize;
    if (!effectivePpeSize && measures && Array.isArray(measures)) {
      const sizeMeasure = measures.find((m: any) => m.measureType === 'SIZE');
      if (sizeMeasure) {
        // If unit is a letter size (P, M, G, GG, XG), use it directly
        if (sizeMeasure.unit && ['P', 'M', 'G', 'GG', 'XG'].includes(sizeMeasure.unit)) {
          effectivePpeSize = sizeMeasure.unit;
        }
        // If value is a numeric size (36, 38, 40, etc.), convert to SIZE_XX format
        else if (sizeMeasure.value) {
          effectivePpeSize = `SIZE_${sizeMeasure.value}`;
        }
      }
    }

    const createInput: Prisma.ItemCreateInput = {
      ...rest,
      name: formData.name || 'Unnamed Item', // Ensure name is provided
      barcodes: barcodesArray,
      totalPrice: 0, // totalPrice is calculated, not provided
      // Handle optional brand relation
      ...(brandId ? { brand: { connect: { id: brandId } } } : {}),
      // Handle optional category relation
      ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
      // Map PPE fields if present - ensure they are properly typed
      ...(ppeType && { ppeType: mapPpeTypeToPrisma(ppeType) }),
      ...(effectivePpeSize && { ppeSize: mapPpeSizeToPrisma(effectivePpeSize) }),
      ...(ppeDeliveryMode && { ppeDeliveryMode: mapPpeDeliveryModeToPrisma(ppeDeliveryMode) }),
      // Handle price through relation if provided
      ...(price !== undefined && {
        prices: {
          create: {
            value: price,
          },
        },
      }),
      // Measures are handled separately by the service layer
    };

    // Note: ppeSizeOrder is calculated dynamically, not stored in the database

    if (supplierId) {
      createInput.supplier = { connect: { id: supplierId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ItemUpdateFormData,
  ): Prisma.ItemUpdateInput {
    const {
      brandId,
      categoryId,
      supplierId,
      ppeType,
      ppeSize,
      ppeDeliveryMode,
      price,
      measures,
      ...rest
    } = formData;

    // Extract PPE size from measures array if not provided directly
    let effectivePpeSize = ppeSize;
    if (effectivePpeSize === undefined && measures && Array.isArray(measures)) {
      const sizeMeasure = measures.find((m: any) => m.measureType === 'SIZE');
      if (sizeMeasure) {
        // If unit is a letter size (P, M, G, GG, XG), use it directly
        if (sizeMeasure.unit && ['P', 'M', 'G', 'GG', 'XG'].includes(sizeMeasure.unit)) {
          effectivePpeSize = sizeMeasure.unit;
        }
        // If value is a numeric size (36, 38, 40, etc.), convert to SIZE_XX format
        else if (sizeMeasure.value) {
          effectivePpeSize = `SIZE_${sizeMeasure.value}`;
        }
      }
    }

    const updateInput: Prisma.ItemUpdateInput = {
      ...rest,
      // Map PPE fields if present
      ...(ppeType !== undefined && { ppeType: ppeType ? mapPpeTypeToPrisma(ppeType) : null }),
      ...(effectivePpeSize !== undefined && {
        ppeSize: effectivePpeSize ? mapPpeSizeToPrisma(effectivePpeSize) : null,
      }),
      ...(ppeDeliveryMode !== undefined && {
        ppeDeliveryMode: ppeDeliveryMode ? mapPpeDeliveryModeToPrisma(ppeDeliveryMode) : null,
      }),
      // Handle price through relation if provided
      ...(price !== undefined && {
        prices: {
          create: {
            value: price,
          },
        },
      }),
      // Measures are handled separately by the service layer
    };

    // Note: ppeSizeOrder is calculated dynamically, not stored in the database

    // totalPrice is calculated based on quantity and latest price, not updated directly

    if (brandId !== undefined) {
      updateInput.brand = brandId ? { connect: { id: brandId } } : { disconnect: true };
    }

    if (categoryId !== undefined) {
      updateInput.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };
    }

    if (supplierId !== undefined) {
      updateInput.supplier = supplierId ? { connect: { id: supplierId } } : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: ItemInclude): Prisma.ItemInclude | undefined {
    if (!include) return undefined;

    // Deep clone to avoid mutating the original
    const mappedInclude = JSON.parse(JSON.stringify(include));

    // Handle activities include with select
    if (
      mappedInclude.activities &&
      typeof mappedInclude.activities === 'object' &&
      mappedInclude.activities.include
    ) {
      if (mappedInclude.activities.include.user && mappedInclude.activities.include.user.select) {
        // Already has select, no need to change
      } else if (
        mappedInclude.activities.include.user &&
        Object.keys(mappedInclude.activities.include.user).length === 0
      ) {
        // Empty object means include all
        mappedInclude.activities.include.user = true;
      }

      if (mappedInclude.activities.include.order && mappedInclude.activities.include.order.select) {
        // Already has select, no need to change
      } else if (
        mappedInclude.activities.include.order &&
        Object.keys(mappedInclude.activities.include.order).length === 0
      ) {
        // Empty object means include all
        mappedInclude.activities.include.order = true;
      }
    }

    // Handle borrows include with select
    if (
      mappedInclude.borrows &&
      typeof mappedInclude.borrows === 'object' &&
      mappedInclude.borrows.include
    ) {
      if (mappedInclude.borrows.include.user && mappedInclude.borrows.include.user.select) {
        // Already has select, no need to change
      } else if (
        mappedInclude.borrows.include.user &&
        Object.keys(mappedInclude.borrows.include.user).length === 0
      ) {
        // Empty object means include all
        mappedInclude.borrows.include.user = true;
      }

      // Handle empty where clause
      if (mappedInclude.borrows.where && Object.keys(mappedInclude.borrows.where).length === 0) {
        delete mappedInclude.borrows.where;
      }
    }

    // Handle orderItems include with select
    if (
      mappedInclude.orderItems &&
      typeof mappedInclude.orderItems === 'object' &&
      mappedInclude.orderItems.include
    ) {
      if (mappedInclude.orderItems.include.order && mappedInclude.orderItems.include.order.select) {
        // Already has select, no need to change
      } else if (
        mappedInclude.orderItems.include.order &&
        Object.keys(mappedInclude.orderItems.include.order).length === 0
      ) {
        // Empty object means include all
        mappedInclude.orderItems.include.order = true;
      }
    }

    // Handle ppeDeliveries include with select
    if (
      mappedInclude.ppeDeliveries &&
      typeof mappedInclude.ppeDeliveries === 'object' &&
      mappedInclude.ppeDeliveries.include
    ) {
      if (
        mappedInclude.ppeDeliveries.include.user &&
        mappedInclude.ppeDeliveries.include.user.select
      ) {
        // Already has select, no need to change
      } else if (
        mappedInclude.ppeDeliveries.include.user &&
        Object.keys(mappedInclude.ppeDeliveries.include.user).length === 0
      ) {
        // Empty object means include all
        mappedInclude.ppeDeliveries.include.user = true;
      }
    }

    return mappedInclude as Prisma.ItemInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: ItemOrderBy,
  ): Prisma.ItemOrderByWithRelationInput | undefined {
    return orderBy as Prisma.ItemOrderByWithRelationInput | undefined;
  }

  private convertOrderByToCorrectFormat(
    orderBy?: ItemOrderBy,
  ): Prisma.ItemOrderByWithRelationInput | Prisma.ItemOrderByWithRelationInput[] | undefined {
    if (!orderBy) return undefined;

    this.logger.log(
      '[convertOrderByToCorrectFormat] Input orderBy:',
      JSON.stringify(orderBy, null, 2),
    );

    // If it's already an array, return it as-is
    if (Array.isArray(orderBy)) {
      this.logger.log(
        '[convertOrderByToCorrectFormat] OrderBy is array with',
        orderBy.length,
        'items',
      );
      return orderBy as Prisma.ItemOrderByWithRelationInput[];
    }

    // If it's an object, check if it has multiple keys
    if (typeof orderBy === 'object') {
      const keys = Object.keys(orderBy);

      // If multiple keys, convert to array format for Prisma
      if (keys.length > 1) {
        const result = keys.map(key => ({
          [key]: orderBy[key as keyof typeof orderBy],
        })) as Prisma.ItemOrderByWithRelationInput[];
        this.logger.log(
          '[convertOrderByToCorrectFormat] Multiple keys, converting to array:',
          JSON.stringify(result, null, 2),
        );
        return result;
      }

      // Single key, return as object
      this.logger.log('[convertOrderByToCorrectFormat] Single key object');
      return orderBy as Prisma.ItemOrderByWithRelationInput;
    }

    return orderBy as Prisma.ItemOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: ItemWhere): Prisma.ItemWhereInput | undefined {
    return where as Prisma.ItemWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.ItemInclude | undefined {
    return {
      brand: true,
      category: true,
      supplier: true,
      prices: {
        orderBy: {
          updatedAt: 'desc',
        },
        take: 1,
      },
    };
  }

  /**
   * Get optimized select for list views (comboboxes, tables, etc.)
   * Only includes essential fields to minimize data transfer
   */
  protected getListSelect(): Prisma.ItemSelect {
    return {
      id: true,
      name: true,
      uniCode: true,
      quantity: true,
      isActive: true,
      brandId: true,
      categoryId: true,
      supplierId: true,
      createdAt: true,
      updatedAt: true,
      brand: {
        select: {
          id: true,
          name: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      supplier: {
        select: {
          id: true,
          fantasyName: true,
        },
      },
      prices: {
        select: {
          id: true,
          value: true,
          updatedAt: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: 1,
      },
    };
  }

  /**
   * Get minimal select for comboboxes
   * Only includes id and name fields
   */
  protected getComboboxSelect(): Prisma.ItemSelect {
    return {
      id: true,
      name: true,
      uniCode: true,
      isActive: true,
    };
  }

  /**
   * Get optimized select for form views
   * Includes all fields needed for editing
   */
  protected getFormSelect(): Prisma.ItemSelect {
    return {
      id: true,
      name: true,
      uniCode: true,
      quantity: true,
      maxQuantity: true,
      reorderPoint: true,
      reorderQuantity: true,
      boxQuantity: true,
      isManualMaxQuantity: true,
      isManualReorderPoint: true,
      lastAutoOrderDate: true,
      icms: true,
      ipi: true,
      totalPrice: true,
      monthlyConsumption: true,
      monthlyConsumptionTrendPercent: true,
      barcodes: true,
      shouldAssignToUser: true,
      abcCategory: true,
      abcCategoryOrder: true,
      xyzCategory: true,
      xyzCategoryOrder: true,
      brandId: true,
      categoryId: true,
      supplierId: true,
      estimatedLeadTime: true,
      isActive: true,
      ppeType: true,
      ppeCA: true,
      ppeDeliveryMode: true,
      ppeStandardQuantity: true,
      createdAt: true,
      updatedAt: true,
      brand: {
        select: {
          id: true,
          name: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      supplier: {
        select: {
          id: true,
          fantasyName: true,
          corporateName: true,
        },
      },
      prices: {
        select: {
          id: true,
          value: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: 5,
      },
      measures: {
        select: {
          id: true,
          value: true,
          unit: true,
          measureType: true,
        },
      },
    };
  }

  /**
   * Get optimized select for detail views
   * Includes comprehensive data for viewing item details
   */
  protected getDetailSelect(): Prisma.ItemSelect {
    return {
      id: true,
      name: true,
      uniCode: true,
      quantity: true,
      maxQuantity: true,
      reorderPoint: true,
      reorderQuantity: true,
      boxQuantity: true,
      isManualMaxQuantity: true,
      isManualReorderPoint: true,
      lastAutoOrderDate: true,
      icms: true,
      ipi: true,
      totalPrice: true,
      monthlyConsumption: true,
      monthlyConsumptionTrendPercent: true,
      barcodes: true,
      shouldAssignToUser: true,
      abcCategory: true,
      abcCategoryOrder: true,
      xyzCategory: true,
      xyzCategoryOrder: true,
      brandId: true,
      categoryId: true,
      supplierId: true,
      estimatedLeadTime: true,
      isActive: true,
      ppeType: true,
      ppeCA: true,
      ppeDeliveryMode: true,
      ppeStandardQuantity: true,
      createdAt: true,
      updatedAt: true,
      brand: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          type: true,
          typeOrder: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      supplier: {
        select: {
          id: true,
          fantasyName: true,
          corporateName: true,
          cnpj: true,
          email: true,
          phones: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      prices: {
        select: {
          id: true,
          value: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: 10,
      },
      measures: {
        select: {
          id: true,
          value: true,
          unit: true,
          measureType: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      _count: {
        select: {
          activities: true,
          borrows: true,
          orderItems: true,
          ppeDelivery: true,
        },
      },
    };
  }

  // WithTransaction method implementations

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ItemCreateFormData,
    options?: CreateOptions<ItemInclude>,
  ): Promise<Item> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options?.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const result = await transaction.item.create({
        data: createInput as any,
        include: includeInput,
      });

      // Calculate and update totalPrice based on quantity and latest price
      if (
        'prices' in result &&
        result.prices &&
        Array.isArray(result.prices) &&
        result.prices.length > 0 &&
        result.quantity
      ) {
        const latestPrice = result.prices[0]?.value ?? 0;
        const totalPrice = result.quantity * latestPrice;

        // Update the totalPrice
        const updatedResult = await transaction.item.update({
          where: { id: result.id },
          data: { totalPrice },
          include: includeInput as any,
        });

        return this.mapDatabaseEntityToEntity(updatedResult);
      }

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar item', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ItemInclude>,
  ): Promise<Item | null> {
    try {
      // If no custom include is provided, use optimized select
      const useOptimizedSelect = !options?.include || Object.keys(options.include).length === 0;

      if (useOptimizedSelect) {
        const result = await transaction.item.findUnique({
          where: { id },
          select: this.getFormSelect(),
        });

        return result ? this.mapDatabaseEntityToEntity(result) : null;
      }

      // Use include when custom include is provided (backward compatibility)
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const result = await transaction.item.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ItemInclude>,
  ): Promise<Item[]> {
    try {
      // If no custom include is provided, use optimized select
      const useOptimizedSelect = !options?.include || Object.keys(options.include).length === 0;

      if (useOptimizedSelect) {
        const results = await transaction.item.findMany({
          where: { id: { in: ids } },
          select: this.getListSelect(),
        });

        return results.map(result => this.mapDatabaseEntityToEntity(result));
      }

      // Use include when custom include is provided (backward compatibility)
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const results = await transaction.item.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<ItemOrderBy, ItemWhere, ItemInclude>,
  ): Promise<FindManyResult<Item>> {
    // Map 'limit' to 'take' for compatibility with schema
    const optionsWithTake = options
      ? { ...options, take: (options as any).limit || options.take }
      : {};
    const {
      where,
      orderBy,
      page = 1,
      take = 20,
      include,
    } = optionsWithTake as {
      where?: ItemWhere;
      orderBy?: ItemOrderBy;
      page?: number;
      take?: number;
      include?: ItemInclude;
    };
    const skip = Math.max(0, (page - 1) * take);

    // Check if price sorting is requested (only for prices[0].value, not totalPrice)
    const hasPriceSort = this.hasPriceSorting(orderBy);

    if (hasPriceSort) {
      return this.findManyWithPriceSort(transaction, { where, orderBy, page, take, include });
    }

    // Use normal Prisma sorting for totalPrice and other fields
    const prismaOrderBy = this.convertOrderByToCorrectFormat(orderBy) || { name: 'asc' };

    // If no custom include is provided, use optimized select instead
    // This significantly reduces data transfer
    const useOptimizedSelect = !include || Object.keys(include).length === 0;

    if (useOptimizedSelect) {
      const [total, items] = await Promise.all([
        transaction.item.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.item.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: prismaOrderBy,
          skip,
          take,
          select: this.getListSelect(),
        }),
      ]);

      return {
        data: items.map(item => this.mapDatabaseEntityToEntity(item)),
        meta: this.calculatePagination(total, page, take),
      };
    }

    // Use include when custom include is provided (backward compatibility)
    const defaultInclude = this.getDefaultInclude();
    const mappedInclude = this.mapIncludeToDatabaseInclude(include);
    const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

    const [total, items] = await Promise.all([
      transaction.item.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.item.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: prismaOrderBy,
        skip,
        take,
        include: includeInput,
      }),
    ]);

    return {
      data: items.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  private hasPriceSorting(orderBy?: ItemOrderBy): boolean {
    if (!orderBy) return false;

    // Check if we need custom price sorting (for prices[0].value)
    if (Array.isArray(orderBy)) {
      return orderBy.some(order => order && typeof order === 'object' && 'price' in order);
    }

    // For object format, check if 'price' field is present
    return typeof orderBy === 'object' && 'price' in orderBy;
  }

  private async findManyWithPriceSort(
    transaction: PrismaTransaction,
    options: FindManyOptions<ItemOrderBy, ItemWhere, ItemInclude>,
  ): Promise<FindManyResult<Item>> {
    // Map 'limit' to 'take' for compatibility with schema
    const optionsWithTake = { ...options, take: (options as any).limit || options.take };
    const { where, orderBy, page = 1, take = 20, include } = optionsWithTake;
    const skip = Math.max(0, (page - 1) * take);

    // BETTER APPROACH: Use regular Prisma query but handle the sorting afterward
    // This ensures all filters work correctly and we have proper type safety

    const prismaWhere = this.mapWhereToDatabaseWhere(where);
    const defaultInclude = this.getDefaultInclude();
    const mappedInclude = this.mapIncludeToDatabaseInclude(include);
    const prismaInclude = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

    // Get all items that match the filter first (without sorting)
    const [total, allFilteredItems] = await Promise.all([
      transaction.item.count({
        where: prismaWhere,
      }),
      transaction.item.findMany({
        where: prismaWhere,
        include: prismaInclude,
      }),
    ]);

    // Sort items in memory based on the orderBy criteria
    const sortedItems = this.sortItemsByPrice(allFilteredItems, orderBy);

    // Apply pagination to the sorted results
    const paginatedItems = sortedItems.slice(skip, skip + take);

    return {
      data: paginatedItems.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  private sortItemsByPrice(items: any[], orderBy?: ItemOrderBy): any[] {
    if (!orderBy) return items;

    const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];

    return items.sort((a, b) => {
      for (const order of orderByArray) {
        if (!order || typeof order !== 'object') continue;

        for (const [field, direction] of Object.entries(order)) {
          const isAsc = direction === 'asc';
          let comparison = 0;

          if (field === 'price') {
            // Compare by current price (prices[0].value)
            const aPrice = a.prices?.[0]?.value || 0;
            const bPrice = b.prices?.[0]?.value || 0;
            comparison = aPrice - bPrice;
          } else if (field === 'brand' && typeof direction === 'object' && direction.name) {
            // Compare by brand name
            const aName = a.brand?.name || '';
            const bName = b.brand?.name || '';
            comparison = aName.localeCompare(bName);
            if (!isAsc) comparison = -comparison;
            continue;
          } else if (field === 'category' && typeof direction === 'object' && direction.name) {
            // Compare by category name
            const aName = a.category?.name || '';
            const bName = b.category?.name || '';
            comparison = aName.localeCompare(bName);
            if (!isAsc) comparison = -comparison;
            continue;
          } else if (
            field === 'supplier' &&
            typeof direction === 'object' &&
            'fantasyName' in direction
          ) {
            // Compare by supplier fantasy name
            const supplierDirection = direction as any;
            const aName = a.supplier?.fantasyName || '';
            const bName = b.supplier?.fantasyName || '';
            comparison = aName.localeCompare(bName);
            const supplierIsAsc = supplierDirection.fantasyName === 'asc';
            if (!supplierIsAsc) comparison = -comparison;
            continue;
          } else {
            // Handle other fields
            const aValue = a[field];
            const bValue = b[field];

            if (aValue === null && bValue === null) comparison = 0;
            else if (aValue === null) comparison = 1;
            else if (bValue === null) comparison = -1;
            else if (typeof aValue === 'string') comparison = aValue.localeCompare(bValue);
            else if (typeof aValue === 'number') comparison = aValue - bValue;
            else if (aValue instanceof Date && bValue instanceof Date)
              comparison = aValue.getTime() - bValue.getTime();
            else comparison = String(aValue).localeCompare(String(bValue));
          }

          if (!isAsc) comparison = -comparison;

          if (comparison !== 0) return comparison;
        }
      }
      return 0;
    });
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ItemUpdateFormData,
    options?: UpdateOptions<ItemInclude>,
  ): Promise<Item> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options?.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      // If quantity is being updated, we need to recalculate totalPrice
      if (data.quantity !== undefined) {
        // Get the current item with its latest price
        const currentItem = await transaction.item.findUnique({
          where: { id },
          include: {
            prices: {
              orderBy: {
                updatedAt: 'desc',
              },
              take: 1,
            },
          },
        });

        if (
          currentItem &&
          currentItem.prices &&
          Array.isArray(currentItem.prices) &&
          currentItem.prices.length > 0
        ) {
          updateInput.totalPrice = (currentItem.prices[0]?.value ?? 0) * data.quantity;
        } else {
          updateInput.totalPrice = 0;
        }
      }

      const result = await transaction.item.update({
        where: { id },
        data: updateInput as any,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar item ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Item> {
    try {
      const result = await transaction.item.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar item ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: ItemWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.item.count({ where: whereInput });
    } catch (error) {
      this.logError('contar itens', error, { where });
      throw error;
    }
  }

  async findByBarcode(barcode: string, options?: { include?: ItemInclude }): Promise<Item | null> {
    try {
      // If no custom include is provided, use optimized select
      const useOptimizedSelect = !options?.include || Object.keys(options.include).length === 0;

      if (useOptimizedSelect) {
        const result = await this.prisma.item.findFirst({
          where: {
            barcodes: {
              has: barcode,
            },
          },
          select: this.getFormSelect(),
        });

        return result ? this.mapDatabaseEntityToEntity(result) : null;
      }

      // Use include when custom include is provided (backward compatibility)
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const result = await this.prisma.item.findFirst({
        where: {
          barcodes: {
            has: barcode,
          },
        },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item por código de barras ${barcode}`, error);
      throw error;
    }
  }

  async findByBarcodeWithTransaction(
    transaction: PrismaTransaction,
    barcode: string,
    options?: { include?: ItemInclude },
  ): Promise<Item | null> {
    try {
      // If no custom include is provided, use optimized select
      const useOptimizedSelect = !options?.include || Object.keys(options.include).length === 0;

      if (useOptimizedSelect) {
        const result = await transaction.item.findFirst({
          where: {
            barcodes: {
              has: barcode,
            },
          },
          select: this.getFormSelect(),
        });

        return result ? this.mapDatabaseEntityToEntity(result) : null;
      }

      // Use include when custom include is provided (backward compatibility)
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const result = await transaction.item.findFirst({
        where: {
          barcodes: {
            has: barcode,
          },
        },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item por código de barras ${barcode}`, error);
      throw error;
    }
  }

  async findByName(name: string, options?: { include?: ItemInclude }): Promise<Item | null> {
    try {
      // If no custom include is provided, use optimized select
      const useOptimizedSelect = !options?.include || Object.keys(options.include).length === 0;

      if (useOptimizedSelect) {
        const result = await this.prisma.item.findFirst({
          where: { name },
          select: this.getFormSelect(),
        });

        return result ? this.mapDatabaseEntityToEntity(result) : null;
      }

      // Use include when custom include is provided (backward compatibility)
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const result = await this.prisma.item.findFirst({
        where: { name },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item por nome ${name}`, error);
      throw error;
    }
  }

  async findByNameWithTransaction(
    transaction: PrismaTransaction,
    name: string,
    options?: { include?: ItemInclude },
  ): Promise<Item | null> {
    try {
      // If no custom include is provided, use optimized select
      const useOptimizedSelect = !options?.include || Object.keys(options.include).length === 0;

      if (useOptimizedSelect) {
        const result = await transaction.item.findFirst({
          where: { name },
          select: this.getFormSelect(),
        });

        return result ? this.mapDatabaseEntityToEntity(result) : null;
      }

      // Use include when custom include is provided (backward compatibility)
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const result = await transaction.item.findFirst({
        where: { name },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item por nome ${name}`, error);
      throw error;
    }
  }

  async findByIds(ids: string[], options?: { include?: ItemInclude }): Promise<Item[]> {
    try {
      // If no custom include is provided, use optimized select
      const useOptimizedSelect = !options?.include || Object.keys(options.include).length === 0;

      if (useOptimizedSelect) {
        const results = await this.prisma.item.findMany({
          where: { id: { in: ids } },
          select: this.getListSelect(),
        });

        return results.map(result => this.mapDatabaseEntityToEntity(result));
      }

      // Use include when custom include is provided (backward compatibility)
      const defaultInclude = this.getDefaultInclude();
      const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
      const includeInput = mappedInclude ? { ...defaultInclude, ...mappedInclude } : defaultInclude;

      const results = await this.prisma.item.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens por IDs', error, { ids });
      throw error;
    }
  }

  // =====================
  // Optimized Query Methods
  // =====================

  /**
   * Find many items with list-optimized select
   * Use this for table views and lists where you need basic item info
   * @returns Items with minimal fields for list display
   */
  async findManyForList(
    options?: FindManyOptions<ItemOrderBy, ItemWhere, ItemInclude>,
  ): Promise<FindManyResult<Item>> {
    const {
      where,
      orderBy,
      page = 1,
      take = 20,
    } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    // Check if price sorting is requested
    const hasPriceSort = this.hasPriceSorting(orderBy);

    if (hasPriceSort) {
      // Use the existing price sort logic for in-memory sorting
      return this.findManyWithPriceSortOptimized(options, this.getListSelect());
    }

    const prismaOrderBy = this.convertOrderByToCorrectFormat(orderBy) || { name: 'asc' };
    const prismaWhere = this.mapWhereToDatabaseWhere(where);

    const [total, items] = await Promise.all([
      this.prisma.item.count({ where: prismaWhere }),
      this.prisma.item.findMany({
        where: prismaWhere,
        orderBy: prismaOrderBy,
        skip,
        take,
        select: this.getListSelect(),
      }),
    ]);

    return {
      data: items.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  /**
   * Find many items for combobox/dropdown
   * Returns only id and name fields
   * @returns Minimal item data for comboboxes
   */
  async findManyForCombobox(
    options?: FindManyOptions<ItemOrderBy, ItemWhere, ItemInclude>,
  ): Promise<FindManyResult<Item>> {
    const {
      where,
      orderBy,
      page = 1,
      take = 100,
    } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const prismaOrderBy = this.convertOrderByToCorrectFormat(orderBy) || { name: 'asc' };
    const prismaWhere = this.mapWhereToDatabaseWhere(where);

    const [total, items] = await Promise.all([
      this.prisma.item.count({ where: prismaWhere }),
      this.prisma.item.findMany({
        where: prismaWhere,
        orderBy: prismaOrderBy,
        skip,
        take,
        select: this.getComboboxSelect(),
      }),
    ]);

    return {
      data: items.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  /**
   * Find item by ID with form-optimized select
   * Use this when loading items for editing
   * @returns Item with all fields needed for forms
   */
  async findByIdForForm(id: string): Promise<Item | null> {
    try {
      const result = await this.prisma.item.findUnique({
        where: { id },
        select: this.getFormSelect(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item por ID para formulário ${id}`, error);
      throw error;
    }
  }

  /**
   * Find item by ID with detail-optimized select
   * Use this for detail/view pages
   * @returns Item with comprehensive data for viewing
   */
  async findByIdForDetail(id: string): Promise<Item | null> {
    try {
      const result = await this.prisma.item.findUnique({
        where: { id },
        select: this.getDetailSelect(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item por ID para detalhes ${id}`, error);
      throw error;
    }
  }

  /**
   * Find items by IDs with list-optimized select
   * Use this for bulk operations where you need basic item info
   * @returns Items with minimal fields for list display
   */
  async findByIdsForList(ids: string[]): Promise<Item[]> {
    try {
      const results = await this.prisma.item.findMany({
        where: { id: { in: ids } },
        select: this.getListSelect(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens por IDs para lista', error, { ids });
      throw error;
    }
  }

  /**
   * Find items by IDs for combobox
   * Returns only essential fields
   * @returns Minimal item data
   */
  async findByIdsForCombobox(ids: string[]): Promise<Item[]> {
    try {
      const results = await this.prisma.item.findMany({
        where: { id: { in: ids } },
        select: this.getComboboxSelect(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens por IDs para combobox', error, { ids });
      throw error;
    }
  }

  /**
   * Helper method for price sorting with custom select
   */
  private async findManyWithPriceSortOptimized(
    options: FindManyOptions<ItemOrderBy, ItemWhere, ItemInclude> | undefined,
    customSelect: Prisma.ItemSelect,
  ): Promise<FindManyResult<Item>> {
    const { where, orderBy, page = 1, take = 20 } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const prismaWhere = this.mapWhereToDatabaseWhere(where);

    // Get all items that match the filter first (without sorting)
    const [total, allFilteredItems] = await Promise.all([
      this.prisma.item.count({ where: prismaWhere }),
      this.prisma.item.findMany({
        where: prismaWhere,
        select: customSelect,
      }),
    ]);

    // Sort items in memory based on the orderBy criteria
    const sortedItems = this.sortItemsByPrice(allFilteredItems, orderBy);

    // Apply pagination to the sorted results
    const paginatedItems = sortedItems.slice(skip, skip + take);

    return {
      data: paginatedItems.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }
}
