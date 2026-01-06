# Push Notifications - Quick Start Guide

Get up and running with Firebase Cloud Messaging in 5 minutes.

## Step 1: Install Dependencies (30 seconds)

```bash
npm install
```

The `firebase-admin` package has already been added to package.json.

## Step 2: Setup Firebase Project (2 minutes)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (or create a new one)
3. Click **Project Settings** (gear icon) → **Service Accounts**
4. Click **Generate New Private Key**
5. Save the downloaded JSON file

## Step 3: Configure Environment Variables (1 minute)

Add to your `.env` file (extract values from the downloaded JSON):

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

**Important**: Keep the quotes around the private key and preserve the `\n` for line breaks!

## Step 4: Update Database (30 seconds)

```bash
npm run db:push
```

This adds the `DeviceToken` model and `Platform` enum to your database.

## Step 5: Import the Module (30 seconds)

In your `app.module.ts` (or main module):

```typescript
import { PushModule } from '@modules/common/push/push.module';

@Module({
  imports: [
    // ... existing modules
    PushModule,
  ],
})
export class AppModule {}
```

## Step 6: Test It! (1 minute)

Start your server:

```bash
npm run dev
```

The module initializes automatically. Check the logs:

```
[PushService] Firebase Admin SDK initialized successfully
```

## Quick Test

### Get a Device Token

From your mobile app or web app, get the FCM token and register it:

```bash
curl -X POST http://localhost:3030/push/register \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_DEVICE_TOKEN",
    "platform": "ANDROID"
  }'
```

### Send a Test Notification

```bash
curl -X POST http://localhost:3030/push/test \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_DEVICE_TOKEN",
    "title": "Hello!",
    "body": "Your first push notification!"
  }'
```

## Use in Your Code

### Send notification to a user:

```typescript
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class YourService {
  constructor(private readonly pushService: PushService) {}

  async notifyUser() {
    await this.pushService.sendToUser(
      'user-id-here',
      'Order Update',
      'Your order has been shipped!',
      { orderId: '123', status: 'shipped' }
    );
  }
}
```

That's it! You're ready to send push notifications.

## Next Steps

- Read [README.md](./README.md) for comprehensive documentation
- Check [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md) for advanced patterns
- See [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for complete details

## Troubleshooting

### "Firebase not initialized"
- Check your `.env` file has all three Firebase variables
- Verify the private key includes `\n` for line breaks
- Restart your server

### "Invalid registration token"
- Token might be expired or from the wrong project
- Get a fresh token from your mobile/web app
- Verify you're using the correct Firebase project

### Notification not received
- Check device has FCM/APNs properly configured
- Verify token is registered and active in database
- Check Firebase Console → Cloud Messaging for errors
- Review server logs for detailed error messages

## Support

Questions? Check the documentation files:
- README.md - Full documentation
- USAGE_EXAMPLES.md - Code examples
- IMPLEMENTATION_SUMMARY.md - Technical details
