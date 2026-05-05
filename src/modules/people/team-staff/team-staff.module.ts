// team-staff.module.ts
import { Module } from '@nestjs/common';
import { TeamStaffController } from './team-staff.controller';
import { TeamStaffService } from './team-staff.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { WarningModule } from '../warning/warning.module';
import { BorrowModule } from '@modules/inventory/borrow/borrow.module';
import { PpeModule } from '@modules/inventory/ppe/ppe.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';

/**
 * Team Staff Module
 * Provides secure endpoints for team leaders to access data from their led sector
 *
 * SECURITY FEATURES:
 * - All endpoints require authentication (AuthGuard)
 * - Authorization: TeamStaffService.validateTeamLeader() checks if user is a sector leader (Sector.leaderId = userId)
 * - ledSectorId is ALWAYS fetched from database via Sector.leaderId for each request
 * - Client-provided sectorId filters are ALWAYS overridden
 * - Returns 403 Forbidden if user is not a sector leader (no sector has this user as leaderId)
 *
 * Controllers:
 * - TeamStaffController (/team-staff/*) - users, calculations, borrows, vacations, epis, activities, warnings
 */
@Module({
  imports: [
    PrismaModule,
    UserModule, // Required for AuthGuard (provides UserRepository)
    WarningModule, // Required for warning data
    BorrowModule, // Required for borrow data
    PpeModule, // Required for PPE/EPI data
    ActivityModule, // Required for activity data
    SecullumModule, // Required for Secullum calculations
  ],
  controllers: [TeamStaffController],
  providers: [TeamStaffService],
  exports: [TeamStaffService],
})
export class TeamStaffModule {}
