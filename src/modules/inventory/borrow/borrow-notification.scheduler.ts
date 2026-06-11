import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { BORROW_STATUS } from '../../../constants/enums';

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
    public readonly sectorLeaderId?: string,
  ) {}
}

/**
 * Borrow Notification Scheduler
 * Handles daily reminders for unreturned borrows using config-based dispatch.
 *
 * Runs daily at 17:20 (5:20 PM) to remind users about unreturned tools/items.
 *
 * Config keys:
 * - borrow.unreturned_reminder          → targets the borrower user
 * - borrow.unreturned_manager_reminder  → targets the sector manager
 * - borrow.unreturned.escalation        → sector-routed (config row carries
 *   ADMIN + WAREHOUSE + PRODUCTION_MANAGER) for borrows out for more than 7 days
 *
 * Uses dispatchByConfigurationToUsers for targeted user dispatch
 * (checks config enablement + user notification preferences before sending).
 */
@Injectable()
export class BorrowNotificationScheduler {
  private readonly logger = new Logger(BorrowNotificationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Run daily at 17:20 to check for unreturned borrows
   * Sends reminders to users and their sector managers
   */
  @Cron('20 17 * * *', { timeZone: 'America/Sao_Paulo' }) // 17:20 every day
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
                  leaderId: true,
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

      // Escalation cutoff: borrows created more than 7 days ago.
      // Dedup is the daily cron cadence itself (once per borrower per day).
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Send notifications for each user with unreturned borrows
      for (const [userId, data] of Object.entries(borrowsByUser)) {
        try {
          const { user, borrows } = data;
          const borrowCount = borrows.length;
          const itemList = borrows.map(b => b.itemName).join(', ');

          const title = 'Lembrete: Itens Emprestados';
          const body =
            borrowCount === 1
              ? `Você possui "${itemList}" emprestado(a). Por favor, devolva ao almoxarifado.`
              : `Você possui ${borrowCount} itens emprestados: ${itemList}. Por favor, devolva ao almoxarifado.`;

          // 1. Notify the user who has the borrowed items
          await this.dispatchService.dispatchByConfigurationToUsers(
            'borrow.unreturned_reminder',
            'system', // Cron-triggered, no actor user
            {
              entityType: 'Borrow',
              entityId: borrows[0].id,
              action: 'unreturned_reminder',
              data: {
                userName: user.name,
                borrowCount: borrowCount.toString(),
                itemList,
              },
              metadata: {
                borrowCount,
                items: borrows.map(b => ({
                  id: b.id,
                  name: b.itemName,
                  quantity: b.quantity,
                  borrowedAt: b.borrowedAt,
                })),
              },
              overrides: {
                actionUrl: '/estoque/emprestimos',
                webUrl: '/estoque/emprestimos',
                relatedEntityType: 'BORROW',
                title,
                body,
              },
            },
            [userId],
          );
          notificationsCreated++;

          // 2. Notify the sector leader (if exists and different from user)
          const sectorLeaderId = user.sector?.leaderId;
          if (sectorLeaderId && sectorLeaderId !== userId) {
            const leaderTitle = 'Lembrete: Colaborador com Itens Emprestados';
            const leaderBody =
              borrowCount === 1
                ? `${user.name} possui "${itemList}" emprestado(a) há mais de um dia.`
                : `${user.name} possui ${borrowCount} itens emprestados: ${itemList}.`;

            await this.dispatchService.dispatchByConfigurationToUsers(
              'borrow.unreturned_manager_reminder',
              'system', // Cron-triggered, no actor user
              {
                entityType: 'Borrow',
                entityId: borrows[0].id,
                action: 'unreturned_manager_reminder',
                data: {
                  userName: user.name,
                  borrowCount: borrowCount.toString(),
                  itemList,
                  employeeName: user.name,
                },
                metadata: {
                  employeeId: userId,
                  employeeName: user.name,
                  borrowCount,
                  items: borrows.map(b => ({
                    id: b.id,
                    name: b.itemName,
                    quantity: b.quantity,
                    borrowedAt: b.borrowedAt,
                  })),
                },
                overrides: {
                  actionUrl: '/estoque/emprestimos',
                  webUrl: '/estoque/emprestimos',
                  relatedEntityType: 'BORROW',
                  title: leaderTitle,
                  body: leaderBody,
                },
              },
              [sectorLeaderId],
            );
            notificationsCreated++;
          }

          // 3. Sector escalation for borrows unreturned for MORE THAN 7 days.
          // Sector-routed via the config row's allowedSectors
          // (ADMIN + WAREHOUSE + PRODUCTION_MANAGER); once per borrower per day
          // (the daily cron cadence is the dedup).
          const overdueBorrows = borrows.filter(b => b.borrowedAt < sevenDaysAgo);
          if (overdueBorrows.length > 0) {
            const overdueCount = overdueBorrows.length;
            const overdueNames = overdueBorrows.map(b => b.itemName);
            const overdueItemList =
              overdueNames.length > 5
                ? `${overdueNames.slice(0, 5).join(', ')}…`
                : overdueNames.join(', ');
            const oldestBorrowedAt = overdueBorrows.reduce(
              (oldest, b) => (b.borrowedAt < oldest ? b.borrowedAt : oldest),
              overdueBorrows[0].borrowedAt,
            );
            const days = Math.floor(
              (Date.now() - oldestBorrowedAt.getTime()) / (24 * 60 * 60 * 1000),
            );

            await this.dispatchService.dispatchByConfiguration(
              'borrow.unreturned.escalation',
              'system', // Cron-triggered, no actor user
              {
                entityType: 'Borrow',
                entityId: overdueBorrows[0].id,
                action: 'unreturned_escalation',
                data: {
                  userName: user.name,
                  borrowCount: overdueCount.toString(),
                  days: days.toString(),
                  itemList: overdueItemList,
                },
                metadata: {
                  employeeId: userId,
                  employeeName: user.name,
                  borrowCount: overdueCount,
                  days,
                  items: overdueBorrows.map(b => ({
                    id: b.id,
                    name: b.itemName,
                    quantity: b.quantity,
                    borrowedAt: b.borrowedAt,
                  })),
                },
                overrides: {
                  actionUrl: '/estoque/emprestimos',
                  webUrl: '/estoque/emprestimos',
                  relatedEntityType: 'BORROW',
                  title: `Empréstimo não devolvido — ${user.name}`,
                  body: `${user.name} mantém ${overdueCount} item(ns) emprestado(s) há mais de 7 dias: ${overdueItemList}.`,
                },
              },
            );
            notificationsCreated++;
          }

          // Emit event for any listeners
          this.eventEmitter.emit(
            'borrow.unreturned.reminder',
            new UnreturnedBorrowEvent(userId, user.name, borrows, sectorLeaderId),
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
