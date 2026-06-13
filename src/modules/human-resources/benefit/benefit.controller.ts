// benefit.controller.ts
// Benefícios (Departamento Pessoal) — CRUD completo + operações em lote.

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
import { BenefitService } from './benefit.service';
import {
  benefitGetManySchema,
  benefitCreateSchema,
  benefitUpdateSchema,
  benefitBatchCreateSchema,
  benefitBatchUpdateSchema,
  benefitBatchDeleteSchema,
  benefitQuerySchema,
  benefitBatchQuerySchema,
} from '../../../schemas';
import type {
  BenefitGetManyFormData,
  BenefitCreateFormData,
  BenefitUpdateFormData,
  BenefitBatchCreateFormData,
  BenefitBatchUpdateFormData,
  BenefitBatchDeleteFormData,
  BenefitQueryFormData,
  BenefitBatchQueryFormData,
} from '../../../schemas';
import type {
  BenefitGetManyResponse,
  BenefitGetUniqueResponse,
  BenefitCreateResponse,
  BenefitUpdateResponse,
  BenefitDeleteResponse,
  BenefitBatchCreateResponse,
  BenefitBatchUpdateResponse,
  BenefitBatchDeleteResponse,
} from '../../../types';

@Controller('benefits')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class BenefitController {
  constructor(private readonly service: BenefitService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(benefitGetManySchema)) query: BenefitGetManyFormData,
  ): Promise<BenefitGetManyResponse> {
    return this.service.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(benefitCreateSchema)) data: BenefitCreateFormData,
    @Query(new ZodQueryValidationPipe(benefitQuerySchema)) query: BenefitQueryFormData,
    @UserId() userId: string,
  ): Promise<BenefitCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(benefitBatchCreateSchema)) data: BenefitBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(benefitBatchQuerySchema)) query: BenefitBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<BenefitBatchCreateResponse<BenefitCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(benefitBatchUpdateSchema)) data: BenefitBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(benefitBatchQuerySchema)) query: BenefitBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<BenefitBatchUpdateResponse<BenefitUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(benefitBatchDeleteSchema)) data: BenefitBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<BenefitBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(benefitQuerySchema)) query: BenefitQueryFormData,
  ): Promise<BenefitGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(benefitUpdateSchema)) data: BenefitUpdateFormData,
    @Query(new ZodQueryValidationPipe(benefitQuerySchema)) query: BenefitQueryFormData,
    @UserId() userId: string,
  ): Promise<BenefitUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<BenefitDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
