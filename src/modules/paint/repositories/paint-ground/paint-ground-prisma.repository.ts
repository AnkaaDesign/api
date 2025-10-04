// paint-ground-prisma.repository.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { PaintGround as PrismaPaintGround, Prisma } from '@prisma/client';
import { PaintGroundRepository } from './paint-ground.repository';
import {
  PaintGroundCreateFormData,
  PaintGroundUpdateFormData,
  PaintGroundInclude,
  PaintGroundOrderBy,
  PaintGroundWhere,
} from '../../../../schemas/paint';
import { PaintGround } from '../../../../types';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';

@Injectable()
export class PaintGroundPrismaRepository
  extends BaseStringPrismaRepository<
    PaintGround,
    PaintGroundCreateFormData,
    PaintGroundUpdateFormData,
    PaintGroundInclude,
    PaintGroundOrderBy,
    PaintGroundWhere,
    PrismaPaintGround,
    Prisma.PaintGroundCreateInput,
    Prisma.PaintGroundUpdateInput,
    Prisma.PaintGroundInclude,
    Prisma.PaintGroundOrderByWithRelationInput,
    Prisma.PaintGroundWhereInput
  >
  implements PaintGroundRepository
{
  protected readonly logger = new Logger(PaintGroundPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaPaintGround): PaintGround {
    return databaseEntity as PaintGround;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PaintGroundCreateFormData,
  ): Prisma.PaintGroundCreateInput {
    const { paintId, groundPaintId } = formData;

    return {
      paint: { connect: { id: paintId } },
      groundPaint: { connect: { id: groundPaintId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PaintGroundUpdateFormData,
  ): Prisma.PaintGroundUpdateInput {
    const { paintId, groundPaintId } = formData;

    const updateInput: Prisma.PaintGroundUpdateInput = {};

    if (paintId !== undefined) {
      updateInput.paint = { connect: { id: paintId } };
    }

    if (groundPaintId !== undefined) {
      updateInput.groundPaint = { connect: { id: groundPaintId } };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PaintGroundInclude,
  ): Prisma.PaintGroundInclude | undefined {
    return include as Prisma.PaintGroundInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PaintGroundOrderBy,
  ): Prisma.PaintGroundOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PaintGroundOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: PaintGroundWhere,
  ): Prisma.PaintGroundWhereInput | undefined {
    return where as Prisma.PaintGroundWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PaintGroundInclude | undefined {
    return {
      paint: true,
      groundPaint: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PaintGroundCreateFormData,
    options?: CreateOptions<PaintGroundInclude>,
  ): Promise<PaintGround> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintGround.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar base de tinta', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PaintGroundInclude>,
  ): Promise<PaintGround | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintGround.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar base de tinta por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PaintGroundInclude>,
  ): Promise<PaintGround[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.paintGround.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar bases de tinta por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PaintGroundOrderBy, PaintGroundWhere, PaintGroundInclude>,
  ): Promise<FindManyResult<PaintGround>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, paintGrounds] = await Promise.all([
      transaction.paintGround.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.paintGround.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: paintGrounds.map(paintGround => this.mapDatabaseEntityToEntity(paintGround)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PaintGroundUpdateFormData,
    options?: UpdateOptions<PaintGroundInclude>,
  ): Promise<PaintGround> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintGround.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar base de tinta ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<PaintGround> {
    try {
      const result = await transaction.paintGround.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar base de tinta ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PaintGroundWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.paintGround.count({ where: whereInput });
    } catch (error) {
      this.logError('contar bases de tinta', error, { where });
      throw error;
    }
  }
}
