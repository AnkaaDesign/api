# Bulk Task Operations API Documentation

This document describes the bulk operation endpoints for managing multiple tasks simultaneously.

## Overview

The bulk operations API allows you to apply the same changes to multiple tasks in a single atomic transaction. All operations are protected by role-based access control and include comprehensive audit logging.

## Authentication & Authorization

All bulk operation endpoints require:
- **Authentication**: Valid user session
- **Authorization**: `LEADER` or `ADMIN` role

## Endpoints

### 1. Bulk Add Artworks

Add the same artworks to multiple tasks.

**Endpoint**: `POST /api/tasks/bulk/arts`

**Request Body**:
```json
{
  "taskIds": ["uuid-1", "uuid-2", "uuid-3"],
  "artworkIds": ["artwork-uuid-1", "artwork-uuid-2"]
}
```

**Response**:
```json
{
  "success": 3,
  "failed": 0,
  "total": 3,
  "errors": []
}
```

**Validation**:
- `taskIds`: Array of UUIDs, minimum 1 required
- `artworkIds`: Array of UUIDs, minimum 1 required

**Behavior**:
- Merges new artworks with existing artworks (no duplicates)
- All artworks are added to all specified tasks
- Creates audit log entry for each task
- Fails gracefully - successful tasks are committed even if some fail

**Error Response Example**:
```json
{
  "success": 2,
  "failed": 1,
  "total": 3,
  "errors": [
    {
      "taskId": "uuid-3",
      "error": "Task not found"
    }
  ]
}
```

---

### 2. Bulk Add Documents

Add the same documents (budgets, invoices, or receipts) to multiple tasks.

**Endpoint**: `POST /api/tasks/bulk/documents`

**Request Body**:
```json
{
  "taskIds": ["uuid-1", "uuid-2", "uuid-3"],
  "documentType": "budget",
  "documentIds": ["doc-uuid-1", "doc-uuid-2"]
}
```

**Document Types**:
- `budget`: Budget documents
- `invoice`: Invoice/NFe documents
- `receipt`: Receipt documents

**Response**:
```json
{
  "success": 3,
  "failed": 0,
  "total": 3,
  "errors": []
}
```

**Validation**:
- `taskIds`: Array of UUIDs, minimum 1 required
- `documentType`: Must be one of: `budget`, `invoice`, `receipt`
- `documentIds`: Array of UUIDs, minimum 1 required

**Behavior**:
- Merges new documents with existing documents (no duplicates)
- Documents are added to the appropriate relation based on `documentType`
- Creates audit log entry for each task
- Transactional - either all succeed or all fail within the transaction

---

### 3. Bulk Add Paints

Add the same paints to multiple tasks (logo paints).

**Endpoint**: `POST /api/tasks/bulk/paints`

**Request Body**:
```json
{
  "taskIds": ["uuid-1", "uuid-2", "uuid-3"],
  "paintIds": ["paint-uuid-1", "paint-uuid-2"]
}
```

**Response**:
```json
{
  "success": 3,
  "failed": 0,
  "total": 3,
  "errors": []
}
```

**Validation**:
- `taskIds`: Array of UUIDs, minimum 1 required
- `paintIds`: Array of UUIDs, minimum 1 required

**Behavior**:
- Merges new paints with existing logo paints (no duplicates)
- All paints are added to all specified tasks
- Creates audit log entry for each task
- Validates that all paint records exist before processing

---

### 4. Bulk Add Cutting Plans

Create individual cutting plans for multiple tasks with the same configuration.

**Endpoint**: `POST /api/tasks/bulk/cutting-plans`

**Request Body**:
```json
{
  "taskIds": ["uuid-1", "uuid-2", "uuid-3"],
  "cutData": {
    "fileId": "file-uuid",
    "type": "VINYL",
    "origin": "PLAN",
    "reason": null,
    "quantity": 2
  }
}
```

**Cut Data Fields**:
- `fileId` (required): UUID of the cut file
- `type` (required): Type of cut (e.g., "VINYL", "PRINT", etc.)
- `origin` (optional): Origin of the cut, defaults to "PLAN"
- `reason` (optional): Reason for the cut request, can be null
- `quantity` (optional): Number of cuts to create per task, defaults to 1

**Response**:
```json
{
  "success": 3,
  "failed": 0,
  "total": 3,
  "errors": []
}
```

**Validation**:
- `taskIds`: Array of UUIDs, minimum 1 required
- `cutData.fileId`: Valid UUID required
- `cutData.type`: String required
- `cutData.origin`: String optional, defaults to "PLAN"
- `cutData.reason`: String or null, optional
- `cutData.quantity`: Integer >= 1, defaults to 1

**Behavior**:
- Creates **separate** cutting plan records for each task
- Each task gets the specified `quantity` of cuts
- All cuts reference the same file but are individual records
- Initial status is set to "PENDING" with statusOrder = 1
- Creates audit log entry for each task
- Links each cut to its respective task via foreign key

**Example**:
If you have 3 tasks and set `quantity: 2`, this will create 6 total cut records (2 per task).

---

## Common Features

### Transaction Support
All bulk operations are executed within a database transaction:
- Changes are atomic - either all succeed or none do
- Partial failures are tracked in the response
- Database rollback on critical errors

### Audit Logging
Every bulk operation creates audit log entries:
- Entity type: `TASK`
- Action: `UPDATE`
- Includes old and new values
- Triggered by: `USER_ACTION`
- Contains reason describing the bulk operation

### Error Handling

**Validation Errors** (400 Bad Request):
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "taskIds",
      "message": "Pelo menos uma tarefa deve ser selecionada"
    }
  ]
}
```

**Not Found Errors** (404 Not Found):
```json
{
  "statusCode": 404,
  "message": "Tarefas não encontradas: uuid-1, uuid-2"
}
```

**Authorization Errors** (403 Forbidden):
```json
{
  "statusCode": 403,
  "message": "Insufficient permissions"
}
```

**Server Errors** (500 Internal Server Error):
```json
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

### Query Parameters

All endpoints support the standard `include` query parameter for related data:

```
POST /api/tasks/bulk/arts?include[customer]=true&include[artworks]=true
```

## Usage Examples

### Example 1: Add Artworks to Multiple Tasks

```bash
curl -X POST https://api.example.com/api/tasks/bulk/arts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "taskIds": [
      "123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-12d3-a456-426614174001"
    ],
    "artworkIds": [
      "223e4567-e89b-12d3-a456-426614174000"
    ]
  }'
```

### Example 2: Add Budget Documents

```bash
curl -X POST https://api.example.com/api/tasks/bulk/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "taskIds": [
      "123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-12d3-a456-426614174001"
    ],
    "documentType": "budget",
    "documentIds": [
      "323e4567-e89b-12d3-a456-426614174000"
    ]
  }'
```

### Example 3: Create Cutting Plans for Multiple Tasks

```bash
curl -X POST https://api.example.com/api/tasks/bulk/cutting-plans \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "taskIds": [
      "123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-12d3-a456-426614174001",
      "123e4567-e89b-12d3-a456-426614174002"
    ],
    "cutData": {
      "fileId": "423e4567-e89b-12d3-a456-426614174000",
      "type": "VINYL",
      "origin": "PLAN",
      "quantity": 2
    }
  }'
```

This will create 6 cuts total (2 per task), each linked to their respective task.

### Example 4: Add Paints to Multiple Tasks

```bash
curl -X POST https://api.example.com/api/tasks/bulk/paints \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "taskIds": [
      "123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-12d3-a456-426614174001"
    ],
    "paintIds": [
      "523e4567-e89b-12d3-a456-426614174000",
      "523e4567-e89b-12d3-a456-426614174001"
    ]
  }'
```

## Best Practices

1. **Batch Size**: Keep task arrays reasonable (recommended max: 50-100 tasks per request)
2. **Validation**: Validate all UUIDs exist before sending the request
3. **Error Handling**: Always check the `errors` array in the response
4. **Idempotency**: Operations are designed to be safe to retry (uses merge/upsert patterns)
5. **Audit Trail**: All operations are logged for compliance and debugging

## Performance Considerations

- Operations are optimized with bulk queries where possible
- Database indexes on foreign keys ensure fast lookups
- Transaction isolation prevents race conditions
- Consider splitting very large batches (>100 tasks) into multiple requests

## Database Schema

### Relevant Models

**Task**:
- `artworks`: Many-to-many relation with File (TASK_FILES)
- `budgets`: Many-to-many relation with File (TASK_BUDGETS)
- `invoices`: Many-to-many relation with File (TASK_INVOICES)
- `receipts`: Many-to-many relation with File (TASK_RECEIPTS)
- `logoPaints`: Many-to-many relation with Paint (TASK_LOGO_PAINT)
- `cuts`: One-to-many relation with Cut (CUT_TASK)

**Cut**:
- `taskId`: Foreign key to Task
- `fileId`: Foreign key to File
- `type`: Cut type enum
- `origin`: Cut origin enum
- `reason`: Optional cut request reason
- `status`: Cut status enum
- `statusOrder`: Integer for sorting

## Changelog

### Version 1.0.0 (2025-01-18)
- Initial implementation of bulk task operations
- Added endpoints for arts, documents, paints, and cutting plans
- Implemented transaction support and audit logging
- Added comprehensive validation with Zod schemas
