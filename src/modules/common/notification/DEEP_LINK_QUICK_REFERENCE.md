# Deep Link Service - Quick Reference

## Quick Start

### 1. Environment Setup
```env
WEB_APP_URL=https://yourapp.com
MOBILE_APP_SCHEME=yourapp
UNIVERSAL_LINK_DOMAIN=https://yourapp.com
```

### 2. Basic Usage
```typescript
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';

constructor(private readonly deepLinkService: DeepLinkService) {}
```

## Common Operations

### Generate Task Links
```typescript
// All platforms
const links = this.deepLinkService.generateTaskLinks('task-id');

// Single platform
const webLink = this.deepLinkService.generateTaskLink('task-id', 'web');
const mobileLink = this.deepLinkService.generateTaskLink('task-id', 'mobile');
```

### Generate Links with Query Parameters
```typescript
const links = this.deepLinkService.generateTaskLinks('task-id', {
  action: 'approve',
  source: 'email'
});
```

### Create Notification with Deep Links
```typescript
const actionUrl = this.deepLinkService.generateNotificationActionUrl(
  DeepLinkEntity.Task,
  'task-id',
  { action: 'view' }
);

await this.notificationService.createNotification({
  userId: 'user-id',
  title: 'New Task',
  body: 'You have a new task',
  actionUrl,  // Store this
  // ... other fields
});
```

## Entity Types

| Type | Import | Usage |
|------|--------|-------|
| Task | `DeepLinkEntity.Task` | `generateTaskLinks(id)` |
| Order | `DeepLinkEntity.Order` | `generateOrderLinks(id)` |
| Item | `DeepLinkEntity.Item` | `generateItemLinks(id)` |
| ServiceOrder | `DeepLinkEntity.ServiceOrder` | `generateServiceOrderLinks(id)` |
| User | `DeepLinkEntity.User` | `generateUserLinks(id)` |

## URL Formats

### Web
```
https://yourapp.com/production/tasks/details/{id}
```

### Mobile (Custom Scheme)
```
yourapp://production/tasks/{id}
```

### Universal Link
```
https://yourapp.com/app/production/tasks/{id}
```

## Testing Endpoints

### Get Links
```bash
GET /deep-links/task/:id?action=view
GET /deep-links/order/:id
GET /deep-links/item/:id
GET /deep-links/service-order/:id
GET /deep-links/user/:id
```

### Test Generation
```bash
POST /deep-links/test
{
  "entityType": "Task",
  "entityId": "123",
  "queryParams": { "action": "approve" }
}
```

### Validate Link
```bash
POST /deep-links/validate
{
  "url": "yourapp://production/tasks/123"
}
```

## Common Query Parameters

| Parameter | Purpose | Example |
|-----------|---------|---------|
| `action` | Action to perform | `approve`, `view`, `edit`, `delete` |
| `source` | Traffic source | `email`, `push`, `notification`, `sms` |
| `highlight` | Section to highlight | `status`, `description`, `comments` |
| `section` | Direct section navigation | `details`, `history`, `comments` |
| `returnTo` | Return URL after action | `/dashboard`, `/tasks` |

## DeepLinkResult Object

```typescript
{
  web: string;           // HTTPS URL for browsers
  mobile: string;        // Custom scheme for mobile
  universalLink: string; // HTTPS that opens app
}
```

## Client-Side Usage

### Parse Notification Action URL
```typescript
// In client application
const notification = await getNotification(id);
const links = JSON.parse(notification.actionUrl);

// Choose appropriate URL
const url = isMobile ? links.universalLink : links.web;

// Navigate
navigate(url);
```

## Service Methods Reference

### Single Platform
```typescript
generateTaskLink(id, platform, params?)
generateOrderLink(id, platform, params?)
generateItemLink(id, platform, params?)
generateServiceOrderLink(id, platform, params?)
generateUserLink(id, platform, params?)
```

### All Platforms
```typescript
generateTaskLinks(id, params?)
generateOrderLinks(id, params?)
generateItemLinks(id, params?)
generateServiceOrderLinks(id, params?)
generateUserLinks(id, params?)
```

### Notification Integration
```typescript
generateNotificationActionUrl(entityType, id, params?)
parseNotificationActionUrl(actionUrl)
validateDeepLink(url)
```

## Real-World Examples

### Task Assignment
```typescript
const actionUrl = this.deepLinkService.generateNotificationActionUrl(
  DeepLinkEntity.Task,
  taskId,
  { action: 'view', source: 'assignment' }
);
```

### Order Approval
```typescript
const actionUrl = this.deepLinkService.generateNotificationActionUrl(
  DeepLinkEntity.Order,
  orderId,
  { action: 'approve', source: 'approval_request' }
);
```

### Profile Update Reminder
```typescript
const actionUrl = this.deepLinkService.generateNotificationActionUrl(
  DeepLinkEntity.User,
  userId,
  { action: 'edit', section: 'personal_info' }
);
```

### Item Restock Alert
```typescript
const actionUrl = this.deepLinkService.generateNotificationActionUrl(
  DeepLinkEntity.Item,
  itemId,
  { action: 'reorder', source: 'low_stock' }
);
```

## Troubleshooting

### Links don't work
- Check environment variables are set
- Verify entity ID is valid
- Test with validation endpoint

### Mobile app doesn't open
- Verify universal link configuration
- Check mobile app scheme registration
- Test on real device (not simulator)

### Query params missing
- Don't pre-encode parameters
- Use service methods (auto-encoding)
- Check client-side parsing

## Best Practices Checklist

- [ ] Always include `action` parameter
- [ ] Store complete JSON in notifications
- [ ] Use universal links for mobile
- [ ] Validate entity IDs before generation
- [ ] Add source tracking for analytics
- [ ] Log deep link generation
- [ ] Handle link expiration for time-sensitive actions
- [ ] Test on all platforms

## Further Reading

- **[DEEP_LINK_README.md](./DEEP_LINK_README.md)** - Complete documentation
- **[DEEP_LINK_USAGE.md](./DEEP_LINK_USAGE.md)** - Detailed usage guide
- **[deep-link-integration.example.ts](./deep-link-integration.example.ts)** - Code examples
