/**
 * Mailer Service Module
 *
 * Comprehensive email notification service with:
 * - SMTP email sending via Nodemailer
 * - Handlebars template rendering
 * - Bulk email sending with rate limiting
 * - Email tracking (opens and clicks)
 * - Deep link integration
 * - Bounce handling
 * - Email validation
 */

export * from './mailer.service';
export {
  MailerService,
  SendEmailOptions,
  EmailAttachment,
  BulkEmailRecipient,
  EmailDeliveryResult,
  BulkEmailResult,
  EmailTrackingData,
  NotificationEmailTemplate,
  BounceData,
  EmailValidationResult,
} from './mailer.service';
