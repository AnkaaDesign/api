/**
 * Mailer Service Usage Examples
 *
 * This file demonstrates various use cases for the MailerService.
 * Copy and adapt these examples for your specific needs.
 */

import { Injectable, Logger } from '@nestjs/common';
import { MailerService, NotificationEmailTemplate } from './mailer.service';
import { DeepLinkService, DeepLinkEntity } from '../deep-link.service';

@Injectable()
export class MailerExampleService {
  private readonly logger = new Logger(MailerExampleService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  /**
   * Example 1: Send a simple notification email
   */
  async sendSimpleNotification(userEmail: string, userName: string): Promise<void> {
    const result = await this.mailerService.sendEmail({
      to: userEmail,
      subject: 'Welcome to Our Platform!',
      template: NotificationEmailTemplate.GENERIC_NOTIFICATION,
      templateData: {
        userName,
        title: 'Welcome!',
        message: 'Thank you for joining our platform. We are excited to have you on board!',
        actionText: 'Click the button below to get started.',
      },
    });

    if (result.success) {
      this.logger.log(`Welcome email sent to ${userEmail}`);
    } else {
      this.logger.error(`Failed to send welcome email: ${result.error}`);
    }
  }

  /**
   * Example 2: Send task created notification with deep link
   */
  async sendTaskCreatedNotification(
    task: any,
    assignedUser: any,
    createdBy: any,
  ): Promise<void> {
    // Build email from template
    const { html, text } = await this.mailerService.buildEmailFromTemplate(
      NotificationEmailTemplate.TASK_CREATED,
      {
        userName: assignedUser.name,
        taskTitle: task.title,
        taskDescription: task.description,
        priority: task.priority,
        dueDate: task.dueDate,
        assignedBy: createdBy.name,
        project: task.project?.name,
      },
    );

    // Add deep link to task details
    const htmlWithLink = this.mailerService.attachDeepLink(
      html,
      DeepLinkEntity.Task,
      task.id,
      'View Task Details',
      { source: 'email', action: 'view' },
    );

    // Add tracking
    let trackedHtml = this.mailerService.trackEmailOpened(htmlWithLink, {
      notificationId: task.notificationId,
      userId: assignedUser.id,
      metadata: { taskId: task.id, type: 'task_created' },
    });

    trackedHtml = this.mailerService.trackLinkClicked(trackedHtml, {
      notificationId: task.notificationId,
      userId: assignedUser.id,
    });

    // Send email
    const result = await this.mailerService.sendEmail({
      to: assignedUser.email,
      subject: `New Task Assigned: ${task.title}`,
      html: trackedHtml,
      text,
      priority: task.priority === 'URGENT' ? 'high' : 'normal',
    });

    if (!result.success) {
      this.logger.error(`Failed to send task notification: ${result.error}`);
    }
  }

  /**
   * Example 3: Send task updated notification
   */
  async sendTaskUpdatedNotification(
    task: any,
    changes: Array<{ field: string; oldValue: any; newValue: any }>,
    updatedBy: any,
    recipient: any,
  ): Promise<void> {
    await this.mailerService.sendEmail({
      to: recipient.email,
      subject: `Task Updated: ${task.title}`,
      template: NotificationEmailTemplate.TASK_UPDATED,
      templateData: {
        userName: recipient.name,
        taskTitle: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        updateSummary: `${changes.length} field(s) updated`,
        changes,
        updatedBy: updatedBy.name,
      },
    });
  }

  /**
   * Example 4: Send order created notification
   */
  async sendOrderCreatedNotification(order: any, recipient: any): Promise<void> {
    const items = order.items.map((item: any) => ({
      name: item.product.name,
      quantity: item.quantity,
      price: item.price.toFixed(2),
    }));

    const result = await this.mailerService.sendEmail({
      to: recipient.email,
      subject: `New Order #${order.orderNumber}`,
      template: NotificationEmailTemplate.ORDER_CREATED,
      templateData: {
        userName: recipient.name,
        orderNumber: order.orderNumber,
        customerName: order.customer.name,
        orderDate: order.createdAt,
        deliveryDate: order.deliveryDate,
        totalAmount: order.totalAmount.toFixed(2),
        orderStatus: order.status,
        items,
        notes: order.notes,
      },
    });

    if (result.success) {
      this.logger.log(`Order notification sent for order #${order.orderNumber}`);
    }
  }

  /**
   * Example 5: Send stock low alert
   */
  async sendStockLowAlert(lowStockItems: any[], recipient: any): Promise<void> {
    const items = lowStockItems.map((item) => ({
      name: item.name,
      code: item.code,
      category: item.category,
      currentQuantity: item.currentQuantity,
      minQuantity: item.minQuantity,
      critical: item.currentQuantity === 0,
      recommendedOrder: Math.max(item.minQuantity * 2 - item.currentQuantity, 0),
    }));

    const criticalItems = items.filter((item) => item.critical);

    await this.mailerService.sendEmail({
      to: recipient.email,
      subject: `⚠️ Stock Alert: ${items.length} Items Below Minimum Level`,
      template: NotificationEmailTemplate.STOCK_LOW,
      templateData: {
        userName: recipient.name,
        items,
        summary: {
          totalItems: items.length,
          criticalItems: criticalItems.length,
        },
      },
      priority: criticalItems.length > 0 ? 'high' : 'normal',
    });
  }

  /**
   * Example 6: Send bulk emails to multiple users
   */
  async sendBulkNewsletter(users: any[], newsletterContent: any): Promise<void> {
    const recipients = users.map((user) => ({
      email: user.email,
      templateData: {
        userName: user.name,
        // Personalized content per user
        recentActivity: user.recentActivity,
        recommendations: user.recommendations,
      },
    }));

    const result = await this.mailerService.sendBulkEmails(
      recipients,
      'Monthly Newsletter - What\'s New',
      NotificationEmailTemplate.GENERIC_NOTIFICATION,
      {
        title: 'Monthly Newsletter',
        message: newsletterContent.message,
        body: newsletterContent.body,
        actionText: 'Check out the latest updates on our platform!',
      },
    );

    this.logger.log(
      `Newsletter sent: ${result.totalSent} successful, ${result.totalFailed} failed`,
    );

    if (result.errors.length > 0) {
      this.logger.error('Newsletter errors:', result.errors);
    }
  }

  /**
   * Example 7: Send email with attachment
   */
  async sendReportEmail(recipient: any, reportData: Buffer, reportName: string): Promise<void> {
    await this.mailerService.sendEmail({
      to: recipient.email,
      subject: `Your Report: ${reportName}`,
      template: NotificationEmailTemplate.GENERIC_NOTIFICATION,
      templateData: {
        userName: recipient.name,
        title: 'Report Ready',
        message: 'Your requested report has been generated and is attached to this email.',
      },
      attachments: [
        {
          filename: `${reportName}.pdf`,
          content: reportData,
          contentType: 'application/pdf',
        },
      ],
    });
  }

  /**
   * Example 8: Send email with embedded images
   */
  async sendEmailWithLogo(recipient: any): Promise<void> {
    const logoPath = '/path/to/logo.png';

    await this.mailerService.sendEmail({
      to: recipient.email,
      subject: 'Welcome to Our Platform',
      html: `
        <h1>Welcome!</h1>
        <img src="cid:logo" alt="Company Logo" />
        <p>Thank you for joining us!</p>
      `,
      attachments: [
        {
          filename: 'logo.png',
          path: logoPath,
          cid: 'logo', // Same as referenced in img src
        },
      ],
    });
  }

  /**
   * Example 9: Send high priority urgent notification
   */
  async sendUrgentAlert(incident: any, admins: any[]): Promise<void> {
    const recipients = admins.map((admin) => ({
      email: admin.email,
      templateData: {
        userName: admin.name,
        adminRole: admin.role,
      },
    }));

    await this.mailerService.sendBulkEmails(
      recipients,
      '🚨 URGENT: System Incident Detected',
      NotificationEmailTemplate.GENERIC_NOTIFICATION,
      {
        title: 'URGENT: System Incident',
        message: incident.description,
        importance: 'URGENT',
        details: [
          { label: 'Incident ID', value: incident.id },
          { label: 'Severity', value: incident.severity },
          { label: 'Time Detected', value: incident.detectedAt },
          { label: 'Affected Systems', value: incident.affectedSystems.join(', ') },
        ],
        actionText: 'Immediate action required. Click below to view details.',
      },
    );
  }

  /**
   * Example 10: Send email with unsubscribe link
   */
  async sendMarketingEmail(user: any, campaign: any): Promise<void> {
    // Build email
    const { html } = await this.mailerService.buildEmailFromTemplate(
      NotificationEmailTemplate.GENERIC_NOTIFICATION,
      {
        userName: user.name,
        title: campaign.title,
        message: campaign.message,
        body: campaign.body,
      },
    );

    // Add unsubscribe link
    const htmlWithUnsubscribe = this.mailerService.addUnsubscribeLink(
      html,
      user.id,
      'marketing',
    );

    // Send email
    await this.mailerService.sendEmail({
      to: user.email,
      subject: campaign.subject,
      html: htmlWithUnsubscribe,
    });
  }

  /**
   * Example 11: Validate emails before sending
   */
  async sendWithValidation(emails: string[], subject: string, message: string): Promise<void> {
    const validEmails: string[] = [];
    const invalidEmails: string[] = [];

    // Validate each email
    for (const email of emails) {
      const validation = this.mailerService.validateEmail(email);
      if (validation.isValid) {
        validEmails.push(validation.email!);
      } else {
        invalidEmails.push(email);
        this.logger.warn(`Invalid email skipped: ${email} - ${validation.error}`);
      }
    }

    // Send to valid emails only
    if (validEmails.length > 0) {
      const recipients = validEmails.map((email) => ({
        email,
        templateData: {},
      }));

      await this.mailerService.sendBulkEmails(
        recipients,
        subject,
        NotificationEmailTemplate.GENERIC_NOTIFICATION,
        { message },
      );
    }

    this.logger.log(`Sent to ${validEmails.length} valid emails, skipped ${invalidEmails.length} invalid`);
  }

  /**
   * Example 12: Handle bounces from webhook
   */
  async handleEmailBounceWebhook(bounceEvent: any): Promise<void> {
    await this.mailerService.handleBounces({
      email: bounceEvent.recipient,
      bounceType: bounceEvent.type, // 'hard', 'soft', 'complaint'
      reason: bounceEvent.diagnostic_code || bounceEvent.reason,
      timestamp: new Date(bounceEvent.timestamp),
    });

    // Check bounce statistics
    const stats = this.mailerService.getBounceStatistics();
    this.logger.log('Bounce statistics:', stats);

    // If hard bounce, you might want to disable email for this user
    if (bounceEvent.type === 'hard') {
      this.logger.warn(`Hard bounce for ${bounceEvent.recipient}. Consider disabling email.`);
      // TODO: Update user record in database
    }
  }

  /**
   * Example 13: Send with retry and fallback
   */
  async sendWithFallback(user: any, notification: any): Promise<void> {
    // Try email first
    const emailResult = await this.mailerService.sendEmail({
      to: user.email,
      subject: notification.title,
      template: NotificationEmailTemplate.GENERIC_NOTIFICATION,
      templateData: {
        userName: user.name,
        title: notification.title,
        message: notification.message,
      },
    });

    if (!emailResult.success) {
      this.logger.error(`Email failed for user ${user.id}: ${emailResult.error}`);

      // Fallback to push notification
      this.logger.log('Attempting push notification fallback...');
      // await this.pushService.send(user.id, notification);

      // Or SMS fallback
      // await this.smsService.send(user.phone, notification.message);
    }
  }

  /**
   * Example 14: Check email service health
   */
  async checkEmailServiceHealth(): Promise<boolean> {
    const isHealthy = await this.mailerService.healthCheck();

    if (!isHealthy) {
      this.logger.error('Email service is unavailable!');
      // Send alert to admins via alternative channel
      // Disable email notifications temporarily
      return false;
    }

    this.logger.log('Email service is healthy');
    return true;
  }

  /**
   * Example 15: Send scheduled digest email
   */
  async sendDailyDigest(user: any, activities: any[]): Promise<void> {
    // Group activities by type
    const groupedActivities = activities.reduce((acc, activity) => {
      if (!acc[activity.type]) {
        acc[activity.type] = [];
      }
      acc[activity.type].push(activity);
      return acc;
    }, {});

    // Build activity summary
    const activitySummary = Object.entries(groupedActivities)
      .map(([type, items]: [string, any]) => ({
        label: type,
        value: `${items.length} new ${type.toLowerCase()}(s)`,
      }));

    await this.mailerService.sendEmail({
      to: user.email,
      subject: `Daily Digest - ${new Date().toLocaleDateString()}`,
      template: NotificationEmailTemplate.GENERIC_NOTIFICATION,
      templateData: {
        userName: user.name,
        title: 'Your Daily Digest',
        message: `Here's a summary of what happened today:`,
        details: activitySummary,
        actionText: 'Click below to view all activities',
      },
    });
  }
}
