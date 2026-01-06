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
import { BonusService } from '@modules/human-resources/bonus/bonus.service';
import { WarningService } from '../warning/warning.service';
import { PPE_DELIVERY_STATUS } from '../../../constants/enums';
import type {
  VacationGetManyResponse,
  BorrowGetManyResponse,
  PpeDeliveryGetManyResponse,
  PpeDeliveryCreateResponse,
  ActivityGetManyResponse,
  BonusGetManyResponse,
  WarningGetManyResponse,
} from '../../../types';
import type {
  VacationGetManyFormData,
  BorrowGetManyFormData,
  PpeDeliveryGetManyFormData,
  PpeDeliveryCreateFormData,
  ActivityGetManyFormData,
  BonusGetManyFormData,
  WarningGetManyFormData,
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
    private readonly bonusService: BonusService,
    private readonly warningService: WarningService,
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
  async getMyLoans(userId: string, query: BorrowGetManyFormData): Promise<BorrowGetManyResponse> {
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

    this.logger.log(
      `[PPE Request Service] Final delivery data: ${JSON.stringify(ppeDeliveryData)}`,
    );

    try {
      const result = await this.ppeDeliveryService.create(ppeDeliveryData, undefined, userId);
      this.logger.log(
        `[PPE Request Service] Request created successfully. Delivery ID: ${result.data.id}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `[PPE Request Service] Failed to create request for user: ${userId}`,
        error,
      );
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
   * Get user's warnings (Meus Avisos)
   * Filters warnings by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's warnings
   */
  async getMyWarnings(
    userId: string,
    query: WarningGetManyFormData,
  ): Promise<WarningGetManyResponse> {
    // Merge user filter with query - user can only see their own warnings
    const userFilteredQuery: WarningGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.warningService.findMany(userFilteredQuery);
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
    const transformedHolidays = (secullumResponse.data || []).map(holiday => ({
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

    // Get user with CPF, PIS, and payrollNumber for Secullum lookup
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        cpf: true,
        pis: true,
        payrollNumber: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Find Secullum employee using CPF/PIS/PayrollNumber lookup
    const secullumEmployee = await this.secullumService.findSecullumEmployee({
      cpf: user.cpf || undefined,
      pis: user.pis || undefined,
      payrollNumber: user.payrollNumber || undefined,
    });

    if (!secullumEmployee.success || !secullumEmployee.data) {
      this.logger.warn(
        `No Secullum employee found for user ${user.name} (CPF: ${user.cpf}, PIS: ${user.pis}, Folha: ${user.payrollNumber})`,
      );
      throw new BadRequestException(
        `No Secullum employee found matching your registration. Please contact HR to verify your CPF, PIS, or Payroll Number.`,
      );
    }

    const secullumEmployeeId = secullumEmployee.data.secullumId.toString();

    // Fetch calculations from Secullum
    const calculationsResponse = await this.secullumService.getCalculations({
      employeeId: secullumEmployeeId,
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
        secullumEmployeeId,
        startDate: params.startDate,
        endDate: params.endDate,
      },
    };
  }

  // =====================
  // MY BONUSES (Meu Bônus)
  // =====================

  /**
   * Get user's bonuses (Meu Bônus)
   * Returns saved bonuses from database filtered by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's saved bonuses
   */
  async getMyBonuses(userId: string, query: BonusGetManyFormData): Promise<BonusGetManyResponse> {
    // Merge user filter with query - user can only see their own bonuses
    const userFilteredQuery = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.bonusService.findManyWithWhere(userFilteredQuery);
  }

  /**
   * Get user's bonus detail by ID (Meu Bônus - Detalhes)
   * Returns a specific saved bonus for the authenticated user
   * Validates that the bonus belongs to the authenticated user
   *
   * @param userId - Authenticated user ID
   * @param bonusId - Bonus ID to retrieve
   * @param include - Optional relations to include
   * @returns User's bonus detail
   */
  async getMyBonusDetail(
    userId: string,
    bonusId: string,
    include?: any,
  ): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    // First get the bonus
    const bonus = await this.bonusService.findByIdOrLive(bonusId, include, userId);

    // Verify the bonus belongs to the authenticated user
    if (bonus.userId !== userId) {
      throw new NotFoundException('Bônus não encontrado.');
    }

    return {
      success: true,
      data: bonus,
      message: 'Bônus carregado com sucesso.',
    };
  }

  /**
   * Get user's live bonus for a specific period (Meu Bônus Ao Vivo)
   * Calculates real-time bonus based on current task data
   * Returns the same structure as saved bonus for consistent frontend handling
   *
   * @param userId - Authenticated user ID
   * @param year - Year of the bonus period
   * @param month - Month of the bonus period (1-12)
   * @returns Live bonus calculation or null if not eligible
   */
  async getMyLiveBonus(
    userId: string,
    year: number,
    month: number,
  ): Promise<{
    success: boolean;
    message: string;
    data: any | null;
  }> {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new BadRequestException('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new BadRequestException('Ano deve estar entre 2020 e 2030');
    }

    // First check if there's already a saved bonus for this period
    const savedBonus = await this.prisma.bonus.findFirst({
      where: {
        userId,
        year,
        month,
      },
      include: {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        payroll: {
          include: {
            position: true,
          },
        },
        tasks: {
          include: {
            customer: {
              select: {
                id: true,
                fantasyName: true,
              },
            },
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        bonusDiscounts: {
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        users: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // If saved bonus exists, return it (with position from payroll snapshot or user)
    if (savedBonus) {
      const position = (savedBonus as any).payroll?.position || savedBonus.user?.position || null;
      return {
        success: true,
        message: 'Bônus salvo encontrado para este período.',
        data: {
          ...savedBonus,
          position,
          isLive: false, // Indicates this is a saved bonus, not live
        },
      };
    }

    // No saved bonus - calculate live bonus
    try {
      const liveBonus = await this.bonusService.calculateLiveBonusData(userId, year, month);

      if (!liveBonus) {
        return {
          success: true,
          message: 'Usuário não elegível para bônus neste período.',
          data: null,
        };
      }

      return {
        success: true,
        message: 'Cálculo de bônus ao vivo obtido com sucesso.',
        data: {
          ...liveBonus,
          isLive: true, // Indicates this is a live calculation
        },
      };
    } catch (error) {
      this.logger.error(`Error calculating live bonus for user ${userId}:`, error);

      // Return null data with appropriate message for non-bonifiable users
      if (error instanceof BadRequestException) {
        return {
          success: true,
          message: error.message,
          data: null,
        };
      }

      throw error;
    }
  }
}
