import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SecullumService } from './secullum.service';
import { SecullumController } from './secullum.controller';
import { SecullumCadastrosService } from './secullum-cadastros.service';
import { SecullumCadastrosController } from './secullum-cadastros.controller';
import { UserSecullumSyncService } from './user-secullum-sync.service';
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
    SecullumCadastrosService,
    UserSecullumSyncService,
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
    UserSecullumSyncService,
    TimeEntryReminderService,
    TimeEntryReminderScheduler,
  ],
})
export class SecullumModule {}
