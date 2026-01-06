# Mailer Service Integration Examples

This document provides practical examples of integrating the enhanced mailer service with the notification system.

## Example 1: Send Email When Creating Notification

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '@modules/common/notification';
import { NotificationMailerService } from '@modules/common/mailer';
import { NOTIFICATION_CHANNEL } from '../../../constants';

@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationMailer: NotificationMailerService,
  ) {}

  /**
   * Create a notification and send it via email if EMAIL channel is specified
   */
  async createAndSendNotification(
    userId: string,
    userEmail: string,
    userName: string,
    data: {
      title: string;
      body: string;
      type: string;
      importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      actionUrl?: string;
      actionType?: string;
      channels?: string[];
      metadata?: Record<string, any>;
    },
  ) {
    try {
      // Create notification in database
      const notificationResponse = await this.notificationService.createNotification(
        {
          userId,
          title: data.title,
          body: data.body,
          type: data.type,
          importance: data.importance || 'MEDIUM',
          actionUrl: data.actionUrl,
          actionType: data.actionType,
          channel: data.channels || [NOTIFICATION_CHANNEL.IN_APP],
        },
        { include: { user: true } },
      );

      const notification = notificationResponse.data;

      // Send email if EMAIL channel is specified
      if (data.channels?.includes(NOTIFICATION_CHANNEL.EMAIL)) {
        this.logger.log(
          `Sending email notification to ${userEmail} for notification ${notification.id}`,
        );

        const emailResult = await this.notificationMailer.sendNotificationEmail({
          to: userEmail,
          userName,
          title: data.title,
          body: data.body,
          importance: data.importance,
          actionUrl: data.actionUrl,
          actionText: this.getActionText(data.actionType),
          metadata: data.metadata,
        });

        // Update notification with sent status
        if (emailResult.success) {
          await this.notificationService.updateNotification(notification.id, {
            sentAt: new Date(),
          });

          this.logger.log(
            `Email notification sent successfully for notification ${notification.id}`,
          );
        } else {
          this.logger.error(
            `Failed to send email notification for notification ${notification.id}: ${emailResult.error}`,
          );
        }

        return {
          notification,
          emailSent: emailResult.success,
          emailError: emailResult.error,
        };
      }

      return {
        notification,
        emailSent: false,
      };
    } catch (error) {
      this.logger.error(`Failed to create and send notification: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get action text based on action type
   */
  private getActionText(actionType?: string): string | undefined {
    if (!actionType) return undefined;

    const actionTexts: Record<string, string> = {
      VIEW: 'Ver Detalhes',
      OPEN: 'Abrir',
      DOWNLOAD: 'Baixar',
      CONFIRM: 'Confirmar',
      APPROVE: 'Aprovar',
      REJECT: 'Rejeitar',
      COMPLETE: 'Concluir',
    };

    return actionTexts[actionType] || 'Ver Mais';
  }
}
```

## Example 2: Bulk Notification with Email

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '@modules/common/notification';
import { NotificationMailerService } from '@modules/common/mailer';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NOTIFICATION_CHANNEL } from '../../../constants';

@Injectable()
export class BulkNotificationService {
  private readonly logger = new Logger(BulkNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly notificationMailer: NotificationMailerService,
  ) {}

  /**
   * Send notification to multiple users via email
   */
  async sendBulkNotification(
    userIds: string[],
    data: {
      title: string;
      body: string;
      type: string;
      importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      actionUrl?: string;
      actionType?: string;
      channels?: string[];
    },
  ) {
    try {
      this.logger.log(`Sending bulk notification to ${userIds.length} users`);

      // Get user details
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      });

      // Create notifications in database
      const notificationData = users.map(user => ({
        userId: user.id,
        title: data.title,
        body: data.body,
        type: data.type,
        importance: data.importance || 'MEDIUM',
        actionUrl: data.actionUrl,
        actionType: data.actionType,
        channel: data.channels || [NOTIFICATION_CHANNEL.IN_APP],
      }));

      const batchResult = await this.notificationService.batchCreateNotifications({
        notifications: notificationData,
      });

      this.logger.log(
        `Created ${batchResult.data.totalSuccess} notifications in database`,
      );

      // Send emails if EMAIL channel is specified
      if (data.channels?.includes(NOTIFICATION_CHANNEL.EMAIL)) {
        const emailRecipients = users.map(user => ({
          email: user.email,
          userName: user.name,
          title: data.title,
          body: data.body,
          importance: data.importance,
          actionUrl: data.actionUrl,
          actionText: this.getActionText(data.actionType),
        }));

        const emailResult = await this.notificationMailer.sendBulkNotificationEmails({
          recipients: emailRecipients,
        });

        this.logger.log(
          `Sent ${emailResult.success} emails, ${emailResult.failed} failed`,
        );

        // Update notifications with sent status for successful emails
        const successfulEmails = emailResult.results
          .filter(r => r.result.success)
          .map(r => r.email);

        const notificationsToUpdate = batchResult.data.success
          .filter(n => {
            const user = users.find(u => u.id === n.userId);
            return user && successfulEmails.includes(user.email);
          })
          .map(n => ({
            id: n.id,
            data: { sentAt: new Date() },
          }));

        if (notificationsToUpdate.length > 0) {
          await this.notificationService.batchUpdateNotifications({
            notifications: notificationsToUpdate,
          });
        }

        return {
          totalUsers: userIds.length,
          notificationsCreated: batchResult.data.totalSuccess,
          emailsSent: emailResult.success,
          emailsFailed: emailResult.failed,
          errors: emailResult.errors,
        };
      }

      return {
        totalUsers: userIds.length,
        notificationsCreated: batchResult.data.totalSuccess,
        emailsSent: 0,
        emailsFailed: 0,
      };
    } catch (error) {
      this.logger.error(`Failed to send bulk notification: ${error.message}`);
      throw error;
    }
  }

  private getActionText(actionType?: string): string | undefined {
    if (!actionType) return undefined;

    const actionTexts: Record<string, string> = {
      VIEW: 'Ver Detalhes',
      OPEN: 'Abrir',
      DOWNLOAD: 'Baixar',
      CONFIRM: 'Confirmar',
      APPROVE: 'Aprovar',
      REJECT: 'Rejeitar',
      COMPLETE: 'Concluir',
    };

    return actionTexts[actionType] || 'Ver Mais';
  }
}
```

## Example 3: Scheduled Notification Emails

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '@modules/common/notification';
import { NotificationMailerService } from '@modules/common/mailer';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NOTIFICATION_CHANNEL } from '../../../constants';

@Injectable()
export class ScheduledNotificationService {
  private readonly logger = new Logger(ScheduledNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly notificationMailer: NotificationMailerService,
  ) {}

  /**
   * Send scheduled notifications every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sendScheduledNotifications() {
    try {
      const now = new Date();

      // Get notifications scheduled for now that haven't been sent
      const scheduledNotifications = await this.prisma.notification.findMany({
        where: {
          scheduledAt: {
            lte: now,
          },
          sentAt: null,
          channel: {
            has: NOTIFICATION_CHANNEL.EMAIL,
          },
        },
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
        take: 100, // Process 100 at a time
      });

      if (scheduledNotifications.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${scheduledNotifications.length} scheduled notifications`,
      );

      // Send emails
      const emailRecipients = scheduledNotifications
        .filter(n => n.user)
        .map(n => ({
          email: n.user!.email,
          userName: n.user!.name,
          title: n.title,
          body: n.body,
          importance: n.importance as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
          actionUrl: n.actionUrl || undefined,
          actionText: this.getActionText(n.actionType),
        }));

      const emailResult = await this.notificationMailer.sendBulkNotificationEmails({
        recipients: emailRecipients,
      });

      this.logger.log(
        `Sent ${emailResult.success} scheduled emails, ${emailResult.failed} failed`,
      );

      // Update notifications with sent status
      const successfulEmails = emailResult.results
        .filter(r => r.result.success)
        .map(r => r.email);

      const notificationsToUpdate = scheduledNotifications
        .filter(n => n.user && successfulEmails.includes(n.user.email))
        .map(n => ({
          id: n.id,
          data: { sentAt: new Date() },
        }));

      if (notificationsToUpdate.length > 0) {
        await this.notificationService.batchUpdateNotifications({
          notifications: notificationsToUpdate,
        });
      }

      return {
        processed: scheduledNotifications.length,
        sent: emailResult.success,
        failed: emailResult.failed,
      };
    } catch (error) {
      this.logger.error(`Failed to send scheduled notifications: ${error.message}`);
    }
  }

  private getActionText(actionType?: string | null): string | undefined {
    if (!actionType) return undefined;

    const actionTexts: Record<string, string> = {
      VIEW: 'Ver Detalhes',
      OPEN: 'Abrir',
      DOWNLOAD: 'Baixar',
      CONFIRM: 'Confirmar',
      APPROVE: 'Aprovar',
      REJECT: 'Rejeitar',
      COMPLETE: 'Concluir',
    };

    return actionTexts[actionType] || 'Ver Mais';
  }
}
```

## Example 4: Notification Service with Email Integration

Here's how to update the existing NotificationService to send emails:

```typescript
// In notification.service.ts, update the sendNotification method:

import { NotificationMailerService } from '@modules/common/mailer';

@Injectable()
export class NotificationService {
  // ... existing code ...

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationRepository: NotificationRepository,
    private readonly seenNotificationRepository: SeenNotificationRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly notificationMailer: NotificationMailerService, // Add this
  ) {}

  async sendNotification(
    notificationId: string,
    userId?: string,
  ): Promise<NotificationUpdateResponse> {
    try {
      const notification = await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const existing = await this.notificationRepository.findByIdWithTransaction(
          tx,
          notificationId,
        );

        if (!existing) {
          throw new NotFoundException(
            'Notificação não encontrada. Verifique se o ID está correto.',
          );
        }

        // Check if already sent
        if (existing.sentAt) {
          throw new BadRequestException('Esta notificação já foi enviada.');
        }

        const sentAt = new Date();

        // Send notification (mark as sent)
        const sent = await this.notificationRepository.updateWithTransaction(
          tx,
          notificationId,
          {
            sentAt,
          },
          { include: { user: true } },
        );

        // Send via channels
        const channelsSent: string[] = [];

        if (existing.channel.includes(NOTIFICATION_CHANNEL.EMAIL)) {
          // Get user email
          const user = await (tx as any).user.findUnique({
            where: { id: existing.userId },
            select: { email: true, name: true },
          });

          if (user && user.email) {
            // Send email asynchronously (don't block transaction)
            this.notificationMailer
              .sendNotificationEmail({
                to: user.email,
                userName: user.name,
                title: existing.title,
                body: existing.body,
                importance: existing.importance as any,
                actionUrl: existing.actionUrl || undefined,
                actionText: this.getActionText(existing.actionType),
              })
              .then(result => {
                if (result.success) {
                  this.logger.log(
                    `Email sent successfully for notification ${notificationId}`,
                  );
                } else {
                  this.logger.error(
                    `Failed to send email for notification ${notificationId}: ${result.error}`,
                  );
                }
              })
              .catch(error => {
                this.logger.error(
                  `Error sending email for notification ${notificationId}: ${error.message}`,
                );
              });

            channelsSent.push('email');
          }
        }

        if (existing.channel.includes(NOTIFICATION_CHANNEL.PUSH)) {
          // Send push notification
          channelsSent.push('push');
        }

        if (existing.channel.includes(NOTIFICATION_CHANNEL.SMS)) {
          // Send SMS notification
          channelsSent.push('SMS');
        }

        // Log the action with enhanced context
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: notificationId,
          action: CHANGE_ACTION.UPDATE,
          field: 'sentAt',
          oldValue: null,
          newValue: sentAt,
          reason: `Notificação enviada${channelsSent.length > 0 ? ` por: ${channelsSent.join(', ')}` : ''}`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: 'system',
          userId: userId || null,
          transaction: tx,
        });

        return sent;
      });

      return {
        success: true,
        data: notification,
        message: 'Notificação enviada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao enviar notificação:', error);
      throw new InternalServerErrorException('Erro ao enviar notificação. Tente novamente.');
    }
  }

  private getActionText(actionType?: string | null): string | undefined {
    if (!actionType) return undefined;

    const actionTexts: Record<string, string> = {
      VIEW: 'Ver Detalhes',
      OPEN: 'Abrir',
      DOWNLOAD: 'Baixar',
      CONFIRM: 'Confirmar',
      APPROVE: 'Aprovar',
      REJECT: 'Rejeitar',
      COMPLETE: 'Concluir',
    };

    return actionTexts[actionType] || 'Ver Mais';
  }
}
```

## Example 5: Monitoring and Statistics

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationMailerService } from '@modules/common/mailer';

@Injectable()
export class EmailMonitoringService {
  private readonly logger = new Logger(EmailMonitoringService.name);

  constructor(
    private readonly notificationMailer: NotificationMailerService,
  ) {}

  /**
   * Monitor email statistics every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async monitorEmailStatistics() {
    const stats = this.notificationMailer.getStatistics();

    this.logger.log('Email Service Statistics:', JSON.stringify(stats, null, 2));

    // Alert if failure rate is high
    if (stats.failureRate > 10) {
      this.logger.error(
        `High email failure rate detected: ${stats.failureRate.toFixed(2)}%`,
      );
      // Send alert to admin
    }

    // Alert if average retries is high
    if (stats.averageRetries > 1) {
      this.logger.warn(
        `High average retry count detected: ${stats.averageRetries.toFixed(2)}`,
      );
    }
  }

  /**
   * Clear old delivery logs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async clearOldLogs() {
    this.notificationMailer.clearDeliveryLogs();
    this.logger.log('Cleared old delivery logs');
  }

  /**
   * Health check every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async healthCheck() {
    const isHealthy = await this.notificationMailer.healthCheck();

    if (!isHealthy) {
      this.logger.error('Email service health check failed');
      // Send alert to admin
    }
  }
}
```

## Module Setup

To use these services, update your notification module:

```typescript
// notification.module.ts
import { Module } from '@nestjs/common';
import { MailerModule } from '@modules/common/mailer';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './notification-email.service';
import { BulkNotificationService } from './bulk-notification.service';
import { ScheduledNotificationService } from './scheduled-notification.service';
import { EmailMonitoringService } from './email-monitoring.service';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    MailerModule, // Import mailer module
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationEmailService,
    BulkNotificationService,
    ScheduledNotificationService,
    EmailMonitoringService,
    // ... repository providers
  ],
  exports: [
    NotificationService,
    NotificationEmailService,
    BulkNotificationService,
  ],
})
export class NotificationModule {}
```

These examples demonstrate how to integrate the enhanced mailer service with the notification system for various use cases.
