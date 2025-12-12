// team-staff.controller.ts
// Controller for team leader's managed sector data endpoints
// All endpoints filter data by authenticated leader's managed sector from database
// SECURITY: managedSectorId is ALWAYS fetched from database via Sector.managerId, NEVER from client/JWT
// NOTE: Authorization is handled by TeamStaffService.validateTeamLeader() which checks Sector.managerId

import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { TeamStaffService } from './team-staff.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { ZodQueryValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit } from '@modules/common/throttler/throttler.decorators';
import type {
  VacationGetManyResponse,
  BorrowGetManyResponse,
  PpeDeliveryGetManyResponse,
  ActivityGetManyResponse,
  WarningGetManyResponse,
  UserGetManyResponse,
} from '../../../types';
import type {
  VacationGetManyFormData,
  BorrowGetManyFormData,
  PpeDeliveryGetManyFormData,
  ActivityGetManyFormData,
  WarningGetManyFormData,
  UserGetManyFormData,
} from '../../../schemas';
import {
  vacationGetManySchema,
  borrowGetManySchema,
  ppeDeliveryGetManySchema,
  activityGetManySchema,
  warningGetManySchema,
  userGetManySchema,
} from '../../../schemas';

/**
 * Team Staff Controller
 * Provides secure endpoints for team leaders to access data from their managed sector
 *
 * CRITICAL SECURITY FEATURES:
 * - All endpoints require authentication (AuthGuard)
 * - Authorization: TeamStaffService.validateTeamLeader() checks if user is a sector manager (Sector.managerId = userId)
 * - managedSectorId is ALWAYS fetched fresh from database for each request via Sector.managerId relation
 * - Client-provided sectorId filters are ALWAYS overridden with database managedSectorId
 * - Returns 403 Forbidden if user is not a sector manager (no sector has this user as managerId)
 *
 * Routes:
 * - GET /team-staff/users - Get users from the leader's managed sector
 * - GET /team-staff/calculations - Get Secullum calculations for team members
 * - GET /team-staff/borrows - Get borrows for team members
 * - GET /team-staff/vacations - Get vacations for team members
 * - GET /team-staff/epis - Get EPI deliveries for team members
 * - GET /team-staff/activities - Get activities for team members
 * - GET /team-staff/warnings - Get warnings for team members
 */
@Controller('team-staff')
@UseGuards(AuthGuard)
export class TeamStaffController {
  private readonly logger = new Logger(TeamStaffController.name);

  constructor(private readonly teamStaffService: TeamStaffService) {}

  // =====================
  // TEAM USERS
  // =====================

  /**
   * Get users from the leader's managed sector
   * Security: Filters users by managed sector from database (Sector.managerId)
   * Returns 403 if user is not a team leader (no sector has this user as managerId)
   */
  @Get('users')
  @ReadRateLimit()
  async getTeamUsers(
    @Query(new ZodQueryValidationPipe(userGetManySchema)) query: UserGetManyFormData,
    @UserId() userId: string,
  ): Promise<UserGetManyResponse> {
    this.logger.log(`[Team Users] Request from user: ${userId}`);
    return this.teamStaffService.getTeamUsers(userId, query);
  }

  // =====================
  // TEAM SECULLUM CALCULATIONS
  // =====================

  /**
   * Get Secullum calculations for a specific team member
   * Security: Validates target user belongs to the leader's managed sector
   * Returns 403 if user is not a team leader (no sector has this user as managerId)
   * Returns 403 if target user is not in the managed sector
   * Requires startDate, endDate, and userId query parameters
   *
   * @param userId - The target team member's Ankaa user ID
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - End date in YYYY-MM-DD format
   */
  @Get('calculations')
  @ReadRateLimit()
  async getTeamCalculations(
    @Query('userId') targetUserId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('page') page?: string,
    @Query('take') take?: string,
    @UserId() authenticatedUserId?: string,
  ): Promise<{
    success: boolean;
    message?: string;
    data?: any;
  }> {
    this.logger.log(`[Team Calculations] Leader ${authenticatedUserId} requesting calculations for team member ${targetUserId}`);
    return this.teamStaffService.getTeamMemberCalculations(authenticatedUserId!, {
      targetUserId,
      startDate,
      endDate,
      page: page ? parseInt(page) : undefined,
      take: take ? parseInt(take) : undefined,
    });
  }

  // =====================
  // TEAM BORROWS
  // =====================

  /**
   * Get borrows for team members
   * Security: Filters borrows by users in managed sector from database (Sector.managerId)
   * Returns 403 if user is not a team leader (no sector has this user as managerId)
   */
  @Get('borrows')
  @ReadRateLimit()
  async getTeamBorrows(
    @Query(new ZodQueryValidationPipe(borrowGetManySchema)) query: BorrowGetManyFormData,
    @UserId() userId: string,
  ): Promise<BorrowGetManyResponse> {
    this.logger.log(`[Team Borrows] Request from user: ${userId}`);
    return this.teamStaffService.getTeamBorrows(userId, query);
  }

  // =====================
  // TEAM VACATIONS
  // =====================

  /**
   * Get vacations for team members
   * Security: Filters vacations by users in managed sector from database (Sector.managerId)
   * Returns 403 if user is not a team leader (no sector has this user as managerId)
   */
  @Get('vacations')
  @ReadRateLimit()
  async getTeamVacations(
    @Query(new ZodQueryValidationPipe(vacationGetManySchema)) query: VacationGetManyFormData,
    @UserId() userId: string,
  ): Promise<VacationGetManyResponse> {
    this.logger.log(`[Team Vacations] Request from user: ${userId}`);
    return this.teamStaffService.getTeamVacations(userId, query);
  }

  // =====================
  // TEAM EPIs (PPE DELIVERIES)
  // =====================

  /**
   * Get EPI (PPE) deliveries for team members
   * Security: Filters EPI deliveries by users in managed sector from database (Sector.managerId)
   * Returns 403 if user is not a team leader (no sector has this user as managerId)
   */
  @Get('epis')
  @ReadRateLimit()
  async getTeamEpis(
    @Query(new ZodQueryValidationPipe(ppeDeliveryGetManySchema)) query: PpeDeliveryGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    this.logger.log(`[Team EPIs] Request from user: ${userId}`);
    return this.teamStaffService.getTeamEpis(userId, query);
  }

  // =====================
  // TEAM ACTIVITIES
  // =====================

  /**
   * Get inventory activities for team members
   * Security: Filters activities by users in managed sector from database (Sector.managerId)
   * Returns 403 if user is not a team leader (no sector has this user as managerId)
   */
  @Get('activities')
  @ReadRateLimit()
  async getTeamActivities(
    @Query(new ZodQueryValidationPipe(activityGetManySchema)) query: ActivityGetManyFormData,
    @UserId() userId: string,
  ): Promise<ActivityGetManyResponse> {
    this.logger.log(`[Team Activities] Request from user: ${userId}`);
    return this.teamStaffService.getTeamActivities(userId, query);
  }

  // =====================
  // TEAM WARNINGS
  // =====================

  /**
   * Get warnings for team members
   * Security: Filters warnings by collaborators in managed sector from database (Sector.managerId)
   * Returns 403 if user is not a team leader (no sector has this user as managerId)
   */
  @Get('warnings')
  @ReadRateLimit()
  async getTeamWarnings(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
    @UserId() userId: string,
  ): Promise<WarningGetManyResponse> {
    this.logger.log(`[Team Warnings] Request from user: ${userId}`);
    return this.teamStaffService.getTeamWarnings(userId, query);
  }
}
