import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppNotificationService } from '../whatsapp/whatsapp.service';
import { WhatsAppService as WhatsAppClientService } from '../../whatsapp/whatsapp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../../constants';

describe('WhatsAppNotificationService', () => {
  let service: WhatsAppNotificationService;
  let whatsappClient: WhatsAppClientService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;

  const mockWhatsAppClient = {
    isReady: jest.fn(),
    sendMessage: jest.fn(),
    client: {
      isRegisteredUser: jest.fn(),
    },
  };

  const mockPrismaService = {
    userNotificationPreference: {
      findFirst: jest.fn(),
    },
    notificationPreference: {
      findFirst: jest.fn(),
    },
    notificationDelivery: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppNotificationService,
        { provide: WhatsAppClientService, useValue: mockWhatsAppClient },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<WhatsAppNotificationService>(WhatsAppNotificationService);
    whatsappClient = module.get<WhatsAppClientService>(WhatsAppClientService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendNotification', () => {
    const mockNotification: any = {
      id: 'notif-1',
      title: 'Test Notification',
      body: 'This is a test',
      type: NOTIFICATION_TYPE.TASK,
    };

    const mockUser: any = {
      id: 'user-1',
      name: 'Test User',
      phone: '5511999999999',
      email: 'test@example.com',
    };

    it('should send WhatsApp notification successfully', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: true,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(true);
      mockWhatsAppClient.sendMessage.mockResolvedValue(undefined);
      mockPrismaService.notificationDelivery.update.mockResolvedValue({
        id: 'delivery-1',
        status: 'DELIVERED',
      });

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(true);
      expect(result.deliveredAt).toBeDefined();
      expect(whatsappClient.sendMessage).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'whatsapp.notification.sent',
        expect.any(Object),
      );
    });

    it('should return error when WhatsApp client is not ready', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(false);

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not ready');
      expect(whatsappClient.sendMessage).not.toHaveBeenCalled();
    });

    it('should check user preferences before sending', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: false,
        channels: [],
      });

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
      expect(whatsappClient.sendMessage).not.toHaveBeenCalled();
    });

    it('should validate phone number', async () => {
      const userWithoutPhone = { ...mockUser, phone: null };

      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: true,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });

      const result = await service.sendNotification(
        mockNotification,
        userWithoutPhone,
        'delivery-1',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('phone number');
    });

    it('should check if user exists on WhatsApp', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: true,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(false);

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not registered');
    });

    it('should handle rate limiting', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: true,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(true);

      // Send multiple messages to trigger rate limit
      const promises = [];
      for (let i = 0; i < 25; i++) {
        promises.push(service.sendNotification(mockNotification, mockUser, `delivery-${i}`));
      }

      const results = await Promise.all(promises);
      const failedResults = results.filter((r) => !r.success);

      expect(failedResults.length).toBeGreaterThan(0);
      expect(failedResults.some((r) => r.error?.includes('Rate limit'))).toBe(true);
    });

    it('should emit failure event on error', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: true,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(true);
      mockWhatsAppClient.sendMessage.mockRejectedValue(new Error('Network error'));

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'whatsapp.notification.failed',
        expect.any(Object),
      );
    });
  });

  describe('formatMessage', () => {
    it('should format notification message correctly', () => {
      const notification: any = {
        id: 'notif-1',
        title: 'Task Update',
        body: 'Your task has been updated',
        type: NOTIFICATION_TYPE.TASK,
        actionUrl: 'https://app.example.com/tasks/1',
        metadata: {
          priority: 'HIGH',
          dueDate: new Date('2024-12-31'),
        },
      };

      const user: any = {
        id: 'user-1',
        name: 'John Doe',
      };

      const message = service.formatMessage(notification, user);

      expect(message).toContain('Hello, John Doe');
      expect(message).toContain('*Task Update*');
      expect(message).toContain('Your task has been updated');
      expect(message).toContain('https://app.example.com/tasks/1');
      expect(message).toContain('Priority');
      expect(message).toContain('HIGH');
    });

    it('should handle notification without metadata', () => {
      const notification: any = {
        id: 'notif-1',
        title: 'Simple Notification',
        body: 'Simple message',
        type: NOTIFICATION_TYPE.GENERAL,
      };

      const user: any = {
        id: 'user-1',
        name: 'Jane Doe',
      };

      const message = service.formatMessage(notification, user);

      expect(message).toContain('Hello, Jane Doe');
      expect(message).toContain('*Simple Notification*');
      expect(message).toContain('Simple message');
    });
  });

  describe('validatePhoneNumber', () => {
    it('should validate Brazilian phone number', async () => {
      const user: any = {
        id: 'user-1',
        phone: '11999999999',
      };

      const result = await service.validatePhoneNumber(user);

      expect(result.valid).toBe(true);
      expect(result.formatted).toBe('5511999999999');
    });

    it('should validate phone with country code', async () => {
      const user: any = {
        id: 'user-1',
        phone: '5511999999999',
      };

      const result = await service.validatePhoneNumber(user);

      expect(result.valid).toBe(true);
      expect(result.formatted).toBe('5511999999999');
    });

    it('should reject phone without number', async () => {
      const user: any = {
        id: 'user-1',
        phone: null,
      };

      const result = await service.validatePhoneNumber(user);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('no phone number');
    });

    it('should reject too short phone number', async () => {
      const user: any = {
        id: 'user-1',
        phone: '123',
      };

      const result = await service.validatePhoneNumber(user);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 10 and 15 digits');
    });

    it('should reject too long phone number', async () => {
      const user: any = {
        id: 'user-1',
        phone: '1234567890123456',
      };

      const result = await service.validatePhoneNumber(user);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 10 and 15 digits');
    });

    it('should strip formatting from phone number', async () => {
      const user: any = {
        id: 'user-1',
        phone: '(11) 99999-9999',
      };

      const result = await service.validatePhoneNumber(user);

      expect(result.valid).toBe(true);
      expect(result.formatted).toBe('5511999999999');
    });
  });

  describe('checkUserExists', () => {
    it('should verify user exists on WhatsApp', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(true);

      const result = await service.checkUserExists('5511999999999');

      expect(result.exists).toBe(true);
      expect(result.phoneNumber).toBe('5511999999999');
    });

    it('should return false when user not registered', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(false);

      const result = await service.checkUserExists('5511999999999');

      expect(result.exists).toBe(false);
      expect(result.error).toContain('not registered');
    });

    it('should handle client not ready', async () => {
      mockWhatsAppClient.isReady.mockReturnValue(false);

      const result = await service.checkUserExists('5511999999999');

      expect(result.exists).toBe(false);
      expect(result.error).toContain('not ready');
    });
  });

  describe('handleDeliveryStatus', () => {
    it('should update delivery status to delivered', async () => {
      const update = {
        deliveryId: 'delivery-1',
        status: 'DELIVERED' as const,
        deliveredAt: new Date(),
      };

      mockPrismaService.notificationDelivery.update.mockResolvedValue({
        id: 'delivery-1',
        status: 'DELIVERED',
      });

      await service.handleDeliveryStatus(update);

      expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'whatsapp.delivery.status.updated',
        expect.any(Object),
      );
    });

    it('should update delivery status to failed', async () => {
      const update = {
        deliveryId: 'delivery-1',
        status: 'FAILED' as const,
        errorMessage: 'Network error',
      };

      mockPrismaService.notificationDelivery.update.mockResolvedValue({
        id: 'delivery-1',
        status: 'FAILED',
      });

      await service.handleDeliveryStatus(update);

      expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Network error',
          failedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('handleErrors', () => {
    it('should retry on client not ready error', async () => {
      const error = new Error('WhatsApp client is not ready');
      const shouldRetry = await service.handleErrors(error, 'delivery-1');

      expect(shouldRetry).toBe(true);
    });

    it('should not retry on user not found error', async () => {
      const error = new Error('Phone number is not registered on WhatsApp');
      const shouldRetry = await service.handleErrors(error, 'delivery-1');

      expect(shouldRetry).toBe(false);
    });

    it('should retry on rate limit error', async () => {
      const error = new Error('Rate limit exceeded');
      const shouldRetry = await service.handleErrors(error, 'delivery-1');

      expect(shouldRetry).toBe(true);
    });

    it('should not retry on user preferences disabled', async () => {
      const error = new Error('User has disabled WhatsApp notifications');
      const shouldRetry = await service.handleErrors(error, 'delivery-1');

      expect(shouldRetry).toBe(false);
    });

    it('should retry on network error', async () => {
      const error = new Error('ETIMEDOUT: Network timeout');
      const shouldRetry = await service.handleErrors(error, 'delivery-1');

      expect(shouldRetry).toBe(true);
    });
  });

  describe('sendBulkNotifications', () => {
    it('should send multiple notifications', async () => {
      const notifications = [
        {
          notification: { id: 'notif-1', title: 'Test 1', body: 'Body 1', type: NOTIFICATION_TYPE.TASK },
          user: { id: 'user-1', name: 'User 1', phone: '5511999999999' },
          deliveryId: 'delivery-1',
        },
        {
          notification: { id: 'notif-2', title: 'Test 2', body: 'Body 2', type: NOTIFICATION_TYPE.TASK },
          user: { id: 'user-2', name: 'User 2', phone: '5511988888888' },
          deliveryId: 'delivery-2',
        },
      ];

      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: true,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(true);
      mockWhatsAppClient.sendMessage.mockResolvedValue(undefined);
      mockPrismaService.notificationDelivery.update.mockResolvedValue({});

      const result = await service.sendBulkNotifications(notifications);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('should handle partial failures in bulk send', async () => {
      const notifications = [
        {
          notification: { id: 'notif-1', title: 'Test 1', body: 'Body 1', type: NOTIFICATION_TYPE.TASK },
          user: { id: 'user-1', name: 'User 1', phone: '5511999999999' },
          deliveryId: 'delivery-1',
        },
        {
          notification: { id: 'notif-2', title: 'Test 2', body: 'Body 2', type: NOTIFICATION_TYPE.TASK },
          user: { id: 'user-2', name: 'User 2', phone: null }, // Invalid phone
          deliveryId: 'delivery-2',
        },
      ];

      mockWhatsAppClient.isReady.mockReturnValue(true);
      mockPrismaService.userNotificationPreference.findFirst.mockResolvedValue({
        enabled: true,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });
      mockWhatsAppClient.client.isRegisteredUser.mockResolvedValue(true);
      mockWhatsAppClient.sendMessage.mockResolvedValue(undefined);
      mockPrismaService.notificationDelivery.update.mockResolvedValue({});

      const result = await service.sendBulkNotifications(notifications);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});
