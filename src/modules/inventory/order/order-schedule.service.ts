import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderScheduleRepository } from './repositories/order-schedule/order-schedule.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  OrderSchedule,
  OrderScheduleGetUniqueResponse,
  OrderScheduleGetManyResponse,
  OrderScheduleCreateResponse,
  OrderScheduleUpdateResponse,
  OrderScheduleDeleteResponse,
  OrderScheduleBatchCreateResponse,
  OrderScheduleBatchUpdateResponse,
  OrderScheduleBatchDeleteResponse,
} from '../../../types';
import {
  OrderScheduleGetManyFormData,
  OrderScheduleCreateFormData,
  OrderScheduleUpdateFormData,
  OrderScheduleInclude,
  OrderScheduleBatchCreateFormData,
  OrderScheduleBatchUpdateFormData,
  OrderScheduleBatchDeleteFormData,
} from '../../../schemas/order';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  CHANGE_ACTION,
  SCHEDULE_FREQUENCY,
} from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  extractEssentialFields,
  getEssentialFields,
} from '@modules/common/changelog/utils/changelog-helpers';

@Injectable()
export class OrderScheduleService {
  private readonly logger = new Logger(OrderScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderScheduleRepository: OrderScheduleRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Calculate the next run date based on schedule frequency and interval
   */
  private calculateNextRunDate(schedule: OrderSchedule, fromDate?: Date): Date | null {
    const baseDate = fromDate || new Date();
    let nextRun = new Date(baseDate);
    const interval = schedule.frequencyCount || 1;

    switch (schedule.frequency) {
      case SCHEDULE_FREQUENCY.ONCE:
        // For one-time schedules, don't auto-create
        return null;

      case SCHEDULE_FREQUENCY.DAILY:
        // Daily with interval (every X days)
        nextRun.setDate(nextRun.getDate() + interval);
        break;

      case SCHEDULE_FREQUENCY.WEEKLY:
        // Weekly with interval (every X weeks)
        nextRun.setDate(nextRun.getDate() + 7 * interval);
        if (schedule.dayOfWeek) {
          // Adjust to specific day of week
          const targetDay = this.getDayOfWeekNumber(schedule.dayOfWeek);
          const currentDay = nextRun.getDay();
          const daysToAdd = (targetDay - currentDay + 7) % 7;
          nextRun.setDate(nextRun.getDate() + daysToAdd);
        }
        break;

      case SCHEDULE_FREQUENCY.MONTHLY:
        // Monthly with interval (every X months)
        nextRun.setMonth(nextRun.getMonth() + interval);
        if (schedule.dayOfMonth) {
          nextRun.setDate(Math.min(schedule.dayOfMonth, this.getDaysInMonth(nextRun)));
        }
        break;

      case SCHEDULE_FREQUENCY.BIWEEKLY:
        // Biweekly with interval (every 2 × X weeks)
        nextRun.setDate(nextRun.getDate() + 14 * interval);
        if (schedule.dayOfWeek) {
          const targetDay = this.getDayOfWeekNumber(schedule.dayOfWeek);
          const currentDay = nextRun.getDay();
          const daysToAdd = (targetDay - currentDay + 7) % 7;
          nextRun.setDate(nextRun.getDate() + daysToAdd);
        }
        break;

      case SCHEDULE_FREQUENCY.BIMONTHLY:
        // Bimonthly with interval (every 2 × X months)
        nextRun.setMonth(nextRun.getMonth() + 2 * interval);
        if (schedule.dayOfMonth) {
          nextRun.setDate(Math.min(schedule.dayOfMonth, this.getDaysInMonth(nextRun)));
        }
        break;

      case SCHEDULE_FREQUENCY.QUARTERLY:
        // Quarterly with interval (every 3 × X months)
        nextRun.setMonth(nextRun.getMonth() + 3 * interval);
        if (schedule.dayOfMonth) {
          nextRun.setDate(Math.min(schedule.dayOfMonth, this.getDaysInMonth(nextRun)));
        }
        break;

      case SCHEDULE_FREQUENCY.TRIANNUAL:
        // Triannual with interval (every 4 × X months)
        nextRun.setMonth(nextRun.getMonth() + 4 * interval);
        if (schedule.dayOfMonth) {
          nextRun.setDate(Math.min(schedule.dayOfMonth, this.getDaysInMonth(nextRun)));
        }
        break;

      case SCHEDULE_FREQUENCY.QUADRIMESTRAL:
        // Quadrimestral with interval (every 4 × X months)
        nextRun.setMonth(nextRun.getMonth() + 4 * interval);
        if (schedule.dayOfMonth) {
          nextRun.setDate(Math.min(schedule.dayOfMonth, this.getDaysInMonth(nextRun)));
        }
        break;

      case SCHEDULE_FREQUENCY.SEMI_ANNUAL:
        // Semi-annual with interval (every 6 × X months)
        nextRun.setMonth(nextRun.getMonth() + 6 * interval);
        if (schedule.dayOfMonth) {
          nextRun.setDate(Math.min(schedule.dayOfMonth, this.getDaysInMonth(nextRun)));
        }
        break;

      case SCHEDULE_FREQUENCY.ANNUAL:
        // Annual with interval (every X years)
        nextRun.setFullYear(nextRun.getFullYear() + interval);
        if (schedule.month && schedule.dayOfMonth) {
          const targetMonth = this.getMonthNumber(schedule.month) - 1; // JS months are 0-based
          nextRun.setMonth(
            targetMonth,
            Math.min(
              schedule.dayOfMonth,
              this.getDaysInMonth(new Date(nextRun.getFullYear(), targetMonth)),
            ),
          );
        }
        break;

      case SCHEDULE_FREQUENCY.CUSTOM:
        // Custom frequency requires manual calculation
        return null;

      default:
        this.logger.warn(`Unknown schedule frequency: ${schedule.frequency}`);
        nextRun.setMonth(nextRun.getMonth() + 1); // Default to monthly
    }

    // Set time to 13:00 (1 PM)
    nextRun = this.setDefaultScheduleTime(nextRun);

    // Adjust for weekends - move to nearest weekday
    nextRun = this.adjustForWeekend(nextRun);

    return nextRun;
  }

  /**
   * Helper methods for date calculations
   */
  private getDayOfWeekNumber(dayOfWeek: string): number {
    const days = {
      SUNDAY: 0,
      MONDAY: 1,
      TUESDAY: 2,
      WEDNESDAY: 3,
      THURSDAY: 4,
      FRIDAY: 5,
      SATURDAY: 6,
    };
    return days[dayOfWeek] || 1; // Default to Monday
  }

  private getMonthNumber(month: string): number {
    const months = {
      JANUARY: 1,
      FEBRUARY: 2,
      MARCH: 3,
      APRIL: 4,
      MAY: 5,
      JUNE: 6,
      JULY: 7,
      AUGUST: 8,
      SEPTEMBER: 9,
      OCTOBER: 10,
      NOVEMBER: 11,
      DECEMBER: 12,
    };
    return months[month] || 1;
  }

  private getDaysInMonth(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  /**
   * Adjust date if it falls on a weekend to the nearest weekday
   * Saturday -> Friday, Sunday -> Monday
   * Preserves the time component
   */
  private adjustForWeekend(date: Date): Date {
    const adjustedDate = new Date(date);
    const dayOfWeek = adjustedDate.getDay();

    if (dayOfWeek === 0) {
      // Sunday -> move to Monday
      adjustedDate.setDate(adjustedDate.getDate() + 1);
    } else if (dayOfWeek === 6) {
      // Saturday -> move to Friday
      adjustedDate.setDate(adjustedDate.getDate() - 1);
    }

    return adjustedDate;
  }

  /**
   * Set time to 13:00:00 (1 PM) for schedule scheduling
   */
  private setDefaultScheduleTime(date: Date): Date {
    const newDate = new Date(date);
    newDate.setHours(13, 0, 0, 0);
    return newDate;
  }

  /**
   * Validate entity data
   */
  private async orderScheduleValidation(
    data: Partial<OrderScheduleCreateFormData | OrderScheduleUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate that items are specified for create operations
    if (!existingId && (!data.items || data.items.length === 0)) {
      throw new BadRequestException('O agendamento deve incluir pelo menos um item.');
    }

    // Validate items exist if provided and apply business rules
    if (data.items && data.items.length > 0) {
      const items = await transaction.item.findMany({
        where: { id: { in: data.items } },
        select: {
          id: true,
          name: true,
          quantity: true,
          reorderPoint: true,
          reorderQuantity: true,
          estimatedLeadTime: true,
          isActive: true,
          maxQuantity: true,
          supplier: {
            select: {
              id: true,
              fantasyName: true,
            },
          },
        },
      });

      if (items.length !== data.items.length) {
        const foundIds = items.map(item => item.id);
        const missingIds = data.items.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Itens não encontrados: ${missingIds.join(', ')}`);
      }

      // Validate business rules for items
      const inactiveItems = items.filter(item => !item.isActive);
      if (inactiveItems.length > 0) {
        const inactiveNames = inactiveItems.map(item => item.name);
        throw new BadRequestException(
          `Não é possível incluir itens inativos no agendamento: ${inactiveNames.join(', ')}`,
        );
      }

      // Validate items have necessary stock configuration
      const itemsWithoutStock = items.filter(item => item.quantity <= 0);

      if (itemsWithoutStock.length > 0) {
        const itemNames = itemsWithoutStock.map(item => item.name);
        this.logger.warn(
          `Items without stock: ${itemNames.join(', ')}. ` + `These items may need ordering soon.`,
        );
      }

      // Validate items have necessary stock configuration
      const itemsWithoutReorderPoint = items.filter(
        item => !item.reorderPoint && !item.maxQuantity,
      );

      if (itemsWithoutReorderPoint.length > 0) {
        const itemNames = itemsWithoutReorderPoint.map(item => item.name);
        this.logger.warn(
          `Items without reorder point or max quantity configuration: ${itemNames.join(', ')}. ` +
            `Automatic ordering may not work optimally.`,
        );
      }
    }

    // Additional business rule: validate schedule frequency configuration
    // Support both flat fields (dayOfWeek, dayOfMonth, month) and nested schedule objects
    if (
      (data.frequency === SCHEDULE_FREQUENCY.WEEKLY ||
        data.frequency === SCHEDULE_FREQUENCY.BIWEEKLY) &&
      !data.weeklySchedule &&
      !data.dayOfWeek
    ) {
      throw new BadRequestException(
        'Dia da semana é obrigatório para frequência semanal/quinzenal.',
      );
    }
    const monthlyFrequencies: string[] = [
      SCHEDULE_FREQUENCY.MONTHLY,
      SCHEDULE_FREQUENCY.BIMONTHLY,
      SCHEDULE_FREQUENCY.QUARTERLY,
      SCHEDULE_FREQUENCY.TRIANNUAL,
      SCHEDULE_FREQUENCY.QUADRIMESTRAL,
      SCHEDULE_FREQUENCY.SEMI_ANNUAL,
    ];
    if (monthlyFrequencies.includes(data.frequency) && !data.monthlySchedule && !data.dayOfMonth) {
      throw new BadRequestException('Dia do mês é obrigatório para frequência mensal ou similar.');
    }
    if (
      data.frequency === SCHEDULE_FREQUENCY.ANNUAL &&
      !data.yearlySchedule &&
      (!data.dayOfMonth || !data.month)
    ) {
      throw new BadRequestException('Dia do mês e mês são obrigatórios para frequência anual.');
    }
  }

  /**
   * Create a new order schedule
   */
  async create(
    data: OrderScheduleCreateFormData,
    include?: OrderScheduleInclude,
    userId?: string,
  ): Promise<OrderScheduleCreateResponse> {
    try {
      const orderSchedule = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate entity
        await this.orderScheduleValidation(data, undefined, tx);

        // Calculate next run date if not provided
        if (!data.nextRun) {
          const nextRun = this.calculateNextRunDate(data as unknown as OrderSchedule);
          if (nextRun) {
            data.nextRun = nextRun;
          }
        }

        // Create the order schedule
        const newOrderSchedule = await this.orderScheduleRepository.createWithTransaction(
          tx,
          data,
          { include },
        );

        // Log creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_SCHEDULE,
          entityId: newOrderSchedule.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(
            newOrderSchedule,
            getEssentialFields(ENTITY_TYPE.ORDER_SCHEDULE) as (keyof OrderSchedule)[],
          ),
          reason: 'Novo agendamento de pedido criado no sistema',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return newOrderSchedule;
      });

      return {
        success: true,
        message: 'Agendamento de pedido criado com sucesso.',
        data: orderSchedule,
      };
    } catch (error) {
      this.logger.error('Erro ao criar agendamento de pedido:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar agendamento de pedido. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing order schedule
   */
  async update(
    id: string,
    data: OrderScheduleUpdateFormData,
    include?: OrderScheduleInclude,
    userId?: string,
  ): Promise<OrderScheduleUpdateResponse> {
    try {
      const updatedOrderSchedule = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing order schedule
        const existingOrderSchedule = await this.orderScheduleRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingOrderSchedule) {
          throw new NotFoundException(
            'Agendamento de pedido não encontrado. Verifique se o ID está correto.',
          );
        }

        // Validate entity
        await this.orderScheduleValidation(data, id, tx);

        // Update the order schedule
        const updatedSchedule = await this.orderScheduleRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Log update
        const fieldsToTrack = [
          'frequency',
          'frequencyCount',
          'isActive',
          'nextRun',
          'lastRun',
          'items',
          'finishedAt',
        ];
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_SCHEDULE,
          entityId: id,
          oldEntity: existingOrderSchedule,
          newEntity: updatedSchedule,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedSchedule;
      });

      return {
        success: true,
        message: 'Agendamento de pedido atualizado com sucesso.',
        data: updatedOrderSchedule,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar agendamento de pedido:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar agendamento de pedido. Tente novamente.',
      );
    }
  }

  /**
   * Delete an order schedule
   */
  async delete(id: string, userId?: string): Promise<OrderScheduleDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const orderSchedule = await this.orderScheduleRepository.findByIdWithTransaction(tx, id);

        if (!orderSchedule) {
          throw new NotFoundException(
            'Agendamento de pedido não encontrado. Verifique se o ID está correto.',
          );
        }

        // Log deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_SCHEDULE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            orderSchedule,
            getEssentialFields(ENTITY_TYPE.ORDER_SCHEDULE) as (keyof OrderSchedule)[],
          ),
          reason: 'Agendamento de pedido excluído do sistema',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.orderScheduleRepository.deleteWithTransaction(tx, id);
      });

      return { success: true, message: 'Agendamento de pedido excluído com sucesso.' };
    } catch (error) {
      this.logger.error('Erro ao excluir agendamento de pedido:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir agendamento de pedido. Tente novamente.',
      );
    }
  }

  /**
   * Find an order schedule by ID
   */
  async findById(
    id: string,
    include?: OrderScheduleInclude,
  ): Promise<OrderScheduleGetUniqueResponse> {
    try {
      const orderSchedule = await this.orderScheduleRepository.findById(id, { include });
      if (!orderSchedule) {
        throw new NotFoundException(
          'Agendamento de pedido não encontrado. Verifique se o ID está correto.',
        );
      }

      return {
        success: true,
        message: 'Agendamento de pedido carregado com sucesso.',
        data: orderSchedule,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar agendamento de pedido por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar agendamento de pedido. Tente novamente.',
      );
    }
  }

  /**
   * Find many order schedules with filtering
   */
  async findMany(query: OrderScheduleGetManyFormData): Promise<OrderScheduleGetManyResponse> {
    try {
      const params = {
        where: query.where || {},
        page: query.page,
        take: query.limit,
        orderBy: query.orderBy || { createdAt: 'desc' },
        include: query.include,
      };

      const result = await this.orderScheduleRepository.findMany(params);

      return {
        success: true,
        message: 'Agendamentos de pedido carregados com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar agendamentos de pedido:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar agendamentos de pedido. Tente novamente.',
      );
    }
  }

  // =====================
  // BATCH OPERATIONS
  // =====================

  /**
   * Batch create order schedules
   */
  async batchCreate(
    data: OrderScheduleBatchCreateFormData,
    include?: OrderScheduleInclude,
    userId?: string,
  ): Promise<OrderScheduleBatchCreateResponse<OrderScheduleCreateFormData>> {
    try {
      const results = {
        success: [] as OrderSchedule[],
        failed: [] as {
          data: OrderScheduleCreateFormData;
          error: string;
          errorCode: string;
          index: number;
        }[],
        totalCreated: 0,
        totalFailed: 0,
      };

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Process each order schedule individually to capture specific errors
        for (const [index, scheduleData] of data.orderSchedules.entries()) {
          try {
            // Validate entity
            await this.orderScheduleValidation(scheduleData, undefined, tx);

            // Calculate next run date if not provided (mirrors single create behavior)
            if (!scheduleData.nextRun) {
              const nextRun = this.calculateNextRunDate(
                scheduleData as unknown as OrderSchedule,
              );
              if (nextRun) {
                scheduleData.nextRun = nextRun;
              }
            }

            // Create the order schedule
            const newOrderSchedule = await this.orderScheduleRepository.createWithTransaction(
              tx,
              scheduleData,
            );

            // Log creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ORDER_SCHEDULE,
              entityId: newOrderSchedule.id,
              action: CHANGE_ACTION.CREATE,
              entity: extractEssentialFields(
                newOrderSchedule,
                getEssentialFields(ENTITY_TYPE.ORDER_SCHEDULE) as (keyof OrderSchedule)[],
              ),
              reason: 'Agendamento de pedido criado em operação de lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            // If include is specified, fetch the order schedule with included relations
            const finalOrderSchedule = include
              ? await this.orderScheduleRepository.findByIdWithTransaction(
                  tx,
                  newOrderSchedule.id,
                  { include },
                )
              : newOrderSchedule;

            if (finalOrderSchedule) {
              results.success.push(finalOrderSchedule);
            } else {
              // This should not happen, but handle it gracefully
              results.success.push(newOrderSchedule);
            }
            results.totalCreated++;
          } catch (error) {
            results.failed.push({
              data: scheduleData,
              error:
                error instanceof Error
                  ? error.message
                  : 'Erro desconhecido ao criar agendamento de pedido',
              errorCode:
                error instanceof BadRequestException
                  ? 'VALIDATION_ERROR'
                  : error instanceof NotFoundException
                    ? 'NOT_FOUND'
                    : 'UNKNOWN_ERROR',
              index,
            });
            results.totalFailed++;
          }
        }
      });

      const successMessage =
        results.totalCreated === 1
          ? '1 agendamento de pedido criado com sucesso'
          : `${results.totalCreated} agendamentos de pedido criados com sucesso`;
      const failureMessage = results.totalFailed > 0 ? `, ${results.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format
      const batchOperationResult = {
        success: results.success,
        failed: results.failed.map(error => ({
          index: error.index,
          id: undefined,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: results.totalCreated + results.totalFailed,
        totalSuccess: results.totalCreated,
        totalFailed: results.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote de agendamentos de pedido:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na criação em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch update order schedules
   */
  async batchUpdate(
    data: OrderScheduleBatchUpdateFormData,
    include?: OrderScheduleInclude,
    userId?: string,
  ): Promise<OrderScheduleBatchUpdateResponse<OrderScheduleUpdateFormData>> {
    try {
      const results = {
        success: [] as OrderSchedule[],
        failed: [] as {
          data: OrderScheduleUpdateFormData & { id: string };
          error: string;
          errorCode: string;
          index: number;
          id: string;
        }[],
        totalUpdated: 0,
        totalFailed: 0,
      };

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Process each update individually to capture specific errors
        for (const [index, updateData] of data.orderSchedules.entries()) {
          try {
            // Get existing order schedule
            const existingOrderSchedule =
              await this.orderScheduleRepository.findByIdWithTransaction(tx, updateData.id);

            if (!existingOrderSchedule) {
              results.failed.push({
                data: { ...updateData.data, id: updateData.id },
                error: 'Agendamento de pedido não encontrado. Verifique se o ID está correto.',
                errorCode: 'NOT_FOUND',
                index,
                id: updateData.id,
              });
              results.totalFailed++;
              continue;
            }

            // Validate entity
            await this.orderScheduleValidation(updateData.data, updateData.id, tx);

            // Update the order schedule
            const updatedOrderSchedule = await this.orderScheduleRepository.updateWithTransaction(
              tx,
              updateData.id,
              updateData.data,
            );

            // Log changes
            const fieldsToTrack = [
              'frequency',
              'frequencyCount',
              'isActive',
              'nextRun',
              'lastRun',
              'items',
            ];
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ORDER_SCHEDULE,
              entityId: updateData.id,
              oldEntity: existingOrderSchedule,
              newEntity: updatedOrderSchedule,
              fieldsToTrack,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // If include is specified, fetch the order schedule with included relations
            const finalOrderSchedule = include
              ? await this.orderScheduleRepository.findByIdWithTransaction(tx, updateData.id, {
                  include,
                })
              : updatedOrderSchedule;

            if (finalOrderSchedule) {
              results.success.push(finalOrderSchedule);
            } else {
              // This should not happen, but handle it gracefully
              results.success.push(updatedOrderSchedule);
            }
            results.totalUpdated++;
          } catch (error) {
            results.failed.push({
              data: { ...updateData.data, id: updateData.id },
              error:
                error instanceof Error
                  ? error.message
                  : 'Erro desconhecido ao atualizar agendamento de pedido',
              errorCode:
                error instanceof BadRequestException
                  ? 'VALIDATION_ERROR'
                  : error instanceof NotFoundException
                    ? 'NOT_FOUND'
                    : 'UNKNOWN_ERROR',
              index,
              id: updateData.id,
            });
            results.totalFailed++;
          }
        }
      });

      const successMessage =
        results.totalUpdated === 1
          ? '1 agendamento de pedido atualizado com sucesso'
          : `${results.totalUpdated} agendamentos de pedido atualizados com sucesso`;
      const failureMessage = results.totalFailed > 0 ? `, ${results.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format
      const batchOperationResult = {
        success: results.success,
        failed: results.failed.map(error => ({
          index: error.index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: results.totalUpdated + results.totalFailed,
        totalSuccess: results.totalUpdated,
        totalFailed: results.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote de agendamentos de pedido:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na atualização em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete order schedules
   */
  async batchDelete(
    data: OrderScheduleBatchDeleteFormData,
    userId?: string,
  ): Promise<OrderScheduleBatchDeleteResponse> {
    try {
      const results = {
        success: [] as { id: string; deleted: boolean }[],
        failed: [] as {
          id: string;
          error: string;
          errorCode: string;
          index: number;
          data: { id: string };
        }[],
        totalDeleted: 0,
        totalFailed: 0,
      };

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Process each deletion individually to capture specific errors
        for (const [index, orderScheduleId] of data.orderScheduleIds.entries()) {
          try {
            // Get order schedule before deletion for logging
            const orderSchedule = await this.orderScheduleRepository.findByIdWithTransaction(
              tx,
              orderScheduleId,
            );

            if (!orderSchedule) {
              results.failed.push({
                id: orderScheduleId,
                error: 'Agendamento de pedido não encontrado. Verifique se o ID está correto.',
                errorCode: 'NOT_FOUND',
                index,
                data: { id: orderScheduleId },
              });
              results.totalFailed++;
              continue;
            }

            // Log deletion
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ORDER_SCHEDULE,
              entityId: orderScheduleId,
              action: CHANGE_ACTION.DELETE,
              oldEntity: extractEssentialFields(
                orderSchedule,
                getEssentialFields(ENTITY_TYPE.ORDER_SCHEDULE) as (keyof OrderSchedule)[],
              ),
              reason: 'Agendamento de pedido excluído em operação de lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              transaction: tx,
            });

            // Delete the order schedule
            await this.orderScheduleRepository.deleteWithTransaction(tx, orderScheduleId);
            results.success.push({ id: orderScheduleId, deleted: true });
            results.totalDeleted++;
          } catch (error) {
            results.failed.push({
              id: orderScheduleId,
              error:
                error instanceof Error
                  ? error.message
                  : 'Erro desconhecido ao excluir agendamento de pedido',
              errorCode: error instanceof NotFoundException ? 'NOT_FOUND' : 'UNKNOWN_ERROR',
              index,
              data: { id: orderScheduleId },
            });
            results.totalFailed++;
          }
        }
      });

      const successMessage =
        results.totalDeleted === 1
          ? '1 agendamento de pedido excluído com sucesso'
          : `${results.totalDeleted} agendamentos de pedido excluídos com sucesso`;
      const failureMessage = results.totalFailed > 0 ? `, ${results.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format
      const batchOperationResult = {
        success: results.success,
        failed: results.failed,
        totalProcessed: results.totalDeleted + results.totalFailed,
        totalSuccess: results.totalDeleted,
        totalFailed: results.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote de agendamentos de pedido:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  /**
   * Calculate order quantities from schedule template based on current stock levels and business rules
   */
  async calculateOrderQuantitiesFromSchedule(
    scheduleId: string,
    tx?: PrismaTransaction,
  ): Promise<{ itemId: string; quantity: number; reason: string }[]> {
    const transaction = tx || this.prisma;

    try {
      // Get the schedule with its items configuration
      const schedule = await transaction.orderSchedule.findUnique({
        where: { id: scheduleId },
        include: {
          weeklyConfig: true,
          monthlyConfig: true,
          yearlyConfig: true,
        },
      });

      if (!schedule) {
        throw new NotFoundException(`Agendamento de pedido ${scheduleId} não encontrado`);
      }

      if (!schedule.items || schedule.items.length === 0) {
        this.logger.warn(`Schedule ${scheduleId} has no items configured`);
        return [];
      }

      // Get current stock information for all items in the schedule
      const items = await transaction.item.findMany({
        where: {
          id: { in: schedule.items },
          isActive: true,
        },
        include: {
          prices: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (items.length === 0) {
        this.logger.warn(`No active items found for schedule ${scheduleId}`);
        return [];
      }

      // Check for active orders to avoid duplicate ordering
      const activeOrderItems = await transaction.orderItem.findMany({
        where: {
          itemId: { in: items.map(item => item.id) },
          order: {
            status: {
              in: ['CREATED', 'PARTIALLY_FULFILLED', 'FULFILLED'],
            },
          },
        },
        select: {
          itemId: true,
          orderedQuantity: true,
        },
      });

      const itemsWithActiveOrders = new Map<string, number>();
      activeOrderItems.forEach(orderItem => {
        const currentQuantity = itemsWithActiveOrders.get(orderItem.itemId) || 0;
        itemsWithActiveOrders.set(orderItem.itemId, currentQuantity + orderItem.orderedQuantity);
      });

      const calculatedQuantities: { itemId: string; quantity: number; reason: string }[] = [];

      // Calculate quantities for each item based on business rules
      for (const item of items) {
        const currentStock = item.quantity || 0;
        const reorderPoint = item.reorderPoint || 0;
        const maxQuantity = item.maxQuantity || null;
        const reorderQuantity = item.reorderQuantity || null;
        const pendingQuantity = itemsWithActiveOrders.get(item.id) || 0;

        // Calculate effective available stock (current stock + pending orders)
        const effectiveStock = currentStock + pendingQuantity;

        let quantityToOrder = 0;
        let reason = '';

        // Determine if we need to order based on different scenarios
        if (effectiveStock <= 0) {
          // Critical stock - order immediately
          if (reorderQuantity && reorderQuantity > 0) {
            quantityToOrder = reorderQuantity;
            reason = `Estoque crítico (${currentStock}). Pedindo quantidade de reposição padrão.`;
          } else if (maxQuantity && maxQuantity > 0) {
            quantityToOrder = maxQuantity;
            reason = `Estoque crítico (${currentStock}). Pedindo quantidade máxima.`;
          } else {
            // Default to a reasonable quantity if no limits are set
            quantityToOrder = Math.max(30, Math.ceil(item.monthlyConsumption?.toNumber() || 10));
            reason = `Estoque crítico (${currentStock}). Pedindo quantidade baseada no consumo mensal.`;
          }
        } else if (reorderPoint > 0 && effectiveStock <= reorderPoint) {
          // Below reorder point - calculate how much to order
          if (reorderQuantity && reorderQuantity > 0) {
            quantityToOrder = reorderQuantity;
            reason = `Abaixo do ponto de reposição (${effectiveStock}/${reorderPoint}). Pedindo quantidade de reposição padrão.`;
          } else if (maxQuantity && maxQuantity > 0) {
            // Order enough to reach max quantity
            quantityToOrder = Math.max(0, maxQuantity - effectiveStock);
            reason = `Abaixo do ponto de reposição (${effectiveStock}/${reorderPoint}). Pedindo para atingir estoque máximo.`;
          } else {
            // Calculate based on consumption if available
            const monthlyConsumption = item.monthlyConsumption?.toNumber() || 0;
            if (monthlyConsumption > 0) {
              // Order 2 months worth of consumption or minimum 10 units
              quantityToOrder = Math.max(10, Math.ceil(monthlyConsumption * 2));
              reason = `Abaixo do ponto de reposição (${effectiveStock}/${reorderPoint}). Pedindo baseado no consumo mensal (2 meses).`;
            } else {
              // Default quantity if no consumption data
              quantityToOrder = Math.max(20, reorderPoint * 2);
              reason = `Abaixo do ponto de reposição (${effectiveStock}/${reorderPoint}). Pedindo quantidade padrão.`;
            }
          }
        } else if (maxQuantity && maxQuantity > 0 && effectiveStock < maxQuantity * 0.7) {
          // Stock is below 70% of max capacity - consider ordering
          const monthlyConsumption = item.monthlyConsumption?.toNumber() || 0;
          if (monthlyConsumption > 0 && effectiveStock < monthlyConsumption * 1.5) {
            // Only order if we have less than 1.5 months of stock
            quantityToOrder = Math.ceil(maxQuantity - effectiveStock);
            reason = `Estoque baixo (${effectiveStock}/${maxQuantity}). Reabastecimento preventivo.`;
          }
        }

        // Apply business rules and constraints
        if (quantityToOrder > 0) {
          // Ensure we don't exceed max quantity if set
          if (maxQuantity && maxQuantity > 0) {
            const totalAfterOrder = effectiveStock + quantityToOrder;
            if (totalAfterOrder > maxQuantity) {
              quantityToOrder = Math.max(0, maxQuantity - effectiveStock);
              if (quantityToOrder > 0) {
                reason += ` Ajustado para não exceder estoque máximo.`;
              } else {
                reason = `Pedido cancelado: estoque efetivo (${effectiveStock}) já está no limite máximo.`;
              }
            }
          }

          // Apply minimum order constraints
          const minOrderQuantity = 1; // Could be configurable per item
          if (quantityToOrder > 0 && quantityToOrder < minOrderQuantity) {
            quantityToOrder = minOrderQuantity;
            reason += ` Ajustado para quantidade mínima de pedido.`;
          }

          // Only add if quantity is still positive after all adjustments
          if (quantityToOrder > 0) {
            calculatedQuantities.push({
              itemId: item.id,
              quantity: quantityToOrder,
              reason: reason,
            });

            this.logger.debug(
              `Item ${item.name}: ordenando ${quantityToOrder} unidades. ${reason}`,
            );
          }
        }
      }

      this.logger.log(
        `Calculated quantities for ${calculatedQuantities.length} items from schedule ${scheduleId}`,
      );
      return calculatedQuantities;
    } catch (error) {
      this.logger.error(`Error calculating order quantities from schedule ${scheduleId}:`, error);
      throw error;
    }
  }

  /**
   * Create an order from schedule with calculated quantities
   */
  async createOrderFromSchedule(
    scheduleId: string,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<any> {
    const transaction = tx || this.prisma;

    try {
      // Get the schedule
      const schedule = await transaction.orderSchedule.findUnique({
        where: { id: scheduleId },
        include: {
          weeklyConfig: true,
          monthlyConfig: true,
          yearlyConfig: true,
        },
      });

      if (!schedule) {
        throw new NotFoundException(`Agendamento de pedido ${scheduleId} não encontrado`);
      }

      if (!schedule.isActive) {
        throw new BadRequestException(`Agendamento de pedido ${scheduleId} está inativo`);
      }

      // Calculate quantities needed
      const calculatedItems = await this.calculateOrderQuantitiesFromSchedule(
        scheduleId,
        transaction,
      );

      if (calculatedItems.length === 0) {
        this.logger.log(`No items need to be ordered for schedule ${scheduleId}`);
        return null;
      }

      // Get current prices for the items
      const items = await transaction.item.findMany({
        where: { id: { in: calculatedItems.map(ci => ci.itemId) } },
        include: {
          prices: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      const itemsMap = new Map(items.map(item => [item.id, item]));

      // Prepare order items with current prices
      const orderItems = calculatedItems.map(calc => {
        const item = itemsMap.get(calc.itemId);
        if (!item) {
          throw new NotFoundException(`Item ${calc.itemId} não encontrado`);
        }

        const currentPrice = item.prices?.[0]?.value || 0;

        return {
          itemId: calc.itemId,
          orderedQuantity: calc.quantity,
          price: currentPrice,
          icms: item.icms || 0,
          ipi: item.ipi || 0,
        };
      });

      // Calculate next run date for the schedule
      const nextRunDate = this.calculateNextRunDate(schedule as OrderSchedule);

      // Create order description
      const itemCount = orderItems.length;
      const description = `Pedido automático - ${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`;

      // Prepare order data
      const orderData = {
        // Auto-order doesn't set a specific supplier
        description,
        forecast: nextRunDate || new Date(),
        status: 'CREATED',
        orderScheduleId: scheduleId,
        items: orderItems,
      };

      this.logger.log(`Creating order from schedule ${scheduleId} with ${orderItems.length} items`);
      return orderData;
    } catch (error) {
      this.logger.error(`Error creating order from schedule ${scheduleId}:`, error);
      throw error;
    }
  }

  /**
   * Handle auto-creation when a schedule is finished
   */
  private async handleScheduleFinishAutoCreation(
    finishedSchedule: any,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      this.logger.log(`Processing schedule finish auto-creation for ${finishedSchedule.id}`);

      // Check if this schedule is active and can generate next instances
      if (!finishedSchedule.isActive) {
        this.logger.log(`Schedule ${finishedSchedule.id} is inactive, skipping auto-creation`);
        return;
      }

      // Calculate the next run date
      const nextRunDate = this.calculateNextRunDate(finishedSchedule, finishedSchedule.finishedAt);

      if (!nextRunDate) {
        this.logger.log(
          `No next run date calculated for schedule ${finishedSchedule.id} - skipping auto-creation`,
        );
        return;
      }

      // Create the next schedule instance
      const newScheduleData: any = {
        frequency: finishedSchedule.frequency,
        frequencyCount: finishedSchedule.frequencyCount,
        isActive: true,
        items: finishedSchedule.items,

        // Schedule configuration
        specificDate: finishedSchedule.specificDate,
        dayOfMonth: finishedSchedule.dayOfMonth,
        dayOfWeek: finishedSchedule.dayOfWeek,
        month: finishedSchedule.month,
        customMonths: finishedSchedule.customMonths,

        // Reschedule fields (reset for new instance)
        rescheduleCount: 0,
        originalDate: null,
        lastRescheduleDate: null,
        rescheduleReason: null,

        // Schedule configuration relations
        weeklyConfigId: finishedSchedule.weeklyConfigId,
        monthlyConfigId: finishedSchedule.monthlyConfigId,
        yearlyConfigId: finishedSchedule.yearlyConfigId,

        // Auto-creation tracking
        lastRunId: finishedSchedule.id,
        originalScheduleId: finishedSchedule.originalScheduleId || finishedSchedule.id,

        // Schedule dates
        nextRun: nextRunDate,
        lastRun: null,
        finishedAt: null,
      };

      // Create the new schedule instance
      if (!tx) {
        throw new Error('Transaction is required for creating order schedule');
      }
      const newSchedule = await this.orderScheduleRepository.createWithTransaction(
        tx,
        newScheduleData,
      );

      // Log the auto-creation
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.ORDER_SCHEDULE,
        entityId: newSchedule.id,
        action: CHANGE_ACTION.CREATE,
        entity: extractEssentialFields(
          newSchedule,
          getEssentialFields(ENTITY_TYPE.ORDER_SCHEDULE) as (keyof OrderSchedule)[],
        ),
        reason: `Agendamento criado automaticamente após finalização do agendamento ${finishedSchedule.id}`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
        transaction: tx,
      });

      this.logger.log(
        `Successfully created new schedule ${newSchedule.id} for next run on ${nextRunDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(`Failed to auto-create next schedule for ${finishedSchedule.id}:`, error);
      // Don't throw error to not prevent schedule finish
    }
  }

  /**
   * Public method to calculate quantities for a schedule (for preview/testing)
   */
  async getCalculatedQuantities(
    scheduleId: string,
  ): Promise<{ itemId: string; quantity: number; reason: string; itemName: string }[]> {
    try {
      const calculated = await this.calculateOrderQuantitiesFromSchedule(scheduleId);

      // Get item names for better response
      const items = await this.prisma.item.findMany({
        where: { id: { in: calculated.map(c => c.itemId) } },
        select: { id: true, name: true },
      });

      const itemNamesMap = new Map(items.map(item => [item.id, item.name]));

      return calculated.map(calc => ({
        ...calc,
        itemName: itemNamesMap.get(calc.itemId) || 'Item não encontrado',
      }));
    } catch (error) {
      this.logger.error(`Error getting calculated quantities for schedule ${scheduleId}:`, error);
      throw error;
    }
  }

  /**
   * Handle order completion - update schedule and prepare for next cycle
   * Mirrors maintenance's handleMaintenanceCompletion pattern:
   * - Fetches schedule fresh from DB (not a stale object)
   * - Calculates next run from completion date (schedule "slides")
   * - Updates schedule's nextRun, lastRun, lastRunId and date config fields
   */
  async handleOrderCompletion(
    scheduleId: string,
    newOrderId: string,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      const transaction = tx || this.prisma;

      // 1. Fetch schedule fresh from DB (like maintenance pattern)
      const schedule = await transaction.orderSchedule.findUnique({
        where: { id: scheduleId },
      });

      if (!schedule) {
        this.logger.warn(`Schedule ${scheduleId} not found during order completion handling`);
        return;
      }

      if (!schedule.isActive) {
        this.logger.log(`Schedule ${scheduleId} is inactive, skipping chain continuation`);
        return;
      }

      // 2. Calculate next run from completion date (schedule slides based on actual completion)
      const baseDate = new Date();
      const nextRunDate = this.calculateNextRunDate(schedule as OrderSchedule, baseDate);

      if (!nextRunDate) {
        this.logger.log(
          `No next run date for schedule ${scheduleId} (frequency: ${schedule.frequency}) - chain ends`,
        );
        return;
      }

      // 3. Build schedule update with date config sliding (like maintenance)
      const scheduleUpdateData: Record<string, any> = {
        nextRun: nextRunDate,
        lastRun: new Date(),
        lastRunId: newOrderId,
      };

      // Slide date config fields to match actual completion date
      if (
        schedule.frequency === SCHEDULE_FREQUENCY.WEEKLY ||
        schedule.frequency === SCHEDULE_FREQUENCY.BIWEEKLY
      ) {
        const completionDay = baseDate.getDay();
        const dayNames = [
          'SUNDAY',
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
        ];
        scheduleUpdateData.dayOfWeek = dayNames[completionDay];
      } else if (
        [
          SCHEDULE_FREQUENCY.MONTHLY,
          SCHEDULE_FREQUENCY.BIMONTHLY,
          SCHEDULE_FREQUENCY.QUARTERLY,
          SCHEDULE_FREQUENCY.TRIANNUAL,
          SCHEDULE_FREQUENCY.QUADRIMESTRAL,
          SCHEDULE_FREQUENCY.SEMI_ANNUAL,
        ].includes(schedule.frequency as SCHEDULE_FREQUENCY)
      ) {
        scheduleUpdateData.dayOfMonth = baseDate.getDate();
      } else if (schedule.frequency === SCHEDULE_FREQUENCY.ANNUAL) {
        const monthNames = [
          'JANUARY',
          'FEBRUARY',
          'MARCH',
          'APRIL',
          'MAY',
          'JUNE',
          'JULY',
          'AUGUST',
          'SEPTEMBER',
          'OCTOBER',
          'NOVEMBER',
          'DECEMBER',
        ];
        scheduleUpdateData.month = monthNames[baseDate.getMonth()];
        scheduleUpdateData.dayOfMonth = baseDate.getDate();
      }

      // 4. Persist schedule update
      await transaction.orderSchedule.update({
        where: { id: scheduleId },
        data: scheduleUpdateData,
      });

      // 5. Log the schedule chain update
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ORDER_SCHEDULE,
        entityId: scheduleId,
        action: CHANGE_ACTION.UPDATE,
        field: 'schedule_chain',
        oldValue: schedule.nextRun?.toISOString() || null,
        newValue: nextRunDate.toISOString(),
        reason: `Agendamento atualizado após recebimento do pedido. Próxima execução: ${nextRunDate.toLocaleDateString('pt-BR')}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: newOrderId,
        userId: userId || null,
        transaction: tx,
      });

      this.logger.log(
        `Schedule ${scheduleId} updated: nextRun=${nextRunDate.toISOString()}, lastRunId=${newOrderId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle order completion for schedule ${scheduleId}:`,
        error,
      );
      // Don't throw to prevent breaking the main order status update transaction
    }
  }

  /**
   * Finish a schedule and auto-create the next instance
   */
  async finishSchedule(id: string, userId?: string): Promise<OrderScheduleUpdateResponse> {
    try {
      const updatedSchedule = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing schedule
        const existingSchedule = await this.orderScheduleRepository.findByIdWithTransaction(tx, id);

        if (!existingSchedule) {
          throw new NotFoundException(
            'Agendamento de pedido não encontrado. Verifique se o ID está correto.',
          );
        }

        if (existingSchedule.finishedAt) {
          throw new BadRequestException('Este agendamento já foi finalizado.');
        }

        // Mark the schedule as finished
        const updateData = {
          finishedAt: new Date(),
          isActive: false, // Deactivate the finished schedule
        };

        const updatedSchedule = await this.orderScheduleRepository.updateWithTransaction(
          tx,
          id,
          updateData,
        );

        // Log the finish action
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ORDER_SCHEDULE,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          entity: extractEssentialFields(
            updatedSchedule,
            getEssentialFields(ENTITY_TYPE.ORDER_SCHEDULE) as (keyof OrderSchedule)[],
          ),
          oldEntity: extractEssentialFields(
            existingSchedule,
            getEssentialFields(ENTITY_TYPE.ORDER_SCHEDULE) as (keyof OrderSchedule)[],
          ),
          reason: 'Agendamento finalizado',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Handle auto-creation of next schedule instance
        // Pass existingSchedule (still has isActive=true) instead of updatedSchedule (already deactivated)
        await this.handleScheduleFinishAutoCreation(existingSchedule, userId, tx);

        return updatedSchedule;
      });

      return {
        success: true,
        message: 'Agendamento de pedido finalizado com sucesso.',
        data: updatedSchedule,
      };
    } catch (error) {
      this.logger.error('Erro ao finalizar agendamento de pedido:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao finalizar agendamento de pedido. Tente novamente.',
      );
    }
  }
}
