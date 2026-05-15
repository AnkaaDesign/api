import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import {
  headcountFiltersSchema,
  turnoverFiltersSchema,
  absenteeismFiltersSchema,
  type HeadcountFilters,
  type TurnoverFilters,
  type AbsenteeismFilters,
} from '../../../schemas/hr-analytics';
import { HrStatisticsService } from './hr-statistics.service';
import { SecullumStatisticsService } from '@modules/integrations/secullum/secullum-statistics.service';

@Controller('human-resources/analytics')
export class HrStatisticsController {
  constructor(
    private readonly hrStatistics: HrStatisticsService,
    private readonly secullumStatistics: SecullumStatisticsService,
  ) {}

  @Post('headcount')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.OK)
  async headcount(
    @Body(new ZodValidationPipe(headcountFiltersSchema)) filters: HeadcountFilters,
  ) {
    const data = await this.hrStatistics.getHeadcount(filters);
    return { success: true, message: 'Análise de efetivo carregada', data };
  }

  @Post('turnover')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.OK)
  async turnover(
    @Body(new ZodValidationPipe(turnoverFiltersSchema)) filters: TurnoverFilters,
  ) {
    const data = await this.hrStatistics.getTurnover(filters);
    return { success: true, message: 'Análise de rotatividade carregada', data };
  }

  @Post('absenteeism')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.OK)
  async absenteeism(
    @Body(new ZodValidationPipe(absenteeismFiltersSchema)) filters: AbsenteeismFilters,
  ) {
    const data = await this.secullumStatistics.getAbsenteeism(filters);
    return { success: true, message: 'Análise de absenteísmo carregada', data };
  }
}
