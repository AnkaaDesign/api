# Deep Link Service - Usage Examples

Quick reference guide with practical examples for using the Deep Link Service in notifications.

## Table of Contents

1. [Basic Usage](#basic-usage)
2. [Entity-Specific Examples](#entity-specific-examples)
3. [Channel Integration](#channel-integration)
4. [Advanced Patterns](#advanced-patterns)

## Basic Usage

### Generate Deep Links for Any Entity

```typescript
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';

@Injectable()
export class MyService {
  constructor(private readonly deepLinkService: DeepLinkService) {}

  example() {
    // Generate all link types at once
    const links = this.deepLinkService.generateDeepLink(
      DeepLinkEntity.Task,
      'task-123',
      { action: 'view' }
    );

    console.log(links.web);           // https://app.domain.com/tarefas/task-123?action=view
    console.log(links.mobile);        // myapp://tarefas/task-123?action=view
    console.log(links.universalLink); // https://app.domain.com/app/tarefas/task-123?action=view
  }
}
```

### Build Platform-Specific Links

```typescript
// Web link only
const webUrl = this.deepLinkService.buildWebLink(
  DeepLinkEntity.Order,
  'order-456'
);
// Result: https://app.domain.com/pedidos/order-456

// Mobile link only
const mobileUrl = this.deepLinkService.buildMobileLink(
  DeepLinkEntity.Order,
  'order-456'
);
// Result: myapp://pedidos/order-456
```

### Get Entity Paths

```typescript
// Using entity enum
const paths1 = this.deepLinkService.getEntityUrl(
  DeepLinkEntity.Task,
  'task-123'
);

// Using notification type string
const paths2 = this.deepLinkService.getEntityUrl(
  'TASK_CREATED',
  'task-123'
);

// Both return:
// {
//   webPath: '/tarefas/task-123',
//   mobilePath: 'tarefas/task-123'
// }
```

### Parse and Validate Links

```typescript
// Parse stored action URL
const parsed = this.deepLinkService.parseDeepLink(notification.actionUrl);
if (parsed) {
  console.log(parsed.web);
  console.log(parsed.mobile);
}

// Validate deep link
const isValid = this.deepLinkService.validateDeepLink(url);
if (isValid) {
  // Use the link
}
```

## Entity-Specific Examples

### 1. Task Notifications

#### Task Assignment
```typescript
async notifyTaskAssignment(taskId: string, userId: string, taskTitle: string) {
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    action: 'view',
    source: 'assignment',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'New Task Assigned',
    body: `You have been assigned: ${taskTitle}`,
    type: 'TASK_ASSIGNMENT',
    importance: NOTIFICATION_IMPORTANCE.MEDIUM,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    actionUrl: JSON.stringify(links),
  });
}
```

**Generated:**
- Web: `https://app.domain.com/tarefas/task-123?action=view&source=assignment`
- Mobile: `myapp://tarefas/task-123?action=view&source=assignment`

#### Task Approval Request
```typescript
const links = this.deepLinkService.generateTaskLinks(taskId, {
  action: 'approve',
  section: 'approval_dialog',
  source: 'notification',
});
```

**Generated:**
- Web: `https://app.domain.com/tarefas/task-123?action=approve&section=approval_dialog&source=notification`

#### Task Deadline Reminder
```typescript
const links = this.deepLinkService.generateTaskLinks(taskId, {
  action: 'view',
  highlight: 'deadline',
  priority: 'urgent',
  deadline: deadline.toISOString(),
});
```

### 2. Order Notifications

#### Order Status Update
```typescript
async notifyOrderStatusUpdate(orderId: string, userId: string, status: string) {
  const links = this.deepLinkService.generateOrderLinks(orderId, {
    action: 'view',
    highlight: 'status',
    source: 'status_update',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Order Status Updated',
    body: `Order status changed to: ${status}`,
    type: 'ORDER_UPDATE',
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    actionUrl: JSON.stringify(links),
  });
}
```

**Generated:**
- Web: `https://app.domain.com/pedidos/order-456?action=view&highlight=status&source=status_update`

#### Order Requires Attention
```typescript
const links = this.deepLinkService.generateOrderLinks(orderId, {
  action: 'resolve',
  issue: 'payment_pending',
  priority: 'high',
});
```

### 3. Stock/Item Notifications

#### Low Stock Alert
```typescript
async notifyLowStock(itemId: string, userId: string, itemName: string) {
  const links = this.deepLinkService.generateItemLinks(itemId, {
    action: 'reorder',
    source: 'low_stock_alert',
    quantity: '5',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Low Stock Alert',
    body: `${itemName} is running low`,
    type: 'STOCK_LOW',
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    actionUrl: JSON.stringify(links),
  });
}
```

**Generated:**
- Web: `https://app.domain.com/estoque/produtos/item-789?action=reorder&source=low_stock_alert&quantity=5`

#### Stock Received
```typescript
const links = this.deepLinkService.generateItemLinks(itemId, {
  action: 'view',
  section: 'stock_history',
  highlight: 'latest_receipt',
});
```

### 4. Service Order Notifications

#### Service Order Completed
```typescript
async notifyServiceOrderComplete(serviceOrderId: string, userId: string) {
  const links = this.deepLinkService.generateServiceOrderLinks(serviceOrderId, {
    action: 'view',
    section: 'completion_details',
    source: 'completion_notification',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Service Order Completed',
    body: 'Your service order has been completed',
    type: 'SERVICE_ORDER_COMPLETE',
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    actionUrl: JSON.stringify(links),
  });
}
```

**Generated:**
- Web: `https://app.domain.com/service-orders/so-123?action=view&section=completion_details&source=completion_notification`

#### Service Order Review Request
```typescript
const links = this.deepLinkService.generateServiceOrderLinks(serviceOrderId, {
  action: 'review',
  tab: 'quality_check',
});
```

### 5. Financial Notifications

#### Financial Transaction
```typescript
async notifyFinancialTransaction(transactionId: string, userId: string, amount: number) {
  const links = this.deepLinkService.generateFinancialLinks(transactionId, {
    action: 'view',
    type: 'payment',
    source: 'transaction_notification',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Financial Transaction',
    body: `Payment of ${amount} processed`,
    type: 'FINANCIAL_TRANSACTION',
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    actionUrl: JSON.stringify(links),
  });
}
```

**Generated:**
- Web: `https://app.domain.com/financeiro/transacoes/txn-123?action=view&type=payment&source=transaction_notification`

#### Payment Reminder
```typescript
const links = this.deepLinkService.generateFinancialLinks(transactionId, {
  action: 'pay',
  priority: 'urgent',
  dueDate: dueDate.toISOString(),
});
```

### 6. User/Profile Notifications

#### Profile Update Required
```typescript
async notifyProfileUpdate(userId: string) {
  const links = this.deepLinkService.generateUserLinks(userId, {
    action: 'edit',
    section: 'personal_info',
    reason: 'incomplete',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Profile Update Required',
    body: 'Please complete your profile information',
    type: 'PROFILE_UPDATE',
    channel: [NOTIFICATION_CHANNEL.IN_APP],
    actionUrl: JSON.stringify(links),
  });
}
```

**Generated:**
- Web: `https://app.domain.com/perfil/user-123?action=edit&section=personal_info&reason=incomplete`

## Channel Integration

### Email Template Integration

```typescript
async sendTaskEmailWithDeepLink(taskId: string, userEmail: string, taskTitle: string) {
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    source: 'email',
    action: 'view',
  });

  await this.mailerService.sendEmail({
    to: userEmail,
    template: 'task-notification',
    subject: 'New Task Assigned',
    context: {
      taskTitle,
      webUrl: links.web,
      actionButtonText: 'View Task',
    },
  });
}
```

**Email Template (Handlebars):**
```html
<div class="email-body">
  <h2>New Task Assigned</h2>
  <p>You have been assigned a new task: {{taskTitle}}</p>

  <a href="{{webUrl}}" class="button">
    {{actionButtonText}}
  </a>
</div>
```

### Push Notification Integration (FCM)

```typescript
async sendPushWithDeepLink(userId: string, taskId: string, deviceToken: string) {
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    source: 'push',
    action: 'view',
  });

  await this.fcmService.send({
    token: deviceToken,
    notification: {
      title: 'New Task Assigned',
      body: 'You have a new task to complete',
    },
    data: {
      entityType: 'Task',
      entityId: taskId,
      webUrl: links.web,
      mobileUrl: links.mobile,
      universalLink: links.universalLink,
      action: 'view',
      source: 'push',
    },
  });
}
```

**Mobile App Handling (React Native):**
```typescript
// Handle FCM notification tap
messaging().onNotificationOpenedApp(remoteMessage => {
  const { mobileUrl } = remoteMessage.data;
  Linking.openURL(mobileUrl);
});
```

### WhatsApp Integration

```typescript
async sendWhatsAppWithDeepLink(taskId: string, phoneNumber: string, taskTitle: string) {
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    source: 'whatsapp',
  });

  const message = `
*New Task Assigned*

You have been assigned a new task: *${taskTitle}*

View details: ${links.web}
  `.trim();

  await this.whatsappService.sendMessage({
    to: phoneNumber,
    message,
  });
}
```

### In-App Notification Integration

```typescript
// Backend: Create in-app notification
async createInAppNotificationWithDeepLink(userId: string, taskId: string) {
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    source: 'in_app',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'New Task',
    body: 'You have a new task',
    type: 'TASK_ASSIGNMENT',
    channel: [NOTIFICATION_CHANNEL.IN_APP],
    actionUrl: JSON.stringify(links),
  });
}
```

**Frontend Handling:**
```typescript
// React/Angular/Vue
function handleNotificationClick(notification: Notification) {
  const links = JSON.parse(notification.actionUrl);

  if (isPlatform('web')) {
    router.navigate(links.web);
  } else if (isPlatform('mobile')) {
    deepLinks.open(links.mobile);
  }
}
```

## Advanced Patterns

### 1. Dynamic Entity Type Resolution

```typescript
async createDynamicNotification(
  notificationType: string,
  entityId: string,
  userId: string,
) {
  // Automatically determine entity type from notification type
  const paths = this.deepLinkService.getEntityUrl(notificationType, entityId);

  // Map notification type prefix to entity enum
  const entityType = this.mapNotificationTypeToEntity(notificationType);

  const links = this.deepLinkService.generateDeepLink(
    entityType,
    entityId,
    { source: 'dynamic' }
  );

  await this.notificationService.createNotification({
    userId,
    title: 'Notification',
    body: 'Check this out',
    type: notificationType,
    actionUrl: JSON.stringify(links),
  });
}

private mapNotificationTypeToEntity(type: string): DeepLinkEntity {
  if (type.startsWith('TASK_')) return DeepLinkEntity.Task;
  if (type.startsWith('ORDER_')) return DeepLinkEntity.Order;
  if (type.startsWith('STOCK_')) return DeepLinkEntity.Item;
  if (type.startsWith('FINANCIAL_')) return DeepLinkEntity.Financial;
  if (type.startsWith('SERVICE_ORDER_')) return DeepLinkEntity.ServiceOrder;
  return DeepLinkEntity.Task;
}
```

### 2. Batch Notifications with Deep Links

```typescript
async sendBatchNotificationsWithDeepLinks(
  assignments: Array<{ taskId: string; userId: string; taskTitle: string }>
) {
  const notifications = assignments.map(assignment => {
    const links = this.deepLinkService.generateTaskLinks(assignment.taskId, {
      action: 'view',
      source: 'batch_assignment',
    });

    return {
      userId: assignment.userId,
      title: 'New Task Assigned',
      body: `Assigned: ${assignment.taskTitle}`,
      type: 'TASK_ASSIGNMENT',
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      actionUrl: JSON.stringify(links),
    };
  });

  await this.notificationService.batchCreateNotifications({ notifications });
}
```

### 3. Conditional Deep Links with Actions

```typescript
async createNotificationWithConditionalAction(
  taskId: string,
  userId: string,
  requiresApproval: boolean,
) {
  const queryParams = requiresApproval
    ? { action: 'approve', section: 'approval_dialog' }
    : { action: 'view' };

  const links = this.deepLinkService.generateTaskLinks(taskId, queryParams);

  await this.notificationService.createNotification({
    userId,
    title: requiresApproval ? 'Approval Required' : 'New Task',
    body: requiresApproval ? 'Please review and approve' : 'View your new task',
    type: requiresApproval ? 'TASK_APPROVAL' : 'TASK_CREATED',
    actionUrl: JSON.stringify(links),
  });
}
```

### 4. Multi-Action Notifications

```typescript
async createMultiActionNotification(orderId: string, userId: string) {
  // Primary action: View order
  const viewLinks = this.deepLinkService.generateOrderLinks(orderId, {
    action: 'view',
  });

  // Secondary action: Cancel order
  const cancelLinks = this.deepLinkService.generateOrderLinks(orderId, {
    action: 'cancel',
    confirm: 'true',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Order Confirmation',
    body: 'Your order has been placed',
    type: 'ORDER_CREATED',
    actionUrl: JSON.stringify(viewLinks),
    metadata: {
      primaryAction: viewLinks,
      secondaryAction: cancelLinks,
    },
  });
}
```

### 5. Time-Sensitive Deep Links

```typescript
async createUrgentNotification(taskId: string, userId: string, deadline: Date) {
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    action: 'view',
    priority: 'urgent',
    deadline: deadline.toISOString(),
    timeRemaining: String(deadline.getTime() - Date.now()),
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Urgent: Deadline Approaching',
    body: `Task deadline is ${formatDistance(deadline, new Date())}`,
    type: 'TASK_DEADLINE',
    importance: NOTIFICATION_IMPORTANCE.CRITICAL,
    actionUrl: JSON.stringify(links),
  });
}
```

### 6. Return URL Pattern

```typescript
async createNotificationWithReturn(taskId: string, userId: string, returnPath: string) {
  const links = this.deepLinkService.generateTaskLinks(taskId, {
    action: 'view',
    returnTo: returnPath,
    source: 'notification',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Task Update',
    body: 'Check out this task update',
    type: 'TASK_UPDATE',
    actionUrl: JSON.stringify(links),
  });
}
```

**Frontend handling:**
```typescript
// After user completes the action, navigate to returnTo path
const params = new URLSearchParams(window.location.search);
const returnTo = params.get('returnTo');
if (returnTo) {
  router.navigate(returnTo);
}
```

## Common Query Parameter Patterns

| Use Case | Query Parameters | Example |
|----------|-----------------|---------|
| Simple view | `{ action: 'view' }` | `?action=view` |
| Edit mode | `{ action: 'edit', section: 'details' }` | `?action=edit&section=details` |
| Approval | `{ action: 'approve', confirm: 'true' }` | `?action=approve&confirm=true` |
| Highlight field | `{ highlight: 'status' }` | `?highlight=status` |
| Navigate to tab | `{ tab: 'comments' }` | `?tab=comments` |
| Track source | `{ source: 'email' }` | `?source=email` |
| Priority indicator | `{ priority: 'urgent' }` | `?priority=urgent` |
| Return navigation | `{ returnTo: '/dashboard' }` | `?returnTo=%2Fdashboard` |

## Error Handling

```typescript
try {
  const links = this.deepLinkService.generateTaskLinks(taskId);
  await this.sendNotification(links);
} catch (error) {
  if (error.message.includes('Entity ID cannot be empty')) {
    this.logger.error('Invalid task ID provided');
    return;
  }
  throw error;
}

// Validate before using
const actionUrl = notification.actionUrl;
const parsed = this.deepLinkService.parseDeepLink(actionUrl);

if (!parsed) {
  this.logger.warn('Invalid action URL in notification');
  // Fallback to default URL
  const fallbackUrl = '/dashboard';
}

// Validate URL format
if (url && this.deepLinkService.validateDeepLink(url)) {
  // Safe to use
} else {
  // Handle invalid URL
}
```

## Testing Examples

```typescript
describe('Deep Link Integration', () => {
  let deepLinkService: DeepLinkService;

  beforeEach(() => {
    // Initialize service
  });

  it('should generate task notification with deep links', () => {
    const links = deepLinkService.generateTaskLinks('task-123', {
      action: 'view',
    });

    expect(links.web).toContain('/tarefas/task-123');
    expect(links.mobile).toContain('tarefas/task-123');
    expect(links.web).toContain('action=view');
  });

  it('should parse stored action URLs', () => {
    const actionUrl = JSON.stringify({
      web: 'https://app.domain.com/tarefas/task-123',
      mobile: 'myapp://tarefas/task-123',
    });

    const parsed = deepLinkService.parseDeepLink(actionUrl);
    expect(parsed).toBeDefined();
    expect(parsed.web).toBe('https://app.domain.com/tarefas/task-123');
  });

  it('should map notification types to entity URLs', () => {
    const paths = deepLinkService.getEntityUrl('TASK_CREATED', 'task-123');
    expect(paths.webPath).toBe('/tarefas/task-123');

    const paths2 = deepLinkService.getEntityUrl('ORDER_UPDATE', 'order-456');
    expect(paths2.webPath).toBe('/pedidos/order-456');
  });
});
```

## Summary

The Deep Link Service provides flexible, type-safe deep link generation for all notification types. Key features:

- **6 entity types** mapped to notification patterns
- **Multi-platform support** (web, mobile, universal links)
- **Query parameter support** for enhanced functionality
- **Channel integration** for email, push, WhatsApp, in-app
- **Validation and parsing** for safe URL handling
- **Dynamic type resolution** from notification type strings

Use these examples as templates for your notification implementation!
