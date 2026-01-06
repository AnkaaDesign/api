/**
 * Notification Template Service Integration Examples
 *
 * This file demonstrates how to integrate the NotificationTemplateService
 * with various parts of the application.
 */

import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '../notification.service';
import { NotificationTemplateService } from './notification-template.service';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, TASK_STATUS } from '../../../../constants/enums';

// =====================
// Example 1: Task Event Listener Integration
// =====================

@Injectable()
export class TaskEventListenerExample {
  private readonly logger = new Logger(TaskEventListenerExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Handle task creation event
   * Uses template service to generate consistent notifications
   */
  async handleTaskCreated(task: any, createdBy: any, targetUserIds: string[]): Promise<void> {
    try {
      // Render template
      const notification = this.templateService.render('task.created', {
        taskName: task.name,
        sectorName: task.sector?.name || 'N/A',
        serialNumber: task.serialNumber,
      });

      // Create notifications for all target users
      for (const userId of targetUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: `/tasks/${task.id}`,
          channel: notification.channels || [NOTIFICATION_CHANNEL.IN_APP],
        });
      }

      this.logger.log(`Created ${targetUserIds.length} notifications for task creation`);
    } catch (error) {
      this.logger.error('Error creating task notifications:', error);
      throw error;
    }
  }

  /**
   * Handle task status change with conditional template selection
   */
  async handleTaskStatusChanged(
    task: any,
    oldStatus: TASK_STATUS,
    newStatus: TASK_STATUS,
    changedBy: any,
    targetUserIds: string[],
  ): Promise<void> {
    try {
      // Use specific template for completion
      const templateKey = newStatus === TASK_STATUS.COMPLETED ? 'task.completed' : 'task.status';

      // Render template
      const notification = this.templateService.render(templateKey, {
        taskName: task.name,
        oldStatus: oldStatus,
        newStatus: newStatus,
        changedBy: changedBy.name,
      });

      // Create notifications
      for (const userId of targetUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: `/tasks/${task.id}`,
          channel: notification.channels || [NOTIFICATION_CHANNEL.IN_APP],
        });
      }

      this.logger.log(`Created ${targetUserIds.length} notifications for status change`);
    } catch (error) {
      this.logger.error('Error creating status change notifications:', error);
      throw error;
    }
  }

  /**
   * Handle deadline approaching with urgency-based template selection
   */
  async handleDeadlineApproaching(
    task: any,
    daysRemaining: number,
    targetUserIds: string[],
  ): Promise<void> {
    try {
      // Select template based on urgency
      const templateKey = daysRemaining <= 1 ? 'task.deadline.critical' : 'task.deadline';

      // Render template
      const notification = this.templateService.render(templateKey, {
        taskName: task.name,
        daysRemaining,
        serialNumber: task.serialNumber,
      });

      // Create notifications
      for (const userId of targetUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: `/tasks/${task.id}`,
          channel: notification.channels,
        });
      }

      this.logger.log(`Created ${targetUserIds.length} deadline notifications`);
    } catch (error) {
      this.logger.error('Error creating deadline notifications:', error);
      throw error;
    }
  }
}

// =====================
// Example 2: Multi-Channel Notification
// =====================

@Injectable()
export class MultiChannelNotificationExample {
  private readonly logger = new Logger(MultiChannelNotificationExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Send notification across multiple channels
   */
  async sendTaskOverdueNotification(
    task: any,
    userId: string,
    userEmail: string,
    userPhone: string,
  ): Promise<void> {
    try {
      const daysOverdue = this.calculateDaysOverdue(task.term);
      const appUrl = process.env.APP_URL || 'https://app.example.com';

      // Prepare data
      const data = {
        taskName: task.name,
        daysOverdue,
        serialNumber: task.serialNumber,
        url: `${appUrl}/tasks/${task.id}`,
      };

      // Render for different channels
      const notification = this.templateService.render('task.overdue', data);
      const whatsappMessage = this.templateService.renderWhatsApp('task.overdue', data);
      const email = this.templateService.renderEmail('task.overdue', data);

      // Create in-app notification
      await this.notificationService.createNotification({
        userId,
        type: NOTIFICATION_TYPE.TASK,
        importance: notification.importance,
        title: notification.title,
        body: notification.body,
        actionType: notification.actionType,
        actionUrl: `/tasks/${task.id}`,
        channel: notification.channels,
      });

      // Send WhatsApp (example - would use actual WhatsApp service)
      // await this.whatsappService.send({
      //   to: userPhone,
      //   message: whatsappMessage,
      // });

      // Send Email (example - would use actual email service)
      // await this.emailService.send({
      //   to: userEmail,
      //   subject: email.subject,
      //   body: email.body,
      //   html: email.html,
      // });

      this.logger.log(`Sent multi-channel notification for overdue task ${task.id}`);
    } catch (error) {
      this.logger.error('Error sending multi-channel notification:', error);
      throw error;
    }
  }

  private calculateDaysOverdue(term: Date): number {
    const now = new Date();
    const termDate = new Date(term);
    const diffTime = Math.abs(now.getTime() - termDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
}

// =====================
// Example 3: Stock Alert System
// =====================

@Injectable()
export class StockAlertExample {
  private readonly logger = new Logger(StockAlertExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Send stock level alerts based on quantity
   */
  async checkAndNotifyStockLevels(
    item: any,
    currentQuantity: number,
    targetUserIds: string[],
  ): Promise<void> {
    try {
      let templateKey: string;

      // Determine template based on stock level
      if (currentQuantity < 0) {
        templateKey = 'stock.negative';
      } else if (currentQuantity === 0) {
        templateKey = 'stock.out';
      } else if (currentQuantity <= item.criticalLevel) {
        templateKey = 'stock.critical';
      } else if (currentQuantity <= item.lowLevel) {
        templateKey = 'stock.low';
      } else if (currentQuantity >= item.maxLevel) {
        templateKey = 'stock.overstocked';
      } else if (currentQuantity <= item.reorderPoint) {
        templateKey = 'stock.reorder';
      } else {
        // Stock is at normal level, no notification needed
        return;
      }

      // Render template
      const notification = this.templateService.render(templateKey, {
        itemName: item.name,
        currentQuantity,
        reorderPoint: item.reorderPoint,
        maxQuantity: item.maxLevel,
      });

      // Create notifications
      for (const userId of targetUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.SYSTEM,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: `/inventory/items/${item.id}`,
          channel: notification.channels,
        });
      }

      this.logger.log(`Created stock alert notifications for ${item.name} (${templateKey})`);
    } catch (error) {
      this.logger.error('Error creating stock alert notifications:', error);
      throw error;
    }
  }
}

// =====================
// Example 4: Order Management
// =====================

@Injectable()
export class OrderNotificationExample {
  private readonly logger = new Logger(OrderNotificationExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Notify about order creation
   */
  async notifyOrderCreated(order: any, createdBy: any, targetUserIds: string[]): Promise<void> {
    try {
      const notification = this.templateService.render('order.created', {
        orderNumber: order.number,
        supplierName: order.supplier.name,
        totalValue: this.formatCurrency(order.totalValue),
        createdBy: createdBy.name,
      });

      for (const userId of targetUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.ORDER,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: `/orders/${order.id}`,
          channel: notification.channels,
        });
      }

      this.logger.log(`Created order creation notifications for order ${order.number}`);
    } catch (error) {
      this.logger.error('Error creating order notifications:', error);
      throw error;
    }
  }

  /**
   * Notify when order item is received
   */
  async notifyOrderItemReceived(
    order: any,
    item: any,
    quantity: number,
    receivedBy: any,
    targetUserIds: string[],
  ): Promise<void> {
    try {
      const notification = this.templateService.render('order.item.received', {
        orderNumber: order.number,
        itemName: item.name,
        quantity,
        receivedBy: receivedBy.name,
      });

      for (const userId of targetUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.ORDER,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: `/orders/${order.id}`,
          channel: notification.channels,
        });
      }

      this.logger.log(`Created item received notifications for order ${order.number}`);
    } catch (error) {
      this.logger.error('Error creating item received notifications:', error);
      throw error;
    }
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }
}

// =====================
// Example 5: PPE Request Workflow
// =====================

@Injectable()
export class PPENotificationExample {
  private readonly logger = new Logger(PPENotificationExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Notify when PPE request is created
   */
  async notifyPPERequestCreated(
    request: any,
    requester: any,
    approverIds: string[],
  ): Promise<void> {
    try {
      const notification = this.templateService.render('ppe.request.created', {
        userName: requester.name,
        itemCount: request.items.length,
      });

      // Notify approvers
      for (const approverId of approverIds) {
        await this.notificationService.createNotification({
          userId: approverId,
          type: NOTIFICATION_TYPE.PPE,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: `/ppe/requests/${request.id}`,
          channel: notification.channels,
        });
      }

      this.logger.log(`Created PPE request notifications for ${approverIds.length} approvers`);
    } catch (error) {
      this.logger.error('Error creating PPE request notifications:', error);
      throw error;
    }
  }

  /**
   * Notify when PPE request is approved
   */
  async notifyPPERequestApproved(request: any, approver: any, requesterId: string): Promise<void> {
    try {
      const notification = this.templateService.render('ppe.request.approved', {
        approvedBy: approver.name,
      });

      // Notify requester
      await this.notificationService.createNotification({
        userId: requesterId,
        type: NOTIFICATION_TYPE.PPE,
        importance: notification.importance,
        title: notification.title,
        body: notification.body,
        actionType: notification.actionType,
        actionUrl: `/ppe/requests/${request.id}`,
        channel: notification.channels,
      });

      this.logger.log(`Created PPE approval notification for requester ${requesterId}`);
    } catch (error) {
      this.logger.error('Error creating PPE approval notification:', error);
      throw error;
    }
  }

  /**
   * Notify when PPE is expiring
   */
  async notifyPPEExpiring(item: any, userId: string, daysRemaining: number): Promise<void> {
    try {
      const notification = this.templateService.render('ppe.expiring.soon', {
        itemName: item.name,
        daysRemaining,
      });

      await this.notificationService.createNotification({
        userId,
        type: NOTIFICATION_TYPE.PPE,
        importance: notification.importance,
        title: notification.title,
        body: notification.body,
        actionType: notification.actionType,
        actionUrl: `/ppe/items/${item.id}`,
        channel: notification.channels,
      });

      this.logger.log(`Created PPE expiring notification for user ${userId}`);
    } catch (error) {
      this.logger.error('Error creating PPE expiring notification:', error);
      throw error;
    }
  }
}

// =====================
// Example 6: System Notifications
// =====================

@Injectable()
export class SystemNotificationExample {
  private readonly logger = new Logger(SystemNotificationExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Schedule maintenance notification
   */
  async notifyScheduledMaintenance(
    startDate: string,
    startTime: string,
    duration: string,
    allUserIds: string[],
  ): Promise<void> {
    try {
      const notification = this.templateService.render('system.maintenance.scheduled', {
        startDate,
        startTime,
        duration,
      });

      // Notify all users
      for (const userId of allUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.SYSTEM,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: null,
          channel: notification.channels,
        });
      }

      this.logger.log(`Created maintenance notifications for ${allUserIds.length} users`);
    } catch (error) {
      this.logger.error('Error creating maintenance notifications:', error);
      throw error;
    }
  }

  /**
   * Send custom announcement
   */
  async sendAnnouncement(title: string, message: string, targetUserIds: string[]): Promise<void> {
    try {
      const notification = this.templateService.render('system.announcement', {
        title,
        message,
      });

      for (const userId of targetUserIds) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.SYSTEM,
          importance: notification.importance,
          title: notification.title,
          body: notification.body,
          actionType: notification.actionType,
          actionUrl: null,
          channel: notification.channels,
        });
      }

      this.logger.log(`Created announcement for ${targetUserIds.length} users`);
    } catch (error) {
      this.logger.error('Error creating announcement:', error);
      throw error;
    }
  }
}

// =====================
// Example 7: Error Handling and Fallback
// =====================

@Injectable()
export class NotificationWithFallbackExample {
  private readonly logger = new Logger(NotificationWithFallbackExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Create notification with fallback handling
   */
  async createNotificationSafe(
    templateKey: string,
    data: any,
    userId: string,
    type: NOTIFICATION_TYPE,
  ): Promise<void> {
    try {
      // Check if template exists
      if (!this.templateService.hasTemplate(templateKey)) {
        this.logger.warn(`Template "${templateKey}" not found, using fallback`);

        // Create generic notification
        await this.notificationService.createNotification({
          userId,
          type,
          importance: 'NORMAL' as any,
          title: 'Notificação',
          body: 'Você tem uma nova notificação.',
          actionType: 'VIEW_DETAILS' as any,
          actionUrl: null,
          channel: ['IN_APP'] as any,
        });

        return;
      }

      // Render template
      const notification = this.templateService.render(templateKey, data);

      // Create notification
      await this.notificationService.createNotification({
        userId,
        type,
        importance: notification.importance,
        title: notification.title,
        body: notification.body,
        actionType: notification.actionType,
        actionUrl: data.url || null,
        channel: notification.channels || (['IN_APP'] as any),
      });

      this.logger.log(`Created notification using template "${templateKey}"`);
    } catch (error) {
      this.logger.error(`Error creating notification: ${error.message}`, error.stack);

      // Create minimal fallback notification
      try {
        await this.notificationService.createNotification({
          userId,
          type,
          importance: 'NORMAL' as any,
          title: 'Notificação',
          body: 'Ocorreu um evento no sistema.',
          actionType: 'VIEW_DETAILS' as any,
          actionUrl: null,
          channel: ['IN_APP'] as any,
        });
      } catch (fallbackError) {
        this.logger.error('Failed to create fallback notification', fallbackError);
      }
    }
  }
}

// =====================
// Example 8: Batch Notifications
// =====================

@Injectable()
export class BatchNotificationExample {
  private readonly logger = new Logger(BatchNotificationExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /**
   * Create notifications for multiple users efficiently
   */
  async notifyMultipleUsers(
    templateKey: string,
    data: any,
    userIds: string[],
    type: NOTIFICATION_TYPE,
    actionUrl?: string,
  ): Promise<void> {
    try {
      // Render template once
      const notification = this.templateService.render(templateKey, data);

      // Create notifications in batch
      const notifications = userIds.map(userId => ({
        userId,
        type,
        importance: notification.importance,
        title: notification.title,
        body: notification.body,
        actionType: notification.actionType,
        actionUrl: actionUrl || null,
        channel: notification.channels || [NOTIFICATION_CHANNEL.IN_APP],
      }));

      // Use batch create if available
      await this.notificationService.batchCreateNotifications({
        notifications,
      });

      this.logger.log(
        `Created ${notifications.length} notifications using template "${templateKey}"`,
      );
    } catch (error) {
      this.logger.error('Error creating batch notifications:', error);
      throw error;
    }
  }
}
