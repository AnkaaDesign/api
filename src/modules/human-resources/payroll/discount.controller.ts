import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DiscountService } from './discount.service';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import type {
  DiscountCreateResponse,
  DiscountDeleteResponse,
  DiscountGetManyResponse,
  DiscountGetUniqueResponse,
  DiscountUpdateResponse,
  DiscountBatchCreateResponse,
  DiscountBatchUpdateResponse,
  DiscountBatchDeleteResponse,
} from '../../../types';
import type {
  DiscountCreateFormData,
  DiscountUpdateFormData,
  DiscountGetManyFormData,
  DiscountQueryFormData,
  DiscountBatchCreateFormData,
  DiscountBatchUpdateFormData,
  DiscountBatchDeleteFormData,
} from '../../../schemas/discount';
import {
  discountCreateSchema,
  discountUpdateSchema,
  discountGetManySchema,
  discountQuerySchema,
  discountBatchCreateSchema,
  discountBatchUpdateSchema,
  discountBatchDeleteSchema,
} from '../../../schemas/discount';

@Controller('discount')
@UseGuards(AuthGuard)
export class DiscountController {
  constructor(private readonly discountService: DiscountService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(discountGetManySchema)) query: DiscountGetManyFormData,
    @UserId() userId: string,
  ): Promise<DiscountGetManyResponse> {
    return this.discountService.findMany(query, query.include, userId);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(discountCreateSchema)) data: DiscountCreateFormData,
    @UserId() userId: string,
  ): Promise<DiscountCreateResponse> {
    return this.discountService.create(data, undefined, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(discountBatchCreateSchema)) data: DiscountBatchCreateFormData,
    @UserId() userId: string,
  ): Promise<DiscountBatchCreateResponse<DiscountCreateFormData>> {
    return this.discountService.batchCreate(data, undefined, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(discountBatchUpdateSchema)) data: DiscountBatchUpdateFormData,
    @UserId() userId: string,
  ): Promise<DiscountBatchUpdateResponse<DiscountUpdateFormData>> {
    return this.discountService.batchUpdate(data, undefined, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(discountBatchDeleteSchema)) data: DiscountBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<DiscountBatchDeleteResponse> {
    return this.discountService.batchDelete(data, userId);
  }

  // Special operations (before dynamic routes)
  @Get('by-payroll/:payrollId')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findByPayroll(
    @Param('payrollId', ParseUUIDPipe) payrollId: string,
    @UserId() userId: string,
  ) {
    const discounts = await this.discountService.findByPayroll(payrollId, undefined);

    return {
      success: true,
      message: 'Descontos da folha de pagamento encontrados com sucesso',
      data: discounts,
    };
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<DiscountGetUniqueResponse> {
    return this.discountService.findById(id, undefined);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(discountUpdateSchema)) data: DiscountUpdateFormData,
    @UserId() userId: string,
  ): Promise<DiscountUpdateResponse> {
    return this.discountService.update(id, data, undefined, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<DiscountDeleteResponse> {
    return this.discountService.delete(id, userId);
  }
}
