import { IsOptional, IsEnum, IsBoolean, IsDateString, IsInt, IsArray, IsString, IsUUID, Min, Max, ValidateNested } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Nested createdAt range filter (gte/lte ISO strings) sent by the web list filter.
 */
export class MessageCreatedAtFilterDto {
  @IsOptional()
  @IsDateString()
  gte?: string;

  @IsOptional()
  @IsDateString()
  lte?: string;
}

/**
 * DTO for filtering and querying messages
 */
export class FilterMessageDto {
  @ApiPropertyOptional({
    description: 'Filter by active status',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Free-text search across message title',
  })
  @IsOptional()
  @IsString()
  searchingFor?: string;

  @ApiPropertyOptional({
    description: 'Filter by message status (web values: draft | active | archived)',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  status?: string[];

  @ApiPropertyOptional({
    description: 'Filter messages targeted to these recipient (user) IDs',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  recipientIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter messages targeted to users belonging to these sector IDs',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  sectorIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter messages by creation date range',
    type: MessageCreatedAtFilterDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageCreatedAtFilterDto)
  createdAt?: MessageCreatedAtFilterDto;

  @ApiPropertyOptional({
    description: 'Filter messages visible at this date (ISO date string)',
    example: '2026-01-06T12:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  visibleAt?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort by field',
    default: 'createdAt',
    enum: ['createdAt', 'updatedAt', 'title'],
  })
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort direction',
    default: 'desc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
