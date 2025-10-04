import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BonusService } from '../../human-resources/bonus/bonus.service';

@Injectable()
export class BonusCronService {
  private readonly logger = new Logger(BonusCronService.name);

  constructor(private readonly bonusService: BonusService) {}

  // Run daily at 02:00 AM to update DRAFT bonuses
  @Cron('0 2 * * *')
  async handleDailyBonusUpdate() {
    const now = new Date();
    const currentDay = now.getDate();

    // Only update drafts before day 26
    if (currentDay >= 26) {
      this.logger.debug('Skipping daily bonus update - past day 26');
      return;
    }

    this.logger.log('Starting daily DRAFT bonus update...');

    try {
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');

      this.logger.log(`Updating DRAFT bonuses for period: ${year}/${month}`);

      // Calculate and update bonuses (will be DRAFT status before day 26)
      const result = await this.bonusService.calculateAndSaveBonuses(year, month, 'system');

      this.logger.log(`Daily bonus update completed. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`);
    } catch (error) {
      this.logger.error('Failed to run daily bonus update', error);
    }
  }

  // Run at 23:59 on the 26th of every month to finalize bonuses
  @Cron('59 23 26 * *')
  async handleMonthlyBonusFinalization() {
    this.logger.log('Starting monthly bonus finalization (CONFIRMED status)...');

    try {
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');

      this.logger.log(`Finalizing bonuses for period: ${year}/${month}`);

      // Get payroll data for the current period to validate calculation
      const payrollData = await this.bonusService.getPayrollData({
        year,
        month: [month],
        includeInactive: false
      }, 'system');

      this.logger.log(`Found ${payrollData.bonuses.length} eligible users for bonus calculation`);

      // Calculate and save bonuses for all eligible users
      // This will automatically set CONFIRMED status since we're running on day 26
      const result = await this.bonusService.calculateAndSaveBonuses(year, month, 'system');

      this.logger.log(`Monthly bonus finalization completed. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`);

      // Log warning if there were failures
      if (result.totalFailed > 0) {
        this.logger.error(`Failed to calculate bonuses for ${result.totalFailed} users`);
        // You could add notification logic here to alert HR team
      }

      // Log success summary
      if (result.totalSuccess > 0) {
        this.logger.log(`Successfully finalized bonuses for ${result.totalSuccess} users with CONFIRMED status`);
      }

    } catch (error) {
      this.logger.error('Failed to run monthly bonus calculation', error);
      // You could add alerting logic here to notify administrators
      // For example: await this.notificationService.alertAdmins('Cron job failed', error);
    }
  }

  // Optional: Run a test calculation on demand (can be triggered manually)
  async runManualBonusCalculation(year: string, month: string, userId?: string) {
    this.logger.log(`Running manual bonus calculation for ${year}/${month}`);

    try {
      // Validate the period
      if (!year || !month) {
        throw new Error('Year and month are required for manual calculation');
      }

      // Log who triggered the manual calculation
      const triggeredBy = userId ? `user: ${userId}` : 'system';
      this.logger.log(`Manual bonus calculation triggered by ${triggeredBy}`);

      // Use calculateAndSaveBonuses which properly determines bonus status
      const result = await this.bonusService.calculateAndSaveBonuses(year, month, userId || 'system');

      this.logger.log(`Manual bonus calculation completed for ${year}/${month}. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`);

      return {
        success: true,
        data: result,
        message: `Cálculo manual de bônus concluído: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas`,
      };
    } catch (error) {
      this.logger.error('Failed to run manual bonus calculation', error);
      throw error;
    }
  }

  // Optional: Get next scheduled execution time
  getNextExecutionTime(): Date {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    let nextExecution: Date;

    // If we're before the 26th of this month, next execution is this month's 26th
    if (currentDay < 26) {
      nextExecution = new Date(currentYear, currentMonth, 26, 0, 0, 0);
    } else {
      // Otherwise, it's the 26th of next month
      nextExecution = new Date(currentYear, currentMonth + 1, 26, 0, 0, 0);
    }

    return nextExecution;
  }

  // Optional: Check if today is bonus calculation day
  isBonusCalculationDay(): boolean {
    const now = new Date();
    return now.getDate() === 26;
  }
}