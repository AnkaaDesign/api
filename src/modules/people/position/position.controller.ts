// position.controller.ts

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
  NotFoundException,
} from '@nestjs/common';
import { PositionService } from './position.service';
import { PositionRemunerationService } from './position-remuneration.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { z } from 'zod';
import type {
  Position,
  PositionBatchCreateResponse,
  PositionBatchDeleteResponse,
  PositionBatchUpdateResponse,
  PositionCreateResponse,
  PositionDeleteResponse,
  PositionGetManyResponse,
  PositionGetUniqueResponse,
  PositionUpdateResponse,
  PositionRemuneration,
  PositionRemunerationBatchCreateResponse,
  PositionRemunerationBatchDeleteResponse,
  PositionRemunerationBatchUpdateResponse,
  PositionRemunerationCreateResponse,
  PositionRemunerationDeleteResponse,
  PositionRemunerationGetManyResponse,
  PositionRemunerationGetUniqueResponse,
  PositionRemunerationUpdateResponse,
} from '../../../types';
import type {
  PositionCreateFormData,
  PositionUpdateFormData,
  PositionGetManyFormData,
  PositionBatchCreateFormData,
  PositionBatchUpdateFormData,
  PositionBatchDeleteFormData,
  PositionQueryFormData,
  PositionRemunerationCreateFormData,
  PositionRemunerationUpdateFormData,
  PositionRemunerationGetManyFormData,
  PositionRemunerationBatchCreateFormData,
  PositionRemunerationBatchUpdateFormData,
  PositionRemunerationBatchDeleteFormData,
  PositionRemunerationQueryFormData,
  PositionRemunerationBatchQueryFormData,
} from '../../../schemas/position';
import {
  positionCreateSchema,
  positionBatchCreateSchema,
  positionBatchDeleteSchema,
  positionBatchUpdateSchema,
  positionGetManySchema,
  positionUpdateSchema,
  positionGetByIdSchema,
  positionQuerySchema,
  positionRemunerationCreateSchema,
  positionRemunerationBatchCreateSchema,
  positionRemunerationBatchDeleteSchema,
  positionRemunerationBatchUpdateSchema,
  positionRemunerationGetManySchema,
  positionRemunerationUpdateSchema,
  positionRemunerationQuerySchema,
  positionRemunerationBatchQuerySchema,
  positionRemunerationGetByIdSchema,
} from '../../../schemas/position';

@Controller('positions')
export class PositionController {
  constructor(private readonly positionService: PositionService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(positionGetManySchema)) query: PositionGetManyFormData,
  ): Promise<PositionGetManyResponse> {
    return this.positionService.findMany(query);
  }

  // Batch Operations (before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(positionBatchCreateSchema)) data: PositionBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(positionQuerySchema)) query: PositionQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionBatchCreateResponse<PositionCreateFormData>> {
    return this.positionService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(positionBatchUpdateSchema)) data: PositionBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(positionQuerySchema)) query: PositionQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionBatchUpdateResponse<PositionUpdateFormData>> {
    return this.positionService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(positionBatchDeleteSchema)) data: PositionBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PositionBatchDeleteResponse> {
    return this.positionService.batchDelete(data, userId);
  }

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(positionQuerySchema)) query: PositionQueryFormData,
  ): Promise<PositionGetUniqueResponse> {
    return this.positionService.findById(id, query.include);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(positionCreateSchema)) data: PositionCreateFormData,
    @Query(new ZodQueryValidationPipe(positionQuerySchema)) query: PositionQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionCreateResponse> {
    return this.positionService.create(data, query.include, userId);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(positionUpdateSchema)) data: PositionUpdateFormData,
    @Query(new ZodQueryValidationPipe(positionQuerySchema)) query: PositionQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionUpdateResponse> {
    return this.positionService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PositionDeleteResponse> {
    return this.positionService.delete(id, userId);
  }

  // =====================
  // USER-SPECIFIC ENDPOINTS
  // =====================

  // Note: Users should get their position information through the user endpoints
  // This is just for HR/Admin to manage positions
}

@Controller('position-remunerations')
export class PositionRemunerationController {
  constructor(private readonly positionRemunerationService: PositionRemunerationService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(positionRemunerationGetManySchema))
    query: PositionRemunerationGetManyFormData,
  ): Promise<PositionRemunerationGetManyResponse> {
    return this.positionRemunerationService.findMany(query);
  }

  // Batch Operations (before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(positionRemunerationBatchCreateSchema))
    data: PositionRemunerationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(positionRemunerationBatchQuerySchema))
    query: PositionRemunerationBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionRemunerationBatchCreateResponse<PositionRemunerationCreateFormData>> {
    return this.positionRemunerationService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(positionRemunerationBatchUpdateSchema))
    data: PositionRemunerationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(positionRemunerationBatchQuerySchema))
    query: PositionRemunerationBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionRemunerationBatchUpdateResponse<PositionRemunerationUpdateFormData>> {
    return this.positionRemunerationService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(positionRemunerationBatchDeleteSchema))
    data: PositionRemunerationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PositionRemunerationBatchDeleteResponse> {
    return this.positionRemunerationService.batchDelete(data, userId);
  }

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(positionRemunerationQuerySchema))
    query: PositionRemunerationQueryFormData,
  ): Promise<PositionRemunerationGetUniqueResponse> {
    return this.positionRemunerationService.findById(id, query.include);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(positionRemunerationCreateSchema))
    data: PositionRemunerationCreateFormData,
    @Query(new ZodQueryValidationPipe(positionRemunerationQuerySchema))
    query: PositionRemunerationQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionRemunerationCreateResponse> {
    return this.positionRemunerationService.create(data, query.include, userId);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(positionRemunerationUpdateSchema))
    data: PositionRemunerationUpdateFormData,
    @Query(new ZodQueryValidationPipe(positionRemunerationQuerySchema))
    query: PositionRemunerationQueryFormData,
    @UserId() userId: string,
  ): Promise<PositionRemunerationUpdateResponse> {
    return this.positionRemunerationService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PositionRemunerationDeleteResponse> {
    return this.positionRemunerationService.delete(id, userId);
  }
}
