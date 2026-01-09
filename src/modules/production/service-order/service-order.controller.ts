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
} from '@nestjs/common';
import { ServiceOrderService } from './service-order.service';
import { ServiceService } from './service.service';
import { UserId, User, UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
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
  ServiceCreateResponse,
  ServiceGetUniqueResponse,
  ServiceGetManyResponse,
  ServiceUpdateResponse,
  ServiceDeleteResponse,
  ServiceBatchCreateResponse,
  ServiceBatchUpdateResponse,
  ServiceBatchDeleteResponse,
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

import type {
  ServiceGetManyFormData,
  ServiceCreateFormData,
  ServiceUpdateFormData,
  ServiceBatchCreateFormData,
  ServiceBatchUpdateFormData,
  ServiceBatchDeleteFormData,
  ServiceQueryFormData,
} from '../../../schemas/service';

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

import {
  serviceGetManySchema,
  serviceQuerySchema,
  serviceCreateSchema,
  serviceUpdateSchema,
  serviceBatchCreateSchema,
  serviceBatchUpdateSchema,
  serviceBatchDeleteSchema,
} from '../../../schemas/service';

@Controller('service-orders')
export class ServiceOrderController {
  constructor(private readonly serviceOrderService: ServiceOrderService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

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
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
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
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

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
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
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
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ServiceOrderDeleteResponse> {
    return this.serviceOrderService.delete(id, userId);
  }
}

@Controller('services')
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(serviceGetManySchema)) query: ServiceGetManyFormData,
  ): Promise<ServiceGetManyResponse> {
    return this.serviceService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(serviceCreateSchema)) data: ServiceCreateFormData,
    @Query(new ZodQueryValidationPipe(serviceQuerySchema)) query: ServiceQueryFormData,
    @UserId() userId: string,
  ): Promise<ServiceCreateResponse> {
    return this.serviceService.create(data, query.include, userId);
  }

  // Batch Operations
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(serviceBatchCreateSchema)) data: ServiceBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(serviceQuerySchema)) query: ServiceQueryFormData,
    @UserId() userId: string,
  ): Promise<ServiceBatchCreateResponse<ServiceCreateFormData>> {
    return this.serviceService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(serviceBatchUpdateSchema)) data: ServiceBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(serviceQuerySchema)) query: ServiceQueryFormData,
    @UserId() userId: string,
  ): Promise<ServiceBatchUpdateResponse<ServiceUpdateFormData>> {
    return this.serviceService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(serviceBatchDeleteSchema)) data: ServiceBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ServiceBatchDeleteResponse> {
    return this.serviceService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(serviceQuerySchema)) query: ServiceQueryFormData,
  ): Promise<ServiceGetUniqueResponse> {
    return this.serviceService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(serviceUpdateSchema)) data: ServiceUpdateFormData,
    @Query(new ZodQueryValidationPipe(serviceQuerySchema)) query: ServiceQueryFormData,
    @UserId() userId: string,
  ): Promise<ServiceUpdateResponse> {
    return this.serviceService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ServiceDeleteResponse> {
    return this.serviceService.delete(id, userId);
  }
}
