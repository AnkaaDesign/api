import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { ItemModule } from '@modules/inventory/item/item.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';

// Controller
import { PpeController } from './ppe.controller';

// Services
import { PpeSizeService } from './ppe-size.service';
import { PpeDeliveryService } from './ppe-delivery.service';
import { PpeDeliveryScheduleService } from './ppe-delivery-schedule.service';

// Repositories
import { PpeSizeRepository } from './repositories/ppe-size/ppe-size.repository';
import { PpeSizePrismaRepository } from './repositories/ppe-size/ppe-size-prisma.repository';
import { PpeDeliveryRepository } from './repositories/ppe-delivery/ppe-delivery.repository';
import { PpeDeliveryPrismaRepository } from './repositories/ppe-delivery/ppe-delivery-prisma.repository';
import { PpeDeliveryScheduleRepository } from './repositories/ppe-delivery-schedule/ppe-delivery-schedule.repository';
import { PpeDeliverySchedulePrismaRepository } from './repositories/ppe-delivery-schedule/ppe-delivery-schedule-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule, ItemModule, ActivityModule],
  controllers: [PpeController],
  providers: [
    // Services
    PpeSizeService,
    PpeDeliveryService,
    PpeDeliveryScheduleService,
    // Repositories
    {
      provide: PpeSizeRepository,
      useClass: PpeSizePrismaRepository,
    },
    {
      provide: PpeDeliveryRepository,
      useClass: PpeDeliveryPrismaRepository,
    },
    {
      provide: PpeDeliveryScheduleRepository,
      useClass: PpeDeliverySchedulePrismaRepository,
    },
  ],
  exports: [PpeSizeService, PpeDeliveryService, PpeDeliveryScheduleService],
})
export class PpeModule {}
