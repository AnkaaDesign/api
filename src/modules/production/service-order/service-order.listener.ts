import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '@modules/common/notification/notification.service';
import { DeepLinkService, DeepLinkEntity } from '@modules/common/notification/deep-link.service';
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
import { SERVICE_ORDER_STATUS_LABELS, SERVICE_ORDER_TYPE_LABELS } from '../../../constants/enum-labels';

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
   * Notify: relevant sector users + admin users (based on service order type)
   * - ARTWORK → DESIGNER + ADMIN
   * - FINANCIAL → FINANCIAL + ADMIN
   * - NEGOTIATION → COMMERCIAL + ADMIN
   * - PRODUCTION → PRODUCTION + ADMIN
   * Channels: IN_APP, PUSH, WHATSAPP (mandatory)
   */
  @OnEvent('service-order.created')
  async handleServiceOrderCreated(payload: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Service order created');
      this.logger.log(`[SERVICE ORDER EVENT] ID: ${payload.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Type: ${payload.serviceOrder.type}`);
      this.logger.log(`[SERVICE ORDER EVENT] Description: ${payload.serviceOrder.description}`);

      const { serviceOrder } = payload;

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true, serialNumber: true },
      });

      if (!task) {
        this.logger.warn('[SERVICE ORDER EVENT] Task not found, skipping notification');
        return;
      }

      const taskIdentifier = task.serialNumber || task.name || 'Task';

      // Get service order with creator information
      const serviceOrderWithCreator = await this.prisma.serviceOrder.findUnique({
        where: { id: serviceOrder.id },
        select: {
          createdById: true,
          createdBy: {
            select: { name: true },
          },
        },
      });

      const creatorName = serviceOrderWithCreator?.createdBy?.name || 'Alguém';
      const creatorId = serviceOrderWithCreator?.createdById;

      // Create deep link to task (service orders are viewed within the task)
      const deepLink = this.deepLinkService.generateNotificationActionUrl(
        DeepLinkEntity.Task,
        serviceOrder.taskId,
      );

      // Determine target privileges based on service order type
      const targetPrivileges = this.getTargetPrivilegesForServiceOrderType(serviceOrder.type);

      this.logger.log(`[SERVICE ORDER EVENT] Target privileges for type ${serviceOrder.type}: ${targetPrivileges.join(', ')}`);

      // Get users with target privileges (including ADMIN which is always included)
      const targetUsers = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: {
              in: targetPrivileges,
            },
          },
          isActive: true,
        },
        select: { id: true, name: true },
      });

      this.logger.log(`[SERVICE ORDER EVENT] Found ${targetUsers.length} users to notify`);

      // Filter out the creator from notifications
      const usersToNotify = targetUsers.filter(user => user.id !== creatorId);

      this.logger.log(`[SERVICE ORDER EVENT] Notifying ${usersToNotify.length} users (excluding creator)`);

      // Get type label for display
      const typeLabel = SERVICE_ORDER_TYPE_LABELS[serviceOrder.type] || serviceOrder.type;

      // Create notification for each target user (except creator)
      for (const user of usersToNotify) {
        await this.notificationService.createNotification({
          userId: user.id,
          title: 'Nova Ordem de Serviço Criada',
          body: `Ordem de serviço "${serviceOrder.description}" foi criada para a tarefa "${taskIdentifier}" por ${creatorName} (Tipo: ${typeLabel})`,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: deepLink,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: {
            serviceOrderId: serviceOrder.id,
            serviceOrderType: serviceOrder.type,
            taskId: serviceOrder.taskId,
            taskIdentifier,
            createdBy: creatorName,
          },
        });
      }

      this.logger.log('[SERVICE ORDER EVENT] ✅ Creation notifications sent to relevant users');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating notifications:', error);
    }
  }

  /**
   * Get target privileges for a service order type
   * Returns the sector privileges that should be notified for this service order type
   */
  private getTargetPrivilegesForServiceOrderType(type: SERVICE_ORDER_TYPE): SECTOR_PRIVILEGES[] {
    switch (type) {
      case SERVICE_ORDER_TYPE.ARTWORK:
        return [SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.ADMIN];

      case SERVICE_ORDER_TYPE.FINANCIAL:
        return [SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN];

      case SERVICE_ORDER_TYPE.NEGOTIATION:
        return [SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN];

      case SERVICE_ORDER_TYPE.PRODUCTION:
        // Production includes LOGISTIC users as well
        return [SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.ADMIN];

      default:
        // Fallback to admin only for unknown types
        return [SECTOR_PRIVILEGES.ADMIN];
    }
  }

  /**
   * Handle service order assignment event
   * Notify: assigned user + all admin users
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

      // Get assigned user info
      const assignedUser = await this.prisma.user.findUnique({
        where: { id: assignedToId },
        select: { name: true },
      });

      const assignedUserName = assignedUser?.name || 'Usuário';

      // Create deep link to task (service orders are viewed within the task)
      const deepLink = this.deepLinkService.generateNotificationActionUrl(
        DeepLinkEntity.Task,
        serviceOrder.taskId,
      );

      // 1. Notify the assigned user
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

      this.logger.log('[SERVICE ORDER EVENT] ✅ Assignment notification sent to assigned user');

      // 2. Notify all ADMIN users
      const admins = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: SECTOR_PRIVILEGES.ADMIN,
          },
          isActive: true,
        },
        select: { id: true },
      });

      this.logger.log(`[SERVICE ORDER EVENT] Found ${admins.length} admin users to notify about assignment`);

      // Notify each admin (including if assigned user is admin, they'll get both notifications)
      for (const admin of admins) {
        // Skip if this admin is the assigned user (they already got the assignment notification)
        if (admin.id === assignedToId) {
          this.logger.log(`[SERVICE ORDER EVENT] Skipping admin ${admin.id} (same as assigned user)`);
          continue;
        }

        await this.notificationService.createNotification({
          userId: admin.id,
          title: 'Ordem de Serviço Atribuída',
          body: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" foi atribuída a ${assignedUserName}`,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: deepLink,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: {
            serviceOrderId: serviceOrder.id,
            serviceOrderType: serviceOrder.type,
            taskId: serviceOrder.taskId,
            taskIdentifier,
            assignedTo: assignedUserName,
            assignedToId,
          },
        });
      }

      this.logger.log('[SERVICE ORDER EVENT] ✅ Assignment notifications sent to admins');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating assignment notification:', error);
    }
  }

  /**
   * Handle service order completion event
   * Notify: creator + all admin users
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

      const creatorId = serviceOrderWithCreator.createdById;
      const taskIdentifier = task.serialNumber || task.name || 'Task';

      // Create deep link to task (service orders are viewed within the task)
      const deepLink = this.deepLinkService.generateNotificationActionUrl(
        DeepLinkEntity.Task,
        serviceOrder.taskId,
      );

      // 1. Notify the creator
      await this.notificationService.createNotification({
        userId: creatorId,
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

      this.logger.log('[SERVICE ORDER EVENT] ✅ Completion notification sent to creator');

      // 2. Notify all ADMIN users
      const admins = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: SECTOR_PRIVILEGES.ADMIN,
          },
          isActive: true,
        },
        select: { id: true },
      });

      this.logger.log(`[SERVICE ORDER EVENT] Found ${admins.length} admin users to notify about completion`);

      // Notify each admin (excluding if admin is the creator - they already got the notification)
      for (const admin of admins) {
        // Skip if this admin is the creator (they already got the completion notification)
        if (admin.id === creatorId) {
          this.logger.log(`[SERVICE ORDER EVENT] Skipping admin ${admin.id} (same as creator)`);
          continue;
        }

        await this.notificationService.createNotification({
          userId: admin.id,
          title: 'Ordem de Serviço Concluída',
          body: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" foi concluída`,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: deepLink,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: {
            serviceOrderId: serviceOrder.id,
            serviceOrderType: serviceOrder.type,
            taskId: serviceOrder.taskId,
            taskIdentifier,
            status: SERVICE_ORDER_STATUS.COMPLETED,
          },
        });
      }

      this.logger.log('[SERVICE ORDER EVENT] ✅ Completion notifications sent to admins');
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

      // Create deep link to task (service orders are viewed within the task)
      const deepLink = this.deepLinkService.generateNotificationActionUrl(
        DeepLinkEntity.Task,
        serviceOrder.taskId,
      );

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
   * Handle status change event
   * Notify: relevant sector users + admin users (based on service order type)
   * - ARTWORK → DESIGNER + ADMIN
   * - FINANCIAL → FINANCIAL + ADMIN
   * - NEGOTIATION → COMMERCIAL + ADMIN
   * - PRODUCTION → PRODUCTION + ADMIN
   * Channels: IN_APP, PUSH, WHATSAPP (mandatory)
   */
  @OnEvent('service-order.status.changed')
  async handleStatusChanged(payload: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Status changed');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${payload.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Type: ${payload.serviceOrder.type}`);
      this.logger.log(`[SERVICE ORDER EVENT] Old Status: ${payload.oldStatus}`);
      this.logger.log(`[SERVICE ORDER EVENT] New Status: ${payload.newStatus}`);

      const { serviceOrder, oldStatus, newStatus, changedBy } = payload;

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true, serialNumber: true },
      });

      if (!task) {
        this.logger.warn('[SERVICE ORDER EVENT] Task not found, skipping notification');
        return;
      }

      const taskIdentifier = task.serialNumber || task.name || 'Task';

      // Get user who made the change
      const changedByUser = changedBy?.id || null;
      const changedByName = changedBy?.name || 'Alguém';

      // Create deep link to task (service orders are viewed within the task)
      const deepLink = this.deepLinkService.generateNotificationActionUrl(
        DeepLinkEntity.Task,
        serviceOrder.taskId,
      );

      // Determine target privileges based on service order type
      const targetPrivileges = this.getTargetPrivilegesForServiceOrderType(serviceOrder.type);

      this.logger.log(`[SERVICE ORDER EVENT] Target privileges for type ${serviceOrder.type}: ${targetPrivileges.join(', ')}`);

      // Get users with target privileges (including ADMIN which is always included)
      const targetUsers = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: {
              in: targetPrivileges,
            },
          },
          isActive: true,
        },
        select: { id: true, name: true },
      });

      this.logger.log(`[SERVICE ORDER EVENT] Found ${targetUsers.length} users to notify`);

      // Filter out the user who made the change
      const usersToNotify = targetUsers.filter(user => user.id !== changedByUser);

      this.logger.log(`[SERVICE ORDER EVENT] Notifying ${usersToNotify.length} users (excluding changer)`);

      // Get status labels for display
      const oldStatusLabel = SERVICE_ORDER_STATUS_LABELS[oldStatus] || oldStatus;
      const newStatusLabel = SERVICE_ORDER_STATUS_LABELS[newStatus] || newStatus;

      // Determine importance based on new status
      let importance = NOTIFICATION_IMPORTANCE.NORMAL;
      if (newStatus === SERVICE_ORDER_STATUS.COMPLETED || newStatus === SERVICE_ORDER_STATUS.CANCELLED) {
        importance = NOTIFICATION_IMPORTANCE.HIGH;
      }

      // Create notification for each target user (except the one who made the change)
      for (const user of usersToNotify) {
        await this.notificationService.createNotification({
          userId: user.id,
          title: 'Ordem de Serviço Atualizada',
          body: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" mudou de "${oldStatusLabel}" para "${newStatusLabel}" por ${changedByName}`,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: deepLink,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: {
            serviceOrderId: serviceOrder.id,
            serviceOrderType: serviceOrder.type,
            taskId: serviceOrder.taskId,
            taskIdentifier,
            oldStatus,
            newStatus,
            changedBy: changedByName,
          },
        });
      }

      this.logger.log('[SERVICE ORDER EVENT] ✅ Status change notifications sent to relevant users');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating status change notifications:', error);
    }
  }
}
