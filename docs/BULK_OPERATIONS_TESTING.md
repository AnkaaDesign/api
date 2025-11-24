# Bulk Task Operations - Testing Guide

This document provides testing scenarios and examples for the bulk task operations API.

## Test Setup

### Prerequisites
1. Database with test tasks, files, and paints
2. User with LEADER or ADMIN role
3. Valid authentication token

### Test Data Setup

```sql
-- Create test tasks
INSERT INTO Task (id, name, status, commission) VALUES
  ('task-1', 'Test Task 1', 'PENDING', 'NO_COMMISSION'),
  ('task-2', 'Test Task 2', 'PENDING', 'NO_COMMISSION'),
  ('task-3', 'Test Task 3', 'PENDING', 'NO_COMMISSION');

-- Create test files (artworks)
INSERT INTO File (id, filename, path, mimetype, size) VALUES
  ('art-1', 'artwork1.png', '/uploads/artworks/artwork1.png', 'image/png', 1024),
  ('art-2', 'artwork2.png', '/uploads/artworks/artwork2.png', 'image/png', 2048);

-- Create test files (documents)
INSERT INTO File (id, filename, path, mimetype, size) VALUES
  ('doc-1', 'budget1.pdf', '/uploads/budgets/budget1.pdf', 'application/pdf', 5120),
  ('doc-2', 'invoice1.pdf', '/uploads/invoices/invoice1.pdf', 'application/pdf', 3072);

-- Create test paints
INSERT INTO Paint (id, name) VALUES
  ('paint-1', 'Red Paint'),
  ('paint-2', 'Blue Paint');

-- Create test cut file
INSERT INTO File (id, filename, path, mimetype, size) VALUES
  ('cut-file-1', 'design.ai', '/uploads/cuts/design.ai', 'application/illustrator', 10240);
```

## Test Scenarios

### 1. Bulk Add Artworks

#### Test Case 1.1: Successfully add artworks to multiple tasks

**Request**:
```bash
POST /api/tasks/bulk/arts
Content-Type: application/json

{
  "taskIds": ["task-1", "task-2", "task-3"],
  "artworkIds": ["art-1", "art-2"]
}
```

**Expected Response**:
```json
{
  "success": 3,
  "failed": 0,
  "total": 3,
  "errors": []
}
```

**Verification**:
```sql
-- Should show 2 artworks for each task
SELECT t.id, COUNT(a.id) as artwork_count
FROM Task t
LEFT JOIN _TASK_FILES tf ON t.id = tf.A
LEFT JOIN File a ON tf.B = a.id
WHERE t.id IN ('task-1', 'task-2', 'task-3')
GROUP BY t.id;

-- Should show 3 records per artwork
SELECT fileId, COUNT(*) as task_count
FROM _TASK_FILES
WHERE fileId IN ('art-1', 'art-2')
GROUP BY fileId;
```

#### Test Case 1.2: Merge with existing artworks (no duplicates)

**Setup**: Task-1 already has art-1

**Request**:
```bash
POST /api/tasks/bulk/arts
Content-Type: application/json

{
  "taskIds": ["task-1"],
  "artworkIds": ["art-1", "art-2"]
}
```

**Expected Response**:
```json
{
  "success": 1,
  "failed": 0,
  "total": 1,
  "errors": []
}
```

**Verification**:
```sql
-- Should show exactly 2 artworks (not 3)
SELECT COUNT(*) as artwork_count
FROM _TASK_FILES
WHERE taskId = 'task-1';
```

#### Test Case 1.3: Handle invalid task IDs

**Request**:
```bash
POST /api/tasks/bulk/arts
Content-Type: application/json

{
  "taskIds": ["task-1", "invalid-task-id"],
  "artworkIds": ["art-1"]
}
```

**Expected Response**: 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Tarefas não encontradas: invalid-task-id"
}
```

#### Test Case 1.4: Handle invalid artwork IDs

**Request**:
```bash
POST /api/tasks/bulk/arts
Content-Type: application/json

{
  "taskIds": ["task-1"],
  "artworkIds": ["art-1", "invalid-art-id"]
}
```

**Expected Response**: 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Artes não encontradas: invalid-art-id"
}
```

#### Test Case 1.5: Validation - empty arrays

**Request**:
```bash
POST /api/tasks/bulk/arts
Content-Type: application/json

{
  "taskIds": [],
  "artworkIds": ["art-1"]
}
```

**Expected Response**: 400 Bad Request
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

---

### 2. Bulk Add Documents

#### Test Case 2.1: Add budget documents

**Request**:
```bash
POST /api/tasks/bulk/documents
Content-Type: application/json

{
  "taskIds": ["task-1", "task-2"],
  "documentType": "budget",
  "documentIds": ["doc-1"]
}
```

**Expected Response**:
```json
{
  "success": 2,
  "failed": 0,
  "total": 2,
  "errors": []
}
```

**Verification**:
```sql
SELECT t.id, COUNT(b.id) as budget_count
FROM Task t
LEFT JOIN _TASK_BUDGETS tb ON t.id = tb.A
LEFT JOIN File b ON tb.B = b.id
WHERE t.id IN ('task-1', 'task-2')
GROUP BY t.id;
```

#### Test Case 2.2: Add invoice documents

**Request**:
```bash
POST /api/tasks/bulk/documents
Content-Type: application/json

{
  "taskIds": ["task-1", "task-2"],
  "documentType": "invoice",
  "documentIds": ["doc-2"]
}
```

**Expected Response**:
```json
{
  "success": 2,
  "failed": 0,
  "total": 2,
  "errors": []
}
```

#### Test Case 2.3: Invalid document type

**Request**:
```bash
POST /api/tasks/bulk/documents
Content-Type: application/json

{
  "taskIds": ["task-1"],
  "documentType": "invalid-type",
  "documentIds": ["doc-1"]
}
```

**Expected Response**: 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "documentType",
      "message": "Tipo de documento inválido"
    }
  ]
}
```

---

### 3. Bulk Add Paints

#### Test Case 3.1: Add paints to multiple tasks

**Request**:
```bash
POST /api/tasks/bulk/paints
Content-Type: application/json

{
  "taskIds": ["task-1", "task-2", "task-3"],
  "paintIds": ["paint-1", "paint-2"]
}
```

**Expected Response**:
```json
{
  "success": 3,
  "failed": 0,
  "total": 3,
  "errors": []
}
```

**Verification**:
```sql
SELECT t.id, COUNT(p.id) as paint_count
FROM Task t
LEFT JOIN _TASK_LOGO_PAINT tlp ON t.id = tlp.A
LEFT JOIN Paint p ON tlp.B = p.id
WHERE t.id IN ('task-1', 'task-2', 'task-3')
GROUP BY t.id;
```

#### Test Case 3.2: Merge with existing paints

**Setup**: Task-1 already has paint-1

**Request**:
```bash
POST /api/tasks/bulk/paints
Content-Type: application/json

{
  "taskIds": ["task-1"],
  "paintIds": ["paint-1", "paint-2"]
}
```

**Expected Response**:
```json
{
  "success": 1,
  "failed": 0,
  "total": 1,
  "errors": []
}
```

**Verification**:
```sql
-- Should show exactly 2 paints (not 3)
SELECT COUNT(*) as paint_count
FROM _TASK_LOGO_PAINT
WHERE taskId = 'task-1';
```

---

### 4. Bulk Add Cutting Plans

#### Test Case 4.1: Create single cut for multiple tasks

**Request**:
```bash
POST /api/tasks/bulk/cutting-plans
Content-Type: application/json

{
  "taskIds": ["task-1", "task-2", "task-3"],
  "cutData": {
    "fileId": "cut-file-1",
    "type": "VINYL",
    "origin": "PLAN",
    "reason": null,
    "quantity": 1
  }
}
```

**Expected Response**:
```json
{
  "success": 3,
  "failed": 0,
  "total": 3,
  "errors": []
}
```

**Verification**:
```sql
-- Should show 1 cut per task (3 total)
SELECT taskId, COUNT(*) as cut_count
FROM Cut
WHERE taskId IN ('task-1', 'task-2', 'task-3')
GROUP BY taskId;

-- All cuts should reference the same file
SELECT DISTINCT fileId
FROM Cut
WHERE taskId IN ('task-1', 'task-2', 'task-3');
```

#### Test Case 4.2: Create multiple cuts per task

**Request**:
```bash
POST /api/tasks/bulk/cutting-plans
Content-Type: application/json

{
  "taskIds": ["task-1", "task-2"],
  "cutData": {
    "fileId": "cut-file-1",
    "type": "VINYL",
    "origin": "PLAN",
    "quantity": 3
  }
}
```

**Expected Response**:
```json
{
  "success": 2,
  "failed": 0,
  "total": 2,
  "errors": []
}
```

**Verification**:
```sql
-- Should show 3 cuts per task (6 total)
SELECT taskId, COUNT(*) as cut_count
FROM Cut
WHERE taskId IN ('task-1', 'task-2')
GROUP BY taskId;

-- Verify all cuts have correct properties
SELECT
  taskId,
  fileId,
  type,
  status,
  statusOrder,
  origin
FROM Cut
WHERE taskId IN ('task-1', 'task-2')
ORDER BY taskId, createdAt;
```

#### Test Case 4.3: Each task gets independent cuts

**Request**: Same as 4.2

**Verification**:
```sql
-- Each cut should be a separate record
SELECT COUNT(DISTINCT id) as total_cuts
FROM Cut
WHERE taskId IN ('task-1', 'task-2');
-- Should return 6

-- Verify cuts are linked to correct tasks
SELECT id, taskId, fileId
FROM Cut
WHERE taskId IN ('task-1', 'task-2')
ORDER BY taskId, createdAt;
```

#### Test Case 4.4: Invalid cut file

**Request**:
```bash
POST /api/tasks/bulk/cutting-plans
Content-Type: application/json

{
  "taskIds": ["task-1"],
  "cutData": {
    "fileId": "invalid-file-id",
    "type": "VINYL",
    "quantity": 1
  }
}
```

**Expected Response**: 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Arquivo de corte não encontrado: invalid-file-id"
}
```

#### Test Case 4.5: Quantity validation

**Request**:
```bash
POST /api/tasks/bulk/cutting-plans
Content-Type: application/json

{
  "taskIds": ["task-1"],
  "cutData": {
    "fileId": "cut-file-1",
    "type": "VINYL",
    "quantity": 0
  }
}
```

**Expected Response**: 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "cutData.quantity",
      "message": "Quantity must be at least 1"
    }
  ]
}
```

---

### 5. Authorization Tests

#### Test Case 5.1: Unauthorized user (no token)

**Request**:
```bash
POST /api/tasks/bulk/arts
Content-Type: application/json

{
  "taskIds": ["task-1"],
  "artworkIds": ["art-1"]
}
```

**Expected Response**: 401 Unauthorized

#### Test Case 5.2: Insufficient permissions (non-admin/leader)

**Request**: With token from user with PRODUCTION role

**Expected Response**: 403 Forbidden

---

### 6. Audit Logging Tests

#### Test Case 6.1: Verify audit logs created

**Request**: Any successful bulk operation

**Verification**:
```sql
-- Check that changelog entries were created
SELECT
  entityType,
  entityId,
  action,
  fieldName,
  oldValue,
  newValue,
  reason,
  userId
FROM ChangeLog
WHERE
  entityType = 'TASK'
  AND entityId IN ('task-1', 'task-2', 'task-3')
  AND createdAt > NOW() - INTERVAL 1 MINUTE
ORDER BY createdAt DESC;
```

**Expected**: One changelog entry per successful task update

---

### 7. Transaction Tests

#### Test Case 7.1: Transaction rollback on critical error

**Setup**: Force a database constraint violation mid-transaction

**Expected**: All changes should be rolled back, no partial updates

#### Test Case 7.2: Partial failures with graceful handling

**Request**: Include one invalid task ID among valid ones

**Expected**: Transaction should complete for valid tasks, errors array should list failures

---

### 8. Performance Tests

#### Test Case 8.1: Large batch (50 tasks)

**Request**: Bulk operation with 50 task IDs

**Expected**:
- Response time < 5 seconds
- All operations complete successfully
- Database connection pool not exhausted

#### Test Case 8.2: Large quantity (100 cuts per task)

**Request**: Create 100 cuts for a single task

**Expected**:
- Response time < 10 seconds
- All cuts created with correct properties
- No timeout errors

---

## Automated Test Suite Example (Jest/NestJS)

```typescript
describe('Bulk Task Operations', () => {
  describe('POST /tasks/bulk/arts', () => {
    it('should add artworks to multiple tasks', async () => {
      const response = await request(app.getHttpServer())
        .post('/tasks/bulk/arts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          taskIds: ['task-1', 'task-2'],
          artworkIds: ['art-1'],
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: 2,
        failed: 0,
        total: 2,
        errors: [],
      });
    });

    it('should merge with existing artworks without duplicates', async () => {
      // Pre-condition: task-1 already has art-1

      await request(app.getHttpServer())
        .post('/tasks/bulk/arts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          taskIds: ['task-1'],
          artworkIds: ['art-1', 'art-2'],
        })
        .expect(200);

      // Verify no duplicates
      const task = await prisma.task.findUnique({
        where: { id: 'task-1' },
        include: { artworks: true },
      });

      expect(task.artworks).toHaveLength(2);
    });
  });

  describe('POST /tasks/bulk/cutting-plans', () => {
    it('should create independent cuts for each task', async () => {
      await request(app.getHttpServer())
        .post('/tasks/bulk/cutting-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          taskIds: ['task-1', 'task-2'],
          cutData: {
            fileId: 'cut-file-1',
            type: 'VINYL',
            quantity: 2,
          },
        })
        .expect(200);

      const cuts = await prisma.cut.findMany({
        where: { taskId: { in: ['task-1', 'task-2'] } },
      });

      expect(cuts).toHaveLength(4); // 2 tasks × 2 cuts each
      expect(cuts.every(cut => cut.fileId === 'cut-file-1')).toBe(true);
      expect(cuts.every(cut => cut.status === 'PENDING')).toBe(true);
    });
  });
});
```

## Performance Benchmarks

Target performance metrics:

| Operation | Tasks | Items | Expected Time | Max Time |
|-----------|-------|-------|---------------|----------|
| Bulk Arts | 10 | 5 artworks | < 1s | 2s |
| Bulk Arts | 50 | 5 artworks | < 3s | 5s |
| Bulk Documents | 10 | 3 docs | < 1s | 2s |
| Bulk Paints | 10 | 5 paints | < 1s | 2s |
| Bulk Cuts | 10 | qty: 1 | < 1s | 2s |
| Bulk Cuts | 10 | qty: 10 | < 2s | 5s |
| Bulk Cuts | 50 | qty: 5 | < 5s | 10s |

## Common Issues & Debugging

### Issue 1: Slow performance with large batches
**Symptom**: Request takes >10 seconds
**Solution**: Check database indexes, reduce batch size, or implement pagination

### Issue 2: Transaction timeout
**Symptom**: 504 Gateway Timeout
**Solution**: Increase transaction timeout, split into smaller batches

### Issue 3: Duplicate entries
**Symptom**: Same artwork appears multiple times
**Solution**: Verify merge logic using Set operations

### Issue 4: Audit logs missing
**Symptom**: No changelog entries created
**Solution**: Check transaction scope includes changelog service calls
