# Firebase Cloud Messaging Configuration Summary

This document provides a complete overview of the Firebase Cloud Messaging (FCM) setup for push notifications in the Ankaa API.

## Overview

Firebase Cloud Messaging has been configured to enable push notifications across web, iOS, and Android platforms. The setup includes:

1. **FirebaseConfigService** - Centralized Firebase Admin SDK initialization
2. **PushService** - Push notification delivery and device management
3. **PushModule** - NestJS module configuration
4. Environment variable configuration with two flexible options

## Files Created/Modified

### New Files

1. **`/src/modules/common/notification/push/firebase-config.service.ts`**
   - Centralized Firebase Admin SDK initialization service
   - Supports multiple initialization methods (environment variables or service account file)
   - Provides access to Firebase services (Messaging, Firestore, Auth)
   - Includes configuration validation and health checks

2. **`/src/modules/common/notification/push/index.ts`**
   - Export file for Firebase push notification module

### Modified Files

1. **`/src/modules/common/push/push.module.ts`**
   - Added FirebaseConfigService as a provider
   - Exported FirebaseConfigService for use in other modules

2. **`/.env.example`**
   - Updated Firebase configuration section with detailed examples
   - Added both configuration options (environment variables and service account file)

3. **`/src/modules/common/push/.env.example`**
   - Enhanced with comprehensive documentation
   - Added step-by-step instructions for obtaining credentials

4. **`/.gitignore`**
   - Added specific entries for Firebase service account files
   - Ensures credentials are never committed to version control

### Existing Documentation

1. **`/src/modules/common/notification/push/FIREBASE_SETUP.md`**
   - Already contains comprehensive step-by-step setup instructions
   - Includes troubleshooting guide and client configuration examples

## Required Environment Variables

### Option 1: Individual Environment Variables (Recommended for Production)

```bash
# Firebase Project ID
FIREBASE_PROJECT_ID=your-project-id

# Firebase Private Key (must include \n for line breaks)
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"

# Firebase Service Account Email
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

### Option 2: Service Account File Path (Recommended for Development)

```bash
# Path to Firebase service account JSON file
FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
```

**Note**: Only ONE option is required. If both are provided, the service account file path takes precedence.

## How to Obtain Firebase Credentials

### Quick Steps

1. **Go to Firebase Console**: https://console.firebase.google.com/
2. **Select your project** (or create a new one)
3. **Navigate to Project Settings** (gear icon)
4. **Go to "Service Accounts" tab**
5. **Click "Generate new private key"**
6. **Download the JSON file**
7. **Extract credentials** or use the file path

### Extracting Values from Service Account JSON

If using Option 1 (environment variables), extract these values from the downloaded JSON:

```json
{
  "project_id": "your-project-id",              // → FIREBASE_PROJECT_ID
  "private_key": "-----BEGIN PRIVATE KEY...",   // → FIREBASE_PRIVATE_KEY
  "client_email": "firebase-adminsdk-..."       // → FIREBASE_CLIENT_EMAIL
}
```

## Package Dependencies

### Already Installed

The following package is already installed in the project:

- **firebase-admin** (v12.7.0) - Firebase Admin SDK for Node.js

### No Additional Installation Required

The `firebase-admin` SDK is already present in `package.json` and does not need to be installed.

## Architecture

### FirebaseConfigService

**Location**: `/src/modules/common/notification/push/firebase-config.service.ts`

**Features**:
- Automatic initialization on module load via `OnModuleInit`
- Support for two initialization methods:
  1. Service account file path
  2. Individual environment variables
- Singleton pattern (only initializes once)
- Provides access to Firebase services:
  - `getApp()` - Firebase App instance
  - `getMessaging()` - Firebase Cloud Messaging instance
  - `getFirestore()` - Firestore instance
  - `getAuth()` - Firebase Auth instance
- Configuration validation and health checks
- Comprehensive logging

**Usage Example**:

```typescript
import { FirebaseConfigService } from '@modules/common/notification/push/firebase-config.service';

@Injectable()
export class MyService {
  constructor(private readonly firebaseConfig: FirebaseConfigService) {}

  async sendNotification() {
    const messaging = this.firebaseConfig.getMessaging();
    if (!messaging) {
      throw new Error('Firebase not initialized');
    }

    // Use messaging service...
  }

  async checkHealth() {
    const validation = await this.firebaseConfig.validateConfiguration();
    return validation;
  }
}
```

### PushService Integration

**Location**: `/src/modules/common/push/push.service.ts`

The existing PushService already handles Firebase initialization internally, but can be enhanced to use the new FirebaseConfigService for better separation of concerns.

**Current Features**:
- Send push notifications to individual devices
- Send multicast notifications (multiple devices)
- Send topic-based notifications
- Device token registration and management
- Automatic token cleanup for invalid tokens
- Deep link support
- Delivery tracking and status updates
- Platform-specific optimizations (Android, iOS, Web)

### PushModule Configuration

**Location**: `/src/modules/common/push/push.module.ts`

The module has been updated to include FirebaseConfigService:

```typescript
@Module({
  imports: [PrismaModule, ConfigModule, JwtModule],
  providers: [
    FirebaseConfigService,  // ← Added
    PushService,
    DeepLinkService,
    // ...
  ],
  controllers: [PushController],
  exports: [PushService, FirebaseConfigService],  // ← Export FirebaseConfigService
})
export class PushModule {}
```

## Usage Examples

### 1. Send Push Notification to a Single Device

```typescript
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class NotificationService {
  constructor(private readonly pushService: PushService) {}

  async notifyUser(deviceToken: string) {
    const result = await this.pushService.sendPushNotification(
      deviceToken,
      'Hello!',
      'This is a test notification',
      { customData: 'value' }
    );

    if (result.success) {
      console.log('Notification sent:', result.messageId);
    } else {
      console.error('Failed to send:', result.error);
    }
  }
}
```

### 2. Send to All User Devices

```typescript
const result = await this.pushService.sendToUser(
  'user-id',
  'New Message',
  'You have received a new message',
  { type: 'message', id: '123' }
);
```

### 3. Send with Deep Links

```typescript
import { DeepLinkService } from '@modules/common/notification/deep-link.service';

constructor(
  private readonly pushService: PushService,
  private readonly deepLinkService: DeepLinkService,
) {}

async notifyWithDeepLink(userId: string, taskId: string) {
  const deepLinks = this.deepLinkService.generateTaskLinks(taskId, {
    action: 'view',
    source: 'notification'
  });

  const tokens = await this.pushService.getUserTokens(userId);

  for (const token of tokens) {
    await this.pushService.sendToDevice(
      token,
      {
        title: 'New Task',
        body: 'You have been assigned a new task',
        deepLinks: deepLinks,
        data: { taskId }
      }
    );
  }
}
```

### 4. Topic-Based Notifications

```typescript
// Subscribe users to a topic
await this.pushService.subscribeToTopic(
  ['token1', 'token2'],
  'announcements'
);

// Send to topic
await this.pushService.sendTopicNotification(
  'announcements',
  'Important Update',
  'We have released a new feature!',
  { version: '2.0' }
);
```

### 5. Register Device Token

```typescript
await this.pushService.registerDeviceToken(
  'user-id',
  'device-token-from-client',
  'IOS' // or 'ANDROID' or 'WEB'
);
```

## Testing Your Setup

### 1. Verify Configuration

Start your application and check the logs:

```bash
npm run dev
```

**Expected output**:
```
[FirebaseConfigService] Initializing Firebase from environment variables...
[FirebaseConfigService] Firebase Admin SDK initialized successfully
[FirebaseConfigService] Project ID: your-project-id
[FirebaseConfigService] Client Email: firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

### 2. Health Check Endpoint

You can add a health check endpoint to verify Firebase status:

```typescript
@Get('/health/firebase')
async checkFirebase() {
  const validation = await this.firebaseConfig.validateConfiguration();
  const summary = this.firebaseConfig.getConfigurationSummary();

  return {
    ...validation,
    ...summary
  };
}
```

### 3. Send Test Notification

Use cURL or Postman to test:

```bash
curl -X POST http://localhost:3030/api/push/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "token": "device-token-here",
    "title": "Test",
    "body": "This is a test notification"
  }'
```

## Security Best Practices

### 1. Credential Management

- ✅ **Never commit credentials to version control**
- ✅ Use environment variables in production
- ✅ Use secret management services (AWS Secrets Manager, Google Secret Manager)
- ✅ Rotate credentials regularly
- ✅ Restrict service account permissions

### 2. .gitignore Configuration

The following patterns are already in `.gitignore`:

```gitignore
# Environment files
.env*
!.env.example

# Firebase credentials
firebase-service-account.json
**/firebase-service-account*.json
config/firebase*.json
```

### 3. Production Deployment

For production environments:

1. **Use environment variables** (not service account files)
2. **Store credentials in secure vault** (AWS Secrets Manager, etc.)
3. **Use least-privilege service accounts**
4. **Enable audit logging in Firebase Console**
5. **Monitor FCM usage and quotas**

## Troubleshooting

### Error: "Firebase credentials not configured"

**Solution**: Ensure you have set either:
- All three environment variables (FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL)
- OR the service account file path (FIREBASE_SERVICE_ACCOUNT_PATH)

### Error: "INVALID_ARGUMENT: Request contains an invalid argument"

**Common causes**:
- Private key format is incorrect (missing `\n` characters)
- Incorrect project ID
- Mismatched service account credentials

**Solution**:
- Verify the private key includes `\n` for line breaks
- Check that the project ID matches your Firebase project
- Ensure all credentials are from the same service account

### Error: "Firebase not initialized"

**Common causes**:
- Firebase initialization failed during startup
- Missing credentials
- Network issues

**Solution**:
- Check application logs for initialization errors
- Verify credentials are correct
- Ensure Firebase Cloud Messaging API is enabled

### Notifications Not Received

**Checklist**:
- [ ] Device token is registered in database
- [ ] Platform (IOS/ANDROID/WEB) matches device
- [ ] Device has granted notification permissions
- [ ] Firebase Cloud Messaging API is enabled
- [ ] Service account has correct permissions
- [ ] Network connectivity is working

## Additional Resources

### Documentation

- Firebase Cloud Messaging: https://firebase.google.com/docs/cloud-messaging
- Firebase Admin SDK: https://firebase.google.com/docs/admin/setup
- FCM HTTP v1 API: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages

### Client Setup Guides

- Android: https://firebase.google.com/docs/cloud-messaging/android/client
- iOS: https://firebase.google.com/docs/cloud-messaging/ios/client
- Web: https://firebase.google.com/docs/cloud-messaging/js/client

### Internal Documentation

- `/src/modules/common/notification/push/FIREBASE_SETUP.md` - Detailed setup instructions
- `/src/modules/common/push/IMPLEMENTATION_SUMMARY.md` - Push service implementation details
- `/src/modules/common/push/QUICKSTART.md` - Quick start guide
- `/src/modules/common/push/USAGE_EXAMPLES.md` - Usage examples

## Next Steps

1. **Set up Firebase project** if you haven't already
2. **Generate service account credentials** from Firebase Console
3. **Configure environment variables** in your `.env` file
4. **Test the configuration** by starting the application
5. **Send a test notification** to verify everything works
6. **Configure mobile/web clients** to receive notifications
7. **Implement notification preferences** for users

## Support

For issues or questions:
1. Check application logs for detailed error messages
2. Review the Firebase Console for API status
3. Consult this documentation and related files
4. Contact your development team for assistance

---

**Last Updated**: January 5, 2026
**Version**: 1.0.0
**Maintained by**: Development Team
