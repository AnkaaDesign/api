// user-position-history.controller.ts
// Histórico de cargos (Departamento Pessoal) — read-only list/detail + promote.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants';
import { UserPositionHistoryService } from './user-position-history.service';
import type {
  UserPositionHistoryGetManyResponse,
  UserPositionHistoryGetUniqueResponse,
  UserPositionHistoryPromoteResponse,
} from '../../../types';
import type {
  UserPositionHistoryGetManyFormData,
  UserPositionHistoryPromoteFormData,
  UserPositionHistoryQueryFormData,
} from '../../../schemas';
import {
  userPositionHistoryGetManySchema,
  userPositionHistoryPromoteSchema,
  userPositionHistoryQuerySchema,
} from '../../../schemas';

@Controller('user-position-history')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class UserPositionHistoryController {
  constructor(private readonly userPositionHistoryService: UserPositionHistoryService) {}

  // Read-only list
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(userPositionHistoryGetManySchema))
    query: UserPositionHistoryGetManyFormData,
  ): Promise<UserPositionHistoryGetManyResponse> {
    return this.userPositionHistoryService.findMany(query);
  }

  // Promote/transfer/demote (static — must come before dynamic :id routes)
  @Post('promote')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async promote(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(userPositionHistoryPromoteSchema))
    data: UserPositionHistoryPromoteFormData,
    @Query(new ZodQueryValidationPipe(userPositionHistoryQuerySchema))
    query: UserPositionHistoryQueryFormData,
    @UserId() userId: string,
  ): Promise<UserPositionHistoryPromoteResponse> {
    return this.userPositionHistoryService.promote(data, query.include, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(userPositionHistoryQuerySchema))
    query: UserPositionHistoryQueryFormData,
  ): Promise<UserPositionHistoryGetUniqueResponse> {
    return this.userPositionHistoryService.findById(id, query.include);
  }
}
