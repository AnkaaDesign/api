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
import { AirbrushingService } from './airbrushing.service';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  airbrushingGetManySchema,
  airbrushingGetByIdSchema,
  airbrushingCreateSchema,
  airbrushingUpdateSchema,
  airbrushingBatchCreateSchema,
  airbrushingBatchUpdateSchema,
  airbrushingBatchDeleteSchema,
  airbrushingQuerySchema,
} from '../../../schemas/airbrushing';
import type {
  AirbrushingGetManyFormData,
  AirbrushingQueryFormData,
  AirbrushingGetByIdFormData,
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingBatchCreateFormData,
  AirbrushingBatchUpdateFormData,
  AirbrushingBatchDeleteFormData,
} from '../../../schemas/airbrushing';
import type {
  AirbrushingGetUniqueResponse,
  AirbrushingGetManyResponse,
  AirbrushingCreateResponse,
  AirbrushingUpdateResponse,
  AirbrushingDeleteResponse,
  AirbrushingBatchCreateResponse,
  AirbrushingBatchUpdateResponse,
  AirbrushingBatchDeleteResponse,
  Airbrushing,
} from '../../../types';
import { UserId } from '@modules/common/auth/decorators/user.decorator';

@Controller('airbrushings')
export class AirbrushingController {
  constructor(
    private readonly airbrushingService: AirbrushingService,
  ) {}

  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(airbrushingGetManySchema)) query: AirbrushingGetManyFormData,
  ): Promise<AirbrushingGetManyResponse> {
    return this.airbrushingService.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(airbrushingCreateSchema)) data: AirbrushingCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingCreateResponse> {
    return this.airbrushingService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(airbrushingBatchCreateSchema)) data: AirbrushingBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchCreateResponse<AirbrushingCreateFormData>> {
    return this.airbrushingService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  async batchUpdate(
    @Body(new ZodValidationPipe(airbrushingBatchUpdateSchema)) data: AirbrushingBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchUpdateResponse<AirbrushingUpdateFormData>> {
    return this.airbrushingService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(airbrushingBatchDeleteSchema)) data: AirbrushingBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchDeleteResponse> {
    return this.airbrushingService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
  ): Promise<AirbrushingGetUniqueResponse> {
    return this.airbrushingService.findById(id, query.include);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(airbrushingUpdateSchema)) data: AirbrushingUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingUpdateResponse> {
    return this.airbrushingService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<AirbrushingDeleteResponse> {
    return this.airbrushingService.delete(id, userId);
  }
}
