# Email Templates - Quick Reference Card

## Template Paths

### Task Notifications
```typescript
'task/status-change.html'         // Task status changed
'task/assignment.html'            // Task assigned to user
'task/deadline-approaching.html'  // Deadline reminder
'task/field-update.html'          // Task field updated
```

### Order Notifications
```typescript
'order/created.html'              // Order created
'order/status-change.html'        // Order status changed
'order/overdue.html'              // Order overdue alert
```

### Stock Notifications
```typescript
'stock/low-stock.html'            // Low stock warning
'stock/out-of-stock.html'         // Out of stock alert
'stock/reorder.html'              // Reorder suggestion
```

### System Notifications
```typescript
'system/generic.html'             // Generic notification
'system/warning.html'             // System warning
```

## Common Code Snippets

### Basic Rendering
```typescript
const html = this.emailTemplateService.render(
  'task/status-change.html',
  { userName: 'John', taskName: 'Task 1' }
);
```

### Multipart Email
```typescript
const { html, text } = this.emailTemplateService.renderMultipart(
  'task/assignment.html',
  { userName: 'Jane', taskName: 'Task 2' }
);
```

### Send Email (with nodemailer)
```typescript
await this.mailer.sendMail({
  to: 'user@example.com',
  subject: 'Task Assigned',
  html: html,
  text: text,
});
```

## Essential Variables

### All Templates
```typescript
{
  userName: string;        // Required for personalization
  actionUrl: string;       // Optional CTA button URL
  actionText: string;      // Optional CTA button text
  subject: string;         // Email subject
}
```

### Task Templates
```typescript
{
  taskName: string;        // Required
  taskCode?: string;
  taskStatus?: string;
  sectorName?: string;
  deadline?: string;
  assignedTo?: string;
}
```

### Order Templates
```typescript
{
  orderNumber: string;     // Required
  supplierName?: string;
  status: string;
  items?: Array<{
    name: string;
    quantity: number;
  }>;
}
```

### Stock Templates
```typescript
{
  itemName: string;        // Required
  itemCode?: string;
  currentQuantity: number;
  reorderPoint?: number;
  preferredSuppliers?: Array<{
    name: string;
    leadTime: string;
    lastPrice: string;
  }>;
}
```

## Handlebars Helpers Cheatsheet

### Conditionals
```handlebars
{{#if condition}}...{{/if}}
{{#unless condition}}...{{/unless}}
{{#if (eq value1 value2)}}...{{/if}}
{{#if (and condition1 condition2)}}...{{/if}}
```

### Loops
```handlebars
{{#each items}}
  {{this.name}} - {{this.value}}
{{/each}}
```

### Formatting
```handlebars
{{formatDate date 'short'}}           // 01/01/2026
{{currency 1500 'BRL'}}               // R$ 1.500,00
{{uppercase "hello"}}                 // HELLO
{{truncate text 100}}                 // First 100 chars...
{{default value 'fallback'}}          // Use fallback if value is null
```

## Environment Variables
```env
COMPANY_NAME="Your Company"
COMPANY_EMAIL="contact@example.com"
COMPANY_PHONE="+55 11 1234-5678"
COMPANY_LOGO_URL="https://cdn.example.com/logo.png"
APP_URL="https://app.example.com"
```

## Service Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `render(template, data, options?)` | Render HTML | `string` |
| `renderMultipart(template, data, options?)` | Render HTML + text | `{html, text}` |
| `renderString(template, data)` | Render from string | `string` |
| `clearCache()` | Clear template cache | `void` |
| `warmupCache(templates[])` | Preload templates | `void` |
| `templateExists(name)` | Check if exists | `boolean` |
| `getAvailableTemplates(category?)` | List templates | `string[]` |

## Styled Components

### Info Box
```handlebars
<div class="info-box">
  <div class="info-box-title">Title</div>
  <div class="info-box-content">
    Content here
  </div>
</div>
```

### Warning Box
```handlebars
<div class="warning-box">
  <p><strong>Warning!</strong> Message here.</p>
</div>
```

### Alert Box (Critical)
```handlebars
<div class="alert-box">
  <p><strong>Critical!</strong> Message here.</p>
</div>
```

### Success Box
```handlebars
<div class="success-box">
  <p><strong>Success!</strong> Message here.</p>
</div>
```

### Buttons
```handlebars
<a href="{{url}}" class="btn btn-primary">Click Here</a>
<!-- btn-secondary, btn-success, btn-warning, btn-danger -->
```

### Data Table
```handlebars
<table style="width: 100%; border-collapse: collapse;">
  <thead>
    <tr style="background-color: #f8f9fa;">
      <th style="padding: 10px;">Column 1</th>
      <th style="padding: 10px;">Column 2</th>
    </tr>
  </thead>
  <tbody>
    {{#each items}}
    <tr>
      <td style="padding: 10px;">{{this.col1}}</td>
      <td style="padding: 10px;">{{this.col2}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
```

## Common Patterns

### Send Task Status Change
```typescript
const { html, text } = this.emailTemplateService.renderMultipart(
  'task/status-change.html',
  {
    userName: user.name,
    taskName: task.name,
    taskCode: task.code,
    oldStatus: task.previousStatus,
    newStatus: task.currentStatus,
    sectorName: task.sector.name,
    deadline: format(task.deadline, 'dd/MM/yyyy'),
    changedBy: currentUser.name,
    actionUrl: `${process.env.APP_URL}/tasks/${task.id}`,
    actionText: 'Ver Tarefa',
  }
);

await this.sendEmail({
  to: user.email,
  subject: `Status da Tarefa Alterado: ${task.name}`,
  html, text,
});
```

### Send Low Stock Alert
```typescript
const { html, text } = this.emailTemplateService.renderMultipart(
  'stock/low-stock.html',
  {
    itemName: item.name,
    itemCode: item.code,
    currentQuantity: item.quantity,
    reorderPoint: item.reorderPoint,
    location: item.location,
    suggestedOrderQuantity: calculateOrderQuantity(item),
    preferredSuppliers: await getSuppliers(item.id),
    actionUrl: `${process.env.APP_URL}/stock/items/${item.id}`,
  }
);

await this.sendBulkEmail({
  to: inventoryManagers.map(m => m.email),
  subject: `Alerta de Estoque Baixo: ${item.name}`,
  html, text,
  priority: 'high',
});
```

### Send Order Overdue Alert
```typescript
const { html, text } = this.emailTemplateService.renderMultipart(
  'order/overdue.html',
  {
    userName: user.name,
    orderNumber: order.number,
    supplierName: order.supplier.name,
    status: order.status,
    expectedDelivery: format(order.expectedDelivery, 'dd/MM/yyyy'),
    daysOverdue: calculateDaysOverdue(order.expectedDelivery),
    contactInfo: {
      phone: order.supplier.phone,
      email: order.supplier.email,
      contactPerson: order.supplier.contactPerson,
    },
    items: order.items.map(i => ({
      name: i.name,
      quantity: i.quantity,
      critical: i.isCritical,
    })),
    actionUrl: `${process.env.APP_URL}/orders/${order.id}`,
  }
);

await this.sendEmail({
  to: user.email,
  cc: purchasingManagers.map(m => m.email),
  subject: `Pedido Atrasado: ${order.number}`,
  html, text,
  priority: 'high',
});
```

## Testing Templates

### Preview in Browser (Development)
```typescript
// Add to controller for dev environment
@Get('preview/:template')
preview(@Param('template') template: string, @Res() res: Response) {
  const html = this.emailTemplateService.render(template, sampleData);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

// Visit: http://localhost:3030/preview/task/status-change.html
```

### Send Test Email
```typescript
async sendTestEmail() {
  const { html, text } = this.emailTemplateService.renderMultipart(
    'task/assignment.html',
    {
      userName: 'Test User',
      taskName: 'Test Task',
      taskCode: 'TEST-001',
      taskStatus: 'Pending',
      deadline: '31/01/2026',
      description: 'This is a test task for email template testing',
      assignedBy: 'System Admin',
      actionUrl: 'https://example.com',
    }
  );

  await this.mailer.sendMail({
    to: 'your-email@example.com',
    subject: 'Test Email - Task Assignment',
    html, text,
  });
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Template not found | Check file path and extension |
| Variables not rendering | Check variable names (case-sensitive) |
| Broken layout | Verify `useLayout: true` option |
| Images not showing | Use absolute URLs for images |
| Cache not updating | Call `clearCache()` in development |
| Outlook styling broken | Use inline styles, avoid flexbox |

## Performance Tips

1. Warmup cache on startup for frequently used templates
2. Use queue for bulk emails
3. Clear cache only when templates change
4. Optimize images (compress, use CDN)
5. Keep HTML under 100KB

## Best Practices

1. Always provide `userName` for personalization
2. Include `actionUrl` for user engagement
3. Test on multiple email clients
4. Use semantic HTML
5. Include alt text for images
6. Keep design simple and clean
7. Validate data before rendering
8. Handle missing variables gracefully
9. Use multipart for better deliverability
10. Monitor email metrics

## Documentation Links

- Full Documentation: `README.md`
- Usage Examples: `USAGE_EXAMPLES.md`
- Summary: `TEMPLATE_SUMMARY.md`
- Service: `email-template.service.ts`

---

**Last Updated:** 2026-01-05
