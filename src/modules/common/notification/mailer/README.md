# Email Notification Service - Mailer

Comprehensive email notification service using Nodemailer with Handlebars templates, deep link integration, tracking, and bounce handling.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Core Methods](#core-methods)
- [Usage Examples](#usage-examples)
- [Templates](#templates)
- [Email Tracking](#email-tracking)
- [Bounce Handling](#bounce-handling)
- [Deep Links](#deep-links)
- [Best Practices](#best-practices)

## Features

1. **Email Sending**: Send single or bulk emails with SMTP
2. **Template Rendering**: Use Handlebars templates for beautiful emails
3. **Bulk Sending**: Send to multiple recipients with rate limiting
4. **Email Tracking**: Track opens (pixel) and clicks
5. **Deep Links**: Include deep links to specific app pages
6. **Bounce Handling**: Handle hard bounces, soft bounces, and complaints
7. **Email Validation**: Comprehensive email address validation
8. **Unsubscribe Links**: Add unsubscribe links for optional notifications
9. **HTML & Plain Text**: Automatic plain text generation from HTML
10. **Retry Logic**: Automatic retry with exponential backoff

## Installation

The service is already integrated into the notification module. No additional installation required.

## Configuration

Set the following environment variables in your `.env` file:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Email Settings
EMAIL_FROM=noreply@yourcompany.com
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# Company Information
COMPANY_NAME=Your Company Name
COMPANY_LOGO_URL=https://yourcompany.com/logo.png
SUPPORT_EMAIL=support@yourcompany.com

# URLs for tracking and deep links
API_URL=https://api.yourcompany.com
WEB_APP_URL=https://app.yourcompany.com
```

## Core Methods

### 1. sendEmail()

Send a single email notification.

```typescript
async sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult>
```

**Parameters:**
- `to`: Recipient email address(es)
- `subject`: Email subject
- `html?`: HTML content (optional if using template)
- `text?`: Plain text content (auto-generated if not provided)
- `template?`: Template name to use
- `templateData?`: Data to pass to template
- `attachments?`: File attachments
- `from?`: Sender email (defaults to EMAIL_FROM)
- `replyTo?`: Reply-to address
- `cc?`: CC recipients
- `bcc?`: BCC recipients
- `priority?`: Email priority (high, normal, low)

### 2. sendBulkEmails()

Send emails to multiple recipients with rate limiting.

```typescript
async sendBulkEmails(
  recipients: BulkEmailRecipient[],
  subject: string,
  template: string,
  baseTemplateData?: Record<string, any>
): Promise<BulkEmailResult>
```

**Features:**
- Batch processing (50 emails per batch)
- Rate limiting (2 second delay between batches)
- Concurrent sending within batches
- Individual recipient template data
- Comprehensive error tracking

### 3. buildEmailFromTemplate()

Build email from Handlebars template.

```typescript
async buildEmailFromTemplate(
  templateName: string,
  data: Record<string, any>
): Promise<{ html: string; text: string }>
```

### 4. attachDeepLink()

Attach deep link button to email.

```typescript
attachDeepLink(
  html: string,
  entityType: DeepLinkEntity,
  entityId: string,
  linkText?: string,
  queryParams?: Record<string, string>
): string
```

### 5. trackEmailOpened()

Add tracking pixel to track email opens.

```typescript
trackEmailOpened(
  html: string,
  trackingData: EmailTrackingData
): string
```

### 6. trackLinkClicked()

Track clicks on links in email.

```typescript
trackLinkClicked(
  html: string,
  trackingData: EmailTrackingData
): string
```

### 7. handleBounces()

Handle bounced emails (hard, soft, complaints).

```typescript
async handleBounces(bounceData: BounceData): Promise<void>
```

### 8. validateEmail()

Validate email address format and status.

```typescript
validateEmail(email: string | string[]): EmailValidationResult
```

## Usage Examples

### Example 1: Send Simple Email

```typescript
import { MailerService } from './mailer/mailer.service';

// Inject service
constructor(private readonly mailerService: MailerService) {}

// Send email
const result = await this.mailerService.sendEmail({
  to: 'user@example.com',
  subject: 'Welcome to Our Platform',
  template: 'generic-notification',
  templateData: {
    userName: 'John Doe',
    title: 'Welcome!',
    message: 'Thank you for joining our platform.',
    actionText: 'Click below to get started.',
  },
});

if (result.success) {
  console.log('Email sent:', result.messageId);
} else {
  console.error('Email failed:', result.error);
}
```

### Example 2: Send Task Created Notification

```typescript
const result = await this.mailerService.sendEmail({
  to: assignedUser.email,
  subject: `New Task Assigned: ${task.title}`,
  template: 'task-created',
  templateData: {
    userName: assignedUser.name,
    taskTitle: task.title,
    taskDescription: task.description,
    priority: task.priority,
    dueDate: task.dueDate,
    assignedBy: createdBy.name,
    project: task.project?.name,
  },
});
```

### Example 3: Send Email with Deep Link

```typescript
// Build template first
const { html, text } = await this.mailerService.buildEmailFromTemplate(
  'task-created',
  {
    userName: user.name,
    taskTitle: task.title,
    // ... other data
  }
);

// Add deep link
const htmlWithLink = this.mailerService.attachDeepLink(
  html,
  DeepLinkEntity.Task,
  task.id,
  'View Task Details'
);

// Send email
await this.mailerService.sendEmail({
  to: user.email,
  subject: 'New Task Assigned',
  html: htmlWithLink,
  text,
});
```

### Example 4: Send Email with Tracking

```typescript
// Build template
const { html } = await this.mailerService.buildEmailFromTemplate(
  'order-created',
  orderData
);

// Add tracking pixel
let trackedHtml = this.mailerService.trackEmailOpened(html, {
  notificationId: notification.id,
  userId: user.id,
  metadata: { orderId: order.id },
});

// Add link tracking
trackedHtml = this.mailerService.trackLinkClicked(trackedHtml, {
  notificationId: notification.id,
  userId: user.id,
});

// Send email
await this.mailerService.sendEmail({
  to: user.email,
  subject: 'New Order Created',
  html: trackedHtml,
});
```

### Example 5: Send Bulk Emails

```typescript
const recipients = users.map(user => ({
  email: user.email,
  templateData: {
    userName: user.name,
    customField: user.customData,
  },
  customSubject: `Hello ${user.name}!`, // Optional
}));

const result = await this.mailerService.sendBulkEmails(
  recipients,
  'Monthly Newsletter',
  'generic-notification',
  {
    title: 'Monthly Newsletter',
    message: 'Check out what\'s new this month!',
    companyName: 'Your Company',
  }
);

console.log(`Sent: ${result.totalSent}, Failed: ${result.totalFailed}`);
console.log('Errors:', result.errors);
```

### Example 6: Send Stock Low Alert

```typescript
const lowStockItems = items.map(item => ({
  name: item.name,
  code: item.code,
  category: item.category,
  currentQuantity: item.currentQuantity,
  minQuantity: item.minQuantity,
  critical: item.currentQuantity === 0,
  recommendedOrder: item.minQuantity * 2 - item.currentQuantity,
}));

await this.mailerService.sendEmail({
  to: 'inventory@company.com',
  subject: '⚠️ Stock Alert: Low Inventory Detected',
  template: 'stock-low',
  templateData: {
    userName: 'Inventory Manager',
    items: lowStockItems,
    summary: {
      totalItems: lowStockItems.length,
      criticalItems: lowStockItems.filter(i => i.critical).length,
    },
  },
});
```

### Example 7: Email Validation

```typescript
// Validate single email
const validation = this.mailerService.validateEmail('user@example.com');
if (validation.isValid) {
  console.log('Email is valid:', validation.email);
} else {
  console.error('Invalid email:', validation.error);
}

// Validate array of emails
const bulkValidation = this.mailerService.validateEmail([
  'user1@example.com',
  'user2@example.com',
  'invalid-email',
]);

if (!bulkValidation.isValid) {
  console.error('Invalid email found:', bulkValidation.error);
}
```

### Example 8: Handle Bounces

```typescript
// Simulate receiving a bounce notification from email provider
await this.mailerService.handleBounces({
  email: 'bounced@example.com',
  bounceType: 'hard',
  reason: 'Mailbox does not exist',
  timestamp: new Date(),
});

// Check if email has bounced
if (this.mailerService.hasEmailBounced('bounced@example.com')) {
  console.log('Email has bounced before, skipping send');
}

// Get bounce statistics
const stats = this.mailerService.getBounceStatistics();
console.log('Bounce stats:', stats);
```

## Templates

Available templates in `/templates/email/notification/`:

### 1. task-created.hbs
Template for new task creation notifications.

**Required Data:**
- `userName`: Recipient name
- `taskTitle`: Task title
- `priority`: Task priority (URGENT, HIGH, MEDIUM, LOW)

**Optional Data:**
- `taskDescription`: Task description
- `dueDate`: Task due date
- `assignedBy`: Who assigned the task
- `project`: Project name

### 2. task-updated.hbs
Template for task update notifications.

**Required Data:**
- `userName`: Recipient name
- `taskTitle`: Task title
- `status`: Current task status

**Optional Data:**
- `updateSummary`: Summary of changes
- `changes`: Array of change objects with `field`, `oldValue`, `newValue`
- `priority`: Task priority
- `dueDate`: Task due date
- `updatedBy`: Who updated the task

### 3. order-created.hbs
Template for new order notifications.

**Required Data:**
- `userName`: Recipient name
- `orderNumber`: Order number

**Optional Data:**
- `customerName`: Customer name
- `orderDate`: Order creation date
- `deliveryDate`: Expected delivery date
- `totalAmount`: Order total amount
- `orderStatus`: Order status
- `items`: Array of order items with `name`, `quantity`, `price`
- `notes`: Special notes or instructions

### 4. stock-low.hbs
Template for low stock alerts.

**Required Data:**
- `userName`: Recipient name

**Optional Data:**
- `items`: Array of low stock items with:
  - `name`: Item name
  - `code`: Item code
  - `category`: Item category
  - `currentQuantity`: Current stock level
  - `minQuantity`: Minimum stock level
  - `critical`: Boolean indicating if critical (0 stock)
  - `recommendedOrder`: Suggested order quantity
- `summary`: Object with `totalItems`, `criticalItems`

### 5. generic-notification.hbs
Generic template for any notification type.

**Optional Data:**
- `userName`: Recipient name
- `title`: Notification title
- `message`: Main message
- `body`: Detailed body (supports HTML)
- `details`: Array of key-value pairs with `label` and `value`
- `importance`: Notification importance (URGENT, HIGH, MEDIUM, LOW)
- `actionText`: Call-to-action text

## Email Tracking

### Tracking Email Opens

The service uses a 1x1 transparent tracking pixel to track when emails are opened:

```typescript
const trackedHtml = this.mailerService.trackEmailOpened(html, {
  notificationId: 'notification-123',
  userId: 'user-456',
  campaignId: 'campaign-789',
  metadata: { source: 'notification' },
});
```

When the user opens the email, a request is made to:
```
GET /api/notifications/track/email-open/{base64EncodedToken}
```

### Tracking Link Clicks

All links in the email are automatically wrapped with tracking URLs:

```typescript
const trackedHtml = this.mailerService.trackLinkClicked(html, {
  notificationId: 'notification-123',
  userId: 'user-456',
});
```

Original link:
```html
<a href="https://app.com/tasks/123">View Task</a>
```

Becomes:
```html
<a href="https://api.com/track/email-click/{base64Token}">View Task</a>
```

The tracking endpoint then redirects to the original URL while logging the click.

## Bounce Handling

### Types of Bounces

1. **Hard Bounce**: Permanent delivery failure (invalid email, domain doesn't exist)
2. **Soft Bounce**: Temporary failure (mailbox full, server down)
3. **Complaint**: Spam complaint from recipient

### Handling Bounces

```typescript
// Hard bounce - email is invalid
await this.mailerService.handleBounces({
  email: 'invalid@example.com',
  bounceType: 'hard',
  reason: 'Mailbox does not exist',
  timestamp: new Date(),
});
// Result: Email marked as invalid, won't send future emails

// Soft bounce - temporary issue
await this.mailerService.handleBounces({
  email: 'user@example.com',
  bounceType: 'soft',
  reason: 'Mailbox full',
  timestamp: new Date(),
});
// Result: Logged for retry later

// Complaint - spam report
await this.mailerService.handleBounces({
  email: 'complainer@example.com',
  bounceType: 'complaint',
  reason: 'User marked as spam',
  timestamp: new Date(),
});
// Result: User should be unsubscribed immediately
```

## Deep Links

Deep links allow users to navigate directly to specific pages in your app from emails.

### Adding Deep Links

```typescript
// Generate deep link for a task
const htmlWithLink = this.mailerService.attachDeepLink(
  html,
  DeepLinkEntity.Task,
  task.id,
  'View Task',
  { action: 'approve' } // Optional query params
);
```

### Supported Entity Types

- `DeepLinkEntity.Task`: Links to task details
- `DeepLinkEntity.Order`: Links to order details
- `DeepLinkEntity.Item`: Links to item/product details
- `DeepLinkEntity.ServiceOrder`: Links to service order details
- `DeepLinkEntity.User`: Links to user profile

### Generated Links

The service generates both web and mobile deep links:
- Web: `https://app.com/production/tasks/details/task-123`
- Mobile: `yourapp://production/tasks/task-123`

## Best Practices

### 1. Always Validate Email Addresses

```typescript
const validation = this.mailerService.validateEmail(email);
if (!validation.isValid) {
  throw new Error(validation.error);
}
```

### 2. Use Templates for Consistency

Create reusable templates instead of inline HTML.

### 3. Add Tracking for Analytics

Track opens and clicks to measure engagement.

### 4. Handle Failures Gracefully

```typescript
const result = await this.mailerService.sendEmail(options);
if (!result.success) {
  this.logger.error('Email failed:', result.error);
  // Implement fallback notification method
  await this.sendPushNotification(userId, message);
}
```

### 5. Use Bulk Sending for Multiple Recipients

For more than 5 recipients, use `sendBulkEmails()` instead of multiple `sendEmail()` calls.

### 6. Include Unsubscribe Links

For marketing or optional notifications:

```typescript
const htmlWithUnsubscribe = this.mailerService.addUnsubscribeLink(
  html,
  userId,
  'marketing'
);
```

### 7. Monitor Bounce Rates

```typescript
const stats = this.mailerService.getBounceStatistics();
if (stats.hardBounces > 100) {
  this.logger.warn('High bounce rate detected!');
}
```

### 8. Test Email Templates

Always test templates with various data combinations before production use.

### 9. Use Priority Flags

Mark important emails with high priority:

```typescript
await this.mailerService.sendEmail({
  to: 'admin@company.com',
  subject: 'Critical System Alert',
  template: 'generic-notification',
  templateData: { /* ... */ },
  priority: 'high',
});
```

### 10. Implement Rate Limiting

The service has built-in rate limiting, but be mindful of your email provider's limits.

## Health Check

Check if the email service is healthy:

```typescript
const isHealthy = await this.mailerService.healthCheck();
if (!isHealthy) {
  this.logger.error('Email service is unavailable');
}
```

## Support

For issues or questions:
- Check the logs for detailed error messages
- Verify SMTP configuration
- Test with a simple email first
- Contact support at: support@yourcompany.com
