# Task Notification Service - Quick Reference

## Installation

Add to your module's providers:

```typescript
import { TaskNotificationService } from './notification/task-notification.service';

@Module({
  providers: [
    TaskNotificationService,
    NotificationPreferenceService,
    NotificationService,
  ],
})
export class YourModule {}
```

## Quick Start

### 1. Track Changes

```typescript
const changes = taskNotificationService.trackTaskChanges(oldTask, newTask);
```

### 2. Create Notifications

**Option A: Individual notifications per field**
```typescript
await taskNotificationService.createFieldChangeNotifications(
  task,
  changes,
  userId,
  changedBy
);
```

**Option B: Aggregated notification (recommended)**
```typescript
await taskNotificationService.aggregateFieldChanges(
  task,
  changes,
  userId,
  changedBy,
  false // Use 5-minute aggregation window
);
```

## Common Patterns

### Basic Task Update

```typescript
async updateTask(taskId: string, updateData: any, userId: string) {
  const oldTask = await this.findOne(taskId);
  const newTask = await this.update(taskId, updateData);

  const changes = this.taskNotificationService.trackTaskChanges(oldTask, newTask);

  if (changes.length > 0) {
    const watchers = await this.getTaskWatchers(taskId);

    for (const watcherId of watchers) {
      await this.taskNotificationService.aggregateFieldChanges(
        newTask,
        changes,
        watcherId,
        userId,
        false
      );
    }
  }

  return newTask;
}
```

### Send Immediately for Critical Fields

```typescript
const criticalFields = ['status', 'term', 'sectorId'];
const isCritical = changes.some(c => criticalFields.includes(c.field));

await taskNotificationService.aggregateFieldChanges(
  task,
  changes,
  userId,
  changedBy,
  isCritical // Send immediately if critical
);
```

### Check User Preferences

```typescript
const wantsNotification = await taskNotificationService.shouldNotifyField(
  userId,
  'status'
);

if (wantsNotification) {
  // Send notification
}
```

## Tracked Fields

| Field | Label | Event Type |
|-------|-------|------------|
| `name` | Título | `task.field.name` |
| `details` | Descrição | `task.field.details` |
| `status` | Status | `task.field.status` |
| `priority` | Prioridade | `task.field.priority` |
| `sectorId` | Responsável | `task.field.sectorId` |
| `term` | Prazo | `task.field.term` |
| `artworks` | Anexos | `task.field.artworks` |
| `observation` | Comentários | `task.field.observation` |

## API Methods

### trackTaskChanges(oldTask, newTask)
Returns array of field changes with formatted values.

### createFieldChangeNotifications(task, changes, userId, changedBy)
Creates individual notification for each change. Returns notification IDs.

### aggregateFieldChanges(task, changes, userId, changedBy, immediate)
Aggregates changes into single notification. Use `immediate: true` to skip window.

### formatFieldChange(taskTitle, change)
Returns formatted message: "Campo X alterado em Y: OLD → NEW"

### getFieldLabel(fieldName)
Returns Portuguese label for field name.

### shouldNotifyField(userId, fieldName)
Checks if user wants notifications for this field.

### cleanup()
Sends all pending aggregations. Call on app shutdown.

## User Preferences

Users configure preferences per field via event types:

```typescript
// Enable status notifications
{
  type: NOTIFICATION_TYPE.TASK,
  eventType: 'task.field.status',
  channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
  enabled: true
}

// Disable description notifications
{
  type: NOTIFICATION_TYPE.TASK,
  eventType: 'task.field.details',
  channels: [],
  enabled: false
}
```

## Notification Format

### Individual Change
```
Title: Alteração em tarefa: Task Name
Message: Campo Status alterado em Task Name: PENDING → IN_PROGRESS
```

### Aggregated (Multiple Changes)
```
Title: 3 alterações em tarefa: Task Name
Message: Campos alterados: Status, Prioridade, Prazo
```

## Aggregation Behavior

- **Window**: 5 minutes by default
- **Immediate**: Set `immediate: true` to bypass window
- **Cleanup**: Call `cleanup()` on shutdown to send pending notifications

## Error Handling

Notification failures don't block task updates. Errors are logged.

```typescript
try {
  await taskNotificationService.createFieldChangeNotifications(...);
} catch (error) {
  // Error logged, task update continues
}
```

## Testing

```bash
npm test task-notification.service.spec.ts
```

## Files

- **Service**: `/src/modules/common/notification/task-notification.service.ts`
- **Examples**: `/src/modules/common/notification/examples/task-notification.example.ts`
- **Tests**: `/src/modules/common/notification/tests/task-notification.service.spec.ts`
- **Docs**: `/src/modules/common/notification/TASK_NOTIFICATION_README.md`

## Tips

1. Use aggregation for bulk updates
2. Send immediately for critical changes
3. Call `cleanup()` on shutdown
4. Don't block task updates on notification failures
5. Check user preferences to respect choices
