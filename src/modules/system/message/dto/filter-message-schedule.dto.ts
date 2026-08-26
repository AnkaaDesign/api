import { IsOptional, IsBoolean, IsString, IsInt, IsArray, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { SCHEDULE_FREQUENCY } from '../../../../constants/enums';
import { MESSAGE_TARGET_TYPE } from './create-message-schedule.dto';

/** Filtros da listagem de agendamentos de mensagem. */
export class FilterMessageScheduleDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou título' })
  @IsOptional()
  @IsString()
  searchingFor?: string;

  @ApiPropertyOptional({ description: 'Somente ativos / somente pausados' })
  @IsOptional()
  // A querystring entrega "true"/"false" como STRING; sem esta conversão o
  // @IsBoolean rejeitaria o filtro e a lista voltaria 400.
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: SCHEDULE_FREQUENCY, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(SCHEDULE_FREQUENCY, { each: true })
  frequency?: SCHEDULE_FREQUENCY[];

  @ApiPropertyOptional({ enum: MESSAGE_TARGET_TYPE, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(MESSAGE_TARGET_TYPE, { each: true })
  targetType?: MESSAGE_TARGET_TYPE[];

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Campo de ordenação (lista branca no service)' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
