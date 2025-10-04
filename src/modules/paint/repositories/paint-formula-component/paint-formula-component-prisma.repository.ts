import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { PaintFormulaComponent as PrismaPaintFormulaComponent, Prisma } from '@prisma/client';
import { PaintFormulaComponentRepository } from './paint-formula-component.repository';
import {
  PaintFormulaComponentCreateFormData,
  PaintFormulaComponentUpdateFormData,
  PaintFormulaComponentInclude,
  PaintFormulaComponentOrderBy,
  PaintFormulaComponentWhere,
} from '../../../../schemas/paint';
import { PaintFormulaComponent } from '../../../../types';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';

@Injectable()
export class PaintFormulaComponentPrismaRepository
  extends BaseStringPrismaRepository<
    PaintFormulaComponent,
    PaintFormulaComponentCreateFormData,
    PaintFormulaComponentUpdateFormData,
    PaintFormulaComponentInclude,
    PaintFormulaComponentOrderBy,
    PaintFormulaComponentWhere,
    PrismaPaintFormulaComponent,
    Prisma.PaintFormulaComponentCreateInput,
    Prisma.PaintFormulaComponentUpdateInput,
    Prisma.PaintFormulaComponentInclude,
    Prisma.PaintFormulaComponentOrderByWithRelationInput,
    Prisma.PaintFormulaComponentWhereInput
  >
  implements PaintFormulaComponentRepository
{
  protected readonly logger = new Logger(PaintFormulaComponentPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(
    databaseEntity: PrismaPaintFormulaComponent,
  ): PaintFormulaComponent {
    return databaseEntity as PaintFormulaComponent;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PaintFormulaComponentCreateFormData,
  ): Prisma.PaintFormulaComponentCreateInput {
    const { itemId, formulaPaintId, ...rest } = formData;

    return {
      ...rest,
      ratio: formData.ratio || 0, // Ensure ratio is provided
      item: { connect: { id: itemId } },
      formula: { connect: { id: formulaPaintId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PaintFormulaComponentUpdateFormData,
  ): Prisma.PaintFormulaComponentUpdateInput {
    const { itemId, formulaPaintId, ...rest } = formData;

    const updateInput: Prisma.PaintFormulaComponentUpdateInput = {
      ...rest,
    };

    if (itemId !== undefined) {
      updateInput.item = { connect: { id: itemId } };
    }

    if (formulaPaintId !== undefined) {
      updateInput.formula = { connect: { id: formulaPaintId } };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PaintFormulaComponentInclude,
  ): Prisma.PaintFormulaComponentInclude | undefined {
    return include as Prisma.PaintFormulaComponentInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PaintFormulaComponentOrderBy,
  ): Prisma.PaintFormulaComponentOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PaintFormulaComponentOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: PaintFormulaComponentWhere,
  ): Prisma.PaintFormulaComponentWhereInput | undefined {
    return where as Prisma.PaintFormulaComponentWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PaintFormulaComponentInclude | undefined {
    return {
      item: true,
      formula: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PaintFormulaComponentCreateFormData,
    options?: CreateOptions<PaintFormulaComponentInclude>,
  ): Promise<PaintFormulaComponent> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintFormulaComponent.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar componente de fórmula de tinta', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PaintFormulaComponentInclude>,
  ): Promise<PaintFormulaComponent | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintFormulaComponent.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar componente de fórmula de tinta por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PaintFormulaComponentInclude>,
  ): Promise<PaintFormulaComponent[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.paintFormulaComponent.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar componentes de fórmula de tinta por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      PaintFormulaComponentOrderBy,
      PaintFormulaComponentWhere,
      PaintFormulaComponentInclude
    >,
  ): Promise<FindManyResult<PaintFormulaComponent>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, paintFormulaComponents] = await Promise.all([
      transaction.paintFormulaComponent.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.paintFormulaComponent.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: paintFormulaComponents.map(paintFormulaComponent =>
        this.mapDatabaseEntityToEntity(paintFormulaComponent),
      ),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PaintFormulaComponentUpdateFormData,
    options?: UpdateOptions<PaintFormulaComponentInclude>,
  ): Promise<PaintFormulaComponent> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paintFormulaComponent.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar componente de fórmula de tinta ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<PaintFormulaComponent> {
    try {
      const result = await transaction.paintFormulaComponent.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar componente de fórmula de tinta ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PaintFormulaComponentWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.paintFormulaComponent.count({ where: whereInput });
    } catch (error) {
      this.logError('contar componentes de fórmula de tinta', error, { where });
      throw error;
    }
  }
}
