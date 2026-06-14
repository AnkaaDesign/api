// work-accident.controller.ts
// CAT — Comunicação de Acidente de Trabalho. CRUD completo, gated a
// ACCOUNTING / HUMAN_RESOURCES / ADMIN (mesma matriz do restante da Medicina do Trabalho).

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
import { WorkAccidentService } from './work-accident.service';
import {
  workAccidentReportGetManySchema,
  workAccidentReportCreateSchema,
  workAccidentReportUpdateSchema,
  workAccidentReportBatchCreateSchema,
  workAccidentReportBatchUpdateSchema,
  workAccidentReportBatchDeleteSchema,
  workAccidentReportQuerySchema,
  workAccidentReportBatchQuerySchema,
} from '../../../schemas';
import type {
  WorkAccidentReportGetManyFormData,
  WorkAccidentReportCreateFormData,
  WorkAccidentReportUpdateFormData,
  WorkAccidentReportBatchCreateFormData,
  WorkAccidentReportBatchUpdateFormData,
  WorkAccidentReportBatchDeleteFormData,
  WorkAccidentReportQueryFormData,
  WorkAccidentReportBatchQueryFormData,
} from '../../../schemas';
import type {
  WorkAccidentReportGetManyResponse,
  WorkAccidentReportGetUniqueResponse,
  WorkAccidentReportCreateResponse,
  WorkAccidentReportUpdateResponse,
  WorkAccidentReportDeleteResponse,
  WorkAccidentReportBatchCreateResponse,
  WorkAccidentReportBatchUpdateResponse,
  WorkAccidentReportBatchDeleteResponse,
} from '../../../types';

@Controller('work-accident-reports')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class WorkAccidentController {
  constructor(private readonly service: WorkAccidentService) {}

  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(workAccidentReportGetManySchema))
    query: WorkAccidentReportGetManyFormData,
  ): Promise<WorkAccidentReportGetManyResponse> {
    return this.service.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(workAccidentReportCreateSchema))
    data: WorkAccidentReportCreateFormData,
    @Query(new ZodQueryValidationPipe(workAccidentReportQuerySchema))
    query: WorkAccidentReportQueryFormData,
    @UserId() userId: string,
  ): Promise<WorkAccidentReportCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(workAccidentReportBatchCreateSchema))
    data: WorkAccidentReportBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(workAccidentReportBatchQuerySchema))
    query: WorkAccidentReportBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WorkAccidentReportBatchCreateResponse<WorkAccidentReportCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(workAccidentReportBatchUpdateSchema))
    data: WorkAccidentReportBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(workAccidentReportBatchQuerySchema))
    query: WorkAccidentReportBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WorkAccidentReportBatchUpdateResponse<WorkAccidentReportUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(workAccidentReportBatchDeleteSchema))
    data: WorkAccidentReportBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<WorkAccidentReportBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(workAccidentReportQuerySchema))
    query: WorkAccidentReportQueryFormData,
  ): Promise<WorkAccidentReportGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workAccidentReportUpdateSchema))
    data: WorkAccidentReportUpdateFormData,
    @Query(new ZodQueryValidationPipe(workAccidentReportQuerySchema))
    query: WorkAccidentReportQueryFormData,
    @UserId() userId: string,
  ): Promise<WorkAccidentReportUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<WorkAccidentReportDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
