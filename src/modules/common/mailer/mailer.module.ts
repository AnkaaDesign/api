import { Module } from '@nestjs/common';
import { MailerRepository } from './repositories/mailer.repository';
import { NodemailRepository } from './repositories/nodemail.repository';
import { EmailService } from './services/email.service';

@Module({
  exports: [MailerRepository, EmailService],
  providers: [
    {
      provide: MailerRepository,
      useClass: NodemailRepository,
    },
    EmailService,
  ],
})
export class MailerModule {}
