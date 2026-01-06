# Email SMTP Configuration - Setup Summary

## Overview

Complete SMTP email configuration has been set up for the Ankaa API using Nodemailer and Handlebars template engine.

## What Was Configured

### 1. SMTP Configuration
- **Location**: `/home/kennedy/Documents/repositories/api/src/modules/common/mailer/repositories/nodemail.repository.ts`
- **Features**:
  - Flexible SMTP configuration supporting any provider
  - Environment-based configuration
  - Connection pooling for performance
  - Automatic connection verification
  - Rate limiting support
  - HTML to plain text conversion

### 2. Handlebars Template Engine
- **Location**: `/home/kennedy/Documents/repositories/api/src/modules/common/mailer/services/handlebars-template.service.ts`
- **Features**:
  - Template compilation and caching
  - 20+ custom helper functions
  - Partial support
  - Layout system
  - Dynamic template loading

### 3. Template Directory Structure
- **Location**: `/home/kennedy/Documents/repositories/api/src/templates/emails/`
- **Structure**:
  ```
  emails/
  ├── layouts/
  │   └── main.hbs              # Main email layout
  ├── partials/
  │   ├── footer.hbs            # Reusable footer
  │   └── button.hbs            # CTA button
  ├── notifications/
  │   ├── welcome.hbs           # Welcome email template
  │   ├── password-reset.hbs    # Password reset template
  │   └── notification.hbs      # Generic notification template
  └── README.md                 # Template documentation
  ```

### 4. Services Updated
- **MailerModule**: Added HandlebarsTemplateService export
- **NodemailRepository**: Enhanced with full SMTP configuration
- **Services Available**:
  - `MailerService`: Email sending with retry logic
  - `HandlebarsTemplateService`: Template rendering
  - `EmailTemplateService`: Pre-built templates
  - `NotificationMailerService`: Notification emails

## Required Environment Variables

Add these to your `.env.development`, `.env.staging`, or `.env.production`:

```bash
# SMTP Server Configuration
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false

# SMTP Authentication
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password"

# Email From Configuration
SMTP_FROM_EMAIL="noreply@yourdomain.com"
SMTP_FROM_NAME="Your Company Name"

# Template Directory (optional)
EMAIL_TEMPLATES_DIR="./src/templates/emails"
```

## Environment Variables Reference

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SMTP_HOST` | SMTP server hostname | Yes | smtp.gmail.com |
| `SMTP_PORT` | SMTP server port | Yes | 587 |
| `SMTP_SECURE` | Use SSL/TLS (true for 465, false for 587) | Yes | false |
| `SMTP_USER` | SMTP username/email | Yes | - |
| `SMTP_PASSWORD` | SMTP password/API key | Yes | - |
| `SMTP_FROM_EMAIL` | Default sender email | Yes | noreply@example.com |
| `SMTP_FROM_NAME` | Default sender name | Yes | Ankaa System |
| `EMAIL_TEMPLATES_DIR` | Template directory path | No | ./src/templates/emails |

### Backward Compatibility
The system also supports legacy variables:
- `EMAIL_USER` (fallback for `SMTP_USER`)
- `EMAIL_PASS` (fallback for `SMTP_PASSWORD`)

## Recommended SMTP Providers

### For Development
1. **Gmail** (Free)
   - 500 emails/day
   - Easy setup with App Password
   - Good for testing

### For Production

1. **SendGrid** (Free tier: 100/day, Paid from $19.95/mo)
   - Excellent deliverability
   - Good analytics
   - Easy setup

2. **Mailgun** (Free tier: 5,000/month, Paid from $35/mo)
   - Detailed logs
   - Good API
   - Email validation

3. **Amazon SES** (Free tier: 62,000/month from EC2, $0.10/1,000)
   - Most cost-effective at scale
   - Highly scalable
   - Requires AWS account

4. **Postmark** (100 emails trial, $10/mo for 10,000)
   - Best deliverability
   - Fast delivery
   - Premium service

See `/home/kennedy/Documents/repositories/api/docs/SMTP_PROVIDERS.md` for detailed provider comparison and setup instructions.

## Quick Start Guide

### 1. Configure Environment

```bash
# Edit your environment file
nano .env.development

# Add SMTP configuration
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password"
SMTP_FROM_EMAIL="noreply@yourdomain.com"
SMTP_FROM_NAME="Your Company"
```

### 2. For Gmail Setup

1. Enable 2-Factor Authentication: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Copy the 16-character password to `SMTP_PASSWORD`

### 3. Send Test Email

```typescript
import { MailerService } from '@/modules/common/mailer/services/mailer.service';

constructor(private readonly mailerService: MailerService) {}

async testEmail() {
  const success = await this.mailerService.sendNotificationEmail(
    'recipient@example.com',
    '<h1>Test Email</h1><p>This is a test.</p>',
    { subject: 'Test', title: 'Test Email' }
  );

  console.log(success ? 'Email sent!' : 'Email failed');
}
```

### 4. Use Templates

```typescript
import { HandlebarsTemplateService } from '@/modules/common/mailer/services/handlebars-template.service';
import { MailerService } from '@/modules/common/mailer/services/mailer.service';

constructor(
  private readonly handlebarsService: HandlebarsTemplateService,
  private readonly mailerService: MailerService,
) {}

async sendWelcomeEmail(email: string, userName: string) {
  // Render template
  const html = await this.handlebarsService.render('welcome', {
    companyName: 'Ankaa',
    userName: userName,
    actionUrl: 'https://example.com/dashboard',
    actionText: 'Access Dashboard',
    supportEmail: 'support@example.com',
    year: new Date().getFullYear(),
  });

  // Send email
  await this.mailerService.sendNotificationEmail(
    email,
    html,
    { subject: 'Welcome to Ankaa' }
  );
}
```

## Available Templates

### 1. Welcome Email (`welcome.hbs`)
```typescript
const html = await handlebarsService.render('welcome', {
  companyName: 'Ankaa',
  userName: 'John Doe',
  actionUrl: 'https://example.com/dashboard',
  actionText: 'Get Started',
  supportEmail: 'support@example.com',
  supportPhone: '+55 11 99999-9999',
  supportUrl: 'https://example.com/support',
  year: 2025,
});
```

### 2. Password Reset (`password-reset.hbs`)
```typescript
const html = await handlebarsService.render('password-reset', {
  companyName: 'Ankaa',
  userName: 'John Doe',
  resetUrl: 'https://example.com/reset?token=xxx',
  expirationTime: '24 horas',
  supportEmail: 'support@example.com',
  year: 2025,
});
```

### 3. Generic Notification (`notification.hbs`)
```typescript
const html = await handlebarsService.render('notification', {
  companyName: 'Ankaa',
  userName: 'John Doe',
  title: 'Important Update',
  body: 'This is the notification message.',
  importance: 'HIGH', // LOW, MEDIUM, HIGH, URGENT
  timestamp: new Date(),
  actionUrl: 'https://example.com/details',
  actionText: 'View Details',
  metadata: {
    'Order ID': '12345',
    'Status': 'Shipped',
  },
  supportEmail: 'support@example.com',
  year: 2025,
});
```

## Handlebars Helper Functions

### Date Formatting
```handlebars
{{formatDate date "short"}}      <!-- 01/01/2025 -->
{{formatDate date "long"}}       <!-- Segunda-feira, 1 de janeiro de 2025 -->
{{formatDate date "datetime"}}   <!-- 01/01/2025, 14:30:00 -->
```

### Number Formatting
```handlebars
{{formatCurrency 1000 "BRL"}}    <!-- R$ 1.000,00 -->
{{formatNumber 1234.56 2}}       <!-- 1.234,56 -->
```

### String Helpers
```handlebars
{{uppercase "text"}}             <!-- TEXT -->
{{lowercase "TEXT"}}             <!-- text -->
{{capitalize "hello"}}           <!-- Hello -->
{{truncate "long text" 10}}      <!-- long text... -->
```

### Conditional Helpers
```handlebars
{{#eq status "active"}}Active{{/eq}}
{{#neq status "inactive"}}Not Inactive{{/neq}}
{{#gt count 10}}More than 10{{/gt}}
{{#lt count 5}}Less than 5{{/lt}}
{{#or a b c}}At least one is true{{/or}}
{{#and a b c}}All are true{{/and}}
```

### Utility Helpers
```handlebars
{{default value "No value"}}
{{length arrayVar}}
{{join arrayVar ", "}}
{{json objectVar}}
```

### Math Helpers
```handlebars
{{add 5 3}}                      <!-- 8 -->
{{subtract 10 3}}                <!-- 7 -->
{{multiply 4 5}}                 <!-- 20 -->
{{divide 10 2}}                  <!-- 5 -->
```

## Documentation Files Created

1. **EMAIL_SETUP.md** - Comprehensive setup guide
   - Path: `/home/kennedy/Documents/repositories/api/docs/EMAIL_SETUP.md`
   - Contains detailed setup instructions, troubleshooting, and best practices

2. **SMTP_PROVIDERS.md** - Provider comparison and configuration
   - Path: `/home/kennedy/Documents/repositories/api/docs/SMTP_PROVIDERS.md`
   - Detailed guide for Gmail, SendGrid, Mailgun, Amazon SES, Outlook, Postmark, and Brevo

3. **Template README** - Template usage documentation
   - Path: `/home/kennedy/Documents/repositories/api/src/templates/emails/README.md`
   - Template usage examples and helper function reference

## Next Steps

1. **Configure Environment Variables**
   - Add SMTP credentials to your `.env` file
   - Use `.env.example` as reference

2. **Choose SMTP Provider**
   - For development: Use Gmail
   - For production: Consider SendGrid, Mailgun, or Amazon SES
   - See `SMTP_PROVIDERS.md` for comparison

3. **Test Email Sending**
   - Send a test email to verify configuration
   - Check logs for any errors

4. **Customize Templates**
   - Modify existing templates or create new ones
   - Add company branding and styling

5. **Set Up Domain Authentication**
   - Configure SPF, DKIM, and DMARC records
   - Verify sender domain with your provider

6. **Monitor and Optimize**
   - Track delivery success rates
   - Monitor for bounces and spam complaints
   - Adjust rate limiting as needed

## Support and Resources

- **Nodemailer Documentation**: https://nodemailer.com/
- **Handlebars Documentation**: https://handlebarsjs.com/
- **Setup Guide**: `/home/kennedy/Documents/repositories/api/docs/EMAIL_SETUP.md`
- **Provider Guide**: `/home/kennedy/Documents/repositories/api/docs/SMTP_PROVIDERS.md`
- **Template Docs**: `/home/kennedy/Documents/repositories/api/src/templates/emails/README.md`

## Troubleshooting

### Email Not Sending
1. Check SMTP credentials are correct
2. Verify environment variables are loaded
3. Check application logs for errors
4. Test SMTP connection with provider

### Templates Not Loading
1. Verify `EMAIL_TEMPLATES_DIR` path
2. Check template file names have `.hbs` extension
3. Ensure templates are in correct subdirectories

### Going to Spam
1. Set up SPF, DKIM, and DMARC records
2. Use verified sender domain
3. Avoid spam trigger words
4. Maintain good sender reputation

## Files Modified/Created

### Modified Files
1. `/home/kennedy/Documents/repositories/api/src/modules/common/mailer/repositories/nodemail.repository.ts`
   - Enhanced with flexible SMTP configuration
   - Added connection pooling and rate limiting

2. `/home/kennedy/Documents/repositories/api/src/modules/common/mailer/mailer.module.ts`
   - Added HandlebarsTemplateService export

3. `/home/kennedy/Documents/repositories/api/.env.example`
   - Added comprehensive SMTP configuration section

### Created Files

**Services:**
- `/home/kennedy/Documents/repositories/api/src/modules/common/mailer/services/handlebars-template.service.ts`

**Templates:**
- `/home/kennedy/Documents/repositories/api/src/templates/emails/layouts/main.hbs`
- `/home/kennedy/Documents/repositories/api/src/templates/emails/partials/footer.hbs`
- `/home/kennedy/Documents/repositories/api/src/templates/emails/partials/button.hbs`
- `/home/kennedy/Documents/repositories/api/src/templates/emails/notifications/welcome.hbs`
- `/home/kennedy/Documents/repositories/api/src/templates/emails/notifications/password-reset.hbs`
- `/home/kennedy/Documents/repositories/api/src/templates/emails/notifications/notification.hbs`

**Documentation:**
- `/home/kennedy/Documents/repositories/api/docs/EMAIL_SETUP.md`
- `/home/kennedy/Documents/repositories/api/docs/SMTP_PROVIDERS.md`
- `/home/kennedy/Documents/repositories/api/docs/EMAIL_SUMMARY.md` (this file)
- `/home/kennedy/Documents/repositories/api/src/templates/emails/README.md`

## Dependencies

All required dependencies are already installed:
- `nodemailer@6.10.1` - Email sending library
- `handlebars@4.7.8` - Template engine
- `@types/nodemailer@6.4.17` - TypeScript types
- `@types/handlebars@4.0.40` - TypeScript types

No additional installations required.
