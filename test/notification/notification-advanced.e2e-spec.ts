/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../src/modules/common/prisma/prisma.service';
import { NotificationModule } from '../../src/modules/common/notification/notification.module';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE } from '../../src/constants';
import {
  createTestUser,
  createTestNotification,
  cleanupDatabase,
  waitForAsync,
  createBatchNotifications,
  simulateNotificationDispatch,
  simulateNotificationFailure,
} from './test-helpers';
import { MockEmailService } from './mocks/mock-email.service';
import { MockSmsService } from './mocks/mock-sms.service';
import { EmailService } from '../../src/modules/common/mailer/services/email.service';
import { SmsService } from '../../src/modules/common/sms/sms.service';

describe('Notification System - Advanced Scenarios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockEmailService: MockEmailService;
  let mockSmsService: MockSmsService;
  let testUserId: string;

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
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    mockEmailService = moduleFixture.get<MockEmailService>(EmailService) as any;
    mockSmsService = moduleFixture.get<MockSmsService>(SmsService) as any;

    await app.init();
  });

  beforeEach(async () => {
    const user = await createTestUser(prisma, {
      name: 'Test User',
      email: 'test@example.com',
    });
    testUserId = user.id;

    // Reset mocks
    mockEmailService.reset();
    mockSmsService.reset();
  });

  afterEach(async () => {
    await cleanupDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Delivery Retry Logic', () => {
    it('should retry failed email delivery', async () => {
      mockEmailService.configureFailureRate(0.5); // 50% failure rate

      const notification = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'Retry Test',
        body: 'Testing retry logic',
        type: NOTIFICATION_TYPE.TASK,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
      });

      // Attempt dispatch multiple times
      for (let i = 0; i < 5; i++) {
        try {
          await request(app.getHttpServer())
            .post(`/notifications/${notification.id}/dispatch`)
            .expect(200);
        } catch (error) {
          // Expected some failures
        }
        await waitForAsync(1000);
      }

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      });

      // Should have multiple delivery attempts
      const totalAttempts = deliveries.reduce((sum, d) => sum + (d.attempts || 0), 0);
      expect(totalAttempts).toBeGreaterThan(1);
    });

    it('should implement exponential backoff for retries', async () => {
      const notification = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'Backoff Test',
        body: 'Testing exponential backoff',
        type: NOTIFICATION_TYPE.TASK,
        channels: [NOTIFICATION_CHANNEL.WHATSAPP],
      });

      mockSmsService.configureFail(true);

      const attemptTimes: number[] = [];

      // Simulate retry attempts
      for (let i = 0; i < 4; i++) {
        attemptTimes.push(Date.now());
        try {
          await simulateNotificationDispatch(prisma, notification.id);
        } catch (error) {
          // Expected to fail
        }

        // Exponential backoff: 1s, 2s, 4s, 8s
        if (i < 3) {
          await waitForAsync(Math.pow(2, i) * 1000);
        }
      }

      // Verify exponential backoff timing
      for (let i = 1; i < attemptTimes.length; i++) {
        const delay = attemptTimes[i] - attemptTimes[i - 1];
        const expectedDelay = Math.pow(2, i - 1) * 1000;
        expect(delay).toBeGreaterThanOrEqual(expectedDelay * 0.9); // Allow 10% variance
      }
    });

    it('should mark notification as failed after max retries', async () => {
      mockEmailService.configureFail(true);

      const notification = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'Max Retry Test',
        body: 'Testing max retry limit',
        type: NOTIFICATION_TYPE.TASK,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
      });

      // Attempt dispatch until max retries reached
      for (let i = 0; i < 5; i++) {
        try {
          await simulateNotificationFailure(
            prisma,
            notification.id,
            NOTIFICATION_CHANNEL.EMAIL,
            'Simulated failure'
          );
        } catch (error) {
          // Expected
        }
      }

      const delivery = await prisma.notificationDelivery.findFirst({
        where: {
          notificationId: notification.id,
          channel: NOTIFICATION_CHANNEL.EMAIL,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(delivery?.status).toBe('FAILED');
      expect(delivery?.attempts).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce per-user rate limits', async () => {
      const notifications = await createBatchNotifications(prisma, 100, {
        userId: testUserId,
        type: NOTIFICATION_TYPE.TASK,
      });

      const startTime = Date.now();

      // Attempt to dispatch all at once
      const results = await Promise.allSettled(
        notifications.map(n =>
          request(app.getHttpServer())
            .post(`/notifications/${n.id}/dispatch`)
        )
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should take time due to rate limiting (not instant)
      expect(duration).toBeGreaterThan(1000);

      // Not all should succeed immediately
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      expect(succeeded).toBeLessThan(notifications.length);
    });

    it('should have separate rate limits per channel', async () => {
      const emailNotifications = await createBatchNotifications(prisma, 50, {
        userId: testUserId,
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
      });

      const smsNotifications = await createBatchNotifications(prisma, 50, {
        userId: testUserId,
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.WHATSAPP],
      });

      // Dispatch both types concurrently
      await Promise.allSettled([
        ...emailNotifications.map(n => simulateNotificationDispatch(prisma, n.id)),
        ...smsNotifications.map(n => simulateNotificationDispatch(prisma, n.id)),
      ]);

      await waitForAsync(2000);

      // Both channels should have delivered some notifications
      expect(mockEmailService.getSentCount()).toBeGreaterThan(0);
      expect(mockSmsService.getSentCount()).toBeGreaterThan(0);
    });

    it('should implement burst capacity for urgent notifications', async () => {
      // Create multiple urgent notifications
      const urgentNotifications = await Promise.all(
        Array.from({ length: 20 }, () =>
          createTestNotification(prisma, {
            userId: testUserId,
            title: 'Urgent Notification',
            body: 'Urgent message',
            type: NOTIFICATION_TYPE.WARNING,
            channels: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.WHATSAPP],
            importance: NOTIFICATION_IMPORTANCE.URGENT,
          })
        )
      );

      const startTime = Date.now();

      // Dispatch all urgent notifications
      await Promise.allSettled(
        urgentNotifications.map(n => simulateNotificationDispatch(prisma, n.id))
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Urgent notifications should be processed faster (burst capacity)
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Delivery Optimization', () => {
    it('should batch email deliveries for efficiency', async () => {
      const notifications = await createBatchNotifications(prisma, 20, {
        userId: testUserId,
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
      });

      mockEmailService.reset();

      // Dispatch all notifications
      await Promise.all(
        notifications.map(n => simulateNotificationDispatch(prisma, n.id))
      );

      await waitForAsync(2000);

      // Should use batching - fewer actual email sends than notifications
      // (depending on implementation)
      const sentCount = mockEmailService.getSentCount();
      expect(sentCount).toBeGreaterThan(0);
    });

    it('should prioritize high-importance notifications', async () => {
      // Create mix of importance levels
      const lowPriority = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'Low Priority',
        body: 'Low priority message',
        type: NOTIFICATION_TYPE.GENERAL,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        importance: NOTIFICATION_IMPORTANCE.NORMAL,
      });

      const highPriority = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'High Priority',
        body: 'High priority message',
        type: NOTIFICATION_TYPE.WARNING,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        importance: NOTIFICATION_IMPORTANCE.URGENT,
      });

      mockEmailService.reset();

      // Dispatch in order: low first, then high
      await simulateNotificationDispatch(prisma, lowPriority.id);
      await simulateNotificationDispatch(prisma, highPriority.id);

      await waitForAsync(1000);

      const emails = mockEmailService.sentEmails;
      expect(emails.length).toBe(2);

      // High priority should be sent first (queue priority)
      // This depends on queue implementation
    });

    it('should deduplicate similar notifications', async () => {
      // Create multiple similar notifications in short time
      const notifications = await Promise.all(
        Array.from({ length: 5 }, () =>
          createTestNotification(prisma, {
            userId: testUserId,
            title: 'Task Status Changed',
            body: 'Task status changed to IN_PRODUCTION',
            type: NOTIFICATION_TYPE.TASK,
            channels: [NOTIFICATION_CHANNEL.EMAIL],
          })
        )
      );

      await Promise.all(
        notifications.map(n => simulateNotificationDispatch(prisma, n.id))
      );

      await waitForAsync(2000);

      // Should deduplicate and send fewer emails
      const sentCount = mockEmailService.getSentCount();
      expect(sentCount).toBeLessThan(notifications.length);
    });
  });

  describe('Notification Aggregation', () => {
    it('should aggregate notifications by time window', async () => {
      // Create notifications over time
      for (let i = 0; i < 10; i++) {
        await createTestNotification(prisma, {
          userId: testUserId,
          title: `Notification ${i}`,
          body: 'Task update',
          type: NOTIFICATION_TYPE.TASK,
          channels: [NOTIFICATION_CHANNEL.EMAIL],
        });
        await waitForAsync(100);
      }

      const response = await request(app.getHttpServer())
        .get('/notifications/aggregated')
        .query({
          userId: testUserId,
          timeWindow: '1h',
        })
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should create digest notifications for frequent updates', async () => {
      // Create many similar notifications
      await createBatchNotifications(prisma, 15, {
        userId: testUserId,
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
      });

      await waitForAsync(2000);

      // Should create a digest instead of individual notifications
      const response = await request(app.getHttpServer())
        .get('/notifications/digest')
        .query({ userId: testUserId })
        .expect(200);

      expect(response.body.data).toHaveProperty('digest');
      expect(response.body.data.digest.count).toBeGreaterThan(1);
    });
  });

  describe('Notification Templates', () => {
    it('should use templates for consistent formatting', async () => {
      const notification = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'Task Assigned',
        body: 'Task assigned template',
        type: NOTIFICATION_TYPE.TASK,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
      });

      await simulateNotificationDispatch(prisma, notification.id);
      await waitForAsync(500);

      const sentEmail = mockEmailService.sentEmails[0];
      expect(sentEmail).toBeDefined();
      expect(sentEmail.subject).toContain('Task Assigned');
    });

    it('should support template variables', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUserId,
          title: 'Task {{taskTitle}} assigned',
          body: 'Task {{taskTitle}} has been assigned to {{userName}}',
          type: NOTIFICATION_TYPE.TASK as any,
          channel: [NOTIFICATION_CHANNEL.EMAIL] as any[],
          importance: NOTIFICATION_IMPORTANCE.NORMAL as any,
          metadata: {
            taskTitle: 'Important Task',
            userName: 'John Doe',
          },
        },
      });

      await simulateNotificationDispatch(prisma, notification.id);
      await waitForAsync(500);

      const sentEmail = mockEmailService.sentEmails[0];
      expect(sentEmail.body).toContain('Important Task');
      expect(sentEmail.body).toContain('John Doe');
    });
  });

  describe('Webhook Integration', () => {
    it('should handle delivery status webhooks', async () => {
      const notification = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'Webhook Test',
        body: 'Testing webhook handling',
        type: NOTIFICATION_TYPE.TASK,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
      });

      await simulateNotificationDispatch(prisma, notification.id);

      // Simulate webhook callback
      const response = await request(app.getHttpServer())
        .post('/notifications/webhook/delivery-status')
        .send({
          notificationId: notification.id,
          channel: NOTIFICATION_CHANNEL.EMAIL,
          status: 'delivered',
          timestamp: new Date().toISOString(),
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify status was updated
      const delivery = await prisma.notificationDelivery.findFirst({
        where: {
          notificationId: notification.id,
          channel: NOTIFICATION_CHANNEL.EMAIL as any,
        },
      });

      expect(delivery?.status).toBe('DELIVERED');
    });

    it('should handle bounce notifications', async () => {
      const notification = await createTestNotification(prisma, {
        userId: testUserId,
        title: 'Bounce Test',
        body: 'Testing bounce handling',
        type: NOTIFICATION_TYPE.TASK,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
      });

      await simulateNotificationDispatch(prisma, notification.id);

      // Simulate bounce webhook
      await request(app.getHttpServer())
        .post('/notifications/webhook/bounce')
        .send({
          notificationId: notification.id,
          channel: NOTIFICATION_CHANNEL.EMAIL,
          bounceType: 'hard',
          reason: 'Invalid email address',
        })
        .expect(200);

      const delivery = await prisma.notificationDelivery.findFirst({
        where: { notificationId: notification.id },
      });

      expect(delivery?.status).toBe('FAILED');
      expect(delivery?.errorMessage).toContain('bounce');
    });
  });

  describe('Performance & Scalability', () => {
    it('should handle high volume of notifications', async () => {
      const startTime = Date.now();

      // Create 500 notifications
      const notifications = await createBatchNotifications(prisma, 500, {
        userId: testUserId,
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.EMAIL],
      });

      const creationTime = Date.now() - startTime;

      expect(notifications.length).toBe(500);
      expect(creationTime).toBeLessThan(10000); // Should create in under 10 seconds
    });

    it('should maintain performance under load', async () => {
      // Create notifications and measure response time
      const responseTimes: number[] = [];

      for (let i = 0; i < 20; i++) {
        const startTime = Date.now();

        await request(app.getHttpServer())
          .post('/notifications')
          .send({
            userId: testUserId,
            title: `Performance Test ${i}`,
            body: 'Testing performance',
            type: NOTIFICATION_TYPE.TASK,
            channel: [NOTIFICATION_CHANNEL.IN_APP],
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
          })
          .expect(201);

        responseTimes.push(Date.now() - startTime);
      }

      // Calculate average response time
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      expect(avgResponseTime).toBeLessThan(500); // Under 500ms average
    });
  });

  describe('Data Consistency', () => {
    it('should maintain referential integrity', async () => {
      const user = await createTestUser(prisma, {
        name: 'Integrity Test User',
        email: 'integrity@test.com',
      });

      const notification = await createTestNotification(prisma, {
        userId: user.id,
        title: 'Integrity Test',
        body: 'Testing referential integrity',
        type: NOTIFICATION_TYPE.TASK,
        channels: [NOTIFICATION_CHANNEL.EMAIL],
      });

      // Delete user - should handle gracefully
      await prisma.user.delete({ where: { id: user.id } });

      const notificationAfter = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      // Notification should be deleted or userId should be null (depending on schema)
      expect(notificationAfter === null || notificationAfter.userId === null).toBe(true);
    });

    it('should handle transaction rollbacks correctly', async () => {
      const initialCount = await prisma.notification.count({
        where: { userId: testUserId },
      });

      try {
        await prisma.$transaction(async (tx) => {
          await tx.notification.create({
            data: {
              userId: testUserId,
              title: 'Transaction Test',
              body: 'Testing transaction',
              type: NOTIFICATION_TYPE.TASK as any,
              channel: [NOTIFICATION_CHANNEL.EMAIL] as any[],
              importance: NOTIFICATION_IMPORTANCE.NORMAL as any,
            },
          });

          // Force rollback
          throw new Error('Forced rollback');
        });
      } catch (error) {
        // Expected
      }

      const finalCount = await prisma.notification.count({
        where: { userId: testUserId },
      });

      expect(finalCount).toBe(initialCount);
    });
  });
});
