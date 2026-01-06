# Notification Tracking System - Implementation Details

## Overview

This document provides detailed information about the notification tracking system implementation, including architecture, data flow, and usage examples.

## Architecture

### Components

1. **NotificationService** (Enhanced)
   - Core tracking methods
   - Statistics aggregation
   - Transaction management

2. **NotificationTrackingController**
   - RESTful API endpoints
   - Request validation
   - Authorization checks

3. **NotificationReminderScheduler**
   - Automated reminder processing
   - Cron-based execution
   - Manual trigger support

4. **NotificationDeliveryRepository**
   - Delivery record management
   - Status tracking
   - Statistics queries

## Data Flow

### Mark as Seen Flow

```
User clicks notification
    ↓
POST /notifications/:id/seen
    ↓
NotificationTrackingController.markAsSeen()
    ↓
NotificationService.markAsSeen()
    ↓
Create SeenNotification record
    ↓
Log to ChangeLog
    ↓
Emit WebSocket event
    ↓
Update all user devices
```

### Reminder Flow

```
User sets reminder
    ↓
POST /notifications/:id/remind
    ↓
NotificationService.setReminder()
    ↓
Update SeenNotification.remindAt
    ↓
[Wait until remindAt time]
    ↓
Scheduler runs every 5 minutes
    ↓
Query SeenNotifications with remindAt <= now
    ↓
Re-send notification via WebSocket
    ↓
Clear remindAt field
    ↓
Log reminder action
```

### Delivery Tracking Flow

```
Notification created
    ↓
Dispatch to channels (EMAIL, SMS, PUSH, IN_APP)
    ↓
For each channel:
    ↓
    Create NotificationDelivery record
    ↓
    Mark as PENDING
    ↓
    Send via channel provider
    ↓
    Update status (SENT/DELIVERED/FAILED)
    ↓
    Store timestamp and error (if failed)
```

## Usage Examples

### Frontend Integration

#### Mark Notification as Seen

```typescript
// When user views notification
async function markNotificationAsSeen(notificationId: string) {
  try {
    await api.post(`/notifications/${notificationId}/seen`);
    // Update local state
    updateNotificationCount();
  } catch (error) {
    console.error('Failed to mark as seen:', error);
  }
}
```

#### Set Reminder

```typescript
// When user clicks "Remind me later"
async function setReminder(notificationId: string, remindAt: Date) {
  try {
    await api.post(`/notifications/${notificationId}/remind`, {
      remindAt: remindAt.toISOString(),
    });
    showSuccessMessage('Reminder set successfully');
  } catch (error) {
    console.error('Failed to set reminder:', error);
  }
}
```

#### Get Unseen Count

```typescript
// Display notification badge
async function getUnseenCount(userId: string) {
  try {
    const response = await api.get(`/notifications/users/${userId}/unseen-count`);
    return response.data.count;
  } catch (error) {
    console.error('Failed to get unseen count:', error);
    return 0;
  }
}
```

#### Listen for Real-time Updates

```typescript
// WebSocket integration
socket.on('notification:seen', (data) => {
  const { id, seenAt } = data;
  updateNotificationUI(id, { seen: true, seenAt });
});

socket.on('notification:new', (notification) => {
  if (notification.isReminder) {
    showReminderNotification(notification);
  } else {
    showNewNotification(notification);
  }
});
```

### Backend Integration

#### Mark Notification as Delivered from Email Service

```typescript
import { NotificationService } from '@modules/common/notification/notification.service';
import { NOTIFICATION_CHANNEL } from '@constants';

@Injectable()
export class EmailService {
  constructor(private readonly notificationService: NotificationService) {}

  async sendEmail(notificationId: string, email: string, content: string) {
    try {
      // Send email via provider
      await this.emailProvider.send(email, content);

      // Mark as delivered
      await this.notificationService.markAsDelivered(
        notificationId,
        NOTIFICATION_CHANNEL.EMAIL,
      );
    } catch (error) {
      // Handle delivery failure
      await this.handleDeliveryFailure(notificationId, error);
    }
  }
}
```

#### Get User Statistics for Dashboard

```typescript
@Get('dashboard/notifications')
async getDashboardStats(@Request() req: any) {
  const userId = req.user.id;

  const [stats, unseenCount, reminders] = await Promise.all([
    this.notificationService.getUserNotificationStats(userId),
    this.notificationService.getUnseenCount(userId),
    this.reminderScheduler.getUserReminders(userId),
  ]);

  return {
    success: true,
    data: {
      stats,
      unseenCount,
      pendingReminders: reminders.length,
    },
  };
}
```

#### Create Notification with Delivery Tracking

```typescript
import { NotificationDeliveryRepository } from '@modules/common/notification/repositories/notification-delivery.repository';

@Injectable()
export class NotificationDispatchService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deliveryRepository: NotificationDeliveryRepository,
  ) {}

  async dispatchNotification(notificationId: string) {
    const notification = await this.notificationService.getNotificationById(notificationId);

    // Create delivery records for each channel
    for (const channel of notification.data.channel) {
      await this.deliveryRepository.create({
        notificationId,
        channel,
        status: 'PENDING',
      });
    }

    // Dispatch to each channel
    await this.sendViaChannels(notification.data);
  }
}
```

## Performance Optimization

### Database Queries

1. **Efficient Count Query**
```typescript
// Uses COUNT(*) instead of fetching all records
const count = await this.prisma.notification.count({
  where: {
    userId,
    seenBy: { none: { userId } },
  },
});
```

2. **Parallel Statistics**
```typescript
// Fetch multiple stats in parallel
const [totalReceived, totalSeen, notifications] = await Promise.all([
  this.prisma.notification.count({ where: { userId } }),
  this.prisma.seenNotification.count({ where: { userId } }),
  this.prisma.notification.findMany({ where: { userId }, include: {...} }),
]);
```

3. **Indexed Queries**
```typescript
// Leverages indexes on userId, remindAt, status
const reminders = await this.prisma.seenNotification.findMany({
  where: {
    remindAt: { lte: now, not: null },
  },
  include: { notification: true, user: true },
});
```

### Caching Strategies

Consider caching for:
- Unseen count (with TTL of 1-5 minutes)
- User statistics (with TTL of 5-10 minutes)
- Delivery statistics (with TTL of 1 minute)

Example with Redis:
```typescript
async getUnseenCount(userId: string): Promise<number> {
  const cacheKey = `unseen:${userId}`;

  // Try cache first
  const cached = await this.redis.get(cacheKey);
  if (cached !== null) {
    return parseInt(cached, 10);
  }

  // Query database
  const count = await this.prisma.notification.count({
    where: {
      userId,
      seenBy: { none: { userId } },
    },
  });

  // Cache for 2 minutes
  await this.redis.setex(cacheKey, 120, count.toString());

  return count;
}
```

## Error Handling

### Transaction Rollback

All tracking operations use transactions to ensure data consistency:

```typescript
await this.prisma.$transaction(async tx => {
  // Create record
  const record = await createRecord(tx);

  // Log change
  await logChange(tx);

  // If any operation fails, entire transaction rolls back
});
```

### Graceful Degradation

WebSocket failures don't block the main operation:

```typescript
try {
  this.gatewayService.notifyNotificationSeen(userId, notificationId, seenAt);
} catch (error) {
  // Log warning but don't throw
  this.logger.warn(`Failed to emit WebSocket event: ${error.message}`);
}
```

### Reminder Processing Safety

```typescript
// Prevent concurrent execution
if (this.isProcessing) {
  this.logger.warn('Already processing, skipping...');
  return;
}

this.isProcessing = true;
try {
  await this.processReminders();
} finally {
  this.isProcessing = false;
}
```

## Monitoring and Logging

### Key Metrics to Monitor

1. **Reminder Processing**
   - Processing duration
   - Number of reminders processed
   - Error rate
   - Overdue reminders count

2. **Delivery Tracking**
   - Delivery success rate by channel
   - Failed delivery count
   - Average delivery time

3. **Seen Tracking**
   - Mark-as-seen response time
   - WebSocket emission success rate
   - Concurrent seen operations

### Log Examples

```typescript
this.logger.log('Starting notification reminder processing...');
this.logger.log(`Found ${reminders.length} reminders to process`);
this.logger.log(`Reminder processing completed in ${duration}ms`);
this.logger.warn('Failed to send WebSocket notification');
this.logger.error('Error during reminder processing:', error);
```

## Security Considerations

### Authorization Checks

```typescript
// Users can only access their own data
if (req.user.id !== userId && !req.user.isAdmin) {
  throw new BadRequestException('Unauthorized access');
}
```

### Input Validation

```typescript
// Validate date is in future
if (remindAt <= new Date()) {
  throw new BadRequestException('Reminder date must be in the future');
}

// Validate channel enum
const validChannels = Object.values(NOTIFICATION_CHANNEL);
if (!validChannels.includes(dto.channel)) {
  throw new BadRequestException('Invalid notification channel');
}
```

### Rate Limiting

Consider implementing rate limiting for:
- Mark-as-seen operations (prevent spam)
- Reminder creation (limit per user per day)
- Statistics queries (prevent abuse)

## Testing

### Unit Tests

```typescript
describe('NotificationService', () => {
  describe('markAsSeen', () => {
    it('should create SeenNotification record', async () => {
      const result = await service.markAsSeen('notif-1', 'user-1');
      expect(result).toBeDefined();
    });

    it('should not create duplicate seen records', async () => {
      await service.markAsSeen('notif-1', 'user-1');
      await service.markAsSeen('notif-1', 'user-1');

      const count = await prisma.seenNotification.count({
        where: { notificationId: 'notif-1', userId: 'user-1' },
      });

      expect(count).toBe(1);
    });
  });
});
```

### Integration Tests

```typescript
describe('NotificationTrackingController', () => {
  it('should mark notification as seen', async () => {
    const response = await request(app.getHttpServer())
      .post('/notifications/notif-1/seen')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});
```

### Scheduler Tests

```typescript
describe('NotificationReminderScheduler', () => {
  it('should process overdue reminders', async () => {
    // Create reminder in past
    await createReminderInPast();

    const result = await scheduler.triggerManualProcessing();

    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
  });
});
```

## Migration Guide

If upgrading from a previous version:

1. Run database migrations to ensure schema is up to date
2. Install `@nestjs/schedule` package
3. Update `notification.module.ts` as described in TRACKING_INTEGRATION.md
4. Deploy reminder scheduler
5. Monitor logs for any errors
6. Test reminder processing with manual trigger
7. Verify WebSocket events are working
8. Update frontend to use new endpoints

## Troubleshooting

### Reminders Not Processing

1. Check scheduler is registered in module
2. Verify ScheduleModule is imported
3. Check logs for cron execution
4. Manually trigger processing for testing

### WebSocket Events Not Received

1. Verify user is connected to WebSocket
2. Check NotificationGatewayService is injected
3. Review WebSocket logs for errors
4. Test with socket.io debugger

### High Database Load

1. Review query patterns
2. Add missing indexes
3. Implement caching layer
4. Consider pagination for large datasets

### Delivery Tracking Inconsistencies

1. Verify delivery records are created
2. Check for transaction failures
3. Review delivery status updates
4. Monitor for race conditions
