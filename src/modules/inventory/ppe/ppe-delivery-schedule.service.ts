// ppe-schedule.service.ts

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PpeDeliveryScheduleRepository } from './repositories/ppe-delivery-schedule/ppe-delivery-schedule.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  PpeDeliveryScheduleCreateFormData,
  PpeDeliveryScheduleUpdateFormData,
  PpeDeliveryScheduleGetManyFormData,
  PpeDeliveryScheduleInclude,
  PpeDeliveryScheduleBatchCreateFormData,
  PpeDeliveryScheduleBatchUpdateFormData,
  PpeDeliveryScheduleBatchDeleteFormData,
  PpeDeliveryCreateFormData,
} from '../../../schemas';
import {
  PpeDeliveryScheduleGetUniqueResponse,
  PpeDeliveryScheduleGetManyResponse,
  PpeDeliveryScheduleCreateResponse,
  PpeDeliveryScheduleUpdateResponse,
  PpeDeliveryScheduleDeleteResponse,
  PpeDeliveryScheduleBatchCreateResponse,
  PpeDeliveryScheduleBatchUpdateResponse,
  PpeDeliveryScheduleBatchDeleteResponse,
} from '../../../types';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_TRIGGERED_BY,
  SCHEDULE_FREQUENCY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  ASSIGNMENT_TYPE,
  PPE_TYPE,
  USER_STATUS,
  PPE_DELIVERY_STATUS,
} from '../../../constants';
import { PPE_DELIVERY_STATUS_ORDER } from '../../../constants';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { ItemRepository } from '@modules/inventory/item/repositories/item/item.repository';
import { PpeDeliveryService } from './ppe-delivery.service';
import { ppeSizeToNumeric } from '../../../utils';

@Injectable()
export class PpeDeliveryScheduleService {
  constructor(
    private readonly repository: PpeDeliveryScheduleRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly prisma: PrismaService,
    private readonly userRepository: UserRepository,
    private readonly itemRepository: ItemRepository,
    private readonly ppeDeliveryService: PpeDeliveryService,
  ) {}

  // Validation methods
  private async validateEntity(): Promise<void> {
    // PpeDeliverySchedule has no unique fields to validate
    // This method is added for consistency with other services
    return Promise.resolve();
  }

  /**
   * Get users based on assignment type configuration
   */
  async getAssignedUsers(
    assignmentType: string,
    excludedUserIds: string[] = [],
    includedUserIds: string[] = [],
    transaction?: PrismaTransaction,
  ): Promise<string[]> {
    const tx = transaction || this.prisma;

    switch (assignmentType) {
      case ASSIGNMENT_TYPE.ALL:
        // Get all non-dismissed users, optionally filtered by category (if PPE category has user restrictions)
        const allUsers = await tx.user.findMany({
          where: {
            status: { not: USER_STATUS.DISMISSED },
          },
          select: { id: true },
        });
        return allUsers.map(user => user.id);

      case ASSIGNMENT_TYPE.ALL_EXCEPT:
        // Get all non-dismissed users except the excluded ones
        const allExceptUsers = await tx.user.findMany({
          where: {
            status: { not: USER_STATUS.DISMISSED },
            id: { notIn: excludedUserIds },
          },
          select: { id: true },
        });
        return allExceptUsers.map(user => user.id);

      case ASSIGNMENT_TYPE.SPECIFIC:
        // Return only the specified users (validate they exist and are not dismissed)
        const specificUsers = await tx.user.findMany({
          where: {
            id: { in: includedUserIds },
            status: { not: USER_STATUS.DISMISSED },
          },
          select: { id: true },
        });
        return specificUsers.map(user => user.id);

      default:
        throw new BadRequestException(`Tipo de atribuição inválido: ${assignmentType}`);
    }
  }

  /**
   * Find matching items for a user based on PPE items with quantities and user's sizes
   */
  private async findMatchingItemsForUser(
    userId: string,
    ppeItems: { ppeType: PPE_TYPE; quantity: number }[],
    transaction?: PrismaTransaction,
  ): Promise<{ userId: string; itemId: string; quantity: number }[]> {
    const tx = transaction || this.prisma;

    // Get user with size information
    const user = await this.userRepository.findByIdWithTransaction(tx, userId, {
      include: { ppeSize: true },
    });

    if (!user) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`User ${userId} not found during PPE item matching`);
      }
      return [];
    }

    if (!user.ppeSize) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`User ${userId} does not have PPE size configuration`);
      }
      return [];
    }

    const results: { userId: string; itemId: string; quantity: number }[] = [];

    // For each PPE item, find matching items
    for (const ppeItem of ppeItems) {
      const ppeType = ppeItem.ppeType;
      const requestedQuantity = ppeItem.quantity;
      let userSize: string | null = null;

      // Map PPE type to user size field
      switch (ppeType) {
        case PPE_TYPE.SHIRT:
          userSize = user.ppeSize.shirts;
          break;
        case PPE_TYPE.PANTS:
          userSize = user.ppeSize.pants;
          break;
        case PPE_TYPE.BOOTS:
          userSize = user.ppeSize.boots;
          break;
        case PPE_TYPE.SLEEVES:
          userSize = user.ppeSize.sleeves;
          break;
        case PPE_TYPE.MASK:
          userSize = user.ppeSize.mask;
          break;
      }

      if (!userSize) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`User ${userId} does not have size configured for PPE type ${ppeType}`);
        }
        continue;
      }

      // Convert PPE size string to numeric value for measures query
      const numericSize = ppeSizeToNumeric(userSize);

      if (!numericSize) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Invalid PPE size format: ${userSize} for user ${userId}`);
        }
        continue;
      }

      // Find items that match the PPE type and user size via measures
      const matchingItems = await this.itemRepository.findManyWithTransaction(tx, {
        where: {
          ppeType: ppeType,
          isActive: true,
          quantity: { gt: 0 }, // Only items with available stock
          measures: {
            some: {
              measureType: 'SIZE',
              value: numericSize, // PPE size stored as numeric value in measures
            },
          },
        },
        include: {
          measures: {
            where: { measureType: 'SIZE' },
          },
        },
        take: 1, // We only need one matching item per type
      });

      if (matchingItems.data.length > 0) {
        const item = matchingItems.data[0];
        results.push({
          userId: userId,
          itemId: item.id,
          quantity: requestedQuantity, // Use quantity specified in schedule
        });
      } else {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `No matching items found for user ${userId} with PPE type ${ppeType} and size ${userSize}`,
          );
        }
      }
    }

    return results;
  }

  /**
   * Create PPE deliveries for users based on schedule configuration
   */
  private async createDeliveriesForSchedule(
    schedule: any,
    userIds: string[],
    ppeItems: { ppeType: PPE_TYPE; quantity: number }[],
    transaction: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    const deliveriesToCreate: Array<{ userId: string; itemId: string; quantity: number }> = [];

    // For each user, find matching items for each PPE type
    for (const assignedUserId of userIds) {
      const userItemMatches = await this.findMatchingItemsForUser(
        assignedUserId,
        ppeItems,
        transaction,
      );
      deliveriesToCreate.push(...userItemMatches);
    }

    if (deliveriesToCreate.length === 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `No deliveries to create for schedule ${schedule.id} - no matching items found`,
        );
      }
      return;
    }

    // Create deliveries for each user-item combination
    for (const delivery of deliveriesToCreate) {
      try {
        const deliveryData: PpeDeliveryCreateFormData = {
          userId: delivery.userId,
          itemId: delivery.itemId,
          quantity: delivery.quantity,
          ppeScheduleId: schedule.id,
          status: PPE_DELIVERY_STATUS.PENDING,
          statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.PENDING],
          scheduledDate: schedule.nextRun || new Date(),
        };

        // Use the delivery service to create the delivery (this handles all validation and stock checking)
        await this.ppeDeliveryService.create(deliveryData, undefined, userId);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY,
          entityId: delivery.itemId, // Use itemId as identifier since delivery id is not available yet
          action: CHANGE_ACTION.CREATE,
          field: 'auto_creation_from_schedule',
          oldValue: null,
          newValue: {
            userId: delivery.userId,
            itemId: delivery.itemId,
            quantity: delivery.quantity,
            scheduleId: schedule.id,
          },
          reason: `Entrega de PPE criada automaticamente pelo agendamento ${schedule.id}`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: schedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error(
            `Failed to create PPE delivery for user ${delivery.userId}, item ${delivery.itemId}:`,
            error,
          );
        }

        // Log the error but continue with other deliveries
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: schedule.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'delivery_creation_error',
          oldValue: null,
          newValue: {
            error: error instanceof Error ? error.message : String(error),
            userId: delivery.userId,
            itemId: delivery.itemId,
            quantity: delivery.quantity,
          },
          reason: `Erro na criação automática de entrega de PPE para usuário ${delivery.userId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: schedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      }
    }
  }

  // Basic CRUD operations
  async create(
    data: PpeDeliveryScheduleCreateFormData,
    include?: PpeDeliveryScheduleInclude,
    userId?: string,
  ): Promise<PpeDeliveryScheduleCreateResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      // Validate assignment type configuration
      if (
        data.assignmentType === ASSIGNMENT_TYPE.ALL_EXCEPT &&
        (!data.excludedUserIds || data.excludedUserIds.length === 0)
      ) {
        throw new BadRequestException(
          "Para o tipo de atribuição 'Todos Exceto', é necessário especificar pelo menos um usuário para excluir.",
        );
      }

      if (
        data.assignmentType === ASSIGNMENT_TYPE.SPECIFIC &&
        (!data.includedUserIds || data.includedUserIds.length === 0)
      ) {
        throw new BadRequestException(
          "Para o tipo de atribuição 'Específicos', é necessário especificar pelo menos um usuário.",
        );
      }

      if (
        data.assignmentType === ASSIGNMENT_TYPE.ALL &&
        ((data.excludedUserIds && data.excludedUserIds.length > 0) ||
          (data.includedUserIds && data.includedUserIds.length > 0))
      ) {
        throw new BadRequestException(
          "Para o tipo de atribuição 'Todos', não deve haver usuários específicos ou excluídos.",
        );
      }

      // Validate PPE types are provided
      if (!data.ppeItems || data.ppeItems.length === 0) {
        throw new BadRequestException(
          'Pelo menos um tipo de PPE deve ser especificado para o agendamento.',
        );
      }

      // Validate unique constraints (even though there are none currently)
      await this.validateEntity();

      // Create the schedule
      let ppeDeliverySchedule = await this.repository.create(data, { include });

      if (!ppeDeliverySchedule) {
        throw new BadRequestException('Erro ao criar agendamento de PPE');
      }

      // Create related schedule configuration based on frequency
      if (data.frequency === SCHEDULE_FREQUENCY.WEEKLY && data.dayOfWeek) {
        const weeklyConfig = await transaction.weeklyScheduleConfig.create({
          data: {
            [data.dayOfWeek.toLowerCase()]: true,
          },
        });
        await transaction.ppeDeliverySchedule.update({
          where: { id: ppeDeliverySchedule.id },
          data: { weeklyConfigId: weeklyConfig.id },
        });
        const updatedSchedule = await this.repository.findById(ppeDeliverySchedule.id, { include });
        if (updatedSchedule) {
          ppeDeliverySchedule = updatedSchedule;
        }
      } else if (data.frequency === SCHEDULE_FREQUENCY.MONTHLY) {
        const monthlyConfig = await transaction.monthlyScheduleConfig.create({
          data: {
            dayOfMonth: data.dayOfMonth || undefined,
            dayOfWeek: data.dayOfWeek || undefined,
            occurrence: null,
          },
        });
        await transaction.ppeDeliverySchedule.update({
          where: { id: ppeDeliverySchedule.id },
          data: { monthlyConfigId: monthlyConfig.id },
        });
        const updatedSchedule = await this.repository.findById(ppeDeliverySchedule.id, { include });
        if (updatedSchedule) {
          ppeDeliverySchedule = updatedSchedule;
        }
      } else if (data.frequency === SCHEDULE_FREQUENCY.ANNUAL) {
        const yearlyConfig = await transaction.yearlyScheduleConfig.create({
          data: {
            month: (data.month as any) || undefined,
            dayOfMonth: data.dayOfMonth || undefined,
            dayOfWeek: data.dayOfWeek || undefined,
            occurrence: null,
          },
        });
        await transaction.ppeDeliverySchedule.update({
          where: { id: ppeDeliverySchedule.id },
          data: { yearlyConfigId: yearlyConfig.id },
        });
        const updatedSchedule = await this.repository.findById(ppeDeliverySchedule.id, { include });
        if (updatedSchedule) {
          ppeDeliverySchedule = updatedSchedule;
        }
      }

      // NEW LOGIC: Create deliveries automatically based on assignment type and PPE types
      try {
        // Get the users who should receive PPE deliveries
        const assignedUserIds = await this.getAssignedUsers(
          data.assignmentType || ASSIGNMENT_TYPE.ALL,
          data.excludedUserIds || [],
          data.includedUserIds || [],
          transaction,
        );

        if (assignedUserIds.length > 0) {
          // Create deliveries for the assigned users with the specified PPE types
          await this.createDeliveriesForSchedule(
            ppeDeliverySchedule,
            assignedUserIds,
            data.ppeItems as { ppeType: PPE_TYPE; quantity: number }[],
            transaction,
            userId,
          );

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
            entityId: ppeDeliverySchedule.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'deliveries_auto_created',
            oldValue: null,
            newValue: {
              userCount: assignedUserIds.length,
              ppeTypes: data.ppeItems,
              assignmentType: data.assignmentType,
            },
            reason: `${assignedUserIds.length} entregas de PPE criadas automaticamente para ${data.ppeItems.length} tipos de PPE`,
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: ppeDeliverySchedule.id,
            userId: userId || null,
            transaction: transaction,
          });
        } else {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `No users found for assignment type ${data.assignmentType} in schedule ${ppeDeliverySchedule.id}`,
            );
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error(
            `Error creating automatic deliveries for schedule ${ppeDeliverySchedule.id}:`,
            error,
          );
        }

        // Log the error but don't fail the schedule creation
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: ppeDeliverySchedule.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'auto_delivery_error',
          oldValue: null,
          newValue: {
            error: error instanceof Error ? error.message : String(error),
            assignmentType: data.assignmentType,
            ppeTypes: data.ppeItems,
          },
          reason: 'Erro na criação automática das entregas de PPE',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: ppeDeliverySchedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      }

      // Log entity creation
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: ppeDeliverySchedule.id,
        action: CHANGE_ACTION.CREATE,
        entity: ppeDeliverySchedule,
        reason: 'Agendamento de PPE criado',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        userId: userId || null,
        transaction: transaction,
      });

      // Track configuration creation based on frequency
      if (data.frequency === SCHEDULE_FREQUENCY.WEEKLY && data.dayOfWeek) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: ppeDeliverySchedule.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'weeklyConfiguration',
          oldValue: null,
          newValue: { dayOfWeek: data.dayOfWeek },
          reason: `Configuração semanal criada: ${data.dayOfWeek}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: ppeDeliverySchedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      } else if (data.frequency === SCHEDULE_FREQUENCY.MONTHLY) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: ppeDeliverySchedule.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'monthlyConfiguration',
          oldValue: null,
          newValue: { dayOfMonth: data.dayOfMonth, dayOfWeek: data.dayOfWeek },
          reason: `Configuração mensal criada`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: ppeDeliverySchedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      } else if (data.frequency === SCHEDULE_FREQUENCY.ANNUAL) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: ppeDeliverySchedule.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'yearlyConfiguration',
          oldValue: null,
          newValue: { month: data.month, dayOfMonth: data.dayOfMonth, dayOfWeek: data.dayOfWeek },
          reason: `Configuração anual criada`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: ppeDeliverySchedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      }

      return {
        success: true,
        message: 'Agendamento de PPE criado com sucesso e entregas automáticas processadas.',
        data: ppeDeliverySchedule,
      };
    });
  }

  async findById(
    id: string,
    include?: PpeDeliveryScheduleInclude,
  ): Promise<PpeDeliveryScheduleGetUniqueResponse> {
    const ppeDeliverySchedule = await this.repository.findById(id, { include });

    if (!ppeDeliverySchedule) {
      throw new NotFoundException(
        'Agendamento de PPE não encontrado. Verifique se o ID está correto.',
      );
    }

    return {
      success: true,
      message: 'Agendamento de PPE encontrado com sucesso.',
      data: ppeDeliverySchedule,
    };
  }

  async findMany(
    query: PpeDeliveryScheduleGetManyFormData,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    const result = await this.repository.findMany(query);

    return {
      success: true,
      message: 'Agendamentos de PPE listados com sucesso.',
      ...result,
    };
  }

  async update(
    id: string,
    data: PpeDeliveryScheduleUpdateFormData,
    include?: PpeDeliveryScheduleInclude,
    userId?: string,
  ): Promise<PpeDeliveryScheduleUpdateResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const oldPpeDeliverySchedule = await this.repository.findById(id);

      if (!oldPpeDeliverySchedule) {
        throw new NotFoundException(
          'Agendamento de PPE não encontrado. Verifique se o ID está correto.',
        );
      }

      // Validate assignment type configuration if provided
      if (
        data.assignmentType === ASSIGNMENT_TYPE.ALL_EXCEPT &&
        (!data.excludedUserIds || data.excludedUserIds.length === 0)
      ) {
        throw new BadRequestException(
          "Para o tipo de atribuição 'Todos Exceto', é necessário especificar pelo menos um usuário para excluir.",
        );
      }

      if (
        data.assignmentType === ASSIGNMENT_TYPE.SPECIFIC &&
        (!data.includedUserIds || data.includedUserIds.length === 0)
      ) {
        throw new BadRequestException(
          "Para o tipo de atribuição 'Específicos', é necessário especificar pelo menos um usuário.",
        );
      }

      if (
        data.assignmentType === ASSIGNMENT_TYPE.ALL &&
        ((data.excludedUserIds && data.excludedUserIds.length > 0) ||
          (data.includedUserIds && data.includedUserIds.length > 0))
      ) {
        throw new BadRequestException(
          "Para o tipo de atribuição 'Todos', não deve haver usuários específicos ou excluídos.",
        );
      }

      // Validate entity
      await this.validateEntity();

      const updatedPpeDeliverySchedule = await this.repository.update(id, data, { include });

      // Track field-level changes
      const fieldsToTrack = [
        'status',
        'nextDeliveryDate',
        'frequency',
        'isActive',
        'itemId',
        'quantity',
        'assignmentType',
        'excludedUserIds',
        'includedUserIds',
        'nextRun',
        'lastRun',
        'weeklyConfigId',
        'monthlyConfigId',
        'yearlyConfigId',
      ];

      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: id,
        oldEntity: oldPpeDeliverySchedule,
        newEntity: updatedPpeDeliverySchedule,
        fieldsToTrack: fieldsToTrack.filter(field => data.hasOwnProperty(field)),
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: transaction,
      });

      // Track configuration changes if frequency changed
      if (data.frequency && data.frequency !== oldPpeDeliverySchedule.frequency) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: updatedPpeDeliverySchedule.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'frequencyConfiguration',
          oldValue: { frequency: oldPpeDeliverySchedule.frequency },
          newValue: { frequency: data.frequency },
          reason: `Frequência alterada de ${oldPpeDeliverySchedule.frequency} para ${data.frequency}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: updatedPpeDeliverySchedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      }

      return {
        success: true,
        message: 'Agendamento de PPE atualizado com sucesso.',
        data: updatedPpeDeliverySchedule,
      };
    });
  }

  async delete(id: string, userId?: string): Promise<PpeDeliveryScheduleDeleteResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const ppeDeliverySchedule = await this.repository.findById(id);

      if (!ppeDeliverySchedule) {
        throw new NotFoundException(
          'Agendamento de PPE não encontrado. Verifique se o ID está correto.',
        );
      }

      // Get the schedule with config IDs before deletion
      const scheduleWithConfigs = await transaction.ppeDeliverySchedule.findUnique({
        where: { id },
        select: {
          weeklyConfigId: true,
          monthlyConfigId: true,
          yearlyConfigId: true,
        },
      });

      // Delete the schedule
      const deletedPpeDeliverySchedule = await this.repository.delete(id);

      // Clean up orphaned config records
      if (scheduleWithConfigs?.weeklyConfigId) {
        await transaction.weeklyScheduleConfig.delete({
          where: { id: scheduleWithConfigs.weeklyConfigId },
        });
      }
      if (scheduleWithConfigs?.monthlyConfigId) {
        await transaction.monthlyScheduleConfig.delete({
          where: { id: scheduleWithConfigs.monthlyConfigId },
        });
      }
      if (scheduleWithConfigs?.yearlyConfigId) {
        await transaction.yearlyScheduleConfig.delete({
          where: { id: scheduleWithConfigs.yearlyConfigId },
        });
      }

      // Log entity deletion
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: deletedPpeDeliverySchedule.id,
        action: CHANGE_ACTION.DELETE,
        entity: deletedPpeDeliverySchedule,
        reason: 'Agendamento de PPE removido',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        userId: userId || null,
        transaction: transaction,
      });

      return {
        success: true,
        message: 'Agendamento de PPE removido com sucesso.',
      };
    });
  }

  // Batch operations
  async batchCreate(
    data: PpeDeliveryScheduleBatchCreateFormData,
    include?: PpeDeliveryScheduleInclude,
    userId?: string,
  ): Promise<PpeDeliveryScheduleBatchCreateResponse<PpeDeliveryScheduleCreateFormData>> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const result = await this.repository.createMany(data.ppeDeliverySchedules, { include });

      // Log successful creations
      for (const schedule of result.success) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: schedule.id,
          action: CHANGE_ACTION.CREATE,
          entity: schedule,
          reason: 'Agendamento de PPE criado em lote',
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
          userId: userId || null,
          transaction: transaction,
        });
      }

      return {
        success: true,
        message: `${result.totalCreated} agendamentos de PPE criados com sucesso. ${result.totalFailed} falharam.`,
        data: {
          success: result.success,
          failed: result.failed.map((error, idx) => ({
            index: error.index ?? idx,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: error.data,
          })),
          totalProcessed: result.totalCreated + result.totalFailed,
          totalSuccess: result.totalCreated,
          totalFailed: result.totalFailed,
        },
      };
    });
  }

  async batchUpdate(
    data: PpeDeliveryScheduleBatchUpdateFormData,
    include?: PpeDeliveryScheduleInclude,
    userId?: string,
  ): Promise<PpeDeliveryScheduleBatchUpdateResponse<PpeDeliveryScheduleUpdateFormData>> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      // Ensure all items have required id and data fields
      const validatedItems = data.ppeDeliverySchedules.map(item => ({
        id: item.id!,
        data: item.data!,
      }));
      const result = await this.repository.updateMany(validatedItems, { include });

      // Log successful updates
      for (const schedule of result.success) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
          entityId: schedule.id,
          action: CHANGE_ACTION.UPDATE,
          field: null,
          oldValue: null,
          newValue: schedule,
          reason: 'Agendamento de PPE atualizado em lote',
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
          triggeredById: schedule.id,
          userId: userId || null,
          transaction: transaction,
        });
      }

      return {
        success: true,
        message: `${result.totalUpdated} agendamentos de PPE atualizados com sucesso. ${result.totalFailed} falharam.`,
        data: {
          success: result.success,
          failed: result.failed.map((error, idx) => ({
            index: error.index ?? idx,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: { ...error.data, id: error.id || '' },
          })),
          totalProcessed: result.totalUpdated + result.totalFailed,
          totalSuccess: result.totalUpdated,
          totalFailed: result.totalFailed,
        },
      };
    });
  }

  async batchDelete(
    data: PpeDeliveryScheduleBatchDeleteFormData,
    userId?: string,
  ): Promise<PpeDeliveryScheduleBatchDeleteResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const result = await this.repository.deleteMany(data.ppeScheduleIds);

      // Log successful deletions
      for (const item of result.success) {
        if (item.deleted) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
            entityId: item.id,
            action: CHANGE_ACTION.DELETE,
            field: null,
            oldValue: null,
            newValue: null,
            reason: 'Agendamento de PPE removido em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            triggeredById: item.id,
            userId: userId || null,
            transaction: transaction,
          });
        }
      }

      return {
        success: true,
        message: `${result.totalDeleted} agendamentos de PPE removidos com sucesso. ${result.totalFailed} falharam.`,
        data: {
          success: result.success,
          failed: result.failed.map((error, idx) => ({
            index: error.index ?? idx,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: error.data,
          })),
          totalProcessed: result.totalDeleted + result.totalFailed,
          totalSuccess: result.totalDeleted,
          totalFailed: result.totalFailed,
        },
      };
    });
  }

  // Specialized operations
  async toggleActive(
    id: string,
    data: { isActive: boolean },
    userId?: string,
  ): Promise<PpeDeliveryScheduleUpdateResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const oldSchedule = await this.repository.findById(id);

      if (!oldSchedule) {
        throw new NotFoundException(
          'Agendamento de PPE não encontrado. Verifique se o ID está correto.',
        );
      }

      const updatedSchedule = await this.repository.update(
        id,
        { isActive: data.isActive },
        { include: undefined },
      );

      // Track the isActive field change
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: id,
        oldEntity: oldSchedule,
        newEntity: updatedSchedule,
        fieldsToTrack: ['isActive'],
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: transaction,
      });

      // Log the status change event
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: updatedSchedule.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'statusChange',
        oldValue: oldSchedule.isActive,
        newValue: data.isActive,
        reason: `Agendamento de PPE ${data.isActive ? 'ativado' : 'desativado'}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: updatedSchedule.id,
        userId: userId || null,
        transaction: transaction,
      });

      return {
        success: true,
        message: `Agendamento de PPE ${data.isActive ? 'ativado' : 'desativado'} com sucesso.`,
        data: updatedSchedule,
      };
    });
  }

  async recalculateNextRun(
    id: string,
    userId?: string,
  ): Promise<PpeDeliveryScheduleUpdateResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const schedule = await this.repository.findById(id);

      if (!schedule) {
        throw new NotFoundException(
          'Agendamento de PPE não encontrado. Verifique se o ID está correto.',
        );
      }

      // For now, skip the nextRun calculation as per user request for basic CRUD only
      const updatedSchedule = await this.repository.updateWithTransaction(
        transaction,
        id,
        {
          lastRun: new Date(),
        },
        { include: undefined },
      );

      // Track the lastRun field change
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: id,
        oldEntity: schedule,
        newEntity: updatedSchedule,
        fieldsToTrack: ['lastRun'],
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: transaction,
      });

      // Log the recalculation event
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: updatedSchedule.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'recalculation',
        oldValue: { lastRun: schedule.lastRun },
        newValue: { lastRun: updatedSchedule.lastRun },
        reason: 'Próxima execução do agendamento recalculada',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: updatedSchedule.id,
        userId: userId || null,
        transaction: transaction,
      });

      return {
        success: true,
        message: 'Próxima execução do agendamento recalculada com sucesso.',
        data: updatedSchedule,
      };
    });
  }

  async findActiveSchedules(
    include?: PpeDeliveryScheduleInclude,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    const result = await this.repository.findMany({
      where: { isActive: true },
      include,
    });

    return {
      success: true,
      message: 'Agendamentos ativos listados com sucesso.',
      data: result.data,
      meta: result.meta,
    };
  }

  async findByUser(
    userId: string,
    include?: PpeDeliveryScheduleInclude,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    const result = await this.repository.findMany({
      where: { userId },
      include,
    });

    return {
      success: true,
      message: 'Agendamentos do usuário listados com sucesso.',
      data: result.data,
      meta: result.meta,
    };
  }

  // Removed findByCategory as categoryId is no longer part of PpeDeliverySchedule

  // COMMENTED OUT: PPE config now in Item model
  // async findByConfig(configId: string, include?: PpeDeliveryScheduleInclude): Promise<PpeDeliveryScheduleGetManyResponse> {
  //   const result = await this.repository.findMany({
  //     where: { ppeConfigId: configId },
  //     include,
  //   });
  //
  //   return {
  //     success: true,
  //     message: "Agendamentos da configuração listados com sucesso.",
  //     data: result.data,
  //     meta: result.meta,
  //   };
  // }

  async findByItem(
    itemId: string,
    include?: PpeDeliveryScheduleInclude,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    const result = await this.repository.findMany({
      where: { itemId },
      include,
    });

    return {
      success: true,
      message: 'Agendamentos do item listados com sucesso.',
      data: result.data,
      meta: result.meta,
    };
  }

  async findDueSchedules(
    date?: Date,
    include?: PpeDeliveryScheduleInclude,
  ): Promise<PpeDeliveryScheduleGetManyResponse> {
    const targetDate = date || new Date();
    const result = await this.repository.findMany({
      where: {
        isActive: true,
        nextRun: {
          lte: targetDate,
        },
      },
      include,
    });

    return {
      success: true,
      message: 'Agendamentos pendentes listados com sucesso.',
      data: result.data,
      meta: result.meta,
    };
  }

  /**
   * Execute a schedule manually - create deliveries for all assigned users immediately
   */
  async executeScheduleNow(
    scheduleId: string,
    userId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      deliveriesCreated: number;
      userCount: number;
      ppeTypes: string[];
      errors?: string[];
    };
  }> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      // Get the schedule with all details
      const schedule = await this.repository.findById(scheduleId, {
        include: {
          user: true,
          category: true,
        },
      });

      if (!schedule) {
        throw new NotFoundException(
          'Agendamento de PPE não encontrado. Verifique se o ID está correto.',
        );
      }

      if (!schedule.isActive) {
        throw new BadRequestException(
          'O agendamento de PPE está inativo e não pode ser executado.',
        );
      }

      if (
        !schedule.ppeItems ||
        !Array.isArray(schedule.ppeItems) ||
        schedule.ppeItems.length === 0
      ) {
        throw new BadRequestException('O agendamento não possui itens de PPE configurados.');
      }

      // Get the users who should receive deliveries
      const assignedUserIds = await this.getAssignedUsers(
        schedule.assignmentType || ASSIGNMENT_TYPE.ALL,
        schedule.excludedUserIds || [],
        schedule.includedUserIds || [],
        transaction,
      );

      if (assignedUserIds.length === 0) {
        throw new BadRequestException(
          'Nenhum usuário encontrado para o tipo de atribuição configurado.',
        );
      }

      let deliveriesCreated = 0;
      const errors: string[] = [];

      // Create deliveries for each assigned user and PPE type combination
      for (const assignedUserId of assignedUserIds) {
        const userItemMatches = await this.findMatchingItemsForUser(
          assignedUserId,
          schedule.ppeItems as { ppeType: PPE_TYPE; quantity: number }[],
          transaction,
        );

        for (const match of userItemMatches) {
          try {
            const deliveryData: PpeDeliveryCreateFormData = {
              userId: match.userId,
              itemId: match.itemId,
              quantity: match.quantity,
              ppeScheduleId: schedule.id,
              status: PPE_DELIVERY_STATUS.PENDING,
              statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.PENDING],
              scheduledDate: new Date(), // Execute now
            };

            await this.ppeDeliveryService.create(deliveryData, undefined, userId);
            deliveriesCreated++;
          } catch (error) {
            const errorMsg = `Erro ao criar entrega para usuário ${match.userId}, item ${match.itemId}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            if (process.env.NODE_ENV !== 'production') {
              console.error(errorMsg);
            }
          }
        }
      }

      // Update schedule last run
      await this.repository.update(scheduleId, {
        lastRun: new Date(),
      });

      // Log the manual execution
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: scheduleId,
        action: CHANGE_ACTION.UPDATE,
        field: 'manual_execution',
        oldValue: null,
        newValue: {
          deliveriesCreated,
          userCount: assignedUserIds.length,
          ppeTypes: schedule.ppeItems?.map(item => item.ppeType) || [],
          errorCount: errors.length,
        },
        reason: `Execução manual do agendamento - ${deliveriesCreated} entregas criadas`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: scheduleId,
        userId: userId || null,
        transaction: transaction,
      });

      return {
        success: true,
        message: `Agendamento executado com sucesso. ${deliveriesCreated} entregas criadas para ${assignedUserIds.length} usuários.${errors.length > 0 ? ` ${errors.length} erros ocorreram.` : ''}`,
        data: {
          deliveriesCreated,
          userCount: assignedUserIds.length,
          ppeTypes: schedule.ppeItems?.map(item => item.ppeType) || [],
          ...(errors.length > 0 && { errors }),
        },
      };
    });
  }

  /**
   * Get schedule execution statistics
   */
  async getScheduleExecutionStats(scheduleId: string): Promise<{
    success: boolean;
    message: string;
    data: {
      totalUsers: number;
      totalDeliveries: number;
      pendingDeliveries: number;
      deliveredCount: number;
      lastExecuted?: Date;
      nextRun?: Date;
      ppeTypes: string[];
      assignmentType: string;
    };
  }> {
    const schedule = await this.repository.findById(scheduleId, {
      include: {
        deliveries: {
          include: {
            user: true,
            item: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException('Agendamento de PPE não encontrado.');
    }

    // Get assigned users count
    const assignedUserIds = await this.getAssignedUsers(
      schedule.assignmentType || ASSIGNMENT_TYPE.ALL,
      schedule.excludedUserIds || [],
      schedule.includedUserIds || [],
    );

    const totalDeliveries = schedule.deliveries?.length || 0;
    const pendingDeliveries = schedule.deliveries?.filter(d => !d.actualDeliveryDate).length || 0;
    const deliveredCount = schedule.deliveries?.filter(d => d.actualDeliveryDate).length || 0;

    return {
      success: true,
      message: 'Estatísticas do agendamento obtidas com sucesso.',
      data: {
        totalUsers: assignedUserIds.length,
        totalDeliveries,
        pendingDeliveries,
        deliveredCount,
        lastExecuted: schedule.lastRun || undefined,
        nextRun: schedule.nextRun || undefined,
        ppeTypes: schedule.ppeItems?.map(item => item.ppeType) || [],
        assignmentType: schedule.assignmentType || ASSIGNMENT_TYPE.ALL,
      },
    };
  }
}
