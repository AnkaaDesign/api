// leave.controller.ts
// Afastamentos (Medicina do Trabalho) — CRUD completo, finalização (retorno)
// e upload de arquivos (m:n "FileToLeave").

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
import { LeaveService } from './leave.service';
import {
  leaveGetManySchema,
  leaveCreateSchema,
  leaveUpdateSchema,
  leaveFinishSchema,
  leaveBatchCreateSchema,
  leaveBatchUpdateSchema,
  leaveBatchDeleteSchema,
  leaveQuerySchema,
  leaveBatchQuerySchema,
} from '../../../schemas';
import type {
  LeaveGetManyFormData,
  LeaveCreateFormData,
  LeaveUpdateFormData,
  LeaveFinishFormData,
  LeaveBatchCreateFormData,
  LeaveBatchUpdateFormData,
  LeaveBatchDeleteFormData,
  LeaveQueryFormData,
  LeaveBatchQueryFormData,
} from '../../../schemas';
import type {
  LeaveGetManyResponse,
  LeaveGetUniqueResponse,
  LeaveCreateResponse,
  LeaveUpdateResponse,
  LeaveDeleteResponse,
  LeaveBatchCreateResponse,
  LeaveBatchUpdateResponse,
  LeaveBatchDeleteResponse,
} from '../../../types';

@Controller('leaves')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(leaveGetManySchema)) query: LeaveGetManyFormData,
  ): Promise<LeaveGetManyResponse> {
    return this.service.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(leaveCreateSchema)) data: LeaveCreateFormData,
    @Query(new ZodQueryValidationPipe(leaveQuerySchema)) query: LeaveQueryFormData,
    @UserId() userId: string,
  ): Promise<LeaveCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(leaveBatchCreateSchema)) data: LeaveBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(leaveBatchQuerySchema)) query: LeaveBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<LeaveBatchCreateResponse<LeaveCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(leaveBatchUpdateSchema)) data: LeaveBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(leaveBatchQuerySchema)) query: LeaveBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<LeaveBatchUpdateResponse<LeaveUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(leaveBatchDeleteSchema)) data: LeaveBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<LeaveBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  // Finalização do afastamento (→ COMPLETED, data de retorno efetiva)
  @Put(':id/finish')
  @WriteRateLimit()
  async finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(leaveFinishSchema)) data: LeaveFinishFormData,
    @Query(new ZodQueryValidationPipe(leaveQuerySchema)) query: LeaveQueryFormData,
    @UserId() userId: string,
  ): Promise<LeaveUpdateResponse> {
    return this.service.finish(id, data.actualEndDate, query.include, userId);
  }

  // Upload de arquivos (atestados etc.) — relação m:n "FileToLeave"
  @Post(':id/files')
  @WriteRateLimit()
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  async uploadFiles(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(leaveQuerySchema)) query: LeaveQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<LeaveUpdateResponse> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Nenhum arquivo enviado. Use o campo "files" para enviar os arquivos.',
      );
    }
    return this.service.uploadFiles(id, files, query.include, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(leaveQuerySchema)) query: LeaveQueryFormData,
  ): Promise<LeaveGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(leaveUpdateSchema)) data: LeaveUpdateFormData,
    @Query(new ZodQueryValidationPipe(leaveQuerySchema)) query: LeaveQueryFormData,
    @UserId() userId: string,
  ): Promise<LeaveUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<LeaveDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
