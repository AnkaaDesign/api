// admission.controller.ts
// Admissões (Departamento Pessoal) — contract §2.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
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
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { AdmissionService } from './admission.service';
import type {
  AdmissionBatchCreateResponse,
  AdmissionBatchDeleteResponse,
  AdmissionBatchUpdateResponse,
  AdmissionCreateResponse,
  AdmissionDeleteResponse,
  AdmissionDocumentUpdateResponse,
  AdmissionGetManyResponse,
  AdmissionGetUniqueResponse,
  AdmissionUpdateResponse,
} from '../../../types';
import type {
  AdmissionAdvanceFormData,
  AdmissionBatchCreateFormData,
  AdmissionBatchDeleteFormData,
  AdmissionBatchQueryFormData,
  AdmissionBatchUpdateFormData,
  AdmissionCreateFormData,
  AdmissionDocumentUpdateFormData,
  AdmissionDocumentUploadFormData,
  AdmissionGetManyFormData,
  AdmissionQueryFormData,
  AdmissionUpdateFormData,
} from '../../../schemas';
import {
  admissionAdvanceSchema,
  admissionBatchCreateSchema,
  admissionBatchDeleteSchema,
  admissionBatchQuerySchema,
  admissionBatchUpdateSchema,
  admissionCreateSchema,
  admissionDocumentUpdateSchema,
  admissionDocumentUploadSchema,
  admissionGetManySchema,
  admissionQuerySchema,
  admissionUpdateSchema,
} from '../../../schemas';

@Controller('admissions')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class AdmissionController {
  constructor(private readonly admissionService: AdmissionService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(admissionGetManySchema)) query: AdmissionGetManyFormData,
  ): Promise<AdmissionGetManyResponse> {
    return this.admissionService.findMany(query);
  }

  @Post()
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(admissionCreateSchema)) data: AdmissionCreateFormData,
    @Query(new ZodQueryValidationPipe(admissionQuerySchema)) query: AdmissionQueryFormData,
    @UserId() userId: string,
  ): Promise<AdmissionCreateResponse> {
    return this.admissionService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(admissionBatchCreateSchema)) data: AdmissionBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(admissionBatchQuerySchema))
    query: AdmissionBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<AdmissionBatchCreateResponse<AdmissionCreateFormData>> {
    return this.admissionService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(admissionBatchUpdateSchema)) data: AdmissionBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(admissionBatchQuerySchema))
    query: AdmissionBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<AdmissionBatchUpdateResponse<AdmissionUpdateFormData>> {
    return this.admissionService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(admissionBatchDeleteSchema)) data: AdmissionBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<AdmissionBatchDeleteResponse> {
    return this.admissionService.batchDelete(data, userId);
  }

  // Document update (static segment before dynamic :id routes)
  @Put('documents/:documentId')
  @WriteRateLimit()
  async updateDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body(new ZodValidationPipe(admissionDocumentUpdateSchema))
    data: AdmissionDocumentUpdateFormData,
    @UserId() userId: string,
  ): Promise<AdmissionDocumentUpdateResponse> {
    return this.admissionService.updateDocument(documentId, data, userId);
  }

  // Documentação do colaborador — admission lookup by userId (static segment)
  @Get('by-user/:userId')
  @ReadRateLimit()
  async findByUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query(new ZodQueryValidationPipe(admissionQuerySchema)) query: AdmissionQueryFormData,
  ): Promise<AdmissionGetUniqueResponse> {
    return this.admissionService.findByUser(targetUserId, query.include);
  }

  // Documentação do colaborador — upload by userId, lazily creating the
  // admission process (DOCS_PENDING + default checklist) when absent
  @Post('by-user/:userId/documents')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('file', 1, multerConfig))
  async uploadDocumentByUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(admissionDocumentUploadSchema))
    data: AdmissionDocumentUploadFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<AdmissionDocumentUpdateResponse> {
    return this.admissionService.uploadDocumentByUser(targetUserId, data, files?.[0], userId);
  }

  // Document upload (multipart)
  @Post(':id/documents')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('file', 1, multerConfig))
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(admissionDocumentUploadSchema))
    data: AdmissionDocumentUploadFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<AdmissionDocumentUpdateResponse> {
    return this.admissionService.uploadDocument(id, data, files?.[0], userId);
  }

  // Status machine
  @Put(':id/advance')
  @WriteRateLimit()
  async advance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(admissionAdvanceSchema)) data: AdmissionAdvanceFormData,
    @Query(new ZodQueryValidationPipe(admissionQuerySchema)) query: AdmissionQueryFormData,
    @UserId() userId: string,
  ): Promise<AdmissionUpdateResponse> {
    return this.admissionService.advance(id, data, query.include, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(admissionQuerySchema)) query: AdmissionQueryFormData,
  ): Promise<AdmissionGetUniqueResponse> {
    return this.admissionService.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(admissionUpdateSchema)) data: AdmissionUpdateFormData,
    @Query(new ZodQueryValidationPipe(admissionQuerySchema)) query: AdmissionQueryFormData,
    @UserId() userId: string,
  ): Promise<AdmissionUpdateResponse> {
    return this.admissionService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<AdmissionDeleteResponse> {
    return this.admissionService.delete(id, userId);
  }
}
