// activity.module.ts

import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityRepository } from './repositories/activity.repository';
import { ActivityPrismaRepository } from './repositories/activity-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { EnhancedActivityService } from '../services/enhanced-activity.service';
import { AtomicStockCalculatorService } from '../services/atomic-stock-calculator.service';
import { AtomicStockUpdateService } from '../services/atomic-stock-update.service';
import { StockErrorHandlerService } from '../services/stock-error-handler.service';
import { ConsumptionAnalyticsService } from './consumption-analytics.service';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    ConsumptionAnalyticsService,
    EnhancedActivityService,
    AtomicStockCalculatorService,
    AtomicStockUpdateService,
    StockErrorHandlerService,
    {
      provide: ActivityRepository,
      useClass: ActivityPrismaRepository,
    },
  ],
  exports: [
    ActivityService,
    ActivityRepository,
    EnhancedActivityService,
    ConsumptionAnalyticsService,
  ],
})
export class ActivityModule {}
