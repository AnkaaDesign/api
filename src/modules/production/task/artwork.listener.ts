import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import {
  ArtworkApprovedEvent,
  ArtworkReprovedEvent,
  ArtworkPendingApprovalReminderEvent,
} from './artwork.events';

/**
 * Artwork status labels for notifications (user-friendly names in Portuguese)
 */
const ARTWORK_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  APPROVED: 'Aprovada',
  REPROVED: 'Reprovada',
};

/**
 * Artwork Event Listener
 * Handles all artwork-related events and creates appropriate notifications
 * using configuration-based dispatch (NotificationDispatchService).
 *
 * Config keys used:
 * - artwork.approved       → targets ADMIN, DESIGNER, PRODUCTION
 * - artwork.reproved       → targets ADMIN, DESIGNER
 * - artwork.pending_approval_reminder → targets ADMIN, COMMERCIAL
 *
 * Self-notification prevention is handled by the dispatch service
 * (triggeringUserId is excluded from recipients automatically).
 */
@Injectable()
export class ArtworkListener {
  private readonly logger = new Logger(ArtworkListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
    private readonly deepLinkService: DeepLinkService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK LISTENER] Initializing Artwork Event Listener');
    this.logger.log('[ARTWORK LISTENER] Registering event handlers...');
    this.logger.log('[ARTWORK LISTENER] Note: artwork.uploaded is handled by task.field.artworks notification');

    // Register event listeners
    // Note: artwork.uploaded and artwork.revision_uploaded are NOT registered here
    // because task.field.artworks already notifies when artwork files are added/removed.
    // These handlers focus specifically on the APPROVAL WORKFLOW (status changes).

    this.eventEmitter.on('artwork.approved', this.handleArtworkApproved.bind(this));
    this.logger.log('[ARTWORK LISTENER] Registered: artwork.approved');

    this.eventEmitter.on('artwork.reproved', this.handleArtworkReproved.bind(this));
    this.logger.log('[ARTWORK LISTENER] Registered: artwork.reproved');

    this.eventEmitter.on(
      'artwork.pending_approval_reminder',
      this.handleArtworkPendingApprovalReminder.bind(this),
    );
    this.logger.log('[ARTWORK LISTENER] Registered: artwork.pending_approval_reminder');

    this.logger.log('[ARTWORK LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle artwork approved event
   * Config key: artwork.approved (targets ADMIN, DESIGNER, PRODUCTION)
   */
  private async handleArtworkApproved(event: ArtworkApprovedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK EVENT] Artwork approved event received');
    this.logger.log(`[ARTWORK EVENT] Artwork ID: ${event.artwork.id}`);
    this.logger.log(`[ARTWORK EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[ARTWORK EVENT] Approved By: ${event.approvedBy.name} (${event.approvedBy.id})`);
    this.logger.log('========================================');

    try {
      const task = event.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/tarefas', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration(
        'artwork.approved',
        event.approvedBy.id,
        {
          entityType: 'Task',
          entityId: task?.id || event.artwork.id,
          action: 'approved',
          data: {
            taskName,
            serialNumber,
            changedBy: event.approvedBy.name,
          },
          metadata: {
            artworkId: event.artwork.id,
            taskId: task?.id,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/tarefas',
            relatedEntityType: task ? 'TASK' : 'ARTWORK',
            title: `Arte aprovada: "${taskName}" ${serialNumber}`,
            body: `A arte da tarefa "${taskName}" ${serialNumber} foi aprovada por ${event.approvedBy.name}. Pronta para produção.`,
          },
        },
      );

      this.logger.log('[ARTWORK EVENT] Artwork approved dispatch completed');
    } catch (error) {
      this.logger.error('[ARTWORK EVENT] Error handling artwork approved event:', error.message);
    }
  }

  /**
   * Handle artwork reproved (rejected) event
   * Config key: artwork.reproved (targets ADMIN, DESIGNER)
   */
  private async handleArtworkReproved(event: ArtworkReprovedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK EVENT] Artwork reproved event received');
    this.logger.log(`[ARTWORK EVENT] Artwork ID: ${event.artwork.id}`);
    this.logger.log(`[ARTWORK EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[ARTWORK EVENT] Reproved By: ${event.reprovedBy.name} (${event.reprovedBy.id})`);
    this.logger.log(`[ARTWORK EVENT] Reason: ${event.reason || 'N/A'}`);
    this.logger.log('========================================');

    try {
      const task = event.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';
      const reasonText = event.reason ? ` Motivo: ${event.reason}` : '';

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/tarefas', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration(
        'artwork.reproved',
        event.reprovedBy.id,
        {
          entityType: 'Task',
          entityId: task?.id || event.artwork.id,
          action: 'reproved',
          data: {
            taskName,
            serialNumber,
            changedBy: event.reprovedBy.name,
            reason: event.reason,
          },
          metadata: {
            artworkId: event.artwork.id,
            taskId: task?.id,
            rejectionReason: event.reason,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/tarefas',
            relatedEntityType: task ? 'TASK' : 'ARTWORK',
            title: `Arte reprovada: "${taskName}" ${serialNumber}`,
            body: `A arte da tarefa "${taskName}" ${serialNumber} foi reprovada por ${event.reprovedBy.name}.${reasonText} Uma nova versão é necessária.`,
          },
        },
      );

      this.logger.log('[ARTWORK EVENT] Artwork reproved dispatch completed');
    } catch (error) {
      this.logger.error('[ARTWORK EVENT] Error handling artwork reproved event:', error.message);
    }
  }

  /**
   * Handle artwork pending approval reminder event
   * Config key: artwork.pending_approval_reminder (targets ADMIN, COMMERCIAL)
   * triggeringUserId is 'system' (no user to exclude, it's a reminder)
   */
  private async handleArtworkPendingApprovalReminder(
    event: ArtworkPendingApprovalReminderEvent,
  ): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK EVENT] Artwork pending approval reminder event received');
    this.logger.log(`[ARTWORK EVENT] Artwork ID: ${event.artwork.id}`);
    this.logger.log(`[ARTWORK EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[ARTWORK EVENT] Days Pending: ${event.daysPending}`);
    this.logger.log('========================================');

    try {
      const task = event.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';
      const daysText = event.daysPending === 1 ? '1 dia' : `${event.daysPending} dias`;

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/tarefas', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration(
        'artwork.pending_approval_reminder',
        'system',
        {
          entityType: 'Task',
          entityId: task?.id || event.artwork.id,
          action: 'pending_approval_reminder',
          data: {
            taskName,
            serialNumber,
            daysPending: event.daysPending,
            daysText,
          },
          metadata: {
            artworkId: event.artwork.id,
            taskId: task?.id,
            daysPending: event.daysPending,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/tarefas',
            relatedEntityType: task ? 'TASK' : 'ARTWORK',
            title: `Lembrete: Arte aguardando aprovação há ${daysText}`,
            body: `A arte da tarefa "${taskName}" ${serialNumber} está aguardando aprovação há ${daysText}. Por favor, revise e aprove ou reprove a arte.`,
          },
        },
      );

      this.logger.log('[ARTWORK EVENT] Artwork pending approval reminder dispatch completed');
    } catch (error) {
      this.logger.error(
        '[ARTWORK EVENT] Error handling artwork pending approval reminder event:',
        error.message,
      );
    }
  }
}
