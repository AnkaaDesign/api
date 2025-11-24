// personal.module.ts
import { Module } from '@nestjs/common';
import { PersonalController } from './personal.controller';
import { PersonalService } from './personal.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { VacationModule } from '../vacation/vacation.module';
import { BorrowModule } from '@modules/inventory/borrow/borrow.module';
import { PpeModule } from '@modules/inventory/ppe/ppe.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';

/**
 * Personal Module
 * Provides user-specific endpoints for accessing personal data
 * All endpoints automatically filter data by authenticated user
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
  ],
  controllers: [PersonalController],
  providers: [PersonalService],
  exports: [PersonalService],
})
export class PersonalModule {}
