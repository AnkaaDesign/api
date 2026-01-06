# Email Templates

This directory contains Handlebars email templates for the application.

## Directory Structure

```
emails/
├── layouts/          # Base layout templates
│   └── main.hbs     # Main email layout
├── partials/        # Reusable template components
│   ├── footer.hbs   # Email footer
│   └── button.hbs   # Call-to-action button
└── notifications/   # Notification templates
    ├── welcome.hbs          # Welcome email
    ├── password-reset.hbs   # Password reset email
    └── notification.hbs     # Generic notification template
```

## Usage

### Using HandlebarsTemplateService

```typescript
import { HandlebarsTemplateService } from '@/modules/common/mailer/services/handlebars-template.service';

// Load and render a template
const html = await handlebarsService.render('welcome', {
  companyName: 'Ankaa',
  userName: 'John Doe',
  actionUrl: 'https://example.com/dashboard',
  supportEmail: 'support@example.com',
  supportPhone: '+55 11 99999-9999',
  supportUrl: 'https://example.com/support',
  year: new Date().getFullYear(),
});
```

### Template Data Structure

#### Welcome Email
```typescript
{
  companyName: string;
  userName?: string;
  actionUrl?: string;
  actionText?: string;
  supportEmail: string;
  supportPhone?: string;
  supportUrl?: string;
  year: number;
}
```

#### Password Reset Email
```typescript
{
  companyName: string;
  userName?: string;
  resetUrl: string;
  expirationTime?: string;  // Default: "24 horas"
  supportEmail: string;
  supportPhone?: string;
  supportUrl?: string;
  year: number;
}
```

#### Generic Notification
```typescript
{
  companyName: string;
  userName?: string;
  title: string;
  body: string;
  importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  timestamp?: Date | string;
  actionUrl?: string;
  actionText?: string;
  metadata?: Record<string, any>;
  supportEmail: string;
  supportPhone?: string;
  supportUrl?: string;
  year: number;
}
```

## Available Handlebars Helpers

### Date Formatting
- `{{formatDate date "short"}}` - Short date format (dd/mm/yyyy)
- `{{formatDate date "long"}}` - Long date format (with day of week)
- `{{formatDate date "datetime"}}` - Date and time format

### Number Formatting
- `{{formatCurrency value "BRL"}}` - Format as currency
- `{{formatNumber value 2}}` - Format number with decimals

### String Helpers
- `{{uppercase str}}` - Convert to uppercase
- `{{lowercase str}}` - Convert to lowercase
- `{{capitalize str}}` - Capitalize first letter
- `{{truncate str 50 "..."}}` - Truncate string

### Conditional Helpers
- `{{#eq a b}}...{{/eq}}` - Equality check
- `{{#neq a b}}...{{/neq}}` - Not equal check
- `{{#gt a b}}...{{/gt}}` - Greater than
- `{{#lt a b}}...{{/lt}}` - Less than
- `{{#or a b c}}...{{/or}}` - Logical OR
- `{{#and a b c}}...{{/and}}` - Logical AND

### Utility Helpers
- `{{default value "default"}}` - Default value if null/undefined
- `{{length array}}` - Array length
- `{{join array ", "}}` - Join array elements
- `{{json object}}` - JSON stringify

### Math Helpers
- `{{add a b}}` - Addition
- `{{subtract a b}}` - Subtraction
- `{{multiply a b}}` - Multiplication
- `{{divide a b}}` - Division

## Creating New Templates

### 1. Create Template File

Create a new `.hbs` file in the appropriate directory:

```handlebars
{{#*inline "content"}}
  <h2>Your Content Here</h2>
  <p>{{yourVariable}}</p>

  {{#if actionUrl}}
  {{> button url=actionUrl text="Click Here"}}
  {{/if}}
{{/inline}}

{{> ../layouts/main}}
```

### 2. Use in Code

```typescript
const html = await handlebarsService.render('your-template', {
  companyName: 'Ankaa',
  yourVariable: 'value',
  // ... other data
});
```

## Partials

Partials are reusable template components that can be included in other templates.

### Using Existing Partials

```handlebars
{{> footer}}
{{> button url="https://example.com" text="Click Me"}}
```

### Creating New Partials

1. Create a `.hbs` file in `partials/` directory
2. Register it using `HandlebarsTemplateService`:

```typescript
await handlebarsService.loadPartial('my-partial');
```

Or load all partials at once:

```typescript
await handlebarsService.loadAllPartials();
```

## Best Practices

1. **Keep templates simple** - Complex logic should be in services, not templates
2. **Use partials** - Reuse common components across templates
3. **Test templates** - Always test email rendering with various data combinations
4. **Mobile-friendly** - All templates include responsive styles
5. **Accessibility** - Use semantic HTML and proper contrast ratios
6. **Inline CSS** - Email clients have limited CSS support, keep styles inline or in `<style>` tags

## Testing Templates

```typescript
// In your test or development code
import { HandlebarsTemplateService } from '@/modules/common/mailer/services/handlebars-template.service';

const service = new HandlebarsTemplateService();
await service.loadAllPartials();

const html = await service.render('notification', {
  companyName: 'Test Company',
  title: 'Test Notification',
  body: 'This is a test',
  importance: 'HIGH',
  year: 2025,
});

console.log(html);
```

## Email Client Compatibility

Templates are tested and compatible with:
- Gmail (Web, iOS, Android)
- Outlook (Web, Desktop, Mobile)
- Apple Mail (macOS, iOS)
- Yahoo Mail
- Thunderbird
- Other major email clients

## Troubleshooting

### Template Not Found
- Ensure the template file exists with `.hbs` extension
- Check the file path and subdirectory
- Verify `EMAIL_TEMPLATES_DIR` environment variable

### Partials Not Working
- Load partials before rendering templates
- Use correct partial names (without `.hbs` extension)
- Check partial file location in `partials/` directory

### Helpers Not Working
- Verify helper is registered in `HandlebarsTemplateService`
- Check helper syntax in template
- Review helper parameters and return values
