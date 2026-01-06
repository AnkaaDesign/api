# Email Template Usage Examples

This document provides practical examples of using the Email Template Service with the Notification System.

## Integration with Notification Service

### Example 1: Task Status Change Notification

```typescript
import { Injectable } from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationEmailService {
  private transporter: nodemailer.Transporter;

  constructor(private emailTemplateService: EmailTemplateService) {
    // Configure nodemailer
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  async sendTaskStatusChangeEmail(taskData: {
    userId: string;
    userEmail: string;
    userName: string;
    taskId: string;
    taskName: string;
    taskCode: string;
    oldStatus: string;
    newStatus: string;
    sectorName: string;
    deadline: string;
    changedBy: string;
  }): Promise<void> {
    const { html, text } = this.emailTemplateService.renderMultipart(
      'task/status-change.html',
      {
        userName: taskData.userName,
        taskName: taskData.taskName,
        taskCode: taskData.taskCode,
        oldStatus: taskData.oldStatus,
        newStatus: taskData.newStatus,
        sectorName: taskData.sectorName,
        deadline: taskData.deadline,
        changedBy: taskData.changedBy,
        actionUrl: `${process.env.APP_URL}/tasks/${taskData.taskId}`,
        actionText: 'Ver Tarefa',
        subject: `Status da Tarefa Alterado: ${taskData.taskName}`,
      }
    );

    await this.transporter.sendMail({
      from: `"${process.env.COMPANY_NAME}" <${process.env.COMPANY_EMAIL}>`,
      to: taskData.userEmail,
      subject: `Status da Tarefa Alterado: ${taskData.taskName}`,
      html: html,
      text: text,
    });
  }
}
```

### Example 2: Task Assignment with Queue Integration

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EmailTemplateService } from './email-template.service';

@Injectable()
export class NotificationQueueService {
  constructor(
    @InjectQueue('notifications') private notificationQueue: Queue,
    private emailTemplateService: EmailTemplateService,
  ) {}

  async queueTaskAssignmentEmail(data: {
    userEmail: string;
    userName: string;
    taskName: string;
    taskCode: string;
    taskStatus: string;
    sectorName: string;
    priority: string;
    deadline: string;
    estimatedHours: number;
    description: string;
    assignedBy: string;
    taskId: string;
  }): Promise<void> {
    // Render the email template
    const { html, text } = this.emailTemplateService.renderMultipart(
      'task/assignment.html',
      {
        userName: data.userName,
        taskName: data.taskName,
        taskCode: data.taskCode,
        taskStatus: data.taskStatus,
        sectorName: data.sectorName,
        priority: data.priority,
        deadline: data.deadline,
        estimatedHours: data.estimatedHours,
        description: data.description,
        assignedBy: data.assignedBy,
        actionUrl: `${process.env.APP_URL}/tasks/${data.taskId}`,
        actionText: 'Visualizar Tarefa',
        subject: `Nova Tarefa Atribuída: ${data.taskName}`,
      }
    );

    // Add to queue
    await this.notificationQueue.add('send-email', {
      to: data.userEmail,
      subject: `Nova Tarefa Atribuída: ${data.taskName}`,
      html: html,
      text: text,
    });
  }
}
```

### Example 3: Low Stock Alert

```typescript
async sendLowStockAlert(stockData: {
  recipients: string[];
  itemName: string;
  itemCode: string;
  category: string;
  currentQuantity: number;
  reorderPoint: number;
  minimumStock: number;
  location: string;
  consumptionRate: string;
  estimatedDaysRemaining: number;
  suggestedOrderQuantity: number;
  preferredSuppliers: Array<{
    name: string;
    leadTime: string;
    lastPrice: string;
  }>;
}): Promise<void> {
  const { html, text } = this.emailTemplateService.renderMultipart(
    'stock/low-stock.html',
    {
      itemName: stockData.itemName,
      itemCode: stockData.itemCode,
      category: stockData.category,
      currentQuantity: stockData.currentQuantity,
      reorderPoint: stockData.reorderPoint,
      minimumStock: stockData.minimumStock,
      location: stockData.location,
      consumptionRate: stockData.consumptionRate,
      estimatedDaysRemaining: stockData.estimatedDaysRemaining,
      suggestedOrderQuantity: stockData.suggestedOrderQuantity,
      preferredSuppliers: stockData.preferredSuppliers,
      actionUrl: `${process.env.APP_URL}/stock/items/${stockData.itemCode}`,
      actionText: 'Ver Item',
      subject: `Alerta de Estoque Baixo: ${stockData.itemName}`,
    }
  );

  // Send to multiple recipients
  for (const email of stockData.recipients) {
    await this.transporter.sendMail({
      from: `"${process.env.COMPANY_NAME}" <${process.env.COMPANY_EMAIL}>`,
      to: email,
      subject: `Alerta de Estoque Baixo: ${stockData.itemName}`,
      html: html,
      text: text,
      priority: 'high',
    });
  }
}
```

### Example 4: Order Overdue with Attachments

```typescript
async sendOrderOverdueAlert(orderData: {
  userEmail: string;
  userName: string;
  orderNumber: string;
  supplierName: string;
  status: string;
  expectedDelivery: string;
  daysOverdue: number;
  contactInfo: {
    phone: string;
    email: string;
    contactPerson: string;
  };
  items: Array<{
    name: string;
    quantity: number;
    critical: boolean;
  }>;
  pdfReport?: Buffer;
}): Promise<void> {
  const { html, text } = this.emailTemplateService.renderMultipart(
    'order/overdue.html',
    {
      userName: orderData.userName,
      orderNumber: orderData.orderNumber,
      supplierName: orderData.supplierName,
      status: orderData.status,
      expectedDelivery: orderData.expectedDelivery,
      daysOverdue: orderData.daysOverdue,
      contactInfo: orderData.contactInfo,
      items: orderData.items,
      actionUrl: `${process.env.APP_URL}/orders/${orderData.orderNumber}`,
      actionText: 'Ver Pedido',
      subject: `Pedido Atrasado: ${orderData.orderNumber}`,
    }
  );

  const mailOptions: any = {
    from: `"${process.env.COMPANY_NAME}" <${process.env.COMPANY_EMAIL}>`,
    to: orderData.userEmail,
    subject: `Pedido Atrasado: ${orderData.orderNumber}`,
    html: html,
    text: text,
    priority: 'high',
  };

  // Add PDF attachment if provided
  if (orderData.pdfReport) {
    mailOptions.attachments = [
      {
        filename: `pedido-${orderData.orderNumber}.pdf`,
        content: orderData.pdfReport,
        contentType: 'application/pdf',
      },
    ];
  }

  await this.transporter.sendMail(mailOptions);
}
```

### Example 5: System Warning to Administrators

```typescript
async sendSystemWarning(warningData: {
  adminEmails: string[];
  warningTitle: string;
  message: string;
  severity: 'high' | 'medium' | 'low';
  details: Array<{ label: string; value: string }>;
  impact: string;
  recommendations: string[];
  requiredActions: string[];
  deadline?: string;
}): Promise<void> {
  const { html, text } = this.emailTemplateService.renderMultipart(
    'system/warning.html',
    {
      warningTitle: warningData.warningTitle,
      message: warningData.message,
      severity: warningData.severity,
      details: warningData.details,
      impact: warningData.impact,
      recommendations: warningData.recommendations,
      requiredActions: warningData.requiredActions,
      deadline: warningData.deadline,
      contactInfo: {
        department: 'TI',
        person: 'Suporte Técnico',
        email: process.env.SUPPORT_EMAIL,
        phone: process.env.SUPPORT_PHONE,
      },
      subject: `Alerta do Sistema: ${warningData.warningTitle}`,
    }
  );

  await this.transporter.sendMail({
    from: `"Sistema ${process.env.COMPANY_NAME}" <${process.env.COMPANY_EMAIL}>`,
    to: warningData.adminEmails.join(','),
    subject: `Alerta do Sistema: ${warningData.warningTitle}`,
    html: html,
    text: text,
    priority: warningData.severity === 'high' ? 'high' : 'normal',
  });
}
```

### Example 6: Batch Deadline Reminders

```typescript
async sendBatchDeadlineReminders(tasks: Array<{
  userId: string;
  userEmail: string;
  userName: string;
  taskId: string;
  taskName: string;
  taskCode: string;
  taskStatus: string;
  deadline: string;
  daysRemaining: string;
  sectorName: string;
  completionPercentage: number;
}>): Promise<void> {
  const emailPromises = tasks.map(task => {
    const { html, text } = this.emailTemplateService.renderMultipart(
      'task/deadline-approaching.html',
      {
        userName: task.userName,
        taskName: task.taskName,
        taskCode: task.taskCode,
        taskStatus: task.taskStatus,
        deadline: task.deadline,
        daysRemaining: task.daysRemaining,
        sectorName: task.sectorName,
        completionPercentage: task.completionPercentage,
        actionUrl: `${process.env.APP_URL}/tasks/${task.taskId}`,
        actionText: 'Visualizar Tarefa',
        subject: `Lembrete: Prazo Próximo - ${task.taskName}`,
      }
    );

    return this.transporter.sendMail({
      from: `"${process.env.COMPANY_NAME}" <${process.env.COMPANY_EMAIL}>`,
      to: task.userEmail,
      subject: `Lembrete: Prazo Próximo - ${task.taskName}`,
      html: html,
      text: text,
    });
  });

  await Promise.all(emailPromises);
}
```

### Example 7: Custom Template with Dynamic Content

```typescript
async sendCustomNotification(data: {
  userEmail: string;
  userName: string;
  title: string;
  message: string;
  details: Array<{ label: string; value: string }>;
  actionUrl?: string;
  actionText?: string;
}): Promise<void> {
  const { html, text } = this.emailTemplateService.renderMultipart(
    'system/generic.html',
    {
      userName: data.userName,
      title: data.title,
      message: data.message,
      details: data.details,
      actionUrl: data.actionUrl,
      actionText: data.actionText || 'Ver Mais',
      subject: data.title,
    }
  );

  await this.transporter.sendMail({
    from: `"${process.env.COMPANY_NAME}" <${process.env.COMPANY_EMAIL}>`,
    to: data.userEmail,
    subject: data.title,
    html: html,
    text: text,
  });
}
```

### Example 8: Integration with Event Emitters

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailTemplateService } from './email-template.service';

@Injectable()
export class NotificationEventListener {
  constructor(
    private emailTemplateService: EmailTemplateService,
    private notificationEmailService: NotificationEmailService,
  ) {}

  @OnEvent('task.assigned')
  async handleTaskAssigned(event: {
    userId: string;
    userEmail: string;
    userName: string;
    taskData: any;
  }): Promise<void> {
    await this.notificationEmailService.sendTaskAssignmentEmail({
      userEmail: event.userEmail,
      userName: event.userName,
      ...event.taskData,
    });
  }

  @OnEvent('stock.low')
  async handleLowStock(event: {
    recipients: string[];
    stockData: any;
  }): Promise<void> {
    await this.notificationEmailService.sendLowStockAlert({
      recipients: event.recipients,
      ...event.stockData,
    });
  }

  @OnEvent('order.overdue')
  async handleOrderOverdue(event: {
    userEmail: string;
    userName: string;
    orderData: any;
  }): Promise<void> {
    await this.notificationEmailService.sendOrderOverdueAlert({
      userEmail: event.userEmail,
      userName: event.userName,
      ...event.orderData,
    });
  }
}
```

## Environment Configuration

Create a `.env` file with the following configuration:

```env
# App Configuration
NODE_ENV=production
APP_URL=https://app.example.com

# Company Information
COMPANY_NAME="Minha Empresa"
COMPANY_ADDRESS="Rua Example, 123 - São Paulo, SP - CEP 01234-567"
COMPANY_PHONE="+55 11 1234-5678"
COMPANY_EMAIL="contato@empresa.com"
COMPANY_LOGO_URL="https://cdn.example.com/logo.png"

# Support Contact
SUPPORT_EMAIL="suporte@empresa.com"
SUPPORT_PHONE="+55 11 8765-4321"

# Links
HELP_URL="https://help.example.com"
PRIVACY_URL="https://example.com/privacy"
TERMS_URL="https://example.com/terms"

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

## Testing Templates

### Unit Test Example

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { EmailTemplateService } from './email-template.service';

describe('EmailTemplateService', () => {
  let service: EmailTemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailTemplateService],
    }).compile();

    service = module.get<EmailTemplateService>(EmailTemplateService);
  });

  it('should render task status change template', () => {
    const html = service.render('task/status-change.html', {
      userName: 'Test User',
      taskName: 'Test Task',
      oldStatus: 'Pending',
      newStatus: 'Completed',
    });

    expect(html).toContain('Test User');
    expect(html).toContain('Test Task');
    expect(html).toContain('Pending');
    expect(html).toContain('Completed');
  });

  it('should render multipart email', () => {
    const { html, text } = service.renderMultipart('task/assignment.html', {
      userName: 'Test User',
      taskName: 'New Task',
      taskStatus: 'Pending',
    });

    expect(html).toBeDefined();
    expect(text).toBeDefined();
    expect(text).not.toContain('<');
    expect(text).not.toContain('>');
  });
});
```

### Preview Template in Browser

```typescript
import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { EmailTemplateService } from './email-template.service';

@Controller('preview')
export class TemplatePreviewController {
  constructor(private emailTemplateService: EmailTemplateService) {}

  @Get('email')
  previewEmail(
    @Query('template') template: string,
    @Res() res: Response,
  ): void {
    // Sample data for preview
    const sampleData = this.getSampleData(template);

    const html = this.emailTemplateService.render(template, sampleData);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  private getSampleData(template: string): any {
    // Return sample data based on template type
    if (template.startsWith('task/')) {
      return {
        userName: 'João Silva',
        taskName: 'Implementar Nova Funcionalidade',
        taskCode: 'TASK-123',
        taskStatus: 'Em Progresso',
        oldStatus: 'Pendente',
        newStatus: 'Em Progresso',
        sectorName: 'Desenvolvimento',
        deadline: '25/01/2026',
        actionUrl: 'https://app.example.com/tasks/123',
      };
    }
    // Add more template types...
    return {};
  }
}
```

## Performance Optimization

### Cache Warmup on Application Start

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';

@Injectable()
export class TemplateWarmupService implements OnModuleInit {
  constructor(private emailTemplateService: EmailTemplateService) {}

  onModuleInit(): void {
    // Warmup frequently used templates
    const frequentTemplates = [
      'task/status-change.html',
      'task/assignment.html',
      'task/deadline-approaching.html',
      'order/created.html',
      'order/status-change.html',
      'stock/low-stock.html',
    ];

    this.emailTemplateService.warmupCache(frequentTemplates);
  }
}
```

## Troubleshooting

### Common Issues and Solutions

1. **Templates not found in production**
   - Ensure templates are copied during build
   - Check `copy-assets` script in package.json
   - Verify template path resolution

2. **Emails look broken in Outlook**
   - Use table-based layouts
   - Avoid flexbox and grid
   - Use inline styles
   - Test with Litmus or Email on Acid

3. **Images not displaying**
   - Use absolute URLs for images
   - Host images on CDN
   - Include alt text
   - Set explicit width/height

4. **Slow rendering**
   - Enable template caching
   - Warmup cache on startup
   - Minimize template complexity
   - Use queue for batch emails

For more information, refer to the main README.md file.
