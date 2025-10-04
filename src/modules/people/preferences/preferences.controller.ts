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
import { PreferencesService } from './preferences.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  preferencesGetManySchema,
  preferencesCreateSchema,
  preferencesUpdateSchema,
  preferencesBatchCreateSchema,
  preferencesBatchUpdateSchema,
  preferencesBatchDeleteSchema,
  preferencesQuerySchema,
} from '../../../schemas/preferences';
import {
  notificationPreferenceGetManySchema,
  notificationPreferenceCreateSchema,
  notificationPreferenceUpdateSchema,
  notificationPreferenceBatchCreateSchema,
  notificationPreferenceBatchUpdateSchema,
  notificationPreferenceBatchDeleteSchema,
  notificationPreferenceQuerySchema,
} from '../../../schemas/notification-preference';
import type {
  PreferencesQueryFormData,
  PreferencesGetManyFormData,
  PreferencesCreateFormData,
  PreferencesUpdateFormData,
  PreferencesBatchCreateFormData,
  PreferencesBatchUpdateFormData,
  PreferencesBatchDeleteFormData,
} from '../../../schemas/preferences';
import type {
  NotificationPreferenceQueryFormData,
  NotificationPreferenceGetManyFormData,
  NotificationPreferenceCreateFormData,
  NotificationPreferenceUpdateFormData,
  NotificationPreferenceBatchCreateFormData,
  NotificationPreferenceBatchUpdateFormData,
  NotificationPreferenceBatchDeleteFormData,
} from '../../../schemas/notification-preference';
import type {
  Preferences,
  PreferencesGetUniqueResponse,
  PreferencesGetManyResponse,
  PreferencesCreateResponse,
  PreferencesUpdateResponse,
  PreferencesDeleteResponse,
  PreferencesBatchCreateResponse,
  PreferencesBatchUpdateResponse,
  PreferencesBatchDeleteResponse,
  NotificationPreference,
  NotificationPreferenceGetUniqueResponse,
  NotificationPreferenceGetManyResponse,
  NotificationPreferenceCreateResponse,
  NotificationPreferenceUpdateResponse,
  NotificationPreferenceDeleteResponse,
  NotificationPreferenceBatchCreateResponse,
  NotificationPreferenceBatchUpdateResponse,
  NotificationPreferenceBatchDeleteResponse,
} from '../../../types';

@Controller('preferences')
export class PreferencesController {
  constructor(
    private readonly preferencesService: PreferencesService,
    private readonly notificationPreferenceService: NotificationPreferenceService,
  ) {}

  /**
   * Create a new preference
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(preferencesCreateSchema)) data: PreferencesCreateFormData,
    @Query(new ZodQueryValidationPipe(preferencesQuerySchema)) query: PreferencesQueryFormData,
    @UserId() userId: string,
  ): Promise<PreferencesCreateResponse> {
    return this.preferencesService.create(data, query.include);
  }

  /**
   * Get many preferences with filters and pagination
   */
  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(preferencesGetManySchema)) query: PreferencesGetManyFormData,
  ): Promise<PreferencesGetManyResponse> {
    return this.preferencesService.findMany(query);
  }

  /**
   * Get preference by ID
   */
  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(preferencesQuerySchema)) query: PreferencesQueryFormData,
  ): Promise<PreferencesGetUniqueResponse> {
    return this.preferencesService.findById(id, query.include);
  }

  /**
   * Update a preference
   */
  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(preferencesUpdateSchema)) data: PreferencesUpdateFormData,
    @Query(new ZodQueryValidationPipe(preferencesQuerySchema)) query: PreferencesQueryFormData,
    @UserId() userId: string,
  ): Promise<PreferencesUpdateResponse> {
    return this.preferencesService.update(id, data, query.include);
  }

  /**
   * Delete a preference
   */
  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PreferencesDeleteResponse> {
    return this.preferencesService.delete(id);
  }

  // /**
  //  * Batch create preferences
  //  */
  // @Post("batch")
  // @HttpCode(HttpStatus.CREATED)
  // @UsePipes(new ZodValidationPipe(preferencesBatchCreateSchema))
  // async batchCreate(
  //   @Body() data: PreferencesBatchCreateFormData,
  //   @Query(new ZodQueryValidationPipe(preferencesQuerySchema)) query: PreferencesQueryFormData
  // ): Promise<PreferencesBatchCreateResponse<Preferences>> {
  //   return this.preferencesService.batchCreate(data.preferences, query.include);
  // }

  // /**
  //  * Batch update preferences
  //  */
  // @Put("batch")
  // @UsePipes(new ZodValidationPipe(preferencesBatchUpdateSchema))
  // async batchUpdate(
  //   @Body() data: PreferencesBatchUpdateFormData,
  //   @Query(new ZodQueryValidationPipe(preferencesQuerySchema)) query: PreferencesQueryFormData
  // ): Promise<PreferencesBatchUpdateResponse<Preferences>> {
  //   return this.preferencesService.batchUpdate(data.preferences, query.include);
  // }

  // /**
  //  * Batch delete preferences
  //  */
  // @Delete("batch")
  // @HttpCode(HttpStatus.OK)
  // @UsePipes(new ZodValidationPipe(preferencesBatchDeleteSchema))
  // async batchDelete(
  //   @Body() data: PreferencesBatchDeleteFormData,
  //   @Query(new ZodQueryValidationPipe(preferencesQuerySchema)) query: PreferencesQueryFormData
  // ): Promise<PreferencesBatchDeleteResponse> {
  //   return this.preferencesService.batchDelete(data.preferenceIds, query.include);
  // }

  // =====================
  // Notification Preference endpoints
  // =====================

  /**
   * Create a new notification preference
   */
  @Post('notification-preferences')
  @HttpCode(HttpStatus.CREATED)
  async createNotificationPreference(
    @Body(new ZodValidationPipe(notificationPreferenceCreateSchema))
    data: NotificationPreferenceCreateFormData,
    @Query(new ZodQueryValidationPipe(notificationPreferenceQuerySchema))
    query: NotificationPreferenceQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationPreferenceCreateResponse> {
    const notificationPreference = await this.notificationPreferenceService.create(
      data,
      userId,
      query.include,
    );
    return {
      success: true,
      message: 'Preferência de notificação criada com sucesso',
      data: notificationPreference,
    };
  }

  /**
   * Get many notification preferences with filters and pagination
   */
  @Get('notification-preferences')
  async findManyNotificationPreferences(
    @Query(new ZodQueryValidationPipe(notificationPreferenceGetManySchema))
    query: NotificationPreferenceGetManyFormData,
  ): Promise<NotificationPreferenceGetManyResponse> {
    const { page = 1, limit = 20, where, include, orderBy } = query;
    const skip = (page - 1) * limit;

    const [data, totalRecords] = await Promise.all([
      this.notificationPreferenceService.findMany({
        where,
        include,
        orderBy,
        skip,
        take: limit,
      }),
      this.notificationPreferenceService.findMany({ where }).then(results => results.length),
    ]);

    return {
      success: true,
      message: 'Preferências de notificação listadas com sucesso',
      data,
      meta: {
        totalRecords,
        page,
        take: limit,
        totalPages: Math.ceil(totalRecords / limit),
        hasNextPage: skip + data.length < totalRecords,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Get notification preferences by preferences ID
   */
  @Get(':id/notification-preferences')
  async findNotificationPreferencesByPreferencesId(
    @Param('id', ParseUUIDPipe) preferencesId: string,
    @Query(new ZodQueryValidationPipe(notificationPreferenceQuerySchema))
    query: NotificationPreferenceQueryFormData,
  ): Promise<NotificationPreferenceGetManyResponse> {
    const data = await this.notificationPreferenceService.findByPreferencesId(
      preferencesId,
      query.include,
    );
    return {
      success: true,
      message: 'Preferências de notificação listadas com sucesso',
      data,
      meta: {
        totalRecords: data.length,
        page: 1,
        take: data.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }

  /**
   * Get notification preference by ID
   */
  @Get('notification-preferences/:id')
  async findNotificationPreferenceById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(notificationPreferenceQuerySchema))
    query: NotificationPreferenceQueryFormData,
  ): Promise<NotificationPreferenceGetUniqueResponse> {
    const notificationPreference = await this.notificationPreferenceService.findById(
      id,
      query.include,
    );
    return {
      success: true,
      message: 'Preferência de notificação encontrada com sucesso',
      data: notificationPreference,
    };
  }

  /**
   * Update a notification preference
   */
  @Put('notification-preferences/:id')
  async updateNotificationPreference(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(notificationPreferenceUpdateSchema))
    data: NotificationPreferenceUpdateFormData,
    @Query(new ZodQueryValidationPipe(notificationPreferenceQuerySchema))
    query: NotificationPreferenceQueryFormData,
    @UserId() userId: string,
  ): Promise<NotificationPreferenceUpdateResponse> {
    const notificationPreference = await this.notificationPreferenceService.update(
      id,
      data,
      userId,
      query.include,
    );
    return {
      success: true,
      message: 'Preferência de notificação atualizada com sucesso',
      data: notificationPreference,
    };
  }

  /**
   * Delete a notification preference
   */
  @Delete('notification-preferences/:id')
  async deleteNotificationPreference(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<NotificationPreferenceDeleteResponse> {
    await this.notificationPreferenceService.delete(id, userId);
    return {
      success: true,
      message: 'Preferência de notificação excluída com sucesso',
    };
  }

  /**
   * Initialize default notification preferences for a user
   */
  @Post(':id/notification-preferences/initialize')
  @HttpCode(HttpStatus.CREATED)
  async initializeNotificationPreferences(
    @Param('id', ParseUUIDPipe) preferencesId: string,
    @UserId() userId: string,
  ): Promise<NotificationPreferenceGetManyResponse> {
    const data = await this.notificationPreferenceService.initializeDefaultPreferences(
      preferencesId,
      userId,
    );
    return {
      success: true,
      message: `${data.length} preferências de notificação inicializadas com sucesso`,
      data,
      meta: {
        totalRecords: data.length,
        page: 1,
        take: data.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }

  /**
   * Batch create notification preferences
   */
  @Post('notification-preferences/batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreateNotificationPreferences(
    @Body(new ZodValidationPipe(notificationPreferenceBatchCreateSchema))
    data: NotificationPreferenceBatchCreateFormData,
    @UserId() userId: string,
  ): Promise<NotificationPreferenceBatchCreateResponse<NotificationPreference>> {
    const result = await this.notificationPreferenceService.batchCreate(
      data.notificationPreferences,
      userId,
    );
    return {
      success: true,
      message: `${result.created} preferências de notificação criadas com sucesso`,
      data: {
        success: [],
        failed: [],
        totalProcessed: result.created,
        totalSuccess: result.created,
        totalFailed: 0,
      },
    };
  }

  /**
   * Batch update notification preferences
   */
  @Put('notification-preferences/batch')
  async batchUpdateNotificationPreferences(
    @Body(new ZodValidationPipe(notificationPreferenceBatchUpdateSchema))
    data: NotificationPreferenceBatchUpdateFormData,
    @UserId() userId: string,
  ): Promise<NotificationPreferenceBatchUpdateResponse<NotificationPreference>> {
    // Ensure all items have required id and data fields
    const validatedItems = data.notificationPreferences.map(item => ({
      id: item.id!,
      data: item.data!,
    }));
    const results = await this.notificationPreferenceService.batchUpdate(validatedItems, userId);
    return {
      success: true,
      message: `${results.length} preferências de notificação atualizadas com sucesso`,
      data: {
        success: results,
        failed: [],
        totalProcessed: results.length,
        totalSuccess: results.length,
        totalFailed: 0,
      },
    };
  }

  /**
   * Batch delete notification preferences
   */
  @Delete('notification-preferences/batch')
  @HttpCode(HttpStatus.OK)
  async batchDeleteNotificationPreferences(
    @Body(new ZodValidationPipe(notificationPreferenceBatchDeleteSchema))
    data: NotificationPreferenceBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<NotificationPreferenceBatchDeleteResponse> {
    const result = await this.notificationPreferenceService.batchDelete(
      data.notificationPreferenceIds,
      userId,
    );
    return {
      success: true,
      message: `${result.deleted} preferências de notificação excluídas com sucesso`,
      data: {
        success: data.notificationPreferenceIds.map(id => ({ id, deleted: true })),
        failed: [],
        totalSuccess: result.deleted,
        totalFailed: 0,
        totalProcessed: result.deleted,
      },
    };
  }
}
