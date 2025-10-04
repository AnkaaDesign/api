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
  // Payroll Operations
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