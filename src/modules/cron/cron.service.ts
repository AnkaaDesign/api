import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BonusService } from '../human-resources/bonus/bonus.service';
import { BONUS_STATUS } from '../../constants/enums';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  private readonly systemUserId = 'system';

  constructor(private readonly bonusService: BonusService) {}

  /**
   * Calculate and save monthly bonuses
   * Runs at 23:59 on day 26 of each month
   *
   * The cron job:
   * - Calculates bonuses for all eligible users (performanceLevel > 0 and bonifiable position)
   * - Gets tasks finished in the commission period (day 26 previous month to day 25 current month)
   * - Calculates average tasks per employee
   * - For each eligible user, calculates bonus using the calculation service
   * - Saves bonuses to database with status CONFIRMED
   */
  @Cron('59 23 26 * *')
  async calculateAndSaveBonuses() {
    this.logger.log('Starting monthly bonus calculation cron job...');

    try {
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');

      this.logger.log(`Calculating bonuses for period: ${year}/${month}`);

      // Get payroll data to validate calculation and log details
      const payrollData = await this.bonusService.getPayrollData({
        year,
        month: [month],
        includeInactive: false
      }, this.systemUserId);

      this.logger.log(`Found ${payrollData.bonuses.length} eligible users for bonus calculation`);
      this.logger.log(`Average tasks per employee: ${payrollData.averageTasksPerEmployee}`);
      this.logger.log(`Total active users with performanceLevel > 0: ${payrollData.totalActiveUsers}`);

      // Calculate and save bonuses for all eligible users with CONFIRMED status
      const result = await this.bonusService.calculateAndSaveBonuses(year, month, this.systemUserId);

      this.logger.log(`Monthly bonus calculation completed successfully.`);
      this.logger.log(`Results: ${result.totalSuccess} bonuses saved, ${result.totalFailed} failures`);

      // Log details about each bonus calculation
      if (payrollData.bonuses.length > 0) {
        this.logger.log('Bonus calculation details:');
        payrollData.bonuses.forEach((bonus) => {
          this.logger.log(
            `User: ${bonus.userName} (${bonus.positionName}) - Performance Level: ${bonus.performanceLevel} - Bonus: R$ ${bonus.bonusValue.toFixed(2)}`
          );
        });
      }

      // Log warning if there were failures
      if (result.totalFailed > 0) {
        this.logger.error(`Failed to calculate bonuses for ${result.totalFailed} users`);
      }

      // Log success summary
      if (result.totalSuccess > 0) {
        this.logger.log(`Successfully calculated and saved bonuses for ${result.totalSuccess} users`);
      } else {
        this.logger.warn('No bonuses were saved in this period');
      }

    } catch (error) {
      this.logger.error('Failed to run monthly bonus calculation cron job', error);
      // In a production environment, you might want to:
      // - Send alerts to administrators
      // - Create system notifications
      // - Retry the operation
      throw error;
    }
  }

  /**
   * Manual trigger for bonus calculation
   * Can be called programmatically when needed
   */
  async triggerBonusCalculation(year: string, month: string, userId?: string) {
    this.logger.log(`Manually triggering bonus calculation for ${year}/${month}`);

    try {
      // Validate the period
      if (!year || !month) {
        throw new Error('Year and month are required for manual calculation');
      }

      // Log who triggered the manual calculation
      const triggeredBy = userId ? `user: ${userId}` : 'system';
      this.logger.log(`Manual bonus calculation triggered by ${triggeredBy}`);

      const result = await this.bonusService.calculateAndSaveBonuses(year, month, userId || this.systemUserId);

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

  /**
   * Get next scheduled execution time for bonus calculation
   */
  getNextBonusCalculationTime(): Date {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    let nextExecution: Date;

    // If we're before the 26th of this month, next execution is this month's 26th at 23:59
    if (currentDay < 26) {
      nextExecution = new Date(currentYear, currentMonth, 26, 23, 59, 0);
    } else {
      // Otherwise, it's the 26th of next month at 23:59
      nextExecution = new Date(currentYear, currentMonth + 1, 26, 23, 59, 0);
    }

    return nextExecution;
  }

  /**
   * Check if today is bonus calculation day
   */
  isBonusCalculationDay(): boolean {
    const now = new Date();
    return now.getDate() === 26;
  }
}