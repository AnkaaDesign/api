// repositories/position-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Position } from '../../../../../types';
import {
  PositionCreateFormData,
  PositionUpdateFormData,
  PositionInclude,
  PositionOrderBy,
  PositionWhere,
} from '../../../../../schemas/position';
import { PositionRepository } from './position.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';

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

    // Add virtual remuneration field from latest monetary value or remuneration record
    // Priority: 1. monetaryValues (current=true), 2. remunerations (deprecated), 3. default to 0
    if (position.monetaryValues && position.monetaryValues.length > 0) {
      // Find the current monetary value or use the most recent one
      const currentValue = position.monetaryValues.find((mv: any) => mv.current === true);
      if (currentValue) {
        position.remuneration = currentValue.value;
      } else {
        // Fallback to the first (most recent) monetary value
        position.remuneration = position.monetaryValues[0].value;
      }
    } else if (position.remunerations && position.remunerations.length > 0) {
      // Fallback to deprecated remunerations for backwards compatibility
      position.remuneration = position.remunerations[0].value;
    } else {
      position.remuneration = 0; // Explicitly set to 0
    }

    return position;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PositionCreateFormData,
  ): Prisma.PositionCreateInput {
    // Note: remuneration is handled separately in the service layer via MonetaryValue
    return {
      name: formData.name,
      hierarchy: formData.hierarchy !== undefined ? formData.hierarchy : null,
      bonifiable: formData.bonifiable !== undefined ? formData.bonifiable : true,
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

    // Note: remuneration is handled separately in the service layer via MonetaryValue

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

    // If it's an array, take the first element to satisfy type requirements
    // Prisma supports both single object and array of objects for orderBy at runtime
    if (Array.isArray(orderBy)) {
      return orderBy[0] as Prisma.PositionOrderByWithRelationInput;
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
      // Fetch monetary values (new approach) ordered by current=true first, then by most recent
      monetaryValues: {
        orderBy: [
          { current: 'desc' as const },
          { createdAt: 'desc' as const }
        ],
        take: 5, // Get a few recent values for history
      },
      // Also fetch deprecated remunerations for backwards compatibility
      remunerations: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: {
        select: {
          users: true,
          monetaryValues: true,
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
