# Message API - Quick Reference

## Endpoints at a Glance

### Admin Endpoints (Require ADMIN role)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/messages` | Create new message |
| GET | `/messages` | List all messages (with filters) |
| GET | `/messages/:id` | Get message by ID |
| PUT | `/messages/:id` | Update message |
| DELETE | `/messages/:id` | Delete message |
| GET | `/messages/:id/stats` | Get message statistics |

### User Endpoints (All authenticated users)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/messages/unviewed` | Get unviewed messages for current user |
| POST | `/messages/:id/mark-viewed` | Mark message as viewed |

## Enums

### MESSAGE_TARGET_TYPE
```typescript
ALL_USERS         // Message visible to all users
SPECIFIC_USERS    // Message visible to specific user IDs
SPECIFIC_ROLES    // Message visible to users with specific roles
```

### MESSAGE_PRIORITY
```typescript
LOW      // Low priority
NORMAL   // Normal priority (default)
HIGH     // High priority
URGENT   // Urgent priority
```

### CONTENT_BLOCK_TYPE
```typescript
TEXT      // Plain text content
HEADING   // Section heading
LIST      // Bulleted or numbered list
IMAGE     // Image with URL
LINK      // Hyperlink
CALLOUT   // Highlighted box (info, warning, error, success)
```

## Common Request Bodies

### Create Message (Admin)
```json
{
  "title": "Message Title",
  "contentBlocks": [
    {
      "type": "TEXT",
      "content": "Message content"
    }
  ],
  "targetType": "ALL_USERS",
  "priority": "NORMAL",
  "isActive": true,
  "startsAt": "2026-01-06T00:00:00Z",
  "endsAt": "2026-01-13T23:59:59Z",
  "actionUrl": "/path",
  "actionText": "Click Here"
}
```

### Update Message (Admin)
```json
{
  "title": "Updated Title",
  "isActive": false
}
```

### Filter Messages (Admin)
```
GET /messages?targetType=ALL_USERS&priority=HIGH&isActive=true&page=1&limit=10
```

## Common Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### List Response
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  },
  "message": "Messages retrieved"
}
```

## Validation Rules

### Required Fields
- `title`: 1-200 characters
- `contentBlocks`: At least one block
- `targetType`: Valid enum value

### Conditional Requirements
- `targetType = SPECIFIC_USERS` → `targetUserIds` required
- `targetType = SPECIFIC_ROLES` → `targetRoles` required

### Date Validation
- `endsAt` must be after `startsAt`

## Content Block Examples

### Text Block
```json
{
  "type": "TEXT",
  "content": "This is plain text"
}
```

### Heading Block
```json
{
  "type": "HEADING",
  "content": "Section Title"
}
```

### List Block
```json
{
  "type": "LIST",
  "content": "- Item 1\n- Item 2\n- Item 3"
}
```

### Image Block
```json
{
  "type": "IMAGE",
  "content": "Image description",
  "metadata": {
    "url": "https://example.com/image.jpg",
    "alt": "Alt text"
  }
}
```

### Link Block
```json
{
  "type": "LINK",
  "content": "Click here",
  "metadata": {
    "href": "/path",
    "target": "_blank"
  }
}
```

### Callout Block
```json
{
  "type": "CALLOUT",
  "content": "Important notice",
  "metadata": {
    "variant": "warning"
  }
}
```

## Targeting Examples

### All Users
```json
{
  "targetType": "ALL_USERS"
}
```

### Specific Users
```json
{
  "targetType": "SPECIFIC_USERS",
  "targetUserIds": ["uuid1", "uuid2"]
}
```

### Specific Roles
```json
{
  "targetType": "SPECIFIC_ROLES",
  "targetRoles": ["ADMIN", "PRODUCTION"]
}
```

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - validation failed |
| 403 | Forbidden - insufficient permissions |
| 404 | Not Found - message doesn't exist |
| 500 | Internal Server Error |

## Database Tables

### Message
```sql
id, title, contentBlocks, targetType, targetUserIds,
targetRoles, priority, isActive, startsAt, endsAt,
actionUrl, actionText, createdAt, updatedAt, createdById
```

### MessageView
```sql
id, messageId, userId, viewedAt, createdAt
UNIQUE(messageId, userId)
```

## Quick Start

### 1. Run Migration
```bash
psql -U user -d db -f prisma/migrations/create_message_tables.sql
```

### 2. Register Module
```typescript
import { MessageModule } from './modules/system/message/message.module';

@Module({
  imports: [MessageModule],
})
export class AppModule {}
```

### 3. Create Message (Admin)
```typescript
const message = await messageService.create({
  title: 'Test Message',
  contentBlocks: [{ type: 'TEXT', content: 'Hello' }],
  targetType: 'ALL_USERS',
  priority: 'NORMAL',
  isActive: true
}, adminUserId);
```

### 4. Get Unviewed (User)
```typescript
const messages = await messageService.getUnviewedForUser(
  userId,
  userRole
);
```

### 5. Mark as Viewed (User)
```typescript
await messageService.markAsViewed(
  messageId,
  userId,
  userRole
);
```

## cURL Examples

### Create Message
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test",
    "contentBlocks": [{"type": "TEXT", "content": "Test"}],
    "targetType": "ALL_USERS",
    "priority": "NORMAL",
    "isActive": true
  }'
```

### Get Unviewed
```bash
curl http://localhost:3000/api/messages/unviewed \
  -H "Authorization: Bearer <user-token>"
```

### Mark as Viewed
```bash
curl -X POST http://localhost:3000/api/messages/<id>/mark-viewed \
  -H "Authorization: Bearer <user-token>"
```

### Get Statistics
```bash
curl http://localhost:3000/api/messages/<id>/stats \
  -H "Authorization: Bearer <admin-token>"
```

## TypeScript Types

### Message
```typescript
interface Message {
  id: string;
  title: string;
  contentBlocks: ContentBlock[];
  targetType: MESSAGE_TARGET_TYPE;
  targetUserIds: string[] | null;
  targetRoles: string[] | null;
  priority: MESSAGE_PRIORITY;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  actionUrl: string | null;
  actionText: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
}
```

### ContentBlock
```typescript
interface ContentBlock {
  type: CONTENT_BLOCK_TYPE;
  content: string;
  metadata?: Record<string, any>;
}
```

### MessageView
```typescript
interface MessageView {
  id: string;
  messageId: string;
  userId: string;
  viewedAt: Date;
  createdAt: Date;
}
```

## Common Use Cases

### 1. System Maintenance
```typescript
{
  targetType: 'ALL_USERS',
  priority: 'HIGH',
  startsAt: '2026-01-06T00:00:00Z',
  endsAt: '2026-01-07T00:00:00Z'
}
```

### 2. Team Update
```typescript
{
  targetType: 'SPECIFIC_ROLES',
  targetRoles: ['PRODUCTION'],
  priority: 'NORMAL'
}
```

### 3. Urgent Alert
```typescript
{
  targetType: 'SPECIFIC_USERS',
  targetUserIds: ['uuid1', 'uuid2'],
  priority: 'URGENT'
}
```

### 4. Feature Announcement
```typescript
{
  targetType: 'ALL_USERS',
  priority: 'NORMAL',
  startsAt: now,
  endsAt: oneWeekLater
}
```

## Tips

1. **Always validate** content blocks before creating
2. **Check targeting** rules match your data
3. **Use date ranges** for time-limited messages
4. **Set priority** appropriately for user experience
5. **Track statistics** to measure engagement
6. **Deactivate** instead of delete for historical records
7. **Test targeting** logic before sending to production
8. **Use pagination** when listing many messages
9. **Cache** frequently accessed messages
10. **Monitor** view rates to optimize content
