import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { ReadRateLimit } from '../throttler/throttler.decorators';
import { Roles } from '../auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';

@Controller('monitoring')
@UseGuards(AuthGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('health')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getHealth(@UserId() userId: string) {
    const health = await this.monitoringService.getCurrentHealth();
    return {
      success: true,
      message: 'Estado de saúde do sistema obtido com sucesso',
      data: health,
    };
  }

  @Get('health/history')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getHealthHistory(
    @UserId() userId: string,
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours: number,
  ) {
    // Validate hours parameter (max 30 days)
    const validatedHours = Math.min(Math.max(hours, 1), 720);

    const history = await this.monitoringService.getHealthHistory(validatedHours);
    return {
      success: true,
      message: `Histórico de saúde dos últimos ${validatedHours} horas obtido com sucesso`,
      data: history,
      meta: {
        hours: validatedHours,
        count: history.length,
      },
    };
  }

  @Post('health/refresh')
  @Roles(SECTOR_PRIVILEGES.MAINTENANCE, SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async refreshHealth(@UserId() userId: string) {
    await this.monitoringService.collectHealthMetrics();
    const health = await this.monitoringService.getCurrentHealth();
    return {
      success: true,
      message: 'Métricas de saúde atualizadas com sucesso',
      data: health,
    };
  }
}
