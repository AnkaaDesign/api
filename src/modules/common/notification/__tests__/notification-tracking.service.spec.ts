import { Test, TestingModule } from '@nestjs/testing';
import { NotificationTrackingService } from '../notification-tracking.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangeLogService } from '../../changelog/changelog.service';
import {
  NotificationRepository,
  SeenNotificationRepository,
} from '../repositories/notification.repository';
import { NotificationDeliveryRepository } from '../repositories/notification-delivery.repository';
import { NotificationGatewayService } from '../notification-gateway.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NOTIFICATION_CHANNEL } from '../../../../constants';

describe('NotificationTrackingService', () => {
  let service: NotificationTrackingService;
  let prisma: PrismaService;
  let notificationRepository: NotificationRepository;
  let seenNotificationRepository: SeenNotificationRepository;
  let deliveryRepository: NotificationDeliveryRepository;

  const mockPrismaService = {
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
    notification: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    seenNotification: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    notificationDelivery: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockNotificationRepository = {
    findById: jest.fn(),
    findByIdWithTransaction: jest.fn(),
    findManyWithTransaction: jest.fn(),
  };

  const mockSeenNotificationRepository = {
    createWithTransaction: jest.fn(),
    findByIdWithTransaction: jest.fn(),
  };

  const mockDeliveryRepository = {
    findByNotification: jest.fn(),
  };

  const mockChangeLogService = {
    logChange: jest.fn(),
  };

  const mockGatewayService = {
    notifyNotificationSeen: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationTrackingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationRepository, useValue: mockNotificationRepository },
        { provide: SeenNotificationRepository, useValue: mockSeenNotificationRepository },
        { provide: NotificationDeliveryRepository, useValue: mockDeliveryRepository },
        { provide: ChangeLogService, useValue: mockChangeLogService },
        { provide: NotificationGatewayService, useValue: mockGatewayService },
      ],
    }).compile();

    service = module.get<NotificationTrackingService>(NotificationTrackingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('markAsSeen', () => {
    it('should mark notification as seen successfully', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };
      const mockSeenNotification = {
        id: 'seen-1',
        notificationId: 'notif-1',
        userId: 'user-1',
        seenAt: new Date(),
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.seenNotification.findFirst.mockResolvedValue(null);
      mockSeenNotificationRepository.createWithTransaction.mockResolvedValue(mockSeenNotification);

      await service.markAsSeen('notif-1', 'user-1');

      expect(mockSeenNotificationRepository.createWithTransaction).toHaveBeenCalled();
      expect(mockChangeLogService.logChange).toHaveBeenCalled();
      expect(mockGatewayService.notifyNotificationSeen).toHaveBeenCalledWith(
        'user-1',
        'notif-1',
        expect.any(Date),
      );
    });

    it('should not create duplicate seen notification', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };
      const existingSeen = {
        id: 'seen-1',
        notificationId: 'notif-1',
        userId: 'user-1',
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.seenNotification.findFirst.mockResolvedValue(existingSeen);

      await service.markAsSeen('notif-1', 'user-1');

      expect(mockSeenNotificationRepository.createWithTransaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(null);

      await expect(service.markAsSeen('invalid-id', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAsDelivered', () => {
    it('should mark notification as delivered', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.notificationDelivery.findFirst.mockResolvedValue(null);
      mockPrismaService.notificationDelivery.create.mockResolvedValue({
        id: 'delivery-1',
        notificationId: 'notif-1',
        channel: NOTIFICATION_CHANNEL.EMAIL,
        status: 'DELIVERED',
      });

      await service.markAsDelivered('notif-1', NOTIFICATION_CHANNEL.EMAIL);

      expect(mockPrismaService.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          notificationId: 'notif-1',
          channel: NOTIFICATION_CHANNEL.EMAIL,
          status: 'DELIVERED',
        }),
      });
      expect(mockChangeLogService.logChange).toHaveBeenCalled();
    });

    it('should update existing delivery record', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };
      const existingDelivery = {
        id: 'delivery-1',
        notificationId: 'notif-1',
        channel: NOTIFICATION_CHANNEL.EMAIL,
        status: 'PENDING',
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.notificationDelivery.findFirst.mockResolvedValue(existingDelivery);
      mockPrismaService.notificationDelivery.update.mockResolvedValue({
        ...existingDelivery,
        status: 'DELIVERED',
      });

      await service.markAsDelivered('notif-1', NOTIFICATION_CHANNEL.EMAIL);

      expect(mockPrismaService.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      });
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(null);

      await expect(
        service.markAsDelivered('invalid-id', NOTIFICATION_CHANNEL.EMAIL),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setReminder', () => {
    it('should set reminder for notification', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.seenNotification.findFirst.mockResolvedValue(null);
      mockSeenNotificationRepository.createWithTransaction.mockResolvedValue({
        id: 'seen-1',
        notificationId: 'notif-1',
        userId: 'user-1',
        seenAt: new Date(),
        remindAt: futureDate,
      });

      await service.setReminder('notif-1', 'user-1', futureDate);

      expect(mockSeenNotificationRepository.createWithTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          notificationId: 'notif-1',
          userId: 'user-1',
          remindAt: futureDate,
        }),
      );
      expect(mockChangeLogService.logChange).toHaveBeenCalled();
    });

    it('should update existing seen notification with reminder', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);
      const existingSeen = {
        id: 'seen-1',
        notificationId: 'notif-1',
        userId: 'user-1',
        remindAt: null,
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.seenNotification.findFirst.mockResolvedValue(existingSeen);
      mockPrismaService.seenNotification.update.mockResolvedValue({
        ...existingSeen,
        remindAt: futureDate,
      });

      await service.setReminder('notif-1', 'user-1', futureDate);

      expect(mockPrismaService.seenNotification.update).toHaveBeenCalledWith({
        where: { id: 'seen-1' },
        data: { remindAt: futureDate },
      });
    });

    it('should throw BadRequestException for past date', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);

      await expect(service.setReminder('notif-1', 'user-1', pastDate)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when notification not found', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(null);

      await expect(service.setReminder('invalid-id', 'user-1', futureDate)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUnseenCount', () => {
    it('should return count of unseen notifications', async () => {
      mockPrismaService.notification.count.mockResolvedValue(5);

      const count = await service.getUnseenCount('user-1');

      expect(count).toBe(5);
      expect(mockPrismaService.notification.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          seenBy: {
            none: {
              userId: 'user-1',
            },
          },
        },
      });
    });

    it('should return 0 when no unseen notifications', async () => {
      mockPrismaService.notification.count.mockResolvedValue(0);

      const count = await service.getUnseenCount('user-1');

      expect(count).toBe(0);
    });
  });

  describe('getUnseenNotifications', () => {
    it('should return unseen notifications for user', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          title: 'Test 1',
          body: 'Body 1',
          userId: 'user-1',
          seenBy: [],
        },
        {
          id: 'notif-2',
          title: 'Test 2',
          body: 'Body 2',
          userId: 'user-1',
          seenBy: [],
        },
      ];

      mockPrismaService.notification.findMany.mockResolvedValue(mockNotifications);

      const result = await service.getUnseenNotifications('user-1');

      expect(result).toHaveLength(2);
      expect(result).toEqual(mockNotifications);
    });

    it('should return empty array when all notifications are seen', async () => {
      mockPrismaService.notification.findMany.mockResolvedValue([]);

      const result = await service.getUnseenNotifications('user-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('getDeliveryStatus', () => {
    it('should return delivery status for all channels', async () => {
      const mockDeliveries = [
        {
          id: 'delivery-1',
          channel: NOTIFICATION_CHANNEL.EMAIL,
          status: 'DELIVERED',
          sentAt: new Date(),
          deliveredAt: new Date(),
        },
        {
          id: 'delivery-2',
          channel: NOTIFICATION_CHANNEL.PUSH,
          status: 'PENDING',
          sentAt: null,
          deliveredAt: null,
        },
      ];

      mockDeliveryRepository.findByNotification.mockResolvedValue(mockDeliveries);

      const result = await service.getDeliveryStatus('notif-1');

      expect(result).toEqual(mockDeliveries);
    });
  });

  describe('getDeliveryStats', () => {
    it('should return comprehensive delivery statistics', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'Test',
        channel: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.WHATSAPP],
        deliveries: [
          {
            id: 'delivery-1',
            channel: NOTIFICATION_CHANNEL.EMAIL,
            status: 'DELIVERED',
            sentAt: new Date(),
            deliveredAt: new Date(),
            failedAt: null,
            errorMessage: null,
            metadata: null,
          },
          {
            id: 'delivery-2',
            channel: NOTIFICATION_CHANNEL.PUSH,
            status: 'FAILED',
            sentAt: new Date(),
            deliveredAt: null,
            failedAt: new Date(),
            errorMessage: 'Push token invalid',
            metadata: { retryCount: 2 },
          },
          {
            id: 'delivery-3',
            channel: NOTIFICATION_CHANNEL.WHATSAPP,
            status: 'PENDING',
            sentAt: null,
            deliveredAt: null,
            failedAt: null,
            errorMessage: null,
            metadata: null,
          },
        ],
        seenBy: [{ id: 'seen-1', userId: 'user-1' }],
        createdAt: new Date(),
        sentAt: new Date(),
      };

      mockPrismaService.notification.findUnique.mockResolvedValue(mockNotification);

      const stats = await service.getDeliveryStats('notif-1');

      expect(stats.notificationId).toBe('notif-1');
      expect(stats.totalChannels).toBe(3);
      expect(stats.totalDelivered).toBe(1);
      expect(stats.totalFailed).toBe(1);
      expect(stats.totalPending).toBe(1);
      expect(stats.totalSeen).toBe(1);
      expect(stats.deliveryRate).toBe(33.33);
      expect(stats.seenRate).toBe(100);
      expect(stats.byChannel).toHaveProperty(NOTIFICATION_CHANNEL.EMAIL);
      expect(stats.byChannel[NOTIFICATION_CHANNEL.PUSH].retryCount).toBe(2);
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockPrismaService.notification.findUnique.mockResolvedValue(null);

      await expect(service.getDeliveryStats('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('trackChannelDelivery', () => {
    it('should track delivery for specific channel', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.notificationDelivery.findFirst.mockResolvedValue(null);
      mockPrismaService.notificationDelivery.create.mockResolvedValue({
        id: 'delivery-1',
        notificationId: 'notif-1',
        channel: NOTIFICATION_CHANNEL.EMAIL,
        status: 'PROCESSING',
      });

      await service.trackChannelDelivery('notif-1', NOTIFICATION_CHANNEL.EMAIL, 'PROCESSING');

      expect(mockPrismaService.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          notificationId: 'notif-1',
          channel: NOTIFICATION_CHANNEL.EMAIL,
          status: 'PROCESSING',
        }),
      });
    });

    it('should update existing delivery with new status', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };
      const existingDelivery = {
        id: 'delivery-1',
        status: 'PENDING',
        sentAt: null,
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.notificationDelivery.findFirst.mockResolvedValue(existingDelivery);
      mockPrismaService.notificationDelivery.update.mockResolvedValue({
        ...existingDelivery,
        status: 'DELIVERED',
      });

      await service.trackChannelDelivery('notif-1', NOTIFICATION_CHANNEL.EMAIL, 'DELIVERED');

      expect(mockPrismaService.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      });
    });

    it('should track failed delivery with error message', async () => {
      const mockNotification = { id: 'notif-1', title: 'Test' };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.notificationDelivery.findFirst.mockResolvedValue(null);
      mockPrismaService.notificationDelivery.create.mockResolvedValue({
        id: 'delivery-1',
        status: 'FAILED',
      });

      await service.trackChannelDelivery(
        'notif-1',
        NOTIFICATION_CHANNEL.EMAIL,
        'FAILED',
        'SMTP connection failed',
      );

      expect(mockPrismaService.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'SMTP connection failed',
          failedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getFailedDeliveries', () => {
    it('should return failed deliveries', async () => {
      const mockFailedDeliveries = [
        {
          id: 'delivery-1',
          notificationId: 'notif-1',
          channel: NOTIFICATION_CHANNEL.EMAIL,
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: 'SMTP error',
          metadata: { retryCount: 1 },
          notification: {
            id: 'notif-1',
            title: 'Test',
            body: 'Body',
            userId: 'user-1',
          },
        },
      ];

      mockPrismaService.notificationDelivery.findMany.mockResolvedValue(mockFailedDeliveries);

      const result = await service.getFailedDeliveries();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('FAILED');
      expect(result[0].errorMessage).toBe('SMTP error');
    });

    it('should filter by notification id', async () => {
      mockPrismaService.notificationDelivery.findMany.mockResolvedValue([]);

      await service.getFailedDeliveries({ notificationId: 'notif-1' });

      expect(mockPrismaService.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            notificationId: 'notif-1',
          }),
        }),
      );
    });

    it('should include retrying deliveries when option is set', async () => {
      mockPrismaService.notificationDelivery.findMany.mockResolvedValue([]);

      await service.getFailedDeliveries({ includeRetrying: true });

      expect(mockPrismaService.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['FAILED', 'RETRYING'] },
          }),
        }),
      );
    });
  });

  describe('retryFailedDelivery', () => {
    it('should retry a failed delivery', async () => {
      const failedDelivery = {
        id: 'delivery-1',
        notificationId: 'notif-1',
        status: 'FAILED',
        metadata: { retryCount: 0 },
        notification: {
          id: 'notif-1',
          title: 'Test',
        },
      };

      mockPrismaService.notificationDelivery.findUnique.mockResolvedValue(failedDelivery);
      mockPrismaService.notificationDelivery.update.mockResolvedValue({
        ...failedDelivery,
        status: 'RETRYING',
        metadata: { retryCount: 1 },
      });

      const result = await service.retryFailedDelivery('delivery-1');

      expect(result.success).toBe(true);
      expect(mockPrismaService.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: 'RETRYING',
          metadata: { retryCount: 1 },
        }),
      });
    });

    it('should not retry if max retries exceeded', async () => {
      const failedDelivery = {
        id: 'delivery-1',
        status: 'FAILED',
        metadata: { retryCount: 3 },
        notification: { id: 'notif-1' },
      };

      mockPrismaService.notificationDelivery.findUnique.mockResolvedValue(failedDelivery);

      const result = await service.retryFailedDelivery('delivery-1', 3);

      expect(result.success).toBe(false);
      expect(result.message).toContain('máximo de tentativas');
    });

    it('should throw NotFoundException when delivery not found', async () => {
      mockPrismaService.notificationDelivery.findUnique.mockResolvedValue(null);

      await expect(service.retryFailedDelivery('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-failed delivery', async () => {
      const successfulDelivery = {
        id: 'delivery-1',
        status: 'DELIVERED',
        notification: { id: 'notif-1' },
      };

      mockPrismaService.notificationDelivery.findUnique.mockResolvedValue(successfulDelivery);

      await expect(service.retryFailedDelivery('delivery-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findScheduledNotifications', () => {
    it('should find notifications scheduled before given date', async () => {
      const now = new Date();
      const mockNotifications = [
        {
          id: 'notif-1',
          title: 'Scheduled 1',
          scheduledAt: new Date(now.getTime() - 1000),
          sentAt: null,
        },
      ];

      mockPrismaService.notification.findMany.mockResolvedValue(mockNotifications);

      const result = await service.findScheduledNotifications(now);

      expect(result).toHaveLength(1);
      expect(result[0].scheduledAt).toBeLessThanOrEqual(now);
    });
  });

  describe('deleteOldNotifications', () => {
    it('should delete old sent notifications', async () => {
      const beforeDate = new Date();
      beforeDate.setMonth(beforeDate.getMonth() - 3);

      mockPrismaService.notification.deleteMany.mockResolvedValue({ count: 10 });

      const count = await service.deleteOldNotifications(beforeDate);

      expect(count).toBe(10);
      expect(mockPrismaService.notification.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: beforeDate },
          sentAt: { not: null },
        },
      });
    });
  });

  describe('findDueReminders', () => {
    it('should find reminders that are due', async () => {
      const now = new Date();
      const mockReminders = [
        {
          id: 'seen-1',
          notificationId: 'notif-1',
          userId: 'user-1',
          remindAt: new Date(now.getTime() - 1000),
          notification: { id: 'notif-1', title: 'Test' },
          user: { id: 'user-1', name: 'Test User' },
        },
      ];

      mockPrismaService.seenNotification.findMany.mockResolvedValue(mockReminders);

      const result = await service.findDueReminders();

      expect(result).toHaveLength(1);
      expect(result[0].remindAt).toBeLessThanOrEqual(now);
    });
  });

  describe('clearReminder', () => {
    it('should clear reminder for seen notification', async () => {
      mockPrismaService.seenNotification.update.mockResolvedValue({
        id: 'seen-1',
        remindAt: null,
      });

      await service.clearReminder('seen-1');

      expect(mockPrismaService.seenNotification.update).toHaveBeenCalledWith({
        where: { id: 'seen-1' },
        data: { remindAt: null },
      });
    });
  });

  describe('getUserNotificationStats', () => {
    it('should return user notification statistics', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          type: 'TASK',
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          seenBy: [{ userId: 'user-1' }],
          deliveries: [
            {
              channel: NOTIFICATION_CHANNEL.EMAIL,
              deliveredAt: new Date(),
              failedAt: null,
            },
          ],
        },
        {
          id: 'notif-2',
          type: 'TASK',
          channel: [NOTIFICATION_CHANNEL.PUSH],
          seenBy: [],
          deliveries: [
            {
              channel: NOTIFICATION_CHANNEL.PUSH,
              deliveredAt: new Date(),
              failedAt: null,
            },
          ],
        },
      ];

      mockPrismaService.notification.count.mockResolvedValueOnce(2); // totalReceived
      mockPrismaService.seenNotification.count.mockResolvedValueOnce(1); // totalSeen
      mockPrismaService.notification.findMany.mockResolvedValue(mockNotifications);

      const stats = await service.getUserNotificationStats('user-1');

      expect(stats.totalReceived).toBe(2);
      expect(stats.totalSeen).toBe(1);
      expect(stats.totalUnseen).toBe(1);
      expect(stats.byType).toHaveProperty('TASK');
      expect(stats.byChannel).toHaveProperty(NOTIFICATION_CHANNEL.EMAIL);
    });
  });
});
