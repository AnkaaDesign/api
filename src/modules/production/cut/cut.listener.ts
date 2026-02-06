import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import {
  CutCreatedEvent,
  CutStartedEvent,
  CutCompletedEvent,
  CutRequestCreatedEvent,
  CutsAddedToTaskEvent,
} from './cut.events';
import {
  CUT_TYPE,
  CUT_REQUEST_REASON,
} from '../../../constants/enums';

/**
 * Cut type labels for notifications (user-friendly names)
 */
const CUT_TYPE_LABELS: Record<string, string> = {
  [CUT_TYPE.VINYL]: 'Adesivo',
  [CUT_TYPE.STENCIL]: 'Máscara de Pintura',
};

/**
 * Cut request reason labels for notifications (user-friendly names)
 */
const CUT_REQUEST_REASON_LABELS: Record<string, string> = {
  [CUT_REQUEST_REASON.WRONG_APPLY]: 'Aplicação incorreta',
  [CUT_REQUEST_REASON.LOST]: 'Material perdido',
  [CUT_REQUEST_REASON.WRONG]: 'Erro no recorte',
};

/**
 * Cut Event Listener
 * Handles all cut-related events and dispatches notifications using
 * database configuration-based approach (checks config enablement + user preferences).
 *
 * Config keys:
 * - cut.created
 * - cut.started
 * - cut.completed
 * - cut.request.created
 * - cuts.added.to.task
 */
@Injectable()
export class CutListener {
  private readonly logger = new Logger(CutListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
    private readonly deepLinkService: DeepLinkService,
  ) {
    this.logger.log('[CUT LISTENER] Initializing Cut Event Listener');

    this.eventEmitter.on('cut.created', this.handleCutCreated.bind(this));
    this.eventEmitter.on('cut.started', this.handleCutStarted.bind(this));
    this.eventEmitter.on('cut.completed', this.handleCutCompleted.bind(this));
    this.eventEmitter.on('cut.request.created', this.handleCutRequestCreated.bind(this));
    this.eventEmitter.on('cuts.added.to.task', this.handleCutsAddedToTask.bind(this));

    this.logger.log('[CUT LISTENER] All event handlers registered successfully');
  }

  /**
   * Build action URL and metadata for cut notifications.
   * Navigates to the task if available, otherwise to the plotter page.
   */
  private buildCutContext(cut: any, task: any | null) {
    const deepLinks = task
      ? this.deepLinkService.generateTaskLinks(task.id)
      : { web: '/producao/plotter', mobile: '', universalLink: '', webPath: '/producao/plotter' };

    const webUrl = task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/plotter';

    return {
      actionUrl: JSON.stringify(deepLinks),
      webUrl,
      entityId: task?.id || cut.id,
      entityType: task ? 'Task' : 'CUT',
    };
  }

  /**
   * Handle cut created event
   */
  private async handleCutCreated(event: CutCreatedEvent): Promise<void> {
    this.logger.log(`[CUT EVENT] Cut created: ${event.cut.id}`);

    try {
      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber || '';
      const ctx = this.buildCutContext(event.cut, event.task);

      await this.dispatchService.dispatchByConfiguration(
        'cut.created',
        event.createdBy.id,
        {
          entityType: ctx.entityType,
          entityId: ctx.entityId,
          action: 'created',
          data: {
            cutTypeLabel,
            taskName,
            serialNumber,
            changedBy: event.createdBy.name,
          },
          metadata: {
            cutId: event.cut.id,
            cutType: event.cut.type,
            taskId: event.task?.id,
          },
          overrides: {
            actionUrl: ctx.actionUrl,
            webUrl: ctx.webUrl,
            relatedEntityType: 'CUT',
            title: `Recorte de ${cutTypeLabel} adicionado para tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''} por ${event.createdBy.name}`,
            body: `Um recorte de ${cutTypeLabel} foi adicionado para a tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''} por ${event.createdBy.name}.`,
          },
        },
      );
    } catch (error) {
      this.logger.error('[CUT EVENT] Error handling cut created event:', error.message);
    }
  }

  /**
   * Handle cut started event
   */
  private async handleCutStarted(event: CutStartedEvent): Promise<void> {
    this.logger.log(`[CUT EVENT] Cut started: ${event.cut.id}`);

    try {
      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber || '';
      const ctx = this.buildCutContext(event.cut, event.task);

      await this.dispatchService.dispatchByConfiguration(
        'cut.started',
        event.startedBy.id,
        {
          entityType: ctx.entityType,
          entityId: ctx.entityId,
          action: 'started',
          data: {
            cutTypeLabel,
            taskName,
            serialNumber,
            changedBy: event.startedBy.name,
          },
          metadata: {
            cutId: event.cut.id,
            cutType: event.cut.type,
            taskId: event.task?.id,
            taskSectorId: event.task?.sectorId,
          },
          overrides: {
            actionUrl: ctx.actionUrl,
            webUrl: ctx.webUrl,
            relatedEntityType: 'CUT',
            title: `Recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''} iniciado por ${event.startedBy.name}`,
            body: `O recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''} foi iniciado por ${event.startedBy.name}.`,
          },
        },
      );
    } catch (error) {
      this.logger.error('[CUT EVENT] Error handling cut started event:', error.message);
    }
  }

  /**
   * Handle cut completed event
   */
  private async handleCutCompleted(event: CutCompletedEvent): Promise<void> {
    this.logger.log(`[CUT EVENT] Cut completed: ${event.cut.id}`);

    try {
      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber || '';
      const ctx = this.buildCutContext(event.cut, event.task);

      await this.dispatchService.dispatchByConfiguration(
        'cut.completed',
        event.completedBy.id,
        {
          entityType: ctx.entityType,
          entityId: ctx.entityId,
          action: 'completed',
          data: {
            cutTypeLabel,
            taskName,
            serialNumber,
            changedBy: event.completedBy.name,
          },
          metadata: {
            cutId: event.cut.id,
            cutType: event.cut.type,
            taskId: event.task?.id,
            taskSectorId: event.task?.sectorId,
          },
          overrides: {
            actionUrl: ctx.actionUrl,
            webUrl: ctx.webUrl,
            relatedEntityType: 'CUT',
            title: `Recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''} concluído por ${event.completedBy.name}`,
            body: `O recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''} foi concluído por ${event.completedBy.name}.`,
          },
        },
      );
    } catch (error) {
      this.logger.error('[CUT EVENT] Error handling cut completed event:', error.message);
    }
  }

  /**
   * Handle cut request created event
   */
  private async handleCutRequestCreated(event: CutRequestCreatedEvent): Promise<void> {
    this.logger.log(`[CUT EVENT] Cut request created: ${event.cut.id}`);

    try {
      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const reasonLabel = CUT_REQUEST_REASON_LABELS[event.reason] || 'Motivo não especificado';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber || '';
      const ctx = this.buildCutContext(event.cut, event.task);

      await this.dispatchService.dispatchByConfiguration(
        'cut.request.created',
        event.createdBy.id,
        {
          entityType: ctx.entityType,
          entityId: ctx.entityId,
          action: 'request_created',
          data: {
            cutTypeLabel,
            taskName,
            serialNumber,
            changedBy: event.createdBy.name,
            reason: reasonLabel,
          },
          metadata: {
            cutId: event.cut.id,
            cutType: event.cut.type,
            taskId: event.task?.id,
            parentCutId: event.parentCut?.id,
            reason: event.reason,
          },
          overrides: {
            actionUrl: ctx.actionUrl,
            webUrl: ctx.webUrl,
            relatedEntityType: 'CUT',
            title: `Novo recorte de ${cutTypeLabel} solicitado para tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''} por ${event.createdBy.name} - Motivo: ${reasonLabel}`,
            body: `Foi solicitado um novo recorte de ${cutTypeLabel} para a tarefa "${taskName}"${serialNumber ? ` (${serialNumber})` : ''}. Motivo: ${reasonLabel}. Solicitado por ${event.createdBy.name}.`,
          },
        },
      );
    } catch (error) {
      this.logger.error('[CUT EVENT] Error handling cut request created event:', error.message);
    }
  }

  /**
   * Handle cuts added to task event
   */
  private async handleCutsAddedToTask(event: CutsAddedToTaskEvent): Promise<void> {
    this.logger.log(`[CUT EVENT] ${event.cuts.length} cuts added to task: ${event.task.id}`);

    try {
      const cutsCount = event.cuts.length;
      const serialNumber = event.task.serialNumber || '';
      const ctx = this.buildCutContext(event.cuts[0], event.task);

      const detailedTitle =
        cutsCount === 1
          ? `1 recorte adicionado à tarefa "${event.task.name}"${serialNumber ? ` (${serialNumber})` : ''} por ${event.addedBy.name}`
          : `${cutsCount} recortes adicionados à tarefa "${event.task.name}"${serialNumber ? ` (${serialNumber})` : ''} por ${event.addedBy.name}`;

      const detailedBody =
        cutsCount === 1
          ? `1 recorte foi adicionado à tarefa "${event.task.name}"${serialNumber ? ` (${serialNumber})` : ''} por ${event.addedBy.name}.`
          : `${cutsCount} recortes foram adicionados à tarefa "${event.task.name}"${serialNumber ? ` (${serialNumber})` : ''} por ${event.addedBy.name}.`;

      await this.dispatchService.dispatchByConfiguration(
        'cuts.added.to.task',
        event.addedBy.id,
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'cuts_added',
          data: {
            taskName: event.task.name,
            serialNumber,
            changedBy: event.addedBy.name,
            count: cutsCount.toString(),
          },
          metadata: {
            taskId: event.task.id,
            cutsCount,
          },
          overrides: {
            actionUrl: ctx.actionUrl,
            webUrl: ctx.webUrl,
            relatedEntityType: 'TASK',
            title: detailedTitle,
            body: detailedBody,
          },
        },
      );
    } catch (error) {
      this.logger.error('[CUT EVENT] Error handling cuts added to task event:', error.message);
    }
  }
}
