import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ORDER_STATUS } from '../../../constants/enums';
import { OrderOverdueEvent } from './order.events';
import { Order } from '../../../types';

/**
 * OrderNotificationScheduler handles scheduled tasks for order notifications
 */
@Injectable()
export class OrderNotificationScheduler {
  private readonly logger = new Logger(OrderNotificationScheduler.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Check for overdue orders daily at 8 AM
   * Emits OrderOverdueEvent for each overdue order
   */
  @Cron('0 8 * * *')
  async checkOverdueOrders(): Promise<void> {
    this.logger.log('Starting daily overdue orders check...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0); // Start of today

      // Find all orders that are overdue
      // An order is overdue if:
      // 1. It has a forecast date
      // 2. The forecast date is in the past
      // 3. The order is not yet received or cancelled
      const overdueOrders = await this.prisma.order.findMany({
        where: {
          forecast: {
            lt: now,
          },
          status: {
            notIn: [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED],
          },
        },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      this.logger.log(`Found ${overdueOrders.length} overdue orders`);

      // Emit event for each overdue order
      for (const order of overdueOrders) {
        if (order.forecast) {
          const forecastDate = new Date(order.forecast);
          forecastDate.setHours(0, 0, 0, 0);

          // Calculate days overdue
          const diffTime = now.getTime() - forecastDate.getTime();
          const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (daysOverdue > 0) {
            this.logger.log(
              `Order ${order.id} is ${daysOverdue} days overdue (forecast: ${order.forecast.toISOString()})`,
            );

            try {
              this.eventEmitter.emit(
                'order.overdue',
                new OrderOverdueEvent(order as unknown as Order, daysOverdue),
              );
            } catch (error) {
              this.logger.error(`Error emitting overdue event for order ${order.id}:`, error);
            }
          }
        }
      }

      this.logger.log('Overdue orders check completed');
    } catch (error) {
      this.logger.error('Error checking overdue orders:', error);
      // Don't throw - we don't want to break the scheduler
    }
  }

  /**
   * Check for orders approaching their forecast date (1 day before)
   * This runs daily at 9 AM
   */
  @Cron('0 9 * * *')
  async checkUpcomingOrders(): Promise<void> {
    this.logger.log('Starting upcoming orders check...');

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const dayAfterTomorrow = new Date(tomorrow);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

      // Find orders with forecast date tomorrow
      const upcomingOrders = await this.prisma.order.findMany({
        where: {
          forecast: {
            gte: tomorrow,
            lt: dayAfterTomorrow,
          },
          status: {
            notIn: [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED],
          },
        },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      this.logger.log(`Found ${upcomingOrders.length} orders due tomorrow`);

      // For upcoming orders, we emit them as "1 day until due" using negative days overdue
      for (const order of upcomingOrders) {
        try {
          // Emit with -1 days to indicate it's due tomorrow
          this.eventEmitter.emit(
            'order.overdue',
            new OrderOverdueEvent(order as unknown as Order, -1),
          );
        } catch (error) {
          this.logger.error(`Error emitting upcoming event for order ${order.id}:`, error);
        }
      }

      this.logger.log('Upcoming orders check completed');
    } catch (error) {
      this.logger.error('Error checking upcoming orders:', error);
      // Don't throw - we don't want to break the scheduler
    }
  }
}
