import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TimeEntryReminderService, TimeEntryType } from './time-entry-reminder.service';

/**
 * Scheduler for time entry reminder notifications
 *
 * This service runs cron jobs at specific times to check if employees
 * have registered their time entries (pontos) and sends reminder notifications
 * to those who haven't.
 *
 * The check times are configured to run 15 minutes after typical entry times:
 * - ENTRADA1: 07:30 (for 07:15 schedule) and 08:15 (for 08:00 schedule)
 * - SAIDA1: 11:45 (for 11:30 schedule) and 12:15 (for 12:00 schedule)
 * - ENTRADA2: 13:15 (for 13:00 schedule)
 * - SAIDA2: 17:45 (for 17:30 schedule) and 18:15 (for 18:00 schedule)
 */
@Injectable()
export class TimeEntryReminderScheduler {
  private readonly logger = new Logger(TimeEntryReminderScheduler.name);

  // Flags to prevent concurrent execution
  private isProcessingEntrada1 = false;
  private isProcessingSaida1 = false;
  private isProcessingEntrada2 = false;
  private isProcessingSaida2 = false;

  constructor(private readonly timeEntryReminderService: TimeEntryReminderService) {}

  /**
   * Check ENTRADA1 (first entry) - runs at 7:30 AM
   * For employees with 07:15 schedule (PINTURA, etc.)
   */
  @Cron('30 7 * * 1-5', { timeZone: 'America/Sao_Paulo' }) // Monday to Friday at 7:30 AM
  async checkEntrada1Early(): Promise<void> {
    await this.runEntrada1Check('07:30');
  }

  /**
   * Check ENTRADA1 (first entry) - runs at 8:15 AM
   * For employees with 08:00 schedule (ADMINISTRAÇÃO, etc.)
   */
  @Cron('15 8 * * 1-5', { timeZone: 'America/Sao_Paulo' }) // Monday to Friday at 8:15 AM
  async checkEntrada1Late(): Promise<void> {
    await this.runEntrada1Check('08:15');
  }

  /**
   * Common logic for ENTRADA1 check
   */
  private async runEntrada1Check(time: string): Promise<void> {
    if (this.isProcessingEntrada1) {
      this.logger.warn(`ENTRADA1 check already in progress, skipping ${time} run`);
      return;
    }

    this.isProcessingEntrada1 = true;
    const startTime = Date.now();

    try {
      this.logger.log(`[ENTRADA1] Starting time entry check at ${time}`);

      const result = await this.timeEntryReminderService.checkAndNotifyMissingEntries('ENTRADA1');

      const duration = Date.now() - startTime;
      this.logger.log(
        `[ENTRADA1] Check completed in ${duration}ms - Checked: ${result.checked}, Missing: ${result.missing}, Notified: ${result.notified}, Errors: ${result.errors}`,
      );
    } catch (error) {
      this.logger.error(`[ENTRADA1] Check failed: ${error.message}`, error.stack);
    } finally {
      this.isProcessingEntrada1 = false;
    }
  }

  /**
   * Check SAIDA1 (first exit/lunch) - runs at 11:45 AM
   * For employees with 11:30 schedule
   */
  @Cron('45 11 * * 1-5', { timeZone: 'America/Sao_Paulo' }) // Monday to Friday at 11:45 AM
  async checkSaida1Early(): Promise<void> {
    await this.runSaida1Check('11:45');
  }

  /**
   * Check SAIDA1 (first exit/lunch) - runs at 12:15 PM
   * For employees with 12:00 schedule
   */
  @Cron('15 12 * * 1-5', { timeZone: 'America/Sao_Paulo' }) // Monday to Friday at 12:15 PM
  async checkSaida1Late(): Promise<void> {
    await this.runSaida1Check('12:15');
  }

  /**
   * Common logic for SAIDA1 check
   */
  private async runSaida1Check(time: string): Promise<void> {
    if (this.isProcessingSaida1) {
      this.logger.warn(`SAIDA1 check already in progress, skipping ${time} run`);
      return;
    }

    this.isProcessingSaida1 = true;
    const startTime = Date.now();

    try {
      this.logger.log(`[SAIDA1] Starting time entry check at ${time}`);

      const result = await this.timeEntryReminderService.checkAndNotifyMissingEntries('SAIDA1');

      const duration = Date.now() - startTime;
      this.logger.log(
        `[SAIDA1] Check completed in ${duration}ms - Checked: ${result.checked}, Missing: ${result.missing}, Notified: ${result.notified}, Errors: ${result.errors}`,
      );
    } catch (error) {
      this.logger.error(`[SAIDA1] Check failed: ${error.message}`, error.stack);
    } finally {
      this.isProcessingSaida1 = false;
    }
  }

  /**
   * Check ENTRADA2 (return from lunch) - runs at 13:15 PM
   * Most schedules have 13:00 as lunch return
   */
  @Cron('15 13 * * 1-5', { timeZone: 'America/Sao_Paulo' }) // Monday to Friday at 1:15 PM
  async checkEntrada2(): Promise<void> {
    if (this.isProcessingEntrada2) {
      this.logger.warn('ENTRADA2 check already in progress, skipping');
      return;
    }

    this.isProcessingEntrada2 = true;
    const startTime = Date.now();

    try {
      this.logger.log('[ENTRADA2] Starting time entry check at 13:15');

      const result = await this.timeEntryReminderService.checkAndNotifyMissingEntries('ENTRADA2');

      const duration = Date.now() - startTime;
      this.logger.log(
        `[ENTRADA2] Check completed in ${duration}ms - Checked: ${result.checked}, Missing: ${result.missing}, Notified: ${result.notified}, Errors: ${result.errors}`,
      );
    } catch (error) {
      this.logger.error(`[ENTRADA2] Check failed: ${error.message}`, error.stack);
    } finally {
      this.isProcessingEntrada2 = false;
    }
  }

  /**
   * Check SAIDA2 (end of work) - runs at 17:45 PM
   * For employees with 17:30 schedule
   */
  @Cron('45 17 * * 1-5', { timeZone: 'America/Sao_Paulo' }) // Monday to Friday at 5:45 PM
  async checkSaida2Early(): Promise<void> {
    await this.runSaida2Check('17:45');
  }

  /**
   * Check SAIDA2 (end of work) - runs at 18:15 PM
   * For employees with 18:00 schedule
   */
  @Cron('15 18 * * 1-5', { timeZone: 'America/Sao_Paulo' }) // Monday to Friday at 6:15 PM
  async checkSaida2Late(): Promise<void> {
    await this.runSaida2Check('18:15');
  }

  /**
   * Common logic for SAIDA2 check
   */
  private async runSaida2Check(time: string): Promise<void> {
    if (this.isProcessingSaida2) {
      this.logger.warn(`SAIDA2 check already in progress, skipping ${time} run`);
      return;
    }

    this.isProcessingSaida2 = true;
    const startTime = Date.now();

    try {
      this.logger.log(`[SAIDA2] Starting time entry check at ${time}`);

      const result = await this.timeEntryReminderService.checkAndNotifyMissingEntries('SAIDA2');

      const duration = Date.now() - startTime;
      this.logger.log(
        `[SAIDA2] Check completed in ${duration}ms - Checked: ${result.checked}, Missing: ${result.missing}, Notified: ${result.notified}, Errors: ${result.errors}`,
      );
    } catch (error) {
      this.logger.error(`[SAIDA2] Check failed: ${error.message}`, error.stack);
    } finally {
      this.isProcessingSaida2 = false;
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
    errors: number;
  }> {
    this.logger.log(`[MANUAL] Triggering manual check for ${entryType}`);
    return await this.timeEntryReminderService.checkAndNotifyMissingEntries(entryType);
  }
}
