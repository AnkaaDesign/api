import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MaintenanceScheduleService } from './maintenance-schedule.service';

/**
 * MaintenanceScheduleScheduler
 *
 * Daily cron that creates the next Maintenance for active MaintenanceSchedules
 * once their nextRun enters the lead-time window (see
 * MaintenanceScheduleService.getLeadTimeDays — 1 day for DAILY/WEEKLY/BIWEEKLY,
 * 7 days otherwise). This keeps long-cadence schedules (e.g. SEMI_ANNUAL) from
 * having their next occurrence sit PENDING for months — handleMaintenanceCompletion
 * only advances the schedule's nextRun/lastRun; this cron is what actually
 * materializes the Maintenance record close to when it's due.
 */
@Injectable()
export class MaintenanceScheduleScheduler {
  private readonly logger = new Logger(MaintenanceScheduleScheduler.name);

  constructor(private readonly maintenanceScheduleService: MaintenanceScheduleService) {}

  @Cron('30 6 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleProcessDueSchedules(): Promise<void> {
    this.logger.log('Running daily maintenance schedule processing...');
    try {
      const result = await this.maintenanceScheduleService.processDueSchedules();
      this.logger.log(
        `Maintenance schedule processing completed: ${result.totalProcessed} processed, ` +
          `${result.totalCreated} maintenance(s) created, ${result.errors.length} errors`,
      );
      if (result.errors.length > 0) {
        result.errors.forEach(error => {
          this.logger.error(`Schedule ${error.scheduleId}: ${error.error}`);
        });
      }
    } catch (error) {
      this.logger.error('Failed to run maintenance schedule processing cron job', error);
    }
  }
}
