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
   * Get notification metadata for a task including web and mobile deep links
   * Returns actionUrl as JSON string (for reliable mobile URL extraction) and metadata
   *
   * IMPORTANT: actionUrl is now a JSON string containing { web, mobile, universalLink }
   * This ensures the mobile app can always extract the correct navigation URL,
   * following the same pattern as order.listener.ts which works correctly.
   *
   * @param taskId - Task ID to generate links for
   * @returns Object with actionUrl (JSON string) and metadata containing all link types
   */
  private getTaskNotificationMetadata(taskId: string): { actionUrl: string; metadata: any } {
    // Generate deep links for mobile and universal linking
    const deepLinks = this.deepLinkService.generateTaskLinks(taskId);

    // CRITICAL FIX: Store actionUrl as JSON string so the queue processor
    // can extract mobileUrl directly via parseActionUrl().
    // Previously this was a simple web path which caused mobileUrl to be empty.
    return {
      actionUrl: JSON.stringify(deepLinks),
      metadata: {
        webUrl: deepLinks.web,
        mobileUrl: deepLinks.mobile,
        universalLink: deepLinks.universalLink,
        taskId,
        // Include entity info for mobile navigation fallback
        entityType: 'Task',
        entityId: taskId,
      },
    };
  }

  /**
   * Handle service order creation event
   * Notify: ADMIN users only (other sectors see service orders when assigned)
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
        select: { name: true, serialNumber: true, customer: { select: { fantasyName: true } } },
      });

      if (!task) {
        this.logger.warn('[SERVICE ORDER EVENT] Task not found, skipping notification');
        return;
      }

      const taskIdentifier = task.name || task.customer?.fantasyName || task.serialNumber || 'Tarefa';

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

      // Get proper actionUrl and metadata for the task
      const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(serviceOrder.taskId);

      // Only notify ADMIN users for new service orders
      const adminUsers = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: SECTOR_PRIVILEGES.ADMIN,
          },
          isActive: true,
        },
        select: { id: true, name: true },
      });

      this.logger.log(`[SERVICE ORDER EVENT] Found ${adminUsers.length} admin users to notify`);

      // Filter out the creator from notifications
      const usersToNotify = adminUsers.filter(user => user.id !== creatorId);

      this.logger.log(`[SERVICE ORDER EVENT] Notifying ${usersToNotify.length} admin users (excluding creator)`);

      // Get type label for display
      const typeLabel = SERVICE_ORDER_TYPE_LABELS[serviceOrder.type] || serviceOrder.type;

      // Create notification for each admin user (except creator)
      for (const user of usersToNotify) {
        await this.notificationService.createNotification({
          userId: user.id,
          title: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" criada por ${creatorName}`,
          body: `Ordem de serviço "${serviceOrder.description}" foi criada para a tarefa "${taskIdentifier}" por ${creatorName} (Tipo: ${typeLabel})`,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: {
            ...linkMetadata,
            serviceOrderId: serviceOrder.id,
            serviceOrderType: serviceOrder.type,
            taskIdentifier,
            createdBy: creatorName,
            eventType: 'created',
          },
        });
      }

      this.logger.log('[SERVICE ORDER EVENT] ✅ Creation notifications sent to admin users');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating notifications:', error);
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
        select: { name: true, serialNumber: true, customer: { select: { fantasyName: true } } },
      });

      const taskIdentifier = task?.name || task?.customer?.fantasyName || task?.serialNumber || 'Tarefa';

      // Get assigned user info
      const assignedUser = await this.prisma.user.findUnique({
        where: { id: assignedToId },
        select: { name: true },
      });

      const assignedUserName = assignedUser?.name || 'Usuário';

      // Get proper actionUrl and metadata for the task
      const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(serviceOrder.taskId);

      // 1. Notify the assigned user
      await this.notificationService.createNotification({
        userId: assignedToId,
        title: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" atribuída a você`,
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
        actionUrl,
        relatedEntityType: 'SERVICE_ORDER',
        relatedEntityId: serviceOrder.id,
        isMandatory: true, // Cannot be disabled
        metadata: {
          ...linkMetadata,
          serviceOrderId: serviceOrder.id,
          serviceOrderType: serviceOrder.type,
          taskIdentifier,
          eventType: 'assigned',
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
          title: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" atribuída a ${assignedUserName}`,
          body: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" foi atribuída a ${assignedUserName}`,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: {
            ...linkMetadata,
            serviceOrderId: serviceOrder.id,
            serviceOrderType: serviceOrder.type,
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

      const { serviceOrder, userId } = payload;

      // Get task information for display
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: {
          name: true,
          serialNumber: true,
          customer: { select: { fantasyName: true } },
        },
      });

      if (!task) {
        this.logger.warn('[SERVICE ORDER EVENT] Task not found, skipping notification');
        return;
      }

      // Get service order with creator and completedBy information
      const serviceOrderWithRelations = await this.prisma.serviceOrder.findUnique({
        where: { id: serviceOrder.id },
        select: {
          createdById: true,
          completedById: true,
          completedBy: {
            select: { name: true },
          },
          startedBy: {
            select: { name: true },
          },
          approvedBy: {
            select: { name: true },
          },
        },
      });

      if (!serviceOrderWithRelations || !serviceOrderWithRelations.createdById) {
        this.logger.warn('[SERVICE ORDER EVENT] Service order has no creator, skipping notification');
        return;
      }

      const creatorId = serviceOrderWithRelations.createdById;
      const completedByName = serviceOrderWithRelations.completedBy?.name || 'Alguém';
      const startedByName = serviceOrderWithRelations.startedBy?.name || null;
      const approvedByName = serviceOrderWithRelations.approvedBy?.name || null;
      const taskIdentifier = task.name || task.customer?.fantasyName || task.serialNumber || 'Tarefa';

      // Get proper actionUrl and metadata for the task
      const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(serviceOrder.taskId);

      // 1. Notify the creator
      await this.notificationService.createNotification({
        userId: creatorId,
        title: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" concluída por ${completedByName}`,
        body: `A ordem de serviço "${serviceOrder.description}" da tarefa ${taskIdentifier} foi concluída por ${completedByName}`,
        type: NOTIFICATION_TYPE.SERVICE_ORDER,
        channel: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
          NOTIFICATION_CHANNEL.EMAIL,
        ],
        importance: NOTIFICATION_IMPORTANCE.NORMAL,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_SERVICE_ORDER,
        actionUrl,
        relatedEntityType: 'SERVICE_ORDER',
        relatedEntityId: serviceOrder.id,
        isMandatory: true, // Cannot be disabled
        metadata: {
          ...linkMetadata,
          serviceOrderId: serviceOrder.id,
          serviceOrderType: serviceOrder.type,
          taskIdentifier,
          status: SERVICE_ORDER_STATUS.COMPLETED,
          completedBy: completedByName,
          startedBy: startedByName,
          approvedBy: approvedByName,
          eventType: 'my.completed',
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
          title: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" concluída por ${completedByName}`,
          body: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" foi concluída por ${completedByName}`,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: {
            ...linkMetadata,
            serviceOrderId: serviceOrder.id,
            serviceOrderType: serviceOrder.type,
            taskIdentifier,
            status: SERVICE_ORDER_STATUS.COMPLETED,
            completedBy: completedByName,
            startedBy: startedByName,
            approvedBy: approvedByName,
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
        select: { name: true, serialNumber: true, customer: { select: { fantasyName: true } } },
      });

      const taskIdentifier = task?.name || task?.customer?.fantasyName || task?.serialNumber || 'Tarefa';

      // Get proper actionUrl and metadata for the task
      const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(serviceOrder.taskId);

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
        title: `Arte "${serviceOrder.description}" da tarefa "${taskIdentifier}" aguardando aprovação`,
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
        actionUrl,
        relatedEntityType: 'SERVICE_ORDER',
        relatedEntityId: serviceOrder.id,
        targetSectors: [SECTOR_PRIVILEGES.ADMIN],
        isMandatory: true, // Cannot be disabled
        metadata: {
          ...linkMetadata,
          serviceOrderId: serviceOrder.id,
          serviceOrderType: SERVICE_ORDER_TYPE.ARTWORK,
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
   * Notify:
   * - Assigned user (eventType: assigned.updated)
   * - Creator (eventType: my.updated)
   * - ADMIN users
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

      const { serviceOrder, oldStatus, newStatus, userId } = payload;

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true, serialNumber: true, customer: { select: { fantasyName: true } } },
      });

      if (!task) {
        this.logger.warn('[SERVICE ORDER EVENT] Task not found, skipping notification');
        return;
      }

      const taskIdentifier = task.name || task.customer?.fantasyName || task.serialNumber || 'Tarefa';

      // Get service order with all user relations for metadata
      const serviceOrderWithUsers = await this.prisma.serviceOrder.findUnique({
        where: { id: serviceOrder.id },
        select: {
          createdById: true,
          assignedToId: true,
          observation: true,
          startedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          completedBy: { select: { name: true } },
        },
      });

      const creatorId = serviceOrderWithUsers?.createdById;
      const assignedToId = serviceOrderWithUsers?.assignedToId || serviceOrder.assignedToId;

      // Get user who made the change
      let changedByName = 'Alguém';
      if (userId) {
        const changedByUser = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        changedByName = changedByUser?.name || 'Alguém';
      }

      // Get proper actionUrl and metadata for the task
      const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(serviceOrder.taskId);

      // Get status labels for display
      const oldStatusLabel = SERVICE_ORDER_STATUS_LABELS[oldStatus] || oldStatus;
      const newStatusLabel = SERVICE_ORDER_STATUS_LABELS[newStatus] || newStatus;

      // Determine importance and special handling based on status transition
      let importance = NOTIFICATION_IMPORTANCE.NORMAL;
      // Detailed title matching the user's expected format: "Ordem de serviço 'X' da tarefa 'Y' mudou de 'A' para 'B' por Z"
      let title = `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" mudou de "${oldStatusLabel}" para "${newStatusLabel}" por ${changedByName}`;
      let body = `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" mudou de "${oldStatusLabel}" para "${newStatusLabel}" por ${changedByName}`;

      // Handle rejection case (going back to IN_PROGRESS from WAITING_APPROVE or COMPLETED)
      const isRejection = newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
        (oldStatus === SERVICE_ORDER_STATUS.WAITING_APPROVE || oldStatus === SERVICE_ORDER_STATUS.COMPLETED);

      if (isRejection && serviceOrderWithUsers?.observation) {
        title = `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}" reprovada por ${changedByName}`;
        body = `Ordem de serviço "${serviceOrder.description}" foi reprovada por ${changedByName}. Motivo: ${serviceOrderWithUsers.observation}`;
        importance = NOTIFICATION_IMPORTANCE.HIGH;
      } else if (newStatus === SERVICE_ORDER_STATUS.COMPLETED || newStatus === SERVICE_ORDER_STATUS.CANCELLED) {
        importance = NOTIFICATION_IMPORTANCE.HIGH;
      }

      // Build base metadata with all user tracking info
      const baseMetadata: any = {
        ...linkMetadata,
        serviceOrderId: serviceOrder.id,
        serviceOrderType: serviceOrder.type,
        taskIdentifier,
        oldStatus,
        newStatus,
        changedBy: changedByName,
        startedBy: serviceOrderWithUsers?.startedBy?.name || null,
        approvedBy: serviceOrderWithUsers?.approvedBy?.name || null,
        completedBy: serviceOrderWithUsers?.completedBy?.name || null,
      };

      // Add observation if it's a rejection
      if (isRejection && serviceOrderWithUsers?.observation) {
        baseMetadata.observation = serviceOrderWithUsers.observation;
        baseMetadata.isRejection = true;
      }

      // Track who we've already notified to avoid duplicates
      const notifiedUserIds = new Set<string>();

      // 1. Notify the assigned user (eventType: assigned.updated)
      if (assignedToId && assignedToId !== userId) {
        const assignedUser = await this.prisma.user.findUnique({
          where: { id: assignedToId },
          select: { isActive: true },
        });

        if (assignedUser?.isActive) {
          await this.notificationService.createNotification({
            userId: assignedToId,
            title,
            body,
            type: NOTIFICATION_TYPE.SERVICE_ORDER,
            channel: [
              NOTIFICATION_CHANNEL.IN_APP,
              NOTIFICATION_CHANNEL.PUSH,
              NOTIFICATION_CHANNEL.WHATSAPP,
            ],
            importance,
            actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
            actionUrl,
            relatedEntityType: 'SERVICE_ORDER',
            relatedEntityId: serviceOrder.id,
            isMandatory: false,
            metadata: { ...baseMetadata, eventType: 'assigned.updated' },
          });
          notifiedUserIds.add(assignedToId);
          this.logger.log(`[SERVICE ORDER EVENT] Notified assigned user (assigned.updated)`);
        }
      }

      // 2. Notify the creator (eventType: my.updated) - if different from assigned and not the changer
      if (creatorId && creatorId !== userId && !notifiedUserIds.has(creatorId)) {
        const creator = await this.prisma.user.findUnique({
          where: { id: creatorId },
          select: { isActive: true },
        });

        if (creator?.isActive) {
          await this.notificationService.createNotification({
            userId: creatorId,
            title,
            body,
            type: NOTIFICATION_TYPE.SERVICE_ORDER,
            channel: [
              NOTIFICATION_CHANNEL.IN_APP,
              NOTIFICATION_CHANNEL.PUSH,
              NOTIFICATION_CHANNEL.WHATSAPP,
            ],
            importance,
            actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
            actionUrl,
            relatedEntityType: 'SERVICE_ORDER',
            relatedEntityId: serviceOrder.id,
            isMandatory: false,
            metadata: { ...baseMetadata, eventType: 'my.updated' },
          });
          notifiedUserIds.add(creatorId);
          this.logger.log(`[SERVICE ORDER EVENT] Notified creator (my.updated)`);
        }
      }

      // 3. Notify ADMIN users
      const adminUsers = await this.prisma.user.findMany({
        where: {
          sector: { privileges: SECTOR_PRIVILEGES.ADMIN },
          isActive: true,
          id: { notIn: [...notifiedUserIds, userId].filter(Boolean) as string[] },
        },
        select: { id: true },
      });

      for (const admin of adminUsers) {
        await this.notificationService.createNotification({
          userId: admin.id,
          title,
          body,
          type: NOTIFICATION_TYPE.SERVICE_ORDER,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.WHATSAPP,
          ],
          importance,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityType: 'SERVICE_ORDER',
          relatedEntityId: serviceOrder.id,
          isMandatory: true,
          metadata: baseMetadata,
        });
      }

      this.logger.log(`[SERVICE ORDER EVENT] ✅ Status change notifications sent (${notifiedUserIds.size} specific + ${adminUsers.length} admins)`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating status change notifications:', error);
    }
  }

  /**
   * Handle service order updated by someone other than the assignee
   * Notify: the assigned user when their service order is modified by another user
   * Channels: IN_APP, PUSH, WHATSAPP
   */
  @OnEvent('service-order.assigned-user-updated')
  async handleAssignedUserUpdate(payload: any): Promise<void> {
    try {
      this.logger.log('========================================');
      this.logger.log('[SERVICE ORDER EVENT] Service order updated (assigned user notification)');
      this.logger.log(`[SERVICE ORDER EVENT] Service Order ID: ${payload.serviceOrder.id}`);
      this.logger.log(`[SERVICE ORDER EVENT] Assigned To: ${payload.assignedToId}`);
      this.logger.log(`[SERVICE ORDER EVENT] Updated By: ${payload.userId}`);

      const { serviceOrder, oldServiceOrder, assignedToId, userId } = payload;

      // Get task information for context
      const task = await this.prisma.task.findUnique({
        where: { id: serviceOrder.taskId },
        select: { name: true, serialNumber: true, customer: { select: { fantasyName: true } } },
      });

      if (!task) {
        this.logger.warn('[SERVICE ORDER EVENT] Task not found, skipping notification');
        return;
      }

      const taskIdentifier = task.name || task.customer?.fantasyName || task.serialNumber || 'Tarefa';

      // Get user who made the change
      const changedByUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const changedByName = changedByUser?.name || 'Alguém';

      // Build description of what changed
      const changes: string[] = [];
      if (oldServiceOrder.description !== serviceOrder.description) {
        changes.push('descrição');
      }
      if (oldServiceOrder.observation !== serviceOrder.observation) {
        changes.push('observação');
      }
      if (oldServiceOrder.type !== serviceOrder.type) {
        changes.push('tipo');
      }

      const changesText = changes.length > 0 ? changes.join(', ') : 'campos';

      // Get proper actionUrl and metadata for the task
      const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(serviceOrder.taskId);

      // Notify the assigned user about the update
      await this.notificationService.createNotification({
        userId: assignedToId,
        title: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}": ${changesText} alterado(s) por ${changedByName}`,
        body: `A ordem de serviço "${serviceOrder.description}" da tarefa ${taskIdentifier} teve ${changesText} alterado(s) por ${changedByName}`,
        type: NOTIFICATION_TYPE.SERVICE_ORDER,
        channel: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
        importance: NOTIFICATION_IMPORTANCE.NORMAL,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
        actionUrl,
        relatedEntityType: 'SERVICE_ORDER',
        relatedEntityId: serviceOrder.id,
        isMandatory: false, // User can disable if they prefer
        metadata: {
          ...linkMetadata,
          serviceOrderId: serviceOrder.id,
          serviceOrderType: serviceOrder.type,
          taskIdentifier,
          changedBy: changedByName,
          changedFields: changes,
          eventType: 'assigned.updated',
        },
      });

      // Also notify the creator if different from assigned user
      const serviceOrderWithCreator = await this.prisma.serviceOrder.findUnique({
        where: { id: serviceOrder.id },
        select: { createdById: true },
      });

      if (serviceOrderWithCreator?.createdById &&
          serviceOrderWithCreator.createdById !== assignedToId &&
          serviceOrderWithCreator.createdById !== userId) {
        const creator = await this.prisma.user.findUnique({
          where: { id: serviceOrderWithCreator.createdById },
          select: { isActive: true },
        });

        if (creator?.isActive) {
          await this.notificationService.createNotification({
            userId: serviceOrderWithCreator.createdById,
            title: `Ordem de serviço "${serviceOrder.description}" da tarefa "${taskIdentifier}": ${changesText} alterado(s) por ${changedByName}`,
            body: `A ordem de serviço "${serviceOrder.description}" da tarefa ${taskIdentifier} teve ${changesText} alterado(s) por ${changedByName}`,
            type: NOTIFICATION_TYPE.SERVICE_ORDER,
            channel: [
              NOTIFICATION_CHANNEL.IN_APP,
              NOTIFICATION_CHANNEL.PUSH,
              NOTIFICATION_CHANNEL.WHATSAPP,
            ],
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
            actionUrl,
            relatedEntityType: 'SERVICE_ORDER',
            relatedEntityId: serviceOrder.id,
            isMandatory: false,
            metadata: {
              ...linkMetadata,
              serviceOrderId: serviceOrder.id,
              serviceOrderType: serviceOrder.type,
              taskIdentifier,
              changedBy: changedByName,
              changedFields: changes,
              eventType: 'my.updated',
            },
          });
          this.logger.log('[SERVICE ORDER EVENT] ✅ Update notification also sent to creator');
        }
      }

      this.logger.log('[SERVICE ORDER EVENT] ✅ Update notification sent to assigned user');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[SERVICE ORDER EVENT] ❌ Error creating assigned user update notification:', error);
    }
  }
}
