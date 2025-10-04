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
import { ObservationService } from './observation.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import {
  observationGetManySchema,
  observationGetByIdSchema,
  observationCreateSchema,
  observationUpdateSchema,
  observationBatchCreateSchema,
  observationBatchUpdateSchema,
  observationBatchDeleteSchema,
  observationQuerySchema,
} from '../../../schemas/observation';
import type {
  ObservationQueryFormData,
  ObservationCreateFormData,
  ObservationUpdateFormData,
  ObservationBatchCreateFormData,
  ObservationBatchUpdateFormData,
  ObservationBatchDeleteFormData,
  ObservationGetManyFormData,
} from '../../../schemas/observation';
import type {
  ObservationCreateResponse,
  ObservationGetUniqueResponse,
  ObservationGetManyResponse,
  ObservationUpdateResponse,
  ObservationDeleteResponse,
  ObservationBatchCreateResponse,
  ObservationBatchUpdateResponse,
  ObservationBatchDeleteResponse,
  Observation,
} from '../../../types';

@Controller('observations')
export class ObservationController {
  constructor(private readonly observationsService: ObservationService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(observationGetManySchema)) query: ObservationGetManyFormData,
  ): Promise<ObservationGetManyResponse> {
    return this.observationsService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(observationCreateSchema))
    data: ObservationCreateFormData,
    @Query(new ZodQueryValidationPipe(observationQuerySchema)) query: ObservationQueryFormData,
    @UserId() userId: string,
  ): Promise<ObservationCreateResponse> {
    return this.observationsService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(observationBatchCreateSchema)) data: ObservationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(observationQuerySchema)) query: ObservationQueryFormData,
    @UserId() userId: string,
  ): Promise<ObservationBatchCreateResponse<ObservationCreateFormData>> {
    return this.observationsService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(observationBatchUpdateSchema)) data: ObservationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(observationQuerySchema)) query: ObservationQueryFormData,
    @UserId() userId: string,
  ): Promise<ObservationBatchUpdateResponse<ObservationUpdateFormData>> {
    return this.observationsService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(observationBatchDeleteSchema)) data: ObservationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ObservationBatchDeleteResponse> {
    return this.observationsService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(observationQuerySchema)) query: ObservationQueryFormData,
  ): Promise<ObservationGetUniqueResponse> {
    return this.observationsService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(observationUpdateSchema))
    data: ObservationUpdateFormData,
    @Query(new ZodQueryValidationPipe(observationQuerySchema)) query: ObservationQueryFormData,
    @UserId() userId: string,
  ): Promise<ObservationUpdateResponse> {
    return this.observationsService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ObservationDeleteResponse> {
    return this.observationsService.delete(id, userId);
  }
}
