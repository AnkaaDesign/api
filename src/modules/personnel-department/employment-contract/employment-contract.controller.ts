// employment-contract.controller.ts
// Vínculos empregatícios (EmploymentContract)

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
import { EmploymentContractService } from './employment-contract.service';
import type {
  EmploymentContractBatchCreateResponse,
  EmploymentContractBatchDeleteResponse,
  EmploymentContractBatchUpdateResponse,
  EmploymentContractCreateResponse,
  EmploymentContractDeleteResponse,
  EmploymentContractGetManyResponse,
  EmploymentContractGetUniqueResponse,
  EmploymentContractUpdateResponse,
} from '../../../types';
import type {
  EmploymentContractBatchCreateFormData,
  EmploymentContractBatchDeleteFormData,
  EmploymentContractBatchQueryFormData,
  EmploymentContractBatchUpdateFormData,
  EmploymentContractCreateFormData,
  EmploymentContractGetManyFormData,
  EmploymentContractQueryFormData,
  EmploymentContractUpdateFormData,
} from '../../../schemas';
import {
  employmentContractBatchCreateSchema,
  employmentContractBatchDeleteSchema,
  employmentContractBatchQuerySchema,
  employmentContractBatchUpdateSchema,
  employmentContractCreateSchema,
  employmentContractGetManySchema,
  employmentContractQuerySchema,
  employmentContractUpdateSchema,
} from '../../../schemas';

@Controller('employment-contracts')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
export class EmploymentContractController {
  constructor(private readonly employmentContractService: EmploymentContractService) {}

  // Basic CRUD Operations
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(employmentContractGetManySchema))
    query: EmploymentContractGetManyFormData,
  ): Promise<EmploymentContractGetManyResponse> {
    return this.employmentContractService.findMany(query);
  }

  @Post()
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(employmentContractCreateSchema))
    data: EmploymentContractCreateFormData,
    @Query(new ZodQueryValidationPipe(employmentContractQuerySchema))
    query: EmploymentContractQueryFormData,
    @UserId() userId: string,
  ): Promise<EmploymentContractCreateResponse> {
    return this.employmentContractService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(employmentContractBatchCreateSchema))
    data: EmploymentContractBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(employmentContractBatchQuerySchema))
    query: EmploymentContractBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<EmploymentContractBatchCreateResponse<EmploymentContractCreateFormData>> {
    return this.employmentContractService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(employmentContractBatchUpdateSchema))
    data: EmploymentContractBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(employmentContractBatchQuerySchema))
    query: EmploymentContractBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<EmploymentContractBatchUpdateResponse<EmploymentContractUpdateFormData>> {
    return this.employmentContractService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(employmentContractBatchDeleteSchema))
    data: EmploymentContractBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<EmploymentContractBatchDeleteResponse> {
    return this.employmentContractService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(employmentContractQuerySchema))
    query: EmploymentContractQueryFormData,
  ): Promise<EmploymentContractGetUniqueResponse> {
    return this.employmentContractService.findById(id, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(employmentContractUpdateSchema))
    data: EmploymentContractUpdateFormData,
    @Query(new ZodQueryValidationPipe(employmentContractQuerySchema))
    query: EmploymentContractQueryFormData,
    @UserId() userId: string,
  ): Promise<EmploymentContractUpdateResponse> {
    return this.employmentContractService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<EmploymentContractDeleteResponse> {
    return this.employmentContractService.delete(id, userId);
  }
}
