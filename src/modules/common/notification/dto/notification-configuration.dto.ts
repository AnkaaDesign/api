import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsUUID,
  ValidateNested,
  Min,
  Max,
  MaxLength,
  MinLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  SECTOR_PRIVILEGES,
} from '../../../../constants';

// =====================
// Enums for Configuration
// =====================

/**
 * Target type for notification rules
 */
export enum NotificationTargetType {
  ALL_USERS = 'ALL_USERS',
  SPECIFIC_USERS = 'SPECIFIC_USERS',
  SECTORS = 'SECTORS',
  PRIVILEGES = 'PRIVILEGES',
  ROLES = 'ROLES',
  DYNAMIC = 'DYNAMIC',
}

/**
 * Rule operator types
 */
export enum RuleOperator {
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  CONTAINS = 'CONTAINS',
  NOT_CONTAINS = 'NOT_CONTAINS',
  GREATER_THAN = 'GREATER_THAN',
  LESS_THAN = 'LESS_THAN',
  IN = 'IN',
  NOT_IN = 'NOT_IN',
  EXISTS = 'EXISTS',
  NOT_EXISTS = 'NOT_EXISTS',
}

/**
 * Rule condition combinator
 */
export enum RuleCombinator {
  AND = 'AND',
  OR = 'OR',
}

// =====================
// Nested DTOs
// =====================

/**
 * DTO for creating channel-specific configuration
 */
export class CreateChannelConfigDto {
  @ApiProperty({
    description: 'Notification channel',
    enum: NOTIFICATION_CHANNEL,
    example: NOTIFICATION_CHANNEL.IN_APP,
  })
  @IsEnum(NOTIFICATION_CHANNEL)
  channel: NOTIFICATION_CHANNEL;

  @ApiProperty({
    description: 'Whether this channel is enabled for this configuration',
    default: true,
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'Minimum importance level required to send via this channel',
    enum: NOTIFICATION_IMPORTANCE,
    example: NOTIFICATION_IMPORTANCE.NORMAL,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  minImportance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Whether to batch notifications on this channel',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  batchingEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Delay in minutes before sending (for batching)',
    minimum: 0,
    maximum: 1440,
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  delayMinutes?: number;

  @ApiPropertyOptional({
    description: 'Template key to use for this channel',
    example: 'email_task_assigned',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateKey?: string;

  @ApiPropertyOptional({
    description: 'Additional channel-specific settings',
    example: { priority: 'high', category: 'task' },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

/**
 * DTO for creating sector override configuration
 */
export class CreateSectorOverrideDto {
  @ApiProperty({
    description: 'Sector privilege to override for',
    enum: SECTOR_PRIVILEGES,
    example: SECTOR_PRIVILEGES.PRODUCTION,
  })
  @IsEnum(SECTOR_PRIVILEGES)
  sector: SECTOR_PRIVILEGES;

  @ApiPropertyOptional({
    description: 'Override enabled status for this sector',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Override importance level for this sector',
    enum: NOTIFICATION_IMPORTANCE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Override channels for this sector',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Custom templates for this sector',
    example: { title: 'Custom Title for {{sector}}', body: 'Custom body' },
  })
  @IsOptional()
  @IsObject()
  templates?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Additional metadata for this sector override',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * DTO for creating target rules
 */
export class CreateTargetRuleDto {
  @ApiProperty({
    description: 'Target type for notification delivery',
    enum: NotificationTargetType,
    example: NotificationTargetType.SECTORS,
  })
  @IsEnum(NotificationTargetType)
  targetType: NotificationTargetType;

  @ApiPropertyOptional({
    description: 'Specific user IDs (for SPECIFIC_USERS target type)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    description: 'Target sectors (for SECTORS target type)',
    enum: SECTOR_PRIVILEGES,
    isArray: true,
    example: [SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(SECTOR_PRIVILEGES, { each: true })
  sectors?: SECTOR_PRIVILEGES[];

  @ApiPropertyOptional({
    description: 'Target privileges (for PRIVILEGES target type)',
    enum: SECTOR_PRIVILEGES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(SECTOR_PRIVILEGES, { each: true })
  privileges?: SECTOR_PRIVILEGES[];

  @ApiPropertyOptional({
    description: 'Target roles (for ROLES target type)',
    type: [String],
    example: ['MANAGER', 'SUPERVISOR'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiPropertyOptional({
    description: 'Dynamic query expression (for DYNAMIC target type)',
    example: "user.sector.privilege === 'PRODUCTION' && user.isActive",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dynamicQuery?: string;

  @ApiPropertyOptional({
    description: 'Whether to include the triggering user',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeTriggeringUser?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to include sector managers',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeSectorManagers?: boolean;

  @ApiPropertyOptional({
    description: 'User IDs to exclude from targeting',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  excludeUserIds?: string[];
}

/**
 * DTO for creating conditional rules
 */
export class CreateNotificationRuleDto {
  @ApiProperty({
    description: 'Rule name/identifier',
    example: 'high_priority_task_rule',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description: 'Rule description',
    example: 'Send urgent notification for high priority tasks',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Field to evaluate in the context',
    example: 'task.priority',
  })
  @IsString()
  @MaxLength(200)
  field: string;

  @ApiProperty({
    description: 'Comparison operator',
    enum: RuleOperator,
    example: RuleOperator.EQUALS,
  })
  @IsEnum(RuleOperator)
  operator: RuleOperator;

  @ApiProperty({
    description: 'Value to compare against',
    example: 'HIGH',
  })
  value: any;

  @ApiPropertyOptional({
    description: 'Override importance when rule matches',
    enum: NOTIFICATION_IMPORTANCE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  overrideImportance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Override channels when rule matches',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  overrideChannels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Override templates when rule matches',
  })
  @IsOptional()
  @IsObject()
  overrideTemplates?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Whether to skip notification when rule matches',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  skipNotification?: boolean;

  @ApiPropertyOptional({
    description: 'Rule priority (higher = evaluated first)',
    default: 0,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;
}

/**
 * DTO for notification templates
 */
export class NotificationTemplatesDto {
  @ApiProperty({
    description: 'Title template with placeholders',
    example: 'Task {{taskNumber}} has been assigned to you',
  })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({
    description: 'Body template with placeholders',
    example: 'You have been assigned to task {{taskNumber}} by {{assignedBy}}. Priority: {{priority}}',
  })
  @IsString()
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({
    description: 'Email subject template (if different from title)',
    example: '[Action Required] Task {{taskNumber}} Assigned',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  emailSubject?: string;

  @ApiPropertyOptional({
    description: 'Email body template (HTML supported)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  emailBody?: string;

  @ApiPropertyOptional({
    description: 'Push notification title template',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  pushTitle?: string;

  @ApiPropertyOptional({
    description: 'Push notification body template',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pushBody?: string;

  @ApiPropertyOptional({
    description: 'WhatsApp message template',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  whatsappMessage?: string;

  @ApiPropertyOptional({
    description: 'Action URL template',
    example: '/tasks/{{taskId}}',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  actionUrl?: string;

  @ApiPropertyOptional({
    description: 'Action type',
    example: 'NAVIGATE',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  actionType?: string;
}

// =====================
// Main DTOs
// =====================

/**
 * DTO for creating a new notification configuration
 */
export class CreateNotificationConfigurationDto {
  @ApiProperty({
    description: 'Unique key for this configuration',
    example: 'task_assigned',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key: string;

  @ApiPropertyOptional({
    description: 'Human-readable name for this configuration (displayed to users)',
    example: 'Tarefa Atribuída',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    description: 'Notification type',
    enum: NOTIFICATION_TYPE,
    example: NOTIFICATION_TYPE.PRODUCTION,
  })
  @IsEnum(NOTIFICATION_TYPE)
  notificationType: NOTIFICATION_TYPE;

  @ApiProperty({
    description: 'Event type that triggers this notification',
    example: 'assigned',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  eventType: string;

  @ApiPropertyOptional({
    description: 'Human-readable description of this configuration',
    example: 'Notification sent when a task is assigned to a user',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Whether this configuration is enabled',
    default: true,
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description: 'Default importance level',
    enum: NOTIFICATION_IMPORTANCE,
    example: NOTIFICATION_IMPORTANCE.NORMAL,
  })
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Only send during work hours (8am-6pm)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  workHoursOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Enable notification batching',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  batchingEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum notifications per day per user (0 = unlimited)',
    default: 0,
    minimum: 0,
    maximum: 1000,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  maxFrequencyPerDay?: number;

  @ApiPropertyOptional({
    description: 'Deduplication window in minutes (0 = no deduplication)',
    default: 0,
    minimum: 0,
    maximum: 1440,
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  deduplicationWindow?: number;

  @ApiProperty({
    description: 'Notification templates',
    type: NotificationTemplatesDto,
  })
  @ValidateNested()
  @Type(() => NotificationTemplatesDto)
  templates: NotificationTemplatesDto;

  @ApiPropertyOptional({
    description: 'Additional metadata for the configuration',
    example: { category: 'task', subcategory: 'assignment' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty({
    description: 'Channel-specific configurations',
    type: [CreateChannelConfigDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateChannelConfigDto)
  channelConfigs: CreateChannelConfigDto[];

  @ApiPropertyOptional({
    description: 'Sector-specific overrides',
    type: [CreateSectorOverrideDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSectorOverrideDto)
  sectorOverrides?: CreateSectorOverrideDto[];

  @ApiProperty({
    description: 'Target rule for notification delivery',
    type: CreateTargetRuleDto,
  })
  @ValidateNested()
  @Type(() => CreateTargetRuleDto)
  targetRule: CreateTargetRuleDto;

  @ApiPropertyOptional({
    description: 'Conditional rules for notification behavior',
    type: [CreateNotificationRuleDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateNotificationRuleDto)
  rules?: CreateNotificationRuleDto[];
}

/**
 * DTO for updating a notification configuration
 * All fields are optional
 */
export class UpdateNotificationConfigurationDto extends PartialType(
  OmitType(CreateNotificationConfigurationDto, ['key'] as const),
) {}

/**
 * DTO for testing a notification configuration
 */
export class TestNotificationConfigurationDto {
  @ApiProperty({
    description: 'Configuration ID to test',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  configurationId: string;

  @ApiPropertyOptional({
    description: 'Test context data to simulate the notification',
    example: {
      task: { id: '123', taskNumber: 'T-1234', priority: 'HIGH' },
      user: { id: '456', name: 'John Doe' },
    },
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'User ID to send test notification to (defaults to current user)',
  })
  @IsOptional()
  @IsUUID('4')
  targetUserId?: string;

  @ApiPropertyOptional({
    description: 'Channels to test (defaults to all configured channels)',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Whether to actually send the notification or just preview',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/**
 * DTO for dispatching a notification by configuration key
 */
export class DispatchByConfigurationDto {
  @ApiProperty({
    description: 'Configuration key',
    example: 'task_assigned',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key: string;

  @ApiProperty({
    description: 'Context data for template rendering',
    example: {
      task: { id: '123', taskNumber: 'T-1234', priority: 'HIGH' },
      assignedBy: { id: '456', name: 'Jane Smith' },
      assignedTo: { id: '789', name: 'John Doe' },
    },
  })
  @IsObject()
  context: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Override target user IDs (ignores targetRule)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targetUserIds?: string[];

  @ApiPropertyOptional({
    description: 'Override importance level',
    enum: NOTIFICATION_IMPORTANCE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Override channels',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Related entity ID for tracking',
  })
  @IsOptional()
  @IsUUID('4')
  relatedEntityId?: string;

  @ApiPropertyOptional({
    description: 'Related entity type',
    example: 'TASK',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  relatedEntityType?: string;

  @ApiPropertyOptional({
    description: 'Schedule for later delivery (ISO date string)',
    example: '2026-01-10T10:00:00Z',
  })
  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata to include with the notification',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

// =====================
// Response DTOs
// =====================

/**
 * Channel config response DTO
 */
export class ChannelConfigResponseDto {
  @ApiProperty({ description: 'Channel config ID' })
  id: string;

  @ApiProperty({ description: 'Notification channel', enum: NOTIFICATION_CHANNEL })
  channel: NOTIFICATION_CHANNEL;

  @ApiProperty({ description: 'Whether channel is enabled' })
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Minimum importance level', enum: NOTIFICATION_IMPORTANCE })
  minImportance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({ description: 'Whether batching is enabled' })
  batchingEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Delay in minutes' })
  delayMinutes?: number;

  @ApiPropertyOptional({ description: 'Template key' })
  templateKey?: string;

  @ApiPropertyOptional({ description: 'Additional settings' })
  settings?: Record<string, any>;
}

/**
 * Sector override response DTO
 */
export class SectorOverrideResponseDto {
  @ApiProperty({ description: 'Sector override ID' })
  id: string;

  @ApiProperty({ description: 'Sector', enum: SECTOR_PRIVILEGES })
  sector: SECTOR_PRIVILEGES;

  @ApiPropertyOptional({ description: 'Enabled override' })
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Importance override', enum: NOTIFICATION_IMPORTANCE })
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Channel overrides',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  channels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({ description: 'Template overrides' })
  templates?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  metadata?: Record<string, any>;
}

/**
 * Target rule response DTO
 */
export class TargetRuleResponseDto {
  @ApiProperty({ description: 'Target rule ID' })
  id: string;

  @ApiProperty({ description: 'Target type', enum: NotificationTargetType })
  targetType: NotificationTargetType;

  @ApiPropertyOptional({ description: 'User IDs', type: [String] })
  userIds?: string[];

  @ApiPropertyOptional({ description: 'Sectors', enum: SECTOR_PRIVILEGES, isArray: true })
  sectors?: SECTOR_PRIVILEGES[];

  @ApiPropertyOptional({ description: 'Privileges', enum: SECTOR_PRIVILEGES, isArray: true })
  privileges?: SECTOR_PRIVILEGES[];

  @ApiPropertyOptional({ description: 'Roles', type: [String] })
  roles?: string[];

  @ApiPropertyOptional({ description: 'Dynamic query expression' })
  dynamicQuery?: string;

  @ApiPropertyOptional({ description: 'Include triggering user' })
  includeTriggeringUser?: boolean;

  @ApiPropertyOptional({ description: 'Include sector managers' })
  includeSectorManagers?: boolean;

  @ApiPropertyOptional({ description: 'Excluded user IDs', type: [String] })
  excludeUserIds?: string[];
}

/**
 * Notification rule response DTO
 */
export class NotificationRuleResponseDto {
  @ApiProperty({ description: 'Rule ID' })
  id: string;

  @ApiProperty({ description: 'Rule name' })
  name: string;

  @ApiPropertyOptional({ description: 'Rule description' })
  description?: string;

  @ApiProperty({ description: 'Field to evaluate' })
  field: string;

  @ApiProperty({ description: 'Operator', enum: RuleOperator })
  operator: RuleOperator;

  @ApiProperty({ description: 'Value to compare' })
  value: any;

  @ApiPropertyOptional({ description: 'Override importance', enum: NOTIFICATION_IMPORTANCE })
  overrideImportance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Override channels',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  overrideChannels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({ description: 'Override templates' })
  overrideTemplates?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Skip notification' })
  skipNotification?: boolean;

  @ApiPropertyOptional({ description: 'Rule priority' })
  priority?: number;
}

/**
 * Notification configuration response DTO
 */
export class NotificationConfigurationResponseDto {
  @ApiProperty({ description: 'Configuration ID' })
  id: string;

  @ApiProperty({ description: 'Unique configuration key' })
  key: string;

  @ApiPropertyOptional({ description: 'Human-readable name displayed to users' })
  name?: string;

  @ApiProperty({ description: 'Notification type', enum: NOTIFICATION_TYPE })
  notificationType: NOTIFICATION_TYPE;

  @ApiProperty({ description: 'Event type' })
  eventType: string;

  @ApiPropertyOptional({ description: 'Description' })
  description?: string;

  @ApiProperty({ description: 'Whether configuration is enabled' })
  enabled: boolean;

  @ApiProperty({ description: 'Default importance level', enum: NOTIFICATION_IMPORTANCE })
  importance: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({ description: 'Work hours only flag' })
  workHoursOnly?: boolean;

  @ApiPropertyOptional({ description: 'Batching enabled flag' })
  batchingEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Max frequency per day' })
  maxFrequencyPerDay?: number;

  @ApiPropertyOptional({ description: 'Deduplication window in minutes' })
  deduplicationWindow?: number;

  @ApiProperty({ description: 'Notification templates' })
  templates: NotificationTemplatesDto;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  metadata?: Record<string, any>;

  @ApiProperty({
    description: 'Channel configurations',
    type: [ChannelConfigResponseDto],
  })
  channelConfigs: ChannelConfigResponseDto[];

  @ApiPropertyOptional({
    description: 'Sector overrides',
    type: [SectorOverrideResponseDto],
  })
  sectorOverrides?: SectorOverrideResponseDto[];

  @ApiProperty({ description: 'Target rule', type: TargetRuleResponseDto })
  targetRule: TargetRuleResponseDto;

  @ApiPropertyOptional({
    description: 'Conditional rules',
    type: [NotificationRuleResponseDto],
  })
  rules?: NotificationRuleResponseDto[];

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Created by user ID' })
  createdById?: string;

  @ApiPropertyOptional({ description: 'Updated by user ID' })
  updatedById?: string;
}

/**
 * Paginated notification configuration list response DTO
 */
export class NotificationConfigurationListDto {
  @ApiProperty({
    description: 'List of notification configurations',
    type: [NotificationConfigurationResponseDto],
  })
  data: NotificationConfigurationResponseDto[];

  @ApiProperty({ description: 'Total number of configurations' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page' })
  hasNext: boolean;

  @ApiProperty({ description: 'Whether there is a previous page' })
  hasPrev: boolean;
}

/**
 * Test notification result DTO
 */
export class TestNotificationResultDto {
  @ApiProperty({ description: 'Whether test was successful' })
  success: boolean;

  @ApiProperty({ description: 'Result message' })
  message: string;

  @ApiPropertyOptional({ description: 'Preview of rendered notification' })
  preview?: {
    title: string;
    body: string;
    channels: NOTIFICATION_CHANNEL[];
    targetUsers: Array<{ id: string; name: string; email: string }>;
  };

  @ApiPropertyOptional({ description: 'Notification ID if sent' })
  notificationId?: string;

  @ApiPropertyOptional({ description: 'Validation errors if any' })
  validationErrors?: string[];

  @ApiPropertyOptional({ description: 'Rules that matched' })
  matchedRules?: string[];
}

/**
 * Dispatch result DTO
 */
export class DispatchResultDto {
  @ApiProperty({ description: 'Whether dispatch was successful' })
  success: boolean;

  @ApiProperty({ description: 'Result message' })
  message: string;

  @ApiPropertyOptional({ description: 'Number of notifications created' })
  notificationCount?: number;

  @ApiPropertyOptional({ description: 'Created notification IDs' })
  notificationIds?: string[];

  @ApiPropertyOptional({ description: 'Scheduled for (if scheduled)' })
  scheduledAt?: Date;

  @ApiPropertyOptional({ description: 'Target user count' })
  targetUserCount?: number;

  @ApiPropertyOptional({ description: 'Channels used' })
  channels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({ description: 'Any warnings during dispatch' })
  warnings?: string[];
}

/**
 * Configuration filter DTO for querying configurations
 */
export class NotificationConfigurationFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by notification type',
    enum: NOTIFICATION_TYPE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_TYPE)
  notificationType?: NOTIFICATION_TYPE;

  @ApiPropertyOptional({
    description: 'Filter by event type',
    example: 'assigned',
  })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({
    description: 'Filter by enabled status',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Search in key and description',
    example: 'task',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by channel',
    enum: NOTIFICATION_CHANNEL,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_CHANNEL)
  channel?: NOTIFICATION_CHANNEL;

  @ApiPropertyOptional({
    description: 'Filter by importance',
    enum: NOTIFICATION_IMPORTANCE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['key', 'notificationType', 'eventType', 'createdAt', 'updatedAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
