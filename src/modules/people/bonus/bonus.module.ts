import { Module, forwardRef } from '@nestjs/common';
import { BonusService } from './bonus.service';
import { BonusDiscountService } from './bonus-discount.service';
import { BonusController } from './bonus.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { BonusRepository } from './repositories/bonus/bonus.repository';
import { BonusPrismaRepository } from './repositories/bonus/bonus-prisma.repository';
import { BonusDiscountRepository } from './repositories/bonus-discount/bonus-discount.repository';
import { BonusDiscountPrismaRepository } from './repositories/bonus-discount/bonus-discount-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { BonusModule as HRBonusModule } from '@modules/human-resources/bonus/bonus.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    forwardRef(() => HRBonusModule), // Import HR BonusModule to get ExactBonusCalculationService
  ],
  controllers: [BonusController],
  providers: [
    BonusService,
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
  exports: [BonusService, BonusDiscountService, BonusRepository, BonusDiscountRepository],
})
export class BonusModule {}