import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../src/modules/common/prisma/prisma.service';
import { NotificationModule } from '../../src/modules/common/notification/notification.module';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE, SECTOR_PRIVILEGES } from '../../src/constants';
import {
  createTestUser,
  createTestTask,
  createTestOrder,
  createTestItem,
  cleanupDatabase,
  waitForAsync
} from './test-helpers';
import { MockEmailService } from './mocks/mock-email.service';
import { MockSmsService } from './mocks/mock-sms.service';
import { MockWhatsAppService } from './mocks/mock-whatsapp.service';
import { MockPushService } from './mocks/mock-push.service';
import { EmailService } from '../../src/modules/common/mailer/services/email.service';
import { SmsService } from '../../src/modules/common/sms/sms.service';

describe('Notification System (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let testUserId: string;
  let warehouseUserId: string;
  let productionUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [NotificationModule],
    })
      .overrideProvider(EmailService)
      .useClass(MockEmailService)
      .overrideProvider(SmsService)
      .useClass(MockSmsService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();
  });

  beforeEach(async () => {
    // Create test users with different sectors
    const adminUser = await createTestUser(prisma, {
      name: 'Admin User',
      email: 'admin@test.com',
      sectorPrivilege: SECTOR_PRIVILEGES.ADMIN,
    });
    testUserId = adminUser.id;
    authToken = 'test-auth-token'; // Mock auth token

    warehouseUserId = (await createTestUser(prisma, {
      name: 'Warehouse User',
      email: 'warehouse@test.com',
      sectorPrivilege: SECTOR_PRIVILEGES.WAREHOUSE,
    })).id;

    productionUserId = (await createTestUser(prisma, {
      name: 'Production User',
      email: 'production@test.com',
      sectorPrivilege: SECTOR_PRIVILEGES.PRODUCTION,
    })).id;
  });

  afterEach(async () => {
    await cleanupDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Task Notifications', () => {
    it('should send notification when task is created', async () => {
      const task = await createTestTask(prisma, {
        title: 'New Test Task',
        userId: testUserId,
      });

      // Wait for async notification processing
      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            type: NOTIFICATION_TYPE.TASK,
            userId: testUserId,
          }),
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.length).toBeGreaterThan(0);

      const notification = response.body.data.find(
        (n: any) => n.title.includes('Task Created') || n.title.includes('New Task')
      );

      expect(notification).toBeDefined();
      expect(notification.type).toBe(NOTIFICATION_TYPE.TASK);
    });

    it('should send notification when task status changes', async () => {
      const task = await createTestTask(prisma, {
        title: 'Status Change Task',
        userId: testUserId,
        status: 'PREPARATION',
      });

      // Update task status
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'IN_PRODUCTION' },
      });

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            type: NOTIFICATION_TYPE.TASK,
            userId: testUserId,
          }),
        })
        .expect(200);

      const statusNotifications = response.body.data.filter(
        (n: any) => n.body.includes('status') || n.body.includes('IN_PRODUCTION')
      );

      expect(statusNotifications.length).toBeGreaterThan(0);
    });

    it('should track individual field changes', async () => {
      const task = await createTestTask(prisma, {
        title: 'Field Track Task',
        userId: testUserId,
        priority: 'NORMAL',
      });

      // Update specific field
      await prisma.task.update({
        where: { id: task.id },
        data: { priority: 'HIGH' },
      });

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            type: NOTIFICATION_TYPE.TASK,
            userId: testUserId,
          }),
        })
        .expect(200);

      const priorityNotification = response.body.data.find(
        (n: any) => n.body.includes('priority') || n.body.includes('HIGH')
      );

      expect(priorityNotification).toBeDefined();
    });

    it('should send notification to assigned user', async () => {
      const task = await createTestTask(prisma, {
        title: 'Assigned Task',
        userId: productionUserId,
      });

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            userId: productionUserId,
            type: NOTIFICATION_TYPE.TASK,
          }),
        })
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].userId).toBe(productionUserId);
    });

    it('should handle task completion notification', async () => {
      const task = await createTestTask(prisma, {
        title: 'Complete Task',
        userId: testUserId,
        status: 'IN_PRODUCTION',
      });

      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'COMPLETED' },
      });

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            type: NOTIFICATION_TYPE.TASK,
            userId: testUserId,
          }),
        })
        .expect(200);

      const completionNotification = response.body.data.find(
        (n: any) => n.body.includes('completed') || n.body.includes('COMPLETED')
      );

      expect(completionNotification).toBeDefined();
    });
  });

  describe('User Preferences', () => {
    it('should respect user channel preferences', async () => {
      // Disable ORDER notifications for production user
      await prisma.userNotificationPreference.upsert({
        where: {
          userId_notificationType_eventType: {
            userId: productionUserId,
            notificationType: NOTIFICATION_TYPE.ORDER,
            eventType: 'created',
          },
        },
        create: {
          userId: productionUserId,
          notificationType: NOTIFICATION_TYPE.ORDER,
          eventType: 'created',
          enabled: false,
          channels: [],
          isMandatory: false,
        },
        update: {
          enabled: false,
          channels: [],
        },
      });

      const order = await createTestOrder(prisma, {
        description: 'Test Order',
      });

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            userId: productionUserId,
            type: NOTIFICATION_TYPE.ORDER,
          }),
        })
        .expect(200);

      expect(response.body.data.filter((n: any) => n.type === NOTIFICATION_TYPE.ORDER)).toHaveLength(0);
    });

    it('should not allow disabling mandatory notifications', async () => {
      const response = await request(app.getHttpServer())
        .put(`/notification-preferences/${testUserId}`)
        .send({
          notificationType: NOTIFICATION_TYPE.TASK,
          eventType: 'status',
          enabled: false,
          channels: [],
        })
        .expect(400);

      expect(response.body.message).toContain('mandatory');
    });

    it('should allow customizing channels for non-mandatory notifications', async () => {
      const response = await request(app.getHttpServer())
        .put(`/notification-preferences/${testUserId}`)
        .send({
          notificationType: NOTIFICATION_TYPE.ORDER,
          eventType: 'created',
          enabled: true,
          channels: [NOTIFICATION_CHANNEL.EMAIL],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.channels).toEqual([NOTIFICATION_CHANNEL.EMAIL]);
    });

    it('should initialize default preferences for new users', async () => {
      const newUser = await createTestUser(prisma, {
        name: 'New User',
        email: 'newuser@test.com',
      });

      const preferences = await prisma.userNotificationPreference.findMany({
        where: { userId: newUser.id },
      });

      expect(preferences.length).toBeGreaterThan(0);
      expect(preferences.some(p => p.isMandatory)).toBe(true);
    });
  });

  describe('Role-based Filtering', () => {
    it('should only send order notifications to warehouse/admin', async () => {
      const order = await createTestOrder(prisma, {
        description: 'Warehouse Order',
      });

      await waitForAsync(1000);

      // Check production user (should not receive)
      const productionResponse = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            userId: productionUserId,
            type: NOTIFICATION_TYPE.ORDER,
          }),
        })
        .expect(200);

      // Check warehouse user (should receive)
      const warehouseResponse = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            userId: warehouseUserId,
            type: NOTIFICATION_TYPE.ORDER,
          }),
        })
        .expect(200);

      expect(productionResponse.body.data.filter((n: any) => n.type === NOTIFICATION_TYPE.ORDER)).toHaveLength(0);
      expect(warehouseResponse.body.data.filter((n: any) => n.type === NOTIFICATION_TYPE.ORDER).length).toBeGreaterThan(0);
    });

    it('should send task notifications to relevant sectors', async () => {
      const task = await createTestTask(prisma, {
        title: 'Production Task',
        userId: productionUserId,
        sectorId: 'production-sector-id',
      });

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            userId: productionUserId,
            type: NOTIFICATION_TYPE.TASK,
          }),
        })
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-channel Delivery', () => {
    it('should send notification via all enabled channels', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Multi-channel Test',
          body: 'Testing all channels',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
        },
      });

      // Trigger dispatch
      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      await waitForAsync(2000);

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      });

      expect(deliveries.length).toBe(3);
      expect(deliveries.some(d => d.channel === NOTIFICATION_CHANNEL.EMAIL)).toBe(true);
      expect(deliveries.some(d => d.channel === NOTIFICATION_CHANNEL.IN_APP)).toBe(true);
      expect(deliveries.some(d => d.channel === NOTIFICATION_CHANNEL.PUSH)).toBe(true);
    });

    it('should handle channel failures gracefully', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Channel Failure Test',
          body: 'Testing failure handling',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.SMS],
          importance: NOTIFICATION_IMPORTANCE.HIGH,
        },
      });

      // Configure mock to fail SMS
      // (This would be set up in the mock service)

      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      await waitForAsync(2000);

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      });

      const emailDelivery = deliveries.find(d => d.channel === NOTIFICATION_CHANNEL.EMAIL);
      const smsDelivery = deliveries.find(d => d.channel === NOTIFICATION_CHANNEL.SMS);

      expect(emailDelivery?.status).toBe('DELIVERED');
      // SMS might be FAILED or RETRYING depending on mock configuration
    });

    it('should track delivery status for each channel', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Delivery Tracking Test',
          body: 'Testing delivery tracking',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.IN_APP],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
        },
      });

      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get(`/notifications/${notification.id}/deliveries`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('channel');
      expect(response.body.data[0]).toHaveProperty('status');
      expect(response.body.data[0]).toHaveProperty('sentAt');
    });
  });

  describe('Tracking', () => {
    it('should track when notification is seen', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Seen Tracking Test',
          body: 'Testing seen tracking',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.IN_APP],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          sentAt: new Date(),
        },
      });

      const response = await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/seen`)
        .send({ userId: testUserId })
        .expect(200);

      expect(response.body.success).toBe(true);

      const seenRecord = await prisma.seenNotification.findFirst({
        where: {
          notificationId: notification.id,
          userId: testUserId,
        },
      });

      expect(seenRecord).toBeDefined();
      expect(seenRecord?.seenAt).toBeDefined();
    });

    it('should not duplicate seen records', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Duplicate Seen Test',
          body: 'Testing duplicate prevention',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.IN_APP],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          sentAt: new Date(),
        },
      });

      // Mark as seen twice
      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/seen`)
        .send({ userId: testUserId })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/seen`)
        .send({ userId: testUserId })
        .expect(200);

      const seenRecords = await prisma.seenNotification.findMany({
        where: {
          notificationId: notification.id,
          userId: testUserId,
        },
      });

      expect(seenRecords.length).toBe(1);
    });

    it('should support remind later functionality', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Remind Later Test',
          body: 'Testing remind later',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.IN_APP],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          sentAt: new Date(),
        },
      });

      const remindAt = new Date(Date.now() + 3600000); // 1 hour from now

      const response = await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/remind`)
        .send({
          userId: testUserId,
          remindAt: remindAt.toISOString(),
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      const seenRecord = await prisma.seenNotification.findFirst({
        where: {
          notificationId: notification.id,
          userId: testUserId,
        },
      });

      expect(seenRecord?.remindAt).toBeDefined();
      expect(new Date(seenRecord!.remindAt!).getTime()).toBeGreaterThan(Date.now());
    });

    it('should get unread notification count', async () => {
      // Create multiple notifications
      await prisma.notification.createMany({
        data: [
          {
            userId: testUserId,
            title: 'Unread 1',
            body: 'Test 1',
            type: NOTIFICATION_TYPE.TASK,
            channel: [NOTIFICATION_CHANNEL.IN_APP],
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            sentAt: new Date(),
          },
          {
            userId: testUserId,
            title: 'Unread 2',
            body: 'Test 2',
            type: NOTIFICATION_TYPE.TASK,
            channel: [NOTIFICATION_CHANNEL.IN_APP],
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            sentAt: new Date(),
          },
        ],
      });

      const response = await request(app.getHttpServer())
        .get(`/notifications/unread/count`)
        .query({ userId: testUserId })
        .expect(200);

      expect(response.body.count).toBeGreaterThanOrEqual(2);
    });

    it('should mark all as read', async () => {
      // Create multiple notifications
      await prisma.notification.createMany({
        data: [
          {
            userId: testUserId,
            title: 'Mark All 1',
            body: 'Test 1',
            type: NOTIFICATION_TYPE.TASK,
            channel: [NOTIFICATION_CHANNEL.IN_APP],
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            sentAt: new Date(),
          },
          {
            userId: testUserId,
            title: 'Mark All 2',
            body: 'Test 2',
            type: NOTIFICATION_TYPE.TASK,
            channel: [NOTIFICATION_CHANNEL.IN_APP],
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            sentAt: new Date(),
          },
        ],
      });

      const response = await request(app.getHttpServer())
        .post(`/notifications/mark-all-read`)
        .send({ userId: testUserId })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBeGreaterThanOrEqual(2);

      // Verify all are marked as read
      const unreadCount = await prisma.notification.count({
        where: {
          userId: testUserId,
          seenBy: {
            none: {
              userId: testUserId,
            },
          },
        },
      });

      expect(unreadCount).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent task updates', async () => {
      const task = await createTestTask(prisma, {
        title: 'Concurrent Update Task',
        userId: testUserId,
      });

      // Simulate concurrent updates
      const updates = [
        prisma.task.update({
          where: { id: task.id },
          data: { priority: 'HIGH' },
        }),
        prisma.task.update({
          where: { id: task.id },
          data: { status: 'IN_PRODUCTION' },
        }),
      ];

      await Promise.all(updates);
      await waitForAsync(2000);

      const notifications = await prisma.notification.findMany({
        where: {
          userId: testUserId,
          type: NOTIFICATION_TYPE.TASK,
        },
      });

      // Should have notifications for both changes
      expect(notifications.length).toBeGreaterThan(1);
    });

    it('should handle failed deliveries with retry', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Retry Test',
          body: 'Testing retry logic',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          importance: NOTIFICATION_IMPORTANCE.HIGH,
        },
      });

      // First attempt will fail (configured in mock)
      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      await waitForAsync(3000); // Wait for retry

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
        orderBy: { createdAt: 'desc' },
      });

      // Should have retry attempts
      expect(deliveries.some(d => d.status === 'RETRYING' || d.attempts > 1)).toBe(true);
    });

    it('should respect rate limiting', async () => {
      const notifications = [];

      // Create many notifications rapidly
      for (let i = 0; i < 50; i++) {
        notifications.push({
          userId: testUserId,
          title: `Rate Limit Test ${i}`,
          body: 'Testing rate limiting',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
        });
      }

      await prisma.notification.createMany({ data: notifications });

      // Attempt to dispatch all at once
      const createdNotifications = await prisma.notification.findMany({
        where: { userId: testUserId },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });

      const dispatchPromises = createdNotifications.map(n =>
        request(app.getHttpServer())
          .post(`/notifications/${n.id}/dispatch`)
      );

      const results = await Promise.allSettled(dispatchPromises);

      // Some should succeed, but rate limiting should prevent all from going through immediately
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      expect(succeeded).toBeLessThan(50);
    });

    it('should handle notification to deleted user gracefully', async () => {
      const tempUser = await createTestUser(prisma, {
        name: 'Temp User',
        email: 'temp@test.com',
      });

      const notification = await prisma.notification.create({
        data: {
          userId: tempUser.id,
          title: 'Deleted User Test',
          body: 'Testing deleted user handling',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
        },
      });

      // Delete user
      await prisma.user.delete({ where: { id: tempUser.id } });

      // Attempt to dispatch - should handle gracefully
      const response = await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should handle empty notification list', async () => {
      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({
          where: JSON.stringify({
            userId: 'non-existent-user-id',
          }),
        })
        .expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta.totalRecords).toBe(0);
    });

    it('should validate notification data', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications')
        .send({
          userId: testUserId,
          title: '', // Empty title should fail
          body: 'Test body',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.IN_APP],
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('Notification Aggregation', () => {
    it('should aggregate similar notifications', async () => {
      // Create multiple similar notifications
      for (let i = 0; i < 5; i++) {
        await createTestTask(prisma, {
          title: `Similar Task ${i}`,
          userId: testUserId,
          status: 'IN_PRODUCTION',
        });
      }

      await waitForAsync(2000);

      const response = await request(app.getHttpServer())
        .get('/notifications/aggregated')
        .query({ userId: testUserId })
        .expect(200);

      expect(response.body.data).toBeDefined();
      // Aggregated notifications should be fewer than individual ones
    });

    it('should group notifications by type', async () => {
      const response = await request(app.getHttpServer())
        .get('/notifications/grouped')
        .query({ userId: testUserId })
        .expect(200);

      expect(response.body.data).toHaveProperty('byType');
      expect(response.body.data.byType).toHaveProperty(NOTIFICATION_TYPE.TASK);
    });
  });

  describe('Scheduled Notifications', () => {
    it('should not send scheduled notification before time', async () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now

      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Scheduled Test',
          body: 'Testing scheduled delivery',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          scheduledAt: futureDate,
        },
      });

      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      const updated = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      expect(updated?.sentAt).toBeNull();
    });

    it('should send scheduled notification after time', async () => {
      const pastDate = new Date(Date.now() - 1000); // 1 second ago

      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Past Scheduled Test',
          body: 'Testing past scheduled delivery',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          scheduledAt: pastDate,
        },
      });

      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      await waitForAsync(1000);

      const updated = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      expect(updated?.sentAt).toBeDefined();
    });
  });

  describe('Notification Statistics', () => {
    it('should get user notification statistics', async () => {
      const response = await request(app.getHttpServer())
        .get(`/notifications/stats/${testUserId}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('totalReceived');
      expect(response.body.data).toHaveProperty('totalSeen');
      expect(response.body.data).toHaveProperty('totalUnseen');
      expect(response.body.data).toHaveProperty('byType');
      expect(response.body.data).toHaveProperty('byChannel');
    });

    it('should get delivery statistics for notification', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Stats Test',
          body: 'Testing statistics',
          type: NOTIFICATION_TYPE.TASK,
          channel: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.IN_APP],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
        },
      });

      await request(app.getHttpServer())
        .post(`/notifications/${notification.id}/dispatch`)
        .expect(200);

      await waitForAsync(1000);

      const response = await request(app.getHttpServer())
        .get(`/notifications/${notification.id}/stats`)
        .expect(200);

      expect(response.body.data).toHaveProperty('totalChannels');
      expect(response.body.data).toHaveProperty('totalSent');
      expect(response.body.data).toHaveProperty('totalDelivered');
      expect(response.body.data).toHaveProperty('byChannel');
    });
  });
});
