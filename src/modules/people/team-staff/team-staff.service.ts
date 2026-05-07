// team-staff.service.ts
// Service for handling sector leader's team data queries
// All methods ensure data is filtered by the leader's sector from database (Sector.leaderId)

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BorrowService } from '@modules/inventory/borrow/borrow.service';
import { PpeDeliveryService } from '@modules/inventory/ppe/ppe-delivery.service';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import { WarningService } from '../warning/warning.service';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import type {
  BorrowGetManyResponse,
  PpeDeliveryGetManyResponse,
  ActivityGetManyResponse,
  WarningGetManyResponse,
  UserGetManyResponse,
} from '../../../types';
import type {
  BorrowGetManyFormData,
  PpeDeliveryGetManyFormData,
  ActivityGetManyFormData,
  WarningGetManyFormData,
  UserGetManyFormData,
} from '../../../schemas';

/**
 * Team Staff Service
 * Handles all sector leader data queries with automatic filtering by led sector
 * CRITICAL SECURITY: Always fetches led sector from database via Sector.leaderId, never from client/JWT
 * Ensures leaders can only access data for users in their led sector
 *
 * Note: Leadership is determined by Sector.leaderId pointing to the user,
 * not by the removed User.ledSectorId field
 */
@Injectable()
export class TeamStaffService {
  private readonly logger = new Logger(TeamStaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly borrowService: BorrowService,
    private readonly ppeDeliveryService: PpeDeliveryService,
    private readonly activityService: ActivityService,
    private readonly warningService: WarningService,
    private readonly secullumService: SecullumService,
  ) {}

  /**
   * Get the sector ID that the user leads from database
   * CRITICAL: This must be called for every request to ensure fresh data
   * Returns null if no sector has this user as leader (user is not a sector leader)
   *
   * Note: This queries Sector.leaderId instead of the removed User.ledSectorId
   */
  private async getLedSectorId(userId: string): Promise<string | null> {
    const sector = await this.prisma.sector.findFirst({
      where: { leaderId: userId },
      select: { id: true },
    });

    return sector?.id || null;
  }

  /**
   * Validate that user is a sector leader (some sector has this user as leaderId)
   * Throws 403 Forbidden if user is not a sector leader
   */
  private async validateTeamLeader(userId: string): Promise<string> {
    const ledSectorId = await this.getLedSectorId(userId);

    if (!ledSectorId) {
      throw new ForbiddenException(
        'Access denied. You must be a sector leader to access this resource.',
      );
    }

    return ledSectorId;
  }

  /**
   * Get users from the leader's led sector
   * Filters users by sectorId = ledSectorId
   *
   * @param userId - Authenticated team leader user ID
   * @param query - Query parameters for filtering/pagination
   * @returns Users in the led sector
   */
  async getTeamUsers(userId: string, query: UserGetManyFormData): Promise<UserGetManyResponse> {
    // Validate leader and get ledSectorId from database
    const ledSectorId = await this.validateTeamLeader(userId);

    this.logger.log(`Team leader ${userId} accessing users from led sector ${ledSectorId}`);

    // Force filter by led sector - NEVER trust client filters for sectorId
    const secureQuery: UserGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        sectorId: ledSectorId, // Override with database ledSectorId
      },
    };

    // Use Prisma directly for users as there's a UserService
    const result = await this.prisma.user.findMany({
      where: secureQuery.where,
      orderBy: secureQuery.orderBy,
      skip: secureQuery.skip,
      take: secureQuery.limit || 25,
      include: secureQuery.include,
    });

    const totalRecords = await this.prisma.user.count({
      where: secureQuery.where,
    });

    const take = secureQuery.limit || 25;
    const page = secureQuery.skip ? Math.floor(secureQuery.skip / take) + 1 : 1;
    const totalPages = Math.ceil(totalRecords / take);

    return {
      success: true,
      message: 'Team users loaded successfully',
      data: result as any,
      meta: {
        page,
        totalPages,
        take,
        totalRecords,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Get Secullum calculations for a specific team member
   * Validates the target user belongs to the leader's led sector
   *
   * @param leaderId - Authenticated team leader user ID
   * @param params - Query parameters including targetUserId, startDate, endDate
   * @returns Secullum calculations for the specific team member in the same format as /secullum/calculations
   */
  async getTeamMemberCalculations(
    leaderId: string,
    params: {
      targetUserId: string;
      startDate: string;
      endDate: string;
      page?: number;
      take?: number;
    },
  ): Promise<{
    success: boolean;
    message?: string;
    data?: any;
  }> {
    // Validate required parameters
    if (!params.targetUserId) {
      throw new BadRequestException('userId is required to fetch calculations for a team member');
    }
    if (!params.startDate || !params.endDate) {
      throw new BadRequestException(
        'startDate and endDate are required parameters (format: YYYY-MM-DD)',
      );
    }

    // Validate leader and get ledSectorId from database
    const ledSectorId = await this.validateTeamLeader(leaderId);

    this.logger.log(
      `Team leader ${leaderId} accessing calculations for team member ${params.targetUserId}`,
    );

    // Verify target user exists and belongs to the led sector
    const targetUser = await this.prisma.user.findUnique({
      where: { id: params.targetUserId },
      select: {
        id: true,
        name: true,
        sectorId: true,
        secullumEmployeeId: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException(`User ${params.targetUserId} not found`);
    }

    // Security check: ensure target user is in the leader's led sector
    if (targetUser.sectorId !== ledSectorId) {
      throw new ForbiddenException(
        'Access denied. You can only view calculations for users in your led sector.',
      );
    }

    if (!targetUser.secullumEmployeeId) {
      this.logger.warn(
        `User ${targetUser.name} (${targetUser.id}) has no secullumEmployeeId`,
      );
      return {
        success: false,
        message: `User ${targetUser.name} does not have a Secullum account linked`,
        data: null,
      };
    }

    const secullumEmployeeId = targetUser.secullumEmployeeId.toString();

    // Fetch calculations from Secullum service
    try {
      const response = await this.secullumService.getCalculations({
        employeeId: secullumEmployeeId,
        startDate: params.startDate,
        endDate: params.endDate,
      });

      this.logger.log(
        `Successfully fetched calculations for ${targetUser.name} (Secullum ID: ${secullumEmployeeId})`,
      );

      // Return data in the same format as /secullum/calculations endpoint
      // The response.data should contain { Colunas, Linhas, Totais }
      return {
        success: true,
        message: 'Calculations fetched successfully',
        data: response.data,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch calculations for ${targetUser.name}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        message: error.message || 'Failed to fetch calculations from Secullum',
        data: null,
      };
    }
  }

  /**
   * Get Secullum calculations for ALL team members (batch)
   * Fetches calculations for all users in the led sector
   *
   * @param userId - Authenticated team leader user ID
   * @param params - Query parameters (startDate, endDate, sectorId is IGNORED)
   * @returns Secullum calculations for all team members
   */
  async getTeamCalculations(
    userId: string,
    params: {
      startDate: string;
      endDate: string;
      page?: number;
      take?: number;
    },
  ): Promise<{
    success: boolean;
    data: any[];
    meta?: any;
  }> {
    // Validate required parameters
    if (!params.startDate || !params.endDate) {
      throw new BadRequestException(
        'startDate and endDate are required parameters (format: YYYY-MM-DD)',
      );
    }

    // Validate leader and get ledSectorId from database
    const ledSectorId = await this.validateTeamLeader(userId);

    this.logger.log(`Team leader ${userId} accessing calculations for led sector ${ledSectorId}`);

    // Get all users in the led sector with their persisted Secullum mapping
    const teamMembers = await this.prisma.user.findMany({
      where: {
        sectorId: ledSectorId, // Use database ledSectorId
      },
      select: {
        id: true,
        name: true,
        secullumEmployeeId: true,
      },
    });

    if (teamMembers.length === 0) {
      return {
        success: true,
        data: [],
        meta: {
          ledSectorId,
          startDate: params.startDate,
          endDate: params.endDate,
          totalMembers: 0,
        },
      };
    }

    // Fetch calculations for all team members using their persisted secullumEmployeeId
    const calculationsPromises = teamMembers.map(async member => {
      if (!member.secullumEmployeeId) {
        this.logger.warn(`User ${member.name} (${member.id}) has no secullumEmployeeId`);
        return {
          userId: member.id,
          userName: member.name,
          secullumEmployeeId: null,
          calculations: [],
          error: 'No Secullum account linked',
        };
      }

      const secullumEmployeeId = member.secullumEmployeeId.toString();

      try {
        const response = await this.secullumService.getCalculations({
          employeeId: secullumEmployeeId,
          startDate: params.startDate,
          endDate: params.endDate,
        });

        return {
          userId: member.id,
          userName: member.name,
          secullumEmployeeId,
          calculations: response.data || [],
        };
      } catch (error) {
        this.logger.warn(
          `Failed to fetch calculations for user ${member.name} (${member.id})`,
          error,
        );
        return {
          userId: member.id,
          userName: member.name,
          secullumEmployeeId,
          calculations: [],
          error: 'Failed to fetch calculations',
        };
      }
    });

    const allCalculations = await Promise.all(calculationsPromises);

    return {
      success: true,
      data: allCalculations,
      meta: {
        ledSectorId,
        startDate: params.startDate,
        endDate: params.endDate,
        totalMembers: teamMembers.length,
      },
    };
  }

  /**
   * Get borrows for team members
   * Filters borrows by users in the led sector
   *
   * @param userId - Authenticated team leader user ID
   * @param query - Query parameters for filtering/pagination
   * @returns Borrows for team members
   */
  async getTeamBorrows(
    userId: string,
    query: BorrowGetManyFormData,
  ): Promise<BorrowGetManyResponse> {
    // Validate leader and get ledSectorId from database
    const ledSectorId = await this.validateTeamLeader(userId);

    this.logger.log(`Team leader ${userId} accessing borrows from led sector ${ledSectorId}`);

    // Force filter by led sector through user relation
    const secureQuery: BorrowGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        user: {
          sectorId: ledSectorId, // Override with database ledSectorId
        },
      },
    };

    return this.borrowService.findMany(secureQuery);
  }

  /**
   * Get EPI deliveries for team members
   * Filters PPE deliveries by users in the led sector
   *
   * @param userId - Authenticated team leader user ID
   * @param query - Query parameters for filtering/pagination
   * @returns PPE deliveries for team members
   */
  async getTeamEpis(
    userId: string,
    query: PpeDeliveryGetManyFormData,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Validate leader and get ledSectorId from database
    const ledSectorId = await this.validateTeamLeader(userId);

    this.logger.log(`Team leader ${userId} accessing EPIs from led sector ${ledSectorId}`);

    // Force filter by led sector through user relation
    const secureQuery: PpeDeliveryGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        user: {
          sectorId: ledSectorId, // Override with database ledSectorId
        },
      },
    };

    return this.ppeDeliveryService.findMany(secureQuery);
  }

  /**
   * Get activities for team members
   * Filters activities by users in the led sector
   *
   * @param userId - Authenticated team leader user ID
   * @param query - Query parameters for filtering/pagination
   * @returns Activities for team members
   */
  async getTeamActivities(
    userId: string,
    query: ActivityGetManyFormData,
  ): Promise<ActivityGetManyResponse> {
    // Validate leader and get ledSectorId from database
    const ledSectorId = await this.validateTeamLeader(userId);

    this.logger.log(`Team leader ${userId} accessing activities from led sector ${ledSectorId}`);

    // Force filter by led sector through user relation
    const secureQuery: ActivityGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        user: {
          sectorId: ledSectorId, // Override with database ledSectorId
        },
      },
    };

    return this.activityService.findMany(secureQuery);
  }

  /**
   * Get warnings for team members
   * Filters warnings by collaborators in the led sector
   *
   * @param userId - Authenticated team leader user ID
   * @param query - Query parameters for filtering/pagination
   * @returns Warnings for team members
   */
  async getTeamWarnings(
    userId: string,
    query: WarningGetManyFormData,
  ): Promise<WarningGetManyResponse> {
    // Validate leader and get ledSectorId from database
    const ledSectorId = await this.validateTeamLeader(userId);

    this.logger.log(`Team leader ${userId} accessing warnings from led sector ${ledSectorId}`);

    // Force filter by led sector through collaborator relation
    const secureQuery: WarningGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        collaborator: {
          sectorId: ledSectorId, // Override with database ledSectorId
        },
      },
    };

    return this.warningService.findMany(secureQuery);
  }
}
