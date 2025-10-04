// apps/api/src/modules/inventory/statistics/inventory-statistics.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { InventoryStatisticsController } from './inventory-statistics.controller';
import { InventoryStatisticsService } from './inventory-statistics.service';
import { InventoryStatisticsRepository } from './repositories/inventory-statistics.repository';
import { InventoryStatisticsPrismaRepository } from './repositories/inventory-statistics-prisma.repository';

@Module({
  imports: [PrismaModule],
  controllers: [InventoryStatisticsController],
  providers: [
    InventoryStatisticsService,
    {
      provide: InventoryStatisticsRepository,
      useClass: InventoryStatisticsPrismaRepository,
    },
  ],
  exports: [InventoryStatisticsService],
})
export class InventoryStatisticsModule {}