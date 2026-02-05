import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IsArray, IsEnum } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { UserId, User, UserPayload } from '../auth/decorators/user.decorator';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationConfigurationRepository } from './repositories/notification-configuration.repository';
import { NOTIFICATION_CHANNEL, NOTIFICATION_TYPE, SECTOR_PRIVILEGES } from '../../../constants';

// =====================
// DTOs
// =====================

/**
 * DTO for updating user's channel preferences for a configuration
 */
export class UpdateUserPreferenceDto {
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels: NOTIFICATION_CHANNEL[];
}

// =====================
// Response Interfaces
// =====================

/**
 * Channel detail in preference response
 */
export interface ChannelPreferenceDetail {
  channel: NOTIFICATION_CHANNEL;
  enabled: boolean;
  mandatory: boolean;
  defaultOn: boolean;
  userEnabled: boolean;
}

/**
 * User preference response shape
 */
export interface UserPreferenceResponse {
  configKey: string;
  description: string;
  importance: string;
  channels: ChannelPreferenceDetail[];
}

/**
 * Configuration grouped by notification type
 */
export interface GroupedConfiguration {
  notificationType: NOTIFICATION_TYPE;
  configurations: UserPreferenceResponse[];
}

// =====================
// Controller
// =====================

/**
 * User-facing notification preference controller
 * Allows users to manage their own notification preferences
 */
@ApiTags('User Notification Preferences')
@ApiBearerAuth()
@Controller('api/notifications/preferences')
@UseGuards(AuthGuard)
export class NotificationUserPreferenceController {
  private readonly logger = new Logger(NotificationUserPreferenceController.name);

  constructor(
    private readonly preferenceService: NotificationPreferenceService,
    private readonly configurationRepository: NotificationConfigurationRepository,
  ) {}

  // =====================
  // User Preference Endpoints
  // =====================

  /**
   * GET /api/notifications/preferences/my-preferences
   * Get all notification configurations with user's preferences
   */
  @Get('my-preferences')
  @ApiOperation({
    summary: 'Get all user preferences',
    description:
      "Retrieve all notification configurations with the current user's channel preferences",
  })
  @ApiResponse({
    status: 200,
    description: 'User preferences retrieved successfully',
  })
  async getMyPreferences(
    @UserId() userId: string,
  ): Promise<{ success: boolean; data: UserPreferenceResponse[]; message: string }> {
    try {
      this.logger.log(`Getting all preferences for user ${userId}`);

      // Get all enabled configurations
      const configurations = await this.configurationRepository.findEnabled();

      // Get user's preferences
      const userPreferences = await this.preferenceService.getUserPreferences(userId);

      // Build response with user's preferences merged with configurations
      const preferences: UserPreferenceResponse[] = configurations.map(config => {
        // Find user's preference for this configuration
        const userPref = userPreferences.find(
          p => p.notificationType === config.notificationType && p.eventType === config.eventType,
        );

        // Get channel configurations
        const channelDetails: ChannelPreferenceDetail[] = Object.values(NOTIFICATION_CHANNEL).map(
          channel => {
            const channelConfig = config.channelConfigs?.find(cc => cc.channel === channel);
            const isEnabled = channelConfig?.enabled ?? config.defaultChannels.includes(channel);
            const isMandatory = userPref?.mandatoryChannels?.includes(channel) ?? false;
            const isDefaultOn = config.defaultChannels.includes(channel);
            const userEnabled = userPref?.channels?.includes(channel) ?? isDefaultOn;

            return {
              channel,
              enabled: isEnabled,
              mandatory: isMandatory,
              defaultOn: isDefaultOn,
              userEnabled,
            };
          },
        );

        return {
          configKey: config.key,
          description: config.description || config.title,
          importance: config.defaultImportance,
          channels: channelDetails,
        };
      });

      return {
        success: true,
        data: preferences,
        message: 'User preferences retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to get preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * GET /api/notifications/preferences/my-preferences/:configKey
   * Get user's preference for a specific configuration
   */
  @Get('my-preferences/:configKey')
  @ApiOperation({
    summary: 'Get preference for specific configuration',
    description:
      "Retrieve user's preference for a specific notification configuration, showing available channels, mandatory flags, and user selections",
  })
  @ApiParam({
    name: 'configKey',
    description: 'The unique configuration key',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Preference retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Configuration not found',
  })
  async getPreferenceForConfig(
    @UserId() userId: string,
    @Param('configKey') configKey: string,
  ): Promise<{ success: boolean; data: UserPreferenceResponse; message: string }> {
    try {
      this.logger.log(`Getting preference for config ${configKey} for user ${userId}`);

      // Get the configuration
      const config = await this.configurationRepository.findByKey(configKey);
      if (!config) {
        throw new NotFoundException(`Configuration with key '${configKey}' not found`);
      }

      // Get user's preferences
      const userPreferences = await this.preferenceService.getUserPreferences(userId);

      // Find user's preference for this configuration
      const userPref = userPreferences.find(
        p => p.notificationType === config.notificationType && p.eventType === config.eventType,
      );

      // Build channel details
      const channelDetails: ChannelPreferenceDetail[] = Object.values(NOTIFICATION_CHANNEL).map(
        channel => {
          const channelConfig = config.channelConfigs?.find(cc => cc.channel === channel);
          const isEnabled = channelConfig?.enabled ?? config.defaultChannels.includes(channel);
          const isMandatory = userPref?.mandatoryChannels?.includes(channel) ?? false;
          const isDefaultOn = config.defaultChannels.includes(channel);
          const userEnabled = userPref?.channels?.includes(channel) ?? isDefaultOn;

          return {
            channel,
            enabled: isEnabled,
            mandatory: isMandatory,
            defaultOn: isDefaultOn,
            userEnabled,
          };
        },
      );

      const preference: UserPreferenceResponse = {
        configKey: config.key,
        description: config.description || config.title,
        importance: config.defaultImportance,
        channels: channelDetails,
      };

      return {
        success: true,
        data: preference,
        message: 'Preference retrieved successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to get preference for config ${configKey} for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * PUT /api/notifications/preferences/my-preferences/:configKey
   * Update user's channel preferences for a configuration
   */
  @Put('my-preferences/:configKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update preference for configuration',
    description:
      "Update user's channel preferences for a specific notification configuration. Cannot disable mandatory channels.",
  })
  @ApiParam({
    name: 'configKey',
    description: 'The unique configuration key',
    type: 'string',
  })
  @ApiBody({
    type: UpdateUserPreferenceDto,
    description: 'The channels to enable for this notification configuration',
  })
  @ApiResponse({
    status: 200,
    description: 'Preference updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - cannot disable mandatory channels',
  })
  @ApiResponse({
    status: 404,
    description: 'Configuration not found',
  })
  async updatePreference(
    @UserId() userId: string,
    @Param('configKey') configKey: string,
    @Body() dto: UpdateUserPreferenceDto,
  ): Promise<{ success: boolean; data: UserPreferenceResponse; message: string }> {
    try {
      this.logger.log(`Updating preference for config ${configKey} for user ${userId}`, {
        channels: dto.channels,
      });

      // Get the configuration
      const config = await this.configurationRepository.findByKey(configKey);
      if (!config) {
        throw new NotFoundException(`Configuration with key '${configKey}' not found`);
      }

      // Check if configuration allows user override
      if (!config.allowUserOverride) {
        throw new BadRequestException(
          `Configuration '${configKey}' does not allow user preferences to be modified`,
        );
      }

      // Get user's current preferences to check mandatory channels
      const userPreferences = await this.preferenceService.getUserPreferences(userId);
      const currentPref = userPreferences.find(
        p => p.notificationType === config.notificationType && p.eventType === config.eventType,
      );

      // Validate mandatory channels are not disabled
      const mandatoryChannels = currentPref?.mandatoryChannels || [];
      const missingMandatory = mandatoryChannels.filter(
        channel => !dto.channels.includes(channel as NOTIFICATION_CHANNEL),
      );

      if (missingMandatory.length > 0) {
        throw new BadRequestException(
          `Cannot disable mandatory channels: ${missingMandatory.join(', ')}. These channels are required for this notification type.`,
        );
      }

      // Update the preference
      await this.preferenceService.updatePreference(
        userId,
        config.notificationType,
        config.eventType || '',
        dto.channels as string[],
        userId, // requestingUserId is the same as userId for user-facing endpoint
        false, // isAdmin
      );

      // Return the updated preference
      const updatedPreferences = await this.preferenceService.getUserPreferences(userId);
      const updatedPref = updatedPreferences.find(
        p => p.notificationType === config.notificationType && p.eventType === config.eventType,
      );

      // Build channel details for response
      const channelDetails: ChannelPreferenceDetail[] = Object.values(NOTIFICATION_CHANNEL).map(
        channel => {
          const channelConfig = config.channelConfigs?.find(cc => cc.channel === channel);
          const isEnabled = channelConfig?.enabled ?? config.defaultChannels.includes(channel);
          const isMandatory = updatedPref?.mandatoryChannels?.includes(channel) ?? false;
          const isDefaultOn = config.defaultChannels.includes(channel);
          const userEnabled = updatedPref?.channels?.includes(channel) ?? isDefaultOn;

          return {
            channel,
            enabled: isEnabled,
            mandatory: isMandatory,
            defaultOn: isDefaultOn,
            userEnabled,
          };
        },
      );

      const preference: UserPreferenceResponse = {
        configKey: config.key,
        description: config.description || config.title,
        importance: config.defaultImportance,
        channels: channelDetails,
      };

      return {
        success: true,
        data: preference,
        message: 'Preference updated successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to update preference for config ${configKey} for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * POST /api/notifications/preferences/my-preferences/:configKey/reset
   * Reset user's preference to default values
   */
  @Post('my-preferences/:configKey/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset preference to default',
    description:
      "Reset user's channel preferences for a specific configuration to the default values (defaultOn)",
  })
  @ApiParam({
    name: 'configKey',
    description: 'The unique configuration key',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Preference reset to defaults successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Configuration not found',
  })
  async resetPreference(
    @UserId() userId: string,
    @Param('configKey') configKey: string,
  ): Promise<{ success: boolean; data: UserPreferenceResponse; message: string }> {
    try {
      this.logger.log(`Resetting preference for config ${configKey} for user ${userId}`);

      // Get the configuration
      const config = await this.configurationRepository.findByKey(configKey);
      if (!config) {
        throw new NotFoundException(`Configuration with key '${configKey}' not found`);
      }

      // Reset to default channels
      const defaultChannels = config.defaultChannels;

      // Update the preference to default values
      await this.preferenceService.updatePreference(
        userId,
        config.notificationType,
        config.eventType || '',
        defaultChannels as string[],
        userId,
        false,
      );

      // Return the reset preference
      const updatedPreferences = await this.preferenceService.getUserPreferences(userId);
      const updatedPref = updatedPreferences.find(
        p => p.notificationType === config.notificationType && p.eventType === config.eventType,
      );

      // Build channel details for response
      const channelDetails: ChannelPreferenceDetail[] = Object.values(NOTIFICATION_CHANNEL).map(
        channel => {
          const channelConfig = config.channelConfigs?.find(cc => cc.channel === channel);
          const isEnabled = channelConfig?.enabled ?? config.defaultChannels.includes(channel);
          const isMandatory = updatedPref?.mandatoryChannels?.includes(channel) ?? false;
          const isDefaultOn = config.defaultChannels.includes(channel);
          const userEnabled = updatedPref?.channels?.includes(channel) ?? isDefaultOn;

          return {
            channel,
            enabled: isEnabled,
            mandatory: isMandatory,
            defaultOn: isDefaultOn,
            userEnabled,
          };
        },
      );

      const preference: UserPreferenceResponse = {
        configKey: config.key,
        description: config.description || config.title,
        importance: config.defaultImportance,
        channels: channelDetails,
      };

      return {
        success: true,
        data: preference,
        message: 'Preference reset to defaults successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to reset preference for config ${configKey} for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * GET /api/notifications/preferences/available-configurations
   * Get all configurations available to the user based on their sector
   */
  @Get('available-configurations')
  @ApiOperation({
    summary: 'Get available configurations',
    description:
      'Retrieve all notification configurations available to the current user based on their sector, grouped by notification type',
  })
  @ApiResponse({
    status: 200,
    description: 'Available configurations retrieved successfully',
  })
  async getAvailableConfigurations(
    @UserId() userId: string,
    @User() user: UserPayload,
  ): Promise<{ success: boolean; data: GroupedConfiguration[]; message: string }> {
    try {
      this.logger.log(`Getting available configurations for user ${userId}`);

      // Get user's sector/role from user payload
      // The role field contains the user's sector privilege level
      const userSector = user.role as SECTOR_PRIVILEGES | undefined;

      // Get configurations based on user's sector
      let configurations;
      if (userSector && Object.values(SECTOR_PRIVILEGES).includes(userSector)) {
        configurations = await this.configurationRepository.findBySector(userSector);
      } else {
        // Fall back to all enabled configurations if sector is not available or invalid
        configurations = await this.configurationRepository.findEnabled();
      }

      // Get user's preferences
      const userPreferences = await this.preferenceService.getUserPreferences(userId);

      // Group configurations by notification type
      const grouped = new Map<NOTIFICATION_TYPE, UserPreferenceResponse[]>();

      for (const config of configurations) {
        // Find user's preference for this configuration
        const userPref = userPreferences.find(
          p => p.notificationType === config.notificationType && p.eventType === config.eventType,
        );

        // Build channel details
        const channelDetails: ChannelPreferenceDetail[] = Object.values(NOTIFICATION_CHANNEL).map(
          channel => {
            const channelConfig = config.channelConfigs?.find(cc => cc.channel === channel);
            const isEnabled = channelConfig?.enabled ?? config.defaultChannels.includes(channel);
            const isMandatory = userPref?.mandatoryChannels?.includes(channel) ?? false;
            const isDefaultOn = config.defaultChannels.includes(channel);
            const userEnabled = userPref?.channels?.includes(channel) ?? isDefaultOn;

            return {
              channel,
              enabled: isEnabled,
              mandatory: isMandatory,
              defaultOn: isDefaultOn,
              userEnabled,
            };
          },
        );

        const preference: UserPreferenceResponse = {
          configKey: config.key,
          description: config.description || config.title,
          importance: config.defaultImportance,
          channels: channelDetails,
        };

        const existing = grouped.get(config.notificationType) || [];
        existing.push(preference);
        grouped.set(config.notificationType, existing);
      }

      // Convert map to array
      const result: GroupedConfiguration[] = [];
      for (const [notificationType, configs] of grouped) {
        result.push({
          notificationType,
          configurations: configs,
        });
      }

      // Sort by notification type
      result.sort((a, b) => a.notificationType.localeCompare(b.notificationType));

      return {
        success: true,
        data: result,
        message: 'Available configurations retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to get available configurations for user ${userId}`, error);
      throw error;
    }
  }
}
