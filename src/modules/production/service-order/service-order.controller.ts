// service-order.controller.ts

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
  UseGuards,
} from '@nestjs/common';
import { ServiceOrderService } from './service-order.service';
import { UserId, User, UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UUIDPathGuard } from '@modules/common/guards/uuid-path.guard';
import { SECTOR_PRIVILEGES, SERVICE_ORDER_STATUS } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import type {
  ServiceOrderGetUniqueResponse,
  ServiceOrderGetManyResponse,
  ServiceOrderCreateResponse,
  ServiceOrderUpdateResponse,
  ServiceOrderDeleteResponse,
  ServiceOrderBatchCreateResponse,
  ServiceOrderBatchUpdateResponse,
  ServiceOrderBatchDeleteResponse,
} from '../../../types';
import type {
  ServiceOrderGetManyFormData,
  ServiceOrderCreateFormData,
  ServiceOrderUpdateFormData,
  ServiceOrderBatchCreateFormData,
  ServiceOrderBatchUpdateFormData,
  ServiceOrderBatchDeleteFormData,
  ServiceOrderQueryFormData,
  ServiceOrderBatchQueryFormData,
} from '../../../schemas/serviceOrder';

import {
  serviceOrderGetManySchema,
  serviceOrderCreateSchema,
  serviceOrderUpdateSchema,
  serviceOrderBatchCreateSchema,
  serviceOrderBatchUpdateSchema,
  serviceOrderBatchDeleteSchema,
  serviceOrderBatchQuerySchema,
  serviceOrderQuerySchema,
} from '../../../schemas/serviceOrder';

@Controller('service-orders')
export class ServiceOrderController {
  constructor(private readonly serviceOrderService: ServiceOrderService) {}

  // Unique Descriptions endpoint (must come before dynamic routes)
  @Get('descriptions')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getUniqueDescriptions(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: boolean; message: string; data: string[] }> {
    const limitNumber = limit ? parseInt(limit, 10) : 50;
    return this.serviceOrderService.getUniqueDescriptions(type, search, limitNumber);
  }

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(serviceOrderGetManySchema))
    query: ServiceOrderGetManyFormData,
  ): Promise<ServiceOrderGetManyResponse> {
    return this.serviceOrderService.findMany(query);
  }

  @Post()
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(serviceOrderCreateSchema)) data: ServiceOrderCreateFormData,
    @Query(new ZodQueryValidationPipe(serviceOrderQuerySchema)) query: ServiceOrderQueryFormData,
    @UserId() userId: string,
  ): Promise<ServiceOrderCreateResponse> {
    return this.serviceOrderService.create(data, query.include, userId);
  }

  // Batch Operations
  @Post('batch')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(serviceOrderBatchCreateSchema))
    data: ServiceOrderBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(serviceOrderBatchQuerySchema))
    query: ServiceOrderBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<ServiceOrderBatchCreateResponse<ServiceOrderCreateFormData>> {
    return this.serviceOrderService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(serviceOrderBatchUpdateSchema))
    data: ServiceOrderBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(serviceOrderBatchQuerySchema))
    query: ServiceOrderBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<ServiceOrderBatchUpdateResponse<ServiceOrderUpdateFormData>> {
    return this.serviceOrderService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(serviceOrderBatchDeleteSchema))
    data: ServiceOrderBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ServiceOrderBatchDeleteResponse> {
    return this.serviceOrderService.batchDelete(data, userId);
  }

  // =====================
  // STATUS CHANGE ENDPOINTS
  // =====================

  @Put(':id/status')
  @UseGuards(UUIDPathGuard)
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
  )
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: SERVICE_ORDER_STATUS,
    @Query(new ZodQueryValidationPipe(serviceOrderQuerySchema)) query: ServiceOrderQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
  ): Promise<ServiceOrderUpdateResponse> {
    return this.serviceOrderService.update(
      id,
      { status },
      query.include,
      userId,
      user?.role as SECTOR_PRIVILEGES,
    );
  }

  // Dynamic routes should come last
  @Get(':id')
  @UseGuards(UUIDPathGuard)
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(serviceOrderQuerySchema)) query: ServiceOrderQueryFormData,
  ): Promise<ServiceOrderGetUniqueResponse> {
    return this.serviceOrderService.findById(id, query.include);
  }

  @Put(':id')
  @UseGuards(UUIDPathGuard)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(serviceOrderUpdateSchema)) data: ServiceOrderUpdateFormData,
    @Query(new ZodQueryValidationPipe(serviceOrderQuerySchema)) query: ServiceOrderQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
  ): Promise<ServiceOrderUpdateResponse> {
    return this.serviceOrderService.update(
      id,
      data,
      query.include,
      userId,
      user?.role as SECTOR_PRIVILEGES,
    );
  }

  @Delete(':id')
  @UseGuards(UUIDPathGuard)
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ServiceOrderDeleteResponse> {
    return this.serviceOrderService.delete(id, userId);
  }
}

// ServiceController removed - Service entity is no longer used
// Service descriptions are now managed via enums in constants/service-descriptions.ts
