# Firebase Push Notification Service - Usage Examples

This document provides practical examples of how to use the Firebase Cloud Messaging (FCM) push notification service in your NestJS application.

## Table of Contents

1. [Basic Push Notifications](#basic-push-notifications)
2. [Push with Deep Links](#push-with-deep-links)
3. [Multi-Device Notifications](#multi-device-notifications)
4. [Topic-Based Notifications](#topic-based-notifications)
5. [Integration with Notification System](#integration-with-notification-system)
6. [Advanced Scenarios](#advanced-scenarios)

## Basic Push Notifications

### Example 1: Send Simple Notification

```typescript
import { Injectable } from '@nestjs/common';
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class OrderService {
  constructor(private readonly pushService: PushService) {}

  async notifyOrderStatusChange(orderId: string, userId: string, status: string) {
    // Get user's device tokens
    const devices = await this.pushService.getUserDevices(userId);

    if (devices.length === 0) {
      console.log('User has no registered devices');
      return;
    }

    // Send to first active device
    const activeDevice = devices.find(d => d.isActive);
    if (activeDevice) {
      const result = await this.pushService.sendPushNotification(
        activeDevice.token,
        'Order Status Update',
        `Your order #${orderId} is now ${status}`,
        {
          orderId: orderId,
          status: status,
          timestamp: new Date().toISOString()
        }
      );

      if (result.success) {
        console.log('Notification sent successfully:', result.messageId);
      } else {
        console.error('Failed to send notification:', result.error);
      }
    }
  }
}
```

### Example 2: Send to All User Devices

```typescript
async notifyUserAllDevices(userId: string, title: string, body: string) {
  const result = await this.pushService.sendToUser(
    userId,
    title,
    body,
    {
      type: 'announcement',
      priority: 'high'
    }
  );

  console.log(`Sent to ${result.success} devices, ${result.failure} failed`);

  if (result.failedTokens?.length > 0) {
    console.log('Failed tokens:', result.failedTokens);
  }
}
```

## Push with Deep Links

### Example 3: Task Assignment with Deep Link

```typescript
import { Injectable } from '@nestjs/common';
import { PushService } from '@modules/common/push/push.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly pushService: PushService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  async notifyTaskAssignment(taskId: string, assignedToUserId: string) {
    // Generate deep links for the task
    const deepLinks = this.deepLinkService.generateTaskLinks(taskId, {
      action: 'view',
      source: 'push_notification'
    });

    // Get user's active device tokens
    const tokens = await this.pushService.getUserTokens(assignedToUserId);

    if (tokens.length === 0) {
      console.log('No active devices found for user');
      return;
    }

    // Send to first device with deep links
    const result = await this.pushService.sendToDevice(
      tokens[0],
      {
        title: 'New Task Assigned',
        body: 'You have been assigned a new production task',
        deepLinks: deepLinks,
        data: {
          taskId: taskId,
          type: 'task_assignment',
          action: 'view'
        }
      }
    );

    return result;
  }
}
```

### Example 4: Order Approval with Action URL

```typescript
async requestOrderApproval(orderId: string, approverId: string) {
  // Generate deep links
  const deepLinks = this.deepLinkService.generateOrderLinks(orderId, {
    action: 'approve',
    source: 'approval_request'
  });

  // Send push notification with approval action
  const result = await this.pushService.sendToDevice(
    approverDeviceToken,
    {
      title: 'Order Approval Required',
      body: `Order #${orderId} requires your approval`,
      deepLinks: deepLinks,
      imageUrl: 'https://yourcdn.com/order-icon.png',
      data: {
        orderId: orderId,
        type: 'approval_request',
        action: 'approve',
        requiresResponse: 'true'
      }
    }
  );

  return result;
}
```

## Multi-Device Notifications

### Example 5: Send to Multiple Devices (Multicast)

```typescript
async notifyMultipleUsers(userIds: string[], title: string, body: string) {
  // Collect all device tokens
  const allTokens: string[] = [];

  for (const userId of userIds) {
    const tokens = await this.pushService.getUserTokens(userId);
    allTokens.push(...tokens);
  }

  if (allTokens.length === 0) {
    console.log('No devices found for any user');
    return;
  }

  // Send to all devices at once (efficient batching)
  const result = await this.pushService.sendMulticastNotification(
    allTokens,
    title,
    body,
    {
      type: 'broadcast',
      timestamp: new Date().toISOString()
    }
  );

  console.log(`Multicast result: ${result.success} succeeded, ${result.failure} failed`);

  return result;
}
```

### Example 6: Platform-Specific Notifications

```typescript
async sendPlatformSpecificNotification(userId: string) {
  const devices = await this.pushService.getUserDevices(userId);

  // Group devices by platform
  const iosDevices = devices.filter(d => d.platform === 'IOS' && d.isActive);
  const androidDevices = devices.filter(d => d.platform === 'ANDROID' && d.isActive);
  const webDevices = devices.filter(d => d.platform === 'WEB' && d.isActive);

  // Send iOS-specific notification
  if (iosDevices.length > 0) {
    await this.pushService.sendToDevice(
      iosDevices[0].token,
      {
        title: 'iOS Notification',
        body: 'This notification is optimized for iOS',
        imageUrl: 'https://yourcdn.com/ios-icon.png',
        data: {
          platform: 'ios',
          badge: '1'
        }
      }
    );
  }

  // Send Android-specific notification
  if (androidDevices.length > 0) {
    await this.pushService.sendToDevice(
      androidDevices[0].token,
      {
        title: 'Android Notification',
        body: 'This notification is optimized for Android',
        imageUrl: 'https://yourcdn.com/android-icon.png',
        data: {
          platform: 'android',
          channelId: 'updates'
        }
      }
    );
  }

  // Send Web notification
  if (webDevices.length > 0) {
    await this.pushService.sendToDevice(
      webDevices[0].token,
      {
        title: 'Web Notification',
        body: 'This notification is for your browser',
        data: {
          platform: 'web'
        }
      }
    );
  }
}
```

## Topic-Based Notifications

### Example 7: Subscribe to Topics

```typescript
async subscribeToProductionUpdates(userId: string) {
  const tokens = await this.pushService.getUserTokens(userId);

  if (tokens.length === 0) {
    throw new Error('No active devices found');
  }

  // Subscribe all user devices to production topic
  const success = await this.pushService.subscribeToTopic(
    tokens,
    'production-updates'
  );

  if (success) {
    console.log('User subscribed to production updates');
  }

  return success;
}
```

### Example 8: Send to Topic Subscribers

```typescript
async notifyAllProductionTeam(message: string) {
  const result = await this.pushService.sendToTopic(
    'production-updates',
    {
      title: 'Production Update',
      body: message,
      data: {
        type: 'team_broadcast',
        topic: 'production-updates',
        timestamp: new Date().toISOString()
      }
    }
  );

  return result;
}
```

### Example 9: Unsubscribe from Topics

```typescript
async unsubscribeFromProductionUpdates(userId: string) {
  const tokens = await this.pushService.getUserTokens(userId);

  if (tokens.length === 0) {
    console.log('No active devices found');
    return;
  }

  // Unsubscribe all user devices from production topic
  const success = await this.pushService.unsubscribeFromTopic(
    tokens,
    'production-updates'
  );

  return success;
}
```

## Integration with Notification System

### Example 10: Queue-Based Push Notification Processing

```typescript
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { PushService } from '@modules/common/push/push.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';

@Processor('notifications')
export class NotificationQueueProcessor {
  constructor(
    private readonly pushService: PushService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  @Process('send-push')
  async handlePushNotification(job: Job) {
    const { notificationId, userId, title, body, actionUrl, data } = job.data;

    try {
      // Parse deep links from notification
      const deepLinks = this.deepLinkService.parseNotificationActionUrl(actionUrl);

      // Get user's device tokens
      const tokens = await this.pushService.getUserTokens(userId);

      if (tokens.length === 0) {
        console.log(`No active devices for user ${userId}`);
        return { success: false, reason: 'no_devices' };
      }

      // Send to all devices
      const results = await Promise.all(
        tokens.map(token =>
          this.pushService.sendToDevice(
            token,
            {
              title,
              body,
              deepLinks,
              data
            },
            notificationId
          )
        )
      );

      const successCount = results.filter(r => r.success).length;

      return {
        success: successCount > 0,
        successCount,
        totalDevices: tokens.length
      };
    } catch (error) {
      console.error('Error processing push notification:', error);
      throw error;
    }
  }
}
```

### Example 11: Notification Dispatch Integration

```typescript
import { Injectable } from '@nestjs/common';
import { PushService } from '@modules/common/push/push.service';
import { DeepLinkService, DeepLinkEntity } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';

@Injectable()
export class NotificationDispatchHelper {
  constructor(
    private readonly pushService: PushService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
  ) {}

  async dispatchPushNotification(notificationId: string) {
    // Load notification from database
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: true }
    });

    if (!notification || !notification.userId) {
      throw new Error('Notification or user not found');
    }

    // Parse action URL for deep links
    const deepLinks = this.deepLinkService.parseNotificationActionUrl(
      notification.actionUrl
    );

    // Get user's active device tokens
    const tokens = await this.pushService.getUserTokens(notification.userId);

    if (tokens.length === 0) {
      console.log('No active devices found');
      return { success: false, reason: 'no_devices' };
    }

    // Send to all devices and track delivery
    const results = await Promise.all(
      tokens.map(token =>
        this.pushService.sendToDevice(
          token,
          {
            title: notification.title,
            body: notification.body,
            deepLinks,
            data: notification.metadata as any || {}
          },
          notificationId
        )
      )
    );

    // Update notification as sent
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { sentAt: new Date() }
    });

    return {
      success: results.some(r => r.success),
      results
    };
  }
}
```

## Advanced Scenarios

### Example 12: Retry Failed Notifications

```typescript
async retryFailedNotifications(notificationId: string) {
  // Get failed deliveries
  const failedDeliveries = await this.prisma.notificationDelivery.findMany({
    where: {
      notificationId,
      status: 'FAILED',
      channel: {
        in: ['MOBILE_PUSH', 'DESKTOP_PUSH']
      }
    }
  });

  const results = [];

  for (const delivery of failedDeliveries) {
    // Extract token from metadata
    const token = (delivery.metadata as any)?.token;

    if (!token) continue;

    // Retry sending
    const result = await this.pushService.sendToDevice(
      token,
      {
        title: 'Notification Retry',
        body: 'This notification was retried',
        data: { retryAttempt: 'true' }
      },
      notificationId
    );

    results.push(result);
  }

  return results;
}
```

### Example 13: Conditional Push Based on User Preferences

```typescript
async sendConditionalPush(
  userId: string,
  notificationType: string,
  payload: any
) {
  // Check user notification preferences
  const preference = await this.prisma.userNotificationPreference.findFirst({
    where: {
      userId,
      notificationType: notificationType as any,
      enabled: true,
      channels: {
        hasSome: ['MOBILE_PUSH', 'DESKTOP_PUSH']
      }
    }
  });

  if (!preference) {
    console.log('User has disabled push notifications for this type');
    return { success: false, reason: 'user_preference' };
  }

  // User has push enabled, send notification
  const tokens = await this.pushService.getUserTokens(userId);

  if (tokens.length === 0) {
    return { success: false, reason: 'no_devices' };
  }

  const result = await this.pushService.sendToDevice(
    tokens[0],
    payload
  );

  return result;
}
```

### Example 14: Scheduled Push Notifications

```typescript
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class ScheduledNotificationService {
  constructor(private readonly pushService: PushService) {}

  @Cron('0 9 * * 1-5') // Every weekday at 9 AM
  async sendDailyReminder() {
    // Get all users who need daily reminders
    const users = await this.getUsersWithDailyReminders();

    for (const user of users) {
      await this.pushService.sendToUser(
        user.id,
        'Daily Reminder',
        'Don\'t forget to check your tasks for today!',
        {
          type: 'daily_reminder',
          time: new Date().toISOString()
        }
      );
    }
  }

  private async getUsersWithDailyReminders() {
    // Implementation to get users
    return [];
  }
}
```

### Example 15: Rich Push Notifications with Images

```typescript
async sendRichNotification(
  userId: string,
  taskId: string,
  imageUrl: string
) {
  const deepLinks = this.deepLinkService.generateTaskLinks(taskId);

  const result = await this.pushService.sendToDevice(
    userToken,
    {
      title: 'Task Completed',
      body: 'Your task has been completed successfully',
      imageUrl: imageUrl, // Image will be displayed in notification
      deepLinks: deepLinks,
      data: {
        taskId: taskId,
        hasImage: 'true',
        imageUrl: imageUrl
      }
    }
  );

  return result;
}
```

### Example 16: Emergency Broadcast

```typescript
async sendEmergencyBroadcast(message: string) {
  // Get all active users
  const users = await this.prisma.user.findMany({
    where: { isActive: true },
    select: { id: true }
  });

  // Collect all device tokens
  const allTokens: string[] = [];

  for (const user of users) {
    const tokens = await this.pushService.getUserTokens(user.id);
    allTokens.push(...tokens);
  }

  // Send emergency notification to all devices
  const result = await this.pushService.sendMulticastNotification(
    allTokens,
    '🚨 EMERGENCY ALERT',
    message,
    {
      type: 'emergency',
      priority: 'high',
      timestamp: new Date().toISOString()
    }
  );

  console.log(`Emergency broadcast sent to ${result.success} devices`);

  return result;
}
```

## Best Practices

1. **Always Check for Device Tokens**
   ```typescript
   const tokens = await this.pushService.getUserTokens(userId);
   if (tokens.length === 0) {
     // Handle no devices gracefully
     return;
   }
   ```

2. **Use Deep Links for Better UX**
   ```typescript
   const deepLinks = this.deepLinkService.generateTaskLinks(taskId);
   // Include in payload for seamless navigation
   ```

3. **Handle Errors Gracefully**
   ```typescript
   const result = await this.pushService.sendToDevice(...);
   if (!result.success) {
     console.error('Push failed:', result.error);
     // Log, retry, or notify admin
   }
   ```

4. **Track Delivery Status**
   ```typescript
   // Always provide notificationId for tracking
   await this.pushService.sendToDevice(token, payload, notificationId);
   ```

5. **Respect User Preferences**
   ```typescript
   // Check preferences before sending
   const preference = await this.checkUserPreference(userId, type);
   if (!preference.pushEnabled) return;
   ```

## Testing

### Test Notification Sending

```bash
# Register a test device
curl -X POST http://localhost:3000/notifications/device-token \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_TOKEN",
    "platform": "ANDROID"
  }'

# Send test notification (Admin only)
curl -X POST http://localhost:3000/push/test \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_TOKEN",
    "title": "Test",
    "body": "Testing push notifications",
    "data": { "test": "true" }
  }'
```

## Troubleshooting

- **No notifications received**: Check device token is registered and active
- **Expired tokens**: Service automatically deactivates them
- **Deep links not working**: Verify mobile app is configured to handle deep links
- **Platform-specific issues**: Check platform-specific configuration in app

For more information, see:
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [Firebase Setup](./FIREBASE_SETUP.md)
