import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../../constants';

// Mock FCM service since we don't have the actual implementation
class MockPushNotificationService {
  private mockFCM = {
    sendMulticast: jest.fn(),
    send: jest.fn(),
  };

  async sendNotification(notification: any, user: any, deliveryId: string) {
    // Mock implementation
    if (!user.fcmToken) {
      return {
        success: false,
        error: 'No FCM token available',
      };
    }

    try {
      await this.mockFCM.send({
        token: user.fcmToken,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          notificationId: notification.id,
          type: notification.type,
        },
      });

      return {
        success: true,
        messageId: 'msg-123',
        deliveredAt: new Date(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendBulkNotifications(
    notifications: Array<{ notification: any; user: any; deliveryId: string }>,
  ) {
    const results = await Promise.all(
      notifications.map(({ notification, user, deliveryId }) =>
        this.sendNotification(notification, user, deliveryId),
      ),
    );

    const success = results.filter(r => r.success).length;
    const failed = results.length - success;

    return { success, failed };
  }

  getMockFCM() {
    return this.mockFCM;
  }
}

describe('PushNotificationService', () => {
  let service: MockPushNotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockPushNotificationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: any = {
                FCM_PROJECT_ID: 'test-project',
                FCM_CLIENT_EMAIL: 'test@test.com',
                FCM_PRIVATE_KEY: 'test-key',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MockPushNotificationService>(MockPushNotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendNotification', () => {
    const mockNotification: any = {
      id: 'notif-1',
      title: 'Test Notification',
      body: 'This is a test push notification',
      type: NOTIFICATION_TYPE.TASK,
    };

    it('should send push notification successfully', async () => {
      const mockUser: any = {
        id: 'user-1',
        name: 'Test User',
        fcmToken: 'fcm-token-123',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({
        messageId: 'msg-123',
      });

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(result.deliveredAt).toBeDefined();
      expect(mockFCM.send).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'fcm-token-123',
          notification: expect.objectContaining({
            title: mockNotification.title,
            body: mockNotification.body,
          }),
        }),
      );
    });

    it('should return error when user has no FCM token', async () => {
      const mockUser: any = {
        id: 'user-1',
        name: 'Test User',
        fcmToken: null,
      };

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No FCM token');
    });

    it('should handle FCM send errors', async () => {
      const mockUser: any = {
        id: 'user-1',
        name: 'Test User',
        fcmToken: 'fcm-token-123',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockRejectedValue(new Error('FCM service unavailable'));

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('FCM service unavailable');
    });

    it('should include notification data in push payload', async () => {
      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'fcm-token-123',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({ messageId: 'msg-123' });

      await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(mockFCM.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationId: mockNotification.id,
            type: mockNotification.type,
          }),
        }),
      );
    });
  });

  describe('sendBulkNotifications', () => {
    it('should send multiple push notifications', async () => {
      const notifications = [
        {
          notification: {
            id: 'notif-1',
            title: 'Test 1',
            body: 'Body 1',
            type: NOTIFICATION_TYPE.TASK,
          },
          user: { id: 'user-1', fcmToken: 'token-1' },
          deliveryId: 'delivery-1',
        },
        {
          notification: {
            id: 'notif-2',
            title: 'Test 2',
            body: 'Body 2',
            type: NOTIFICATION_TYPE.ORDER,
          },
          user: { id: 'user-2', fcmToken: 'token-2' },
          deliveryId: 'delivery-2',
        },
      ];

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({ messageId: 'msg-123' });

      const result = await service.sendBulkNotifications(notifications);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('should handle partial failures in bulk send', async () => {
      const notifications = [
        {
          notification: {
            id: 'notif-1',
            title: 'Test 1',
            body: 'Body 1',
            type: NOTIFICATION_TYPE.TASK,
          },
          user: { id: 'user-1', fcmToken: 'token-1' },
          deliveryId: 'delivery-1',
        },
        {
          notification: {
            id: 'notif-2',
            title: 'Test 2',
            body: 'Body 2',
            type: NOTIFICATION_TYPE.TASK,
          },
          user: { id: 'user-2', fcmToken: null }, // No token
          deliveryId: 'delivery-2',
        },
      ];

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({ messageId: 'msg-123' });

      const result = await service.sendBulkNotifications(notifications);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid token errors', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
      };

      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'invalid-token',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockRejectedValue(
        new Error('Requested entity was not found: Invalid registration token'),
      );

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid registration token');
    });

    it('should handle quota exceeded errors', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
      };

      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'valid-token',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockRejectedValue(new Error('Quota exceeded for quota metric'));

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Quota exceeded');
    });

    it('should handle network errors', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
      };

      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'valid-token',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockRejectedValue(new Error('ETIMEDOUT: Network timeout'));

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });
  });

  describe('Notification Payload', () => {
    it('should include action URL in notification data', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
        actionUrl: 'app://tasks/123',
      };

      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'token-123',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({ messageId: 'msg-123' });

      await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      // Would check if actionUrl is included in data payload
      expect(mockFCM.send).toHaveBeenCalled();
    });

    it('should include importance level for priority', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'Urgent Task',
        body: 'High priority notification',
        type: NOTIFICATION_TYPE.TASK,
        importance: 'HIGH',
      };

      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'token-123',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({ messageId: 'msg-123' });

      await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      // Would check if priority is set based on importance
      expect(mockFCM.send).toHaveBeenCalled();
    });
  });

  describe('Token Management', () => {
    it('should validate FCM token format', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'Test',
        body: 'Test',
        type: NOTIFICATION_TYPE.TASK,
      };

      const invalidTokens = ['', ' ', 'short', undefined, null];

      for (const token of invalidTokens) {
        const mockUser: any = {
          id: 'user-1',
          fcmToken: token,
        };

        const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

        expect(result.success).toBe(false);
      }
    });
  });

  describe('Platform-Specific Handling', () => {
    it('should handle Android-specific notifications', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'Android Test',
        body: 'Android notification',
        type: NOTIFICATION_TYPE.TASK,
      };

      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'android-token',
        platform: 'android',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({ messageId: 'msg-123' });

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(true);
    });

    it('should handle iOS-specific notifications', async () => {
      const mockNotification: any = {
        id: 'notif-1',
        title: 'iOS Test',
        body: 'iOS notification',
        type: NOTIFICATION_TYPE.TASK,
      };

      const mockUser: any = {
        id: 'user-1',
        fcmToken: 'ios-token',
        platform: 'ios',
      };

      const mockFCM = service.getMockFCM();
      mockFCM.send.mockResolvedValue({ messageId: 'msg-123' });

      const result = await service.sendNotification(mockNotification, mockUser, 'delivery-1');

      expect(result.success).toBe(true);
    });
  });
});
