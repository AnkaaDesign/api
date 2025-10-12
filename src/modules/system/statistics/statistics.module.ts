import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

// Controller
import { StatisticsController } from './statistics.controller';

// Services
import { InventoryStatisticsService } from './services/inventory-statistics.service';
import { ProductionStatisticsService } from './services/production-statistics.service';
import { OrdersStatisticsService } from './services/orders-statistics.service';
import { HrStatisticsService } from './services/hr-statistics.service';
import { FinancialStatisticsService } from './services/financial-statistics.service';

@Module({
  imports: [PrismaModule],
  controllers: [StatisticsController],
  providers: [
    InventoryStatisticsService,
    ProductionStatisticsService,
    OrdersStatisticsService,
    HrStatisticsService,
    FinancialStatisticsService,
  ],
  exports: [
    InventoryStatisticsService,
    ProductionStatisticsService,
    OrdersStatisticsService,
    HrStatisticsService,
    FinancialStatisticsService,
  ],
})
export class StatisticsModule {}
