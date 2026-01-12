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

      const serviceOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const oldData = serviceOrderExists;
        const updated = await this.serviceOrderRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Track field-level changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: id,
          oldEntity: oldData,
          newEntity: updated,
          fieldsToTrack: [
            'status',
            'description',
            'taskId',
            'startedAt',
            'finishedAt',
            'type',
            'assignedToId',
          ],
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

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
          serviceOrder.type === 'ARTWORK'
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

      const updates = data.serviceOrders.map(item => {
        return { id: item.id, data: item.data };
      });

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.serviceOrderRepository.updateManyWithTransaction(
          tx,
          updates,
          { include },
        );

        // Log all successful updates
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
                'taskId',
                'startedAt',
                'finishedAt',
                'type',
                'assignedToId',
              ],
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return batchResult;
      });

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
