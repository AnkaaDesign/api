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
import { MaintenanceService } from './maintenance.service';
import { MaintenanceItemService } from './maintenance-item.service';
import { MaintenanceScheduleService } from './maintenance-schedule.service';
import { UserId } from '../../common/auth/decorators/user.decorator';
import { Roles } from '../../common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '../../common/pipes/array-fix.pipe';
import {
  maintenanceGetManySchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  maintenanceBatchCreateSchema,
  maintenanceBatchUpdateSchema,
  maintenanceBatchDeleteSchema,
  maintenanceIncludeSchema,
  maintenanceItemGetManySchema,
  maintenanceItemCreateSchema,
  maintenanceItemUpdateSchema,
  maintenanceItemBatchCreateSchema,
  maintenanceItemBatchUpdateSchema,
  maintenanceItemBatchDeleteSchema,
  maintenanceItemIncludeSchema,
  maintenanceQuerySchema,
  maintenanceItemQuerySchema,
  maintenanceScheduleGetManySchema,
  maintenanceScheduleCreateSchema,
  maintenanceScheduleUpdateSchema,
  maintenanceScheduleBatchCreateSchema,
  maintenanceScheduleBatchUpdateSchema,
  maintenanceScheduleBatchDeleteSchema,
  maintenanceScheduleIncludeSchema,
  maintenanceScheduleQuerySchema,
} from '../../../schemas/maintenance';
import type {
  MaintenanceGetManyFormData,
  MaintenanceCreateFormData,
  MaintenanceUpdateFormData,
  MaintenanceBatchCreateFormData,
  MaintenanceBatchUpdateFormData,
  MaintenanceBatchDeleteFormData,
  MaintenanceItemGetManyFormData,
  MaintenanceItemCreateFormData,
  MaintenanceItemUpdateFormData,
  MaintenanceItemBatchCreateFormData,
  MaintenanceItemBatchUpdateFormData,
  MaintenanceItemBatchDeleteFormData,
  MaintenanceQueryFormData,
  MaintenanceItemQueryFormData,
  MaintenanceScheduleGetManyFormData,
  MaintenanceScheduleCreateFormData,
  MaintenanceScheduleUpdateFormData,
  MaintenanceScheduleBatchCreateFormData,
  MaintenanceScheduleBatchUpdateFormData,
  MaintenanceScheduleBatchDeleteFormData,
  MaintenanceScheduleQueryFormData,
} from '../../../schemas/maintenance';
import {
  MaintenanceGetUniqueResponse,
  MaintenanceGetManyResponse,
  MaintenanceCreateResponse,
  MaintenanceUpdateResponse,
  MaintenanceDeleteResponse,
  MaintenanceBatchCreateResponse,
  MaintenanceBatchUpdateResponse,
  MaintenanceBatchDeleteResponse,
  MaintenanceItemGetUniqueResponse,
  MaintenanceItemGetManyResponse,
  MaintenanceItemCreateResponse,
  MaintenanceItemUpdateResponse,
  MaintenanceItemDeleteResponse,
  MaintenanceItemBatchCreateResponse,
  MaintenanceItemBatchUpdateResponse,
  MaintenanceItemBatchDeleteResponse,
  MaintenanceScheduleGetUniqueResponse,
  MaintenanceScheduleGetManyResponse,
  MaintenanceScheduleCreateResponse,
  MaintenanceScheduleUpdateResponse,
  MaintenanceScheduleDeleteResponse,
  MaintenanceScheduleBatchCreateResponse,
  MaintenanceScheduleBatchUpdateResponse,
  MaintenanceScheduleBatchDeleteResponse,
} from '../../../types';
import { z } from 'zod';

// Schema for findById query parameters
const maintenanceGetByIdQuerySchema = z.object({
  include: maintenanceIncludeSchema.optional(),
});

const maintenanceItemGetByIdQuerySchema = z.object({
  include: maintenanceItemIncludeSchema.optional(),
});

const maintenanceScheduleGetByIdQuerySchema = z.object({
  include: maintenanceScheduleIncludeSchema.optional(),
});

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  // =====================
  // Maintenance Query Operations
  // =====================

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(maintenanceGetManySchema)) query: MaintenanceGetManyFormData,
  ): Promise<MaintenanceGetManyResponse> {
    return this.maintenanceService.findMany(query);
  }

  // =====================
  // Maintenance CRUD Operations
  // =====================

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(maintenanceCreateSchema))
    data: MaintenanceCreateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceQuerySchema)) query: MaintenanceQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceCreateResponse> {
    return this.maintenanceService.create(data, query.include, userId);
  }

  // =====================
  // Maintenance Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(maintenanceBatchCreateSchema)) data: MaintenanceBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceQuerySchema)) query: MaintenanceQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceBatchCreateResponse<MaintenanceCreateFormData>> {
    return this.maintenanceService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(maintenanceBatchUpdateSchema)) data: MaintenanceBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceQuerySchema)) query: MaintenanceQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceBatchUpdateResponse<MaintenanceUpdateFormData>> {
    return this.maintenanceService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(maintenanceBatchDeleteSchema)) data: MaintenanceBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceBatchDeleteResponse> {
    return this.maintenanceService.batchDelete(data, userId);
  }

  @Post('batch/finish')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async batchFinish(
    @Body() data: { maintenanceIds: string[] },
    @Query(new ZodQueryValidationPipe(maintenanceQuerySchema)) query: MaintenanceQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceBatchUpdateResponse<MaintenanceUpdateFormData>> {
    return this.maintenanceService.batchFinish(data, query.include, userId);
  }

  @Post('batch/start')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async batchStart(
    @Body() data: { maintenanceIds: string[] },
    @Query(new ZodQueryValidationPipe(maintenanceQuerySchema)) query: MaintenanceQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceBatchUpdateResponse<MaintenanceUpdateFormData>> {
    return this.maintenanceService.batchStart(data, query.include, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(maintenanceGetByIdQuerySchema))
    query: z.infer<typeof maintenanceGetByIdQuerySchema>,
  ): Promise<MaintenanceGetUniqueResponse> {
    return this.maintenanceService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(maintenanceUpdateSchema))
    data: MaintenanceUpdateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceQuerySchema)) query: MaintenanceQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceUpdateResponse> {
    return this.maintenanceService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<MaintenanceDeleteResponse> {
    return this.maintenanceService.delete(id, userId);
  }

  @Post(':id/finish')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(maintenanceQuerySchema)) query: MaintenanceQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceUpdateResponse> {
    return this.maintenanceService.finish(id, query.include, userId);
  }
}

@Controller('maintenance-items')
export class MaintenanceItemController {
  constructor(private readonly maintenanceItemService: MaintenanceItemService) {}

  // =====================
  // MaintenanceItem Query Operations
  // =====================

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(maintenanceItemGetManySchema))
    query: MaintenanceItemGetManyFormData,
  ): Promise<MaintenanceItemGetManyResponse> {
    return this.maintenanceItemService.findMany(query);
  }

  // =====================
  // MaintenanceItem CRUD Operations
  // =====================

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(maintenanceItemCreateSchema)) data: MaintenanceItemCreateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceItemQuerySchema))
    query: MaintenanceItemQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceItemCreateResponse> {
    return this.maintenanceItemService.create(data, query.include, userId);
  }

  // =====================
  // MaintenanceItem Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(maintenanceItemBatchCreateSchema))
    data: MaintenanceItemBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceItemQuerySchema))
    query: MaintenanceItemQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceItemBatchCreateResponse<MaintenanceItemCreateFormData>> {
    return this.maintenanceItemService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(maintenanceItemBatchUpdateSchema))
    data: MaintenanceItemBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceItemQuerySchema))
    query: MaintenanceItemQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceItemBatchUpdateResponse<MaintenanceItemUpdateFormData>> {
    return this.maintenanceItemService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(maintenanceItemBatchDeleteSchema))
    data: MaintenanceItemBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceItemBatchDeleteResponse> {
    return this.maintenanceItemService.batchDelete(data, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(maintenanceItemGetByIdQuerySchema))
    query: z.infer<typeof maintenanceItemGetByIdQuerySchema>,
  ): Promise<MaintenanceItemGetUniqueResponse> {
    return this.maintenanceItemService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(maintenanceItemUpdateSchema)) data: MaintenanceItemUpdateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceItemQuerySchema))
    query: MaintenanceItemQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceItemUpdateResponse> {
    return this.maintenanceItemService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<MaintenanceItemDeleteResponse> {
    return this.maintenanceItemService.delete(id, userId);
  }
}

// =====================
// MaintenanceSchedule Controller
// =====================

@Controller('maintenance-schedules')
export class MaintenanceScheduleController {
  constructor(private readonly maintenanceScheduleService: MaintenanceScheduleService) {}

  // =====================
  // MaintenanceSchedule Query Operations
  // =====================

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(maintenanceScheduleGetManySchema))
    query: MaintenanceScheduleGetManyFormData,
  ): Promise<MaintenanceScheduleGetManyResponse> {
    return this.maintenanceScheduleService.findMany(query);
  }

  // =====================
  // MaintenanceSchedule CRUD Operations
  // =====================

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(maintenanceScheduleCreateSchema))
    data: MaintenanceScheduleCreateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceScheduleQuerySchema))
    query: MaintenanceScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceScheduleCreateResponse> {
    return this.maintenanceScheduleService.create(data, query.include, userId);
  }

  // =====================
  // MaintenanceSchedule Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(maintenanceScheduleBatchCreateSchema))
    data: MaintenanceScheduleBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceScheduleQuerySchema))
    query: MaintenanceScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceScheduleBatchCreateResponse<MaintenanceScheduleCreateFormData>> {
    return this.maintenanceScheduleService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(maintenanceScheduleBatchUpdateSchema))
    data: MaintenanceScheduleBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceScheduleQuerySchema))
    query: MaintenanceScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceScheduleBatchUpdateResponse<MaintenanceScheduleUpdateFormData>> {
    return this.maintenanceScheduleService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(maintenanceScheduleBatchDeleteSchema))
    data: MaintenanceScheduleBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceScheduleBatchDeleteResponse> {
    return this.maintenanceScheduleService.batchDelete(data, userId);
  }

  // =====================
  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(maintenanceScheduleGetByIdQuerySchema))
    query: z.infer<typeof maintenanceScheduleGetByIdQuerySchema>,
  ): Promise<MaintenanceScheduleGetUniqueResponse> {
    return this.maintenanceScheduleService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(maintenanceScheduleUpdateSchema))
    data: MaintenanceScheduleUpdateFormData,
    @Query(new ZodQueryValidationPipe(maintenanceScheduleQuerySchema))
    query: MaintenanceScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<MaintenanceScheduleUpdateResponse> {
    return this.maintenanceScheduleService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<MaintenanceScheduleDeleteResponse> {
    return this.maintenanceScheduleService.delete(id, userId);
  }
}
