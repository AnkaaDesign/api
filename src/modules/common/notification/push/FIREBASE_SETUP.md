# Firebase Cloud Messaging (FCM) Setup Instructions

## Overview

This guide will walk you through setting up Firebase Cloud Messaging for your NestJS application, including creating a Firebase project, generating credentials, and configuring your application.

## Prerequisites

- Google account
- Node.js and npm installed
- NestJS application running
- Access to your server environment variables

## Step 1: Create a Firebase Project

1. **Go to Firebase Console**
   - Visit [https://console.firebase.google.com/](https://console.firebase.google.com/)
   - Click "Add project" or "Create a project"

2. **Configure Your Project**
   - Enter your project name (e.g., "MyApp Notifications")
   - Choose whether to enable Google Analytics (optional)
   - Click "Create project"
   - Wait for the project to be created

3. **Navigate to Project Settings**
   - Click the gear icon next to "Project Overview"
   - Select "Project settings"

## Step 2: Enable Cloud Messaging

1. **Navigate to Cloud Messaging**
   - In Project Settings, click on the "Cloud Messaging" tab
   - You should see your Server key and Sender ID

2. **Enable Cloud Messaging API**
   - Click "Manage API in Google Cloud Console"
   - Enable the "Firebase Cloud Messaging API"
   - Enable the "Cloud Messaging" API (if not already enabled)

## Step 3: Generate Service Account Credentials

1. **Navigate to Service Accounts**
   - In Project Settings, click on the "Service accounts" tab
   - Click "Generate new private key"

2. **Download JSON Key**
   - A dialog will appear warning you to keep the key secure
   - Click "Generate key"
   - A JSON file will be downloaded to your computer
   - **Keep this file secure and never commit it to version control!**

3. **Example JSON Structure**
   ```json
   {
     "type": "service_account",
     "project_id": "your-project-id",
     "private_key_id": "abc123...",
     "private_key": "-----BEGIN PRIVATE KEY-----\nYour key here\n-----END PRIVATE KEY-----\n",
     "client_email": "firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com",
     "client_id": "123456789",
     "auth_uri": "https://accounts.google.com/o/oauth2/auth",
     "token_uri": "https://oauth2.googleapis.com/token",
     "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
     "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
   }
   ```

## Step 4: Configure Environment Variables

1. **Extract Required Values**
   From the downloaded JSON file, extract:
   - `project_id`
   - `private_key`
   - `client_email`

2. **Add to .env File**
   ```env
   # Firebase Cloud Messaging Configuration
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour key here\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
   ```

3. **Important Notes**
   - The `FIREBASE_PRIVATE_KEY` must include the newline characters (`\n`)
   - Keep the quotes around the private key
   - The service automatically replaces `\\n` with actual newlines

4. **For Production (Docker/Cloud)**
   If deploying to production, you may need to handle the private key differently:

   **Option A: Environment Variable (Recommended)**
   ```bash
   # In your deployment pipeline
   export FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
   Your key here
   -----END PRIVATE KEY-----"
   ```

   **Option B: Base64 Encoding**
   ```bash
   # Encode the key
   echo "YOUR_PRIVATE_KEY" | base64

   # In your app, decode it
   const privateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64').toString('utf-8');
   ```

## Step 5: Verify Installation

1. **Check Dependencies**
   Verify `firebase-admin` is installed:
   ```bash
   npm list firebase-admin
   ```

   If not installed:
   ```bash
   npm install firebase-admin
   ```

2. **Start Your Application**
   ```bash
   npm run start:dev
   ```

3. **Check Logs**
   You should see:
   ```
   [PushService] Firebase Admin SDK initialized successfully
   ```

   If you see a warning:
   ```
   [PushService] Firebase credentials not configured. Push notifications will be disabled.
   ```
   Double-check your environment variables.

## Step 6: Test Push Notifications

### 6.1 Get a Device Token

**For Android:**
```kotlin
// In your Android app
FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
    if (task.isSuccessful) {
        val token = task.result
        Log.d("FCM Token", token)
        // Send this token to your backend
    }
}
```

**For iOS:**
```swift
// In your iOS app
Messaging.messaging().token { token, error in
    if let error = error {
        print("Error fetching FCM token: \(error)")
    } else if let token = token {
        print("FCM token: \(token)")
        // Send this token to your backend
    }
}
```

**For Web:**
```javascript
// In your web app
import { getMessaging, getToken } from "firebase/messaging";

const messaging = getMessaging();
getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY' })
  .then((currentToken) => {
    if (currentToken) {
      console.log('FCM Token:', currentToken);
      // Send this token to your backend
    }
  });
```

### 6.2 Register Device Token

```bash
curl -X POST http://localhost:3000/notifications/device-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "token": "YOUR_FCM_DEVICE_TOKEN",
    "platform": "ANDROID"
  }'
```

### 6.3 Send Test Notification (Admin Only)

```bash
curl -X POST http://localhost:3000/push/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "token": "YOUR_FCM_DEVICE_TOKEN",
    "title": "Test Notification",
    "body": "This is a test push notification",
    "data": {
      "type": "test",
      "timestamp": "2025-01-05T12:00:00Z"
    }
  }'
```

### 6.4 Send Notification Programmatically

```typescript
import { PushService } from '@modules/common/push/push.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';

// In your service
constructor(
  private readonly pushService: PushService,
  private readonly deepLinkService: DeepLinkService,
) {}

async sendNotificationToUser(userId: string, taskId: string) {
  // Generate deep links
  const deepLinks = this.deepLinkService.generateTaskLinks(taskId, {
    action: 'view',
    source: 'notification'
  });

  // Send to all user's devices
  const result = await this.pushService.sendToDevice(
    userDeviceToken,
    {
      title: 'New Task Assignment',
      body: 'You have been assigned a new task',
      deepLinks: deepLinks,
      data: {
        taskId: taskId,
        type: 'task_assignment'
      }
    },
    notificationId
  );

  return result;
}
```

## Step 7: Configure Mobile/Web Clients

### Android Configuration

1. **Add google-services.json**
   - Download `google-services.json` from Firebase Console
   - Place in `android/app/` directory

2. **Update build.gradle**
   ```gradle
   // Project-level build.gradle
   dependencies {
     classpath 'com.google.gms:google-services:4.3.15'
   }

   // App-level build.gradle
   plugins {
     id 'com.google.gms.google-services'
   }

   dependencies {
     implementation 'com.google.firebase:firebase-messaging:23.1.2'
   }
   ```

3. **Add Service**
   ```kotlin
   class MyFirebaseMessagingService : FirebaseMessagingService() {
     override fun onMessageReceived(remoteMessage: RemoteMessage) {
       // Handle FCM messages here
       val title = remoteMessage.notification?.title
       val body = remoteMessage.notification?.body
       val data = remoteMessage.data

       // Extract deep links
       val mobileUrl = data["mobileUrl"]
       val webUrl = data["webUrl"]

       // Show notification and handle click
     }

     override fun onNewToken(token: String) {
       // Send token to backend
       registerDeviceToken(token)
     }
   }
   ```

### iOS Configuration

1. **Add GoogleService-Info.plist**
   - Download from Firebase Console
   - Add to Xcode project

2. **Configure App Delegate**
   ```swift
   import FirebaseCore
   import FirebaseMessaging

   @UIApplicationMain
   class AppDelegate: UIResponder, UIApplicationDelegate {
     func application(_ application: UIApplication,
                      didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
       FirebaseApp.configure()
       Messaging.messaging().delegate = self

       UNUserNotificationCenter.current().delegate = self

       return true
     }
   }

   extension AppDelegate: MessagingDelegate {
     func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
       // Send token to backend
       registerDeviceToken(fcmToken)
     }
   }
   ```

### Web Configuration

1. **Add Firebase Config**
   ```javascript
   import { initializeApp } from 'firebase/app';
   import { getMessaging, onMessage } from 'firebase/messaging';

   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };

   const app = initializeApp(firebaseConfig);
   const messaging = getMessaging(app);

   onMessage(messaging, (payload) => {
     console.log('Message received:', payload);
     // Handle foreground messages
   });
   ```

2. **Add Service Worker (firebase-messaging-sw.js)**
   ```javascript
   importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
   importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

   firebase.initializeApp({
     apiKey: "YOUR_API_KEY",
     projectId: "your-project-id",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   });

   const messaging = firebase.messaging();

   messaging.onBackgroundMessage((payload) => {
     console.log('Background message:', payload);
     // Handle background messages
   });
   ```

## Step 8: Security Best Practices

1. **Protect Service Account Credentials**
   - Never commit credentials to Git
   - Use environment variables or secret management
   - Rotate keys periodically

2. **Secure Token Storage**
   - Store device tokens securely in database
   - Implement token cleanup for inactive devices
   - Validate tokens before sending

3. **Rate Limiting**
   - Implement rate limiting for notification endpoints
   - Prevent abuse of test notification endpoint
   - Monitor FCM quota usage

4. **User Privacy**
   - Allow users to opt-out of notifications
   - Respect notification preferences
   - Implement Do Not Disturb schedules

## Troubleshooting

### Common Issues

1. **"Firebase not initialized"**
   - Check environment variables are set correctly
   - Verify private key format (newlines preserved)
   - Ensure Firebase SDK is installed

2. **"Invalid registration token"**
   - Token may be expired or invalid
   - Re-register the device token
   - Check token format

3. **"Permission denied"**
   - Verify service account has FCM permissions
   - Check Firebase Cloud Messaging API is enabled
   - Verify project ID matches

4. **Notifications not received**
   - Check device token is registered
   - Verify platform matches device
   - Check device notification permissions
   - Review Firebase Console logs

### Debug Checklist

- [ ] Firebase project created
- [ ] Cloud Messaging API enabled
- [ ] Service account credentials downloaded
- [ ] Environment variables configured
- [ ] firebase-admin installed
- [ ] Application started successfully
- [ ] Device token registered
- [ ] Platform correctly specified
- [ ] Test notification sent
- [ ] Device notification permissions granted

## Additional Resources

- [Firebase Cloud Messaging Documentation](https://firebase.google.com/docs/cloud-messaging)
- [Firebase Admin SDK Documentation](https://firebase.google.com/docs/admin/setup)
- [FCM HTTP v1 API](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)
- [Android FCM Setup](https://firebase.google.com/docs/cloud-messaging/android/client)
- [iOS FCM Setup](https://firebase.google.com/docs/cloud-messaging/ios/client)
- [Web FCM Setup](https://firebase.google.com/docs/cloud-messaging/js/client)

## Support

For issues specific to this implementation, please refer to:
- Implementation Summary: `IMPLEMENTATION_SUMMARY.md`
- Service code: `push.service.ts`
- Application logs: Check NestJS console output
