import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '@modules/common/notification/notification.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ACTION_TYPE,
  SECTOR_PRIVILEGES,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
} from '../../../constants/enums';
import { SERVICE_ORDER_STATUS_LABELS } from '../../../constants/enum-labels';

/**
 * Service Order Event Listener
 * Handles all service order-related events and creates appropriate notifications
 */
@Injectable()
export class ServiceOrderListener {
  private readonly logger = new Logger(ServiceOrderListener.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[SERVICE ORDER LISTENER] Initializing Service Order Event Listener');
    this.logger.log('[SERVICE ORDER LISTENER] Event handlers will be registered via decorators');
    this.logger.log('========================================');
  }

  /**
   * Handle service order creation event
   * Currently just logs - notification is handled by assignment event if assigned
   */
  @OnEvent('service-order.created')
  async handleServiceOrderCreated(payload: any): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[SERVICE ORDER EVENT] Service order created');
    this.logger.log(`[SERVICE ORDER EVENT] ID: ${payload.serviceOrder.id}`);
    this.logger.log(`[SERVICE ORDER EVENT] Type: ${payload.serviceOrder.type}`);
    this.logger.log(`[SERVICE ORDER EVENT] Description: ${payload.serviceOrder.description}`);
    this.logger.log('========================================');
  }

  /**
   * Handle service order assignment event
   * Notify: assigned user
   * Channels: IN_APP, PUSH, WHATSAPP (mandatory), EMAIL (optional)
   */
  @OnEvent('service-order.assigned')
  async handleServiceOrderAssigned(payload: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Service order assigned');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${payload.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Assigned To: ${payload.assignedToId}`);

      const { serviceOrder, assignedToId } = payload;

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true, serialNumber: true },
      });

      const taskIdentifier = task?.serialNumber || task?.name || 'Task';

      // Create deep link to service order
      const deepLink = this.deepLinkService.createServiceOrderDeepLink(serviceOrder.id);

      // Create notification
      await this.notificationService.createNotification({
        userId: assignedToId,
        title: 'Nova Ordem de Serviço Atribuída',
        body: `Você foi atribuído à ordem de serviço "${serviceOrder.description}" da tarefa ${taskIdentifier}`,
        type: NOTIFICATION_TYPE.SERVICE_ORDER,
        channel: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
          NOTIFICATION_CHANNEL.EMAIL,
        ],
        importance: NOTIFICATION_IMPORTANCE.HIGH,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_SERVICE_ORDER,
        actionUrl: deepLink,
        relatedEntityType: 'SERVICE_ORDER',
        relatedEntityId: serviceOrder.id,
        isMandatory: true, // Cannot be disabled
        metadata: {
          serviceOrderId: serviceOrder.id,
          serviceOrderType: serviceOrder.type,
          taskId: serviceOrder.taskId,
          taskIdentifier,
        },
      });

      this.logger.log('[SERVICE ORDER EVENT] ✅ Assignment notification created');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating assignment notification:', error);
    }
  }

  /**
   * Handle service order completion event
   * Notify: task creator
   * Channels: IN_APP, PUSH, WHATSAPP (mandatory), EMAIL (optional)
   */
  @OnEvent('service-order.completed')
  async handleServiceOrderCompleted(payload: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Service order completed');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${payload.serviceOrder.id}`);

      const { serviceOrder } = payload;

      // Get task information for display
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: {
          name: true,
          serialNumber: true,
        },
      });

      if (!task) {
        this.logger.warn('[SERVICE ORDER EVENT] Task not found, skipping notification');
        return;
      }

      // Get service order with creator information
      const serviceOrderWithCreator = await this.prisma.serviceOrder.findUnique({
        where: { id: serviceOrder.id },
        select: {
          createdById: true,
        },
      });

      if (!serviceOrderWithCreator || !serviceOrderWithCreator.createdById) {
        this.logger.warn('[SERVICE ORDER EVENT] Service order has no creator, skipping notification');
        return;
      }

      const taskIdentifier = task.serialNumber || task.name || 'Task';

      // Create deep link to service order
      const deepLink = this.deepLinkService.createServiceOrderDeepLink(serviceOrder.id);

      // Create notification for service order creator (not task creator)
      await this.notificationService.createNotification({
        userId: serviceOrderWithCreator.createdById,
        title: 'Ordem de Serviço Concluída',
        body: `A ordem de serviço "${serviceOrder.description}" da tarefa ${taskIdentifier} foi concluída`,
        type: NOTIFICATION_TYPE.SERVICE_ORDER,
        channel: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
          NOTIFICATION_CHANNEL.EMAIL,
        ],
        importance: NOTIFICATION_IMPORTANCE.NORMAL,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_SERVICE_ORDER,
        actionUrl: deepLink,
        relatedEntityType: 'SERVICE_ORDER',
        relatedEntityId: serviceOrder.id,
        isMandatory: true, // Cannot be disabled
        metadata: {
          serviceOrderId: serviceOrder.id,
          serviceOrderType: serviceOrder.type,
          taskId: serviceOrder.taskId,
          taskIdentifier,
          status: SERVICE_ORDER_STATUS.COMPLETED,
        },
      });

      this.logger.log('[SERVICE ORDER EVENT] ✅ Completion notification created for service order creator');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating completion notification:', error);
    }
  }

  /**
   * Handle artwork service order waiting approval event
   * Notify: all admin users
   * Channels: IN_APP, PUSH, WHATSAPP (mandatory), EMAIL (optional)
   */
  @OnEvent('service-order.artwork-waiting-approval')
  async handleArtworkWaitingApproval(payload: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Artwork waiting approval');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${payload.serviceOrder.id}`);

      const { serviceOrder } = payload;

      // Get task information
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true, serialNumber: true },
      });

      const taskIdentifier = task?.serialNumber || task?.name || 'Task';

      // Create deep link to service order
      const deepLink = this.deepLinkService.createServiceOrderDeepLink(serviceOrder.id);

      // Get all admin users
      const admins = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: SECTOR_PRIVILEGES.ADMIN,
          },
          isActive: true,
        },
        select: { id: true },
      });

      this.logger.log(`[SERVICE ORDER EVENT] Found ${admins.length} admin users to notify`);

      // Create notification for all admins
      await this.notificationService.createNotification({
        userId: null, // Will target all admins via targetSectors
        title: 'Arte Aguardando Aprovação',
        body: `A ordem de serviço de arte "${serviceOrder.description}" da tarefa ${taskIdentifier} está aguardando aprovação`,
        type: NOTIFICATION_TYPE.SERVICE_ORDER,
        channel: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
          NOTIFICATION_CHANNEL.EMAIL,
        ],
        importance: NOTIFICATION_IMPORTANCE.HIGH,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_SERVICE_ORDER,
        actionUrl: deepLink,
        relatedEntityType: 'SERVICE_ORDER',
        relatedEntityId: serviceOrder.id,
        targetSectors: [SECTOR_PRIVILEGES.ADMIN],
        isMandatory: true, // Cannot be disabled
        metadata: {
          serviceOrderId: serviceOrder.id,
          serviceOrderType: SERVICE_ORDER_TYPE.ARTWORK,
          taskId: serviceOrder.taskId,
          taskIdentifier,
          status: SERVICE_ORDER_STATUS.WAITING_APPROVE,
        },
      });

      this.logger.log('[SERVICE ORDER EVENT] ✅ Approval notification created for admins');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating approval notification:', error);
    }
  }

  /**
   * Handle status change event (for logging purposes)
   */
  @OnEvent('service-order.status.changed')
  async handleStatusChanged(payload: any): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[SERVICE ORDER EVENT] Status changed');
    this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${payload.serviceOrder.id}`);
    this.logger.log(`[SERVICE ORDER EVENT] Old Status: ${payload.oldStatus}`);
    this.logger.log(`[SERVICE ORDER EVENT] New Status: ${payload.newStatus}`);
    this.logger.log('========================================');
  }
}
