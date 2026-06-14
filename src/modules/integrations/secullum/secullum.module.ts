import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SecullumService } from './secullum.service';
import { SecullumBrowserSignerService } from './secullum-browser-signer.service';
import { SecullumController } from './secullum.controller';
import { SecullumCadastrosService } from './secullum-cadastros.service';
import { SecullumCadastrosController } from './secullum-cadastros.controller';
import { SecullumStatisticsService } from './secullum-statistics.service';
import { UserSecullumSyncService } from './user-secullum-sync.service';
import { SecullumVacationSyncService } from './secullum-vacation-sync.service';
import { CacheModule } from '@modules/common/cache/cache.module';
import { UserModule } from '@modules/people/user/user.module';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { TimeEntryReminderService } from './time-entry-reminder/time-entry-reminder.service';
import { TimeEntryReminderScheduler } from './time-entry-reminder/time-entry-reminder.scheduler';
import { TimeEntryReminderController } from './time-entry-reminder/time-entry-reminder.controller';
import { HOLIDAY_PROVIDER } from '@modules/common/notification/work-schedule.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CacheModule,
    // forwardRef closes the loop: UserModule now imports SecullumModule so
    // UserService can inject UserSecullumSyncService directly.
    forwardRef(() => UserModule),
    PrismaModule,
    forwardRef(() => NotificationModule),
  ],
  providers: [
    SecullumService,
    SecullumBrowserSignerService,
    SecullumCadastrosService,
    SecullumStatisticsService,
    UserSecullumSyncService,
    SecullumVacationSyncService,
    TimeEntryReminderService,
    TimeEntryReminderScheduler,
    {
      provide: HOLIDAY_PROVIDER,
      useExisting: SecullumService,
    },
  ],
  controllers: [SecullumController, SecullumCadastrosController, TimeEntryReminderController],
  exports: [
    SecullumService,
    SecullumCadastrosService,
    SecullumStatisticsService,
    UserSecullumSyncService,
    SecullumVacationSyncService,
    TimeEntryReminderService,
    TimeEntryReminderScheduler,
  ],
})
export class SecullumModule {}
