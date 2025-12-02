import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  MaintenanceSchedule as PrismaMaintenanceSchedule,
  Prisma,
  ScheduleFrequency,
  MaintenanceScheduleStatus,
  DayOfWeek,
  Month,
} from '@prisma/client';
import { MaintenanceScheduleRepository } from './maintenance-schedule.repository';
import {
  SCHEDULE_FREQUENCY,
  WEEK_DAY,
  MONTH,
  RESCHEDULE_REASON,
} from '../../../../../constants/enums';
import {
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
  MaintenanceSchedule,
} from '../../../../../types';
import {
  MaintenanceScheduleCreateFormData,
  MaintenanceScheduleUpdateFormData,
  MaintenanceScheduleInclude,
  MaintenanceScheduleOrderBy,
  MaintenanceScheduleWhere,
} from '../../../../../schemas/maintenance';

@Injectable()
export class MaintenanceSchedulePrismaRepository
  extends BaseStringPrismaRepository<
    MaintenanceSchedule,
    MaintenanceScheduleCreateFormData,
    MaintenanceScheduleUpdateFormData,
    MaintenanceScheduleInclude,
    MaintenanceScheduleOrderBy,
    MaintenanceScheduleWhere,
    PrismaMaintenanceSchedule,
    Prisma.MaintenanceScheduleCreateInput,
    Prisma.MaintenanceScheduleUpdateInput,
    Prisma.MaintenanceScheduleInclude,
    Prisma.MaintenanceScheduleOrderByWithRelationInput,
    Prisma.MaintenanceScheduleWhereInput
  >
  implements MaintenanceScheduleRepository
{
  protected readonly logger = new Logger(MaintenanceSchedulePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(
    databaseEntity: PrismaMaintenanceSchedule,
  ): MaintenanceSchedule {
    return {
      ...databaseEntity,
      frequency: databaseEntity.frequency as SCHEDULE_FREQUENCY,
      status: databaseEntity.status as string,
      dayOfWeek: databaseEntity.dayOfWeek as WEEK_DAY | null,
      month: databaseEntity.month as MONTH | null,
      customMonths: (databaseEntity.customMonths || []) as MONTH[],
    } as MaintenanceSchedule;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: MaintenanceScheduleCreateFormData,
  ): Prisma.MaintenanceScheduleCreateInput {
    const {
      itemId,
      frequency,
      dayOfWeek,
      month,
      customMonths,
      weeklyConfigId,
      monthlyConfigId,
      yearlyConfigId,
      ...rest
    } = formData;

    const createInput: Prisma.MaintenanceScheduleCreateInput = {
      ...rest,
      name: formData.name || '', // Ensure name is provided
      description: formData.description || '', // Ensure description is provided
      frequency: frequency as ScheduleFrequency,
      dayOfWeek: dayOfWeek as DayOfWeek | null | undefined,
      month: month as Month | null | undefined,
      customMonths: customMonths as Month[] | undefined,
    };

    if (itemId) {
      createInput.item = { connect: { id: itemId } };
    }

    if (weeklyConfigId) {
      createInput.weeklyConfig = { connect: { id: weeklyConfigId } };
    }

    if (monthlyConfigId) {
      createInput.monthlyConfig = { connect: { id: monthlyConfigId } };
    }

    if (yearlyConfigId) {
      createInput.yearlyConfig = { connect: { id: yearlyConfigId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: MaintenanceScheduleUpdateFormData,
  ): Prisma.MaintenanceScheduleUpdateInput {
    const {
      itemId,
      frequency,
      dayOfWeek,
      month,
      customMonths,
      weeklyConfigId,
      monthlyConfigId,
      yearlyConfigId,
      ...rest
    } = formData;

    const updateInput: Prisma.MaintenanceScheduleUpdateInput = {
      ...rest,
    };

    if (frequency !== undefined) {
      updateInput.frequency = frequency as ScheduleFrequency;
    }
    if (dayOfWeek !== undefined) {
      updateInput.dayOfWeek = dayOfWeek as DayOfWeek | null;
    }
    if (month !== undefined) {
      updateInput.month = month as Month | null;
    }
    if (customMonths !== undefined) {
      updateInput.customMonths = customMonths as Month[];
    }

    if (itemId !== undefined) {
      updateInput.item = itemId ? { connect: { id: itemId } } : { disconnect: true };
    }

    if (weeklyConfigId !== undefined) {
      updateInput.weeklyConfig = weeklyConfigId
        ? { connect: { id: weeklyConfigId } }
        : { disconnect: true };
    }

    if (monthlyConfigId !== undefined) {
      updateInput.monthlyConfig = monthlyConfigId
        ? { connect: { id: monthlyConfigId } }
        : { disconnect: true };
    }

    if (yearlyConfigId !== undefined) {
      updateInput.yearlyConfig = yearlyConfigId
        ? { connect: { id: yearlyConfigId } }
        : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: MaintenanceScheduleInclude,
  ): Prisma.MaintenanceScheduleInclude | undefined {
    return include as Prisma.MaintenanceScheduleInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: MaintenanceScheduleOrderBy,
  ): Prisma.MaintenanceScheduleOrderByWithRelationInput | undefined {
    return orderBy as Prisma.MaintenanceScheduleOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: MaintenanceScheduleWhere,
  ): Prisma.MaintenanceScheduleWhereInput | undefined {
    return where as Prisma.MaintenanceScheduleWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.MaintenanceScheduleInclude | undefined {
    return {
      item: {
        select: {
          id: true,
          name: true,
          uniCode: true,
        },
      },
      weeklyConfig: true,
      monthlyConfig: true,
      yearlyConfig: true,
      maintenances: {
        take: 5,
        orderBy: { scheduledFor: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          scheduledFor: true,
        },
      },
    };
  }

  // =====================
  // Override required transaction methods from base class
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: MaintenanceScheduleCreateFormData,
    options?: CreateOptions<MaintenanceScheduleInclude>,
  ): Promise<MaintenanceSchedule> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenanceSchedule.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar agendamento de manutenção', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<MaintenanceScheduleInclude>,
  ): Promise<MaintenanceSchedule | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenanceSchedule.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar agendamento de manutenção por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<MaintenanceScheduleInclude>,
  ): Promise<MaintenanceSchedule[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.maintenanceSchedule.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos de manutenção por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      MaintenanceScheduleOrderBy,
      MaintenanceScheduleWhere,
      MaintenanceScheduleInclude
    >,
  ): Promise<FindManyResult<MaintenanceSchedule>> {
    try {
      const { where, orderBy, page = 1, take = 20, include } = options || {};
      const skip = Math.max(0, (page - 1) * take);

      const [total, results] = await Promise.all([
        transaction.maintenanceSchedule.count({ where: this.mapWhereToDatabaseWhere(where) }),
        transaction.maintenanceSchedule.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { nextRun: 'asc' },
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
      this.logError('buscar muitos agendamentos de manutenção', error, { options });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: MaintenanceScheduleUpdateFormData,
    options?: UpdateOptions<MaintenanceScheduleInclude>,
  ): Promise<MaintenanceSchedule> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenanceSchedule.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar agendamento de manutenção ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<MaintenanceSchedule> {
    try {
      const result = await transaction.maintenanceSchedule.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar agendamento de manutenção ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: MaintenanceScheduleWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.maintenanceSchedule.count({ where: whereInput });
    } catch (error) {
      this.logError('contar agendamentos de manutenção', error, { where });
      throw error;
    }
  }

  // =====================
  // Specialized schedule operations
  // =====================

  async findActiveSchedules(tx?: PrismaTransaction): Promise<MaintenanceSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.maintenanceSchedule.findMany({
        where: { isActive: true },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos ativos', error);
      throw error;
    }
  }

  async findDueSchedules(
    upToDate: Date = new Date(),
    tx?: PrismaTransaction,
  ): Promise<MaintenanceSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.maintenanceSchedule.findMany({
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
      this.logError('buscar agendamentos vencidos', error, { upToDate });
      throw error;
    }
  }

  async findByFrequency(
    frequency: SCHEDULE_FREQUENCY,
    tx?: PrismaTransaction,
  ): Promise<MaintenanceSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.maintenanceSchedule.findMany({
        where: { frequency: frequency as ScheduleFrequency },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos por frequência', error, { frequency });
      throw error;
    }
  }

  async calculateNextOccurrence(schedule: MaintenanceSchedule): Promise<Date | null> {
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
      this.logError('calcular próxima ocorrência', error, { scheduleId: schedule.id });
      throw error;
    }
  }

  async updateNextRun(
    id: string,
    nextRun: Date,
    tx?: PrismaTransaction,
  ): Promise<MaintenanceSchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.maintenanceSchedule.update({
        where: { id },
        data: {
          nextRun,
          lastRun: new Date(),
        },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar próxima execução ${id}`, error, { nextRun });
      throw error;
    }
  }

  async findByItemId(itemId: string, tx?: PrismaTransaction): Promise<MaintenanceSchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.maintenanceSchedule.findMany({
        where: { itemId },
        include: this.getDefaultInclude(),
        orderBy: { nextRun: 'asc' },
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos por item', error, { itemId });
      throw error;
    }
  }

  async findOverdueSchedules(tx?: PrismaTransaction): Promise<MaintenanceSchedule[]> {
    try {
      const client = tx || this.prisma;
      const now = new Date();
      const results = await client.maintenanceSchedule.findMany({
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
      this.logError('buscar agendamentos em atraso', error);
      throw error;
    }
  }

  async deactivate(id: string, tx?: PrismaTransaction): Promise<MaintenanceSchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.maintenanceSchedule.update({
        where: { id },
        data: { isActive: false },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`desativar agendamento ${id}`, error);
      throw error;
    }
  }

  async activate(id: string, tx?: PrismaTransaction): Promise<MaintenanceSchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.maintenanceSchedule.update({
        where: { id },
        data: { isActive: true },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`ativar agendamento ${id}`, error);
      throw error;
    }
  }
}
