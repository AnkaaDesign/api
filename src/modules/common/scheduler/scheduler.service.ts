import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ItemService } from '../../inventory/item/item.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly systemUserId = 'system'; // You may want to create a specific system user

  constructor(private readonly itemService: ItemService) {}

  /**
   * Run reorder point updates daily at 2 AM
   * This ensures the calculation runs during low-traffic hours
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async updateReorderPoints() {
    this.logger.log('Starting automatic reorder point update...');

    try {
      const result = await this.itemService.updateReorderPointsBasedOnConsumption(
        this.systemUserId,
        90, // 90 days lookback
      );

      this.logger.log(
        `Reorder point update completed. Analyzed: ${result.data.totalAnalyzed}, Updated: ${result.data.totalUpdated}`,
      );

      // Log details of significant updates
      result.data.updates
        .filter(update => Math.abs(update.percentageChange) > 25)
        .forEach(update => {
          this.logger.log(
            `Significant update for ${update.itemName}: ${update.previousReorderPoint || 0} → ${update.newReorderPoint} (${update.percentageChange.toFixed(1)}% change)`,
          );
        });
    } catch (error) {
      this.logger.error('Failed to update reorder points:', error);
    }
  }

  /**
   * Run a weekly comprehensive analysis on Sundays at 3 AM
   * This provides a more thorough analysis with a longer lookback period
   */
  @Cron('0 3 * * 0') // Every Sunday at 3 AM
  async weeklyReorderPointAnalysis() {
    this.logger.log('Starting weekly comprehensive reorder point analysis...');

    try {
      const result = await this.itemService.updateReorderPointsBasedOnConsumption(
        this.systemUserId,
        180, // 180 days lookback for weekly analysis
      );

      this.logger.log(
        `Weekly analysis completed. Analyzed: ${result.data.totalAnalyzed}, Updated: ${result.data.totalUpdated}`,
      );
    } catch (error) {
      this.logger.error('Failed to run weekly reorder point analysis:', error);
    }
  }

  /**
   * Manual trigger for reorder point updates
   * Can be called programmatically when needed
   */
  async triggerReorderPointUpdate(lookbackDays: number = 90): Promise<void> {
    this.logger.log(
      `Manually triggering reorder point update with ${lookbackDays} days lookback...`,
    );

    try {
      await this.itemService.updateReorderPointsBasedOnConsumption(this.systemUserId, lookbackDays);
    } catch (error) {
      this.logger.error('Failed to manually trigger reorder point update:', error);
      throw error;
    }
  }
}
