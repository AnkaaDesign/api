import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController, SeenNotificationController } from '../notification.controller';
import { NotificationService } from '../notification.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../../constants';

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: NotificationService;

  const mockNotificationService = {
    getNotifications: jest.fn(),
    getNotificationById: jest.fn(),
    createNotification: jest.fn(),
    updateNotification: jest.fn(),
    deleteNotification: jest.fn(),
    batchCreateNotifications: jest.fn(),
    batchUpdateNotifications: jest.fn(),
    batchDeleteNotifications: jest.fn(),
    markAsSeen: jest.fn(),
    getDeliveryStatus: jest.fn(),
    getDeliveryStats: jest.fn(),
    getUnseenNotifications: jest.fn(),
    getUnseenCount: jest.fn(),
    getUserNotificationStats: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findMany', () => {
    it('should return paginated notifications', async () => {
      const mockResult = {
        success: true,
        data: [
          {
            id: 'notif-1',
            title: 'Test Notification',
            body: 'Test body',
            type: NOTIFICATION_TYPE.PRODUCTION,
            channel: [NOTIFICATION_CHANNEL.EMAIL],
            userId: 'user-1',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        message: 'Notificações carregadas com sucesso.',
        meta: {
          totalRecords: 1,
          page: 1,
          take: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };

      mockNotificationService.getNotifications.mockResolvedValue(mockResult);

      const result = await controller.findMany({ page: 1, limit: 10 });

      expect(result).toEqual(mockResult);
      expect(service.getNotifications).toHaveBeenCalledWith({ page: 1, limit: 10 });
    });

    it('should handle filtering by userId', async () => {
      const query = {
        where: { userId: 'user-1' },
        page: 1,
        limit: 10,
      };

      await controller.findMany(query);

      expect(service.getNotifications).toHaveBeenCalledWith(query);
    });
  });

  describe('findById', () => {
    it('should return a notification by id', async () => {
      const mockNotification = {
        success: true,
        data: {
          id: 'notif-1',
          title: 'Test Notification',
          body: 'Test body',
          type: NOTIFICATION_TYPE.PRODUCTION,
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        message: 'Notificação carregada com sucesso.',
      };

      mockNotificationService.getNotificationById.mockResolvedValue(mockNotification);

      const result = await controller.findById('notif-1', { include: {} });

      expect(result).toEqual(mockNotification);
      expect(service.getNotificationById).toHaveBeenCalledWith('notif-1', {});
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationService.getNotificationById.mockRejectedValue(
        new NotFoundException('Notificação não encontrada.'),
      );

      await expect(controller.findById('invalid-id', { include: {} })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a new notification', async () => {
      const createData = {
        title: 'New Notification',
        body: 'Notification body',
        type: NOTIFICATION_TYPE.PRODUCTION,
        channel: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
        userId: 'user-1',
        importance: 'HIGH' as any,
      };

      const mockResult = {
        success: true,
        data: {
          id: 'notif-1',
          ...createData,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        message: 'Notificação criada com sucesso.',
      };

      mockNotificationService.createNotification.mockResolvedValue(mockResult);

      const result = await controller.create(createData, { include: {} }, 'creator-id');

      expect(result).toEqual(mockResult);
      expect(service.createNotification).toHaveBeenCalledWith(createData, {}, 'creator-id');
    });

    it('should validate required fields', async () => {
      const invalidData = {
        body: 'Missing title',
        type: NOTIFICATION_TYPE.PRODUCTION,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
      } as any;

      mockNotificationService.createNotification.mockRejectedValue(
        new BadRequestException('Título da notificação não pode estar vazio.'),
      );

      await expect(controller.create(invalidData, { include: {} }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('should update a notification', async () => {
      const updateData = {
        title: 'Updated Title',
        body: 'Updated body',
      };

      const mockResult = {
        success: true,
        data: {
          id: 'notif-1',
          ...updateData,
          type: NOTIFICATION_TYPE.PRODUCTION,
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        message: 'Notificação atualizada com sucesso.',
      };

      mockNotificationService.updateNotification.mockResolvedValue(mockResult);

      const result = await controller.update('notif-1', updateData, { include: {} }, 'user-1');

      expect(result).toEqual(mockResult);
      expect(service.updateNotification).toHaveBeenCalledWith('notif-1', updateData, {}, 'user-1');
    });
  });

  describe('delete', () => {
    it('should delete a notification', async () => {
      const mockResult = {
        success: true,
        message: 'Notificação excluída com sucesso.',
      };

      mockNotificationService.deleteNotification.mockResolvedValue(mockResult);

      const result = await controller.delete('notif-1', 'user-1');

      expect(result).toEqual(mockResult);
      expect(service.deleteNotification).toHaveBeenCalledWith('notif-1', 'user-1');
    });
  });

  describe('batchCreate', () => {
    it('should create multiple notifications', async () => {
      const batchData = {
        notifications: [
          {
            title: 'Notification 1',
            body: 'Body 1',
            type: NOTIFICATION_TYPE.PRODUCTION,
            channel: [NOTIFICATION_CHANNEL.EMAIL],
            userId: 'user-1',
          },
          {
            title: 'Notification 2',
            body: 'Body 2',
            type: NOTIFICATION_TYPE.PRODUCTION,
            channel: [NOTIFICATION_CHANNEL.PUSH],
            userId: 'user-2',
          },
        ],
      };

      const mockResult = {
        success: true,
        data: {
          success: [],
          failed: [],
          totalProcessed: 2,
          totalSuccess: 2,
          totalFailed: 0,
        },
        message: '2 notificações criadas com sucesso.',
      };

      mockNotificationService.batchCreateNotifications.mockResolvedValue(mockResult);

      const result = await controller.batchCreate(batchData, { include: {} }, 'user-1');

      expect(result).toEqual(mockResult);
      expect(service.batchCreateNotifications).toHaveBeenCalledWith(batchData, {}, 'user-1');
    });
  });

  describe('markAsSeen', () => {
    it('should mark notification as seen', async () => {
      mockNotificationService.markAsSeen.mockResolvedValue(undefined);

      const result = await controller.markAsSeen('notif-1', 'user-1');

      expect(result).toEqual({
        success: true,
        message: 'Notificação marcada como vista com sucesso.',
      });
      expect(service.markAsSeen).toHaveBeenCalledWith('notif-1', 'user-1');
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

      mockNotificationService.getDeliveryStatus.mockResolvedValue(mockDeliveries);

      const result = await controller.getDeliveryStatus('notif-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDeliveries);
      expect(service.getDeliveryStatus).toHaveBeenCalledWith('notif-1');
    });
  });

  describe('getStats', () => {
    it('should return notification statistics', async () => {
      const mockStats = {
        notificationId: 'notif-1',
        totalChannels: 3,
        totalDelivered: 2,
        totalFailed: 1,
        totalSeen: 1,
        deliveryRate: 66.67,
        seenRate: 50,
      };

      mockNotificationService.getDeliveryStats.mockResolvedValue(mockStats);

      const result = await controller.getStats('notif-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockStats);
    });
  });

  describe('getUnseenNotifications', () => {
    it('should return unseen notifications for user', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          title: 'Unseen 1',
          body: 'Body 1',
          type: NOTIFICATION_TYPE.PRODUCTION,
          userId: 'user-1',
          createdAt: new Date(),
        },
      ];

      mockNotificationService.getUnseenNotifications.mockResolvedValue(mockNotifications);

      const result = await controller.getUnseenNotifications('user-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockNotifications);
      expect(result.meta.total).toBe(1);
    });

    it('should throw error when accessing other users unseen notifications', async () => {
      await expect(controller.getUnseenNotifications('user-2', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getUnseenCount', () => {
    it('should return count of unseen notifications', async () => {
      mockNotificationService.getUnseenCount.mockResolvedValue(5);

      const result = await controller.getUnseenCount('user-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.data.count).toBe(5);
    });

    it('should throw error when accessing other users count', async () => {
      await expect(controller.getUnseenCount('user-2', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getUserStats', () => {
    it('should return user notification statistics', async () => {
      const mockStats = {
        totalReceived: 20,
        totalSeen: 15,
        totalUnseen: 5,
        byType: {},
        byChannel: {},
      };

      mockNotificationService.getUserNotificationStats.mockResolvedValue(mockStats);

      const result = await controller.getUserStats('user-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockStats);
    });

    it('should throw error when accessing other users stats', async () => {
      await expect(controller.getUserStats('user-2', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

describe('SeenNotificationController', () => {
  let controller: SeenNotificationController;
  let service: NotificationService;

  const mockNotificationService = {
    getSeenNotifications: jest.fn(),
    getSeenNotificationById: jest.fn(),
    createSeenNotification: jest.fn(),
    updateSeenNotification: jest.fn(),
    deleteSeenNotification: jest.fn(),
    markAsRead: jest.fn(),
    batchCreateSeenNotifications: jest.fn(),
    batchUpdateSeenNotifications: jest.fn(),
    batchDeleteSeenNotifications: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SeenNotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    controller = module.get<SeenNotificationController>(SeenNotificationController);
    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const mockResult = {
        success: true,
        data: {
          id: 'seen-1',
          notificationId: 'notif-1',
          userId: 'user-1',
          seenAt: new Date(),
        },
        message: 'Notificação marcada como lida.',
      };

      mockNotificationService.markAsRead.mockResolvedValue(mockResult);

      const result = await controller.markAsRead('notif-1', 'user-1');

      expect(result).toEqual(mockResult);
      expect(service.markAsRead).toHaveBeenCalledWith('notif-1', 'user-1');
    });

    it('should throw error when notification not found', async () => {
      mockNotificationService.markAsRead.mockRejectedValue(
        new NotFoundException('Notificação não encontrada.'),
      );

      await expect(controller.markAsRead('invalid-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle already seen notification', async () => {
      const mockResult = {
        success: true,
        data: {
          id: 'seen-1',
          notificationId: 'notif-1',
          userId: 'user-1',
          seenAt: new Date(),
        },
        message: 'Notificação marcada como lida.',
      };

      mockNotificationService.markAsRead.mockResolvedValue(mockResult);

      const result = await controller.markAsRead('notif-1', 'user-1');

      expect(result.success).toBe(true);
    });
  });
});
