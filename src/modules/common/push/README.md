# Push Notification Module

Firebase Cloud Messaging (FCM) integration for sending push notifications to iOS, Android, and Web platforms.

## Features

- Send notifications to individual devices
- Send multicast notifications to multiple devices
- Send topic-based notifications
- Automatic invalid token tracking and removal
- Multi-platform support (iOS, Android, Web)
- Device token registration/unregistration
- User-based notification delivery

## Setup

### 1. Install Dependencies

```bash
npm install firebase-admin
```

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

To get these credentials:
1. Go to Firebase Console
2. Project Settings > Service Accounts
3. Generate new private key
4. Extract the values from the downloaded JSON file

### 3. Update Database Schema

The Prisma schema has been updated with the `DeviceToken` model and `Platform` enum. Run the migration:

```bash
npm run db:migrate
```

Or push the schema changes:

```bash
npm run db:push
```

### 4. Import the Module

Add `PushModule` to your app module imports:

```typescript
import { PushModule } from '@modules/common/push/push.module';

@Module({
  imports: [
    // ... other modules
    PushModule,
  ],
})
export class AppModule {}
```

## API Endpoints

### Register Device Token

```http
POST /push/register
Authorization: Bearer {token}
Content-Type: application/json

{
  "token": "device-fcm-token-here",
  "platform": "IOS" | "ANDROID" | "WEB"
}
```

### Unregister Device Token

```http
DELETE /push/unregister
Authorization: Bearer {token}
Content-Type: application/json

{
  "token": "device-fcm-token-here"
}
```

### Send Test Notification (Admin Only)

```http
POST /push/test
Authorization: Bearer {token}
Content-Type: application/json

{
  "token": "device-fcm-token-here",
  "title": "Test Notification",
  "body": "This is a test message",
  "data": {
    "key": "value"
  }
}
```

## Service Usage

### Inject the Service

```typescript
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class YourService {
  constructor(private readonly pushService: PushService) {}
}
```

### Send Notification to Single Device

```typescript
const result = await this.pushService.sendPushNotification(
  'device-token',
  'Notification Title',
  'Notification body message',
  { customKey: 'customValue' } // optional data
);

if (result.success) {
  console.log('Notification sent:', result.messageId);
} else {
  console.error('Failed to send:', result.error);
}
```

### Send Notification to Multiple Devices

```typescript
const result = await this.pushService.sendMulticastNotification(
  ['token1', 'token2', 'token3'],
  'Notification Title',
  'Notification body message',
  { customKey: 'customValue' } // optional data
);

console.log(`Success: ${result.success}, Failed: ${result.failure}`);
if (result.failedTokens) {
  console.log('Failed tokens:', result.failedTokens);
}
```

### Send Notification to All User's Devices

```typescript
const result = await this.pushService.sendToUser(
  'user-id',
  'Notification Title',
  'Notification body message',
  { customKey: 'customValue' } // optional data
);
```

### Send Topic Notification

```typescript
const result = await this.pushService.sendTopicNotification(
  'news-updates',
  'Breaking News',
  'Something important happened',
  { articleId: '123' }
);
```

### Subscribe/Unsubscribe to Topics

```typescript
// Subscribe
await this.pushService.subscribeToTopic('device-token', 'news-updates');
await this.pushService.subscribeToTopic(['token1', 'token2'], 'news-updates');

// Unsubscribe
await this.pushService.unsubscribeFromTopic('device-token', 'news-updates');
await this.pushService.unsubscribeFromTopic(['token1', 'token2'], 'news-updates');
```

## Platform-Specific Configurations

### iOS (APNs)

- Notifications include sound, badge, and content-available flags
- Priority set to high (10)
- Supports background notifications

### Android (FCM)

- Uses high priority
- Configured with default notification channel
- Includes sound and vibration

### Web

- Includes icon and badge images
- Set to require interaction
- Desktop and mobile web support

## Error Handling

The service automatically:
- Logs all send attempts
- Detects invalid/unregistered tokens
- Marks failed tokens as inactive in the database
- Provides detailed error messages

## Invalid Token Management

When a notification fails due to an invalid token, the service:
1. Detects the error type
2. Marks the token as inactive in the database
3. Logs the action for debugging

This prevents repeated attempts to send to invalid tokens.

## Database Schema

### DeviceToken Model

```prisma
model DeviceToken {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  platform  Platform
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation("USER_DEVICE_TOKENS", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([platform])
}

enum Platform {
  IOS
  ANDROID
  WEB
}
```

### User Model Relation

```prisma
model User {
  // ... other fields
  deviceTokens DeviceToken[] @relation("USER_DEVICE_TOKENS")
}
```

## Security

- Registration requires authenticated user
- Test endpoint restricted to admin users
- Tokens automatically removed on user deletion (cascade)
- Invalid tokens automatically deactivated

## Logging

All operations are logged with appropriate log levels:
- INFO: Successful operations, initialization
- WARN: Missing configuration, no tokens found
- ERROR: Failed operations with stack traces

## Best Practices

1. Always register device tokens when users log in
2. Unregister tokens when users log out
3. Use topics for broadcast notifications
4. Keep data payloads small
5. Handle failed notifications gracefully
6. Monitor inactive token cleanup

## Troubleshooting

### Firebase not initialized
- Check environment variables are set correctly
- Verify private key format (should include `\n` newlines)
- Check Firebase console for service account access

### Notifications not received
- Verify token is correctly registered
- Check token is marked as active in database
- Verify device has FCM/APNs configured
- Check Firebase console logs

### Invalid token errors
- Normal for expired/uninstalled app tokens
- Service automatically handles cleanup
- No action needed
