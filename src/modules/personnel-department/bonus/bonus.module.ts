// bonus.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { BonusController } from './bonus.controller';
import { BonusService } from './bonus.service';
import { BonusCalculationService } from './bonus-calculation.service';
import { BonusCalculationContextService } from './bonus-calculation-context.service';
import { BonusEligibilityService } from './bonus-eligibility.service';
import { BonusAbsenceService } from './bonus-absence.service';
import { BonusDiscountService } from './bonus-discount.service';
import { BonusTerminationListener } from './bonus-termination.listener';
import { SecullumBonusIntegrationService } from './secullum-bonus-integration.service';
import { BonusRepository } from './repositories/bonus/bonus.repository';
import { BonusPrismaRepository } from './repositories/bonus/bonus-prisma.repository';
import { BonusDiscountRepository } from './repositories/bonus-discount/bonus-discount.repository';
import { BonusDiscountPrismaRepository } from './repositories/bonus-discount/bonus-discount-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { SchedulerModule } from '@modules/common/scheduler/scheduler.module';
import { UserModule } from '@modules/people/user/user.module';
import { PositionModule } from '@modules/people/position/position.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';
import { NotificationModule } from '@modules/common/notification/notification.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    UserModule,
    PositionModule,
    SecullumModule,
    NotificationModule,
    forwardRef(() => SchedulerModule),
  ],
  controllers: [BonusController],
  providers: [
    BonusService,
    BonusCalculationService,
    BonusCalculationContextService,
    BonusEligibilityService,
    BonusAbsenceService,
    BonusDiscountService,
    BonusTerminationListener,
    SecullumBonusIntegrationService,
    {
      provide: BonusRepository,
      useClass: BonusPrismaRepository,
    },
    {
      provide: BonusDiscountRepository,
      useClass: BonusDiscountPrismaRepository,
    },
  ],
  exports: [
    BonusService,
    BonusCalculationService,
    BonusCalculationContextService,
    BonusEligibilityService,
    BonusAbsenceService,
    BonusDiscountService,
    BonusRepository,
  ],
})
export class BonusModule {}
