# Message/Announcement System API

Complete backend implementation for managing system messages and announcements with rich content, user targeting, and view tracking.

## Features

- **CRUD Operations**: Full create, read, update, delete for messages (admin only)
- **User Targeting**:
  - All users
  - Specific users (by ID)
  - Specific roles (e.g., ADMIN, PRODUCTION, WAREHOUSE)
- **Rich Content Blocks**: Support for multiple content types (text, heading, list, image, link, callout)
- **View Tracking**: Track which users have viewed which messages
- **Priority Levels**: LOW, NORMAL, HIGH, URGENT
- **Date Range**: Set start and end dates for message visibility
- **Statistics**: View counts and engagement metrics (admin only)
- **Authorization**: Role-based access control (admin for management, all users for viewing)

## Database Schema

### Message Table
```sql
CREATE TABLE "Message" (
  id UUID PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  contentBlocks JSONB NOT NULL,
  targetType VARCHAR(50) NOT NULL, -- ALL_USERS, SPECIFIC_USERS, SPECIFIC_ROLES
  targetUserIds TEXT[],
  targetRoles TEXT[],
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  isActive BOOLEAN NOT NULL DEFAULT true,
  startsAt TIMESTAMP,
  endsAt TIMESTAMP,
  actionUrl VARCHAR(500),
  actionText VARCHAR(100),
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL,
  createdById UUID NOT NULL REFERENCES "User"(id)
);
```

### MessageView Table
```sql
CREATE TABLE "MessageView" (
  id UUID PRIMARY KEY,
  messageId UUID NOT NULL REFERENCES "Message"(id),
  userId UUID NOT NULL REFERENCES "User"(id),
  viewedAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL,
  UNIQUE(messageId, userId)
);
```

## API Endpoints

### Admin Endpoints

#### Create Message
```http
POST /messages
Authorization: Bearer <token>
Role: ADMIN

Request Body:
{
  "title": "System Maintenance Notice",
  "contentBlocks": [
    {
      "type": "HEADING",
      "content": "Important Notice"
    },
    {
      "type": "TEXT",
      "content": "The system will be under maintenance on Saturday."
    },
    {
      "type": "CALLOUT",
      "content": "Please save your work before 10 PM.",
      "metadata": { "variant": "warning" }
    }
  ],
  "targetType": "ALL_USERS",
  "priority": "HIGH",
  "isActive": true,
  "startsAt": "2026-01-06T00:00:00Z",
  "endsAt": "2026-01-13T23:59:59Z",
  "actionUrl": "/help/maintenance",
  "actionText": "Learn More"
}

Response:
{
  "success": true,
  "data": { ... },
  "message": "Message created successfully"
}
```

#### Get All Messages
```http
GET /messages?page=1&limit=10&isActive=true&priority=HIGH
Authorization: Bearer <token>
Role: ADMIN

Response:
{
  "success": true,
  "data": [...],
  "meta": {
    "total": 25,
    "page": 1,
    "limit": 10,
    "totalPages": 3
  },
  "message": "Messages retrieved successfully"
}
```

#### Get Message by ID
```http
GET /messages/:id
Authorization: Bearer <token>
Role: ADMIN

Response:
{
  "success": true,
  "data": { ... },
  "message": "Message retrieved successfully"
}
```

#### Update Message
```http
PUT /messages/:id
Authorization: Bearer <token>
Role: ADMIN

Request Body:
{
  "title": "Updated Title",
  "isActive": false
}

Response:
{
  "success": true,
  "data": { ... },
  "message": "Message updated successfully"
}
```

#### Delete Message
```http
DELETE /messages/:id
Authorization: Bearer <token>
Role: ADMIN

Response:
{
  "success": true,
  "message": "Message deleted successfully"
}
```

#### Get Message Statistics
```http
GET /messages/:id/stats
Authorization: Bearer <token>
Role: ADMIN

Response:
{
  "success": true,
  "data": {
    "totalViews": 150,
    "uniqueViewers": 45,
    "targetedUsers": 100
  },
  "message": "Statistics retrieved successfully"
}
```

### User Endpoints

#### Get Unviewed Messages
```http
GET /messages/unviewed
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "New Feature Announcement",
      "contentBlocks": [...],
      "priority": "HIGH",
      ...
    }
  ],
  "meta": {
    "count": 3
  },
  "message": "Unviewed messages retrieved successfully"
}
```

#### Mark Message as Viewed
```http
POST /messages/:id/mark-viewed
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "messageId": "uuid",
    "userId": "uuid",
    "viewedAt": "2026-01-06T12:00:00Z"
  },
  "message": "Message marked as viewed"
}
```

## Content Block Types

### TEXT
```json
{
  "type": "TEXT",
  "content": "Regular text content"
}
```

### HEADING
```json
{
  "type": "HEADING",
  "content": "Section Heading"
}
```

### LIST
```json
{
  "type": "LIST",
  "content": "- Item 1\n- Item 2\n- Item 3"
}
```

### IMAGE
```json
{
  "type": "IMAGE",
  "content": "Image description",
  "metadata": {
    "url": "https://example.com/image.jpg",
    "alt": "Image alt text"
  }
}
```

### LINK
```json
{
  "type": "LINK",
  "content": "Click here for more information",
  "metadata": {
    "href": "/help/guide",
    "target": "_blank"
  }
}
```

### CALLOUT
```json
{
  "type": "CALLOUT",
  "content": "Important information",
  "metadata": {
    "variant": "warning" // info, warning, error, success
  }
}
```

## Targeting Logic

### All Users
```json
{
  "targetType": "ALL_USERS"
}
```
Message will be visible to all active users.

### Specific Users
```json
{
  "targetType": "SPECIFIC_USERS",
  "targetUserIds": ["uuid1", "uuid2", "uuid3"]
}
```
Message will only be visible to specified user IDs.

### Specific Roles
```json
{
  "targetType": "SPECIFIC_ROLES",
  "targetRoles": ["ADMIN", "PRODUCTION", "WAREHOUSE"]
}
```
Message will be visible to users with any of the specified roles.

## Validation Rules

### Required Fields
- `title`: 1-200 characters
- `contentBlocks`: At least one block required
- `targetType`: Must be valid enum value

### Conditional Requirements
- If `targetType` is `SPECIFIC_USERS`: `targetUserIds` required (at least one)
- If `targetType` is `SPECIFIC_ROLES`: `targetRoles` required (at least one)

### Date Validation
- `endsAt` must be after `startsAt` (if both provided)
- Dates in the past are allowed for historical records

### Content Block Validation
- Each block must have `type` and `content`
- `content` max length: 5000 characters
- `metadata` is optional and block-type specific

## Authorization

### Admin-Only Operations
- Create message: `POST /messages`
- Update message: `PUT /messages/:id`
- Delete message: `DELETE /messages/:id`
- List all messages: `GET /messages`
- Get message by ID: `GET /messages/:id`
- Get statistics: `GET /messages/:id/stats`

### User Operations
- Get unviewed messages: `GET /messages/unviewed`
- Mark as viewed: `POST /messages/:id/mark-viewed`

## Error Handling

### 400 Bad Request
- Missing required fields
- Invalid content blocks
- Invalid targeting configuration
- Invalid date ranges

### 403 Forbidden
- Non-admin trying to access admin endpoints
- User trying to view message they don't have access to

### 404 Not Found
- Message ID doesn't exist

### 500 Internal Server Error
- Database errors
- Unexpected server errors

## Usage Examples

### Creating a System-Wide Announcement
```typescript
const message = await messageService.create({
  title: 'Company Holiday Announcement',
  contentBlocks: [
    {
      type: CONTENT_BLOCK_TYPE.HEADING,
      content: 'Holiday Schedule'
    },
    {
      type: CONTENT_BLOCK_TYPE.TEXT,
      content: 'The office will be closed from December 24-26.'
    },
    {
      type: CONTENT_BLOCK_TYPE.CALLOUT,
      content: 'Please plan accordingly.',
      metadata: { variant: 'info' }
    }
  ],
  targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
  priority: MESSAGE_PRIORITY.HIGH,
  isActive: true,
  startsAt: '2026-12-20T00:00:00Z',
  endsAt: '2026-12-27T00:00:00Z'
}, adminUserId);
```

### Creating a Role-Specific Message
```typescript
const message = await messageService.create({
  title: 'Production Team Update',
  contentBlocks: [
    {
      type: CONTENT_BLOCK_TYPE.TEXT,
      content: 'New production schedule is available.'
    }
  ],
  targetType: MESSAGE_TARGET_TYPE.SPECIFIC_ROLES,
  targetRoles: ['PRODUCTION'],
  priority: MESSAGE_PRIORITY.NORMAL,
  isActive: true
}, adminUserId);
```

### Getting Unviewed Messages for User
```typescript
const unviewedMessages = await messageService.getUnviewedForUser(
  userId,
  userRole
);
```

### Marking Message as Viewed
```typescript
const view = await messageService.markAsViewed(
  messageId,
  userId,
  userRole
);
```

## Migration

To set up the database tables, run:

```bash
# Apply the migration
psql -U your_user -d your_database -f prisma/migrations/create_message_tables.sql
```

Or if using Prisma:

```bash
npx prisma db push
```

## Integration

### 1. Register Module
```typescript
// app.module.ts
import { MessageModule } from './modules/system/message/message.module';

@Module({
  imports: [
    // ... other modules
    MessageModule,
  ],
})
export class AppModule {}
```

### 2. Use in Frontend
```typescript
// Get unviewed messages
const response = await fetch('/api/messages/unviewed', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { data: messages } = await response.json();

// Mark as viewed
await fetch(`/api/messages/${messageId}/mark-viewed`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

## Testing

### Create Test Message
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Message",
    "contentBlocks": [{"type": "TEXT", "content": "Test"}],
    "targetType": "ALL_USERS",
    "priority": "NORMAL",
    "isActive": true
  }'
```

### Get Unviewed Messages
```bash
curl http://localhost:3000/api/messages/unviewed \
  -H "Authorization: Bearer <user-token>"
```

### Mark as Viewed
```bash
curl -X POST http://localhost:3000/api/messages/<message-id>/mark-viewed \
  -H "Authorization: Bearer <user-token>"
```

## Notes

- Messages are automatically filtered by date range and targeting rules
- Users can only see messages that are:
  - Active (`isActive = true`)
  - Within date range (if specified)
  - Targeted to them (based on `targetType`)
- View tracking prevents duplicate views (unique constraint on `messageId + userId`)
- All admin operations require ADMIN role
- Statistics provide insights into message engagement

## Future Enhancements

Possible improvements:
- Email/push notification integration when new messages are created
- Message templates for common announcements
- Rich text editor support
- File attachments
- Message categories/tags
- Scheduled publishing
- A/B testing for messages
- Analytics dashboard
