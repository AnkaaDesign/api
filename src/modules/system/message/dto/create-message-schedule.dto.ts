import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  IsBoolean,
  IsEnum,
  IsInt,
  IsDateString,
  MaxLength,
  MinLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SCHEDULE_FREQUENCY,
  WEEK_DAY,
  MONTH,
  MONTH_OCCURRENCE,
} from '../../../../constants/enums';

/** Como o público é descrito. Espelha o seletor do compositor no web. */
export enum MESSAGE_TARGET_TYPE {
  ALL = 'ALL',
  SPECIFIC = 'SPECIFIC',
  SECTOR = 'SECTOR',
  POSITION = 'POSITION',
}

/** Dias da semana ligados numa recorrência SEMANAL/QUINZENAL. */
export class WeeklyScheduleConfigDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  monday?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  tuesday?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  wednesday?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  thursday?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  friday?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  saturday?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  sunday?: boolean;
}

/**
 * Recorrência MENSAL, em uma de duas gramáticas:
 *   - `dayOfMonth` → "todo dia 5";
 *   - `occurrence` + `dayOfWeek` → "primeira segunda", "última sexta".
 * O service recusa o config que não preencher nenhuma das duas.
 */
export class MonthlyScheduleConfigDto {
  @ApiPropertyOptional({ description: 'Dia fixo do mês (1-31)', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number | null;

  @ApiPropertyOptional({ enum: MONTH_OCCURRENCE, example: MONTH_OCCURRENCE.FIRST })
  @IsOptional()
  @IsEnum(MONTH_OCCURRENCE)
  occurrence?: MONTH_OCCURRENCE | null;

  @ApiPropertyOptional({ enum: WEEK_DAY, example: WEEK_DAY.MONDAY })
  @IsOptional()
  @IsEnum(WEEK_DAY)
  dayOfWeek?: WEEK_DAY | null;
}

/** Recorrência ANUAL: mês fixo + a mesma escolha de dia do mensal. */
export class YearlyScheduleConfigDto {
  @ApiProperty({ enum: MONTH })
  @IsEnum(MONTH)
  month: MONTH;

  @ApiPropertyOptional({ description: 'Dia fixo do mês (1-31)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number | null;

  @ApiPropertyOptional({ enum: MONTH_OCCURRENCE })
  @IsOptional()
  @IsEnum(MONTH_OCCURRENCE)
  occurrence?: MONTH_OCCURRENCE | null;

  @ApiPropertyOptional({ enum: WEEK_DAY })
  @IsOptional()
  @IsEnum(WEEK_DAY)
  dayOfWeek?: WEEK_DAY | null;
}

/**
 * Criação de um comunicado RECORRENTE.
 *
 * Diferença central para `CreateMessageDto`: o público chega aqui como REGRA
 * (`targetType` + ids de setor/cargo/usuário), não como lista de userIds já
 * resolvida. O compositor do web resolve setor→usuários antes de mandar uma
 * mensagem avulsa; num agendamento isso seria errado, porque a lista
 * congelaria no dia da criação e o aviso continuaria indo para quem saiu do
 * setor — ou nunca chegaria a quem entrou. Quem resolve é o cron, a cada
 * disparo.
 */
export class CreateMessageScheduleDto {
  @ApiProperty({
    description: 'Rótulo administrativo do agendamento',
    example: 'Aviso semanal de segurança',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiProperty({ description: 'Título da mensagem publicada a cada disparo' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({
    description: 'Blocos de conteúdo, mesmo formato de CreateMessageDto',
    type: [Object],
  })
  @IsArray()
  @Type(() => Object)
  contentBlocks: any[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isDismissible?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresView?: boolean;

  // ---- público como regra ----

  @ApiProperty({ enum: MESSAGE_TARGET_TYPE, default: MESSAGE_TARGET_TYPE.ALL })
  @IsEnum(MESSAGE_TARGET_TYPE)
  targetType: MESSAGE_TARGET_TYPE;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targetUserIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targetSectorIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targetPositionIds?: string[];

  // ---- recorrência ----

  @ApiProperty({ enum: SCHEDULE_FREQUENCY, example: SCHEDULE_FREQUENCY.WEEKLY })
  @IsEnum(SCHEDULE_FREQUENCY)
  frequency: SCHEDULE_FREQUENCY;

  @ApiPropertyOptional({
    description: 'Multiplicador do intervalo ("a cada N semanas/meses")',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  frequencyCount?: number;

  @ApiPropertyOptional({ description: 'Dia do mês da frequência CUSTOM' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number | null;

  @ApiPropertyOptional({ enum: MONTH, isArray: true, description: 'Meses da frequência CUSTOM' })
  @IsOptional()
  @IsArray()
  @IsEnum(MONTH, { each: true })
  customMonths?: MONTH[];

  @ApiPropertyOptional({ type: WeeklyScheduleConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeeklyScheduleConfigDto)
  weeklyConfig?: WeeklyScheduleConfigDto;

  @ApiPropertyOptional({ type: MonthlyScheduleConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MonthlyScheduleConfigDto)
  monthlyConfig?: MonthlyScheduleConfigDto;

  @ApiPropertyOptional({ type: YearlyScheduleConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => YearlyScheduleConfigDto)
  yearlyConfig?: YearlyScheduleConfigDto;

  // ---- janela de exibição de cada ocorrência ----

  @ApiPropertyOptional({
    description: 'Por quantos dias-calendário cada ocorrência fica visível',
    default: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  displayDurationDays?: number;

  @ApiPropertyOptional({
    description: 'Hora de São Paulo em que a ocorrência entra no ar (0-23)',
    default: 8,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  publishHour?: number;

  // ---- limites ----

  @ApiPropertyOptional({ description: 'Não disparar antes desta data' })
  @IsOptional()
  @IsDateString()
  startsOn?: string | null;

  @ApiPropertyOptional({ description: 'Não disparar depois desta data' })
  @IsOptional()
  @IsDateString()
  endsOn?: string | null;

  @ApiPropertyOptional({ description: 'Encerrar após N ocorrências' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOccurrences?: number | null;

  @ApiPropertyOptional({ description: 'Criar já pausado', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
