import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsBoolean,
  IsDateString,
  IsUUID,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';

/**
 * DTO for creating a new notification
 */
export class CreateNotificationDto {
  @ApiProperty({
    description: 'User ID to send notification to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  userId: string;

  @ApiProperty({
    description: 'Notification title',
    example: 'New Task Assigned',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Notification body/content',
    example: 'You have been assigned to Task #1234',
  })
  @IsString()
  body: string;

  @ApiProperty({
    description: 'Notification type',
    enum: NOTIFICATION_TYPE,
    example: NOTIFICATION_TYPE.TASK,
  })
  @IsEnum(NOTIFICATION_TYPE)
  type: NOTIFICATION_TYPE;

  @ApiProperty({
    description: 'Channels to send notification through',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
    example: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  })
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Notification importance level',
    enum: NOTIFICATION_IMPORTANCE,
    default: NOTIFICATION_IMPORTANCE.NORMAL,
    example: NOTIFICATION_IMPORTANCE.HIGH,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Action URL for the notification',
    example: '/tasks/1234',
  })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({
    description: 'Action type for the notification',
    example: 'NAVIGATE',
  })
  @IsOptional()
  @IsString()
  actionType?: string;

  @ApiPropertyOptional({
    description: 'Schedule notification for later (ISO date string)',
    example: '2026-01-10T10:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description: 'Related entity ID (e.g., task ID, order ID)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID('4')
  relatedEntityId?: string;

  @ApiPropertyOptional({
    description: 'Related entity type (e.g., TASK, ORDER)',
    example: 'TASK',
  })
  @IsOptional()
  @IsString()
  relatedEntityType?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the notification',
    example: { taskNumber: 'T-1234', priority: 'high' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether this notification is mandatory (cannot be disabled)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Expiration date for the notification (ISO date string)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/**
 * DTO for bulk creating notifications
 */
export class BulkCreateNotificationDto {
  @ApiProperty({
    description: 'User IDs to send notification to',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];

  @ApiProperty({
    description: 'Notification title',
    example: 'System Maintenance Notice',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Notification body/content',
    example: 'System maintenance scheduled for tonight',
  })
  @IsString()
  body: string;

  @ApiProperty({
    description: 'Notification type',
    enum: NOTIFICATION_TYPE,
    example: NOTIFICATION_TYPE.SYSTEM,
  })
  @IsEnum(NOTIFICATION_TYPE)
  type: NOTIFICATION_TYPE;

  @ApiProperty({
    description: 'Channels to send notification through',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
    example: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
  })
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Notification importance level',
    enum: NOTIFICATION_IMPORTANCE,
    default: NOTIFICATION_IMPORTANCE.NORMAL,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Action URL for the notification',
  })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({
    description: 'Schedule notification for later (ISO date string)',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the notification',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether this notification is mandatory',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}

/**
 * DTO for creating notifications with sector targeting
 */
export class CreateSectorNotificationDto {
  @ApiProperty({
    description: 'Target sectors',
    type: [String],
    example: ['PRODUCTION', 'LOGISTICS'],
  })
  @IsArray()
  @IsString({ each: true })
  targetSectors: string[];

  @ApiProperty({
    description: 'Notification title',
    example: 'Department Announcement',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Notification body/content',
    example: 'New policy update for all sectors',
  })
  @IsString()
  body: string;

  @ApiProperty({
    description: 'Notification type',
    enum: NOTIFICATION_TYPE,
    example: NOTIFICATION_TYPE.GENERAL,
  })
  @IsEnum(NOTIFICATION_TYPE)
  type: NOTIFICATION_TYPE;

  @ApiProperty({
    description: 'Channels to send notification through',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
    example: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
  })
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Notification importance level',
    enum: NOTIFICATION_IMPORTANCE,
    default: NOTIFICATION_IMPORTANCE.NORMAL,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Action URL for the notification',
  })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({
    description: 'Schedule notification for later (ISO date string)',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description: 'Whether this notification is mandatory',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}
