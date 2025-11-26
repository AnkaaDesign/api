import { Injectable } from '@nestjs/common';
import { ChangeLogRepository } from '../changelog/repositories/changelog.repository';
import {
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  CHANGE_ACTION,
  ENTITY_TYPE,
} from '../../../constants';
import type { ChangeLogCreateFormData } from '../../../schemas';
import { convertToChangeLogEntityType } from './utils/enum-converter';

interface LogChangeParams {
  entityType: ENTITY_TYPE;
  entityId: string;
  action: CHANGE_ACTION;
  field?: string | null;
  oldValue?: any;
  newValue?: any;
  reason: string;
  triggeredBy: CHANGE_TRIGGERED_BY | null;
  triggeredById: string | null;
  userId: string | null;
  transaction?: any;
}

@Injectable()
export class ChangeLogService {
  constructor(private readonly changeLogRepository: ChangeLogRepository) {}

  async findMany(params: any): Promise<any> {
    return await this.changeLogRepository.findMany(params);
  }

  async findOne(id: string, include?: any): Promise<any> {
    return await this.changeLogRepository.findById(id, include);
  }

  async logChange(params: LogChangeParams): Promise<void>;
  async logChange(
    entityType: ENTITY_TYPE,
    action: CHANGE_ACTION,
    entityId: string,
    oldValue: any,
    newValue: any,
    userId: string | null,
    triggeredBy: CHANGE_TRIGGERED_BY,
    transaction?: any,
  ): Promise<void>;
  async logChange(
    paramsOrEntityType: LogChangeParams | ENTITY_TYPE,
    action?: CHANGE_ACTION,
    entityId?: string,
    oldValue?: any,
    newValue?: any,
    userId?: string | null,
    triggeredBy?: CHANGE_TRIGGERED_BY,
    transaction?: any,
  ): Promise<void> {
    let params: LogChangeParams;

    // Check if called with object parameter
    if (
      typeof paramsOrEntityType === 'object' &&
      paramsOrEntityType !== null &&
      'entityType' in paramsOrEntityType
    ) {
      params = paramsOrEntityType as LogChangeParams;
    } else {
      // Legacy positional parameters
      params = {
        entityType: paramsOrEntityType as ENTITY_TYPE,
        action: action!,
        entityId: entityId!,
        oldValue,
        newValue,
        userId: userId || null,
        triggeredBy: triggeredBy!,
        triggeredById: null,
        reason: this.generateChangeReason(action!, oldValue, newValue),
        transaction,
      };
    }

    const {
      entityType,
      entityId: id,
      action: changeAction,
      field,
      oldValue: old,
      newValue: updated,
      reason,
      triggeredBy: trigger,
      triggeredById,
      userId: user,
      transaction: tx,
    } = params;

    // Convert ENTITY_TYPE to CHANGE_LOG_ENTITY_TYPE
    const changeLogEntityType = convertToChangeLogEntityType(entityType);

    const changeLogData: ChangeLogCreateFormData = {
      entityType: changeLogEntityType as string,
      entityId: id,
      action: changeAction as string,
      field,
      oldValue: old,
      newValue: updated,
      reason,
      triggeredBy: trigger,
      triggeredById,
      userId: user,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    if (tx) {
      await this.changeLogRepository.createWithTransaction(tx, changeLogData);
    } else {
      await this.changeLogRepository.create(changeLogData);
    }
  }

  private generateChangeReason(action: CHANGE_ACTION, oldValue: any, newValue: any): string {
    switch (action) {
      case CHANGE_ACTION.CREATE:
        return 'Registro criado';
      case CHANGE_ACTION.UPDATE:
        return 'Registro atualizado';
      case CHANGE_ACTION.DELETE:
        return 'Registro removido';
      default:
        return `Ação: ${action}`;
    }
  }

  async getEntityHistory(entityType: CHANGE_LOG_ENTITY_TYPE, entityId: string, limit?: number) {
    const result = await this.changeLogRepository.findMany({
      where: {
        entityType: entityType as string,
        entityId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return result.data;
  }

  async getRelatedChanges(triggeredBy: CHANGE_TRIGGERED_BY, triggeredById: string) {
    const result = await this.changeLogRepository.findMany({
      where: {
        triggeredBy: triggeredBy as string,
        triggeredById,
      },
      orderBy: { createdAt: 'desc' },
    });
    return result.data;
  }

  async getChangesByDateRange(startDate: Date, endDate: Date, entityType?: CHANGE_LOG_ENTITY_TYPE) {
    const result = await this.changeLogRepository.findMany({
      where: {
        ...(entityType && { entityType: entityType as string }),
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return result.data;
  }

  async cleanupOldLogs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // First, find all logs older than cutoff date
    const oldLogs = await this.changeLogRepository.findMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    // Delete them using batch delete
    if (oldLogs.data.length > 0) {
      const ids = oldLogs.data.map(log => log.id);
      const result = await this.changeLogRepository.deleteMany(ids);
      return result.totalDeleted;
    }

    return 0;
  }

  async getActivityImpact(activityId: string) {
    // Get all changes triggered by this activity
    const result = await this.changeLogRepository.findMany({
      where: {
        entityType: CHANGE_LOG_ENTITY_TYPE.ACTIVITY,
        entityId: activityId,
      },
      orderBy: { createdAt: 'desc' },
    });
    const changes = result.data;

    // Group changes by entity type
    const impact = {
      items: changes.filter(c => c.entityType === CHANGE_LOG_ENTITY_TYPE.ITEM),
      orders: changes.filter(c => c.entityType === CHANGE_LOG_ENTITY_TYPE.ORDER),
      orderItems: changes.filter(c => c.entityType === CHANGE_LOG_ENTITY_TYPE.ORDER_ITEM),
    };

    return impact;
  }

  async getOrderHistory(orderId: string) {
    const orderResult = await this.changeLogRepository.findMany({
      where: {
        entityType: CHANGE_LOG_ENTITY_TYPE.ORDER,
        entityId: orderId,
      },
      orderBy: { createdAt: 'asc' },
    });
    const changes = orderResult.data;

    // Also get changes to order items
    const orderItemChanges = await this.changeLogRepository.findMany({
      where: {
        entityType: CHANGE_LOG_ENTITY_TYPE.ORDER_ITEM,
        triggeredBy: CHANGE_TRIGGERED_BY.ORDER_UPDATE,
        triggeredById: orderId,
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      orderChanges: changes,
      orderItemChanges: orderItemChanges.data,
    };
  }

  async getTaskHistory(taskId: string) {
    const taskResult = await this.changeLogRepository.findMany({
      where: {
        entityType: CHANGE_LOG_ENTITY_TYPE.TASK,
        entityId: taskId,
      },
      orderBy: { createdAt: 'asc' },
    });
    const changes = taskResult.data;

    // Also get changes to service orders
    const serviceChanges = await this.changeLogRepository.findMany({
      where: {
        entityType: CHANGE_LOG_ENTITY_TYPE.SERVICE_ORDER,
        // Filter by task ID in metadata or entity relationships instead
        // since triggeredBy/triggeredById are for specific enum-based triggers
      },
      orderBy: { createdAt: 'asc' },
    });

    // Commission changes are tracked as part of task changes (field-level changes)
    // since commission is a field on the Task entity, not a separate entity

    return {
      taskChanges: changes,
      serviceChanges: serviceChanges.data,
      commissionChanges: [], // Commission changes are included in taskChanges
    };
  }
}
