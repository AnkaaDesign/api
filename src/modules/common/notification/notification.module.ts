import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { CacheModule } from '@modules/common/cache/cache.module';
import { NotificationController, SeenNotificationController } from './notification.controller';
import {
  NotificationPreferenceController,
  NotificationPreferenceDefaultsController,
} from './notification-preference.controller';
import { NotificationAdminController } from './notification-admin.controller';
import { NotificationAggregationController } from './notification-aggregation.controller';
import { NotificationService } from './notification.service';
import { NotificationTrackingService } from './notification-tracking.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationPreferenceInitService } from './notification-preference-init.service';
import { NotificationAggregationService } from './notification-aggregation.service';
import { NotificationAnalyticsService } from './notification-analytics.service';
import { NotificationExportService } from './notification-export.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationReminderScheduler } from './notification-reminder.scheduler';
import { NotificationReminderSchedulerService } from './notification-reminder-scheduler.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationFilterService } from './notification-filter.service';
import { NotificationReminderController } from './notification-reminder.controller';
import {
  NotificationRepository,
  SeenNotificationRepository,
} from './repositories/notification.repository';
import {
  NotificationPrismaRepository,
  SeenNotificationPrismaRepository,
} from './repositories/notification-prisma.repository';
import { NotificationPreferenceRepository } from './repositories/notification-preference.repository';
import { NotificationPreferencePrismaRepository } from './repositories/notification-preference-prisma.repository';
import { NotificationDeliveryRepository } from './repositories/notification-delivery.repository';
import { NotificationGateway } from './notification.gateway';
import { NotificationGatewayService } from './notification-gateway.service';
import { EmailTemplateService } from './email-template.service';
import { DeepLinkService } from './deep-link.service';
import { DeepLinkController } from './deep-link.controller';
import { NotificationTrackingController } from './notification-tracking.controller';
import {
  NotificationApiController,
  NotificationAdminApiController,
} from './notification-api.controller';
import { WhatsAppNotificationService } from './whatsapp/whatsapp.service';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { UserPrismaRepository } from '@modules/people/user/repositories/user-prisma.repository';
import { NotificationQueueModule } from './notification-queue.module';
import { PushModule } from '../push/push.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MailerModule } from '../mailer/mailer.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    CacheModule,
    ConfigModule,
    MailerModule,
    SmsModule,
    NotificationQueueModule,
    PushModule,
    WhatsAppModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [
    NotificationController,
    SeenNotificationController,
    NotificationTrackingController,
    NotificationApiController,
    NotificationAdminApiController,
    DeepLinkController,
    NotificationPreferenceController,
    NotificationPreferenceDefaultsController,
    NotificationAdminController,
    NotificationAggregationController,
    NotificationReminderController,
  ],
  providers: [
    NotificationService,
    NotificationTrackingService,
    NotificationGateway,
    NotificationGatewayService,
    NotificationAggregationService,
    NotificationAnalyticsService,
    NotificationExportService,
    NotificationSchedulerService,
    NotificationReminderScheduler,
    NotificationReminderSchedulerService,
    NotificationDispatchService,
    NotificationFilterService,
    EmailTemplateService,
    DeepLinkService,
    NotificationPreferenceService,
    NotificationPreferenceInitService,
    NotificationDeliveryRepository,
    WhatsAppNotificationService,
    {
      provide: NotificationRepository,
      useClass: NotificationPrismaRepository,
    },
    {
      provide: SeenNotificationRepository,
      useClass: SeenNotificationPrismaRepository,
    },
    {
      provide: NotificationPreferenceRepository,
      useClass: NotificationPreferencePrismaRepository,
    },
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: [
    NotificationService,
    NotificationTrackingService,
    NotificationGatewayService,
    NotificationAggregationService,
    NotificationAnalyticsService,
    NotificationExportService,
    NotificationSchedulerService,
    NotificationReminderSchedulerService,
    NotificationDispatchService,
    EmailTemplateService,
    DeepLinkService,
    NotificationPreferenceService,
    NotificationPreferenceInitService,
    NotificationDeliveryRepository,
    WhatsAppNotificationService,
  ],
})
export class NotificationModule {}
