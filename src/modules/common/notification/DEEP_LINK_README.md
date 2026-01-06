# Deep Link Service

A comprehensive service for generating platform-specific deep links for navigating to specific entities within your application. Supports web URLs, mobile deep links (custom schemes), and universal links.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The Deep Link Service provides a unified way to generate navigation URLs for different platforms (web and mobile) that point to specific entities in your application. It's designed to integrate seamlessly with the notification system, enabling notifications to contain actionable links that work across all platforms.

### Key Concepts

- **Deep Link**: A URL that points to a specific location within an app, bypassing the home screen
- **Custom Scheme**: Mobile-specific URL format (e.g., `yourapp://path/to/resource`)
- **Universal Link**: HTTPS URL that opens the app if installed, otherwise opens in browser
- **Action URL**: JSON string containing deep links for all platforms

## Features

- Generate deep links for multiple entity types (Task, Order, Item, ServiceOrder, User)
- Platform-specific URL generation (web and mobile)
- Universal link support for seamless mobile experience
- Query parameter support for context-aware actions
- Automatic URL encoding for safe parameter handling
- Integration with notification system
- Validation and parsing utilities
- RESTful API endpoints for testing

## Installation

The Deep Link Service is already integrated into the Notification Module. No additional installation is required.

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
# Required: Web application base URL
WEB_APP_URL=https://yourapp.com

# Required: Mobile app custom URL scheme (without ://)
MOBILE_APP_SCHEME=yourapp

# Optional: Domain for universal links (defaults to WEB_APP_URL)
UNIVERSAL_LINK_DOMAIN=https://yourapp.com
```

### Mobile App Configuration

#### iOS (Universal Links)

1. Create an `apple-app-site-association` file on your server:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.BUNDLE_ID",
        "paths": ["/app/*"]
      }
    ]
  }
}
```

2. Host it at: `https://yourapp.com/.well-known/apple-app-site-association`

3. Add Associated Domains capability in Xcode:
   ```
   applinks:yourapp.com
   ```

#### Android (App Links)

1. Add intent filter to `AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data
    android:scheme="https"
    android:host="yourapp.com"
    android:pathPrefix="/app/" />
</intent-filter>

<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data
    android:scheme="yourapp"
    android:host="*" />
</intent-filter>
```

2. Create `assetlinks.json` file:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.yourapp",
    "sha256_cert_fingerprints": ["YOUR_CERT_FINGERPRINT"]
  }
}]
```

3. Host it at: `https://yourapp.com/.well-known/assetlinks.json`

## Architecture

### Entity Types

The service supports five entity types:

| Entity Type | Description | Web Route | Mobile Route |
|------------|-------------|-----------|--------------|
| `Task` | Production tasks | `/production/tasks/details/` | `production/tasks/` |
| `Order` | Inventory orders | `/inventory/orders/details/` | `inventory/orders/` |
| `Item` | Inventory items/products | `/inventory/products/details/` | `inventory/items/` |
| `ServiceOrder` | Service orders | `/production/service-orders/details/` | `production/service-orders/` |
| `User` | User profiles | `/administration/collaborators/details/` | `profile/` |

### URL Structure

#### Web URLs
```
https://yourapp.com/production/tasks/details/{taskId}?action=view&source=notification
```

#### Mobile Deep Links (Custom Scheme)
```
yourapp://production/tasks/{taskId}?action=view&source=notification
```

#### Universal Links
```
https://yourapp.com/app/production/tasks/{taskId}?action=view&source=notification
```

### Deep Link Result

All platform-specific generation methods return a `DeepLinkResult` object:

```typescript
{
  web: string;           // HTTPS URL for web browsers
  mobile: string;        // Custom scheme URL for mobile apps
  universalLink: string; // HTTPS URL that opens mobile app
}
```

## API Reference

### Service Methods

#### Generate Single Platform Links

```typescript
// Task links
generateTaskLink(taskId: string, platform: 'web' | 'mobile', queryParams?: DeepLinkQueryParams): string

// Order links
generateOrderLink(orderId: string, platform: 'web' | 'mobile', queryParams?: DeepLinkQueryParams): string

// Item links
generateItemLink(itemId: string, platform: 'web' | 'mobile', queryParams?: DeepLinkQueryParams): string

// Service Order links
generateServiceOrderLink(serviceOrderId: string, platform: 'web' | 'mobile', queryParams?: DeepLinkQueryParams): string

// User links
generateUserLink(userId: string, platform: 'web' | 'mobile', queryParams?: DeepLinkQueryParams): string
```

#### Generate Multi-Platform Links

```typescript
// Task links (all platforms)
generateTaskLinks(taskId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult

// Order links (all platforms)
generateOrderLinks(orderId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult

// Item links (all platforms)
generateItemLinks(itemId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult

// Service Order links (all platforms)
generateServiceOrderLinks(serviceOrderId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult

// User links (all platforms)
generateUserLinks(userId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult
```

#### Notification Integration

```typescript
// Generate action URL for notifications (JSON string)
generateNotificationActionUrl(
  entityType: DeepLinkEntity,
  entityId: string,
  queryParams?: DeepLinkQueryParams
): string

// Parse action URL from notification
parseNotificationActionUrl(actionUrl: string | null): DeepLinkResult | null

// Validate deep link
validateDeepLink(url: string): boolean
```

### REST API Endpoints

#### Get Entity-Specific Links

```http
GET /deep-links/task/:id?action=view&source=email
GET /deep-links/order/:id?action=view
GET /deep-links/item/:id
GET /deep-links/service-order/:id
GET /deep-links/user/:id
```

Response:
```json
{
  "success": true,
  "data": {
    "web": "https://yourapp.com/production/tasks/details/123",
    "mobile": "yourapp://production/tasks/123",
    "universalLink": "https://yourapp.com/app/production/tasks/123"
  },
  "message": "Task deep links generated successfully"
}
```

#### Test Link Generation

```http
POST /deep-links/test
Content-Type: application/json

{
  "entityType": "Task",
  "entityId": "123e4567-e89b-12d3-a456-426614174000",
  "queryParams": {
    "action": "approve",
    "source": "email"
  }
}
```

#### Generate Notification Action URL

```http
POST /deep-links/notification-action-url
Content-Type: application/json

{
  "entityType": "Order",
  "entityId": "order-123",
  "queryParams": {
    "action": "view"
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "actionUrl": "{\"web\":\"https://...\",\"mobile\":\"yourapp://...\",\"universalLink\":\"https://...\"}",
    "parsed": {
      "web": "https://yourapp.com/inventory/orders/details/order-123?action=view",
      "mobile": "yourapp://inventory/orders/order-123?action=view",
      "universalLink": "https://yourapp.com/app/inventory/orders/order-123?action=view"
    }
  },
  "message": "Notification action URL generated successfully"
}
```

#### Validate Deep Link

```http
POST /deep-links/validate
Content-Type: application/json

{
  "url": "https://yourapp.com/production/tasks/details/123"
}
```

#### Get Available Entity Types

```http
GET /deep-links/entity-types
```

## Usage Examples

### Basic Usage

```typescript
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';

@Injectable()
export class MyService {
  constructor(private readonly deepLinkService: DeepLinkService) {}

  // Generate web link only
  getWebLink() {
    return this.deepLinkService.generateTaskLink('task-123', 'web');
    // Returns: https://yourapp.com/production/tasks/details/task-123
  }

  // Generate all platform links
  getAllLinks() {
    return this.deepLinkService.generateTaskLinks('task-123');
    // Returns: { web: '...', mobile: '...', universalLink: '...' }
  }

  // Generate links with query parameters
  getLinksWithParams() {
    return this.deepLinkService.generateTaskLinks('task-123', {
      action: 'approve',
      source: 'email'
    });
  }
}
```

### Notification Integration

```typescript
import { NotificationService } from './notification.service';
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';

@Injectable()
export class TaskNotificationService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  async sendTaskAssignment(taskId: string, userId: string, taskTitle: string) {
    // Generate action URL with both platforms
    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Task,
      taskId,
      { action: 'view', source: 'notification' }
    );

    // Create notification
    await this.notificationService.createNotification({
      userId,
      title: 'New Task Assigned',
      body: `You have been assigned: ${taskTitle}`,
      type: 'TASK_ASSIGNMENT',
      importance: 'MEDIUM',
      channel: ['IN_APP', 'PUSH'],
      actionUrl, // Stored as JSON string
      actionType: 'VIEW_TASK',
    });
  }
}
```

### Client-Side Parsing

```typescript
// Frontend/Mobile application
const notification = await fetchNotification(notificationId);

// Parse the action URL
const actionUrls = JSON.parse(notification.actionUrl);

// Choose appropriate URL based on platform
const isMobile = /* detect platform */;
const url = isMobile
  ? actionUrls.universalLink  // Preferred for mobile
  : actionUrls.web;

// Navigate to the URL
navigate(url);
```

## Testing

### Unit Tests

```bash
npm test deep-link.service.spec.ts
```

### Integration Tests

```bash
# Test task link generation
curl http://localhost:3000/deep-links/task/test-123?action=view

# Test with POST
curl -X POST http://localhost:3000/deep-links/test \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "Task",
    "entityId": "test-123",
    "queryParams": {"action": "approve"}
  }'

# Validate a link
curl -X POST http://localhost:3000/deep-links/validate \
  -H "Content-Type: application/json" \
  -d '{"url": "yourapp://production/tasks/test-123"}'
```

### Manual Testing Checklist

- [ ] Web links open correct pages in browser
- [ ] Mobile custom scheme links open app
- [ ] Universal links open app when installed
- [ ] Universal links open web when app not installed
- [ ] Query parameters are properly encoded
- [ ] Special characters in IDs are handled correctly
- [ ] All entity types generate correct routes
- [ ] Validation correctly identifies valid/invalid links

## Best Practices

### 1. Always Use Query Parameters for Actions

```typescript
// Good: Includes action context
generateTaskLinks(taskId, { action: 'approve', source: 'email' })

// Bad: No context for the app
generateTaskLinks(taskId)
```

### 2. Store Complete Deep Link Result in Notifications

```typescript
// Good: Store JSON with all platforms
const actionUrl = deepLinkService.generateNotificationActionUrl(
  DeepLinkEntity.Task,
  taskId,
  queryParams
);

// Bad: Store only one platform
const actionUrl = deepLinkService.generateTaskLink(taskId, 'web');
```

### 3. Use Universal Links for Mobile

```typescript
// Good: Universal links provide better UX
const url = isMobile ? links.universalLink : links.web;

// Acceptable: Falls back to custom scheme
const url = isMobile ? links.mobile : links.web;
```

### 4. Validate Entity IDs

```typescript
// Good: Validate before generating
if (!taskId || taskId.trim() === '') {
  throw new Error('Invalid task ID');
}
const links = deepLinkService.generateTaskLinks(taskId);

// Bad: No validation
const links = deepLinkService.generateTaskLinks(taskId);
```

### 5. Add Source Tracking

```typescript
// Good: Track where links are used
generateTaskLinks(taskId, {
  action: 'view',
  source: 'email_notification',
  campaign: 'task_reminders'
});
```

### 6. Handle Link Expiration

```typescript
// Good: Add expiration for time-sensitive actions
generateTaskLinks(taskId, {
  action: 'approve',
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
});
```

### 7. Log Deep Link Usage

```typescript
// Good: Log for analytics
const links = deepLinkService.generateTaskLinks(taskId, queryParams);
logger.log('Generated deep link', { taskId, queryParams, userId });
```

## Troubleshooting

### Links Don't Open App on Mobile

**Symptoms**: Universal links open in browser instead of app

**Solutions**:
1. Verify `apple-app-site-association` is accessible at `https://yourdomain.com/.well-known/apple-app-site-association`
2. Check that the file is served with `Content-Type: application/json`
3. Ensure app is properly configured with Associated Domains (iOS) or App Links (Android)
4. Test on a real device (simulators can behave differently)

### Custom Scheme Links Not Working

**Symptoms**: `yourapp://` links don't open the app

**Solutions**:
1. Verify the custom scheme is registered in app's `Info.plist` (iOS) or `AndroidManifest.xml` (Android)
2. Check that `MOBILE_APP_SCHEME` environment variable matches the registered scheme
3. Ensure the scheme doesn't conflict with system schemes

### Query Parameters Not Working

**Symptoms**: Parameters are missing or incorrectly formatted

**Solutions**:
1. Use the service's built-in encoding (don't pre-encode parameters)
2. Check for special characters that need encoding
3. Verify client-side parsing of query parameters

### Wrong Routes Generated

**Symptoms**: Links point to incorrect pages

**Solutions**:
1. Verify entity type matches the actual entity
2. Check that routes in `ROUTES` constant match your app's routing
3. Update route mappings if your app structure changed

### Environment Variables Not Loading

**Symptoms**: Links use default values instead of configured URLs

**Solutions**:
1. Verify `.env` file exists and is properly formatted
2. Restart the application after changing environment variables
3. Check that `ConfigModule` is imported in `NotificationModule`

## Further Reading

- [DEEP_LINK_USAGE.md](./DEEP_LINK_USAGE.md) - Detailed usage guide with examples
- [deep-link-integration.example.ts](./deep-link-integration.example.ts) - Code examples
- [iOS Universal Links Documentation](https://developer.apple.com/ios/universal-links/)
- [Android App Links Documentation](https://developer.android.com/training/app-links)

## Support

For issues or questions about the Deep Link Service, please:
1. Check this documentation and the usage guide
2. Review the example code
3. Test using the provided API endpoints
4. Contact the development team

## Version History

- **v1.0.0** - Initial implementation
  - Support for 5 entity types
  - Web, mobile (custom scheme), and universal link generation
  - Query parameter support
  - Notification integration
  - REST API endpoints for testing
