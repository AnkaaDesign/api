import { IsOptional, IsEnum, IsBoolean, IsDateString, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MESSAGE_TARGET_TYPE, MESSAGE_PRIORITY } from './create-message.dto';

/**
 * DTO for filtering and querying messages
 */
export class FilterMessageDto {
  @ApiPropertyOptional({
    description: 'Filter by target type',
    enum: MESSAGE_TARGET_TYPE,
  })
  @IsOptional()
  @IsEnum(MESSAGE_TARGET_TYPE)
  targetType?: MESSAGE_TARGET_TYPE;

  @ApiPropertyOptional({
    description: 'Filter by priority',
    enum: MESSAGE_PRIORITY,
  })
  @IsOptional()
  @IsEnum(MESSAGE_PRIORITY)
  priority?: MESSAGE_PRIORITY;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

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
    enum: ['createdAt', 'updatedAt', 'priority', 'title'],
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
