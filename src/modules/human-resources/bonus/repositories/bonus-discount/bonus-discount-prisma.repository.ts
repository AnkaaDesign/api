import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  BonusDiscount,
  BonusDiscountIncludes,
  BonusDiscountOrderBy,
  BonusDiscountWhere,
  BonusDiscountGetManyParams,
  FindManyResult,
  FindManyOptions,
} from '../../../../../types';
import { BonusDiscountCreateFormData } from '../../../../../schemas';
import { BonusDiscountRepository, BonusDiscountUpdateFormData } from './bonus-discount.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { BonusDiscount as PrismaBonusDiscount, Prisma } from '@prisma/client';

@Injectable()
export class BonusDiscountPrismaRepository
  extends BaseStringPrismaRepository<
    BonusDiscount,
    BonusDiscountCreateFormData,
    BonusDiscountUpdateFormData,
    BonusDiscountIncludes,
    BonusDiscountOrderBy,
    BonusDiscountWhere,
    PrismaBonusDiscount,
    Prisma.BonusDiscountCreateInput,
    Prisma.BonusDiscountUpdateInput,
    Prisma.BonusDiscountInclude,
    Prisma.BonusDiscountOrderByWithRelationInput,
    Prisma.BonusDiscountWhereInput
  >
  implements BonusDiscountRepository
{
  protected readonly logger = new Logger(BonusDiscountPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): BonusDiscount {
    return {
      ...databaseEntity,
      // Convert Decimal fields to numbers if needed
      percentage: databaseEntity.percentage ? Number(databaseEntity.percentage) : null,
      value: databaseEntity.value ? Number(databaseEntity.value) : null,
    } as BonusDiscount;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: BonusDiscountCreateFormData,
  ): Prisma.BonusDiscountCreateInput {
    const createInput: Prisma.BonusDiscountCreateInput = {
      reference: formData.reference,
      calculationOrder: formData.calculationOrder,
      bonus: { connect: { id: formData.bonusId } },
      ...(formData.percentage !== undefined && { percentage: formData.percentage }),
      ...(formData.value !== undefined && { value: formData.value }),
    };

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: BonusDiscountUpdateFormData,
  ): Prisma.BonusDiscountUpdateInput {
    const updateInput: Prisma.BonusDiscountUpdateInput = {
      ...(formData.reference !== undefined && { reference: formData.reference }),
      ...(formData.calculationOrder !== undefined && {
        calculationOrder: formData.calculationOrder,
      }),
      ...(formData.percentage !== undefined && { percentage: formData.percentage }),
      ...(formData.value !== undefined && { value: formData.value }),
    };

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: BonusDiscountIncludes,
  ): Prisma.BonusDiscountInclude | undefined {
    if (!include) return undefined;

    // Deep clone to avoid mutating the original
    const mappedInclude = JSON.parse(JSON.stringify(include));

    // Handle bonus include with select
    if (
      mappedInclude.bonus &&
      typeof mappedInclude.bonus === 'object' &&
      mappedInclude.bonus.include
    ) {
      // Already properly structured
    } else if (mappedInclude.bonus && Object.keys(mappedInclude.bonus).length === 0) {
      // Empty object means include all
      mappedInclude.bonus = true;
    }

    return mappedInclude as Prisma.BonusDiscountInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: BonusDiscountOrderBy,
  ): Prisma.BonusDiscountOrderByWithRelationInput | undefined {
    return orderBy as Prisma.BonusDiscountOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: BonusDiscountWhere,
  ): Prisma.BonusDiscountWhereInput | undefined {
    return where as Prisma.BonusDiscountWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.BonusDiscountInclude | undefined {
    return {
      bonus: {
        select: {
          id: true,
          year: true,
          month: true,
          baseBonus: true,
          userId: true,
        },
      },
    };
  }

  // Required method implementations from BaseStringPrismaRepository

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: BonusDiscountCreateFormData,
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput = options?.include
        ? this.mapIncludeToDatabaseInclude(options.include)
        : this.getDefaultInclude();

      const result = await transaction.bonusDiscount.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar desconto de bônus', error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount | null> {
    try {
      const includeInput = options?.include
        ? this.mapIncludeToDatabaseInclude(options.include)
        : this.getDefaultInclude();

      const result = await transaction.bonusDiscount.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar desconto de bônus ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount[]> {
    try {
      const includeInput = options?.include
        ? this.mapIncludeToDatabaseInclude(options.include)
        : this.getDefaultInclude();

      const results = await transaction.bonusDiscount.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar descontos de bônus por IDs', error);
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<BonusDiscountOrderBy, BonusDiscountWhere, BonusDiscountIncludes>,
  ): Promise<FindManyResult<BonusDiscount>> {
    try {
      const { where, orderBy, page = 1, take = 20, include } = options || {};
      const skip = Math.max(0, (page - 1) * take);

      const whereClause = this.mapWhereToDatabaseWhere(where);
      const orderByClause = this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' };
      const includeClause = include
        ? this.mapIncludeToDatabaseInclude(include)
        : this.getDefaultInclude();

      const [total, discounts] = await Promise.all([
        transaction.bonusDiscount.count({ where: whereClause }),
        transaction.bonusDiscount.findMany({
          where: whereClause,
          orderBy: orderByClause,
          skip,
          take,
          include: includeClause,
        }),
      ]);

      return {
        data: discounts.map(discount => this.mapDatabaseEntityToEntity(discount)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar descontos de bônus', error);
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: BonusDiscountUpdateFormData,
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput = options?.include
        ? this.mapIncludeToDatabaseInclude(options.include)
        : this.getDefaultInclude();

      const result = await transaction.bonusDiscount.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar desconto de bônus ${id}`, error);
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<BonusDiscount> {
    try {
      const result = await transaction.bonusDiscount.delete({
        where: { id },
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar desconto de bônus ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: BonusDiscountWhere,
  ): Promise<number> {
    try {
      const whereClause = this.mapWhereToDatabaseWhere(where);
      return await transaction.bonusDiscount.count({ where: whereClause });
    } catch (error) {
      this.logError('contar descontos de bônus', error);
      throw error;
    }
  }

  // Custom bonus-discount-specific methods
  async findByBonusId(
    bonusId: string,
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await this.prisma.bonusDiscount.findMany({
        where: { bonusId },
        include: includeInput,
        orderBy: { createdAt: 'desc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError(`buscar descontos por bônus ${bonusId}`, error);
      throw error;
    }
  }

  async findByBonusIdWithTransaction(
    transaction: PrismaTransaction,
    bonusId: string,
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.bonusDiscount.findMany({
        where: { bonusId },
        include: includeInput,
        orderBy: { createdAt: 'desc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError(`buscar descontos por bônus ${bonusId}`, error);
      throw error;
    }
  }

  async findByReference(
    reference: string,
    options?: BonusDiscountGetManyParams,
  ): Promise<FindManyResult<BonusDiscount>> {
    try {
      const { where, orderBy, page = 1, take = 20, include } = options || {};
      const skip = Math.max(0, (page - 1) * take);

      const whereClause: Prisma.BonusDiscountWhereInput = {
        ...this.mapWhereToDatabaseWhere(where),
        reference: { contains: reference, mode: 'insensitive' },
      };

      const [total, discounts] = await Promise.all([
        this.prisma.bonusDiscount.count({ where: whereClause }),
        this.prisma.bonusDiscount.findMany({
          where: whereClause,
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: discounts.map(discount => this.mapDatabaseEntityToEntity(discount)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError(`buscar descontos por referência ${reference}`, error);
      throw error;
    }
  }

  async findByReferenceWithTransaction(
    transaction: PrismaTransaction,
    reference: string,
    options?: BonusDiscountGetManyParams,
  ): Promise<FindManyResult<BonusDiscount>> {
    try {
      const { where, orderBy, page = 1, take = 20, include } = options || {};
      const skip = Math.max(0, (page - 1) * take);

      const whereClause: Prisma.BonusDiscountWhereInput = {
        ...this.mapWhereToDatabaseWhere(where),
        reference: { contains: reference, mode: 'insensitive' },
      };

      const [total, discounts] = await Promise.all([
        transaction.bonusDiscount.count({ where: whereClause }),
        transaction.bonusDiscount.findMany({
          where: whereClause,
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: discounts.map(discount => this.mapDatabaseEntityToEntity(discount)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError(`buscar descontos por referência ${reference}`, error);
      throw error;
    }
  }

  async deleteByBonusId(bonusId: string): Promise<number> {
    try {
      const result = await this.prisma.bonusDiscount.deleteMany({
        where: { bonusId },
      });

      return result.count;
    } catch (error) {
      this.logError(`deletar descontos por bônus ${bonusId}`, error);
      throw error;
    }
  }

  async deleteByBonusIdWithTransaction(
    transaction: PrismaTransaction,
    bonusId: string,
  ): Promise<number> {
    try {
      const result = await transaction.bonusDiscount.deleteMany({
        where: { bonusId },
      });

      return result.count;
    } catch (error) {
      this.logError(`deletar descontos por bônus ${bonusId}`, error);
      throw error;
    }
  }
}
