import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskDeadlineApproachingEvent, TaskOverdueEvent } from './task.events';
import { ArtworkPendingApprovalReminderEvent } from './artwork.events';
import { TASK_STATUS, SERVICE_ORDER_STATUS, SERVICE_ORDER_TYPE } from '../../../constants/enums';

/**
 * Forecast deadline event - for tasks in preparation
 */
export class TaskForecastApproachingEvent {
  constructor(
    public readonly task: any,
    public readonly daysRemaining: number,
    public readonly hasIncompleteOrders: boolean,
    public readonly incompleteOrderTypes: string[],
  ) {}
}

/**
 * Forecast overdue event
 */
export class TaskForecastOverdueEvent {
  constructor(
    public readonly task: any,
    public readonly daysOverdue: number,
    public readonly hasIncompleteOrders: boolean,
    public readonly incompleteOrderTypes: string[],
  ) {}
}

/**
 * Task Notification Scheduler
 * Handles all deadline-related notifications for tasks
 *
 * Production Tasks (IN_PRODUCTION) - uses term field:
 * - 1 hour before term
 * - 4 hours before term
 *
 * Preparation Tasks (PREPARATION/WAITING_PRODUCTION) - uses forecastDate field:
 * - 10 days before forecast
 * - 7 days before forecast
 * - 3 days before forecast
 * - 1 day before forecast (with pending orders warning)
 * - Today is forecast date
 * - Overdue forecast date
 */
@Injectable()
export class TaskNotificationScheduler {
  private readonly logger = new Logger(TaskNotificationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  // =====================
  // PRODUCTION TASK DEADLINES (term field)
  // =====================

  /**
   * Run hourly to check for production tasks with deadlines within 1 hour
   */
  @Cron('0 * * * *', { timeZone: 'America/Sao_Paulo' }) // Every hour at minute 0
  async checkUrgentDeadlines1Hour() {
    this.logger.log('Running hourly urgent deadline check (1 hour)...');

    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 1 * 60 * 60 * 1000);
      const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);

      // Find tasks with deadline between 30 minutes and 1 hour from now
      const tasks = await this.prisma.task.findMany({
        where: {
          term: {
            gt: thirtyMinutesFromNow,
            lte: oneHourFromNow,
          },
          status: TASK_STATUS.IN_PRODUCTION,
        },
        include: {
          sector: {
            select: { id: true, name: true, managerId: true },
          },
          customer: {
            select: { id: true, fantasyName: true },
          },
        },
      });

      this.logger.log(`Found ${tasks.length} production tasks with deadline in ~1 hour`);

      for (const task of tasks) {
        try {
          const hoursRemaining = 1;
          this.eventEmitter.emit(
            'task.deadline.approaching',
            new TaskDeadlineApproachingEvent(task as any, 0, hoursRemaining),
          );
        } catch (error) {
          this.logger.error(`Error emitting 1-hour deadline event for task ${task.id}:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Error during 1-hour deadline check:', error);
    }
  }

  /**
   * Run hourly to check for production tasks with deadlines within 4 hours
   */
  @Cron('0 * * * *', { timeZone: 'America/Sao_Paulo' }) // Every hour at minute 0
  async checkUrgentDeadlines4Hours() {
    this.logger.log('Running hourly urgent deadline check (4 hours)...');

    try {
      const now = new Date();
      const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

      // Find tasks with deadline between 3 and 4 hours from now
      const tasks = await this.prisma.task.findMany({
        where: {
          term: {
            gt: threeHoursFromNow,
            lte: fourHoursFromNow,
          },
          status: TASK_STATUS.IN_PRODUCTION,
        },
        include: {
          sector: {
            select: { id: true, name: true, managerId: true },
          },
          customer: {
            select: { id: true, fantasyName: true },
          },
        },
      });

      this.logger.log(`Found ${tasks.length} production tasks with deadline in ~4 hours`);

      for (const task of tasks) {
        try {
          const hoursRemaining = Math.ceil(
            (new Date(task.term!).getTime() - now.getTime()) / (1000 * 60 * 60),
          );
          this.eventEmitter.emit(
            'task.deadline.approaching',
            new TaskDeadlineApproachingEvent(task as any, 0, hoursRemaining),
          );
        } catch (error) {
          this.logger.error(`Error emitting 4-hour deadline event for task ${task.id}:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Error during 4-hour deadline check:', error);
    }
  }

  /**
   * Run daily at 9:00 AM to check for production tasks with upcoming term deadlines
   * Checks for tasks with term in 1, 3, and 7 days
   */
  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkUpcomingTermDeadlines() {
    this.logger.log('Running daily term deadline check...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const deadlineThresholds = [1, 3, 7];

      for (const daysRemaining of deadlineThresholds) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysRemaining);
        targetDate.setHours(23, 59, 59, 999);

        const startOfTargetDay = new Date(targetDate);
        startOfTargetDay.setHours(0, 0, 0, 0);

        const tasks = await this.prisma.task.findMany({
          where: {
            term: {
              gte: startOfTargetDay,
              lte: targetDate,
            },
            status: {
              in: [TASK_STATUS.IN_PRODUCTION, TASK_STATUS.WAITING_PRODUCTION],
            },
          },
          include: {
            sector: {
              select: { id: true, name: true, managerId: true },
            },
            customer: {
              select: { id: true, fantasyName: true },
            },
          },
        });

        this.logger.log(`Found ${tasks.length} tasks with term deadline in ${daysRemaining} day(s)`);

        for (const task of tasks) {
          try {
            this.eventEmitter.emit(
              'task.deadline.approaching',
              new TaskDeadlineApproachingEvent(task as any, daysRemaining),
            );
          } catch (error) {
            this.logger.error(
              `Error emitting term deadline event for task ${task.id}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error('Error during term deadline check:', error);
    }
  }

  /**
   * Run daily at 9:00 AM to check for overdue production tasks (term)
   */
  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkOverdueTermTasks() {
    this.logger.log('Running daily overdue term task check...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const overdueTasks = await this.prisma.task.findMany({
        where: {
          term: { lt: now },
          status: {
            in: [TASK_STATUS.IN_PRODUCTION, TASK_STATUS.WAITING_PRODUCTION],
          },
        },
        include: {
          sector: {
            select: { id: true, name: true, managerId: true },
          },
          customer: {
            select: { id: true, fantasyName: true },
          },
        },
      });

      this.logger.log(`Found ${overdueTasks.length} overdue tasks (term)`);

      for (const task of overdueTasks) {
        try {
          const termDate = new Date(task.term!);
          termDate.setHours(0, 0, 0, 0);
          const daysOverdue = Math.floor(
            (now.getTime() - termDate.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Only notify for specific intervals to avoid spam
          const shouldNotify =
            daysOverdue === 1 ||
            daysOverdue === 3 ||
            daysOverdue === 7 ||
            daysOverdue === 14 ||
            daysOverdue === 30 ||
            (daysOverdue > 30 && daysOverdue % 30 === 0);

          if (shouldNotify) {
            this.eventEmitter.emit('task.overdue', new TaskOverdueEvent(task as any, daysOverdue));
          }
        } catch (error) {
          this.logger.error(`Error emitting overdue event for task ${task.id}:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Error during overdue term task check:', error);
    }
  }

  // =====================
  // PREPARATION TASK DEADLINES (forecastDate field)
  // =====================

  /**
   * Run daily at 9:00 AM to check for preparation tasks with forecast approaching
   * Checks for: 10 days, 7 days, 3 days, 1 day, today, and overdue
   */
  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkForecastDeadlines() {
    this.logger.log('Running daily forecast deadline check...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      // Define forecast thresholds (days before forecast date)
      const forecastThresholds = [10, 7, 3, 1, 0]; // 0 = today

      for (const daysRemaining of forecastThresholds) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysRemaining);
        targetDate.setHours(23, 59, 59, 999);

        const startOfTargetDay = new Date(targetDate);
        startOfTargetDay.setHours(0, 0, 0, 0);

        const tasks = await this.prisma.task.findMany({
          where: {
            forecastDate: {
              gte: startOfTargetDay,
              lte: targetDate,
            },
            status: {
              in: [TASK_STATUS.PREPARATION, TASK_STATUS.WAITING_PRODUCTION],
            },
          },
          include: {
            sector: {
              select: { id: true, name: true, managerId: true },
            },
            customer: {
              select: { id: true, fantasyName: true },
            },
            serviceOrders: {
              select: {
                id: true,
                type: true,
                status: true,
              },
            },
          },
        });

        this.logger.log(
          `Found ${tasks.length} preparation tasks with forecast in ${daysRemaining} day(s)`,
        );

        for (const task of tasks) {
          try {
            // Check for incomplete service orders
            const { hasIncompleteOrders, incompleteTypes } = this.checkServiceOrders(
              task.serviceOrders,
            );

            // For 1 day or less, only notify if there are incomplete orders
            // For today (0 days), always notify
            if (daysRemaining === 1 && !hasIncompleteOrders) {
              continue; // Skip if 1 day remaining but all orders are complete
            }

            this.eventEmitter.emit(
              'task.forecast.approaching',
              new TaskForecastApproachingEvent(
                task as any,
                daysRemaining,
                hasIncompleteOrders,
                incompleteTypes,
              ),
            );
          } catch (error) {
            this.logger.error(
              `Error emitting forecast deadline event for task ${task.id}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error('Error during forecast deadline check:', error);
    }
  }

  /**
   * Run daily at 9:00 AM to check for overdue forecast tasks
   */
  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkOverdueForecastTasks() {
    this.logger.log('Running daily overdue forecast task check...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const overdueTasks = await this.prisma.task.findMany({
        where: {
          forecastDate: { lt: now },
          status: {
            in: [TASK_STATUS.PREPARATION, TASK_STATUS.WAITING_PRODUCTION],
          },
        },
        include: {
          sector: {
            select: { id: true, name: true, managerId: true },
          },
          customer: {
            select: { id: true, fantasyName: true },
          },
          serviceOrders: {
            select: {
              id: true,
              type: true,
              status: true,
            },
          },
        },
      });

      this.logger.log(`Found ${overdueTasks.length} overdue forecast tasks`);

      for (const task of overdueTasks) {
        try {
          const forecastDate = new Date(task.forecastDate!);
          forecastDate.setHours(0, 0, 0, 0);
          const daysOverdue = Math.floor(
            (now.getTime() - forecastDate.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Only notify for specific intervals
          const shouldNotify =
            daysOverdue === 1 ||
            daysOverdue === 3 ||
            daysOverdue === 7 ||
            daysOverdue === 14 ||
            (daysOverdue > 14 && daysOverdue % 7 === 0);

          if (shouldNotify) {
            const { hasIncompleteOrders, incompleteTypes } = this.checkServiceOrders(
              task.serviceOrders,
            );

            this.eventEmitter.emit(
              'task.forecast.overdue',
              new TaskForecastOverdueEvent(
                task as any,
                daysOverdue,
                hasIncompleteOrders,
                incompleteTypes,
              ),
            );
          }
        } catch (error) {
          this.logger.error(`Error emitting forecast overdue event for task ${task.id}:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Error during overdue forecast task check:', error);
    }
  }

  /**
   * Check service orders for incomplete commercial or artwork orders
   */
  private checkServiceOrders(
    serviceOrders: Array<{ id: string; type: string; status: string }>,
  ): { hasIncompleteOrders: boolean; incompleteTypes: string[] } {
    const incompleteStatuses = [
      SERVICE_ORDER_STATUS.PENDING,
      SERVICE_ORDER_STATUS.IN_PROGRESS,
      SERVICE_ORDER_STATUS.WAITING_APPROVE,
    ];

    const incompleteTypes: string[] = [];

    // Check commercial orders
    const commercialOrders = serviceOrders.filter(
      (so) => so.type === SERVICE_ORDER_TYPE.COMMERCIAL,
    );
    const hasIncompleteCommercial = commercialOrders.some((so) =>
      incompleteStatuses.includes(so.status as SERVICE_ORDER_STATUS),
    );
    const hasMissingCommercial = commercialOrders.length === 0;

    if (hasIncompleteCommercial || hasMissingCommercial) {
      incompleteTypes.push('COMMERCIAL');
    }

    // Check artwork orders
    const artworkOrders = serviceOrders.filter(
      (so) => so.type === SERVICE_ORDER_TYPE.ARTWORK,
    );
    const hasIncompleteArtwork = artworkOrders.some((so) =>
      incompleteStatuses.includes(so.status as SERVICE_ORDER_STATUS),
    );
    const hasMissingArtwork = artworkOrders.length === 0;

    if (hasIncompleteArtwork || hasMissingArtwork) {
      incompleteTypes.push('ARTWORK');
    }

    return {
      hasIncompleteOrders: incompleteTypes.length > 0,
      incompleteTypes,
    };
  }

  // =====================
  // PENDING ARTWORK APPROVAL REMINDERS
  // =====================

  /**
   * Run daily at 9:00 AM to check for artworks pending approval > 24 hours
   * Sends reminders to COMMERCIAL and ADMIN users to approve/reject pending artworks
   */
  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkPendingArtworks() {
    this.logger.log('Running daily pending artwork approval check...');

    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Find artworks in DRAFT status created more than 24 hours ago
      const pendingArtworks = await this.prisma.artwork.findMany({
        where: {
          status: 'DRAFT',
          createdAt: { lt: twentyFourHoursAgo },
        },
        include: {
          tasks: {
            select: {
              id: true,
              name: true,
              serialNumber: true,
              sectorId: true,
              customerId: true,
            },
            take: 1, // Get the first associated task
          },
          file: {
            select: {
              id: true,
              filename: true,
            },
          },
        },
      });

      this.logger.log(`Found ${pendingArtworks.length} artworks pending approval for > 24 hours`);

      for (const artwork of pendingArtworks) {
        try {
          // Calculate days pending
          const createdAt = new Date(artwork.createdAt);
          const daysPending = Math.floor(
            (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Only send reminders at specific intervals to avoid spam:
          // 1 day, 2 days, 3 days, 5 days, 7 days, then every 7 days
          const shouldNotify =
            daysPending === 1 ||
            daysPending === 2 ||
            daysPending === 3 ||
            daysPending === 5 ||
            daysPending === 7 ||
            (daysPending > 7 && daysPending % 7 === 0);

          if (shouldNotify) {
            // Get the first associated task (if any)
            const task = artwork.tasks && artwork.tasks.length > 0 ? artwork.tasks[0] : null;

            this.logger.log(
              `Emitting pending_approval_reminder for artwork ${artwork.id} (${daysPending} days pending)`,
            );
            this.eventEmitter.emit(
              'artwork.pending_approval_reminder',
              new ArtworkPendingApprovalReminderEvent(
                artwork as any,
                task as any,
                daysPending,
              ),
            );
          }
        } catch (error) {
          this.logger.error(
            `Error emitting pending approval reminder for artwork ${artwork.id}:`,
            error,
          );
        }
      }

      this.logger.log('Completed pending artwork approval check');
    } catch (error) {
      this.logger.error('Error during pending artwork approval check:', error);
    }
  }

  // =====================
  // WEEKLY SUMMARY
  // =====================

  /**
   * Run weekly on Monday at 8:00 AM to provide weekly summary
   */
  @Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo' })
  async sendWeeklySummary() {
    this.logger.log('Running weekly task summary...');

    try {
      const now = new Date();
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const upcomingTasks = await this.prisma.task.findMany({
        where: {
          OR: [
            { term: { gte: now, lte: nextWeek } },
            { forecastDate: { gte: now, lte: nextWeek } },
          ],
          status: {
            notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED],
          },
        },
        include: {
          sector: {
            select: { id: true, name: true, managerId: true },
          },
        },
        orderBy: [{ term: 'asc' }, { forecastDate: 'asc' }],
      });

      const tasksBySector = upcomingTasks.reduce(
        (acc, task) => {
          const sectorId = task.sectorId || 'no-sector';
          if (!acc[sectorId]) {
            acc[sectorId] = [];
          }
          acc[sectorId].push(task);
          return acc;
        },
        {} as Record<string, any[]>,
      );

      this.logger.log(
        `Weekly summary: ${upcomingTasks.length} tasks due in the next 7 days across ${Object.keys(tasksBySector).length} sectors`,
      );
    } catch (error) {
      this.logger.error('Error during weekly summary:', error);
    }
  }
}
