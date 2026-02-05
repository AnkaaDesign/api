import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  IsDateString,
  IsBoolean,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Content block types for rich message content
 * These are the supported types, but the actual blocks are stored as flexible JSON
 */
export enum CONTENT_BLOCK_TYPE {
  TEXT = 'TEXT',
  HEADING = 'HEADING',
  HEADING1 = 'heading1',
  HEADING2 = 'heading2',
  HEADING3 = 'heading3',
  PARAGRAPH = 'paragraph',
  LIST = 'LIST',
  IMAGE = 'IMAGE',
  LINK = 'LINK',
  BUTTON = 'button',
  DIVIDER = 'divider',
  QUOTE = 'quote',
  CALLOUT = 'CALLOUT',
}

/**
 * DTO for content blocks
 * Using flexible validation to support rich content blocks from the frontend
 */
export class ContentBlockDto {
  @ApiProperty({
    description: 'Unique identifier for the block',
    example: 'block-123',
  })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Type of content block',
    example: 'paragraph',
  })
  @IsString()
  type: string;

  // Allow any additional properties for flexibility
  [key: string]: any;
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
        id: 'block-1',
        type: 'heading1',
        content: 'Important Notice',
      },
      {
        id: 'block-2',
        type: 'paragraph',
        content: 'The system will be under maintenance on Saturday.',
      },
    ],
  })
  @IsArray()
  @Type(() => Object) // Keep objects as-is, don't transform nested structures
  // We validate blocks manually in the service layer for flexibility
  contentBlocks: any[];

  @ApiPropertyOptional({
    description:
      'Array of target user IDs. Empty array = all users. Frontend should resolve sectors/positions to user IDs before sending.',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440001'],
    default: [],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targets?: string[];

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
}
