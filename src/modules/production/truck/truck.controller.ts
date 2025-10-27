import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TruckService } from './truck.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  truckCreateSchema,
  truckUpdateSchema,
  truckQuerySchema,
  truckGetManySchema,
  truckGetByIdSchema,
  truckBatchCreateSchema,
  truckBatchUpdateSchema,
  truckBatchDeleteSchema,
  truckBatchQuerySchema,
} from '../../../schemas';
import type {
  TruckCreateFormData,
  TruckUpdateFormData,
  TruckQueryFormData,
  TruckGetManyFormData,
  TruckBatchCreateFormData,
  TruckBatchUpdateFormData,
  TruckBatchDeleteFormData,
  TruckBatchQueryFormData,
} from '../../../schemas';
import type {
  Truck,
  TruckGetManyResponse,
  TruckGetUniqueResponse,
  TruckCreateResponse,
  TruckUpdateResponse,
  TruckDeleteResponse,
  TruckBatchCreateResponse,
  TruckBatchUpdateResponse,
  TruckBatchDeleteResponse,
} from '../../../types';

@Controller('trucks')
export class TruckController {
  constructor(private readonly trucksService: TruckService) {}

  // =====================
  // BASIC CRUD OPERATIONS
  // =====================

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(truckGetManySchema)) query: TruckGetManyFormData,
  ): Promise<TruckGetManyResponse> {
    return this.trucksService.findMany(query);
  }

  @Post()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(truckCreateSchema)) data: TruckCreateFormData,
    @Query(new ZodQueryValidationPipe(truckQuerySchema)) query: TruckQueryFormData,
    @UserId() userId: string,
  ): Promise<TruckCreateResponse> {
    return this.trucksService.create(data, query.include, userId);
  }

  // =====================
  // BATCH OPERATIONS
  // =====================

  @Post('batch')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(truckBatchCreateSchema)) data: TruckBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(truckBatchQuerySchema)) query: TruckBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<TruckBatchCreateResponse<TruckCreateFormData>> {
    return this.trucksService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async batchUpdate(
    @Body(new ZodValidationPipe(truckBatchUpdateSchema)) data: TruckBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(truckBatchQuerySchema)) query: TruckBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<TruckBatchUpdateResponse<TruckUpdateFormData>> {
    return this.trucksService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(truckBatchDeleteSchema)) data: TruckBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<TruckBatchDeleteResponse> {
    return this.trucksService.batchDelete(data, userId);
  }

  // =====================
  // DYNAMIC ROUTES (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(truckQuerySchema)) query: TruckQueryFormData,
  ): Promise<TruckGetUniqueResponse> {
    return this.trucksService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(truckUpdateSchema)) data: TruckUpdateFormData,
    @Query(new ZodQueryValidationPipe(truckQuerySchema)) query: TruckQueryFormData,
    @UserId() userId: string,
  ): Promise<TruckUpdateResponse> {
    return this.trucksService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<TruckDeleteResponse> {
    return this.trucksService.delete(id, userId);
  }
}
