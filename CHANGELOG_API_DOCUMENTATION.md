# Changelog API - Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Tracked Fields](#tracked-fields)
6. [How to Add New Tracked Fields](#how-to-add-new-tracked-fields)
7. [Testing Guide](#testing-guide)
8. [Performance Considerations](#performance-considerations)

---

## Overview

The Changelog API provides a comprehensive audit trail system for tracking all changes to entities in the Ankaa application. The system automatically logs create, update, and delete operations with field-level granularity.

### Key Features

- **Automatic tracking** of entity changes at field level
- **User attribution** - tracks who made each change
- **Flexible querying** - filter by entity, date, user, action type
- **JSON storage** - old and new values stored as JSON for complex data types
- **Performance optimized** - indexed queries and efficient pagination
- **Portuguese labels** - user-friendly field name translations

---

## Architecture

```
┌─────────────────┐
│   Controllers   │ (Task, Order, User, etc.)
│   (Services)    │
└────────┬────────┘
         │ calls
         ↓
┌─────────────────┐
│  ChangeLogService│ ← Core changelog logic
└────────┬────────┘
         │ uses
         ↓
┌─────────────────┐
│  ChangeLogRepo  │ ← Database operations
└────────┬────────┘
         │ writes to
         ↓
┌─────────────────┐
│  ChangeLog      │ ← Prisma model
│  (PostgreSQL)   │
└─────────────────┘
```

### Components

1. **ChangeLogController** (`/src/modules/common/changelog/changelog.controller.ts`)
   - Exposes REST API endpoints
   - Handles query parameter validation
   - Returns formatted responses

2. **ChangeLogService** (`/src/modules/common/changelog/changelog.service.ts`)
   - Core business logic for logging changes
   - Provides helper methods for common operations
   - Supports both direct calls and transaction-based logging

3. **ChangeLogRepository** (`/src/modules/common/changelog/repositories/`)
   - Database abstraction layer
   - Handles Prisma interactions
   - Provides transaction support

4. **Changelog Helpers** (`/src/modules/common/changelog/utils/changelog-helpers.ts`)
   - Utility functions for field tracking
   - Field name translations (English → Portuguese)
   - Value comparison and serialization

---

## Database Schema

### ChangeLog Table

```sql
CREATE TABLE "ChangeLog" (
  id            TEXT PRIMARY KEY,
  entityType    "ChangeLogEntityType" NOT NULL,
  entityId      TEXT NOT NULL,
  action        "ChangeLogAction" NOT NULL,
  field         TEXT,
  oldValue      JSONB,
  newValue      JSONB,
  reason        TEXT,
  metadata      JSONB,
  userId        TEXT,
  triggeredBy   "ChangeLogTriggeredByType",
  triggeredById TEXT,
  createdAt     TIMESTAMP DEFAULT NOW() NOT NULL,

  CONSTRAINT "ChangeLog_userId_fkey"
    FOREIGN KEY (userId) REFERENCES "User"(id)
);

-- Indexes for performance
CREATE INDEX "ChangeLog_entityType_entityId_idx"
  ON "ChangeLog"(entityType, entityId);

CREATE INDEX "ChangeLog_createdAt_idx"
  ON "ChangeLog"(createdAt DESC);
```

### Field Descriptions

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | UUID | Primary key | `"a1b2c3d4-..."` |
| `entityType` | Enum | Type of entity changed | `"TASK"`, `"ORDER"`, `"USER"` |
| `entityId` | UUID | ID of the entity that changed | `"task-uuid-123"` |
| `action` | Enum | Type of change | `"CREATE"`, `"UPDATE"`, `"DELETE"` |
| `field` | String (nullable) | Field name that changed | `"status"`, `"price"`, `"cuts"` |
| `oldValue` | JSON (nullable) | Previous value | `"PENDING"` or `{"quantity": 2}` |
| `newValue` | JSON (nullable) | New value | `"IN_PRODUCTION"` or `{"quantity": 3}` |
| `reason` | String (nullable) | Human-readable change description | `"Status alterado"` |
| `metadata` | JSON (nullable) | Additional context | `{"timestamp": "2025-10-06..."}` |
| `userId` | UUID (nullable) | User who made the change | `"user-uuid-456"` |
| `triggeredBy` | Enum (nullable) | What triggered the change | `"USER_ACTION"`, `"BATCH_UPDATE"` |
| `triggeredById` | UUID (nullable) | ID of trigger source | Same as entityId typically |
| `createdAt` | Timestamp | When the change occurred | `2025-10-06T15:30:00Z` |

### Enums

**ChangeLogEntityType** (65+ entity types):
```typescript
TASK, ORDER, ORDER_ITEM, USER, CUSTOMER, SUPPLIER,
ITEM, ACTIVITY, CUT, AIRBRUSHING, SERVICE_ORDER,
NOTIFICATION, FILE, PAINT, TRUCK, GARAGE_LANE, ...
```

**ChangeLogAction**:
```typescript
CREATE, UPDATE, DELETE, RESTORE, ROLLBACK,
ARCHIVE, UNARCHIVE, ACTIVATE, DEACTIVATE,
APPROVE, REJECT, CANCEL, COMPLETE,
BATCH_CREATE, BATCH_UPDATE, BATCH_DELETE
```

**ChangeLogTriggeredByType**:
```typescript
USER_ACTION, SYSTEM, BATCH_OPERATION, BATCH_CREATE,
BATCH_UPDATE, BATCH_DELETE, TASK_CREATE, TASK_UPDATE,
EXTERNAL_WITHDRAWAL, ORDER_UPDATE, ...
```

---

## API Endpoints

### Base URL
```
/api/changelogs
```

### 1. Get All Changelogs (Paginated)

**Endpoint**: `GET /api/changelogs`

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 20 | Items per page (max 100) |
| `take` | number | - | Alias for limit |
| `entityType` | string | - | Filter by entity type (e.g., "TASK") |
| `entityId` | string | - | Filter by specific entity ID |
| `action` | string | - | Filter by action type |
| `userId` | string | - | Filter by user who made change |
| `searchingFor` | string | - | Search across multiple fields |
| `createdAt[gte]` | ISO date | - | Filter by created date (after) |
| `createdAt[lte]` | ISO date | - | Filter by created date (before) |

**Example Request**:
```bash
GET /api/changelogs?entityType=TASK&entityId=abc-123&page=1&limit=20
```

**Example Response**:
```json
{
  "success": true,
  "message": "Registros de mudanças carregados com sucesso",
  "data": [
    {
      "id": "changelog-uuid-1",
      "entityType": "TASK",
      "entityId": "task-uuid-123",
      "action": "UPDATE",
      "field": "status",
      "oldValue": "PENDING",
      "newValue": "IN_PRODUCTION",
      "reason": "Campo status atualizado",
      "userId": "user-uuid-456",
      "triggeredBy": "USER_ACTION",
      "triggeredById": "task-uuid-123",
      "createdAt": "2025-10-06T15:30:00.000Z",
      "user": {
        "id": "user-uuid-456",
        "name": "João Silva",
        "email": "joao@example.com"
      }
    },
    {
      "id": "changelog-uuid-2",
      "entityType": "TASK",
      "entityId": "task-uuid-123",
      "action": "UPDATE",
      "field": "price",
      "oldValue": 1000.00,
      "newValue": 1500.00,
      "reason": "Campo preço atualizado",
      "userId": "user-uuid-456",
      "triggeredBy": "USER_ACTION",
      "triggeredById": "task-uuid-123",
      "createdAt": "2025-10-06T15:30:00.000Z",
      "user": {
        "id": "user-uuid-456",
        "name": "João Silva",
        "email": "joao@example.com"
      }
    }
  ],
  "meta": {
    "totalRecords": 45,
    "totalPages": 3,
    "currentPage": 1,
    "pageSize": 20,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

### 2. Get Entity History

**Endpoint**: `GET /api/changelogs/entity/:type/:id`

**Parameters**:
- `type` (path): Entity type (e.g., "TASK", "ORDER")
- `id` (path): Entity ID
- `limit` (query, optional): Limit number of results

**Example Request**:
```bash
GET /api/changelogs/entity/TASK/abc-123?limit=50
```

**Example Response**:
```json
{
  "message": "Entity history loaded successfully",
  "data": [
    {
      "id": "changelog-uuid-1",
      "entityType": "TASK",
      "entityId": "abc-123",
      "action": "CREATE",
      "field": null,
      "oldValue": null,
      "newValue": {
        "id": "abc-123",
        "name": "Tarefa Nova",
        "status": "PENDING"
      },
      "reason": "Registro criado",
      "userId": "user-uuid-456",
      "createdAt": "2025-10-06T14:00:00.000Z",
      "user": {
        "id": "user-uuid-456",
        "name": "João Silva"
      }
    },
    {
      "id": "changelog-uuid-2",
      "entityType": "TASK",
      "entityId": "abc-123",
      "action": "UPDATE",
      "field": "status",
      "oldValue": "PENDING",
      "newValue": "IN_PRODUCTION",
      "reason": "Campo status atualizado",
      "userId": "user-uuid-456",
      "createdAt": "2025-10-06T15:30:00.000Z",
      "user": {
        "id": "user-uuid-456",
        "name": "João Silva"
      }
    }
  ]
}
```

---

### 3. Get Task History

**Endpoint**: `GET /api/changelogs/task/:id/history`

**Parameters**:
- `id` (path): Task ID

**Example Request**:
```bash
GET /api/changelogs/task/abc-123/history
```

**Example Response**:
```json
{
  "success": true,
  "message": "Histórico da tarefa carregado com sucesso",
  "data": {
    "taskChanges": [
      {
        "id": "changelog-uuid-1",
        "action": "UPDATE",
        "field": "status",
        "oldValue": "PENDING",
        "newValue": "IN_PRODUCTION",
        "createdAt": "2025-10-06T15:30:00.000Z",
        "user": { "name": "João Silva" }
      }
    ],
    "serviceChanges": [
      {
        "id": "changelog-uuid-2",
        "action": "CREATE",
        "field": "services",
        "newValue": [{"description": "Pintura completa"}],
        "createdAt": "2025-10-06T15:35:00.000Z",
        "user": { "name": "João Silva" }
      }
    ],
    "commissionChanges": []
  }
}
```

---

### 4. Get Order History

**Endpoint**: `GET /api/changelogs/order/:id/history`

**Parameters**:
- `id` (path): Order ID

**Response Structure**:
```json
{
  "success": true,
  "message": "Histórico do pedido carregado com sucesso",
  "data": {
    "orderChanges": [...],
    "orderItemChanges": [...]
  }
}
```

---

### 5. Get Changes by Date Range

**Endpoint**: `GET /api/changelogs/date-range`

**Query Parameters**:
- `startDate` (required): ISO date string
- `endDate` (required): ISO date string
- `entityType` (optional): Filter by entity type

**Example Request**:
```bash
GET /api/changelogs/date-range?startDate=2025-10-01&endDate=2025-10-06&entityType=TASK
```

---

### 6. Get Activity Impact

**Endpoint**: `GET /api/changelogs/activity/:id/impact`

**Parameters**:
- `id` (path): Activity ID

**Description**: Get all changes triggered by a specific inventory activity.

---

### 7. Get Related Changes

**Endpoint**: `GET /api/changelogs/triggered/:type/:id`

**Parameters**:
- `type` (path): Triggered by type (e.g., "BATCH_UPDATE")
- `id` (path): Triggered by ID

**Description**: Get all changes triggered by a specific event.

---

### 8. Cleanup Old Logs

**Endpoint**: `DELETE /api/changelogs/cleanup`

**Body**:
```json
{
  "daysToKeep": 90
}
```

**Response**:
```json
{
  "success": true,
  "message": "150 registros antigos removidos com sucesso",
  "data": {
    "deletedCount": 150
  }
}
```

**Note**: Default is 90 days. Use with caution!

---

## Tracked Fields

### Task Entity

The following task fields are automatically tracked:

| Field | Portuguese Label | Format |
|-------|------------------|--------|
| `name` | Nome | String |
| `status` | Status | Enum (PENDING, IN_PRODUCTION, etc.) |
| `serialNumber` | Número de Série | String |
| `plate` | Placa | String |
| `details` | Detalhes | Text |
| `entryDate` | Data de Entrada | Date |
| `term` | Prazo | Date |
| `price` | Preço | Currency (formatted as R$ X.XXX,XX) |
| `budgetId` | Orçamento | UUID |
| `nfeId` | Nota Fiscal | UUID |
| `receiptId` | Recibo | UUID |
| `customerId` | Cliente | UUID (resolved to name) |
| `sectorId` | Setor | UUID (resolved to name) |
| `paintId` | Tinta | UUID (resolved to name/color) |
| `services` | Serviços | Array of service descriptions |
| `artworks` | Artes | Array of file references |
| `paintIds` | Tintas de Logo | Array of paint IDs |
| `cuts` | Recortes | Array of cut objects |
| `airbrushings` | Aerografias | Array of airbrushing work |

### Complex Field Examples

**Services Field**:
```json
{
  "field": "services",
  "oldValue": null,
  "newValue": [
    { "description": "Pintura completa" },
    { "description": "Polimento" }
  ],
  "reason": "2 serviço(s) adicionado(s)"
}
```

**Cuts Field** (when implemented):
```json
{
  "field": "cuts",
  "oldValue": [
    { "type": "VINYL", "quantity": 2, "fileId": "file-uuid-1" }
  ],
  "newValue": [
    { "type": "VINYL", "quantity": 3, "fileId": "file-uuid-2" }
  ],
  "reason": "Recortes alterados de 2 para 3"
}
```

### All Tracked Entities

The system tracks changes for 65+ entity types including:

- **Production**: TASK, CUT, AIRBRUSHING, SERVICE_ORDER, TRUCK, GARAGE_LANE
- **Inventory**: ITEM, ORDER, ORDER_ITEM, ACTIVITY, CATEGORY, BRAND, SUPPLIER
- **People**: USER, POSITION, SECTOR, VACATION, WARNING, BONUS
- **Paint**: PAINT, PAINT_TYPE, PAINT_FORMULA, PAINT_PRODUCTION
- **Files**: FILE, BUDGET, RECEIPT, NFE
- **HR**: PAYROLL, DISCOUNT, COMMISSION
- **Notifications**: NOTIFICATION, NOTIFICATION_PREFERENCE
- **And many more...**

---

## How to Add New Tracked Fields

### Step 1: Identify the Field

Determine which entity and field you want to track.

**Example**: Track `cuts` field on Task entity

---

### Step 2: Add Field Translation (Optional)

Edit `/src/modules/common/changelog/utils/changelog-helpers.ts`:

```typescript
export const FIELD_TRANSLATIONS: Record<string, string> = {
  // ... existing translations
  cuts: 'recortes',           // Add this line
  cutRequest: 'solicitações de corte',
  cutPlan: 'planos de corte',
  // ...
};
```

---

### Step 3: Update Service to Track the Field

Edit your entity service (e.g., `/src/modules/production/task/task.service.ts`):

#### Option A: Simple Field Tracking

If the field is a simple value (string, number, boolean):

```typescript
async update(id: string, data: TaskUpdateFormData, userId: string) {
  return await this.prisma.$transaction(async tx => {
    const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, id);
    const updatedTask = await this.tasksRepository.updateWithTransaction(tx, id, data);

    // Track simple field changes
    const fieldsToTrack = [
      'status', 'price', 'name', 'details',
      'serialNumber', 'plate', 'term', 'entryDate',
      'sectorId', 'paintId', 'customerId',
      // Add your new field here:
      'newFieldName',
    ];

    await trackAndLogFieldChanges({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.TASK,
      entityId: id,
      oldEntity: existingTask,
      newEntity: updatedTask,
      fieldsToTrack,
      userId,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      transaction: tx,
    });

    return updatedTask;
  });
}
```

---

#### Option B: Complex/Nested Field Tracking

If the field is an array or complex object (like `cuts`, `services`, `artworks`):

```typescript
async update(id: string, data: TaskUpdateFormData, userId: string) {
  return await this.prisma.$transaction(async tx => {
    const existingTask = await this.tasksRepository.findByIdWithTransaction(
      tx,
      id,
      { include: { cuts: true } }  // Include the relation
    );

    const updatedTask = await this.tasksRepository.updateWithTransaction(tx, id, data);

    // ... track simple fields ...

    // Track complex field (cuts example)
    if (data.cuts !== undefined) {
      const oldCuts = existingTask.cuts || [];
      const newCuts = updatedTask.cuts || [];

      // Check if cuts actually changed
      const oldCutsJson = JSON.stringify(oldCuts.map(c => ({
        type: c.type,
        fileId: c.fileId,
        quantity: 1
      })));
      const newCutsJson = JSON.stringify(newCuts.map(c => ({
        type: c.type,
        fileId: c.fileId,
        quantity: 1
      })));

      if (oldCutsJson !== newCutsJson) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'cuts',
          oldValue: oldCuts,
          newValue: newCuts,
          reason: `Recortes alterados de ${oldCuts.length} para ${newCuts.length}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId,
          transaction: tx,
        });
      }
    }

    return updatedTask;
  });
}
```

---

### Step 4: Add Frontend Display Logic (If Needed)

If the field requires special formatting in the frontend, edit `/Users/kennedycampos/Documents/repositories/web/src/utils/changelog-fields.ts`:

```typescript
// Add field label
export const TASK_CHANGELOG_FIELDS: Record<string, string> = {
  // ... existing fields
  cuts: 'Recortes',
  // ...
};

// Add value formatting
export function formatFieldValue(
  field: string,
  value: any,
  entityType: CHANGE_LOG_ENTITY_TYPE
): string {
  // ... existing formatters

  // Add custom formatter for cuts
  if (field === 'cuts' && Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? 'recorte' : 'recortes'}`;
  }

  // ...
}
```

---

### Step 5: Test the Implementation

1. **Make a change** to the entity field
2. **Check the database**:
   ```sql
   SELECT * FROM "ChangeLog"
   WHERE "entityType" = 'TASK'
     AND "entityId" = 'your-task-id'
   ORDER BY "createdAt" DESC;
   ```
3. **Check the API**:
   ```bash
   GET /api/changelogs/entity/TASK/your-task-id
   ```
4. **Check the frontend** changelog display component

---

## Testing Guide

### Manual Testing

#### 1. Test Field Tracking

**Create a Task**:
```bash
POST /api/tasks
{
  "name": "Test Task",
  "status": "PENDING",
  "customerId": "customer-uuid"
}
```

**Check Changelog**:
```bash
GET /api/changelogs/entity/TASK/{created-task-id}
```

**Expected Result**: One CREATE changelog entry

---

**Update the Task**:
```bash
PATCH /api/tasks/{task-id}
{
  "status": "IN_PRODUCTION",
  "price": 1500.00
}
```

**Check Changelog**:
```bash
GET /api/changelogs/entity/TASK/{task-id}
```

**Expected Result**: Two UPDATE changelog entries (one for status, one for price)

---

#### 2. Test Complex Fields

**Add Services**:
```bash
PATCH /api/tasks/{task-id}
{
  "services": [
    { "description": "Pintura completa" },
    { "description": "Polimento" }
  ]
}
```

**Check Changelog**:
```bash
GET /api/changelogs/entity/TASK/{task-id}
```

**Expected Result**: One UPDATE changelog with field="services" showing added services

---

#### 3. Test Pagination

```bash
GET /api/changelogs?page=1&limit=10
GET /api/changelogs?page=2&limit=10
```

**Verify**: `meta.currentPage`, `meta.hasNextPage`, `meta.totalPages`

---

#### 4. Test Filtering

**By Entity Type**:
```bash
GET /api/changelogs?entityType=TASK
```

**By Date Range**:
```bash
GET /api/changelogs/date-range?startDate=2025-10-01&endDate=2025-10-06
```

**By User**:
```bash
GET /api/changelogs?userId={user-uuid}
```

---

#### 5. Test User Attribution

**Verify** all changelog entries include:
- `userId` (populated)
- `user.name` (populated via relation)
- `user.email` (populated via relation)

---

### Automated Testing

#### Unit Tests

```typescript
describe('ChangeLogService', () => {
  it('should create changelog entry for field change', async () => {
    const result = await changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK,
      entityId: 'task-123',
      action: CHANGE_ACTION.UPDATE,
      field: 'status',
      oldValue: 'PENDING',
      newValue: 'IN_PRODUCTION',
      reason: 'Status changed',
      userId: 'user-456',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: 'task-123',
    });

    expect(result).toBeDefined();
  });
});
```

#### Integration Tests

```typescript
describe('Task Update with Changelog', () => {
  it('should track status change', async () => {
    const task = await createTask({ status: 'PENDING' });
    await updateTask(task.id, { status: 'IN_PRODUCTION' }, userId);

    const changelogs = await getChangelogs(task.id);

    expect(changelogs).toHaveLength(2); // CREATE + UPDATE
    expect(changelogs[1].field).toBe('status');
    expect(changelogs[1].oldValue).toBe('PENDING');
    expect(changelogs[1].newValue).toBe('IN_PRODUCTION');
  });
});
```

---

## Performance Considerations

### Database Indexes

The ChangeLog table has two critical indexes:

```sql
-- For entity queries (most common)
CREATE INDEX "ChangeLog_entityType_entityId_idx"
  ON "ChangeLog"(entityType, entityId);

-- For date-based queries
CREATE INDEX "ChangeLog_createdAt_idx"
  ON "ChangeLog"(createdAt DESC);
```

### Query Optimization Tips

1. **Always use pagination**:
   ```bash
   GET /api/changelogs?page=1&limit=20  # Good
   GET /api/changelogs?limit=1000        # Bad (too many)
   ```

2. **Filter by entity type and ID** when possible:
   ```bash
   GET /api/changelogs?entityType=TASK&entityId=abc-123  # Optimized
   ```

3. **Use date range filters** for large datasets:
   ```bash
   GET /api/changelogs?createdAt[gte]=2025-10-01&createdAt[lte]=2025-10-06
   ```

### Storage Management

**Cleanup old logs periodically**:

```bash
DELETE /api/changelogs/cleanup
{
  "daysToKeep": 90
}
```

**Recommended retention periods**:
- Development: 30 days
- Staging: 60 days
- Production: 90-180 days (compliance dependent)

### Value Serialization

The system automatically handles:
- **Circular references** - removed before storing
- **Undefined values** - converted to null
- **Large objects** - only essential fields stored
- **Dates** - serialized as ISO strings

**Best Practice**: Use `extractEssentialFields()` for CREATE/DELETE operations to minimize storage.

---

## Troubleshooting

### Common Issues

**Issue**: Changelog entries not appearing

**Solutions**:
1. Check if `changeLogService` is injected in the service
2. Verify field is in `fieldsToTrack` array
3. Check if value actually changed (use `hasValueChanged()`)
4. Verify transaction is committed (not rolled back)

---

**Issue**: JSON serialization errors

**Solutions**:
1. Use `serializeChangelogValue()` utility
2. Avoid storing entire entities with relations
3. Use `extractEssentialFields()` for complex objects

---

**Issue**: Performance degradation

**Solutions**:
1. Add pagination to queries
2. Use date range filters
3. Run cleanup for old logs
4. Check database indexes exist

---

**Issue**: User not showing in changelog

**Solutions**:
1. Ensure `userId` is passed to `logChange()`
2. Check `include: { user: true }` in repository
3. Verify user exists in database

---

## Best Practices

1. **Always track within transactions** to ensure atomicity
2. **Use field-level tracking** for updates (not entire entities)
3. **Store only essential fields** for CREATE/DELETE
4. **Provide meaningful reasons** for each change
5. **Use appropriate `triggeredBy`** values
6. **Test changelog creation** for all CRUD operations
7. **Cleanup old logs** periodically
8. **Monitor storage usage** in production

---

## Support

For questions or issues:
- Review the implementation guide: `/src/modules/common/changelog/CHANGELOG_IMPLEMENTATION_GUIDE.md`
- Check helper utilities: `/src/modules/common/changelog/utils/changelog-helpers.ts`
- Review existing implementations in services (TaskService, OrderService, etc.)

---

**Last Updated**: October 6, 2025
**API Version**: 1.0
