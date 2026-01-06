# Deep Link Service Implementation Summary

## Overview

The Deep Link Service has been fully implemented to support notification routing across web and mobile platforms. It provides a unified interface for generating, parsing, building, and validating deep links for various entity types.

## File Location

`/home/kennedy/Documents/repositories/api/src/modules/common/notification/deep-link.service.ts`

## Implemented Methods

### 1. generateDeepLink()
Generate a complete deep link for a notification with web, mobile, and universal link URLs.

```typescript
generateDeepLink(
  entityType: DeepLinkEntity,
  entityId: string,
  queryParams?: DeepLinkQueryParams,
): DeepLinkResult
```

**Example:**
```typescript
const links = deepLinkService.generateDeepLink(
  DeepLinkEntity.Task,
  'task-123',
  { action: 'view', source: 'notification' }
);
// Returns:
// {
//   web: 'https://app.domain.com/tarefas/task-123?action=view&source=notification',
//   mobile: 'myapp://tarefas/task-123?action=view&source=notification',
//   universalLink: 'https://app.domain.com/app/tarefas/task-123?action=view&source=notification'
// }
```

### 2. parseDeepLink()
Parse a deep link string to extract entity information.

```typescript
parseDeepLink(deepLink: string | null): DeepLinkResult | null
```

**Example:**
```typescript
const parsed = deepLinkService.parseDeepLink(notification.actionUrl);
// Returns:
// {
//   web: 'https://app.domain.com/tarefas/task-123',
//   mobile: 'myapp://tarefas/task-123',
//   universalLink: 'https://app.domain.com/app/tarefas/task-123'
// }
```

### 3. buildWebLink()
Build a web application link for an entity.

```typescript
buildWebLink(
  entityType: DeepLinkEntity,
  entityId: string,
  queryParams?: DeepLinkQueryParams,
): string
```

**Example:**
```typescript
const webUrl = deepLinkService.buildWebLink(
  DeepLinkEntity.Order,
  'order-456',
  { highlight: 'status' }
);
// Returns: 'https://app.domain.com/pedidos/order-456?highlight=status'
```

### 4. buildMobileLink()
Build a mobile app link using custom URL scheme.

```typescript
buildMobileLink(
  entityType: DeepLinkEntity,
  entityId: string,
  queryParams?: DeepLinkQueryParams,
): string
```

**Example:**
```typescript
const mobileUrl = deepLinkService.buildMobileLink(
  DeepLinkEntity.Item,
  'item-789'
);
// Returns: 'myapp://estoque/produtos/item-789'
```

### 5. getEntityUrl()
Get URL paths for an entity type (supports notification type strings).

```typescript
getEntityUrl(
  entityType: DeepLinkEntity | string,
  entityId: string,
): { webPath: string; mobilePath: string }
```

**Example:**
```typescript
// Using enum
const paths1 = deepLinkService.getEntityUrl(DeepLinkEntity.Task, 'task-123');

// Using notification type string
const paths2 = deepLinkService.getEntityUrl('TASK_CREATED', 'task-123');

// Both return:
// {
//   webPath: '/tarefas/task-123',
//   mobilePath: 'tarefas/task-123'
// }
```

### 6. validateDeepLink()
Validate deep link format.

```typescript
validateDeepLink(url: string): boolean
```

**Example:**
```typescript
deepLinkService.validateDeepLink('https://app.domain.com/tarefas/123'); // true
deepLinkService.validateDeepLink('myapp://pedidos/456'); // true
deepLinkService.validateDeepLink('invalid-url'); // false
```

## Entity Types and Route Mappings

### Supported Entity Types

```typescript
enum DeepLinkEntity {
  Task = 'Task',              // TASK_* notifications
  Order = 'Order',            // ORDER_* notifications
  Item = 'Item',              // STOCK_*, ITEM_* notifications
  ServiceOrder = 'ServiceOrder', // SERVICE_ORDER_* notifications
  Financial = 'Financial',    // FINANCIAL_* notifications
  User = 'User',              // USER_*, PROFILE_* notifications
}
```

### Route Mappings

| Entity Type | Notification Pattern | Web Route | Mobile Route |
|-------------|---------------------|-----------|--------------|
| Task | `TASK_*` | `/tarefas/:id` | `tarefas/:id` |
| Order | `ORDER_*` | `/pedidos/:id` | `pedidos/:id` |
| Item | `STOCK_*`, `ITEM_*` | `/estoque/produtos/:id` | `estoque/produtos/:id` |
| ServiceOrder | `SERVICE_ORDER_*` | `/service-orders/:id` | `service-orders/:id` |
| Financial | `FINANCIAL_*` | `/financeiro/transacoes/:id` | `financeiro/transacoes/:id` |
| User | `USER_*`, `PROFILE_*` | `/perfil/:id` | `perfil/:id` |

## Deep Link Structure

### Web Links
```
https://app.domain.com/[entity-route]/[entity-id]?[query-params]
```

**Example:**
```
https://app.domain.com/tarefas/task-123?action=approve&source=notification
```

### Mobile Links (Custom Scheme)
```
myapp://[entity-route]/[entity-id]?[query-params]
```

**Example:**
```
myapp://pedidos/order-456?action=view&highlight=status
```

### Universal Links
```
https://app.domain.com/app/[entity-route]/[entity-id]?[query-params]
```

**Example:**
```
https://app.domain.com/app/estoque/produtos/item-789?action=reorder
```

## Notification Payload Integration

### Including Deep Links in Notification Payload

When creating a notification, include deep link information in the payload:

```typescript
const actionUrl = deepLinkService.generateNotificationActionUrl(
  DeepLinkEntity.Task,
  taskId,
  { action: 'view', source: 'notification' }
);

await notificationService.createNotification({
  userId,
  title: 'New Task Assigned',
  body: 'You have been assigned a new task',
  type: 'TASK_ASSIGNMENT',
  importance: NOTIFICATION_IMPORTANCE.MEDIUM,
  channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  actionUrl, // JSON string with web, mobile, universalLink
  actionType: 'VIEW_TASK',
});
```

### Stored Format

The `actionUrl` field stores a JSON string:

```json
{
  "web": "https://app.domain.com/tarefas/task-123",
  "mobile": "myapp://tarefas/task-123",
  "universalLink": "https://app.domain.com/app/tarefas/task-123"
}
```

## Channel-Specific Integration

### 1. Email Notifications

Include a clickable button/link in the email template:

```html
<a href="{{webUrl}}" style="...">View Task</a>
```

**Implementation:**
```typescript
const links = deepLinkService.generateTaskLinks(taskId);
await mailerService.sendEmail({
  to: user.email,
  template: 'task-notification',
  context: {
    webUrl: links.web,
    taskTitle: 'Design New Logo',
  },
});
```

### 2. Push Notifications (FCM)

Include deep link in FCM data payload:

```typescript
const links = deepLinkService.generateTaskLinks(taskId);

await fcmService.send({
  token: deviceToken,
  notification: {
    title: 'New Task Assigned',
    body: 'You have a new task',
  },
  data: {
    entityType: 'Task',
    entityId: taskId,
    webUrl: links.web,
    mobileUrl: links.mobile,
    universalLink: links.universalLink,
    action: 'view',
  },
});
```

**Mobile app handling:**
```kotlin
// Android example
val data = remoteMessage.data
val mobileUrl = data["mobileUrl"]
val intent = Intent(Intent.ACTION_VIEW, Uri.parse(mobileUrl))
startActivity(intent)
```

### 3. WhatsApp Notifications

Include clickable link in message text:

```typescript
const links = deepLinkService.generateTaskLinks(taskId);
const message = `
New Task Assigned: ${taskTitle}

View details: ${links.web}
`;

await whatsappService.sendMessage({
  to: user.phone,
  message: message,
});
```

### 4. In-App Notifications

Use click handler to navigate within the app:

```typescript
// Frontend handling
function handleNotificationClick(notification) {
  const links = JSON.parse(notification.actionUrl);

  // Web app
  if (isWebPlatform) {
    router.push(links.web);
  }

  // Mobile app
  if (isMobilePlatform) {
    navigation.navigate(links.mobile);
  }
}
```

## Complete Usage Examples

### Example 1: Task Assignment with Deep Links

```typescript
@Injectable()
export class TaskNotificationService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  async notifyTaskAssignment(taskId: string, userId: string, taskTitle: string) {
    // Generate deep links
    const links = this.deepLinkService.generateDeepLink(
      DeepLinkEntity.Task,
      taskId,
      { action: 'view', source: 'assignment' }
    );

    // Create notification with deep links
    await this.notificationService.createNotification({
      userId,
      title: 'New Task Assigned',
      body: `You have been assigned: ${taskTitle}`,
      type: 'TASK_ASSIGNMENT',
      importance: NOTIFICATION_IMPORTANCE.MEDIUM,
      channel: [
        NOTIFICATION_CHANNEL.IN_APP,
        NOTIFICATION_CHANNEL.PUSH,
        NOTIFICATION_CHANNEL.EMAIL,
      ],
      actionUrl: JSON.stringify(links),
      actionType: 'VIEW_TASK',
      metadata: {
        entityType: 'Task',
        entityId: taskId,
        webUrl: links.web,
        mobileUrl: links.mobile,
      },
    });
  }
}
```

**Generated Links:**
- Web: `https://app.domain.com/tarefas/task-123?action=view&source=assignment`
- Mobile: `myapp://tarefas/task-123?action=view&source=assignment`
- Universal: `https://app.domain.com/app/tarefas/task-123?action=view&source=assignment`

### Example 2: Order Status Update

```typescript
async notifyOrderStatusChange(
  orderId: string,
  userId: string,
  orderNumber: string,
  newStatus: string,
) {
  const links = this.deepLinkService.generateOrderLinks(orderId, {
    action: 'view',
    highlight: 'status',
    source: 'status_update',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Order Status Updated',
    body: `Order #${orderNumber} status changed to: ${newStatus}`,
    type: 'ORDER_UPDATE',
    importance: NOTIFICATION_IMPORTANCE.MEDIUM,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    actionUrl: JSON.stringify(links),
    actionType: 'VIEW_ORDER',
  });
}
```

**Generated Links:**
- Web: `https://app.domain.com/pedidos/order-456?action=view&highlight=status&source=status_update`
- Mobile: `myapp://pedidos/order-456?action=view&highlight=status&source=status_update`

### Example 3: Low Stock Alert

```typescript
async notifyLowStock(
  itemId: string,
  userId: string,
  itemName: string,
  quantity: number,
) {
  const links = this.deepLinkService.generateItemLinks(itemId, {
    action: 'reorder',
    source: 'low_stock_alert',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Low Stock Alert',
    body: `${itemName} is running low (${quantity} remaining)`,
    type: 'STOCK_LOW',
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    actionUrl: JSON.stringify(links),
    actionType: 'VIEW_ITEM',
  });
}
```

**Generated Links:**
- Web: `https://app.domain.com/estoque/produtos/item-789?action=reorder&source=low_stock_alert`
- Mobile: `myapp://estoque/produtos/item-789?action=reorder&source=low_stock_alert`

### Example 4: Financial Transaction

```typescript
async notifyFinancialTransaction(
  transactionId: string,
  userId: string,
  amount: number,
  type: string,
) {
  const links = this.deepLinkService.generateFinancialLinks(transactionId, {
    action: 'view',
    type: type,
    source: 'transaction_notification',
  });

  await this.notificationService.createNotification({
    userId,
    title: 'Financial Transaction',
    body: `${type} of ${amount} has been processed`,
    type: 'FINANCIAL_TRANSACTION',
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    actionUrl: JSON.stringify(links),
    actionType: 'VIEW_TRANSACTION',
  });
}
```

**Generated Links:**
- Web: `https://app.domain.com/financeiro/transacoes/txn-123?action=view&type=payment&source=transaction_notification`
- Mobile: `myapp://financeiro/transacoes/txn-123?action=view&type=payment&source=transaction_notification`

### Example 5: Using getEntityUrl() with Notification Types

```typescript
async dynamicNotificationWithDeepLink(
  notificationType: string, // e.g., 'TASK_CREATED', 'ORDER_UPDATE'
  entityId: string,
  userId: string,
) {
  // Get entity paths automatically based on notification type
  const paths = this.deepLinkService.getEntityUrl(notificationType, entityId);

  // Build full URLs
  const webUrl = this.deepLinkService.buildWebLink(
    this.getEntityTypeFromNotificationType(notificationType),
    entityId,
  );

  const mobileUrl = this.deepLinkService.buildMobileLink(
    this.getEntityTypeFromNotificationType(notificationType),
    entityId,
  );

  await this.notificationService.createNotification({
    userId,
    title: 'Dynamic Notification',
    body: 'Check out this update',
    type: notificationType,
    importance: NOTIFICATION_IMPORTANCE.MEDIUM,
    channel: [NOTIFICATION_CHANNEL.IN_APP],
    actionUrl: JSON.stringify({ web: webUrl, mobile: mobileUrl }),
  });
}
```

## Environment Configuration

Required environment variables:

```env
# Base URL for web application
WEB_APP_URL=https://app.domain.com

# Custom URL scheme for mobile app
MOBILE_APP_SCHEME=myapp

# Domain for universal links (optional, defaults to WEB_APP_URL)
UNIVERSAL_LINK_DOMAIN=https://app.domain.com
```

## Query Parameters

Common query parameters used in deep links:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `action` | Action to perform | `view`, `edit`, `approve`, `reject` |
| `source` | Source of the link | `notification`, `email`, `push` |
| `highlight` | Field to highlight | `status`, `deadline`, `description` |
| `section` | Section to navigate to | `details`, `comments`, `history` |
| `returnTo` | Return URL after action | `/dashboard`, `/tasks` |
| `priority` | Priority indicator | `urgent`, `high`, `normal` |

## Validation

The service includes built-in validation:

```typescript
// Validates URL format
const isValid = deepLinkService.validateDeepLink(url);

// Handles empty or malformed URLs
const parsed = deepLinkService.parseDeepLink(invalidUrl);
// Returns null if invalid

// Entity ID validation
const link = deepLinkService.generateTaskLink('', 'web');
// Throws: 'Entity ID cannot be empty'
```

## Best Practices

1. **Always include both web and mobile links** in notification payloads
2. **Use meaningful query parameters** to enhance user experience
3. **Validate entity IDs** before generating links
4. **Store the full JSON actionUrl** in notifications for flexibility
5. **Use universal links** when available for better mobile UX
6. **Test deep links** across all platforms before deployment
7. **Monitor click-through rates** to optimize notification engagement
8. **Handle missing/invalid links gracefully** in client applications

## Testing

```typescript
describe('DeepLinkService', () => {
  it('should generate valid task deep links', () => {
    const links = deepLinkService.generateTaskLinks('task-123');

    expect(links.web).toBe('https://app.domain.com/tarefas/task-123');
    expect(links.mobile).toBe('myapp://tarefas/task-123');
    expect(deepLinkService.validateDeepLink(links.web)).toBe(true);
    expect(deepLinkService.validateDeepLink(links.mobile)).toBe(true);
  });

  it('should parse notification action URLs', () => {
    const actionUrl = JSON.stringify({
      web: 'https://app.domain.com/tarefas/task-123',
      mobile: 'myapp://tarefas/task-123',
    });

    const parsed = deepLinkService.parseDeepLink(actionUrl);
    expect(parsed).toBeDefined();
    expect(parsed.web).toContain('/tarefas/task-123');
  });

  it('should map notification types to entity types', () => {
    const paths = deepLinkService.getEntityUrl('TASK_CREATED', 'task-123');
    expect(paths.webPath).toBe('/tarefas/task-123');

    const paths2 = deepLinkService.getEntityUrl('ORDER_UPDATE', 'order-456');
    expect(paths2.webPath).toBe('/pedidos/order-456');
  });
});
```

## Summary

The Deep Link Service provides a comprehensive solution for generating and managing notification deep links across web and mobile platforms. It supports:

- 6 main methods for deep link management
- 6 entity types with customizable routing
- Automatic notification type to entity type mapping
- Multi-channel support (email, push, WhatsApp, in-app)
- Query parameter support for enhanced functionality
- Built-in validation and error handling
- Full backward compatibility

All generated links follow consistent patterns and include both platform-specific URLs and universal links for optimal user experience.
