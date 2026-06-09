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
  ABC_CATEGORY,
  XYZ_CATEGORY,
} from '../../../constants/enums';
import { DEFAULT_LEAD_TIME_DAYS, isToolType } from '../../../constants/inventory-config';
import { calculateReorderQuantity } from '../../../utils/stock-health';
import { calculateSafetyStock } from '../../../utils/safety-stock';
import {
  blendedFactorAcrossDays,
  buildSeasonalContextFromSnapshots,
} from '../../../utils/seasonality';
import { balanceDepletionAcrossItems } from '../../../utils/order-coverage';
import { calculateNextRunDate as utilCalculateNextRunDate } from '../../../utils/order';
import { nextBrazilianBusinessDay } from '../../../utils/brazilian-holidays.util';
import { isInVacationPeriod } from '../../../constants/working-days-config';
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
   * Calculate the next run date for a schedule. Delegates to the canonical
   * util `calculateNextRunDate` in `@/utils/order` (which honors
   * `monthlyConfig.occurrence + dayOfWeek` for "first Thursday" / "second
   * Thursday" patterns), then shifts to the next Brazilian business day
   * (skipping weekends, national holidays, and company vacation).
   *
   * The schedule MUST be loaded with `weeklyConfig`/`monthlyConfig`/
   * `yearlyConfig` included; without them, occurrence-based monthly schedules
   * fall back to a flat month advance.
   */
  public calculateNextRunDate(
    schedule: OrderSchedule & {
      weeklyConfig?: any;
      monthlyConfig?: any;
      yearlyConfig?: any;
    },
    fromDate?: Date,
  ): Date | null {
    const base = fromDate || new Date();
    const raw = utilCalculateNextRunDate(schedule as any, base);
    if (!raw) return null;
    return shiftToBusinessDay(raw);
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

        // Recompute nextRun server-side so it always aligns with the configured
        // occurrence pattern. The user's form-provided date is used as a "not
        // before" hint: the system finds the next valid occurrence on or after
        // that date. This prevents orders from being created on the wrong day
        // (e.g. the user accidentally set a non-Tuesday date for a "first Tuesday"
        // monthly schedule).
        if (newOrderSchedule.isActive) {
          const scheduleWithConfig = await tx.orderSchedule.findUnique({
            where: { id: newOrderSchedule.id },
            include: { monthlyConfig: true, weeklyConfig: true, yearlyConfig: true },
          });
          if (scheduleWithConfig) {
            const fromDate = newOrderSchedule.nextRun ?? new Date();
            const correctNextRun = this.calculateNextRunDate(scheduleWithConfig as any, fromDate);
            if (
              correctNextRun &&
              (!newOrderSchedule.nextRun ||
                correctNextRun.getTime() !== new Date(newOrderSchedule.nextRun).getTime())
            ) {
              await tx.orderSchedule.update({
                where: { id: newOrderSchedule.id },
                data: { nextRun: correctNextRun },
              });
              (newOrderSchedule as any).nextRun = correctNextRun;
            }
          }
        }

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
          'supplierId',
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

  // Milliseconds in a day — used for coverage/gap day math.
  private static readonly DAY_MS = 1000 * 60 * 60 * 24;

  /**
   * Calculate order quantities from schedule template based on current stock
   * levels and business rules. Thin wrapper over `computeScheduleOrderPlan`
   * that preserves the legacy cron behavior: coverage window = days until the
   * next computed run (default 30), anchored at "now", with NO forward stock
   * projection. Returns only the items that require ordering.
   */
  async calculateOrderQuantitiesFromSchedule(
    scheduleId: string,
    tx?: PrismaTransaction,
  ): Promise<{ itemId: string; quantity: number; reason: string }[]> {
    const transaction = tx || this.prisma;

    const schedule = await transaction.orderSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento de pedido ${scheduleId} não encontrado`);
    }

    const nextRun = this.calculateNextRunDate(schedule as OrderSchedule);
    const now = new Date();
    const coverageDays = nextRun
      ? Math.max(1, Math.ceil((nextRun.getTime() - now.getTime()) / OrderScheduleService.DAY_MS))
      : 30;

    const plan = await this.computeScheduleOrderPlan({
      scheduleId,
      asOfDate: now,
      coverageDays,
      stockProjectionDays: 0,
      tx: transaction,
    });

    return plan.items
      .filter(i => !i.skipped && i.quantity > 0)
      .map(i => ({ itemId: i.itemId, quantity: i.quantity, reason: i.reason }));
  }

  /**
   * Generalized order-quantity planner — the single engine behind the cron, the
   * dual-projection details columns, and the trigger-now cascade modes. For
   * every active item on a schedule it computes the quantity to order so stock
   * covers `coverageDays` starting from `asOfDate`. Two knobs generalize the
   * legacy calc:
   *   - `coverageDays`         — the cycle length to cover (replaces the implicit
   *     "days until next run"); the trigger-now modes pass gap-only or gap+cycle.
   *   - `stockProjectionDays`  — days of consumption to subtract from CURRENT
   *     stock BEFORE evaluating need, simulating the item's state on a future
   *     date (the "scheduled" column). Depletion uses the raw daily rate
   *     (monthlyConsumption / 30); incoming receipts stay treated as available,
   *     consistent with the legacy calc.
   *
   * Returns EVERY evaluated schedule item (zero-quantity / skipped ones carry a
   * human-readable `reason` + `skipped` flag) so the projection endpoint can
   * render a complete table; order-creating callers filter `!skipped && qty>0`.
   */
  private async computeScheduleOrderPlan(params: {
    scheduleId: string;
    asOfDate: Date;
    coverageDays: number;
    stockProjectionDays?: number;
    tx?: PrismaTransaction;
  }): Promise<{
    items: Array<{
      itemId: string;
      itemName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      icms: number;
      ipi: number;
      reason: string;
      skipped: boolean;
      startStock: number;
      coverageDays: number;
    }>;
    meta: { coverageDays: number; asOfDate: Date; stockProjectionDays: number };
  }> {
    const { scheduleId, asOfDate, tx } = params;
    const coverageDays = Math.max(1, Math.round(params.coverageDays));
    const stockProjectionDays = Math.max(0, Math.round(params.stockProjectionDays ?? 0));
    const transaction = tx || this.prisma;
    const meta = { coverageDays, asOfDate, stockProjectionDays };

    const schedule = await transaction.orderSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento de pedido ${scheduleId} não encontrado`);
    }
    if (!schedule.items || schedule.items.length === 0) {
      return { items: [], meta };
    }

    // Load items with category type (TOOL skip), latest price, and active
    // OrderRules. ABC/XYZ + reorderPoint + ordersLast12Months drive the
    // safety-buffer matrix lookup and the lt-floor in the balancer.
    const items = await transaction.item.findMany({
      where: { id: { in: schedule.items }, isActive: true },
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
      return { items: [], meta };
    }

    // Keep the schedule's configured item order for stable table rendering.
    const itemOrder = new Map(schedule.items.map((id, idx) => [id, idx]));
    items.sort((a, b) => (itemOrder.get(a.id) ?? 0) - (itemOrder.get(b.id) ?? 0));

    // Per-item SeasonalContext from ConsumptionSnapshot history (corpus
    // fallback handled inside the helper).
    const snapshotRows = await transaction.consumptionSnapshot.findMany({
      where: { itemId: { in: items.map(i => i.id) } },
      select: {
        itemId: true,
        year: true,
        month: true,
        seasonalFactor: true,
        normalizedConsumption: true,
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const snapshotsByItem = new Map<string, Array<{ year: number; month: number; seasonalFactor: number }>>();
    // Trailing monthly consumption (oldest-first) → σ for the statistical
    // safety-stock layer.
    const historyByItem = new Map<string, number[]>();
    for (const r of snapshotRows) {
      const arr = snapshotsByItem.get(r.itemId) ?? [];
      arr.push({ year: r.year, month: r.month, seasonalFactor: r.seasonalFactor });
      snapshotsByItem.set(r.itemId, arr);
      const h = historyByItem.get(r.itemId) ?? [];
      h.push(r.normalizedConsumption);
      historyByItem.set(r.itemId, h);
    }

    // Pending receipts (still-open orders) offset the need.
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

    type Candidate = {
      itemId: string;
      itemName: string;
      currentStock: number; // effective (forward-projected) stock
      incoming: number;
      dailyConsumption: number; // raw daily (mc/30) for the balancer
      maxQuantity: number | null;
      leadTimeDays: number;
      reorderPoint: number;
      boxQuantity: number | null;
      orderRule: { minOrderQuantity?: number | null; maxOrderQuantity?: number | null; orderMultiple?: number | null } | null;
      proposedQty: number;
      unitPrice: number;
      icms: number;
      ipi: number;
    };

    const candidates: Candidate[] = [];
    const passiveResults = new Map<
      string,
      { itemId: string; itemName: string; unitPrice: number; icms: number; ipi: number; reason: string; skipped: boolean; startStock: number }
    >();

    for (const item of items) {
      const unitPrice = item.prices?.[0]?.value ?? 0;
      const icms = item.icms ?? 0;
      const ipi = item.ipi ?? 0;
      const monthlyConsumption = Number(item.monthlyConsumption ?? 0);
      const dailyBase = monthlyConsumption / 30;
      const currentStock = item.quantity ?? 0;
      // Forward-simulate stock to `asOfDate`: deplete by raw daily rate over the
      // projection window. Clamped at 0 (can't have negative stock).
      const effectiveStock =
        stockProjectionDays > 0
          ? Math.max(0, currentStock - dailyBase * stockProjectionDays)
          : currentStock;

      const pushPassive = (reason: string, skipped: boolean) =>
        passiveResults.set(item.id, {
          itemId: item.id,
          itemName: item.name,
          unitPrice,
          icms,
          ipi,
          reason,
          skipped,
          startStock: effectiveStock,
        });

      // Tools (regular + electronic) never go through scheduled replenishment.
      if (isToolType(item.category?.type)) {
        pushPassive('Ferramenta — não entra em reabastecimento automático', true);
        continue;
      }
      if (monthlyConsumption <= 0) {
        pushPassive('Sem histórico de consumo registrado', true);
        continue;
      }

      const incoming = incomingByItem.get(item.id) ?? 0;
      const leadTimeDays = item.estimatedLeadTime ?? DEFAULT_LEAD_TIME_DAYS;

      // Periodic-review (order-up-to) model. A schedule only reviews stock every
      // `coverageDays`, so it is exposed to demand variability over the whole
      // PROTECTION INTERVAL = coverageDays + leadTime (not just the lead time).
      // The safety stock is the statistical z×σ×√(protection) from the shared
      // layered helper (we pass the protection interval as its "lead time"), so
      // it scales with each item's MEASURED variability: volatile / high-usage
      // items automatically carry more buffer, while steady items stay lean.
      const protectionDays = coverageDays + leadTimeDays;

      // Seasonal-adjusted daily consumption blended across the protection window,
      // anchored at `asOfDate + leadTime`.
      const projectionStart = new Date(asOfDate);
      projectionStart.setDate(projectionStart.getDate() + leadTimeDays);
      const seasonalCtx = buildSeasonalContextFromSnapshots(snapshotsByItem.get(item.id));
      const seasonal = blendedFactorAcrossDays(projectionStart, protectionDays, seasonalCtx);
      const dailyConsumption = dailyBase * seasonal;

      const demandOverProtection = dailyConsumption * protectionDays;
      const ssRaw = calculateSafetyStock({
        monthlyConsumption,
        leadTimeDays: protectionDays,
        abcCategory: (item.abcCategory as ABC_CATEGORY | null) ?? null,
        xyzCategory: (item.xyzCategory as XYZ_CATEGORY | null) ?? null,
        monthlyHistory: historyByItem.get(item.id) ?? [],
        trendPercent:
          item.monthlyConsumptionTrendPercent != null
            ? Number(item.monthlyConsumptionTrendPercent)
            : 0,
      }).safetyStock;
      // Sanity bound: safety never exceeds one protection-interval of demand, so a
      // bad-data σ can't balloon stock (worst case ≈ 2× the cycle) while volatile
      // items still get a generous buffer.
      const safetyStock = Math.min(ssRaw, demandOverProtection);
      const orderUpTo = demandOverProtection + safetyStock;

      if (effectiveStock + incoming >= orderUpTo) {
        pushPassive('Estoque projetado já cobre a cobertura + segurança', false);
        continue;
      }

      const matchingRule =
        item.orderRules.find(r => r.supplierId === item.supplierId) ?? item.orderRules[0] ?? null;
      // Order up to the computed order-up-to level (demand over the protection
      // interval + statistical safety stock), box/orderRule-rounded. This level
      // — not the stored maxQuantity (which used a weaker safety model) — is the
      // variability-aware ceiling for the scheduled path.
      const proposedQty = calculateReorderQuantity({
        currentStock: effectiveStock,
        maxQuantity: orderUpTo,
        incomingOrderedQuantity: incoming,
        boxQuantity: item.boxQuantity,
        orderRule: matchingRule,
      });
      if (proposedQty <= 0) {
        pushPassive('Estoque suficiente para o período projetado', false);
        continue;
      }

      candidates.push({
        itemId: item.id,
        itemName: item.name,
        currentStock: effectiveStock,
        incoming,
        dailyConsumption: dailyBase,
        maxQuantity: Math.ceil(orderUpTo),
        leadTimeDays,
        reorderPoint: item.reorderPoint ?? 0,
        boxQuantity: item.boxQuantity,
        orderRule: matchingRule,
        proposedQty,
        unitPrice,
        icms,
        ipi,
      });
    }

    // Aligned-depletion balancing across the same-supplier basket.
    const balanceResults =
      candidates.length > 0
        ? balanceDepletionAcrossItems(
            candidates.map(c => ({
              currentQty: c.currentStock,
              proposedQty: c.proposedQty,
              dailyConsumption: c.dailyConsumption,
              maxQuantity: c.maxQuantity,
              reorderPoint: c.reorderPoint,
              leadTimeDays: c.leadTimeDays,
              incomingQty: c.incoming,
            })),
          )
        : [];
    const minCoverage =
      balanceResults.length > 0
        ? Math.min(
            ...balanceResults.map(r =>
              Number.isFinite(r.coverageDays) ? r.coverageDays : Number.POSITIVE_INFINITY,
            ),
          )
        : 0;

    type ResultItem = {
      itemId: string;
      itemName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      icms: number;
      ipi: number;
      reason: string;
      skipped: boolean;
      startStock: number;
      coverageDays: number;
    };
    const activeResults = new Map<string, ResultItem>();
    candidates.forEach((c, i) => {
      const balanced = balanceResults[i];
      // Round the BALANCED (depletion-aligned) need up to box/orderRule
      // multiples. Target = stock+incoming+balancedQty so the rounded shortfall
      // equals balancedQty. (The old `min(rounded, balancedQty)` leaked the raw
      // fractional balancedQty into the result — e.g. "1.266,571".)
      const finalQty = calculateReorderQuantity({
        currentStock: c.currentStock,
        maxQuantity: c.currentStock + c.incoming + balanced.balancedQty,
        incomingOrderedQuantity: c.incoming,
        boxQuantity: c.boxQuantity,
        orderRule: c.orderRule,
      });
      if (finalQty <= 0) {
        activeResults.set(c.itemId, {
          itemId: c.itemId,
          itemName: c.itemName,
          quantity: 0,
          unitPrice: c.unitPrice,
          totalPrice: 0,
          icms: c.icms,
          ipi: c.ipi,
          reason: 'Estoque suficiente para o período projetado',
          skipped: false,
          startStock: c.currentStock,
          coverageDays: balanced.coverageDays,
        });
        return;
      }
      activeResults.set(c.itemId, {
        itemId: c.itemId,
        itemName: c.itemName,
        quantity: finalQty,
        unitPrice: c.unitPrice,
        totalPrice: finalQty * c.unitPrice,
        icms: c.icms,
        ipi: c.ipi,
        reason: `Cobre ${coverageDays}d + lead time + buffer. Cobertura projetada ≈ ${Math.round(
          balanced.coverageDays,
        )}d (alinhado a ${Math.round(minCoverage)}d).`,
        skipped: false,
        startStock: c.currentStock,
        coverageDays: balanced.coverageDays,
      });
    });

    // Emit in the schedule's configured item order, merging active + passive.
    const resultItems: ResultItem[] = items.map(item => {
      const active = activeResults.get(item.id);
      if (active) return active;
      const passive = passiveResults.get(item.id);
      return {
        itemId: item.id,
        itemName: item.name,
        quantity: 0,
        unitPrice: passive?.unitPrice ?? item.prices?.[0]?.value ?? 0,
        totalPrice: 0,
        icms: passive?.icms ?? item.icms ?? 0,
        ipi: passive?.ipi ?? item.ipi ?? 0,
        reason: passive?.reason ?? 'Item indisponível',
        skipped: passive?.skipped ?? true,
        startStock: passive?.startStock ?? item.quantity ?? 0,
        coverageDays: 0,
      };
    });

    this.logger.log(
      `Plan for schedule ${scheduleId}: coverage=${coverageDays}d projection=${stockProjectionDays}d → ${
        resultItems.filter(i => i.quantity > 0).length
      } item(s) to order`,
    );
    return { items: resultItems, meta };
  }

  /**
   * Compute schedule timing: the next scheduled run, the recurrence interval in
   * days (one full cycle), and the gap in days from now until the next run.
   * `intervalDays` is derived from two RAW (non business-day-shifted) next-run
   * computations so month-length variation is captured exactly; null for ONCE.
   * Timing is computed as-if-active so projections still work for paused schedules.
   */
  public getScheduleTiming(
    schedule: OrderSchedule & { weeklyConfig?: any; monthlyConfig?: any; yearlyConfig?: any },
  ): { nextRun: Date | null; intervalDays: number | null; gapDays: number } {
    const now = new Date();
    const activeLike = { ...schedule, isActive: true, lastRun: null } as any;
    const nextRun = schedule.nextRun ?? this.calculateNextRunDate(activeLike);

    let intervalDays: number | null = null;
    if (schedule.frequency !== SCHEDULE_FREQUENCY.ONCE) {
      const rawNext1 = utilCalculateNextRunDate(activeLike, now);
      const rawNext2 = rawNext1 ? utilCalculateNextRunDate(activeLike, rawNext1) : null;
      if (rawNext1 && rawNext2 && rawNext2.getTime() > rawNext1.getTime()) {
        intervalDays = Math.max(
          1,
          Math.round((rawNext2.getTime() - rawNext1.getTime()) / OrderScheduleService.DAY_MS),
        );
      }
    }

    const gapDays = nextRun
      ? Math.max(0, Math.ceil((nextRun.getTime() - now.getTime()) / OrderScheduleService.DAY_MS))
      : 0;

    return { nextRun, intervalDays, gapDays };
  }

  /**
   * Trigger-preview table for the details page. Every column corresponds to a
   * REAL order the user can create, so the per-item rows always reconcile with
   * the totals shown elsewhere:
   *   - GAP_ONLY        — "Executar agora": order now, cover only until the next
   *                       scheduled run. Per-item rows sum to `gapOnlyTotal`.
   *   - GAP_PLUS_CYCLE  — "Executar agora + ciclo": cover the gap PLUS one full
   *                       cycle. Per-item rows sum to `gapPlusCycleTotal`.
   * Both use the EXACT coverage windows of OrderScheduleScheduler.triggerNow, so
   * each column total equals the order that mode actually creates. `meta` also
   * carries `scheduledTotal` — the forecast of the next AUTOMATIC order when the
   * cron fires on its date (stock rolled forward over the gap); it matches the
   * list's "Preço esperado" and is informational only (NOT a trigger total).
   */
  async getScheduleProjection(scheduleId: string): Promise<{
    success: boolean;
    message: string;
    data: {
      items: Array<{
        itemId: string;
        itemName: string;
        unitPrice: number;
        // GAP_ONLY ("Executar agora" — cover only until the next run).
        quantityGapOnly: number;
        totalGapOnly: number;
        reasonGapOnly: string;
        skippedGapOnly: boolean;
        // GAP_PLUS_CYCLE ("Executar agora + ciclo" — gap + one full cycle).
        quantityGapPlusCycle: number;
        totalGapPlusCycle: number;
        reasonGapPlusCycle: string;
        skippedGapPlusCycle: boolean;
      }>;
      meta: {
        nextRun: Date | null;
        scheduledDate: Date | null;
        gapDays: number;
        intervalDays: number | null;
        /** False when the schedule is due now / overdue — the GAP_ONLY option
         *  then falls back to one interval and clients hide its column/button. */
        hasGap: boolean;
        /** Total the GAP_ONLY trigger creates (coverage = gap to next run).
         *  Equals the sum of the per-item `totalGapOnly` column. */
        gapOnlyTotal: number;
        gapOnlyCoverageDays: number;
        /** Total the GAP_PLUS_CYCLE trigger creates (coverage = gap + one full
         *  cycle). Equals the sum of the per-item `totalGapPlusCycle` column. */
        gapPlusCycleTotal: number;
        gapPlusCycleCoverageDays: number;
        /** Forecast of the next AUTOMATIC order (cron fires on nextRun, stock
         *  rolled forward over the gap). Informational; matches "Preço esperado". */
        scheduledTotal: number;
        scheduledCoverageDays: number;
      };
    };
  }> {
    const schedule = await this.prisma.orderSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento de pedido ${scheduleId} não encontrado`);
    }

    const { nextRun, intervalDays, gapDays } = this.getScheduleTiming(schedule as OrderSchedule);
    const now = new Date();
    const interval = intervalDays ?? 30;
    const hasGap = gapDays > 0;

    // Coverage windows mirror OrderScheduleScheduler.triggerNow EXACTLY, so the
    // previewed per-item rows + column totals equal the orders that get created.
    const gapOnlyCoverageDays = hasGap ? gapDays : interval; // overdue → one cycle
    const gapPlusCycleCoverageDays = Math.max(1, gapDays) + interval;
    const scheduledCoverageDays = interval;

    const [planGapOnly, planGapPlusCycle, planScheduled] = await Promise.all([
      this.computeScheduleOrderPlan({ scheduleId, asOfDate: now, coverageDays: gapOnlyCoverageDays, stockProjectionDays: 0 }),
      this.computeScheduleOrderPlan({ scheduleId, asOfDate: now, coverageDays: gapPlusCycleCoverageDays, stockProjectionDays: 0 }),
      // Scheduled forecast: the order the cron will create when it fires on
      // nextRun (stock depleted over the gap, then one cycle of coverage). When
      // due now / overdue it collapses to "cover one cycle from now".
      hasGap && nextRun
        ? this.computeScheduleOrderPlan({ scheduleId, asOfDate: nextRun, coverageDays: scheduledCoverageDays, stockProjectionDays: gapDays })
        : this.computeScheduleOrderPlan({ scheduleId, asOfDate: now, coverageDays: scheduledCoverageDays, stockProjectionDays: 0 }),
    ]);

    // Skipped / zero-quantity rows carry totalPrice 0, so summing every row's
    // totalPrice equals the order created by buildOrderDataForCoverage (which
    // filters `!skipped && quantity > 0`).
    const gapOnlyById = new Map(planGapOnly.items.map(i => [i.itemId, i]));
    const scheduledById = new Map(planScheduled.items.map(i => [i.itemId, i]));

    let gapOnlyTotal = 0;
    let gapPlusCycleTotal = 0;
    let scheduledTotal = 0;
    // Iterate planGapPlusCycle — it evaluates every schedule item in configured
    // order — and zip in the GAP_ONLY + scheduled counterparts by id.
    const itemsOut = planGapPlusCycle.items.map(gpc => {
      const go = gapOnlyById.get(gpc.itemId);
      const sched = scheduledById.get(gpc.itemId);
      gapOnlyTotal += go?.totalPrice ?? 0;
      gapPlusCycleTotal += gpc.totalPrice;
      scheduledTotal += sched?.totalPrice ?? 0;
      return {
        itemId: gpc.itemId,
        itemName: gpc.itemName,
        unitPrice: gpc.unitPrice,
        quantityGapOnly: go?.quantity ?? 0,
        totalGapOnly: go?.totalPrice ?? 0,
        reasonGapOnly: go?.reason ?? gpc.reason,
        skippedGapOnly: go?.skipped ?? true,
        quantityGapPlusCycle: gpc.quantity,
        totalGapPlusCycle: gpc.totalPrice,
        reasonGapPlusCycle: gpc.reason,
        skippedGapPlusCycle: gpc.skipped,
      };
    });

    return {
      success: true,
      message: `Projeção calculada para o agendamento ${scheduleId}.`,
      data: {
        items: itemsOut,
        meta: {
          nextRun,
          scheduledDate: nextRun,
          gapDays,
          intervalDays,
          hasGap,
          gapOnlyTotal,
          gapOnlyCoverageDays,
          gapPlusCycleTotal,
          gapPlusCycleCoverageDays,
          scheduledTotal,
          scheduledCoverageDays,
        },
      },
    };
  }

  /**
   * Lightweight batch projection for list views: the EXPECTED order total for
   * each schedule when it fires on its scheduled date (stock rolled forward to
   * `nextRun`). Computes only the scheduled plan (not today's), with bounded
   * concurrency, so a list can show a single "expected price" column without N
   * round-trips. Failures per schedule degrade to a 0 total rather than erroring
   * the whole request.
   */
  async getExpectedTotals(
    scheduleIds: string[],
  ): Promise<
    Array<{ id: string; expectedTotal: number; nextRun: Date | null; gapDays: number }>
  > {
    const ids = [...new Set((scheduleIds ?? []).filter(id => typeof id === 'string'))].slice(0, 200);
    if (ids.length === 0) return [];

    const now = new Date();
    const results: Array<{
      id: string;
      expectedTotal: number;
      nextRun: Date | null;
      gapDays: number;
    }> = [];
    const CONCURRENCY = 5;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = ids.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async id => {
          try {
            const schedule = await this.prisma.orderSchedule.findUnique({
              where: { id },
              include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
            });
            if (!schedule) return { id, expectedTotal: 0, nextRun: null, gapDays: 0 };

            const { nextRun, intervalDays, gapDays } = this.getScheduleTiming(
              schedule as OrderSchedule,
            );
            const coverageDays = intervalDays ?? 30;
            const plan =
              nextRun && gapDays > 0
                ? await this.computeScheduleOrderPlan({
                    scheduleId: id,
                    asOfDate: nextRun,
                    coverageDays,
                    stockProjectionDays: gapDays,
                  })
                : await this.computeScheduleOrderPlan({
                    scheduleId: id,
                    asOfDate: now,
                    coverageDays,
                    stockProjectionDays: 0,
                  });

            const expectedTotal = plan.items.reduce((sum, it) => sum + (it.totalPrice ?? 0), 0);
            return { id, expectedTotal, nextRun, gapDays };
          } catch (err) {
            this.logger.warn(
              `Failed to compute expected total for schedule ${id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return { id, expectedTotal: 0, nextRun: null, gapDays: 0 };
          }
        }),
      );
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Build (but do not persist) the order payload for a schedule covering an
   * explicit window. Used by the trigger-now flow in the scheduler. Returns null
   * when no item needs ordering.
   */
  async buildOrderDataForCoverage(
    scheduleId: string,
    opts: { asOfDate: Date; coverageDays: number; stockProjectionDays?: number },
    tx?: PrismaTransaction,
  ): Promise<any | null> {
    const transaction = tx || this.prisma;
    const schedule = await transaction.orderSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento de pedido ${scheduleId} não encontrado`);
    }

    const plan = await this.computeScheduleOrderPlan({
      scheduleId,
      asOfDate: opts.asOfDate,
      coverageDays: opts.coverageDays,
      stockProjectionDays: opts.stockProjectionDays ?? 0,
      tx: transaction,
    });

    const orderItems = plan.items
      .filter(i => !i.skipped && i.quantity > 0)
      .map(i => ({
        itemId: i.itemId,
        orderedQuantity: i.quantity,
        price: i.unitPrice,
        icms: i.icms,
        ipi: i.ipi,
      }));
    if (orderItems.length === 0) {
      return null;
    }

    // Name the order after the schedule (matches the cron path createOrderFromSchedule):
    // "<schedule name> (automático)". Trigger-now orders still carry orderScheduleId, so
    // they are automatic (.1) — naming them "(automático)" keeps that consistent.
    const itemCount = orderItems.length;
    const scheduleName = schedule.name?.trim() || schedule.description?.trim();
    const description = scheduleName
      ? `${scheduleName} (automático)`
      : `Pedido automático - ${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`;

    return {
      supplierId: schedule.supplierId ?? null,
      description,
      // forecast left null so order creation derives it from the items' average
      // lead time (expected delivery), not the schedule's next-run date.
      forecast: null,
      status: 'CREATED',
      orderScheduleId: scheduleId,
      items: orderItems,
    };
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

      // Create order description from the schedule's own name (falling back to
      // its description, then a generic item-count label for unnamed schedules).
      // The "(automático)" suffix flags it as a scheduled order in listings.
      const itemCount = orderItems.length;
      const scheduleName = schedule.name?.trim() || schedule.description?.trim();
      const description = scheduleName
        ? `${scheduleName} (automático)`
        : `Pedido automático - ${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`;

      // Prepare order data. supplierId is propagated from the schedule when
      // present (added 2026-05-21 — see migration memo). Falls back to NULL
      // for legacy schedules that haven't been re-saved with a supplier yet.
      const orderData = {
        supplierId: schedule.supplierId ?? null,
        description,
        // forecast left null so order creation derives it from the items' average
        // lead time (expected delivery), not the schedule's next-run date.
        forecast: null,
        status: 'CREATED',
        orderScheduleId: scheduleId,
        items: orderItems,
      };

      this.logger.log(
        `Creating order from schedule ${scheduleId} with ${orderItems.length} items (supplier=${schedule.supplierId ?? 'none'})`,
      );
      return orderData;
    } catch (error) {
      this.logger.error(`Error creating order from schedule ${scheduleId}:`, error);
      throw error;
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

        // Recurrence is now handled IN PLACE by the cron (a schedule produces
        // many orders over its lifetime). Finishing therefore simply stops the
        // schedule — no clone/rotation. (Historically a child schedule was
        // cloned here to work around the old Order.orderScheduleId @unique
        // constraint, which no longer exists.)

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

/** Shifts a computed `nextRun` forward to the next valid Brazilian business
 *  day, skipping weekends, national holidays (Carnaval/Páscoa/Natal/etc.),
 *  and company vacation periods. Hard cap of 60 forward steps. */
function shiftToBusinessDay(d: Date): Date {
  let candidate = new Date(d);
  for (let i = 0; i < 60; i++) {
    // First skip vacation (per-day check); then skip to next Brazilian
    // business day; loop if either advanced. Stops when both pass.
    const beforeVac = candidate.getTime();
    while (isInVacationPeriod(candidate) && i < 60) {
      candidate.setDate(candidate.getDate() + 1);
      i++;
    }
    const advanced = nextBrazilianBusinessDay(candidate);
    if (advanced.getTime() === candidate.getTime() && candidate.getTime() === beforeVac) {
      return candidate;
    }
    candidate = advanced;
  }
  return candidate;
}
