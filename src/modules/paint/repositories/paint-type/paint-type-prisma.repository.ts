import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { PaintType } from '../../../../types';
import {
  PaintTypeCreateFormData,
  PaintTypeUpdateFormData,
  PaintTypeInclude,
  PaintTypeOrderBy,
  PaintTypeWhere,
} from '../../../../schemas/paint';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { PaintTypeRepository } from './paint-type.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PaintType as PrismaPaintType, Prisma } from '@prisma/client';

@Injectable()
export class PaintTypePrismaRepository
  extends BaseStringPrismaRepository<
    PaintType,
    PaintTypeCreateFormData,
    PaintTypeUpdateFormData,
    PaintTypeInclude,
    PaintTypeOrderBy,
    PaintTypeWhere,
    PrismaPaintType,
    Prisma.PaintTypeCreateInput,
    Prisma.PaintTypeUpdateInput,
    Prisma.PaintTypeInclude,
    Prisma.PaintTypeOrderByWithRelationInput,
    Prisma.PaintTypeWhereInput
  >
  implements PaintTypeRepository
{
  protected readonly logger = new Logger(PaintTypePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): PaintType {
    return databaseEntity as PaintType;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PaintTypeCreateFormData,
  ): Prisma.PaintTypeCreateInput {
    const { componentItemIds, ...rest } = formData;

    const createInput: Prisma.PaintTypeCreateInput = {
      ...rest,
      name: formData.name || 'Unnamed Paint Type', // Ensure name is provided
    };

    if (componentItemIds && componentItemIds.length > 0) {
      createInput.componentItems = {
        connect: componentItemIds.map(id => ({ id })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PaintTypeUpdateFormData,
  ): Prisma.PaintTypeUpdateInput {
    const { componentItemIds, ...rest } = formData;

    const updateInput: Prisma.PaintTypeUpdateInput = {
      ...rest,
    };

    if (componentItemIds !== undefined) {
      updateInput.componentItems = {
        set: componentItemIds.map(id => ({ id })),
      };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PaintTypeInclude,
  ): Prisma.PaintTypeInclude | undefined {
    if (!include) return undefined;

    // Handle nested includes for componentItems
    const mappedInclude: any = {};

    // Handle _count field
    if (include._count !== undefined) {
      mappedInclude._count = include._count;
    }

    if (include.paints !== undefined) {
      mappedInclude.paints = include.paints;
    }

    if (include.componentItems !== undefined) {
      if (typeof include.componentItems === 'boolean') {
        mappedInclude.componentItems = include.componentItems;
      } else {
        // Handle nested include for componentItems
        mappedInclude.componentItems = {
          include: include.componentItems.include || undefined,
          where: include.componentItems.where || undefined,
          orderBy: include.componentItems.orderBy || undefined,
          take: include.componentItems.take || undefined,
          skip: include.componentItems.skip || undefined,
        };
      }
    }

    return mappedInclude as Prisma.PaintTypeInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PaintTypeOrderBy,
  ): Prisma.PaintTypeOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PaintTypeOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: PaintTypeWhere,
  ): Prisma.PaintTypeWhereInput | undefined {
    return where as Prisma.PaintTypeWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PaintTypeInclude | undefined {
    return {
      paints: true,
      componentItems: {
        include: {
          measures: true,
        },
      },
    };
  }

  // Get the correct model accessor from Prisma client
  protected getModelAccessor() {
    return this.prisma.paintType;
  }

  // Implement transaction methods required by BaseStringPrismaRepository
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PaintTypeCreateFormData,
    options?: CreateOptions<PaintTypeInclude>,
  ): Promise<PaintType> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintType.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar tipo de tinta', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PaintTypeUpdateFormData,
    options?: UpdateOptions<PaintTypeInclude>,
  ): Promise<PaintType> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintType.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar tipo de tinta ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<PaintType> {
    try {
      const result = await transaction.paintType.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar tipo de tinta ${id}`, error);
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PaintTypeOrderBy, PaintTypeWhere, PaintTypeInclude>,
  ): Promise<FindManyResult<PaintType>> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(options?.where);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();
      const orderByInput = this.mapOrderByToDatabaseOrderBy(options?.orderBy) || { name: 'asc' };

      const [data, totalRecords] = await Promise.all([
        transaction.paintType.findMany({
          where: whereInput,
          include: includeInput,
          orderBy: orderByInput,
          skip: options?.skip,
          take: options?.take,
        }),
        transaction.paintType.count({ where: whereInput }),
      ]);

      const results = data.map(item => this.mapDatabaseEntityToEntity(item));

      const take = options?.take || 10;
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
      this.logError('buscar tipos de tinta', error, { options });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: { include?: PaintTypeInclude },
  ): Promise<PaintType | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintType.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar tipo de tinta por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: PaintTypeInclude },
  ): Promise<PaintType[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.paintType.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError(`buscar tipos de tinta por IDs`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PaintTypeWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.paintType.count({ where: whereInput });
    } catch (error) {
      this.logError('contar tipos de tinta', error, { where });
      throw error;
    }
  }

  // Custom methods specific to PaintTypeRepository
  async findByName(
    name: string,
    options?: { include?: PaintTypeInclude },
  ): Promise<PaintType | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await this.prisma.paintType.findFirst({
        where: { name },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar tipo de tinta por nome ${name}`, error);
      throw error;
    }
  }

  async findByNameWithTransaction(
    transaction: PrismaTransaction,
    name: string,
    options?: { include?: PaintTypeInclude },
  ): Promise<PaintType | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintType.findFirst({
        where: { name },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar tipo de tinta por nome ${name} (transação)`, error);
      throw error;
    }
  }
}
