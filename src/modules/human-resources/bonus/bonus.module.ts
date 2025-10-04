// bonus.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { BonusController } from './bonus.controller';
import { BonusService } from './bonus.service';
import { ExactBonusCalculationService } from './exact-bonus-calculation.service';
import { BonusDiscountService } from './bonus-discount.service';
import { BonusRepository } from './repositories/bonus/bonus.repository';
import { BonusPrismaRepository } from './repositories/bonus/bonus-prisma.repository';
import { BonusDiscountRepository } from './repositories/bonus-discount/bonus-discount.repository';
import { BonusDiscountPrismaRepository } from './repositories/bonus-discount/bonus-discount-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { SchedulerModule } from '@modules/common/scheduler/scheduler.module';
import { UserModule } from '@modules/people/user/user.module';
import { PositionModule } from '@modules/people/position/position.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    UserModule,
    PositionModule,
    forwardRef(() => SchedulerModule),
  ],
  controllers: [BonusController],
  providers: [
    BonusService,
    ExactBonusCalculationService,
    BonusDiscountService,
    {
      provide: BonusRepository,
      useClass: BonusPrismaRepository,
    },
    {
      provide: BonusDiscountRepository,
      useClass: BonusDiscountPrismaRepository,
    },
  ],
  exports: [BonusService, ExactBonusCalculationService, BonusDiscountService, BonusRepository],
})
export class BonusModule {}
