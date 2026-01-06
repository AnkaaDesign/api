# Enhanced Mailer Service

Production-ready email service with notification system integration, featuring advanced delivery tracking, rate limiting, bulk sending, and comprehensive error handling.

## Overview

The mailer module provides three main services:

1. **EmailService** - Original service for standard email operations (verification, password reset, etc.)
2. **MailerService** - Low-level service with retry logic, rate limiting, and delivery tracking
3. **EmailTemplateService** - Template rendering service with HTML and plain text generation
4. **NotificationMailerService** - High-level service integrating mailer and template services

## Features

### Core Features
- Email delivery with automatic retry logic
- SMTP error categorization and handling
- Delivery tracking and monitoring
- HTML and plain text email versions
- Template variable substitution
- Email validation

### Advanced Features
- **Rate Limiting**: Configurable batch processing with delays
- **Bulk Sending**: Send to multiple recipients efficiently
- **Delivery Tracking**: Track every email delivery attempt
- **Error Recovery**: Automatic retry with exponential backoff
- **Statistics**: Monitor success rates and performance

## Installation

The mailer module is already configured in the common modules. To use it in your module:

```typescript
import { Module } from '@nestjs/common';
import { MailerModule } from '@modules/common/mailer';

@Module({
  imports: [MailerModule],
  // ...
})
export class YourModule {}
```

## Usage

### Basic Notification Email

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationMailerService } from '@modules/common/mailer';

@Injectable()
export class YourService {
  constructor(
    private readonly notificationMailer: NotificationMailerService,
  ) {}

  async sendWelcomeNotification(email: string, userName: string) {
    const result = await this.notificationMailer.sendNotificationEmail({
      to: email,
      title: 'Bem-vindo ao Sistema!',
      body: 'Sua conta foi criada com sucesso. Comece a explorar!',
      userName,
      importance: 'HIGH',
      actionUrl: 'https://app.example.com/dashboard',
      actionText: 'Acessar Dashboard',
      metadata: {
        'ID da Conta': '12345',
        'Data de Criação': new Date().toLocaleDateString('pt-BR'),
      },
    });

    if (result.success) {
      console.log('Email sent successfully!');
    } else {
      console.error('Failed to send email:', result.error);
    }
  }
}
```

### Bulk Notification Emails

```typescript
async sendBulkNotifications(users: Array<{ email: string; name: string }>) {
  const result = await this.notificationMailer.sendBulkNotificationEmails({
    recipients: users.map(user => ({
      email: user.email,
      userName: user.name,
      title: 'Nova Atualização Disponível',
      body: 'Acabamos de lançar novas funcionalidades no sistema!',
      importance: 'MEDIUM',
      actionUrl: 'https://app.example.com/updates',
      actionText: 'Ver Novidades',
    })),
  });

  console.log(`Sent: ${result.success}, Failed: ${result.failed}`);

  // Check failed emails
  if (result.failed > 0) {
    console.error('Failed emails:', result.errors);
  }
}
```

### Using MailerService Directly

For more control over the email sending process:

```typescript
import { Injectable } from '@nestjs/common';
import { MailerService, EmailTemplateService } from '@modules/common/mailer';

@Injectable()
export class YourService {
  constructor(
    private readonly mailer: MailerService,
    private readonly templateService: EmailTemplateService,
  ) {}

  async sendCustomEmail(to: string) {
    // Render template
    const rendered = this.templateService.renderNotificationTemplate({
      ...this.templateService.createBaseEmailData('John Doe'),
      title: 'Custom Notification',
      body: 'This is a custom email with full control.',
      importance: 'HIGH',
    });

    // Send email
    const success = await this.mailer.sendNotificationEmail(
      to,
      rendered.html,
      { subject: rendered.subject },
    );

    return success;
  }
}
```

### Bulk Sending with Rate Limiting

```typescript
// Configure rate limiting
this.notificationMailer.updateRateLimitConfig({
  batchSize: 20,              // Send 20 emails per batch
  delayBetweenBatches: 3000,  // Wait 3 seconds between batches
  maxConcurrent: 10,          // Max 10 concurrent sends per batch
});

// Send bulk emails with configured rate limiting
const result = await this.notificationMailer.sendBulkNotificationEmails({
  recipients: largeRecipientList, // Can be thousands of recipients
});
```

## Importance Levels

The system supports four importance levels that affect email styling and subject lines:

- **LOW**: Default styling, no special indicators
- **MEDIUM**: Yellow badge, medium priority indicator
- **HIGH**: Orange badge, "[IMPORTANTE]" subject prefix
- **URGENT**: Red badge, "[URGENTE]" subject prefix, alert styling

```typescript
await this.notificationMailer.sendNotificationEmail({
  to: 'user@example.com',
  title: 'System Maintenance',
  body: 'System will be down for maintenance in 1 hour.',
  importance: 'URGENT', // Red alert styling
});
```

## Template Features

### HTML and Plain Text

Every email is automatically generated in both HTML and plain text versions:

```typescript
const rendered = this.templateService.renderNotificationTemplate(data);
// rendered.html - Beautiful HTML version
// rendered.plainText - Clean plain text version
// rendered.subject - Generated subject line
```

### Template Variables

Use template variables in custom templates:

```typescript
const html = `
  <h1>Hello {{userName}}!</h1>
  <p>Your order {{orderId}} is ready.</p>
`;

const rendered = this.templateService.renderCustomTemplate(html, {
  userName: 'John',
  orderId: '12345',
});
```

### Metadata Display

Add structured data that appears as a list in the email:

```typescript
metadata: {
  'Order ID': '12345',
  'Total Amount': 'R$ 150,00',
  'Delivery Date': '15/01/2026',
}
// Renders as a formatted list in the email
```

## Delivery Tracking

### Track Individual Deliveries

```typescript
// Send email
const success = await this.mailer.sendNotificationEmail(to, html, data);

// Get delivery status later (if you have the messageId)
const status = this.notificationMailer.getDeliveryStatus(messageId);
console.log(status);
// {
//   success: true,
//   messageId: 'abc123',
//   retryCount: 1,
//   deliveryTimestamp: Date,
// }
```

### Monitor Statistics

```typescript
const stats = this.notificationMailer.getStatistics();
console.log(stats);
// {
//   totalTracked: 1000,
//   successRate: 98.5,
//   failureRate: 1.5,
//   averageRetries: 0.3,
// }
```

## Error Handling

### Error Categories

The service automatically categorizes SMTP errors:

- **TIMEOUT** - Request timed out
- **DNS_ERROR** - Domain not found
- **CONNECTION_RESET** - Connection was reset
- **CONNECTION_REFUSED** - Connection refused
- **INVALID_RECIPIENT** - Recipient address invalid (550)
- **MAILBOX_FULL** - Recipient mailbox full (552)
- **AUTH_FAILED** - Authentication failed
- **RATE_LIMITED** - Rate limit exceeded
- **UNKNOWN_ERROR** - Other errors

### Handling Failed Deliveries

```typescript
const result = await this.notificationMailer.sendBulkNotificationEmails({
  recipients: users,
});

// Process failed deliveries
for (const error of result.errors) {
  console.error(`Failed to send to ${error.email}: ${error.error}`);

  if (error.errorCode === 'RATE_LIMITED') {
    // Implement rate limit backoff
  } else if (error.errorCode === 'INVALID_RECIPIENT') {
    // Mark email as invalid in database
  }
}
```

### Retry Logic

Failed emails are automatically retried up to 3 times with exponential backoff:

- Attempt 1: Immediate
- Attempt 2: Wait 1 second
- Attempt 3: Wait 2 seconds
- Attempt 4: Wait 4 seconds

Only retryable errors (network issues, timeouts) trigger retries. Invalid recipients or authentication failures do not retry.

## Rate Limiting

### Default Configuration

```typescript
{
  batchSize: 10,              // 10 emails per batch
  delayBetweenBatches: 2000,  // 2 seconds between batches
  maxConcurrent: 5,           // 5 concurrent sends per batch
}
```

### Custom Configuration

```typescript
// For high-volume sending
this.notificationMailer.updateRateLimitConfig({
  batchSize: 50,
  delayBetweenBatches: 1000,
  maxConcurrent: 20,
});

// For low-priority sends with strict rate limits
this.notificationMailer.updateRateLimitConfig({
  batchSize: 5,
  delayBetweenBatches: 5000,
  maxConcurrent: 2,
});
```

## Integration with Notification System

### Sending Notifications via Email

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationService } from '@modules/common/notification';
import { NotificationMailerService } from '@modules/common/mailer';

@Injectable()
export class NotificationDispatcher {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationMailer: NotificationMailerService,
  ) {}

  async sendAndNotify(userId: string, email: string, data: any) {
    // Create notification in database
    const notification = await this.notificationService.createNotification({
      userId,
      title: data.title,
      body: data.body,
      channel: ['EMAIL', 'IN_APP'],
      importance: data.importance || 'MEDIUM',
      type: data.type,
    });

    // Send email notification
    const emailResult = await this.notificationMailer.sendNotificationEmail({
      to: email,
      ...data,
    });

    // Update notification status
    if (emailResult.success) {
      await this.notificationService.updateNotification(
        notification.data.id,
        { sentAt: new Date() },
      );
    }

    return {
      notificationId: notification.data.id,
      emailSent: emailResult.success,
    };
  }
}
```

## Health Checks

```typescript
const isHealthy = await this.notificationMailer.healthCheck();
if (!isHealthy) {
  console.error('Email service is not available');
}
```

## Environment Configuration

Required environment variables:

```env
# Email Configuration
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# Company Information
API_URL=https://your-api.com
TWILIO_PHONE_NUMBER=+55 11 99999-9999
```

## Best Practices

### 1. Use Appropriate Importance Levels

```typescript
// High importance for critical notifications
importance: 'URGENT'  // Account security, system alerts
importance: 'HIGH'    // Important updates, confirmations
importance: 'MEDIUM'  // Regular notifications
importance: 'LOW'     // Marketing, newsletters
```

### 2. Batch Large Sends

```typescript
// DON'T: Send one at a time
for (const user of users) {
  await sendEmail(user.email); // Slow!
}

// DO: Use bulk sending
await this.notificationMailer.sendBulkNotificationEmails({
  recipients: users.map(u => ({ email: u.email, ... })),
});
```

### 3. Handle Failed Deliveries

```typescript
const result = await sendBulk(...);

// Log failures for retry
for (const error of result.errors) {
  await this.logFailedEmail({
    email: error.email,
    error: error.error,
    errorCode: error.errorCode,
  });
}
```

### 4. Monitor Statistics

```typescript
// Periodic health check
setInterval(() => {
  const stats = this.notificationMailer.getStatistics();
  if (stats.failureRate > 10) {
    this.logger.error('High email failure rate detected');
  }
}, 60000); // Check every minute
```

### 5. Clean Up Logs

```typescript
// Clear old delivery logs periodically
setInterval(() => {
  this.notificationMailer.clearDeliveryLogs();
}, 3600000); // Clear every hour
```

## Troubleshooting

### Emails Not Sending

1. Check environment variables are set
2. Verify SMTP credentials
3. Check email service health: `await healthCheck()`
4. Review logs for error codes

### High Failure Rate

1. Check SMTP server status
2. Verify recipient email addresses
3. Check rate limiting settings
4. Review error codes in statistics

### Slow Bulk Sending

1. Increase `batchSize` in rate limit config
2. Increase `maxConcurrent` for parallel processing
3. Decrease `delayBetweenBatches` if server allows

### Memory Issues with Large Sends

1. Process in smaller batches
2. Clear delivery logs more frequently
3. Use streaming for very large recipient lists

## API Reference

### NotificationMailerService

#### `sendNotificationEmail(request: NotificationEmailRequest): Promise<EmailDeliveryResult>`

Send a single notification email.

#### `sendBulkNotificationEmails(request: BulkNotificationEmailRequest): Promise<BulkEmailDeliveryResult>`

Send bulk notification emails with rate limiting.

#### `getDeliveryStatus(messageId: string): EmailDeliveryResult | undefined`

Get delivery status for a specific message.

#### `getStatistics(): Object`

Get email service statistics.

#### `updateRateLimitConfig(config: RateLimitConfig): void`

Update rate limiting configuration.

### MailerService

#### `sendNotificationEmail(to: string, template: string, data: any): Promise<boolean>`

Low-level email sending with retry logic.

#### `getDeliveryStatus(messageId: string): EmailDeliveryResult | undefined`

Get delivery status.

### EmailTemplateService

#### `renderNotificationTemplate(data: NotificationTemplateData): RenderedTemplate`

Render notification template (HTML + plain text).

#### `renderCustomTemplate(html: string, data: any): RenderedTemplate`

Render custom template with variable substitution.

#### `validateTemplateData(data: NotificationTemplateData): boolean`

Validate template data.

## License

This module is part of the Ankaa API project.
