import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { MaintenanceScheduleRepository } from './repositories/maintenance-schedule/maintenance-schedule.repository';
import { MaintenanceService } from './maintenance.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  MaintenanceSchedule,
  MaintenanceScheduleGetUniqueResponse,
  MaintenanceScheduleGetManyResponse,
  MaintenanceScheduleCreateResponse,
  MaintenanceScheduleUpdateResponse,
  MaintenanceScheduleDeleteResponse,
  MaintenanceScheduleBatchCreateResponse,
  MaintenanceScheduleBatchUpdateResponse,
  MaintenanceScheduleBatchDeleteResponse,
} from '../../../types';
import {
  MaintenanceScheduleGetManyFormData,
  MaintenanceScheduleCreateFormData,
  MaintenanceScheduleUpdateFormData,
  MaintenanceScheduleInclude,
  MaintenanceScheduleBatchCreateFormData,
  MaintenanceScheduleBatchUpdateFormData,
  MaintenanceScheduleBatchDeleteFormData,
} from '../../../schemas/maintenance';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  CHANGE_ACTION,
  SCHEDULE_FREQUENCY,
  MAINTENANCE_STATUS,
} from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  extractEssentialFields,
  getEssentialFields,
} from '@modules/common/changelog/utils/changelog-helpers';

@Injectable()
export class MaintenanceScheduleService {
  private readonly logger = new Logger(MaintenanceScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenanceScheduleRepository: MaintenanceScheduleRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject(forwardRef(() => MaintenanceService))
    private readonly maintenanceService: MaintenanceService,
  ) {}

  /**
   * Calculate the next run date based on schedule frequency and interval
   */
  private calculateNextRunDate(schedule: any, fromDate?: Date | null): Date | null {
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
    nextRun = this.setDefaultMaintenanceTime(nextRun);

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
   * Set time to 13:00:00 (1 PM) for maintenance scheduling
   */
  private setDefaultMaintenanceTime(date: Date): Date {
    const newDate = new Date(date);
    newDate.setHours(13, 0, 0, 0);
    return newDate;
  }

  /**
   * Validate entity data
   */
  private async maintenanceScheduleValidation(
    data: Partial<MaintenanceScheduleCreateFormData | MaintenanceScheduleUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate item exists if provided
    if (data.itemId) {
      const item = await transaction.item.findUnique({
        where: { id: data.itemId },
      });
      if (!item) {
        throw new NotFoundException('Item não encontrado. Verifique se o ID está correto.');
      }
    }

    // Maintenance items config is optional - can be empty for cleanup-only maintenance
    // Validate maintenance items if provided
    if (data.maintenanceItemsConfig && Array.isArray(data.maintenanceItemsConfig)) {
      for (const itemConfig of data.maintenanceItemsConfig) {
        if (!itemConfig.itemId) {
          throw new BadRequestException(
            'Todos os itens de manutenção devem ter um ID de item especificado.',
          );
        }

        // Validate item exists
        const item = await transaction.item.findUnique({
          where: { id: itemConfig.itemId },
        });
        if (!item) {
          throw new NotFoundException(`Item com ID ${itemConfig.itemId} não encontrado.`);
        }

        // Validate quantity is positive
        if (itemConfig.quantity && itemConfig.quantity <= 0) {
          throw new BadRequestException(
            `A quantidade para o item ${item.name} deve ser maior que zero.`,
          );
        }
      }
    }
  }

  /**
   * Create a new maintenance schedule
   */
  async create(
    data: MaintenanceScheduleCreateFormData,
    include?: MaintenanceScheduleInclude,
    userId?: string,
  ): Promise<MaintenanceScheduleCreateResponse> {
    try {
      const maintenanceSchedule = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate entity
        await this.maintenanceScheduleValidation(data, undefined, tx);

        // Calculate next run date if not provided
        if (!data.nextRun) {
          const nextRun = this.calculateNextRunDate(data);
          if (nextRun) {
            data.nextRun = nextRun;
          }
        }

        // Create the maintenance schedule
        const newMaintenanceSchedule =
          await this.maintenanceScheduleRepository.createWithTransaction(tx, data, { include });

        // Log creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MAINTENANCE_SCHEDULE,
          entityId: newMaintenanceSchedule.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(
            newMaintenanceSchedule,
            getEssentialFields(ENTITY_TYPE.MAINTENANCE_SCHEDULE) as (keyof MaintenanceSchedule)[],
          ),
          reason: 'Novo agendamento de manutenção criado no sistema',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Create the first maintenance if nextRun is set and schedule is active
        if (newMaintenanceSchedule.isActive && newMaintenanceSchedule.nextRun) {
          await this.createInitialMaintenanceFromSchedule(newMaintenanceSchedule, userId, tx);
        }

        return newMaintenanceSchedule;
      });

      return {
        success: true,
        message: 'Agendamento de manutenção criado com sucesso.',
        data: maintenanceSchedule,
      };
    } catch (error) {
      this.logger.error('Erro ao criar agendamento de manutenção:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar agendamento de manutenção. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing maintenance schedule
   */
  async update(
    id: string,
    data: MaintenanceScheduleUpdateFormData,
    include?: MaintenanceScheduleInclude,
    userId?: string,
  ): Promise<MaintenanceScheduleUpdateResponse> {
    try {
      const updatedMaintenanceSchedule = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // Get existing maintenance schedule
          const existingMaintenanceSchedule =
            await this.maintenanceScheduleRepository.findByIdWithTransaction(tx, id);

          if (!existingMaintenanceSchedule) {
            throw new NotFoundException(
              'Agendamento de manutenção não encontrado. Verifique se o ID está correto.',
            );
          }

          // Validate entity
          await this.maintenanceScheduleValidation(data, id, tx);

          // Update the maintenance schedule
          const updatedSchedule = await this.maintenanceScheduleRepository.updateWithTransaction(
            tx,
            id,
            data,
            { include },
          );

          // Log update
          const fieldsToTrack = [
            'name',
            'description',
            'itemId',
            'frequency',
            'frequencyCount',
            'isActive',
            'nextRun',
            'lastRun',
            'finishedAt',
            'maintenanceItemsConfig',
          ];
          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.MAINTENANCE_SCHEDULE,
            entityId: id,
            oldEntity: existingMaintenanceSchedule,
            newEntity: updatedSchedule,
            fieldsToTrack,
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          return updatedSchedule;
        },
      );

      return {
        success: true,
        message: 'Agendamento de manutenção atualizado com sucesso.',
        data: updatedMaintenanceSchedule,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar agendamento de manutenção:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar agendamento de manutenção. Tente novamente.',
      );
    }
  }

  /**
   * Delete a maintenance schedule
   */
  async delete(id: string, userId?: string): Promise<MaintenanceScheduleDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const maintenanceSchedule =
          await this.maintenanceScheduleRepository.findByIdWithTransaction(tx, id);

        if (!maintenanceSchedule) {
          throw new NotFoundException(
            'Agendamento de manutenção não encontrado. Verifique se o ID está correto.',
          );
        }

        // Log deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MAINTENANCE_SCHEDULE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            maintenanceSchedule,
            getEssentialFields(ENTITY_TYPE.MAINTENANCE_SCHEDULE) as (keyof MaintenanceSchedule)[],
          ),
          reason: 'Agendamento de manutenção excluído do sistema',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.maintenanceScheduleRepository.deleteWithTransaction(tx, id);
      });

      return { success: true, message: 'Agendamento de manutenção excluído com sucesso.' };
    } catch (error) {
      this.logger.error('Erro ao excluir agendamento de manutenção:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir agendamento de manutenção. Tente novamente.',
      );
    }
  }

  /**
   * Find a maintenance schedule by ID
   */
  async findById(
    id: string,
    include?: MaintenanceScheduleInclude,
  ): Promise<MaintenanceScheduleGetUniqueResponse> {
    try {
      const maintenanceSchedule = await this.maintenanceScheduleRepository.findById(id, {
        include,
      });
      if (!maintenanceSchedule) {
        throw new NotFoundException(
          'Agendamento de manutenção não encontrado. Verifique se o ID está correto.',
        );
      }

      return {
        success: true,
        message: 'Agendamento de manutenção carregado com sucesso.',
        data: maintenanceSchedule,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar agendamento de manutenção por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar agendamento de manutenção. Tente novamente.',
      );
    }
  }

  /**
   * Find many maintenance schedules with filtering
   */
  async findMany(
    query: MaintenanceScheduleGetManyFormData,
  ): Promise<MaintenanceScheduleGetManyResponse> {
    try {
      const params = {
        where: query.where || {},
        page: query.page,
        take: query.limit,
        orderBy: query.orderBy || { createdAt: 'desc' },
        include: query.include,
      };

      const result = await this.maintenanceScheduleRepository.findMany(params);

      return {
        success: true,
        message: 'Agendamentos de manutenção carregados com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar agendamentos de manutenção:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar agendamentos de manutenção. Tente novamente.',
      );
    }
  }

  // =====================
  // BATCH OPERATIONS
  // =====================

  /**
   * Batch create maintenance schedules
   */
  async batchCreate(
    data: MaintenanceScheduleBatchCreateFormData,
    include?: MaintenanceScheduleInclude,
    userId?: string,
  ): Promise<MaintenanceScheduleBatchCreateResponse<MaintenanceScheduleCreateFormData>> {
    try {
      const results = {
        success: [] as MaintenanceSchedule[],
        failed: [] as {
          data: MaintenanceScheduleCreateFormData;
          error: string;
          errorCode: string;
          index: number;
        }[],
        totalCreated: 0,
        totalFailed: 0,
      };

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Process each maintenance schedule individually to capture specific errors
        for (const [index, scheduleData] of data.maintenanceSchedules.entries()) {
          try {
            // Validate entity
            await this.maintenanceScheduleValidation(scheduleData, undefined, tx);

            // Calculate next run date if not provided
            if (!scheduleData.nextRun) {
              const nextRun = this.calculateNextRunDate(scheduleData);
              if (nextRun) {
                scheduleData.nextRun = nextRun;
              }
            }

            // Create the maintenance schedule
            const newMaintenanceSchedule =
              await this.maintenanceScheduleRepository.createWithTransaction(tx, scheduleData);

            // Log creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MAINTENANCE_SCHEDULE,
              entityId: newMaintenanceSchedule.id,
              action: CHANGE_ACTION.CREATE,
              entity: extractEssentialFields(
                newMaintenanceSchedule,
                getEssentialFields(
                  ENTITY_TYPE.MAINTENANCE_SCHEDULE,
                ) as (keyof MaintenanceSchedule)[],
              ),
              reason: 'Agendamento de manutenção criado em operação de lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            // Create the first maintenance if nextRun is set and schedule is active
            if (newMaintenanceSchedule.isActive && newMaintenanceSchedule.nextRun) {
              await this.createInitialMaintenanceFromSchedule(newMaintenanceSchedule, userId, tx);
            }

            // If include is specified, fetch the maintenance schedule with included relations
            const finalMaintenanceSchedule = include
              ? await this.maintenanceScheduleRepository.findByIdWithTransaction(
                  tx,
                  newMaintenanceSchedule.id,
                  { include },
                )
              : newMaintenanceSchedule;

            if (finalMaintenanceSchedule) {
              results.success.push(finalMaintenanceSchedule);
            } else {
              // This should not happen, but handle it gracefully
              results.success.push(newMaintenanceSchedule);
            }
            results.totalCreated++;
          } catch (error) {
            results.failed.push({
              data: scheduleData,
              error:
                error instanceof Error
                  ? error.message
                  : 'Erro desconhecido ao criar agendamento de manutenção',
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
          ? '1 agendamento de manutenção criado com sucesso'
          : `${results.totalCreated} agendamentos de manutenção criados com sucesso`;
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
      this.logger.error('Erro na criação em lote de agendamentos de manutenção:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na criação em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch update maintenance schedules
   */
  async batchUpdate(
    data: MaintenanceScheduleBatchUpdateFormData,
    include?: MaintenanceScheduleInclude,
    userId?: string,
  ): Promise<MaintenanceScheduleBatchUpdateResponse<MaintenanceScheduleUpdateFormData>> {
    try {
      const results = {
        success: [] as MaintenanceSchedule[],
        failed: [] as {
          data: MaintenanceScheduleUpdateFormData & { id: string };
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
        for (const [index, updateData] of data.maintenanceSchedules.entries()) {
          try {
            // Get existing maintenance schedule
            const existingMaintenanceSchedule =
              await this.maintenanceScheduleRepository.findByIdWithTransaction(tx, updateData.id);

            if (!existingMaintenanceSchedule) {
              results.failed.push({
                data: { ...updateData.data, id: updateData.id },
                error: 'Agendamento de manutenção não encontrado. Verifique se o ID está correto.',
                errorCode: 'NOT_FOUND',
                index,
                id: updateData.id,
              });
              results.totalFailed++;
              continue;
            }

            // Validate entity
            await this.maintenanceScheduleValidation(updateData.data, updateData.id, tx);

            // Update the maintenance schedule
            const updatedMaintenanceSchedule =
              await this.maintenanceScheduleRepository.updateWithTransaction(
                tx,
                updateData.id,
                updateData.data,
              );

            // Log changes
            const fieldsToTrack = [
              'name',
              'description',
              'itemId',
              'frequency',
              'frequencyCount',
              'isActive',
              'nextRun',
              'lastRun',
              'maintenanceItemsConfig',
            ];
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MAINTENANCE_SCHEDULE,
              entityId: updateData.id,
              oldEntity: existingMaintenanceSchedule,
              newEntity: updatedMaintenanceSchedule,
              fieldsToTrack,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // If include is specified, fetch the maintenance schedule with included relations
            const finalMaintenanceSchedule = include
              ? await this.maintenanceScheduleRepository.findByIdWithTransaction(
                  tx,
                  updateData.id,
                  { include },
                )
              : updatedMaintenanceSchedule;

            if (finalMaintenanceSchedule) {
              results.success.push(finalMaintenanceSchedule);
            } else {
              // This should not happen, but handle it gracefully
              results.success.push(updatedMaintenanceSchedule);
            }
            results.totalUpdated++;
          } catch (error) {
            results.failed.push({
              data: { ...updateData.data, id: updateData.id },
              error:
                error instanceof Error
                  ? error.message
                  : 'Erro desconhecido ao atualizar agendamento de manutenção',
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
          ? '1 agendamento de manutenção atualizado com sucesso'
          : `${results.totalUpdated} agendamentos de manutenção atualizados com sucesso`;
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
      this.logger.error('Erro na atualização em lote de agendamentos de manutenção:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na atualização em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete maintenance schedules
   */
  async batchDelete(
    data: MaintenanceScheduleBatchDeleteFormData,
    userId?: string,
  ): Promise<MaintenanceScheduleBatchDeleteResponse> {
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
        for (const [index, maintenanceScheduleId] of data.maintenanceScheduleIds.entries()) {
          try {
            // Get maintenance schedule before deletion for logging
            const maintenanceSchedule =
              await this.maintenanceScheduleRepository.findByIdWithTransaction(
                tx,
                maintenanceScheduleId,
              );

            if (!maintenanceSchedule) {
              results.failed.push({
                id: maintenanceScheduleId,
                error: 'Agendamento de manutenção não encontrado. Verifique se o ID está correto.',
                errorCode: 'NOT_FOUND',
                index,
                data: { id: maintenanceScheduleId },
              });
              results.totalFailed++;
              continue;
            }

            // Log deletion
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MAINTENANCE_SCHEDULE,
              entityId: maintenanceScheduleId,
              action: CHANGE_ACTION.DELETE,
              oldEntity: extractEssentialFields(
                maintenanceSchedule,
                getEssentialFields(
                  ENTITY_TYPE.MAINTENANCE_SCHEDULE,
                ) as (keyof MaintenanceSchedule)[],
              ),
              reason: 'Agendamento de manutenção excluído em operação de lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              transaction: tx,
            });

            // Delete the maintenance schedule
            await this.maintenanceScheduleRepository.deleteWithTransaction(
              tx,
              maintenanceScheduleId,
            );
            results.success.push({ id: maintenanceScheduleId, deleted: true });
            results.totalDeleted++;
          } catch (error) {
            results.failed.push({
              id: maintenanceScheduleId,
              error:
                error instanceof Error
                  ? error.message
                  : 'Erro desconhecido ao excluir agendamento de manutenção',
              errorCode: error instanceof NotFoundException ? 'NOT_FOUND' : 'UNKNOWN_ERROR',
              index,
              data: { id: maintenanceScheduleId },
            });
            results.totalFailed++;
          }
        }
      });

      const successMessage =
        results.totalDeleted === 1
          ? '1 agendamento de manutenção excluído com sucesso'
          : `${results.totalDeleted} agendamentos de manutenção excluídos com sucesso`;
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
      this.logger.error('Erro na exclusão em lote de agendamentos de manutenção:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
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
      this.logger.log(
        `Processing maintenance schedule finish auto-creation for ${finishedSchedule.id}`,
      );

      // Check if this schedule is active and can generate next instances
      if (!finishedSchedule.isActive) {
        this.logger.log(`Schedule ${finishedSchedule.id} is inactive, skipping auto-creation`);
        return;
      }

      // Calculate the next run date
      const nextRunDate = this.calculateNextRunDate(
        finishedSchedule,
        finishedSchedule.finishedAt || new Date(),
      );

      if (!nextRunDate) {
        this.logger.log(
          `No next run date calculated for schedule ${finishedSchedule.id} - skipping auto-creation`,
        );
        return;
      }

      // Create the next schedule instance
      const newScheduleData: any = {
        name: finishedSchedule.name,
        description: finishedSchedule.description,
        itemId: finishedSchedule.itemId,
        frequency: finishedSchedule.frequency,
        frequencyCount: finishedSchedule.frequencyCount,
        isActive: finishedSchedule.isActive,
        maintenanceItemsConfig: finishedSchedule.maintenanceItemsConfig,

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
      const newSchedule = await this.maintenanceScheduleRepository.createWithTransaction(
        tx || this.prisma,
        newScheduleData,
      );

      // Log the auto-creation
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.MAINTENANCE_SCHEDULE,
        entityId: newSchedule.id,
        action: CHANGE_ACTION.CREATE,
        entity: extractEssentialFields(
          newSchedule,
          getEssentialFields(ENTITY_TYPE.MAINTENANCE_SCHEDULE) as (keyof MaintenanceSchedule)[],
        ),
        reason: `Agendamento criado automaticamente após finalização do agendamento ${finishedSchedule.id}`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
        transaction: tx,
      });

      this.logger.log(
        `Successfully created new maintenance schedule ${newSchedule.id} for next run on ${nextRunDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to auto-create next maintenance schedule for ${finishedSchedule.id}:`,
        error,
      );
      // Don't throw error to not prevent schedule finish
    }
  }

  /**
   * Public method to get active schedules
   */
  async getActiveSchedules(): Promise<MaintenanceSchedule[]> {
    try {
      return await this.maintenanceScheduleRepository.findActiveSchedules();
    } catch (error) {
      this.logger.error('Error getting active maintenance schedules:', error);
      throw error;
    }
  }

  /**
   * Public method to get due schedules
   */
  async getDueSchedules(upToDate?: Date): Promise<MaintenanceSchedule[]> {
    try {
      return await this.maintenanceScheduleRepository.findDueSchedules(upToDate);
    } catch (error) {
      this.logger.error('Error getting due maintenance schedules:', error);
      throw error;
    }
  }

  /**
   * Public method to get overdue schedules
   */
  async getOverdueSchedules(): Promise<MaintenanceSchedule[]> {
    try {
      return await this.maintenanceScheduleRepository.findOverdueSchedules();
    } catch (error) {
      this.logger.error('Error getting overdue maintenance schedules:', error);
      throw error;
    }
  }

  /**
   * Create the initial maintenance from a newly created schedule
   */
  private async createInitialMaintenanceFromSchedule(
    schedule: MaintenanceSchedule,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      this.logger.log(
        `Creating initial maintenance for schedule ${schedule.id} with nextRun: ${schedule.nextRun}`,
      );

      // Generate unique name by appending scheduled date
      const formattedDate = schedule.nextRun.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const uniqueName = `${schedule.name} - ${formattedDate}`;

      // Prepare maintenance data based on the schedule configuration
      const maintenanceData: any = {
        name: uniqueName,
        description: schedule.description
          ? `${schedule.description}\n\nManutenção criada automaticamente pelo agendamento.`
          : 'Manutenção criada automaticamente pelo agendamento.',
        itemId: schedule.itemId,
        status: MAINTENANCE_STATUS.PENDING,
        scheduledFor: schedule.nextRun,
        maintenanceScheduleId: schedule.id,
        itemsNeeded: schedule.maintenanceItemsConfig || [],
      };

      // Create the maintenance using the maintenance service within the same transaction
      await this.maintenanceService.createWithinTransaction(
        maintenanceData,
        tx || this.prisma,
        undefined,
        userId,
      );

      this.logger.log(`Successfully created initial maintenance for schedule ${schedule.id}`);
    } catch (error) {
      this.logger.error(`Failed to create initial maintenance for schedule ${schedule.id}:`, error);
      // Don't throw error to prevent schedule creation from failing
      // The schedule is still created, but the first maintenance wasn't
    }
  }

  /**
   * Handle maintenance completion - create the next maintenance based on the schedule
   */
  async handleMaintenanceCompletion(
    scheduleId: string,
    completedMaintenance: any,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    this.logger.log(
      `[MAINTENANCE COMPLETION] Starting handler for schedule ${scheduleId}, maintenance: ${completedMaintenance.id}`,
    );

    try {
      // Get the schedule details
      const schedule = await (tx || this.prisma).maintenanceSchedule.findUnique({
        where: { id: scheduleId },
      });

      if (!schedule) {
        this.logger.error(
          `[MAINTENANCE COMPLETION] Schedule ${scheduleId} not found! Cannot create next maintenance.`,
        );
        return;
      }

      this.logger.log(
        `[MAINTENANCE COMPLETION] Schedule found: ${schedule.name}, frequency: ${schedule.frequency}, isActive: ${schedule.isActive}`,
      );

      // Check if schedule is still active
      if (!schedule.isActive) {
        this.logger.warn(
          `[MAINTENANCE COMPLETION] Schedule ${scheduleId} is not active, skipping next maintenance creation`,
        );
        return;
      }

      // Calculate next run date based on the completed maintenance's actual completion date
      // This allows the schedule to adjust based on when maintenances are actually finished
      // If a maintenance scheduled for 10/10 is finished on 15/10 and it's monthly,
      // the next one will be created for 15/11 instead of 10/11
      const baseDate = completedMaintenance.finishedAt || new Date();
      this.logger.log(
        `[MAINTENANCE COMPLETION] Calculating next run from completion date: ${baseDate}`,
      );

      const nextRunDate = this.calculateNextRunDate(schedule, baseDate);

      if (!nextRunDate) {
        this.logger.warn(
          `[MAINTENANCE COMPLETION] No next run date calculated for schedule ${scheduleId} (frequency: ${schedule.frequency}). This might be a ONCE schedule.`,
        );
        return;
      }

      this.logger.log(
        `[MAINTENANCE COMPLETION] Next run date calculated: ${nextRunDate.toISOString()}`,
      );

      // Prepare schedule update data - update nextRun, lastRun, and date configuration fields
      // based on the completion date to adjust the schedule
      const scheduleUpdateData: any = {
        nextRun: nextRunDate,
        lastRun: completedMaintenance.finishedAt || new Date(),
      };

      // Update the schedule's date configuration fields based on the completion date
      // This ensures the schedule adjusts to when maintenances are actually completed
      if (schedule.frequency === SCHEDULE_FREQUENCY.WEEKLY) {
        // For weekly schedules, update dayOfWeek to match the completion date's day of week
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
        this.logger.log(
          `[MAINTENANCE COMPLETION] Updating schedule dayOfWeek to ${scheduleUpdateData.dayOfWeek} based on completion date`,
        );
      } else if (schedule.frequency === SCHEDULE_FREQUENCY.MONTHLY) {
        // For monthly schedules, update dayOfMonth to match the completion date's day
        scheduleUpdateData.dayOfMonth = baseDate.getDate();
        this.logger.log(
          `[MAINTENANCE COMPLETION] Updating schedule dayOfMonth to ${scheduleUpdateData.dayOfMonth} based on completion date`,
        );
      } else if (schedule.frequency === SCHEDULE_FREQUENCY.ANNUAL) {
        // For annual schedules, update both month and dayOfMonth
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
        this.logger.log(
          `[MAINTENANCE COMPLETION] Updating schedule month to ${scheduleUpdateData.month} and dayOfMonth to ${scheduleUpdateData.dayOfMonth} based on completion date`,
        );
      }

      // Update the schedule with the new date configuration
      const updatedSchedule = await (tx || this.prisma).maintenanceSchedule.update({
        where: { id: scheduleId },
        data: scheduleUpdateData,
      });

      this.logger.log(
        `[MAINTENANCE COMPLETION] Schedule updated: nextRun=${updatedSchedule.nextRun?.toISOString()}, lastRun=${updatedSchedule.lastRun?.toISOString()}`,
      );

      // Prepare maintenance data for the next occurrence
      // Generate unique name by appending scheduled date
      const formattedDate = nextRunDate.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const uniqueName = `${schedule.name} - ${formattedDate}`;

      const maintenanceData: any = {
        name: uniqueName,
        description: schedule.description
          ? `${schedule.description}\n\nManutenção criada automaticamente pelo agendamento.`
          : 'Manutenção criada automaticamente pelo agendamento.',
        itemId: schedule.itemId,
        status: MAINTENANCE_STATUS.PENDING,
        scheduledFor: nextRunDate,
        maintenanceScheduleId: schedule.id,
        itemsNeeded: schedule.maintenanceItemsConfig || [],
      };

      this.logger.log(
        `[MAINTENANCE COMPLETION] Creating next maintenance: ${maintenanceData.name} for ${nextRunDate.toISOString()}`,
      );

      // Create the next maintenance using the maintenance service within the same transaction
      const createdMaintenance = await this.maintenanceService.createWithinTransaction(
        maintenanceData,
        tx || this.prisma,
        undefined,
        userId,
      );

      this.logger.log(
        `[MAINTENANCE COMPLETION] ✅ SUCCESS! Created next maintenance ${createdMaintenance.id} for schedule ${scheduleId}, scheduled for ${nextRunDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(`[MAINTENANCE COMPLETION] ❌ FAILED for schedule ${scheduleId}:`, error);
      this.logger.error(`[MAINTENANCE COMPLETION] Error stack:`, error.stack);
      // Don't throw error to prevent maintenance status update from failing
      // The maintenance is still completed, but the next one wasn't created
      // Log the error for investigation
    }
  }
}
