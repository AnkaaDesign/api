# Mailer Service - Quick Reference

## Import

```typescript
import { MailerService, NotificationEmailTemplate } from './mailer/mailer.service';
import { DeepLinkEntity } from '../deep-link.service';
```

## Basic Usage

### Send Simple Email

```typescript
await mailerService.sendEmail({
  to: 'user@example.com',
  subject: 'Hello!',
  template: NotificationEmailTemplate.GENERIC_NOTIFICATION,
  templateData: {
    userName: 'John',
    title: 'Welcome',
    message: 'Welcome to our platform!',
  },
});
```

### Send with Template

```typescript
await mailerService.sendEmail({
  to: user.email,
  subject: `New Task: ${task.title}`,
  template: NotificationEmailTemplate.TASK_CREATED,
  templateData: {
    userName: user.name,
    taskTitle: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
  },
});
```

### Send Bulk Emails

```typescript
const recipients = users.map(u => ({
  email: u.email,
  templateData: { userName: u.name },
}));

await mailerService.sendBulkEmails(
  recipients,
  'Newsletter',
  NotificationEmailTemplate.GENERIC_NOTIFICATION,
  { title: 'Monthly Update' }
);
```

## Advanced Features

### Add Deep Link

```typescript
const { html } = await mailerService.buildEmailFromTemplate('task-created', data);
const htmlWithLink = mailerService.attachDeepLink(
  html,
  DeepLinkEntity.Task,
  task.id,
  'View Task'
);
```

### Add Tracking

```typescript
// Track opens
let html = mailerService.trackEmailOpened(html, {
  notificationId: 'notif-123',
  userId: 'user-456',
});

// Track clicks
html = mailerService.trackLinkClicked(html, {
  notificationId: 'notif-123',
  userId: 'user-456',
});
```

### Validate Email

```typescript
const validation = mailerService.validateEmail(email);
if (!validation.isValid) {
  console.error(validation.error);
}
```

### Handle Bounces

```typescript
await mailerService.handleBounces({
  email: 'bounced@example.com',
  bounceType: 'hard',
  reason: 'Mailbox does not exist',
  timestamp: new Date(),
});
```

## Available Templates

| Template | Use Case | Key Data |
|----------|----------|----------|
| `task-created` | New task assigned | taskTitle, priority, dueDate |
| `task-updated` | Task updated | taskTitle, status, changes[] |
| `order-created` | New order received | orderNumber, items[], totalAmount |
| `stock-low` | Low stock alert | items[], summary |
| `generic-notification` | Any notification | title, message, body |

## Template Data Examples

### Task Created

```typescript
{
  userName: 'John Doe',
  taskTitle: 'Build Feature X',
  taskDescription: 'Implement the new feature',
  priority: 'HIGH',
  dueDate: new Date('2025-01-15'),
  assignedBy: 'Manager Name',
  project: 'Project Alpha',
}
```

### Order Created

```typescript
{
  userName: 'John Doe',
  orderNumber: 'ORD-12345',
  customerName: 'Acme Corp',
  orderDate: new Date(),
  deliveryDate: new Date('2025-01-20'),
  totalAmount: '1250.00',
  orderStatus: 'PENDING',
  items: [
    { name: 'Product A', quantity: 10, price: '50.00' },
    { name: 'Product B', quantity: 5, price: '150.00' },
  ],
  notes: 'Urgent delivery required',
}
```

### Stock Low

```typescript
{
  userName: 'Inventory Manager',
  items: [
    {
      name: 'Product A',
      code: 'SKU-001',
      category: 'Electronics',
      currentQuantity: 5,
      minQuantity: 20,
      critical: false,
      recommendedOrder: 35,
    },
    {
      name: 'Product B',
      code: 'SKU-002',
      category: 'Hardware',
      currentQuantity: 0,
      minQuantity: 10,
      critical: true,
      recommendedOrder: 20,
    },
  ],
  summary: {
    totalItems: 2,
    criticalItems: 1,
  },
}
```

## Common Patterns

### Complete Email Flow

```typescript
// 1. Build from template
const { html, text } = await mailerService.buildEmailFromTemplate(
  'task-created',
  templateData
);

// 2. Add deep link
let finalHtml = mailerService.attachDeepLink(
  html,
  DeepLinkEntity.Task,
  task.id,
  'View Task'
);

// 3. Add tracking
finalHtml = mailerService.trackEmailOpened(finalHtml, trackingData);
finalHtml = mailerService.trackLinkClicked(finalHtml, trackingData);

// 4. Add unsubscribe (if optional notification)
finalHtml = mailerService.addUnsubscribeLink(finalHtml, user.id, 'tasks');

// 5. Send
await mailerService.sendEmail({
  to: user.email,
  subject: 'New Task Assigned',
  html: finalHtml,
  text,
  priority: 'high',
});
```

### Validate Before Send

```typescript
const validation = mailerService.validateEmail(user.email);
if (!validation.isValid) {
  this.logger.error(`Invalid email: ${validation.error}`);
  return;
}

await mailerService.sendEmail({ /* ... */ });
```

### Check Service Health

```typescript
const isHealthy = await mailerService.healthCheck();
if (!isHealthy) {
  this.logger.error('Email service unavailable');
  // Use fallback notification method
}
```

## Environment Variables

```env
# Required
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Optional (with defaults)
SMTP_SECURE=false
EMAIL_FROM=noreply@yourcompany.com
COMPANY_NAME=Your Company
SUPPORT_EMAIL=support@yourcompany.com
COMPANY_LOGO_URL=https://yourcompany.com/logo.png
API_URL=http://localhost:3030
WEB_APP_URL=http://localhost:3000
```

## Error Handling

```typescript
const result = await mailerService.sendEmail(options);

if (result.success) {
  console.log('Email sent:', result.messageId);
} else {
  console.error('Email failed:', result.error, result.errorCode);
  // Implement fallback
}
```

## Utility Methods

```typescript
// Get bounce statistics
const stats = mailerService.getBounceStatistics();
// { totalBounces, hardBounces, softBounces, complaints }

// Check if email bounced
const hasBounced = mailerService.hasEmailBounced('user@example.com');

// Get bounce data
const bounceData = mailerService.getBounceData('user@example.com');

// Clear bounce data
mailerService.clearBounceData('user@example.com');
```

## Best Practices

1. ✅ Always validate emails before sending
2. ✅ Use templates for consistency
3. ✅ Add deep links for better UX
4. ✅ Track opens and clicks for analytics
5. ✅ Handle bounces properly
6. ✅ Use bulk sending for multiple recipients
7. ✅ Add unsubscribe links for optional emails
8. ✅ Check service health before critical sends
9. ✅ Log failures and implement fallbacks
10. ✅ Monitor bounce rates

## Quick Tips

- **Priority**: Set priority for urgent emails
- **Attachments**: Add files with `attachments` option
- **CC/BCC**: Use `cc` and `bcc` options
- **Reply-To**: Set custom reply address with `replyTo`
- **Retries**: Automatic 3 retries with exponential backoff
- **Rate Limit**: Built-in rate limiting (50 per batch, 2s delay)
- **Template Cache**: Templates cached automatically for performance

## Common Issues

| Issue | Solution |
|-------|----------|
| SMTP auth failed | Check EMAIL_USER and EMAIL_PASS |
| Template not found | Verify template path and name |
| Invalid email | Use validateEmail() before sending |
| Timeout | Check SMTP_HOST and network connectivity |
| Rate limited | Reduce BATCH_SIZE or increase BATCH_DELAY_MS |

## Support

- 📖 Full Documentation: `README.md`
- 💡 Examples: `mailer.example.ts`
- 📋 Implementation Details: `IMPLEMENTATION_SUMMARY.md`
