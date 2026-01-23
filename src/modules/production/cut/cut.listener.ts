import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationService } from '@modules/common/notification/notification.service';
import { NotificationPreferenceService } from '@modules/common/notification/notification-preference.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  CutCreatedEvent,
  CutStartedEvent,
  CutCompletedEvent,
  CutRequestCreatedEvent,
  CutsAddedToTaskEvent,
} from './cut.events';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ACTION_TYPE,
  SECTOR_PRIVILEGES,
  CUT_STATUS,
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
 * Handles all cut-related events and creates appropriate notifications
 * with role-based targeting and multi-channel delivery
 *
 * Notification targets:
 * - PLOTTING: Receives all cut notifications (primary audience - they do the cutting)
 * - PRODUCTION: Receives notifications when cuts are started/completed for tasks in their sector
 * - ADMIN: Receives all cut notifications
 *
 * Self-notification prevention:
 * - Users who perform an action do NOT receive the notification for that action
 */
@Injectable()
export class CutListener {
  private readonly logger = new Logger(CutListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[CUT LISTENER] Initializing Cut Event Listener');
    this.logger.log('[CUT LISTENER] Registering event handlers...');

    // Register event listeners
    this.eventEmitter.on('cut.created', this.handleCutCreated.bind(this));
    this.logger.log('[CUT LISTENER] ✅ Registered: cut.created');

    this.eventEmitter.on('cut.started', this.handleCutStarted.bind(this));
    this.logger.log('[CUT LISTENER] ✅ Registered: cut.started');

    this.eventEmitter.on('cut.completed', this.handleCutCompleted.bind(this));
    this.logger.log('[CUT LISTENER] ✅ Registered: cut.completed');

    this.eventEmitter.on('cut.request.created', this.handleCutRequestCreated.bind(this));
    this.logger.log('[CUT LISTENER] ✅ Registered: cut.request.created');

    this.eventEmitter.on('cuts.added.to.task', this.handleCutsAddedToTask.bind(this));
    this.logger.log('[CUT LISTENER] ✅ Registered: cuts.added.to.task');

    this.logger.log('[CUT LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle cut created event
   * Notify: PLOTTING + ADMIN users
   */
  private async handleCutCreated(event: CutCreatedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[CUT EVENT] Cut created event received');
    this.logger.log(`[CUT EVENT] Cut ID: ${event.cut.id}`);
    this.logger.log(`[CUT EVENT] Cut Type: ${event.cut.type}`);
    this.logger.log(`[CUT EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[CUT EVENT] Created By: ${event.createdBy.name} (${event.createdBy.id})`);
    this.logger.log('========================================');

    try {
      const targetUsers = await this.getTargetUsersForCutEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PLOTTING],
        event.createdBy.id,
      );

      this.logger.log(`[CUT EVENT] Found ${targetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber ? ` (${event.task.serialNumber})` : '';

      for (const userId of targetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.CUT,
          'created',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getCutNotificationMetadata(event.cut, event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.CUT,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: `Recorte de ${cutTypeLabel} adicionado para tarefa "${taskName}"${serialNumber} por ${event.createdBy.name}`,
          body: `Um recorte de ${cutTypeLabel} foi adicionado para a tarefa "${taskName}"${serialNumber} por ${event.createdBy.name}.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.cut.id,
          relatedEntityType: 'CUT',
          metadata,
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[CUT EVENT] Cut creation notification summary:');
      this.logger.log(`[CUT EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[CUT EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[CUT EVENT] ❌ Error handling cut created event:', error.message);
    }
  }

  /**
   * Handle cut started event (status changed to CUTTING)
   * Notify: PLOTTING + ADMIN users
   * Also notify PRODUCTION users if the cut is for a task in their sector
   */
  private async handleCutStarted(event: CutStartedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[CUT EVENT] Cut started event received');
    this.logger.log(`[CUT EVENT] Cut ID: ${event.cut.id}`);
    this.logger.log(`[CUT EVENT] Cut Type: ${event.cut.type}`);
    this.logger.log(`[CUT EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[CUT EVENT] Started By: ${event.startedBy.name} (${event.startedBy.id})`);
    this.logger.log('========================================');

    try {
      // Base target users: PLOTTING + ADMIN
      const targetUsers = await this.getTargetUsersForCutEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PLOTTING],
        event.startedBy.id,
      );

      // Get PRODUCTION users for the task's sector (if applicable)
      let productionUsers: string[] = [];
      if (event.task?.sectorId) {
        productionUsers = await this.getProductionUsersForSector(
          event.task.sectorId,
          event.startedBy.id,
        );
      }

      // Merge users (avoiding duplicates)
      const allTargetUsers = [...new Set([...targetUsers, ...productionUsers])];

      this.logger.log(`[CUT EVENT] Found ${allTargetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber ? ` (${event.task.serialNumber})` : '';

      for (const userId of allTargetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.CUT,
          'started',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getCutNotificationMetadata(event.cut, event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.CUT,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: `Recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber} iniciado por ${event.startedBy.name}`,
          body: `O recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber} foi iniciado por ${event.startedBy.name}.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.cut.id,
          relatedEntityType: 'CUT',
          metadata,
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[CUT EVENT] Cut started notification summary:');
      this.logger.log(`[CUT EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[CUT EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[CUT EVENT] ❌ Error handling cut started event:', error.message);
    }
  }

  /**
   * Handle cut completed event (status changed to COMPLETED)
   * Notify: PLOTTING + ADMIN users
   * Also notify PRODUCTION users if the cut is for a task in their sector
   */
  private async handleCutCompleted(event: CutCompletedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[CUT EVENT] Cut completed event received');
    this.logger.log(`[CUT EVENT] Cut ID: ${event.cut.id}`);
    this.logger.log(`[CUT EVENT] Cut Type: ${event.cut.type}`);
    this.logger.log(`[CUT EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[CUT EVENT] Completed By: ${event.completedBy.name} (${event.completedBy.id})`);
    this.logger.log('========================================');

    try {
      // Base target users: PLOTTING + ADMIN
      const targetUsers = await this.getTargetUsersForCutEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PLOTTING],
        event.completedBy.id,
      );

      // Get PRODUCTION users for the task's sector (if applicable)
      let productionUsers: string[] = [];
      if (event.task?.sectorId) {
        productionUsers = await this.getProductionUsersForSector(
          event.task.sectorId,
          event.completedBy.id,
        );
      }

      // Merge users (avoiding duplicates)
      const allTargetUsers = [...new Set([...targetUsers, ...productionUsers])];

      this.logger.log(`[CUT EVENT] Found ${allTargetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber ? ` (${event.task.serialNumber})` : '';

      for (const userId of allTargetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.CUT,
          'completed',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getCutNotificationMetadata(event.cut, event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.CUT,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: `Recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber} concluído por ${event.completedBy.name}`,
          body: `O recorte de ${cutTypeLabel} da tarefa "${taskName}"${serialNumber} foi concluído por ${event.completedBy.name}.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.cut.id,
          relatedEntityType: 'CUT',
          metadata,
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[CUT EVENT] Cut completed notification summary:');
      this.logger.log(`[CUT EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[CUT EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[CUT EVENT] ❌ Error handling cut completed event:', error.message);
    }
  }

  /**
   * Handle cut request created event (recut due to issues)
   * Notify: PLOTTING + ADMIN users with higher importance
   */
  private async handleCutRequestCreated(event: CutRequestCreatedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[CUT EVENT] Cut request created event received');
    this.logger.log(`[CUT EVENT] Cut ID: ${event.cut.id}`);
    this.logger.log(`[CUT EVENT] Reason: ${event.reason}`);
    this.logger.log(`[CUT EVENT] Parent Cut ID: ${event.parentCut?.id || 'N/A'}`);
    this.logger.log(`[CUT EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[CUT EVENT] Created By: ${event.createdBy.name} (${event.createdBy.id})`);
    this.logger.log('========================================');

    try {
      const targetUsers = await this.getTargetUsersForCutEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PLOTTING],
        event.createdBy.id,
      );

      this.logger.log(`[CUT EVENT] Found ${targetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const cutTypeLabel = CUT_TYPE_LABELS[event.cut.type] || 'Recorte';
      const reasonLabel = CUT_REQUEST_REASON_LABELS[event.reason] || 'Motivo não especificado';
      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber ? ` (${event.task.serialNumber})` : '';

      for (const userId of targetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.CUT,
          'request',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getCutNotificationMetadata(event.cut, event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.CUT,
          importance: NOTIFICATION_IMPORTANCE.URGENT,
          title: `Novo recorte de ${cutTypeLabel} solicitado para tarefa "${taskName}"${serialNumber} por ${event.createdBy.name} - Motivo: ${reasonLabel}`,
          body: `Foi solicitado um novo recorte de ${cutTypeLabel} para a tarefa "${taskName}"${serialNumber}. Motivo: ${reasonLabel}. Solicitado por ${event.createdBy.name}.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.cut.id,
          relatedEntityType: 'CUT',
          metadata,
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[CUT EVENT] Cut request notification summary:');
      this.logger.log(`[CUT EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[CUT EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[CUT EVENT] ❌ Error handling cut request created event:', error.message);
    }
  }

  /**
   * Handle cuts added to task event
   * Notify: PLOTTING + ADMIN users
   */
  private async handleCutsAddedToTask(event: CutsAddedToTaskEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[CUT EVENT] Cuts added to task event received');
    this.logger.log(`[CUT EVENT] Task ID: ${event.task.id}`);
    this.logger.log(`[CUT EVENT] Task Name: ${event.task.name}`);
    this.logger.log(`[CUT EVENT] Number of Cuts: ${event.cuts.length}`);
    this.logger.log(`[CUT EVENT] Added By: ${event.addedBy.name} (${event.addedBy.id})`);
    this.logger.log('========================================');

    try {
      const targetUsers = await this.getTargetUsersForCutEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PLOTTING],
        event.addedBy.id,
      );

      this.logger.log(`[CUT EVENT] Found ${targetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const cutsCount = event.cuts.length;
      const serialNumber = event.task.serialNumber ? ` (${event.task.serialNumber})` : '';

      for (const userId of targetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.CUT,
          'created',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        // Use task for navigation
        const { actionUrl, metadata } = this.getCutNotificationMetadata(event.cuts[0], event.task);
        const detailedTitle = cutsCount === 1
          ? `1 recorte adicionado à tarefa "${event.task.name}"${serialNumber} por ${event.addedBy.name}`
          : `${cutsCount} recortes adicionados à tarefa "${event.task.name}"${serialNumber} por ${event.addedBy.name}`;
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.CUT,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: detailedTitle,
          body: cutsCount === 1
            ? `1 recorte foi adicionado à tarefa "${event.task.name}"${serialNumber} por ${event.addedBy.name}.`
            : `${cutsCount} recortes foram adicionados à tarefa "${event.task.name}"${serialNumber} por ${event.addedBy.name}.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[CUT EVENT] Cuts added notification summary:');
      this.logger.log(`[CUT EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[CUT EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[CUT EVENT] ❌ Error handling cuts added to task event:', error.message);
    }
  }

  // =====================
  // Helper Methods - Target Users
  // =====================

  /**
   * Get target users for cut events
   * Excludes the user who performed the action (self-notification prevention)
   */
  private async getTargetUsersForCutEvent(
    allowedSectors: SECTOR_PRIVILEGES[],
    excludeUserId: string,
  ): Promise<string[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sector: {
            is: {
              privileges: {
                in: allowedSectors,
              },
            },
          },
          // Self-notification prevention: exclude the user who performed the action
          id: {
            not: excludeUserId,
          },
        },
        select: { id: true },
      });

      return users.map(user => user.id);
    } catch (error) {
      this.logger.error('Error getting target users for cut event:', error);
      return [];
    }
  }

  /**
   * Get PRODUCTION users for a specific sector
   * Used when cuts are started/completed for tasks in a production sector
   * Excludes the user who performed the action (self-notification prevention)
   */
  private async getProductionUsersForSector(
    sectorId: string,
    excludeUserId: string,
  ): Promise<string[]> {
    try {
      // Get the sector to check its privileges
      const sector = await this.prisma.sector.findUnique({
        where: { id: sectorId },
        select: { privileges: true },
      });

      // Only get PRODUCTION users if the sector has PRODUCTION privileges
      if (sector?.privileges !== SECTOR_PRIVILEGES.PRODUCTION) {
        return [];
      }

      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sectorId: sectorId,
          // Self-notification prevention
          id: {
            not: excludeUserId,
          },
        },
        select: { id: true },
      });

      return users.map(user => user.id);
    } catch (error) {
      this.logger.error('Error getting production users for sector:', error);
      return [];
    }
  }

  // =====================
  // Helper Methods - Channels
  // =====================

  /**
   * Get enabled channels for a user based on their preferences
   */
  private async getEnabledChannelsForUser(
    userId: string,
    notificationType: NOTIFICATION_TYPE,
    eventType: string,
  ): Promise<NOTIFICATION_CHANNEL[]> {
    try {
      const channels = await this.preferenceService.getChannelsForEvent(
        userId,
        notificationType,
        eventType,
      );

      if (channels.length > 0) {
        return channels;
      }

      // Default channels for cut notifications
      return [NOTIFICATION_CHANNEL.IN_APP];
    } catch (error) {
      this.logger.warn(`Error getting channels for user ${userId}, using defaults:`, error);
      return [NOTIFICATION_CHANNEL.IN_APP];
    }
  }

  // =====================
  // Helper Methods - Metadata
  // =====================

  /**
   * Get cut notification metadata including navigation URLs
   */
  private getCutNotificationMetadata(cut: any, task: any | null): { actionUrl: string; metadata: any } {
    // If there's a task, navigate to the task details
    // Otherwise, navigate to the plotter page
    const webUrl = task
      ? `/producao/cronograma/detalhes/${task.id}`
      : '/producao/plotter';

    // CRITICAL FIX: Store actionUrl as JSON string so the queue processor
    // can extract mobileUrl directly via parseActionUrl().
    // Generate deep links for mobile and universal linking when there's a task
    const deepLinks = task
      ? this.deepLinkService.generateTaskLinks(task.id)
      : { web: webUrl, mobile: '', universalLink: '' };

    return {
      actionUrl: JSON.stringify(deepLinks),
      metadata: {
        webUrl,
        mobileUrl: deepLinks.mobile,
        universalLink: deepLinks.universalLink,
        entityType: task ? 'Task' : null,
        entityId: task?.id || null,
        cut: {
          id: cut.id,
          taskId: task?.id || null,
          taskSectorId: task?.sectorId || null,
          type: cut.type,
          origin: cut.origin,
          reason: cut.reason || null,
          status: cut.status,
          createdById: cut.createdById || null,
        },
        taskId: task?.id,
        taskName: task?.name,
        taskSerialNumber: task?.serialNumber,
      },
    };
  }
}
