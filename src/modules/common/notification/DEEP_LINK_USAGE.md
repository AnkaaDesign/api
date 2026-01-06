# Deep Link Service - Usage Guide

## Overview

The Deep Link Service provides functionality to generate platform-specific URLs for navigating to specific entities in your application. It supports both web URLs and mobile deep links (custom scheme and universal links).

## Features

- Generate deep links for multiple entity types (Task, Order, Item, ServiceOrder, User)
- Support for both web and mobile platforms
- Universal links for seamless mobile app opening
- Query parameter support for specific actions
- URL encoding for safe parameter handling
- Integration with notification system

## Configuration

Set the following environment variables in your `.env` file:

```env
# Web application base URL
WEB_APP_URL=https://yourapp.com

# Mobile app custom scheme (without ://)
MOBILE_APP_SCHEME=yourapp

# Universal link domain (defaults to WEB_APP_URL if not set)
UNIVERSAL_LINK_DOMAIN=https://yourapp.com
```

## Entity Types and Routes

The service supports the following entity types with predefined routes:

| Entity Type | Web Route | Mobile Route |
|------------|-----------|--------------|
| Task | `/production/tasks/details/` | `production/tasks/` |
| Order | `/inventory/orders/details/` | `inventory/orders/` |
| Item | `/inventory/products/details/` | `inventory/items/` |
| ServiceOrder | `/production/service-orders/details/` | `production/service-orders/` |
| User | `/administration/collaborators/details/` | `profile/` |

## Basic Usage

### 1. Inject the Service

```typescript
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';

@Injectable()
export class YourService {
  constructor(private readonly deepLinkService: DeepLinkService) {}
}
```

### 2. Generate Links for a Single Platform

```typescript
// Generate web link
const webLink = this.deepLinkService.generateTaskLink('task-id-123', 'web');
// Result: https://yourapp.com/production/tasks/details/task-id-123

// Generate mobile link
const mobileLink = this.deepLinkService.generateTaskLink('task-id-123', 'mobile');
// Result: yourapp://production/tasks/task-id-123
```

### 3. Generate Links for Both Platforms

```typescript
const links = this.deepLinkService.generateTaskLinks('task-id-123');
// Result:
// {
//   web: 'https://yourapp.com/production/tasks/details/task-id-123',
//   mobile: 'yourapp://production/tasks/task-id-123',
//   universalLink: 'https://yourapp.com/app/production/tasks/task-id-123'
// }
```

### 4. Add Query Parameters

```typescript
const links = this.deepLinkService.generateTaskLinks('task-id-123', {
  action: 'approve',
  source: 'email'
});
// Result:
// {
//   web: 'https://yourapp.com/production/tasks/details/task-id-123?action=approve&source=email',
//   mobile: 'yourapp://production/tasks/task-id-123?action=approve&source=email',
//   universalLink: 'https://yourapp.com/app/production/tasks/task-id-123?action=approve&source=email'
// }
```

## Integration with Notifications

### 1. Generate Action URL for Notification

```typescript
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';

@Injectable()
export class NotificationCreationService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  async createTaskNotification(taskId: string, userId: string) {
    // Generate action URL with both web and mobile links
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
      { action: 'view' }
    );

    // Create notification
    await this.notificationService.createNotification({
      userId,
      title: 'New Task Assigned',
      body: 'You have been assigned a new task',
      type: 'TASK_ASSIGNMENT',
      importance: 'MEDIUM',
      channel: ['IN_APP', 'EMAIL', 'PUSH'],
      actionUrl, // Store as JSON string
      actionType: 'VIEW_TASK',
    });
  }
}
```

### 2. Parse Action URL in Client

The `actionUrl` is stored as a JSON string containing both web and mobile URLs:

```json
{
  "web": "https://yourapp.com/production/tasks/details/task-id-123?action=view",
  "mobile": "yourapp://production/tasks/task-id-123?action=view",
  "universalLink": "https://yourapp.com/app/production/tasks/task-id-123?action=view"
}
```

Client applications can parse this and use the appropriate URL:

```typescript
// In your client application
const notification = await fetchNotification(notificationId);
const actionUrls = JSON.parse(notification.actionUrl);

// Use the appropriate URL based on platform
const url = isMobile ? actionUrls.mobile : actionUrls.web;

// Or use universal link for mobile (preferred for iOS/Android)
const url = isMobile ? actionUrls.universalLink : actionUrls.web;
```

## API Endpoints

The Deep Link Controller provides testing endpoints:

### 1. Get Task Links
```http
GET /deep-links/task/:id?action=approve&source=email
```

### 2. Get Order Links
```http
GET /deep-links/order/:id?action=view
```

### 3. Get Item Links
```http
GET /deep-links/item/:id
```

### 4. Get Service Order Links
```http
GET /deep-links/service-order/:id
```

### 5. Get User Links
```http
GET /deep-links/user/:id
```

### 6. Test Link Generation
```http
POST /deep-links/test
Content-Type: application/json

{
  "entityType": "Task",
  "entityId": "123e4567-e89b-12d3-a456-426614174000",
  "queryParams": {
    "action": "approve",
    "source": "email"
  }
}
```

### 7. Generate Notification Action URL
```http
POST /deep-links/notification-action-url
Content-Type: application/json

{
  "entityType": "Order",
  "entityId": "order-123",
  "queryParams": {
    "action": "view"
  }
}
```

### 8. Validate Deep Link
```http
POST /deep-links/validate
Content-Type: application/json

{
  "url": "https://yourapp.com/production/tasks/details/123"
}
```

### 9. Get Available Entity Types
```http
GET /deep-links/entity-types
```

## Universal Links

Universal links provide a seamless experience on mobile devices:

- If the app is installed, it opens directly in the app
- If the app is not installed, it falls back to the web browser
- Uses HTTPS URLs instead of custom schemes

### iOS Configuration

Add to your `apple-app-site-association` file:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.BUNDLE_ID",
        "paths": ["/app/*"]
      }
    ]
  }
}
```

### Android Configuration

Add to your `AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https"
        android:host="yourapp.com"
        android:pathPrefix="/app/" />
</intent-filter>
```

## Complete Example: Task Assignment Notification

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';
import { NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE } from '../../../constants';

@Injectable()
export class TaskNotificationService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  /**
   * Send a task assignment notification with deep links
   */
  async sendTaskAssignmentNotification(taskId: string, userId: string, taskTitle: string) {
    // Generate action URL with query parameter for automatic action
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
      {
        action: 'view',
        source: 'notification'
      }
    );

    // Create the notification
    await this.notificationService.createNotification({
      userId,
      title: 'New Task Assigned',
      body: `You have been assigned to: ${taskTitle}`,
      type: 'TASK_ASSIGNMENT',
      importance: NOTIFICATION_IMPORTANCE.HIGH,
      channel: [
        NOTIFICATION_CHANNEL.IN_APP,
        NOTIFICATION_CHANNEL.EMAIL,
        NOTIFICATION_CHANNEL.PUSH,
      ],
      actionUrl,
      actionType: 'VIEW_TASK',
    });
  }

  /**
   * Send a task approval request notification
   */
  async sendTaskApprovalRequest(taskId: string, userId: string, taskTitle: string) {
    // Use 'approve' action to potentially open approval dialog directly
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
      {
        action: 'approve',
        source: 'notification'
      }
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Task Approval Required',
      body: `Please review and approve: ${taskTitle}`,
      type: 'APPROVAL_REQUEST',
      importance: NOTIFICATION_IMPORTANCE.HIGH,
      channel: [
        NOTIFICATION_CHANNEL.IN_APP,
        NOTIFICATION_CHANNEL.EMAIL,
        NOTIFICATION_CHANNEL.PUSH,
      ],
      actionUrl,
      actionType: 'APPROVE_TASK',
    });
  }

  /**
   * Send an order status update notification
   */
  async sendOrderStatusUpdate(orderId: string, userId: string, newStatus: string) {
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Order,
      orderId,
      {
        action: 'view',
        highlight: 'status'
      }
    );

    await this.notificationService.createNotification({
      userId,
      title: 'Order Status Updated',
      body: `Order status changed to: ${newStatus}`,
      type: 'ORDER_UPDATE',
      importance: NOTIFICATION_IMPORTANCE.MEDIUM,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      actionUrl,
      actionType: 'VIEW_ORDER',
    });
  }
}
```

## Best Practices

1. **Always use query parameters for specific actions**: Include `action`, `source`, or other parameters to enable context-aware behavior in your app.

2. **Store the full JSON in notifications**: Store the complete deep link result (web, mobile, universalLink) to support all client types.

3. **Use universal links for mobile**: Universal links provide better user experience than custom schemes.

4. **URL encoding is automatic**: The service handles URL encoding, so pass parameters as plain text.

5. **Validate IDs**: Always validate entity IDs before generating deep links.

6. **Log deep link generation**: For analytics and debugging, log when deep links are generated and used.

7. **Handle link expiration**: Consider adding expiration timestamps to query parameters for time-sensitive actions.

## Error Handling

```typescript
try {
  const links = this.deepLinkService.generateTaskLinks(taskId);
} catch (error) {
  // Handle errors like invalid entity ID or configuration issues
  this.logger.error('Failed to generate deep links', error);
}
```

## Testing

Use the test endpoints to verify your deep link configuration:

```bash
# Test task link generation
curl -X POST http://localhost:3000/deep-links/test \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "Task",
    "entityId": "test-task-123",
    "queryParams": {
      "action": "approve"
    }
  }'

# Validate a deep link
curl -X POST http://localhost:3000/deep-links/validate \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourapp.com/production/tasks/details/test-task-123"
  }'
```

## Migration Guide

If you have existing notifications without deep links, you can migrate them:

```typescript
async migrateExistingNotifications() {
  const notifications = await this.notificationService.getNotifications({
    where: { actionUrl: null }
  });

  for (const notification of notifications.data) {
    // Parse notification type to determine entity
    const entityType = this.determineEntityType(notification.type);
    const entityId = this.extractEntityId(notification);

    if (entityType && entityId) {
      const actionUrl = this.deepLinkService.generateNotificationActionUrl(
        entityType,
        entityId
      );

      await this.notificationService.updateNotification(notification.id, {
        actionUrl
      });
    }
  }
}
```
