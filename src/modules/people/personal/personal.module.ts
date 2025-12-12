// personal.module.ts
import { Module } from '@nestjs/common';
import { PersonalController } from './personal.controller';
import { PersonalBonusController } from './personal-bonus.controller';
import { PersonalService } from './personal.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { VacationModule } from '../vacation/vacation.module';
import { BorrowModule } from '@modules/inventory/borrow/borrow.module';
import { PpeModule } from '@modules/inventory/ppe/ppe.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';
import { BonusModule } from '@modules/human-resources/bonus/bonus.module';
import { WarningModule } from '../warning/warning.module';

/**
 * Personal Module
 * Provides user-specific endpoints for accessing personal data
 * All endpoints automatically filter data by authenticated user
 *
 * Controllers:
 * - PersonalController (/personal/*) - vacations, loans, EPIs, activities, warnings, holidays
 * - PersonalBonusController (/bonuses/*) - personal bonus data (my-bonuses, my-live-bonus)
 */
@Module({
  imports: [
    PrismaModule,
    UserModule, // Required for AuthGuard (provides UserRepository)
    VacationModule,
    BorrowModule,
    PpeModule,
    ActivityModule,
    SecullumModule, // Required for Secullum calculations
    BonusModule, // Required for bonus/my-bonuses endpoints
    WarningModule, // Required for warnings/my-warnings endpoints
  ],
  controllers: [PersonalController, PersonalBonusController],
  providers: [PersonalService],
  exports: [PersonalService],
})
export class PersonalModule {}
