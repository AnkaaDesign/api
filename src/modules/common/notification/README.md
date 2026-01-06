# Notification System

Comprehensive multi-channel notification system supporting Email, SMS, Push, and In-App notifications with advanced features including user preferences, delivery tracking, aggregation, reminders, and deep linking.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Notification Types](#notification-types)
- [Notification Channels](#notification-channels)
- [API Endpoints](#api-endpoints)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [Testing](#testing)

---

## Features

### Core Features
- Multi-channel delivery (Email, SMS, Push, In-App)
- User notification preferences per type
- Role-based filtering (sector/privilege-based)
- Mandatory vs optional notifications
- Real-time delivery via Socket.io
- Scheduled notifications
- Batch operations support

### Advanced Features
- Delivery tracking (sent, delivered, failed, seen)
- Remind later functionality with scheduler
- Notification aggregation/batching
- Deep linking to relevant app pages
- Retry logic with exponential backoff
- Template system for consistent messaging
- Comprehensive admin analytics dashboard
- Export capabilities (CSV/JSON)

### Tracking & Analytics
- Delivery status tracking per channel
- Seen/read status tracking
- User engagement metrics
- Channel performance analytics
- Failure reason analysis
- Time-series reporting

---

## Architecture

```
User Action / Event
        |
        v
  Event Emitter
        |
        v
  Event Listener
        |
        v
Notification Service
        |
        +------------------------+
        |                        |
        v                        v
Preference Check         Filter Service
        |                   (Role-based)
        v                        |
        |<-----------------------+
        v
 Aggregation Service
 (Optional batching)
        |
        v
Notification Dispatch
        |
        +------+------+------+
        |      |      |      |
        v      v      v      v
     Queue  Socket  DB   Template
     (Async) (Real) Store Service
        |      |
        v      v
   +----+------+----+
   |    |      |    |
   v    v      v    v
Email SMS   Push  WhatsApp
        |
        v
Delivery Tracking
        |
        v
    Database
```

### Key Components

1. **NotificationService**: Core service for CRUD operations
2. **NotificationDispatchService**: Handles multi-channel dispatch
3. **NotificationQueueService**: Manages background job queues
4. **NotificationQueueProcessor**: Processes queued notification jobs
5. **NotificationGatewayService**: Real-time WebSocket notifications
6. **NotificationPreferenceService**: User preference management
7. **NotificationFilterService**: Role and sector-based filtering
8. **NotificationAggregationService**: Batches similar notifications
9. **NotificationReminderScheduler**: Handles reminder scheduling
10. **DeepLinkService**: Generates deep links for notifications
11. **EmailTemplateService**: Email template rendering

---

## Notification Types

### System Notifications
- **Type**: `SYSTEM`
- **Description**: Critical system-wide announcements
- **Importance**: HIGH/URGENT
- **Mandatory**: Yes
- **Default Channels**: IN_APP, PUSH

### Task Notifications
- **Type**: `TASK`
- **Events**:
  - Task created
  - Task status changed
  - Task field updated
  - Task deadline approaching
  - Task overdue
  - Task assigned
- **Importance**: HIGH (for assignments), NORMAL (for updates)
- **Mandatory**: Yes
- **Default Channels**: IN_APP, EMAIL, PUSH

### Order Notifications
- **Type**: `ORDER`
- **Events**:
  - Order created
  - Order status changed
  - Order overdue
  - Order received
  - Order cancelled
- **Importance**: NORMAL
- **Mandatory**: No (user configurable)
- **Default Channels**: IN_APP, EMAIL

### Stock Notifications
- **Type**: `STOCK`
- **Events**:
  - Low stock alert
  - Out of stock
  - Reorder required
  - Stock replenished
- **Importance**: HIGH (out of stock), NORMAL (low stock)
- **Mandatory**: No
- **Default Channels**: IN_APP

### PPE (Personal Protective Equipment) Notifications
- **Type**: `PPE`
- **Events**:
  - PPE assignment
  - PPE return reminder
  - PPE expiration warning
- **Importance**: HIGH
- **Mandatory**: Yes
- **Default Channels**: IN_APP, PUSH, EMAIL

### Vacation Notifications
- **Type**: `VACATION`
- **Events**:
  - Vacation request submitted
  - Vacation approved/rejected
  - Vacation reminder
- **Importance**: NORMAL
- **Mandatory**: No
- **Default Channels**: IN_APP, EMAIL

### Warning Notifications
- **Type**: `WARNING`
- **Events**:
  - Compliance warning
  - Safety warning
  - Policy violation
- **Importance**: URGENT
- **Mandatory**: Yes
- **Default Channels**: IN_APP, PUSH, EMAIL, SMS

### General Notifications
- **Type**: `GENERAL`
- **Description**: Miscellaneous notifications
- **Importance**: LOW/NORMAL
- **Mandatory**: No
- **Default Channels**: IN_APP

---

## Notification Channels

### IN_APP
- Real-time WebSocket delivery
- Persistent in database
- Supports seen tracking
- Supports reminders
- Always available

### EMAIL
- Asynchronous delivery via queue
- HTML templates support
- Supports attachments
- Delivery tracking
- Retry on failure

### SMS
- Asynchronous delivery via queue
- Limited to 160 characters (extended SMS supported)
- High delivery priority
- Cost-based (track usage)
- Delivery confirmation

### PUSH
- Mobile and desktop push notifications
- Requires device tokens
- Real-time delivery
- Click-through tracking
- Deep linking support

---

## API Endpoints

### User Endpoints

#### Notifications

**GET /notifications**
- Get user's notifications with filtering
- Query Parameters:
  - `type`: Filter by notification type
  - `seen`: Filter by seen status (boolean)
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 20)
- Response: Paginated list of notifications

**GET /notifications/:id**
- Get specific notification by ID
- Parameters:
  - `id`: Notification UUID
- Response: Notification details

**POST /notifications**
- Create a new notification
- Body: Notification data
- Response: Created notification

**PUT /notifications/:id**
- Update notification
- Parameters:
  - `id`: Notification UUID
- Body: Update data
- Response: Updated notification

**DELETE /notifications/:id**
- Delete notification
- Parameters:
  - `id`: Notification UUID
- Response: Success message

**POST /notifications/batch**
- Batch create notifications
- Body: Array of notification data
- Response: Created notifications

#### Seen Notifications

**POST /notifications/:id/seen**
- Mark notification as seen
- Parameters:
  - `id`: Notification UUID
- Response: Seen notification record

**POST /notifications/:id/remind**
- Set reminder for notification
- Parameters:
  - `id`: Notification UUID
- Body: `{ remindAt: ISO date string }`
- Response: Reminder confirmation

**GET /notifications/:id/delivery-status**
- Get delivery status across all channels
- Parameters:
  - `id`: Notification UUID
- Response: Delivery status per channel

**GET /users/:userId/notifications/unseen**
- Get unseen notifications for user
- Parameters:
  - `userId`: User UUID
- Response: Array of unseen notifications

**GET /users/:userId/notifications/unseen-count**
- Get count of unseen notifications
- Parameters:
  - `userId`: User UUID
- Response: `{ count: number }`

#### User Preferences

**GET /users/:userId/notification-preferences**
- Get all notification preferences for user
- Parameters:
  - `userId`: User UUID
- Response: Array of preferences

**PUT /users/:userId/notification-preferences/:type**
- Update notification preference
- Parameters:
  - `userId`: User UUID
  - `type`: Notification type
- Body:
  ```json
  {
    "channels": ["EMAIL", "IN_APP"],
    "eventType": "TASK_CREATED"
  }
  ```
- Response: Updated preference

**POST /users/:userId/notification-preferences/reset**
- Reset preferences to defaults
- Parameters:
  - `userId`: User UUID
- Body: `{ confirm: true }`
- Response: Success message

**GET /notification-preferences/defaults**
- Get default notification preferences (public)
- Response: Default preferences for all types

#### Aggregation

**GET /notifications/aggregation/preferences**
- Get user's aggregation preferences
- Response: Aggregation settings

**PUT /notifications/aggregation/preferences**
- Update aggregation preferences
- Body: Aggregation settings
- Response: Updated preferences

**GET /notifications/aggregation/pending**
- Get pending aggregated notifications
- Response: Pending aggregations

**POST /notifications/aggregation/flush**
- Manually flush user's aggregations
- Response: Success message

---

### Admin Endpoints

#### Notification Management

**GET /admin/notifications**
- List all notifications with advanced filtering
- Query Parameters:
  - `type`: NOTIFICATION_TYPE enum
  - `channel`: NOTIFICATION_CHANNEL enum
  - `status`: sent | scheduled | pending
  - `deliveryStatus`: delivered | failed | pending
  - `userId`: Filter by user
  - `sectorId`: Filter by sector
  - `dateFrom`: ISO date string
  - `dateTo`: ISO date string
  - `page`: Page number
  - `limit`: Items per page
  - `orderBy`: Field to sort by
  - `order`: asc | desc
- Response: Paginated notifications with metadata

**GET /admin/notifications/:id**
- Get detailed notification information
- Parameters:
  - `id`: Notification UUID
- Response: Notification with deliveries, seen status, metrics

**GET /admin/notifications/stats/overview**
- Get comprehensive notification statistics
- Query Parameters:
  - `dateFrom`: ISO date string (optional)
  - `dateTo`: ISO date string (optional)
- Response:
  ```json
  {
    "total": 1234,
    "byType": { "TASK": 500, "ORDER": 300, ... },
    "byChannel": { "EMAIL": 800, "SMS": 200, ... },
    "deliveryRate": {
      "email": { "sent": 800, "delivered": 750, "failed": 50 },
      "sms": { "sent": 200, "delivered": 195, "failed": 5 },
      ...
    },
    "seenRate": 75.5,
    "averageDeliveryTime": 2500,
    "failureReasons": { "Invalid email": 30, ... }
  }
  ```

**GET /admin/notifications/reports/delivery**
- Get comprehensive delivery report
- Query Parameters:
  - `dateFrom`: ISO date string (optional)
  - `dateTo`: ISO date string (optional)
  - `groupBy`: day | hour (default: day)
- Response:
  ```json
  {
    "timeSeries": [
      { "date": "2026-01-01", "sent": 100, "delivered": 95, "failed": 5 }
    ],
    "channelPerformance": [
      { "channel": "EMAIL", "sent": 500, "delivered": 475, "failed": 25, "successRate": 95 }
    ],
    "topFailureReasons": [
      { "reason": "Invalid email", "count": 30, "percentage": 60 }
    ],
    "userEngagement": {
      "totalSent": 1000,
      "totalSeen": 750,
      "seenRate": 75,
      "averageSeenTime": 45.5
    }
  }
  ```

**GET /admin/notifications/user/:userId**
- Get notification history for specific user
- Parameters:
  - `userId`: User UUID
- Response: User's notifications, preferences, and stats

**POST /admin/notifications/resend/:id**
- Resend failed notification
- Parameters:
  - `id`: Notification UUID
- Response: Resend results per channel

**GET /admin/notifications/export/csv**
- Export notifications to CSV or JSON
- Query Parameters: Same as list endpoint
  - `format`: csv | json (default: csv)
- Response: CSV file or JSON array

**POST /admin/notifications/aggregation/flush-all**
- Flush all pending aggregations (admin only)
- Response: Success message

**POST /admin/notifications/aggregation/clear-all**
- Clear all aggregations (maintenance)
- Response: Success message

---

### Deep Link Endpoints

**GET /deep-links/task/:id**
- Get deep links for task
- Parameters:
  - `id`: Task UUID
- Query Parameters:
  - `action`: Optional action (e.g., approve, reject)
  - `source`: Optional source (e.g., email, push)
- Response: Web, mobile, and universal links

**GET /deep-links/order/:id**
- Get deep links for order
- Similar structure to task endpoint

**GET /deep-links/item/:id**
- Get deep links for item

**GET /deep-links/service-order/:id**
- Get deep links for service order

**GET /deep-links/user/:id**
- Get deep links for user profile

**POST /deep-links/test**
- Test deep link generation
- Body:
  ```json
  {
    "entityType": "Task",
    "entityId": "uuid",
    "queryParams": { "action": "approve", "source": "email" }
  }
  ```
- Response: Generated links

**POST /deep-links/validate**
- Validate a deep link URL
- Body: `{ "url": "https://..." }`
- Response: Validation result

**GET /deep-links/entity-types**
- Get available entity types
- Response: Array of entity types

**POST /deep-links/notification-action-url**
- Generate notification action URL (JSON format)
- Body: Entity type, ID, and query params
- Response: JSON string with web and mobile URLs

---

## Usage Examples

### Creating a Notification

```typescript
import { NotificationService } from './notification.service';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE } from '@constants';

// In your service
constructor(private readonly notificationService: NotificationService) {}

async notifyTaskAssignment(taskId: string, assignedUserId: string) {
  const notification = await this.notificationService.createNotification({
    userId: assignedUserId,
    type: NOTIFICATION_TYPE.TASK,
    title: 'New Task Assigned',
    body: 'You have been assigned a new task',
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    channel: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.EMAIL,
      NOTIFICATION_CHANNEL.PUSH
    ],
    actionUrl: JSON.stringify({
      web: `https://app.example.com/tasks/${taskId}`,
      mobile: `myapp://tasks/${taskId}`
    }),
    metadata: {
      taskId,
      eventType: 'TASK_ASSIGNED'
    }
  }, undefined, 'system');

  return notification;
}
```

### Using the Notification Queue

```typescript
import { NotificationQueueService } from './notification-queue.service';

constructor(private readonly queueService: NotificationQueueService) {}

async sendEmailNotification(notificationId: string, userEmail: string) {
  await this.queueService.addEmailJob(
    notificationId,
    userEmail,
    'Task Update',
    'Your task status has changed',
    {
      actionUrl: 'https://app.example.com/tasks/123',
      priority: 'high'
    }
  );
}
```

### Emitting Events for Notifications

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

constructor(private readonly eventEmitter: EventEmitter2) {}

async updateTaskStatus(taskId: string, newStatus: string) {
  // Update task in database
  const task = await this.updateTask(taskId, { status: newStatus });

  // Emit event for notification system
  this.eventEmitter.emit('task.status.changed', {
    taskId: task.id,
    userId: task.assignedUserId,
    oldStatus: task.previousStatus,
    newStatus: task.status,
    taskTitle: task.title
  });

  return task;
}
```

### Checking User Preferences

```typescript
import { NotificationPreferenceService } from './notification-preference.service';

constructor(
  private readonly preferenceService: NotificationPreferenceService
) {}

async shouldNotifyUser(
  userId: string,
  notificationType: NOTIFICATION_TYPE,
  eventType: string
): Promise<boolean> {
  const preference = await this.preferenceService.getPreferenceForType(
    userId,
    notificationType,
    eventType
  );

  return preference?.enabled ?? true; // Default to true if no preference
}
```

### Using Deep Links

```typescript
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';

constructor(private readonly deepLinkService: DeepLinkService) {}

async createTaskNotificationWithDeepLink(taskId: string, userId: string) {
  // Generate deep links
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    action: 'view',
    source: 'notification'
  });

  // Create notification with action URL
  await this.notificationService.createNotification({
    userId,
    type: NOTIFICATION_TYPE.TASK,
    title: 'Task Update',
    body: 'Your task has been updated',
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    actionUrl: JSON.stringify({
      web: links.webUrl,
      mobile: links.mobileUrl
    })
  }, undefined, 'system');
}
```

### Aggregating Notifications

```typescript
import { NotificationAggregationService } from './notification-aggregation.service';

constructor(
  private readonly aggregationService: NotificationAggregationService
) {}

// Configure user aggregation preferences
async updateUserAggregation(userId: string) {
  await this.aggregationService.updateUserPreference(userId, {
    enabled: true,
    types: [NOTIFICATION_TYPE.TASK, NOTIFICATION_TYPE.ORDER],
    timeWindowMinutes: 30,
    maxNotifications: 10
  });
}

// Manually flush aggregations
async flushUserNotifications(userId: string) {
  await this.aggregationService.flushUserAggregations(userId);
}
```

### Setting Reminders

```typescript
import { NotificationReminderScheduler } from './notification-reminder.scheduler';

constructor(
  private readonly reminderScheduler: NotificationReminderScheduler
) {}

async setNotificationReminder(notificationId: string, userId: string) {
  const remindAt = new Date();
  remindAt.setHours(remindAt.getHours() + 2); // Remind in 2 hours

  await this.notificationService.setReminder(
    notificationId,
    userId,
    remindAt
  );
}
```

---

## Configuration

### Environment Variables

```env
# Email Configuration
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=notifications@example.com
EMAIL_PASSWORD=your_password
EMAIL_FROM=noreply@example.com

# SMS Configuration (Twilio example)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Redis (for queues)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# WebSocket
SOCKET_IO_PORT=3001
SOCKET_IO_CORS_ORIGIN=http://localhost:3000

# Deep Links
WEB_APP_URL=https://app.example.com
MOBILE_APP_SCHEME=myapp
MOBILE_APP_HOST=app.example.com

# Notification Settings
NOTIFICATION_RETRY_ATTEMPTS=3
NOTIFICATION_RETRY_DELAY=5000
NOTIFICATION_AGGREGATION_WINDOW=30
NOTIFICATION_MAX_AGGREGATION=10
```

### Module Configuration

```typescript
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [
    NotificationModule.register({
      email: {
        enabled: true,
        retryAttempts: 3,
        retryDelay: 5000
      },
      sms: {
        enabled: true,
        provider: 'twilio'
      },
      push: {
        enabled: true,
        providers: ['fcm', 'apns']
      },
      aggregation: {
        enabled: true,
        defaultWindow: 30,
        maxNotifications: 10
      },
      deepLinks: {
        webBaseUrl: 'https://app.example.com',
        mobileScheme: 'myapp'
      }
    })
  ]
})
export class AppModule {}
```

---

## Testing

### Unit Tests

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: PrismaService,
          useValue: {
            notification: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn()
            }
          }
        }
      ]
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create a notification', async () => {
    const mockNotification = {
      id: 'uuid',
      userId: 'user-uuid',
      type: 'TASK',
      title: 'Test',
      body: 'Test body',
      channel: ['IN_APP'],
      importance: 'NORMAL',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotification);

    const result = await service.createNotification({
      userId: 'user-uuid',
      type: 'TASK',
      title: 'Test',
      body: 'Test body',
      channel: ['IN_APP'],
      importance: 'NORMAL'
    }, undefined, 'system');

    expect(result).toEqual(mockNotification);
  });
});
```

### Integration Tests

```typescript
describe('Notification Flow (e2e)', () => {
  it('should create notification and deliver via multiple channels', async () => {
    // Create notification
    const response = await request(app.getHttpServer())
      .post('/notifications')
      .send({
        userId: testUser.id,
        type: 'TASK',
        title: 'Test Notification',
        body: 'This is a test',
        channel: ['IN_APP', 'EMAIL'],
        importance: 'NORMAL'
      })
      .expect(201);

    const notificationId = response.body.data.id;

    // Wait for delivery
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check delivery status
    const deliveryResponse = await request(app.getHttpServer())
      .get(`/notifications/${notificationId}/delivery-status`)
      .expect(200);

    expect(deliveryResponse.body.data).toHaveLength(2);
    expect(deliveryResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'IN_APP', status: 'DELIVERED' }),
        expect.objectContaining({ channel: 'EMAIL', status: 'DELIVERED' })
      ])
    );
  });
});
```

### Testing Aggregation

```typescript
import { aggregationTestUtils } from './tests/aggregation.test-utils';

describe('Notification Aggregation', () => {
  it('should aggregate multiple notifications', async () => {
    const userId = 'test-user-id';

    // Enable aggregation for user
    await aggregationService.updateUserPreference(userId, {
      enabled: true,
      types: ['TASK'],
      timeWindowMinutes: 5,
      maxNotifications: 3
    });

    // Create multiple notifications
    await aggregationTestUtils.createMultipleNotifications(userId, 3);

    // Check pending aggregations
    const pending = await aggregationService.getAggregatedNotifications(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].count).toBe(3);

    // Flush aggregations
    await aggregationService.flushUserAggregations(userId);

    // Verify aggregation was sent
    const notifications = await notificationService.getUserNotifications(userId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toContain('3 notifications');
  });
});
```

---

## Performance Considerations

### Optimization Tips

1. **Use Batch Operations**: When creating multiple notifications, use batch endpoints
2. **Enable Aggregation**: Reduce notification fatigue by aggregating similar notifications
3. **Queue Asynchronous Channels**: Email and SMS should always be queued
4. **Index Database Properly**: Ensure proper indexes on userId, type, createdAt, sentAt
5. **Cache User Preferences**: Cache frequently accessed preferences in Redis
6. **Limit Real-time Connections**: Use Socket.io rooms for targeted delivery
7. **Monitor Queue Health**: Track queue depth and processing times

### Monitoring

```typescript
// Get queue statistics
const queueStats = await notificationQueueService.getQueueStats();
console.log('Queue depth:', queueStats.waiting);
console.log('Processing:', queueStats.active);
console.log('Failed:', queueStats.failed);

// Get delivery metrics
const metrics = await notificationService.getDeliveryMetrics({
  dateFrom: new Date('2026-01-01'),
  dateTo: new Date()
});
console.log('Success rate:', metrics.successRate);
console.log('Average delivery time:', metrics.avgDeliveryTime);
```

---

## Troubleshooting

### Common Issues

**Notifications not being delivered**
- Check user preferences for the notification type
- Verify channel-specific configuration (email server, SMS credentials)
- Check queue processor is running
- Verify user has valid contact information (email/phone)

**WebSocket notifications not working**
- Ensure Socket.io server is running
- Check CORS configuration
- Verify user authentication token
- Check firewall rules for WebSocket connections

**High delivery failure rate**
- Review failure reasons in admin dashboard
- Check external service credentials
- Verify contact information validity
- Review retry configuration

**Performance degradation**
- Check queue depth
- Review database query performance
- Enable aggregation to reduce volume
- Scale queue workers horizontally

---

## Security Considerations

1. **Authentication**: All endpoints require valid JWT token
2. **Authorization**: Users can only access their own notifications (except admins)
3. **Rate Limiting**: Implement rate limiting on notification creation
4. **Input Validation**: All inputs are validated using Zod schemas
5. **SQL Injection**: Using Prisma ORM protects against SQL injection
6. **XSS Prevention**: Sanitize notification content before rendering
7. **Sensitive Data**: Never include sensitive data in notification bodies
8. **Encryption**: Consider encrypting notification content at rest

---

## Future Enhancements

- [ ] WhatsApp channel integration
- [ ] Slack/Teams channel integration
- [ ] A/B testing for notification content
- [ ] Machine learning for optimal delivery timing
- [ ] Rich media support (images, videos)
- [ ] Notification templates with variables
- [ ] Multi-language support
- [ ] User notification digest (daily/weekly summaries)
- [ ] Smart notification grouping
- [ ] Interactive notifications (quick actions)

---

## License

Internal use only. All rights reserved.

---

## Support

For issues, questions, or feature requests, please contact the development team or create an issue in the project repository.
