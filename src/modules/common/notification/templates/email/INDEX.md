# Email Template System - Documentation Index

Welcome to the Email Template System documentation. This index will help you find the information you need quickly.

## Getting Started

1. **[Quick Reference](QUICK_REFERENCE.md)** - Start here for quick snippets and common patterns
2. **[Template Summary](TEMPLATE_SUMMARY.md)** - Overview of the complete system
3. **[README](README.md)** - Complete documentation with all details
4. **[Usage Examples](USAGE_EXAMPLES.md)** - Real-world implementation examples

## Documentation Structure

### For Quick Tasks
- **Need to send an email right now?** → [Quick Reference](QUICK_REFERENCE.md)
- **Looking for code examples?** → [Usage Examples](USAGE_EXAMPLES.md)
- **Want template paths?** → [Quick Reference - Template Paths](QUICK_REFERENCE.md#template-paths)

### For Understanding
- **How does it work?** → [Template Summary](TEMPLATE_SUMMARY.md)
- **What templates exist?** → [README - Template Variables](README.md#template-variables)
- **What helpers are available?** → [README - Handlebars Helpers](README.md#handlebars-helpers)

### For Implementation
- **Integrating with services?** → [Usage Examples](USAGE_EXAMPLES.md)
- **Setting up email sending?** → [Usage Examples - Integration](USAGE_EXAMPLES.md#integration-with-notification-service)
- **Creating custom templates?** → [README - Creating Custom Templates](README.md#creating-custom-templates)

### For Troubleshooting
- **Something not working?** → [README - Troubleshooting](README.md#troubleshooting)
- **Common issues?** → [Quick Reference - Troubleshooting](QUICK_REFERENCE.md#troubleshooting)
- **Performance problems?** → [README - Cache Management](README.md#cache-management)

## File Locations

### Templates
```
/api/src/modules/common/notification/templates/email/
├── layouts/base.html           # Base layout
├── task/*.html                 # Task notifications (4 templates)
├── order/*.html                # Order notifications (3 templates)
├── stock/*.html                # Stock notifications (3 templates)
└── system/*.html               # System notifications (2 templates)
```

### Service
```
/api/src/modules/common/notification/email-template.service.ts
```

### Module
```
/api/src/modules/common/notification/notification.module.ts
```

## Template Catalog

### Task Notifications (4)
| Template | Purpose | When to Use |
|----------|---------|-------------|
| [task/status-change.html](README.md#status-changehtml) | Task status changed | Status transitions |
| [task/assignment.html](README.md#assignmenthtml) | Task assigned to user | New assignments |
| [task/deadline-approaching.html](README.md#deadline-approachinghtml) | Deadline reminder | X days before deadline |
| [task/field-update.html](README.md#field-updatehtml) | Task field updated | Important field changes |

### Order Notifications (3)
| Template | Purpose | When to Use |
|----------|---------|-------------|
| [order/created.html](README.md#createdhtml) | Order created | New purchase orders |
| [order/status-change.html](README.md#status-changehtml-1) | Order status changed | Status updates |
| [order/overdue.html](README.md#overduehtml) | Order overdue | Delayed deliveries |

### Stock Notifications (3)
| Template | Purpose | When to Use |
|----------|---------|-------------|
| [stock/low-stock.html](README.md#low-stockhtml) | Low stock warning | Below reorder point |
| [stock/out-of-stock.html](README.md#out-of-stockhtml) | Out of stock alert | Zero inventory |
| [stock/reorder.html](README.md#reorderhtml) | Reorder suggestion | Scheduled reordering |

### System Notifications (2)
| Template | Purpose | When to Use |
|----------|---------|-------------|
| [system/generic.html](README.md#generichtml) | Generic notification | Custom messages |
| [system/warning.html](README.md#warninghtml) | System warning | Alerts and warnings |

## Quick Links by Role

### Developers
- [Service API Reference](README.md#emailtemplateservice)
- [Code Examples](USAGE_EXAMPLES.md)
- [Custom Helpers](README.md#handlebars-helpers)
- [Environment Config](README.md#environment-variables)

### Designers
- [Base Layout](layouts/base.html)
- [Styling Components](README.md#styling-components)
- [Template Features](TEMPLATE_SUMMARY.md#template-features)
- [Email Client Compatibility](TEMPLATE_SUMMARY.md#browseremail-client-compatibility)

### Product Managers
- [Template Catalog](#template-catalog)
- [Template Variables](README.md#template-variables)
- [Use Cases](TEMPLATE_SUMMARY.md#common-use-cases)

### System Administrators
- [Build Configuration](TEMPLATE_SUMMARY.md#build-configuration)
- [Performance Considerations](TEMPLATE_SUMMARY.md#performance-considerations)
- [Environment Setup](README.md#environment-variables)
- [Monitoring](TEMPLATE_SUMMARY.md#monitoring)

## Common Tasks

### Send a Task Status Change Email
```typescript
// See: QUICK_REFERENCE.md → Send Task Status Change
const { html, text } = this.emailTemplateService.renderMultipart(
  'task/status-change.html',
  { userName, taskName, oldStatus, newStatus, actionUrl }
);
```
[Full Example →](USAGE_EXAMPLES.md#example-1-task-status-change-notification)

### Send a Low Stock Alert
```typescript
// See: QUICK_REFERENCE.md → Send Low Stock Alert
const { html, text } = this.emailTemplateService.renderMultipart(
  'stock/low-stock.html',
  { itemName, currentQuantity, reorderPoint, suggestedOrderQuantity }
);
```
[Full Example →](USAGE_EXAMPLES.md#example-3-low-stock-alert)

### Create a Custom Template
```html
<!-- See: README.md → Creating Custom Templates -->
<p>Hello {{userName}},</p>
<div class="info-box">
  <!-- Your content here -->
</div>
```
[Full Guide →](README.md#creating-custom-templates)

### Test Templates in Browser
```typescript
// See: QUICK_REFERENCE.md → Preview in Browser
@Get('preview/:template')
preview(@Param('template') template: string) {
  return this.emailTemplateService.render(template, sampleData);
}
```
[Full Example →](USAGE_EXAMPLES.md#preview-template-in-browser)

## Service Methods Reference

| Method | Quick Link | Documentation |
|--------|------------|---------------|
| `render()` | [Quick Ref](QUICK_REFERENCE.md#basic-rendering) | [Full Docs](README.md#usage) |
| `renderMultipart()` | [Quick Ref](QUICK_REFERENCE.md#multipart-email) | [Full Docs](README.md#render-with-multipart-texthtml) |
| `clearCache()` | [Quick Ref](QUICK_REFERENCE.md#service-methods) | [Full Docs](README.md#cache-management) |
| `warmupCache()` | [Quick Ref](QUICK_REFERENCE.md#service-methods) | [Full Docs](README.md#cache-management) |

## Environment Variables Reference

| Variable | Required | Default | Documentation |
|----------|----------|---------|---------------|
| `COMPANY_NAME` | No | "Sua Empresa" | [README](README.md#environment-variables) |
| `COMPANY_EMAIL` | No | "contato@empresa.com" | [README](README.md#environment-variables) |
| `COMPANY_LOGO_URL` | No | - | [README](README.md#environment-variables) |
| `APP_URL` | Yes | - | [Usage Examples](USAGE_EXAMPLES.md#environment-configuration) |
| `SMTP_HOST` | Yes* | - | [Usage Examples](USAGE_EXAMPLES.md#environment-configuration) |

*Required if using email sending functionality

[Complete Environment Setup →](USAGE_EXAMPLES.md#environment-configuration)

## Handlebars Helpers Reference

### Comparison
- `{{#if (eq a b)}}` - [Docs](README.md#handlebars-helpers) | [Examples](QUICK_REFERENCE.md#conditionals)
- `{{#if (and a b)}}` - [Docs](README.md#handlebars-helpers) | [Examples](QUICK_REFERENCE.md#conditionals)

### Formatting
- `{{formatDate date 'short'}}` - [Docs](README.md#handlebars-helpers) | [Examples](QUICK_REFERENCE.md#formatting)
- `{{currency value 'BRL'}}` - [Docs](README.md#handlebars-helpers) | [Examples](QUICK_REFERENCE.md#formatting)

[View All Helpers →](README.md#handlebars-helpers)

## Troubleshooting Index

| Problem | Solution Link |
|---------|--------------|
| Template not found | [README](README.md#troubleshooting) |
| Variables not rendering | [Quick Ref](QUICK_REFERENCE.md#troubleshooting) |
| Styling issues in Outlook | [README](README.md#browseremail-client-compatibility) |
| Poor performance | [Summary](TEMPLATE_SUMMARY.md#performance-considerations) |
| Cache not updating | [README](README.md#cache-management) |

## Integration Examples

### With Queue System
[Bull Queue Integration →](USAGE_EXAMPLES.md#example-2-task-assignment-with-queue-integration)

### With Event Emitters
[Event Listener Integration →](USAGE_EXAMPLES.md#example-8-integration-with-event-emitters)

### With File Attachments
[Email with PDF Attachment →](USAGE_EXAMPLES.md#example-4-order-overdue-with-attachments)

### Batch Sending
[Batch Email Sending →](USAGE_EXAMPLES.md#example-6-batch-deadline-reminders)

## Testing Resources

### Unit Tests
[Test Examples →](USAGE_EXAMPLES.md#unit-test-example)

### Preview Templates
[Browser Preview →](USAGE_EXAMPLES.md#preview-template-in-browser)

### Send Test Emails
[Test Email →](USAGE_EXAMPLES.md#send-test-email)

## Best Practices

### Development
- [Creating Custom Templates](README.md#creating-custom-templates)
- [Performance Optimization](TEMPLATE_SUMMARY.md#performance-considerations)
- [Security Features](TEMPLATE_SUMMARY.md#security-features)

### Design
- [Responsive Design](TEMPLATE_SUMMARY.md#template-features)
- [Email Client Compatibility](TEMPLATE_SUMMARY.md#browseremail-client-compatibility)
- [Styled Components](README.md#styling-components)

### Maintenance
- [Updating Templates](TEMPLATE_SUMMARY.md#maintenance)
- [Cache Management](README.md#cache-management)
- [Monitoring](TEMPLATE_SUMMARY.md#monitoring)

## Version Information

**Current Version:** 1.0.0
**Last Updated:** 2026-01-05
**Dependencies:**
- handlebars: ^4.7.8
- @types/handlebars: ^4.0.40

[Changelog →](TEMPLATE_SUMMARY.md#changelog)

## Support

### Documentation Issues
If you find any issues with the documentation or have suggestions:
1. Check existing documentation
2. Review code comments in service file
3. Contact development team

### Template Issues
If you encounter template rendering issues:
1. Check [Troubleshooting](README.md#troubleshooting)
2. Review [Common Issues](QUICK_REFERENCE.md#troubleshooting)
3. Test with sample data
4. Verify environment configuration

### Feature Requests
For new templates or features:
1. Review existing templates
2. Check if generic template can be used
3. Follow [Creating Custom Templates](README.md#creating-custom-templates)
4. Contact development team for complex requirements

## Next Steps

1. **New to the system?** Start with [Quick Reference](QUICK_REFERENCE.md)
2. **Implementing email?** See [Usage Examples](USAGE_EXAMPLES.md)
3. **Need complete details?** Read [README](README.md)
4. **Want an overview?** Check [Template Summary](TEMPLATE_SUMMARY.md)

---

**Happy Email Templating!**

For questions or contributions, contact the development team.
