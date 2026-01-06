# Task Notification Service - Field-Level Change Tracking

## Overview

The `TaskNotificationService` provides comprehensive field-level change tracking for tasks, allowing users to receive notifications about specific field changes they care about. The service intelligently tracks changes, respects user preferences, and can aggregate multiple changes to prevent notification spam.

## Features

### 1. **Field-Level Change Detection**
- Detects changes in individual task fields
- Handles primitives, objects, arrays, and dates
- Provides formatted values for display

### 2. **User Preference Support**
- Users can enable/disable notifications per field
- Respects notification channel preferences (Email, Push, In-App, SMS, WhatsApp)
- Mandatory vs optional notification types

### 3. **Notification Aggregation**
- Combines multiple field changes into a single notification
- Configurable aggregation window (default: 5 minutes)
- Reduces notification spam while keeping users informed

### 4. **Portuguese Localization**
- All field labels in Portuguese
- Formatted messages in Portuguese
- Date formatting in Brazilian format

## Tracked Fields

The service tracks the following task fields:

| Field Name | Portuguese Label | Importance |
|------------|-----------------|------------|
| `name` | Título | Normal |
| `details` | Descrição | Normal |
| `status` | Status | High |
| `priority` | Prioridade | Normal |
| `sectorId` | Responsável | High |
| `term` | Prazo | High |
| `tags` | Etiquetas | Normal |
| `artworks` | Anexos | Normal |
| `observation` | Comentários | Normal |
| `commission` | Comissão | Normal |
| `serialNumber` | Número de Série | Normal |
| `entryDate` | Data de Entrada | Normal |
| `startedAt` | Data de Início | Normal |
| `finishedAt` | Data de Conclusão | Normal |
| `forecastDate` | Data Prevista | Normal |
| `paintId` | Pintura | Normal |
| `customerId` | Cliente | Normal |
| `invoiceToId` | Faturar Para | Normal |
| `negotiatingWith` | Negociando Com | Normal |
| `budgets` | Orçamentos | Normal |
| `invoices` | Faturas | Normal |
| `receipts` | Recibos | Normal |

## API Reference

### Core Methods

#### `trackTaskChanges(oldTask: Task, newTask: Task): TaskFieldChange[]`

Compares two task states and returns an array of detected field changes.

**Parameters:**
- `oldTask` - Previous task state
- `newTask` - New task state

**Returns:**
Array of `TaskFieldChange` objects with:
- `field` - Field name
- `fieldLabel` - Portuguese label
- `oldValue` - Previous value
- `newValue` - New value
- `formattedOldValue` - Formatted old value for display
- `formattedNewValue` - Formatted new value for display
- `changedAt` - Timestamp of change

**Example:**
```typescript
const changes = taskNotificationService.trackTaskChanges(oldTask, newTask);
// Returns: [{ field: 'status', fieldLabel: 'Status', ... }]
```

---

#### `createFieldChangeNotifications(task: Task, changes: TaskFieldChange[], userId: string, changedBy: string): Promise<string[]>`

Creates individual notifications for each field change, respecting user preferences.

**Parameters:**
- `task` - Updated task
- `changes` - Array of field changes
- `userId` - User to notify
- `changedBy` - User who made the changes

**Returns:**
Array of created notification IDs

**Example:**
```typescript
const notificationIds = await taskNotificationService.createFieldChangeNotifications(
  updatedTask,
  changes,
  'user-123',
  'user-admin'
);
```

---

#### `formatFieldChange(taskTitle: string, change: TaskFieldChange): string`

Formats a field change into a user-friendly message.

**Parameters:**
- `taskTitle` - Task title
- `change` - Field change object

**Returns:**
Formatted message string

**Example:**
```typescript
const message = taskNotificationService.formatFieldChange('Pintura do Caminhão', change);
// Returns: "Campo Status alterado em Pintura do Caminhão: PENDING → IN_PROGRESS"
```

---

#### `getFieldLabel(fieldName: string): string`

Returns the Portuguese label for a field name.

**Parameters:**
- `fieldName` - Field name to lookup

**Returns:**
Portuguese label string

**Example:**
```typescript
const label = taskNotificationService.getFieldLabel('status');
// Returns: "Status"
```

---

#### `shouldNotifyField(userId: string, fieldName: string): Promise<boolean>`

Checks if a user wants notifications for a specific field based on their preferences.

**Parameters:**
- `userId` - User ID
- `fieldName` - Field name

**Returns:**
`true` if user wants notifications for this field

**Example:**
```typescript
const shouldNotify = await taskNotificationService.shouldNotifyField('user-123', 'status');
// Returns: true or false based on user preferences
```

---

#### `aggregateFieldChanges(task: Task, changes: TaskFieldChange[], userId: string, changedBy: string, immediate: boolean): Promise<void>`

Aggregates multiple field changes into a single notification to prevent spam.

**Parameters:**
- `task` - Updated task
- `changes` - Array of field changes
- `userId` - User to notify
- `changedBy` - User who made changes
- `immediate` - If true, send immediately; otherwise wait for aggregation window

**Example:**
```typescript
// Aggregate changes with 5-minute window
await taskNotificationService.aggregateFieldChanges(
  task,
  changes,
  'user-123',
  'user-admin',
  false // Wait for window
);

// Send immediately
await taskNotificationService.aggregateFieldChanges(
  task,
  changes,
  'user-123',
  'user-admin',
  true // Send now
);
```

---

#### `cleanup(): Promise<void>`

Sends all pending aggregated notifications immediately. Useful during application shutdown.

**Example:**
```typescript
await taskNotificationService.cleanup();
```

## Usage Examples

### Basic Integration in Task Service

```typescript
import { Injectable } from '@nestjs/common';
import { TaskNotificationService } from '../notification/task-notification.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly taskNotificationService: TaskNotificationService,
  ) {}

  async updateTask(taskId: string, updateData: any, userId: string) {
    // Get old task state
    const oldTask = await this.findOne(taskId);

    // Update task
    const newTask = await this.prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });

    // Track changes
    const changes = this.taskNotificationService.trackTaskChanges(
      oldTask,
      newTask
    );

    if (changes.length > 0) {
      // Get users to notify (team members, watchers, etc.)
      const usersToNotify = await this.getTaskWatchers(taskId);

      // Notify each user
      for (const notifyUserId of usersToNotify) {
        // Option 1: Aggregate changes (recommended)
        await this.taskNotificationService.aggregateFieldChanges(
          newTask,
          changes,
          notifyUserId,
          userId,
          false // Use aggregation window
        );

        // Option 2: Individual notifications per field
        // await this.taskNotificationService.createFieldChangeNotifications(
        //   newTask,
        //   changes,
        //   notifyUserId,
        //   userId
        // );
      }
    }

    return newTask;
  }
}
```

### Selective Notification Based on Field Type

```typescript
// Notify immediately for critical fields
const criticalFields = ['status', 'term', 'sectorId'];
const hasCriticalChanges = changes.some(c =>
  criticalFields.includes(c.field)
);

await taskNotificationService.aggregateFieldChanges(
  task,
  changes,
  userId,
  changedBy,
  hasCriticalChanges // Send immediately if critical
);
```

### Custom Change Formatting

```typescript
const changes = taskNotificationService.trackTaskChanges(oldTask, newTask);

changes.forEach(change => {
  const message = taskNotificationService.formatFieldChange(
    task.name,
    change
  );
  console.log(message);
  // Output: "Campo Status alterado em Task Name: OLD → NEW"
});
```

## User Preference Configuration

### Event Types

Each tracked field has a corresponding event type for user preferences:

- `task.field.name` - Title changes
- `task.field.details` - Description changes
- `task.field.status` - Status changes
- `task.field.priority` - Priority changes
- `task.field.sectorId` - Assignment changes
- `task.field.term` - Due date changes
- `task.field.tags` - Tags changes
- `task.field.artworks` - Attachment changes
- `task.field.observation` - Comment changes
- `task.field.multiple` - Aggregated changes (multiple fields)

### Example Preference Setup

```typescript
// User wants status change notifications via In-App and Email
{
  userId: 'user-123',
  type: NOTIFICATION_TYPE.TASK,
  eventType: 'task.field.status',
  channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
  enabled: true,
  isMandatory: false
}

// User wants NO description change notifications
{
  userId: 'user-123',
  type: NOTIFICATION_TYPE.TASK,
  eventType: 'task.field.details',
  channels: [],
  enabled: false,
  isMandatory: false
}
```

### Checking User Preferences

```typescript
// Check if user wants status notifications
const wantsStatusNotifs = await taskNotificationService.shouldNotifyField(
  'user-123',
  'status'
);

if (wantsStatusNotifs) {
  // Send notification
}
```

## Notification Format

### Individual Field Change Notification

```
Title: Alteração em tarefa: Pintura do Caminhão
Message: Campo Status alterado em Pintura do Caminhão: PENDING → IN_PROGRESS
Importance: HIGH
Entity: Task (task-123)
Action URL: /tasks/task-123
Metadata:
  - field: status
  - fieldLabel: Status
  - oldValue: PENDING
  - newValue: IN_PROGRESS
  - changedBy: user-admin
```

### Aggregated Notification

```
Title: 3 alterações em tarefa: Pintura do Caminhão
Message: Campos alterados: Status, Prioridade, Prazo
Importance: NORMAL
Entity: Task (task-123)
Action URL: /tasks/task-123
Metadata:
  - aggregated: true
  - changeCount: 3
  - changes: [
      { field: 'status', ... },
      { field: 'priority', ... },
      { field: 'term', ... }
    ]
  - firstChangeAt: 2026-01-05T10:00:00Z
  - sentAt: 2026-01-05T10:05:00Z
```

## Aggregation Behavior

### Aggregation Window

The service uses a 5-minute aggregation window by default. Changes occurring within this window are combined into a single notification.

**Timeline Example:**
```
10:00:00 - Status changed (start aggregation)
10:02:00 - Priority changed (added to aggregation)
10:04:00 - Due date changed (added to aggregation)
10:05:00 - Aggregated notification sent (3 changes)
```

### Immediate Send

Use `immediate: true` to bypass the aggregation window:

```typescript
// Important change - send immediately
await taskNotificationService.aggregateFieldChanges(
  task,
  changes,
  userId,
  changedBy,
  true // immediate
);
```

### Cleanup on Shutdown

Always call `cleanup()` during application shutdown to send pending notifications:

```typescript
// In your application shutdown hook
async onApplicationShutdown() {
  await this.taskNotificationService.cleanup();
}
```

## Field Value Formatting

The service automatically formats values for display:

- **Dates**: `10/01/2026` (Brazilian format)
- **Null/Undefined**: `N/A`
- **Arrays**: `2 item(ns)` or `Nenhum` for empty arrays
- **Booleans**: `Sim` / `Não`
- **Objects**: Special handling for `negotiatingWith`, JSON for others

## Testing

Comprehensive test suite included at:
`/src/modules/common/notification/tests/task-notification.service.spec.ts`

Run tests:
```bash
npm test task-notification.service.spec.ts
```

## Integration with Notification Module

The service integrates with:

1. **NotificationPreferenceService** - User preferences
2. **NotificationService** - Notification creation
3. **NotificationGatewayService** - Real-time delivery (via NotificationService)
4. **NotificationQueueService** - Async processing (via NotificationService)

## Performance Considerations

1. **Aggregation reduces load**: Multiple changes = single notification
2. **Preference caching**: Consider caching user preferences
3. **Async processing**: Notifications are queued and processed asynchronously
4. **Memory usage**: Pending aggregations stored in memory (consider Redis for production)

## Best Practices

1. **Use aggregation for bulk updates**: Prevents notification spam
2. **Send immediately for critical changes**: Status, assignments, due dates
3. **Check user preferences**: Respect user choices
4. **Clean up on shutdown**: Ensure all notifications are sent
5. **Log errors**: Don't block task updates on notification failures

## Troubleshooting

### Notifications not being sent

1. Check user preferences: `shouldNotifyField()`
2. Verify channels are enabled
3. Check aggregation window hasn't expired
4. Ensure `cleanup()` is called on shutdown

### Wrong field labels

- Update `FIELD_LABELS` constant in the service
- Labels are in Portuguese by default

### Performance issues

- Consider Redis for aggregation storage
- Cache user preferences
- Adjust aggregation window
- Use background jobs for notifications

## Future Enhancements

- [ ] Redis-based aggregation storage
- [ ] Configurable aggregation windows per field
- [ ] Notification templates for different field types
- [ ] Batch preference checking
- [ ] Webhook notifications for field changes
- [ ] Field change history API
