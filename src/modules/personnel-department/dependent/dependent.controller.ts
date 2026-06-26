// dependent.controller.ts
// Dependentes do colaborador (dedução IRRF / salário-família) — CRUD completo.

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
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { DependentService } from './dependent.service';
import {
  dependentGetManySchema,
  dependentCreateSchema,
  dependentUpdateSchema,
  dependentBatchCreateSchema,
  dependentBatchUpdateSchema,
  dependentBatchDeleteSchema,
  dependentQuerySchema,
  dependentBatchQuerySchema,
} from '../../../schemas';
import type {
  DependentGetManyFormData,
  DependentCreateFormData,
  DependentUpdateFormData,
  DependentBatchCreateFormData,
  DependentBatchUpdateFormData,
  DependentBatchDeleteFormData,
  DependentQueryFormData,
  DependentBatchQueryFormData,
} from '../../../schemas';
import type {
  DependentGetManyResponse,
  DependentGetUniqueResponse,
  DependentCreateResponse,
  DependentUpdateResponse,
  DependentDeleteResponse,
  DependentBatchCreateResponse,
  DependentBatchUpdateResponse,
  DependentBatchDeleteResponse,
} from '../../../types';

@Controller('dependents')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class DependentController {
  constructor(private readonly service: DependentService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(dependentGetManySchema)) query: DependentGetManyFormData,
  ): Promise<DependentGetManyResponse> {
    return this.service.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async create(
    @Body(new ZodValidationPipe(dependentCreateSchema)) data: DependentCreateFormData,
    @Query(new ZodQueryValidationPipe(dependentQuerySchema)) query: DependentQueryFormData,
    @UserId() userId: string,
  ): Promise<DependentCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async batchCreate(
    @Body(new ZodValidationPipe(dependentBatchCreateSchema)) data: DependentBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(dependentBatchQuerySchema)) query: DependentBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<DependentBatchCreateResponse<DependentCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(dependentBatchUpdateSchema)) data: DependentBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(dependentBatchQuerySchema)) query: DependentBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<DependentBatchUpdateResponse<DependentUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async batchDelete(
    @Body(new ZodValidationPipe(dependentBatchDeleteSchema)) data: DependentBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<DependentBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(dependentQuerySchema)) query: DependentQueryFormData,
  ): Promise<DependentGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(dependentUpdateSchema)) data: DependentUpdateFormData,
    @Query(new ZodQueryValidationPipe(dependentQuerySchema)) query: DependentQueryFormData,
    @UserId() userId: string,
  ): Promise<DependentUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<DependentDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
