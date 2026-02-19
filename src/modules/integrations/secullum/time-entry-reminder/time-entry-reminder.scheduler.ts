import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TimeEntryReminderService, TimeEntryType } from './time-entry-reminder.service';

/**
 * Scheduler for time entry reminder notifications
 *
 * Runs every 15 minutes Mon-Fri from 07:00 to 18:45 (São Paulo time).
 * Each run checks all 4 entry types. The service's isTimePastEntry() check
 * ensures only users whose expected time + tolerance has passed get evaluated.
 * Redis dedup in the service prevents duplicate notifications.
 */
@Injectable()
export class TimeEntryReminderScheduler {
  private readonly logger = new Logger(TimeEntryReminderScheduler.name);

  private isProcessing = false;

  constructor(private readonly timeEntryReminderService: TimeEntryReminderService) {}

  /**
   * Single cron that fires every 15 minutes during work hours, Mon-Fri
   */
  @Cron('0,15,30,45 7-18 * * 1-5', { timeZone: 'America/Sao_Paulo' })
  async checkAllEntryTypes(): Promise<void> {
    if (this.isProcessing) {
      this.logger.warn('Time entry check already in progress, skipping this run');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      const entryTypes: TimeEntryType[] = ['ENTRADA1', 'SAIDA1', 'ENTRADA2', 'SAIDA2'];

      for (const entryType of entryTypes) {
        try {
          this.logger.log(`[${entryType}] Starting time entry check`);

          const result =
            await this.timeEntryReminderService.checkAndNotifyMissingEntries(entryType);

          this.logger.log(
            `[${entryType}] Check completed - Checked: ${result.checked}, Missing: ${result.missing}, Notified: ${result.notified}, Dedup: ${result.skippedDedup}, Errors: ${result.errors}`,
          );
        } catch (error) {
          this.logger.error(`[${entryType}] Check failed: ${error.message}`, error.stack);
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(`All entry type checks completed in ${duration}ms`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Manual trigger for testing purposes
   * Can be called via an admin endpoint
   */
  async triggerManualCheck(entryType: TimeEntryType): Promise<{
    checked: number;
    missing: number;
    notified: number;
    skippedDedup: number;
    errors: number;
  }> {
    this.logger.log(`[MANUAL] Triggering manual check for ${entryType}`);
    return await this.timeEntryReminderService.checkAndNotifyMissingEntries(entryType);
  }
}
