# Notification Reminder Scheduler Implementation

## Overview

The NotificationReminderSchedulerService provides comprehensive "remind me later" functionality for notifications. Users can schedule reminders to re-receive notifications at a later time through their preferred channels.

## Features

- **Multiple Time Intervals**: 5min, 15min, 1hr, 3hr, tomorrow, next week
- **Automatic Processing**: Cron job runs every minute to check due reminders
- **Smart Re-dispatch**: Re-sends notifications through original channels
- **Reminder Limits**: Maximum 3 reminders per notification
- **Comprehensive Tracking**: All actions logged in changelog
- **Cleanup Utilities**: Remove expired reminders automatically

## File Structure

```
src/modules/common/notification/
├── notification-reminder-scheduler.service.ts  # Main service implementation
├── notification-reminder.controller.ts         # REST API endpoints
├── dto/notification-reminder.dto.ts           # Request/response DTOs
└── REMINDER_IMPLEMENTATION.md                 # This documentation
```

## API Endpoints

### User Endpoints

#### 1. Get Reminder Options
```
GET /notifications/reminders/options
```
Returns available reminder intervals with metadata.

**Response:**
```json
[
  {
    "value": "5min",
    "label": "5 minutes",
    "description": "Remind me in 5 minutes",
    "milliseconds": 300000
  },
  {
    "value": "1hr",
    "label": "1 hour",
    "description": "Remind me in 1 hour",
    "milliseconds": 3600000
  }
]
```

#### 2. Schedule Reminder
```
POST /notifications/reminders/schedule
```

**Request Body:**
```json
{
  "notificationId": "550e8400-e29b-41d4-a716-446655440000",
  "interval": "1hr"
}
```

**Response:**
```json
{
  "id": "reminder-id",
  "userId": "user-id",
  "notificationId": "notification-id",
  "remindAt": "2026-01-05T14:30:00Z",
  "seenAt": "2026-01-05T13:30:00Z",
  "reminderCount": 1,
  "notification": {
    "id": "notification-id",
    "title": "Task Assigned",
    "body": "You have been assigned a new task",
    "type": "TASK_ASSIGNED",
    "importance": "HIGH"
  },
  "user": {
    "id": "user-id",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

#### 3. Cancel Reminder
```
DELETE /notifications/reminders/cancel
```

**Request Body:**
```json
{
  "notificationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### 4. Reschedule Reminder
```
POST /notifications/reminders/reschedule
```

**Request Body:**
```json
{
  "notificationId": "550e8400-e29b-41d4-a716-446655440000",
  "newInterval": "3hr"
}
```

#### 5. Get My Reminders
```
GET /notifications/reminders/my-reminders
```

Returns all active reminders for the authenticated user.

#### 6. Cancel All My Reminders
```
DELETE /notifications/reminders/my-reminders
```

### Admin Endpoints

#### 7. Get Statistics
```
GET /notifications/reminders/stats
```

**Response:**
```json
{
  "totalPending": 45,
  "overdue": 3,
  "upcoming": 12,
  "byUser": {
    "user-id-1": 5,
    "user-id-2": 3
  },
  "byInterval": {
    "5min": 10,
    "1hr": 20,
    "tomorrow": 15
  }
}
```

#### 8. Manual Processing
```
POST /notifications/reminders/process
```

Manually triggers reminder processing (useful for testing).

#### 9. Cleanup Expired Reminders
```
DELETE /notifications/reminders/cleanup?daysOld=30
```

Removes reminders older than specified days.

#### 10. Get User Reminders
```
GET /notifications/reminders/user/:userId
```

Get all reminders for a specific user.

#### 11. Cancel User Reminders
```
DELETE /notifications/reminders/user/:userId
```

Cancel all reminders for a specific user.

## Service Methods

### Core Methods

#### `scheduleReminder(notificationId, userId, interval)`
Schedules a new reminder for a notification.

**Parameters:**
- `notificationId`: ID of notification to remind about
- `userId`: ID of user to remind
- `interval`: Time interval (enum REMINDER_INTERVAL)

**Throws:**
- `NotFoundException`: If notification or user not found
- `BadRequestException`: If max reminders reached or invalid interval

**Returns:** ReminderWithData object

---

#### `cancelReminder(notificationId, userId)`
Cancels an active reminder.

**Parameters:**
- `notificationId`: ID of notification
- `userId`: ID of user

**Throws:**
- `NotFoundException`: If no active reminder found

---

#### `rescheduleReminder(notificationId, userId, newInterval)`
Changes the time of an existing reminder.

**Parameters:**
- `notificationId`: ID of notification
- `userId`: ID of user
- `newInterval`: New time interval

**Throws:**
- `NotFoundException`: If no active reminder found

**Returns:** Updated ReminderWithData object

---

#### `processReminders()`
Main cron job that runs every minute. Finds and processes all due reminders.

**Features:**
- Concurrent execution prevention
- Error isolation (one failure doesn't affect others)
- Comprehensive logging
- Performance tracking

---

#### `getReminderOptions()`
Returns list of available reminder intervals with metadata.

**Returns:** Array of ReminderOption objects

---

#### `cleanupExpiredReminders(daysOld)`
Removes reminders older than specified days.

**Parameters:**
- `daysOld`: Number of days (default: 30)

**Returns:** Number of reminders cleaned up

---

### Utility Methods

#### `getUserReminders(userId)`
Get all active reminders for a user.

#### `cancelUserReminders(userId)`
Cancel all reminders for a user.

#### `getReminderStats()`
Get comprehensive statistics about pending reminders.

#### `triggerManualProcessing()`
Manually trigger reminder processing.

## Reminder Flow

### 1. User Schedules Reminder

```
User clicks "Remind me later"
   ↓
Select time interval (5min, 1hr, tomorrow, etc.)
   ↓
POST /notifications/reminders/schedule
   ↓
Service validates notification & user exist
   ↓
Check reminder count < 3
   ↓
Calculate reminder time based on interval
   ↓
Update SeenNotification.remindAt field
   ↓
Log action in changelog
   ↓
Return reminder details
```

### 2. Cron Processing

```
Every minute, cron job runs
   ↓
Query SeenNotifications where remindAt <= now
   ↓
For each due reminder:
   ├─ Send via WebSocket (in-app)
   ├─ Re-dispatch through original channels
   ├─ Clear remindAt field
   ├─ Log processing in changelog
   └─ Handle errors gracefully
   ↓
Report processing statistics
```

### 3. Re-dispatch Logic

```
Reminder is due
   ↓
Load original notification
   ↓
Send via WebSocket with isReminder flag
   ↓
Check notification.channel array
   ↓
If channels exist:
   ├─ Call dispatchService.dispatchNotification()
   ├─ Respects user preferences
   └─ Sends via EMAIL, SMS, PUSH, etc.
   ↓
Update notification status
   ↓
Log all actions
```

## Database Schema

The reminder system uses the existing `SeenNotification` model:

```prisma
model SeenNotification {
  id             String       @id @default(uuid())
  userId         String
  notificationId String
  seenAt         DateTime     @default(now())
  remindAt       DateTime?    // ← Reminder time field
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  notification   Notification @relation(...)
  user           User         @relation(...)

  @@unique([userId, notificationId])
}
```

**Key Points:**
- `remindAt`: When to remind (NULL = no reminder)
- `seenAt`: When notification was first seen
- Unique constraint ensures one reminder per user-notification pair
- Reminder count tracked via changelog entries

## Configuration

### Cron Schedule
The cron job runs every minute:
```typescript
@Cron(CronExpression.EVERY_MINUTE)
```

To change frequency, update the decorator:
```typescript
// Every 5 minutes
@Cron(CronExpression.EVERY_5_MINUTES)

// Every 30 seconds
@Cron('*/30 * * * * *')
```

### Max Reminders Per Notification
Configurable constant:
```typescript
const MAX_REMINDERS_PER_NOTIFICATION = 3;
```

### Reminder Intervals
Defined in `REMINDER_INTERVAL` enum:
```typescript
export enum REMINDER_INTERVAL {
  FIVE_MINUTES = '5min',
  FIFTEEN_MINUTES = '15min',
  ONE_HOUR = '1hr',
  THREE_HOURS = '3hr',
  TOMORROW = 'tomorrow',
  NEXT_WEEK = 'next_week',
}
```

## Error Handling

### Common Errors

1. **Max Reminders Reached**
   ```
   BadRequestException: Maximum 3 reminders reached for this notification
   ```

2. **Notification Not Found**
   ```
   NotFoundException: Notification not found
   ```

3. **No Active Reminder**
   ```
   NotFoundException: No active reminder found for this notification
   ```

4. **Concurrent Processing**
   ```
   BadRequestException: Reminder processing already in progress
   ```

### Error Recovery

- Processing errors are logged but don't stop the cron job
- Failed reminders are retried on next cron run
- WebSocket failures are logged but don't fail the entire process
- Dispatch errors are caught and logged separately

## Logging

All reminder actions are logged in the ChangeLog:

### Schedule Event
```typescript
{
  entityType: 'SEEN_NOTIFICATION',
  entityId: 'seen-notification-id',
  action: 'UPDATE',
  field: 'remindAt',
  oldValue: null,
  newValue: '2026-01-05T14:00:00Z',
  reason: 'Reminder scheduled for 1hr',
  triggeredBy: 'USER_ACTION',
  userId: 'user-id'
}
```

### Processing Event
```typescript
{
  entityType: 'SEEN_NOTIFICATION',
  entityId: 'seen-notification-id',
  action: 'UPDATE',
  field: 'remindAt',
  oldValue: '2026-01-05T14:00:00Z',
  newValue: null,
  reason: 'Reminder processed and notification re-sent',
  triggeredBy: 'SYSTEM',
  triggeredById: 'reminder-scheduler'
}
```

## Testing

### Manual Testing

1. **Schedule a reminder:**
   ```bash
   curl -X POST http://localhost:3000/notifications/reminders/schedule \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "notificationId": "NOTIFICATION_ID",
       "interval": "5min"
     }'
   ```

2. **Check your reminders:**
   ```bash
   curl http://localhost:3000/notifications/reminders/my-reminders \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. **Manually trigger processing:**
   ```bash
   curl -X POST http://localhost:3000/notifications/reminders/process \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

### Unit Testing

```typescript
describe('NotificationReminderSchedulerService', () => {
  it('should schedule a reminder', async () => {
    const result = await service.scheduleReminder(
      'notification-id',
      'user-id',
      REMINDER_INTERVAL.ONE_HOUR
    );

    expect(result.remindAt).toBeDefined();
    expect(result.reminderCount).toBe(1);
  });

  it('should enforce max reminder limit', async () => {
    // Schedule 3 reminders
    await service.scheduleReminder(...);
    await service.scheduleReminder(...);
    await service.scheduleReminder(...);

    // 4th should fail
    await expect(
      service.scheduleReminder(...)
    ).rejects.toThrow('Maximum 3 reminders reached');
  });

  it('should process due reminders', async () => {
    // Schedule reminder for past time
    await service.scheduleReminder(...);

    // Process reminders
    await service.processReminders();

    // Verify reminder was cleared
    const reminders = await service.getUserReminders('user-id');
    expect(reminders).toHaveLength(0);
  });
});
```

## Performance Considerations

### Query Optimization

1. **Index on remindAt field** (recommended):
   ```sql
   CREATE INDEX idx_seen_notification_remind_at
   ON "SeenNotification" ("remindAt")
   WHERE "remindAt" IS NOT NULL;
   ```

2. **Compound index for user queries**:
   ```sql
   CREATE INDEX idx_seen_notification_user_remind
   ON "SeenNotification" ("userId", "remindAt")
   WHERE "remindAt" IS NOT NULL;
   ```

### Scaling

- Cron runs on single instance (use @nestjs/schedule locking)
- For high volume, consider:
  - Message queue (Bull, RabbitMQ)
  - Separate microservice for processing
  - Batch processing with pagination
  - Rate limiting on reminder creation

## Integration Examples

### Frontend Integration

```typescript
// Get reminder options
const options = await fetch('/notifications/reminders/options');

// Schedule reminder
async function scheduleReminder(notificationId: string, interval: string) {
  const response = await fetch('/notifications/reminders/schedule', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ notificationId, interval })
  });

  return response.json();
}

// Listen for reminder notifications via WebSocket
socket.on('notification', (data) => {
  if (data.isReminder) {
    console.log('Reminder received:', data);
    showReminderNotification(data);
  }
});
```

### React Component Example

```tsx
function NotificationItem({ notification }) {
  const [reminderActive, setReminderActive] = useState(false);

  const handleReminder = async (interval: string) => {
    await scheduleReminder(notification.id, interval);
    setReminderActive(true);
  };

  return (
    <div>
      <h3>{notification.title}</h3>
      <p>{notification.body}</p>

      {!reminderActive ? (
        <ReminderMenu onSelect={handleReminder} />
      ) : (
        <button onClick={() => cancelReminder(notification.id)}>
          Cancel Reminder
        </button>
      )}
    </div>
  );
}
```

## Troubleshooting

### Reminders Not Processing

1. **Check cron is running:**
   - Verify ScheduleModule is imported
   - Check application logs for "Starting notification reminder processing"

2. **Check database:**
   ```sql
   SELECT * FROM "SeenNotification"
   WHERE "remindAt" IS NOT NULL
   AND "remindAt" <= NOW();
   ```

3. **Manually trigger:**
   ```bash
   POST /notifications/reminders/process
   ```

### WebSocket Not Receiving

1. Verify WebSocket connection is active
2. Check NotificationGatewayService is working
3. Check user is subscribed to notification channel

### Reminders Not Re-dispatching

1. Check notification has channels defined
2. Verify NotificationDispatchService is available
3. Check user preferences allow the channels

## Future Enhancements

### Potential Features

1. **Custom reminder times:**
   - Allow user to specify exact date/time
   - Support recurring reminders

2. **Reminder priorities:**
   - High priority reminders get processed first
   - Low priority can be batched

3. **Smart reminders:**
   - ML-based optimal reminder times
   - User behavior analysis

4. **Reminder notifications:**
   - Notify user when reminder is set
   - Send confirmation before reminder time

5. **Snooze functionality:**
   - Quick snooze for 5/10 minutes
   - Increment reminder count properly

6. **Analytics:**
   - Track reminder effectiveness
   - User engagement metrics
   - Most popular intervals

## License

This implementation is part of the notification system and follows the project's license.

## Support

For issues or questions:
1. Check this documentation
2. Review the code comments
3. Check application logs
4. Contact the development team
