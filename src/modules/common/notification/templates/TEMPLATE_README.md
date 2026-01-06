# Notification Template System

A comprehensive template system for all notification types in the application, providing consistent messaging across multiple channels (In-App, Push, Email, WhatsApp, SMS).

## Overview

The Notification Template Service provides:

- **90+ pre-defined templates** covering all event types
- **Multi-channel support** (In-App, Push, Email, WhatsApp, SMS)
- **Type-safe template rendering** with TypeScript
- **Consistent messaging** across the application
- **Easy customization** and extension
- **i18n ready** structure for future multi-language support

## Table of Contents

1. [Quick Start](#quick-start)
2. [Template Categories](#template-categories)
3. [Usage Examples](#usage-examples)
4. [Template Structure](#template-structure)
5. [Available Templates](#available-templates)
6. [Multi-Channel Templates](#multi-channel-templates)
7. [Customization](#customization)
8. [Best Practices](#best-practices)

## Quick Start

```typescript
import { NotificationTemplateService } from './templates';

// Inject the service
constructor(private readonly templateService: NotificationTemplateService) {}

// Render a notification template
const notification = this.templateService.render('task.created', {
  taskName: 'Design Logo',
  sectorName: 'Design',
  serialNumber: 'TS-2024-001',
});

console.log(notification);
// {
//   title: 'Nova Tarefa Criada',
//   body: 'Tarefa "Design Logo" foi criada e atribuída ao setor Design (TS-2024-001).',
//   importance: 'NORMAL',
//   actionType: 'TASK_CREATED',
//   channels: ['IN_APP', 'PUSH']
// }
```

## Template Categories

### 1. Task Templates (23 templates)

Templates for task-related events:

- `task.created` - Task creation
- `task.status` - Status changes
- `task.deadline` - Deadline approaching (normal)
- `task.deadline.critical` - Deadline approaching (urgent)
- `task.overdue` - Task overdue
- `task.term` - Due date changes
- `task.forecastDate` - Forecast date updates
- `task.sector` - Sector changes
- `task.artwork.added` - Artwork files added
- `task.artwork.updated` - Artwork files updated
- `task.artwork.removed` - Artwork files removed
- `task.budget.added` - Budget added
- `task.budget.updated` - Budget updated
- `task.budget.approved` - Budget approved
- `task.invoice.added` - Invoice added
- `task.invoice.updated` - Invoice updated
- `task.receipt.added` - Receipt added
- `task.negotiatingWith` - Negotiation contact updated
- `task.commission.updated` - Commission status changed
- `task.priority.changed` - Priority changed
- `task.completed` - Task completed
- `task.cancelled` - Task cancelled
- `task.comment.added` - New comment added

### 2. Order Templates (8 templates)

Templates for purchase order events:

- `order.created` - Order created
- `order.status` - Status changes
- `order.overdue` - Order overdue
- `order.received` - Order fully received
- `order.partially_received` - Order partially received
- `order.item.received` - Individual item received
- `order.cancelled` - Order cancelled
- `order.deadline.approaching` - Delivery deadline approaching

### 3. Stock Templates (7 templates)

Templates for inventory management:

- `stock.low` - Low stock level
- `stock.critical` - Critical stock level
- `stock.out` - Out of stock
- `stock.negative` - Negative stock detected
- `stock.reorder` - Reorder point reached
- `stock.overstocked` - Excess stock
- `stock.movement.large` - Significant stock movement

### 4. PPE (EPI) Templates (7 templates)

Templates for personal protective equipment:

- `ppe.request.created` - PPE request created
- `ppe.request.approved` - PPE request approved
- `ppe.request.rejected` - PPE request rejected
- `ppe.delivery.ready` - PPE ready for pickup
- `ppe.delivery.completed` - PPE delivered
- `ppe.expiring.soon` - PPE expiring soon
- `ppe.expired` - PPE expired

### 5. Vacation Templates (6 templates)

Templates for vacation management:

- `vacation.request.created` - Vacation request created
- `vacation.request.approved` - Vacation approved
- `vacation.request.rejected` - Vacation rejected
- `vacation.starting.soon` - Vacation starting soon
- `vacation.started` - Vacation started
- `vacation.ending.soon` - Vacation ending soon

### 6. System Templates (7 templates)

Templates for system-wide notifications:

- `system.maintenance.scheduled` - Scheduled maintenance
- `system.maintenance.starting` - Maintenance starting soon
- `system.maintenance.completed` - Maintenance completed
- `system.warning` - System warning
- `system.error` - System error
- `system.announcement` - General announcement
- `system.update.available` - System update available

### 7. User Templates (5 templates)

Templates for user-related events:

- `user.birthday` - User birthday
- `user.anniversary` - Work anniversary
- `user.profile.updated` - Profile updated
- `user.password.changed` - Password changed
- `user.role.changed` - User role changed

### 8. Report Templates (2 templates)

Templates for report generation:

- `report.generated` - Report successfully generated
- `report.failed` - Report generation failed

## Usage Examples

### Basic Template Rendering

```typescript
// Simple notification
const notification = this.templateService.render('task.created', {
  taskName: 'Design Logo',
  sectorName: 'Design',
  serialNumber: 'TS-2024-001',
});
```

### WhatsApp Template

```typescript
// Render WhatsApp-formatted message
const whatsappMessage = this.templateService.renderWhatsApp('task.overdue', {
  taskName: 'Design Logo',
  daysOverdue: 3,
  serialNumber: 'TS-2024-001',
  url: 'https://app.example.com/tasks/123',
});

// Result:
// 🚨 *Tarefa Atrasada*
//
// Tarefa: Design Logo
// Atrasada há: 3 dia(s)
// Série: TS-2024-001
//
// *AÇÃO URGENTE NECESSÁRIA*
//
// Ver detalhes: https://app.example.com/tasks/123
```

### Email Template

```typescript
// Render email with subject, body, and HTML
const email = this.templateService.renderEmail('task.deadline.critical', {
  taskName: 'Design Logo',
  daysRemaining: 1,
  serialNumber: 'TS-2024-001',
  url: 'https://app.example.com/tasks/123',
});

console.log(email);
// {
//   subject: 'URGENTE: Prazo da Tarefa "Design Logo" se Aproximando',
//   body: '...',
//   html: '<!DOCTYPE html>...'
// }
```

### Complete Notification Creation

```typescript
async createTaskDeadlineNotification(task: Task, userId: string) {
  // Calculate days remaining
  const daysRemaining = this.calculateDaysRemaining(task.term);

  // Determine template based on urgency
  const templateKey = daysRemaining <= 1
    ? 'task.deadline.critical'
    : 'task.deadline';

  // Render notification
  const notification = this.templateService.render(templateKey, {
    taskName: task.name,
    daysRemaining,
    serialNumber: task.serialNumber,
  });

  // Create notification
  await this.notificationService.createNotification({
    userId,
    type: NOTIFICATION_TYPE.TASK,
    importance: notification.importance,
    title: notification.title,
    body: notification.body,
    actionType: notification.actionType,
    actionUrl: `/tasks/${task.id}`,
    channel: notification.channels || [NOTIFICATION_CHANNEL.IN_APP],
  });
}
```

### Checking Template Existence

```typescript
// Check if template exists before using
if (this.templateService.hasTemplate('task.created')) {
  const notification = this.templateService.render('task.created', data);
}

// Get all available templates
const templates = this.templateService.getAvailableTemplates();
console.log(templates); // ['task.created', 'task.status', ...]

// Get template metadata
const metadata = this.templateService.getTemplateMetadata('task.created');
console.log(metadata);
// {
//   importance: 'NORMAL',
//   actionType: 'TASK_CREATED',
//   channels: ['IN_APP', 'PUSH']
// }
```

## Template Structure

Each template consists of:

```typescript
interface NotificationTemplate {
  title: (data: any) => string;           // Title generator function
  body: (data: any) => string;            // Body generator function
  importance: NOTIFICATION_IMPORTANCE;    // LOW, NORMAL, HIGH, URGENT
  actionType: NOTIFICATION_ACTION_TYPE;   // Action button type
  channels?: NOTIFICATION_CHANNEL[];      // Recommended channels
}
```

### Template Data Structure

Each template expects specific data fields:

```typescript
// Task templates
{
  taskName: string;
  sectorName?: string;
  serialNumber?: string;
  changedBy?: string;
  oldStatus?: string;
  newStatus?: string;
  daysRemaining?: number;
  daysOverdue?: number;
  oldValue?: string;
  newValue?: string;
  // ... other task-specific fields
}

// Order templates
{
  orderNumber: string;
  supplierName: string;
  totalValue?: string;
  createdBy?: string;
  changedBy?: string;
  oldStatus?: string;
  newStatus?: string;
  daysOverdue?: number;
  daysRemaining?: number;
  // ... other order-specific fields
}

// Stock templates
{
  itemName: string;
  currentQuantity: number;
  reorderPoint?: number;
  maxQuantity?: number;
  operation?: string;
  quantity?: number;
  userName?: string;
  // ... other stock-specific fields
}
```

## Available Templates

### Task Templates Reference

| Template Key | Title | Importance | Action Type |
|-------------|-------|------------|-------------|
| `task.created` | Nova Tarefa Criada | NORMAL | TASK_CREATED |
| `task.status` | Status da Tarefa Atualizado | HIGH | TASK_UPDATED |
| `task.deadline` | Prazo da Tarefa se Aproximando | URGENT | VIEW_DETAILS |
| `task.deadline.critical` | Prazo da Tarefa - URGENTE | URGENT | VIEW_DETAILS |
| `task.overdue` | Tarefa Atrasada | URGENT | VIEW_DETAILS |
| `task.term` | Prazo da Tarefa Alterado | HIGH | TASK_UPDATED |
| `task.forecastDate` | Data de Previsão Atualizada | NORMAL | TASK_UPDATED |
| `task.sector` | Tarefa Transferida de Setor | HIGH | TASK_UPDATED |
| `task.artwork.added` | Arte Adicionada à Tarefa | NORMAL | VIEW_DETAILS |
| `task.budget.approved` | Orçamento Aprovado | HIGH | VIEW_DETAILS |
| `task.completed` | Tarefa Concluída | NORMAL | VIEW_DETAILS |
| `task.cancelled` | Tarefa Cancelada | HIGH | VIEW_DETAILS |

### Order Templates Reference

| Template Key | Title | Importance | Action Type |
|-------------|-------|------------|-------------|
| `order.created` | Novo Pedido Criado | NORMAL | VIEW_ORDER |
| `order.status` | Status do Pedido Atualizado | NORMAL | VIEW_ORDER |
| `order.overdue` | Pedido Atrasado | URGENT | VIEW_ORDER |
| `order.received` | Pedido Recebido | NORMAL | VIEW_ORDER |
| `order.cancelled` | Pedido Cancelado | HIGH | VIEW_ORDER |

### Stock Templates Reference

| Template Key | Title | Importance | Action Type |
|-------------|-------|------------|-------------|
| `stock.low` | Estoque Baixo | HIGH | VIEW_DETAILS |
| `stock.critical` | Estoque Crítico | URGENT | VIEW_DETAILS |
| `stock.out` | Estoque Esgotado | URGENT | VIEW_DETAILS |
| `stock.negative` | Estoque Negativo Detectado | URGENT | VIEW_DETAILS |

## Multi-Channel Templates

### Channel-Specific Formatting

Templates automatically adapt to different channels:

#### In-App / Push Notifications
- Concise titles (under 50 characters)
- Brief bodies (under 200 characters)
- Include essential information only

#### Email Notifications
- Full HTML formatting
- Detailed information
- Call-to-action buttons
- Professional styling

#### WhatsApp Messages
- Emoji indicators for quick scanning
- Structured formatting with line breaks
- Direct links to resources

### Channel Selection Logic

```typescript
// Templates define recommended channels
const template = TEMPLATES['task.deadline.critical'];
console.log(template.channels);
// ['IN_APP', 'PUSH', 'EMAIL']

// For urgent notifications, use all channels
const urgentChannels = [
  NOTIFICATION_CHANNEL.IN_APP,
  NOTIFICATION_CHANNEL.PUSH,
  NOTIFICATION_CHANNEL.EMAIL,
  NOTIFICATION_CHANNEL.SMS,
];

// For normal notifications, use selective channels
const normalChannels = [
  NOTIFICATION_CHANNEL.IN_APP,
  NOTIFICATION_CHANNEL.PUSH,
];
```

## Customization

### Adding New Templates

To add a new template:

```typescript
// 1. Add to TEMPLATES object
TEMPLATES['custom.event'] = {
  title: (data) => `Custom Event Title`,
  body: (data) => `Custom event description with ${data.field}`,
  importance: NOTIFICATION_IMPORTANCE.NORMAL,
  actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
  channels: [NOTIFICATION_CHANNEL.IN_APP],
};

// 2. Add WhatsApp template (optional)
WHATSAPP_TEMPLATES['custom.event'] = (data) => `
🔔 *Custom Event*

Details: ${data.field}

Ver detalhes: ${data.url}
`.trim();

// 3. Add Email template (optional)
EMAIL_TEMPLATES['custom.event'] = {
  subject: (data) => `Custom Event - ${data.field}`,
  body: (data) => `Email body content...`,
  html: (data) => `<html>...</html>`,
};
```

### Modifying Existing Templates

```typescript
// Override a template
TEMPLATES['task.created'] = {
  title: (data) => `🆕 Nova Tarefa: ${data.taskName}`,
  body: (data) => `Descrição customizada...`,
  importance: NOTIFICATION_IMPORTANCE.HIGH,
  actionType: NOTIFICATION_ACTION_TYPE.TASK_CREATED,
};
```

### Template Inheritance

Create base templates and extend them:

```typescript
// Base template
const baseTaskTemplate = {
  importance: NOTIFICATION_IMPORTANCE.NORMAL,
  actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
  channels: [NOTIFICATION_CHANNEL.IN_APP],
};

// Extended template
TEMPLATES['task.custom'] = {
  ...baseTaskTemplate,
  title: (data) => `Custom Task Event`,
  body: (data) => `Custom body...`,
};
```

## Best Practices

### 1. Data Validation

Always validate data before rendering:

```typescript
function renderTaskNotification(task: Task) {
  if (!task.name) {
    throw new Error('Task name is required');
  }

  return this.templateService.render('task.created', {
    taskName: task.name,
    sectorName: task.sector?.name || 'N/A',
    serialNumber: task.serialNumber || undefined,
  });
}
```

### 2. Fallback Values

Provide fallback values for optional fields:

```typescript
const notification = this.templateService.render('task.created', {
  taskName: task.name,
  sectorName: task.sector?.name || 'Sem setor',
  serialNumber: task.serialNumber || null, // Will be omitted if null
  changedBy: user?.name || 'Sistema',
});
```

### 3. URL Generation

Include full URLs for better user experience:

```typescript
const baseUrl = process.env.APP_URL;

const notification = this.templateService.render('task.created', {
  taskName: task.name,
  sectorName: task.sector?.name,
  url: `${baseUrl}/tasks/${task.id}`,
});
```

### 4. Error Handling

Always handle missing templates gracefully:

```typescript
try {
  const notification = this.templateService.render(templateKey, data);
  return notification;
} catch (error) {
  this.logger.error(`Template error: ${error.message}`);

  // Fallback to generic notification
  return {
    title: 'Notificação',
    body: 'Você tem uma nova notificação.',
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
  };
}
```

### 5. Template Testing

Test templates with various data scenarios:

```typescript
describe('NotificationTemplateService', () => {
  it('should render task.created template', () => {
    const result = service.render('task.created', {
      taskName: 'Test Task',
      sectorName: 'Test Sector',
      serialNumber: 'TS-001',
    });

    expect(result.title).toBe('Nova Tarefa Criada');
    expect(result.body).toContain('Test Task');
    expect(result.importance).toBe(NOTIFICATION_IMPORTANCE.NORMAL);
  });

  it('should handle missing optional fields', () => {
    const result = service.render('task.created', {
      taskName: 'Test Task',
      sectorName: 'Test Sector',
      // serialNumber omitted
    });

    expect(result.body).not.toContain('undefined');
  });
});
```

### 6. i18n Preparation

Structure templates for future internationalization:

```typescript
// Future i18n structure
interface TemplatesByLanguage {
  'pt-BR': Record<string, NotificationTemplate>;
  'en-US': Record<string, NotificationTemplate>;
  'es-ES': Record<string, NotificationTemplate>;
}

// Extended service method
render(templateKey: string, data: any, language: string = 'pt-BR') {
  const templates = TEMPLATES_BY_LANGUAGE[language] || TEMPLATES_BY_LANGUAGE['pt-BR'];
  const template = templates[templateKey];
  // ...
}
```

## Integration Example

Complete integration with notification service:

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationService } from '../notification.service';
import { NotificationTemplateService } from '../templates';
import { NOTIFICATION_TYPE } from '@constants';

@Injectable()
export class TaskNotificationService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  async notifyTaskCreated(task: Task, userId: string) {
    // Render template
    const notification = this.templateService.render('task.created', {
      taskName: task.name,
      sectorName: task.sector?.name,
      serialNumber: task.serialNumber,
    });

    // Create notification
    await this.notificationService.createNotification({
      userId,
      type: NOTIFICATION_TYPE.TASK,
      importance: notification.importance,
      title: notification.title,
      body: notification.body,
      actionType: notification.actionType,
      actionUrl: `/tasks/${task.id}`,
      channel: notification.channels,
    });
  }

  async notifyTaskOverdue(task: Task, userId: string) {
    const daysOverdue = this.calculateDaysOverdue(task.term);

    // Render notification
    const notification = this.templateService.render('task.overdue', {
      taskName: task.name,
      daysOverdue,
      serialNumber: task.serialNumber,
    });

    // Render email
    const email = this.templateService.renderEmail('task.overdue', {
      taskName: task.name,
      daysOverdue,
      serialNumber: task.serialNumber,
      url: `${process.env.APP_URL}/tasks/${task.id}`,
    });

    // Create notification
    await this.notificationService.createNotification({
      userId,
      type: NOTIFICATION_TYPE.TASK,
      importance: notification.importance,
      title: notification.title,
      body: notification.body,
      actionType: notification.actionType,
      actionUrl: `/tasks/${task.id}`,
      channel: notification.channels,
    });

    // Send email separately
    await this.emailService.send({
      to: user.email,
      subject: email.subject,
      body: email.body,
      html: email.html,
    });
  }
}
```

## Summary

The Notification Template System provides:

- **90+ templates** for all event types
- **Multi-channel support** (In-App, Push, Email, WhatsApp)
- **Type-safe** TypeScript implementation
- **Consistent messaging** across the application
- **Easy to extend** and customize
- **Production-ready** with best practices

For questions or issues, refer to the main notification documentation or contact the development team.
