import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TimeEntryReminderService } from './time-entry-reminder.service';
import { TimeEntryReminderScheduler } from './time-entry-reminder.scheduler';
import { TimeEntryReminderController } from './time-entry-reminder.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { SecullumModule } from '../secullum.module';
import { NotificationModule } from '@modules/common/notification/notification.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    forwardRef(() => SecullumModule),
    NotificationModule,
  ],
  controllers: [TimeEntryReminderController],
  providers: [TimeEntryReminderService, TimeEntryReminderScheduler],
  exports: [TimeEntryReminderService, TimeEntryReminderScheduler],
})
export class TimeEntryReminderModule {}
