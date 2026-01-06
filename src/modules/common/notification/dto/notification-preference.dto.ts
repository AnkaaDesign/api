import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
} from '../../../../constants';

/**
 * DTO for updating a single notification preference
 */
export class UpdateNotificationPreferenceDto {
  @ApiProperty({
    description: 'Notification type to update preference for',
    enum: NOTIFICATION_TYPE,
    example: NOTIFICATION_TYPE.TASK,
  })
  @IsEnum(NOTIFICATION_TYPE)
  notificationType: NOTIFICATION_TYPE;

  @ApiPropertyOptional({
    description: 'Event type within the notification type (e.g., "status" for TASK, "created" for ORDER)',
    example: 'status',
  })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiProperty({
    description: 'Whether this notification type is enabled',
    default: true,
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description: 'Channels to receive this notification type',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
    example: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  })
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels: NOTIFICATION_CHANNEL[];
}

/**
 * DTO for bulk updating notification preferences
 */
export class BulkUpdateNotificationPreferencesDto {
  @ApiProperty({
    description: 'Array of preferences to update',
    type: [UpdateNotificationPreferenceDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationPreferenceDto)
  preferences: UpdateNotificationPreferenceDto[];
}

/**
 * DTO for updating global notification settings
 */
export class UpdateGlobalNotificationSettingsDto {
  @ApiPropertyOptional({
    description: 'Enable all notifications globally',
  })
  @IsOptional()
  @IsBoolean()
  enableAll?: boolean;

  @ApiPropertyOptional({
    description: 'Enable Do Not Disturb mode',
  })
  @IsOptional()
  @IsBoolean()
  doNotDisturb?: boolean;

  @ApiPropertyOptional({
    description: 'Do Not Disturb start time (HH:mm format)',
    example: '22:00',
  })
  @IsOptional()
  @IsString()
  dndStartTime?: string;

  @ApiPropertyOptional({
    description: 'Do Not Disturb end time (HH:mm format)',
    example: '08:00',
  })
  @IsOptional()
  @IsString()
  dndEndTime?: string;

  @ApiPropertyOptional({
    description: 'Enable email digest',
  })
  @IsOptional()
  @IsBoolean()
  emailDigest?: boolean;

  @ApiPropertyOptional({
    description: 'Email digest frequency',
    enum: ['daily', 'weekly', 'never'],
    example: 'daily',
  })
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'never'])
  emailDigestFrequency?: 'daily' | 'weekly' | 'never';

  @ApiPropertyOptional({
    description: 'Enable sound for notifications',
  })
  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Enable desktop notifications',
  })
  @IsOptional()
  @IsBoolean()
  desktopEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Enable mobile push notifications',
  })
  @IsOptional()
  @IsBoolean()
  mobileEnabled?: boolean;
}

/**
 * DTO for channel-specific preferences
 */
export class UpdateChannelPreferencesDto {
  @ApiProperty({
    description: 'Channel to update preferences for',
    enum: NOTIFICATION_CHANNEL,
    example: NOTIFICATION_CHANNEL.EMAIL,
  })
  @IsEnum(NOTIFICATION_CHANNEL)
  channel: NOTIFICATION_CHANNEL;

  @ApiProperty({
    description: 'Whether this channel is enabled',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'Minimum importance level for this channel',
    enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
    example: 'NORMAL',
  })
  @IsOptional()
  @IsEnum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  minImportance?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

/**
 * DTO for enabling/disabling specific notification types
 */
export class ToggleNotificationTypeDto {
  @ApiProperty({
    description: 'Notification types to enable or disable',
    enum: NOTIFICATION_TYPE,
    isArray: true,
    example: [NOTIFICATION_TYPE.TASK, NOTIFICATION_TYPE.ORDER],
  })
  @IsArray()
  @IsEnum(NOTIFICATION_TYPE, { each: true })
  notificationTypes: NOTIFICATION_TYPE[];

  @ApiProperty({
    description: 'Whether to enable (true) or disable (false) the notification types',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;
}

/**
 * DTO for importing/exporting preferences
 */
export class NotificationPreferencesExportDto {
  @ApiProperty({
    description: 'User notification preferences',
  })
  preferences: UpdateNotificationPreferenceDto[];

  @ApiPropertyOptional({
    description: 'Global notification settings',
  })
  @IsOptional()
  globalSettings?: UpdateGlobalNotificationSettingsDto;

  @ApiPropertyOptional({
    description: 'Channel-specific preferences',
  })
  @IsOptional()
  channelPreferences?: UpdateChannelPreferencesDto[];
}

/**
 * DTO for resetting preferences to defaults
 */
export class ResetPreferencesDto {
  @ApiPropertyOptional({
    description: 'Reset only specific notification types (leave empty to reset all)',
    enum: NOTIFICATION_TYPE,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_TYPE, { each: true })
  notificationTypes?: NOTIFICATION_TYPE[];

  @ApiPropertyOptional({
    description: 'Reset global settings',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  resetGlobal?: boolean;

  @ApiPropertyOptional({
    description: 'Reset channel preferences',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  resetChannels?: boolean;
}
