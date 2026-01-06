# Email Notification Templates

This directory contains email templates for the notification system. The templates use Handlebars for dynamic content rendering and are designed to work across all major email clients (Gmail, Outlook, Apple Mail, etc.).

## Directory Structure

```
templates/email/
├── layouts/
│   └── base.html              # Base layout with header/footer
├── task/
│   ├── status-change.html     # Task status change notification
│   ├── assignment.html        # Task assignment notification
│   ├── deadline-approaching.html  # Deadline reminder
│   └── field-update.html      # Task field update notification
├── order/
│   ├── created.html           # Order creation notification
│   ├── status-change.html     # Order status update
│   └── overdue.html           # Overdue order alert
├── stock/
│   ├── low-stock.html         # Low stock warning
│   ├── out-of-stock.html      # Out of stock alert
│   └── reorder.html           # Reorder suggestion
└── system/
    ├── generic.html           # Generic notification template
    └── warning.html           # System warning notification
```

## Usage

### Basic Usage

```typescript
import { EmailTemplateService } from './email-template.service';

// Inject the service
constructor(private emailTemplateService: EmailTemplateService) {}

// Render a template
const html = this.emailTemplateService.render('task/status-change.html', {
  userName: 'João Silva',
  taskName: 'Implementar API de Notificações',
  taskCode: 'TASK-123',
  oldStatus: 'Em Progresso',
  newStatus: 'Concluído',
  sectorName: 'Desenvolvimento',
  deadline: '15/01/2026',
  changedBy: 'Maria Santos',
  actionUrl: 'https://app.example.com/tasks/123',
  actionText: 'Ver Tarefa'
});
```

### Render with Multipart (HTML + Text)

```typescript
const { html, text } = this.emailTemplateService.renderMultipart('task/assignment.html', {
  userName: 'Pedro Costa',
  taskName: 'Revisar Documentação',
  taskCode: 'TASK-456',
  taskStatus: 'Pendente',
  sectorName: 'Qualidade',
  priority: 'Alta',
  deadline: '20/01/2026',
  estimatedHours: 4,
  description: 'Revisar toda a documentação técnica do projeto',
  assignedBy: 'Ana Paula'
});

// Use both versions in your email service
await sendEmail({
  to: 'pedro@example.com',
  subject: 'Nova Tarefa Atribuída',
  html: html,
  text: text
});
```

### Without Layout (Content Only)

```typescript
const content = this.emailTemplateService.render(
  'task/status-change.html',
  data,
  { useLayout: false }
);
```

## Template Variables

### Base Layout Variables

All templates have access to these base variables from the layout:

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `subject` | string | Email subject line | - |
| `userName` | string | Recipient's name | - |
| `logoUrl` | string | Company logo URL | - |
| `companyName` | string | Company name | "Sua Empresa" |
| `companyAddress` | string | Company address | - |
| `companyPhone` | string | Company phone | - |
| `companyEmail` | string | Company email | "contato@empresa.com" |
| `actionUrl` | string | Call-to-action URL | - |
| `actionText` | string | Call-to-action button text | "Ver Detalhes" |
| `footerNote` | string | Additional footer note | - |
| `helpUrl` | string | Help center URL | "#" |
| `privacyUrl` | string | Privacy policy URL | "#" |
| `termsUrl` | string | Terms of service URL | "#" |
| `unsubscribeUrl` | string | Unsubscribe URL | - |
| `year` | number | Current year | Auto-generated |

### Task Templates

#### status-change.html

```typescript
{
  taskName: string;
  taskCode?: string;
  oldStatus: string;
  newStatus: string;
  sectorName?: string;
  assignedTo?: string;
  deadline?: string;
  description?: string;
  changedBy?: string;
}
```

#### assignment.html

```typescript
{
  taskName: string;
  taskCode?: string;
  taskStatus: string;
  sectorName?: string;
  priority?: string;
  deadline?: string;
  estimatedHours?: number;
  description?: string;
  requirements?: string[];
  assignedBy?: string;
}
```

#### deadline-approaching.html

```typescript
{
  taskName: string;
  taskCode?: string;
  taskStatus: string;
  deadline: string;
  daysRemaining?: string;
  sectorName?: string;
  priority?: string;
  completionPercentage?: number;
  pendingItems?: string[];
}
```

#### field-update.html

```typescript
{
  taskName: string;
  taskCode?: string;
  fieldName: string;
  oldValue?: string;
  newValue: string;
  multipleChanges?: boolean;
  changes?: Array<{field: string; oldValue: string; newValue: string}>;
  taskStatus?: string;
  sectorName?: string;
  assignedTo?: string;
  deadline?: string;
  updateReason?: string;
  changedBy?: string;
  updateDate?: string;
}
```

### Order Templates

#### created.html

```typescript
{
  orderNumber: string;
  supplierName?: string;
  status: string;
  orderDate?: string;
  expectedDelivery?: string;
  totalValue?: string;
  items?: Array<{
    name: string;
    quantity: number;
    unitPrice?: string;
    totalPrice?: string;
  }>;
  showPrices?: boolean;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
}
```

#### status-change.html

```typescript
{
  orderNumber: string;
  supplierName?: string;
  oldStatus: string;
  newStatus: string;
  expectedDelivery?: string;
  updatedAt?: string;
  statusDescription?: string;
  trackingCode?: string;
  carrier?: string;
  trackingUrl?: string;
  nextSteps?: string[];
  itemsSummary?: string;
  updatedBy?: string;
}
```

#### overdue.html

```typescript
{
  orderNumber: string;
  supplierName?: string;
  status: string;
  expectedDelivery: string;
  daysOverdue?: number;
  orderDate?: string;
  contactInfo?: {
    phone?: string;
    email?: string;
    contactPerson?: string;
  };
  alternativeActions?: string[];
  items?: Array<{
    name: string;
    quantity: number;
    critical?: boolean;
  }>;
  impactAnalysis?: string;
}
```

### Stock Templates

#### low-stock.html

```typescript
{
  itemName: string;
  itemCode?: string;
  category?: string;
  currentQuantity: number;
  reorderPoint: number;
  minimumStock?: number;
  location?: string;
  consumptionRate?: string;
  estimatedDaysRemaining?: number;
  averageConsumption?: string;
  suggestedOrderQuantity?: number;
  preferredSuppliers?: Array<{
    name: string;
    leadTime: string;
    lastPrice: string;
  }>;
  pendingOrders?: number;
}
```

#### out-of-stock.html

```typescript
{
  itemName: string;
  itemCode?: string;
  category?: string;
  currentQuantity: number;
  lastStockDate?: string;
  location?: string;
  impactedTasks?: number;
  tasksList?: Array<{
    name: string;
    deadline: string;
  }>;
  pendingDemand?: number;
  backorderCount?: number;
  suggestedOrderQuantity?: number;
  preferredSuppliers?: Array<{
    name: string;
    hasStock: boolean;
    leadTime: string;
    price: string;
  }>;
  alternativeItems?: Array<{
    name: string;
    code: string;
    stock: number;
  }>;
  pendingOrders?: number;
  expectedArrival?: string;
}
```

#### reorder.html

```typescript
{
  itemName: string;
  itemCode?: string;
  category?: string;
  currentQuantity: number;
  reorderPoint: number;
  recommendedQuantity?: number;
  calculationDetails?: {
    averageConsumption?: string;
    leadTime?: string;
    safetyStock?: number;
    maxStock?: number;
  };
  preferredSupplier?: {
    name: string;
    price?: string;
    leadTime?: string;
    minOrder?: number;
    reliability?: string;
  };
  estimatedCost?: {
    unitPrice?: string;
    totalCost?: string;
    shipping?: string;
  };
  alternativeSuppliers?: Array<{
    name: string;
    leadTime: string;
    price: string;
    rating: string;
  }>;
  requiresApproval?: boolean;
  notes?: string;
}
```

### System Templates

#### generic.html

```typescript
{
  title?: string;
  message?: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
  content?: string;  // HTML content
  items?: string[];
  additionalInfo?: string;
}
```

#### warning.html

```typescript
{
  warningTitle?: string;
  message?: string;
  severity?: 'high' | 'medium' | 'low';
  details?: Array<{
    label: string;
    value: string;
  }>;
  description?: string;
  impact?: string;
  recommendations?: string[];
  requiredActions?: string[];
  deadline?: string;
  contactInfo?: {
    department?: string;
    person?: string;
    email?: string;
    phone?: string;
  };
  relatedLinks?: Array<{
    url: string;
    text: string;
  }>;
  additionalInfo?: string;
}
```

## Handlebars Helpers

The template service provides several custom Handlebars helpers:

### Comparison Helpers

- `{{#if (eq value1 value2)}}` - Equality check
- `{{#if (ne value1 value2)}}` - Not equal check
- `{{#if (gt value1 value2)}}` - Greater than
- `{{#if (lt value1 value2)}}` - Less than
- `{{#if (and condition1 condition2)}}` - Logical AND
- `{{#if (or condition1 condition2)}}` - Logical OR

### Formatting Helpers

- `{{formatDate date 'short'}}` - Format date (short, long, time)
- `{{currency value 'BRL'}}` - Format currency
- `{{pluralize count 'item' 'items'}}` - Pluralization
- `{{uppercase str}}` - Convert to uppercase
- `{{lowercase str}}` - Convert to lowercase
- `{{capitalize str}}` - Capitalize first letter
- `{{truncate str 100}}` - Truncate string
- `{{default value 'fallback'}}` - Default value

### Examples

```handlebars
<!-- Conditional rendering -->
{{#if (eq status 'completed')}}
  <span style="color: green;">Concluído</span>
{{else if (eq status 'in_progress')}}
  <span style="color: orange;">Em Progresso</span>
{{else}}
  <span style="color: gray;">Pendente</span>
{{/if}}

<!-- Date formatting -->
<p>Criado em: {{formatDate createdAt 'long'}}</p>

<!-- Currency -->
<p>Valor: {{currency totalValue 'BRL'}}</p>

<!-- Pluralization -->
<p>{{count}} {{pluralize count 'item' 'itens'}}</p>

<!-- Default value -->
<p>Status: {{default status 'Não definido'}}</p>
```

## Environment Variables

Configure these environment variables for template defaults:

```env
COMPANY_NAME="Sua Empresa"
COMPANY_ADDRESS="Rua Example, 123 - São Paulo, SP"
COMPANY_PHONE="+55 11 1234-5678"
COMPANY_EMAIL="contato@empresa.com"
COMPANY_LOGO_URL="https://example.com/logo.png"
HELP_URL="https://example.com/help"
PRIVACY_URL="https://example.com/privacy"
TERMS_URL="https://example.com/terms"
```

## Template Features

### Responsive Design

All templates are fully responsive and work on:
- Desktop email clients (Outlook, Thunderbird, Apple Mail)
- Webmail clients (Gmail, Yahoo, Outlook.com)
- Mobile devices (iOS Mail, Android Gmail)

### Email Client Compatibility

- Uses inline CSS for maximum compatibility
- Tested on Gmail, Outlook 2016+, Apple Mail
- Includes Outlook-specific conditional comments
- Table-based layout for older email clients
- Dark mode support (prefers-color-scheme)

### Styling Components

The base layout includes pre-styled components:

- `.info-box` - Information display box
- `.warning-box` - Warning/alert box (yellow)
- `.alert-box` - Critical alert box (red)
- `.success-box` - Success message box (green)
- `.btn-primary` - Primary action button
- `.btn-secondary` - Secondary button
- `.btn-success` - Success button
- `.btn-warning` - Warning button
- `.btn-danger` - Danger button

## Best Practices

1. **Always provide fallback values** for optional variables
2. **Test templates** across different email clients
3. **Keep HTML simple** - complex CSS may not render correctly
4. **Use inline styles** for critical styling
5. **Optimize images** - use compressed images with proper dimensions
6. **Include alt text** for images
7. **Test text-only version** - many users prefer plain text
8. **Keep file sizes small** - under 100KB is recommended
9. **Use semantic HTML** for accessibility
10. **Include unsubscribe links** for marketing emails

## Cache Management

The service automatically caches compiled templates. You can:

```typescript
// Clear cache (useful in development)
this.emailTemplateService.clearCache();

// Warmup cache with frequently used templates
this.emailTemplateService.warmupCache([
  'task/status-change.html',
  'task/assignment.html',
  'order/created.html',
]);

// Check if template exists
const exists = this.emailTemplateService.templateExists('task/custom.html');

// Get available templates
const templates = this.emailTemplateService.getAvailableTemplates('task');
```

## Creating Custom Templates

To create a new template:

1. Create an HTML file in the appropriate category directory
2. Use Handlebars syntax for dynamic content
3. Follow the existing template structure
4. Test with various data scenarios
5. Document required variables

Example custom template:

```html
<!-- templates/email/custom/my-template.html -->
<p>Hello {{userName}},</p>

<div class="info-box">
    <div class="info-box-title">Custom Information</div>
    <div class="info-box-content">
        <div class="info-row">
            <span class="info-label">Field:</span>
            <span class="info-value">{{customField}}</span>
        </div>
    </div>
</div>

{{#if items}}
<ul>
    {{#each items}}
    <li>{{this.name}} - {{this.value}}</li>
    {{/each}}
</ul>
{{/if}}
```

## Troubleshooting

### Template not found error
- Verify the template path is correct
- Check file permissions
- Ensure the file exists in the templates directory

### Variables not rendering
- Check variable names match exactly (case-sensitive)
- Verify data is being passed to the render method
- Use `{{!-- {{debug}} --}}` to inspect available variables

### Styling issues
- Use inline styles for critical CSS
- Test in target email clients
- Check for unsupported CSS properties

### Layout not applying
- Verify `useLayout: true` in render options
- Check layout file exists in layouts directory
- Ensure content is wrapped in `{{{content}}}` in layout

## Support

For questions or issues with email templates, contact the development team or check the project documentation.
