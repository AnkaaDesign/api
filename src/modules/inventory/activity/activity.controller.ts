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

@Controller('activities')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
