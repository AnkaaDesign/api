// repositories/position-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Position } from '@types';
import {
  PositionCreateFormData,
  PositionUpdateFormData,
  PositionInclude,
  PositionOrderBy,
  PositionWhere,
} from '@schemas/position';
import { PositionRepository } from './position.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '@types';

@Injectable()
export class PositionPrismaRepository
  extends BaseStringPrismaRepository<
    Position,
    PositionCreateFormData,
    PositionUpdateFormData,
    PositionInclude,
    PositionOrderBy,
    PositionWhere,
    Prisma.PositionGetPayload<{ include: any }>,
    Prisma.PositionCreateInput,
    Prisma.PositionUpdateInput,
    Prisma.PositionInclude,
    Prisma.PositionOrderByWithRelationInput,
    Prisma.PositionWhereInput
  >
  implements PositionRepository
{
  protected readonly logger = new Logger(PositionPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Position {
    const position = databaseEntity as Position;

    // Add virtual remuneration field from latest remuneration record
    if (position.remunerations && position.remunerations.length > 0) {
      // Assuming remunerations are ordered by createdAt desc
      position.remuneration = position.remunerations[0].value;
    } else {
      position.remuneration = 0; // Explicitly set to 0
    }

    return position;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PositionCreateFormData,
  ): Prisma.PositionCreateInput {
    // Note: remuneration is handled separately in the service layer
    return {
      name: formData.name,
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PositionUpdateFormData,
  ): Prisma.PositionUpdateInput {
    const updateInput: Prisma.PositionUpdateInput = {};

    if (formData.name !== undefined) {
      updateInput.name = formData.name;
    }

    if (formData.hierarchy !== undefined) {
      updateInput.hierarchy = formData.hierarchy;
    }

    if (formData.bonifiable !== undefined) {
      updateInput.bonifiable = formData.bonifiable;
    }

    // Note: remuneration is handled separately in the service layer

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PositionInclude,
  ): Prisma.PositionInclude | undefined {
    return include as Prisma.PositionInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PositionOrderBy,
  ): Prisma.PositionOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;

    // Handle array of orderBy objects
    if (Array.isArray(orderBy)) {
      // Check if any orderBy contains 'remuneration' (virtual field)
      const hasRemunerationSort = orderBy.some(
        order => typeof order === 'object' && order !== null && 'remuneration' in order,
      );

      if (hasRemunerationSort) {
        // Return undefined to trigger memory sorting in findManyWithTransaction
        return undefined;
      }

      return orderBy as Prisma.PositionOrderByWithRelationInput;
    }

    // Handle single orderBy object
    if (typeof orderBy === 'object' && orderBy !== null) {
      // Check if orderBy contains 'remuneration' (virtual field)
      if ('remuneration' in orderBy) {
        // Return undefined to trigger memory sorting in findManyWithTransaction
        return undefined;
      }
    }

    return orderBy as Prisma.PositionOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: PositionWhere): Prisma.PositionWhereInput | undefined {
    return where as Prisma.PositionWhereInput;
  }

  protected getDefaultInclude(): Prisma.PositionInclude {
    return {
      users: {
        include: {
          sector: true,
        },
      },
      remunerations: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: {
        select: {
          users: true,
          remunerations: true,
        },
      },
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PositionCreateFormData,
    options?: CreateOptions<PositionInclude>,
  ): Promise<Position> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.position.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar cargo', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PositionInclude>,
  ): Promise<Position | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.position.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar cargo por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PositionInclude>,
  ): Promise<Position[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.position.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar cargos por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PositionOrderBy, PositionWhere, PositionInclude>,
  ): Promise<FindManyResult<Position>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    // Check if sorting by remuneration (virtual field)
    const needsRemunerationSort = this.needsRemunerationSort(orderBy);

    if (needsRemunerationSort) {
      // Fetch all positions and sort in memory
      const [total, allPositions] = await Promise.all([
        transaction.position.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.position.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      // Sort by remuneration
      const sortedPositions = this.sortByRemuneration(allPositions, orderBy);

      // Apply pagination
      const paginatedPositions = sortedPositions.slice(skip, skip + take);

      return {
        data: paginatedPositions.map(position => this.mapDatabaseEntityToEntity(position)),
        meta: this.calculatePagination(total, page, take),
      };
    }

    // Normal database sorting
    const [total, positions] = await Promise.all([
      transaction.position.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.position.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: positions.map(position => this.mapDatabaseEntityToEntity(position)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  private needsRemunerationSort(orderBy?: PositionOrderBy): boolean {
    if (!orderBy) return false;

    if (Array.isArray(orderBy)) {
      return orderBy.some(
        order => typeof order === 'object' && order !== null && 'remuneration' in order,
      );
    }

    return typeof orderBy === 'object' && orderBy !== null && 'remuneration' in orderBy;
  }

  private sortByRemuneration(positions: any[], orderBy?: PositionOrderBy): any[] {
    if (!orderBy) return positions;

    const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
    const remunerationOrder = orderByArray.find(
      order => typeof order === 'object' && order !== null && 'remuneration' in order,
    );

    if (!remunerationOrder || typeof remunerationOrder !== 'object') return positions;

    const direction = (remunerationOrder as any).remuneration === 'desc' ? -1 : 1;

    return [...positions].sort((a, b) => {
      const aValue = a.remunerations && a.remunerations.length > 0 ? a.remunerations[0].value : 0;
      const bValue = b.remunerations && b.remunerations.length > 0 ? b.remunerations[0].value : 0;

      return (aValue - bValue) * direction;
    });
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PositionUpdateFormData,
    options?: UpdateOptions<PositionInclude>,
  ): Promise<Position> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.position.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar cargo ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Position> {
    try {
      const result = await transaction.position.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar cargo ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PositionWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.position.count({ where: whereInput });
    } catch (error) {
      this.logError('contar cargos', error, { where });
      throw error;
    }
  }

  async findByName(name: string): Promise<Position | null> {
    try {
      const result = await this.prisma.position.findFirst({
        where: { name },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar cargo por nome ${name}`, error);
      throw error;
    }
  }
}
