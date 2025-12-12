// activity.controller.ts

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
import { ActivityService } from './activity.service';
import { ConsumptionAnalyticsService } from './consumption-analytics.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import type {
  ActivityBatchCreateResponse,
  ActivityBatchDeleteResponse,
  ActivityBatchUpdateResponse,
  ActivityCreateResponse,
  ActivityDeleteResponse,
  ActivityGetManyResponse,
  ActivityGetUniqueResponse,
  ActivityUpdateResponse,
} from '../../../types';
import type { ConsumptionAnalyticsResponse } from '../../../types/consumption-analytics';
import type {
  ActivityCreateFormData,
  ActivityUpdateFormData,
  ActivityGetManyFormData,
  ActivityBatchCreateFormData,
  ActivityBatchUpdateFormData,
  ActivityBatchDeleteFormData,
  ActivityGetByIdFormData,
  ActivityQueryFormData,
} from '../../../schemas/activity';
import type { ConsumptionAnalyticsFormData } from '../../../schemas/consumption-analytics';
import {
  activityCreateSchema,
  activityBatchCreateSchema,
  activityBatchDeleteSchema,
  activityBatchUpdateSchema,
  activityGetManySchema,
  activityUpdateSchema,
  activityGetByIdSchema,
  activityQuerySchema,
} from '../../../schemas/activity';
import { consumptionAnalyticsSchema } from '../../../schemas/consumption-analytics';

@Controller('activities')
export class ActivityController {
  constructor(
    private readonly activityService: ActivityService,
    private readonly consumptionAnalyticsService: ConsumptionAnalyticsService,
  ) {}

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
    @Query(new ZodQueryValidationPipe(activityGetManySchema)) query: ActivityGetManyFormData,
    @UserId() userId: string,
  ): Promise<ActivityGetManyResponse> {
    return this.activityService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(activityCreateSchema)) data: ActivityCreateFormData,
    @Query(new ZodQueryValidationPipe(activityQuerySchema)) query: ActivityQueryFormData,
    @UserId() userId: string,
  ): Promise<ActivityCreateResponse> {
    return this.activityService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(activityBatchCreateSchema)) data: ActivityBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(activityQuerySchema)) query: ActivityQueryFormData,
    @UserId() userId: string,
  ): Promise<ActivityBatchCreateResponse<ActivityCreateFormData>> {
    return this.activityService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(activityBatchUpdateSchema)) data: ActivityBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(activityQuerySchema)) query: ActivityQueryFormData,
    @UserId() userId: string,
  ): Promise<ActivityBatchUpdateResponse<ActivityUpdateFormData>> {
    return this.activityService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(activityBatchDeleteSchema)) data: ActivityBatchDeleteFormData,
    @Query(new ZodQueryValidationPipe(activityQuerySchema)) query: ActivityQueryFormData,
    @UserId() userId: string,
  ): Promise<ActivityBatchDeleteResponse> {
    return this.activityService.batchDelete(data, query.include, userId);
  }

  // Analytics Operations
  @Post('analytics/consumption-comparison')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @HttpCode(HttpStatus.OK)
  async getConsumptionAnalytics(
    @Body(new ZodValidationPipe(consumptionAnalyticsSchema)) data: ConsumptionAnalyticsFormData,
    @UserId() userId: string,
  ): Promise<ConsumptionAnalyticsResponse> {
    return this.consumptionAnalyticsService.getConsumptionAnalytics(data);
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
    @Query(new ZodQueryValidationPipe(activityGetByIdSchema)) query: ActivityGetByIdFormData,
    @UserId() userId: string,
  ): Promise<ActivityGetUniqueResponse> {
    return this.activityService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(activityUpdateSchema)) data: ActivityUpdateFormData,
    @Query(new ZodQueryValidationPipe(activityQuerySchema)) query: ActivityQueryFormData,
    @UserId() userId: string,
  ): Promise<ActivityUpdateResponse> {
    return this.activityService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ActivityDeleteResponse> {
    return this.activityService.delete(id, userId);
  }
}
