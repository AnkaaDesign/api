/**
 * Task Notification Service - Usage Examples
 *
 * This file demonstrates how to use the TaskNotificationService for field-level
 * task change tracking and notifications.
 */

import { TaskNotificationService } from '../task-notification.service';
import type { Task } from '../../../../types';

// Example: Basic field change tracking
export async function exampleTrackTaskChanges(
  taskNotificationService: TaskNotificationService,
) {
  // Old task state
  const oldTask: Task = {
    id: 'task-123',
    name: 'Pintura do Caminhão Mercedes',
    details: 'Pintura completa do caminhão',
    status: 'IN_PROGRESS' as any,
    priority: 'NORMAL',
    sectorId: 'sector-1',
    term: new Date('2026-01-10'),
    // ... other fields
  } as Task;

  // New task state with changes
  const newTask: Task = {
    ...oldTask,
    name: 'Pintura Completa do Caminhão Mercedes', // Changed
    status: 'COMPLETED' as any, // Changed
    term: new Date('2026-01-15'), // Changed
  };

  // Track changes
  const changes = taskNotificationService.trackTaskChanges(oldTask, newTask);

  console.log(`Detected ${changes.length} changes:`);
  changes.forEach(change => {
    console.log(`- ${change.fieldLabel}: ${change.formattedOldValue} → ${change.formattedNewValue}`);
  });

  // Output:
  // Detected 3 changes:
  // - Título: Pintura do Caminhão Mercedes → Pintura Completa do Caminhão Mercedes
  // - Status: IN_PROGRESS → COMPLETED
  // - Prazo: 10/01/2026 → 15/01/2026
}

// Example: Create individual notifications for each field change
export async function exampleCreateFieldChangeNotifications(
  taskNotificationService: TaskNotificationService,
) {
  const oldTask: Task = {
    id: 'task-123',
    name: 'Pintura do Caminhão',
    status: 'PENDING' as any,
    priority: 'NORMAL',
  } as Task;

  const newTask: Task = {
    ...oldTask,
    status: 'IN_PROGRESS' as any,
    priority: 'HIGH',
  };

  // Track changes
  const changes = taskNotificationService.trackTaskChanges(oldTask, newTask);

  // Create notifications for user
  const userId = 'user-456';
  const changedBy = 'user-789';

  const notificationIds = await taskNotificationService.createFieldChangeNotifications(
    newTask,
    changes,
    userId,
    changedBy,
  );

  console.log(`Created ${notificationIds.length} notifications`);

  // This will create notifications like:
  // - "Campo Status alterado em Pintura do Caminhão: PENDING → IN_PROGRESS"
  // - "Campo Prioridade alterado em Pintura do Caminhão: NORMAL → HIGH"
}

// Example: Check if user wants notifications for specific fields
export async function exampleShouldNotifyField(
  taskNotificationService: TaskNotificationService,
) {
  const userId = 'user-123';

  // Check if user wants status change notifications
  const shouldNotifyStatus = await taskNotificationService.shouldNotifyField(
    userId,
    'status',
  );

  // Check if user wants description change notifications
  const shouldNotifyDescription = await taskNotificationService.shouldNotifyField(
    userId,
    'details',
  );

  console.log('User notification preferences:');
  console.log(`- Status changes: ${shouldNotifyStatus ? 'Enabled' : 'Disabled'}`);
  console.log(`- Description changes: ${shouldNotifyDescription ? 'Enabled' : 'Disabled'}`);
}

// Example: Aggregate multiple field changes into a single notification
export async function exampleAggregateFieldChanges(
  taskNotificationService: TaskNotificationService,
) {
  const task: Task = {
    id: 'task-123',
    name: 'Pintura do Caminhão',
    status: 'IN_PROGRESS' as any,
    priority: 'NORMAL',
    sectorId: 'sector-1',
    term: new Date('2026-01-10'),
  } as Task;

  const oldTask: Task = {
    ...task,
    status: 'PENDING' as any,
    priority: 'LOW',
    term: new Date('2026-01-08'),
  };

  // Track changes
  const changes = taskNotificationService.trackTaskChanges(oldTask, task);

  const userId = 'user-456';
  const changedBy = 'user-789';

  // Aggregate changes (will be sent after 5-minute window)
  await taskNotificationService.aggregateFieldChanges(
    task,
    changes,
    userId,
    changedBy,
    false, // Not immediate
  );

  console.log('Changes aggregated. Notification will be sent after 5 minutes.');

  // Later, if more changes occur within the window, they'll be added to the same notification
  const updatedTask: Task = {
    ...task,
    details: 'Pintura completa incluindo arte personalizada',
  };

  const moreChanges = taskNotificationService.trackTaskChanges(task, updatedTask);

  await taskNotificationService.aggregateFieldChanges(
    updatedTask,
    moreChanges,
    userId,
    changedBy,
    false,
  );

  console.log('Additional changes added to pending aggregation.');

  // Final notification will include all changes:
  // "4 alterações em tarefa: Pintura do Caminhão"
  // "Campos alterados: Status, Prioridade, Prazo, Descrição"
}

// Example: Send aggregated notification immediately
export async function exampleAggregateImmediately(
  taskNotificationService: TaskNotificationService,
) {
  const task: Task = {
    id: 'task-123',
    name: 'Pintura do Caminhão',
    status: 'COMPLETED' as any,
  } as Task;

  const oldTask: Task = {
    ...task,
    status: 'IN_PROGRESS' as any,
  };

  const changes = taskNotificationService.trackTaskChanges(oldTask, task);

  const userId = 'user-456';
  const changedBy = 'user-789';

  // Send immediately without waiting for aggregation window
  await taskNotificationService.aggregateFieldChanges(
    task,
    changes,
    userId,
    changedBy,
    true, // Send immediately
  );

  console.log('Notification sent immediately');
}

// Example: Format field changes for display
export async function exampleFormatFieldChange(
  taskNotificationService: TaskNotificationService,
) {
  const taskTitle = 'Pintura do Caminhão Mercedes';

  const change = {
    field: 'status',
    fieldLabel: 'Status',
    oldValue: 'PENDING',
    newValue: 'IN_PROGRESS',
    formattedOldValue: 'PENDING',
    formattedNewValue: 'IN_PROGRESS',
    changedAt: new Date(),
  };

  const message = taskNotificationService.formatFieldChange(taskTitle, change);

  console.log(message);
  // Output: "Campo Status alterado em Pintura do Caminhão Mercedes: PENDING → IN_PROGRESS"
}

// Example: Get field labels
export async function exampleGetFieldLabel(
  taskNotificationService: TaskNotificationService,
) {
  const labels = {
    name: taskNotificationService.getFieldLabel('name'),
    details: taskNotificationService.getFieldLabel('details'),
    status: taskNotificationService.getFieldLabel('status'),
    priority: taskNotificationService.getFieldLabel('priority'),
    sectorId: taskNotificationService.getFieldLabel('sectorId'),
    term: taskNotificationService.getFieldLabel('term'),
  };

  console.log('Field labels:');
  Object.entries(labels).forEach(([field, label]) => {
    console.log(`- ${field}: ${label}`);
  });

  // Output:
  // Field labels:
  // - name: Título
  // - details: Descrição
  // - status: Status
  // - priority: Prioridade
  // - sectorId: Responsável
  // - term: Prazo
}

// Example: Complete workflow - Task update with notifications
export async function exampleCompleteWorkflow(
  taskNotificationService: TaskNotificationService,
) {
  // Simulate a task update in your service
  const oldTask: Task = {
    id: 'task-123',
    name: 'Pintura do Caminhão',
    status: 'IN_PROGRESS' as any,
    priority: 'NORMAL',
    sectorId: 'sector-1',
    term: new Date('2026-01-10'),
    details: 'Pintura básica',
    artworks: [],
  } as Task;

  // User updates the task
  const newTask: Task = {
    ...oldTask,
    status: 'COMPLETED' as any, // Changed
    details: 'Pintura completa com arte personalizada', // Changed
    artworks: [{ id: 'file-1' }, { id: 'file-2' }] as any, // Changed
  };

  // Step 1: Track changes
  const changes = taskNotificationService.trackTaskChanges(oldTask, newTask);

  console.log(`\n=== Task Update Workflow ===`);
  console.log(`Task: ${newTask.name}`);
  console.log(`Changes detected: ${changes.length}`);
  changes.forEach(change => {
    console.log(`  - ${change.fieldLabel}: ${change.formattedOldValue} → ${change.formattedNewValue}`);
  });

  // Step 2: Notify relevant users
  const usersToNotify = ['user-1', 'user-2', 'user-3'];
  const changedBy = 'user-admin';

  for (const userId of usersToNotify) {
    // Option A: Individual notifications for each field
    // await taskNotificationService.createFieldChangeNotifications(
    //   newTask,
    //   changes,
    //   userId,
    //   changedBy,
    // );

    // Option B: Aggregated notification (recommended for multiple changes)
    await taskNotificationService.aggregateFieldChanges(
      newTask,
      changes,
      userId,
      changedBy,
      true, // Send immediately since task is completed
    );
  }

  console.log(`\nNotifications sent to ${usersToNotify.length} users`);
}

// Example: Integration with task service
export async function exampleTaskServiceIntegration(
  taskNotificationService: TaskNotificationService,
) {
  // This is how you would integrate in your task.service.ts

  /*

  In your task.service.ts:

  import { TaskNotificationService } from '../common/notification/task-notification.service';

  @Injectable()
  export class TaskService {
    constructor(
      // ... other dependencies
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

      // Track and notify changes
      const changes = this.taskNotificationService.trackTaskChanges(oldTask, newTask);

      if (changes.length > 0) {
        // Get all users who should be notified (team members, watchers, etc.)
        const usersToNotify = await this.getTaskWatchers(taskId);

        // Aggregate notifications for each user
        for (const notifyUserId of usersToNotify) {
          await this.taskNotificationService.aggregateFieldChanges(
            newTask,
            changes,
            notifyUserId,
            userId,
            false, // Aggregate over 5 minutes
          );
        }
      }

      return newTask;
    }
  }

  */
}

// Example: User preference setup
export async function exampleUserPreferenceSetup() {
  /*

  Users can configure which field changes they want to be notified about.

  The notification preferences use event types like:
  - task.field.name (Title changes)
  - task.field.details (Description changes)
  - task.field.status (Status changes)
  - task.field.priority (Priority changes)
  - task.field.sectorId (Assignment changes)
  - task.field.term (Due date changes)
  - task.field.tags (Tags changes)
  - task.field.artworks (Attachment changes)
  - task.field.observation (Comment changes)

  Example preference configuration:

  {
    userId: 'user-123',
    type: NOTIFICATION_TYPE.TASK,
    eventType: 'task.field.status',
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    enabled: true,
    isMandatory: false
  }

  Users can enable/disable notifications for each field independently.

  */
}

// Example: Cleanup pending aggregations (e.g., on shutdown)
export async function exampleCleanup(
  taskNotificationService: TaskNotificationService,
) {
  // Call this during application shutdown to send any pending aggregations
  await taskNotificationService.cleanup();
  console.log('All pending notifications sent');
}
