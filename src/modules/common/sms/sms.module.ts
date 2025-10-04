import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { SmsRepository } from './repositories/sms.repository';
import { TwilioRepository } from './repositories/twilio.repository';

@Module({
  imports: [ConfigModule],
  exports: [SmsService],
  providers: [
    SmsService,
    {
      provide: SmsRepository,
      useClass: TwilioRepository,
    },
  ],
})
export class SmsModule {}
