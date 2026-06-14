// user-position-history.controller.ts
// Histórico de cargos (Departamento Pessoal) — read-only list/detail + promote.

import {
  BadRequestException,
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

  // Historical salary resolution (Part F). Thin endpoint usável por estatísticas:
  //   GET /user-position-history/salary-at?userIds=a,b&date=2025-06-01
  //   GET /user-position-history/salary-at?userId=a&date=2025-06-01
  // Resolve cargo-na-data × MonetaryValue-na-data. Sem salário em User.
  @Get('salary-at')
  @ReadRateLimit()
  async salaryAt(
    @Query('date') date?: string,
    @Query('userId') userId?: string,
    @Query('userIds') userIds?: string,
  ) {
    const when = date ? new Date(date) : new Date();
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('Data inválida.');
    }

    const ids = [
      ...(userId ? [userId] : []),
      ...(userIds ? userIds.split(',').map(s => s.trim()).filter(Boolean) : []),
    ];
    if (ids.length === 0) {
      throw new BadRequestException('Informe userId ou userIds.');
    }

    const map = await this.userPositionHistoryService.getUsersSalaryAt(ids, when);
    const data = ids.map(id => map.get(id)).filter((r): r is NonNullable<typeof r> => !!r);

    return {
      success: true,
      message: 'Salário histórico resolvido com sucesso.',
      data: ids.length === 1 ? data[0] ?? null : data,
    };
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
