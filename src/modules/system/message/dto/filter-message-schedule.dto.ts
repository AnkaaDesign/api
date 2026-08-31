import { IsOptional, IsBoolean, IsString, IsInt, IsArray, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { SCHEDULE_FREQUENCY } from '../../../../constants/enums';
import { MESSAGE_TARGET_TYPE } from './create-message-schedule.dto';

/** As três situações de um agendamento, como a interface as apresenta. */
export enum MESSAGE_SCHEDULE_STATUS {
  ACTIVE = 'active',
  PAUSED = 'paused',
  FINISHED = 'finished',
}

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

  /**
   * A situação como a interface a mostra, que NÃO é o `isActive` cru: um
   * agendamento encerrado (fim da vigência, limite de publicações) também tem
   * `isActive = false`, e amontoá-lo com os pausados esconde a diferença que
   * importa — pausado volta com um clique, encerrado precisa da regra editada.
   */
  @ApiPropertyOptional({ enum: MESSAGE_SCHEDULE_STATUS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(MESSAGE_SCHEDULE_STATUS, { each: true })
  status?: MESSAGE_SCHEDULE_STATUS[];

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
