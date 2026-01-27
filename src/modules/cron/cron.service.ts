import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserService } from '../people/user/user.service';
import { OrderService } from '../inventory/order/order.service';
import { PpeDeliveryScheduleService } from '../inventory/ppe/ppe-delivery-schedule.service';
import { ORDER_STATUS } from '../../constants/enums';

/**
 * CronService handles general system cron jobs
 *
 * Note: Bonus calculation is handled by BonusCronService (runs on 25th at midnight)
 * This service only handles:
 * - User status transitions (daily at midnight)
 * - Overdue order updates (daily at midnight)
 */
@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  private readonly systemUserId = 'system';

  constructor(
    private readonly userService: UserService,
    private readonly orderService: OrderService,
    private readonly ppeDeliveryScheduleService: PpeDeliveryScheduleService,
  ) {}

  /**
   * Process automatic user status transitions when experience periods end
   * Runs daily at 1 AM (01:00)
   *
   * This cron job:
   * - Finds users where exp1EndAt has passed and transitions them from EXPERIENCE_PERIOD_1 to EXPERIENCE_PERIOD_2
   * - Finds users where exp2EndAt has passed and transitions them from EXPERIENCE_PERIOD_2 to EFFECTED
   * - Logs all changes to the changelog system
   * - Catches users even if they were missed on previous days (e.g., server downtime, user created after cron ran)
   */
  @Cron('0 1 * * *')
  async processUserStatusTransitions() {
    this.logger.log('Starting automatic user status transitions cron job...');

    try {
      const result = await this.userService.processExperiencePeriodTransitions(this.systemUserId);

      this.logger.log('User status transitions completed successfully.');
      this.logger.log(
        `Results: ${result.totalProcessed} users processed, ` +
          `${result.exp1ToExp2} transitioned from EXP1 to EXP2, ` +
          `${result.exp2ToEffected} transitioned from EXP2 to EFFECTED, ` +
          `${result.errors.length} errors`,
      );

      // Log details about transitions
      if (result.exp1ToExp2 > 0) {
        this.logger.log(
          `${result.exp1ToExp2} users completed Experience Period 1 and moved to Experience Period 2`,
        );
      }

      if (result.exp2ToEffected > 0) {
        this.logger.log(
          `${result.exp2ToEffected} users completed Experience Period 2 and became EFFECTED`,
        );
      }

      // Log warning if there were errors
      if (result.errors.length > 0) {
        this.logger.error(`Failed to transition ${result.errors.length} users`);
        result.errors.forEach(error => {
          this.logger.error(`User ${error.userId}: ${error.error}`);
        });
      }

      // Log if no transitions occurred
      if (result.totalProcessed === 0) {
        this.logger.log('No users required status transitions');
      }
    } catch (error) {
      this.logger.error('Failed to run user status transitions cron job', error);
      // In a production environment, you might want to:
      // - Send alerts to administrators
      // - Create system notifications
      // - Retry the operation
      throw error;
    }
  }

  /**
   * Update orders with overdue forecasts
   * Runs daily at midnight (00:00)
   *
   * This cron job:
   * - Finds all active orders (not RECEIVED or CANCELLED) where forecast date has passed
   * - Updates their status to OVERDUE
   * - Logs all changes to the changelog system
   */
  @Cron('0 0 * * *')
  async updateOverdueOrders() {
    this.logger.log('Starting overdue orders update cron job...');

    try {
      const now = new Date();

      // Get all active orders with overdue forecasts
      const overdueOrders = await this.orderService.findMany({
        where: {
          forecast: {
            lte: now,
          },
          status: {
            notIn: [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED, ORDER_STATUS.OVERDUE],
          },
        },
      });

      this.logger.log(`Found ${overdueOrders.data.length} orders with overdue forecasts`);

      if (overdueOrders.data.length === 0) {
        this.logger.log('No orders require OVERDUE status update today');
        return {
          totalProcessed: 0,
          totalSuccess: 0,
          totalFailed: 0,
          errors: [],
        };
      }

      let totalSuccess = 0;
      let totalFailed = 0;
      const errors: Array<{ orderId: string; error: string }> = [];

      // Update each order to OVERDUE status
      for (const order of overdueOrders.data) {
        try {
          await this.orderService.update(
            order.id,
            { status: ORDER_STATUS.OVERDUE },
            undefined,
            this.systemUserId,
          );

          this.logger.log(
            `Order ${order.id} (${order.description}) updated to OVERDUE status. ` +
              `Forecast was: ${order.forecast ? new Date(order.forecast).toISOString().split('T')[0] : 'N/A'}`,
          );

          totalSuccess++;
        } catch (error) {
          totalFailed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push({ orderId: order.id, error: errorMessage });
          this.logger.error(`Failed to update order ${order.id} to OVERDUE: ${errorMessage}`);
        }
      }

      this.logger.log('Overdue orders update completed successfully.');
      this.logger.log(
        `Results: ${overdueOrders.data.length} orders processed, ` +
          `${totalSuccess} updated to OVERDUE, ` +
          `${totalFailed} errors`,
      );

      // Log warning if there were errors
      if (errors.length > 0) {
        this.logger.error(`Failed to update ${errors.length} orders to OVERDUE status`);
        errors.forEach(error => {
          this.logger.error(`Order ${error.orderId}: ${error.error}`);
        });
      }

      return {
        totalProcessed: overdueOrders.data.length,
        totalSuccess,
        totalFailed,
        errors,
      };
    } catch (error) {
      this.logger.error('Failed to run overdue orders update cron job', error);
      // In a production environment, you might want to:
      // - Send alerts to administrators
      // - Create system notifications
      // - Retry the operation
      throw error;
    }
  }

  /**
   * Process due PPE delivery schedules
   * Runs daily at 7 AM (07:00)
   *
   * This cron job:
   * - Finds all active PPE delivery schedules where nextRun <= now
   * - Creates delivery batches for all assigned users
   * - Recalculates nextRun for recurring schedules
   * - Deactivates ONCE schedules after execution
   */
  @Cron('0 7 * * *')
  async processDuePpeDeliverySchedules() {
    this.logger.log('Starting PPE delivery schedule processing cron job...');

    try {
      const result = await this.ppeDeliveryScheduleService.processDueSchedules();

      this.logger.log('PPE delivery schedule processing completed successfully.');
      this.logger.log(
        `Results: ${result.totalProcessed} schedules processed, ` +
          `${result.totalDeliveriesCreated} deliveries created, ` +
          `${result.errors.length} errors`,
      );

      if (result.errors.length > 0) {
        this.logger.error(`Failed to process ${result.errors.length} PPE schedules`);
        result.errors.forEach(error => {
          this.logger.error(`Schedule ${error.scheduleId}: ${error.error}`);
        });
      }

      if (result.totalProcessed === 0) {
        this.logger.log('No PPE delivery schedules required processing');
      }
    } catch (error) {
      this.logger.error('Failed to run PPE delivery schedule processing cron job', error);
      throw error;
    }
  }
}
