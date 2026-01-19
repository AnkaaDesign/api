import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { assertCanUpdateServiceOrder } from './service-order.permissions';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  ServiceOrderGetUniqueResponse,
  ServiceOrderGetManyResponse,
  ServiceOrderCreateResponse,
  ServiceOrderUpdateResponse,
  ServiceOrderDeleteResponse,
  ServiceOrderBatchCreateResponse,
  ServiceOrderBatchUpdateResponse,
  ServiceOrderBatchDeleteResponse,
} from '../../../types';
import { ServiceOrderRepository } from './repositories/service-order/service-order.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  ServiceOrderCreateFormData,
  ServiceOrderUpdateFormData,
  ServiceOrderGetManyFormData,
  ServiceOrderInclude,
  ServiceOrderBatchCreateFormData,
  ServiceOrderBatchUpdateFormData,
  ServiceOrderBatchDeleteFormData,
} from '../../../schemas/serviceOrder';
import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  TASK_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';

@Injectable()
export class ServiceOrderService {
  private readonly logger = new Logger(ServiceOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceOrderRepository: ServiceOrderRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new service order
   */
  async create(
    data: ServiceOrderCreateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
  ): Promise<ServiceOrderCreateResponse> {
    try {
      // Validate task exists
      const taskExists = await this.prisma.task.findUnique({
        where: { id: data.taskId },
      });

      if (!taskExists) {
        throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
      }

      // Validate assignedTo user exists if provided
      if (data.assignedToId) {
        const userExists = await this.prisma.user.findUnique({
          where: { id: data.assignedToId },
        });

        if (!userExists) {
          throw new NotFoundException(
            'Usuário atribuído não encontrado. Verifique se o ID está correto.',
          );
        }
      }

      const serviceOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get task's current service orders before creating new one
        const taskWithServices = await tx.task.findUnique({
          where: { id: data.taskId },
          include: {
            serviceOrders: {
              select: {
                description: true,
                status: true,
                startedAt: true,
                finishedAt: true,
              },
            },
          },
        });

        const oldServices = taskWithServices?.serviceOrders || [];

        // Create the service order with createdById
        const createData = {
          ...data,
          createdById: userId || '',
        };

        const created = await this.serviceOrderRepository.createWithTransaction(tx, createData, {
          include,
        });

        // Log the creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: created,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          reason: 'Ordem de serviço criada',
          transaction: tx,
        });

        // Build new services array by adding the created service order
        const serializeServices = (services: any[]) => {
          return services.map((s: any) => ({
            description: s.description,
            status: s.status,
            ...(s.startedAt && { startedAt: s.startedAt }),
            ...(s.finishedAt && { finishedAt: s.finishedAt }),
          }));
        };

        // Add the newly created service order to the old services array
        const newServices = [
          ...oldServices,
          {
            description: created.description,
            status: created.status,
            startedAt: created.startedAt,
            finishedAt: created.finishedAt,
          },
        ];

        // Log task serviceOrders field change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: data.taskId,
          action: CHANGE_ACTION.UPDATE,
          field: 'serviceOrders',
          oldValue: serializeServices(oldServices),
          newValue: serializeServices(newServices),
          reason: `Ordem de serviço adicionada (${oldServices.length} → ${newServices.length})`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: data.taskId,
          userId: userId || '',
          transaction: tx,
        });

        return created;
      });

      // Emit events after successful creation
      this.eventEmitter.emit('service-order.created', {
        serviceOrder,
        userId,
      });

      // If service order is assigned, emit assignment event
      if (serviceOrder.assignedToId) {
        this.eventEmitter.emit('service-order.assigned', {
          serviceOrder,
          userId,
          assignedToId: serviceOrder.assignedToId,
        });
      }

      return {
        success: true,
        message: 'Ordem de serviço criada com sucesso.',
        data: serviceOrder,
      };
    } catch (error) {
      this.logger.error('Erro ao criar ordem de serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing service order
   */
  async update(
    id: string,
    data: ServiceOrderUpdateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
    userPrivilege?: string,
  ): Promise<ServiceOrderUpdateResponse> {
    try {
      const serviceOrderExists = await this.serviceOrderRepository.findById(id);
      if (!serviceOrderExists) {
        throw new NotFoundException(
          'Ordem de serviço não encontrada. Verifique se o ID está correto.',
        );
      }

      // Check permissions before allowing update
      if (userId && userPrivilege) {
        assertCanUpdateServiceOrder(
          serviceOrderExists,
          userId,
          userPrivilege,
          data.status as SERVICE_ORDER_STATUS,
        );
      }

      // If updating taskId, validate it exists
      if (data.taskId) {
        const taskExists = await this.prisma.task.findUnique({
          where: { id: data.taskId },
        });

        if (!taskExists) {
          throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
        }
      }

      // If updating assignedToId, validate user exists
      if (data.assignedToId) {
        const userExists = await this.prisma.user.findUnique({
          where: { id: data.assignedToId },
        });

        if (!userExists) {
          throw new NotFoundException(
            'Usuário atribuído não encontrado. Verifique se o ID está correto.',
          );
        }
      }

      // Track if task was auto-started for event emission after transaction
      let taskAutoStarted: { taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS } | null = null;
      // Track if task was auto-transitioned to WAITING_PRODUCTION for event emission after transaction
      let taskAutoTransitionedToWaitingProduction: { taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS } | null = null;
      // Track if task was auto-completed for event emission after transaction
      let taskAutoCompleted: { taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS } | null = null;

      const serviceOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const oldData = serviceOrderExists;

        // Build the update data with automatic user tracking based on status changes
        const updateData: any = { ...data };

        // Automatically set startedBy/startedAt when status changes to IN_PROGRESS
        if (data.status === SERVICE_ORDER_STATUS.IN_PROGRESS && oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS) {
          if (!oldData.startedById) {
            updateData.startedById = userId || null;
            updateData.startedAt = new Date();
          }
        }

        // Automatically set approvedBy/approvedAt when status changes from WAITING_APPROVE to another status (approved)
        // This happens when an ARTWORK service order is approved by admin
        if (oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
            data.status && data.status !== SERVICE_ORDER_STATUS.WAITING_APPROVE) {
          if (data.status === SERVICE_ORDER_STATUS.COMPLETED || data.status === SERVICE_ORDER_STATUS.IN_PROGRESS) {
            if (!oldData.approvedById) {
              updateData.approvedById = userId || null;
              updateData.approvedAt = new Date();
            }
          }
        }

        // Automatically set completedBy/finishedAt when status changes to COMPLETED
        if (data.status === SERVICE_ORDER_STATUS.COMPLETED && oldData.status !== SERVICE_ORDER_STATUS.COMPLETED) {
          if (!oldData.completedById) {
            updateData.completedById = userId || null;
            updateData.finishedAt = new Date();
          }
        }

        // If going back to IN_PROGRESS (rejection scenario), clear approval data
        if (data.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
            (oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE || oldData.status === SERVICE_ORDER_STATUS.COMPLETED)) {
          // The observation field should be set by the caller for rejection reasons
          // Clear completion data if going back from completed
          if (oldData.status === SERVICE_ORDER_STATUS.COMPLETED) {
            updateData.completedById = null;
            updateData.finishedAt = null;
          }
        }

        const updated = await this.serviceOrderRepository.updateWithTransaction(tx, id, updateData, {
          include,
        });

        // Track field-level changes - include new fields
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: id,
          oldEntity: oldData,
          newEntity: updated,
          fieldsToTrack: [
            'status',
            'description',
            'observation',
            'taskId',
            'startedAt',
            'startedById',
            'approvedAt',
            'approvedById',
            'finishedAt',
            'completedById',
            'type',
            'assignedToId',
          ],
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Auto-start task when service order is started and task is waiting for production
        // This ensures the task workflow progresses automatically when work begins
        if (
          data.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
          oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true },
          });

          // If task is WAITING_PRODUCTION, auto-start it
          if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
            this.logger.log(
              `[AUTO-START] Service order ${id} started, auto-starting task ${task.id} (WAITING_PRODUCTION → IN_PRODUCTION)`,
            );

            await tx.task.update({
              where: { id: task.id },
              data: {
                status: TASK_STATUS.IN_PRODUCTION,
                startedAt: new Date(),
              },
            });

            // Log the auto-start in changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: task.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'status',
              oldValue: TASK_STATUS.WAITING_PRODUCTION,
              newValue: TASK_STATUS.IN_PRODUCTION,
              reason: `Tarefa iniciada automaticamente quando ordem de serviço "${updated.description}" foi iniciada`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });

            // Track for event emission after transaction commits
            taskAutoStarted = {
              taskId: task.id,
              oldStatus: TASK_STATUS.WAITING_PRODUCTION,
              newStatus: TASK_STATUS.IN_PRODUCTION,
            };
          }
        }

        // Auto-transition task from PREPARATION to WAITING_PRODUCTION when all ARTWORK service orders are COMPLETED
        // This ensures the task workflow progresses automatically when all artwork approvals are complete
        if (
          data.status === SERVICE_ORDER_STATUS.COMPLETED &&
          oldData.status !== SERVICE_ORDER_STATUS.COMPLETED &&
          updated.type === SERVICE_ORDER_TYPE.ARTWORK
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true },
          });

          // Only proceed if task is in PREPARATION status
          if (task && task.status === TASK_STATUS.PREPARATION) {
            // Get all ARTWORK service orders for this task
            const artworkServiceOrders = await tx.serviceOrder.findMany({
              where: {
                taskId: updated.taskId,
                type: SERVICE_ORDER_TYPE.ARTWORK,
              },
              select: { id: true, status: true },
            });

            // Check if there's at least 1 artwork service order and ALL are COMPLETED
            const hasArtworkOrders = artworkServiceOrders.length > 0;
            const allArtworkCompleted = artworkServiceOrders.every(
              (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
            );

            if (hasArtworkOrders && allArtworkCompleted) {
              this.logger.log(
                `[AUTO-TRANSITION] All ${artworkServiceOrders.length} ARTWORK service orders completed for task ${task.id}, transitioning PREPARATION → WAITING_PRODUCTION`,
              );

              await tx.task.update({
                where: { id: task.id },
                data: {
                  status: TASK_STATUS.WAITING_PRODUCTION,
                  statusOrder: 2, // WAITING_PRODUCTION statusOrder
                },
              });

              // Log the auto-transition in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: TASK_STATUS.PREPARATION,
                newValue: TASK_STATUS.WAITING_PRODUCTION,
                reason: `Tarefa liberada automaticamente para produção quando todas as ${artworkServiceOrders.length} ordens de serviço de arte foram concluídas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskAutoTransitionedToWaitingProduction = {
                taskId: task.id,
                oldStatus: TASK_STATUS.PREPARATION,
                newStatus: TASK_STATUS.WAITING_PRODUCTION,
              };
            }
          }
        }

        // Auto-complete task when all PRODUCTION service orders are COMPLETED
        // This ensures the task workflow progresses automatically when all production work is done
        if (
          data.status === SERVICE_ORDER_STATUS.COMPLETED &&
          oldData.status !== SERVICE_ORDER_STATUS.COMPLETED &&
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true, finishedAt: true },
          });

          // Only proceed if task is in IN_PRODUCTION or WAITING_PRODUCTION status (not already completed)
          if (task && (task.status === TASK_STATUS.IN_PRODUCTION || task.status === TASK_STATUS.WAITING_PRODUCTION)) {
            // Get all PRODUCTION service orders for this task
            const productionServiceOrders = await tx.serviceOrder.findMany({
              where: {
                taskId: updated.taskId,
                type: SERVICE_ORDER_TYPE.PRODUCTION,
              },
              select: { id: true, status: true },
            });

            // Check if there's at least 1 production service order and ALL are COMPLETED
            const hasProductionOrders = productionServiceOrders.length > 0;
            const allProductionCompleted = productionServiceOrders.every(
              (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
            );

            if (hasProductionOrders && allProductionCompleted) {
              this.logger.log(
                `[AUTO-COMPLETE TASK] All ${productionServiceOrders.length} PRODUCTION service orders completed for task ${task.id}, transitioning to COMPLETED`,
              );

              const oldTaskStatus = task.status;
              await tx.task.update({
                where: { id: task.id },
                data: {
                  status: TASK_STATUS.COMPLETED,
                  statusOrder: 4, // COMPLETED statusOrder
                  finishedAt: task.finishedAt || new Date(),
                  // Also set startedAt if not already set
                  startedAt: task.startedAt || new Date(),
                },
              });

              // Log the auto-complete in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: oldTaskStatus,
                newValue: TASK_STATUS.COMPLETED,
                reason: `Tarefa concluída automaticamente quando todas as ${productionServiceOrders.length} ordens de serviço de produção foram finalizadas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskAutoCompleted = {
                taskId: task.id,
                oldStatus: oldTaskStatus,
                newStatus: TASK_STATUS.COMPLETED,
              };
            }
          }
        }

        return updated;
      });

      // Emit events after successful update
      // Check if status changed
      if (serviceOrderExists.status !== serviceOrder.status) {
        this.eventEmitter.emit('service-order.status.changed', {
          serviceOrder,
          oldStatus: serviceOrderExists.status,
          newStatus: serviceOrder.status,
          userId,
        });

        // If status changed to COMPLETED
        if (serviceOrder.status === SERVICE_ORDER_STATUS.COMPLETED) {
          this.eventEmitter.emit('service-order.completed', {
            serviceOrder,
            userId,
          });
        }

        // If status changed to WAITING_APPROVE and type is ARTWORK
        if (
          serviceOrder.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
          serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK
        ) {
          this.eventEmitter.emit('service-order.artwork-waiting-approval', {
            serviceOrder,
            userId,
          });
        }
      }

      // Check if assignedToId changed
      if (serviceOrderExists.assignedToId !== serviceOrder.assignedToId) {
        // If assigned to someone new (or reassigned)
        if (serviceOrder.assignedToId) {
          this.eventEmitter.emit('service-order.assigned', {
            serviceOrder,
            userId,
            assignedToId: serviceOrder.assignedToId,
            previousAssignedToId: serviceOrderExists.assignedToId,
          });
        }
      }

      // Notify assigned user when their service order is updated by someone else
      // Only notify if: service order is assigned, updater is not the assignee, and there were changes
      if (
        serviceOrder.assignedToId &&
        serviceOrder.assignedToId !== userId &&
        serviceOrderExists.status === serviceOrder.status // Status changes already send notifications
      ) {
        // Check if there were any actual changes (other than status which is already handled)
        const hasOtherChanges =
          serviceOrderExists.description !== serviceOrder.description ||
          serviceOrderExists.observation !== serviceOrder.observation ||
          serviceOrderExists.type !== serviceOrder.type;

        if (hasOtherChanges) {
          this.eventEmitter.emit('service-order.assigned-user-updated', {
            serviceOrder,
            oldServiceOrder: serviceOrderExists,
            userId,
            assignedToId: serviceOrder.assignedToId,
          });
        }
      }

      // Emit task status changed event if task was auto-started
      if (taskAutoStarted) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoStarted.taskId },
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the auto-start
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoStarted.oldStatus,
            newStatus: taskAutoStarted.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-START] Emitted task.status.changed event for task ${taskAutoStarted.taskId}`,
          );
        }
      }

      // Emit task status changed event if task was auto-transitioned to WAITING_PRODUCTION
      if (taskAutoTransitionedToWaitingProduction) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoTransitionedToWaitingProduction.taskId },
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the auto-transition
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoTransitionedToWaitingProduction.oldStatus,
            newStatus: taskAutoTransitionedToWaitingProduction.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-TRANSITION] Emitted task.status.changed event for task ${taskAutoTransitionedToWaitingProduction.taskId} (PREPARATION → WAITING_PRODUCTION)`,
          );

          // Emit task.created event to notify production sector users
          // For production users, WAITING_PRODUCTION is effectively the "new task" status
          this.eventEmitter.emit('task.created', {
            task: updatedTask,
            createdBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-TRANSITION] Emitted task.created event for task ${taskAutoTransitionedToWaitingProduction.taskId} (notifying production sector users)`,
          );
        }
      }

      // Emit task status changed event if task was auto-completed
      if (taskAutoCompleted) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoCompleted.taskId },
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the auto-complete
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoCompleted.oldStatus,
            newStatus: taskAutoCompleted.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-COMPLETE TASK] Emitted task.status.changed event for task ${taskAutoCompleted.taskId} (${taskAutoCompleted.oldStatus} → COMPLETED)`,
          );
        }
      }

      return {
        success: true,
        message: 'Ordem de serviço atualizada com sucesso.',
        data: serviceOrder,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar ordem de serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Delete a service order
   */
  async delete(id: string, userId?: string): Promise<ServiceOrderDeleteResponse> {
    try {
      const serviceOrderExists = await this.serviceOrderRepository.findById(id);
      if (!serviceOrderExists) {
        throw new NotFoundException(
          'Ordem de serviço não encontrada. Verifique se o ID está correto.',
        );
      }

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Delete the service order
        await this.serviceOrderRepository.deleteWithTransaction(tx, id);

        // Log the deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: serviceOrderExists,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          reason: 'Ordem de serviço excluída',
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Ordem de serviço excluída com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir ordem de serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Find a single service order by ID
   */
  async findById(
    id: string,
    include?: ServiceOrderInclude,
  ): Promise<ServiceOrderGetUniqueResponse> {
    try {
      const serviceOrder = await this.serviceOrderRepository.findById(id, { include });

      if (!serviceOrder) {
        throw new NotFoundException(
          'Ordem de serviço não encontrada. Verifique se o ID está correto.',
        );
      }

      return {
        success: true,
        message: 'Ordem de serviço encontrada com sucesso.',
        data: serviceOrder,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar ordem de serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Find many service orders with pagination
   */
  async findMany(query: ServiceOrderGetManyFormData): Promise<ServiceOrderGetManyResponse> {
    try {
      const result = await this.serviceOrderRepository.findMany(query);

      return {
        success: true,
        message: 'Ordens de serviço carregadas com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar ordens de serviço:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar as ordens de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Batch create service orders
   */
  async batchCreate(
    data: ServiceOrderBatchCreateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
  ): Promise<ServiceOrderBatchCreateResponse<ServiceOrderCreateFormData>> {
    try {
      // Validate all task IDs exist
      const taskIds = Array.from(new Set(data.serviceOrders.map(item => item.taskId)));
      const tasks = await this.prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true },
      });

      const existingTaskIds = new Set(tasks.map(t => t.id));
      const invalidItems = data.serviceOrders.filter(item => !existingTaskIds.has(item.taskId));

      if (invalidItems.length > 0) {
        throw new BadRequestException(
          `As seguintes tarefas não foram encontradas: ${invalidItems.map(i => i.taskId).join(', ')}`,
        );
      }

      // Validate all assignedTo user IDs exist if provided
      const userIdsToValidate = new Set<string>();
      data.serviceOrders.forEach(item => {
        if (item.assignedToId) {
          userIdsToValidate.add(item.assignedToId);
        }
      });

      if (userIdsToValidate.size > 0) {
        const users = await this.prisma.user.findMany({
          where: { id: { in: Array.from(userIdsToValidate) } },
          select: { id: true },
        });

        const existingUserIds = new Set(users.map(u => u.id));
        const invalidUserIds = Array.from(userIdsToValidate).filter(id => !existingUserIds.has(id));

        if (invalidUserIds.length > 0) {
          throw new BadRequestException(
            `Os seguintes usuários não foram encontrados: ${invalidUserIds.join(', ')}`,
          );
        }
      }

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.serviceOrderRepository.createManyWithTransaction(
          tx,
          data.serviceOrders,
          { include },
        );

        // Log all successful creations
        for (const serviceOrder of batchResult.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.SERVICE_ORDER,
            entityId: serviceOrder.id,
            action: CHANGE_ACTION.CREATE,
            entity: serviceOrder,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            reason: 'Ordem de serviço criada em lote',
            transaction: tx,
          });
        }

        return batchResult;
      });

      // Emit events for all successfully created service orders
      // This must happen AFTER the transaction completes successfully
      for (const serviceOrder of result.success) {
        // Emit creation event
        this.eventEmitter.emit('service-order.created', {
          serviceOrder,
          userId,
        });

        // If service order is assigned, emit assignment event
        if (serviceOrder.assignedToId) {
          this.eventEmitter.emit('service-order.assigned', {
            serviceOrder,
            userId,
            assignedToId: serviceOrder.assignedToId,
          });
        }
      }

      // Convert BatchCreateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${result.totalCreated} ordens de serviço criadas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao criar ordens de serviço em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar as ordens de serviço em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch update service orders
   */
  async batchUpdate(
    data: ServiceOrderBatchUpdateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
  ): Promise<ServiceOrderBatchUpdateResponse<ServiceOrderUpdateFormData>> {
    try {
      // Get all service orders to update
      const ids = data.serviceOrders.map(item => item.id);
      const existingServiceOrders = await this.serviceOrderRepository.findByIds(ids);
      const existingMap = new Map(existingServiceOrders.map(so => [so.id, so]));

      // Validate all IDs exist
      const missingIds = ids.filter(id => !existingMap.has(id));
      if (missingIds.length > 0) {
        throw new BadRequestException(
          `As seguintes ordens de serviço não foram encontradas: ${missingIds.join(', ')}`,
        );
      }

      // Validate task IDs if being updated
      const taskIdsToValidate = new Set<string>();
      data.serviceOrders.forEach(item => {
        if (item.data.taskId) {
          taskIdsToValidate.add(item.data.taskId);
        }
      });

      if (taskIdsToValidate.size > 0) {
        const tasks = await this.prisma.task.findMany({
          where: { id: { in: Array.from(taskIdsToValidate) } },
          select: { id: true },
        });

        const existingTaskIds = new Set(tasks.map(t => t.id));
        const invalidTaskIds = Array.from(taskIdsToValidate).filter(id => !existingTaskIds.has(id));

        if (invalidTaskIds.length > 0) {
          throw new BadRequestException(
            `As seguintes tarefas não foram encontradas: ${invalidTaskIds.join(', ')}`,
          );
        }
      }

      // Validate assignedTo user IDs if being updated
      const userIdsToValidate = new Set<string>();
      data.serviceOrders.forEach(item => {
        if (item.data.assignedToId) {
          userIdsToValidate.add(item.data.assignedToId);
        }
      });

      if (userIdsToValidate.size > 0) {
        const users = await this.prisma.user.findMany({
          where: { id: { in: Array.from(userIdsToValidate) } },
          select: { id: true },
        });

        const existingUserIds = new Set(users.map(u => u.id));
        const invalidUserIds = Array.from(userIdsToValidate).filter(id => !existingUserIds.has(id));

        if (invalidUserIds.length > 0) {
          throw new BadRequestException(
            `Os seguintes usuários não foram encontrados: ${invalidUserIds.join(', ')}`,
          );
        }
      }

      // Process each update to apply automatic timestamp logic (same as single update)
      const updates = data.serviceOrders.map(item => {
        const oldData = existingMap.get(item.id);
        if (!oldData) {
          return { id: item.id, data: item.data };
        }

        const updateData: any = { ...item.data };

        // Automatically set startedBy/startedAt when status changes to IN_PROGRESS
        if (updateData.status === SERVICE_ORDER_STATUS.IN_PROGRESS && oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS) {
          if (!oldData.startedById) {
            updateData.startedById = userId || null;
            updateData.startedAt = new Date();
          }
        }

        // Automatically set approvedBy/approvedAt when status changes from WAITING_APPROVE to another status (approved)
        if (oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
            updateData.status && updateData.status !== SERVICE_ORDER_STATUS.WAITING_APPROVE) {
          if (updateData.status === SERVICE_ORDER_STATUS.COMPLETED || updateData.status === SERVICE_ORDER_STATUS.IN_PROGRESS) {
            if (!oldData.approvedById) {
              updateData.approvedById = userId || null;
              updateData.approvedAt = new Date();
            }
          }
        }

        // Automatically set completedBy/finishedAt when status changes to COMPLETED
        if (updateData.status === SERVICE_ORDER_STATUS.COMPLETED && oldData.status !== SERVICE_ORDER_STATUS.COMPLETED) {
          if (!oldData.completedById) {
            updateData.completedById = userId || null;
            updateData.finishedAt = new Date();
          }
        }

        // If going back to IN_PROGRESS (rejection scenario), clear approval data
        if (updateData.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
            (oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE || oldData.status === SERVICE_ORDER_STATUS.COMPLETED)) {
          // Clear completion data if going back from completed
          if (oldData.status === SERVICE_ORDER_STATUS.COMPLETED) {
            updateData.completedById = null;
            updateData.finishedAt = null;
          }
        }

        return { id: item.id, data: updateData };
      });

      // Track auto-started tasks for event emission after transaction
      const tasksAutoStarted: Array<{ taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS }> = [];
      // Track tasks auto-transitioned to WAITING_PRODUCTION for event emission after transaction
      const tasksAutoTransitionedToWaitingProduction: Array<{ taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS }> = [];
      // Track tasks auto-completed for event emission after transaction
      const tasksAutoCompleted: Array<{ taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS }> = [];

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.serviceOrderRepository.updateManyWithTransaction(
          tx,
          updates,
          { include },
        );

        // Log all successful updates with complete field tracking
        for (const serviceOrder of batchResult.success) {
          const oldData = existingMap.get(serviceOrder.id);
          if (oldData) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE_ORDER,
              entityId: serviceOrder.id,
              oldEntity: oldData,
              newEntity: serviceOrder,
              fieldsToTrack: [
                'status',
                'description',
                'observation',
                'taskId',
                'startedAt',
                'startedById',
                'approvedAt',
                'approvedById',
                'finishedAt',
                'completedById',
                'type',
                'assignedToId',
              ],
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // Auto-start task when service order is started and task is waiting for production
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
              oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS
            ) {
              // Check if this task was already auto-started in this batch
              const alreadyStarted = tasksAutoStarted.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyStarted) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true },
                });

                if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
                  this.logger.log(
                    `[AUTO-START BATCH] Service order ${serviceOrder.id} started, auto-starting task ${task.id}`,
                  );

                  await tx.task.update({
                    where: { id: task.id },
                    data: {
                      status: TASK_STATUS.IN_PRODUCTION,
                      startedAt: new Date(),
                    },
                  });

                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: TASK_STATUS.WAITING_PRODUCTION,
                    newValue: TASK_STATUS.IN_PRODUCTION,
                    reason: `Tarefa iniciada automaticamente quando ordem de serviço "${serviceOrder.description}" foi iniciada (batch)`,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: serviceOrder.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  tasksAutoStarted.push({
                    taskId: task.id,
                    oldStatus: TASK_STATUS.WAITING_PRODUCTION,
                    newStatus: TASK_STATUS.IN_PRODUCTION,
                  });
                }
              }
            }

            // Auto-transition task from PREPARATION to WAITING_PRODUCTION when all ARTWORK service orders are COMPLETED
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.COMPLETED &&
              oldData.status !== SERVICE_ORDER_STATUS.COMPLETED &&
              serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK
            ) {
              // Check if this task was already auto-transitioned in this batch
              const alreadyTransitioned = tasksAutoTransitionedToWaitingProduction.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyTransitioned) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true },
                });

                // Only proceed if task is in PREPARATION status
                if (task && task.status === TASK_STATUS.PREPARATION) {
                  // Get all ARTWORK service orders for this task
                  const artworkServiceOrders = await tx.serviceOrder.findMany({
                    where: {
                      taskId: serviceOrder.taskId,
                      type: SERVICE_ORDER_TYPE.ARTWORK,
                    },
                    select: { id: true, status: true },
                  });

                  // Check if there's at least 1 artwork service order and ALL are COMPLETED
                  const hasArtworkOrders = artworkServiceOrders.length > 0;
                  const allArtworkCompleted = artworkServiceOrders.every(
                    (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
                  );

                  if (hasArtworkOrders && allArtworkCompleted) {
                    this.logger.log(
                      `[AUTO-TRANSITION BATCH] All ${artworkServiceOrders.length} ARTWORK service orders completed for task ${task.id}, transitioning PREPARATION → WAITING_PRODUCTION`,
                    );

                    await tx.task.update({
                      where: { id: task.id },
                      data: {
                        status: TASK_STATUS.WAITING_PRODUCTION,
                        statusOrder: 2, // WAITING_PRODUCTION statusOrder
                      },
                    });

                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: TASK_STATUS.PREPARATION,
                      newValue: TASK_STATUS.WAITING_PRODUCTION,
                      reason: `Tarefa liberada automaticamente para produção quando todas as ${artworkServiceOrders.length} ordens de serviço de arte foram concluídas (batch)`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksAutoTransitionedToWaitingProduction.push({
                      taskId: task.id,
                      oldStatus: TASK_STATUS.PREPARATION,
                      newStatus: TASK_STATUS.WAITING_PRODUCTION,
                    });
                  }
                }
              }
            }

            // Auto-complete task when all PRODUCTION service orders are COMPLETED
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.COMPLETED &&
              oldData.status !== SERVICE_ORDER_STATUS.COMPLETED &&
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION
            ) {
              // Check if this task was already auto-completed in this batch
              const alreadyCompleted = tasksAutoCompleted.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyCompleted) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true, finishedAt: true },
                });

                // Only proceed if task is in IN_PRODUCTION or WAITING_PRODUCTION status
                if (task && (task.status === TASK_STATUS.IN_PRODUCTION || task.status === TASK_STATUS.WAITING_PRODUCTION)) {
                  // Get all PRODUCTION service orders for this task
                  const productionServiceOrders = await tx.serviceOrder.findMany({
                    where: {
                      taskId: serviceOrder.taskId,
                      type: SERVICE_ORDER_TYPE.PRODUCTION,
                    },
                    select: { id: true, status: true },
                  });

                  // Check if there's at least 1 production service order and ALL are COMPLETED
                  const hasProductionOrders = productionServiceOrders.length > 0;
                  const allProductionCompleted = productionServiceOrders.every(
                    (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
                  );

                  if (hasProductionOrders && allProductionCompleted) {
                    this.logger.log(
                      `[AUTO-COMPLETE TASK BATCH] All ${productionServiceOrders.length} PRODUCTION service orders completed for task ${task.id}, transitioning to COMPLETED`,
                    );

                    const oldTaskStatus = task.status;
                    await tx.task.update({
                      where: { id: task.id },
                      data: {
                        status: TASK_STATUS.COMPLETED,
                        statusOrder: 4, // COMPLETED statusOrder
                        finishedAt: task.finishedAt || new Date(),
                        startedAt: task.startedAt || new Date(),
                      },
                    });

                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: oldTaskStatus,
                      newValue: TASK_STATUS.COMPLETED,
                      reason: `Tarefa concluída automaticamente quando todas as ${productionServiceOrders.length} ordens de serviço de produção foram finalizadas (batch)`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksAutoCompleted.push({
                      taskId: task.id,
                      oldStatus: oldTaskStatus,
                      newStatus: TASK_STATUS.COMPLETED,
                    });
                  }
                }
              }
            }
          }
        }

        return batchResult;
      });

      // Emit events for successful updates
      for (const serviceOrder of result.success) {
        const oldData = existingMap.get(serviceOrder.id);
        if (!oldData) continue;

        // Emit status.changed event if status changed
        if (oldData.status !== serviceOrder.status) {
          this.eventEmitter.emit('service-order.status.changed', {
            serviceOrder,
            oldStatus: oldData.status,
            newStatus: serviceOrder.status,
            userId,
          });

          // If status changed to COMPLETED
          if (serviceOrder.status === SERVICE_ORDER_STATUS.COMPLETED) {
            this.eventEmitter.emit('service-order.completed', {
              serviceOrder,
              userId,
            });
          }

          // If status changed to WAITING_APPROVE and type is ARTWORK
          if (serviceOrder.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
              serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK) {
            this.eventEmitter.emit('service-order.artwork-waiting-approval', {
              serviceOrder,
              userId,
            });
          }
        }

        // Emit assigned event if assignedToId changed
        if (oldData.assignedToId !== serviceOrder.assignedToId) {
          this.eventEmitter.emit('service-order.assigned', {
            serviceOrder,
            userId,
            assignedToId: serviceOrder.assignedToId,
            previousAssignedToId: oldData.assignedToId,
          });

          // Also emit assigned-user-updated if not a status change
          if (oldData.status === serviceOrder.status) {
            this.eventEmitter.emit('service-order.assigned-user-updated', {
              serviceOrder,
              oldServiceOrder: oldData,
              userId,
              assignedToId: serviceOrder.assignedToId,
            });
          }
        }
      }

      // Emit task status changed events for auto-started tasks
      for (const taskAutoStarted of tasksAutoStarted) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoStarted.taskId },
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            sectorId: true,
          },
        });

        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoStarted.oldStatus,
            newStatus: taskAutoStarted.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-START BATCH] Emitted task.status.changed event for task ${taskAutoStarted.taskId}`,
          );
        }
      }

      // Emit task status changed events for tasks auto-transitioned to WAITING_PRODUCTION
      for (const taskAutoTransitioned of tasksAutoTransitionedToWaitingProduction) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoTransitioned.taskId },
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            sectorId: true,
          },
        });

        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoTransitioned.oldStatus,
            newStatus: taskAutoTransitioned.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-TRANSITION BATCH] Emitted task.status.changed event for task ${taskAutoTransitioned.taskId} (PREPARATION → WAITING_PRODUCTION)`,
          );

          // Emit task.created event to notify production sector users
          // For production users, WAITING_PRODUCTION is effectively the "new task" status
          this.eventEmitter.emit('task.created', {
            task: updatedTask,
            createdBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-TRANSITION BATCH] Emitted task.created event for task ${taskAutoTransitioned.taskId} (notifying production sector users)`,
          );
        }
      }

      // Emit task status changed events for tasks auto-completed
      for (const taskAutoComplete of tasksAutoCompleted) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoComplete.taskId },
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            sectorId: true,
          },
        });

        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoComplete.oldStatus,
            newStatus: taskAutoComplete.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-COMPLETE TASK BATCH] Emitted task.status.changed event for task ${taskAutoComplete.taskId} (${taskAutoComplete.oldStatus} → COMPLETED)`,
          );
        }
      }

      // Convert BatchUpdateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${result.totalUpdated} ordens de serviço atualizadas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar ordens de serviço em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar as ordens de serviço em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete service orders
   */
  async batchDelete(
    data: ServiceOrderBatchDeleteFormData,
    userId?: string,
  ): Promise<ServiceOrderBatchDeleteResponse> {
    try {
      // Get all service orders to delete
      const existingServiceOrders = await this.serviceOrderRepository.findByIds(
        data.serviceOrderIds,
      );
      const existingMap = new Map(existingServiceOrders.map(so => [so.id, so]));

      // Validate all IDs exist
      const missingIds = data.serviceOrderIds.filter(id => !existingMap.has(id));
      if (missingIds.length > 0) {
        throw new BadRequestException(
          `As seguintes ordens de serviço não foram encontradas: ${missingIds.join(', ')}`,
        );
      }

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.serviceOrderRepository.deleteManyWithTransaction(
          tx,
          data.serviceOrderIds,
        );

        // Log all successful deletions
        for (const { id } of batchResult.success) {
          const oldData = existingMap.get(id);
          if (oldData) {
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE_ORDER,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: oldData,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              reason: 'Ordem de serviço excluída em lote',
              transaction: tx,
            });
          }
        }

        return batchResult;
      });

      // Convert BatchDeleteResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index !== undefined ? error.index : index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${result.totalDeleted} ordens de serviço excluídas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao excluir ordens de serviço em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir as ordens de serviço em lote. Tente novamente.',
      );
    }
  }
}
