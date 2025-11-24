// personal.service.ts
// Service for handling user-specific personal data queries
// All methods ensure data is filtered by the authenticated user

import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { VacationService } from '../vacation/vacation.service';
import { BorrowService } from '@modules/inventory/borrow/borrow.service';
import { PpeDeliveryService } from '@modules/inventory/ppe/ppe-delivery.service';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { PPE_DELIVERY_STATUS } from '../../../constants/enums';
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

/**
 * Personal Service
 * Handles all user-specific data queries with automatic filtering by userId
 * Ensures users can only access their own personal data
 */
@Injectable()
export class PersonalService {
  private readonly logger = new Logger(PersonalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vacationService: VacationService,
    private readonly borrowService: BorrowService,
    private readonly ppeDeliveryService: PpeDeliveryService,
    private readonly activityService: ActivityService,
    private readonly secullumService: SecullumService,
  ) {}

  /**
   * Get user's vacations (Minhas Férias)
   * Filters vacations by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's vacations
   */
  async getMyVacations(
    userId: string,
    query: VacationGetManyFormData,
  ): Promise<VacationGetManyResponse> {
    // Merge user filter with query - user can only see their own vacations
    const userFilteredQuery: VacationGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.vacationService.findMany(userFilteredQuery);
  }

  /**
   * Get user's loans/borrows (Meus Empréstimos)
   * Filters borrows by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's active borrows
   */
  async getMyLoans(
    userId: string,
    query: BorrowGetManyFormData,
  ): Promise<BorrowGetManyResponse> {
    // Merge user filter with query - user can only see their own borrows
    const userFilteredQuery: BorrowGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.borrowService.findMany(userFilteredQuery);
  }

  /**
   * Get user's PPE/EPI deliveries (Meus EPIs)
   * Filters PPE deliveries by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's PPE deliveries
   */
  async getMyEpis(
    userId: string,
    query: PpeDeliveryGetManyFormData,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Merge user filter with query - user can only see their own EPIs
    const userFilteredQuery: PpeDeliveryGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.ppeDeliveryService.findMany(userFilteredQuery);
  }

  /**
   * Request new PPE/EPI delivery
   * Automatically sets userId to authenticated user and status to PENDING
   *
   * @param userId - Authenticated user ID
   * @param data - PPE delivery request data (without userId, status, statusOrder)
   * @returns Created PPE delivery request
   */
  async requestEpi(
    userId: string,
    data: Omit<PpeDeliveryCreateFormData, 'userId' | 'status' | 'statusOrder'>,
  ): Promise<PpeDeliveryCreateResponse> {
    this.logger.log(`[PPE Request Service] Processing request for user: ${userId}`);
    this.logger.log(`[PPE Request Service] Input data: ${JSON.stringify(data)}`);

    // Build complete PPE delivery data with enforced user ID and PENDING status
    const ppeDeliveryData: PpeDeliveryCreateFormData = {
      ...data,
      userId, // Force authenticated user
      status: PPE_DELIVERY_STATUS.PENDING, // Always PENDING for user requests
      statusOrder: 1, // PENDING order
    };

    this.logger.log(`[PPE Request Service] Final delivery data: ${JSON.stringify(ppeDeliveryData)}`);

    try {
      const result = await this.ppeDeliveryService.create(ppeDeliveryData, undefined, userId);
      this.logger.log(`[PPE Request Service] Request created successfully. Delivery ID: ${result.data.id}`);
      return result;
    } catch (error) {
      this.logger.error(`[PPE Request Service] Failed to create request for user: ${userId}`, error);
      throw error;
    }
  }

  /**
   * Get user's inventory activities (Minhas Atividades)
   * Filters activities by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's inventory activities
   */
  async getMyActivities(
    userId: string,
    query: ActivityGetManyFormData,
  ): Promise<ActivityGetManyResponse> {
    // Merge user filter with query - user can only see their own activities
    const userFilteredQuery: ActivityGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.activityService.findMany(userFilteredQuery);
  }

  /**
   * Get holidays (Meus Feriados)
   * Note: Holidays are not user-specific but public/company-wide
   * This provides a convenient endpoint for users to check holidays
   * Fetches holiday data from Secullum integration
   *
   * @param year - Optional year parameter (defaults to current year)
   * @returns List of holidays from Secullum
   */
  async getMyHolidays(year?: string): Promise<{
    success: boolean;
    message: string;
    data: any[];
  }> {
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

    // Fetch holidays from Secullum integration
    const secullumResponse = await this.secullumService.getHolidays({ year: targetYear });

    // Transform Secullum holidays to match the Holiday interface
    // Secullum returns: { Id, Data, Descricao }
    // Holiday interface requires: { id, name, date, type, createdAt, updatedAt }
    const transformedHolidays = (secullumResponse.data || []).map((holiday) => ({
      id: `secullum-${holiday.Id}`,
      name: holiday.Descricao,
      date: new Date(holiday.Data),
      type: null, // Keep as null - required by interface but not provided by Secullum
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    return {
      success: true,
      message: secullumResponse.message,
      data: transformedHolidays,
    };
  }

  /**
   * Get user's Secullum calculations (Meus Pontos)
   * Fetches time clock calculations from Secullum for the authenticated user
   *
   * @param userId - Authenticated user ID
   * @param params - Query parameters (startDate, endDate, page, take)
   * @returns Secullum calculations data
   */
  async getMySecullumCalculations(
    userId: string,
    params: {
      startDate: string;
      endDate: string;
      page?: number;
      take?: number;
    },
  ): Promise<{
    success: boolean;
    data: any;
    meta?: any;
  }> {
    // Validate required parameters
    if (!params.startDate || !params.endDate) {
      throw new BadRequestException(
        'startDate and endDate are required parameters (format: YYYY-MM-DD)',
      );
    }

    // Get user with Secullum employee ID
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        secullumId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.secullumId) {
      throw new BadRequestException(
        'User does not have a Secullum employee ID associated. Please contact HR to link your Secullum account.',
      );
    }

    // Fetch calculations from Secullum
    const calculationsResponse = await this.secullumService.getCalculations({
      employeeId: user.secullumId,
      startDate: params.startDate,
      endDate: params.endDate,
    });

    if (!calculationsResponse.success) {
      throw new BadRequestException(
        calculationsResponse.message || 'Failed to fetch calculations from Secullum',
      );
    }

    return {
      success: true,
      data: calculationsResponse.data,
      meta: {
        userId: user.id,
        userName: user.name,
        secullumEmployeeId: user.secullumId,
        startDate: params.startDate,
        endDate: params.endDate,
      },
    };
  }
}
