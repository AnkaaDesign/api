import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SecullumService } from './secullum.service';
import { SecullumController } from './secullum.controller';
import { CacheModule } from '@modules/common/cache/cache.module';
import { UserModule } from '@modules/people/user/user.module';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { TimeEntryReminderService } from './time-entry-reminder/time-entry-reminder.service';
import { TimeEntryReminderScheduler } from './time-entry-reminder/time-entry-reminder.scheduler';
import { TimeEntryReminderController } from './time-entry-reminder/time-entry-reminder.controller';
import { HOLIDAY_PROVIDER } from '@modules/common/notification/work-schedule.service';

@Module({
  imports: [ScheduleModule.forRoot(), CacheModule, UserModule, PrismaModule, NotificationModule],
  providers: [
    SecullumService,
    TimeEntryReminderService,
    TimeEntryReminderScheduler,
    {
      provide: HOLIDAY_PROVIDER,
      useExisting: SecullumService,
    },
  ],
  controllers: [SecullumController, TimeEntryReminderController],
  exports: [SecullumService, TimeEntryReminderService, TimeEntryReminderScheduler],
})
export class SecullumModule {}
