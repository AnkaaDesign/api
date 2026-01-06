# Notification Preferences - Quick Start Guide

## 🚀 Quick Integration (5 minutes)

### Step 1: Import the Module

In your `user.module.ts`:

```typescript
import { NotificationModule } from '@modules/common/notification/notification.module';

@Module({
  imports: [
    NotificationModule, // Add this line
    // ... your other imports
  ],
})
export class UserModule {}
```

### Step 2: Initialize Preferences on User Creation

In your `user.service.ts`:

```typescript
import { NotificationPreferenceInitService } from '@modules/common/notification/notification-preference-init.service';

@Injectable()
export class UserService {
  constructor(
    // ... your existing dependencies
    private readonly notificationPreferenceInitService: NotificationPreferenceInitService,
  ) {}

  async createUser(data: CreateUserDto): Promise<User> {
    const user = await this.userRepository.create(data);

    // Add these 2 lines:
    await this.notificationPreferenceInitService.initializeForNewUser(user.id);

    return user;
  }
}
```

### Step 3: Test the API

```bash
# Get user preferences
curl http://localhost:3000/users/{userId}/notification-preferences

# Update a preference
curl -X PUT http://localhost:3000/users/{userId}/notification-preferences/TASK \
  -H "Content-Type: application/json" \
  -d '{"eventType": "status", "channels": ["IN_APP", "EMAIL"]}'

# Reset to defaults
curl -X POST http://localhost:3000/users/{userId}/notification-preferences/reset \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'

# Get default preferences
curl http://localhost:3000/notification-preferences/defaults
```

## 📋 API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/:userId/notification-preferences` | Get all user preferences |
| PUT | `/users/:userId/notification-preferences/:type` | Update a preference |
| POST | `/users/:userId/notification-preferences/reset` | Reset to defaults |
| GET | `/notification-preferences/defaults` | Get default config |

## 🎯 Key Concepts

### Mandatory vs Optional

- **Mandatory**: All TASK notifications (10 types) - Users must keep at least 1 channel enabled
- **Optional**: ORDER, STOCK, PPE, VACATION, WARNING, SYSTEM, GENERAL - Users can disable completely

### Available Channels

- `IN_APP` - In-app notifications
- `EMAIL` - Email notifications
- `PUSH` - Push notifications (mobile/desktop)
- `SMS` - SMS notifications
- `WHATSAPP` - WhatsApp messages
- `DESKTOP_PUSH` - Desktop push notifications
- `MOBILE_PUSH` - Mobile push notifications

### Notification Types

- `TASK` - Task-related notifications (mandatory)
- `ORDER` - Order updates (optional)
- `STOCK` - Inventory alerts (optional)
- `PPE` - Equipment notifications (optional)
- `VACATION` - Vacation requests (optional)
- `WARNING` - Warning/disciplinary (optional)
- `SYSTEM` - System announcements (optional)
- `GENERAL` - General notifications (optional)

## 🔧 Using in Notification Dispatch

```typescript
import { NotificationPreferenceService } from '@modules/common/notification/notification-preference.service';

@Injectable()
export class YourNotificationService {
  constructor(
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  async sendNotification(userId: string, type: string, eventType: string) {
    // Check user preferences
    const channels = await this.preferenceService.getChannelsForEvent(
      userId,
      type,
      eventType,
    );

    if (channels.length === 0) {
      // User disabled this notification
      return;
    }

    // Send only to enabled channels
    for (const channel of channels) {
      await this.sendToChannel(channel, userId, /* your message */);
    }
  }
}
```

## 📚 Full Documentation

- **Integration Guide**: `NOTIFICATION_PREFERENCES_INTEGRATION.md`
- **Code Examples**: `USER_SERVICE_INTEGRATION_EXAMPLE.ts`
- **Implementation Details**: `IMPLEMENTATION_SUMMARY.md`

## ⚠️ Important Notes

1. **Auto-Initialization**: If preferences aren't initialized during user creation, they'll be auto-created when first accessed
2. **Mandatory Preferences**: Can't be disabled, but channels can be changed
3. **Authorization**: Users can only modify their own preferences (unless admin)
4. **Migration**: Existing users without preferences will get them auto-created on first access

## 🐛 Troubleshooting

### Preferences not created?
- Check that `NotificationModule` is imported in your `UserModule`
- Verify initialization is being called in user creation flow
- Check logs for any errors during initialization

### Can't update preference?
- Ensure user is updating their own preferences
- Check if preference is mandatory (can't disable completely)
- Verify notification type and channels are valid

### Getting 404 errors?
- Verify the controllers are registered in `notification.module.ts`
- Check that the module is imported in your `app.module.ts`

## 💡 Common Use Cases

### Bulk Initialize Existing Users

```typescript
// In a migration script or admin endpoint
import { NotificationPreferenceInitService } from '@modules/common/notification/notification-preference-init.service';

const userIds = await getAllUserIds();
await preferenceInitService.initializeForMultipleUsers(userIds);
```

### Check if User Has Preferences

```typescript
const hasPrefs = await preferenceInitService.hasPreferencesInitialized(userId);
if (!hasPrefs) {
  await preferenceInitService.initializeForNewUser(userId);
}
```

### Get Current User Preferences (Frontend)

```typescript
// React example
const fetchPreferences = async () => {
  const response = await fetch(`/api/users/${userId}/notification-preferences`);
  const { data } = await response.json();
  setPreferences(data);
};
```

## ✅ Done!

That's it! Your notification preference system is now ready to use.
