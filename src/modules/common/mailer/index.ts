// Mailer Module Exports
export { MailerModule } from './mailer.module';

// Services
export { EmailService } from './services/email.service';
export { MailerService } from './services/mailer.service';
export { EmailTemplateService } from './services/email-template.service';
export { NotificationMailerService } from './services/notification-mailer.service';

// Repositories
export { MailerRepository, MailerResult } from './repositories/mailer.repository';
export { NodemailRepository } from './repositories/nodemail.repository';

// Types and Interfaces
export type {
  EmailDeliveryResult,
  BulkEmailDeliveryResult,
  NotificationEmailData,
} from './services/mailer.service';

export type {
  BaseTemplateData,
  NotificationTemplateData,
  RenderedTemplate,
} from './services/email-template.service';

export type {
  NotificationEmailRequest,
  BulkNotificationEmailRequest,
} from './services/notification-mailer.service';

export type {
  EmailVerificationData,
  PasswordResetData,
  PasswordChangedData,
  AccountStatusData,
  WelcomeEmailData,
  BaseEmailData,
} from './services/email.service';
