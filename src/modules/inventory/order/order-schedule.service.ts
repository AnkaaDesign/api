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
  ITEM_CATEGORY_TYPE,
  SCHEDULE_FREQUENCY,
} from '../../../constants/enums';
import { DEFAULT_LEAD_TIME_DAYS } from '../../../constants/inventory-config';
import { calculateReorderQuantity } from '../../../utils/stock-health';
import { resolveSeasonalFactor } from '../../../utils/seasonality';
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
    const nextRun = new Date(baseDate);
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

      // Cycle window: number of days until the next scheduled run. Default 30
      // when the schedule lacks a computable next run.
      const nextRun = this.calculateNextRunDate(schedule as OrderSchedule);
      const now = new Date();
      const cycleDays = nextRun
        ? Math.max(1, Math.ceil((nextRun.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 30;

      // Load schedule items with category type (needed for TOOL skip) and the
      // active OrderRule for each item against the schedule supplier.
      const items = await transaction.item.findMany({
        where: {
          id: { in: schedule.items },
          isActive: true,
        },
        include: {
          prices: { orderBy: { createdAt: 'desc' }, take: 1 },
          category: { select: { type: true } },
          orderRules: {
            where: { isActive: true },
            select: {
              supplierId: true,
              minOrderQuantity: true,
              maxOrderQuantity: true,
              orderMultiple: true,
            },
          },
        },
      });

      if (items.length === 0) {
        this.logger.warn(`No active items found for schedule ${scheduleId}`);
        return [];
      }

      // Pending receipts (CREATED / PARTIALLY_FULFILLED / FULFILLED / PARTIALLY_RECEIVED).
      const activeOrderItems = await transaction.orderItem.findMany({
        where: {
          itemId: { in: items.map(item => item.id) },
          order: {
            status: { in: ['CREATED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'PARTIALLY_RECEIVED'] },
          },
        },
        select: { itemId: true, orderedQuantity: true, receivedQuantity: true },
      });
      const incomingByItem = new Map<string, number>();
      for (const oi of activeOrderItems) {
        const pending = Math.max(0, oi.orderedQuantity - oi.receivedQuantity);
        incomingByItem.set(oi.itemId, (incomingByItem.get(oi.itemId) ?? 0) + pending);
      }

      // Build candidates per spec §C.2 + skip rules in §C.4.
      const candidates: Array<{
        itemId: string;
        itemName: string;
        currentStock: number;
        incoming: number;
        dailyConsumption: number;
        maxQuantity: number | null;
        leadTimeDays: number;
        boxQuantity: number | null;
        orderRule: { minOrderQuantity?: number | null; maxOrderQuantity?: number | null; orderMultiple?: number | null } | null;
        proposedQty: number;
      }> = [];

      for (const item of items) {
        // TOOL never goes through scheduled replenishment (spec §1, §4).
        if (item.category?.type === ITEM_CATEGORY_TYPE.TOOL) continue;

        const monthlyConsumption = Number(item.monthlyConsumption ?? 0);
        if (monthlyConsumption <= 0) continue;

        const incoming = incomingByItem.get(item.id) ?? 0;
        const currentStock = item.quantity ?? 0;
        const maxQuantity = item.maxQuantity ?? null;
        if (maxQuantity != null && currentStock + incoming >= maxQuantity) continue;

        const leadTimeDays = item.estimatedLeadTime ?? DEFAULT_LEAD_TIME_DAYS;
        const buffer = Math.max(3, Math.ceil(cycleDays * 0.1));
        const targetCoverageDays = cycleDays + leadTimeDays + buffer;

        // Seasonal-adjusted daily consumption over the projected window.
        const projectionStart = new Date(now);
        projectionStart.setDate(projectionStart.getDate() + leadTimeDays);
        const seasonal = resolveSeasonalFactor(projectionStart);
        const dailyConsumption = (monthlyConsumption / 30) * seasonal;

        let qty = dailyConsumption * targetCoverageDays - currentStock - incoming;
        if (qty <= 0) continue;

        if (maxQuantity != null) {
          const headroom = maxQuantity - currentStock - incoming;
          qty = Math.min(qty, headroom);
          if (qty <= 0) continue;
        }

        const matchingRule =
          item.orderRules.find(r => r.supplierId === item.supplierId) ?? item.orderRules[0] ?? null;
        const proposedQty = calculateReorderQuantity({
          currentStock,
          maxQuantity: maxQuantity ?? currentStock + qty + incoming,
          incomingOrderedQuantity: incoming,
          boxQuantity: item.boxQuantity,
          orderRule: matchingRule,
        });
        if (proposedQty <= 0) continue;

        candidates.push({
          itemId: item.id,
          itemName: item.name,
          currentStock,
          incoming,
          dailyConsumption: monthlyConsumption / 30,
          maxQuantity,
          leadTimeDays,
          boxQuantity: item.boxQuantity,
          orderRule: matchingRule,
          proposedQty,
        });
      }

      if (candidates.length === 0) {
        this.logger.log(`Schedule ${scheduleId}: no items require ordering`);
        return [];
      }

      // Aligned-depletion balancing (services-spec §C.3): trim long-coverage
      // items so the basket runs out around the same date — but never below
      // each item's own lead-time floor.
      const projected = candidates.map(c => ({
        ...c,
        coverageDays:
          c.dailyConsumption > 0
            ? (c.currentStock + c.incoming + c.proposedQty) / c.dailyConsumption
            : Infinity,
      }));
      const minCoverage = Math.min(...projected.map(p => p.coverageDays));

      const balanced = projected.map(p => {
        const targetTotal = minCoverage * p.dailyConsumption;
        const reducedProposed = Math.max(0, targetTotal - p.currentStock - p.incoming);
        const ltFloor = p.dailyConsumption * p.leadTimeDays;
        const safeProposed = Math.max(
          reducedProposed,
          Math.max(0, ltFloor - p.currentStock - p.incoming),
        );
        const finalQty = Math.min(p.proposedQty, safeProposed);
        const rounded = calculateReorderQuantity({
          currentStock: p.currentStock,
          maxQuantity: p.maxQuantity ?? p.currentStock + finalQty + p.incoming,
          incomingOrderedQuantity: p.incoming,
          boxQuantity: p.boxQuantity,
          orderRule: p.orderRule,
        });
        // calculateReorderQuantity uses the headroom-to-max formula; here we
        // need it to honor the depletion-trimmed target, so synthesize a
        // pseudo-max if the rounded value overshoots.
        return {
          itemId: p.itemId,
          itemName: p.itemName,
          quantity: Math.min(rounded, finalQty || rounded),
          coverageDays: p.coverageDays,
        };
      });

      const calculatedQuantities = balanced
        .filter(b => b.quantity > 0)
        .map(b => ({
          itemId: b.itemId,
          quantity: b.quantity,
          reason: `Cycle ${cycleDays}d + LT + buffer. Cobertura projetada ≈ ${Math.round(b.coverageDays)}d (alinhado a ${Math.round(minCoverage)}d).`,
        }));

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
        isActive: finishedSchedule.isActive,
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
        await this.handleScheduleFinishAutoCreation(updatedSchedule, userId, tx);

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
