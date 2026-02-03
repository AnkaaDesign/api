// ppe-delivery.service.ts

import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import {
  PpeDeliveryRepository,
  PrismaTransaction,
} from './repositories/ppe-delivery/ppe-delivery.repository';
import {
  PpeDelivery,
  PpeDeliveryGetUniqueResponse,
  PpeDeliveryGetManyResponse,
  PpeDeliveryCreateResponse,
  PpeDeliveryUpdateResponse,
  PpeDeliveryDeleteResponse,
  PpeDeliveryBatchCreateResponse,
  PpeDeliveryBatchUpdateResponse,
  PpeDeliveryBatchDeleteResponse,
} from '@types';
import {
  PpeDeliveryCreateFormData,
  PpeDeliveryUpdateFormData,
  PpeDeliveryGetManyFormData,
  PpeDeliveryInclude,
  PpeDeliveryBatchCreateFormData,
  PpeDeliveryBatchUpdateFormData,
  PpeDeliveryBatchDeleteFormData,
  PpeDeliveryByScheduleFormData,
} from '@schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_TRIGGERED_BY,
  ACTIVITY_REASON,
  ACTIVITY_OPERATION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  USER_STATUS,
  SCHEDULE_FREQUENCY,
  PPE_DELIVERY_STATUS,
  PPE_TYPE,
  ACTIVE_USER_STATUSES,
} from '@constants';
import { PPE_DELIVERY_STATUS_ORDER } from '@constants';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { ItemRepository } from '@modules/inventory/item/repositories/item/item.repository';
import { PpeDeliveryScheduleRepository } from './repositories/ppe-delivery-schedule/ppe-delivery-schedule.repository';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import {
  logEntityChange,
  trackFieldChanges,
  trackAndLogFieldChanges,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  PpeRequestedEvent,
  PpeApprovedEvent,
  PpeRejectedEvent,
  PpeDeliveredEvent,
  PpeBatchDeliveredEvent,
} from './ppe.events';

@Injectable()
export class PpeDeliveryService {
  constructor(
    private readonly repository: PpeDeliveryRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly prisma: PrismaService,
    private readonly userRepository: UserRepository,
    private readonly itemRepository: ItemRepository,
    private readonly ppeDeliveryScheduleRepository: PpeDeliveryScheduleRepository,
    private readonly activityService: ActivityService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  private async validateEntity(
    data: Partial<PpeDeliveryCreateFormData | PpeDeliveryUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    const isUpdate = !!existingId;
    const existingDelivery = isUpdate ? await this.repository.findById(existingId) : undefined;

    // Validate required fields for creation
    if (!isUpdate) {
      if (!('userId' in data) || !data.userId) {
        throw new BadRequestException('ID do usuário é obrigatório');
      }
      if (!('itemId' in data) || !data.itemId) {
        throw new BadRequestException('ID do item é obrigatório');
      }
      if (!('quantity' in data) || data.quantity === undefined || data.quantity === null) {
        throw new BadRequestException('Quantidade é obrigatória');
      }
    }

    // Validate user exists and is active
    if ('userId' in data && data.userId) {
      const user = await this.userRepository.findById(data.userId, {
        include: {
          ppeSize: true,
          position: true,
          sector: true,
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      if (!user.isActive) {
        throw new BadRequestException('Usuário não está ativo e não pode receber PPEs');
      }

      // Store user info for later size validation
      if (!isUpdate) {
        (data as any)._userInfo = user;
      }
    }

    // Validate approved by user exists and is active
    if ('reviewedBy' in data && data.reviewedBy) {
      const reviewedByUser = await this.userRepository.findById(data.reviewedBy);

      if (!reviewedByUser) {
        throw new NotFoundException('Usuário responsável pela aprovação não encontrado');
      }

      if (!reviewedByUser.isActive) {
        throw new BadRequestException('Usuário responsável pela aprovação não está ativo');
      }
    }

    // Validate quantity
    if ('quantity' in data && data.quantity !== undefined) {
      if (!Number.isInteger(data.quantity)) {
        throw new BadRequestException('Quantidade deve ser um número inteiro');
      }

      if (data.quantity <= 0) {
        throw new BadRequestException('Quantidade deve ser maior que zero');
      }

      if (data.quantity > 100) {
        throw new BadRequestException('Quantidade máxima por entrega é 100 unidades');
      }
    }

    // For creates, validate item exists and is marked as PPE
    if (!isUpdate && 'itemId' in data && data.itemId) {
      const item = await this.itemRepository.findById(data.itemId, {
        include: {
          category: true,
          brand: true,
          measures: {
            where: { measureType: 'SIZE' },
          },
        },
      });

      if (!item) {
        throw new NotFoundException('Item não encontrado');
      }

      if (!item.isActive) {
        throw new BadRequestException('Item não está ativo e não pode ser entregue');
      }

      // Check if item is configured as PPE (check category type)
      if (!item.category || item.category.type !== 'PPE') {
        throw new BadRequestException(
          'O item selecionado não está configurado como PPE. Configure o item como PPE antes de criar entregas',
        );
      }

      // Validate size compatibility between user and PPE config (optional - won't prevent creation)
      if (!isUpdate && (data as any)._userInfo) {
        const userInfo = (data as any)._userInfo;
        // PPE config is now directly on the item

        // Declare userSize outside the inner if block
        let userSize: string | null = null;

        // Size validation is optional - we just log a warning if sizes don't match
        if (userInfo.ppeSize) {
          // Map PPE type to user size field
          let userSizeField: string | null = null;

          switch (item.ppeType) {
            case PPE_TYPE.SHIRT:
              userSizeField = 'shirts';
              userSize = userInfo.ppeSize.shirts;
              break;
            case PPE_TYPE.PANTS:
              userSizeField = 'pants';
              userSize = userInfo.ppeSize.pants;
              break;
            case PPE_TYPE.BOOTS:
              userSizeField = 'boots';
              userSize = userInfo.ppeSize.boots;
              break;
            case PPE_TYPE.SLEEVES:
              userSizeField = 'sleeves';
              userSize = userInfo.ppeSize.sleeves;
              break;
            case PPE_TYPE.MASK:
              userSizeField = 'mask';
              userSize = userInfo.ppeSize.mask;
              break;
            case PPE_TYPE.GLOVES:
              userSizeField = 'gloves';
              userSize = userInfo.ppeSize.gloves;
              break;
            case PPE_TYPE.RAIN_BOOTS:
              userSizeField = 'rainBoots';
              userSize = userInfo.ppeSize.rainBoots;
              break;
          }

          // Size validation is optional - we just log a warning if sizes don't match
        } else {
        }

        // Check if PPE size matches user size via measures (optional - log only)
        // Extract size from item measures (looking for SIZE type measures)
        const sizeMatch = item.measures?.find(m => m.measureType === 'SIZE');
        // For PPE sizes: numeric sizes (boots/pants) use value, letter sizes (shirts) use unit
        const itemSize = sizeMatch?.unit || (sizeMatch?.value ? String(sizeMatch.value) : null);

        // Normalize userSize by removing "SIZE_" prefix for comparison
        // User sizes are stored as enums like "SIZE_38" but item sizes are "38"
        const normalizedUserSize = userSize?.replace('SIZE_', '') || null;

        if (itemSize && normalizedUserSize && itemSize !== normalizedUserSize) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `Warning: PPE size (${itemSize}) doesn't match user size (${normalizedUserSize}) for ${userInfo.name}. Proceeding with delivery anyway.`,
            );
          }
        }

        // Store validated size for stock tracking (if available)
        (data as any)._validatedSize = userSize || itemSize || null;
        (data as any)._ppeType = item.ppeType;
      }

      // Check if item has enough quantity for delivery (considering other pending deliveries)
      if ('quantity' in data) {
        // Get total pending deliveries for this item
        const pendingDeliveries = await transaction.ppeDelivery.aggregate({
          where: {
            itemId: data.itemId,
            actualDeliveryDate: null, // Not yet delivered
          },
          _sum: {
            quantity: true,
          },
        });
        const totalPending = pendingDeliveries._sum?.quantity ?? 0;

        // Get total unreturned borrows
        const unreturnedBorrows = await transaction.borrow.aggregate({
          where: {
            itemId: data.itemId,
            returnedAt: null,
          },
          _sum: {
            quantity: true,
          },
        });
        const totalBorrowed = unreturnedBorrows._sum?.quantity ?? 0;

        const availableQuantity = item.quantity - totalPending - totalBorrowed;

        // Note: Stock validation is done when marking as DELIVERED, not at creation time
        // This allows creating deliveries even with low stock (for planning purposes)
        if (data.quantity !== undefined && availableQuantity < data.quantity) {
          const details: string[] = [];
          if (totalPending > 0) {
            details.push(`${totalPending} pendente(s) de entrega`);
          }
          if (totalBorrowed > 0) {
            details.push(`${totalBorrowed} emprestado(s)`);
          }

          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `Low stock warning: Disponível: ${availableQuantity}, Solicitado: ${data.quantity}. ` +
                `Estoque total: ${item.quantity}${details.length > 0 ? ', ' + details.join(', ') : ''}. Proceeding with delivery creation.`,
            );
          }
        }

        // Warn if stock will be low
        const remainingAfterDelivery = availableQuantity - (data.quantity || 0);
        if (item.reorderPoint && remainingAfterDelivery <= item.reorderPoint) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `AVISO: Item "${item.name}" ficará com estoque baixo após a entrega. ` +
                `Disponível após entrega: ${remainingAfterDelivery}, Ponto de reposição: ${item.reorderPoint}`,
            );
          }
        }
      }
    }

    // For updates, check if we have enough stock when increasing quantity
    if (isUpdate && existingDelivery && 'quantity' in data && data.quantity !== undefined) {
      const quantityDifference = data.quantity - existingDelivery.quantity;

      if (quantityDifference > 0) {
        const item = await this.itemRepository.findById(existingDelivery.itemId);
        if (!item) {
          throw new NotFoundException('Item não encontrado');
        }

        // Only check stock if delivery is already delivered (actualDeliveryDate is set)
        if (existingDelivery.actualDeliveryDate) {
          if (item.quantity < quantityDifference) {
            throw new BadRequestException(
              `Quantidade insuficiente em estoque para aumentar a entrega. Disponível: ${item.quantity}, Aumento necessário: ${quantityDifference}`,
            );
          }
        } else {
          // For pending deliveries, check available quantity considering other pending
          const pendingDeliveries = await transaction.ppeDelivery.aggregate({
            where: {
              itemId: existingDelivery.itemId,
              actualDeliveryDate: null,
              NOT: { id: existingDelivery.id },
            },
            _sum: {
              quantity: true,
            },
          });
          const totalPending = pendingDeliveries._sum?.quantity ?? 0;

          const availableQuantity = item.quantity - totalPending;
          if (availableQuantity < data.quantity) {
            throw new BadRequestException(
              `Quantidade insuficiente considerando outras entregas pendentes. Disponível: ${availableQuantity}, Solicitado: ${data.quantity}`,
            );
          }
        }
      }
    }

    // Validate delivery date
    if ('actualDeliveryDate' in data && data.actualDeliveryDate) {
      const deliveryDate = new Date(data.actualDeliveryDate);

      // Check if valid date
      if (isNaN(deliveryDate.getTime())) {
        throw new BadRequestException('Data de entrega inválida');
      }

      // Cannot be in the future
      const now = new Date();
      if (deliveryDate > now) {
        throw new BadRequestException('A data de entrega não pode ser no futuro');
      }

      // Cannot be too far in the past (e.g., more than 1 year)
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (deliveryDate < oneYearAgo) {
        throw new BadRequestException('A data de entrega não pode ser mais de 1 ano no passado');
      }

      // If updating, check if delivery date can be changed
      if (isUpdate && existingDelivery && existingDelivery.actualDeliveryDate) {
        // Calculate days since delivery
        const daysSinceDelivery = Math.floor(
          (now.getTime() - existingDelivery.actualDeliveryDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        // Don't allow changes after 30 days
        if (daysSinceDelivery > 30) {
          throw new BadRequestException('Não é possível alterar a data de entrega após 30 dias');
        }

        // Warn if changing delivery date
        if (data.actualDeliveryDate.getTime() !== existingDelivery.actualDeliveryDate.getTime()) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `AVISO: Alterando data de entrega de ${existingDelivery.actualDeliveryDate.toISOString()} ` +
                `para ${data.actualDeliveryDate.toISOString()}`,
            );
          }
        }
      }
    }

    // Validate scheduled date
    if ('scheduledDate' in data && data.scheduledDate) {
      const scheduledDate = new Date(data.scheduledDate);

      // Check if valid date
      if (isNaN(scheduledDate.getTime())) {
        throw new BadRequestException('Data agendada inválida');
      }

      // For new deliveries, scheduled date should be in the future
      if (!isUpdate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (scheduledDate < today) {
          throw new BadRequestException('A data agendada deve ser hoje ou no futuro');
        }

        // Don't allow scheduling more than 1 year in advance
        const oneYearFromNow = new Date();
        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
        if (scheduledDate > oneYearFromNow) {
          throw new BadRequestException(
            'Não é possível agendar entregas para mais de 1 ano no futuro',
          );
        }
      }

      // If both scheduled and actual delivery dates are provided, validate consistency
      if ('actualDeliveryDate' in data && data.actualDeliveryDate) {
        const actualDate = new Date(data.actualDeliveryDate);
        const scheduledDateObj = new Date(data.scheduledDate);
        if (actualDate < scheduledDateObj) {
          throw new BadRequestException('A data de entrega não pode ser anterior à data agendada');
        }
      }
    }

    // For scheduled deliveries being converted to actual deliveries
    if (!isUpdate && 'ppeScheduleId' in data && data.ppeScheduleId) {
      const schedule = await this.ppeDeliveryScheduleRepository.findById(data.ppeScheduleId, {
        include: {
          item: true,
          user: true,
        },
      });

      if (!schedule) {
        throw new NotFoundException('Agendamento de PPE não encontrado');
      }

      // Ensure the schedule is active
      if (!schedule.isActive) {
        throw new BadRequestException('O agendamento de PPE está inativo');
      }

      // Note: PpeDeliverySchedule uses flexible assignment, not direct userId/itemId

      // Check if delivery for this schedule already exists for the current period
      // Calculate days based on frequency
      let daysToCheck = 1;
      switch (schedule.frequency) {
        case SCHEDULE_FREQUENCY.ONCE:
          daysToCheck = 36500; // Effectively infinite - once means only once ever
          break;
        case SCHEDULE_FREQUENCY.DAILY:
          daysToCheck = 1;
          break;
        case SCHEDULE_FREQUENCY.WEEKLY:
          daysToCheck = 7;
          break;
        case SCHEDULE_FREQUENCY.BIWEEKLY:
          daysToCheck = 14;
          break;
        case SCHEDULE_FREQUENCY.MONTHLY:
          daysToCheck = 30;
          break;
        case SCHEDULE_FREQUENCY.BIMONTHLY:
          daysToCheck = 60;
          break;
        case SCHEDULE_FREQUENCY.QUARTERLY:
          daysToCheck = 90;
          break;
        case SCHEDULE_FREQUENCY.TRIANNUAL:
          daysToCheck = 120;
          break;
        case SCHEDULE_FREQUENCY.QUADRIMESTRAL:
          daysToCheck = 120;
          break;
        case SCHEDULE_FREQUENCY.SEMI_ANNUAL:
          daysToCheck = 180;
          break;
        case SCHEDULE_FREQUENCY.ANNUAL:
          daysToCheck = 365;
          break;
        case SCHEDULE_FREQUENCY.CUSTOM:
          daysToCheck = (schedule.frequencyCount || 1);
          break;
        default:
          daysToCheck = 30;
      }

      const existingDeliveryForSchedule = await transaction.ppeDelivery.findFirst({
        where: {
          ppeScheduleId: data.ppeScheduleId,
          userId: data.userId,
          itemId: data.itemId, // Check for same item to allow multiple PPE types per schedule
          createdAt: {
            gte: new Date(new Date().setDate(new Date().getDate() - daysToCheck)),
          },
        },
      });

      if (existingDeliveryForSchedule) {
        throw new BadRequestException(
          `Já existe uma entrega recente deste item para este agendamento (criada em ${existingDeliveryForSchedule.createdAt.toLocaleDateString('pt-BR')})`,
        );
      }
    }

    // Validate observation length if provided
    if ('observation' in data && data.observation !== undefined && data.observation !== null) {
      if (typeof data.observation === 'string' && data.observation.length > 500) {
        throw new BadRequestException('Observação deve ter no máximo 500 caracteres');
      }
    }

    // Status transition validation
    if ('status' in data && data.status !== undefined) {
      const newStatus = data.status;

      if (isUpdate && existingDelivery) {
        const currentStatus = existingDelivery.status;

        // Validate allowed status transitions
        const validTransitions: Record<PPE_DELIVERY_STATUS, PPE_DELIVERY_STATUS[]> = {
          [PPE_DELIVERY_STATUS.PENDING]: [
            PPE_DELIVERY_STATUS.APPROVED,
            PPE_DELIVERY_STATUS.REPROVED,
            PPE_DELIVERY_STATUS.CANCELLED,
          ],
          [PPE_DELIVERY_STATUS.APPROVED]: [
            PPE_DELIVERY_STATUS.DELIVERED,
            PPE_DELIVERY_STATUS.REPROVED,
            PPE_DELIVERY_STATUS.CANCELLED,
          ],
          [PPE_DELIVERY_STATUS.DELIVERED]: [
            PPE_DELIVERY_STATUS.WAITING_SIGNATURE, // After delivery, goes to waiting signature
            PPE_DELIVERY_STATUS.APPROVED, // Allow reverting delivery if marked by mistake
          ],
          [PPE_DELIVERY_STATUS.WAITING_SIGNATURE]: [
            PPE_DELIVERY_STATUS.COMPLETED, // After signing, goes to completed
            PPE_DELIVERY_STATUS.SIGNATURE_REJECTED, // If signature is rejected
          ],
          [PPE_DELIVERY_STATUS.COMPLETED]: [], // Final status - no further transitions
          [PPE_DELIVERY_STATUS.SIGNATURE_REJECTED]: [
            PPE_DELIVERY_STATUS.WAITING_SIGNATURE, // Can retry signature
          ],
          [PPE_DELIVERY_STATUS.REPROVED]: [], // Final status - no further transitions
          [PPE_DELIVERY_STATUS.CANCELLED]: [], // Final status - no further transitions
        };

        if (!validTransitions[currentStatus]?.includes(newStatus as PPE_DELIVERY_STATUS)) {
          throw new BadRequestException(
            `Transição de status inválida: não é possível alterar de ${currentStatus} para ${newStatus}. ` +
              `Transições válidas: ${validTransitions[currentStatus]?.join(', ') || 'nenhuma'}`,
          );
        }

        // Special validation for DELIVERED status
        if (newStatus === PPE_DELIVERY_STATUS.DELIVERED) {
          if (!data.actualDeliveryDate && !existingDelivery.actualDeliveryDate) {
            throw new BadRequestException('Data de entrega é obrigatória ao marcar como entregue');
          }
        }
      } else if (!isUpdate) {
        // For new deliveries, only allow PENDING or APPROVED status
        if (
          newStatus !== PPE_DELIVERY_STATUS.PENDING &&
          newStatus !== PPE_DELIVERY_STATUS.APPROVED
        ) {
          throw new BadRequestException('Novas entregas devem ter status PENDING ou APPROVED');
        }
      }
    }

    // Additional validations for updates
    if (isUpdate && existingDelivery) {
      // Don't allow changing core fields after delivery
      if (existingDelivery.actualDeliveryDate) {
        if ('userId' in data && data.userId !== existingDelivery.userId) {
          throw new BadRequestException('Não é possível alterar o usuário após a entrega');
        }

        if ('itemId' in data && data.itemId !== existingDelivery.itemId) {
          throw new BadRequestException('Não é possível alterar o item após a entrega');
        }

        if ('ppeScheduleId' in data && data.ppeScheduleId !== existingDelivery.ppeScheduleId) {
          throw new BadRequestException('Não é possível alterar o agendamento após a entrega');
        }
      }
    }
  }

  private async updateStockForDelivery(
    delivery: PpeDelivery,
    transaction: PrismaTransaction,
    userId?: string,
    additionalInfo?: { size?: string; ppeType?: PPE_TYPE },
  ): Promise<void> {
    // Update item stock
    const item = await this.itemRepository.findById(delivery.itemId);
    if (!item) {
      throw new NotFoundException('Item não encontrado para atualização de estoque');
    }

    // Get size and PPE type information
    const sizeInfo = additionalInfo?.size;
    let ppeType = additionalInfo?.ppeType;

    // If not provided, try to get from item's PPE fields
    if (!sizeInfo && item.ppeType) {
      // Note: ppeSize field removed from Item model
      ppeType = item.ppeType;
    }

    // Create activity for stock movement - this handles stock update and monthly consumption automatically
    await this.activityService.create(
      {
        itemId: delivery.itemId,
        userId: delivery.userId,
        quantity: delivery.quantity, // Quantity is positive, operation determines in/out
        operation: ACTIVITY_OPERATION.OUTBOUND, // Removal
        reason: ACTIVITY_REASON.PPE_DELIVERY,
      },
      undefined,
      userId,
    );
  }

  private calculateNextScheduledDate(schedule: any, currentDate: Date = new Date()): Date | null {
    const nextDate = new Date(currentDate);
    const count = schedule.frequencyCount || 1;

    switch (schedule.frequency) {
      case SCHEDULE_FREQUENCY.ONCE:
        // One-time schedules don't have a next occurrence
        return null;

      case SCHEDULE_FREQUENCY.DAILY:
        nextDate.setDate(nextDate.getDate() + count);
        break;

      case SCHEDULE_FREQUENCY.WEEKLY:
        nextDate.setDate(nextDate.getDate() + 7 * count);
        break;

      case SCHEDULE_FREQUENCY.BIWEEKLY:
        nextDate.setDate(nextDate.getDate() + 14 * count);
        break;

      case SCHEDULE_FREQUENCY.MONTHLY:
        nextDate.setMonth(nextDate.getMonth() + count);
        break;

      case SCHEDULE_FREQUENCY.BIMONTHLY:
        nextDate.setMonth(nextDate.getMonth() + 2 * count);
        break;

      case SCHEDULE_FREQUENCY.QUARTERLY:
        nextDate.setMonth(nextDate.getMonth() + 3 * count);
        break;

      case SCHEDULE_FREQUENCY.TRIANNUAL:
        nextDate.setMonth(nextDate.getMonth() + 4 * count);
        break;

      case SCHEDULE_FREQUENCY.QUADRIMESTRAL:
        nextDate.setMonth(nextDate.getMonth() + 4 * count);
        break;

      case SCHEDULE_FREQUENCY.SEMI_ANNUAL:
        nextDate.setMonth(nextDate.getMonth() + 6 * count);
        break;

      case SCHEDULE_FREQUENCY.ANNUAL:
        nextDate.setFullYear(nextDate.getFullYear() + count);
        break;

      case SCHEDULE_FREQUENCY.CUSTOM:
        // Custom frequency uses frequencyCount as days
        nextDate.setDate(nextDate.getDate() + count);
        break;

      default:
        // Default to monthly if frequency is unknown
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
    }

    return nextDate;
  }

  private async autoCreateNextDelivery(
    finishedDelivery: PpeDelivery,
    transaction: PrismaTransaction,
    userId?: string,
  ): Promise<PpeDelivery | null> {
    // Only auto-create if the delivery is linked to a schedule
    if (!finishedDelivery.ppeScheduleId) {
      return null;
    }

    try {
      // Get the schedule with all necessary includes
      const schedule = await this.ppeDeliveryScheduleRepository.findById(
        finishedDelivery.ppeScheduleId,
        {
          include: {
            weeklyConfig: true,
            monthlyConfig: true,
            yearlyConfig: true,
            deliveries: true,
          },
        },
      );

      if (!schedule) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Schedule ${finishedDelivery.ppeScheduleId} not found for auto-creation`);
        }
        return null;
      }

      // Only auto-create if schedule is still active
      if (!schedule.isActive) {
        return null;
      }

      // Don't auto-create for one-time schedules
      if (schedule.frequency === SCHEDULE_FREQUENCY.ONCE) {
        return null;
      }

      // Calculate next scheduled date
      const nextScheduledDate = this.calculateNextScheduledDate(
        schedule,
        finishedDelivery.actualDeliveryDate || new Date(),
      );

      // If no next date (e.g., ONCE frequency), don't create
      if (!nextScheduledDate) {
        return null;
      }

      // Create the new delivery instance
      const newDeliveryData: PpeDeliveryCreateFormData = {
        userId: finishedDelivery.userId,
        itemId: finishedDelivery.itemId,
        quantity: finishedDelivery.quantity,
        ppeScheduleId: schedule.id,
        status: PPE_DELIVERY_STATUS.PENDING,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.PENDING],
        scheduledDate: nextScheduledDate,
        // Do not set actualDeliveryDate - it should remain null until delivered
      };

      // Create the new delivery using the existing validation logic
      const newDelivery = await this.repository.create(newDeliveryData, {
        include: {
          item: true,
          user: true,
          ppeSchedule: true,
        },
      });

      // Update the schedule's lastRun and nextRun
      await this.ppeDeliveryScheduleRepository.update(schedule.id, {
        lastRun: finishedDelivery.actualDeliveryDate || new Date(),
        nextRun: nextScheduledDate,
      });

      // Log the auto-creation
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: newDelivery.id,
        action: CHANGE_ACTION.CREATE,
        field: null,
        oldValue: null,
        newValue: newDelivery,
        reason: `Entrega de PPE criada automaticamente a partir da conclusão da entrega ${finishedDelivery.id}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
        triggeredById: finishedDelivery.id,
        userId: userId || null,
        transaction: transaction,
      });

      // Log the schedule update
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY_SCHEDULE,
        entityId: schedule.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'auto_schedule_update',
        oldValue: { lastRun: schedule.lastRun, nextRun: schedule.nextRun },
        newValue: {
          lastRun: finishedDelivery.actualDeliveryDate || new Date(),
          nextRun: nextScheduledDate,
        },
        reason: `Agendamento atualizado após conclusão da entrega ${finishedDelivery.id}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
        triggeredById: finishedDelivery.id,
        userId: userId || null,
        transaction: transaction,
      });

      return newDelivery;
    } catch (error) {
      // Log the error but don't fail the main transaction
      if (process.env.NODE_ENV !== 'production') {
        console.error(
          `Error auto-creating next PPE delivery for schedule ${finishedDelivery.ppeScheduleId}:`,
          error,
        );
      }

      // Log the error in change log
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: finishedDelivery.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'auto_creation_error',
        oldValue: null,
        newValue: { error: error instanceof Error ? error.message : String(error) },
        reason: `Erro na criação automática da próxima entrega`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: finishedDelivery.id,
        userId: userId || null,
        transaction: transaction,
      });

      return null;
    }
  }

  // Basic CRUD operations
  async create(
    data: PpeDeliveryCreateFormData,
    include?: PpeDeliveryInclude,
    userId?: string,
  ): Promise<PpeDeliveryCreateResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      // Validate the delivery
      await this.validateEntity(data, undefined, transaction);

      const ppeDelivery = await this.repository.create(data, { include });

      // If delivery has actualDeliveryDate, update stock
      if (data.actualDeliveryDate) {
        // Pass size info from validation
        const sizeInfo = (data as any)._validatedSize;
        const ppeType = (data as any)._ppeType;
        await this.updateStockForDelivery(ppeDelivery, transaction, userId, {
          size: sizeInfo,
          ppeType,
        });
      }

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: ppeDelivery.id,
        action: CHANGE_ACTION.CREATE,
        field: null,
        oldValue: null,
        newValue: ppeDelivery,
        reason: `Nova entrega de EPI criada${data.ppeScheduleId ? ' via agendamento' : ''}`,
        triggeredBy: data.ppeScheduleId
          ? CHANGE_TRIGGERED_BY.SCHEDULE
          : CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: ppeDelivery.id,
        userId: userId || null,
        transaction: transaction,
      });

      // Emit ppe.requested event for new pending deliveries
      if (ppeDelivery.status === PPE_DELIVERY_STATUS.PENDING && userId) {
        try {
          // Get delivery with item and user info for the event
          const deliveryWithRelations = await this.repository.findById(ppeDelivery.id, {
            include: { item: true, user: true },
          });

          const requestedByUser = await this.userRepository.findById(userId);

          if (deliveryWithRelations && deliveryWithRelations.item && requestedByUser) {
            this.eventEmitter.emit(
              'ppe.requested',
              new PpeRequestedEvent(
                deliveryWithRelations,
                deliveryWithRelations.item as any,
                requestedByUser as any,
              ),
            );
          }
        } catch (error) {
          // Log error but don't fail the main operation
          console.error('Error emitting ppe.requested event:', error);
        }
      }

      return {
        success: true,
        message: 'Entrega de PPE criada com sucesso.',
        data: ppeDelivery,
      };
    });
  }

  async findById(id: string, include?: PpeDeliveryInclude): Promise<PpeDeliveryGetUniqueResponse> {
    const ppeDelivery = await this.repository.findById(id, { include });

    if (!ppeDelivery) {
      throw new NotFoundException('Entrega de PPE não encontrada. Verifique se o ID está correto.');
    }

    return {
      success: true,
      message: 'Entrega de PPE encontrada com sucesso.',
      data: ppeDelivery,
    };
  }

  async findMany(query: PpeDeliveryGetManyFormData): Promise<PpeDeliveryGetManyResponse> {
    const result = await this.repository.findMany(query);

    return {
      success: true,
      message: 'Entregas de PPE listadas com sucesso.',
      ...result,
    };
  }

  /**
   * Find PPE deliveries for users in the manager's team/sector
   * If user manages a sector, returns deliveries for users in that sector
   * If user doesn't manage a sector, returns only their own deliveries
   */
  async findManyForTeam(
    query: PpeDeliveryGetManyFormData,
    managerId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Get the manager's managed sector
    const manager = await this.userRepository.findById(managerId, {
      include: {
        managedSector: true,
        sector: true,
      },
    });

    if (!manager) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Get the sector ID to filter by
    // Priority: managed sector > own sector
    const sectorId = manager.managedSector?.id || manager.sectorId;

    if (!sectorId) {
      // User has no sector association, return empty result
      return {
        success: true,
        message: 'Entregas de PPE da equipe listadas com sucesso.',
        data: [],
        meta: {
          totalRecords: 0,
          totalPages: 0,
          page: query.page || 1,
          take: query.take || query.limit || 20,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    // Get all user IDs in the sector
    const usersInSector = await this.prisma.user.findMany({
      where: { sectorId },
      select: { id: true },
    });

    const userIds = usersInSector.map(u => u.id);

    if (userIds.length === 0) {
      // No users in sector, return empty result
      return {
        success: true,
        message: 'Entregas de PPE da equipe listadas com sucesso.',
        data: [],
        meta: {
          totalRecords: 0,
          totalPages: 0,
          page: query.page || 1,
          take: query.take || query.limit || 20,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    // Filter deliveries to only users in the sector using userId IN filter
    const filteredQuery: PpeDeliveryGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId: { in: userIds },
      },
    };

    const result = await this.repository.findMany(filteredQuery);

    return {
      success: true,
      message: 'Entregas de PPE da equipe listadas com sucesso.',
      ...result,
    };
  }

  /**
   * Find available PPE items filtered by user's size and delivery mode
   * Returns only items that:
   * - Match the user's configured PPE size
   * - Are available for on-demand delivery (ON_DEMAND or BOTH)
   */
  async findAvailablePpeItems(
    userId: string,
    ppeType?: PPE_TYPE,
    page: number = 1,
    limit: number = 50,
    search?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: any[];
    meta: {
      totalRecords: number;
      totalPages: number;
      page: number;
      take: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }> {
    // Get user's PPE size configuration
    const user = await this.userRepository.findById(userId, {
      include: {
        ppeSize: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const userPpeSize = user.ppeSize;

    // Helper function to get user's size for a PPE type
    const getUserSizeForPpeType = (itemPpeType: string | null): string | null => {
      if (!userPpeSize || !itemPpeType) return null;

      switch (itemPpeType) {
        case PPE_TYPE.SHIRT:
          return userPpeSize.shirts;
        case PPE_TYPE.PANTS:
          return userPpeSize.pants;
        case PPE_TYPE.SHORT:
          // Use shorts field if available, fallback to pants
          return userPpeSize.shorts || userPpeSize.pants;
        case PPE_TYPE.BOOTS:
          return userPpeSize.boots;
        case PPE_TYPE.SLEEVES:
          return userPpeSize.sleeves;
        case PPE_TYPE.MASK:
          return userPpeSize.mask;
        case PPE_TYPE.GLOVES:
          return userPpeSize.gloves;
        case PPE_TYPE.RAIN_BOOTS:
          return userPpeSize.rainBoots;
        default:
          return null;
      }
    };

    // Build the base query for PPE items
    // Only include items available for on-demand delivery
    const whereConditions: any = {
      isActive: true,
      category: {
        type: 'PPE',
      },
      // Only show items that can be requested on-demand
      OR: [
        { ppeDeliveryMode: 'ON_DEMAND' },
        { ppeDeliveryMode: 'BOTH' },
        { ppeDeliveryMode: null }, // Include items without delivery mode set (legacy)
      ],
    };

    // Filter by ppeType if specified
    if (ppeType) {
      whereConditions.ppeType = ppeType;
    } else {
      // If no ppeType specified, only get items that have a ppeType configured
      whereConditions.ppeType = { not: null };
    }

    // Add search filter if provided
    if (search) {
      whereConditions.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { uniCode: { contains: search, mode: 'insensitive' } },
            { brand: { name: { contains: search, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    // Fetch all matching items (we need to filter by size in memory)
    // Using a reasonable limit to prevent memory issues
    const allItems = await this.prisma.item.findMany({
      where: whereConditions,
      include: {
        brand: true,
        category: true,
        measures: {
          where: { measureType: 'SIZE' },
        },
      },
      orderBy: { name: 'asc' },
      take: 500, // Reasonable limit for PPE items
    });

    // Filter items by size match
    const matchingItems = allItems.filter((item) => {
      // Get the item's size from measures
      const sizeMeasure = item.measures?.find((m) => m.measureType === 'SIZE');
      const itemSize = sizeMeasure?.unit || (sizeMeasure?.value ? String(sizeMeasure.value) : null);

      // If item has no size defined, include it (generic item)
      if (!itemSize) return true;

      // Get user's size for this PPE type
      const userSize = getUserSizeForPpeType(item.ppeType);

      // If user has no size configured for this type, include all items
      if (!userSize) return true;

      // Normalize user size (remove SIZE_ prefix if present)
      const normalizedUserSize = userSize.replace('SIZE_', '');

      // Check if sizes match
      return itemSize === normalizedUserSize;
    });

    // Calculate pagination on filtered results
    const total = matchingItems.length;
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;
    const paginatedItems = matchingItems.slice(skip, skip + limit);

    // Annotate items with size info for frontend display
    const annotatedItems = paginatedItems.map((item) => {
      const sizeMeasure = item.measures?.find((m) => m.measureType === 'SIZE');
      const itemSize = sizeMeasure?.unit || (sizeMeasure?.value ? String(sizeMeasure.value) : null);
      const userSize = getUserSizeForPpeType(item.ppeType);
      const normalizedUserSize = userSize?.replace('SIZE_', '') || null;

      return {
        ...item,
        itemSize,
        userSize: normalizedUserSize,
        sizeMatches: true, // All returned items match (we filtered above)
        // Remove measures from response to keep it clean
        measures: undefined,
      };
    });

    return {
      success: true,
      message: 'Itens de PPE carregados com sucesso.',
      data: annotatedItems,
      meta: {
        totalRecords: total,
        totalPages,
        page,
        take: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async update(
    id: string,
    data: PpeDeliveryUpdateFormData,
    include?: PpeDeliveryInclude,
    userId?: string,
  ): Promise<PpeDeliveryUpdateResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const oldPpeDelivery = await this.repository.findById(id);

      if (!oldPpeDelivery) {
        throw new NotFoundException(
          'Entrega de PPE não encontrada. Verifique se o ID está correto.',
        );
      }

      // Validate the update
      await this.validateEntity(data, id, transaction);

      const updatedPpeDelivery = await this.repository.update(id, data, { include });

      // Track field-level changes for better changelog history
      const fieldsToTrack = [
        'status',
        'quantity',
        'scheduledDate',
        'actualDeliveryDate',
        'reviewedBy',
        'observation',
      ];

      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: id,
        oldEntity: oldPpeDelivery,
        newEntity: updatedPpeDelivery,
        fieldsToTrack: fieldsToTrack.filter(field => data.hasOwnProperty(field)),
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: transaction,
      });

      // Handle stock updates if actualDeliveryDate is being set for the first time
      if (!oldPpeDelivery.actualDeliveryDate && data.actualDeliveryDate) {
        // Get size info from the updated delivery
        const itemWithConfig = await this.itemRepository.findById(updatedPpeDelivery.itemId);
        const userWithSize = await this.userRepository.findById(updatedPpeDelivery.userId, {
          include: { ppeSize: true },
        });

        let sizeInfo: string | undefined;
        let ppeType: PPE_TYPE | undefined;

        if (itemWithConfig?.ppeType && userWithSize?.ppeSize) {
          ppeType = itemWithConfig.ppeType;
          // Map PPE type to user size
          switch (ppeType) {
            case PPE_TYPE.SHIRT:
              sizeInfo = userWithSize.ppeSize.shirts || undefined;
              break;
            case PPE_TYPE.PANTS:
              sizeInfo = userWithSize.ppeSize.pants || undefined;
              break;
            case PPE_TYPE.BOOTS:
              sizeInfo = userWithSize.ppeSize.boots || undefined;
              break;
            case PPE_TYPE.SLEEVES:
              sizeInfo = userWithSize.ppeSize.sleeves || undefined;
              break;
            case PPE_TYPE.MASK:
              sizeInfo = userWithSize.ppeSize.mask || undefined;
              break;
            case PPE_TYPE.GLOVES:
              sizeInfo = userWithSize.ppeSize.gloves || undefined;
              break;
            case PPE_TYPE.RAIN_BOOTS:
              sizeInfo = userWithSize.ppeSize.rainBoots || undefined;
              break;
          }
        }

        await this.updateStockForDelivery(updatedPpeDelivery, transaction, userId, {
          size: sizeInfo,
          ppeType,
        });
      }

      // Handle stock restoration when reverting a delivery (actualDeliveryDate cleared)
      if (oldPpeDelivery.actualDeliveryDate && data.actualDeliveryDate === null) {
        // Restore stock directly - we update the item quantity and create an activity record
        const item = await this.itemRepository.findById(oldPpeDelivery.itemId);
        if (item) {
          // Update item quantity directly
          const newQuantity = item.quantity + oldPpeDelivery.quantity;
          await transaction.item.update({
            where: { id: oldPpeDelivery.itemId },
            data: { quantity: newQuantity },
          });

          // Create activity record directly to avoid nested transaction issues
          await transaction.activity.create({
            data: {
              itemId: oldPpeDelivery.itemId,
              userId: oldPpeDelivery.userId,
              quantity: oldPpeDelivery.quantity,
              operation: ACTIVITY_OPERATION.INBOUND,
              reason: ACTIVITY_REASON.RETURN,
            },
          });

          if (process.env.NODE_ENV !== 'production') {
            console.log(
              `Estoque restaurado: ${oldPpeDelivery.quantity} unidades de ${item.name} devolvidas ao estoque (entrega revertida). Nova quantidade: ${newQuantity}`,
            );
          }
        }
      }

      // Handle stock adjustments if quantity changed on delivered items
      if (
        oldPpeDelivery.actualDeliveryDate &&
        data.quantity !== undefined &&
        data.quantity !== oldPpeDelivery.quantity
      ) {
        const quantityDifference = data.quantity - oldPpeDelivery.quantity;

        const item = await this.itemRepository.findById(oldPpeDelivery.itemId);
        if (!item) {
          throw new NotFoundException('Item não encontrado para ajuste de estoque');
        }

        const newQuantity = Math.max(0, item.quantity - quantityDifference);
        await this.itemRepository.update(oldPpeDelivery.itemId, { quantity: newQuantity });

        // Create adjustment activity
        await this.activityService.create(
          {
            itemId: oldPpeDelivery.itemId,
            userId: oldPpeDelivery.userId,
            quantity: Math.abs(quantityDifference),
            operation:
              quantityDifference > 0 ? ACTIVITY_OPERATION.OUTBOUND : ACTIVITY_OPERATION.INBOUND,
            reason: ACTIVITY_REASON.MANUAL_ADJUSTMENT,
          },
          undefined,
          userId,
        );
      }

      return {
        success: true,
        message: 'Entrega de PPE atualizada com sucesso.',
        data: updatedPpeDelivery,
      };
    });
  }

  async delete(id: string, userId?: string): Promise<PpeDeliveryDeleteResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const ppeDelivery = await this.repository.findById(id);

      if (!ppeDelivery) {
        throw new NotFoundException(
          'Entrega de PPE não encontrada. Verifique se o ID está correto.',
        );
      }

      const deletedPpeDelivery = await this.repository.delete(id);

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: deletedPpeDelivery.id,
        action: CHANGE_ACTION.DELETE,
        field: null,
        oldValue: deletedPpeDelivery,
        newValue: null,
        reason: `Entrega de EPI excluída - Status: ${ppeDelivery.status}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: deletedPpeDelivery.id,
        userId: userId || null,
        transaction: transaction,
      });

      return {
        success: true,
        message: 'Entrega de PPE removida com sucesso.',
      };
    });
  }

  // Batch operations
  async batchCreate(
    data: PpeDeliveryBatchCreateFormData,
    include?: PpeDeliveryInclude,
    userId?: string,
  ): Promise<PpeDeliveryBatchCreateResponse<PpeDeliveryCreateFormData>> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      // Always include item and user for proper display in frontend
      const defaultInclude: PpeDeliveryInclude = {
        item: true,
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        reviewedByUser: true,
        ppeSchedule: true,
      };

      const result = await this.repository.createMany(data.ppeDeliveries, {
        include: include || defaultInclude,
      });

      // Log successful creations
      for (const delivery of result.success) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PPE_DELIVERY,
          entityId: delivery.id,
          action: CHANGE_ACTION.CREATE,
          entity: delivery,
          reason: 'Entrega de PPE criada em lote',
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
          userId: userId || null,
          transaction: transaction,
        });
      }

      // Enrich success data with extracted fields for frontend
      const enrichedSuccess = result.success.map((delivery: any) => ({
        ...delivery,
        itemName: delivery.item?.name || delivery.item?.uniCode || 'Item desconhecido',
        userName: delivery.user?.name || 'Funcionário desconhecido',
        quantity: delivery.quantity,
      }));

      // Enrich failed data with item and user names from original request
      const enrichedFailed = await Promise.all(
        result.failed.map(async (error, idx) => {
          const originalData = data.ppeDeliveries[error.index ?? idx];
          let itemName = 'Item desconhecido';
          let userName = 'Funcionário desconhecido';

          // Try to fetch item and user names
          if (originalData?.itemId) {
            try {
              const item = await transaction.item.findUnique({
                where: { id: originalData.itemId },
                select: { name: true, uniCode: true },
              });
              itemName = item?.name || item?.uniCode || itemName;
            } catch (e) {
              // Keep default
            }
          }

          if (originalData?.userId) {
            try {
              const user = await transaction.user.findUnique({
                where: { id: originalData.userId },
                select: { name: true },
              });
              userName = user?.name || userName;
            } catch (e) {
              // Keep default
            }
          }

          return {
            index: error.index ?? idx,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: error.data,
            itemName,
            userName,
            quantity: originalData?.quantity,
          };
        }),
      );

      return {
        success: true,
        message: `${result.totalCreated} entregas de PPE criadas com sucesso. ${result.totalFailed} falharam.`,
        data: {
          success: enrichedSuccess,
          failed: enrichedFailed,
          totalProcessed: result.totalCreated + result.totalFailed,
          totalSuccess: result.totalCreated,
          totalFailed: result.totalFailed,
        },
      };
    });
  }

  async batchUpdate(
    data: PpeDeliveryBatchUpdateFormData,
    include?: PpeDeliveryInclude,
    userId?: string,
  ): Promise<PpeDeliveryBatchUpdateResponse<PpeDeliveryUpdateFormData>> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      // Ensure all items have required id and data fields
      const validatedItems = data.ppeDeliveries.map(item => ({
        id: item.id!,
        data: item.data!,
      }));
      const result = await this.repository.updateMany(validatedItems, { include });

      // Log successful updates
      for (const delivery of result.success) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_DELIVERY,
          entityId: delivery.id,
          action: CHANGE_ACTION.UPDATE,
          field: null,
          oldValue: null,
          newValue: delivery,
          reason: 'Entrega de PPE atualizada em lote',
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
          triggeredById: delivery.id,
          userId: userId || null,
          transaction: transaction,
        });
      }

      return {
        success: true,
        message: `${result.totalUpdated} entregas de PPE atualizadas com sucesso. ${result.totalFailed} falharam.`,
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
    data: PpeDeliveryBatchDeleteFormData,
    userId?: string,
  ): Promise<PpeDeliveryBatchDeleteResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const result = await this.repository.deleteMany(data.ppeDeliveryIds);

      // Log successful deletions
      for (const item of result.success) {
        if (item.deleted) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_DELIVERY,
            entityId: item.id,
            action: CHANGE_ACTION.DELETE,
            field: null,
            oldValue: null,
            newValue: null,
            reason: 'Entrega de PPE removida em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            triggeredById: item.id,
            userId: userId || null,
            transaction: transaction,
          });
        }
      }

      return {
        success: true,
        message: `${result.totalDeleted} entregas de PPE removidas com sucesso. ${result.totalFailed} falharam.`,
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
  async markAsDelivered(
    id: string,
    reviewedById: string,
    deliveryDate?: Date,
    userId?: string,
  ): Promise<PpeDeliveryUpdateResponse> {
    const transactionResult = await this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const oldDelivery = await this.repository.findById(id, {
        include: { item: true },
      });

      if (!oldDelivery) {
        throw new NotFoundException(
          'Entrega de PPE não encontrada. Verifique se o ID está correto.',
        );
      }

      if (oldDelivery.actualDeliveryDate) {
        throw new BadRequestException('Esta entrega já foi marcada como entregue.');
      }

      // Validate delivery date
      const actualDeliveryDate = deliveryDate || new Date();
      if (actualDeliveryDate > new Date()) {
        throw new BadRequestException('A data de entrega não pode ser no futuro.');
      }

      // Validate approved by user exists
      const reviewedByUser = await this.userRepository.findById(reviewedById);
      if (!reviewedByUser) {
        throw new NotFoundException('Usuário responsável pela aprovação não encontrado.');
      }

      // Check stock availability
      if (oldDelivery.item && oldDelivery.item.quantity < oldDelivery.quantity) {
        throw new BadRequestException(
          `Quantidade insuficiente em estoque. Disponível: ${oldDelivery.item.quantity}, Solicitado: ${oldDelivery.quantity}`,
        );
      }

      // Validate size compatibility
      const userWithSize = await this.userRepository.findById(oldDelivery.userId, {
        include: { ppeSize: true },
      });

      let sizeInfo: string | undefined;
      let ppeType: PPE_TYPE | undefined;

      if (oldDelivery.item?.ppeType && userWithSize?.ppeSize) {
        ppeType = oldDelivery.item.ppeType;

        // Map PPE type to user size
        switch (ppeType) {
          case PPE_TYPE.SHIRT:
            sizeInfo = userWithSize.ppeSize.shirts || undefined;
            break;
          case PPE_TYPE.PANTS:
            sizeInfo = userWithSize.ppeSize.pants || undefined;
            break;
          case PPE_TYPE.BOOTS:
            sizeInfo = userWithSize.ppeSize.boots || undefined;
            break;
          case PPE_TYPE.SLEEVES:
            sizeInfo = userWithSize.ppeSize.sleeves || undefined;
            break;
          case PPE_TYPE.MASK:
            sizeInfo = userWithSize.ppeSize.mask || undefined;
            break;
          case PPE_TYPE.GLOVES:
            sizeInfo = userWithSize.ppeSize.gloves || undefined;
            break;
          case PPE_TYPE.RAIN_BOOTS:
            sizeInfo = userWithSize.ppeSize.rainBoots || undefined;
            break;
        }

        // Note: Size validation removed - ppeSize field no longer in Item model
        // Size should be validated at creation time via additionalInfo
      }

      const updatedDelivery = await this.repository.updateWithTransaction(
        transaction,
        id,
        {
          reviewedBy: reviewedById,
          actualDeliveryDate,
          status: PPE_DELIVERY_STATUS.DELIVERED,
          statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.DELIVERED],
        },
        { include: { item: true, user: { include: { ppeSize: true } }, ppeSchedule: true } },
      );

      // Update stock with size information
      await this.updateStockForDelivery(updatedDelivery, transaction, userId, {
        size: sizeInfo,
        ppeType,
      });

      // Try to auto-create the next delivery if this is linked to a schedule
      let nextDelivery: PpeDelivery | null = null;
      try {
        nextDelivery = await this.autoCreateNextDelivery(updatedDelivery, transaction, userId);
        if (nextDelivery && process.env.NODE_ENV !== 'production') {
          console.log(
            `Auto-created next PPE delivery: ${nextDelivery.id} scheduled for ${nextDelivery.scheduledDate?.toISOString()}`,
          );
        }
      } catch (error) {
        // Log but don't fail the main operation
        if (process.env.NODE_ENV !== 'production') {
          console.error('Error in auto-creation during markAsDelivered:', error);
        }
      }

      // Track field changes for delivery completion
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: id,
        oldEntity: oldDelivery,
        newEntity: updatedDelivery,
        fieldsToTrack: ['status', 'reviewedBy', 'actualDeliveryDate'],
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: transaction,
      });

      // Emit ppe.delivered event
      try {
        if (updatedDelivery.item && updatedDelivery.user) {
          this.eventEmitter.emit(
            'ppe.delivered',
            new PpeDeliveredEvent(
              updatedDelivery,
              updatedDelivery.item as any,
              updatedDelivery.user as any,
              reviewedByUser as any,
            ),
          );
        }
      } catch (error) {
        console.error('Error emitting ppe.delivered event:', error);
      }

      // Return data needed for signature workflow (will be called after transaction commits)
      return {
        updatedDelivery,
        nextDelivery,
      };
    });

    return {
      success: true,
      message: transactionResult.nextDelivery
        ? 'Entrega de PPE marcada como entregue com sucesso. Próxima entrega criada automaticamente.'
        : 'Entrega de PPE marcada como entregue com sucesso.',
      data: transactionResult.updatedDelivery,
    };
  }

  async finishDeliveryWithAutoSchedule(
    id: string,
    reviewedById: string,
    deliveryDate?: Date,
    userId?: string,
  ): Promise<PpeDeliveryUpdateResponse> {
    const transactionResult = await this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const oldDelivery = await this.repository.findById(id, {
        include: { item: true, ppeSchedule: true },
      });

      if (!oldDelivery) {
        throw new NotFoundException(
          'Entrega de PPE não encontrada. Verifique se o ID está correto.',
        );
      }

      if (oldDelivery.actualDeliveryDate) {
        throw new BadRequestException('Esta entrega já foi marcada como entregue.');
      }

      if (!oldDelivery.ppeScheduleId) {
        throw new BadRequestException(
          'Esta entrega não está vinculada a um agendamento. Use o endpoint de marcar como entregue padrão.',
        );
      }

      // Validate delivery date
      const actualDeliveryDate = deliveryDate || new Date();
      if (actualDeliveryDate > new Date()) {
        throw new BadRequestException('A data de entrega não pode ser no futuro.');
      }

      // Validate approved by user exists
      const reviewedByUser = await this.userRepository.findById(reviewedById);
      if (!reviewedByUser) {
        throw new NotFoundException('Usuário responsável pela aprovação não encontrado.');
      }

      // Check stock availability
      if (oldDelivery.item && oldDelivery.item.quantity < oldDelivery.quantity) {
        throw new BadRequestException(
          `Quantidade insuficiente em estoque. Disponível: ${oldDelivery.item.quantity}, Solicitado: ${oldDelivery.quantity}`,
        );
      }

      // Validate size compatibility
      const userWithSize = await this.userRepository.findById(oldDelivery.userId, {
        include: { ppeSize: true },
      });

      let sizeInfo: string | undefined;
      let ppeType: PPE_TYPE | undefined;

      if (oldDelivery.item?.ppeType && userWithSize?.ppeSize) {
        ppeType = oldDelivery.item.ppeType;

        // Map PPE type to user size
        switch (ppeType) {
          case PPE_TYPE.SHIRT:
            sizeInfo = userWithSize.ppeSize.shirts || undefined;
            break;
          case PPE_TYPE.PANTS:
            sizeInfo = userWithSize.ppeSize.pants || undefined;
            break;
          case PPE_TYPE.BOOTS:
            sizeInfo = userWithSize.ppeSize.boots || undefined;
            break;
          case PPE_TYPE.SLEEVES:
            sizeInfo = userWithSize.ppeSize.sleeves || undefined;
            break;
          case PPE_TYPE.MASK:
            sizeInfo = userWithSize.ppeSize.mask || undefined;
            break;
          case PPE_TYPE.GLOVES:
            sizeInfo = userWithSize.ppeSize.gloves || undefined;
            break;
          case PPE_TYPE.RAIN_BOOTS:
            sizeInfo = userWithSize.ppeSize.rainBoots || undefined;
            break;
        }

        // Note: Size validation removed - ppeSize field no longer in Item model
        // Size should be validated at creation time via additionalInfo
      }

      const updatedDelivery = await this.repository.updateWithTransaction(
        transaction,
        id,
        {
          reviewedBy: reviewedById,
          actualDeliveryDate,
          status: PPE_DELIVERY_STATUS.DELIVERED,
          statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.DELIVERED],
        },
        { include: { item: true, user: { include: { ppeSize: true } }, ppeSchedule: true } },
      );

      // Update stock with size information
      await this.updateStockForDelivery(updatedDelivery, transaction, userId, {
        size: sizeInfo,
        ppeType,
      });

      // Auto-create the next delivery - this is the main difference from markAsDelivered
      let nextDelivery: PpeDelivery | null = null;
      try {
        nextDelivery = await this.autoCreateNextDelivery(updatedDelivery, transaction, userId);
        if (nextDelivery && process.env.NODE_ENV !== 'production') {
          console.log(
            `Auto-created next PPE delivery: ${nextDelivery.id} scheduled for ${nextDelivery.scheduledDate?.toISOString()}`,
          );
        } else if (!nextDelivery && process.env.NODE_ENV !== 'production') {
          console.warn(`No next delivery was created for completed delivery ${updatedDelivery.id}`);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Error in auto-creation during finishDeliveryWithAutoSchedule:', error);
        }
        // For this method, we want to be more strict about auto-creation errors
        throw new BadRequestException(
          `Entrega marcada como concluída, mas houve erro na criação automática da próxima: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: updatedDelivery.id,
        action: CHANGE_ACTION.UPDATE,
        field: null,
        oldValue: oldDelivery,
        newValue: updatedDelivery,
        reason: 'Entrega de PPE finalizada com agendamento automático da próxima',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: updatedDelivery.id,
        userId: userId || null,
        transaction: transaction,
      });

      return {
        updatedDelivery,
        nextDelivery,
      };
    });

    return {
      success: true,
      message: transactionResult.nextDelivery
        ? `Entrega de PPE finalizada com sucesso. Próxima entrega criada automaticamente para ${transactionResult.nextDelivery.scheduledDate?.toLocaleDateString('pt-BR')}.`
        : 'Entrega de PPE finalizada com sucesso. Não foi possível criar automaticamente a próxima entrega.',
      data: transactionResult.updatedDelivery,
    };
  }

  async createFromSchedule(
    data: PpeDeliveryByScheduleFormData,
    userId?: string,
  ): Promise<PpeDeliveryCreateResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      // Validate schedule exists and is active
      const schedule = await this.ppeDeliveryScheduleRepository.findById(data.ppeScheduleId);

      if (!schedule) {
        throw new NotFoundException('Agendamento de PPE não encontrado.');
      }

      if (!schedule.isActive) {
        throw new BadRequestException('O agendamento de PPE está inativo.');
      }

      // Validate approved by user
      const reviewedByUser = await this.userRepository.findById(data.reviewedBy);
      if (!reviewedByUser) {
        throw new NotFoundException('Usuário responsável pela aprovação não encontrado.');
      }

      // Validate the user and item from the data
      if (!data.userId) {
        throw new BadRequestException('Usuário não foi especificado para a entrega.');
      }

      if (!data.itemId) {
        throw new BadRequestException('Item de PPE não foi especificado para a entrega.');
      }

      if (!data.quantity || data.quantity <= 0) {
        throw new BadRequestException('Quantidade deve ser maior que zero.');
      }

      // Check if item exists and has enough stock
      const item = await transaction.item.findUnique({
        where: { id: data.itemId },
        select: { id: true, name: true, quantity: true, ppeType: true },
      });

      if (!item) {
        throw new NotFoundException('Item de PPE não encontrado.');
      }

      // Note: Stock validation is done when marking as DELIVERED, not at creation time
      // This allows creating deliveries even with low stock (for planning purposes)
      if (item.quantity < data.quantity) {
        console.warn(
          `Low stock warning for ${item.name}: Available ${item.quantity}, Requested ${data.quantity}. Proceeding with delivery creation.`,
        );
      }

      // Create delivery based on provided data
      const deliveryData: PpeDeliveryCreateFormData = {
        userId: data.userId,
        itemId: data.itemId,
        quantity: data.quantity,
        reviewedBy: data.reviewedBy,
        ppeScheduleId: data.ppeScheduleId,
        status: PPE_DELIVERY_STATUS.PENDING,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.PENDING],
        scheduledDate: new Date(),
      };

      // Use the standard create method to ensure size validation
      const result = await this.create(
        deliveryData,
        {
          item: true,
          user: { include: { position: true, sector: true } },
          reviewedByUser: true,
          ppeSchedule: true,
        },
        userId,
      );

      // Update the change log to reflect schedule-triggered creation
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: result.data?.id || '',
        action: CHANGE_ACTION.UPDATE,
        field: 'triggeredBy',
        oldValue: CHANGE_TRIGGERED_BY.USER_ACTION,
        newValue: CHANGE_TRIGGERED_BY.SCHEDULE,
        reason: 'Entrega de PPE criada a partir de agendamento',
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
        triggeredById: data.ppeScheduleId,
        userId: userId || null,
        transaction: transaction,
      });

      return {
        success: true,
        message: 'Entrega de PPE criada a partir do agendamento com sucesso.',
        data: result.data,
      };
    });
  }

  async findBySchedule(
    scheduleId: string,
    include?: PpeDeliveryInclude,
  ): Promise<PpeDeliveryGetManyResponse> {
    const result = await this.repository.findMany({
      where: { ppeScheduleId: scheduleId },
      include,
    });

    return {
      success: true,
      message: 'Entregas do agendamento listadas com sucesso.',
      data: result.data,
    };
  }

  async findPendingDeliveries(include?: PpeDeliveryInclude): Promise<PpeDeliveryGetManyResponse> {
    const result = await this.repository.findMany({
      where: { actualDeliveryDate: null },
      include,
    });

    return {
      success: true,
      message: 'Entregas pendentes listadas com sucesso.',
      data: result.data,
    };
  }

  async findByUserAndItem(
    userId: string,
    itemId: string,
    include?: PpeDeliveryInclude,
  ): Promise<PpeDeliveryGetManyResponse> {
    const result = await this.repository.findMany({
      where: {
        userId,
        itemId,
      },
      include,
    });

    return {
      success: true,
      message: 'Entregas do usuário para o item listadas com sucesso.',
      data: result.data,
    };
  }

  async findAvailablePpeForUser(
    userId: string,
    ppeType?: PPE_TYPE,
    include?: PpeDeliveryInclude,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Get user with size information
    const user = await this.userRepository.findById(userId, {
      include: {
        ppeSize: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (!user.ppeSize) {
      throw new BadRequestException('O usuário não possui informações de tamanho cadastradas');
    }

    // Build query to find compatible PPE items
    const whereConditions: any = {
      isActive: true,
      ppeType: {
        not: null,
      },
    };

    // If specific PPE type is requested
    if (ppeType) {
      whereConditions.ppeType = ppeType;
    }

    // Get all PPE items with their configurations
    const items = await this.itemRepository.findMany({
      where: whereConditions,
      include: {
        // No need to include ppeConfig as it's now directly on item
        brand: true,
        category: true,
        prices: true,
        measures: {
          where: { measureType: 'SIZE' },
        },
      },
    });

    // Filter items based on user's size
    const compatibleItems = items.data.filter(item => {
      if (!item.ppeType) return false;

      let userSize: string | null = null;

      switch (item.ppeType) {
        case PPE_TYPE.SHIRT:
          userSize = user.ppeSize!.shirts;
          break;
        case PPE_TYPE.PANTS:
          userSize = user.ppeSize!.pants;
          break;
        case PPE_TYPE.BOOTS:
          userSize = user.ppeSize!.boots;
          break;
        case PPE_TYPE.SLEEVES:
          userSize = user.ppeSize!.sleeves;
          break;
        case PPE_TYPE.MASK:
          userSize = user.ppeSize!.mask;
          break;
        case PPE_TYPE.GLOVES:
          userSize = user.ppeSize!.gloves;
          break;
        case PPE_TYPE.RAIN_BOOTS:
          userSize = user.ppeSize!.rainBoots;
          break;
      }

      // Check if user has size for this PPE type
      if (!userSize) return false;

      // Check if PPE size matches user size via measures
      // Extract size from item measures (looking for SIZE type measures)
      const sizeMatch = item.measures?.find(m => m.measureType === 'SIZE');
      // For PPE sizes: numeric sizes (boots/pants) use value, letter sizes (shirts) use unit
      const itemSize = sizeMatch?.unit || (sizeMatch?.value ? String(sizeMatch.value) : null);
      return !itemSize || itemSize === userSize;
    });

    // Check stock availability for each compatible item
    const itemsWithAvailability = await Promise.all(
      compatibleItems.map(async item => {
        // Get pending deliveries
        const pendingDeliveries = await this.prisma.ppeDelivery.aggregate({
          where: {
            itemId: item.id,
            actualDeliveryDate: null,
          },
          _sum: {
            quantity: true,
          },
        });

        // Get unreturned borrows
        const unreturnedBorrows = await this.prisma.borrow.aggregate({
          where: {
            itemId: item.id,
            returnedAt: null,
          },
          _sum: {
            quantity: true,
          },
        });

        const totalPending = pendingDeliveries._sum?.quantity ?? 0;
        const totalBorrowed = unreturnedBorrows._sum?.quantity ?? 0;
        const availableQuantity = item.quantity - totalPending - totalBorrowed;

        return {
          ...item,
          availableQuantity,
          totalPending,
          totalBorrowed,
        };
      }),
    );

    // Filter out items with no available stock
    const availableItems = itemsWithAvailability.filter(item => item.availableQuantity > 0);

    return {
      success: true,
      message: `${availableItems.length} itens de PPE compatíveis encontrados para o usuário`,
      data: availableItems as any,
    };
  }

  async findOverdueScheduledDeliveries(
    include?: PpeDeliveryInclude,
  ): Promise<PpeDeliveryGetManyResponse> {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const result = await this.repository.findMany({
      where: {
        ppeScheduleId: { not: null }, // Only scheduled deliveries
        actualDeliveryDate: null, // Not yet delivered
        scheduledDate: { lt: today }, // Past scheduled date
      },
      include,
      orderBy: { scheduledDate: 'asc' },
    });

    return {
      success: true,
      message: 'Entregas agendadas em atraso listadas com sucesso.',
      data: result.data,
      meta: result.meta,
    };
  }

  async findUpcomingScheduledDeliveries(
    days: number = 7,
    include?: PpeDeliveryInclude,
  ): Promise<PpeDeliveryGetManyResponse> {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    today.setHours(0, 0, 0, 0);
    futureDate.setHours(23, 59, 59, 999);

    const result = await this.repository.findMany({
      where: {
        ppeScheduleId: { not: null }, // Only scheduled deliveries
        actualDeliveryDate: null, // Not yet delivered
        scheduledDate: {
          gte: today,
          lte: futureDate,
        },
      },
      include,
      orderBy: { scheduledDate: 'asc' },
    });

    return {
      success: true,
      message: `Entregas agendadas para os próximos ${days} dias listadas com sucesso.`,
      data: result.data,
      meta: result.meta,
    };
  }

  async batchApprove(
    deliveryIds: string[],
    reviewedById: string,
    userId?: string,
  ): Promise<{
    success: number;
    failed: number;
    results: any[];
  }> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const results: any[] = [];
      let successCount = 0;
      let failedCount = 0;

      // Validate approved by user exists
      const reviewedByUser = await this.userRepository.findById(reviewedById);
      if (!reviewedByUser) {
        throw new BadRequestException('Usuário aprovador não encontrado.');
      }

      for (const deliveryId of deliveryIds) {
        try {
          // Find the delivery
          const delivery = await this.repository.findById(deliveryId);

          if (!delivery) {
            results.push({
              id: deliveryId,
              success: false,
              error: 'Entrega não encontrada',
            });
            failedCount++;
            continue;
          }

          // Check if already approved or delivered
          if (delivery.status !== PPE_DELIVERY_STATUS.PENDING) {
            results.push({
              id: deliveryId,
              success: false,
              error: `Entrega já está com status: ${delivery.status}`,
            });
            failedCount++;
            continue;
          }

          // Update delivery status to approved
          const updatedDelivery = await this.repository.update(deliveryId, {
            status: PPE_DELIVERY_STATUS.APPROVED,
            statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.APPROVED],
            reviewedBy: reviewedById,
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_DELIVERY,
            entityId: deliveryId,
            action: CHANGE_ACTION.UPDATE,
            field: 'batch_approval',
            oldValue: { status: delivery.status, reviewedBy: null },
            newValue: { status: PPE_DELIVERY_STATUS.APPROVED, reviewedBy: reviewedById },
            reason: 'Entrega aprovada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: deliveryId,
            userId: userId || null,
            transaction: transaction,
          });

          // Emit ppe.approved event
          try {
            const deliveryWithRelations = await this.repository.findById(deliveryId, {
              include: { item: true, user: true },
            });

            if (deliveryWithRelations && deliveryWithRelations.item && deliveryWithRelations.user) {
              this.eventEmitter.emit(
                'ppe.approved',
                new PpeApprovedEvent(
                  deliveryWithRelations,
                  deliveryWithRelations.item as any,
                  deliveryWithRelations.user as any,
                  reviewedByUser as any,
                ),
              );
            }
          } catch (error) {
            console.error('Error emitting ppe.approved event:', error);
          }

          results.push({
            id: deliveryId,
            success: true,
            data: updatedDelivery,
          });
          successCount++;
        } catch (error) {
          results.push({
            id: deliveryId,
            success: false,
            error: error.message || 'Erro desconhecido',
          });
          failedCount++;
        }
      }

      return {
        success: successCount,
        failed: failedCount,
        results,
      };
    });
  }

  async batchReject(
    deliveryIds: string[],
    reviewedById: string,
    reason?: string,
    userId?: string,
  ): Promise<{
    success: number;
    failed: number;
    results: any[];
  }> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const results: any[] = [];
      let successCount = 0;
      let failedCount = 0;

      // Validate reviewed by user exists
      const reviewedByUser = await this.userRepository.findById(reviewedById);
      if (!reviewedByUser) {
        throw new BadRequestException('Usuário revisor não encontrado.');
      }

      for (const deliveryId of deliveryIds) {
        try {
          // Find the delivery
          const delivery = await this.repository.findById(deliveryId);

          if (!delivery) {
            results.push({
              id: deliveryId,
              success: false,
              error: 'Entrega não encontrada',
            });
            failedCount++;
            continue;
          }

          // Check if already delivered or reproved
          if (
            delivery.status === PPE_DELIVERY_STATUS.DELIVERED ||
            delivery.status === PPE_DELIVERY_STATUS.REPROVED
          ) {
            results.push({
              id: deliveryId,
              success: false,
              error: `Entrega já está com status: ${delivery.status}`,
            });
            failedCount++;
            continue;
          }

          // Update delivery status to reproved
          const updatedDelivery = await this.repository.update(deliveryId, {
            status: PPE_DELIVERY_STATUS.REPROVED,
            statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.REPROVED],
            reviewedBy: reviewedById,
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_DELIVERY,
            entityId: deliveryId,
            action: CHANGE_ACTION.UPDATE,
            field: 'batch_rejection',
            oldValue: { status: delivery.status, reviewedBy: null },
            newValue: { status: PPE_DELIVERY_STATUS.REPROVED, reviewedBy: reviewedById, reason },
            reason: reason || 'Entrega reprovada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: deliveryId,
            userId: userId || null,
            transaction: transaction,
          });

          // Emit ppe.rejected event
          try {
            const deliveryWithRelations = await this.repository.findById(deliveryId, {
              include: { item: true, user: true },
            });

            if (deliveryWithRelations && deliveryWithRelations.item && deliveryWithRelations.user) {
              this.eventEmitter.emit(
                'ppe.rejected',
                new PpeRejectedEvent(
                  deliveryWithRelations,
                  deliveryWithRelations.item as any,
                  deliveryWithRelations.user as any,
                  reviewedByUser as any,
                  reason,
                ),
              );
            }
          } catch (error) {
            console.error('Error emitting ppe.rejected event:', error);
          }

          results.push({
            id: deliveryId,
            success: true,
            data: updatedDelivery,
          });
          successCount++;
        } catch (error) {
          results.push({
            id: deliveryId,
            success: false,
            error: error.message || 'Erro desconhecido',
          });
          failedCount++;
        }
      }

      return {
        success: successCount,
        failed: failedCount,
        results,
      };
    });
  }

  async batchMarkAsDelivered(
    deliveryIds: string[],
    reviewedById: string,
    deliveryDate?: Date,
    userId?: string,
  ): Promise<{
    success: number;
    failed: number;
    results: any[];
  }> {
    const transactionResult = await this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const results: any[] = [];
      let successCount = 0;
      let failedCount = 0;

      // Validate reviewed by user exists
      const reviewedByUser = await this.userRepository.findById(reviewedById);
      if (!reviewedByUser) {
        throw new BadRequestException('Usuário revisor não encontrado.');
      }

      // Use current date if not provided
      const actualDeliveryDate = deliveryDate || new Date();
      if (actualDeliveryDate > new Date()) {
        throw new BadRequestException('A data de entrega não pode ser no futuro.');
      }

      for (const deliveryId of deliveryIds) {
        try {
          // Find the delivery with item and user info
          const delivery = await this.repository.findById(deliveryId, {
            include: { item: true, user: { include: { ppeSize: true } } },
          });

          if (!delivery) {
            results.push({
              id: deliveryId,
              success: false,
              error: 'Entrega não encontrada',
            });
            failedCount++;
            continue;
          }

          // Check if already delivered
          if (delivery.actualDeliveryDate) {
            results.push({
              id: deliveryId,
              success: false,
              error: 'Esta entrega já foi marcada como entregue',
            });
            failedCount++;
            continue;
          }

          // Check if status is APPROVED
          if (delivery.status !== PPE_DELIVERY_STATUS.APPROVED) {
            results.push({
              id: deliveryId,
              success: false,
              error: `Entrega não está aprovada. Status atual: ${delivery.status}`,
            });
            failedCount++;
            continue;
          }

          // Check stock availability
          if (delivery.item && delivery.item.quantity < delivery.quantity) {
            results.push({
              id: deliveryId,
              success: false,
              error: `Quantidade insuficiente em estoque. Disponível: ${delivery.item.quantity}, Solicitado: ${delivery.quantity}`,
            });
            failedCount++;
            continue;
          }

          // Validate size compatibility
          let sizeInfo: string | undefined;
          let ppeType: PPE_TYPE | undefined;

          if (delivery.item?.ppeType && delivery.user?.ppeSize) {
            ppeType = delivery.item.ppeType;

            // Map PPE type to user size
            switch (ppeType) {
              case PPE_TYPE.SHIRT:
                sizeInfo = delivery.user.ppeSize.shirts || undefined;
                break;
              case PPE_TYPE.PANTS:
                sizeInfo = delivery.user.ppeSize.pants || undefined;
                break;
              case PPE_TYPE.BOOTS:
                sizeInfo = delivery.user.ppeSize.boots || undefined;
                break;
              case PPE_TYPE.SLEEVES:
                sizeInfo = delivery.user.ppeSize.sleeves || undefined;
                break;
              case PPE_TYPE.MASK:
                sizeInfo = delivery.user.ppeSize.mask || undefined;
                break;
              case PPE_TYPE.GLOVES:
                sizeInfo = delivery.user.ppeSize.gloves || undefined;
                break;
              case PPE_TYPE.RAIN_BOOTS:
                sizeInfo = delivery.user.ppeSize.rainBoots || undefined;
                break;
            }

            // Note: Size validation removed - ppeSize field no longer in Item model
            // Size should be validated at creation time via additionalInfo
          }

          // Update delivery status to delivered
          const updatedDelivery = await this.repository.updateWithTransaction(
            transaction,
            deliveryId,
            {
              reviewedBy: reviewedById,
              actualDeliveryDate,
              status: PPE_DELIVERY_STATUS.DELIVERED,
              statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.DELIVERED],
            },
            { include: { item: true, user: { include: { ppeSize: true } }, ppeSchedule: true } },
          );

          // Update stock with size information
          await this.updateStockForDelivery(updatedDelivery, transaction, userId, {
            size: sizeInfo,
            ppeType,
          });

          // Try to auto-create the next delivery if this is linked to a schedule
          try {
            const nextDelivery = await this.autoCreateNextDelivery(
              updatedDelivery,
              transaction,
              userId,
            );
            if (nextDelivery && process.env.NODE_ENV !== 'production') {
              console.log(
                `Auto-created next PPE delivery: ${nextDelivery.id} scheduled for ${nextDelivery.scheduledDate?.toISOString()}`,
              );
            }
          } catch (error) {
            // Log but don't fail the main operation
            if (process.env.NODE_ENV !== 'production') {
              console.error('Error in auto-creation during batch mark as delivered:', error);
            }
          }

          // Log the change - only status transition for cleaner display
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_DELIVERY,
            entityId: deliveryId,
            action: CHANGE_ACTION.UPDATE,
            field: 'batch_mark_delivered',
            oldValue: { status: delivery.status },
            newValue: { status: PPE_DELIVERY_STATUS.DELIVERED },
            reason: 'Entrega marcada como entregue em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: deliveryId,
            userId: userId || null,
            transaction: transaction,
          });

          // Emit ppe.delivered event
          try {
            if (updatedDelivery.item && updatedDelivery.user) {
              this.eventEmitter.emit(
                'ppe.delivered',
                new PpeDeliveredEvent(
                  updatedDelivery,
                  updatedDelivery.item as any,
                  updatedDelivery.user as any,
                  reviewedByUser as any,
                ),
              );
            }
          } catch (error) {
            console.error('Error emitting ppe.delivered event:', error);
          }

          // Store for batch signature processing (will be done after transaction commits)
          results.push({
            id: deliveryId,
            success: true,
            data: updatedDelivery,
            userId: updatedDelivery.userId,
          });
          successCount++;
        } catch (error) {
          results.push({
            id: deliveryId,
            success: false,
            error: error.message || 'Erro desconhecido',
          });
          failedCount++;
        }
      }

      return {
        success: successCount,
        failed: failedCount,
        results,
        reviewedByUser, // Include for batch event emission
      };
    });

    // Emit batch delivered event for signature processing (after transaction commits)
    const successfulDeliveryIds = transactionResult.results
      .filter((r: any) => r.success)
      .map((r: any) => r.id);

    if (successfulDeliveryIds.length > 0 && transactionResult.reviewedByUser) {
      try {
        this.eventEmitter.emit(
          'ppe.batch.delivered',
          new PpeBatchDeliveredEvent(
            successfulDeliveryIds,
            transactionResult.reviewedByUser as any,
          ),
        );
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[PPE] Batch delivered event emitted for ${successfulDeliveryIds.length} deliveries`);
        }
      } catch (error) {
        console.error('Error emitting ppe.batch.delivered event:', error);
      }
    }

    return {
      success: transactionResult.success,
      failed: transactionResult.failed,
      results: transactionResult.results,
    };
  }

  async getDeliveryStatistics(userId?: string): Promise<{
    success: boolean;
    message: string;
    data: {
      total: number;
      pending: number;
      approved: number;
      delivered: number;
      waitingSignature: number;
      completed: number;
      signatureRejected: number;
      reproved: number;
      cancelled: number;
      overdue: number;
      scheduled: number;
      onDemand: number;
    };
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const baseWhere = userId ? { userId } : {};

    const [
      total,
      pending,
      approved,
      delivered,
      waitingSignature,
      completed,
      signatureRejected,
      reproved,
      cancelled,
      overdue,
      scheduled,
      onDemand,
    ] = await Promise.all([
      this.prisma.ppeDelivery.count({ where: baseWhere }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.PENDING },
      }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.APPROVED },
      }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.DELIVERED },
      }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE },
      }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.COMPLETED },
      }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.SIGNATURE_REJECTED },
      }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.REPROVED },
      }),
      this.prisma.ppeDelivery.count({
        where: { ...baseWhere, status: PPE_DELIVERY_STATUS.CANCELLED },
      }),
      this.prisma.ppeDelivery.count({
        where: {
          ...baseWhere,
          actualDeliveryDate: null,
          scheduledDate: { lt: today },
        },
      }),
      this.prisma.ppeDelivery.count({ where: { ...baseWhere, ppeScheduleId: { not: null } } }),
      this.prisma.ppeDelivery.count({ where: { ...baseWhere, ppeScheduleId: null } }),
    ]);

    return {
      success: true,
      message: 'Estatísticas de entregas de PPE obtidas com sucesso.',
      data: {
        total,
        pending,
        approved,
        delivered,
        waitingSignature,
        completed,
        signatureRejected,
        reproved,
        cancelled,
        overdue,
        scheduled,
        onDemand,
      },
    };
  }

}
