import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from '../notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangeLogService } from '../../changelog/changelog.service';
import { NotificationRepository, SeenNotificationRepository } from '../repositories/notification.repository';
import { NotificationGatewayService } from '../notification-gateway.service';
import { NotificationTrackingService } from '../notification-tracking.service';
import { NotificationDispatchService } from '../notification-dispatch.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../../constants';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: PrismaService;
  let notificationRepository: NotificationRepository;
  let seenNotificationRepository: SeenNotificationRepository;
  let changeLogService: ChangeLogService;
  let gatewayService: NotificationGatewayService;
  let trackingService: NotificationTrackingService;
  let dispatchService: NotificationDispatchService;

  const mockPrismaService = {
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    notification: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    seenNotification: {
      findFirst: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    notificationDelivery: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockNotificationRepository = {
    findMany: jest.fn(),
    findById: jest.fn(),
    findByIdWithTransaction: jest.fn(),
    createWithTransaction: jest.fn(),
    updateWithTransaction: jest.fn(),
    deleteWithTransaction: jest.fn(),
    createManyWithTransaction: jest.fn(),
    updateManyWithTransaction: jest.fn(),
    deleteManyWithTransaction: jest.fn(),
    findManyWithTransaction: jest.fn(),
  };

  const mockSeenNotificationRepository = {
    findMany: jest.fn(),
    findById: jest.fn(),
    findByIdWithTransaction: jest.fn(),
    createWithTransaction: jest.fn(),
    updateWithTransaction: jest.fn(),
    deleteWithTransaction: jest.fn(),
    createManyWithTransaction: jest.fn(),
    updateManyWithTransaction: jest.fn(),
    deleteManyWithTransaction: jest.fn(),
  };

  const mockChangeLogService = {
    logChange: jest.fn(),
  };

  const mockGatewayService = {
    sendToUser: jest.fn(),
    sendUpdateToUser: jest.fn(),
    sendDeletionToUser: jest.fn(),
    notifyNotificationSeen: jest.fn(),
  };

  const mockTrackingService = {
    markAsSeen: jest.fn(),
    markAsDelivered: jest.fn(),
    setReminder: jest.fn(),
    getUnseenCount: jest.fn(),
    getUnseenNotifications: jest.fn(),
    getDeliveryStatus: jest.fn(),
    getDeliveryStats: jest.fn(),
    findScheduledNotifications: jest.fn(),
    deleteOldNotifications: jest.fn(),
    findDueReminders: jest.fn(),
    clearReminder: jest.fn(),
    findFailedDeliveries: jest.fn(),
    getUserNotificationStats: jest.fn(),
  };

  const mockDispatchService = {
    dispatchNotification: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationRepository, useValue: mockNotificationRepository },
        { provide: SeenNotificationRepository, useValue: mockSeenNotificationRepository },
        { provide: ChangeLogService, useValue: mockChangeLogService },
        { provide: NotificationGatewayService, useValue: mockGatewayService },
        { provide: NotificationTrackingService, useValue: mockTrackingService },
        { provide: NotificationDispatchService, useValue: mockDispatchService },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    prisma = module.get<PrismaService>(PrismaService);
    notificationRepository = module.get<NotificationRepository>(NotificationRepository);
    seenNotificationRepository = module.get<SeenNotificationRepository>(SeenNotificationRepository);
    changeLogService = module.get<ChangeLogService>(ChangeLogService);
    gatewayService = module.get<NotificationGatewayService>(NotificationGatewayService);
    trackingService = module.get<NotificationTrackingService>(NotificationTrackingService);
    dispatchService = module.get<NotificationDispatchService>(NotificationDispatchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('should create a notification successfully', async () => {
      const createData = {
        title: 'Test Notification',
        body: 'Test Body',
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      const mockUser = { id: 'user-1', name: 'Test User' };
      const mockNotification = {
        id: 'notif-1',
        ...createData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockNotificationRepository.createWithTransaction.mockResolvedValue(mockNotification);

      const result = await service.createNotification(createData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockNotification);
      expect(notificationRepository.createWithTransaction).toHaveBeenCalled();
      expect(changeLogService.logChange).toHaveBeenCalled();
      expect(gatewayService.sendToUser).toHaveBeenCalledWith('user-1', mockNotification);
    });

    it('should throw BadRequestException for invalid user', async () => {
      const createData = {
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'invalid-user',
        importance: 'HIGH' as any,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.createNotification(createData)).rejects.toThrow(BadRequestException);
    });

    it('should validate title length', async () => {
      const createData = {
        title: 'a'.repeat(201), // Too long
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.createNotification(createData)).rejects.toThrow(BadRequestException);
    });

    it('should validate body length', async () => {
      const createData = {
        title: 'Test',
        body: 'a'.repeat(5001), // Too long
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.createNotification(createData)).rejects.toThrow(BadRequestException);
    });

    it('should validate empty title', async () => {
      const createData = {
        title: '',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.createNotification(createData)).rejects.toThrow(BadRequestException);
    });

    it('should validate channels', async () => {
      const createData = {
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
        channel: ['INVALID_CHANNEL' as any],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.createNotification(createData)).rejects.toThrow(BadRequestException);
    });

    it('should validate scheduledAt is in future', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      const createData = {
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'user-1',
        importance: 'HIGH' as any,
        scheduledAt: pastDate,
      };

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.createNotification(createData)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getNotifications', () => {
    it('should return paginated notifications', async () => {
      const mockResult = {
        data: [
          {
            id: 'notif-1',
            title: 'Test',
            body: 'Test',
            type: NOTIFICATION_TYPE.TASK,
            createdAt: new Date(),
          },
        ],
        meta: {
          totalRecords: 1,
          page: 1,
          take: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };

      mockNotificationRepository.findMany.mockResolvedValue(mockResult);

      const result = await service.getNotifications({ page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResult.data);
      expect(result.meta).toEqual(mockResult.meta);
    });
  });

  describe('getNotificationById', () => {
    it('should return a notification by id', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
      };

      mockNotificationRepository.findById.mockResolvedValue(mockNotification);

      const result = await service.getNotificationById('notif-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockNotification);
    });

    it('should throw NotFoundException when not found', async () => {
      mockNotificationRepository.findById.mockResolvedValue(null);

      await expect(service.getNotificationById('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateNotification', () => {
    it('should update notification successfully', async () => {
      const updateData = {
        title: 'Updated Title',
        body: 'Updated Body',
      };

      const existing = {
        id: 'notif-1',
        title: 'Old Title',
        body: 'Old Body',
        type: NOTIFICATION_TYPE.TASK,
        userId: 'user-1',
      };

      const updated = {
        ...existing,
        ...updateData,
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(existing);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });
      mockNotificationRepository.updateWithTransaction.mockResolvedValue(updated);

      const result = await service.updateNotification('notif-1', updateData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(updated);
      expect(changeLogService.logChange).toHaveBeenCalled();
      expect(gatewayService.sendUpdateToUser).toHaveBeenCalledWith('user-1', updated);
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(null);

      await expect(service.updateNotification('invalid-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification successfully', async () => {
      const existing = {
        id: 'notif-1',
        title: 'Test',
        userId: 'user-1',
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(existing);
      mockNotificationRepository.deleteWithTransaction.mockResolvedValue(existing);

      const result = await service.deleteNotification('notif-1');

      expect(result.success).toBe(true);
      expect(notificationRepository.deleteWithTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'notif-1',
      );
      expect(changeLogService.logChange).toHaveBeenCalled();
      expect(gatewayService.sendDeletionToUser).toHaveBeenCalledWith('user-1', 'notif-1');
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(null);

      await expect(service.deleteNotification('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('batchCreateNotifications', () => {
    it('should create multiple notifications', async () => {
      const batchData = {
        notifications: [
          {
            title: 'Notif 1',
            body: 'Body 1',
            type: NOTIFICATION_TYPE.TASK,
            channel: [NOTIFICATION_CHANNEL.EMAIL],
            userId: 'user-1',
          },
          {
            title: 'Notif 2',
            body: 'Body 2',
            type: NOTIFICATION_TYPE.TASK,
            channel: [NOTIFICATION_CHANNEL.PUSH],
            userId: 'user-2',
          },
        ],
      };

      const mockResult = {
        success: [
          { id: 'notif-1', ...batchData.notifications[0] },
          { id: 'notif-2', ...batchData.notifications[1] },
        ],
        failed: [],
        totalCreated: 2,
        totalFailed: 0,
      };

      mockNotificationRepository.createManyWithTransaction.mockResolvedValue(mockResult);

      const result = await service.batchCreateNotifications(batchData);

      expect(result.success).toBe(true);
      expect(result.data.totalSuccess).toBe(2);
      expect(result.data.totalFailed).toBe(0);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'Test',
        userId: 'user-1',
      };

      const mockSeenNotification = {
        id: 'seen-1',
        notificationId: 'notif-1',
        userId: 'user-1',
        seenAt: new Date(),
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.seenNotification.findFirst.mockResolvedValue(null);
      mockSeenNotificationRepository.createWithTransaction.mockResolvedValue(mockSeenNotification);

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSeenNotification);
      expect(gatewayService.notifyNotificationSeen).toHaveBeenCalled();
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(null);

      await expect(service.markAsRead('invalid-id', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user is not authorized', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'Test',
        userId: 'user-1',
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);

      await expect(service.markAsRead('notif-1', 'user-2')).rejects.toThrow(BadRequestException);
    });

    it('should return existing seen notification if already marked', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'Test',
        userId: 'user-1',
      };

      const existingSeen = {
        id: 'seen-1',
        notificationId: 'notif-1',
        userId: 'user-1',
        seenAt: new Date(),
      };

      mockNotificationRepository.findByIdWithTransaction.mockResolvedValue(mockNotification);
      mockPrismaService.seenNotification.findFirst.mockResolvedValue(existingSeen);

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(existingSeen);
    });
  });

  describe('sendNotification', () => {
    it('should send notification via dispatch service', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'Test',
        sentAt: null,
      };

      const updatedNotification = {
        ...mockNotification,
        sentAt: new Date(),
      };

      mockNotificationRepository.findById.mockResolvedValueOnce(mockNotification);
      mockDispatchService.dispatchNotification.mockResolvedValue(undefined);
      mockNotificationRepository.findById.mockResolvedValueOnce(updatedNotification);

      const result = await service.sendNotification('notif-1');

      expect(result.success).toBe(true);
      expect(dispatchService.dispatchNotification).toHaveBeenCalledWith('notif-1');
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepository.findById.mockResolvedValue(null);

      await expect(service.sendNotification('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when already sent', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'Test',
        sentAt: new Date(),
      };

      mockNotificationRepository.findById.mockResolvedValue(mockNotification);

      await expect(service.sendNotification('notif-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('scheduleNotification', () => {
    it('should schedule notification for future delivery', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);

      const notificationData = {
        title: 'Scheduled',
        body: 'Body',
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      const mockUser = { id: 'user-1' };
      const mockNotification = {
        id: 'notif-1',
        ...notificationData,
        scheduledAt: futureDate,
        createdAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockNotificationRepository.createWithTransaction.mockResolvedValue(mockNotification);

      const result = await service.scheduleNotification(notificationData, futureDate);

      expect(result.success).toBe(true);
      expect(result.data.scheduledAt).toEqual(futureDate);
    });

    it('should throw BadRequestException for past date', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      const notificationData = {
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      await expect(service.scheduleNotification(notificationData, pastDate)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
