// repositories/order-schedule.repository.ts

import { OrderSchedule } from '../../../../../types';
import {
  OrderScheduleCreateFormData,
  OrderScheduleUpdateFormData,
  OrderScheduleInclude,
  OrderScheduleWhere,
  OrderScheduleOrderBy,
} from '../../../../../schemas/order';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { SCHEDULE_FREQUENCY } from '../../../../../constants/enums';

export abstract class OrderScheduleRepository extends BaseStringRepository<
  OrderSchedule,
  OrderScheduleCreateFormData,
  OrderScheduleUpdateFormData,
  OrderScheduleInclude,
  OrderScheduleOrderBy,
  OrderScheduleWhere
> {
  /**
   * Find all active order schedules
   */
  abstract findActiveSchedules(tx?: PrismaTransaction): Promise<OrderSchedule[]>;

  /**
   * Find order schedules that are due for execution
   */
  abstract findDueSchedules(upToDate?: Date, tx?: PrismaTransaction): Promise<OrderSchedule[]>;

  /**
   * Find order schedules by frequency
   */
  abstract findByFrequency(
    frequency: SCHEDULE_FREQUENCY,
    tx?: PrismaTransaction,
  ): Promise<OrderSchedule[]>;

  /**
   * Calculate the next occurrence date for an order schedule
   */
  abstract calculateNextOccurrence(schedule: OrderSchedule): Promise<Date | null>;

  /**
   * Update the next run date for an order schedule
   */
  abstract updateNextRun(id: string, nextRun: Date, tx?: PrismaTransaction): Promise<OrderSchedule>;

  /**
   * Find overdue order schedules
   */
  abstract findOverdueSchedules(tx?: PrismaTransaction): Promise<OrderSchedule[]>;

  /**
   * Deactivate order schedule
   */
  abstract deactivate(id: string, tx?: PrismaTransaction): Promise<OrderSchedule>;

  /**
   * Activate order schedule
   */
  abstract activate(id: string, tx?: PrismaTransaction): Promise<OrderSchedule>;
}
