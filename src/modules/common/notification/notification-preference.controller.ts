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
   * PUT /users/:userId/notification-preferences/:type
   * Update a notification preference for a user
   * Event type is passed as query parameter or in body
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
    // Validate request body
    if (!body.channels || !Array.isArray(body.channels)) {
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
        body.channels,
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

  /**
   * POST /users/:userId/notification-preferences/reset
   * Reset notification preferences to defaults
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
