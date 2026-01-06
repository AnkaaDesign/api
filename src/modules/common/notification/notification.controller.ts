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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { UserId } from '../auth/decorators/user.decorator';
import { NotificationService } from './notification.service';
import { NotificationDispatchService } from './notification-dispatch.service';
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

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  // =====================
  // Notification CRUD Operations
  // =====================

  @Get()
  @ApiOperation({
    summary: 'Get notifications for current user',
    description: 'Retrieve a paginated list of notifications for the authenticated user with optional filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'List of notifications retrieved successfully',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async findMany(
    @Query(new ZodQueryValidationPipe(notificationGetManySchema))
    query: NotificationGetManyFormData,
    @UserId() userId: string,
  ): Promise<NotificationGetManyResponse> {
    // SECURITY: Always filter by the authenticated user's ID
    // Users should only see their own notifications
    const filteredQuery: NotificationGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Enforce userId filter
      },
    };
    return this.notificationService.getNotifications(filteredQuery);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new notification',
    description: 'Create a new notification for a specific user',
  })
  @ApiResponse({
    status: 201,
    description: 'Notification created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input data',
  })
  async create(
    @Body(new ZodValidationPipe(notificationCreateSchema)) data: NotificationCreateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationCreateResponse> {
    return this.notificationService.createNotification(data, query.include, userId);
  }

  // =====================
  // Notification Send Operation
  // =====================

  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a notification',
    description: 'Create and send a notification to the authenticated user',
  })
  @ApiResponse({
    status: 201,
    description: 'Notification sent successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input data',
  })
  async send(
    @Body(new ZodValidationPipe(notificationCreateSchema)) data: NotificationCreateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationCreateResponse> {
    const notification = await this.notificationService.createNotification(data, query.include, userId);

    // Dispatch the notification immediately if not scheduled
    if (!data.scheduledAt) {
      await this.dispatchService.dispatchNotification(notification.data.id);
    }

    return notification;
  }

  // =====================
  // Notification Batch Operations (must come before dynamic routes)
  // =====================

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Batch create notifications',
    description: 'Create multiple notifications in a single request',
  })
  @ApiResponse({
    status: 201,
    description: 'Notifications created successfully',
  })
  async batchCreate(
    @Body(new ZodValidationPipe(notificationBatchCreateSchema))
    data: NotificationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationBatchCreateResponse<NotificationCreateFormData>> {
    return this.notificationService.batchCreateNotifications(data, query.include, userId);
  }

  @Put('batch')
  @ApiOperation({
    summary: 'Batch update notifications',
    description: 'Update multiple notifications in a single request',
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications updated successfully',
  })
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
  @ApiOperation({
    summary: 'Batch delete notifications',
    description: 'Delete multiple notifications in a single request',
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications deleted successfully',
  })
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
  @ApiOperation({
    summary: 'Get notification by ID',
    description: 'Retrieve a specific notification by its unique identifier',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
  ): Promise<NotificationGetUniqueResponse> {
    return this.notificationService.getNotificationById(id, query.include);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update notification',
    description: 'Update an existing notification by its ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(notificationUpdateSchema)) data: NotificationUpdateFormData,
    @Query(new ZodQueryValidationPipe(notificationQuerySchema)) query: NotificationQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationUpdateResponse> {
    return this.notificationService.updateNotification(id, data, query.include, userId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete notification',
    description: 'Delete a notification by its ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<NotificationDeleteResponse> {
    return this.notificationService.deleteNotification(id, userId);
  }

  // =====================
  // Notification Tracking Routes
  // =====================

  @Post(':id/seen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notification as seen',
    description: 'Mark a notification as seen/viewed by the authenticated user',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as seen successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async markAsSeen(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.notificationService.markAsSeen(id, userId);
    return {
      success: true,
      message: 'Notificação marcada como vista com sucesso.',
    };
  }

  @Post(':id/mark-as-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Mark a notification as read/seen by the authenticated user (alias for seen)',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.notificationService.markAsSeen(id, userId);
    return {
      success: true,
      message: 'Notificação marcada como lida com sucesso.',
    };
  }

  @Get(':id/delivery-status')
  @ApiOperation({
    summary: 'Get delivery status',
    description: 'Get delivery status for a notification across all channels',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Delivery status retrieved successfully',
  })
  async getDeliveryStatus(@Param('id', ParseUUIDPipe) id: string) {
    const deliveries = await this.notificationService.getDeliveryStatus(id);
    return {
      success: true,
      message: 'Status de entrega carregado com sucesso.',
      data: deliveries,
    };
  }

  @Get(':id/stats')
  @ApiOperation({
    summary: 'Get notification statistics',
    description: 'Get delivery statistics for a specific notification',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getStats(@Param('id', ParseUUIDPipe) id: string) {
    const stats = await this.notificationService.getDeliveryStats(id);
    return {
      success: true,
      message: 'Estatísticas carregadas com sucesso.',
      data: stats,
    };
  }

  @Get('user/:userId/unseen')
  @ApiOperation({
    summary: 'Get unseen notifications',
    description: 'Get all unseen notifications for a specific user',
  })
  @ApiParam({
    name: 'userId',
    description: 'User UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Unseen notifications retrieved successfully',
  })
  async getUnseenNotifications(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @UserId() userId: string,
  ) {
    // Users can only access their own unseen notifications
    if (userId !== targetUserId) {
      throw new BadRequestException('Você não tem permissão para acessar essas notificações.');
    }

    const notifications = await this.notificationService.getUnseenNotifications(targetUserId);
    return {
      success: true,
      message: 'Notificações não vistas carregadas com sucesso.',
      data: notifications,
      meta: {
        total: notifications.length,
      },
    };
  }

  @Get('user/:userId/unseen-count')
  @ApiOperation({
    summary: 'Get unseen notification count',
    description: 'Get count of unseen notifications for a specific user',
  })
  @ApiParam({
    name: 'userId',
    description: 'User UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Unseen count retrieved successfully',
  })
  async getUnseenCount(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @UserId() userId: string,
  ) {
    // Users can only access their own unseen count
    if (userId !== targetUserId) {
      throw new BadRequestException('Você não tem permissão para acessar essa informação.');
    }

    const count = await this.notificationService.getUnseenCount(targetUserId);
    return {
      success: true,
      message: 'Contagem de notificações não vistas carregada com sucesso.',
      data: { count },
    };
  }

  @Get('user/:userId/stats')
  @ApiOperation({
    summary: 'Get user notification statistics',
    description: 'Get notification statistics for a specific user',
  })
  @ApiParam({
    name: 'userId',
    description: 'User UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'User statistics retrieved successfully',
  })
  async getUserStats(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @UserId() userId: string,
  ) {
    // Users can only access their own stats
    if (userId !== targetUserId) {
      throw new BadRequestException('Você não tem permissão para acessar essas estatísticas.');
    }

    const stats = await this.notificationService.getUserNotificationStats(targetUserId);
    return {
      success: true,
      message: 'Estatísticas do usuário carregadas com sucesso.',
      data: stats,
    };
  }
}

@ApiTags('Seen Notifications')
@ApiBearerAuth()
@Controller('seen-notifications')
export class SeenNotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // =====================
  // SeenNotification CRUD Operations
  // =====================

  @Get()
  @ApiOperation({
    summary: 'Get seen notifications',
    description: 'Retrieve a list of notifications that have been marked as seen',
  })
  @ApiResponse({
    status: 200,
    description: 'Seen notifications retrieved successfully',
  })
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
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Mark a specific notification as read/seen by the current user',
  })
  @ApiParam({
    name: 'notificationId',
    description: 'Notification UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 201,
    description: 'Notification marked as read successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async markAsRead(
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @UserId() userId: string,
  ): Promise<SeenNotificationCreateResponse> {
    return this.notificationService.markAsRead(notificationId, userId);
  }
}
