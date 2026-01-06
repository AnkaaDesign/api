# Notification Template Quick Reference

Quick reference guide for using notification templates.

## Quick Start

```typescript
import { NotificationTemplateService } from './templates';

// Render a template
const notification = templateService.render('task.created', {
  taskName: 'Design Logo',
  sectorName: 'Design',
});
```

## All Available Templates

### Task Templates (23)

| Key | Title | Importance |
|-----|-------|-----------|
| `task.created` | Nova Tarefa Criada | NORMAL |
| `task.status` | Status da Tarefa Atualizado | HIGH |
| `task.deadline` | Prazo da Tarefa se Aproximando | URGENT |
| `task.deadline.critical` | Prazo da Tarefa - URGENTE | URGENT |
| `task.overdue` | Tarefa Atrasada | URGENT |
| `task.term` | Prazo da Tarefa Alterado | HIGH |
| `task.forecastDate` | Data de Previsão Atualizada | NORMAL |
| `task.sector` | Tarefa Transferida de Setor | HIGH |
| `task.artwork.added` | Arte Adicionada à Tarefa | NORMAL |
| `task.artwork.updated` | Arte da Tarefa Atualizada | NORMAL |
| `task.artwork.removed` | Arte Removida da Tarefa | NORMAL |
| `task.budget.added` | Orçamento Adicionado | NORMAL |
| `task.budget.updated` | Orçamento Atualizado | HIGH |
| `task.budget.approved` | Orçamento Aprovado | HIGH |
| `task.invoice.added` | Nota Fiscal Adicionada | NORMAL |
| `task.invoice.updated` | Nota Fiscal Atualizada | NORMAL |
| `task.receipt.added` | Recibo Adicionado | NORMAL |
| `task.negotiatingWith` | Contato de Negociação Atualizado | NORMAL |
| `task.commission.updated` | Status da Comissão Atualizado | NORMAL |
| `task.priority.changed` | Prioridade da Tarefa Alterada | HIGH |
| `task.completed` | Tarefa Concluída | NORMAL |
| `task.cancelled` | Tarefa Cancelada | HIGH |
| `task.comment.added` | Novo Comentário na Tarefa | NORMAL |

### Order Templates (8)

| Key | Title | Importance |
|-----|-------|-----------|
| `order.created` | Novo Pedido Criado | NORMAL |
| `order.status` | Status do Pedido Atualizado | NORMAL |
| `order.overdue` | Pedido Atrasado | URGENT |
| `order.received` | Pedido Recebido | NORMAL |
| `order.partially_received` | Pedido Parcialmente Recebido | NORMAL |
| `order.item.received` | Item do Pedido Recebido | NORMAL |
| `order.cancelled` | Pedido Cancelado | HIGH |
| `order.deadline.approaching` | Prazo de Entrega se Aproximando | HIGH |

### Stock Templates (7)

| Key | Title | Importance |
|-----|-------|-----------|
| `stock.low` | Estoque Baixo | HIGH |
| `stock.critical` | Estoque Crítico | URGENT |
| `stock.out` | Estoque Esgotado | URGENT |
| `stock.negative` | Estoque Negativo Detectado | URGENT |
| `stock.reorder` | Ponto de Reabastecimento Atingido | NORMAL |
| `stock.overstocked` | Excesso de Estoque | NORMAL |
| `stock.movement.large` | Movimentação Significativa de Estoque | NORMAL |

### PPE Templates (7)

| Key | Title | Importance |
|-----|-------|-----------|
| `ppe.request.created` | Nova Solicitação de EPI | NORMAL |
| `ppe.request.approved` | Solicitação de EPI Aprovada | NORMAL |
| `ppe.request.rejected` | Solicitação de EPI Rejeitada | HIGH |
| `ppe.delivery.ready` | EPI Pronto para Retirada | NORMAL |
| `ppe.delivery.completed` | EPI Entregue | NORMAL |
| `ppe.expiring.soon` | EPI Próximo ao Vencimento | HIGH |
| `ppe.expired` | EPI Vencido | URGENT |

### Vacation Templates (6)

| Key | Title | Importance |
|-----|-------|-----------|
| `vacation.request.created` | Nova Solicitação de Férias | NORMAL |
| `vacation.request.approved` | Férias Aprovadas | HIGH |
| `vacation.request.rejected` | Férias Rejeitadas | HIGH |
| `vacation.starting.soon` | Férias se Aproximando | NORMAL |
| `vacation.started` | Férias Iniciadas | NORMAL |
| `vacation.ending.soon` | Férias Terminando | NORMAL |

### System Templates (7)

| Key | Title | Importance |
|-----|-------|-----------|
| `system.maintenance.scheduled` | Manutenção Programada | HIGH |
| `system.maintenance.starting` | Manutenção Iniciando | URGENT |
| `system.maintenance.completed` | Manutenção Concluída | NORMAL |
| `system.warning` | Aviso do Sistema | HIGH |
| `system.error` | Erro do Sistema | URGENT |
| `system.announcement` | (Dynamic) | NORMAL |
| `system.update.available` | Atualização Disponível | NORMAL |

### User Templates (5)

| Key | Title | Importance |
|-----|-------|-----------|
| `user.birthday` | Feliz Aniversário! | NORMAL |
| `user.anniversary` | Aniversário de Empresa | NORMAL |
| `user.profile.updated` | Perfil Atualizado | NORMAL |
| `user.password.changed` | Senha Alterada | HIGH |
| `user.role.changed` | Função Alterada | HIGH |

### Report Templates (2)

| Key | Title | Importance |
|-----|-------|-----------|
| `report.generated` | Relatório Gerado | NORMAL |
| `report.failed` | Falha ao Gerar Relatório | HIGH |

## Common Data Fields

### Task Data
```typescript
{
  taskName: string;
  sectorName?: string;
  serialNumber?: string;
  changedBy?: string;
  oldStatus?: string;
  newStatus?: string;
  daysRemaining?: number;
  daysOverdue?: number;
}
```

### Order Data
```typescript
{
  orderNumber: string;
  supplierName: string;
  totalValue?: string;
  createdBy?: string;
  daysOverdue?: number;
}
```

### Stock Data
```typescript
{
  itemName: string;
  currentQuantity: number;
  reorderPoint?: number;
  maxQuantity?: number;
}
```

### PPE Data
```typescript
{
  userName: string;
  itemName?: string;
  itemCount?: number;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  daysRemaining?: number;
}
```

## Service Methods

```typescript
// Render notification template
render(templateKey: string, data: any): RenderedNotification

// Render WhatsApp template
renderWhatsApp(templateKey: string, data: any): string

// Render email template
renderEmail(templateKey: string, data: any): { subject, body, html? }

// Check if template exists
hasTemplate(templateKey: string): boolean

// Get all template keys
getAvailableTemplates(): string[]

// Get template metadata
getTemplateMetadata(templateKey: string): { importance, actionType, channels? }
```

## Usage Patterns

### Pattern 1: Simple Notification

```typescript
const notification = templateService.render('task.created', data);

await notificationService.createNotification({
  userId,
  type: NOTIFICATION_TYPE.TASK,
  ...notification,
  actionUrl: `/tasks/${taskId}`,
});
```

### Pattern 2: Multi-Channel

```typescript
const notification = templateService.render('task.overdue', data);
const whatsapp = templateService.renderWhatsApp('task.overdue', { ...data, url });
const email = templateService.renderEmail('task.overdue', { ...data, url });

// Send via all channels
await notificationService.createNotification({ ...notification });
await whatsappService.send({ to, message: whatsapp });
await emailService.send({ to, ...email });
```

### Pattern 3: Conditional Template

```typescript
const templateKey = daysRemaining <= 1
  ? 'task.deadline.critical'
  : 'task.deadline';

const notification = templateService.render(templateKey, data);
```

### Pattern 4: With Fallback

```typescript
try {
  const notification = templateService.render(templateKey, data);
  return notification;
} catch (error) {
  return {
    title: 'Notificação',
    body: 'Nova notificação disponível',
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
  };
}
```

## Importance Levels

- **LOW** - Informational, no action required
- **NORMAL** - Standard notifications
- **HIGH** - Important, requires attention
- **URGENT** - Critical, immediate action required

## Action Types

- `VIEW_DETAILS` - View item details
- `VIEW_ORDER` - View order details
- `VIEW_REPORT` - View report
- `APPROVE_REQUEST` - Approve a request
- `REJECT_REQUEST` - Reject a request
- `COMPLETE_TASK` - Complete a task
- `TASK_CREATED` - New task notification
- `TASK_UPDATED` - Task updated notification
- `ACKNOWLEDGE` - Acknowledge notification
- `DISMISS` - Dismiss notification

## Channels

- `IN_APP` - In-application notification
- `PUSH` - Push notification
- `EMAIL` - Email notification
- `SMS` - SMS notification

## Template Naming Convention

Templates follow the pattern: `{entity}.{event}[.{modifier}]`

Examples:
- `task.created` - Entity: task, Event: created
- `task.deadline.critical` - Entity: task, Event: deadline, Modifier: critical
- `stock.out` - Entity: stock, Event: out
- `ppe.request.approved` - Entity: ppe, Event: request, Modifier: approved

## Best Practices

1. **Always provide required fields**
   ```typescript
   // Bad
   render('task.created', {})

   // Good
   render('task.created', { taskName: 'Design', sectorName: 'Design' })
   ```

2. **Use optional chaining for optional fields**
   ```typescript
   {
     taskName: task.name,
     serialNumber: task.serialNumber || undefined,
     changedBy: user?.name,
   }
   ```

3. **Include URLs for external channels**
   ```typescript
   renderWhatsApp('task.created', {
     ...data,
     url: `${APP_URL}/tasks/${id}`,
   })
   ```

4. **Check template existence**
   ```typescript
   if (templateService.hasTemplate(key)) {
     return templateService.render(key, data);
   }
   ```

5. **Use metadata for channel selection**
   ```typescript
   const metadata = templateService.getTemplateMetadata('task.overdue');
   const channels = metadata.channels || [NOTIFICATION_CHANNEL.IN_APP];
   ```
