import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserId } from '../auth/decorators/user.decorator';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  UserNotificationPreference,
  UserNotificationPreferenceGetManyResponse,
  UserNotificationPreferenceUpdateResponse,
} from '../../../types';

// DTOs for request validation
export class UpdatePreferenceDto {
  channels: string[];
}

export class BatchUpdatePreferenceDto {
  type: string;
  eventType: string;
  channels: string[];
}

export class BatchUpdatePreferencesDto {
  preferences: BatchUpdatePreferenceDto[];
}

export class ResetPreferencesDto {
  confirm: boolean;
}

@ApiTags('User Notification Preferences')
@ApiBearerAuth()
@Controller('users')
export class NotificationPreferenceController {
  constructor(private readonly preferenceService: NotificationPreferenceService) {}

  // =====================
  // User Notification Preference Endpoints
  // =====================
  // IMPORTANT: Route order matters in NestJS!
  // Specific routes (batch, reset) MUST come BEFORE wildcard routes (:type)

  /**
   * GET /users/:userId/notification-preferences
   * Get all notification preferences for a user
   */
  @Get(':userId/notification-preferences')
  @ApiOperation({
    summary: 'Get user notification preferences',
    description: 'Retrieve all notification preferences for a specific user',
  })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({
    status: 200,
    description: 'Preferences retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getUserPreferences(
    @Param('userId', ParseUUIDPipe) userId: string,
    @UserId() requestingUserId: string,
  ): Promise<UserNotificationPreferenceGetManyResponse> {
    try {
      const preferences = await this.preferenceService.getUserPreferences(userId);

      return {
        success: true,
        data: preferences,
        message: 'Notification preferences retrieved successfully',
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * PUT /users/:userId/notification-preferences/batch
   * Batch update notification preferences for a user
   * NOTE: This route MUST be defined BEFORE the :type route to prevent "batch" being matched as a type
   */
  @Put(':userId/notification-preferences/batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch update notification preferences',
    description: 'Update multiple notification preferences at once',
  })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        preferences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Notification type (e.g., PRODUCTION, STOCK, USER, SYSTEM, GENERAL)' },
              eventType: { type: 'string', description: 'Event type (e.g., status, created)' },
              channels: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      required: ['preferences'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated successfully',
  })
  async batchUpdatePreferences(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: any, // Use any to bypass DTO validation - handle object-with-numeric-keys format
    @UserId() requestingUserId: string,
  ): Promise<{ success: boolean; message: string; data: { updated: number } }> {
    // Handle both array and object-with-numeric-keys formats (browser serialization issue)
    // When axios/browsers serialize arrays, they sometimes convert them to objects like {"0": ..., "1": ...}
    let preferences: any[];
    const rawPreferences = body?.preferences;

    if (Array.isArray(rawPreferences)) {
      preferences = rawPreferences;
    } else if (rawPreferences && typeof rawPreferences === 'object') {
      // Convert object with numeric keys to array
      preferences = Object.values(rawPreferences);
    } else {
      throw new BadRequestException('preferences must be provided');
    }

    try {
      const isAdmin = false; // TODO: Implement admin check
      let updatedCount = 0;

      for (const pref of preferences) {
        if (!pref.type || !pref.eventType) {
          continue; // Skip invalid entries
        }

        // Handle channels that may also be an object with numeric keys
        let channels: string[];
        if (Array.isArray(pref.channels)) {
          channels = pref.channels;
        } else if (pref.channels && typeof pref.channels === 'object') {
          channels = Object.values(pref.channels);
        } else {
          continue; // Skip if no valid channels
        }

        await this.preferenceService.updatePreference(
          userId,
          pref.type,
          pref.eventType,
          channels,
          requestingUserId,
          isAdmin,
        );
        updatedCount++;
      }

      return {
        success: true,
        message: `${updatedCount} notification preferences updated successfully`,
        data: { updated: updatedCount },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * POST /users/:userId/notification-preferences/reset
   * Reset notification preferences to defaults
   * NOTE: This route MUST be defined BEFORE the :type route to prevent "reset" being matched as a type
   */
  @Post(':userId/notification-preferences/reset')
  @HttpCode(HttpStatus.OK)
  async resetPreferences(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: ResetPreferencesDto,
    @UserId() requestingUserId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Validate confirmation
    if (!body.confirm) {
      throw new BadRequestException('You must confirm the reset by setting confirm: true');
    }

    try {
      // Determine if requesting user is admin (you may need to implement this)
      const isAdmin = false; // TODO: Implement admin check

      await this.preferenceService.resetToDefaults(userId, requestingUserId, isAdmin);

      return {
        success: true,
        message: 'Notification preferences reset to defaults successfully',
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * PUT /users/:userId/notification-preferences/:type
   * Update a notification preference for a user
   * Event type is passed as query parameter or in body
   * NOTE: This wildcard route MUST be defined AFTER specific routes (batch, reset)
   */
  @Put(':userId/notification-preferences/:type')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update notification preference',
    description: 'Update notification channel preferences for a specific notification type',
  })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiParam({ name: 'type', description: 'Notification type' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        channels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of notification channels (EMAIL, SMS, PUSH, IN_APP)',
        },
        eventType: {
          type: 'string',
          description: 'Event type for the notification',
        },
      },
      required: ['channels', 'eventType'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Preference updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input',
  })
  async updatePreference(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('type') type: string,
    @Body() body: UpdatePreferenceDto & { eventType?: string },
    @UserId() requestingUserId: string,
  ): Promise<UserNotificationPreferenceUpdateResponse> {
    // Handle channels that may be an object with numeric keys (browser serialization issue)
    let channels: string[];
    if (Array.isArray(body.channels)) {
      channels = body.channels;
    } else if (body.channels && typeof body.channels === 'object') {
      channels = Object.values(body.channels);
    } else {
      throw new BadRequestException('channels must be provided as an array');
    }

    if (!body.eventType) {
      throw new BadRequestException('eventType must be provided in the request body');
    }

    try {
      // Determine if requesting user is admin (you may need to implement this)
      const isAdmin = false; // TODO: Implement admin check

      const updatedPreference = await this.preferenceService.updatePreference(
        userId,
        type,
        body.eventType,
        channels,
        requestingUserId,
        isAdmin,
      );

      return {
        success: true,
        data: updatedPreference,
        message: 'Notification preference updated successfully',
      };
    } catch (error) {
      throw error;
    }
  }
}

@Controller('notification-preferences')
export class NotificationPreferenceDefaultsController {
  constructor(private readonly preferenceService: NotificationPreferenceService) {}

  /**
   * GET /notification-preferences/defaults
   * Get default notification preferences (public endpoint)
   */
  @Get('defaults')
  async getDefaultPreferences(): Promise<{
    success: boolean;
    data: any[];
    message: string;
  }> {
    try {
      const defaults = this.preferenceService.getDefaultPreferences();

      return {
        success: true,
        data: defaults,
        message: 'Default notification preferences retrieved successfully',
      };
    } catch (error) {
      throw error;
    }
  }
}
