# Bulk Task Operations - Quick Start Guide

## Introduction

This guide provides a quick reference for using the bulk task operations API. For comprehensive documentation, see the linked files below.

## Quick Links

- **API Documentation**: [BULK_TASK_OPERATIONS.md](./BULK_TASK_OPERATIONS.md)
- **Testing Guide**: [BULK_OPERATIONS_TESTING.md](./BULK_OPERATIONS_TESTING.md)
- **Implementation Summary**: [BULK_OPERATIONS_IMPLEMENTATION_SUMMARY.md](./BULK_OPERATIONS_IMPLEMENTATION_SUMMARY.md)

## Available Endpoints

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/tasks/bulk/arts` | POST | Add artworks to multiple tasks | LEADER, ADMIN |
| `/api/tasks/bulk/documents` | POST | Add documents to multiple tasks | LEADER, ADMIN |
| `/api/tasks/bulk/paints` | POST | Add paints to multiple tasks | LEADER, ADMIN |
| `/api/tasks/bulk/cutting-plans` | POST | Create cutting plans for multiple tasks | LEADER, ADMIN |

## Quick Examples

### 1. Add Artworks

```bash
POST /api/tasks/bulk/arts
Content-Type: application/json
Authorization: Bearer <token>

{
  "taskIds": ["task-uuid-1", "task-uuid-2"],
  "artworkIds": ["artwork-uuid"]
}
```

### 2. Add Budget Documents

```bash
POST /api/tasks/bulk/documents
Content-Type: application/json
Authorization: Bearer <token>

{
  "taskIds": ["task-uuid-1", "task-uuid-2"],
  "documentType": "budget",
  "documentIds": ["doc-uuid"]
}
```

### 3. Add Paints

```bash
POST /api/tasks/bulk/paints
Content-Type: application/json
Authorization: Bearer <token>

{
  "taskIds": ["task-uuid-1", "task-uuid-2"],
  "paintIds": ["paint-uuid"]
}
```

### 4. Create Cutting Plans

```bash
POST /api/tasks/bulk/cutting-plans
Content-Type: application/json
Authorization: Bearer <token>

{
  "taskIds": ["task-uuid-1", "task-uuid-2"],
  "cutData": {
    "fileId": "file-uuid",
    "type": "VINYL",
    "quantity": 2
  }
}
```

## Standard Response Format

All endpoints return the same response format:

```json
{
  "success": 2,
  "failed": 0,
  "total": 2,
  "errors": []
}
```

With errors:

```json
{
  "success": 1,
  "failed": 1,
  "total": 2,
  "errors": [
    {
      "taskId": "task-uuid-2",
      "error": "Task not found"
    }
  ]
}
```

## Code Locations

### Backend Files
- **Controller**: `/api/src/modules/production/task/task.controller.ts`
  - Lines 183-275: Bulk operation endpoints

- **Service**: `/api/src/modules/production/task/task.service.ts`
  - Lines 2484-2918: Bulk operation methods

- **Schemas**: `/api/src/schemas/task-bulk.ts`
  - Complete file: Validation schemas

### Documentation Files
- `/api/docs/BULK_TASK_OPERATIONS.md` - API reference
- `/api/docs/BULK_OPERATIONS_TESTING.md` - Testing guide
- `/api/docs/BULK_OPERATIONS_IMPLEMENTATION_SUMMARY.md` - Implementation details

## Key Features

✅ **Transaction Support**: All operations are atomic
✅ **Validation**: Comprehensive input validation with Zod
✅ **Authorization**: Role-based access control
✅ **Audit Logging**: Complete changelog tracking
✅ **Error Handling**: Graceful partial failure handling
✅ **Type Safety**: Full TypeScript support

## Important Notes

### Document Types
- `budget` - Budget documents
- `invoice` - Invoice/NFe documents
- `receipt` - Receipt documents

### Cutting Plans Behavior
- Creates **separate** cut records for each task
- `quantity` parameter controls cuts per task
- All cuts reference the same file
- Initial status: PENDING

### Merging Behavior
- **Artworks**: Merged with existing (no duplicates)
- **Documents**: Merged with existing (no duplicates)
- **Paints**: Merged with existing (no duplicates)
- **Cuts**: Creates new records (does not merge)

## Performance Guidelines

| Tasks | Expected Time | Max Recommended |
|-------|---------------|-----------------|
| 1-10 | < 1 second | - |
| 11-50 | < 5 seconds | Recommended max |
| 51-100 | < 10 seconds | Absolute max |

For more than 100 tasks, split into multiple requests.

## Error Handling

### Common HTTP Status Codes
- `200` - Success (with success/failed counts)
- `400` - Validation error
- `401` - Unauthorized (no token)
- `403` - Forbidden (insufficient permissions)
- `404` - Resource not found (task, file, paint)
- `500` - Internal server error

### Validation Rules
- `taskIds`: Array of UUIDs, minimum 1
- `artworkIds`: Array of UUIDs, minimum 1
- `documentIds`: Array of UUIDs, minimum 1
- `paintIds`: Array of UUIDs, minimum 1
- `documentType`: Must be "budget", "invoice", or "receipt"
- `cutData.fileId`: Valid UUID
- `cutData.quantity`: Integer >= 1

## Testing

### Manual Testing
```bash
# Test bulk arts endpoint
curl -X POST http://localhost:3000/api/tasks/bulk/arts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "taskIds": ["task-uuid"],
    "artworkIds": ["art-uuid"]
  }'
```

### Verify Results
```sql
-- Check task relationships
SELECT t.id,
       COUNT(DISTINCT a.id) as artworks,
       COUNT(DISTINCT c.id) as cuts
FROM Task t
LEFT JOIN _TASK_FILES a ON t.id = a.A
LEFT JOIN Cut c ON t.id = c.taskId
WHERE t.id = 'task-uuid'
GROUP BY t.id;
```

See [BULK_OPERATIONS_TESTING.md](./BULK_OPERATIONS_TESTING.md) for comprehensive test scenarios.

## Support

### Troubleshooting
1. **Slow response**: Reduce batch size
2. **Not found errors**: Verify all UUIDs exist
3. **Unauthorized**: Check role (must be LEADER or ADMIN)
4. **Transaction timeout**: Split into smaller batches

### Debug Mode
Enable detailed logging:
```typescript
// In task.service.ts
this.logger.log(`[bulkAddArtworks] ...`);
```

## Migration Notes

If migrating from individual task updates to bulk operations:

**Before**:
```typescript
// Update each task individually
for (const taskId of taskIds) {
  await updateTask(taskId, { artworkIds: [...] });
}
```

**After**:
```typescript
// Single bulk operation
await bulkAddArtworks({
  taskIds: taskIds,
  artworkIds: artworkIds
});
```

**Benefits**:
- Single transaction (atomic)
- Better performance
- Consistent audit logging
- Simpler error handling

## Next Steps

1. **Read full API docs**: [BULK_TASK_OPERATIONS.md](./BULK_TASK_OPERATIONS.md)
2. **Review test scenarios**: [BULK_OPERATIONS_TESTING.md](./BULK_OPERATIONS_TESTING.md)
3. **Understand implementation**: [BULK_OPERATIONS_IMPLEMENTATION_SUMMARY.md](./BULK_OPERATIONS_IMPLEMENTATION_SUMMARY.md)
4. **Test endpoints**: Use curl or Postman
5. **Integrate with frontend**: Update UI to use bulk operations

## Version History

- **v1.0.0** (2025-01-18): Initial implementation
  - Bulk arts endpoint
  - Bulk documents endpoint
  - Bulk paints endpoint
  - Bulk cutting plans endpoint

---

**Questions?** See comprehensive documentation in linked files above.
