// medical-exam.controller.ts
// ASO / Exames ocupacionais (Medicina do Trabalho) — CRUD completo, painel de
// vencimentos (expiring), conclusão de exame e upload do documento ASO.

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
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { MedicalExamService } from './medical-exam.service';
import {
  medicalExamGetManySchema,
  medicalExamExpiringSchema,
  medicalExamCreateSchema,
  medicalExamUpdateSchema,
  medicalExamCompleteSchema,
  medicalExamBatchCreateSchema,
  medicalExamBatchUpdateSchema,
  medicalExamBatchDeleteSchema,
  medicalExamQuerySchema,
  medicalExamBatchQuerySchema,
} from '../../../schemas';
import type {
  MedicalExamGetManyFormData,
  MedicalExamExpiringFormData,
  MedicalExamCreateFormData,
  MedicalExamUpdateFormData,
  MedicalExamCompleteFormData,
  MedicalExamBatchCreateFormData,
  MedicalExamBatchUpdateFormData,
  MedicalExamBatchDeleteFormData,
  MedicalExamQueryFormData,
  MedicalExamBatchQueryFormData,
} from '../../../schemas';
import type {
  MedicalExamGetManyResponse,
  MedicalExamGetUniqueResponse,
  MedicalExamCreateResponse,
  MedicalExamUpdateResponse,
  MedicalExamDeleteResponse,
  MedicalExamBatchCreateResponse,
  MedicalExamBatchUpdateResponse,
  MedicalExamBatchDeleteResponse,
} from '../../../types';

@Controller('medical-exams')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class MedicalExamController {
  constructor(private readonly service: MedicalExamService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(medicalExamGetManySchema)) query: MedicalExamGetManyFormData,
  ): Promise<MedicalExamGetManyResponse> {
    return this.service.findMany(query);
  }

  // Exames Periódicos dashboard: COMPLETED exams expiring within N days (or
  // already overdue), with user+position, ordered by expiresAt asc.
  // Static route — must come before @Get(':id').
  @Get('expiring')
  @ReadRateLimit()
  async findExpiring(
    @Query(new ZodQueryValidationPipe(medicalExamExpiringSchema))
    query: MedicalExamExpiringFormData,
  ): Promise<MedicalExamGetManyResponse> {
    return this.service.findExpiring(query.days);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(medicalExamCreateSchema)) data: MedicalExamCreateFormData,
    @Query(new ZodQueryValidationPipe(medicalExamQuerySchema)) query: MedicalExamQueryFormData,
    @UserId() userId: string,
  ): Promise<MedicalExamCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(medicalExamBatchCreateSchema))
    data: MedicalExamBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(medicalExamBatchQuerySchema))
    query: MedicalExamBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<MedicalExamBatchCreateResponse<MedicalExamCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(medicalExamBatchUpdateSchema))
    data: MedicalExamBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(medicalExamBatchQuerySchema))
    query: MedicalExamBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<MedicalExamBatchUpdateResponse<MedicalExamUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(medicalExamBatchDeleteSchema))
    data: MedicalExamBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<MedicalExamBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  // Conclusão do exame (SCHEDULED → COMPLETED)
  @Put(':id/complete')
  @WriteRateLimit()
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(medicalExamCompleteSchema)) data: MedicalExamCompleteFormData,
    @Query(new ZodQueryValidationPipe(medicalExamQuerySchema)) query: MedicalExamQueryFormData,
    @UserId() userId: string,
  ): Promise<MedicalExamUpdateResponse> {
    return this.service.complete(id, data, query.include, userId);
  }

  // Upload do documento ASO (define fileId)
  @Post(':id/document')
  @WriteRateLimit()
  @UseInterceptors(FilesInterceptor('document', 1, multerConfig))
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(medicalExamQuerySchema)) query: MedicalExamQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<MedicalExamUpdateResponse> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Nenhum arquivo enviado. Use o campo "document" para enviar o documento ASO.',
      );
    }
    return this.service.uploadDocument(id, files[0], query.include, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(medicalExamQuerySchema)) query: MedicalExamQueryFormData,
  ): Promise<MedicalExamGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(medicalExamUpdateSchema)) data: MedicalExamUpdateFormData,
    @Query(new ZodQueryValidationPipe(medicalExamQuerySchema)) query: MedicalExamQueryFormData,
    @UserId() userId: string,
  ): Promise<MedicalExamUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<MedicalExamDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
