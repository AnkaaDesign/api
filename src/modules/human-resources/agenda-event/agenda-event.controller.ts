// agenda-event.controller.ts
// Agenda com avisos — CRUD completo. Acesso espelha o calendário de RH
// (Contabilidade, Recursos Humanos e Admin).

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
import { AgendaEventService } from './agenda-event.service';
import {
  agendaEventGetManySchema,
  agendaEventCreateSchema,
  agendaEventUpdateSchema,
  agendaEventBatchCreateSchema,
  agendaEventBatchUpdateSchema,
  agendaEventBatchDeleteSchema,
  agendaEventQuerySchema,
  agendaEventBatchQuerySchema,
} from '../../../schemas';
import type {
  AgendaEventGetManyFormData,
  AgendaEventCreateFormData,
  AgendaEventUpdateFormData,
  AgendaEventBatchCreateFormData,
  AgendaEventBatchUpdateFormData,
  AgendaEventBatchDeleteFormData,
  AgendaEventQueryFormData,
  AgendaEventBatchQueryFormData,
} from '../../../schemas';
import type {
  AgendaEventGetManyResponse,
  AgendaEventGetUniqueResponse,
  AgendaEventCreateResponse,
  AgendaEventUpdateResponse,
  AgendaEventDeleteResponse,
  AgendaEventBatchCreateResponse,
  AgendaEventBatchUpdateResponse,
  AgendaEventBatchDeleteResponse,
} from '../../../types';

@Controller('agenda-events')
@UseGuards(AuthGuard)
// Agenda events are the shared Calendário (Ferramentas) data — HR/ACCOUNTING/ADMIN and
// PRODUCTION_MANAGER can all view and manage them (create/edit/delete).
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
export class AgendaEventController {
  constructor(private readonly service: AgendaEventService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(agendaEventGetManySchema))
    query: AgendaEventGetManyFormData,
  ): Promise<AgendaEventGetManyResponse> {
    return this.service.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(agendaEventCreateSchema)) data: AgendaEventCreateFormData,
    @Query(new ZodQueryValidationPipe(agendaEventQuerySchema)) query: AgendaEventQueryFormData,
    @UserId() userId: string,
  ): Promise<AgendaEventCreateResponse> {
    return this.service.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(agendaEventBatchCreateSchema))
    data: AgendaEventBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(agendaEventBatchQuerySchema))
    query: AgendaEventBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<AgendaEventBatchCreateResponse<AgendaEventCreateFormData>> {
    return this.service.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(agendaEventBatchUpdateSchema))
    data: AgendaEventBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(agendaEventBatchQuerySchema))
    query: AgendaEventBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<AgendaEventBatchUpdateResponse<AgendaEventUpdateFormData>> {
    return this.service.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(agendaEventBatchDeleteSchema))
    data: AgendaEventBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<AgendaEventBatchDeleteResponse> {
    return this.service.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(agendaEventQuerySchema)) query: AgendaEventQueryFormData,
  ): Promise<AgendaEventGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(agendaEventUpdateSchema)) data: AgendaEventUpdateFormData,
    @Query(new ZodQueryValidationPipe(agendaEventQuerySchema)) query: AgendaEventQueryFormData,
    @UserId() userId: string,
  ): Promise<AgendaEventUpdateResponse> {
    return this.service.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<AgendaEventDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
