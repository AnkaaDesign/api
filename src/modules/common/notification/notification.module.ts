import { Module, forwardRef } from '@nestjs/common';
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
import { NotificationUserPreferenceController } from './notification-user-preference.controller';
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
import { NotificationConfigurationService } from './notification-configuration.service';
import { NotificationRecipientResolverService } from './notification-recipient-resolver.service';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
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
import { NotificationConfigurationRepository } from './repositories/notification-configuration.repository';
import { NotificationConfigurationPrismaRepository } from './repositories/notification-configuration-prisma.repository';
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
import { NotificationConfigurationController } from './notification-configuration.controller';
import { WhatsAppNotificationService } from './whatsapp/whatsapp.service';
import { WhatsAppMessageFormatterService } from './whatsapp/whatsapp-message-formatter.service';
import { NotificationTemplateRendererService } from './notification-template-renderer.service';
import { NotificationQueueModule } from './notification-queue.module';
import { PushModule } from '../push/push.module';
import { UserModule } from '@modules/people/user/user.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MailerModule } from '../mailer/mailer.module';
import { WorkScheduleService, HOLIDAY_PROVIDER } from './work-schedule.service';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    CacheModule,
    ConfigModule,
    MailerModule,
    forwardRef(() => UserModule),
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
    NotificationUserPreferenceController,
    NotificationConfigurationController,
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
    WhatsAppMessageFormatterService,
    NotificationTemplateRendererService,
    NotificationConfigurationService,
    NotificationRecipientResolverService,
    NotificationChannelResolverService,
    WorkScheduleService,
    {
      provide: HOLIDAY_PROVIDER,
      useValue: null, // Will be overridden when SecullumModule provides it
    },
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
      provide: NotificationConfigurationRepository,
      useClass: NotificationConfigurationPrismaRepository,
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
    NotificationConfigurationService,
    EmailTemplateService,
    DeepLinkService,
    NotificationPreferenceService,
    NotificationPreferenceInitService,
    NotificationDeliveryRepository,
    WhatsAppNotificationService,
    WhatsAppMessageFormatterService,
    NotificationTemplateRendererService,
    WorkScheduleService,
  ],
})
export class NotificationModule {}
