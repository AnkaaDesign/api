// apps/api/src/modules/production/cut/cut.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { CutService } from './cut.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  CutGetUniqueResponse,
  CutGetManyResponse,
  CutCreateResponse,
  CutUpdateResponse,
  CutDeleteResponse,
  CutBatchCreateResponse,
  CutBatchUpdateResponse,
  CutBatchDeleteResponse,
  CutBatchCreateData,
  CutBatchUpdateData,
} from '../../../types';
import {
  CutCreateFormData,
  CutUpdateFormData,
  CutGetManyFormData,
  CutQueryFormData,
  CutBatchCreateFormData,
  CutBatchUpdateFormData,
  CutBatchDeleteFormData,
  cutCreateSchema,
  cutUpdateSchema,
  cutGetManySchema,
  cutQueryParamsSchema,
  cutBatchCreateSchema,
  cutBatchUpdateSchema,
  cutBatchDeleteSchema,
} from '../../../schemas/cut';
import { z } from 'zod';
import { UserId } from '@modules/common/auth/decorators/user.decorator';

@Controller('cuts')
@UseGuards(AuthGuard)
export class CutController {
  constructor(private readonly cutService: CutService) {}

  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getMany(
    @Query(new ZodQueryValidationPipe(cutGetManySchema)) query: CutGetManyFormData,
  ): Promise<CutGetManyResponse> {
    return this.cutService.getMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(cutCreateSchema)) data: CutCreateFormData,
    @UserId() userId: string,
    @Query(new ZodQueryValidationPipe(cutQueryParamsSchema)) query: CutQueryFormData,
  ): Promise<CutCreateResponse> {
    return this.cutService.create(data, query.include, userId);
  }

  // Batch operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(cutBatchCreateSchema)) data: CutBatchCreateFormData,
    @UserId() userId: string,
    @Query(new ZodQueryValidationPipe(cutQueryParamsSchema)) query: CutQueryFormData,
  ): Promise<CutBatchCreateResponse<CutBatchCreateData>> {
    return this.cutService.batchCreate(data, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(cutBatchUpdateSchema)) data: CutBatchUpdateFormData,
    @UserId() userId: string,
    @Query(new ZodQueryValidationPipe(cutQueryParamsSchema)) query: CutQueryFormData,
  ): Promise<CutBatchUpdateResponse<CutBatchUpdateData>> {
    return this.cutService.batchUpdate(data, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(cutBatchDeleteSchema)) data: CutBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<CutBatchDeleteResponse> {
    return this.cutService.batchDelete(data, userId);
  }

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getUnique(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(cutQueryParamsSchema)) query: CutQueryFormData,
  ): Promise<CutGetUniqueResponse> {
    return this.cutService.getUnique(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cutUpdateSchema)) data: CutUpdateFormData,
    @UserId() userId: string,
    @Query(new ZodQueryValidationPipe(cutQueryParamsSchema)) query: CutQueryFormData,
  ): Promise<CutUpdateResponse> {
    return this.cutService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<CutDeleteResponse> {
    return this.cutService.delete(id, userId);
  }
}
