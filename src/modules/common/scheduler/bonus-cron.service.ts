import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BonusService } from '../../human-resources/bonus/bonus.service';
import { PayrollService } from '../../human-resources/payroll/payroll.service';

@Injectable()
export class BonusCronService {
  private readonly logger = new Logger(BonusCronService.name);

  constructor(
    private readonly bonusService: BonusService,
    private readonly payrollService: PayrollService,
  ) {}

  // Run daily at 02:00 AM to update DRAFT bonuses
  @Cron('0 2 * * *')
  async handleDailyBonusUpdate() {
    const now = new Date();
    const currentDay = now.getDate();

    // Only update drafts before day 25 (period ends on 25th)
    if (currentDay >= 25) {
      this.logger.debug('Skipping daily bonus update - past day 25');
      return;
    }

    this.logger.log('Starting daily DRAFT bonus update...');

    try {
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');

      this.logger.log(`Updating DRAFT bonuses for period: ${year}/${month}`);

      // Calculate and update bonuses (will be DRAFT status before day 25)
      const result = await this.bonusService.calculateAndSaveBonuses(year, month, 'system');

      this.logger.log(`Daily bonus update completed. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`);
    } catch (error) {
      this.logger.error('Failed to run daily bonus update', error);
    }
  }

  // Run at midnight (00:00) on the 25th of every month to finalize bonuses and create payrolls
  // Period: 26th of previous month to 25th of current month
  @Cron('0 0 25 * *')
  async handleMonthlyBonusAndPayrollFinalization() {
    this.logger.log('Starting monthly bonus and payroll finalization...');

    try {
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');

      this.logger.log(`Finalizing bonuses and payrolls for period: ${year}/${month}`);

      // Step 1: Generate payrolls for all active users
      this.logger.log('Step 1: Generating payrolls for all active users...');
      const payrollResult = await this.payrollService.generateForMonth(
        parseInt(year),
        parseInt(month),
        'system'
      );
      this.logger.log(`Payroll generation completed. Created: ${payrollResult.created}, Skipped: ${payrollResult.skipped}`);

      // Step 2: Calculate and save bonuses for all users with payroll
      // This creates bonus records even for non-eligible users (with value 0)
      this.logger.log('Step 2: Calculating and saving bonuses...');
      const bonusResult = await this.bonusService.calculateAndSaveBonuses(year, month, 'system');
      this.logger.log(`Bonus calculation completed. Success: ${bonusResult.totalSuccess}, Failed: ${bonusResult.totalFailed}`);

      // Log warning if there were failures
      if (bonusResult.totalFailed > 0) {
        this.logger.error(`Failed to calculate bonuses for ${bonusResult.totalFailed} users`);
      }

      // Log success summary
      this.logger.log(`Monthly finalization completed successfully.`);
      this.logger.log(`- Payrolls: ${payrollResult.created} created, ${payrollResult.skipped} skipped`);
      this.logger.log(`- Bonuses: ${bonusResult.totalSuccess} calculated`);

    } catch (error) {
      this.logger.error('Failed to run monthly bonus and payroll finalization', error);
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

    // If we're before the 25th of this month, next execution is this month's 25th at midnight
    if (currentDay < 25) {
      nextExecution = new Date(currentYear, currentMonth, 25, 0, 0, 0);
    } else {
      // Otherwise, it's the 25th of next month
      nextExecution = new Date(currentYear, currentMonth + 1, 25, 0, 0, 0);
    }

    return nextExecution;
  }

  // Optional: Check if today is bonus/payroll calculation day
  isBonusCalculationDay(): boolean {
    const now = new Date();
    return now.getDate() === 25;
  }
}