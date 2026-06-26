// salary-adjustment.controller.ts
// Reajustes salariais (Departamento Pessoal)

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
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants';
import { SalaryAdjustmentService } from './salary-adjustment.service';
import type {
  SalaryAdjustmentApplyResponse,
  SalaryAdjustmentDeleteResponse,
  SalaryAdjustmentGetManyResponse,
  SalaryAdjustmentGetUniqueResponse,
  SalaryAdjustmentUpdateResponse,
} from '../../../types';
import type {
  SalaryAdjustmentApplyFormData,
  SalaryAdjustmentGetManyFormData,
  SalaryAdjustmentQueryFormData,
  SalaryAdjustmentUpdateFormData,
} from '../../../schemas';
import {
  salaryAdjustmentApplySchema,
  salaryAdjustmentGetManySchema,
  salaryAdjustmentQuerySchema,
  salaryAdjustmentUpdateSchema,
} from '../../../schemas';

@Controller('salary-adjustments')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class SalaryAdjustmentController {
  constructor(private readonly salaryAdjustmentService: SalaryAdjustmentService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(salaryAdjustmentGetManySchema))
    query: SalaryAdjustmentGetManyFormData,
  ): Promise<SalaryAdjustmentGetManyResponse> {
    return this.salaryAdjustmentService.findMany(query);
  }

  // Core apply route (static — must come before dynamic :id routes)
  @Post('apply')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async apply(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(salaryAdjustmentApplySchema))
    data: SalaryAdjustmentApplyFormData,
    @UserId() userId: string,
  ): Promise<SalaryAdjustmentApplyResponse> {
    return this.salaryAdjustmentService.apply(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(salaryAdjustmentQuerySchema))
    query: SalaryAdjustmentQueryFormData,
  ): Promise<SalaryAdjustmentGetUniqueResponse> {
    return this.salaryAdjustmentService.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(salaryAdjustmentUpdateSchema))
    data: SalaryAdjustmentUpdateFormData,
    @Query(new ZodQueryValidationPipe(salaryAdjustmentQuerySchema))
    query: SalaryAdjustmentQueryFormData,
    @UserId() userId: string,
  ): Promise<SalaryAdjustmentUpdateResponse> {
    return this.salaryAdjustmentService.update(id, data, query.include, userId);
  }

  // Destructive — ADMIN only (removes the history record; does NOT revert salaries)
  @Delete(':id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<SalaryAdjustmentDeleteResponse> {
    return this.salaryAdjustmentService.delete(id, userId);
  }
}
