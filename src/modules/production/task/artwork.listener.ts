import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationService } from '@modules/common/notification/notification.service';
import { NotificationPreferenceService } from '@modules/common/notification/notification-preference.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ArtworkApprovedEvent,
  ArtworkReprovedEvent,
  ArtworkPendingApprovalReminderEvent,
} from './artwork.events';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ACTION_TYPE,
  SECTOR_PRIVILEGES,
} from '../../../constants/enums';

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
 * with role-based targeting and multi-channel delivery
 *
 * Notification targets:
 * - COMMERCIAL + ADMIN: Receives approval/rejection notifications (they approve artworks)
 * - DESIGNER: Receives notifications about artwork status changes
 * - PRODUCTION: Receives notifications when artworks are approved (ready for production)
 *
 * Self-notification prevention:
 * - Users who perform an action do NOT receive the notification for that action
 */
@Injectable()
export class ArtworkListener {
  private readonly logger = new Logger(ArtworkListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
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
    this.logger.log('[ARTWORK LISTENER] ✅ Registered: artwork.approved');

    this.eventEmitter.on('artwork.reproved', this.handleArtworkReproved.bind(this));
    this.logger.log('[ARTWORK LISTENER] ✅ Registered: artwork.reproved');

    this.eventEmitter.on(
      'artwork.pending_approval_reminder',
      this.handleArtworkPendingApprovalReminder.bind(this),
    );
    this.logger.log('[ARTWORK LISTENER] ✅ Registered: artwork.pending_approval_reminder');

    this.logger.log('[ARTWORK LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle artwork approved event
   * Notify: DESIGNER + PRODUCTION users (artwork is ready)
   */
  private async handleArtworkApproved(event: ArtworkApprovedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[ARTWORK EVENT] Artwork approved event received');
    this.logger.log(`[ARTWORK EVENT] Artwork ID: ${event.artwork.id}`);
    this.logger.log(`[ARTWORK EVENT] Task ID: ${event.task?.id || 'N/A'}`);
    this.logger.log(`[ARTWORK EVENT] Approved By: ${event.approvedBy.name} (${event.approvedBy.id})`);
    this.logger.log('========================================');

    try {
      // Notify DESIGNER and PRODUCTION users that artwork is approved
      const targetUsers = await this.getTargetUsersForArtworkEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.PRODUCTION],
        event.approvedBy.id,
      );

      this.logger.log(`[ARTWORK EVENT] Found ${targetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber ? `#${event.task.serialNumber}` : '';

      for (const userId of targetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.PRODUCTION,
          'artwork.approved',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getArtworkNotificationMetadata(
          event.artwork,
          event.task,
        );

        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.PRODUCTION,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: `Arte aprovada: "${taskName}" ${serialNumber}`,
          body: `A arte da tarefa "${taskName}" ${serialNumber} foi aprovada por ${event.approvedBy.name}. Pronta para produção.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.task?.id || event.artwork.id,
          relatedEntityType: event.task ? 'TASK' : 'ARTWORK',
          metadata,
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[ARTWORK EVENT] Artwork approved notification summary:');
      this.logger.log(`[ARTWORK EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[ARTWORK EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[ARTWORK EVENT] ❌ Error handling artwork approved event:', error.message);
    }
  }

  /**
   * Handle artwork reproved (rejected) event
   * Notify: DESIGNER users (they need to fix the artwork)
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
      // Notify DESIGNER and ADMIN users that artwork was rejected
      const targetUsers = await this.getTargetUsersForArtworkEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.DESIGNER],
        event.reprovedBy.id,
      );

      this.logger.log(`[ARTWORK EVENT] Found ${targetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber ? `#${event.task.serialNumber}` : '';
      const reasonText = event.reason ? ` Motivo: ${event.reason}` : '';

      for (const userId of targetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.PRODUCTION,
          'artwork.reproved',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getArtworkNotificationMetadata(
          event.artwork,
          event.task,
        );

        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.PRODUCTION,
          importance: NOTIFICATION_IMPORTANCE.HIGH,
          title: `Arte reprovada: "${taskName}" ${serialNumber}`,
          body: `A arte da tarefa "${taskName}" ${serialNumber} foi reprovada por ${event.reprovedBy.name}.${reasonText} Uma nova versão é necessária.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.task?.id || event.artwork.id,
          relatedEntityType: event.task ? 'TASK' : 'ARTWORK',
          metadata: {
            ...metadata,
            rejectionReason: event.reason,
          },
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[ARTWORK EVENT] Artwork reproved notification summary:');
      this.logger.log(`[ARTWORK EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[ARTWORK EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[ARTWORK EVENT] ❌ Error handling artwork reproved event:', error.message);
    }
  }

  /**
   * Handle artwork pending approval reminder event
   * Notify: COMMERCIAL + ADMIN users (reminder to approve)
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
      // Notify COMMERCIAL and ADMIN users about pending artwork
      const targetUsers = await this.getTargetUsersForArtworkEvent(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL],
        '', // No user to exclude
      );

      this.logger.log(`[ARTWORK EVENT] Found ${targetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const taskName = event.task?.name || 'Sem tarefa';
      const serialNumber = event.task?.serialNumber ? `#${event.task.serialNumber}` : '';
      const daysText = event.daysPending === 1 ? '1 dia' : `${event.daysPending} dias`;

      for (const userId of targetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.PRODUCTION,
          'artwork.pending_approval_reminder',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getArtworkNotificationMetadata(
          event.artwork,
          event.task,
        );

        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.PRODUCTION,
          importance: event.daysPending >= 3 ? NOTIFICATION_IMPORTANCE.HIGH : NOTIFICATION_IMPORTANCE.NORMAL,
          title: `Lembrete: Arte aguardando aprovação há ${daysText}`,
          body: `A arte da tarefa "${taskName}" ${serialNumber} está aguardando aprovação há ${daysText}. Por favor, revise e aprove ou reprove a arte.`,
          actionType: NOTIFICATION_ACTION_TYPE.APPROVE_REQUEST,
          actionUrl,
          relatedEntityId: event.task?.id || event.artwork.id,
          relatedEntityType: event.task ? 'TASK' : 'ARTWORK',
          metadata: {
            ...metadata,
            daysPending: event.daysPending,
          },
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[ARTWORK EVENT] Artwork pending approval reminder notification summary:');
      this.logger.log(`[ARTWORK EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[ARTWORK EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error(
        '[ARTWORK EVENT] ❌ Error handling artwork pending approval reminder event:',
        error.message,
      );
    }
  }

  // =====================
  // Helper Methods - Target Users
  // =====================

  /**
   * Get target users for artwork events
   * Excludes the user who performed the action (self-notification prevention)
   */
  private async getTargetUsersForArtworkEvent(
    allowedSectors: SECTOR_PRIVILEGES[],
    excludeUserId: string,
  ): Promise<string[]> {
    try {
      const whereClause: any = {
        isActive: true,
        sector: {
          is: {
            privileges: {
              in: allowedSectors,
            },
          },
        },
      };

      // Only add exclusion if there's a user to exclude
      if (excludeUserId) {
        whereClause.id = { not: excludeUserId };
      }

      const users = await this.prisma.user.findMany({
        where: whereClause,
        select: { id: true },
      });

      return users.map(user => user.id);
    } catch (error) {
      this.logger.error('Error getting target users for artwork event:', error);
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

      // Default channels for artwork notifications
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
   * Get artwork notification metadata including navigation URLs
   */
  private getArtworkNotificationMetadata(
    artwork: any,
    task: any | null,
  ): { actionUrl: string; metadata: any } {
    // Navigate to task details if there's a task, otherwise to a generic page
    const webUrl = task ? `/producao/cronograma/detalhes/${task.id}` : '/producao/tarefas';

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
        entityType: task ? 'Task' : 'Artwork',
        entityId: task?.id || artwork.id,
        artwork: {
          id: artwork.id,
          fileId: artwork.fileId,
          status: artwork.status,
          taskId: task?.id || null,
          airbrushingId: artwork.airbrushingId || null,
        },
        taskId: task?.id,
        taskName: task?.name,
        taskSerialNumber: task?.serialNumber,
      },
    };
  }
}
