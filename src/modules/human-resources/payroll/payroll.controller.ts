import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';

// Import schemas and types
import {
  payrollCreateSchema,
  payrollUpdateSchema,
  payrollGetManyFormDataSchema,
  payrollQuerySchema,
  payrollBatchCreateSchema,
  payrollBatchUpdateSchema,
  payrollBatchDeleteSchema,
  payrollGenerateMonthSchema,
  payrollLiveCalculationSchema,
  discountCreateSchema,
  type PayrollCreateFormData,
  type PayrollUpdateFormData,
  type PayrollGetManyFormData,
  type PayrollQueryFormData,
  type PayrollBatchCreateFormData,
  type PayrollBatchUpdateFormData,
  type PayrollBatchDeleteFormData,
  type PayrollGenerateMonthParams,
  type PayrollLiveCalculationParams,
  type DiscountCreateFormData,
} from '../../../schemas/payroll';

// Response types - these should be properly defined in @types
type PayrollCreateResponse = any;
type PayrollDeleteResponse = any;
type PayrollGetManyResponse = any;
type PayrollGetUniqueResponse = any;
type PayrollUpdateResponse = any;
type PayrollBatchResponse = any;
type PayrollGenerateMonthResponse = any;
type PayrollLiveCalculationResponse = any;

@Controller('payroll')
@UseGuards(AuthGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  // =====================
  // Basic CRUD Operations
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(payrollGetManyFormDataSchema)) query: PayrollGetManyFormData,
    @UserId() userId: string,
  ): Promise<PayrollGetManyResponse> {
    // The service will handle live calculations internally when needed
    return this.payrollService.findMany(query);
  }

  // This endpoint handles legacy calls to /payroll/bonuses
  // It simply delegates to the standard findMany with bonus included
  @Get('bonuses')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async getPayrollWithBonuses(
    @Query(new ZodQueryValidationPipe(payrollQuerySchema)) query: PayrollQueryFormData,
    @UserId() userId: string,
  ): Promise<PayrollGetManyResponse> {
    // Convert the query to include bonus data
    const payrollQuery: PayrollGetManyFormData = {
      where: {
        year: query.year,
        month: query.month,
        userId: query.userId,
      },
      include: {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        bonus: {
          include: {
            tasks: {
              include: {
                customer: true,
                createdBy: true,
                sector: true,
                services: true,
              },
            },
            users: true,
          },
        },
        discounts: true,
      },
    };

    return this.payrollService.findMany(payrollQuery);
  }

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(payrollQuerySchema)) query: PayrollQueryFormData,
    @UserId() userId: string,
  ): Promise<PayrollGetUniqueResponse> {
    try {
      // Always use well-defined includes instead of relying on query params
      // Complex nested objects cannot be properly transmitted through URL query parameters
      const defaultInclude = {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        bonus: {
          include: {
            tasks: {
              include: {
                customer: true,
                createdBy: true,
                sector: true,
                services: true,
              },
            },
            users: true,
          },
        },
        discounts: true,
      };

      const payroll = await this.payrollService.findById(id, defaultInclude);

      if (!payroll) {
        return {
          success: false,
          message: 'Folha de pagamento não encontrada.',
          data: null,
        };
      }

      return {
        success: true,
        message: 'Folha de pagamento obtida com sucesso.',
        data: payroll,
      };
    } catch (error) {
      throw error;
    }
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(payrollCreateSchema)) data: PayrollCreateFormData,
    @Query(new ZodQueryValidationPipe(payrollQuerySchema)) query: PayrollQueryFormData,
    @UserId() userId: string,
  ): Promise<PayrollCreateResponse> {
    return this.payrollService.create(data, userId);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(payrollUpdateSchema)) data: PayrollUpdateFormData,
    @Query(new ZodQueryValidationPipe(payrollQuerySchema)) query: PayrollQueryFormData,
    @UserId() userId: string,
  ): Promise<PayrollUpdateResponse> {
    return this.payrollService.update(id, data, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PayrollDeleteResponse> {
    await this.payrollService.delete(id, userId);
    return {
      success: true,
      message: 'Folha de pagamento excluída com sucesso',
    };
  }

  // =====================
  // Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(payrollBatchCreateSchema)) data: PayrollBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(payrollQuerySchema)) query: PayrollQueryFormData,
    @UserId() userId: string,
  ): Promise<PayrollBatchResponse> {
    return this.payrollService.batchCreate(data.payrolls, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(payrollBatchUpdateSchema)) data: PayrollBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(payrollQuerySchema)) query: PayrollQueryFormData,
    @UserId() userId: string,
  ): Promise<PayrollBatchResponse> {
    return this.payrollService.batchUpdate(data.updates!.map(u => ({ id: u.id!, data: u.data! })), userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(payrollBatchDeleteSchema)) data: PayrollBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PayrollBatchResponse> {
    return this.payrollService.batchDelete(data.ids, userId);
  }

  // =====================
  // Special Endpoints
  // =====================

  @Post('generate-month')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async generateMonthlyPayrolls(
    @Body(new ZodValidationPipe(payrollGenerateMonthSchema)) data: PayrollGenerateMonthParams,
    @UserId() userId: string,
  ): Promise<PayrollGenerateMonthResponse> {
    return this.payrollService.generateForMonth(data.year, data.month, userId);
  }

  @Get('live')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async getLiveCalculations(
    @Query(new ZodQueryValidationPipe(payrollLiveCalculationSchema)) query: PayrollLiveCalculationParams,
    @UserId() userId: string,
  ): Promise<PayrollLiveCalculationResponse> {
    // Return live calculations for current user in current month/year
    const now = new Date();
    return this.payrollService.calculateLivePayrollData(
      userId,
      now.getFullYear(),
      now.getMonth() + 1,
    );
  }

  // =====================
  // Filtering Endpoints
  // =====================

  @Get('user/:userId')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findByUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query(new ZodQueryValidationPipe(payrollGetManyFormDataSchema)) query: PayrollGetManyFormData,
    @UserId() userId: string,
  ): Promise<PayrollGetManyResponse> {
    const queryWithUserFilter = {
      ...query,
      where: {
        ...query.where,
        userId: targetUserId,
      },
    };
    return this.payrollService.findMany(queryWithUserFilter);
  }

  @Get('month/:year/:month')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findByMonth(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Query(new ZodQueryValidationPipe(payrollGetManyFormDataSchema)) query: PayrollGetManyFormData,
    @UserId() userId: string,
  ): Promise<PayrollGetManyResponse> {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    const queryWithDateFilter = {
      ...query,
      where: {
        ...query.where,
        year,
        month,
      },
    };
    return this.payrollService.findMany(queryWithDateFilter);
  }

  @Get('user/:userId/month/:year/:month')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findByUserAndMonth(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Query(new ZodQueryValidationPipe(payrollQuerySchema)) query: PayrollQueryFormData,
    @UserId() userId: string,
  ): Promise<PayrollGetUniqueResponse> {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    // Always use well-defined includes instead of relying on query params
    // Complex nested objects cannot be properly transmitted through URL query parameters
    const defaultInclude = {
      user: {
        include: {
          position: true,
          sector: true,
        },
      },
      bonus: {
        include: {
          tasks: {
            include: {
              customer: true,
              createdBy: true,
              sector: true,
              services: true,
            },
          },
          users: true,
        },
      },
      discounts: true,
    };

    return this.payrollService.findByUserAndMonth(
      targetUserId,
      year,
      month,
      defaultInclude,
    );
  }

  @Get('live/:userId/:year/:month')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async getLiveCalculation(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @UserId() userId: string,
  ): Promise<PayrollLiveCalculationResponse> {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    return this.payrollService.calculateLivePayrollData(targetUserId, year, month);
  }

  // =====================
  // Bonus Simulation
  // =====================

  @Get('bonuses/simulate')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async simulateBonusesGet(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @UserId() userId: string,
    @Query('taskQuantity') taskQuantity?: string,
    @Query('sectorIds') sectorIds?: string,
    @Query('excludeUserIds') excludeUserIds?: string,
  ) {
    const params = {
      year,
      month,
      taskQuantity: taskQuantity ? parseInt(taskQuantity, 10) : undefined,
      sectorIds: sectorIds ? sectorIds.split(',') : undefined,
      excludeUserIds: excludeUserIds ? excludeUserIds.split(',') : undefined,
    };
    return this.payrollService.simulateBonuses(params);
  }

  @Post('simulate-bonuses')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async simulateBonuses(
    @Body() params: {
      year: number;
      month: number;
      taskQuantity?: number;
      sectorIds?: string[];
      excludeUserIds?: string[];
    },
    @UserId() userId: string,
  ) {
    return this.payrollService.simulateBonuses(params);
  }

  // =====================
  // Discount Management
  // =====================

  @Post(':payrollId/discount')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async addDiscount(
    @Param('payrollId', ParseUUIDPipe) payrollId: string,
    @Body(new ZodValidationPipe(discountCreateSchema)) data: DiscountCreateFormData,
    @UserId() userId: string,
  ) {
    // Note: These methods may need to be implemented in the service
    // For now, returning a placeholder response
    return {
      success: false,
      message: 'Funcionalidade de descontos ainda não implementada no serviço',
    };
  }

  @Delete(':payrollId/discount/:discountId')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async removeDiscount(
    @Param('payrollId', ParseUUIDPipe) payrollId: string,
    @Param('discountId', ParseUUIDPipe) discountId: string,
    @UserId() userId: string,
  ) {
    // Note: These methods may need to be implemented in the service
    // For now, returning a placeholder response
    return {
      success: false,
      message: 'Funcionalidade de descontos ainda não implementada no serviço',
    };
  }
}