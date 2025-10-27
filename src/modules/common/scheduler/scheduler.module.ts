import { Module, forwardRef } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { BonusCronService } from './bonus-cron.service';
import { CronService } from '../../cron/cron.service';
import { ScheduleModule } from '@nestjs/schedule';
import { ItemModule } from '../../inventory/item/item.module';
import { BonusModule } from '../../human-resources/bonus/bonus.module';
import { UserModule } from '../../people/user/user.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ItemModule,
    forwardRef(() => BonusModule),
    UserModule,
  ],
  providers: [SchedulerService, BonusCronService, CronService],
  exports: [SchedulerService, BonusCronService, CronService],
})
export class SchedulerModule {}
