// sector.controller.ts

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
} from '@nestjs/common';
import { SectorService } from './sector.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  SectorBatchCreateResponse,
  SectorBatchDeleteResponse,
  SectorBatchUpdateResponse,
  SectorCreateResponse,
  SectorDeleteResponse,
  SectorGetManyResponse,
  SectorGetUniqueResponse,
  SectorUpdateResponse,
  Sector,
} from '../../../types';
import {
  SectorCreateFormData,
  SectorUpdateFormData,
  SectorGetManyFormData,
  SectorBatchCreateFormData,
  SectorBatchUpdateFormData,
  SectorBatchDeleteFormData,
  SectorGetByIdFormData,
  SectorQueryFormData,
  sectorCreateSchema,
  sectorBatchCreateSchema,
  sectorBatchDeleteSchema,
  sectorBatchUpdateSchema,
  sectorGetManySchema,
  sectorUpdateSchema,
  sectorGetByIdSchema,
  sectorQuerySchema,
} from '../../../schemas/sector';

@Controller('sectors')
export class SectorController {
  constructor(private readonly sectorService: SectorService) {}

  // Basic CRUD Operations
  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(sectorGetManySchema)) query: SectorGetManyFormData,
  ): Promise<SectorGetManyResponse> {
    return this.sectorService.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(sectorCreateSchema)) data: SectorCreateFormData,
    @Query(new ZodQueryValidationPipe(sectorQuerySchema)) query: SectorQueryFormData,
    @UserId() userId: string,
  ): Promise<SectorCreateResponse> {
    return this.sectorService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(sectorBatchCreateSchema)) data: SectorBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(sectorQuerySchema)) query: SectorQueryFormData,
    @UserId() userId: string,
  ): Promise<SectorBatchCreateResponse<SectorCreateFormData>> {
    return this.sectorService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  async batchUpdate(
    @Body(new ZodValidationPipe(sectorBatchUpdateSchema)) data: SectorBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(sectorQuerySchema)) query: SectorQueryFormData,
    @UserId() userId: string,
  ): Promise<SectorBatchUpdateResponse<SectorUpdateFormData>> {
    return this.sectorService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(sectorBatchDeleteSchema)) data: SectorBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<SectorBatchDeleteResponse> {
    return this.sectorService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after all static routes)
  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(sectorQuerySchema)) query: SectorQueryFormData,
  ): Promise<SectorGetUniqueResponse> {
    return this.sectorService.findById(id, query.include);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(sectorUpdateSchema)) data: SectorUpdateFormData,
    @Query(new ZodQueryValidationPipe(sectorQuerySchema)) query: SectorQueryFormData,
    @UserId() userId: string,
  ): Promise<SectorUpdateResponse> {
    return this.sectorService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<SectorDeleteResponse> {
    return this.sectorService.delete(id, userId);
  }
}
