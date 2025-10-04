import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { BonusDiscount } from '../../../../../types';
import {
  BonusDiscountCreateFormData,
  BonusDiscountUpdateFormData,
  BonusDiscountInclude,
  BonusDiscountOrderBy,
  BonusDiscountWhere,
} from '../../../../../schemas';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { BonusDiscountRepository } from './bonus-discount.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import { mapWhereClause } from '../../../../../utils';

@Injectable()
export class BonusDiscountPrismaRepository
  extends BaseStringPrismaRepository<
    BonusDiscount,
    BonusDiscountCreateFormData,
    BonusDiscountUpdateFormData,
    BonusDiscountInclude,
    BonusDiscountOrderBy,
    BonusDiscountWhere,
    Prisma.BonusDiscountGetPayload<{ include: any }>,
    Prisma.BonusDiscountCreateInput,
    Prisma.BonusDiscountUpdateInput,
    Prisma.BonusDiscountInclude,
    Prisma.BonusDiscountOrderByWithRelationInput,
    Prisma.BonusDiscountWhereInput
  >
  implements BonusDiscountRepository
{
  protected readonly logger = new Logger(BonusDiscountPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get model() {
    return this.prisma.bonusDiscount;
  }

  protected mapDatabaseEntityToEntity(databaseEntity: Prisma.BonusDiscountGetPayload<{ include: any }>): BonusDiscount {
    return databaseEntity as unknown as BonusDiscount;
  }

  protected mapCreateFormDataToDatabaseCreateInput(data: BonusDiscountCreateFormData): Prisma.BonusDiscountCreateInput {
    return this.mapToCreateInput(data);
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(data: BonusDiscountUpdateFormData): Prisma.BonusDiscountUpdateInput {
    return this.mapToUpdateInput(data);
  }

  protected mapIncludeToDatabaseInclude(include?: BonusDiscountInclude): Prisma.BonusDiscountInclude | undefined {
    return this.mapToInclude(include);
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: BonusDiscountOrderBy): Prisma.BonusDiscountOrderByWithRelationInput | undefined {
    const result = this.mapToOrderBy(orderBy);
    if (Array.isArray(result)) {
      return result[0];
    }
    return result;
  }

  protected mapWhereToDatabaseWhere(where?: BonusDiscountWhere): Prisma.BonusDiscountWhereInput | undefined {
    return this.mapToWhereInput(where);
  }

  protected mapToCreateInput(data: BonusDiscountCreateFormData): Prisma.BonusDiscountCreateInput {
    return {
      bonus: {
        connect: { id: data.bonusId },
      },
      reference: data.reference,
      percentage: data.percentage,
      value: data.value,
      calculationOrder: data.calculationOrder || 1,
    };
  }

  protected mapToUpdateInput(data: BonusDiscountUpdateFormData): Prisma.BonusDiscountUpdateInput {
    const updateData: Prisma.BonusDiscountUpdateInput = {};

    if (data.reference !== undefined) updateData.reference = data.reference;
    if (data.percentage !== undefined) updateData.percentage = data.percentage;
    if (data.value !== undefined) updateData.value = data.value;
    if (data.calculationOrder !== undefined) updateData.calculationOrder = data.calculationOrder;

    return updateData;
  }

  protected mapToInclude(include?: BonusDiscountInclude): Prisma.BonusDiscountInclude | undefined {
    if (!include) return undefined;

    const prismaInclude: Prisma.BonusDiscountInclude = {};

    if (include.bonus) {
      if (typeof include.bonus === 'boolean') {
        prismaInclude.bonus = true;
      } else {
        prismaInclude.bonus = {
          include: this.mapBonusInclude(include.bonus.include),
        };
      }
    }

    return prismaInclude;
  }

  private mapBonusInclude(bonusInclude?: any): any {
    if (!bonusInclude) return undefined;

    const include: any = {};
    if (bonusInclude.user) include.user = true;
    if (bonusInclude.bonusDiscounts) include.bonusDiscounts = true;

    return Object.keys(include).length > 0 ? include : undefined;
  }

  protected mapToOrderBy(orderBy?: BonusDiscountOrderBy): Prisma.BonusDiscountOrderByWithRelationInput | Prisma.BonusDiscountOrderByWithRelationInput[] | undefined {
    if (!orderBy) return undefined;

    if (Array.isArray(orderBy)) {
      return orderBy.map(order => this.mapSingleOrderBy(order));
    }

    return this.mapSingleOrderBy(orderBy);
  }

  private mapSingleOrderBy(orderBy: Exclude<BonusDiscountOrderBy, any[]>): Prisma.BonusDiscountOrderByWithRelationInput {
    const prismaOrderBy: Prisma.BonusDiscountOrderByWithRelationInput = {};

    if ('id' in orderBy && orderBy.id) prismaOrderBy.id = orderBy.id;
    if ('reference' in orderBy && orderBy.reference) prismaOrderBy.reference = orderBy.reference;
    if ('percentage' in orderBy && orderBy.percentage) prismaOrderBy.percentage = orderBy.percentage;
    if ('value' in orderBy && orderBy.value) prismaOrderBy.value = orderBy.value;
    if ('calculationOrder' in orderBy && orderBy.calculationOrder) prismaOrderBy.calculationOrder = orderBy.calculationOrder;
    if ('createdAt' in orderBy && orderBy.createdAt) prismaOrderBy.createdAt = orderBy.createdAt;
    if ('updatedAt' in orderBy && orderBy.updatedAt) prismaOrderBy.updatedAt = orderBy.updatedAt;

    if ('bonus' in orderBy && orderBy.bonus && typeof orderBy.bonus === 'object') {
      prismaOrderBy.bonus = {};
      if ('year' in orderBy.bonus && orderBy.bonus.year) prismaOrderBy.bonus.year = orderBy.bonus.year;
      if ('month' in orderBy.bonus && orderBy.bonus.month) prismaOrderBy.bonus.month = orderBy.bonus.month;
      if ('createdAt' in orderBy.bonus && orderBy.bonus.createdAt) prismaOrderBy.bonus.createdAt = orderBy.bonus.createdAt;
    }

    return prismaOrderBy;
  }

  protected mapToWhereInput(where?: BonusDiscountWhere): Prisma.BonusDiscountWhereInput | undefined {
    if (!where) return undefined;

    return mapWhereClause(where) as Prisma.BonusDiscountWhereInput;
  }

  protected getDefaultInclude(): Prisma.BonusDiscountInclude | undefined {
    return undefined;
  }

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: BonusDiscountCreateFormData,
    options?: any
  ): Promise<BonusDiscount> {
    const client = transaction || this.prisma;
    const discount = await client.bonusDiscount.create({
      data: this.mapToCreateInput(data),
      include: this.mapToInclude(options?.include),
    });
    return discount as unknown as BonusDiscount;
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: any
  ): Promise<BonusDiscount | null> {
    const client = transaction || this.prisma;
    const discount = await client.bonusDiscount.findUnique({
      where: { id },
      include: this.mapToInclude(options?.include),
    });
    return discount as unknown as BonusDiscount | null;
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: any
  ): Promise<BonusDiscount[]> {
    const client = transaction || this.prisma;
    const discounts = await client.bonusDiscount.findMany({
      where: { id: { in: ids } },
      include: this.mapToInclude(options?.include),
    });
    return discounts as unknown as BonusDiscount[];
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<BonusDiscountOrderBy, BonusDiscountWhere, BonusDiscountInclude>
  ): Promise<FindManyResult<BonusDiscount>> {
    const client = transaction || this.prisma;

    const [discounts, total] = await Promise.all([
      client.bonusDiscount.findMany({
        where: this.mapToWhereInput(options?.where),
        include: this.mapToInclude(options?.include),
        orderBy: this.mapToOrderBy(options?.orderBy),
        skip: options?.skip,
        take: options?.take,
      }),
      client.bonusDiscount.count({
        where: this.mapToWhereInput(options?.where),
      }),
    ]);

    const take = options?.take || 10;
    const skip = options?.skip || 0;
    const page = Math.floor(skip / take) + 1;
    const totalPages = Math.ceil(total / take);

    return {
      data: discounts as unknown as BonusDiscount[],
      meta: {
        totalRecords: total,
        page,
        take,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: BonusDiscountWhere
  ): Promise<number> {
    const client = transaction || this.prisma;
    return client.bonusDiscount.count({
      where: this.mapToWhereInput(where),
    });
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: BonusDiscountUpdateFormData,
    options?: any
  ): Promise<BonusDiscount> {
    const client = transaction || this.prisma;
    const discount = await client.bonusDiscount.update({
      where: { id },
      data: this.mapToUpdateInput(data),
      include: this.mapToInclude(options?.include),
    });
    return discount as unknown as BonusDiscount;
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string
  ): Promise<BonusDiscount> {
    const client = transaction || this.prisma;
    const discount = await client.bonusDiscount.delete({
      where: { id },
    });
    return discount as unknown as BonusDiscount;
  }

  // BonusDiscount-specific implementations
  async findByBonusId(
    bonusId: string,
    include?: BonusDiscountInclude,
    tx?: PrismaTransaction
  ): Promise<BonusDiscount[]> {
    try {
      const client = tx || this.prisma;
      const discounts = await client.bonusDiscount.findMany({
        where: {
          bonusId,
        },
        include: this.mapToInclude(include),
      });

      return discounts as unknown as BonusDiscount[];
    } catch (error) {
      this.logger.error('Error finding bonus discounts by bonusId', { error, bonusId });
      throw error;
    }
  }

  async deleteByBonusId(bonusId: string, tx?: PrismaTransaction): Promise<void> {
    try {
      const client = tx || this.prisma;
      await client.bonusDiscount.deleteMany({
        where: {
          bonusId,
        },
      });
    } catch (error) {
      this.logger.error('Error deleting bonus discounts by bonusId', { error, bonusId });
      throw error;
    }
  }
}