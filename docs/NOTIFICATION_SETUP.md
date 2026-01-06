# Notification System Setup Guide

## Prerequisites
- Redis server running
- Firebase project created
- WhatsApp phone number

## Firebase Setup

### Step 1: Create/Configure Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create new project or select existing project
3. Navigate to Project Settings (gear icon)

### Step 2: Enable Cloud Messaging
1. In the Firebase Console, go to **Build > Cloud Messaging**
2. Enable the Cloud Messaging API
3. Note your **Sender ID** (you'll need this for web/mobile)

### Step 3: Generate Service Account Key
1. Go to **Project Settings > Service Accounts**
2. Click **Generate New Private Key**
3. Download the JSON file
4. Extract the following values:
   - `project_id` -> use for `FIREBASE_PROJECT_ID`
   - `private_key` -> use for `FIREBASE_PRIVATE_KEY`
   - `client_email` -> use for `FIREBASE_CLIENT_EMAIL`

### Step 4: Add to API .env
Add the following to your `api/.env` file:
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
```

**Important:** Keep the private key in quotes and preserve the `\n` newline characters.

### Step 5: Configure Web Push (for web/.env)
1. In Firebase Console, go to **Project Settings > Cloud Messaging**
2. Under **Web Push certificates**, click **Generate key pair**
3. Copy the VAPID key
4. Also note your **Web API Key**, **Project ID**, **Sender ID**, and **App ID** from the **General** tab

Add to `web/.env`:
```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
VITE_FIREBASE_VAPID_KEY=your-vapid-key
```

## WhatsApp Setup

### Initial Setup
1. Ensure you have a phone number available for WhatsApp Business
2. The WhatsApp session will be stored in `.wwebjs_auth/` directory
3. Add to `api/.env`:
```bash
WHATSAPP_SESSION_PATH=./.wwebjs_auth
```

### First Run (QR Code Authentication)
1. Start your API server:
```bash
npm run start:dev
```

2. Watch the console logs for the QR code ASCII art
3. Open WhatsApp on your mobile device
4. Go to **Settings > Linked Devices > Link a Device**
5. Scan the QR code displayed in the terminal
6. Wait for "WhatsApp client is ready!" message

### Subsequent Runs
- Session data is automatically saved to `.wwebjs_auth/`
- The system will auto-login on subsequent runs
- No QR code scan required unless session expires

### Troubleshooting WhatsApp
If you need to re-authenticate:
```bash
# Stop the API server
# Delete the session directory
rm -rf .wwebjs_auth/
# Restart the API server and scan QR code again
```

## Expo Push Notifications Setup

### Step 1: Install EAS CLI
```bash
npm install -g eas-cli
```

### Step 2: Login to Expo
```bash
eas login
```

### Step 3: Configure Your Project
1. Navigate to your mobile app directory:
```bash
cd mobile
```

2. Initialize EAS (if not already done):
```bash
eas init
```

### Step 4: Build Your App
```bash
# For development build
eas build --profile development --platform all

# For production build
eas build --profile production --platform all
```

### Step 5: Get Project ID
1. Go to [Expo Dashboard](https://expo.dev/)
2. Select your project
3. Copy the **Project ID** from the project settings
4. Add to `mobile/.env`:
```bash
EXPO_PROJECT_ID=your-expo-project-id
```

### Step 6: Configure Deep Linking
Add the following to `mobile/.env`:
```bash
EXPO_PUBLIC_APP_SCHEME=yourapp
EXPO_PUBLIC_WEB_URL=https://yourapp.com
```

Update your `app.json` or `app.config.js` to include:
```json
{
  "expo": {
    "scheme": "yourapp",
    "ios": {
      "associatedDomains": ["applinks:yourapp.com"]
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [
            {
              "scheme": "https",
              "host": "yourapp.com",
              "pathPrefix": "/app"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

## Redis Configuration

### Development (Local Redis)
1. Install Redis:
```bash
# Ubuntu/Debian
sudo apt-get install redis-server

# macOS
brew install redis
```

2. Start Redis:
```bash
# Ubuntu/Debian
sudo systemctl start redis

# macOS
brew services start redis
```

3. Verify Redis is running:
```bash
redis-cli ping
# Should return: PONG
```

### Production
Add Redis configuration to `api/.env`:
```bash
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0
```

## Notification Queue Configuration

Add to `api/.env`:
```bash
NOTIFICATION_QUEUE_CONCURRENCY=5
```

This controls how many notifications are processed simultaneously. Adjust based on your system resources:
- **Low traffic:** 3-5
- **Medium traffic:** 5-10
- **High traffic:** 10-20

## Testing the Setup

### 1. Check WhatsApp Status
```bash
curl http://localhost:3030/whatsapp/status
```

Expected response:
```json
{
  "status": "ready",
  "isConnected": true
}
```

### 2. Send Test Notification
```bash
curl -X POST http://localhost:3030/admin/notifications/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "userId": "user-id",
    "type": "system",
    "channels": ["push", "whatsapp"]
  }'
```

### 3. Check Notification Queue
```bash
# Connect to Redis CLI
redis-cli

# Check queue length
LLEN bull:notifications:wait

# View pending jobs
LRANGE bull:notifications:wait 0 -1
```

### 4. Monitor Logs
Watch your API logs for notification processing:
```bash
npm run start:dev
```

Look for log messages like:
- `[NotificationService] Processing notification...`
- `[WhatsAppService] Message sent successfully`
- `[FirebaseService] Push notification sent`

## Common Issues

### WhatsApp QR Code Not Appearing
- Check that port 3030 is not blocked
- Ensure WhatsApp Web is not already logged in on another device
- Try clearing `.wwebjs_auth/` and restarting

### Firebase Push Notifications Not Working
- Verify all Firebase environment variables are set correctly
- Check that the service account has Cloud Messaging permissions
- Ensure VAPID key is correctly configured for web push

### Redis Connection Errors
- Verify Redis is running: `redis-cli ping`
- Check Redis host and port in `.env`
- Ensure firewall allows Redis connections

### Expo Push Notifications Not Working
- Verify `EXPO_PROJECT_ID` is correct
- Ensure you're testing on a physical device (push doesn't work on simulators)
- Check that you've built the app with EAS

## Environment Variables Summary

### API (.env)
```bash
NOTIFICATION_QUEUE_CONCURRENCY=5
WHATSAPP_SESSION_PATH=./.wwebjs_auth
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
WEB_APP_URL=https://yourapp.com
MOBILE_APP_SCHEME=yourapp
WEB_BASE_URL=https://yourapp.com
MOBILE_UNIVERSAL_LINK=https://yourapp.com/app
```

### Web (.env)
```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
VITE_FIREBASE_VAPID_KEY=your-vapid-key
```

### Mobile (.env)
```bash
EXPO_PROJECT_ID=your-expo-project-id
EXPO_PUBLIC_APP_SCHEME=yourapp
EXPO_PUBLIC_WEB_URL=https://yourapp.com
```

## Next Steps

1. Follow the [Migration Guide](./NOTIFICATION_MIGRATION.md) to set up the database
2. Configure notification preferences for existing users
3. Test notifications in development
4. Deploy to staging for integration testing
5. Roll out to production

## Support

For issues or questions:
- Check the [troubleshooting section](#common-issues) above
- Review API logs for detailed error messages
- Consult Firebase and Expo documentation for platform-specific issues
