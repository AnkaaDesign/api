import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { PaintBrand } from '../../../../types';
import {
  PaintBrandCreateFormData,
  PaintBrandUpdateFormData,
  PaintBrandInclude,
  PaintBrandOrderBy,
  PaintBrandWhere,
} from '../../../../schemas/paint';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { PaintBrandRepository } from './paint-brand.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PaintBrand as PrismaPaintBrand, Prisma } from '@prisma/client';

@Injectable()
export class PaintBrandPrismaRepository
  extends BaseStringPrismaRepository<
    PaintBrand,
    PaintBrandCreateFormData,
    PaintBrandUpdateFormData,
    PaintBrandInclude,
    PaintBrandOrderBy,
    PaintBrandWhere,
    PrismaPaintBrand,
    Prisma.PaintBrandCreateInput,
    Prisma.PaintBrandUpdateInput,
    Prisma.PaintBrandInclude,
    Prisma.PaintBrandOrderByWithRelationInput,
    Prisma.PaintBrandWhereInput
  >
  implements PaintBrandRepository
{
  protected readonly logger = new Logger(PaintBrandPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): PaintBrand {
    return databaseEntity as PaintBrand;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PaintBrandCreateFormData,
  ): Prisma.PaintBrandCreateInput {
    const createInput: Prisma.PaintBrandCreateInput = {
      name: formData.name,
    };

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PaintBrandUpdateFormData,
  ): Prisma.PaintBrandUpdateInput {
    const updateInput: Prisma.PaintBrandUpdateInput = {
      ...formData,
    };

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PaintBrandInclude,
  ): Prisma.PaintBrandInclude | undefined {
    if (!include) return undefined;

    const mappedInclude: any = {};

    // Handle _count field - CRITICAL for proper count display
    if (include._count !== undefined) {
      mappedInclude._count = include._count;
    }

    if (include.paints !== undefined) {
      if (typeof include.paints === 'boolean') {
        mappedInclude.paints = include.paints;
      } else {
        mappedInclude.paints = {
          include: include.paints.include || undefined,
          where: include.paints.where || undefined,
          orderBy: include.paints.orderBy || undefined,
          take: include.paints.take || undefined,
          skip: include.paints.skip || undefined,
        };
      }
    }

    if (include.componentItems !== undefined) {
      if (typeof include.componentItems === 'boolean') {
        mappedInclude.componentItems = include.componentItems;
      } else {
        mappedInclude.componentItems = {
          include: include.componentItems.include || undefined,
          where: include.componentItems.where || undefined,
          orderBy: include.componentItems.orderBy || undefined,
          take: include.componentItems.take || undefined,
          skip: include.componentItems.skip || undefined,
        };
      }
    }

    return mappedInclude as Prisma.PaintBrandInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PaintBrandOrderBy,
  ): Prisma.PaintBrandOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PaintBrandOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: PaintBrandWhere,
  ): Prisma.PaintBrandWhereInput | undefined {
    return where as Prisma.PaintBrandWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PaintBrandInclude | undefined {
    return {
      paints: true,
      componentItems: true,
      _count: {
        select: {
          paints: true,
          componentItems: true,
        },
      },
    };
  }

  // Get the correct model accessor from Prisma client
  protected getModelAccessor() {
    return this.prisma.paintBrand;
  }

  // Implement transaction methods required by BaseStringPrismaRepository
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PaintBrandCreateFormData,
    options?: CreateOptions<PaintBrandInclude>,
  ): Promise<PaintBrand> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintBrand.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar marca de tinta', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PaintBrandUpdateFormData,
    options?: UpdateOptions<PaintBrandInclude>,
  ): Promise<PaintBrand> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintBrand.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar marca de tinta ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<PaintBrand> {
    try {
      const result = await transaction.paintBrand.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar marca de tinta ${id}`, error);
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PaintBrandOrderBy, PaintBrandWhere, PaintBrandInclude>,
  ): Promise<FindManyResult<PaintBrand>> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(options?.where);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();
      const orderByInput = this.mapOrderByToDatabaseOrderBy(options?.orderBy) || { name: 'asc' };

      const [data, totalRecords] = await Promise.all([
        transaction.paintBrand.findMany({
          where: whereInput,
          include: includeInput,
          orderBy: orderByInput,
          skip: options?.skip,
          take: options?.take,
        }),
        transaction.paintBrand.count({ where: whereInput }),
      ]);

      const results = data.map(item => this.mapDatabaseEntityToEntity(item));

      const take = options?.take || 40;
      const skip = options?.skip || 0;
      const page = options?.page || Math.floor(skip / take) + 1;
      const totalPages = Math.ceil(totalRecords / take);

      return {
        data: results,
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      this.logError('buscar marcas de tinta', error, { options });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: { include?: PaintBrandInclude },
  ): Promise<PaintBrand | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintBrand.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar marca de tinta por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: PaintBrandInclude },
  ): Promise<PaintBrand[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.paintBrand.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError(`buscar marcas de tinta por IDs`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PaintBrandWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.paintBrand.count({ where: whereInput });
    } catch (error) {
      this.logError('contar marcas de tinta', error, { where });
      throw error;
    }
  }

  // Custom methods specific to PaintBrandRepository
  async findByName(
    name: string,
    options?: { include?: PaintBrandInclude },
  ): Promise<PaintBrand | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await this.prisma.paintBrand.findFirst({
        where: { name },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar marca de tinta por nome ${name}`, error);
      throw error;
    }
  }

  async findByNameWithTransaction(
    transaction: PrismaTransaction,
    name: string,
    options?: { include?: PaintBrandInclude },
  ): Promise<PaintBrand | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintBrand.findFirst({
        where: { name },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar marca de tinta por nome ${name} (transação)`, error);
      throw error;
    }
  }
}
