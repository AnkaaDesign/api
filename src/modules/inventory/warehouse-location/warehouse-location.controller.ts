// warehouse-location.controller.ts

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
import { WarehouseLocationService } from './warehouse-location.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import type {
  WarehouseLocationBatchCreateResponse,
  WarehouseLocationBatchDeleteResponse,
  WarehouseLocationBatchUpdateResponse,
  WarehouseLocationCreateResponse,
  WarehouseLocationDeleteResponse,
  WarehouseLocationGetManyResponse,
  WarehouseLocationGetUniqueResponse,
  WarehouseLocationUpdateResponse,
} from '../../../types';
import type {
  WarehouseLocationCreateFormData,
  WarehouseLocationUpdateFormData,
  WarehouseLocationGetManyFormData,
  WarehouseLocationBatchCreateFormData,
  WarehouseLocationBatchUpdateFormData,
  WarehouseLocationBatchDeleteFormData,
  WarehouseLocationQueryFormData,
} from '../../../schemas/warehouse-location';
import {
  warehouseLocationCreateSchema,
  warehouseLocationBatchCreateSchema,
  warehouseLocationBatchDeleteSchema,
  warehouseLocationBatchUpdateSchema,
  warehouseLocationGetManySchema,
  warehouseLocationUpdateSchema,
  warehouseLocationQuerySchema,
} from '../../../schemas/warehouse-location';

@Controller('warehouse-locations')
export class WarehouseLocationController {
  constructor(private readonly warehouseLocationService: WarehouseLocationService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(warehouseLocationGetManySchema))
    query: WarehouseLocationGetManyFormData,
    @UserId() userId: string,
  ): Promise<WarehouseLocationGetManyResponse> {
    return this.warehouseLocationService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(warehouseLocationCreateSchema))
    data: WarehouseLocationCreateFormData,
    @Query(new ZodQueryValidationPipe(warehouseLocationQuerySchema))
    query: WarehouseLocationQueryFormData,
    @UserId() userId: string,
  ): Promise<WarehouseLocationCreateResponse> {
    return this.warehouseLocationService.create(data, query.include, userId);
  }

  // Batch Operations - Must come before dynamic routes
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(warehouseLocationBatchCreateSchema))
    data: WarehouseLocationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(warehouseLocationQuerySchema))
    query: WarehouseLocationQueryFormData,
    @UserId() userId: string,
  ): Promise<WarehouseLocationBatchCreateResponse<WarehouseLocationCreateFormData>> {
    return this.warehouseLocationService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(warehouseLocationBatchUpdateSchema))
    data: WarehouseLocationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(warehouseLocationQuerySchema))
    query: WarehouseLocationQueryFormData,
    @UserId() userId: string,
  ): Promise<WarehouseLocationBatchUpdateResponse<WarehouseLocationUpdateFormData>> {
    return this.warehouseLocationService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(warehouseLocationBatchDeleteSchema))
    data: WarehouseLocationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<WarehouseLocationBatchDeleteResponse> {
    return this.warehouseLocationService.batchDelete(data, userId);
  }

  // Dynamic routes - Must come after static routes
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(warehouseLocationQuerySchema))
    query: WarehouseLocationQueryFormData,
    @UserId() userId: string,
  ): Promise<WarehouseLocationGetUniqueResponse> {
    return this.warehouseLocationService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(warehouseLocationUpdateSchema))
    data: WarehouseLocationUpdateFormData,
    @Query(new ZodQueryValidationPipe(warehouseLocationQuerySchema))
    query: WarehouseLocationQueryFormData,
    @UserId() userId: string,
  ): Promise<WarehouseLocationUpdateResponse> {
    return this.warehouseLocationService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<WarehouseLocationDeleteResponse> {
    return this.warehouseLocationService.delete(id, userId);
  }
}
