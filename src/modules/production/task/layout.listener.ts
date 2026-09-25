import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import {
  LayoutApprovedEvent,
  LayoutReprovedEvent,
  LayoutPendingApprovalReminderEvent,
  type LayoutActor,
} from './layout.events';

/** Quem decidiu, para o texto: o contato do cliente é identificado como tal. */
function actorLabel(actor: LayoutActor): string {
  const name =
    actor.name?.trim() || (actor.kind === 'RESPONSIBLE' ? 'contato do cliente' : 'usuário');
  return actor.kind === 'RESPONSIBLE' ? `${name} (cliente)` : name;
}

/**
 * O funcionário que não deve receber o próprio aviso. Contato do cliente não é
 * `User`: nunca vai neste campo (o id seria gravado como de funcionário).
 */
function triggeringUserOf(actor: LayoutActor): string {
  return actor.kind === 'USER' ? actor.id : 'system';
}

/**
 * Layout Event Listener
 * Handles all layout-related events and creates appropriate notifications
 * using configuration-based dispatch (NotificationDispatchService).
 *
 * Config keys used:
 * - artwork.approved       → targets ADMIN, COMMERCIAL, DESIGNER, LOGISTIC
 * - artwork.reproved       → targets ADMIN, COMMERCIAL, DESIGNER, LOGISTIC
 * - artwork.pending_approval_reminder → targets ADMIN, COMMERCIAL
 *
 * Self-notification prevention is handled by the dispatch service
 * (triggeringUserId is excluded from recipients automatically).
 */
@Injectable()
export class LayoutListener {
  private readonly logger = new Logger(LayoutListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
    private readonly deepLinkService: DeepLinkService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK LISTENER] Initializing Layout Event Listener');
    this.logger.log('[ARTWORK LISTENER] Registering event handlers...');
    // A arte é do implemento (P12): estes avisos são do FLUXO DE APROVAÇÃO (a
    // decisão). O envio ao cliente avisa o contato pelo portal
    // (`PortalNotificationService.notifyArtworkPendingApproval`).

    this.eventEmitter.on('artwork.approved', this.handleLayoutApproved.bind(this));
    this.logger.log('[ARTWORK LISTENER] Registered: artwork.approved');

    this.eventEmitter.on('artwork.reproved', this.handleLayoutReproved.bind(this));
    this.logger.log('[ARTWORK LISTENER] Registered: artwork.reproved');

    this.eventEmitter.on(
      'artwork.pending_approval_reminder',
      this.handleLayoutPendingApprovalReminder.bind(this),
    );
    this.logger.log('[ARTWORK LISTENER] Registered: artwork.pending_approval_reminder');

    this.logger.log('[ARTWORK LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle layout approved event
   * Config key: artwork.approved (targets ADMIN, COMMERCIAL, DESIGNER, LOGISTIC)
   */
  private async handleLayoutApproved(event: LayoutApprovedEvent): Promise<void> {
    const { context, approvedBy } = event;
    this.logger.log(
      `[ARTWORK EVENT] Arte ${context.layout.id} aprovada (${approvedBy.kind} ${approvedBy.name ?? approvedBy.id}); tarefa ${context.task?.id ?? '—'}`,
    );

    try {
      const task = context.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';
      const who = actorLabel(approvedBy);

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/cronograma', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration(
        'artwork.approved',
        triggeringUserOf(approvedBy),
        {
          entityType: 'Task',
          entityId: task?.id || context.layout.id,
          action: 'approved',
          data: {
            taskName,
            serialNumber,
            changedBy: who,
          },
          metadata: {
            layoutId: context.layout.id,
            implementId: context.implementId,
            taskId: task?.id,
            actorKind: approvedBy.kind,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/cronograma',
            relatedEntityType: task ? 'TASK' : 'ARTWORK',
            title: `Arte aprovada: "${taskName}" ${serialNumber}`,
            body:
              approvedBy.kind === 'RESPONSIBLE'
                ? `O cliente (${who}) aprovou a arte da tarefa "${taskName}" ${serialNumber}. Pronta para produção.`
                : `A arte da tarefa "${taskName}" ${serialNumber} foi aprovada em nome do cliente por ${who}.${event.note ? ` Nota: ${event.note}` : ''}`,
          },
        },
      );
    } catch (error) {
      this.logger.error('[ARTWORK EVENT] Error handling layout approved event:', error.message);
    }
  }

  /**
   * Handle layout reproved (rejected) event
   * Config key: artwork.reproved (targets ADMIN, COMMERCIAL, DESIGNER, LOGISTIC)
   */
  private async handleLayoutReproved(event: LayoutReprovedEvent): Promise<void> {
    const { context, reprovedBy } = event;
    this.logger.log(
      `[ARTWORK EVENT] Arte ${context.layout.id} reprovada (${reprovedBy.kind} ${reprovedBy.name ?? reprovedBy.id}); motivo: ${event.reason ?? '—'}`,
    );

    try {
      const task = context.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';
      const reasonText = event.reason ? ` Motivo: ${event.reason}` : '';
      const who = actorLabel(reprovedBy);

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/cronograma', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration(
        'artwork.reproved',
        triggeringUserOf(reprovedBy),
        {
          entityType: 'Task',
          entityId: task?.id || context.layout.id,
          action: 'reproved',
          data: {
            taskName,
            serialNumber,
            changedBy: who,
            reason: event.reason ?? undefined,
          },
          metadata: {
            layoutId: context.layout.id,
            implementId: context.implementId,
            taskId: task?.id,
            actorKind: reprovedBy.kind,
            rejectionReason: event.reason ?? undefined,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/cronograma',
            relatedEntityType: task ? 'TASK' : 'ARTWORK',
            title: `Arte reprovada: "${taskName}" ${serialNumber}`,
            body: `A arte da tarefa "${taskName}" ${serialNumber} foi reprovada por ${who}.${reasonText} Uma nova versão é necessária.`,
          },
        },
      );
    } catch (error) {
      this.logger.error('[ARTWORK EVENT] Error handling layout reproved event:', error.message);
    }
  }

  /**
   * Handle layout pending approval reminder event
   * Config key: artwork.pending_approval_reminder (targets ADMIN, COMMERCIAL)
   * triggeringUserId is 'system' (no user to exclude, it's a reminder)
   */
  private async handleLayoutPendingApprovalReminder(
    event: LayoutPendingApprovalReminderEvent,
  ): Promise<void> {
    const { context } = event;
    this.logger.log(
      `[ARTWORK EVENT] Lembrete: arte ${context.layout.id} aguardando o cliente há ${event.daysPending} dia(s)`,
    );

    try {
      const task = context.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';
      const daysText = event.daysPending === 1 ? '1 dia' : `${event.daysPending} dias`;

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/cronograma', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration(
        'artwork.pending_approval_reminder',
        'system',
        {
          entityType: 'Task',
          entityId: task?.id || context.layout.id,
          action: 'pending_approval_reminder',
          data: {
            taskName,
            serialNumber,
            daysPending: event.daysPending,
            daysText,
          },
          metadata: {
            layoutId: context.layout.id,
            implementId: context.implementId,
            taskId: task?.id,
            daysPending: event.daysPending,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/cronograma',
            relatedEntityType: task ? 'TASK' : 'ARTWORK',
            title: `Lembrete: arte aguardando o cliente há ${daysText}`,
            body: `A arte da tarefa "${taskName}" ${serialNumber} foi enviada ao cliente há ${daysText} e segue sem resposta. Cobre o cliente ou aprove em nome dele, com nota.`,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        '[ARTWORK EVENT] Error handling layout pending approval reminder event:',
        error.message,
      );
    }
  }
}
