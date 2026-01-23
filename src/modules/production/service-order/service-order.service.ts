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
import {
  getTaskUpdateForServiceOrderStatusChange,
  getTaskStatusOrder,
  isStatusRollback,
} from '../../../utils/task-service-order-sync';
import {
  getServiceOrderToPricingSync,
  type SyncPricingItem,
} from '../../../utils/task-pricing-service-order-sync';
import {
  getServiceDescriptionsByType,
  SERVICE_DESCRIPTIONS_BY_TYPE,
} from '../../../constants/service-descriptions';

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
   * Convert a string to Title Case (first letter of each word capitalized)
   * Handles Portuguese prepositions (de, da, do, das, dos, na, no, nas, nos, e, em)
   */
  private toTitleCase(str: string): string {
    if (!str) return str;

    // Portuguese prepositions that should stay lowercase (unless at the start)
    const lowercaseWords = new Set(['de', 'da', 'do', 'das', 'dos', 'na', 'no', 'nas', 'nos', 'e', 'em', 'para', 'com']);

    return str
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (!word) return word;
        // Keep prepositions lowercase unless it's the first word
        if (index > 0 && lowercaseWords.has(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

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
        // Convert description to Title Case for consistency
        const createData = {
          ...data,
          description: this.toTitleCase(data.description),
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

        // =====================================================================
        // SYNC: Production Service Order → Task Pricing Item
        // When a PRODUCTION service order is created, automatically create
        // a corresponding pricing item (description + observation → item description)
        // =====================================================================
        if (created.type === SERVICE_ORDER_TYPE.PRODUCTION) {
          try {
            // Get task's pricing information
            const taskWithPricing = await tx.task.findUnique({
              where: { id: data.taskId },
              include: {
                pricing: {
                  include: { items: true },
                },
              },
            });

            if (taskWithPricing?.pricing) {
              const existingPricingItems: SyncPricingItem[] = (taskWithPricing.pricing.items || []).map((item: any) => ({
                id: item.id,
                description: item.description,
                observation: item.observation,
                amount: item.amount,
              }));

              // Check if we should create a pricing item
              const syncResult = getServiceOrderToPricingSync(
                {
                  id: created.id,
                  description: created.description,
                  observation: created.observation,
                  type: created.type,
                },
                existingPricingItems,
              );

              if (syncResult.shouldCreatePricingItem) {
                this.logger.log(
                  `[SO→PRICING SYNC] Creating pricing item: "${syncResult.pricingItemDescription}" for SO "${created.description}"`,
                );

                await tx.taskPricingItem.create({
                  data: {
                    pricingId: taskWithPricing.pricing.id,
                    description: syncResult.pricingItemDescription,
                    observation: syncResult.pricingItemObservation,
                    amount: syncResult.pricingItemAmount,
                  },
                });

                // Recalculate pricing subtotal and total
                const allItems = await tx.taskPricingItem.findMany({
                  where: { pricingId: taskWithPricing.pricing.id },
                });
                const newSubtotal = allItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

                await tx.taskPricing.update({
                  where: { id: taskWithPricing.pricing.id },
                  data: {
                    subtotal: newSubtotal,
                    total: newSubtotal,
                  },
                });

                this.logger.log(`[SO→PRICING SYNC] Pricing item created. New pricing subtotal: ${newSubtotal}`);
              } else {
                this.logger.log(`[SO→PRICING SYNC] Skipped: ${syncResult.reason}`);
              }
            } else {
              this.logger.log(`[SO→PRICING SYNC] Skipped: Task ${data.taskId} has no pricing`);
            }
          } catch (syncError) {
            this.logger.error('[SO→PRICING SYNC] Error during sync:', syncError);
            // Don't throw - sync errors shouldn't block service order creation
          }
        }

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
      // Track if task was rolled back for event emission after transaction
      let taskRolledBack: { taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS } | null = null;

      const serviceOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const oldData = serviceOrderExists;

        // Build the update data with automatic user tracking based on status changes
        // Convert description to Title Case if provided
        const updateData: any = {
          ...data,
          ...(data.description && { description: this.toTitleCase(data.description) }),
        };

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

        // If going back to PENDING, clear all progress data (rollback to initial state)
        if (data.status === SERVICE_ORDER_STATUS.PENDING && oldData.status !== SERVICE_ORDER_STATUS.PENDING) {
          this.logger.log(`[SERVICE ORDER ROLLBACK] Clearing all dates for SO ${id}: ${oldData.status} → PENDING`);
          updateData.startedById = null;
          updateData.startedAt = null;
          updateData.approvedById = null;
          updateData.approvedAt = null;
          updateData.completedById = null;
          updateData.finishedAt = null;
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

        // Auto-start task when PRODUCTION service order is started and task is waiting for production
        // This ensures the task workflow progresses automatically when work begins
        // NOTE: Only PRODUCTION type service orders trigger task auto-start, not ARTWORK
        if (
          data.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
          oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS &&
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION
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

        // Auto-transition task from PREPARATION to WAITING_PRODUCTION when at least one ARTWORK service order is COMPLETED
        // This ensures the task workflow progresses automatically when any artwork approval is complete
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
            // Since this artwork service order just became COMPLETED, we can transition the task
            // No need to check other artwork orders - one completed artwork is enough
            this.logger.log(
              `[AUTO-TRANSITION] ARTWORK service order ${id} completed for task ${task.id}, transitioning PREPARATION → WAITING_PRODUCTION`,
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
              reason: `Tarefa liberada automaticamente para produção quando ordem de serviço de arte "${updated.description}" foi concluída`,
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

            // Filter out CANCELLED orders - they don't block task completion
            const activeProductionOrders = productionServiceOrders.filter(
              (so) => so.status !== SERVICE_ORDER_STATUS.CANCELLED
            );

            // Check if there's at least 1 active production service order and ALL are COMPLETED
            const hasActiveProductionOrders = activeProductionOrders.length > 0;
            const allActiveProductionCompleted = activeProductionOrders.every(
              (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
            );

            if (hasActiveProductionOrders && allActiveProductionCompleted) {
              this.logger.log(
                `[AUTO-COMPLETE TASK] All ${activeProductionOrders.length} active PRODUCTION service orders completed for task ${task.id}, transitioning to COMPLETED`,
              );

              const oldTaskStatus = task.status as TASK_STATUS;
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
                reason: `Tarefa concluída automaticamente quando todas as ${activeProductionOrders.length} ordens de serviço de produção ativas foram finalizadas`,
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

        // =====================================================================
        // AUTO-COMPLETE TASK WHEN SERVICE ORDER IS CANCELLED
        // When a PRODUCTION service order is cancelled, check if all remaining
        // active (non-cancelled) production orders are completed - if so, complete the task
        // =====================================================================
        if (
          data.status === SERVICE_ORDER_STATUS.CANCELLED &&
          oldData.status !== SERVICE_ORDER_STATUS.CANCELLED &&
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true, finishedAt: true },
          });

          // Only proceed if task is in IN_PRODUCTION or WAITING_PRODUCTION status
          if (task && (task.status === TASK_STATUS.IN_PRODUCTION || task.status === TASK_STATUS.WAITING_PRODUCTION)) {
            // Get all PRODUCTION service orders for this task
            const productionServiceOrders = await tx.serviceOrder.findMany({
              where: {
                taskId: updated.taskId,
                type: SERVICE_ORDER_TYPE.PRODUCTION,
              },
              select: { id: true, status: true },
            });

            // Filter out CANCELLED orders - they don't block task completion
            const activeProductionOrders = productionServiceOrders.filter(
              (so) => so.status !== SERVICE_ORDER_STATUS.CANCELLED
            );

            // Check if there's at least 1 active production service order and ALL are COMPLETED
            const hasActiveProductionOrders = activeProductionOrders.length > 0;
            const allActiveProductionCompleted = activeProductionOrders.every(
              (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
            );

            if (hasActiveProductionOrders && allActiveProductionCompleted) {
              this.logger.log(
                `[AUTO-COMPLETE TASK ON CANCEL] All ${activeProductionOrders.length} active PRODUCTION service orders completed for task ${task.id} (SO ${id} cancelled), transitioning to COMPLETED`,
              );

              const oldTaskStatus = task.status as TASK_STATUS;
              await tx.task.update({
                where: { id: task.id },
                data: {
                  status: TASK_STATUS.COMPLETED,
                  statusOrder: 4, // COMPLETED statusOrder
                  finishedAt: task.finishedAt || new Date(),
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
                reason: `Tarefa concluída automaticamente quando ordem de serviço foi cancelada e todas as ${activeProductionOrders.length} ordens de serviço de produção restantes estão finalizadas`,
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

        // =====================================================================
        // ROLLBACK SYNC: ARTWORK Service Order Rollback → Task Status Rollback
        // When an ARTWORK service order goes backwards from COMPLETED, check if task
        // should rollback from WAITING_PRODUCTION to PREPARATION
        // Only rollback if NO artwork service orders remain completed
        // =====================================================================
        if (
          updated.type === SERVICE_ORDER_TYPE.ARTWORK &&
          data.status &&
          oldData.status === SERVICE_ORDER_STATUS.COMPLETED &&
          data.status !== SERVICE_ORDER_STATUS.COMPLETED
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true },
          });

          // Only rollback if task is currently in WAITING_PRODUCTION
          if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
            // Get all ARTWORK service orders to check if any are still completed
            const artworkServiceOrders = await tx.serviceOrder.findMany({
              where: {
                taskId: updated.taskId,
                type: SERVICE_ORDER_TYPE.ARTWORK,
              },
              select: { id: true, status: true },
            });

            // Only rollback task if NO artwork SOs remain completed
            // If at least one artwork is still completed, keep task in WAITING_PRODUCTION
            const anyArtworkCompleted = artworkServiceOrders.some(
              (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
            );

            if (!anyArtworkCompleted) {
              this.logger.log(
                `[ARTWORK ROLLBACK] Artwork service order ${id} rolled back from COMPLETED to ${data.status}, no artwork orders remain completed, rolling back task ${task.id} from WAITING_PRODUCTION to PREPARATION`,
              );

              await tx.task.update({
                where: { id: task.id },
                data: {
                  status: TASK_STATUS.PREPARATION,
                  statusOrder: 1, // PREPARATION statusOrder
                },
              });

              // Log the rollback in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: TASK_STATUS.WAITING_PRODUCTION,
                newValue: TASK_STATUS.PREPARATION,
                reason: `Tarefa retornada para preparação pois nenhuma ordem de serviço de arte permanece concluída`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskRolledBack = {
                taskId: task.id,
                oldStatus: TASK_STATUS.WAITING_PRODUCTION,
                newStatus: TASK_STATUS.PREPARATION,
              };
            }
          }
        }

        // =====================================================================
        // ROLLBACK SYNC: Service Order Status Rollback → Task Status Rollback
        // When a production service order goes backwards, sync task status accordingly
        // =====================================================================
        if (
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION &&
          data.status &&
          isStatusRollback(oldData.status as SERVICE_ORDER_STATUS, data.status as SERVICE_ORDER_STATUS)
        ) {
          // Get the task with its current status
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true, finishedAt: true },
          });

          if (task) {
            // Get ALL service orders for this task to determine the new task status
            const allServiceOrders = await tx.serviceOrder.findMany({
              where: { taskId: updated.taskId },
              select: { id: true, status: true, type: true },
            });

            // Use the sync utility to determine if task needs to be updated
            const taskUpdate = getTaskUpdateForServiceOrderStatusChange(
              allServiceOrders.map(so => ({
                id: so.id,
                status: so.status as SERVICE_ORDER_STATUS,
                type: so.type as SERVICE_ORDER_TYPE,
              })),
              updated.id,
              oldData.status as SERVICE_ORDER_STATUS,
              data.status as SERVICE_ORDER_STATUS,
              task.status as TASK_STATUS,
            );

            if (taskUpdate && taskUpdate.shouldUpdate && taskUpdate.newTaskStatus) {
              this.logger.log(
                `[SO→TASK ROLLBACK] Service order ${id} rolled back ${oldData.status} → ${data.status}, updating task ${task.id}: ${task.status} → ${taskUpdate.newTaskStatus}`,
              );

              const taskUpdateData: any = {
                status: taskUpdate.newTaskStatus,
                statusOrder: getTaskStatusOrder(taskUpdate.newTaskStatus),
              };

              // Handle date fields based on update flags
              if (taskUpdate.setStartedAt && !task.startedAt) {
                taskUpdateData.startedAt = new Date();
              }
              if (taskUpdate.setFinishedAt && !task.finishedAt) {
                taskUpdateData.finishedAt = new Date();
              }
              if (taskUpdate.clearStartedAt) {
                taskUpdateData.startedAt = null;
              }
              if (taskUpdate.clearFinishedAt) {
                taskUpdateData.finishedAt = null;
              }

              await tx.task.update({
                where: { id: task.id },
                data: taskUpdateData,
              });

              // Log the rollback in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: task.status,
                newValue: taskUpdate.newTaskStatus,
                reason: taskUpdate.reason,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskRolledBack = {
                taskId: task.id,
                oldStatus: task.status as TASK_STATUS,
                newStatus: taskUpdate.newTaskStatus as TASK_STATUS,
              };
            }
          }
        }

        // =====================================================================
        // COMPREHENSIVE TASK STATUS SYNC (Catch-all)
        // After all specific sync checks, verify the task status is correct
        // based on all production service orders. This handles edge cases
        // that might be missed by the specific conditions above.
        // =====================================================================
        if (
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION &&
          data.status &&
          !taskAutoCompleted && // Don't re-check if already auto-completed
          !taskRolledBack // Don't re-check if already rolled back
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true, finishedAt: true },
          });

          if (task && task.status !== TASK_STATUS.PREPARATION && task.status !== TASK_STATUS.CANCELLED) {
            // Get all service orders for this task
            const allServiceOrders = await tx.serviceOrder.findMany({
              where: { taskId: updated.taskId },
              select: { id: true, status: true, type: true },
            });

            // Filter production service orders and exclude CANCELLED
            const activeProductionOrders = allServiceOrders
              .filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION)
              .filter(so => so.status !== SERVICE_ORDER_STATUS.CANCELLED);

            if (activeProductionOrders.length > 0) {
              const allCompleted = activeProductionOrders.every(
                so => so.status === SERVICE_ORDER_STATUS.COMPLETED
              );
              const allPending = activeProductionOrders.every(
                so => so.status === SERVICE_ORDER_STATUS.PENDING
              );
              const anyInProgress = activeProductionOrders.some(
                so => so.status === SERVICE_ORDER_STATUS.IN_PROGRESS
              );
              const anyCompleted = activeProductionOrders.some(
                so => so.status === SERVICE_ORDER_STATUS.COMPLETED
              );

              let expectedStatus: TASK_STATUS | null = null;

              if (allCompleted) {
                expectedStatus = TASK_STATUS.COMPLETED;
              } else if (anyInProgress || anyCompleted) {
                expectedStatus = TASK_STATUS.IN_PRODUCTION;
              } else if (allPending) {
                expectedStatus = TASK_STATUS.WAITING_PRODUCTION;
              }

              // If expected status differs from current, update the task
              if (expectedStatus && expectedStatus !== task.status) {
                this.logger.log(
                  `[COMPREHENSIVE SYNC] Task ${task.id} status mismatch: current=${task.status}, expected=${expectedStatus}. Updating...`,
                );

                const taskUpdateData: any = {
                  status: expectedStatus,
                  statusOrder: getTaskStatusOrder(expectedStatus),
                };

                // Handle dates based on status change
                if (expectedStatus === TASK_STATUS.COMPLETED) {
                  if (!task.finishedAt) taskUpdateData.finishedAt = new Date();
                  if (!task.startedAt) taskUpdateData.startedAt = new Date();
                } else if (expectedStatus === TASK_STATUS.IN_PRODUCTION) {
                  if (task.status === TASK_STATUS.COMPLETED) {
                    taskUpdateData.finishedAt = null; // Clear finish date on rollback
                  }
                  if (!task.startedAt) taskUpdateData.startedAt = new Date();
                } else if (expectedStatus === TASK_STATUS.WAITING_PRODUCTION) {
                  taskUpdateData.startedAt = null;
                  taskUpdateData.finishedAt = null;
                }

                await tx.task.update({
                  where: { id: task.id },
                  data: taskUpdateData,
                });

                // Log the sync in changelog
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: task.status,
                  newValue: expectedStatus,
                  reason: `Status da tarefa sincronizado automaticamente com base nas ordens de serviço de produção`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });

                // Track for event emission
                if (expectedStatus === TASK_STATUS.COMPLETED) {
                  taskAutoCompleted = {
                    taskId: task.id,
                    oldStatus: task.status as TASK_STATUS,
                    newStatus: expectedStatus,
                  };
                } else {
                  taskRolledBack = {
                    taskId: task.id,
                    oldStatus: task.status as TASK_STATUS,
                    newStatus: expectedStatus,
                  };
                }
              }
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

      // Emit task status changed event if task was rolled back
      if (taskRolledBack) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskRolledBack.taskId },
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the rollback
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskRolledBack.oldStatus,
            newStatus: taskRolledBack.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[SO→TASK ROLLBACK] Emitted task.status.changed event for task ${taskRolledBack.taskId} (${taskRolledBack.oldStatus} → ${taskRolledBack.newStatus})`,
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
   * Get service order descriptions from enums
   * Used for combobox in the task edit form
   * Optionally filtered by type and search term
   */
  async getUniqueDescriptions(
    type?: string,
    search?: string,
    limit: number = 50,
  ): Promise<{ success: boolean; message: string; data: string[] }> {
    try {
      let descriptions: string[] = [];

      // Get descriptions from enums based on type
      if (type && SERVICE_DESCRIPTIONS_BY_TYPE[type as SERVICE_ORDER_TYPE]) {
        descriptions = [...getServiceDescriptionsByType(type as SERVICE_ORDER_TYPE)];
      } else {
        // If no type specified, return all descriptions from all types
        descriptions = Object.values(SERVICE_DESCRIPTIONS_BY_TYPE).flat();
        // Remove duplicates (e.g., "OUTROS" appears in all types)
        descriptions = [...new Set(descriptions)];
      }

      // Filter by search term if provided
      if (search && search.trim()) {
        const searchLower = search.trim().toLowerCase();
        descriptions = descriptions.filter(d =>
          d.toLowerCase().includes(searchLower)
        );
      }

      // Sort alphabetically and apply limit
      descriptions = descriptions
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .slice(0, limit);

      return {
        success: true,
        message: 'Descrições carregadas com sucesso.',
        data: descriptions,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar descrições:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar descrições. Tente novamente.',
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
        // Convert all descriptions to Title Case
        const serviceOrdersWithTitleCase = data.serviceOrders.map(so => ({
          ...so,
          description: this.toTitleCase(so.description),
        }));

        const batchResult = await this.serviceOrderRepository.createManyWithTransaction(
          tx,
          serviceOrdersWithTitleCase,
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

        const updateData: any = {
          ...item.data,
          // Convert description to Title Case if provided
          ...(item.data.description && { description: this.toTitleCase(item.data.description) }),
        };

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
      // Track tasks rolled back for event emission after transaction
      const tasksRolledBack: Array<{ taskId: string; oldStatus: TASK_STATUS; newStatus: TASK_STATUS }> = [];

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

            // Auto-start task when PRODUCTION service order is started and task is waiting for production
            // NOTE: Only PRODUCTION type service orders trigger task auto-start, not ARTWORK
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
              oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS &&
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION
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

            // Auto-transition task from PREPARATION to WAITING_PRODUCTION when at least one ARTWORK service order is COMPLETED
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
                  // Since this artwork service order just became COMPLETED, we can transition the task
                  // No need to check other artwork orders - one completed artwork is enough
                  this.logger.log(
                    `[AUTO-TRANSITION BATCH] ARTWORK service order ${serviceOrder.id} completed for task ${task.id}, transitioning PREPARATION → WAITING_PRODUCTION`,
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
                    reason: `Tarefa liberada automaticamente para produção quando ordem de serviço de arte "${serviceOrder.description}" foi concluída (batch)`,
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

                  // Filter out CANCELLED orders - they don't block task completion
                  const activeProductionOrders = productionServiceOrders.filter(
                    (so) => so.status !== SERVICE_ORDER_STATUS.CANCELLED
                  );

                  // Check if there's at least 1 active production service order and ALL are COMPLETED
                  const hasActiveProductionOrders = activeProductionOrders.length > 0;
                  const allActiveProductionCompleted = activeProductionOrders.every(
                    (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
                  );

                  if (hasActiveProductionOrders && allActiveProductionCompleted) {
                    this.logger.log(
                      `[AUTO-COMPLETE TASK BATCH] All ${activeProductionOrders.length} active PRODUCTION service orders completed for task ${task.id}, transitioning to COMPLETED`,
                    );

                    const oldTaskStatus = task.status as TASK_STATUS;
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
                      reason: `Tarefa concluída automaticamente quando todas as ${activeProductionOrders.length} ordens de serviço de produção ativas foram finalizadas (batch)`,
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

            // =====================================================================
            // AUTO-COMPLETE TASK WHEN SERVICE ORDER IS CANCELLED (BATCH)
            // When a PRODUCTION service order is cancelled, check if all remaining
            // active (non-cancelled) production orders are completed - if so, complete the task
            // =====================================================================
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.CANCELLED &&
              oldData.status !== SERVICE_ORDER_STATUS.CANCELLED &&
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

                  // Filter out CANCELLED orders - they don't block task completion
                  const activeProductionOrders = productionServiceOrders.filter(
                    (so) => so.status !== SERVICE_ORDER_STATUS.CANCELLED
                  );

                  // Check if there's at least 1 active production service order and ALL are COMPLETED
                  const hasActiveProductionOrders = activeProductionOrders.length > 0;
                  const allActiveProductionCompleted = activeProductionOrders.every(
                    (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
                  );

                  if (hasActiveProductionOrders && allActiveProductionCompleted) {
                    this.logger.log(
                      `[AUTO-COMPLETE TASK ON CANCEL BATCH] All ${activeProductionOrders.length} active PRODUCTION service orders completed for task ${task.id} (SO ${serviceOrder.id} cancelled), transitioning to COMPLETED`,
                    );

                    const oldTaskStatus = task.status as TASK_STATUS;
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
                      reason: `Tarefa concluída automaticamente quando ordem de serviço foi cancelada e todas as ${activeProductionOrders.length} ordens de serviço de produção restantes estão finalizadas (batch)`,
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

            // =====================================================================
            // ROLLBACK SYNC: ARTWORK Service Order Rollback → Task Status Rollback
            // When an ARTWORK service order goes backwards from COMPLETED, check if task
            // should rollback from WAITING_PRODUCTION to PREPARATION
            // Only rollback if NO artwork service orders remain completed
            // =====================================================================
            if (
              serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK &&
              oldData.status === SERVICE_ORDER_STATUS.COMPLETED &&
              serviceOrder.status !== SERVICE_ORDER_STATUS.COMPLETED
            ) {
              // Check if this task was already rolled back in this batch
              const alreadyRolledBack = tasksRolledBack.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyRolledBack) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true },
                });

                // Only rollback if task is currently in WAITING_PRODUCTION
                if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
                  // Get all ARTWORK service orders to check if any are still completed
                  const artworkServiceOrders = await tx.serviceOrder.findMany({
                    where: {
                      taskId: serviceOrder.taskId,
                      type: SERVICE_ORDER_TYPE.ARTWORK,
                    },
                    select: { id: true, status: true },
                  });

                  // Only rollback task if NO artwork SOs remain completed
                  // If at least one artwork is still completed, keep task in WAITING_PRODUCTION
                  const anyArtworkCompleted = artworkServiceOrders.some(
                    (so) => so.status === SERVICE_ORDER_STATUS.COMPLETED
                  );

                  if (!anyArtworkCompleted) {
                    this.logger.log(
                      `[ARTWORK ROLLBACK BATCH] Artwork service order ${serviceOrder.id} rolled back from COMPLETED to ${serviceOrder.status}, no artwork orders remain completed, rolling back task ${task.id} from WAITING_PRODUCTION to PREPARATION`,
                    );

                    await tx.task.update({
                      where: { id: task.id },
                      data: {
                        status: TASK_STATUS.PREPARATION,
                        statusOrder: 1, // PREPARATION statusOrder
                      },
                    });

                    // Log the rollback in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: TASK_STATUS.WAITING_PRODUCTION,
                      newValue: TASK_STATUS.PREPARATION,
                      reason: `Tarefa retornada para preparação pois nenhuma ordem de serviço de arte permanece concluída (batch)`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksRolledBack.push({
                      taskId: task.id,
                      oldStatus: TASK_STATUS.WAITING_PRODUCTION,
                      newStatus: TASK_STATUS.PREPARATION,
                    });
                  }
                }
              }
            }

            // =====================================================================
            // ROLLBACK SYNC: Service Order Status Rollback → Task Status Rollback
            // When a production service order goes backwards, sync task status accordingly
            // =====================================================================
            if (
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION &&
              isStatusRollback(oldData.status as SERVICE_ORDER_STATUS, serviceOrder.status as SERVICE_ORDER_STATUS)
            ) {
              // Check if this task was already rolled back in this batch
              const alreadyRolledBack = tasksRolledBack.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyRolledBack) {
                // Get the task with its current status
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true, finishedAt: true },
                });

                if (task) {
                  // Get ALL service orders for this task to determine the new task status
                  const allServiceOrders = await tx.serviceOrder.findMany({
                    where: { taskId: serviceOrder.taskId },
                    select: { id: true, status: true, type: true },
                  });

                  // Use the sync utility to determine if task needs to be updated
                  const taskUpdate = getTaskUpdateForServiceOrderStatusChange(
                    allServiceOrders.map(so => ({
                      id: so.id,
                      status: so.status as SERVICE_ORDER_STATUS,
                      type: so.type as SERVICE_ORDER_TYPE,
                    })),
                    serviceOrder.id,
                    oldData.status as SERVICE_ORDER_STATUS,
                    serviceOrder.status as SERVICE_ORDER_STATUS,
                    task.status as TASK_STATUS,
                  );

                  if (taskUpdate && taskUpdate.shouldUpdate && taskUpdate.newTaskStatus) {
                    this.logger.log(
                      `[SO→TASK ROLLBACK BATCH] Service order ${serviceOrder.id} rolled back ${oldData.status} → ${serviceOrder.status}, updating task ${task.id}: ${task.status} → ${taskUpdate.newTaskStatus}`,
                    );

                    const taskUpdateData: any = {
                      status: taskUpdate.newTaskStatus,
                      statusOrder: getTaskStatusOrder(taskUpdate.newTaskStatus),
                    };

                    // Handle date fields based on update flags
                    if (taskUpdate.setStartedAt && !task.startedAt) {
                      taskUpdateData.startedAt = new Date();
                    }
                    if (taskUpdate.setFinishedAt && !task.finishedAt) {
                      taskUpdateData.finishedAt = new Date();
                    }
                    if (taskUpdate.clearStartedAt) {
                      taskUpdateData.startedAt = null;
                    }
                    if (taskUpdate.clearFinishedAt) {
                      taskUpdateData.finishedAt = null;
                    }

                    await tx.task.update({
                      where: { id: task.id },
                      data: taskUpdateData,
                    });

                    // Log the rollback in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: task.status,
                      newValue: taskUpdate.newTaskStatus,
                      reason: taskUpdate.reason + ' (batch)',
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksRolledBack.push({
                      taskId: task.id,
                      oldStatus: task.status as TASK_STATUS,
                      newStatus: taskUpdate.newTaskStatus as TASK_STATUS,
                    });
                  }
                }
              }
            }

            // =====================================================================
            // COMPREHENSIVE TASK STATUS SYNC (Catch-all) - BATCH
            // After all specific sync checks, verify the task status is correct
            // based on all production service orders. This handles edge cases
            // that might be missed by the specific conditions above.
            // =====================================================================
            if (
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION &&
              oldData.status !== serviceOrder.status // Only when status changed
            ) {
              // Check if this task was already handled by another sync block
              const alreadyHandled =
                tasksAutoCompleted.some(t => t.taskId === serviceOrder.taskId) ||
                tasksRolledBack.some(t => t.taskId === serviceOrder.taskId);

              if (!alreadyHandled) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true, finishedAt: true },
                });

                if (task && task.status !== TASK_STATUS.PREPARATION && task.status !== TASK_STATUS.CANCELLED) {
                  // Get all service orders for this task
                  const allServiceOrders = await tx.serviceOrder.findMany({
                    where: { taskId: serviceOrder.taskId },
                    select: { id: true, status: true, type: true },
                  });

                  // Filter production service orders and exclude CANCELLED
                  const activeProductionOrders = allServiceOrders
                    .filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION)
                    .filter(so => so.status !== SERVICE_ORDER_STATUS.CANCELLED);

                  if (activeProductionOrders.length > 0) {
                    const allCompleted = activeProductionOrders.every(
                      so => so.status === SERVICE_ORDER_STATUS.COMPLETED
                    );
                    const allPending = activeProductionOrders.every(
                      so => so.status === SERVICE_ORDER_STATUS.PENDING
                    );
                    const anyInProgress = activeProductionOrders.some(
                      so => so.status === SERVICE_ORDER_STATUS.IN_PROGRESS
                    );
                    const anyCompleted = activeProductionOrders.some(
                      so => so.status === SERVICE_ORDER_STATUS.COMPLETED
                    );

                    let expectedStatus: TASK_STATUS | null = null;

                    if (allCompleted) {
                      expectedStatus = TASK_STATUS.COMPLETED;
                    } else if (anyInProgress || anyCompleted) {
                      expectedStatus = TASK_STATUS.IN_PRODUCTION;
                    } else if (allPending) {
                      expectedStatus = TASK_STATUS.WAITING_PRODUCTION;
                    }

                    // If expected status differs from current, update the task
                    if (expectedStatus && expectedStatus !== task.status) {
                      this.logger.log(
                        `[COMPREHENSIVE SYNC BATCH] Task ${task.id} status mismatch: current=${task.status}, expected=${expectedStatus}. Updating...`,
                      );

                      const taskUpdateData: any = {
                        status: expectedStatus,
                        statusOrder: getTaskStatusOrder(expectedStatus),
                      };

                      // Handle dates based on status change
                      if (expectedStatus === TASK_STATUS.COMPLETED) {
                        if (!task.finishedAt) taskUpdateData.finishedAt = new Date();
                        if (!task.startedAt) taskUpdateData.startedAt = new Date();
                      } else if (expectedStatus === TASK_STATUS.IN_PRODUCTION) {
                        if (task.status === TASK_STATUS.COMPLETED) {
                          taskUpdateData.finishedAt = null; // Clear finish date on rollback
                        }
                        if (!task.startedAt) taskUpdateData.startedAt = new Date();
                      } else if (expectedStatus === TASK_STATUS.WAITING_PRODUCTION) {
                        taskUpdateData.startedAt = null;
                        taskUpdateData.finishedAt = null;
                      }

                      await tx.task.update({
                        where: { id: task.id },
                        data: taskUpdateData,
                      });

                      // Log the sync in changelog
                      await this.changeLogService.logChange({
                        entityType: ENTITY_TYPE.TASK,
                        entityId: task.id,
                        action: CHANGE_ACTION.UPDATE,
                        field: 'status',
                        oldValue: task.status,
                        newValue: expectedStatus,
                        reason: `Status da tarefa sincronizado automaticamente com base nas ordens de serviço de produção (batch)`,
                        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                        triggeredById: serviceOrder.id,
                        userId: userId || '',
                        transaction: tx,
                      });

                      // Track for event emission
                      if (expectedStatus === TASK_STATUS.COMPLETED) {
                        tasksAutoCompleted.push({
                          taskId: task.id,
                          oldStatus: task.status as TASK_STATUS,
                          newStatus: expectedStatus,
                        });
                      } else {
                        tasksRolledBack.push({
                          taskId: task.id,
                          oldStatus: task.status as TASK_STATUS,
                          newStatus: expectedStatus,
                        });
                      }
                    }
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

      // Emit task status changed events for tasks rolled back
      for (const taskRollback of tasksRolledBack) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskRollback.taskId },
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
            oldStatus: taskRollback.oldStatus,
            newStatus: taskRollback.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[SO→TASK ROLLBACK BATCH] Emitted task.status.changed event for task ${taskRollback.taskId} (${taskRollback.oldStatus} → ${taskRollback.newStatus})`,
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
