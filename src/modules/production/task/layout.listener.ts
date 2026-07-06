import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { syncEmNegociacaoForTask } from '../../../utils/em-negociacao-sync';
import {
  LayoutApprovedEvent,
  LayoutReprovedEvent,
  LayoutPendingApprovalReminderEvent,
} from './layout.events';

/**
 * Layout status labels for notifications (user-friendly names in Portuguese)
 */
const LAYOUT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  APPROVED: 'Aprovada',
  REPROVED: 'Reprovada',
};

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
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK LISTENER] Initializing Layout Event Listener');
    this.logger.log('[ARTWORK LISTENER] Registering event handlers...');
    this.logger.log(
      '[ARTWORK LISTENER] Note: layout.uploaded is handled by task.field.layouts notification',
    );

    // Register event listeners
    // Note: layout.uploaded and layout.revision_uploaded are NOT registered here
    // because task.field.layouts already notifies when layout files are added/removed.
    // These handlers focus specifically on the APPROVAL WORKFLOW (status changes).

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
    this.logger.log('========================================');
    this.logger.log('[ARTWORK EVENT] Layout approved event received');
    this.logger.log(`[ARTWORK EVENT] Layout ID: ${event.layout.id}`);
    this.logger.log(`[ARTWORK EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(
      `[ARTWORK EVENT] Approved By: ${event.approvedBy.name} (${event.approvedBy.id})`,
    );
    this.logger.log('========================================');

    try {
      const task = event.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/cronograma', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration('artwork.approved', event.approvedBy.id, {
        entityType: 'Task',
        entityId: task?.id || event.layout.id,
        action: 'approved',
        data: {
          taskName,
          serialNumber,
          changedBy: event.approvedBy.name,
        },
        metadata: {
          layoutId: event.layout.id,
          taskId: task?.id,
        },
        overrides: {
          actionUrl: JSON.stringify(deepLinks),
          webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/cronograma',
          relatedEntityType: task ? 'TASK' : 'ARTWORK',
          title: `Arte aprovada: "${taskName}" ${serialNumber}`,
          body: `A arte da tarefa "${taskName}" ${serialNumber} foi aprovada. Pronta para produção.`,
        },
      });

      this.logger.log('[ARTWORK EVENT] Layout approved dispatch completed');

      // Reconcile the commercial workflow: a task that was waiting for
      // layout now has an APPROVED layout — close the "Em Negociação" SO.
      if (event.task?.id) {
        await syncEmNegociacaoForTask(
          this.prisma,
          event.task.id,
          event.approvedBy.id,
        );
      }
    } catch (error) {
      this.logger.error('[ARTWORK EVENT] Error handling layout approved event:', error.message);
    }
  }

  /**
   * Handle layout reproved (rejected) event
   * Config key: artwork.reproved (targets ADMIN, COMMERCIAL, DESIGNER, LOGISTIC)
   */
  private async handleLayoutReproved(event: LayoutReprovedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK EVENT] Layout reproved event received');
    this.logger.log(`[ARTWORK EVENT] Layout ID: ${event.layout.id}`);
    this.logger.log(`[ARTWORK EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(
      `[ARTWORK EVENT] Reproved By: ${event.reprovedBy.name} (${event.reprovedBy.id})`,
    );
    this.logger.log(`[ARTWORK EVENT] Reason: ${event.reason || 'N/A'}`);
    this.logger.log('========================================');

    try {
      const task = event.task;
      const taskName = task?.name || 'Sem tarefa';
      const serialNumber = task?.serialNumber ? `#${task.serialNumber}` : '';
      const reasonText = event.reason ? ` Motivo: ${event.reason}` : '';

      const deepLinks = task
        ? this.deepLinkService.generateTaskLinks(task.id)
        : { web: '/producao/cronograma', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration('artwork.reproved', event.reprovedBy.id, {
        entityType: 'Task',
        entityId: task?.id || event.layout.id,
        action: 'reproved',
        data: {
          taskName,
          serialNumber,
          changedBy: event.reprovedBy.name,
          reason: event.reason,
        },
        metadata: {
          layoutId: event.layout.id,
          taskId: task?.id,
          rejectionReason: event.reason,
        },
        overrides: {
          actionUrl: JSON.stringify(deepLinks),
          webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/cronograma',
          relatedEntityType: task ? 'TASK' : 'ARTWORK',
          title: `Arte reprovada: "${taskName}" ${serialNumber}`,
          body: `A arte da tarefa "${taskName}" ${serialNumber} foi reprovada.${reasonText} Uma nova versão é necessária.`,
        },
      });

      this.logger.log('[ARTWORK EVENT] Layout reproved dispatch completed');

      // Reconcile: an layout was reproved. If the task had previously
      // closed the commercial SO (auto-COMPLETED on a now-REPROVED layout),
      // re-open it to WAITING_ARTWORK so the commercial flow knows layout
      // is still pending.
      if (event.task?.id) {
        await syncEmNegociacaoForTask(
          this.prisma,
          event.task.id,
          event.reprovedBy.id,
        );
      }
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
    this.logger.log('========================================');
    this.logger.log('[ARTWORK EVENT] Layout pending approval reminder event received');
    this.logger.log(`[ARTWORK EVENT] Layout ID: ${event.layout.id}`);
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
        : { web: '/producao/cronograma', mobile: '', universalLink: '' };

      await this.dispatchService.dispatchByConfiguration(
        'artwork.pending_approval_reminder',
        'system',
        {
          entityType: 'Task',
          entityId: task?.id || event.layout.id,
          action: 'pending_approval_reminder',
          data: {
            taskName,
            serialNumber,
            daysPending: event.daysPending,
            daysText,
          },
          metadata: {
            layoutId: event.layout.id,
            taskId: task?.id,
            daysPending: event.daysPending,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/cronograma',
            relatedEntityType: task ? 'TASK' : 'ARTWORK',
            title: `Lembrete: Arte aguardando aprovação há ${daysText}`,
            body: `A arte da tarefa "${taskName}" ${serialNumber} está aguardando aprovação há ${daysText}. Por favor, revise e aprove ou reprove a arte.`,
          },
        },
      );

      this.logger.log('[ARTWORK EVENT] Layout pending approval reminder dispatch completed');
    } catch (error) {
      this.logger.error(
        '[ARTWORK EVENT] Error handling layout pending approval reminder event:',
        error.message,
      );
    }
  }
}
