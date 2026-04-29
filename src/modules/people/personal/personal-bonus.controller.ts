// personal-bonus.controller.ts
// Controller for user-specific personal bonus endpoints
// Uses the /bonuses route prefix for personal (non-admin) bonus access

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PersonalService } from './personal.service';
import { BonusService } from '@modules/human-resources/bonus/bonus.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodQueryValidationPipe,
  ZodValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit } from '@modules/common/throttler/throttler.decorators';
import type { BonusGetManyResponse } from '../../../types';
import type { BonusGetManyFormData, BonusSimulateFormData } from '../../../schemas';
import { bonusGetManySchema, bonusSimulateSchema } from '../../../schemas';

// All roles that can access personal bonus data
const ALL_ROLES = [
  SECTOR_PRIVILEGES.PRODUCTION,

  SECTOR_PRIVILEGES.WAREHOUSE,
  SECTOR_PRIVILEGES.MAINTENANCE,
  SECTOR_PRIVILEGES.DESIGNER,
  SECTOR_PRIVILEGES.LOGISTIC,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  SECTOR_PRIVILEGES.FINANCIAL,
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.HUMAN_RESOURCES,
  SECTOR_PRIVILEGES.EXTERNAL,
];

/**
 * Personal Bonus Controller
 * Provides user-specific endpoints for accessing personal bonus data
 * All endpoints automatically filter data by authenticated user
 *
 * Routes:
 * - GET /bonuses/my-bonuses - Get authenticated user's saved bonuses
 * - GET /bonuses/my-bonuses/:id - Get authenticated user's specific bonus detail
 * - GET /bonuses/my-live-bonus - Get authenticated user's live bonus calculation
 */
@Controller('bonuses')
@UseGuards(AuthGuard)
export class PersonalBonusController {
  private readonly logger = new Logger(PersonalBonusController.name);

  constructor(
    private readonly personalService: PersonalService,
    private readonly bonusService: BonusService,
  ) {}

  // =====================
  // MY BONUSES (Meu Bônus)
  // =====================

  /**
   * Get authenticated user's saved bonuses
   * Filters bonuses by userId automatically
   * Returns paginated list of saved/confirmed bonuses
   */
  @Get('my-bonuses')
  @ReadRateLimit()
  @Roles(...ALL_ROLES)
  async getMyBonuses(
    @Query(new ZodQueryValidationPipe(bonusGetManySchema)) query: BonusGetManyFormData,
    @UserId() userId: string,
  ): Promise<BonusGetManyResponse> {
    this.logger.log(`[My Bonuses] Fetching bonuses for user: ${userId}`);
    return this.personalService.getMyBonuses(userId, query);
  }

  /**
   * Get authenticated user's specific bonus detail
   * Validates that the bonus belongs to the authenticated user
   * Supports both regular UUIDs and live IDs (live-{userId}-{year}-{month})
   */
  @Get('my-bonuses/:id')
  @ReadRateLimit()
  @Roles(...ALL_ROLES)
  async getMyBonusDetail(
    @Param('id') bonusId: string,
    @Query('include') include?: string,
    @UserId() userId?: string,
  ): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    this.logger.log(`[My Bonus Detail] Fetching bonus ${bonusId} for user: ${userId}`);

    // Parse include parameter if it's a JSON string
    let parsedInclude: any;
    if (include) {
      try {
        parsedInclude = typeof include === 'string' ? JSON.parse(include) : include;
      } catch (e) {
        parsedInclude = undefined;
      }
    }

    return this.personalService.getMyBonusDetail(userId, bonusId, parsedInclude);
  }

  /**
   * Get authenticated user's live bonus calculation
   * Calculates real-time bonus based on current task data
   * Returns same structure as saved bonus for consistent frontend handling
   *
   * Query params:
   * - year: Year of the bonus period (defaults to current)
   * - month: Month of the bonus period (defaults to current)
   */
  @Get('my-live-bonus')
  @ReadRateLimit()
  @Roles(...ALL_ROLES)
  async getMyLiveBonus(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @UserId() userId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: any | null;
  }> {
    // Determine current bonus period if not specified
    const now = new Date();
    const currentDay = now.getDate();

    let targetYear = year ? parseInt(year, 10) : now.getFullYear();
    let targetMonth = month ? parseInt(month, 10) : now.getMonth() + 1;

    // If on day 26+, we're looking at next month's bonus period
    if (!month && currentDay >= 26) {
      targetMonth += 1;
      if (targetMonth > 12) {
        targetMonth = 1;
        targetYear += 1;
      }
    }

    this.logger.log(
      `[My Live Bonus] Calculating for user: ${userId}, period: ${targetMonth}/${targetYear}`,
    );

    return this.personalService.getMyLiveBonus(userId, targetYear, targetMonth);
  }

  /**
   * Run the salary-based logistic bonus simulation as the authenticated user.
   *
   * The admin-only endpoint POST /bonus/simulate would 403 regular employees,
   * so the personal/employee mobile simulator hits this route instead. The
   * algorithm is identical — same BonusService.simulate, same parameters —
   * we just open it up to ALL_ROLES.
   */
  @Post('my-bonus-simulate')
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  @Roles(...ALL_ROLES)
  @UsePipes(new ZodValidationPipe(bonusSimulateSchema))
  async simulateMyBonus(@Body() data: BonusSimulateFormData) {
    const result = await this.bonusService.simulate({
      averageTasksPerUser: data.averageTasksPerUser!,
      users: (data.users ?? []).map(u => ({
        id: u.id,
        name: u.name,
        positionName: u.positionName,
        positionId: u.positionId,
        sectorName: u.sectorName,
        salary: u.salary,
        performanceLevel: u.performanceLevel!,
      })),
      config: data.config,
      salaryRange: data.salaryRange as { min: number; max: number } | undefined,
      b1Sweep: data.b1Sweep
        ? {
            salary: data.b1Sweep.salary!,
            performanceLevel: data.b1Sweep.performanceLevel!,
            min: data.b1Sweep.min ?? 0,
            max: data.b1Sweep.max ?? 8,
            steps: data.b1Sweep.steps ?? 160,
          }
        : undefined,
    });
    return { success: true, data: result, message: 'Simulação calculada com sucesso.' };
  }

  /**
   * Get period task stats for bonus simulation (no admin privileges required)
   * Returns lightweight task counts and averages (no Secullum)
   * Accessible to all bonifiable users for the simulation page
   */
  @Get('my-period-stats/:year/:month')
  @ReadRateLimit()
  @Roles(...ALL_ROLES)
  async getMyPeriodTaskStats(@Param('year') yearParam: string, @Param('month') monthParam: string) {
    const year = parseInt(yearParam, 10);
    const month = parseInt(monthParam, 10);

    if (isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mês deve estar entre 1 e 12');
    }
    if (isNaN(year) || year < 2020 || year > 2030) {
      throw new BadRequestException('Ano deve estar entre 2020 e 2030');
    }

    return this.personalService.getPeriodTaskStats(year, month);
  }
}
