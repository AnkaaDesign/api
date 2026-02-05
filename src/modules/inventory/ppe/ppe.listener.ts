import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationService } from '@modules/common/notification/notification.service';
import { NotificationPreferenceService } from '@modules/common/notification/notification-preference.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PpeSignatureService } from './ppe-signature.service';
import {
  PpeRequestedEvent,
  PpeApprovedEvent,
  PpeRejectedEvent,
  PpeDeliveredEvent,
  PpeBatchDeliveredEvent,
} from './ppe.events';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ACTION_TYPE,
  SECTOR_PRIVILEGES,
} from '../../../constants/enums';

/**
 * PPE Event Listener
 * Handles all PPE delivery-related events and creates appropriate notifications
 *
 * Notification flow:
 * 1. User requests PPE → ADMIN, HR receive notification
 * 2. Admin approves → User + WAREHOUSE receive notification
 * 3. Admin rejects → User receives notification
 * 4. Warehouse delivers → User receives notification
 *
 * Self-notification prevention:
 * - Users who perform an action do NOT receive the notification for that action
 */
@Injectable()
export class PpeListener {
  private readonly logger = new Logger(PpeListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PpeSignatureService))
    private readonly ppeSignatureService: PpeSignatureService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[PPE LISTENER] Initializing PPE Event Listener');
    this.logger.log('[PPE LISTENER] Registering event handlers...');

    // Register event listeners
    this.eventEmitter.on('ppe.requested', this.handlePpeRequested.bind(this));
    this.logger.log('[PPE LISTENER] ✅ Registered: ppe.requested');

    this.eventEmitter.on('ppe.approved', this.handlePpeApproved.bind(this));
    this.logger.log('[PPE LISTENER] ✅ Registered: ppe.approved');

    this.eventEmitter.on('ppe.rejected', this.handlePpeRejected.bind(this));
    this.logger.log('[PPE LISTENER] ✅ Registered: ppe.rejected');

    this.eventEmitter.on('ppe.delivered', this.handlePpeDelivered.bind(this));
    this.logger.log('[PPE LISTENER] ✅ Registered: ppe.delivered');

    this.eventEmitter.on('ppe.batch.delivered', this.handlePpeBatchDelivered.bind(this));
    this.logger.log('[PPE LISTENER] ✅ Registered: ppe.batch.delivered');

    this.logger.log('[PPE LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle PPE requested event
   * Notify: ADMIN + HUMAN_RESOURCES users
   */
  private async handlePpeRequested(event: PpeRequestedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[PPE EVENT] PPE requested event received');
    this.logger.log(`[PPE EVENT] Delivery ID: ${event.delivery.id}`);
    this.logger.log(`[PPE EVENT] Item: ${event.item.name}`);
    this.logger.log(
      `[PPE EVENT] Requested By: ${event.requestedBy.name} (${event.requestedBy.id})`,
    );
    this.logger.log('========================================');

    try {
      // Get ADMIN and HR users (excluding the requester)
      const targetUsers = await this.getUsersByPrivileges(
        [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES],
        event.requestedBy.id,
      );

      this.logger.log(`[PPE EVENT] Found ${targetUsers.length} target user(s)`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const itemName = event.item.name;
      const quantity = event.delivery.quantity || 1;
      const quantityLabel = quantity > 1 ? `${quantity} unidades de ` : '';

      for (const userId of targetUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.PPE,
          'requested',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.PPE,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: 'Nova Solicitação de EPI',
          body: `${event.requestedBy.name} solicitou ${quantityLabel}"${itemName}". Aguardando aprovação.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: `/estoque/epi/entregas/${event.delivery.id}`,
          relatedEntityId: event.delivery.id,
          relatedEntityType: 'PPE_DELIVERY',
          metadata: {
            webUrl: `/estoque/epi/entregas/${event.delivery.id}`,
            deliveryId: event.delivery.id,
            itemId: event.item.id,
            itemName: event.item.name,
            requestedById: event.requestedBy.id,
            requestedByName: event.requestedBy.name,
            quantity: event.delivery.quantity,
          },
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[PPE EVENT] PPE request notification summary:');
      this.logger.log(`[PPE EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[PPE EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[PPE EVENT] ❌ Error handling PPE requested event:', error.message);
    }
  }

  /**
   * Handle PPE approved event
   * Notify: The user who requested + WAREHOUSE users
   */
  private async handlePpeApproved(event: PpeApprovedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[PPE EVENT] PPE approved event received');
    this.logger.log(`[PPE EVENT] Delivery ID: ${event.delivery.id}`);
    this.logger.log(`[PPE EVENT] Item: ${event.item.name}`);
    this.logger.log(`[PPE EVENT] Requested By: ${event.requestedBy.name}`);
    this.logger.log(`[PPE EVENT] Approved By: ${event.approvedBy.name} (${event.approvedBy.id})`);
    this.logger.log('========================================');

    try {
      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const itemName = event.item.name;
      const quantity = event.delivery.quantity || 1;
      const quantityLabel = quantity > 1 ? `${quantity} unidades de ` : '';

      // 1. Notify the user who requested (high importance - their request was approved)
      if (event.requestedBy.id !== event.approvedBy.id) {
        const userChannels = await this.getEnabledChannelsForUser(
          event.requestedBy.id,
          NOTIFICATION_TYPE.PPE,
          'approved',
        );

        if (userChannels.length > 0) {
          await this.notificationService.createNotification({
            userId: event.requestedBy.id,
            type: NOTIFICATION_TYPE.PPE,
            importance: NOTIFICATION_IMPORTANCE.HIGH,
            title: 'Solicitação de EPI Aprovada',
            body: `Sua solicitação de ${quantityLabel}"${itemName}" foi aprovada por ${event.approvedBy.name}. Aguarde a entrega pelo almoxarifado.`,
            actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
            actionUrl: `/estoque/epi/entregas/${event.delivery.id}`,
            relatedEntityId: event.delivery.id,
            relatedEntityType: 'PPE_DELIVERY',
            metadata: {
              webUrl: `/estoque/epi/entregas/${event.delivery.id}`,
              deliveryId: event.delivery.id,
              itemId: event.item.id,
              itemName: event.item.name,
              approvedById: event.approvedBy.id,
              approvedByName: event.approvedBy.name,
              quantity: event.delivery.quantity,
            },
            channel: userChannels,
          });
          notificationsCreated++;
        } else {
          notificationsSkipped++;
        }
      }

      // 2. Notify WAREHOUSE users (they need to prepare for delivery)
      const warehouseUsers = await this.getUsersByPrivileges(
        [SECTOR_PRIVILEGES.WAREHOUSE],
        event.approvedBy.id,
      );

      for (const userId of warehouseUsers) {
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.PPE,
          'approved',
        );

        if (channels.length === 0) {
          notificationsSkipped++;
          continue;
        }

        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.PPE,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: 'EPI Aprovado para Entrega',
          body: `${quantityLabel}"${itemName}" aprovado para ${event.requestedBy.name}. Por favor, realize a entrega.`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: `/estoque/epi/entregas/${event.delivery.id}`,
          relatedEntityId: event.delivery.id,
          relatedEntityType: 'PPE_DELIVERY',
          metadata: {
            webUrl: `/estoque/epi/entregas/${event.delivery.id}`,
            deliveryId: event.delivery.id,
            itemId: event.item.id,
            itemName: event.item.name,
            requestedById: event.requestedBy.id,
            requestedByName: event.requestedBy.name,
            quantity: event.delivery.quantity,
          },
          channel: channels,
        });
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[PPE EVENT] PPE approved notification summary:');
      this.logger.log(`[PPE EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[PPE EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[PPE EVENT] ❌ Error handling PPE approved event:', error.message);
    }
  }

  /**
   * Handle PPE rejected event
   * Notify: The user who requested
   */
  private async handlePpeRejected(event: PpeRejectedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[PPE EVENT] PPE rejected event received');
    this.logger.log(`[PPE EVENT] Delivery ID: ${event.delivery.id}`);
    this.logger.log(`[PPE EVENT] Item: ${event.item.name}`);
    this.logger.log(`[PPE EVENT] Requested By: ${event.requestedBy.name}`);
    this.logger.log(`[PPE EVENT] Rejected By: ${event.rejectedBy.name} (${event.rejectedBy.id})`);
    this.logger.log(`[PPE EVENT] Reason: ${event.reason || 'Não informado'}`);
    this.logger.log('========================================');

    try {
      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const itemName = event.item.name;
      const reasonText = event.reason ? ` Motivo: ${event.reason}.` : '';

      // Only notify the user who requested (if they're not the one who rejected)
      if (event.requestedBy.id !== event.rejectedBy.id) {
        const channels = await this.getEnabledChannelsForUser(
          event.requestedBy.id,
          NOTIFICATION_TYPE.PPE,
          'rejected',
        );

        if (channels.length > 0) {
          await this.notificationService.createNotification({
            userId: event.requestedBy.id,
            type: NOTIFICATION_TYPE.PPE,
            importance: NOTIFICATION_IMPORTANCE.HIGH,
            title: 'Solicitação de EPI Reprovada',
            body: `Sua solicitação de "${itemName}" foi reprovada por ${event.rejectedBy.name}.${reasonText}`,
            actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
            actionUrl: `/estoque/epi/entregas/${event.delivery.id}`,
            relatedEntityId: event.delivery.id,
            relatedEntityType: 'PPE_DELIVERY',
            metadata: {
              webUrl: `/estoque/epi/entregas/${event.delivery.id}`,
              deliveryId: event.delivery.id,
              itemId: event.item.id,
              itemName: event.item.name,
              rejectedById: event.rejectedBy.id,
              rejectedByName: event.rejectedBy.name,
              reason: event.reason,
            },
            channel: channels,
          });
          notificationsCreated++;
        } else {
          notificationsSkipped++;
        }
      }

      this.logger.log('========================================');
      this.logger.log('[PPE EVENT] PPE rejected notification summary:');
      this.logger.log(`[PPE EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[PPE EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[PPE EVENT] ❌ Error handling PPE rejected event:', error.message);
    }
  }

  /**
   * Handle PPE delivered event
   * Notify: The user who receives the PPE
   */
  private async handlePpeDelivered(event: PpeDeliveredEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[PPE EVENT] PPE delivered event received');
    this.logger.log(`[PPE EVENT] Delivery ID: ${event.delivery.id}`);
    this.logger.log(`[PPE EVENT] Item: ${event.item.name}`);
    this.logger.log(
      `[PPE EVENT] Delivered To: ${event.deliveredTo.name} (${event.deliveredTo.id})`,
    );
    this.logger.log(
      `[PPE EVENT] Delivered By: ${event.deliveredBy.name} (${event.deliveredBy.id})`,
    );
    this.logger.log('========================================');

    try {
      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      const itemName = event.item.name;
      const quantity = event.delivery.quantity || 1;
      const quantityLabel = quantity > 1 ? `${quantity} unidades de ` : '';

      // Notify the user who received the PPE (if they're not the one who marked it as delivered)
      if (event.deliveredTo.id !== event.deliveredBy.id) {
        const channels = await this.getEnabledChannelsForUser(
          event.deliveredTo.id,
          NOTIFICATION_TYPE.PPE,
          'delivered',
        );

        if (channels.length > 0) {
          await this.notificationService.createNotification({
            userId: event.deliveredTo.id,
            type: NOTIFICATION_TYPE.PPE,
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            title: 'EPI Entregue',
            body: `${quantityLabel}"${itemName}" foi entregue a você por ${event.deliveredBy.name}.`,
            actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
            actionUrl: `/estoque/epi/entregas/${event.delivery.id}`,
            relatedEntityId: event.delivery.id,
            relatedEntityType: 'PPE_DELIVERY',
            metadata: {
              webUrl: `/estoque/epi/entregas/${event.delivery.id}`,
              deliveryId: event.delivery.id,
              itemId: event.item.id,
              itemName: event.item.name,
              deliveredById: event.deliveredBy.id,
              deliveredByName: event.deliveredBy.name,
              quantity: event.delivery.quantity,
            },
            channel: channels,
          });
          notificationsCreated++;
        } else {
          notificationsSkipped++;
        }
      }

      this.logger.log('========================================');
      this.logger.log('[PPE EVENT] PPE delivered notification summary:');
      this.logger.log(`[PPE EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[PPE EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');

      // Note: Signature workflow is handled by the batch event (ppe.batch.delivered)
      // to avoid duplicate signature requests
    } catch (error) {
      this.logger.error('[PPE EVENT] ❌ Error handling PPE delivered event:', error.message);
    }
  }

  /**
   * Handle PPE batch delivered event
   * Initiates signature workflow for multiple deliveries (grouped by user)
   */
  private async handlePpeBatchDelivered(event: PpeBatchDeliveredEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[PPE EVENT] PPE batch delivered event received');
    this.logger.log(`[PPE EVENT] Delivery IDs: ${event.deliveryIds.join(', ')}`);
    this.logger.log(`[PPE EVENT] Total: ${event.deliveryIds.length} deliveries`);
    this.logger.log('========================================');

    try {
      // Initiate signature for batch (will be grouped by user automatically)
      await this.initiateSignatureForDeliveries(event.deliveryIds);

      this.logger.log('========================================');
      this.logger.log('[PPE EVENT] PPE batch delivered processed successfully');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[PPE EVENT] ❌ Error handling PPE batch delivered event:', error.message);
    }
  }

  /**
   * Initiate signature workflow for delivered PPE(s)
   * Groups deliveries by user and creates one signature request per user
   */
  private async initiateSignatureForDeliveries(deliveryIds: string[]): Promise<void> {
    if (!this.ppeSignatureService.isClickSignAvailable()) {
      this.logger.log('[PPE EVENT] ClickSign not configured - skipping signature workflow');
      return;
    }

    try {
      this.logger.log(
        `[PPE EVENT] Initiating signature workflow for ${deliveryIds.length} deliveries`,
      );

      const result = await this.ppeSignatureService.initiateSignatureForDeliveries({
        deliveryIds,
      });

      if (result.success) {
        this.logger.log('[PPE EVENT] ✅ Signature workflow initiated successfully');
        for (const r of result.results) {
          if (r.signatureResult) {
            this.logger.log(
              `[PPE EVENT]   - User ${r.userId}: Envelope ${r.signatureResult.envelopeId}`,
            );
          }
        }
      } else {
        this.logger.warn('[PPE EVENT] ⚠️ Some signature initiations failed');
        for (const r of result.results) {
          if (r.error) {
            this.logger.warn(`[PPE EVENT]   - User ${r.userId}: ${r.error}`);
          }
        }
      }
    } catch (error) {
      this.logger.error('[PPE EVENT] ❌ Error initiating signature workflow:', error);
      // Don't throw - signature is not critical for delivery
    }
  }

  // =====================
  // Helper Methods
  // =====================

  /**
   * Get users by sector privileges
   * Excludes a specific user (for self-notification prevention)
   */
  private async getUsersByPrivileges(
    privileges: SECTOR_PRIVILEGES[],
    excludeUserId: string,
  ): Promise<string[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sector: {
            is: {
              privileges: {
                in: privileges,
              },
            },
          },
          id: {
            not: excludeUserId,
          },
        },
        select: { id: true },
      });

      return users.map(user => user.id);
    } catch (error) {
      this.logger.error('Error getting users by privileges:', error);
      return [];
    }
  }

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

      // Default channels for PPE notifications
      return [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH];
    } catch (error) {
      this.logger.warn(`Error getting channels for user ${userId}, using defaults:`, error);
      return [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH];
    }
  }
}
