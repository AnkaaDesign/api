import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Bonus } from '../../../../../types';
import {
  BonusCreateFormData,
  BonusUpdateFormData,
  BonusInclude,
  BonusOrderBy,
  BonusWhere,
} from '../../../../../schemas/bonus';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { BonusRepository } from './bonus.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import { mapWhereClause } from '../../../../../utils';

@Injectable()
export class BonusPrismaRepository
  extends BaseStringPrismaRepository<
    Bonus,
    BonusCreateFormData,
    BonusUpdateFormData,
    BonusInclude,
    BonusOrderBy,
    BonusWhere,
    Prisma.BonusGetPayload<{ include: any }>,
    Prisma.BonusCreateInput,
    Prisma.BonusUpdateInput,
    Prisma.BonusInclude,
    Prisma.BonusOrderByWithRelationInput,
    Prisma.BonusWhereInput
  >
  implements BonusRepository
{
  protected readonly logger = new Logger(BonusPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get model() {
    return this.prisma.bonus;
  }

  protected mapDatabaseEntityToEntity(databaseEntity: Prisma.BonusGetPayload<{ include: any }>): Bonus {
    return databaseEntity as unknown as Bonus;
  }

  protected mapCreateFormDataToDatabaseCreateInput(data: BonusCreateFormData): Prisma.BonusCreateInput {
    return this.mapToCreateInput(data);
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(data: BonusUpdateFormData): Prisma.BonusUpdateInput {
    return this.mapToUpdateInput(data);
  }

  protected mapIncludeToDatabaseInclude(include?: BonusInclude): Prisma.BonusInclude | undefined {
    return this.mapToInclude(include);
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: BonusOrderBy): Prisma.BonusOrderByWithRelationInput | undefined {
    const result = this.mapToOrderBy(orderBy);
    if (Array.isArray(result)) {
      return result[0];
    }
    return result;
  }

  protected mapWhereToDatabaseWhere(where?: BonusWhere): Prisma.BonusWhereInput | undefined {
    return this.mapToWhereInput(where);
  }

  protected getDefaultInclude(): Prisma.BonusInclude | undefined {
    return undefined;
  }

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: BonusCreateFormData,
    options?: any
  ): Promise<Bonus> {
    const client = transaction || this.prisma;
    const bonus = await client.bonus.create({
      data: this.mapToCreateInput(data),
      include: this.mapToInclude(options?.include),
    });
    return bonus as unknown as Bonus;
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: any
  ): Promise<Bonus | null> {
    const client = transaction || this.prisma;
    const bonus = await client.bonus.findUnique({
      where: { id },
      include: this.mapToInclude(options?.include),
    });
    return bonus as unknown as Bonus | null;
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: any
  ): Promise<Bonus[]> {
    const client = transaction || this.prisma;
    const bonuses = await client.bonus.findMany({
      where: { id: { in: ids } },
      include: this.mapToInclude(options?.include),
    });
    return bonuses as unknown as Bonus[];
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<BonusOrderBy, BonusWhere, BonusInclude>
  ): Promise<FindManyResult<Bonus>> {
    const client = transaction || this.prisma;

    const [bonuses, total] = await Promise.all([
      client.bonus.findMany({
        where: this.mapToWhereInput(options?.where),
        include: this.mapToInclude(options?.include),
        orderBy: this.mapToOrderBy(options?.orderBy),
        skip: options?.skip,
        take: options?.take,
      }),
      client.bonus.count({
        where: this.mapToWhereInput(options?.where),
      }),
    ]);

    const take = options?.take || 10;
    const skip = options?.skip || 0;
    const page = Math.floor(skip / take) + 1;
    const totalPages = Math.ceil(total / take);

    return {
      data: bonuses as unknown as Bonus[],
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
    where?: BonusWhere
  ): Promise<number> {
    const client = transaction || this.prisma;
    return client.bonus.count({
      where: this.mapToWhereInput(where),
    });
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: BonusUpdateFormData,
    options?: any
  ): Promise<Bonus> {
    const client = transaction || this.prisma;
    const bonus = await client.bonus.update({
      where: { id },
      data: this.mapToUpdateInput(data),
      include: this.mapToInclude(options?.include),
    });
    return bonus as unknown as Bonus;
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string
  ): Promise<Bonus> {
    const client = transaction || this.prisma;
    const bonus = await client.bonus.delete({
      where: { id },
    });
    return bonus as unknown as Bonus;
  }

  protected mapToCreateInput(data: BonusCreateFormData): Prisma.BonusCreateInput {
    const input: Prisma.BonusCreateInput = {
      year: data.year,
      month: data.month,
      user: {
        connect: { id: data.userId },
      },
      baseBonus: data.baseBonus,
      performanceLevel: data.performanceLevel,
    };

    if (data.payrollId) {
      input.payroll = { connect: { id: data.payrollId } };
    }

    return input;
  }

  protected mapToUpdateInput(data: BonusUpdateFormData): Prisma.BonusUpdateInput {
    const updateData: Prisma.BonusUpdateInput = {};

    if (data.year !== undefined) updateData.year = data.year;
    if (data.month !== undefined) updateData.month = data.month;
    if (data.baseBonus !== undefined) updateData.baseBonus = data.baseBonus;
    if (data.performanceLevel !== undefined) updateData.performanceLevel = data.performanceLevel;
    if (data.userId !== undefined) updateData.user = { connect: { id: data.userId } };
    if (data.payrollId !== undefined) {
      updateData.payroll = data.payrollId ? { connect: { id: data.payrollId } } : { disconnect: true };
    }

    return updateData;
  }

  protected mapToInclude(include?: BonusInclude): Prisma.BonusInclude | undefined {
    if (!include) return undefined;

    const prismaInclude: Prisma.BonusInclude = {};

    if (include.user) {
      if (typeof include.user === 'boolean') {
        prismaInclude.user = true;
      } else {
        prismaInclude.user = {
          include: this.mapUserInclude(include.user.include),
        };
      }
    }

    if (include.bonusDiscounts) {
      if (typeof include.bonusDiscounts === 'boolean') {
        prismaInclude.bonusDiscounts = true;
      } else {
        prismaInclude.bonusDiscounts = {
          include: this.mapBonusDiscountInclude(include.bonusDiscounts.include),
        };
      }
    }

    return prismaInclude;
  }

  private mapUserInclude(userInclude?: any): any {
    if (!userInclude) return undefined;

    const include: any = {};
    if (userInclude.position) include.position = true;
    if (userInclude.sector) include.sector = true;

    return Object.keys(include).length > 0 ? include : undefined;
  }

  private mapBonusDiscountInclude(discountInclude?: any): any {
    if (!discountInclude) return undefined;

    const include: any = {};
    if (discountInclude.bonus) include.bonus = true;

    return Object.keys(include).length > 0 ? include : undefined;
  }

  protected mapToOrderBy(orderBy?: BonusOrderBy): Prisma.BonusOrderByWithRelationInput | Prisma.BonusOrderByWithRelationInput[] | undefined {
    if (!orderBy) return undefined;

    if (Array.isArray(orderBy)) {
      return orderBy.map(order => this.mapSingleOrderBy(order));
    }

    return this.mapSingleOrderBy(orderBy);
  }

  private mapSingleOrderBy(orderBy: Exclude<BonusOrderBy, any[]>): Prisma.BonusOrderByWithRelationInput {
    const prismaOrderBy: Prisma.BonusOrderByWithRelationInput = {};

    if ('id' in orderBy && orderBy.id) prismaOrderBy.id = orderBy.id;
    if ('year' in orderBy && orderBy.year) prismaOrderBy.year = orderBy.year;
    if ('month' in orderBy && orderBy.month) prismaOrderBy.month = orderBy.month;
    if ('baseBonus' in orderBy && orderBy.baseBonus) prismaOrderBy.baseBonus = orderBy.baseBonus;
    if ('createdAt' in orderBy && orderBy.createdAt) prismaOrderBy.createdAt = orderBy.createdAt;
    if ('updatedAt' in orderBy && orderBy.updatedAt) prismaOrderBy.updatedAt = orderBy.updatedAt;

    if ('user' in orderBy && orderBy.user) {
      prismaOrderBy.user = {};
      if (typeof orderBy.user === 'object' && 'name' in orderBy.user && orderBy.user.name) {
        prismaOrderBy.user.name = orderBy.user.name;
      }
      if (typeof orderBy.user === 'object' && 'createdAt' in orderBy.user && orderBy.user.createdAt) {
        prismaOrderBy.user.createdAt = orderBy.user.createdAt;
      }
    }

    return prismaOrderBy;
  }

  protected mapToWhereInput(where?: BonusWhere): Prisma.BonusWhereInput | undefined {
    if (!where) return undefined;

    const whereInput: Prisma.BonusWhereInput = {};

    // Map direct fields
    if (where.id) whereInput.id = where.id;
    if (where.userId) whereInput.userId = where.userId;
    if (where.year !== undefined) whereInput.year = where.year;
    if (where.month !== undefined) whereInput.month = where.month;
    if (where.payrollId) whereInput.payrollId = where.payrollId;

    // Map nested user where clause
    if (where.user) {
      whereInput.user = {};
      if (where.user.id) whereInput.user.id = where.user.id;
      if (where.user.name) whereInput.user.name = where.user.name;
      if (where.user.status) whereInput.user.status = where.user.status;
      if (where.user.positionId) whereInput.user.positionId = where.user.positionId;
      if (where.user.sectorId) whereInput.user.sectorId = where.user.sectorId;
    }

    // Map logical operators
    if (where.AND) whereInput.AND = Array.isArray(where.AND)
      ? where.AND.map(w => this.mapToWhereInput(w)).filter(Boolean)
      : this.mapToWhereInput(where.AND);
    if (where.OR) whereInput.OR = where.OR.map(w => this.mapToWhereInput(w)).filter(Boolean);
    if (where.NOT) whereInput.NOT = Array.isArray(where.NOT)
      ? where.NOT.map(w => this.mapToWhereInput(w)).filter(Boolean)
      : this.mapToWhereInput(where.NOT);

    return whereInput;
  }

  // Bonus-specific implementations
  async findByUserAndPeriod(
    userId: string,
    year: number,
    month: number,
    tx?: PrismaTransaction
  ): Promise<Bonus | null> {
    try {
      const client = tx || this.prisma;
      const bonus = await client.bonus.findUnique({
        where: {
          userId_year_month: {
            userId,
            year,
            month,
          },
        },
      });

      return bonus as unknown as Bonus | null;
    } catch (error) {
      this.logger.error('Error finding bonus by user and period', { error, userId, year, month });
      throw error;
    }
  }

  async findByPeriod(
    year: number,
    month: number,
    include?: BonusInclude,
    tx?: PrismaTransaction
  ): Promise<Bonus[]> {
    try {
      const client = tx || this.prisma;
      const bonuses = await client.bonus.findMany({
        where: {
          year,
          month,
        },
        include: this.mapToInclude(include),
      });

      return bonuses as unknown as Bonus[];
    } catch (error) {
      this.logger.error('Error finding bonuses by period', { error, year, month });
      throw error;
    }
  }

  async getPayrollData(
    year: number,
    month: number,
    userId?: string,
    sectorId?: string,
    tx?: PrismaTransaction
  ): Promise<any[]> {
    try {
      const client = tx || this.prisma;

      const whereClause: any = {
        year,
        month,
      };

      if (userId) {
        whereClause.userId = userId;
      }

      if (sectorId) {
        whereClause.user = {
          sectorId,
        };
      }

      const bonuses = await client.bonus.findMany({
        where: whereClause,
        include: {
          user: {
            include: {
              position: {
                include: {
                  remunerations: {
                    orderBy: {
                      createdAt: 'desc',
                    },
                    take: 1,
                  },
                },
              },
              sector: true,
            },
          },
          bonusDiscounts: true,
        },
      });

      // Calculate payroll data
      return bonuses.map(bonus => {
        const baseRemuneration = Number(bonus.user?.position?.remunerations?.[0]?.value || 0);
        const totalDiscountPercentage = bonus.bonusDiscounts?.reduce((sum, discount) => sum + (Number(discount.percentage) || 0), 0) || 0;
        const finalBonus = Number(bonus.baseBonus) * (1 - totalDiscountPercentage / 100);

        return {
          userId: bonus.userId,
          userName: bonus.user?.name || 'N/A',
          payrollNumber: bonus.user?.payrollNumber || 'N/A',
          position: bonus.user?.position?.name || 'N/A',
          sector: bonus.user?.sector?.name || 'N/A',
          performanceLevel: bonus.performanceLevel || 0,
          bonus: finalBonus,
          baseRemuneration,
          totalEarnings: finalBonus + baseRemuneration,
          discounts: bonus.bonusDiscounts?.map(d => ({
            reference: d.reference,
            percentage: Number(d.percentage) || 0,
          })) || [],
        };
      });
    } catch (error) {
      this.logger.error('Error getting payroll data', { error, year, month, userId, sectorId });
      throw error;
    }
  }
}