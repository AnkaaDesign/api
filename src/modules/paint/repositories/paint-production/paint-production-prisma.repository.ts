import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { PaintProduction as PrismaPaintProduction, Prisma } from '@prisma/client';
import { PaintProductionRepository } from './paint-production.repository';
import {
  PaintProductionCreateFormData,
  PaintProductionUpdateFormData,
  PaintProductionInclude,
  PaintProductionOrderBy,
  PaintProductionWhere,
} from '../../../../schemas/paint';
import { PaintProduction } from '../../../../types';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';

@Injectable()
export class PaintProductionPrismaRepository
  extends BaseStringPrismaRepository<
    PaintProduction,
    PaintProductionCreateFormData,
    PaintProductionUpdateFormData,
    PaintProductionInclude,
    PaintProductionOrderBy,
    PaintProductionWhere,
    PrismaPaintProduction,
    Prisma.PaintProductionCreateInput,
    Prisma.PaintProductionUpdateInput,
    Prisma.PaintProductionInclude,
    Prisma.PaintProductionOrderByWithRelationInput,
    Prisma.PaintProductionWhereInput
  >
  implements PaintProductionRepository
{
  protected readonly logger = new Logger(PaintProductionPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaPaintProduction): PaintProduction {
    return databaseEntity as PaintProduction;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PaintProductionCreateFormData & { volumeLiters?: number },
  ): Prisma.PaintProductionCreateInput {
    const { formulaId, volumeLiters, ...rest } = formData;

    return {
      ...rest,
      volumeLiters: volumeLiters || 0, // This will be calculated by the service
      formula: { connect: { id: formulaId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PaintProductionUpdateFormData,
  ): Prisma.PaintProductionUpdateInput {
    const { formulaId, ...rest } = formData;

    const updateInput: Prisma.PaintProductionUpdateInput = {
      ...rest,
    };

    if (formulaId !== undefined) {
      updateInput.formula = { connect: { id: formulaId } };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PaintProductionInclude,
  ): Prisma.PaintProductionInclude | undefined {
    return include as Prisma.PaintProductionInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PaintProductionOrderBy,
  ): Prisma.PaintProductionOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PaintProductionOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: PaintProductionWhere,
  ): Prisma.PaintProductionWhereInput | undefined {
    return where as Prisma.PaintProductionWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PaintProductionInclude | undefined {
    return {
      formula: {
        include: {
          paint: {
            include: {
              paintType: true,
              paintBrand: true,
            },
          },
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PaintProductionCreateFormData,
    options?: CreateOptions<PaintProductionInclude>,
  ): Promise<PaintProduction> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintProduction.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar produção de tinta', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PaintProductionInclude>,
  ): Promise<PaintProduction | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintProduction.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar produção de tinta por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PaintProductionInclude>,
  ): Promise<PaintProduction[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.paintProduction.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar produções de tinta por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PaintProductionOrderBy, PaintProductionWhere, PaintProductionInclude>,
  ): Promise<FindManyResult<PaintProduction>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, paintProductions] = await Promise.all([
      transaction.paintProduction.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.paintProduction.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: paintProductions.map(paintProduction =>
        this.mapDatabaseEntityToEntity(paintProduction),
      ),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PaintProductionUpdateFormData,
    options?: UpdateOptions<PaintProductionInclude>,
  ): Promise<PaintProduction> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintProduction.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar produção de tinta ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<PaintProduction> {
    try {
      const result = await transaction.paintProduction.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar produção de tinta ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PaintProductionWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.paintProduction.count({ where: whereInput });
    } catch (error) {
      this.logError('contar produções de tinta', error, { where });
      throw error;
    }
  }
}
