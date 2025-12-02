// personal.controller.ts
// Controller for user-specific personal data endpoints
// All endpoints filter data by authenticated user (user-specific queries)

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { PersonalService } from './personal.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import type {
  VacationGetManyResponse,
  BorrowGetManyResponse,
  PpeDeliveryGetManyResponse,
  PpeDeliveryCreateResponse,
  ActivityGetManyResponse,
} from '../../../types';
import type {
  VacationGetManyFormData,
  BorrowGetManyFormData,
  PpeDeliveryGetManyFormData,
  PpeDeliveryCreateFormData,
  ActivityGetManyFormData,
} from '../../../schemas';
import {
  vacationGetManySchema,
  borrowGetManySchema,
  ppeDeliveryGetManySchema,
  ppeDeliveryCreateSchema,
  ppeDeliveryPersonalRequestSchema,
  activityGetManySchema,
} from '../../../schemas';

/**
 * Personal Controller
 * Provides user-specific endpoints for accessing personal data
 * All endpoints automatically filter data by authenticated user
 *
 * Routes:
 * - GET /personal/my-vacations - Get authenticated user's vacations (ferias)
 * - GET /personal/my-loans - Get authenticated user's loans/borrows (emprestimos)
 * - GET /personal/my-epis - Get authenticated user's PPE deliveries
 * - POST /personal/my-epis/request - Request new EPIs
 * - GET /personal/my-activities - Get authenticated user's activities
 * - GET /personal/my-holidays - Get holidays (public/company holidays)
 */
@Controller('personal')
@UseGuards(AuthGuard)
export class PersonalController {
  private readonly logger = new Logger(PersonalController.name);

  constructor(private readonly personalService: PersonalService) {}

  // =====================
  // MY VACATIONS (Minhas Férias)
  // =====================

  /**
   * Get authenticated user's vacations
   * Filters vacations by userId automatically
   */
  @Get('my-vacations')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyVacations(
    @Query(new ZodQueryValidationPipe(vacationGetManySchema)) query: VacationGetManyFormData,
    @UserId() userId: string,
  ): Promise<VacationGetManyResponse> {
    return this.personalService.getMyVacations(userId, query);
  }

  // =====================
  // MY LOANS/BORROWS (Meus Empréstimos)
  // =====================

  /**
   * Get authenticated user's active loans/borrows
   * Filters borrows by userId automatically
   */
  @Get('my-loans')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyLoans(
    @Query(new ZodQueryValidationPipe(borrowGetManySchema)) query: BorrowGetManyFormData,
    @UserId() userId: string,
  ): Promise<BorrowGetManyResponse> {
    return this.personalService.getMyLoans(userId, query);
  }

  // =====================
  // MY EPIs (Meus EPIs)
  // =====================

  /**
   * Get authenticated user's PPE (EPI) deliveries
   * Filters PPE deliveries by userId automatically
   */
  @Get('my-epis')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyEpis(
    @Query(new ZodQueryValidationPipe(ppeDeliveryGetManySchema)) query: PpeDeliveryGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    return this.personalService.getMyEpis(userId, query);
  }

  /**
   * Request new PPE (EPI) delivery
   * Automatically sets userId to authenticated user and status to PENDING
   */
  @Post('my-epis/request')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async requestEpi(
    @Body(new ZodValidationPipe(ppeDeliveryPersonalRequestSchema))
    data: Omit<PpeDeliveryCreateFormData, 'userId' | 'status' | 'statusOrder'>,
    @UserId() userId: string,
  ): Promise<PpeDeliveryCreateResponse> {
    this.logger.log(`[PPE Request API] Request received for user: ${userId}`);
    this.logger.log(`[PPE Request API] Request data: ${JSON.stringify(data)}`);

    try {
      const result = await this.personalService.requestEpi(userId, data);
      this.logger.log(
        `[PPE Request API] Request successful for user: ${userId}, delivery ID: ${result.data.id}`,
      );
      return result;
    } catch (error) {
      this.logger.error(`[PPE Request API] Request failed for user: ${userId}`, error);
      throw error;
    }
  }

  // =====================
  // MY ACTIVITIES (Minhas Atividades)
  // =====================

  /**
   * Get authenticated user's inventory activities
   * Filters activities by userId automatically
   */
  @Get('my-activities')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyActivities(
    @Query(new ZodQueryValidationPipe(activityGetManySchema)) query: ActivityGetManyFormData,
    @UserId() userId: string,
  ): Promise<ActivityGetManyResponse> {
    return this.personalService.getMyActivities(userId, query);
  }

  // =====================
  // MY HOLIDAYS (Meus Feriados)
  // =====================

  /**
   * Get holidays (public/company holidays)
   * Note: Holidays are not user-specific, but this provides easy access for personal view
   * Returns holidays for the current year or specified year
   */
  @Get('my-holidays')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyHolidays(
    @Query('year') year?: string,
    @UserId() userId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: any[];
  }> {
    return this.personalService.getMyHolidays(year);
  }

  // =====================
  // MY SECULLUM CALCULATIONS (Meus Pontos)
  // =====================

  /**
   * Get authenticated user's Secullum time clock calculations (pontos)
   * Filters calculations by userId automatically
   * Requires startDate and endDate query parameters (YYYY-MM-DD format)
   */
  @Get('my-secullum-calculations')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMySecullumCalculations(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('page') page?: string,
    @Query('take') take?: string,
    @UserId() userId?: string,
  ): Promise<{
    success: boolean;
    data: any;
    meta?: any;
  }> {
    return this.personalService.getMySecullumCalculations(userId, {
      startDate,
      endDate,
      page: page ? parseInt(page) : undefined,
      take: take ? parseInt(take) : undefined,
    });
  }
}
