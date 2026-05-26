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
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '../../../../../types';

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

  // The recurrence config relations (weeklyConfig/monthlyConfig/yearlyConfig)
  // are the SINGLE SOURCE OF TRUTH for scheduling: `calculateNextRunDate`
  // (utils/order.ts) and the scheduler read ONLY these relations, never the
  // flat top-level dayOfMonth/dayOfWeek/month columns. The web/mobile forms,
  // however, send positional configs nested (`monthlySchedule`) but fixed
  // values flat (top-level `dayOfMonth`/`dayOfWeek`/`month`). These helpers
  // normalize BOTH inputs into the config relations so every frequency gets a
  // usable config (otherwise fixed-day schedules get nextRun=null and never
  // fire). Building the config from the opposite branch's nulled columns also
  // clears stale data on a mode switch (positional↔fixed).

  private static readonly MONTHLY_FREQUENCIES: ReadonlyArray<string> = [
    SCHEDULE_FREQUENCY.MONTHLY,
    SCHEDULE_FREQUENCY.BIMONTHLY,
    SCHEDULE_FREQUENCY.QUARTERLY,
    SCHEDULE_FREQUENCY.TRIANNUAL,
    SCHEDULE_FREQUENCY.QUADRIMESTRAL,
    SCHEDULE_FREQUENCY.SEMI_ANNUAL,
  ];

  private static readonly WEEKLY_FREQUENCIES: ReadonlyArray<string> = [
    SCHEDULE_FREQUENCY.WEEKLY,
    SCHEDULE_FREQUENCY.BIWEEKLY,
  ];

  private isMonthlyFrequency(frequency?: string): boolean {
    return !!frequency && OrderSchedulePrismaRepository.MONTHLY_FREQUENCIES.includes(frequency);
  }

  private isWeeklyFrequency(frequency?: string): boolean {
    return !!frequency && OrderSchedulePrismaRepository.WEEKLY_FREQUENCIES.includes(frequency);
  }

  /** Expand a single flat dayOfWeek into the 7 booleans WeeklyScheduleConfig expects. */
  private weeklyConfigFromDayOfWeek(dayOfWeek: string): Prisma.WeeklyScheduleConfigCreateWithoutOrderScheduleInput {
    return {
      monday: dayOfWeek === DayOfWeek.MONDAY,
      tuesday: dayOfWeek === DayOfWeek.TUESDAY,
      wednesday: dayOfWeek === DayOfWeek.WEDNESDAY,
      thursday: dayOfWeek === DayOfWeek.THURSDAY,
      friday: dayOfWeek === DayOfWeek.FRIDAY,
      saturday: dayOfWeek === DayOfWeek.SATURDAY,
      sunday: dayOfWeek === DayOfWeek.SUNDAY,
    };
  }

  /** Always set all three monthly columns so the unused branch is explicitly nulled. */
  private normalizeMonthlyConfig(monthly: {
    dayOfMonth?: number | null;
    occurrence?: string | null;
    dayOfWeek?: string | null;
  }): { dayOfMonth: number | null; occurrence: MonthOccurrence | null; dayOfWeek: DayOfWeek | null } {
    return {
      dayOfMonth: monthly.dayOfMonth ?? null,
      occurrence: (monthly.occurrence ?? null) as MonthOccurrence | null,
      dayOfWeek: (monthly.dayOfWeek ?? null) as DayOfWeek | null,
    };
  }

  private normalizeYearlyConfig(yearly: {
    month: string;
    dayOfMonth?: number | null;
    occurrence?: string | null;
    dayOfWeek?: string | null;
  }): { month: Month; dayOfMonth: number | null; occurrence: MonthOccurrence | null; dayOfWeek: DayOfWeek | null } {
    return {
      month: yearly.month as Month,
      dayOfMonth: yearly.dayOfMonth ?? null,
      occurrence: (yearly.occurrence ?? null) as MonthOccurrence | null,
      dayOfWeek: (yearly.dayOfWeek ?? null) as DayOfWeek | null,
    };
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: OrderScheduleCreateFormData,
  ): Prisma.OrderScheduleCreateInput {
    const {
      frequency,
      weeklySchedule,
      monthlySchedule,
      yearlySchedule,
      dayOfWeek,
      month,
      dayOfMonth,
      supplierId,
      ...rest
    } = formData;

    const createInput: Prisma.OrderScheduleCreateInput = {
      ...rest,
      frequency: frequency as ScheduleFrequency,
      // Keep the flat columns for display/back-compat; the configs below drive scheduling.
      dayOfMonth: dayOfMonth ?? undefined,
      dayOfWeek: dayOfWeek ? (dayOfWeek as DayOfWeek) : undefined,
      month: month ? (month as Month) : undefined,
    };

    // Supplier is a defined Prisma @relation, so the strict CreateInput requires
    // the nested `supplier: { connect: { id } }` shape rather than a raw
    // supplierId column. Skip when nullish to preserve "no supplier" schedules.
    if (supplierId) {
      createInput.supplier = { connect: { id: supplierId } };
    }

    // WEEKLY config — nested object if present, else build from the flat single dayOfWeek.
    if (weeklySchedule) {
      createInput.weeklyConfig = { create: weeklySchedule };
    } else if (this.isWeeklyFrequency(frequency) && dayOfWeek) {
      createInput.weeklyConfig = { create: this.weeklyConfigFromDayOfWeek(dayOfWeek) };
    }

    // MONTHLY config — nested (positional or fixed) if present, else build from flat dayOfMonth.
    if (monthlySchedule) {
      createInput.monthlyConfig = { create: this.normalizeMonthlyConfig(monthlySchedule) };
    } else if (this.isMonthlyFrequency(frequency) && dayOfMonth != null) {
      createInput.monthlyConfig = {
        create: { dayOfMonth, occurrence: null, dayOfWeek: null },
      };
    }

    // YEARLY config — nested if present, else build from flat month + dayOfMonth.
    if (yearlySchedule) {
      createInput.yearlyConfig = { create: this.normalizeYearlyConfig(yearlySchedule) };
    } else if (frequency === SCHEDULE_FREQUENCY.ANNUAL && month && dayOfMonth != null) {
      createInput.yearlyConfig = {
        create: { month: month as Month, dayOfMonth, occurrence: null, dayOfWeek: null },
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: OrderScheduleUpdateFormData,
  ): Prisma.OrderScheduleUpdateInput {
    const {
      weeklySchedule,
      frequency,
      monthlySchedule,
      yearlySchedule,
      dayOfWeek,
      month,
      dayOfMonth,
      supplierId,
      ...rest
    } = formData;

    const updateInput: Prisma.OrderScheduleUpdateInput = {
      ...rest,
    };

    // Supplier as nested connect/disconnect to satisfy strict UpdateInput.
    // - `supplierId === undefined` → key not in payload, no change
    // - `supplierId === null`      → explicit clear (disconnect)
    // - `supplierId === '<uuid>'`  → connect to that supplier
    if (supplierId !== undefined) {
      updateInput.supplier = supplierId ? { connect: { id: supplierId } } : { disconnect: true };
    }

    if (frequency !== undefined) {
      updateInput.frequency = frequency as ScheduleFrequency;
    }

    // Handle flat enum fields (kept for display/back-compat; configs drive scheduling)
    if (dayOfWeek !== undefined) {
      updateInput.dayOfWeek = dayOfWeek ? (dayOfWeek as DayOfWeek) : null;
    }

    if (month !== undefined) {
      updateInput.month = month ? (month as Month) : null;
    }

    if (dayOfMonth !== undefined) {
      updateInput.dayOfMonth = dayOfMonth ?? null;
    }

    // Normalize recurrence into the config relations (see mapCreate comment).
    // Each upsert sets ALL columns so switching modes (positional↔fixed) clears
    // the stale branch instead of leaving e.g. a lingering occurrence/dayOfWeek
    // that would silently win in calculateNextRunDate.

    // WEEKLY — nested object if present, else build from the flat single dayOfWeek.
    if (weeklySchedule !== undefined) {
      updateInput.weeklyConfig = {
        upsert: { create: weeklySchedule, update: weeklySchedule },
      };
    } else if (this.isWeeklyFrequency(frequency) && dayOfWeek) {
      const cfg = this.weeklyConfigFromDayOfWeek(dayOfWeek);
      updateInput.weeklyConfig = { upsert: { create: cfg, update: cfg } };
    }

    // MONTHLY — nested (positional/fixed) if present, else build from flat dayOfMonth.
    if (monthlySchedule !== undefined) {
      const cfg = this.normalizeMonthlyConfig(monthlySchedule);
      updateInput.monthlyConfig = { upsert: { create: cfg, update: cfg } };
    } else if (this.isMonthlyFrequency(frequency) && dayOfMonth != null) {
      const cfg = { dayOfMonth, occurrence: null, dayOfWeek: null };
      updateInput.monthlyConfig = { upsert: { create: cfg, update: cfg } };
    }

    // YEARLY — nested if present, else build from flat month + dayOfMonth.
    if (yearlySchedule !== undefined) {
      const cfg = this.normalizeYearlyConfig(yearlySchedule);
      updateInput.yearlyConfig = { upsert: { create: cfg, update: cfg } };
    } else if (frequency === SCHEDULE_FREQUENCY.ANNUAL && month && dayOfMonth != null) {
      const cfg = { month: month as Month, dayOfMonth, occurrence: null, dayOfWeek: null };
      updateInput.yearlyConfig = { upsert: { create: cfg, update: cfg } };
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
