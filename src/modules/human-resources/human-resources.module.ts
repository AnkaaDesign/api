// human-resources.module.ts

import { Module } from '@nestjs/common';
import { BonusModule } from './bonus/bonus.module';
import { PayrollModule } from './payroll/payroll.module';

@Module({
  imports: [BonusModule, PayrollModule],
  exports: [BonusModule, PayrollModule],
})
export class HumanResourcesModule {}
