import { BullModule } from '@nestjs/bull';
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule as NestEventEmitterModule } from '@nestjs/event-emitter';
import { NotificationQueueProcessor } from './notification-queue.processor';
import { NotificationQueueService } from './notification-queue.service';
import { NotificationQueueMonitorService } from './notification-queue-monitor.service';
import { NotificationQueueHealthIndicator } from './notification-queue.health';
import { NotificationQueueMonitorController } from './notification-queue-monitor.controller';
import { NotificationQueueHealthController } from './notification-queue-health.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MailerModule } from '../mailer/mailer.module';
import { SmsModule } from '../sms/sms.module';
import { PushModule } from '../push/push.module';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { UserPrismaRepository } from '@modules/people/user/repositories/user-prisma.repository';
import { WhatsAppNotificationService } from './whatsapp/whatsapp.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    MailerModule,
    SmsModule,
    PushModule,
    WhatsAppModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
    }),
    BullModule.registerQueue({
      name: 'notification',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
      settings: {
        stalledInterval: 30000, // 30 seconds
        maxStalledCount: 2,
      },
    }),
  ],
  controllers: [NotificationQueueMonitorController, NotificationQueueHealthController],
  providers: [
    NotificationQueueProcessor,
    NotificationQueueService,
    NotificationQueueMonitorService,
    NotificationQueueHealthIndicator,
    WhatsAppNotificationService,
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: [
    NotificationQueueService,
    NotificationQueueMonitorService,
    NotificationQueueHealthIndicator,
  ],
})
export class NotificationQueueModule {}
