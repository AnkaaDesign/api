# Message System Workflow Documentation

## Overview
The message system allows administrators to create and manage announcements that are displayed to users based on targeting rules and scheduling.

**Last Updated**: January 2026
**Version**: 2.0 (Simplified)

## Message Lifecycle

### 1. **Creation**
When a message is created:
- **Draft Mode** (`isActive: false`):
  - `status` = `'DRAFT'`
  - `publishedAt` = `NULL`
  - Message will NOT appear to any users
  - Can be edited and previewed

- **Active Mode** (`isActive: true`):
  - `status` = `'ACTIVE'`
  - `publishedAt` = `NOW()` (current timestamp)
  - Message will appear to targeted users immediately (or at `startDate` if specified)

### 2. **Display Logic**
Messages appear to users when ALL these conditions are met:

1. **Status Check**: `status = 'ACTIVE'`
2. **Published Check**: `publishedAt IS NOT NULL`
3. **Date Range Check**:
   - If `startDate` is set: `NOW() >= startDate`
   - If `endDate` is set: `NOW() <= endDate`
4. **Targeting Check**: User matches targeting rules
5. **Not Dismissed**: User hasn't permanently dismissed the message

### 3. **Scheduling Options**

#### **Immediate Display** (Default)
```typescript
{
  isActive: true,
  // No startDate, no endDate
}
```
- Message shows immediately after creation
- Remains visible indefinitely until archived

#### **Scheduled Start**
```typescript
{
  isActive: true,
  startsAt: '2026-01-10T08:00:00Z', // Future date
}
```
- Message is created but won't show until start date
- At first app focus on or after start date, message will appear

#### **Time-Limited Campaign**
```typescript
{
  isActive: true,
  startsAt: '2026-01-10T08:00:00Z',
  endsAt: '2026-01-20T23:59:59Z',
}
```
- Shows during the specified date range
- Automatically stops showing after end date

#### **Next Day Display**
```typescript
{
  isActive: true,
  startsAt: '2026-01-09T00:00:00Z', // Tomorrow at midnight
}
```
- Message will appear at first app focus on the next day

### 4. **User Interaction**

#### **View Tracking**
- When user sees a message, a `MessageView` record is created
- `viewedAt` timestamp is recorded
- Message continues to show until dismissed (views don't hide messages)

#### **Temporary Dismissal** (Frontend Only)
- User clicks "Show Later" or similar
- Message ID stored in localStorage with today's date
- Message hidden for today only
- Will show again tomorrow

#### **Permanent Dismissal**
- User clicks "Don't Show Again"
- `MessageView.dismissedAt` is set
- Message will NEVER show to this user again
- Persists across devices and sessions

### 5. **Targeting Types** (SIMPLIFIED)

The targeting system has been simplified. The backend always resolves targeting to user IDs:

#### **All Users**
```typescript
targetType: 'ALL_USERS'
// No MessageTarget records created
```
- Shows to every user in the system
- Database: No records in MessageTarget table

#### **Specific Users**
```typescript
targetType: 'SPECIFIC_USERS',
targetUserIds: ['user-id-1', 'user-id-2']
```
- Shows only to listed users
- Database: MessageTarget records created for each user

#### **By Sector**
```typescript
targetType: 'BY_SECTOR',
targetSectorIds: ['sector-id-1', 'sector-id-2']
```
- Backend resolves all active users in those sectors
- Database: MessageTarget records created for resolved users

#### **By Position** (Cargo)
```typescript
targetType: 'BY_POSITION',
targetPositionIds: ['position-id-1', 'position-id-2']
```
- Backend resolves all active users with those positions
- Database: MessageTarget records created for resolved users

**Key Point**: The database ONLY stores user IDs in MessageTarget. Sector/position selections are resolved to user IDs at creation time.

## First Focus Display Logic

### Web Application
Messages are checked and displayed:
1. On initial page load (`refetchOnMount: 'always'`)
2. When window regains focus (`refetchOnWindowFocus: true`)
3. Every 60 seconds (`refetchInterval: 60000`)

### Mobile Application
Should implement similar logic:
1. On app launch
2. When app comes to foreground
3. Periodic background check

## Database Schema (SIMPLIFIED - v2.0)

### Message Table
```typescript
{
  id: string;
  title: string;
  content: JSON; // { blocks: [...] }
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'ARCHIVED';
  publishedAt: Date | null; // CRITICAL: Must be set for messages to appear
  startDate: Date | null;
  endDate: Date | null;
  // REMOVED: targetingType (determined by presence of targets)
  // REMOVED: priority, priorityOrder, actionType, actionUrl
  createdById: string;
  isDismissible: boolean @default(true);
  requiresView: boolean @default(false);
  metadata: JSON | null; // Optional metadata
  createdAt: Date;
  updatedAt: Date;
}
```

### MessageTarget Table (SIMPLIFIED)
```typescript
{
  id: string;
  messageId: string;
  userId: string; // ALWAYS a user ID (resolved from sector/position)
  createdAt: Date;
  updatedAt: Date;

  @@unique([messageId, userId]) // Prevent duplicates
}
```

### MessageView Table
```typescript
{
  id: string;
  messageId: string;
  userId: string;
  viewedAt: Date; // When user first saw it
  dismissedAt: Date | null; // When user permanently dismissed it
}
```

**Key Changes from v1.0**:
- MessageTarget now ONLY stores userId (no sectorId, positionId, privileges)
- Removed targetingType from Message (implicit: no targets = ALL_USERS)
- Removed priority/action fields (use content blocks for buttons)
- Added unique constraint on [messageId, userId]

## API Endpoints

### Create Message
```bash
POST /messages
{
  "title": "Important Update",
  "contentBlocks": [...],
  "targetType": "ALL_USERS",
  "isActive": true,
  "startsAt": "2026-01-10T00:00:00Z" // Optional
}
```

### Get Unviewed Messages (User)
```bash
GET /messages/unviewed
# Returns messages that:
# - Are ACTIVE
# - Have publishedAt set
# - Match date range
# - Match targeting
# - Aren't permanently dismissed by user
```

### Mark as Viewed
```bash
POST /messages/:id/mark-viewed
# Creates MessageView record with viewedAt
```

### Dismiss Permanently
```bash
POST /messages/:id/dismiss
# Sets MessageView.dismissedAt
```

## Common Issues & Solutions

### Issue: Message created but doesn't appear
**Cause**: `publishedAt` is NULL
**Solution**: Ensure `isActive: true` when creating, which sets `publishedAt`

### Issue: Message shows every day after dismissal
**Cause**: Using localStorage dismissal instead of database
**Solution**: Use `/messages/:id/dismiss` endpoint for permanent dismissal

### Issue: Scheduled message doesn't appear
**Cause**: `startDate` is set but `publishedAt` is NULL
**Solution**: Set both `isActive: true` and `startsAt` when creating

### Issue: Message appears before scheduled date
**Cause**: `startDate` is NULL but message is ACTIVE
**Solution**: Always set `startsAt` when scheduling for future

## Best Practices

1. **Always set `publishedAt` for ACTIVE messages** - This is now automatic in create/update methods
2. **Use database dismissal for "Don't show again"** - Not localStorage
3. **Use localStorage only for "Show later"** - Temporary daily dismissal
4. **Test targeting rules** - Verify users can see messages they should see
5. **Set end dates for time-sensitive messages** - Prevents stale announcements
6. **Monitor view statistics** - Track engagement with `/messages/:id/stats`

## Frontend Implementation Checklist

- [x] Auto-fetch on mount
- [x] Auto-fetch on window focus
- [x] Periodic refresh (60s)
- [x] Daily dismissal (localStorage)
- [x] Permanent dismissal (API)
- [ ] Mobile: App foreground detection
- [ ] Mobile: Background sync
- [ ] Push notifications for high-priority messages (future)
