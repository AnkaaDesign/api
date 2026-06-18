// termination.controller.ts
// Rescisões (Departamento Pessoal) — contract §2.

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
import { TerminationService } from './termination.service';
import type {
  TerminationBatchCreateResponse,
  TerminationBatchDeleteResponse,
  TerminationBatchUpdateResponse,
  TerminationCalculateResponse,
  TerminationComputeTaxesResponse,
  TerminationCreateResponse,
  TerminationDeleteResponse,
  TerminationDocumentUpdateResponse,
  TerminationGetManyResponse,
  TerminationGetUniqueResponse,
  TerminationItemCreateResponse,
  TerminationItemDeleteResponse,
  TerminationItemUpdateResponse,
  TerminationUpdateResponse,
} from '../../../types';
import type {
  TerminationAdvanceFormData,
  TerminationBatchCreateFormData,
  TerminationBatchDeleteFormData,
  TerminationBatchQueryFormData,
  TerminationBatchUpdateFormData,
  TerminationCreateFormData,
  TerminationDocumentUpdateFormData,
  TerminationDocumentUploadFormData,
  TerminationGetManyFormData,
  TerminationItemCreateFormData,
  TerminationItemUpdateFormData,
  TerminationQueryFormData,
  TerminationUpdateFormData,
} from '../../../schemas';
import {
  terminationAdvanceSchema,
  terminationBatchCreateSchema,
  terminationBatchDeleteSchema,
  terminationBatchQuerySchema,
  terminationBatchUpdateSchema,
  terminationCreateSchema,
  terminationDocumentUpdateSchema,
  terminationDocumentUploadSchema,
  terminationGetManySchema,
  terminationItemCreateSchema,
  terminationItemUpdateSchema,
  terminationQuerySchema,
  terminationUpdateSchema,
} from '../../../schemas';

@Controller('terminations')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
export class TerminationController {
  constructor(private readonly terminationService: TerminationService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(terminationGetManySchema)) query: TerminationGetManyFormData,
  ): Promise<TerminationGetManyResponse> {
    return this.terminationService.findMany(query);
  }

  @Post()
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(terminationCreateSchema)) data: TerminationCreateFormData,
    @Query(new ZodQueryValidationPipe(terminationQuerySchema)) query: TerminationQueryFormData,
    @UserId() userId: string,
  ): Promise<TerminationCreateResponse> {
    return this.terminationService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(terminationBatchCreateSchema)) data: TerminationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(terminationBatchQuerySchema))
    query: TerminationBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<TerminationBatchCreateResponse<TerminationCreateFormData>> {
    return this.terminationService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(terminationBatchUpdateSchema)) data: TerminationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(terminationBatchQuerySchema))
    query: TerminationBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<TerminationBatchUpdateResponse<TerminationUpdateFormData>> {
    return this.terminationService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(terminationBatchDeleteSchema)) data: TerminationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<TerminationBatchDeleteResponse> {
    return this.terminationService.batchDelete(data, userId);
  }

  // Document update (static segment before dynamic :id routes)
  @Put('documents/:documentId')
  @WriteRateLimit()
  async updateDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body(new ZodValidationPipe(terminationDocumentUpdateSchema))
    data: TerminationDocumentUpdateFormData,
    @UserId() userId: string,
  ): Promise<TerminationDocumentUpdateResponse> {
    return this.terminationService.updateDocument(documentId, data, userId);
  }

  // Custom item update/delete (static segment before dynamic :id routes)
  @Put('items/:itemId')
  @WriteRateLimit()
  async updateItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(terminationItemUpdateSchema)) data: TerminationItemUpdateFormData,
    @UserId() userId: string,
  ): Promise<TerminationItemUpdateResponse> {
    return this.terminationService.updateItem(itemId, data, userId);
  }

  @Delete('items/:itemId')
  @WriteRateLimit()
  async deleteItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UserId() userId: string,
  ): Promise<TerminationItemDeleteResponse> {
    return this.terminationService.deleteItem(itemId, userId);
  }

  // Document upload (multipart)
  @Post(':id/documents')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('file', 1, multerConfig))
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(terminationDocumentUploadSchema))
    data: TerminationDocumentUploadFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<TerminationDocumentUpdateResponse> {
    return this.terminationService.uploadDocument(id, data, files?.[0], userId);
  }

  // Custom item creation (INSS/IRRF and other user-entered earnings/discounts)
  @Post(':id/items')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(terminationItemCreateSchema)) data: TerminationItemCreateFormData,
    @UserId() userId: string,
  ): Promise<TerminationItemCreateResponse> {
    return this.terminationService.addItem(id, data, userId);
  }

  // Verbas engine
  @Post(':id/calculate')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async calculate(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<TerminationCalculateResponse> {
    return this.terminationService.calculate(id, userId);
  }

  // Tax/FGTS assist — auto-compute INSS/IRRF on taxable verbas + FGTS-multa base
  @Post(':id/compute-taxes')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async computeTaxes(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<TerminationComputeTaxesResponse> {
    return this.terminationService.computeTaxes(id, userId);
  }

  // Status machine
  @Put(':id/advance')
  @WriteRateLimit()
  async advance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(terminationAdvanceSchema)) data: TerminationAdvanceFormData,
    @Query(new ZodQueryValidationPipe(terminationQuerySchema)) query: TerminationQueryFormData,
    @UserId() userId: string,
  ): Promise<TerminationUpdateResponse> {
    return this.terminationService.advance(id, data, query.include, userId);
  }

  @Put(':id/regress')
  @WriteRateLimit()
  async regress(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(terminationQuerySchema)) query: TerminationQueryFormData,
    @UserId() userId: string,
  ): Promise<TerminationUpdateResponse> {
    return this.terminationService.regress(id, userId, query.include);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(terminationQuerySchema)) query: TerminationQueryFormData,
  ): Promise<TerminationGetUniqueResponse> {
    return this.terminationService.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(terminationUpdateSchema)) data: TerminationUpdateFormData,
    @Query(new ZodQueryValidationPipe(terminationQuerySchema)) query: TerminationQueryFormData,
    @UserId() userId: string,
  ): Promise<TerminationUpdateResponse> {
    return this.terminationService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<TerminationDeleteResponse> {
    return this.terminationService.delete(id, userId);
  }
}
