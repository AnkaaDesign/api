// vacation.controller.ts
// Férias (Departamento Pessoal) — Part C.

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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { AdminOnly } from '@modules/common/auth/decorators/admin-only.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { VacationService } from './vacation.service';
import {
  vacationAdvanceSchema,
  vacationBatchCreateSchema,
  vacationBatchDeleteSchema,
  vacationBatchQuerySchema,
  vacationBatchUpdateSchema,
  vacationCreateSchema,
  vacationGetManySchema,
  vacationPeriodBalanceSchema,
  vacationQuerySchema,
  vacationUpdateSchema,
} from './dto/vacation.schema';
import type {
  VacationAdvanceFormData,
  VacationBatchCreateFormData,
  VacationBatchDeleteFormData,
  VacationBatchQueryFormData,
  VacationBatchUpdateFormData,
  VacationCreateFormData,
  VacationGetManyFormData,
  VacationPeriodBalanceFormData,
  VacationQueryFormData,
  VacationUpdateFormData,
} from './dto/vacation.schema';
import type {
  VacationBatchCreateResponse,
  VacationBatchDeleteResponse,
  VacationBatchUpdateResponse,
  VacationCalculateResponse,
  VacationCreateResponse,
  VacationDeleteResponse,
  VacationGetManyResponse,
  VacationGetUniqueResponse,
  VacationPeriodBalanceResponse,
  VacationUpdateResponse,
} from './types/vacation.types';

@Controller('vacations')
@UseGuards(AuthGuard)
// Manage (create/update/calculate/advance/sync/batch) is HR/Accounting/Admin.
// PRODUCTION_MANAGER gets read-only access, re-granted per-GET below (the guard
// unions class + method @Roles via getAllAndMerge, so adding PM on a GET widens
// only that handler; the write handlers stay restricted to this class-level set).
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class VacationController {
  constructor(private readonly vacationService: VacationService) {}

  // List / filter
  @Get()
  @Roles(SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(vacationGetManySchema)) query: VacationGetManyFormData,
  ): Promise<VacationGetManyResponse> {
    return this.vacationService.findMany(query);
  }

  @Post()
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(vacationCreateSchema)) data: VacationCreateFormData,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationCreateResponse> {
    return this.vacationService.create(data, query.include, userId);
  }

  // Batch (before dynamic routes)
  @Post('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(vacationBatchCreateSchema)) data: VacationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(vacationBatchQuerySchema)) query: VacationBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationBatchCreateResponse<VacationCreateFormData>> {
    return this.vacationService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(vacationBatchUpdateSchema)) data: VacationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(vacationBatchQuerySchema)) query: VacationBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationBatchUpdateResponse<VacationUpdateFormData>> {
    return this.vacationService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  // Deletion is ADMIN-only. The class-level @Roles is merged (union) by the
  // guard, so @AdminOnly() is required to restrict below it — @Roles(ADMIN)
  // alone would NOT narrow access.
  @AdminOnly()
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(vacationBatchDeleteSchema)) data: VacationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<VacationBatchDeleteResponse> {
    return this.vacationService.batchDelete(data, userId);
  }

  // Saldo de gozo do período aquisitivo (tomadas-irmãs agrupadas). Keyed by the
  // vacation id so the acquisitive dates come straight from the DB row — avoids
  // any client date-serialization/timezone drift in the grouping match.
  @Get(':id/period-balance')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @ReadRateLimit()
  async periodBalance(@Param('id', ParseUUIDPipe) id: string): Promise<VacationPeriodBalanceResponse> {
    return this.vacationService.getPeriodBalance(id);
  }

  // Recibo (verbas + INSS/IRRF)
  @Post(':id/calculate')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async calculate(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<VacationCalculateResponse> {
    return this.vacationService.calculate(id, userId);
  }

  // Status machine
  @Put(':id/advance')
  @WriteRateLimit()
  async advance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(vacationAdvanceSchema)) data: VacationAdvanceFormData,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationUpdateResponse> {
    return this.vacationService.advance(id, data, query.include, userId);
  }

  // Secullum (ponto) integration — manual (re)sync + read-derived status
  @Post(':id/sync')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async syncSecullum(@Param('id', ParseUUIDPipe) id: string) {
    return this.vacationService.syncSecullum(id);
  }

  @Get(':id/secullum-status')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @ReadRateLimit()
  async secullumStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.vacationService.getSecullumStatus(id);
  }

  // Dynamic routes (after static)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
  ): Promise<VacationGetUniqueResponse> {
    return this.vacationService.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(vacationUpdateSchema)) data: VacationUpdateFormData,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationUpdateResponse> {
    return this.vacationService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  // Deletion is ADMIN-only (see batchDelete note re: the role-union guard).
  @AdminOnly()
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<VacationDeleteResponse> {
    return this.vacationService.delete(id, userId);
  }
}
