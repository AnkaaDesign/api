// vacation-group.controller.ts
// Férias COLETIVAS (CLT art. 139-141) — Departamento Pessoal.

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
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { VacationGroupService } from './vacation-group.service';
import {
  vacationGroupAdvanceSchema,
  vacationGroupCreateSchema,
  vacationGroupGetManySchema,
  vacationGroupQuerySchema,
  vacationGroupUpdateSchema,
} from './dto/vacation-group.schema';
import type {
  VacationGroupAdvanceFormData,
  VacationGroupCreateFormData,
  VacationGroupGetManyFormData,
  VacationGroupQueryFormData,
  VacationGroupUpdateFormData,
} from './dto/vacation-group.schema';
import type {
  VacationGroupCreateResponse,
  VacationGroupDeleteResponse,
  VacationGroupExpandResponse,
  VacationGroupGetManyResponse,
  VacationGroupGetUniqueResponse,
  VacationGroupMembersResponse,
  VacationGroupUpdateResponse,
} from './types/vacation-group.types';

@Controller('vacation-groups')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class VacationGroupController {
  constructor(private readonly service: VacationGroupService) {}

  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(vacationGroupGetManySchema)) query: VacationGroupGetManyFormData,
  ): Promise<VacationGroupGetManyResponse> {
    return this.service.findMany(query);
  }

  @Post()
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(vacationGroupCreateSchema)) data: VacationGroupCreateFormData,
    @UserId() userId: string,
  ): Promise<VacationGroupCreateResponse> {
    return this.service.create(data, userId);
  }

  // Member preview / expansion (before dynamic :id routes that conflict)
  @Get(':id/members')
  @ReadRateLimit()
  async previewMembers(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VacationGroupMembersResponse> {
    return this.service.previewMembers(id);
  }

  @Post(':id/expand')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async expand(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<VacationGroupExpandResponse> {
    return this.service.expand(id, userId);
  }

  @Post(':id/sync')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async sync(@Param('id', ParseUUIDPipe) id: string): Promise<VacationGroupGetUniqueResponse> {
    return this.service.sync(id);
  }

  @Put(':id/advance')
  @WriteRateLimit()
  async advance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(vacationGroupAdvanceSchema)) data: VacationGroupAdvanceFormData,
    @UserId() userId: string,
  ): Promise<VacationGroupUpdateResponse> {
    return this.service.advance(id, data, userId);
  }

  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(vacationGroupQuerySchema)) query: VacationGroupQueryFormData,
  ): Promise<VacationGroupGetUniqueResponse> {
    return this.service.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(vacationGroupUpdateSchema)) data: VacationGroupUpdateFormData,
    @UserId() userId: string,
  ): Promise<VacationGroupUpdateResponse> {
    return this.service.update(id, data, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<VacationGroupDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
