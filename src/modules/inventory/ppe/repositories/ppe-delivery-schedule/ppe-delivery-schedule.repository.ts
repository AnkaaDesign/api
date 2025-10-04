// repositories/ppe-delivery-schedule.repository.ts

import { PpeDeliverySchedule } from '../../../../../types';
import {
  PpeDeliveryScheduleCreateFormData,
  PpeDeliveryScheduleUpdateFormData,
  PpeDeliveryScheduleInclude,
  PpeDeliveryScheduleOrderBy,
  PpeDeliveryScheduleWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { SCHEDULE_FREQUENCY } from '../../../../../constants';

export abstract class PpeDeliveryScheduleRepository extends BaseStringRepository<
  PpeDeliverySchedule,
  PpeDeliveryScheduleCreateFormData,
  PpeDeliveryScheduleUpdateFormData,
  PpeDeliveryScheduleInclude,
  PpeDeliveryScheduleOrderBy,
  PpeDeliveryScheduleWhere
> {
  /**
   * Find all active PPE delivery schedules
   */
  abstract findActiveSchedules(tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]>;

  /**
   * Find PPE delivery schedules that are due for execution
   */
  abstract findDueSchedules(
    upToDate?: Date,
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule[]>;

  /**
   * Find PPE delivery schedules by frequency
   */
  abstract findByFrequency(
    frequency: SCHEDULE_FREQUENCY,
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule[]>;

  /**
   * Calculate the next occurrence date for a PPE delivery schedule
   */
  abstract calculateNextOccurrence(schedule: PpeDeliverySchedule): Promise<Date | null>;

  /**
   * Update the next run date for a PPE delivery schedule
   */
  abstract updateNextRun(
    id: string,
    nextRun: Date,
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule>;

  /**
   * Find PPE delivery schedules by PPE type
   */
  abstract findByPpeType(ppeType: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]>;

  /**
   * Find PPE delivery schedules containing any of the specified PPE types
   */
  abstract findByPpeTypes(
    ppeTypes: string[],
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule[]>;

  /**
   * Find PPE delivery schedules by user ID
   */
  abstract findByUserId(userId: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]>;

  /**
   * Find PPE delivery schedules by category ID
   */
  abstract findByCategoryId(
    categoryId: string,
    tx?: PrismaTransaction,
  ): Promise<PpeDeliverySchedule[]>;

  /**
   * Find overdue PPE delivery schedules
   */
  abstract findOverdueSchedules(tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]>;

  /**
   * Deactivate PPE delivery schedule
   */
  abstract deactivate(id: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule>;

  /**
   * Activate PPE delivery schedule
   */
  abstract activate(id: string, tx?: PrismaTransaction): Promise<PpeDeliverySchedule>;

  /**
   * Find schedules requiring reschedule
   */
  abstract findSchedulesForReschedule(tx?: PrismaTransaction): Promise<PpeDeliverySchedule[]>;
}
