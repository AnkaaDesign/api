# Notification Preference Management System - Integration Guide

## Overview

The notification preference management system allows users to customize which notification channels they want to receive for different types of events. Some preferences are mandatory (cannot be disabled), while others are optional.

## Components

### 1. Repository Layer
- `notification-preference.repository.ts` - Abstract repository interface
- `notification-preference-prisma.repository.ts` - Prisma implementation

### 2. Service Layer
- `notification-preference.service.ts` - Business logic for CRUD operations
- `notification-preference-init.service.ts` - Initialization service for new users

### 3. Controller Layer
- `notification-preference.controller.ts` - REST API endpoints

## API Endpoints

### Get User Preferences
```
GET /users/:userId/notification-preferences
```
Returns all notification preferences for a user. If no preferences exist, they will be automatically initialized with defaults.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "notificationType": "TASK",
      "eventType": "status",
      "enabled": true,
      "channels": ["IN_APP", "EMAIL", "PUSH"],
      "isMandatory": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "message": "Notification preferences retrieved successfully"
}
```

### Update Preference
```
PUT /users/:userId/notification-preferences/:type
Content-Type: application/json

{
  "eventType": "status",
  "channels": ["IN_APP", "EMAIL"]
}
```

**Validation:**
- Users can only update their own preferences (unless admin)
- Cannot disable mandatory preferences completely (must have at least one channel)
- Channels must be valid: `EMAIL`, `SMS`, `PUSH`, `IN_APP`, `WHATSAPP`, `DESKTOP_PUSH`, `MOBILE_PUSH`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "notificationType": "TASK",
    "eventType": "status",
    "enabled": true,
    "channels": ["IN_APP", "EMAIL"],
    "isMandatory": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Notification preference updated successfully"
}
```

### Reset to Defaults
```
POST /users/:userId/notification-preferences/reset
Content-Type: application/json

{
  "confirm": true
}
```

Deletes all preferences and reinitializes with defaults.

### Get Default Preferences
```
GET /notification-preferences/defaults
```

Returns the default preference configuration (public endpoint).

## Integration with User Creation

### Option 1: Direct Service Call (Recommended)

In your user service, inject the `NotificationPreferenceInitService`:

```typescript
import { NotificationPreferenceInitService } from '@modules/common/notification/notification-preference-init.service';

@Injectable()
export class UserService {
  constructor(
    private readonly preferenceInitService: NotificationPreferenceInitService,
  ) {}

  async createUser(data: CreateUserDto): Promise<User> {
    // Create the user
    const user = await this.userRepository.create(data);

    // Initialize notification preferences
    await this.preferenceInitService.initializeForNewUser(user.id);

    return user;
  }
}
```

### Option 2: Event-Based (For Decoupling)

If you prefer event-driven architecture:

```typescript
// In user.service.ts
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class UserService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async createUser(data: CreateUserDto): Promise<User> {
    const user = await this.userRepository.create(data);

    // Emit user created event
    this.eventEmitter.emit('user.created', { userId: user.id });

    return user;
  }
}

// In notification-preference-init.service.ts
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class NotificationPreferenceInitService {
  @OnEvent('user.created')
  async handleUserCreated(payload: { userId: string }) {
    await this.initializeForNewUser(payload.userId);
  }
}
```

### Option 3: Lazy Initialization (Automatic)

The system will automatically initialize preferences when a user first accesses their preferences. This is built into the `getUserPreferences()` method.

```typescript
// No explicit initialization needed
// Preferences are auto-created on first access
const preferences = await preferenceService.getUserPreferences(userId);
```

## Default Preferences

### Mandatory (Cannot be disabled, but channels can be modified)
All TASK notifications are mandatory:
- `status` - Task status changes (IN_APP, EMAIL, PUSH)
- `deadline` - Deadline reminders (IN_APP, EMAIL, PUSH)
- `assignment` - Task assignments (IN_APP, EMAIL, PUSH)
- `artwork` - Artwork updates (IN_APP, EMAIL)
- `priority` - Priority changes (IN_APP, EMAIL, PUSH)
- `description` - Description updates (IN_APP)
- `customer` - Customer changes (IN_APP, EMAIL)
- `sector` - Sector changes (IN_APP, EMAIL)
- `comment` - New comments (IN_APP, PUSH)
- `completion` - Task completion (IN_APP, EMAIL)

### Optional (Can be disabled)
- ORDER notifications: `created`, `status`, `fulfilled`, `cancelled`, `overdue`
- STOCK notifications: `low`, `out`, `restock`
- PPE notifications: `delivery`, `expiration`, `shortage`
- VACATION notifications: `approved`, `rejected`, `expiring`
- WARNING notifications: `issued`, `escalation`
- SYSTEM notifications: `maintenance`, `update`, `announcement`
- GENERAL notifications: all general notifications

## Usage in Notification Dispatch

When sending notifications, check user preferences first:

```typescript
import { NotificationPreferenceService } from '@modules/common/notification/notification-preference.service';

@Injectable()
export class NotificationDispatchService {
  constructor(
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  async sendNotification(
    userId: string,
    type: string,
    eventType: string,
    message: NotificationMessage,
  ) {
    // Get enabled channels for this user and event type
    const channels = await this.preferenceService.getChannelsForEvent(
      userId,
      type,
      eventType,
    );

    if (channels.length === 0) {
      // User has disabled this notification
      return;
    }

    // Send notification only to enabled channels
    for (const channel of channels) {
      await this.sendToChannel(channel, userId, message);
    }
  }
}
```

## Database Schema

The `UserNotificationPreference` table in Prisma:

```prisma
model UserNotificationPreference {
  id               String                @id @default(uuid())
  userId           String
  notificationType NotificationType
  eventType        String?
  enabled          Boolean               @default(true)
  channels         NotificationChannel[]
  isMandatory      Boolean               @default(false)
  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt

  user User @relation("USER_NOTIFICATION_PREFERENCES", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, notificationType, eventType])
  @@index([userId])
}
```

## Error Handling

The system handles various error cases:

1. **Mandatory Preference Disabling**: Returns `BadRequestException` if trying to set channels to empty array for mandatory preferences
2. **Unauthorized Access**: Returns `ForbiddenException` if non-admin user tries to update another user's preferences
3. **Invalid Type/Channel**: Returns `BadRequestException` with list of valid values
4. **Missing Preference**: Returns `NotFoundException` if preference doesn't exist

## Migration Guide for Existing Users

To initialize preferences for all existing users:

```typescript
// Create a migration script
import { NotificationPreferenceInitService } from '@modules/common/notification/notification-preference-init.service';

async function migrateExistingUsers() {
  const userIds = await getUserIds(); // Get all user IDs

  await preferenceInitService.initializeForMultipleUsers(userIds);
}
```

## Testing

Example test cases:

```typescript
describe('NotificationPreferenceService', () => {
  it('should initialize default preferences for new user', async () => {
    await service.initializeUserPreferences(userId);
    const prefs = await service.getUserPreferences(userId);
    expect(prefs.length).toBeGreaterThan(0);
  });

  it('should not allow disabling mandatory preferences', async () => {
    await expect(
      service.updatePreference(userId, 'TASK', 'status', [], userId),
    ).rejects.toThrow(BadRequestException);
  });

  it('should allow updating channels for mandatory preferences', async () => {
    const updated = await service.updatePreference(
      userId,
      'TASK',
      'status',
      ['IN_APP'],
      userId,
    );
    expect(updated.channels).toEqual(['IN_APP']);
  });
});
```

## Notes

- Preferences are user-specific and cannot be shared
- Admin users can update any user's preferences
- The system is designed to be non-blocking - if preference initialization fails during user creation, it will be retried on first access
- All preference operations are logged for audit purposes
