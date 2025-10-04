import { Controller, Get, Query, Param, Delete, Body, UsePipes } from '@nestjs/common';
import { ChangeLogService } from './changelog.service';
import { ZodQueryValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import type { ChangeLogGetManyResponse } from '../../../types';
import type { ChangeLogGetManyFormData } from '../../../schemas';
import { changeLogGetManySchema } from '../../../schemas';
import { CHANGE_LOG_ENTITY_TYPE, CHANGE_TRIGGERED_BY } from '../../../constants';

@Controller('changelogs')
export class ChangeLogController {
  constructor(private readonly changeLogService: ChangeLogService) {}

  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(changeLogGetManySchema))
  async findMany(@Query() query: ChangeLogGetManyFormData): Promise<ChangeLogGetManyResponse> {
    const result = await this.changeLogService.findMany(query);
    return {
      ...result,
      success: true,
      message: 'Registros de mudanças carregados com sucesso',
    };
  }

  @Get('entity/:type/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async getEntityHistory(
    @Param('type') entityType: string,
    @Param('id') entityId: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.changeLogService.getEntityHistory(
      entityType as CHANGE_LOG_ENTITY_TYPE,
      entityId,
      limit ? parseInt(limit) : undefined,
    );

    return {
      message: 'Entity history loaded successfully',
      data,
    };
  }

  @Get('activity/:id/impact')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async getActivityImpact(@Param('id') activityId: string) {
    const data = await this.changeLogService.getActivityImpact(activityId);

    return {
      message: 'Activity impact loaded successfully',
      data,
    };
  }

  @Get('order/:id/history')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async getOrderHistory(@Param('id') orderId: string) {
    const data = await this.changeLogService.getOrderHistory(orderId);

    return {
      success: true,
      message: 'Histórico do pedido carregado com sucesso',
      data,
    };
  }

  @Get('task/:id/history')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async getTaskHistory(@Param('id') taskId: string) {
    const data = await this.changeLogService.getTaskHistory(taskId);

    return {
      success: true,
      message: 'Histórico da tarefa carregado com sucesso',
      data,
    };
  }

  @Get('triggered/:type/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async getTriggeredChanges(
    @Param('type') triggeredBy: string,
    @Param('id') triggeredById: string,
  ) {
    const data = await this.changeLogService.getRelatedChanges(
      triggeredBy as CHANGE_TRIGGERED_BY,
      triggeredById,
    );

    return {
      success: true,
      message: 'Mudanças relacionadas carregadas com sucesso',
      data,
    };
  }

  @Get('date-range')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async getByDateRange(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('entityType') entityType?: string,
  ) {
    const data = await this.changeLogService.getChangesByDateRange(
      new Date(startDate),
      new Date(endDate),
      entityType as CHANGE_LOG_ENTITY_TYPE | undefined,
    );

    return {
      success: true,
      message: 'Mudanças no período carregadas com sucesso',
      data,
    };
  }

  @Delete('cleanup')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async cleanupOldLogs(@Body('daysToKeep') daysToKeep?: number) {
    const deletedCount = await this.changeLogService.cleanupOldLogs(daysToKeep);

    return {
      success: true,
      message: `${deletedCount} registros antigos removidos com sucesso`,
      data: { deletedCount },
    };
  }
}
