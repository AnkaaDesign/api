// human-resources.module.ts

import { Module } from '@nestjs/common';
import { BonusModule } from './bonus/bonus.module';
import { PayrollModule } from './payroll/payroll.module';
import { HrStatisticsModule } from './statistics/hr-statistics.module';

@Module({
  imports: [BonusModule, PayrollModule, HrStatisticsModule],
  exports: [BonusModule, PayrollModule, HrStatisticsModule],
})
export class HumanResourcesModule {}
