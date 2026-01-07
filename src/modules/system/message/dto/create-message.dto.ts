import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsUUID,
  IsDateString,
  ValidateNested,
  IsBoolean,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Message targeting options
 */
export enum MESSAGE_TARGET_TYPE {
  ALL_USERS = 'ALL_USERS',
  SPECIFIC_USERS = 'SPECIFIC_USERS',
  SPECIFIC_ROLES = 'SPECIFIC_ROLES',
}

/**
 * Message priority levels
 */
export enum MESSAGE_PRIORITY {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/**
 * Content block types for rich message content
 */
export enum CONTENT_BLOCK_TYPE {
  TEXT = 'TEXT',
  HEADING = 'HEADING',
  LIST = 'LIST',
  IMAGE = 'IMAGE',
  LINK = 'LINK',
  CALLOUT = 'CALLOUT',
}

/**
 * DTO for content blocks
 */
export class ContentBlockDto {
  @ApiProperty({
    description: 'Type of content block',
    enum: CONTENT_BLOCK_TYPE,
    example: CONTENT_BLOCK_TYPE.TEXT,
  })
  @IsEnum(CONTENT_BLOCK_TYPE)
  type: CONTENT_BLOCK_TYPE;

  @ApiProperty({
    description: 'Content of the block',
    example: 'This is an important announcement',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({
    description: 'Optional metadata for the block (e.g., image URL, link href)',
    example: { url: 'https://example.com/image.jpg' },
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO for creating a new message/announcement
 */
export class CreateMessageDto {
  @ApiProperty({
    description: 'Message title',
    example: 'System Maintenance Notice',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({
    description: 'Message content blocks',
    type: [ContentBlockDto],
    example: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Important Notice',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content: 'The system will be under maintenance on Saturday.',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContentBlockDto)
  contentBlocks: ContentBlockDto[];

  @ApiProperty({
    description: 'Target type for the message',
    enum: MESSAGE_TARGET_TYPE,
    example: MESSAGE_TARGET_TYPE.ALL_USERS,
  })
  @IsEnum(MESSAGE_TARGET_TYPE)
  targetType: MESSAGE_TARGET_TYPE;

  @ApiPropertyOptional({
    description: 'Specific user IDs to target (required if targetType is SPECIFIC_USERS)',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targetUserIds?: string[];

  @ApiPropertyOptional({
    description: 'Specific roles to target (required if targetType is SPECIFIC_ROLES)',
    type: [String],
    example: ['ADMIN', 'PRODUCTION'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetRoles?: string[];

  @ApiPropertyOptional({
    description: 'Message priority level',
    enum: MESSAGE_PRIORITY,
    default: MESSAGE_PRIORITY.NORMAL,
    example: MESSAGE_PRIORITY.HIGH,
  })
  @IsOptional()
  @IsEnum(MESSAGE_PRIORITY)
  priority?: MESSAGE_PRIORITY;

  @ApiPropertyOptional({
    description: 'Whether this message is active and visible',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Start date for message visibility (ISO date string)',
    example: '2026-01-06T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({
    description: 'End date for message visibility (ISO date string)',
    example: '2026-01-13T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({
    description: 'Optional action URL when message is clicked',
    example: '/estoque/produtos',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  actionUrl?: string;

  @ApiPropertyOptional({
    description: 'Optional action button text',
    example: 'View Details',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  actionText?: string;
}
