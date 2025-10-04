// repositories/ppe-delivery-schedule-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { PpeDeliverySchedule } from '../../../../../types';
import {
  PpeDeliveryScheduleCreateFormData,
  PpeDeliveryScheduleUpdateFormData,
  PpeDeliveryScheduleInclude,
  PpeDeliveryScheduleOrderBy,
  PpeDeliveryScheduleWhere,
} from '../../../../../schemas';
import { CreateOptions, FindManyOptions, FindManyResult, UpdateOptions } from '../../../../../types';
import { PpeDeliveryScheduleRepository } from './ppe-delivery-schedule.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  AssignmentType,
  DayOfWeek,
  Month,
  Prisma,
  PpeType,
  RescheduleReason,
  ScheduleFrequency,
} from '@prisma/client';
import { SCHEDULE_FREQUENCY } from '../../../../../constants';

@Injectable()
export class PpeDeliverySchedulePrismaRepository
  extends BaseStringPrismaRepository<
    PpeDeliverySchedule,
    PpeDeliveryScheduleCreateFormData,
    PpeDeliveryScheduleUpdateFormData,
    PpeDeliveryScheduleInclude,
    PpeDeliveryScheduleOrderBy,
    PpeDeliveryScheduleWhere,
    Prisma.PpeDeliveryScheduleGetPayload<{ include: any }>,
    Prisma.PpeDeliveryScheduleCreateInput,
    Prisma.PpeDeliveryScheduleUpdateInput,
    Prisma.PpeDeliveryScheduleInclude,
    | Prisma.PpeDeliveryScheduleOrderByWithRelationInput
    | Prisma.PpeDeliveryScheduleOrderByWithRelationInput[],
    Prisma.PpeDeliveryScheduleWhereInput
  >
  implements PpeDeliveryScheduleRepository
{
  protected readonly logger = new Logger(PpeDeliverySchedulePrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): PpeDeliverySchedule {
    return databaseEntity as PpeDeliverySchedule;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PpeDeliveryScheduleCreateFormData,
  ): Prisma.PpeDeliveryScheduleCreateInput {
    const {
      ppeItems,
      frequency,
      dayOfWeek,
      month,
      customMonths,
      rescheduleReason,
      assignmentType,
      excludedUserIds,
      includedUserIds,
      ...rest
    } = formData;

    const createInput: Prisma.PpeDeliveryScheduleCreateInput = {
      ...rest,
      ppeItems: (ppeItems || []) as Prisma.InputJsonValue, // This is a JSON field storing array of {ppeType: PpeType, quantity: number}
      frequency: frequency as ScheduleFrequency,
      dayOfWeek: dayOfWeek as DayOfWeek | null | undefined,
      month: month as Month | null | undefined,
      customMonths: customMonths as Month[] | undefined,
      rescheduleReason: rescheduleReason as RescheduleReason | null | undefined,
      assignmentType: (assignmentType || 'ALL') as AssignmentType,
      excludedUserIds: excludedUserIds || [],
      includedUserIds: includedUserIds || [],
      nextRun: new Date(),
    };

    // Note: PpeDeliverySchedule doesn't have itemId, userId, or categoryId fields
    // The model uses assignmentType with includedUserIds/excludedUserIds for user assignment
    // PPE types and quantities are stored in the ppeItems JSON field

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PpeDeliveryScheduleUpdateFormData,
  ): Prisma.PpeDeliveryScheduleUpdateInput {
    const {
      ppeItems,
      frequency,
      dayOfWeek,
      month,
      customMonths,
      rescheduleReason,
      assignmentType,
      excludedUserIds,
      includedUserIds,
      ...rest
    } = formData;

    const updateInput: Prisma.PpeDeliveryScheduleUpdateInput = {
      ...rest,
    };

    if (ppeItems !== undefined) {
      // For JSON fields in Prisma, we need to ensure the value is properly typed
      updateInput.ppeItems = ppeItems as Prisma.InputJsonValue;
    }
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
    if (rescheduleReason !== undefined) {
      updateInput.rescheduleReason = rescheduleReason as RescheduleReason | null;
    }
    if (assignmentType !== undefined) {
      updateInput.assignmentType = assignmentType as AssignmentType;
    }
    if (excludedUserIds !== undefined) {
      updateInput.excludedUserIds = excludedUserIds;
    }
    if (includedUserIds !== undefined) {
      updateInput.includedUserIds = includedUserIds;
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PpeDeliveryScheduleInclude,
  ): Prisma.PpeDeliveryScheduleInclude | undefined {
    if (!include) return undefined;

    // Filter out invalid includes - PpeDeliverySchedule only has these relations:
    // - weeklyConfig, monthlyConfig, yearlyConfig (schedule configs)
    // - deliveries (PpeDelivery[])
    // - autoOrders (Order[])
    const validInclude: any = {};

    // Only include valid relations
    if ('weeklyConfig' in include) validInclude.weeklyConfig = include.weeklyConfig;
    if ('monthlyConfig' in include) validInclude.monthlyConfig = include.monthlyConfig;
    if ('yearlyConfig' in include) validInclude.yearlyConfig = include.yearlyConfig;
    if ('deliveries' in include) validInclude.deliveries = include.deliveries;
    if ('autoOrders' in include) validInclude.autoOrders = include.autoOrders;

    // Note: 'item', 'user', and 'category' are not valid relations on PpeDeliverySchedule
    // PPE types are stored in the ppeItems JSON field
    // User assignment is handled via assignmentType with includedUserIds/excludedUserIds

    return Object.keys(validInclude).length > 0 ? validInclude : undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PpeDeliveryScheduleOrderBy,
  ):
    | Prisma.PpeDeliveryScheduleOrderByWithRelationInput
    | Prisma.PpeDeliveryScheduleOrderByWithRelationInput[]
    | undefined {
    if (!orderBy) return undefined;

    // Prisma expects an array for orderBy
    if (Array.isArray(orderBy)) {
      return orderBy as Prisma.PpeDeliveryScheduleOrderByWithRelationInput[];
    }

    // If it's an object with multiple fields, convert to array format
    // e.g., { isActive: "desc", nextRun: "asc" } becomes [{ isActive: "desc" }, { nextRun: "asc" }]
    if (typeof orderBy === 'object' && orderBy !== null) {
      const orderByArray: Prisma.PpeDeliveryScheduleOrderByWithRelationInput[] = [];
      for (const [key, value] of Object.entries(orderBy)) {
        orderByArray.push({ [key]: value } as Prisma.PpeDeliveryScheduleOrderByWithRelationInput);
      }
      return orderByArray;
    }

    // Fallback: wrap single value in array
    return [orderBy as Prisma.PpeDeliveryScheduleOrderByWithRelationInput];
  }

  protected mapWhereToDatabaseWhere(
    where?: PpeDeliveryScheduleWhere,
  ): Prisma.PpeDeliveryScheduleWhereInput | undefined {
    return where as Prisma.PpeDeliveryScheduleWhereInput;
  }

  protected getDefaultInclude(): Prisma.PpeDeliveryScheduleInclude {
    return {
      weeklyConfig: true,
      monthlyConfig: true,
      yearlyConfig: true,
      deliveries: {
        include: {
          item: true,
          user: true,
        },
        take: 10, // Limit to avoid too much data
        orderBy: [
          {
            scheduledDate: 'desc',
          },
        ],
      },
      autoOrders: {
        take: 5, // Limit to recent orders
        orderBy: [
          {
            createdAt: 'desc',
          },
        ],
      },
    };
  }

  protected getDatabaseModel(tx?: PrismaTransaction) {
    return tx ? tx.ppeDeliverySchedule : this.prisma.ppeDeliverySchedule;
  }

  // Implement abstract methods from base

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PpeDeliveryScheduleCreateFormData,
    options?: CreateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeDeliverySchedule.create({
        data: createInput,
        include: includeInput,
      });

      // Note: Related schedule configuration should be created in the service layer, not here

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar agendamento PPE', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeDeliverySchedule.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar agendamento PPE por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.ppeDeliverySchedule.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      PpeDeliveryScheduleOrderBy,
      PpeDeliveryScheduleWhere,
      PpeDeliveryScheduleInclude
    >,
  ): Promise<FindManyResult<PpeDeliverySchedule>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, schedules] = await Promise.all([
      transaction.ppeDeliverySchedule.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.ppeDeliverySchedule.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [{ nextRun: 'asc' }],
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: schedules.map(schedule => this.mapDatabaseEntityToEntity(schedule)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PpeDeliveryScheduleUpdateFormData,
    options?: UpdateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeDeliverySchedule.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar agendamento PPE ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<PpeDeliverySchedule> {
    try {
      // Note: Related schedule configuration cleanup should be handled in the service layer
      const result = await transaction.ppeDeliverySchedule.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar agendamento PPE ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PpeDeliveryScheduleWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.ppeDeliverySchedule.count({ where: whereInput });
    } catch (error) {
      this.logError('contar agendamentos PPE', error, { where });
      throw error;
    }
  }

  // Non-transaction methods that delegate to transaction methods
  async create(
    data: PpeDeliveryScheduleCreateFormData,
    options?: CreateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule> {
    return this.createWithTransaction(this.prisma, data, options);
  }

  async findById(
    id: string,
    options?: CreateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule | null> {
    return this.findByIdWithTransaction(this.prisma, id, options);
  }

  async findByIds(
    ids: string[],
    options?: CreateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule[]> {
    return this.findByIdsWithTransaction(this.prisma, ids, options);
  }

  async findMany(
    options?: FindManyOptions<
      PpeDeliveryScheduleOrderBy,
      PpeDeliveryScheduleWhere,
      PpeDeliveryScheduleInclude
    >,
  ): Promise<FindManyResult<PpeDeliverySchedule>> {
    return this.findManyWithTransaction(this.prisma, options);
  }

  async update(
    id: string,
    data: PpeDeliveryScheduleUpdateFormData,
    options?: UpdateOptions<PpeDeliveryScheduleInclude>,
  ): Promise<PpeDeliverySchedule> {
    return this.updateWithTransaction(this.prisma, id, data, options);
  }

  async delete(id: string): Promise<PpeDeliverySchedule> {
    return this.deleteWithTransaction(this.prisma, id);
  }

  async count(where?: PpeDeliveryScheduleWhere): Promise<number> {
    return this.countWithTransaction(this.prisma, where);
  }

  // =====================
  // Specialized schedule operations
  // =====================

  async findActiveSchedules(tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.ppeDeliverySchedule.findMany({
        where: { isActive: true },
        include: this.getDefaultInclude(),
        orderBy: [{ nextRun: 'asc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE ativos', error);
      throw error;
    }
  }

  async findDueSchedules(
    upToDate: Date = new Date(),
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.ppeDeliverySchedule.findMany({
        where: {
          isActive: true,
          nextRun: {
            lte: upToDate,
          },
        },
        include: this.getDefaultInclude(),
        orderBy: [{ nextRun: 'asc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE vencidos', error, { upToDate });
      throw error;
    }
  }

  async findByFrequency(
    frequency: SCHEDULE_FREQUENCY,
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.ppeDeliverySchedule.findMany({
        where: { frequency: frequency as ScheduleFrequency },
        include: this.getDefaultInclude(),
        orderBy: [{ nextRun: 'asc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE por frequência', error, { frequency });
      throw error;
    }
  }

  async calculateNextOccurrence(schedule: PpeDeliverySchedule): Promise<Date | null> {
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
      this.logError('calcular próxima ocorrência PPE', error, { scheduleId: schedule.id });
      throw error;
    }
  }

  async updateNextRun(
    id: string,
    nextRun: Date,
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.ppeDeliverySchedule.update({
        where: { id },
        data: {
          nextRun,
          lastRun: new Date(),
        },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar próxima execução PPE ${id}`, error, { nextRun });
      throw error;
    }
  }

  async findByPpeType(ppeType: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.ppeDeliverySchedule.findMany({
        where: {
          ppeItems: {
            path: ['$'],
            array_contains: {
              ppeType: ppeType,
            },
          },
        },
        include: this.getDefaultInclude(),
        orderBy: [{ nextRun: 'asc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE por tipo', error, { ppeType });
      throw error;
    }
  }

  async findByPpeTypes(ppeTypes: string[], tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.ppeDeliverySchedule.findMany({
        where: {
          OR: ppeTypes.map(ppeType => ({
            ppeItems: {
              path: ['$'],
              array_contains: {
                ppeType: ppeType,
              },
            },
          })),
        },
        include: this.getDefaultInclude(),
        orderBy: [{ nextRun: 'asc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE por tipos', error, { ppeTypes });
      throw error;
    }
  }

  async findByUserId(userId: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.ppeDeliverySchedule.findMany({
        where: {
          OR: [
            // For ALL assignment type, user should not be in excludedUserIds
            {
              assignmentType: 'ALL',
              NOT: {
                excludedUserIds: {
                  has: userId,
                },
              },
            },
            // For SPECIFIC assignment type, user should be in includedUserIds
            {
              assignmentType: 'SPECIFIC',
              includedUserIds: {
                has: userId,
              },
            },
          ],
        },
        include: this.getDefaultInclude(),
        orderBy: [{ nextRun: 'asc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE por usuário', error, { userId });
      throw error;
    }
  }

  async findByCategoryId(
    categoryId: string,
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule[]> {
    // Note: PpeDeliverySchedule doesn't have a categoryId field
    // This method is required by the interface but returns empty array
    // PPE types are stored in the ppeItems JSON field instead
    this.logger.warn(
      `findByCategoryId called but PpeDeliverySchedule doesn't have categoryId field`,
    );
    return [];
  }

  async findOverdueSchedules(tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const now = new Date();
      const results = await client.ppeDeliverySchedule.findMany({
        where: {
          isActive: true,
          nextRun: {
            lt: now,
          },
        },
        include: this.getDefaultInclude(),
        orderBy: [{ nextRun: 'asc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE em atraso', error);
      throw error;
    }
  }

  async deactivate(id: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.ppeDeliverySchedule.update({
        where: { id },
        data: { isActive: false },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`desativar agendamento PPE ${id}`, error);
      throw error;
    }
  }

  async activate(id: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule> {
    try {
      const client = tx || this.prisma;
      const result = await client.ppeDeliverySchedule.update({
        where: { id },
        data: { isActive: true },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`ativar agendamento PPE ${id}`, error);
      throw error;
    }
  }

  async findSchedulesForReschedule(tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]> {
    try {
      const client = tx || this.prisma;
      const results = await client.ppeDeliverySchedule.findMany({
        where: {
          isActive: true,
          rescheduleCount: {
            gt: 0,
          },
        },
        include: this.getDefaultInclude(),
        orderBy: [{ lastRescheduleDate: 'desc' }],
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar agendamentos PPE para reagendar', error);
      throw error;
    }
  }
}
