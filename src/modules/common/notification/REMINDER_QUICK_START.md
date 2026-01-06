# Notification Reminder Quick Start Guide

## Quick Overview

The NotificationReminderScheduler provides "remind me later" functionality for notifications.

## Basic Usage

### 1. Schedule a Reminder

```typescript
POST /notifications/reminders/schedule

Body:
{
  "notificationId": "notification-uuid",
  "interval": "1hr"  // Options: 5min, 15min, 1hr, 3hr, tomorrow, next_week
}
```

### 2. View My Reminders

```typescript
GET /notifications/reminders/my-reminders
```

### 3. Cancel a Reminder

```typescript
DELETE /notifications/reminders/cancel

Body:
{
  "notificationId": "notification-uuid"
}
```

### 4. Reschedule a Reminder

```typescript
POST /notifications/reminders/reschedule

Body:
{
  "notificationId": "notification-uuid",
  "newInterval": "3hr"
}
```

## Available Time Intervals

| Interval | Description | Time |
|----------|-------------|------|
| `5min` | 5 minutes | +5 minutes |
| `15min` | 15 minutes | +15 minutes |
| `1hr` | 1 hour | +1 hour |
| `3hr` | 3 hours | +3 hours |
| `tomorrow` | Tomorrow morning | Next day at 9 AM |
| `next_week` | Next week | Next Monday at 9 AM |

## Service Methods

```typescript
// Inject the service
constructor(
  private reminderScheduler: NotificationReminderSchedulerService
) {}

// Schedule a reminder
await this.reminderScheduler.scheduleReminder(
  notificationId,
  userId,
  REMINDER_INTERVAL.ONE_HOUR
);

// Cancel a reminder
await this.reminderScheduler.cancelReminder(notificationId, userId);

// Get user reminders
const reminders = await this.reminderScheduler.getUserReminders(userId);

// Get reminder options
const options = this.reminderScheduler.getReminderOptions();
```

## Frontend Integration

### React Example

```tsx
import { useState, useEffect } from 'react';

function NotificationReminder({ notification }) {
  const [options, setOptions] = useState([]);
  const [hasReminder, setHasReminder] = useState(false);

  useEffect(() => {
    // Load reminder options
    fetch('/notifications/reminders/options')
      .then(r => r.json())
      .then(setOptions);
  }, []);

  const scheduleReminder = async (interval: string) => {
    await fetch('/notifications/reminders/schedule', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        notificationId: notification.id,
        interval
      })
    });
    setHasReminder(true);
  };

  const cancelReminder = async () => {
    await fetch('/notifications/reminders/cancel', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        notificationId: notification.id
      })
    });
    setHasReminder(false);
  };

  return (
    <div>
      {!hasReminder ? (
        <select onChange={e => scheduleReminder(e.target.value)}>
          <option>Remind me later...</option>
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <button onClick={cancelReminder}>
          Cancel Reminder
        </button>
      )}
    </div>
  );
}
```

### WebSocket Integration

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('notification', (notification) => {
  if (notification.isReminder) {
    // This is a reminder notification
    showReminderToast({
      title: notification.title,
      body: notification.body,
      reminderNote: notification.reminderNote
    });
  }
});
```

## Admin Operations

### View Statistics

```bash
curl http://localhost:3000/notifications/reminders/stats \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Manual Processing (Testing)

```bash
curl -X POST http://localhost:3000/notifications/reminders/process \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Cleanup Old Reminders

```bash
curl -X DELETE "http://localhost:3000/notifications/reminders/cleanup?daysOld=30" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

## How It Works

1. **User schedules reminder** → Stored in `SeenNotification.remindAt`
2. **Cron runs every minute** → Checks for due reminders
3. **Reminder is due** → Re-sends notification via:
   - WebSocket (in-app)
   - Original channels (email, SMS, push)
4. **Reminder cleared** → `remindAt` set to NULL

## Limitations

- Maximum 3 reminders per notification
- Minimum interval: 5 minutes
- Cron processes every minute
- Requires authentication

## Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Maximum 3 reminders reached" | Too many reminders for this notification | Cancel old reminder first |
| "Notification not found" | Invalid notification ID | Check notification exists |
| "No active reminder found" | Trying to cancel non-existent reminder | Check reminder exists first |

## Troubleshooting

### Reminder not being sent?

1. Check cron is running:
   ```bash
   # Look for this in logs every minute
   "Starting notification reminder processing..."
   ```

2. Check database:
   ```sql
   SELECT * FROM "SeenNotification"
   WHERE "remindAt" IS NOT NULL
   AND "remindAt" <= NOW();
   ```

3. Manually trigger:
   ```bash
   POST /notifications/reminders/process
   ```

### Not receiving WebSocket notification?

- Verify WebSocket connection is active
- Check browser console for errors
- Verify user is authenticated

## Need More Info?

See full documentation: `REMINDER_IMPLEMENTATION.md`

## Support

For issues:
1. Check application logs
2. Verify database state
3. Test with manual processing endpoint
4. Contact development team
