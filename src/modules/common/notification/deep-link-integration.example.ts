/**
 * Deep Link Integration Examples
 *
 * This file demonstrates how to integrate the DeepLinkService with notification creation.
 * These are usage examples and should not be imported directly into production code.
 */

import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';
import { NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE } from '../../../constants';

/**
 * Example service showing deep link integration patterns
 */
@Injectable()
export class DeepLinkIntegrationExamples {
  private readonly logger = new Logger(DeepLinkIntegrationExamples.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  /**
   * Example 1: Basic Task Notification with Deep Links
   */
  async example1_basicTaskNotification(taskId: string, userId: string) {
    // Generate action URL for both platforms
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
    );

    // Create notification with action URL
    await this.notificationService.createNotification({
      userId,
      title: 'New Task Assigned',
      body: 'You have been assigned a new task',
      type: 'TASK_ASSIGNMENT',
      importance: NOTIFICATION_IMPORTANCE.NORMAL,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      actionUrl,
      actionType: 'VIEW_TASK',
    });

    this.logger.log(`Created task notification with deep links for task ${taskId}`);
  }

  /**
   * Example 2: Task Approval Request with Action Parameter
   */
  async example2_taskApprovalWithAction(taskId: string, userId: string, taskTitle: string) {
    // Generate action URL with 'approve' action parameter
    // When user clicks, app can automatically open approval dialog
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
      {
        action: 'approve',
        source: 'notification',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Task Approval Required',
      body: `Please review and approve: ${taskTitle}`,
      type: 'APPROVAL_REQUEST',
      importance: NOTIFICATION_IMPORTANCE.HIGH,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
      actionUrl,
      actionType: 'APPROVE_TASK',
    });
  }

  /**
   * Example 3: Order Status Update Notification
   */
  async example3_orderStatusUpdate(
    orderId: string,
    userId: string,
    newStatus: string,
    orderNumber: string,
  ) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Order,
      orderId,
      {
        action: 'view',
        highlight: 'status',
        source: 'status_update',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Order Status Updated',
      body: `Order #${orderNumber} status changed to: ${newStatus}`,
      type: 'ORDER_UPDATE',
      importance: NOTIFICATION_IMPORTANCE.NORMAL,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      actionUrl,
      actionType: 'VIEW_ORDER',
    });
  }

  /**
   * Example 4: Low Stock Alert for Item
   */
  async example4_lowStockAlert(itemId: string, userId: string, itemName: string, quantity: number) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Item,
      itemId,
      {
        action: 'reorder',
        source: 'low_stock_alert',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Low Stock Alert',
      body: `${itemName} is running low (${quantity} remaining). Consider reordering.`,
      type: 'INVENTORY_ALERT',
      importance: NOTIFICATION_IMPORTANCE.HIGH,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      actionUrl,
      actionType: 'VIEW_ITEM',
    });
  }

  /**
   * Example 5: Service Order Completion Notification
   */
  async example5_serviceOrderComplete(
    serviceOrderId: string,
    userId: string,
    serviceOrderNumber: string,
  ) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.ServiceOrder,
      serviceOrderId,
      {
        action: 'view',
        section: 'completion_details',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Service Order Completed',
      body: `Service order #${serviceOrderNumber} has been completed successfully`,
      type: 'SERVICE_ORDER_COMPLETE',
      importance: NOTIFICATION_IMPORTANCE.NORMAL,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      actionUrl,
      actionType: 'VIEW_SERVICE_ORDER',
    });
  }

  /**
   * Example 6: User Profile Update Required
   */
  async example6_profileUpdateRequired(userId: string) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.User,
      userId,
      {
        action: 'edit',
        section: 'personal_info',
        reason: 'incomplete',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Profile Update Required',
      body: 'Please complete your profile information',
      type: 'PROFILE_UPDATE',
      importance: NOTIFICATION_IMPORTANCE.NORMAL,
      channel: [NOTIFICATION_CHANNEL.IN_APP],
      actionUrl,
      actionType: 'EDIT_PROFILE',
    });
  }

  /**
   * Example 7: Multiple Notifications with Different Actions
   */
  async example7_batchTaskAssignments(
    taskAssignments: Array<{ taskId: string; userId: string; taskTitle: string }>,
  ) {
    const notifications = taskAssignments.map(assignment => {
      const actionUrl = this.deepLinkService.generateNotificationActionUrl(
        DeepLinkEntity.Task,
        assignment.taskId,
        {
          action: 'view',
          source: 'batch_assignment',
        },
      );

      return {
        userId: assignment.userId,
        title: 'New Task Assigned',
        body: `You have been assigned: ${assignment.taskTitle}`,
        type: 'TASK_ASSIGNMENT',
        importance: NOTIFICATION_IMPORTANCE.NORMAL,
        channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        actionUrl,
        actionType: 'VIEW_TASK',
      };
    });

    await this.notificationService.batchCreateNotifications({
      notifications,
    });

    this.logger.log(`Created ${notifications.length} task assignment notifications`);
  }

  /**
   * Example 8: Notification with Time-Sensitive Action
   */
  async example8_urgentTaskWithDeadline(
    taskId: string,
    userId: string,
    taskTitle: string,
    deadline: Date,
  ) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
      {
        action: 'view',
        priority: 'urgent',
        deadline: deadline.toISOString(),
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Urgent Task - Deadline Approaching',
      body: `${taskTitle} is due soon!`,
      type: 'TASK_DEADLINE',
      importance: NOTIFICATION_IMPORTANCE.URGENT,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
      actionUrl,
      actionType: 'VIEW_TASK',
    });
  }

  /**
   * Example 9: Order Requires Attention
   */
  async example9_orderRequiresAttention(
    orderId: string,
    userId: string,
    orderNumber: string,
    issue: string,
  ) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Order,
      orderId,
      {
        action: 'resolve',
        issue: issue,
        source: 'system_check',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Order Requires Attention',
      body: `Order #${orderNumber}: ${issue}`,
      type: 'ORDER_ISSUE',
      importance: NOTIFICATION_IMPORTANCE.HIGH,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      actionUrl,
      actionType: 'RESOLVE_ORDER_ISSUE',
    });
  }

  /**
   * Example 10: Service Order Review Request
   */
  async example10_serviceOrderReviewRequest(
    serviceOrderId: string,
    userId: string,
    serviceOrderNumber: string,
  ) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.ServiceOrder,
      serviceOrderId,
      {
        action: 'review',
        source: 'completion_notification',
        tab: 'quality_check',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Service Order Review Needed',
      body: `Please review service order #${serviceOrderNumber}`,
      type: 'REVIEW_REQUEST',
      importance: NOTIFICATION_IMPORTANCE.NORMAL,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      actionUrl,
      actionType: 'REVIEW_SERVICE_ORDER',
    });
  }

  /**
   * Example 11: Generate Links Without Creating Notification
   * (Useful for email templates or external systems)
   */
  async example11_generateLinksOnly(taskId: string) {
    // Get all link types
    const links = this.deepLinkService.generateTaskLinks(taskId, {
      action: 'view',
      source: 'email',
    });

    console.log('Web Link:', links.web);
    console.log('Mobile Link:', links.mobile);
    console.log('Universal Link:', links.universalLink);

    // Or get individual platform links
    const webOnly = this.deepLinkService.generateTaskLink(taskId, 'web', {
      action: 'approve',
    });

    const mobileOnly = this.deepLinkService.generateTaskLink(taskId, 'mobile', {
      action: 'approve',
    });

    return { links, webOnly, mobileOnly };
  }

  /**
   * Example 12: Parse Existing Action URL
   */
  async example12_parseExistingActionUrl(notificationId: string) {
    // Fetch notification
    const notification = await this.notificationService.getNotificationById(notificationId);

    // Parse the action URL
    const parsedLinks = this.deepLinkService.parseNotificationActionUrl(
      notification.data.actionUrl,
    );

    if (parsedLinks) {
      console.log('Web URL:', parsedLinks.web);
      console.log('Mobile URL:', parsedLinks.mobile);
      console.log('Universal Link:', parsedLinks.universalLink);
    }

    return parsedLinks;
  }

  /**
   * Example 13: Validate Deep Link Before Use
   */
  async example13_validateDeepLink(url: string) {
    const isValid = this.deepLinkService.validateDeepLink(url);

    if (isValid) {
      this.logger.log(`Deep link is valid: ${url}`);
    } else {
      this.logger.warn(`Invalid deep link: ${url}`);
    }

    return isValid;
  }

  /**
   * Example 14: Dynamic Entity Type Selection
   */
  async example14_dynamicEntityType(
    entityType: 'task' | 'order' | 'item' | 'serviceOrder' | 'user',
    entityId: string,
    userId: string,
  ) {
    // Map string type to enum
    const entityTypeMap: Record<string, DeepLinkEntity> = {
      task: DeepLinkEntity.Task,
      order: DeepLinkEntity.Order,
      item: DeepLinkEntity.Item,
      serviceOrder: DeepLinkEntity.ServiceOrder,
      user: DeepLinkEntity.User,
    };

    const enumType = entityTypeMap[entityType];

    const actionUrl = this.deepLinkService.generateNotificationActionUrl(enumType, entityId, {
      action: 'view',
    });

    await this.notificationService.createNotification({
      userId,
      title: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Update`,
      body: `View the latest updates`,
      type: 'GENERIC_UPDATE',
      importance: NOTIFICATION_IMPORTANCE.NORMAL,
      channel: [NOTIFICATION_CHANNEL.IN_APP],
      actionUrl,
      actionType: 'VIEW',
    });
  }

  /**
   * Example 15: Complex Query Parameters
   */
  async example15_complexQueryParams(taskId: string, userId: string) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
      {
        action: 'edit',
        section: 'details',
        field: 'description',
        highlight: 'true',
        returnTo: '/dashboard',
        source: 'notification',
      },
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Task Description Required',
      body: 'Please add a description to this task',
      type: 'TASK_UPDATE_REQUIRED',
      importance: NOTIFICATION_IMPORTANCE.NORMAL,
      channel: [NOTIFICATION_CHANNEL.IN_APP],
      actionUrl,
      actionType: 'EDIT_TASK',
    });
  }
}

/**
 * Usage in your actual services:
 *
 * 1. Inject both NotificationService and DeepLinkService
 * 2. Generate deep links using DeepLinkService methods
 * 3. Store the generated actionUrl in your notification
 * 4. Client applications parse the actionUrl and use the appropriate platform link
 *
 * Environment Configuration Required:
 * - WEB_APP_URL: Your web application base URL
 * - MOBILE_APP_SCHEME: Your mobile app's custom URL scheme
 * - UNIVERSAL_LINK_DOMAIN: Domain for universal links (optional, defaults to WEB_APP_URL)
 */
