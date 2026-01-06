# Mailer Service - Quick Start Guide

Get started with the enhanced mailer service in 5 minutes.

## Installation

### 1. Import the Module

```typescript
import { Module } from '@nestjs/common';
import { MailerModule } from '@modules/common/mailer';

@Module({
  imports: [MailerModule],
  // ...
})
export class YourModule {}
```

### 2. Inject the Service

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationMailerService } from '@modules/common/mailer';

@Injectable()
export class YourService {
  constructor(
    private readonly notificationMailer: NotificationMailerService,
  ) {}
}
```

## Basic Usage

### Send a Simple Email

```typescript
async sendWelcomeEmail(email: string, userName: string) {
  const result = await this.notificationMailer.sendNotificationEmail({
    to: email,
    userName,
    title: 'Welcome to Our Platform!',
    body: 'Thank you for joining us. Get started by exploring our features.',
    importance: 'HIGH',
    actionUrl: 'https://app.example.com/getting-started',
    actionText: 'Get Started',
  });

  return result.success;
}
```

### Send to Multiple Recipients

```typescript
async sendBulkEmail(users: Array<{ email: string; name: string }>) {
  const result = await this.notificationMailer.sendBulkNotificationEmails({
    recipients: users.map(user => ({
      email: user.email,
      userName: user.name,
      title: 'Important Announcement',
      body: 'We have exciting news to share with you!',
      importance: 'MEDIUM',
    })),
  });

  console.log(`Sent: ${result.success}, Failed: ${result.failed}`);
  return result;
}
```

## Common Patterns

### Pattern 1: Send Email After Creating Notification

```typescript
async notifyUser(userId: string, email: string, data: any) {
  // Create notification in database
  const notification = await this.notificationService.createNotification({
    userId,
    title: data.title,
    body: data.body,
    channel: ['EMAIL', 'IN_APP'],
    importance: data.importance,
  });

  // Send email
  await this.notificationMailer.sendNotificationEmail({
    to: email,
    title: data.title,
    body: data.body,
    importance: data.importance,
  });

  // Update notification status
  await this.notificationService.updateNotification(notification.data.id, {
    sentAt: new Date(),
  });
}
```

### Pattern 2: Handle Email Failures

```typescript
async sendWithRetry(email: string, data: any) {
  const result = await this.notificationMailer.sendNotificationEmail({
    to: email,
    ...data,
  });

  if (!result.success) {
    // Log failure
    console.error(`Failed to send email: ${result.error}`);

    // Store in retry queue
    await this.queueFailedEmail(email, data, result.errorCode);
  }

  return result.success;
}
```

### Pattern 3: Scheduled Emails

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async sendScheduledEmails() {
  // Get scheduled notifications
  const notifications = await this.getScheduledNotifications();

  // Send emails
  const result = await this.notificationMailer.sendBulkNotificationEmails({
    recipients: notifications.map(n => ({
      email: n.user.email,
      userName: n.user.name,
      title: n.title,
      body: n.body,
      importance: n.importance,
    })),
  });

  // Update sent status
  await this.updateSentNotifications(result);
}
```

## Configuration

### Environment Variables

Add to your `.env` file:

```env
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
API_URL=https://your-api.com
```

### Rate Limiting (Optional)

```typescript
// Configure rate limits for your use case
this.notificationMailer.updateRateLimitConfig({
  batchSize: 20,              // Emails per batch
  delayBetweenBatches: 3000,  // 3 seconds delay
  maxConcurrent: 10,          // Max concurrent sends
});
```

## Importance Levels

Choose the right importance level for your emails:

```typescript
// Critical alerts
importance: 'URGENT'  // Red styling, [URGENTE] prefix

// Important notifications
importance: 'HIGH'    // Orange styling, [IMPORTANTE] prefix

// Regular notifications
importance: 'MEDIUM'  // Yellow styling

// Low priority
importance: 'LOW'     // Default green styling
```

## Email Features

### Action Buttons

```typescript
{
  actionUrl: 'https://app.example.com/confirm',
  actionText: 'Confirm Now',
}
```

### Metadata

```typescript
{
  metadata: {
    'Order Number': '#12345',
    'Amount': '$99.99',
    'Date': '2026-01-05',
  }
}
```

### Full Example

```typescript
await this.notificationMailer.sendNotificationEmail({
  to: 'user@example.com',
  userName: 'John Doe',
  title: 'Order Confirmation',
  body: 'Your order has been confirmed and will be shipped soon.',
  importance: 'HIGH',
  actionUrl: 'https://app.example.com/orders/12345',
  actionText: 'Track Order',
  metadata: {
    'Order Number': '#12345',
    'Total Amount': '$99.99',
    'Estimated Delivery': 'Jan 10, 2026',
  },
});
```

## Monitoring

### Check Statistics

```typescript
const stats = this.notificationMailer.getStatistics();
console.log(stats);
// {
//   totalTracked: 1000,
//   successRate: 98.5,
//   failureRate: 1.5,
//   averageRetries: 0.3
// }
```

### Health Check

```typescript
const isHealthy = await this.notificationMailer.healthCheck();
if (!isHealthy) {
  // Alert admin
}
```

## Error Handling

### Basic Error Handling

```typescript
const result = await this.notificationMailer.sendNotificationEmail(data);

if (result.success) {
  console.log('Email sent successfully');
} else {
  console.error('Failed to send email:', result.error);
  console.error('Error code:', result.errorCode);
}
```

### Advanced Error Handling

```typescript
const result = await this.notificationMailer.sendBulkNotificationEmails({
  recipients,
});

// Check for failures
if (result.failed > 0) {
  for (const error of result.errors) {
    switch (error.errorCode) {
      case 'INVALID_RECIPIENT':
        // Mark email as invalid
        break;
      case 'RATE_LIMITED':
        // Retry later
        break;
      case 'MAILBOX_FULL':
        // Notify user via SMS
        break;
      default:
        // Log for investigation
        break;
    }
  }
}
```

## Best Practices

### ✅ DO

- Use appropriate importance levels
- Handle email failures gracefully
- Monitor statistics regularly
- Use bulk sending for multiple recipients
- Include action buttons for user engagement
- Add metadata for context

### ❌ DON'T

- Send emails one-by-one in loops (use bulk sending)
- Ignore failure rates
- Use URGENT for non-critical emails
- Forget to handle errors
- Block request threads waiting for email delivery

## Troubleshooting

### Emails Not Sending

1. Check environment variables
2. Verify SMTP credentials
3. Check health status: `await healthCheck()`
4. Review logs for errors

### High Failure Rate

1. Check SMTP provider status
2. Review error codes in statistics
3. Verify rate limit configuration
4. Check recipient email addresses

### Slow Bulk Sending

1. Increase batch size
2. Increase max concurrent sends
3. Decrease delay between batches
4. Check network latency

## Next Steps

- Read [README.md](./README.md) for complete documentation
- See [INTEGRATION_EXAMPLE.md](./INTEGRATION_EXAMPLE.md) for advanced examples
- Review [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for architecture details

## Need Help?

Check the inline documentation in the service files:
- `NotificationMailerService` - High-level API
- `MailerService` - Low-level sending
- `EmailTemplateService` - Template rendering

All methods include JSDoc comments with parameter descriptions and examples.
