import { Module } from '@nestjs/common';
import {
  MaintenanceController,
  MaintenanceItemController,
  MaintenanceScheduleController,
} from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceItemService } from './maintenance-item.service';
import { MaintenanceScheduleService } from './maintenance-schedule.service';
import { MaintenanceRepository } from './repositories/maintenance/maintenance.repository';
import { MaintenancePrismaRepository } from './repositories/maintenance/maintenance-prisma.repository';
import { MaintenanceItemRepository } from './repositories/maintenance-item/maintenance-item.repository';
import { MaintenanceItemPrismaRepository } from './repositories/maintenance-item/maintenance-item-prisma.repository';
import { MaintenanceScheduleRepository } from './repositories/maintenance-schedule/maintenance-schedule.repository';
import { MaintenanceSchedulePrismaRepository } from './repositories/maintenance-schedule/maintenance-schedule-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, ActivityModule],
  controllers: [MaintenanceController, MaintenanceItemController, MaintenanceScheduleController],
  providers: [
    MaintenanceService,
    MaintenanceItemService,
    MaintenanceScheduleService,
    {
      provide: MaintenanceRepository,
      useClass: MaintenancePrismaRepository,
    },
    {
      provide: MaintenanceItemRepository,
      useClass: MaintenanceItemPrismaRepository,
    },
    {
      provide: MaintenanceScheduleRepository,
      useClass: MaintenanceSchedulePrismaRepository,
    },
  ],
  exports: [
    MaintenanceService,
    MaintenanceRepository,
    MaintenanceScheduleService,
    MaintenanceScheduleRepository,
  ],
})
export class MaintenanceModule {}
