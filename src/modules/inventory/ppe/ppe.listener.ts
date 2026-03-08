import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PPE_DELIVERY_STATUS, PPE_DELIVERY_STATUS_ORDER } from '@constants';
import {
  PpeRequestedEvent,
  PpeApprovedEvent,
  PpeRejectedEvent,
  PpeDeliveredEvent,
  PpeBatchDeliveredEvent,
} from './ppe.events';

/**
 * PPE Event Listener
 * Handles all PPE delivery-related events and dispatches notifications using
 * database configuration-based approach (checks config enablement + user preferences).
 *
 * Config keys:
 * - ppe.requested  (sector-based: ADMIN + HUMAN_RESOURCES)
 * - ppe.approved   (targeted: the requester)
 * - ppe.rejected   (targeted: the requester)
 * - ppe.delivered   (targeted: the deliveredTo user)
 * - ppe.batch.delivered (no notification — signature workflow only)
 *
 * Self-notification prevention:
 * - The dispatch service automatically excludes the triggering user from recipients
 */
@Injectable()
export class PpeListener {
  private readonly logger = new Logger(PpeListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[PPE LISTENER] Initializing PPE Event Listener');
    this.logger.log('[PPE LISTENER] Registering event handlers...');

    // Register event listeners
    this.eventEmitter.on('ppe.requested', this.handlePpeRequested.bind(this));
    this.logger.log('[PPE LISTENER] Registered: ppe.requested');

    this.eventEmitter.on('ppe.approved', this.handlePpeApproved.bind(this));
    this.logger.log('[PPE LISTENER] Registered: ppe.approved');

    this.eventEmitter.on('ppe.rejected', this.handlePpeRejected.bind(this));
    this.logger.log('[PPE LISTENER] Registered: ppe.rejected');

    this.eventEmitter.on('ppe.delivered', this.handlePpeDelivered.bind(this));
    this.logger.log('[PPE LISTENER] Registered: ppe.delivered');

    this.eventEmitter.on('ppe.batch.delivered', this.handlePpeBatchDelivered.bind(this));
    this.logger.log('[PPE LISTENER] Registered: ppe.batch.delivered');

    this.logger.log('[PPE LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle PPE requested event
   * Notify: ADMIN + HUMAN_RESOURCES users (sector-based via config)
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
      const itemName = event.item.name;
      const quantity = event.delivery.quantity || 1;
      const quantityLabel = quantity > 1 ? `${quantity} unidades de ` : '';
      const webUrl = `/estoque/epi/entregas/${event.delivery.id}`;

      await this.dispatchService.dispatchByConfiguration(
        'ppe.requested',
        event.requestedBy.id,
        {
          entityType: 'PPE_DELIVERY',
          entityId: event.delivery.id,
          action: 'requested',
          data: {
            itemName,
            requestedByName: event.requestedBy.name,
            quantity,
            quantityLabel,
          },
          metadata: {
            deliveryId: event.delivery.id,
            itemId: event.item.id,
            itemName,
            requestedById: event.requestedBy.id,
            requestedByName: event.requestedBy.name,
            quantity: event.delivery.quantity,
          },
          overrides: {
            actionUrl: JSON.stringify({ web: webUrl, mobile: '', universalLink: '' }),
            webUrl,
            relatedEntityType: 'PPE_DELIVERY',
            title: 'Nova Solicitacao de EPI',
            body: `${event.requestedBy.name} solicitou ${quantityLabel}"${itemName}". Aguardando aprovacao.`,
          },
        },
      );

      this.logger.log('[PPE EVENT] PPE requested dispatch completed');
    } catch (error) {
      this.logger.error('[PPE EVENT] Error handling PPE requested event:', error.message);
    }
  }

  /**
   * Handle PPE approved event
   * Notify: The user who requested (targeted dispatch)
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
      const itemName = event.item.name;
      const quantity = event.delivery.quantity || 1;
      const quantityLabel = quantity > 1 ? `${quantity} unidades de ` : '';
      const webUrl = `/estoque/epi/entregas/${event.delivery.id}`;

      // Notify the requester that their request was approved
      await this.dispatchService.dispatchByConfigurationToUsers(
        'ppe.approved',
        event.approvedBy.id,
        {
          entityType: 'PPE_DELIVERY',
          entityId: event.delivery.id,
          action: 'approved',
          data: {
            itemName,
            approvedByName: event.approvedBy.name,
            requestedByName: event.requestedBy.name,
            quantity,
            quantityLabel,
          },
          metadata: {
            deliveryId: event.delivery.id,
            itemId: event.item.id,
            itemName,
            approvedById: event.approvedBy.id,
            approvedByName: event.approvedBy.name,
            quantity: event.delivery.quantity,
          },
          overrides: {
            actionUrl: JSON.stringify({ web: webUrl, mobile: '', universalLink: '' }),
            webUrl,
            relatedEntityType: 'PPE_DELIVERY',
            title: 'Solicitacao de EPI Aprovada',
            body: `Sua solicitacao de ${quantityLabel}"${itemName}" foi aprovada por ${event.approvedBy.name}. Aguarde a entrega pelo almoxarifado.`,
          },
        },
        [event.requestedBy.id],
      );

      this.logger.log('[PPE EVENT] PPE approved dispatch completed');
    } catch (error) {
      this.logger.error('[PPE EVENT] Error handling PPE approved event:', error.message);
    }
  }

  /**
   * Handle PPE rejected event
   * Notify: The user who requested (targeted dispatch)
   */
  private async handlePpeRejected(event: PpeRejectedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[PPE EVENT] PPE rejected event received');
    this.logger.log(`[PPE EVENT] Delivery ID: ${event.delivery.id}`);
    this.logger.log(`[PPE EVENT] Item: ${event.item.name}`);
    this.logger.log(`[PPE EVENT] Requested By: ${event.requestedBy.name}`);
    this.logger.log(`[PPE EVENT] Rejected By: ${event.rejectedBy.name} (${event.rejectedBy.id})`);
    this.logger.log('========================================');

    try {
      const itemName = event.item.name;
      const webUrl = `/estoque/epi/entregas/${event.delivery.id}`;

      await this.dispatchService.dispatchByConfigurationToUsers(
        'ppe.rejected',
        event.rejectedBy.id,
        {
          entityType: 'PPE_DELIVERY',
          entityId: event.delivery.id,
          action: 'rejected',
          data: {
            itemName,
            rejectedByName: event.rejectedBy.name,
            requestedByName: event.requestedBy.name,
          },
          metadata: {
            deliveryId: event.delivery.id,
            itemId: event.item.id,
            itemName,
            rejectedById: event.rejectedBy.id,
            rejectedByName: event.rejectedBy.name,
          },
          overrides: {
            actionUrl: JSON.stringify({ web: webUrl, mobile: '', universalLink: '' }),
            webUrl,
            relatedEntityType: 'PPE_DELIVERY',
            title: 'Solicitacao de EPI Reprovada',
            body: `Sua solicitacao de "${itemName}" foi reprovada por ${event.rejectedBy.name}.`,
          },
        },
        [event.requestedBy.id],
      );

      this.logger.log('[PPE EVENT] PPE rejected dispatch completed');
    } catch (error) {
      this.logger.error('[PPE EVENT] Error handling PPE rejected event:', error.message);
    }
  }

  /**
   * Handle PPE delivered event
   * Notify: The user who receives the PPE (targeted dispatch)
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
      const itemName = event.item.name;
      const quantity = event.delivery.quantity || 1;
      const quantityLabel = quantity > 1 ? `${quantity} unidades de ` : '';
      const webUrl = `/estoque/epi/entregas/${event.delivery.id}`;

      await this.dispatchService.dispatchByConfigurationToUsers(
        'ppe.delivered',
        event.deliveredBy.id,
        {
          entityType: 'PPE_DELIVERY',
          entityId: event.delivery.id,
          action: 'delivered',
          data: {
            itemName,
            deliveredByName: event.deliveredBy.name,
            deliveredToName: event.deliveredTo.name,
            quantity,
            quantityLabel,
          },
          metadata: {
            deliveryId: event.delivery.id,
            itemId: event.item.id,
            itemName,
            deliveredById: event.deliveredBy.id,
            deliveredByName: event.deliveredBy.name,
            quantity: event.delivery.quantity,
          },
          overrides: {
            actionUrl: JSON.stringify({ web: webUrl, mobile: '', universalLink: '' }),
            webUrl,
            relatedEntityType: 'PPE_DELIVERY',
            title: 'Confirme o Recebimento do EPI',
            body: `${quantityLabel}"${itemName}" foi entregue a voce por ${event.deliveredBy.name}. Abra o app e confirme o recebimento com sua biometria.`,
          },
        },
        [event.deliveredTo.id],
      );

      this.logger.log('[PPE EVENT] PPE delivered dispatch completed');

      // Initiate signature workflow for single delivery (same as batch handler)
      await this.initiateSignatureForDeliveries([event.delivery.id]);
    } catch (error) {
      this.logger.error('[PPE EVENT] Error handling PPE delivered event:', error.message);
    }
  }

  /**
   * Handle PPE batch delivered event
   * Initiates signature workflow for multiple deliveries (grouped by user)
   * No notification dispatch — signature workflow only
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

      // Send notifications to affected users
      await this.sendBatchDeliveredNotifications(event.deliveryIds, event.deliveredBy);

      this.logger.log('========================================');
      this.logger.log('[PPE EVENT] PPE batch delivered processed successfully');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[PPE EVENT] Error handling PPE batch delivered event:', error.message);
    }
  }

  /**
   * Initiate in-app signature workflow for delivered PPE(s)
   * Transitions deliveries to WAITING_SIGNATURE status.
   */
  private async initiateSignatureForDeliveries(deliveryIds: string[]): Promise<void> {
    this.logger.log(
      `[PPE EVENT] Using in-app signature flow for ${deliveryIds.length} deliveries`,
    );

    try {
      await this.prisma.ppeDelivery.updateMany({
        where: { id: { in: deliveryIds } },
        data: {
          status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE,
          statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.WAITING_SIGNATURE],
        },
      });

      this.logger.log(
        `[PPE EVENT] Updated ${deliveryIds.length} deliveries to WAITING_SIGNATURE for in-app signing`,
      );
    } catch (error) {
      this.logger.error('[PPE EVENT] Error transitioning deliveries to WAITING_SIGNATURE:', error);
    }
  }

  /**
   * Send notifications for batch-delivered PPEs (in-app signing flow only).
   * Fetches delivery details, groups by user, and sends one notification per user.
   */
  private async sendBatchDeliveredNotifications(
    deliveryIds: string[],
    deliveredBy: { id: string; name: string },
  ): Promise<void> {
    try {
      const deliveries = await this.prisma.ppeDelivery.findMany({
        where: { id: { in: deliveryIds } },
        include: { user: true, item: true },
      });

      // Group by userId
      const byUser = new Map<string, typeof deliveries>();
      for (const d of deliveries) {
        const list = byUser.get(d.userId) || [];
        list.push(d);
        byUser.set(d.userId, list);
      }

      for (const [userId, userDeliveries] of byUser) {
        const count = userDeliveries.length;
        const itemNames = userDeliveries
          .map(d => (d.item as any)?.name || 'EPI')
          .slice(0, 3)
          .join(', ');
        const webUrl = `/estoque/epi/entregas/${userDeliveries[0].id}`;

        await this.dispatchService.dispatchByConfigurationToUsers(
          'ppe.delivered',
          deliveredBy.id,
          {
            entityType: 'PPE_DELIVERY',
            entityId: userDeliveries[0].id,
            action: 'delivered',
            data: {
              itemNames,
              deliveredByName: deliveredBy.name,
              count,
            },
            metadata: {
              deliveryIds: userDeliveries.map(d => d.id),
              deliveredById: deliveredBy.id,
              deliveredByName: deliveredBy.name,
              count,
            },
            overrides: {
              actionUrl: JSON.stringify({ web: webUrl, mobile: '', universalLink: '' }),
              webUrl,
              relatedEntityType: 'PPE_DELIVERY',
              title: 'Confirme o Recebimento de EPI',
              body: count > 1
                ? `${count} EPIs foram entregues a voce por ${deliveredBy.name}. Abra o app e confirme o recebimento.`
                : `"${itemNames}" foi entregue a voce por ${deliveredBy.name}. Abra o app e confirme o recebimento com sua biometria.`,
            },
          },
          [userId],
        );
      }

      this.logger.log(`[PPE EVENT] Sent batch delivered notifications to ${byUser.size} users`);
    } catch (error) {
      this.logger.error('[PPE EVENT] Error sending batch delivered notifications:', error);
    }
  }
}
