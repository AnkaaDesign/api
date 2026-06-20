// repositories/warehouse-location-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { WarehouseLocation } from '../../../../types';
import {
  WarehouseLocationCreateFormData,
  WarehouseLocationUpdateFormData,
  WarehouseLocationInclude,
  WarehouseLocationOrderBy,
  WarehouseLocationWhere,
} from '../../../../schemas/warehouse-location';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { WarehouseLocationRepository } from './warehouse-location.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class WarehouseLocationPrismaRepository
  extends BaseStringPrismaRepository<
    WarehouseLocation,
    WarehouseLocationCreateFormData,
    WarehouseLocationUpdateFormData,
    WarehouseLocationInclude,
    WarehouseLocationOrderBy,
    WarehouseLocationWhere,
    Prisma.WarehouseLocationGetPayload<{ include: any }>,
    Prisma.WarehouseLocationCreateInput,
    Prisma.WarehouseLocationUpdateInput,
    Prisma.WarehouseLocationInclude,
    Prisma.WarehouseLocationOrderByWithRelationInput,
    Prisma.WarehouseLocationWhereInput
  >
  implements WarehouseLocationRepository
{
  protected readonly logger = new Logger(WarehouseLocationPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): WarehouseLocation {
    return {
      id: databaseEntity.id,
      name: databaseEntity.name,
      type: databaseEntity.type,
      section: databaseEntity.section ?? null,
      code: databaseEntity.code ?? null,
      description: databaseEntity.description ?? null,
      isActive: databaseEntity.isActive,
      positionX: databaseEntity.positionX,
      positionY: databaseEntity.positionY,
      width: databaseEntity.width,
      height: databaseEntity.height,
      rotation: databaseEntity.rotation,
      levels: databaseEntity.levels,
      columns: databaseEntity.columns,
      columnsPerLevel: databaseEntity.columnsPerLevel ?? [],
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      // Relations
      items: databaseEntity.items,
      // Count aggregations
      _count: databaseEntity._count,
    };
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: WarehouseLocationCreateFormData,
  ): Prisma.WarehouseLocationCreateInput {
    if (!formData.name) {
      throw new Error('Nome é obrigatório para criar uma localização');
    }

    const input: Prisma.WarehouseLocationCreateInput = {
      name: formData.name,
      section: formData.section ?? null,
      code: formData.code ?? null,
      description: formData.description ?? null,
      isActive: formData.isActive ?? true,
    };

    if (formData.type !== undefined) input.type = formData.type;
    if (formData.levels !== undefined) input.levels = formData.levels;
    if (formData.columns !== undefined) input.columns = formData.columns;
    if (formData.columnsPerLevel !== undefined) input.columnsPerLevel = formData.columnsPerLevel;
    if (formData.positionX !== undefined) input.positionX = formData.positionX;
    if (formData.positionY !== undefined) input.positionY = formData.positionY;
    if (formData.width !== undefined) input.width = formData.width;
    if (formData.height !== undefined) input.height = formData.height;
    if (formData.rotation !== undefined) input.rotation = formData.rotation;

    return input;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: WarehouseLocationUpdateFormData,
  ): Prisma.WarehouseLocationUpdateInput {
    const updateInput: Prisma.WarehouseLocationUpdateInput = {};

    if (formData.name !== undefined) updateInput.name = formData.name;
    if (formData.type !== undefined) updateInput.type = formData.type;
    if (formData.section !== undefined) updateInput.section = formData.section;
    if (formData.code !== undefined) updateInput.code = formData.code;
    if (formData.description !== undefined) updateInput.description = formData.description;
    if (formData.isActive !== undefined) updateInput.isActive = formData.isActive;
    if (formData.levels !== undefined) updateInput.levels = formData.levels;
    if (formData.columns !== undefined) updateInput.columns = formData.columns;
    if (formData.columnsPerLevel !== undefined)
      updateInput.columnsPerLevel = formData.columnsPerLevel;
    if (formData.positionX !== undefined) updateInput.positionX = formData.positionX;
    if (formData.positionY !== undefined) updateInput.positionY = formData.positionY;
    if (formData.width !== undefined) updateInput.width = formData.width;
    if (formData.height !== undefined) updateInput.height = formData.height;
    if (formData.rotation !== undefined) updateInput.rotation = formData.rotation;

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: WarehouseLocationInclude,
  ): Prisma.WarehouseLocationInclude | undefined {
    if (!include) return undefined;

    const { _count, ...rest } = include as any;
    const prismaInclude: any = { ...rest };
    if (_count) {
      prismaInclude._count = _count;
    }
    return prismaInclude as Prisma.WarehouseLocationInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: WarehouseLocationOrderBy,
  ): Prisma.WarehouseLocationOrderByWithRelationInput | undefined {
    return orderBy as Prisma.WarehouseLocationOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: WarehouseLocationWhere,
  ): Prisma.WarehouseLocationWhereInput | undefined {
    return where as Prisma.WarehouseLocationWhereInput;
  }

  protected getDefaultInclude(): Prisma.WarehouseLocationInclude {
    return {
      _count: {
        select: {
          items: true,
        },
      },
    } as any;
  }

  // =====================
  // Override required transaction methods from base class
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: WarehouseLocationCreateFormData,
    options?: CreateOptions<WarehouseLocationInclude>,
  ): Promise<WarehouseLocation> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.warehouseLocation.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar localização', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<WarehouseLocationInclude>,
  ): Promise<WarehouseLocation | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.warehouseLocation.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar localização por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<WarehouseLocationInclude>,
  ): Promise<WarehouseLocation[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.warehouseLocation.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar localizações por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      WarehouseLocationOrderBy,
      WarehouseLocationWhere,
      WarehouseLocationInclude
    >,
  ): Promise<FindManyResult<WarehouseLocation>> {
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
      where?: WarehouseLocationWhere;
      orderBy?: WarehouseLocationOrderBy;
      page?: number;
      take?: number;
      include?: WarehouseLocationInclude;
    };
    const skip = Math.max(0, (page - 1) * take);

    const [total, locations] = await Promise.all([
      transaction.warehouseLocation.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.warehouseLocation.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [{ name: 'asc' }],
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: locations.map(location => this.mapDatabaseEntityToEntity(location)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: WarehouseLocationUpdateFormData,
    options?: UpdateOptions<WarehouseLocationInclude>,
  ): Promise<WarehouseLocation> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.warehouseLocation.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar localização ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<WarehouseLocation> {
    try {
      const result = await transaction.warehouseLocation.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar localização ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: WarehouseLocationWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.warehouseLocation.count({ where: whereInput });
    } catch (error) {
      this.logError('contar localizações', error, { where });
      throw error;
    }
  }

  async findByCode(code: string, tx?: PrismaTransaction): Promise<WarehouseLocation | null> {
    const transaction = tx || this.prisma;
    try {
      const result = await transaction.warehouseLocation.findFirst({
        where: { code },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar localização por código ${code}`, error);
      throw error;
    }
  }
}
