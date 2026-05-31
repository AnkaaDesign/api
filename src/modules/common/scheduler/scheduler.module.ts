import { Module, forwardRef } from '@nestjs/common';
import { BonusCronService } from './bonus-cron.service';
import { CronService } from '../../cron/cron.service';
import { InventoryCronService } from '../../inventory/services/inventory-cron.service';
import { ScheduleModule } from '@nestjs/schedule';
import { ItemModule } from '../../inventory/item/item.module';
import { BonusModule } from '../../human-resources/bonus/bonus.module';
import { PayrollModule } from '../../human-resources/payroll/payroll.module';
import { UserModule } from '../../people/user/user.module';
import { OrderModule } from '../../inventory/order/order.module';
import { PpeModule } from '../../inventory/ppe/ppe.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChangeLogModule } from '../changelog/changelog.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ItemModule,
    forwardRef(() => BonusModule),
    forwardRef(() => PayrollModule),
    UserModule,
    OrderModule,
    forwardRef(() => PpeModule),
    PrismaModule,
    ChangeLogModule,
    NotificationModule,
  ],
  providers: [BonusCronService, CronService, InventoryCronService],
  exports: [BonusCronService, CronService, InventoryCronService],
})
export class SchedulerModule {}
