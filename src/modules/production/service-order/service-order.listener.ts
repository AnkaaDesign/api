import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SERVICE_ORDER_STATUS } from '../../../constants/enums';

/**
 * Builds a type-specific notification config key.
 * E.g., getTypedConfigKey('service_order.created', 'PRODUCTION') → 'service_order.created.production'
 */
function getTypedConfigKey(baseKey: string, soType: string): string {
  return `${baseKey}.${soType.toLowerCase()}`;
}

/**
 * Status to configuration key mapping for service order status changes
 * Maps SERVICE_ORDER_STATUS enum values to notification configuration keys
 */
const STATUS_CONFIG_MAP: Record<string, string> = {
  // ASSIGNED status is handled by the 'service_order.assigned' event directly
  [SERVICE_ORDER_STATUS.IN_PROGRESS]: 'service_order.started',
  [SERVICE_ORDER_STATUS.WAITING_APPROVE]: 'service_order.waiting_approval',
  [SERVICE_ORDER_STATUS.COMPLETED]: 'service_order.completed',
  [SERVICE_ORDER_STATUS.CANCELLED]: 'service_order.cancelled',
};

/**
 * Service Order Event Listener
 * Handles all service order-related events and creates appropriate notifications
 * using configuration-based dispatch for flexible notification management
 */
@Injectable()
export class ServiceOrderListener {
  private readonly logger = new Logger(ServiceOrderListener.name);

  constructor(
    private readonly dispatchService: NotificationDispatchService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[SERVICE ORDER LISTENER] Initializing Service Order Event Listener');
    this.logger.log('[SERVICE ORDER LISTENER] Event handlers will be registered via decorators');
    this.logger.log('[SERVICE ORDER LISTENER] Using configuration-based dispatch');
    this.logger.log('========================================');
  }

  /**
   * Handle service order creation event
   * Uses configuration-based dispatch for flexible notification management
   */
  @OnEvent('service_order.created')
  async handleServiceOrderCreated(event: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Service order created');
      this.logger.log(`[SERVICE ORDER EVENT] ID: ${event.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Type: ${event.serviceOrder.type}`);
      this.logger.log(`[SERVICE ORDER EVENT] Description: ${event.serviceOrder.description}`);

      if (!event.serviceOrder.type) {
        this.logger.warn('[SERVICE ORDER EVENT] Missing SO type, skipping notification');
        return;
      }

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: event.serviceOrder.taskId },
        select: { name: true },
      });

      // Get creator information
      const serviceOrderWithCreator = await this.prisma.serviceOrder.findUnique({
        where: { id: event.serviceOrder.id },
        select: {
          createdBy: {
            select: { name: true },
          },
        },
      });

      const configKey = getTypedConfigKey('service_order.created', event.serviceOrder.type);
      this.logger.log(`[SERVICE ORDER EVENT] Using config key: ${configKey}`);

      await this.dispatchService.dispatchByConfiguration(
        configKey,
        event.userId,
        {
          entityType: 'SERVICE_ORDER',
          entityId: event.serviceOrder.id,
          action: 'created',
          data: {
            serviceOrderId: event.serviceOrder.id,
            description: event.serviceOrder.description,
            type: event.serviceOrder.type,
            taskId: event.serviceOrder.taskId,
            taskName: task?.name,
            createdBy: serviceOrderWithCreator?.createdBy?.name || event.user?.name || 'Sistema',
          },
        },
      );

      this.logger.log('[SERVICE ORDER EVENT] ✅ Creation notification dispatched via configuration');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error dispatching creation notification:', error);
    }
  }

  /**
   * Handle service order assignment event
   * Uses configuration-based dispatch for flexible notification management
   */
  @OnEvent('service_order.assigned')
  async handleServiceOrderAssigned(event: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Service order assigned');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${event.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Assigned To: ${event.assignedToId}`);

      if (!event.serviceOrder.type) {
        this.logger.warn('[SERVICE ORDER EVENT] Missing SO type, skipping notification');
        return;
      }

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: event.serviceOrder.taskId },
        select: { name: true },
      });

      // Get assigned user info
      const assignedUser = await this.prisma.user.findUnique({
        where: { id: event.assignedToId },
        select: { name: true },
      });

      // Get user who assigned
      const assignedByUser = event.user || (event.userId ? await this.prisma.user.findUnique({
        where: { id: event.userId },
        select: { name: true },
      }) : null);

      const configKey = getTypedConfigKey('service_order.assigned', event.serviceOrder.type);
      this.logger.log(`[SERVICE ORDER EVENT] Using config key: ${configKey}`);

      await this.dispatchService.dispatchByConfiguration(
        configKey,
        event.userId,
        {
          entityType: 'SERVICE_ORDER',
          entityId: event.serviceOrder.id,
          action: 'assigned',
          data: {
            serviceOrderId: event.serviceOrder.id,
            description: event.serviceOrder.description,
            assignedTo: assignedUser?.name || event.assignedTo?.name,
            assignedBy: assignedByUser?.name || event.user?.name,
            taskName: task?.name || event.task?.name,
          },
        },
      );

      this.logger.log('[SERVICE ORDER EVENT] ✅ Assignment notification dispatched via configuration');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error dispatching assignment notification:', error);
    }
  }

  /**
   * Handle status change event
   * Maps status to specific configuration keys and dispatches via configuration
   */
  @OnEvent('service_order.status.changed')
  async handleStatusChanged(event: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Status changed');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${event.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Type: ${event.serviceOrder.type}`);
      this.logger.log(`[SERVICE ORDER EVENT] Old Status: ${event.oldStatus}`);
      this.logger.log(`[SERVICE ORDER EVENT] New Status: ${event.newStatus}`);

      const { serviceOrder, oldStatus, newStatus, userId } = event;

      if (!serviceOrder.type) {
        this.logger.warn('[SERVICE ORDER EVENT] Missing SO type, skipping notification');
        return;
      }

      // Map status to configuration key
      const baseConfigKey = STATUS_CONFIG_MAP[newStatus];
      if (!baseConfigKey) {
        this.logger.warn(`[SERVICE ORDER EVENT] No configuration mapping for status: ${newStatus}`);
        return;
      }

      const configKey = getTypedConfigKey(baseConfigKey, serviceOrder.type);
      this.logger.log(`[SERVICE ORDER EVENT] Using configuration key: ${configKey}`);

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true },
      });

      // Get service order with user relations
      const serviceOrderWithUsers = await this.prisma.serviceOrder.findUnique({
        where: { id: serviceOrder.id },
        select: {
          assignedTo: { select: { name: true } },
          startedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          completedBy: { select: { name: true } },
        },
      });

      // Get user who made the change
      let changedByUser = event.user;
      if (!changedByUser && userId) {
        changedByUser = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
      }

      await this.dispatchService.dispatchByConfiguration(
        configKey,
        userId,
        {
          entityType: 'SERVICE_ORDER',
          entityId: serviceOrder.id,
          action: newStatus,
          data: {
            serviceOrderId: serviceOrder.id,
            description: serviceOrder.description,
            type: serviceOrder.type,
            taskId: serviceOrder.taskId,
            taskName: task?.name,
            oldStatus,
            newStatus,
            changedBy: changedByUser?.name || 'Sistema',
            assignedTo: serviceOrderWithUsers?.assignedTo?.name,
            startedBy: serviceOrderWithUsers?.startedBy?.name,
            approvedBy: serviceOrderWithUsers?.approvedBy?.name,
            completedBy: serviceOrderWithUsers?.completedBy?.name,
          },
        },
      );

      this.logger.log(`[SERVICE ORDER EVENT] ✅ Status change notification dispatched via configuration (${configKey})`);

      // Also notify the creator of the service order (if they're not the one who changed it)
      const soWithCreator = await this.prisma.serviceOrder.findUnique({
        where: { id: serviceOrder.id },
        select: { createdById: true },
      });

      if (soWithCreator?.createdById && soWithCreator.createdById !== userId) {
        const creatorConfigKey = getTypedConfigKey('service_order.status_changed_for_creator', serviceOrder.type);
        this.logger.log(`[SERVICE ORDER EVENT] Notifying creator ${soWithCreator.createdById} via ${creatorConfigKey}`);

        await this.dispatchService.dispatchByConfigurationToUsers(
          creatorConfigKey,
          userId,
          {
            entityType: 'SERVICE_ORDER',
            entityId: serviceOrder.id,
            action: newStatus,
            data: {
              serviceOrderId: serviceOrder.id,
              description: serviceOrder.description,
              type: serviceOrder.type,
              taskId: serviceOrder.taskId,
              taskName: task?.name,
              oldStatus,
              newStatus,
              changedBy: changedByUser?.name || 'Sistema',
            },
          },
          [soWithCreator.createdById],
        );
      }

      this.logger.log('========================================');
    } catch (error) {
      this.logger.error(
        '[SERVICE ORDER EVENT] ❌ Error dispatching status change notification:',
        error,
      );
    }
  }

  /**
   * Handle service order observation change event
   * Dispatches notification when an SO observation is added, modified, or cleared
   */
  @OnEvent('service_order.observation.changed')
  async handleObservationChanged(event: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Observation changed');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${event.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Type: ${event.serviceOrder.type}`);

      const { serviceOrder, oldObservation, newObservation, userId } = event;

      if (!serviceOrder.type) {
        this.logger.warn('[SERVICE ORDER EVENT] Missing SO type, skipping observation notification');
        return;
      }

      const configKey = getTypedConfigKey('service_order.observation_changed', serviceOrder.type);
      this.logger.log(`[SERVICE ORDER EVENT] Using config key: ${configKey}`);

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true },
      });

      // Get user who made the change
      let changedByUser = event.user;
      if (!changedByUser && userId) {
        changedByUser = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
      }

      await this.dispatchService.dispatchByConfiguration(
        configKey,
        userId,
        {
          entityType: 'SERVICE_ORDER',
          entityId: serviceOrder.id,
          action: 'observation_changed',
          data: {
            serviceOrderId: serviceOrder.id,
            description: serviceOrder.description,
            type: serviceOrder.type,
            taskId: serviceOrder.taskId,
            taskName: task?.name,
            oldObservation: oldObservation || '(vazio)',
            newObservation: newObservation || '(vazio)',
            changedBy: changedByUser?.name || 'Sistema',
          },
        },
      );

      this.logger.log('[SERVICE ORDER EVENT] ✅ Observation change notification dispatched via configuration');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error(
        '[SERVICE ORDER EVENT] ❌ Error dispatching observation change notification:',
        error,
      );
    }
  }
}
