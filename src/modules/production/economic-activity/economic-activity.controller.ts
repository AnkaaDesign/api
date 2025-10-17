import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { EconomicActivityService } from './economic-activity.service';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '../../common/pipes/array-fix.pipe';
import {
  economicActivityGetManySchema,
  economicActivityGetByIdSchema,
  economicActivityCreateSchema,
  economicActivityUpdateSchema,
  economicActivityBatchCreateSchema,
  economicActivityBatchUpdateSchema,
  economicActivityBatchDeleteSchema,
  economicActivityQuerySchema,
} from '../../../schemas/economic-activity';
import type {
  EconomicActivityGetManyFormData,
  EconomicActivityGetByIdFormData,
  EconomicActivityCreateFormData,
  EconomicActivityUpdateFormData,
  EconomicActivityBatchCreateFormData,
  EconomicActivityBatchUpdateFormData,
  EconomicActivityBatchDeleteFormData,
  EconomicActivityQueryFormData,
} from '../../../schemas/economic-activity';
import type {
  EconomicActivityCreateResponse,
  EconomicActivityGetUniqueResponse,
  EconomicActivityGetManyResponse,
  EconomicActivityUpdateResponse,
  EconomicActivityDeleteResponse,
  EconomicActivityBatchCreateResponse,
  EconomicActivityBatchUpdateResponse,
  EconomicActivityBatchDeleteResponse,
  EconomicActivity,
} from '../../../types';

@Controller('economic-activities')
export class EconomicActivityController {
  constructor(private readonly economicActivityService: EconomicActivityService) {}

  // Basic CRUD Operations
  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(economicActivityGetManySchema)) query: EconomicActivityGetManyFormData,
  ): Promise<EconomicActivityGetManyResponse> {
    return this.economicActivityService.findMany(query);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(economicActivityGetByIdSchema)) query: EconomicActivityGetByIdFormData,
  ): Promise<EconomicActivityGetUniqueResponse> {
    return this.economicActivityService.findOne(id, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(economicActivityCreateSchema))
    data: EconomicActivityCreateFormData,
    @Query(new ZodQueryValidationPipe(economicActivityQuerySchema)) query: EconomicActivityQueryFormData,
  ): Promise<EconomicActivityCreateResponse> {
    return this.economicActivityService.create(data, query?.include);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(economicActivityUpdateSchema))
    data: EconomicActivityUpdateFormData,
    @Query(new ZodQueryValidationPipe(economicActivityQuerySchema)) query: EconomicActivityQueryFormData,
  ): Promise<EconomicActivityUpdateResponse> {
    return this.economicActivityService.update(id, data, query?.include);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<EconomicActivityDeleteResponse> {
    return this.economicActivityService.delete(id);
  }

  // Batch Operations
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(economicActivityBatchCreateSchema))
    data: EconomicActivityBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(economicActivityQuerySchema)) query: EconomicActivityQueryFormData,
  ): Promise<EconomicActivityBatchCreateResponse<EconomicActivityCreateFormData>> {
    return this.economicActivityService.batchCreate(data, query?.include);
  }

  @Put('batch')
  async batchUpdate(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(economicActivityBatchUpdateSchema))
    data: EconomicActivityBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(economicActivityQuerySchema)) query: EconomicActivityQueryFormData,
  ): Promise<EconomicActivityBatchUpdateResponse<EconomicActivityUpdateFormData & { id: string }>> {
    return this.economicActivityService.batchUpdate(data, query?.include);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(economicActivityBatchDeleteSchema))
    data: EconomicActivityBatchDeleteFormData,
  ): Promise<EconomicActivityBatchDeleteResponse> {
    return this.economicActivityService.batchDelete(data);
  }
}
