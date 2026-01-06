# Task Field-Level Change Tracking Implementation

## Overview

This implementation provides comprehensive field-level change tracking for tasks with special handling for file arrays (artworks, budgets, invoices, receipts).

## Components Created

### 1. TaskFieldTrackerService (`task-field-tracker.service.ts`)

A dedicated service for efficient field change detection and tracking.

**Key Features:**
- Tracks 18+ task fields including primitives, objects, dates, and arrays
- Specialized file array comparison using ID-based detection
- Efficient change detection with optimized algorithms
- Automatic detection of added vs removed files
- Support for null/undefined value handling
- Deep object comparison for complex fields like `negotiatingWith`

**Tracked Fields:**
```typescript
const TRACKED_FIELDS = [
  'status',
  'term',
  'forecastDate',
  'sectorId',
  'commission',
  'negotiatingWith',
  'artworks',
  'budgets',
  'invoices',
  'receipts',
  'priority',
  'details',
  'entryDate',
  'startedAt',
  'finishedAt',
  'customerId',
  'invoiceToId',
  'paintId',
  'serialNumber',
];
```

**Main Methods:**

- `trackChanges(taskId, oldTask, newTask, userId)` - Detects all field changes
- `hasChanged(oldValue, newValue, fieldName)` - Smart comparison for any value type
- `analyzeFileArrayChange(oldFiles, newFiles)` - Detailed file array analysis
- `emitFieldChangeEvents(task, changes, oldTask)` - Emits events for all changes
- `getChangeDescription(change)` - Human-readable change description

**Performance Optimizations:**
- ID-based comparison for file arrays (O(n) vs O(n²))
- Quick length checks before deep comparisons
- Sorted ID comparison for file arrays
- JSON serialization fallback for complex objects

### 2. TaskFieldChangeLog Entity (Prisma Schema)

New database table for persisting field change history.

```prisma
model TaskFieldChangeLog {
  id           String   @id @default(uuid())
  taskId       String
  field        String   // Field name
  oldValue     Json?    // Previous value
  newValue     Json?    // New value
  changedBy    String   // User ID
  changedAt    DateTime @default(now())
  isFileArray  Boolean  @default(false)
  filesAdded   Int      @default(0)
  filesRemoved Int      @default(0)
  metadata     Json?    // Additional context
  task         Task     @relation("TASK_FIELD_CHANGE_LOGS", fields: [taskId], references: [id], onDelete: Cascade)
  user         User     @relation("TASK_FIELD_CHANGE_USER", fields: [changedBy], references: [id])

  @@index([taskId])
  @@index([field])
  @@index([changedAt])
  @@index([changedBy])
  @@index([taskId, field])
}
```

**Indexes for Performance:**
- `taskId` - Fast lookup of all changes for a task
- `field` - Query changes by field name
- `changedAt` - Time-based queries
- `changedBy` - User activity tracking
- `taskId + field` - Composite index for field history per task

### 3. TaskFieldChangedEvent (task.events.ts)

New event type with detailed file array information.

```typescript
export class TaskFieldChangedEvent {
  constructor(
    public readonly task: Task,
    public readonly field: string,
    public readonly oldValue: any,
    public readonly newValue: any,
    public readonly changedBy: string,
    public readonly isFileArray?: boolean,
    public readonly fileChange?: {
      field: string;
      added: number;
      removed: number;
      addedFiles?: any[];
      removedFiles?: any[];
      changedAt: Date;
      changedBy: string;
    },
  ) {}
}
```

### 4. TaskService Integration

Field tracking is integrated into the `task.service.ts` update method:

**Location:** After line 1260 in the update transaction

**Flow:**
1. Task is updated in database
2. Field tracker detects all changes
3. Changes are persisted to `TaskFieldChangeLog` table
4. Events are emitted for each change
5. Transaction completes

**Code Example:**
```typescript
// Track field changes
const fieldChanges = await this.fieldTracker.trackChanges(
  id,
  existingTask as Task,
  updatedTask as Task,
  userId,
);

if (fieldChanges.length > 0) {
  // Store in database
  for (const change of fieldChanges) {
    await tx.taskFieldChangeLog.create({
      data: {
        taskId: id,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedBy: userId,
        changedAt: change.changedAt,
        isFileArray,
        filesAdded,
        filesRemoved,
        metadata,
      },
    });
  }

  // Emit events
  await this.fieldTracker.emitFieldChangeEvents(
    updatedTask as Task,
    fieldChanges,
    existingTask as Task,
  );
}
```

### 5. TaskListener Enhancement

Added `handleTaskFieldChanged` method for processing field change events.

**Features:**
- Smart notification generation based on field type
- Special handling for file arrays with count information
- User-friendly messages: "2 artwork files added", "1 budget file removed"
- Importance-based notification channels
- Metadata storage for rich notifications

**Example Notifications:**

For file arrays:
- "Artes da tarefa 'Truck ABC': 2 arquivo(s) adicionado(s) por João Silva"
- "Orçamentos da tarefa 'Truck ABC': 1 arquivo(s) removido(s), 3 arquivo(s) adicionado(s) por Maria Santos"

For regular fields:
- "Prazo da tarefa 'Truck ABC' foi alterado de '01/01/2026' para '15/01/2026' por João Silva"
- "Setor da tarefa 'Truck ABC' foi alterado de 'Produção' para 'Acabamento' por Maria Santos"

## Usage Examples

### Querying Change History

```typescript
// Get all changes for a task
const changes = await prisma.taskFieldChangeLog.findMany({
  where: { taskId: 'task-id' },
  include: { user: true },
  orderBy: { changedAt: 'desc' },
});

// Get changes for a specific field
const termChanges = await prisma.taskFieldChangeLog.findMany({
  where: {
    taskId: 'task-id',
    field: 'term',
  },
  orderBy: { changedAt: 'desc' },
});

// Get file array changes
const artworkChanges = await prisma.taskFieldChangeLog.findMany({
  where: {
    taskId: 'task-id',
    isFileArray: true,
    field: 'artworks',
  },
  orderBy: { changedAt: 'desc' },
});

// User activity audit
const userChanges = await prisma.taskFieldChangeLog.findMany({
  where: { changedBy: 'user-id' },
  include: { task: true },
  orderBy: { changedAt: 'desc' },
});
```

### Listening to Field Changes

```typescript
// Listen to specific field changes
eventEmitter.on('task.field.changed', (event: TaskFieldChangedEvent) => {
  if (event.field === 'status') {
    console.log(`Status changed from ${event.oldValue} to ${event.newValue}`);
  }

  if (event.isFileArray && event.fileChange) {
    console.log(`Files changed: +${event.fileChange.added} -${event.fileChange.removed}`);
  }
});
```

## Database Migration

Run the following command to create the database table:

```bash
cd /home/kennedy/Documents/repositories/api
npx prisma migrate dev --name add_task_field_change_log
```

Or for production:

```bash
npx prisma migrate deploy
```

## File Structure

```
/home/kennedy/Documents/repositories/api/src/modules/production/task/
├── task-field-tracker.service.ts    # Field tracking service (NEW)
├── task.events.ts                   # Event definitions (UPDATED)
├── task.service.ts                  # Task service with tracking (UPDATED)
├── task.listener.ts                 # Event listener (UPDATED)
├── task.module.ts                   # Module configuration (UPDATED)
└── FIELD_TRACKING_IMPLEMENTATION.md # This documentation (NEW)

/home/kennedy/Documents/repositories/api/prisma/
└── schema.prisma                    # Database schema (UPDATED)
```

## Benefits

### 1. Performance
- Efficient ID-based file comparison (O(n) instead of O(n²))
- Optimized change detection with early exits
- Indexed database queries for fast history retrieval

### 2. Accuracy
- Handles all JavaScript types: primitives, objects, arrays, dates, null/undefined
- Deep comparison for nested objects
- Special handling for file arrays prevents false positives

### 3. Auditability
- Complete change history for compliance
- User attribution for all changes
- Timestamp tracking for temporal queries
- Rollback support with old/new values

### 4. User Experience
- Rich notifications with context
- Clear messaging for file changes ("2 files added" vs raw array diff)
- Importance-based notification routing
- Metadata for UI rendering

### 5. Developer Experience
- Type-safe interfaces
- Clear separation of concerns
- Easy to extend with new fields
- Comprehensive error handling

## Testing Recommendations

### Unit Tests

```typescript
describe('TaskFieldTrackerService', () => {
  it('should detect primitive value changes', () => {
    const changes = tracker.trackChanges(oldTask, newTask, userId);
    expect(changes).toContainEqual({
      field: 'status',
      oldValue: 'PREPARATION',
      newValue: 'IN_PROGRESS',
    });
  });

  it('should detect file array changes', () => {
    const oldFiles = [{ id: '1' }, { id: '2' }];
    const newFiles = [{ id: '2' }, { id: '3' }];
    const change = tracker.analyzeFileArrayChange(oldFiles, newFiles);
    expect(change.added).toBe(1);
    expect(change.removed).toBe(1);
  });

  it('should handle null values', () => {
    expect(tracker.hasChanged(null, null)).toBe(false);
    expect(tracker.hasChanged(null, 'value')).toBe(true);
    expect(tracker.hasChanged('value', null)).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('Task Update with Field Tracking', () => {
  it('should store field changes in database', async () => {
    await taskService.update(taskId, { term: newDate }, userId);

    const changes = await prisma.taskFieldChangeLog.findMany({
      where: { taskId },
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('term');
  });

  it('should emit events for field changes', async () => {
    const spy = jest.spyOn(eventEmitter, 'emit');

    await taskService.update(taskId, { status: 'COMPLETED' }, userId);

    expect(spy).toHaveBeenCalledWith('task.field.changed', expect.any(Object));
  });
});
```

## Future Enhancements

### Possible Additions

1. **Change Rollback**
   - Use old/new values to revert changes
   - Implement undo/redo functionality

2. **Change Aggregation**
   - Group related changes (e.g., bulk file uploads)
   - Summary views for multiple changes

3. **Real-time Updates**
   - WebSocket notifications
   - Live change feeds

4. **Analytics**
   - Most changed fields
   - User activity patterns
   - Change frequency metrics

5. **Export/Reporting**
   - Change history CSV export
   - Audit reports
   - Compliance documentation

6. **Smart Notifications**
   - Batch similar notifications
   - Digest mode for frequent changes
   - User preferences for notification types

## Maintenance Notes

### Adding New Tracked Fields

1. Add field to `TRACKED_FIELDS` array in `task-field-tracker.service.ts`
2. Add field label to `getFieldLabel()` in `task.listener.ts`
3. Set field importance in `getFieldImportance()` if needed
4. Update notification templates if special handling required

### Performance Monitoring

Monitor these metrics:
- Average time for `trackChanges()` execution
- Database query performance for change history
- Event emission latency
- Notification creation throughput

### Error Handling

The implementation includes comprehensive error handling:
- Try-catch blocks around change tracking
- Logging for debugging
- Graceful degradation (task updates succeed even if tracking fails)
- Transaction safety (all changes committed or rolled back together)

## Support

For questions or issues with the field tracking implementation, refer to:
- Service implementation: `task-field-tracker.service.ts`
- Event definitions: `task.events.ts`
- Integration point: `task.service.ts` (lines 1260-1315)
- Event handlers: `task.listener.ts` (lines 156-230)
