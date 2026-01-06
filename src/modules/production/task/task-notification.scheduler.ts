import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskDeadlineApproachingEvent, TaskOverdueEvent } from './task.events';
import { TASK_STATUS } from '../../../constants/enums';

/**
 * Task Notification Scheduler
 * Runs daily to check for upcoming deadlines and overdue tasks
 */
@Injectable()
export class TaskNotificationScheduler {
  private readonly logger = new Logger(TaskNotificationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Run daily at 9:00 AM to check for upcoming deadlines
   * Checks for tasks with deadlines in 1, 3, and 7 days
   */
  @Cron('0 9 * * *')
  async checkUpcomingDeadlines() {
    this.logger.log('Running daily deadline check...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0); // Start of today

      // Define deadline thresholds (1 day, 3 days, 7 days)
      const deadlineThresholds = [1, 3, 7];

      for (const daysRemaining of deadlineThresholds) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysRemaining);
        targetDate.setHours(23, 59, 59, 999); // End of target day

        const startOfTargetDay = new Date(targetDate);
        startOfTargetDay.setHours(0, 0, 0, 0);

        // Find tasks with deadline on this specific day
        // Exclude completed and cancelled tasks
        const tasks = await this.prisma.task.findMany({
          where: {
            term: {
              gte: startOfTargetDay,
              lte: targetDate,
            },
            status: {
              notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED],
            },
          },
          include: {
            sector: {
              select: {
                id: true,
                name: true,
                managerId: true,
              },
            },
            customer: {
              select: {
                id: true,
                fantasyName: true,
              },
            },
          },
        });

        this.logger.log(`Found ${tasks.length} tasks with deadline in ${daysRemaining} day(s)`);

        // Emit event for each task
        for (const task of tasks) {
          try {
            this.eventEmitter.emit(
              'task.deadline.approaching',
              new TaskDeadlineApproachingEvent(task as any, daysRemaining),
            );
          } catch (error) {
            this.logger.error(
              `Error emitting deadline approaching event for task ${task.id}:`,
              error,
            );
          }
        }
      }

      this.logger.log('Daily deadline check completed successfully');
    } catch (error) {
      this.logger.error('Error during deadline check:', error);
    }
  }

  /**
   * Run daily at 9:00 AM to check for overdue tasks
   * Sends notifications for tasks that have passed their deadline
   */
  @Cron('0 9 * * *')
  async checkOverdueTasks() {
    this.logger.log('Running daily overdue task check...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0); // Start of today

      // Find tasks that are overdue
      // Exclude completed and cancelled tasks
      const overdueTasks = await this.prisma.task.findMany({
        where: {
          term: {
            lt: now,
          },
          status: {
            notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED],
          },
        },
        include: {
          sector: {
            select: {
              id: true,
              name: true,
              managerId: true,
            },
          },
          customer: {
            select: {
              id: true,
              fantasyName: true,
            },
          },
        },
      });

      this.logger.log(`Found ${overdueTasks.length} overdue tasks`);

      // Emit event for each overdue task
      for (const task of overdueTasks) {
        try {
          // Calculate days overdue
          const termDate = new Date(task.term!);
          termDate.setHours(0, 0, 0, 0);
          const daysOverdue = Math.floor(
            (now.getTime() - termDate.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Only notify for specific intervals to avoid spam
          // Day 1, 3, 7, 14, 30, and then every 30 days
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

      this.logger.log('Daily overdue task check completed successfully');
    } catch (error) {
      this.logger.error('Error during overdue task check:', error);
    }
  }

  /**
   * Run weekly on Monday at 8:00 AM to provide weekly summary
   * This can be used for a weekly digest notification
   */
  @Cron('0 8 * * 1')
  async sendWeeklySummary() {
    this.logger.log('Running weekly task summary...');

    try {
      const now = new Date();
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);

      // Find tasks due in the next week
      const upcomingTasks = await this.prisma.task.findMany({
        where: {
          term: {
            gte: now,
            lte: nextWeek,
          },
          status: {
            notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED],
          },
        },
        include: {
          sector: {
            select: {
              id: true,
              name: true,
              managerId: true,
            },
          },
        },
        orderBy: {
          term: 'asc',
        },
      });

      // Group by sector
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

      // Here you could emit a weekly summary event if needed
      // For now, just logging the summary

      this.logger.log('Weekly task summary completed successfully');
    } catch (error) {
      this.logger.error('Error during weekly summary:', error);
    }
  }
}
