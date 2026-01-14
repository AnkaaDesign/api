# Service Order Workflow Documentation

## Table of Contents
1. [Overview](#overview)
2. [Status Lifecycle](#status-lifecycle)
3. [Automatic Timestamp & User Tracking](#automatic-timestamp--user-tracking)
4. [Notification System](#notification-system)
5. [Changelog Tracking](#changelog-tracking)
6. [Permissions](#permissions)
7. [API Endpoints](#api-endpoints)
8. [Best Practices](#best-practices)

---

## Overview

Service orders are work items that belong to tasks. They track specific work that needs to be done, with automatic user and timestamp tracking at each status transition.

### Database Schema

```prisma
model ServiceOrder {
  id            String             @id @default(uuid())
  status        ServiceOrderStatus @default(PENDING)
  statusOrder   Int                @default(1)
  description   String
  type          ServiceOrderType   @default(PRODUCTION)
  observation   String?            @db.Text
  assignedToId  String?
  taskId        String
  createdById   String
  startedById   String?
  approvedById  String?
  completedById String?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt
  startedAt     DateTime?
  approvedAt    DateTime?
  finishedAt    DateTime?

  // Relations
  assignedTo    User?   @relation("SERVICE_ORDER_ASSIGNED_TO")
  task          Task    @relation("SERVICE_ORDER_TASK")
  createdBy     User    @relation("SERVICE_ORDER_CREATED_BY")
  startedBy     User?   @relation("SERVICE_ORDER_STARTED_BY")
  approvedBy    User?   @relation("SERVICE_ORDER_APPROVED_BY")
  completedBy   User?   @relation("SERVICE_ORDER_COMPLETED_BY")
}
```

---

## Status Lifecycle

### Available Statuses

| Status | Value | statusOrder | Portuguese Label |
|--------|-------|-------------|------------------|
| PENDING | 'PENDING' | 1 | Pendente |
| IN_PROGRESS | 'IN_PROGRESS' | 2 | Em Andamento |
| WAITING_APPROVE | 'WAITING_APPROVE' | 3 | Aguardando Aprovação |
| COMPLETED | 'COMPLETED' | 4 | Concluído |
| CANCELLED | 'CANCELLED' | 5 | Cancelado |

### Status Flow Diagram

```
┌─────────┐
│ PENDING │
└────┬────┘
     │
     ↓
┌──────────────┐
│ IN_PROGRESS  │←──────┐
└────┬─────────┘       │ (Rejection/Rework)
     │                 │
     ├─────────────────┤
     │                 │
     ↓                 │
┌──────────────────┐   │
│ WAITING_APPROVE  │───┘
│  (ARTWORK only)  │
└────┬─────────────┘
     │
     ↓
┌───────────┐
│ COMPLETED │
└───────────┘

     ↓ (Any status can be cancelled by ADMIN)
┌───────────┐
│ CANCELLED │
└───────────┘
```

---

## Automatic Timestamp & User Tracking

The system **AUTOMATICALLY** sets timestamps and user IDs based on status transitions. You should **NOT** manually set these fields unless you have a specific reason.

### Automatic Rules

| Transition | Auto-Set Fields | Conditions | Code Reference |
|------------|----------------|------------|----------------|
| ANY → IN_PROGRESS | `startedAt = now()`<br>`startedById = userId` | Only if `startedById` is not already set | service-order.service.ts:660-665 |
| WAITING_APPROVE → COMPLETED/IN_PROGRESS | `approvedAt = now()`<br>`approvedById = userId` | Only if `approvedById` is not already set | service-order.service.ts:668-676 |
| ANY → COMPLETED | `finishedAt = now()`<br>`completedById = userId` | Only if `completedById` is not already set | service-order.service.ts:679-684 |
| COMPLETED → IN_PROGRESS | `finishedAt = null`<br>`completedById = null` | Rejection scenario - clears completion data | service-order.service.ts:687-694 |

### What This Means

✅ **DO THIS:**
```typescript
// Just change the status - timestamps are automatic!
await updateServiceOrder(id, {
  status: SERVICE_ORDER_STATUS.IN_PROGRESS,
});
// startedAt and startedById are automatically set ✓
```

❌ **DON'T DO THIS (unless necessary):**
```typescript
// Manually setting timestamps is usually not needed
await updateServiceOrder(id, {
  status: SERVICE_ORDER_STATUS.IN_PROGRESS,
  startedAt: new Date(), // Redundant - automatically set
  startedById: userId,   // Redundant - automatically set
});
```

### When to Manually Set Timestamps

Only set timestamps manually if:
1. Importing historical data
2. Correcting data from external sources
3. Explicitly backdating an action

---

## Notification System

### Events Emitted

The service order service emits the following events, which trigger notifications:

#### 1. `service-order.created`
**When:** Service order is created
**Payload:** `{ serviceOrder, userId }`
**Who Gets Notified:**
- Users with privileges matching the service order type:
  - ARTWORK → DESIGNER + ADMIN
  - FINANCIAL → FINANCIAL + ADMIN
  - NEGOTIATION → COMMERCIAL + ADMIN
  - PRODUCTION → PRODUCTION + LOGISTIC + ADMIN
- Excludes the creator

**Channels:** IN_APP, PUSH, WHATSAPP (mandatory)
**Code:** service-order.listener.ts:45-150

#### 2. `service-order.assigned`
**When:** Service order is assigned to a user
**Payload:** `{ serviceOrder, userId, assignedToId, previousAssignedToId? }`
**Who Gets Notified:**
- The assigned user (HIGH importance, mandatory)
- All ADMIN users (excluding if they're the assignee)

**Channels:** IN_APP, PUSH, WHATSAPP, EMAIL
**Code:** service-order.listener.ts:182-295

#### 3. `service-order.status.changed`
**When:** Service order status changes
**Payload:** `{ serviceOrder, oldStatus, newStatus, userId }`
**Who Gets Notified:**
- Users with privileges matching the service order type (same as creation)
- Assigned user (if exists and not the changer)
- Excludes the user who made the change

**Special Cases:**
- Rejection detection: newStatus = IN_PROGRESS from WAITING_APPROVE/COMPLETED
- HIGH importance for: rejections, COMPLETED, CANCELLED

**Channels:** IN_APP, PUSH, WHATSAPP
**Code:** service-order.listener.ts:534-694

#### 4. `service-order.completed`
**When:** Service order is completed
**Payload:** `{ serviceOrder, userId }`
**Who Gets Notified:**
- Creator of the service order (mandatory)
- All ADMIN users (excluding if they're the creator)

**Metadata Includes:** completedBy, startedBy, approvedBy names

**Channels:** IN_APP, PUSH, WHATSAPP, EMAIL
**Code:** service-order.listener.ts:302-447

#### 5. `service-order.artwork-waiting-approval`
**When:** ARTWORK service order status → WAITING_APPROVE
**Payload:** `{ serviceOrder, userId }`
**Who Gets Notified:**
- All ADMIN users (HIGH importance, mandatory)

**Channels:** IN_APP, PUSH, WHATSAPP, EMAIL
**Code:** service-order.listener.ts:454-523

#### 6. `service-order.assigned-user-updated`
**When:** Non-status fields change on assigned service order
**Payload:** `{ serviceOrder, oldServiceOrder, userId, assignedToId }`
**Who Gets Notified:**
- Assigned user (when description, observation, or type changes)

**Channels:** IN_APP, PUSH, WHATSAPP
**Code:** service-order.listener.ts:701-784

### Notification Preferences

Users can configure notification preferences via:
- **notificationType:** e.g., "SERVICE_ORDER_CREATED", "SERVICE_ORDER_COMPLETED"
- **enabled:** boolean - Whether to receive notifications of this type
- **channels:** Array of NOTIFICATION_CHANNEL (IN_APP, EMAIL, PUSH, WHATSAPP, SMS)
- **importance:** NOTIFICATION_IMPORTANCE level

**Note:** Notifications marked as `isMandatory: true` bypass user preferences and are always sent.

**Schema:** `/src/schemas/notification-preference.ts`

---

## Changelog Tracking

All service order changes are automatically logged to the changelog system.

### Tracked Fields

Both `update()` and `batchUpdate()` methods track these fields:

- `status` - Status changes
- `description` - Description updates
- `observation` - Observation notes
- `taskId` - Task reassignment
- `startedAt` - Start timestamp
- `startedById` - Who started
- `approvedAt` - Approval timestamp
- `approvedById` - Who approved
- `finishedAt` - Finish timestamp
- `completedById` - Who completed
- `type` - Service order type
- `assignedToId` - Assignment changes

### Changelog Labels

Portuguese labels for each field are defined in `/src/utils/changelog-fields.ts`:

```typescript
{
  status: 'Status',
  description: 'Descrição',
  observation: 'Observação',
  startedAt: 'Iniciado em',
  startedById: 'Iniciado por',
  approvedAt: 'Aprovado em',
  approvedById: 'Aprovado por',
  finishedAt: 'Finalizado em',
  completedById: 'Concluído por',
  // ... etc
}
```

### Viewing Changelog

Frontend components display changelog entries with:
- Field name (using labels)
- Old value → New value
- Timestamp of change
- User who made the change
- Relative time ("há X minutos", "agora mesmo")

**Component:** `/web/src/components/ui/changelog-history.tsx`

---

## Permissions

### Permission Matrix

| Role | Can View | Can Create | Can Update | Special Rules |
|------|----------|------------|------------|---------------|
| **ADMIN** | All | All types | All service orders | Can set CANCELLED status |
| **DESIGNER** | Type-based | ARTWORK | ARTWORK (assigned or unassigned) | Cannot directly set COMPLETED for ARTWORK - must use WAITING_APPROVE |
| **PRODUCTION** | Type-based | PRODUCTION | PRODUCTION (assigned or unassigned) | - |
| **LOGISTIC** | Type-based | PRODUCTION | PRODUCTION (assigned or unassigned) | - |
| **FINANCIAL** | Type-based | FINANCIAL | FINANCIAL (assigned or unassigned) | Can batch update |
| **COMMERCIAL** | Type-based | NEGOTIATION | NEGOTIATION (via ADMIN only) | Limited permissions |

### Assignment Rules

- **If assigned:** Only the assigned user OR ADMIN can update
- **If not assigned:** Users with appropriate sector privileges can update

### Type-Based Access

- **PRODUCTION** → PRODUCTION or LOGISTIC privileges
- **FINANCIAL** → FINANCIAL privileges
- **NEGOTIATION** → ADMIN only
- **ARTWORK** → DESIGNER privileges (with WAITING_APPROVE workflow)

**Code:** `/src/modules/production/service-order/service-order.permissions.ts`

---

## API Endpoints

### Single Operations

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| POST | `/service-orders` | Create service order | ADMIN, FINANCIAL, PRODUCTION, DESIGNER, LOGISTIC |
| GET | `/service-orders/:id` | Get by ID | All authenticated |
| GET | `/service-orders` | List service orders | All authenticated |
| PUT | `/service-orders/:id` | Update service order | Permission-based (see matrix) |
| PUT | `/service-orders/:id/status` | Change status only | Permission-based |
| DELETE | `/service-orders/:id` | Delete service order | ADMIN, FINANCIAL, PRODUCTION, DESIGNER, LOGISTIC |

### Batch Operations

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| POST | `/service-orders/batch` | Batch create | ADMIN, FINANCIAL |
| PUT | `/service-orders/batch` | Batch update | ADMIN, FINANCIAL |
| DELETE | `/service-orders/batch` | Batch delete | ADMIN, FINANCIAL |

### Request/Response Examples

#### Create Service Order

```typescript
POST /service-orders

{
  "taskId": "uuid",
  "type": "PRODUCTION",
  "description": "Aplicar logomarca padrão",
  "observation": "Verificar alinhamento antes de aplicar",
  "assignedToId": "user-uuid" // optional
}
```

#### Update Service Order

```typescript
PUT /service-orders/:id

{
  "status": "IN_PROGRESS",
  // startedAt and startedById are AUTOMATIC - don't include!
}
```

#### Batch Update

```typescript
PUT /service-orders/batch

{
  "serviceOrders": [
    {
      "id": "uuid-1",
      "data": {
        "status": "COMPLETED"
        // finishedAt and completedById are AUTOMATIC!
      }
    },
    {
      "id": "uuid-2",
      "data": {
        "description": "Updated description"
      }
    }
  ]
}
```

**Code:** `/src/modules/production/service-order/service-order.controller.ts`

---

## Best Practices

### ✅ DO

1. **Let the system set timestamps automatically**
   - Just change the status - timestamps are automatic

2. **Provide meaningful descriptions**
   - Clear, actionable descriptions
   - Include relevant details

3. **Use observations for notes**
   - Rejection reasons
   - Special instructions
   - Issues encountered

4. **Assign service orders when appropriate**
   - Ensures accountability
   - Triggers notifications to assigned user

5. **Use batch operations for multiple updates**
   - More efficient
   - Maintains data consistency
   - Now includes automatic timestamps!

### ❌ DON'T

1. **Don't manually set timestamps unless importing data**
   - The system handles this automatically
   - Manual timestamps can cause confusion

2. **Don't bypass the ARTWORK approval workflow**
   - ARTWORK type must go through WAITING_APPROVE
   - Ensures admin review

3. **Don't update service orders you don't have permission for**
   - Respect assignment rules
   - Respect type-based permissions

4. **Don't set CANCELLED status unless you're an ADMIN**
   - Only admins can cancel service orders

5. **Don't forget to include userId in API calls**
   - Required for proper tracking
   - Ensures notifications go to correct users

### Frontend Integration

When building frontend components:

1. **Display all timestamp fields**
   ```typescript
   {serviceOrder.startedAt && (
     <div>Iniciado em: {formatDateTime(serviceOrder.startedAt)}</div>
   )}
   {serviceOrder.startedBy && (
     <div>Iniciado por: {serviceOrder.startedBy.name}</div>
   )}
   ```

2. **Use proper date formatting**
   ```typescript
   import { formatDateTime, formatRelativeTime } from '@/utils/date';

   // For absolute times
   formatDateTime(serviceOrder.finishedAt) // "14/01/2026 - 09:16"

   // For relative times
   formatRelativeTime(serviceOrder.updatedAt) // "há 5 minutos"
   ```

3. **Show changelog in detail views**
   - Users want to see who did what and when
   - Provides transparency and accountability

4. **Display proper labels**
   - Use the Portuguese labels from changelog-fields.ts
   - Consistent terminology across the app

---

## Troubleshooting

### Issue: Timestamps are NULL in database

**Symptoms:** Status shows IN_PROGRESS/COMPLETED but timestamps are null

**Causes:**
1. Old data from before automatic timestamp logic
2. Direct database update bypassing service layer
3. Bug in batch update (now fixed!)

**Solution:**
- Recent fix added automatic timestamps to batch update
- For old data, run a migration script to backfill
- Always use service layer methods, not direct DB updates

### Issue: "Data inválida" in changelog

**Symptoms:** Changelog shows "Data inválida" instead of date

**Causes:**
1. Timestamp is NULL in database
2. Frontend using raw `toLocaleDateString()` on null value

**Solution:**
- Fixed in `/web/src/components/ui/changelog-history.tsx`
- Now uses `formatDateTime()` which handles null gracefully
- Returns "Data inválida" or "-" instead of "Invalid Date"

### Issue: No notifications received

**Symptoms:** User doesn't receive notifications for service order changes

**Causes:**
1. User has notifications disabled in preferences
2. Notification marked as optional and user opted out
3. Event not emitted (check batch vs single update)

**Solution:**
- Check user notification preferences
- Verify event is emitted (check logs)
- Ensure using updated batch update with event emissions

---

## Code References

| Component | File Path | Key Lines |
|-----------|-----------|-----------|
| Service Implementation | `/src/modules/production/service-order/service-order.service.ts` | - |
| - create() | Same | 60-144 |
| - update() | Same | 149-356 |
| - batchUpdate() | Same | 583-820 |
| - Automatic Timestamps | Same | 660-694 |
| Repository | `/src/modules/production/service-order/repositories/service-order/service-order-prisma.repository.ts` | - |
| Permissions | `/src/modules/production/service-order/service-order.permissions.ts` | 1-147 |
| Event Listeners | `/src/modules/production/service-order/service-order.listener.ts` | 1-786 |
| Controller | `/src/modules/production/service-order/service-order.controller.ts` | 88-254 |
| Changelog Labels | `/src/utils/changelog-fields.ts` | 675-698 |
| Frontend Display | `/web/src/components/ui/changelog-history.tsx` | 754-845 |
| Types | `/src/types/serviceOrder.ts` | 19-64 |
| Schemas | `/src/schemas/serviceOrder.ts` | 518-579 |

---

## Recent Updates (January 2026)

### ✨ Batch Update Enhancements

**Changes:**
1. ✅ Added automatic timestamp logic to `batchUpdate()` (matching `update()`)
2. ✅ Added complete field tracking to changelog (including observation, *ById fields)
3. ✅ Added event emissions for batch updates (notifications now work!)
4. ✅ Fixed frontend changelog display (proper handling of null timestamps)

**Impact:**
- Batch operations now have the same timestamp behavior as single updates
- Complete audit trail for all updates
- Users receive notifications for batch status changes
- Frontend displays dates correctly even when null

**Code Commits:**
- service-order.service.ts: Lines 650-791 (batch update improvements)
- changelog-history.tsx: Line 790 & Line 34 (use formatDateTime)
- task-with-service-orders-changelog.tsx: Line 762 & Line 32 (use formatDateTime)

---

## Summary

The service order workflow is designed to automatically track who does what and when. By following the automatic timestamp system, respecting permissions, and using the notification system, you ensure:

✅ Complete audit trail
✅ Proper user notifications
✅ Clear accountability
✅ Consistent data quality

For questions or issues, refer to this documentation or check the code references above.
