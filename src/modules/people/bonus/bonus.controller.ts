import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { BonusService } from './bonus.service';
import { BonusDiscountService } from './bonus-discount.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import type {
  Bonus,
  BonusDiscount,
  BonusBatchResponse,
  BonusDiscountBatchResponse,
  BonusCreateResponse,
  BonusDiscountCreateResponse,
  BonusDeleteResponse,
  BonusDiscountDeleteResponse,
  BonusGetManyResponse,
  BonusDiscountGetManyResponse,
  BonusGetUniqueResponse,
  BonusDiscountGetUniqueResponse,
  BonusUpdateResponse,
  BonusDiscountUpdateResponse,
} from '../../../types';
import type {
  BonusCreateFormData,
  BonusDiscountCreateFormData,
  BonusUpdateFormData,
  BonusDiscountUpdateFormData,
  BonusGetManyFormData,
  BonusDiscountGetManyFormData,
  BonusBatchCreateFormData,
  BonusDiscountBatchCreateFormData,
  BonusBatchUpdateFormData,
  BonusDiscountBatchUpdateFormData,
  BonusBatchDeleteFormData,
  BonusDiscountBatchDeleteFormData,
  BonusGetByIdFormData,
  BonusDiscountGetByIdFormData,
  BonusQueryFormData,
  BonusDiscountQueryFormData,
  PayrollGetParams,
} from '../../../schemas';
import {
  bonusCreateSchema,
  bonusDiscountCreateSchema,
  bonusBatchCreateSchema,
  bonusDiscountBatchCreateSchema,
  bonusBatchDeleteSchema,
  bonusDiscountBatchDeleteSchema,
  bonusBatchUpdateSchema,
  bonusDiscountBatchUpdateSchema,
  bonusGetManySchema,
  bonusDiscountGetManySchema,
  bonusUpdateSchema,
  bonusDiscountUpdateSchema,
  bonusGetByIdSchema,
  bonusDiscountGetByIdSchema,
  bonusQuerySchema,
  bonusDiscountQuerySchema,
  payrollGetSchema,
} from '../../../schemas';

@Controller('bonuses')
export class BonusController {
  constructor(
    private readonly bonusService: BonusService,
    private readonly bonusDiscountService: BonusDiscountService
  ) {}

  // =====================
  // Bonus CRUD Operations
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(bonusGetManySchema)) query: BonusGetManyFormData,
    @UserId() userId: string,
  ): Promise<BonusGetManyResponse> {
    return this.bonusService.findMany(query, query.include, userId);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(bonusCreateSchema)) data: BonusCreateFormData,
    @Query(new ZodQueryValidationPipe(bonusQuerySchema)) query: BonusQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusCreateResponse> {
    return this.bonusService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(bonusBatchCreateSchema)) data: BonusBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(bonusQuerySchema)) query: BonusQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusBatchResponse<BonusCreateFormData>> {
    return this.bonusService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(bonusBatchUpdateSchema)) data: BonusBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(bonusQuerySchema)) query: BonusQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusBatchResponse<BonusUpdateFormData>> {
    return this.bonusService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(bonusBatchDeleteSchema)) data: BonusBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<BonusBatchResponse<string>> {
    return this.bonusService.batchDelete(data, userId);
  }

  // =====================
  // Personal Bonus Operations (No privilege requirements - available to all authenticated users)
  // =====================

  /**
   * Get current user's saved bonuses
   * Returns only bonuses belonging to the authenticated user
   * No admin/HR privileges required - accessible to all users
   */
  @Get('my-bonuses')
  @ReadRateLimit()
  async getMyBonuses(
    @Query(new ZodQueryValidationPipe(bonusGetManySchema)) query: BonusGetManyFormData,
    @UserId() userId: string,
  ): Promise<BonusGetManyResponse> {
    console.log('🔍 [my-bonuses] Request received:', {
      userId,
      where: query.where,
    });

    // Force filter by current user - users can only see their own bonuses
    const userQuery = {
      ...query,
      where: {
        ...query.where,
        userId: userId,
      },
    };

    const result = await this.bonusService.findMany(userQuery, query.include, userId);

    // Convert Prisma Decimal fields to plain numbers for mobile compatibility
    if (result.data) {
      result.data = result.data.map((bonus: any) => ({
        ...bonus,
        baseBonus: bonus.baseBonus?.toNumber ? bonus.baseBonus.toNumber() : bonus.baseBonus,
        ponderedTaskCount: bonus.ponderedTaskCount?.toNumber ? bonus.ponderedTaskCount.toNumber() : bonus.ponderedTaskCount,
        averageTasksPerUser: bonus.averageTasksPerUser?.toNumber ? bonus.averageTasksPerUser.toNumber() : bonus.averageTasksPerUser,
      }));
    }

    console.log('🔍 [my-bonuses] Returning:', {
      count: result.data?.length || 0,
      totalRecords: result.meta?.totalRecords || 0,
      firstBonusValue: result.data?.[0]?.baseBonus,
      firstBonusType: typeof result.data?.[0]?.baseBonus,
    });

    return result;
  }

  /**
   * Get a specific bonus detail for current user
   * Returns only if the bonus belongs to the authenticated user
   * No admin/HR privileges required - accessible to all users
   */
  @Get('my-bonuses/:id')
  @ReadRateLimit()
  async getMyBonusDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(bonusQuerySchema)) query: BonusQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusGetUniqueResponse> {
    console.log('🔍 [my-bonuses/:id] Request received:', {
      bonusId: id,
      userId,
    });

    const bonus = await this.bonusService.findById(id, query.include, userId);

    // Security check: ensure the bonus belongs to the current user
    if (bonus.data && bonus.data.userId !== userId) {
      throw new NotFoundException('Bônus não encontrado.');
    }

    // If tasks are requested but not linked via relation, fetch by calculation period
    if (bonus.data && query.include?.tasks && (!bonus.data.tasks || bonus.data.tasks.length === 0)) {
      console.log('🔍 [my-bonuses/:id] Tasks not linked, fetching by calculation period');

      const tasks = await this.bonusService.getTasksForBonus(
        bonus.data.userId,
        bonus.data.calculationPeriodStart,
        bonus.data.calculationPeriodEnd
      );

      bonus.data.tasks = tasks;
      console.log('🔍 [my-bonuses/:id] Fetched tasks by period:', tasks.length);
    }

    // Convert Prisma Decimal fields to plain numbers for mobile compatibility
    if (bonus.data) {
      bonus.data = {
        ...bonus.data,
        baseBonus: bonus.data.baseBonus?.toNumber ? bonus.data.baseBonus.toNumber() : bonus.data.baseBonus,
        ponderedTaskCount: bonus.data.ponderedTaskCount?.toNumber ? bonus.data.ponderedTaskCount.toNumber() : bonus.data.ponderedTaskCount,
        averageTasksPerUser: bonus.data.averageTasksPerUser?.toNumber ? bonus.data.averageTasksPerUser.toNumber() : bonus.data.averageTasksPerUser,
        bonusDiscounts: bonus.data.bonusDiscounts?.map((discount: any) => ({
          ...discount,
          percentage: discount.percentage?.toNumber ? discount.percentage.toNumber() : discount.percentage,
          value: discount.value?.toNumber ? discount.value.toNumber() : discount.value,
        })),
        tasks: bonus.data.tasks?.map((task: any) => ({
          ...task,
          // Convert task Decimal fields
          totalPrice: task.totalPrice?.toNumber ? task.totalPrice.toNumber() : task.totalPrice,
          laborPrice: task.laborPrice?.toNumber ? task.laborPrice.toNumber() : task.laborPrice,
          materialPrice: task.materialPrice?.toNumber ? task.materialPrice.toNumber() : task.materialPrice,
          // commission field is already a string enum, no conversion needed
        })),
      } as any;
    }

    console.log('🔍 [my-bonuses/:id] Returning bonus for user');

    return bonus;
  }

  /**
   * Get current user's live bonus calculation for current period
   * Returns real-time bonus calculation without saving to database
   * No admin/HR privileges required - accessible to all users
   */
  @Get('my-live-bonus')
  @ReadRateLimit()
  async getMyLiveBonus(
    @Query(new ZodQueryValidationPipe(payrollGetSchema)) params: PayrollGetParams,
    @UserId() userId: string,
  ) {
    console.log('🔍 [my-live-bonus] Request received:', {
      userId,
      year: params.year,
      month: params.month,
    });

    // Get payroll data for the specified period
    const payrollData = await this.bonusService.getPayrollData(params, userId);

    console.log('🔍 [my-live-bonus] Payroll data:', {
      bonusesCount: payrollData.data?.bonuses?.length || 0,
      hasBonuses: !!payrollData.data?.bonuses,
    });

    // Extract only the current user's bonus from the payroll data
    const myBonus = payrollData.data?.bonuses?.find((b: any) => b.userId === userId);

    console.log('🔍 [my-live-bonus] Returning:', {
      found: !!myBonus,
      data: myBonus || null,
    });

    return {
      success: true,
      message: myBonus
        ? 'Bônus ao vivo calculado com sucesso.'
        : 'Nenhum bônus encontrado para o período.',
      data: myBonus || null,
    };
  }

  // =====================
  // Payroll Operations (Admin/HR only)
  // =====================

  @Get('payroll')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async getPayroll(
    @Query(new ZodQueryValidationPipe(payrollGetSchema)) params: PayrollGetParams,
    @UserId() userId: string,
  ) {
    return this.bonusService.getPayrollData(params, userId);
  }

  @Get('payroll/export')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async exportPayroll(
    @Query(new ZodQueryValidationPipe(payrollGetSchema)) params: PayrollGetParams,
    @UserId() userId: string,
    @Res() res: Response,
  ) {
    const payrollData = await this.bonusService.getPayrollData(params, userId);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=folha-pagamento-${params.year}-${params.month}.xlsx`);

    // TODO: Generate Excel file from payrollData and stream to response
    // For now, return JSON data
    res.json(payrollData);
  }

  // =====================
  // Bonus Discount CRUD Operations
  // =====================

  @Get('discounts')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findManyDiscounts(
    @Query(new ZodQueryValidationPipe(bonusDiscountGetManySchema)) query: BonusDiscountGetManyFormData,
    @UserId() userId: string,
  ): Promise<BonusDiscountGetManyResponse> {
    return this.bonusDiscountService.findMany(query, query.include, userId);
  }

  @Post('discounts')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async createDiscount(
    @Body(new ZodValidationPipe(bonusDiscountCreateSchema)) data: BonusDiscountCreateFormData,
    @Query(new ZodQueryValidationPipe(bonusDiscountQuerySchema)) query: BonusDiscountQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusDiscountCreateResponse> {
    return this.bonusDiscountService.create(data, query.include, userId);
  }

  // Discount Batch Operations
  @Post('discounts/batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreateDiscounts(
    @Body(new ZodValidationPipe(bonusDiscountBatchCreateSchema)) data: BonusDiscountBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(bonusDiscountQuerySchema)) query: BonusDiscountQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusDiscountBatchResponse<BonusDiscountCreateFormData>> {
    return this.bonusDiscountService.batchCreate(data, query.include, userId);
  }

  @Put('discounts/batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async batchUpdateDiscounts(
    @Body(new ZodValidationPipe(bonusDiscountBatchUpdateSchema)) data: BonusDiscountBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(bonusDiscountQuerySchema)) query: BonusDiscountQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusDiscountBatchResponse<BonusDiscountUpdateFormData>> {
    return this.bonusDiscountService.batchUpdate(data, query.include, userId);
  }

  @Delete('discounts/batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDeleteDiscounts(
    @Body(new ZodValidationPipe(bonusDiscountBatchDeleteSchema)) data: BonusDiscountBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<BonusDiscountBatchResponse<string>> {
    return this.bonusDiscountService.batchDelete(data, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(bonusQuerySchema)) query: BonusQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusGetUniqueResponse> {
    return this.bonusService.findById(id, query.include, userId);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(bonusUpdateSchema)) data: BonusUpdateFormData,
    @Query(new ZodQueryValidationPipe(bonusQuerySchema)) query: BonusQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusUpdateResponse> {
    return this.bonusService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<BonusDeleteResponse> {
    return this.bonusService.delete(id, userId);
  }

  // =====================
  // Bonus Discount Dynamic routes
  // =====================

  @Get('discounts/:id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findDiscountById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(bonusDiscountQuerySchema)) query: BonusDiscountQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusDiscountGetUniqueResponse> {
    return this.bonusDiscountService.findById(id, query.include, userId);
  }

  @Put('discounts/:id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async updateDiscount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(bonusDiscountUpdateSchema)) data: BonusDiscountUpdateFormData,
    @Query(new ZodQueryValidationPipe(bonusDiscountQuerySchema)) query: BonusDiscountQueryFormData,
    @UserId() userId: string,
  ): Promise<BonusDiscountUpdateResponse> {
    return this.bonusDiscountService.update(id, data, query.include, userId);
  }

  @Delete('discounts/:id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async deleteDiscount(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<BonusDiscountDeleteResponse> {
    return this.bonusDiscountService.delete(id, userId);
  }
}