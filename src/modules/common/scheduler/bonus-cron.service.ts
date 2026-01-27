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

  // REMOVED: Daily draft updates - bonuses are now calculated LIVE during current period
  // Only the monthly finalization on the 6th saves data to database

  // Run at midnight (00:00) on the 6th of every month to finalize bonuses and create payrolls
  // This runs AFTER the grace period (26th to 5th) which allows fixing commission status errors
  // Period being saved: 26th of previous month to 25th of current month
  // Example: December 6th saves November period (Oct 26 - Nov 25)
  // The period just closed on the 25th, and now after the 5th grace period we save it
  @Cron('0 0 6 * *')
  async handleMonthlyBonusAndPayrollFinalization() {
    this.logger.log('Starting monthly bonus and payroll finalization...');

    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1; // 1-12
      const currentYear = now.getFullYear();

      // On the 6th, we save the period that just ended on the 25th of PREVIOUS month
      // The 5th day rule means: days 1-5 = previous period, days 6+ = current period
      // So on Dec 6th, current period switches to December
      // But we need to save November's period (Oct 26 - Nov 25) which just closed
      let periodMonth = currentMonth - 1;
      let periodYear = currentYear;

      if (periodMonth === 0) {
        periodMonth = 12;
        periodYear = currentYear - 1;
      }

      const year = periodYear.toString();
      const month = periodMonth.toString().padStart(2, '0');

      this.logger.log(`Finalizing bonuses and payrolls for period: ${year}/${month}`);

      // Step 1: Calculate and save bonuses for all users FIRST
      // This creates bonus records even for non-eligible users (with value 0)
      // By running on the 6th (after the 5th grace period), all commission status
      // corrections made between the 25th-5th are included in the saved calculations
      // IMPORTANT: Bonuses must be saved BEFORE payrolls so payroll can reference netBonus
      this.logger.log('Step 1: Calculating and saving bonuses...');
      const bonusResult = await this.bonusService.calculateAndSaveBonuses(year, month, 'system');
      this.logger.log(
        `Bonus calculation completed. Success: ${bonusResult.totalSuccess}, Failed: ${bonusResult.totalFailed}`,
      );

      // Log warning if there were failures
      if (bonusResult.totalFailed > 0) {
        this.logger.error(`Failed to calculate bonuses for ${bonusResult.totalFailed} users`);
      }

      // Step 2: Generate payrolls for all active users (uses saved netBonus)
      this.logger.log('Step 2: Generating payrolls for all active users...');
      const payrollResult = await this.payrollService.generateForMonth(
        parseInt(year),
        parseInt(month),
        'system',
      );
      this.logger.log(
        `Payroll generation completed. Created: ${payrollResult.created}, Skipped: ${payrollResult.skipped}, Errors: ${payrollResult.errors?.length || 0}`,
      );

      // Log errors if any
      if (payrollResult.errors && payrollResult.errors.length > 0) {
        this.logger.error('Payroll generation errors:', payrollResult.errors);
      }

      // Log success summary
      this.logger.log(`Monthly finalization completed successfully.`);
      this.logger.log(
        `- Payrolls: ${payrollResult.created} created, ${payrollResult.skipped} skipped, ${payrollResult.errors?.length || 0} errors`,
      );
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
      const result = await this.bonusService.calculateAndSaveBonuses(
        year,
        month,
        userId || 'system',
      );

      this.logger.log(
        `Manual bonus calculation completed for ${year}/${month}. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`,
      );

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

    // If we're before the 6th of this month, next execution is this month's 6th at midnight
    if (currentDay < 6) {
      nextExecution = new Date(currentYear, currentMonth, 6, 0, 0, 0);
    } else {
      // Otherwise, it's the 6th of next month
      nextExecution = new Date(currentYear, currentMonth + 1, 6, 0, 0, 0);
    }

    return nextExecution;
  }

  // Optional: Check if today is bonus/payroll calculation day
  isBonusCalculationDay(): boolean {
    const now = new Date();
    return now.getDate() === 6;
  }
}
