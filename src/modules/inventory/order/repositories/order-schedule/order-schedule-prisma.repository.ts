import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  OrderSchedule as PrismaOrderSchedule,
  Prisma,
  ScheduleFrequency,
  Month,
  MonthOccurrence,
  DayOfWeek,
} from '@prisma/client';
import { OrderScheduleRepository } from './order-schedule.repository';
import {
  OrderScheduleCreateFormData,
  OrderScheduleUpdateFormData,
  OrderScheduleInclude,
  OrderScheduleOrderBy,
  OrderScheduleWhere,
} from '../../../../../schemas/order';
import { OrderSchedule } from '../../../../../types';
import { SCHEDULE_FREQUENCY } from '../../../../../constants/enums';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';

@Injectable()
export class OrderSchedulePrismaRepository
  extends BaseStringPrismaRepository<
    OrderSchedule,
    OrderScheduleCreateFormData,
    OrderScheduleUpdateFormData,
    OrderScheduleInclude,
    OrderScheduleOrderBy,
    OrderScheduleWhere,
    PrismaOrderSchedule,
    Prisma.OrderScheduleCreateInput,
    Prisma.OrderScheduleUpdateInput,
    Prisma.OrderScheduleInclude,
    Prisma.OrderScheduleOrderByWithRelationInput,
    Prisma.OrderScheduleWhereInput
  >
  implements OrderScheduleRepository
{
  protected readonly logger = new Logger(OrderSchedulePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaOrderSchedule): OrderSchedule {
    return databaseEntity as OrderSchedule;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: OrderScheduleCreateFormData,
  ): Prisma.OrderScheduleCreateInput {
    const { frequency, weeklySchedule, monthlySchedule, yearlySchedule, ...rest } = formData;

    const createInput: Prisma.OrderScheduleCreateInput = {
      ...rest,
      frequency: frequency as ScheduleFrequency,
    };

    // Handle schedule configs based on frequency
    if (weeklySchedule) {
      createInput.weeklyConfig = {
        create: weeklySchedule,
      };
    }

    if (monthlySchedule) {
      createInput.monthlyConfig = {
        create: {
          ...monthlySchedule,
          occurrence: monthlySchedule.occurrence as MonthOccurrence | null | undefined,
          dayOfWeek: monthlySchedule.dayOfWeek as DayOfWeek | null | undefined,
        },
      };
    }

    if (yearlySchedule) {
      createInput.yearlyConfig = {
        create: {
          ...yearlySchedule,
          month: yearlySchedule.month as Month,
          occurrence: yearlySchedule.occurrence as MonthOccurrence | null | undefined,
          dayOfWeek: yearlySchedule.dayOfWeek as DayOfWeek | null | undefined,
        },
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: OrderScheduleUpdateFormData,
  ): Prisma.OrderScheduleUpdateInput {
    const { weeklySchedule, frequency, monthlySchedule, yearlySchedule, ...rest } = formData;

    const updateInput: Prisma.OrderScheduleUpdateInput = {
      ...rest,
    };

    if (frequency !== undefined) {
      updateInput.frequency = frequency as ScheduleFrequency;
    }

    // Handle schedule config updates
    if (weeklySchedule !== undefined) {
      updateInput.weeklyConfig = {
        upsert: {
          create: weeklySchedule,
          update: weeklySchedule,
        },
      };
    }

    if (monthlySchedule !== undefined) {
      updateInput.monthlyConfig = {
        upsert: {
          create: {
            ...monthlySchedule,
            occurrence: monthlySchedule.occurrence as MonthOccurrence | null | undefined,
            dayOfWeek: monthlySchedule.dayOfWeek as DayOfWeek | null | undefined,
          },
          update: {
            ...monthlySchedule,
            occurrence: monthlySchedule.occurrence as MonthOccurrence | null | undefined,
            dayOfWeek: monthlySchedule.dayOfWeek as DayOfWeek | null | undefined,
          },
        },
      };
    }

    if (yearlySchedule !== undefined) {
      updateInput.yearlyConfig = {
        upsert: {
          create: {
            ...yearlySchedule,
            month: yearlySchedule.month as Month,
            occurrence: yearlySchedule.occurrence as MonthOccurrence | null | undefined,
            dayOfWeek: yearlySchedule.dayOfWeek as DayOfWeek | null | undefined,
          },
          update: {
            ...yearlySchedule,
            month: yearlySchedule.month as Month,
            occurrence: yearlySchedule.occurrence as MonthOccurrence | null | undefined,
            dayOfWeek: yearlySchedule.dayOfWeek as DayOfWeek | null | undefined,
          },
        },
      };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: OrderScheduleInclude,
  ): Prisma.OrderScheduleInclude | undefined {
    return include as Prisma.OrderScheduleInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: OrderScheduleOrderBy,
  ): Prisma.OrderScheduleOrderByWithRelationInput | undefined {
    return orderBy as Prisma.OrderScheduleOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: OrderScheduleWhere,
  ): Prisma.OrderScheduleWhereInput | undefined {
    return where as Prisma.OrderScheduleWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.OrderScheduleInclude | undefined {
    return {
      weeklyConfig: true,
      monthlyConfig: true,
      yearlyConfig: true,
      order: {
        select: {
          id: true,
          description: true,
          status: true,
        },
      },
    };
  }

  // =====================
  // Override required transaction methods from base class
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: OrderScheduleCreateFormData,
    options?: CreateOptions<OrderScheduleInclude>,
  ): Promise<OrderSchedule> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.orderSchedule.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar agendamento de pedido', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<OrderScheduleInclude>,
  ): Promise<OrderSchedule | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.orderSchedule.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar agendamento de pedido por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<OrderScheduleInclude>,
  ): Promise<OrderSchedule[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.orderSchedule.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedido por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<OrderScheduleOrderBy, OrderScheduleWhere, OrderScheduleInclude>,
  ): Promise<FindManyResult<OrderSchedule>> {
    try {
      const { where, orderBy, page = 1, take = 20, include } = options || {};
      const skip = Math.max(0, (page - 1) * take);

      const [total, results] = await Promise.all([
        transaction.orderSchedule.count({ where: this.mapWhereToDatabaseWhere(where) }),
        transaction.orderSchedule.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: results.map(result => this.mapDatabaseEntityToEntity(result)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar muitos agendamentos de pedido', error, { options });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: OrderScheduleUpdateFormData,
    options?: UpdateOptions<OrderScheduleInclude>,
  ): Promise<OrderSchedule> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.orderSchedule.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar agendamento de pedido ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<OrderSchedule> {
    try {
      const result = await transaction.orderSchedule.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar agendamento de pedido ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: OrderScheduleWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.orderSchedule.count({ where: whereInput });
    } catch (error) {
      this.logError('contar agendamentos de pedido', error, { where });
      throw error;
    }
  }

  // =====================
  // Specialized schedule operations
  // =====================

  async findActiveSchedules(tx?: PrismaTransaction): Promise<OrderSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.orderSchedule.findMany({
        where: { isActive: true },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedidos ativos', error);
      throw error;
    }
  }

  async findDueSchedules(
    upToDate: Date = new Date(),
    tx?: PrismaTransaction,
  ): Promise<OrderSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.orderSchedule.findMany({
        where: {
          isActive: true,
          nextRun: {
            lte: upToDate,
          },
        },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedidos vencidos', error, { upToDate });
      throw error;
    }
  }

  async findByFrequency(
    frequency: SCHEDULE_FREQUENCY,
    tx?: PrismaTransaction,
  ): Promise<OrderSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.orderSchedule.findMany({
        where: { frequency: frequency as ScheduleFrequency },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedidos por frequência', error, { frequency });
      throw error;
    }
  }

  async calculateNextOccurrence(schedule: OrderSchedule): Promise<Date | null> {
    try {
      const now = new Date();
      const currentDate = schedule.nextRun || now;

      switch (schedule.frequency) {
        case SCHEDULE_FREQUENCY.DAILY:
          return new Date(currentDate.getTime() + schedule.frequencyCount * 24 * 60 * 60 * 1000);

        case SCHEDULE_FREQUENCY.WEEKLY:
          return new Date(
            currentDate.getTime() + schedule.frequencyCount * 7 * 24 * 60 * 60 * 1000,
          );

        case SCHEDULE_FREQUENCY.MONTHLY:
          const nextMonth = new Date(currentDate);
          nextMonth.setMonth(nextMonth.getMonth() + schedule.frequencyCount);
          return nextMonth;

        case SCHEDULE_FREQUENCY.QUARTERLY:
          const nextQuarter = new Date(currentDate);
          nextQuarter.setMonth(nextQuarter.getMonth() + 3 * schedule.frequencyCount);
          return nextQuarter;

        case SCHEDULE_FREQUENCY.ANNUAL:
          const nextYear = new Date(currentDate);
          nextYear.setFullYear(nextYear.getFullYear() + schedule.frequencyCount);
          return nextYear;

        case SCHEDULE_FREQUENCY.ONCE:
          return null; // One-time schedules don't have next occurrences

        default:
          this.logger.warn(
            `Unsupported frequency for next occurrence calculation: ${schedule.frequency}`,
          );
          return null;
      }
    } catch (error) {
      this.logError('calcular próxima ocorrência de pedido', error, { scheduleId: schedule.id });
      throw error;
    }
  }

  async updateNextRun(id: string, nextRun: Date, tx?: PrismaTransaction): Promise<OrderSchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.orderSchedule.update({
        where: { id },
        data: {
          nextRun,
          lastRun: new Date(),
        },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar próxima execução de pedido ${id}`, error, { nextRun });
      throw error;
    }
  }

  async findByItemIds(itemIds: string[], tx?: PrismaTransaction): Promise<OrderSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.orderSchedule.findMany({
        where: {
          items: {
            hasSome: itemIds,
          },
        },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedidos por IDs de itens', error, { itemIds });
      throw error;
    }
  }

  async findBySupplierId(supplierId: string, tx?: PrismaTransaction): Promise<OrderSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.orderSchedule.findMany({
        where: {
          order: {
            supplierId,
          },
        },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedidos por ID do fornecedor', error, { supplierId });
      throw error;
    }
  }

  async findByCategoryId(categoryId: string, tx?: PrismaTransaction): Promise<OrderSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.orderSchedule.findMany({
        where: {
          order: {
            items: {
              some: {
                item: {
                  categoryId,
                },
              },
            },
          },
        },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedidos por ID da categoria', error, { categoryId });
      throw error;
    }
  }

  async findOverdueSchedules(tx?: PrismaTransaction): Promise<OrderSchedule[]> {
    try {
      const client = tx || this.prisma;
      const now = new Date();
      const results = await client.orderSchedule.findMany({
        where: {
          isActive: true,
          nextRun: {
            lt: now,
          },
        },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de pedidos em atraso', error);
      throw error;
    }
  }

  async deactivate(id: string, tx?: PrismaTransaction): Promise<OrderSchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.orderSchedule.update({
        where: { id },
        data: { isActive: false },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`desativar agendamento de pedido ${id}`, error);
      throw error;
    }
  }

  async activate(id: string, tx?: PrismaTransaction): Promise<OrderSchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.orderSchedule.update({
        where: { id },
        data: { isActive: true },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`ativar agendamento de pedido ${id}`, error);
      throw error;
    }
  }
}
