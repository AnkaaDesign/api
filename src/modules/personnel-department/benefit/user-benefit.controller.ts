// user-benefit.controller.ts
// Adesões de benefícios (Departamento Pessoal) — CRUD completo, máquina de status
// (suspend/reactivate/terminate) e upload de declaração (renúncia VT / autorização convênio).

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
import { UserBenefitService } from './user-benefit.service';
import {
  userBenefitGetManySchema,
  userBenefitCreateSchema,
  userBenefitUpdateSchema,
  userBenefitTerminateSchema,
  userBenefitBatchCreateSchema,
  userBenefitBatchUpdateSchema,
  userBenefitBatchDeleteSchema,
  userBenefitQuerySchema,
  userBenefitBatchQuerySchema,
} from '../../../schemas';
import type {
  UserBenefitGetManyFormData,
  UserBenefitCreateFormData,
  UserBenefitUpdateFormData,
  UserBenefitTerminateFormData,
  UserBenefitBatchCreateFormData,
  UserBenefitBatchUpdateFormData,
  UserBenefitBatchDeleteFormData,
  UserBenefitQueryFormData,
  UserBenefitBatchQueryFormData,
} from '../../../schemas';
import type {
  UserBenefitGetManyResponse,
  UserBenefitGetUniqueResponse,
  UserBenefitCreateResponse,
  UserBenefitUpdateResponse,
  UserBenefitDeleteResponse,
  UserBenefitBatchCreateResponse,
  UserBenefitBatchUpdateResponse,
  UserBenefitBatchDeleteResponse,
} from '../../../types';

@Controller('user-benefits')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class UserBenefitController {
  constructor(private readonly service: UserBenefitService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(userBenefitGetManySchema)) query: UserBenefitGetManyFormData,
  ): Promise<UserBenefitGetManyResponse> {
    return this.service.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(userBenefitCreateSchema)) data: UserBenefitCreateFormData,
    @Query(new ZodQueryValidationPipe(userBenefitQuerySchema)) query: UserBenefitQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(userBenefitBatchCreateSchema))
    data: UserBenefitBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(userBenefitBatchQuerySchema))
    query: UserBenefitBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitBatchCreateResponse<UserBenefitCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(userBenefitBatchUpdateSchema))
    data: UserBenefitBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(userBenefitBatchQuerySchema))
    query: UserBenefitBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitBatchUpdateResponse<UserBenefitUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(userBenefitBatchDeleteSchema))
    data: UserBenefitBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  // Status machine routes (static suffixes — declared before plain :id routes for clarity)
  @Put(':id/suspend')
  @WriteRateLimit()
  async suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(userBenefitQuerySchema)) query: UserBenefitQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitUpdateResponse> {
    return this.service.suspend(id, query.include, userId);
  }

  @Put(':id/reactivate')
  @WriteRateLimit()
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(userBenefitQuerySchema)) query: UserBenefitQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitUpdateResponse> {
    return this.service.reactivate(id, query.include, userId);
  }

  @Put(':id/terminate')
  @WriteRateLimit()
  async terminate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userBenefitTerminateSchema)) data: UserBenefitTerminateFormData,
    @Query(new ZodQueryValidationPipe(userBenefitQuerySchema)) query: UserBenefitQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitUpdateResponse> {
    return this.service.terminate(id, data.endDate, query.include, userId);
  }

  // Avança a parcela corrente de um convênio parcelado (uso administrativo;
  // a folha mensal — Part B — avança automaticamente via accessor do service).
  @Put(':id/advance-installment')
  @WriteRateLimit()
  async advanceInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<UserBenefitUpdateResponse> {
    const data = await this.service.advanceInstallment(id, userId);
    return { success: true, message: 'Parcela avançada com sucesso.', data };
  }

  // Declaração assinada (renúncia VT / autorização de desconto de convênio — CLT 462)
  @Post(':id/declaration')
  @WriteRateLimit()
  @UseInterceptors(FilesInterceptor('declaration', 1, multerConfig))
  async uploadDeclaration(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(userBenefitQuerySchema)) query: UserBenefitQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<UserBenefitUpdateResponse> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Nenhum arquivo enviado. Use o campo "declaration" para enviar a declaração.',
      );
    }
    return this.service.uploadDeclaration(id, files[0], query.include, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(userBenefitQuerySchema)) query: UserBenefitQueryFormData,
  ): Promise<UserBenefitGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userBenefitUpdateSchema)) data: UserBenefitUpdateFormData,
    @Query(new ZodQueryValidationPipe(userBenefitQuerySchema)) query: UserBenefitQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBenefitUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<UserBenefitDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
