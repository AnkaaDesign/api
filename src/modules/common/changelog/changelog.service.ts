import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
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
  metadata?: Record<string, any>;
}

/**
 * Sentinelas de "ator não humano" que circulam pelo código como `userId`.
 *
 * `ChangeLog.userId` é uma FK para `User`: o repositório monta
 * `user: { connect: { id } }`, e um id inexistente derruba o `create` com P2025
 * — que, dentro de uma `$transaction`, arrasta junto a escrita de negócio que
 * estava sendo auditada. Foi exatamente isso que apagou 7 linhas de bonificação
 * de 07/2026: o cron chamava `calculateAndSaveBonuses(..., 'system')`, o
 * desconto de falta tentava logar, o `connect` falhava e a transação inteira do
 * colaborador ia embora — sem linha `Bonus`, e o único rastro era um erro de
 * changelog no journal.
 *
 * A autoria do sistema já está registrada em `triggeredBy = SYSTEM`; o campo
 * `userId` só existe para apontar uma PESSOA. Sentinela vira `null`.
 */
const ACTOR_SENTINELS = new Set(['system', 'System', 'SYSTEM', 'cron', '']);

/**
 * Teto das duas consultas de `getTaskHistory`. O repositório pagina com `take`
 * 20 por padrão, e a tela de histórico da tarefa não pagina: sem um teto
 * explícito ela mostrava as vinte linhas mais antigas e escondia o resto.
 */
const TASK_HISTORY_TAKE = 500;

@Injectable()
export class ChangeLogService {
  private readonly logger = new Logger(ChangeLogService.name);

  constructor(
    private readonly changeLogRepository: ChangeLogRepository,
    // Só para RESOLVER AS ORDENS DE SERVIÇO DE UMA TAREFA em `getTaskHistory`.
    // `ChangeLog` guarda `entityType` + `entityId`, e não há como perguntar "as
    // O.S. desta tarefa" sem olhar a tabela de O.S. `PrismaModule` é `@Global`.
    private readonly prisma: PrismaService,
  ) {}

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
      metadata: callerMetadata,
    } = params;

    // Convert ENTITY_TYPE to CHANGE_LOG_ENTITY_TYPE
    const changeLogEntityType = convertToChangeLogEntityType(entityType);

    // Build metadata object. Caller-supplied metadata is merged FIRST: it was
    // previously destructured away and dropped, so every child-entity log
    // (TASK_QUOTE_SERVICE and friends) lost the provenance it passed in — the
    // customer/service it referred to was unrecoverable from the row itself.
    // `timestamp` stays authoritative and cannot be overridden by a caller.
    const metadata: Record<string, any> = {
      ...(callerMetadata ?? {}),
      timestamp: new Date().toISOString(),
    };

    // If oldValue and newValue are change objects (have 'from' and 'to' structure),
    // include them in metadata for better querying
    if (old && typeof old === 'object' && !Array.isArray(old)) {
      // Check if it looks like a changes object (multiple fields with from/to structure)
      const keys = Object.keys(old);
      if (keys.length > 0) {
        const firstKey = keys[0];
        const firstValue = old[firstKey];
        if (
          firstValue &&
          typeof firstValue === 'object' &&
          'from' in firstValue &&
          'to' in firstValue
        ) {
          // This is a changes object, include it in metadata
          Object.assign(metadata, old);
        }
      }
    }

    // Ver `ACTOR_SENTINELS`: um id que não existe em `User` transforma a
    // auditoria em causa de rollback da própria escrita auditada.
    let actorId = user ?? null;
    if (actorId !== null && ACTOR_SENTINELS.has(actorId)) {
      this.logger.debug(
        `ChangeLog ${changeLogEntityType}/${id}: userId sentinela "${actorId}" ` +
          'normalizado para null (autoria fica em triggeredBy).',
      );
      actorId = null;
    }

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
      userId: actorId,
      metadata,
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

  /**
   * ⛔ ESTE MÉTODO DEVOLVIA O HISTÓRICO DE O.S. DO SISTEMA INTEIRO.
   *
   * O `where` da segunda consulta filtrava por `entityType = SERVICE_ORDER` e
   * PARAVA AÍ — não havia `taskId` em lugar nenhum. `GET /changelogs/task/:id/
   * history` respondia, no lugar das O.S. daquele implemento, as vinte alterações
   * de O.S. mais ANTIGAS de toda a base (vinte porque o `take` do repositório
   * é 20 por padrão), iguais para qualquer tarefa consultada.
   *
   * `ChangeLog` não tem FK para tarefa: a linha de uma O.S. guarda o id DA O.S.
   * em `entityId`. O recorte, portanto, é resolver antes quais O.S. são desta
   * tarefa e filtrar por esses ids. A O.S. apagada não entra — `ServiceOrder`
   * cai em cascata com a tarefa (`onDelete: Cascade`), de modo que a trilha de
   * uma tarefa viva é exatamente a das O.S. vivas dela.
   */
  async getTaskHistory(taskId: string) {
    const taskResult = await this.changeLogRepository.findMany({
      where: {
        entityType: CHANGE_LOG_ENTITY_TYPE.TASK,
        entityId: taskId,
      },
      orderBy: { createdAt: 'asc' },
      take: TASK_HISTORY_TAKE,
    });
    const changes = taskResult.data;

    // As O.S. DESTA tarefa — o recorte que faltava.
    const serviceOrders = await this.prisma.serviceOrder.findMany({
      where: { taskId },
      select: { id: true },
    });
    const serviceOrderIds = serviceOrders.map(so => so.id);

    // Tarefa sem ordem de serviço: `entityId: { in: [] }` devolveria vazio de
    // qualquer forma, mas a consulta é pura perda — e um `in` vazio já foi
    // fonte de surpresa neste repositório.
    const serviceChanges = serviceOrderIds.length
      ? await this.changeLogRepository.findMany({
          where: {
            entityType: CHANGE_LOG_ENTITY_TYPE.SERVICE_ORDER,
            entityId: { in: serviceOrderIds },
          },
          orderBy: { createdAt: 'asc' },
          take: TASK_HISTORY_TAKE,
        })
      : { data: [] as any[] };

    // Bonification changes are tracked as part of task changes (field-level changes)
    // since bonification is a field on the Task entity, not a separate entity

    return {
      taskChanges: changes,
      serviceChanges: serviceChanges.data,
      bonificationChanges: [], // Bonification changes are included in taskChanges
    };
  }
}
