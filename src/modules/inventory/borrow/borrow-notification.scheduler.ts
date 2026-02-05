import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import {
  BORROW_STATUS,
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
} from '../../../constants/enums';

/**
 * Event emitted when user has unreturned borrows
 */
export class UnreturnedBorrowEvent {
  constructor(
    public readonly userId: string,
    public readonly userName: string,
    public readonly borrows: Array<{
      id: string;
      itemName: string;
      quantity: number;
      borrowedAt: Date;
    }>,
    public readonly sectorManagerId?: string,
  ) {}
}

/**
 * Borrow Notification Scheduler
 * Handles daily reminders for unreturned borrows
 *
 * Runs daily at 17:20 (5:20 PM) to remind users about unreturned tools/items
 * Notifies:
 * - The user who has the borrowed item
 * - The sector manager of that user
 */
@Injectable()
export class BorrowNotificationScheduler {
  private readonly logger = new Logger(BorrowNotificationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Run daily at 17:20 to check for unreturned borrows
   * Sends reminders to users and their sector managers
   */
  @Cron('20 17 * * *') // 17:20 every day
  async checkUnreturnedBorrows() {
    this.logger.log('Running daily unreturned borrow check...');

    try {
      // Find all active (unreturned) borrows
      const unreturnedBorrows = await this.prisma.borrow.findMany({
        where: {
          status: {
            in: [BORROW_STATUS.ACTIVE, BORROW_STATUS.OVERDUE],
          },
        },
        include: {
          item: {
            select: {
              id: true,
              name: true,
              uniCode: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              sectorId: true,
              sector: {
                select: {
                  id: true,
                  name: true,
                  managerId: true,
                },
              },
            },
          },
        },
      });

      this.logger.log(`Found ${unreturnedBorrows.length} unreturned borrows`);

      if (unreturnedBorrows.length === 0) {
        return;
      }

      // Group borrows by user
      const borrowsByUser = unreturnedBorrows.reduce(
        (acc, borrow) => {
          const userId = borrow.userId;
          if (!acc[userId]) {
            acc[userId] = {
              user: borrow.user,
              borrows: [],
            };
          }
          acc[userId].borrows.push({
            id: borrow.id,
            itemName: borrow.item.uniCode
              ? `${borrow.item.uniCode} - ${borrow.item.name}`
              : borrow.item.name,
            quantity: borrow.quantity,
            borrowedAt: borrow.createdAt,
          });
          return acc;
        },
        {} as Record<
          string,
          {
            user: any;
            borrows: Array<{
              id: string;
              itemName: string;
              quantity: number;
              borrowedAt: Date;
            }>;
          }
        >,
      );

      let notificationsCreated = 0;

      // Send notifications for each user with unreturned borrows
      for (const [userId, data] of Object.entries(borrowsByUser)) {
        try {
          const { user, borrows } = data;
          const borrowCount = borrows.length;
          const itemList = borrows.map((b) => b.itemName).join(', ');

          // 1. Notify the user who has the borrowed items
          await this.notificationService.createNotification({
            userId,
            type: NOTIFICATION_TYPE.STOCK,
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            title: 'Lembrete: Itens Emprestados',
            body:
              borrowCount === 1
                ? `Você possui "${itemList}" emprestado(a). Por favor, devolva ao almoxarifado.`
                : `Você possui ${borrowCount} itens emprestados: ${itemList}. Por favor, devolva ao almoxarifado.`,
            actionUrl: '/estoque/emprestimos',
            metadata: {
              webUrl: '/estoque/emprestimos',
              borrowCount,
              items: borrows.map((b) => ({
                id: b.id,
                name: b.itemName,
                quantity: b.quantity,
                borrowedAt: b.borrowedAt,
              })),
            },
            channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
          });
          notificationsCreated++;

          // 2. Notify the sector manager (if exists and different from user)
          const sectorManagerId = user.sector?.managerId;
          if (sectorManagerId && sectorManagerId !== userId) {
            await this.notificationService.createNotification({
              userId: sectorManagerId,
              type: NOTIFICATION_TYPE.STOCK,
              importance: NOTIFICATION_IMPORTANCE.NORMAL,
              title: 'Lembrete: Colaborador com Itens Emprestados',
              body:
                borrowCount === 1
                  ? `${user.name} possui "${itemList}" emprestado(a) há mais de um dia.`
                  : `${user.name} possui ${borrowCount} itens emprestados: ${itemList}.`,
              actionUrl: '/estoque/emprestimos',
              metadata: {
                webUrl: '/estoque/emprestimos',
                employeeId: userId,
                employeeName: user.name,
                borrowCount,
                items: borrows.map((b) => ({
                  id: b.id,
                  name: b.itemName,
                  quantity: b.quantity,
                  borrowedAt: b.borrowedAt,
                })),
              },
              channel: [NOTIFICATION_CHANNEL.IN_APP],
            });
            notificationsCreated++;
          }

          // Emit event for any listeners
          this.eventEmitter.emit(
            'borrow.unreturned.reminder',
            new UnreturnedBorrowEvent(userId, user.name, borrows, sectorManagerId),
          );
        } catch (error) {
          this.logger.error(`Error sending borrow reminder to user ${userId}:`, error);
        }
      }

      this.logger.log(`Sent ${notificationsCreated} unreturned borrow reminders`);
    } catch (error) {
      this.logger.error('Error during unreturned borrow check:', error);
    }
  }
}
