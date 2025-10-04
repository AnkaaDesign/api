import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { PaintFormula as PrismaPaintFormula, Prisma } from '@prisma/client';
import { PaintFormulaRepository } from './paint-formula.repository';
import {
  PaintFormulaCreateFormData,
  PaintFormulaUpdateFormData,
  PaintFormulaInclude,
  PaintFormulaOrderBy,
  PaintFormulaWhere,
} from '../../../../schemas/paint';
import { PaintFormula } from '../../../../types';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';

@Injectable()
export class PaintFormulaPrismaRepository
  extends BaseStringPrismaRepository<
    PaintFormula,
    PaintFormulaCreateFormData,
    PaintFormulaUpdateFormData,
    PaintFormulaInclude,
    PaintFormulaOrderBy,
    PaintFormulaWhere,
    PrismaPaintFormula,
    Prisma.PaintFormulaCreateInput,
    Prisma.PaintFormulaUpdateInput,
    Prisma.PaintFormulaInclude,
    Prisma.PaintFormulaOrderByWithRelationInput,
    Prisma.PaintFormulaWhereInput
  >
  implements PaintFormulaRepository
{
  protected readonly logger = new Logger(PaintFormulaPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaPaintFormula): PaintFormula {
    return {
      ...databaseEntity,
      density: Number(databaseEntity.density),
      pricePerLiter: Number(databaseEntity.pricePerLiter),
    } as PaintFormula;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PaintFormulaCreateFormData,
  ): Prisma.PaintFormulaCreateInput {
    const { paintId, components, ...rest } = formData;

    const createInput: Prisma.PaintFormulaCreateInput = {
      ...rest,
      paint: { connect: { id: paintId } },
    };

    if (components && components.length > 0) {
      createInput.components = {
        create: components.map(({ itemId, ratio, ...componentData }) => {
          return {
            ...componentData,
            ratio,
            item: { connect: { id: itemId } },
          };
        }),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PaintFormulaUpdateFormData,
  ): Prisma.PaintFormulaUpdateInput {
    const { paintId, ...rest } = formData;

    const updateInput: Prisma.PaintFormulaUpdateInput = {
      ...rest,
    };

    if (paintId !== undefined) {
      updateInput.paint = { connect: { id: paintId } };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PaintFormulaInclude,
  ): Prisma.PaintFormulaInclude | undefined {
    // Always ensure prices and measures are included for items within components
    if (include && (include as any).components) {
      const componentsInclude = (include as any).components;
      if (componentsInclude === true) {
        // If components is just true, expand it to include item with prices and measures
        return {
          ...include,
          components: {
            include: {
              item: {
                include: {
                  prices: true,
                  measures: true,
                },
              },
            },
          },
        } as Prisma.PaintFormulaInclude;
      } else if (componentsInclude.include?.item) {
        // If item is included, ensure it also includes prices and measures
        const itemInclude = componentsInclude.include.item;
        if (itemInclude === true) {
          // If item is just true, expand it
          return {
            ...include,
            components: {
              ...componentsInclude,
              include: {
                ...componentsInclude.include,
                item: {
                  include: {
                    prices: true,
                    measures: true,
                  },
                },
              },
            },
          } as Prisma.PaintFormulaInclude;
        } else if (typeof itemInclude === 'object' && itemInclude.include) {
          // Merge with existing item includes
          return {
            ...include,
            components: {
              ...componentsInclude,
              include: {
                ...componentsInclude.include,
                item: {
                  ...itemInclude,
                  include: {
                    ...itemInclude.include,
                    prices: true,
                    measures: true,
                  },
                },
              },
            },
          } as Prisma.PaintFormulaInclude;
        }
      }
    }

    return include as Prisma.PaintFormulaInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PaintFormulaOrderBy,
  ): Prisma.PaintFormulaOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PaintFormulaOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: PaintFormulaWhere,
  ): Prisma.PaintFormulaWhereInput | undefined {
    return where as Prisma.PaintFormulaWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PaintFormulaInclude | undefined {
    return {
      paint: true,
      components: {
        include: {
          item: {
            include: {
              prices: true,
              measures: true,
            },
          },
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PaintFormulaCreateFormData,
    options?: CreateOptions<PaintFormulaInclude>,
  ): Promise<PaintFormula> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintFormula.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar fórmula de tinta', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PaintFormulaInclude>,
  ): Promise<PaintFormula | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintFormula.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar fórmula de tinta por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PaintFormulaInclude>,
  ): Promise<PaintFormula[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.paintFormula.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar fórmulas de tinta por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PaintFormulaOrderBy, PaintFormulaWhere, PaintFormulaInclude>,
  ): Promise<FindManyResult<PaintFormula>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, paintFormulas] = await Promise.all([
      transaction.paintFormula.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.paintFormula.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: paintFormulas.map(paintFormula => this.mapDatabaseEntityToEntity(paintFormula)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PaintFormulaUpdateFormData,
    options?: UpdateOptions<PaintFormulaInclude>,
  ): Promise<PaintFormula> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintFormula.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar fórmula de tinta ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<PaintFormula> {
    try {
      const result = await transaction.paintFormula.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar fórmula de tinta ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PaintFormulaWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.paintFormula.count({ where: whereInput });
    } catch (error) {
      this.logError('contar fórmulas de tinta', error, { where });
      throw error;
    }
  }
}
