// repositories/maintenance-schedule.repository.ts

import { MaintenanceSchedule } from '../../../../../types';
import {
  MaintenanceScheduleCreateFormData,
  MaintenanceScheduleUpdateFormData,
  MaintenanceScheduleInclude,
  MaintenanceScheduleWhere,
  MaintenanceScheduleOrderBy,
} from '../../../../../schemas/maintenance';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { SCHEDULE_FREQUENCY } from '../../../../../constants/enums';

export abstract class MaintenanceScheduleRepository extends BaseStringRepository<
  MaintenanceSchedule,
  MaintenanceScheduleCreateFormData,
  MaintenanceScheduleUpdateFormData,
  MaintenanceScheduleInclude,
  MaintenanceScheduleOrderBy,
  MaintenanceScheduleWhere
> {
  /**
   * Find all active maintenance schedules
   */
  abstract findActiveSchedules(tx?: PrismaTransaction): Promise<MaintenanceSchedule[]>;

  /**
   * Find maintenance schedules that are due for execution
   */
  abstract findDueSchedules(
    upToDate?: Date,
    tx?: PrismaTransaction,
  ): Promise<MaintenanceSchedule[]>;

  /**
   * Find maintenance schedules by frequency
   */
  abstract findByFrequency(
    frequency: SCHEDULE_FREQUENCY,
    tx?: PrismaTransaction,
  ): Promise<MaintenanceSchedule[]>;

  /**
   * Calculate the next occurrence date for a maintenance schedule
   */
  abstract calculateNextOccurrence(schedule: MaintenanceSchedule): Promise<Date | null>;

  /**
   * Update the next run date for a maintenance schedule
   */
  abstract updateNextRun(
    id: string,
    nextRun: Date,
    tx?: PrismaTransaction,
  ): Promise<MaintenanceSchedule>;

  /**
   * Find maintenance schedules by item ID
   */
  abstract findByItemId(itemId: string, tx?: PrismaTransaction): Promise<MaintenanceSchedule[]>;

  /**
   * Find overdue maintenance schedules
   */
  abstract findOverdueSchedules(tx?: PrismaTransaction): Promise<MaintenanceSchedule[]>;

  /**
   * Deactivate maintenance schedule
   */
  abstract deactivate(id: string, tx?: PrismaTransaction): Promise<MaintenanceSchedule>;

  /**
   * Activate maintenance schedule
   */
  abstract activate(id: string, tx?: PrismaTransaction): Promise<MaintenanceSchedule>;
}
