import { Module } from '@nestjs/common';
import { MailerRepository } from './repositories/mailer.repository';
import { NodemailRepository } from './repositories/nodemail.repository';
import { EmailService } from './services/email.service';
import { MailerService } from './services/mailer.service';
import { EmailTemplateService } from './services/email-template.service';
import { HandlebarsTemplateService } from './services/handlebars-template.service';
import { NotificationMailerService } from './services/notification-mailer.service';

@Module({
  exports: [
    MailerRepository,
    EmailService,
    MailerService,
    EmailTemplateService,
    HandlebarsTemplateService,
    NotificationMailerService,
  ],
  providers: [
    {
      provide: MailerRepository,
      useClass: NodemailRepository,
    },
    EmailService,
    MailerService,
    EmailTemplateService,
    HandlebarsTemplateService,
    NotificationMailerService,
  ],
})
export class MailerModule {}
