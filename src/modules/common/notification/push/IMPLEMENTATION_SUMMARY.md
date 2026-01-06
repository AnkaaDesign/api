# Firebase Cloud Messaging (FCM) Push Notification Service - Implementation Summary

## Overview

A complete Firebase Cloud Messaging (FCM) push notification service has been implemented at `/home/kennedy/Documents/repositories/api/src/modules/common/push/push.service.ts`. This service provides comprehensive push notification functionality with deep linking, delivery tracking, and multi-platform support.

## Implemented Features

### 1. Core Push Notification Methods

#### `sendPushNotification(token, title, body, data)`
- Send push notification to a single device token
- Basic FCM notification without deep links
- Legacy method for backward compatibility

#### `sendToDevice(token, payload, notificationId)`
- **Enhanced push notification** with deep links and delivery tracking
- Supports platform-specific optimizations (iOS, Android, Web)
- Automatically tracks delivery status in database
- Handles expired tokens automatically
- Includes deep link data in payload

#### `sendToTopic(topic, payload, notificationId)`
- Send push notification to topic subscribers
- Supports deep links and delivery tracking
- Useful for broadcasting to user groups

### 2. Device Token Management

#### `registerDeviceToken(userId, token, platform)`
- Register a user's device token for push notifications
- Supports platforms: IOS, ANDROID, WEB
- Uses upsert to handle token updates
- Stores in `DeviceToken` table

#### `unregisterDeviceToken(token)`
- Remove a device token from the system
- Called when user logs out or uninstalls app

#### `getUserDevices(userId)`
- Get all device tokens for a user
- Returns both active and inactive devices
- Ordered by most recently updated

#### `getUserTokens(userId)`
- Get only active device tokens for a user
- Returns array of token strings
- Used internally for multi-device notifications

### 3. Multi-Device & Topic Management

#### `sendMulticastNotification(tokens, title, body, data)`
- Send to multiple device tokens efficiently
- FCM batches the requests
- Automatically handles failed tokens
- Returns success/failure counts

#### `sendToUser(userId, title, body, data)`
- Send notification to all of a user's devices
- Automatically fetches active tokens
- Uses multicast for efficiency

#### `subscribeToTopic(tokens, topic)`
- Subscribe device token(s) to a topic
- Enables topic-based broadcasting

#### `unsubscribeFromTopic(tokens, topic)`
- Unsubscribe device token(s) from a topic

### 4. Delivery Status Tracking

#### `handleDeliveryStatus(notificationId, token, status, messageId, errorMessage)`
- Track FCM delivery status in database
- Creates `NotificationDelivery` records
- Supports statuses: DELIVERED, FAILED, PENDING
- Stores FCM message ID for reference
- Automatically determines channel (MOBILE_PUSH vs DESKTOP_PUSH)

### 5. Payload Building with Deep Links

#### `buildNotificationPayload(token, payload)`
- Build FCM message with deep links and platform-specific config
- Supports Android, iOS, and Web platforms
- Automatically parses deep link JSON from notification.actionUrl
- Includes:
  - Web URL for web push
  - Mobile deep link for app navigation
  - Universal link for iOS/Android fallback
  - Custom data payload
  - Platform-specific notification settings

#### Features:
- **Android**: High priority, default channel, sound, vibration, click action
- **iOS**: APNS with alert, sound, badge, content available
- **Web**: Web push with icon, badge, require interaction, click URL

### 6. Error Handling & Token Management

#### `isInvalidTokenError(error)`
- Detects invalid/expired FCM tokens
- Handles error codes:
  - `messaging/invalid-registration-token`
  - `messaging/registration-token-not-registered`
  - `messaging/invalid-argument`

#### `deactivateToken(token)` & `deactivateTokens(tokens)`
- Automatically deactivates invalid tokens in database
- Prevents future attempts to send to expired tokens
- Sets `isActive = false` in DeviceToken table

## API Endpoints

### POST `/notifications/device-token`
Register a device token for push notifications

**Request Body:**
```json
{
  "token": "cXQx...:APA91bGKPy...",
  "platform": "ANDROID"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Device token registered successfully"
}
```

### DELETE `/notifications/device-token`
Unregister a device token

**Request Body:**
```json
{
  "token": "cXQx...:APA91bGKPy..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Device token unregistered successfully"
}
```

### GET `/notifications/device-tokens`
Get all device tokens for the current user

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "token": "cXQx...:APA91bGKPy...",
      "platform": "ANDROID",
      "isActive": true,
      "createdAt": "2025-01-05T12:00:00Z",
      "updatedAt": "2025-01-05T12:00:00Z"
    }
  ],
  "count": 1
}
```

## Database Schema

### DeviceToken Table
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

### NotificationDelivery Table
```prisma
model NotificationDelivery {
  id             String              @id @default(uuid())
  notificationId String
  channel        NotificationChannel
  status         DeliveryStatus      @default(PENDING)
  sentAt         DateTime?
  deliveredAt    DateTime?
  failedAt       DateTime?
  errorMessage   String?
  metadata       Json?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)

  @@index([notificationId])
  @@index([channel])
  @@index([status])
}
```

## Notification Channels

The system supports the following notification channels:

- `EMAIL` - Email notifications
- `SMS` - SMS text messages
- `PUSH` - Generic push (both mobile and desktop)
- `MOBILE_PUSH` - Mobile app push notifications (iOS/Android)
- `DESKTOP_PUSH` - Web browser push notifications
- `IN_APP` - In-app notifications via WebSocket
- `WHATSAPP` - WhatsApp messages

## Deep Link Integration

The service integrates with the `DeepLinkService` to support deep linking:

### Deep Link Payload Structure
```typescript
interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  imageUrl?: string;
  actionUrl?: string;  // JSON string from DeepLinkService
  deepLinks?: {
    web?: string;
    mobile?: string;
    universalLink?: string;
  };
}
```

### Example Usage
```typescript
// Using DeepLinkService to generate links
const deepLinks = deepLinkService.generateTaskLinks(taskId, { action: 'approve' });

// Send push notification with deep links
await pushService.sendToDevice(
  deviceToken,
  {
    title: 'Task Approval Required',
    body: 'Please review and approve task #123',
    deepLinks: deepLinks,
    data: {
      taskId: taskId,
      action: 'approve'
    }
  },
  notificationId
);
```

### Deep Link Data in Payload
When a notification is sent, deep links are included in the data payload:
- `webUrl` - Web application URL
- `mobileUrl` - Mobile deep link (custom scheme)
- `universalLink` - Universal/App Link (HTTPS)
- `actionUrl` - Fallback action URL

Mobile apps can use these URLs to navigate to the appropriate screen when the notification is tapped.

## Platform-Specific Configurations

### Android
```typescript
android: {
  priority: 'high',
  notification: {
    channelId: 'default',
    priority: 'high',
    defaultSound: true,
    defaultVibrateTimings: true,
    imageUrl: payload.imageUrl,
    clickAction: dataPayload.mobileUrl,
  },
  data: dataPayload,
}
```

### iOS (APNS)
```typescript
apns: {
  payload: {
    aps: {
      alert: {
        title: payload.title,
        body: payload.body,
      },
      sound: 'default',
      badge: 1,
      contentAvailable: true,
      mutableContent: true,
    },
  },
  headers: {
    'apns-priority': '10',
  },
  fcmOptions: {
    imageUrl: payload.imageUrl,
  },
}
```

### Web Push
```typescript
webpush: {
  notification: {
    title: payload.title,
    body: payload.body,
    icon: payload.imageUrl || '/icon.png',
    badge: '/badge.png',
    requireInteraction: true,
    data: dataPayload,
  },
  fcmOptions: {
    link: dataPayload.webUrl || dataPayload.universalLink,
  },
}
```

## Integration with Notification Dispatch Service

The PushService is integrated with the NotificationDispatchService:

### In notification-dispatch.service.ts:
```typescript
private async handleMobilePushChannel(
  notification: Notification,
  user: User,
  deliveryId: string,
): Promise<void> {
  // Queue for async processing
  await this.queueService.queueNotificationJob({
    notificationId: notification.id,
    deliveryId,
    channel: NOTIFICATION_CHANNEL.MOBILE_PUSH,
    userId: user.id,
    attempts: 0,
  });

  await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.PROCESSING);
}
```

### Queue Processor Usage:
The queue processor can use PushService to send notifications:

```typescript
// In notification-queue.processor.ts
async processPushNotification(job: NotificationQueueJob) {
  const notification = await this.getNotification(job.notificationId);
  const tokens = await this.pushService.getUserTokens(job.userId);

  // Parse deep links from notification.actionUrl
  const deepLinks = this.deepLinkService.parseNotificationActionUrl(
    notification.actionUrl
  );

  const result = await this.pushService.sendToDevice(
    tokens[0], // or multicast
    {
      title: notification.title,
      body: notification.body,
      deepLinks: deepLinks,
      data: notification.metadata,
    },
    notification.id
  );

  // Update delivery status
  if (result.success) {
    await this.updateDeliveryStatus(job.deliveryId, 'DELIVERED');
  } else {
    await this.updateDeliveryStatus(job.deliveryId, 'FAILED', result.error);
  }
}
```

## Error Handling

The service implements comprehensive error handling:

1. **Firebase Not Initialized**: Returns error response gracefully
2. **Invalid Tokens**: Automatically detected and deactivated
3. **Network Errors**: Logged and returned in response
4. **Missing User Data**: Handles missing phone/email gracefully
5. **Delivery Failures**: Tracked in database for retry logic

## Logging

Comprehensive logging is implemented throughout:
- Initialization status
- Token registration/unregistration
- Notification sending attempts
- Delivery success/failure
- Token deactivation
- Error details with stack traces

## Environment Variables

Required Firebase configuration:
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYour key here\n-----END PRIVATE KEY-----
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
```

## Dependencies

- `firebase-admin` - Firebase Admin SDK
- `@prisma/client` - Database ORM
- `@nestjs/common` - NestJS framework
- `DeepLinkService` - Deep link generation

## Testing

To test the push notification service:

1. **Register a device token** via POST `/notifications/device-token`
2. **Send a test notification** via POST `/push/test` (Admin only)
3. **Check delivery status** in NotificationDelivery table
4. **Verify device tokens** via GET `/notifications/device-tokens`

## Security Considerations

1. **Token Validation**: Device tokens are validated by FCM
2. **User Authentication**: All endpoints require authentication
3. **Authorization**: Test endpoint requires admin role
4. **Token Cleanup**: Invalid tokens are automatically deactivated
5. **Secure Credentials**: Firebase credentials loaded from environment

## Performance Optimizations

1. **Multicast Sending**: Batch notifications to multiple devices
2. **Token Caching**: User tokens fetched once per batch
3. **Async Processing**: Queue-based processing for scalability
4. **Platform Detection**: Optimize payload based on device platform
5. **Error Isolation**: Individual device failures don't affect batch

## Future Enhancements

Potential improvements:
1. Retry logic for failed deliveries
2. Analytics dashboard for delivery rates
3. A/B testing for notification content
4. Scheduled notifications
5. Rich media notifications (images, buttons)
6. Notification templates
7. User preference management
8. Silent notifications for data sync

## Support

For issues or questions:
- Check Firebase Console for FCM errors
- Review application logs for detailed error messages
- Verify Firebase credentials are correctly configured
- Ensure device tokens are registered before sending
