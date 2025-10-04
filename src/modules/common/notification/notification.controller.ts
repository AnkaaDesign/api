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
import { UserId } from '../auth/decorators/user.decorator';
import { NotificationService } from './notification.service';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../pipes/zod-validation.pipe';
import {
  notificationGetManySchema,
  notificationCreateSchema,
  notificationUpdateSchema,
  notificationBatchCreateSchema,
  notificationBatchUpdateSchema,
  notificationBatchDeleteSchema,
  notificationQuerySchema,
  NotificationGetManyFormData,
  NotificationCreateFormData,
  NotificationUpdateFormData,
  NotificationBatchCreateFormData,
  NotificationBatchUpdateFormData,
  NotificationBatchDeleteFormData,
  NotificationQueryFormData,
  NotificationInclude,
  seenNotificationGetManySchema,
  seenNotificationGetByIdSchema,
  seenNotificationCreateSchema,
  seenNotificationUpdateSchema,
  seenNotificationBatchCreateSchema,
  seenNotificationBatchUpdateSchema,
  seenNotificationBatchDeleteSchema,
  seenNotificationQuerySchema,
  SeenNotificationGetManyFormData,
  SeenNotificationQueryFormData,
  SeenNotificationCreateFormData,
  SeenNotificationUpdateFormData,
  SeenNotificationBatchCreateFormData,
  SeenNotificationBatchUpdateFormData,
  SeenNotificationBatchDeleteFormData,
  SeenNotificationInclude,
} from '../../../schemas';
import {
  Notification,
  NotificationGetManyResponse,
  NotificationGetUniqueResponse,
  NotificationCreateResponse,
  NotificationUpdateResponse,
  NotificationDeleteResponse,
  NotificationBatchCreateResponse,
  NotificationBatchUpdateResponse,
  NotificationBatchDeleteResponse,
  SeenNotification,
  SeenNotificationGetManyResponse,
  SeenNotificationGetUniqueResponse,
  SeenNotificationCreateResponse,
  SeenNotificationUpdateResponse,
  SeenNotificationDeleteResponse,
  SeenNotificationBatchCreateResponse,
  SeenNotificationBatchUpdateResponse,
  SeenNotificationBatchDeleteResponse,
} from '../../../types';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // =====================
  // Notification CRUD Operations
  // =====================

  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(notificationGetManySchema))
    query: NotificationGetManyFormData,
  ): Promise<NotificationGetManyResponse> {
    return this.notificationService.getNotifications(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(notificationCreateSchema)) data: NotificationCreateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationCreateResponse> {
    return this.notificationService.createNotification(data, query.include, userId);
  }

  // =====================
  // Notification Batch Operations (must come before dynamic routes)
  // =====================

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(notificationBatchCreateSchema))
    data: NotificationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationBatchCreateResponse<NotificationCreateFormData>> {
    return this.notificationService.batchCreateNotifications(data, query.include, userId);
  }

  @Put('batch')
  async batchUpdate(
    @Body(new ZodValidationPipe(notificationBatchUpdateSchema))
    data: NotificationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationBatchUpdateResponse<NotificationUpdateFormData>> {
    return this.notificationService.batchUpdateNotifications(data, userId, query.include);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(notificationBatchDeleteSchema))
    data: NotificationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<NotificationBatchDeleteResponse> {
    return this.notificationService.batchDeleteNotifications(data, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
  ): Promise<NotificationGetUniqueResponse> {
    return this.notificationService.getNotificationById(id, query.include);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(notificationUpdateSchema)) data: NotificationUpdateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationUpdateResponse> {
    return this.notificationService.updateNotification(id, data, query.include, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<NotificationDeleteResponse> {
    return this.notificationService.deleteNotification(id, userId);
  }
}

@Controller('seen-notifications')
export class SeenNotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // =====================
  // SeenNotification CRUD Operations
  // =====================

  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(seenNotificationGetManySchema))
    query: SeenNotificationGetManyFormData,
  ): Promise<SeenNotificationGetManyResponse> {
    return this.notificationService.getSeenNotifications(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(seenNotificationCreateSchema)) data: SeenNotificationCreateFormData,
    @Query(new ZodQueryValidationPipe(seenNotificationQuerySchema))
    query: SeenNotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<SeenNotificationCreateResponse> {
    return this.notificationService.createSeenNotification(data, query.include, userId);
  }

  // =====================
  // SeenNotification Batch Operations
  // =====================

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(seenNotificationBatchCreateSchema))
    data: SeenNotificationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(seenNotificationQuerySchema))
    query: SeenNotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<SeenNotificationBatchCreateResponse<SeenNotificationCreateFormData>> {
    return this.notificationService.batchCreateSeenNotifications(data, query.include, userId);
  }

  @Put('batch')
  async batchUpdate(
    @Body(new ZodValidationPipe(seenNotificationBatchUpdateSchema))
    data: SeenNotificationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(seenNotificationQuerySchema))
    query: SeenNotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<SeenNotificationBatchUpdateResponse<SeenNotificationUpdateFormData>> {
    return this.notificationService.batchUpdateSeenNotifications(data, userId, query.include);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(seenNotificationBatchDeleteSchema))
    data: SeenNotificationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<SeenNotificationBatchDeleteResponse> {
    return this.notificationService.batchDeleteSeenNotifications(data, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(seenNotificationQuerySchema))
    query: SeenNotificationQueryFormData,
  ): Promise<SeenNotificationGetUniqueResponse> {
    return this.notificationService.getSeenNotificationById(id, query.include);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(seenNotificationUpdateSchema)) data: SeenNotificationUpdateFormData,
    @Query(new ZodQueryValidationPipe(seenNotificationQuerySchema))
    query: SeenNotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<SeenNotificationUpdateResponse> {
    return this.notificationService.updateSeenNotification(id, data, query.include, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<SeenNotificationDeleteResponse> {
    return this.notificationService.deleteSeenNotification(id, userId);
  }

  // =====================
  // Special endpoint to mark notification as read
  // =====================

  @Post('mark-as-read/:notificationId')
  @HttpCode(HttpStatus.CREATED)
  async markAsRead(
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @UserId() userId: string,
  ): Promise<SeenNotificationCreateResponse> {
    return this.notificationService.markAsRead(notificationId, userId);
  }
}
