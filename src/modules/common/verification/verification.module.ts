import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { UserPrismaRepository } from '@modules/people/user/repositories/user-prisma.repository';
import { VerificationThrottlerService } from '../throttler/verification-throttler.service';
import { SmsModule } from '../sms/sms.module';
import { MailerModule } from '../mailer/mailer.module';
import { ChangeLogModule } from '../changelog/changelog.module';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [SmsModule, MailerModule, ChangeLogModule, PrismaModule],
  providers: [
    VerificationService,
    VerificationThrottlerService,
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
