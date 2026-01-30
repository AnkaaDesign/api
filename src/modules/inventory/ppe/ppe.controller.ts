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
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  // PPE Size schemas
  ppeSizeGetManySchema,
  ppeSizeCreateSchema,
  ppeSizeUpdateSchema,
  ppeSizeBatchCreateSchema,
  ppeSizeBatchUpdateSchema,
  ppeSizeBatchDeleteSchema,
  ppeSizeQuerySchema,
  ppeSizeGetByIdSchema,

  // PPE Delivery schemas
  ppeDeliveryGetManySchema,
  ppeDeliveryCreateSchema,
  ppeDeliveryUpdateSchema,
  ppeDeliveryBatchCreateSchema,
  ppeDeliveryBatchUpdateSchema,
  ppeDeliveryBatchDeleteSchema,
  ppeDeliveryQuerySchema,
  ppeDeliveryGetByIdSchema,

  // PPE Config schemas - COMMENTED OUT: PPE config now in Item model
  // ppeConfigGetManySchema,
  // ppeConfigCreateSchema,
  // ppeConfigUpdateSchema,
  // ppeConfigBatchCreateSchema,
  // ppeConfigBatchUpdateSchema,
  // ppeConfigBatchDeleteSchema,
  // ppeConfigQuerySchema,
  // ppeConfigGetByIdSchema,

  // PPE Schedule schemas
  ppeDeliveryScheduleGetManySchema,
  ppeDeliveryScheduleCreateSchema,
  ppeDeliveryScheduleUpdateSchema,
  ppeDeliveryScheduleBatchCreateSchema,
  ppeDeliveryScheduleBatchUpdateSchema,
  ppeDeliveryScheduleBatchDeleteSchema,
  ppeDeliveryScheduleQuerySchema,
  ppeDeliveryScheduleGetByIdSchema,

  // PPE Delivery By Schedule schemas
  ppeDeliveryByScheduleSchema,
} from '@schemas';
import type {
  // PPE Size types
  PpeSizeGetManyFormData,
  PpeSizeCreateFormData,
  PpeSizeUpdateFormData,
  PpeSizeBatchCreateFormData,
  PpeSizeBatchUpdateFormData,
  PpeSizeBatchDeleteFormData,
  PpeSizeQueryFormData,
  PpeSizeGetByIdFormData,

  // PPE Delivery types
  PpeDeliveryGetManyFormData,
  PpeDeliveryCreateFormData,
  PpeDeliveryUpdateFormData,
  PpeDeliveryBatchCreateFormData,
  PpeDeliveryBatchUpdateFormData,
  PpeDeliveryBatchDeleteFormData,
  PpeDeliveryQueryFormData,
  PpeDeliveryGetByIdFormData,

  // PPE Config types - COMMENTED OUT: PPE config now in Item model
  // PpeConfigGetManyFormData,
  // PpeConfigCreateFormData,
  // PpeConfigUpdateFormData,
  // PpeConfigBatchCreateFormData,
  // PpeConfigBatchUpdateFormData,
  // PpeConfigBatchDeleteFormData,
  // PpeConfigQueryFormData,
  // PpeConfigQueryFormData,

  // PPE Schedule types
  PpeDeliveryScheduleGetManyFormData,
  PpeDeliveryScheduleCreateFormData,
  PpeDeliveryScheduleUpdateFormData,
  PpeDeliveryScheduleBatchCreateFormData,
  PpeDeliveryScheduleBatchUpdateFormData,
  PpeDeliveryScheduleBatchDeleteFormData,
  PpeDeliveryScheduleQueryFormData,
  PpeDeliveryScheduleGetByIdFormData,

  // PPE Delivery By Schedule types
  PpeDeliveryByScheduleFormData,
} from '@schemas';
import type {
  PpeSizeGetManyResponse,
  PpeSizeGetUniqueResponse,
  PpeSizeCreateResponse,
  PpeSizeUpdateResponse,
  PpeSizeDeleteResponse,
  PpeSizeBatchCreateResponse,
  PpeSizeBatchUpdateResponse,
  PpeSizeBatchDeleteResponse,
  PpeDeliveryGetManyResponse,
  PpeDeliveryGetUniqueResponse,
  PpeDeliveryCreateResponse,
  PpeDeliveryUpdateResponse,
  PpeDeliveryDeleteResponse,
  PpeDeliveryBatchCreateResponse,
  PpeDeliveryBatchUpdateResponse,
  PpeDeliveryBatchDeleteResponse,
  // PpeConfigGetManyResponse, // COMMENTED OUT
  // PpeConfigGetUniqueResponse, // COMMENTED OUT
  // PpeConfigCreateResponse, // COMMENTED OUT
  // PpeConfigUpdateResponse, // COMMENTED OUT
  // PpeConfigDeleteResponse, // COMMENTED OUT
  // PpeConfigBatchCreateResponse, // COMMENTED OUT
  // PpeConfigBatchUpdateResponse, // COMMENTED OUT
  // PpeConfigBatchDeleteResponse, // COMMENTED OUT
  PpeDeliveryScheduleGetManyResponse,
  PpeDeliveryScheduleGetUniqueResponse,
  PpeDeliveryScheduleCreateResponse,
  PpeDeliveryScheduleUpdateResponse,
  PpeDeliveryScheduleDeleteResponse,
  PpeDeliveryScheduleBatchCreateResponse,
  PpeDeliveryScheduleBatchUpdateResponse,
  PpeDeliveryScheduleBatchDeleteResponse,
} from '@types';
import { PpeDeliveryService } from './ppe-delivery.service';
import { PpeDeliveryScheduleService } from './ppe-delivery-schedule.service';
import { PpeSizeService } from './ppe-size.service';
import { PpeSignatureService } from './ppe-signature.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES, PPE_DELIVERY_STATUS, PPE_TYPE, PPE_SIZE } from '@constants';

@Controller('ppe')
export class PpeController {
  constructor(
    private readonly ppeSizeService: PpeSizeService,
    private readonly ppeDeliveryScheduleService: PpeDeliveryScheduleService,
    private readonly ppeDeliveryService: PpeDeliveryService,
    private readonly ppeSignatureService: PpeSignatureService,
  ) {}

  // =====================
  // PPE SIZE OPERATIONS
  // =====================

  @Get('sizes')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeSizes(
    @Query(new ZodQueryValidationPipe(ppeSizeGetManySchema)) query: PpeSizeGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeGetManyResponse> {
    return this.ppeSizeService.findMany(query);
  }

  @Post('sizes')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createPpeSize(
    @Body(new ZodValidationPipe(ppeSizeCreateSchema)) data: PpeSizeCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeSizeQuerySchema)) query: PpeSizeQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeCreateResponse> {
    return this.ppeSizeService.create(data, query.include, userId);
  }

  @Post('sizes/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreatePpeSizes(
    @Body(new ZodValidationPipe(ppeSizeBatchCreateSchema)) data: PpeSizeBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeSizeQuerySchema)) query: PpeSizeQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeBatchCreateResponse<PpeSizeCreateFormData>> {
    return this.ppeSizeService.batchCreate(data, query.include, userId);
  }

  @Put('sizes/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdatePpeSizes(
    @Body(new ZodValidationPipe(ppeSizeBatchUpdateSchema)) data: PpeSizeBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeSizeQuerySchema)) query: PpeSizeQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeBatchUpdateResponse<PpeSizeUpdateFormData>> {
    return this.ppeSizeService.batchUpdate(data, query.include, userId);
  }

  @Delete('sizes/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeletePpeSizes(
    @Body(new ZodValidationPipe(ppeSizeBatchDeleteSchema)) data: PpeSizeBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeBatchDeleteResponse> {
    return this.ppeSizeService.batchDelete(data, userId);
  }

  @Get('sizes/by-mask/:maskSize')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeSizesByMask(
    @Param('maskSize') maskSize: string,
    @Query(new ZodQueryValidationPipe(ppeSizeQuerySchema)) query: PpeSizeQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeGetManyResponse> {
    return this.ppeSizeService.findByMaskSize(maskSize, query.include);
  }

  @Get('sizes/user/:userId')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeSizeByUserId(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query(new ZodQueryValidationPipe(ppeSizeQuerySchema)) query: PpeSizeQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeGetUniqueResponse> {
    return this.ppeSizeService.findByUserId(targetUserId, query.include);
  }

  @Get('sizes/:id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeSizeById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(ppeSizeQuerySchema)) query: PpeSizeQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeGetUniqueResponse> {
    return this.ppeSizeService.findById(id, query.include);
  }

  @Put('sizes/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updatePpeSize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ppeSizeUpdateSchema)) data: PpeSizeUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeSizeQuerySchema)) query: PpeSizeQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeSizeUpdateResponse> {
    return this.ppeSizeService.update(id, data, query.include, userId);
  }

  @Delete('sizes/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePpeSize(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PpeSizeDeleteResponse> {
    return this.ppeSizeService.delete(id, userId);
  }

  // =====================
  // PPE DELIVERY OPERATIONS
  // =====================

  @Get('deliveries')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeDeliveries(
    @Query(new ZodQueryValidationPipe(ppeDeliveryGetManySchema)) query: PpeDeliveryGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    return this.ppeDeliveryService.findMany(query);
  }

  @Post('deliveries')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createPpeDelivery(
    @Body(new ZodValidationPipe(ppeDeliveryCreateSchema)) data: PpeDeliveryCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryCreateResponse> {
    return this.ppeDeliveryService.create(data, query.include, userId);
  }

  @Post('deliveries/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreatePpeDeliveries(
    @Body(new ZodValidationPipe(ppeDeliveryBatchCreateSchema)) data: PpeDeliveryBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryBatchCreateResponse<PpeDeliveryCreateFormData>> {
    return this.ppeDeliveryService.batchCreate(data, query.include, userId);
  }

  @Put('deliveries/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdatePpeDeliveries(
    @Body(new ZodValidationPipe(ppeDeliveryBatchUpdateSchema)) data: PpeDeliveryBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryBatchUpdateResponse<PpeDeliveryUpdateFormData>> {
    return this.ppeDeliveryService.batchUpdate(data, query.include, userId);
  }

  @Delete('deliveries/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeletePpeDeliveries(
    @Body(new ZodValidationPipe(ppeDeliveryBatchDeleteSchema)) data: PpeDeliveryBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryBatchDeleteResponse> {
    return this.ppeDeliveryService.batchDelete(data, userId);
  }

  @Post('deliveries/mark-delivered/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async markPpeDeliveryAsDelivered(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @Body('deliveryDate') deliveryDate?: Date,
  ): Promise<PpeDeliveryUpdateResponse> {
    return this.ppeDeliveryService.markAsDelivered(id, userId, deliveryDate, userId);
  }

  @Post('deliveries/finish-and-schedule-next/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async finishDeliveryAndScheduleNext(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reviewedBy', ParseUUIDPipe) reviewedBy: string,
    @UserId() userId: string,
    @Body('deliveryDate') deliveryDate?: Date,
  ): Promise<PpeDeliveryUpdateResponse> {
    // This endpoint is specifically designed for scheduled deliveries
    // It marks the delivery as finished AND creates the next scheduled instance
    return this.ppeDeliveryService.finishDeliveryWithAutoSchedule(
      id,
      reviewedBy,
      deliveryDate,
      userId,
    );
  }

  @Post('deliveries/batch-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchApprovePpeDeliveries(
    @Body() data: { deliveryIds: string[]; reviewedBy?: string },
    @UserId() userId: string,
  ): Promise<{ success: number; failed: number; results: any[] }> {
    return this.ppeDeliveryService.batchApprove(
      data.deliveryIds,
      data.reviewedBy || userId,
      userId,
    );
  }

  @Post('deliveries/batch-reject')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchRejectPpeDeliveries(
    @Body() data: { deliveryIds: string[]; reviewedBy?: string; reason?: string },
    @UserId() userId: string,
  ): Promise<{ success: number; failed: number; results: any[] }> {
    return this.ppeDeliveryService.batchReject(
      data.deliveryIds,
      data.reviewedBy || userId,
      data.reason,
      userId,
    );
  }

  @Post('deliveries/batch-mark-delivered')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchMarkPpeDeliveriesAsDelivered(
    @Body() data: { deliveryIds: string[]; reviewedBy?: string; deliveryDate?: Date },
    @UserId() userId: string,
  ): Promise<{ success: number; failed: number; results: any[] }> {
    return this.ppeDeliveryService.batchMarkAsDelivered(
      data.deliveryIds,
      data.reviewedBy || userId,
      data.deliveryDate,
      userId,
    );
  }

  @Get('deliveries/scheduled')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getScheduledDeliveries(
    @Query(new ZodQueryValidationPipe(ppeDeliveryGetManySchema)) query: PpeDeliveryGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Filter for deliveries that are linked to schedules and are pending
    const scheduledQuery: PpeDeliveryGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        ppeScheduleId: { not: null },
        actualDeliveryDate: null,
      },
    };
    return this.ppeDeliveryService.findMany(scheduledQuery);
  }

  @Get('deliveries/pending-for-schedule/:scheduleId')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPendingDeliveriesForSchedule(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    return this.ppeDeliveryService.findBySchedule(scheduleId, query.include);
  }

  @Get('deliveries/available-for-user/:userId')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getAvailablePpeForUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
    @Query('ppeType') ppeType?: PPE_TYPE,
  ): Promise<PpeDeliveryGetManyResponse> {
    return this.ppeDeliveryService.findAvailablePpeForUser(targetUserId, ppeType, query.include);
  }

  @Get('deliveries/stats')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeDeliveryStatistics(@UserId() userId: string, @Query('userId') targetUserId?: string) {
    return this.ppeDeliveryService.getDeliveryStatistics(targetUserId);
  }

  @Get('deliveries/overdue')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getOverdueDeliveries(
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ) {
    return this.ppeDeliveryService.findOverdueScheduledDeliveries(query.include);
  }

  @Get('deliveries/upcoming')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getUpcomingDeliveries(
    @Query('days') days: string = '7',
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ) {
    const daysNumber = parseInt(days) || 7;
    return this.ppeDeliveryService.findUpcomingScheduledDeliveries(daysNumber, query.include);
  }

  @Post('deliveries/create-from-schedule')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createDeliveryFromSchedule(
    @Body(new ZodValidationPipe(ppeDeliveryByScheduleSchema)) data: PpeDeliveryByScheduleFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryCreateResponse> {
    return this.ppeDeliveryService.createFromSchedule(data, userId);
  }

  // =====================
  // PRODUCTION WORKER ENDPOINTS
  // =====================

  @Get('deliveries/my-requests')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyPpeDeliveries(
    @Query(new ZodQueryValidationPipe(ppeDeliveryGetManySchema)) query: PpeDeliveryGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Production workers can only see their own PPE deliveries
    const filteredQuery: PpeDeliveryGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId,
      },
    };
    return this.ppeDeliveryService.findMany(filteredQuery);
  }

  @Get('deliveries/my-available')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyAvailablePpe(
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
    @Query('ppeType') ppeType?: PPE_TYPE,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Production workers can see available PPE items for themselves
    return this.ppeDeliveryService.findAvailablePpeForUser(userId, ppeType, query.include);
  }

  @Post('deliveries/request')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async requestPpeDelivery(
    @Body(new ZodValidationPipe(ppeDeliveryCreateSchema))
    data: Omit<PpeDeliveryCreateFormData, 'userId' | 'status' | 'statusOrder'>,
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryCreateResponse> {
    // Production workers can only request PPEs for themselves with PENDING status
    const requestData: PpeDeliveryCreateFormData = {
      ...data,
      userId,
      status: PPE_DELIVERY_STATUS.PENDING,
      statusOrder: 1,
    };
    return this.ppeDeliveryService.create(requestData, query.include, userId);
  }

  // =====================
  // SINGLE DELIVERY OPERATIONS (must be after static routes to avoid route conflicts)
  // =====================

  @Get('deliveries/:id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeDeliveryById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(ppeDeliveryGetByIdSchema)) query: PpeDeliveryGetByIdFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetUniqueResponse> {
    return this.ppeDeliveryService.findById(id, query.include);
  }

  @Put('deliveries/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updatePpeDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ppeDeliveryUpdateSchema)) data: PpeDeliveryUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryQuerySchema)) query: PpeDeliveryQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryUpdateResponse> {
    return this.ppeDeliveryService.update(id, data, query.include, userId);
  }

  @Delete('deliveries/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePpeDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PpeDeliveryDeleteResponse> {
    return this.ppeDeliveryService.delete(id, userId);
  }

  // =====================
  // PPE SIGNATURE OPERATIONS
  // =====================

  @Get('deliveries/:id/signature-status')
  @Roles(
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getSignatureStatus(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{
    success: boolean;
    data: {
      status: string;
      documentKey?: string;
      signedAt?: Date;
      documentUrl?: string;
      signatureUrl?: string;
    };
  }> {
    const data = await this.ppeSignatureService.getSignatureStatus(id);
    return { success: true, data };
  }

  @Post('deliveries/:id/resend-signature-notification')
  @Roles(
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @HttpCode(HttpStatus.OK)
  async resendSignatureNotification(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.ppeSignatureService.resendSignatureNotification(id);
    return { success: true, message: 'Notificação de assinatura reenviada com sucesso.' };
  }

  @Post('deliveries/:id/complete-signature')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async manuallyCompleteSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.ppeSignatureService.manuallyCompleteSignature(id, userId);
    return { success: true, message: 'Assinatura completada manualmente.' };
  }

  @Post('deliveries/:id/reject-signature')
  @Roles(
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @HttpCode(HttpStatus.OK)
  async rejectSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.ppeSignatureService.rejectSignature(id, reason);
    return { success: true, message: 'Assinatura rejeitada.' };
  }

  @Get('signature-available')
  @Roles(
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async isSignatureAvailable(): Promise<{ available: boolean }> {
    return { available: this.ppeSignatureService.isClickSignAvailable() };
  }

  /* COMMENTED OUT: PPE CONFIG OPERATIONS - PPE config now in Item model
  // =====================
  // PPE CONFIG OPERATIONS
  // =====================

  @Get("configs")
  @Roles(SECTOR_PRIVILEGES.PRODUCTION,  SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(ppeConfigGetManySchema))
  async getPpeConfigs(@Query() query: PpeConfigGetManyFormData): Promise<PpeConfigGetManyResponse> {
    return this.ppeConfigService.findMany(query);
  }

  @Get("configs/:id")
  @Roles(SECTOR_PRIVILEGES.PRODUCTION,  SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getPpeConfigById(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodQueryValidationPipe(ppeConfigQuerySchema)) query: PpeConfigQueryFormData): Promise<PpeConfigGetUniqueResponse> {
    return this.ppeConfigService.findById(id, query.include);
  }

  @Post("configs")
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(ppeConfigCreateSchema))
  async createPpeConfig(
    @Body() data: PpeConfigCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeConfigQuerySchema)) query: PpeConfigQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeConfigCreateResponse> {
    return this.ppeConfigService.create(data, query.include, userId);
  }

  @Put("configs/:id")
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(ppeConfigUpdateSchema))
  async updatePpeConfig(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() data: PpeConfigUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeConfigQuerySchema)) query: PpeConfigQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeConfigUpdateResponse> {
    return this.ppeConfigService.update(id, data, query.include, userId);
  }

  @Delete("configs/:id")
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePpeConfig(@Param("id", ParseUUIDPipe) id: string, @UserId() userId: string): Promise<PpeConfigDeleteResponse> {
    return this.ppeConfigService.delete(id, userId);
  }

  @Post("configs/batch")
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(ppeConfigBatchCreateSchema))
  async batchCreatePpeConfigs(
    @Body() data: PpeConfigBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeConfigQuerySchema)) query: PpeConfigQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeConfigBatchCreateResponse<PpeConfigCreateFormData>> {
    return this.ppeConfigService.batchCreate(data, query.include, userId);
  }

  @Put("configs/batch")
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(ppeConfigBatchUpdateSchema))
  async batchUpdatePpeConfigs(
    @Body() data: PpeConfigBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeConfigQuerySchema)) query: PpeConfigQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeConfigBatchUpdateResponse<PpeConfigUpdateFormData>> {
    return this.ppeConfigService.batchUpdate(data, query.include, userId);
  }

  @Delete("configs/batch")
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(ppeConfigBatchDeleteSchema))
  async batchDeletePpeConfigs(@Body() data: PpeConfigBatchDeleteFormData, @UserId() userId: string): Promise<PpeConfigBatchDeleteResponse> {
    return this.ppeConfigService.batchDelete(data, userId);
  }

  @Get("configs/by-type/:ppeType")
  @Roles(SECTOR_PRIVILEGES.PRODUCTION,  SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(ppeConfigQuerySchema))
  async getPpeConfigsByType(@Param("ppeType") ppeType: PPE_TYPE, @Query() query: PpeConfigQueryFormData): Promise<PpeConfigGetManyResponse> {
    return this.ppeConfigService.findByPpeType(ppeType, query.include);
  }

  @Get("configs/item/:itemId")
  @Roles(SECTOR_PRIVILEGES.PRODUCTION,  SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(ppeConfigQuerySchema))
  async getPpeConfigByItem(@Param("itemId", ParseUUIDPipe) itemId: string, @Query() query: PpeConfigQueryFormData): Promise<PpeConfigGetManyResponse> {
    return this.ppeConfigService.findByItem(itemId, query.include);
  }

  @Get("configs/unique/:itemId/:ppeType/:size")
  @Roles(SECTOR_PRIVILEGES.PRODUCTION,  SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(ppeConfigQuerySchema))
  async getPpeConfigByUniqueFields(
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Param("ppeType") ppeType: string,
    @Param("size") size: string,
    @Query() query: PpeConfigQueryFormData
  ): Promise<PpeConfigGetUniqueResponse> {
    return this.ppeConfigService.findByUniqueFields(itemId, ppeType, size, query.include);
  }

  @Get("configs/by-size/:size")
  @Roles(SECTOR_PRIVILEGES.PRODUCTION,  SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(ppeConfigQuerySchema))
  async getPpeConfigsBySize(@Param("size") size: PPE_SIZE, @Query() query: PpeConfigQueryFormData): Promise<PpeConfigGetManyResponse> {
    return this.ppeConfigService.findBySize(size, query.include);
  }
  */

  // =====================
  // PPE SCHEDULE OPERATIONS
  // =====================

  @Get('schedules')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeDeliverySchedules(
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleGetManySchema))
    query: PpeDeliveryScheduleGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    return this.ppeDeliveryScheduleService.findMany(query);
  }

  @Post('schedules')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createPpeDeliverySchedule(
    @Body(new ZodValidationPipe(ppeDeliveryScheduleCreateSchema))
    data: PpeDeliveryScheduleCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleQuerySchema))
    query: PpeDeliveryScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleCreateResponse> {
    return this.ppeDeliveryScheduleService.create(data, query.include, userId);
  }

  @Post('schedules/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreatePpeDeliverySchedules(
    @Body(new ZodValidationPipe(ppeDeliveryScheduleBatchCreateSchema))
    data: PpeDeliveryScheduleBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleQuerySchema))
    query: PpeDeliveryScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleBatchCreateResponse<PpeDeliveryScheduleCreateFormData>> {
    return this.ppeDeliveryScheduleService.batchCreate(data, query.include, userId);
  }

  @Put('schedules/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdatePpeDeliverySchedules(
    @Body(new ZodValidationPipe(ppeDeliveryScheduleBatchUpdateSchema))
    data: PpeDeliveryScheduleBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleQuerySchema))
    query: PpeDeliveryScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleBatchUpdateResponse<PpeDeliveryScheduleUpdateFormData>> {
    return this.ppeDeliveryScheduleService.batchUpdate(data, query.include, userId);
  }

  @Delete('schedules/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeletePpeDeliverySchedules(
    @Body(new ZodValidationPipe(ppeDeliveryScheduleBatchDeleteSchema))
    data: PpeDeliveryScheduleBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleBatchDeleteResponse> {
    return this.ppeDeliveryScheduleService.batchDelete(data, userId);
  }

  @Get('schedules/:id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getPpeDeliveryScheduleById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleGetByIdSchema))
    query: PpeDeliveryScheduleGetByIdFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleGetUniqueResponse> {
    return this.ppeDeliveryScheduleService.findById(id, query.include);
  }

  @Put('schedules/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updatePpeDeliverySchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ppeDeliveryScheduleUpdateSchema))
    data: PpeDeliveryScheduleUpdateFormData,
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleQuerySchema))
    query: PpeDeliveryScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleUpdateResponse> {
    return this.ppeDeliveryScheduleService.update(id, data, query.include, userId);
  }

  @Delete('schedules/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePpeDeliverySchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleDeleteResponse> {
    return this.ppeDeliveryScheduleService.delete(id, userId);
  }

  @Post('schedules/execute/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async executeScheduleNow(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      deliveriesCreated: number;
      userCount: number;
      ppeTypes: string[];
      errors?: string[];
    };
  }> {
    return this.ppeDeliveryScheduleService.executeScheduleNow(id, userId);
  }

  @Get('schedules/stats/:id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getScheduleExecutionStats(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      totalUsers: number;
      totalDeliveries: number;
      pendingDeliveries: number;
      deliveredCount: number;
      lastExecuted?: Date;
      nextRun?: Date;
      ppeTypes: string[];
      assignmentType: string;
    };
  }> {
    return this.ppeDeliveryScheduleService.getScheduleExecutionStats(id);
  }

  @Post('schedules/toggle-active/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async toggleScheduleActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isActive') isActive: boolean,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleUpdateResponse> {
    return this.ppeDeliveryScheduleService.toggleActive(id, { isActive }, userId);
  }

  @Post('schedules/recalculate-next-run/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async recalculateScheduleNextRun(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleUpdateResponse> {
    return this.ppeDeliveryScheduleService.recalculateNextRun(id, userId);
  }

  @Get('schedules/active')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getActiveSchedules(
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleQuerySchema))
    query: PpeDeliveryScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    return this.ppeDeliveryScheduleService.findActiveSchedules(query.include);
  }

  @Get('schedules/by-user/:userId')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getSchedulesByUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleQuerySchema))
    query: PpeDeliveryScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    return this.ppeDeliveryScheduleService.findByUser(targetUserId, query.include);
  }

  @Get('schedules/due')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getDueSchedules(
    @Query(new ZodQueryValidationPipe(ppeDeliveryScheduleQuerySchema))
    query: PpeDeliveryScheduleQueryFormData,
    @UserId() userId: string,
    @Query('date') date?: string,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    const targetDate = date ? new Date(date) : undefined;
    return this.ppeDeliveryScheduleService.findDueSchedules(targetDate, query.include);
  }
}
