// repositories/payroll-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Payroll } from '../../../../../types';
import {
  PayrollCreateFormData,
  PayrollUpdateFormData,
  PayrollInclude,
  PayrollOrderBy,
  PayrollWhere,
  PayrollBatchCreateFormData,
} from '../../../../../schemas';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions, BatchOperationResult } from '../../../../../types';
import { PayrollRepository } from './payroll.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, Payroll as PrismaPayroll, UserStatus } from '@prisma/client';
import {
  getBonusPeriodStart,
  getBonusPeriodEnd,
  calculateBonusForPosition,
  calculatePayrollDiscounts,
  calculateNetSalary,
  getPayrollCalculationBreakdown
} from '../../../../../utils';
import { ACTIVE_USER_STATUSES } from '../../../../../constants';

@Injectable()
export class PayrollPrismaRepository
  extends BaseStringPrismaRepository<
    Payroll,
    PayrollCreateFormData,
    PayrollUpdateFormData,
    PayrollInclude,
    PayrollOrderBy,
    PayrollWhere,
    PrismaPayroll,
    Prisma.PayrollCreateInput,
    Prisma.PayrollUpdateInput,
    Prisma.PayrollInclude,
    Prisma.PayrollOrderByWithRelationInput,
    Prisma.PayrollWhereInput
  >
  implements PayrollRepository
{
  protected readonly logger = new Logger(PayrollPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // =====================
  // Abstract method implementations from BaseStringPrismaRepository
  // =====================

  protected mapDatabaseEntityToEntity(databaseEntity: PrismaPayroll): Payroll {
    return {
      ...databaseEntity,
      baseRemuneration: Number(databaseEntity.baseRemuneration),
    } as Payroll;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PayrollCreateFormData,
  ): Prisma.PayrollCreateInput {
    const { userId, discounts, positionId, status, baseRemuneration, year, month } = formData;

    const createInput: Prisma.PayrollCreateInput = {
      baseRemuneration,
      year,
      month,
      user: { connect: { id: userId } },
    };

    // Connect position if provided
    if (positionId) {
      createInput.position = { connect: { id: positionId } };
    }

    // Handle nested discounts creation
    if (discounts && discounts.length > 0) {
      createInput.discounts = {
        create: discounts.map((discount, index) => ({
          percentage: discount.percentage,
          value: discount.value,
          calculationOrder: discount.calculationOrder || index + 1,
          reference: discount.reference,
        })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PayrollUpdateFormData,
  ): Prisma.PayrollUpdateInput {
    const { discounts, positionId, ...rest } = formData;

    const updateInput: Prisma.PayrollUpdateInput = { ...rest };

    // Update position if provided
    if (positionId !== undefined) {
      if (positionId === null) {
        updateInput.position = { disconnect: true };
      } else {
        updateInput.position = { connect: { id: positionId } };
      }
    }

    // Handle nested discounts update (replace all)
    if (discounts !== undefined) {
      updateInput.discounts = {
        deleteMany: {}, // Delete all existing discounts
        create: discounts.map((discount, index) => ({
          percentage: discount.percentage,
          value: discount.value,
          calculationOrder: discount.calculationOrder || index + 1,
          reference: discount.reference,
        })),
      };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PayrollInclude,
  ): Prisma.PayrollInclude | undefined {
    return include as Prisma.PayrollInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PayrollOrderBy,
  ): Prisma.PayrollOrderByWithRelationInput | Prisma.PayrollOrderByWithRelationInput[] | undefined {
    if (!orderBy) return undefined;

    // If it's already an array, return as is
    if (Array.isArray(orderBy)) {
      return orderBy as Prisma.PayrollOrderByWithRelationInput[];
    }

    // If it's an object with multiple keys, convert to array of single-key objects
    const keys = Object.keys(orderBy);
    if (keys.length > 1) {
      return keys.map(key => ({ [key]: (orderBy as any)[key] })) as Prisma.PayrollOrderByWithRelationInput[];
    }

    // Single key object, return as is
    return orderBy as Prisma.PayrollOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: PayrollWhere): Prisma.PayrollWhereInput | undefined {
    if (!where) return undefined;
    return where as Prisma.PayrollWhereInput;
  }

  protected getDefaultInclude(): Prisma.PayrollInclude {
    return {
      user: {
        include: {
          position: {
            include: {
              remunerations: {
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          sector: true,
        },
      },
      bonus: {
        include: {
          tasks: {
            include: {
              customer: {
                select: {
                  id: true,
                  fantasyName: true,
                  corporateName: true,
                  cnpj: true,
                },
              },
              createdBy: true,
              sector: true,
              services: true,
            },
          },
          users: true,
        },
      },
      discounts: {
        orderBy: { calculationOrder: 'asc' },
      },
      position: {
        include: {
          remunerations: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    };
  }

  // =====================
  // Enhanced Repository Methods
  // =====================

  /**
   * Find many payrolls with advanced filtering by user, month, year
   */
  async findMany(
    options?: FindManyOptions<PayrollOrderBy, PayrollWhere, PayrollInclude>,
  ): Promise<FindManyResult<Payroll>> {
    const { where, include, page = 1, take = 20, orderBy = { year: 'desc', month: 'desc' } } = options || {};
    const skip = page && take ? (page - 1) * take : undefined;

    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);

      const [total, payrolls] = await Promise.all([
        this.prisma.payroll.count({ where: whereInput }),
        this.prisma.payroll.findMany({
          where: whereInput,
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy),
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: payrolls.map(payroll => this.mapDatabaseEntityToEntity(payroll)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar folhas de pagamento', error, { where, orderBy, page, take });
      throw error;
    }
  }

  /**
   * Find specific payroll for user and month/year
   */
  async findByUserAndMonth(
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll | null> {
    if (!userId || !year || !month) {
      throw new BadRequestException('userId, year e month são obrigatórios');
    }

    try {
      const result = await this.prisma.payroll.findUnique({
        where: {
          userId_year_month: {
            userId,
            year,
            month,
          },
        },
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError('buscar folha de pagamento por usuário e período', error, { userId, year, month });
      throw error;
    }
  }

  /**
   * Create payroll with all calculated fields
   */
  async create(
    data: PayrollCreateFormData,
    options?: CreateOptions<PayrollInclude>,
  ): Promise<Payroll> {
    try {
      // Validate that payroll doesn't already exist for this user/period
      const existing = await this.findByUserAndMonth(data.userId, data.year, data.month);
      if (existing) {
        throw new BadRequestException(`Folha de pagamento já existe para este usuário em ${data.month}/${data.year}`);
      }

      // Get user with position to calculate bonus
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
        include: {
          position: {
            include: {
              remunerations: {
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      if (!ACTIVE_USER_STATUSES.includes(user.status as any)) {
        throw new BadRequestException('Usuário deve estar ativo para criar folha de pagamento');
      }

      // Use current position if not provided
      if (!data.positionId && user.position) {
        data.positionId = user.position.id;
      }

      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await this.prisma.payroll.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar folha de pagamento', error, { data });
      throw error;
    }
  }

  /**
   * Update payroll record
   */
  async update(
    id: string,
    data: PayrollUpdateFormData,
    options?: UpdateOptions<PayrollInclude>,
  ): Promise<Payroll> {
    try {
      // Check if payroll exists
      const existing = await this.prisma.payroll.findUnique({
        where: { id },
        include: { user: true },
      });

      if (!existing) {
        throw new NotFoundException('Folha de pagamento não encontrada');
      }

      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await this.prisma.payroll.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar folha de pagamento ${id}`, error, { data });
      throw error;
    }
  }

  /**
   * Soft delete payroll (actual delete since no soft delete in schema)
   */
  async delete(id: string): Promise<Payroll> {
    try {
      const existing = await this.prisma.payroll.findUnique({
        where: { id },
        include: this.getDefaultInclude(),
      });

      if (!existing) {
        throw new NotFoundException('Folha de pagamento não encontrada');
      }

      // Delete related discounts first (if cascade is not configured)
      await this.prisma.payrollDiscount.deleteMany({
        where: { payrollId: id },
      });

      const result = await this.prisma.payroll.delete({
        where: { id },
      });

      return this.mapDatabaseEntityToEntity({ ...existing, ...result });
    } catch (error) {
      this.logError(`deletar folha de pagamento ${id}`, error);
      throw error;
    }
  }

  /**
   * Find existing payroll or generate live calculation
   */
  async findOrGenerateLive(
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll> {
    try {
      // First try to find existing payroll
      const existing = await this.findByUserAndMonth(userId, year, month, include);
      if (existing) {
        return existing;
      }

      // Generate live calculation
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          position: {
            include: {
              remunerations: {
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          sector: true,
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      // Get bonus for this period if exists
      const bonus = await this.prisma.bonus.findUnique({
        where: {
          userId_year_month: {
            userId,
            year,
            month,
          },
        },
        include: {
          tasks: {
            include: {
              customer: true,
              sector: true,
            },
          },
          users: true,
        },
      });

      // Calculate payroll details
      const baseRemuneration = user.position?.remunerations?.[0]?.value || 0;
      const calculatedDiscounts: any[] = []; // Would come from rules or defaults

      // Create live payroll object (not saved to database)
      const livePayroll: Payroll = {
        id: `live-${userId}-${year}-${month}`,
        baseRemuneration,
        year,
        month,
        userId,
        positionId: user.position?.id || null,
        bonus: bonus as any,
        discounts: calculatedDiscounts,
        user: user as any,
        position: user.position as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return livePayroll;
    } catch (error) {
      this.logError('gerar cálculo ao vivo da folha de pagamento', error, { userId, year, month });
      throw error;
    }
  }

  /**
   * Create multiple payrolls in transaction
   */
  async batchCreate(
    data: PayrollBatchCreateFormData,
  ): Promise<BatchOperationResult<Payroll>> {
    const results: Payroll[] = [];
    const errors: Array<{ index: number; error: string; data: any }> = [];

    try {
      await this.prisma.$transaction(async (tx) => {
        for (let i = 0; i < data.payrolls.length; i++) {
          try {
            const payrollData = data.payrolls[i];

            // Check if payroll already exists
            const existing = await tx.payroll.findUnique({
              where: {
                userId_year_month: {
                  userId: payrollData.userId,
                  year: payrollData.year,
                  month: payrollData.month,
                },
              },
            });

            if (existing) {
              errors.push({
                index: i,
                error: `Folha de pagamento já existe para usuário ${payrollData.userId} em ${payrollData.month}/${payrollData.year}`,
                data: data.payrolls[i],
              });
              continue;
            }

            // Validate user exists and is active
            const user = await tx.user.findUnique({
              where: { id: payrollData.userId },
              include: { position: true },
            });

            if (!user) {
              errors.push({
                index: i,
                error: `Usuário ${payrollData.userId} não encontrado`,
                data: data.payrolls[i],
              });
              continue;
            }

            if (!ACTIVE_USER_STATUSES.includes(user.status as any)) {
              errors.push({
                index: i,
                error: `Usuário ${payrollData.userId} não está ativo`,
                data: data.payrolls[i],
              });
              continue;
            }

            // Use current position if not provided
            if (!payrollData.positionId && user.position) {
              payrollData.positionId = user.position.id;
            }

            const createInput = this.mapCreateFormDataToDatabaseCreateInput(payrollData);

            const result = await tx.payroll.create({
              data: createInput,
              include: this.getDefaultInclude(),
            });

            results.push(this.mapDatabaseEntityToEntity(result));
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Erro desconhecido',
              data: data.payrolls[i],
            });
          }
        }
      });

      return {
        totalProcessed: data.payrolls.length,
        totalSuccess: results.length,
        totalFailed: errors.length,
        success: results,
        failed: errors,
      };
    } catch (error) {
      this.logError('criar folhas de pagamento em lote', error, { count: data.payrolls.length });
      throw error;
    }
  }

  // =====================
  // Transaction methods (inherited implementations)
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PayrollCreateFormData,
    options?: CreateOptions<PayrollInclude>,
  ): Promise<Payroll> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await transaction.payroll.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar folha de pagamento (transação)', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PayrollUpdateFormData,
    options?: UpdateOptions<PayrollInclude>,
  ): Promise<Payroll> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await transaction.payroll.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar folha de pagamento ${id} (transação)`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Payroll> {
    try {
      // Get the payroll with relations before deleting
      const existing = await transaction.payroll.findUnique({
        where: { id },
        include: this.getDefaultInclude(),
      });

      if (!existing) {
        throw new NotFoundException('Folha de pagamento não encontrada');
      }

      // Delete related discounts first
      await transaction.payrollDiscount.deleteMany({
        where: { payrollId: id },
      });

      const result = await transaction.payroll.delete({
        where: { id },
      });

      return this.mapDatabaseEntityToEntity({ ...existing, ...result });
    } catch (error) {
      this.logError(`deletar folha de pagamento ${id} (transação)`, error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PayrollInclude>,
  ): Promise<Payroll | null> {
    try {
      const result = await transaction.payroll.findUnique({
        where: { id },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar folha de pagamento por ID ${id} (transação)`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PayrollInclude>,
  ): Promise<Payroll[]> {
    try {
      const results = await transaction.payroll.findMany({
        where: { id: { in: ids } },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar folhas de pagamento por IDs (transação)', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PayrollOrderBy, PayrollWhere, PayrollInclude>,
  ): Promise<FindManyResult<Payroll>> {
    const { where, include, page = 1, take = 20, orderBy = { year: 'desc', month: 'desc' } } = options || {};
    const skip = page && take ? (page - 1) * take : undefined;

    try {
      const [total, payrolls] = await Promise.all([
        transaction.payroll.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.payroll.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy),
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: payrolls.map(payroll => this.mapDatabaseEntityToEntity(payroll)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar múltiplas folhas de pagamento (transação)', error, { where, orderBy, page, take });
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PayrollWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.payroll.count({ where: whereInput });
    } catch (error) {
      this.logError('contar folhas de pagamento (transação)', error, { where });
      throw error;
    }
  }

  // =====================
  // Legacy methods for compatibility
  // =====================

  async findByUserAndPeriod(
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll | null> {
    return this.findByUserAndMonth(userId, year, month, include);
  }

  async findByUserAndPeriodWithTransaction(
    transaction: PrismaTransaction,
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll | null> {
    try {
      const result = await transaction.payroll.findUnique({
        where: {
          userId_year_month: {
            userId,
            year,
            month,
          },
        },
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError('buscar folha de pagamento por usuário e período (transação)', error, { userId, year, month });
      throw error;
    }
  }

  async createManyForMonth(
    year: number,
    month: number,
    transaction?: PrismaTransaction,
  ): Promise<number> {
    const client = transaction || this.prisma;

    try {
      // Get users without payroll for this period
      const activeUsers = await this.getActiveUsersWithoutPayroll(year, month);

      if (activeUsers.length === 0) {
        return 0;
      }

      // Create payrolls for all active users with their current position
      const payrollsData = activeUsers.map(user => ({
        userId: user.id,
        year,
        month,
        baseRemuneration: user.position?.remunerations?.[0]?.value || 0,
        positionId: user.position?.id,
      }));

      const result = await client.payroll.createMany({
        data: payrollsData,
        skipDuplicates: true,
      });

      return result.count;
    } catch (error) {
      this.logError('criar folhas de pagamento para o mês', error, { year, month });
      throw error;
    }
  }

  async getActiveUsersWithoutPayroll(year: number, month: number): Promise<any[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          status: { in: ACTIVE_USER_STATUSES as any },
          payrollNumber: { not: null }, // Only users with payroll number
          payrolls: {
            none: {
              year,
              month,
            },
          },
        },
        include: {
          position: {
            include: {
              remunerations: {
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      });

      return users;
    } catch (error) {
      this.logError('buscar usuários ativos sem folha de pagamento', error, { year, month });
      throw error;
    }
  }
}