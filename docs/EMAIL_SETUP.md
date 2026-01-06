# Email SMTP Configuration Guide

This guide provides comprehensive instructions for setting up email functionality using Nodemailer with SMTP in your application.

## Table of Contents

- [Overview](#overview)
- [Required Environment Variables](#required-environment-variables)
- [SMTP Provider Configuration](#smtp-provider-configuration)
- [Setup Instructions](#setup-instructions)
- [Template System](#template-system)
- [Usage Examples](#usage-examples)
- [Troubleshooting](#troubleshooting)

## Overview

The email system is built on:
- **Nodemailer**: Node.js email sending library
- **Handlebars**: Template engine for email rendering
- **SMTP**: Protocol for sending emails through various providers

### Features

- Flexible SMTP configuration for any provider
- Handlebars template engine with custom helpers
- Connection pooling for better performance
- Automatic retry logic with exponential backoff
- Rate limiting support
- Delivery tracking and monitoring
- HTML and plain text email support
- Template caching for performance

## Required Environment Variables

Add these variables to your `.env.development`, `.env.staging`, or `.env.production` file:

```bash
# SMTP Server Configuration
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false

# SMTP Authentication
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password-here"

# Email From Configuration
SMTP_FROM_EMAIL="noreply@yourdomain.com"
SMTP_FROM_NAME="Your Company Name"

# Template Configuration (optional)
EMAIL_TEMPLATES_DIR="./src/templates/emails"
```

### Variable Descriptions

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SMTP_HOST` | SMTP server hostname | Yes | smtp.gmail.com |
| `SMTP_PORT` | SMTP server port | Yes | 587 |
| `SMTP_SECURE` | Use SSL/TLS (true for port 465, false for 587) | Yes | false |
| `SMTP_USER` | SMTP authentication username/email | Yes | - |
| `SMTP_PASSWORD` | SMTP authentication password | Yes | - |
| `SMTP_FROM_EMAIL` | Default sender email address | Yes | noreply@example.com |
| `SMTP_FROM_NAME` | Default sender name | Yes | Ankaa System |
| `EMAIL_TEMPLATES_DIR` | Path to email templates directory | No | ./src/templates/emails |

### Legacy Variables (Backward Compatibility)

For backward compatibility, the system also supports:
- `EMAIL_USER` (maps to `SMTP_USER`)
- `EMAIL_PASS` (maps to `SMTP_PASSWORD`)

## SMTP Provider Configuration

### Gmail

**Setup Steps:**
1. Enable 2-Factor Authentication on your Google Account
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Generate a new app password for "Mail"
4. Use the generated password in `SMTP_PASSWORD`

**Configuration:**
```bash
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="xxxx xxxx xxxx xxxx"  # 16-character app password
```

**Limits:**
- Free: 500 emails/day
- Google Workspace: 2,000 emails/day

### Outlook / Office 365

**Configuration:**
```bash
SMTP_HOST="smtp-mail.outlook.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-email@outlook.com"
SMTP_PASSWORD="your-password"
```

**Limits:**
- 300 emails/day (personal)
- Higher limits for business accounts

### SendGrid

**Setup Steps:**
1. Sign up at [SendGrid](https://sendgrid.com)
2. Create an API Key in Settings > API Keys
3. Use the API key as password

**Configuration:**
```bash
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="apikey"  # Literally "apikey"
SMTP_PASSWORD="SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Limits:**
- Free tier: 100 emails/day
- Paid plans: Scale up as needed

### Mailgun

**Setup Steps:**
1. Sign up at [Mailgun](https://www.mailgun.com)
2. Add and verify your domain
3. Get SMTP credentials from domain settings

**Configuration:**
```bash
SMTP_HOST="smtp.mailgun.org"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="postmaster@your-domain.mailgun.org"
SMTP_PASSWORD="your-smtp-password"
```

**Limits:**
- Free tier: 5,000 emails/month
- Pay-as-you-go available

### Amazon SES

**Setup Steps:**
1. Set up AWS account and verify domain/email
2. Create SMTP credentials in SES console
3. Move out of sandbox mode for production

**Configuration:**
```bash
SMTP_HOST="email-smtp.us-east-1.amazonaws.com"  # Change region as needed
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="AKIAXXXXXXXXXXXXXXXX"
SMTP_PASSWORD="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Limits:**
- Sandbox: 200 emails/day
- Production: 50,000 emails/day (can request increase)

### Custom SMTP Server

**Configuration:**
```bash
SMTP_HOST="mail.yourdomain.com"
SMTP_PORT=587  # or 465 for SSL
SMTP_SECURE=false  # true for port 465
SMTP_USER="username"
SMTP_PASSWORD="password"
```

## Setup Instructions

### 1. Install Dependencies

Dependencies are already installed:
- `nodemailer@6.10.1`
- `handlebars@4.7.8`
- `@types/nodemailer@6.4.17`
- `@types/handlebars@4.0.40`

### 2. Configure Environment Variables

Copy `.env.example` to your environment file:

```bash
cp .env.example .env.development
```

Edit `.env.development` and add your SMTP credentials.

### 3. Template Directory Structure

Templates are located at `/home/kennedy/Documents/repositories/api/src/templates/emails/`:

```
emails/
├── layouts/
│   └── main.hbs              # Main email layout
├── partials/
│   ├── footer.hbs            # Email footer
│   └── button.hbs            # CTA button
├── notifications/
│   ├── welcome.hbs           # Welcome email
│   ├── password-reset.hbs    # Password reset
│   └── notification.hbs      # Generic notification
└── README.md                 # Template documentation
```

### 4. Services Available

The mailer module provides the following services:

- `NodemailRepository`: SMTP email sending with Nodemailer
- `MailerService`: High-level email service with retry logic
- `HandlebarsTemplateService`: Template compilation and rendering
- `EmailTemplateService`: Pre-built email templates
- `NotificationMailerService`: Notification-specific email service

## Template System

### Using Handlebars Templates

```typescript
import { HandlebarsTemplateService } from '@/modules/common/mailer/services/handlebars-template.service';

// Inject service
constructor(
  private readonly handlebarsService: HandlebarsTemplateService,
) {}

// Load and render template
async sendWelcomeEmail(email: string, userName: string) {
  const html = await this.handlebarsService.render('welcome', {
    companyName: 'Ankaa',
    userName: userName,
    actionUrl: 'https://example.com/dashboard',
    supportEmail: 'support@example.com',
    year: new Date().getFullYear(),
  });

  // Send email...
}
```

### Available Templates

1. **welcome.hbs** - Welcome email for new users
2. **password-reset.hbs** - Password reset instructions
3. **notification.hbs** - Generic notification template

### Custom Handlebars Helpers

The system includes these built-in helpers:

**Date Formatting:**
- `{{formatDate date "short"}}` - 01/01/2025
- `{{formatDate date "long"}}` - Segunda-feira, 1 de janeiro de 2025
- `{{formatDate date "datetime"}}` - 01/01/2025, 14:30:00

**Number Formatting:**
- `{{formatCurrency 1000 "BRL"}}` - R$ 1.000,00
- `{{formatNumber 1234.5 2}}` - 1.234,50

**String Helpers:**
- `{{uppercase "text"}}` - TEXT
- `{{lowercase "TEXT"}}` - text
- `{{capitalize "text"}}` - Text
- `{{truncate "long text" 10}}` - long text...

**Conditional Helpers:**
- `{{#eq a b}}...{{/eq}}` - Equality check
- `{{#neq a b}}...{{/neq}}` - Not equal
- `{{#gt a b}}...{{/gt}}` - Greater than
- `{{#lt a b}}...{{/lt}}` - Less than

## Usage Examples

### Basic Email Sending

```typescript
import { MailerService } from '@/modules/common/mailer/services/mailer.service';

constructor(private readonly mailerService: MailerService) {}

async sendEmail() {
  const success = await this.mailerService.sendNotificationEmail(
    'user@example.com',
    '<h1>Hello</h1><p>This is a test email</p>',
    { subject: 'Test Email', title: 'Test' }
  );

  if (success) {
    console.log('Email sent successfully');
  }
}
```

### Using Templates

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
    supportPhone: '+55 11 99999-9999',
    supportUrl: 'https://example.com/support',
    year: new Date().getFullYear(),
  });

  // Send email
  await this.mailerService.sendNotificationEmail(
    email,
    html,
    { subject: 'Welcome to Ankaa', title: 'Welcome' }
  );
}
```

### Bulk Email Sending

```typescript
async sendBulkEmails() {
  const recipients = [
    { email: 'user1@example.com', data: { userName: 'User 1' } },
    { email: 'user2@example.com', data: { userName: 'User 2' } },
    // ... more recipients
  ];

  const template = '<h1>Hello {{userName}}</h1>';

  const result = await this.mailerService.sendBulkNotificationEmails(
    recipients,
    template,
  );

  console.log(`Success: ${result.success}, Failed: ${result.failed}`);
}
```

### Password Reset Email

```typescript
async sendPasswordResetEmail(email: string, resetToken: string) {
  const resetUrl = `https://example.com/reset-password?token=${resetToken}`;

  const html = await this.handlebarsService.render('password-reset', {
    companyName: 'Ankaa',
    userName: 'User Name',
    resetUrl: resetUrl,
    expirationTime: '24 horas',
    supportEmail: 'support@example.com',
    year: new Date().getFullYear(),
  });

  await this.mailerService.sendNotificationEmail(
    email,
    html,
    { subject: 'Password Reset Request', title: 'Reset Password' }
  );
}
```

## Troubleshooting

### Common Issues

**1. Authentication Failed**
- Verify SMTP credentials are correct
- For Gmail, ensure you're using an App Password, not your account password
- Check if 2FA is enabled (required for Gmail App Passwords)

**2. Connection Timeout**
- Verify SMTP_HOST and SMTP_PORT are correct
- Check firewall settings
- Ensure your network allows outbound connections on the SMTP port

**3. TLS/SSL Errors**
- For port 587, set `SMTP_SECURE=false` (uses STARTTLS)
- For port 465, set `SMTP_SECURE=true` (uses SSL)
- Don't mix SSL/TLS settings with wrong ports

**4. Template Not Found**
- Verify `EMAIL_TEMPLATES_DIR` path is correct
- Ensure template files have `.hbs` extension
- Check file permissions

**5. Emails Going to Spam**
- Set up SPF, DKIM, and DMARC records for your domain
- Use a verified sender email address
- Avoid spam trigger words in subject/content
- Consider using a dedicated email service provider

### Testing Email Configuration

```typescript
import { NodemailRepository } from '@/modules/common/mailer/repositories/nodemail.repository';

async testEmailConfig() {
  const repository = new NodemailRepository();
  const transporter = repository.getTransporter();

  try {
    await transporter.verify();
    console.log('SMTP configuration is valid');
  } catch (error) {
    console.error('SMTP configuration error:', error.message);
  }
}
```

### Debug Mode

Enable detailed logging in development:

```bash
LOG_LEVEL="debug"
NODE_ENV="development"
```

### Check Delivery Logs

```typescript
const stats = this.mailerService.getStatistics();
console.log('Email Statistics:', stats);

const logs = this.mailerService.getAllDeliveryLogs();
console.log('Delivery Logs:', logs);
```

## Best Practices

1. **Use App Passwords**: Never use your main email password for SMTP
2. **Environment Variables**: Keep credentials in environment variables, never commit them
3. **Rate Limiting**: Respect provider limits to avoid account suspension
4. **Error Handling**: Always handle email sending errors gracefully
5. **Template Testing**: Test templates with various data combinations
6. **Monitoring**: Track delivery success rates and errors
7. **Fallback**: Consider implementing multiple providers for redundancy

## Security Considerations

- Never commit `.env` files with real credentials
- Use different credentials for development, staging, and production
- Regularly rotate SMTP passwords
- Monitor for unusual sending patterns
- Implement rate limiting at application level
- Validate email addresses before sending
- Sanitize user input in email content

## Performance Optimization

- Templates are cached after first load
- Connection pooling is enabled by default
- Batch sending is supported for bulk emails
- Rate limiting prevents overwhelming SMTP servers

## Support

For additional help:
- Check the [Nodemailer documentation](https://nodemailer.com/)
- Review template examples in `/src/templates/emails/`
- Check application logs for detailed error messages
