# Notification Tracking System - Integration Guide

This document describes the changes needed to complete the notification tracking system integration.

## Module Updates Required

### notification.module.ts

Add the following imports:
```typescript
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationTrackingController } from './notification-tracking.controller';
import { NotificationDeliveryRepository } from './repositories/notification-delivery.repository';
import { NotificationReminderScheduler } from './notification-reminder.scheduler';
```

Update the imports array to include:
```typescript
ScheduleModule.forRoot(),
```

Update the controllers array to include:
```typescript
NotificationTrackingController,
```

Update the providers array to include:
```typescript
NotificationReminderScheduler,
NotificationDeliveryRepository,
```

Update the exports array to include:
```typescript
NotificationReminderScheduler,
NotificationDeliveryRepository,
```

## Complete Module Configuration

```typescript
@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    CacheModule,
    ConfigModule,
    ScheduleModule.forRoot(), // ADD THIS
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [
    NotificationController,
    SeenNotificationController,
    NotificationTrackingController, // ADD THIS
    DeepLinkController,
    NotificationPreferenceController,
    NotificationPreferenceDefaultsController,
    NotificationAdminController,
  ],
  providers: [
    NotificationService,
    NotificationGateway,
    NotificationGatewayService,
    NotificationReminderScheduler, // ADD THIS
    NotificationDeliveryRepository, // ADD THIS
    NotificationAggregationService,
    EmailTemplateService,
    DeepLinkService,
    NotificationPreferenceService,
    NotificationPreferenceInitService,
    {
      provide: NotificationRepository,
      useClass: NotificationPrismaRepository,
    },
    {
      provide: SeenNotificationRepository,
      useClass: SeenNotificationPrismaRepository,
    },
    {
      provide: NotificationPreferenceRepository,
      useClass: NotificationPreferencePrismaRepository,
    },
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: [
    NotificationService,
    NotificationGatewayService,
    NotificationReminderScheduler, // ADD THIS
    NotificationDeliveryRepository, // ADD THIS
    NotificationAggregationService,
    EmailTemplateService,
    DeepLinkService,
    NotificationPreferenceService,
    NotificationPreferenceInitService,
  ],
})
export class NotificationModule {}
```

## Package Dependencies

Ensure the following package is installed:
```bash
npm install @nestjs/schedule
```

## Files Created

1. **notification-tracking.controller.ts** - Controller with tracking endpoints
2. **notification-reminder.scheduler.ts** - Scheduler for processing reminders
3. **repositories/notification-delivery.repository.ts** - Repository for delivery tracking

## Service Methods Added

The following methods were added to `notification.service.ts`:

- `markAsSeen(notificationId: string, userId: string): Promise<void>`
- `markAsDelivered(notificationId: string, channel: NotificationChannel): Promise<void>`
- `setReminder(notificationId: string, userId: string, remindAt: Date): Promise<void>`
- `getUnseenCount(userId: string): Promise<number>`
- `getUnseenNotifications(userId: string): Promise<Notification[]>`
- `getDeliveryStatus(notificationId: string): Promise<NotificationDelivery[]>`
- `getDeliveryStats(notificationId: string): Promise<Stats>`
- `getUserNotificationStats(userId: string): Promise<Stats>`

## API Endpoints

### Tracking Endpoints

- `POST /notifications/:id/seen` - Mark notification as seen
- `POST /notifications/:id/remind` - Set reminder for notification
- `POST /notifications/:id/delivered` - Mark as delivered (internal)
- `GET /notifications/:id/delivery-status` - Get delivery status
- `GET /notifications/:id/stats` - Get notification statistics

### User Endpoints

- `GET /notifications/users/:userId/unseen` - Get unseen notifications
- `GET /notifications/users/:userId/unseen-count` - Get unseen count
- `GET /notifications/users/:userId/stats` - Get user notification statistics
- `GET /notifications/users/:userId/reminders` - Get user reminders
- `POST /notifications/users/:userId/reminders/cancel-all` - Cancel all reminders

### Admin Endpoints

- `GET /notifications/reminders/stats` - Get reminder statistics (admin only)
- `POST /notifications/reminders/process` - Manually trigger reminder processing (admin only)

## Database Considerations

### Indexes for Optimization

The following indexes should be verified in the Prisma schema:

```prisma
model Notification {
  // ... existing fields

  @@index([userId])
  @@index([scheduledAt])
  @@index([sentAt])
}

model SeenNotification {
  // ... existing fields

  @@index([userId])
  @@index([notificationId])
  @@index([remindAt])
  @@unique([userId, notificationId])
}

model NotificationDelivery {
  // ... existing fields

  @@index([notificationId])
  @@index([status])
  @@index([channel])
}
```

## Scheduler Configuration

The reminder scheduler runs every 5 minutes using the `@Cron` decorator:
```typescript
@Cron(CronExpression.EVERY_5_MINUTES)
async processReminders(): Promise<void>
```

To adjust the frequency, modify the cron expression in `notification-reminder.scheduler.ts`.

## Testing Recommendations

1. Test marking notifications as seen
2. Test setting and canceling reminders
3. Test reminder processing (manual trigger)
4. Test delivery status tracking
5. Test statistics endpoints
6. Test unseen count queries with large datasets
7. Verify WebSocket events are emitted correctly
8. Test scheduler under load

## Performance Notes

- The `getUnseenCount` method uses an efficient count query
- Statistics methods use parallel queries with `Promise.all`
- The reminder scheduler includes a lock to prevent concurrent execution
- Delivery tracking uses find-or-create pattern to avoid duplicates

## Security Notes

- All endpoints require JWT authentication
- Users can only access their own notification data (except admins)
- Admin-only endpoints check `req.user.isAdmin`
- Validation is performed on all input dates and channels
