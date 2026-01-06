# Push Notification Usage Examples

## Basic Integration

### 1. Register Device Token on User Login

```typescript
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class AuthService {
  constructor(private readonly pushService: PushService) {}

  async login(userId: string, deviceToken: string, platform: 'IOS' | 'ANDROID' | 'WEB') {
    // ... authenticate user

    // Register device token
    await this.pushService.registerDeviceToken(userId, deviceToken, platform);

    return { accessToken: '...' };
  }
}
```

### 2. Send Notification on Order Update

```typescript
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class OrderService {
  constructor(private readonly pushService: PushService) {}

  async updateOrderStatus(orderId: string, status: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });

    // Send notification to user
    await this.pushService.sendToUser(
      order.userId,
      'Order Update',
      `Your order #${orderId} is now ${status}`,
      {
        orderId,
        status,
        type: 'order_update',
      }
    );
  }
}
```

### 3. Send Notification to Multiple Users

```typescript
import { PushService } from '@modules/common/push/push.service';

@Injectable()
export class AnnouncementService {
  constructor(
    private readonly pushService: PushService,
    private readonly prisma: PrismaService,
  ) {}

  async sendAnnouncement(title: string, message: string, userIds: string[]) {
    // Get all device tokens for these users
    const devices = await this.prisma.deviceToken.findMany({
      where: {
        userId: { in: userIds },
        isActive: true,
      },
      select: { token: true },
    });

    const tokens = devices.map(d => d.token);

    // Send multicast notification
    const result = await this.pushService.sendMulticastNotification(
      tokens,
      title,
      message,
      { type: 'announcement' }
    );

    console.log(`Sent to ${result.success} devices, ${result.failure} failed`);
  }
}
```

## Advanced Use Cases

### Topic-Based Notifications

```typescript
@Injectable()
export class NewsService {
  constructor(private readonly pushService: PushService) {}

  // Subscribe user to news topic
  async subscribeToNews(userId: string) {
    const tokens = await this.pushService.getUserTokens(userId);
    await this.pushService.subscribeToTopic(tokens, 'breaking-news');
  }

  // Send news to all subscribed users
  async sendBreakingNews(headline: string, summary: string, articleId: string) {
    await this.pushService.sendTopicNotification(
      'breaking-news',
      headline,
      summary,
      {
        articleId,
        type: 'news',
      }
    );
  }
}
```

### Scheduled Notifications

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class NotificationScheduler {
  constructor(private readonly pushService: PushService) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDailyReminder() {
    const users = await this.prisma.user.findMany({
      where: { notificationsEnabled: true },
    });

    for (const user of users) {
      await this.pushService.sendToUser(
        user.id,
        'Daily Reminder',
        'Don\'t forget to check your tasks today!',
        { type: 'daily_reminder' }
      );
    }
  }
}
```

### User Preferences Integration

```typescript
@Injectable()
export class NotificationService {
  constructor(
    private readonly pushService: PushService,
    private readonly prisma: PrismaService,
  ) {}

  async sendNotification(
    userId: string,
    type: string,
    title: string,
    body: string,
    data?: any,
  ) {
    // Check user preferences
    const preference = await this.prisma.userNotificationPreference.findFirst({
      where: {
        userId,
        notificationType: type,
        enabled: true,
        channels: { has: 'PUSH' },
      },
    });

    if (!preference) {
      console.log(`User ${userId} has disabled ${type} push notifications`);
      return;
    }

    // Send notification
    return this.pushService.sendToUser(userId, title, body, data);
  }
}
```

### Error Handling and Retry Logic

```typescript
@Injectable()
export class RobustNotificationService {
  constructor(private readonly pushService: PushService) {}

  async sendWithRetry(
    userId: string,
    title: string,
    body: string,
    data?: any,
    maxRetries = 3,
  ) {
    let attempt = 0;
    let lastError: string | undefined;

    while (attempt < maxRetries) {
      const result = await this.pushService.sendToUser(
        userId,
        title,
        body,
        data,
      );

      if (result.success > 0) {
        return { success: true };
      }

      lastError = 'No active devices found';
      attempt++;

      if (attempt < maxRetries) {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }

    return { success: false, error: lastError };
  }
}
```

### Batch Notifications with Queue

```typescript
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class BatchNotificationService {
  constructor(
    @InjectQueue('notifications') private notificationQueue: Queue,
    private readonly pushService: PushService,
  ) {}

  async queueBatchNotifications(
    userIds: string[],
    title: string,
    body: string,
    data?: any,
  ) {
    // Process in batches of 100
    const batchSize = 100;

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);

      await this.notificationQueue.add('send-batch', {
        userIds: batch,
        title,
        body,
        data,
      });
    }
  }

  @Process('send-batch')
  async processBatch(job: Job) {
    const { userIds, title, body, data } = job.data;

    for (const userId of userIds) {
      try {
        await this.pushService.sendToUser(userId, title, body, data);
      } catch (error) {
        console.error(`Failed to send to user ${userId}:`, error);
      }
    }
  }
}
```

### Integration with Event Emitter

```typescript
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class NotificationListener {
  constructor(private readonly pushService: PushService) {}

  @OnEvent('order.created')
  async handleOrderCreated(event: { orderId: string; userId: string; total: number }) {
    await this.pushService.sendToUser(
      event.userId,
      'Order Confirmed',
      `Your order has been confirmed. Total: $${event.total}`,
      {
        orderId: event.orderId,
        type: 'order_created',
      }
    );
  }

  @OnEvent('task.assigned')
  async handleTaskAssigned(event: { taskId: string; userId: string; taskName: string }) {
    await this.pushService.sendToUser(
      event.userId,
      'New Task Assigned',
      `You have been assigned: ${event.taskName}`,
      {
        taskId: event.taskId,
        type: 'task_assigned',
      }
    );
  }

  @OnEvent('payment.received')
  async handlePaymentReceived(event: { userId: string; amount: number }) {
    await this.pushService.sendToUser(
      event.userId,
      'Payment Received',
      `We received your payment of $${event.amount}`,
      {
        amount: event.amount.toString(),
        type: 'payment_received',
      }
    );
  }
}
```

## Client-Side Integration

### React Native (iOS/Android)

```javascript
import messaging from '@react-native-firebase/messaging';
import axios from 'axios';

// Request permission
async function requestUserPermission() {
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  if (enabled) {
    const token = await messaging().getToken();
    await registerToken(token, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
  }
}

// Register token with backend
async function registerToken(token, platform) {
  await axios.post('/push/register', {
    token,
    platform,
  }, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

// Handle foreground messages
messaging().onMessage(async remoteMessage => {
  Alert.alert('New Notification', remoteMessage.notification.body);
});

// Handle background/quit messages
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('Message handled in background:', remoteMessage);
});
```

### Web (Progressive Web App)

```javascript
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "...",
  projectId: "...",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// Request permission and get token
async function registerPushNotifications() {
  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    const token = await getToken(messaging, {
      vapidKey: 'YOUR_VAPID_KEY'
    });

    await fetch('/push/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ token, platform: 'WEB' })
    });
  }
}

// Handle foreground messages
onMessage(messaging, (payload) => {
  console.log('Message received:', payload);
  // Show notification
  new Notification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon.png'
  });
});
```

## Testing

### Test with cURL

```bash
# Register device token
curl -X POST http://localhost:3030/push/register \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_TOKEN",
    "platform": "ANDROID"
  }'

# Send test notification (admin only)
curl -X POST http://localhost:3030/push/test \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_TOKEN",
    "title": "Test Notification",
    "body": "This is a test message",
    "data": {
      "key": "value"
    }
  }'

# Unregister device token
curl -X DELETE http://localhost:3030/push/unregister \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_TOKEN"
  }'
```
