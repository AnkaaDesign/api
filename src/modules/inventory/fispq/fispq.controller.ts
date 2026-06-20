// fispq.controller.ts
// FISPQ / FDS — Ficha de Informações de Segurança de Produtos Químicos (Medicina
// do Trabalho — inventário de produtos químicos). CRUD + upload de PDF + exportação
// de inventário + ficha de referência rápida por item.

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
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
import { FispqService } from './fispq.service';
import { FispqDocumentService } from './fispq-document.service';
import {
  fispqGetManySchema,
  fispqCreateSchema,
  fispqUpdateSchema,
  fispqBatchCreateSchema,
  fispqBatchUpdateSchema,
  fispqBatchDeleteSchema,
  fispqQuerySchema,
  fispqBatchQuerySchema,
  fispqExportSchema,
} from '../../../schemas';
import type {
  FispqGetManyFormData,
  FispqCreateFormData,
  FispqUpdateFormData,
  FispqBatchCreateFormData,
  FispqBatchUpdateFormData,
  FispqBatchDeleteFormData,
  FispqQueryFormData,
  FispqBatchQueryFormData,
  FispqExportFormData,
} from '../../../schemas';
import type {
  FispqGetManyResponse,
  FispqGetUniqueResponse,
  FispqCreateResponse,
  FispqUpdateResponse,
  FispqDeleteResponse,
  FispqBatchCreateResponse,
  FispqBatchUpdateResponse,
  FispqBatchDeleteResponse,
} from '../../../types';

@Controller('fispq')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class FispqController {
  constructor(
    private readonly service: FispqService,
    private readonly documentService: FispqDocumentService,
  ) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(fispqGetManySchema)) query: FispqGetManyFormData,
  ): Promise<FispqGetManyResponse> {
    return this.service.findMany(query);
  }

  // Inventário de produtos químicos (PDF pdfkit / XLSX). Static route — DEVE vir
  // antes de @Get(':id'). Honra os mesmos filtros da listagem.
  @Get('export')
  @ReadRateLimit()
  async export(
    @Query(new ZodQueryValidationPipe(fispqExportSchema)) query: FispqExportFormData,
    @Res() res: Response,
  ): Promise<void> {
    const where = (query as any).where || {};
    const format = query.format;
    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'xlsx') {
      const buffer = await this.documentService.generateInventoryXlsx(where);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="inventario-fispq-${timestamp}.xlsx"`,
        'Content-Length': buffer.length.toString(),
      });
      res.end(buffer);
      return;
    }

    const buffer = await this.documentService.generateInventoryPdf(where);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="inventario-fispq-${timestamp}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(fispqCreateSchema)) data: FispqCreateFormData,
    @Query(new ZodQueryValidationPipe(fispqQuerySchema)) query: FispqQueryFormData,
    @UserId() userId: string,
  ): Promise<FispqCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(fispqBatchCreateSchema)) data: FispqBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(fispqBatchQuerySchema)) query: FispqBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<FispqBatchCreateResponse<FispqCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(fispqBatchUpdateSchema)) data: FispqBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(fispqBatchQuerySchema)) query: FispqBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<FispqBatchUpdateResponse<FispqUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(fispqBatchDeleteSchema)) data: FispqBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<FispqBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  // Upload do PDF oficial da FDS (define pdfFileId)
  @Post(':id/document')
  @WriteRateLimit()
  @UseInterceptors(FilesInterceptor('document', 1, multerConfig))
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(fispqQuerySchema)) query: FispqQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<FispqUpdateResponse> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Nenhum arquivo enviado. Use o campo "document" para enviar o PDF da FDS.',
      );
    }
    return this.service.uploadDocument(id, files[0], query.include, userId);
  }

  // Ficha de referência rápida da FDS (PDF por item). Static-ish — vem antes do
  // @Get(':id') por ter sufixo /report.
  @Get(':id/report')
  @ReadRateLimit()
  async report(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const buffer = await this.documentService.generateItemReportPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="fds-${id}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(fispqQuerySchema)) query: FispqQueryFormData,
  ): Promise<FispqGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fispqUpdateSchema)) data: FispqUpdateFormData,
    @Query(new ZodQueryValidationPipe(fispqQuerySchema)) query: FispqQueryFormData,
    @UserId() userId: string,
  ): Promise<FispqUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<FispqDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
