import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { MaintenanceRepository } from './repositories/maintenance/maintenance.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_ACTION,
  MAINTENANCE_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
} from '../../../constants/enums';
import { MAINTENANCE_STATUS_ORDER } from '../../../constants/sortOrders';
import {
  MaintenanceGetManyFormData,
  MaintenanceInclude,
  MaintenanceCreateFormData,
  MaintenanceUpdateFormData,
  MaintenanceBatchCreateFormData,
  MaintenanceBatchUpdateFormData,
  MaintenanceBatchDeleteFormData,
} from '../../../schemas/maintenance';
import {
  Maintenance,
  MaintenanceGetUniqueResponse,
  MaintenanceGetManyResponse,
  MaintenanceCreateResponse,
  MaintenanceUpdateResponse,
  MaintenanceDeleteResponse,
  MaintenanceBatchCreateResponse,
  MaintenanceBatchUpdateResponse,
  MaintenanceBatchDeleteResponse,
} from '../../../types';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import { MaintenanceScheduleService } from './maintenance-schedule.service';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly maintenanceRepository: MaintenanceRepository,
    private readonly changelogService: ChangeLogService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ActivityService))
    private readonly activityService: ActivityService,
    @Inject(forwardRef(() => MaintenanceScheduleService))
    private readonly maintenanceScheduleService: MaintenanceScheduleService,
  ) {}

  // =====================
  // VALIDATION HELPERS
  // =====================

  private async validateMaintenance(
    data: Partial<MaintenanceCreateFormData | MaintenanceUpdateFormData>,
    existingId?: string,
  ): Promise<void> {
    // Validar campos obrigatórios
    if ('name' in data && !data.name) {
      throw new BadRequestException('Nome da manutenção é obrigatório.');
    }

    // Validar nome único (excluindo a manutenção atual em caso de atualização)
    if (data.name) {
      const existingWithName = await this.maintenanceRepository.findMany({
        where: {
          name: data.name,
          ...(existingId && { NOT: { id: existingId } }),
        },
        take: 1,
      });

      if (existingWithName.data.length > 0) {
        throw new BadRequestException('Já existe uma manutenção com este nome.');
      }
    }

    // Validar data de agendamento para novas manutenções
    if (data.scheduledFor && !existingId) {
      const scheduledDate = new Date(data.scheduledFor);
      const now = new Date();

      // Zerar as horas para comparar apenas datas
      now.setHours(0, 0, 0, 0);
      scheduledDate.setHours(0, 0, 0, 0);

      if (scheduledDate < now) {
        throw new BadRequestException(
          'A data de agendamento deve ser no futuro para novas manutenções.',
        );
      }
    }

    // Validar status
    if (
      data.status &&
      !Object.values(MAINTENANCE_STATUS).includes(data.status as MAINTENANCE_STATUS)
    ) {
      throw new BadRequestException('Status de manutenção inválido.');
    }

    // Validar transições de status (se atualizando)
    if (existingId && data.status) {
      const existing = await this.maintenanceRepository.findById(existingId);
      if (existing) {
        this.validateStatusTransition(existing.status, data.status as MAINTENANCE_STATUS);
      }
    }
  }

  private validateStatusTransition(
    fromStatus: MAINTENANCE_STATUS,
    toStatus: MAINTENANCE_STATUS,
  ): void {
    const validTransitions: Record<MAINTENANCE_STATUS, MAINTENANCE_STATUS[]> = {
      [MAINTENANCE_STATUS.PENDING]: [
        MAINTENANCE_STATUS.IN_PROGRESS,
        MAINTENANCE_STATUS.CANCELLED,
        MAINTENANCE_STATUS.OVERDUE,
      ],
      [MAINTENANCE_STATUS.IN_PROGRESS]: [
        MAINTENANCE_STATUS.COMPLETED,
        MAINTENANCE_STATUS.CANCELLED,
      ],
      [MAINTENANCE_STATUS.COMPLETED]: [],
      [MAINTENANCE_STATUS.CANCELLED]: [],
      [MAINTENANCE_STATUS.OVERDUE]: [MAINTENANCE_STATUS.IN_PROGRESS, MAINTENANCE_STATUS.CANCELLED],
    };

    const allowedTransitions = validTransitions[fromStatus] || [];
    if (!allowedTransitions.includes(toStatus)) {
      throw new BadRequestException(`Transição de status inválida: ${fromStatus} → ${toStatus}`);
    }
  }

  // =====================
  // MAINTENANCE QUERY OPERATIONS
  // =====================

  async findMany(query: MaintenanceGetManyFormData): Promise<MaintenanceGetManyResponse> {
    try {
      const result = await this.maintenanceRepository.findMany(query);

      return {
        success: true,
        message: 'Manutenções encontradas com sucesso',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar manutenções:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar manutenções. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: MaintenanceInclude): Promise<MaintenanceGetUniqueResponse> {
    try {
      const maintenance = await this.maintenanceRepository.findById(id, { include });

      if (!maintenance) {
        throw new NotFoundException('Manutenção não encontrada.');
      }

      return {
        success: true,
        message: 'Manutenção encontrada com sucesso',
        data: maintenance,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar manutenção:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar manutenção. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // MAINTENANCE CRUD OPERATIONS
  // =====================

  async create(
    data: MaintenanceCreateFormData,
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceCreateResponse> {
    try {
      const maintenance = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade
        await this.validateMaintenance(data);

        // Set default scheduled date if not provided and not linked to a schedule
        if (!data.scheduledFor && !data.maintenanceScheduleId) {
          data.scheduledFor = new Date(); // Default to now for manual maintenances
        }

        // Check for late maintenance status
        if (
          data.scheduledFor &&
          new Date(data.scheduledFor) < new Date() &&
          (data.status as MAINTENANCE_STATUS) === MAINTENANCE_STATUS.PENDING
        ) {
          data.status = MAINTENANCE_STATUS.OVERDUE;
        }

        // Set statusOrder based on status
        const status = (data.status as MAINTENANCE_STATUS) || MAINTENANCE_STATUS.PENDING;
        (data as any).statusOrder = MAINTENANCE_STATUS_ORDER[status];

        const newMaintenance = await this.maintenanceRepository.create(
          data,
          include ? { include } : undefined,
        );

        // Create changelog entry using helper
        await logEntityChange({
          changeLogService: this.changelogService,
          entityType: ENTITY_TYPE.MAINTENANCE,
          entityId: newMaintenance.id,
          action: CHANGE_ACTION.CREATE,
          entity: newMaintenance,
          reason: 'Nova manutenção criada no sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newMaintenance;
      });

      return {
        success: true,
        message: 'Manutenção criada com sucesso',
        data: maintenance,
      };
    } catch (error) {
      this.logger.error('Erro ao criar manutenção:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar manutenção. Por favor, tente novamente.',
      );
    }
  }

  async update(
    id: string,
    data: MaintenanceUpdateFormData,
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceUpdateResponse> {
    try {
      const updatedMaintenance = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar manutenção existente com relações para tracking
        const existing = await this.maintenanceRepository.findById(id, {
          include: {
            item: true,
            maintenanceSchedule: true,
            itemsNeeded: true,
          },
        });

        if (!existing) {
          throw new NotFoundException('Manutenção não encontrada.');
        }

        // Validar entidade
        await this.validateMaintenance(data, id);

        // Check for late maintenance status
        if (
          data.scheduledFor &&
          new Date(data.scheduledFor) < new Date() &&
          (data.status as MAINTENANCE_STATUS) === MAINTENANCE_STATUS.PENDING
        ) {
          data.status = MAINTENANCE_STATUS.OVERDUE;
        }

        // Set statusOrder when status changes
        if (data.status && data.status !== existing.status) {
          (data as any).statusOrder = MAINTENANCE_STATUS_ORDER[data.status as MAINTENANCE_STATUS];
        }

        // Handle status transitions for time tracking
        if (data.status) {
          // Starting maintenance - set startedAt
          if (
            data.status === MAINTENANCE_STATUS.IN_PROGRESS &&
            (existing.status === MAINTENANCE_STATUS.PENDING ||
              existing.status === MAINTENANCE_STATUS.OVERDUE)
          ) {
            (data as any).startedAt = new Date();
          }

          // Completing maintenance - set finishedAt and calculate timeTaken
          if (
            data.status === MAINTENANCE_STATUS.COMPLETED &&
            existing.status !== MAINTENANCE_STATUS.COMPLETED
          ) {
            const finishedAt = new Date();
            (data as any).finishedAt = finishedAt;

            // Calculate time taken if we have a start time
            if (existing.startedAt) {
              const timeTakenMs = finishedAt.getTime() - new Date(existing.startedAt).getTime();
              (data as any).timeTaken = Math.round(timeTakenMs / 1000); // Convert to seconds
            }

            await this.handleMaintenanceCompletion(existing, userId, tx);

            // Notify the schedule that this maintenance was completed (if linked to a schedule)
            if (existing.maintenanceScheduleId) {
              await this.notifyScheduleOfCompletion(
                existing.maintenanceScheduleId,
                existing,
                userId,
                tx,
              );
            }
          }
        }

        const updated = await this.maintenanceRepository.updateWithTransaction(
          tx,
          id,
          data,
          include ? { include } : undefined,
        );

        // Track all field changes using the helper
        const fieldsToTrack = [
          'name',
          'description',
          'status',
          'statusOrder',
          'itemId',
          'maintenanceScheduleId',
          'scheduledFor',
          'startedAt',
          'finishedAt',
          'timeTaken',
        ];

        // Track field changes
        await trackAndLogFieldChanges({
          changeLogService: this.changelogService,
          entityType: ENTITY_TYPE.MAINTENANCE,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: fieldsToTrack.filter(field => data.hasOwnProperty(field)),
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Track relationship changes with descriptive messages
        if (data.hasOwnProperty('itemId') && existing.itemId !== updated.itemId) {
          const oldItem = existing.item?.name || 'Nenhum';
          const newItem = updated.item?.name || 'Nenhum';
          await this.changelogService.logChange({
            entityType: ENTITY_TYPE.MAINTENANCE,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'item',
            oldValue: oldItem,
            newValue: newItem,
            reason: `Item alterado de "${oldItem}" para "${newItem}"`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        // Track maintenance schedule changes
        if (
          data.hasOwnProperty('maintenanceScheduleId') &&
          existing.maintenanceScheduleId !== updated.maintenanceScheduleId
        ) {
          const oldSchedule = existing.maintenanceSchedule?.name || 'Nenhum';
          const newSchedule = updated.maintenanceSchedule?.name || 'Nenhum';
          await this.changelogService.logChange({
            entityType: ENTITY_TYPE.MAINTENANCE,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'maintenanceSchedule',
            oldValue: oldSchedule,
            newValue: newSchedule,
            reason: `Cronograma alterado de "${oldSchedule}" para "${newSchedule}"`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        // NOTE: Truck and mechanic tracking removed as these properties don't exist on the Maintenance model
        // The Maintenance model only has itemId/item relation. If truck/mechanic tracking is needed,
        // the schema would need to be updated to include these fields.

        return updated;
      });

      return {
        success: true,
        message: 'Manutenção atualizada com sucesso',
        data: updatedMaintenance,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar manutenção:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar manutenção. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<MaintenanceDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await this.maintenanceRepository.findById(id);
        if (!existing) {
          throw new NotFoundException('Manutenção não encontrada.');
        }

        await this.maintenanceRepository.delete(id);

        // Create changelog entry using helper
        await logEntityChange({
          changeLogService: this.changelogService,
          entityType: ENTITY_TYPE.MAINTENANCE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason: 'Manutenção excluída do sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Manutenção removida com sucesso',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao remover manutenção:', error);
      throw new InternalServerErrorException(
        'Erro ao remover manutenção. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Specific endpoint to finish a maintenance, which will notify the schedule if applicable
   */
  async finish(
    id: string,
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceUpdateResponse> {
    try {
      // Simply delegate to the update method with status COMPLETED
      // The update method already handles all the logic for completing a maintenance
      // including handleMaintenanceCompletion
      return await this.update(id, { status: MAINTENANCE_STATUS.COMPLETED }, include, userId);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao concluir manutenção:', error);
      throw new InternalServerErrorException(
        'Erro ao concluir manutenção. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // MAINTENANCE BATCH OPERATIONS
  // =====================

  async batchCreate(
    data: MaintenanceBatchCreateFormData,
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceBatchCreateResponse<MaintenanceCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const errors: Array<{ index: number; error: string; data?: MaintenanceCreateFormData }> =
          [];
        const validItems: Array<{ index: number; data: MaintenanceCreateFormData }> = [];

        // Validate each item
        for (let i = 0; i < data.maintenances.length; i++) {
          const item = data.maintenances[i];
          try {
            // Validar entidade
            await this.validateMaintenance(item);

            // Check for late maintenance status
            const processedItem = { ...item };
            if (
              item.scheduledFor &&
              new Date(item.scheduledFor) < new Date() &&
              (item.status as MAINTENANCE_STATUS) === MAINTENANCE_STATUS.PENDING
            ) {
              processedItem.status = MAINTENANCE_STATUS.OVERDUE;
            }

            validItems.push({ index: i, data: processedItem });
          } catch (error) {
            errors.push({
              index: i,
              error:
                error instanceof BadRequestException || error instanceof NotFoundException
                  ? error.message
                  : 'Erro ao validar manutenção.',
              data: item,
            });
          }
        }

        // If all items have errors, throw early
        if (errors.length === data.maintenances.length) {
          throw new BadRequestException(
            'Nenhuma manutenção pôde ser criada devido a erros de validação.',
          );
        }

        // Process only valid items
        const processedData = validItems.map(item => item.data);
        const createResult = await this.maintenanceRepository.createMany(processedData, {
          include,
        });

        // Create changelog entries for successful creates
        for (const maintenance of createResult.success) {
          await logEntityChange({
            changeLogService: this.changelogService,
            entityType: ENTITY_TYPE.MAINTENANCE,
            entityId: maintenance.id,
            action: CHANGE_ACTION.CREATE,
            entity: maintenance,
            reason: 'Manutenção criada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

        // Combine validation errors with execution errors
        const allFailed = [
          ...errors.map(e => ({
            index: e.index,
            error: e.error,
            data: e.data!,
          })),
          ...createResult.failed.map(f => ({
            index: validItems[f.index ?? 0]?.index ?? f.index ?? 0,
            ...(f.id && { id: f.id }),
            error: f.error,
            data: f.data,
          })),
        ];

        return {
          success: createResult.success,
          failed: allFailed,
          totalProcessed: data.maintenances.length,
          totalSuccess: createResult.totalCreated,
          totalFailed: allFailed.length,
        };
      });

      return {
        success: true,
        message: `${result.totalSuccess} manutenções criadas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao criar manutenções em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar manutenções em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: MaintenanceBatchUpdateFormData,
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceBatchUpdateResponse<MaintenanceUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const errors: Array<{ index: number; id?: string; error: string; data: any }> = [];
        const validItems: Array<{
          index: number;
          id: string;
          data: MaintenanceUpdateFormData;
          existing: any;
        }> = [];

        // Validate each item
        for (let i = 0; i < data.maintenances.length; i++) {
          const item = data.maintenances[i];
          try {
            // Check if maintenance exists and get full data for tracking
            const existing = await this.maintenanceRepository.findById(item.id, {
              include: {
                item: true,
                maintenanceSchedule: true,
                itemsNeeded: true,
              },
            });

            if (!existing) {
              errors.push({
                index: i,
                id: item.id,
                error: 'Manutenção não encontrada.',
                data: { id: item.id, data: item.data },
              });
              continue;
            }

            // Validar entidade
            await this.validateMaintenance(item.data, item.id);

            // Check for late maintenance status
            const processedData = { ...item.data };
            if (
              item.data.scheduledFor &&
              new Date(item.data.scheduledFor) < new Date() &&
              (item.data.status as MAINTENANCE_STATUS) === MAINTENANCE_STATUS.PENDING
            ) {
              processedData.status = MAINTENANCE_STATUS.OVERDUE;
            }

            validItems.push({ index: i, id: item.id, data: processedData, existing });
          } catch (error) {
            errors.push({
              index: i,
              id: item.id,
              error:
                error instanceof BadRequestException || error instanceof NotFoundException
                  ? error.message
                  : 'Erro ao validar manutenção.',
              data: { id: item.id, data: item.data },
            });
          }
        }

        // If all items have errors, throw early
        if (errors.length === data.maintenances.length) {
          throw new BadRequestException(
            'Nenhuma manutenção pôde ser atualizada devido a erros de validação.',
          );
        }

        // Process only valid items
        const processedData = validItems.map(item => ({ id: item.id, data: item.data }));
        const updateResult = await this.maintenanceRepository.updateMany(processedData, {
          include,
        });

        // Track field changes for successful updates
        const fieldsToTrack = [
          'name',
          'description',
          'status',
          'statusOrder',
          'itemId',
          'maintenanceScheduleId',
          'scheduledFor',
          'startedAt',
          'finishedAt',
          'timeTaken',
        ];

        for (const maintenance of updateResult.success) {
          // Find the corresponding valid item with existing data
          const validItem = validItems.find(v => v.id === maintenance.id);
          if (validItem) {
            // Track field changes
            await trackAndLogFieldChanges({
              changeLogService: this.changelogService,
              entityType: ENTITY_TYPE.MAINTENANCE,
              entityId: maintenance.id,
              oldEntity: validItem.existing,
              newEntity: maintenance,
              fieldsToTrack: fieldsToTrack.filter(field => validItem.data.hasOwnProperty(field)),
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // Track relationship changes with descriptive messages
            if (
              validItem.data.hasOwnProperty('itemId') &&
              validItem.existing.itemId !== maintenance.itemId
            ) {
              const oldItem = validItem.existing.item?.name || 'Nenhum';
              const newItem = maintenance.item?.name || 'Nenhum';
              await this.changelogService.logChange({
                entityType: ENTITY_TYPE.MAINTENANCE,
                entityId: maintenance.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'item',
                oldValue: oldItem,
                newValue: newItem,
                reason: `Item alterado de "${oldItem}" para "${newItem}"`,
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                triggeredById: maintenance.id,
                userId: userId || null,
                transaction: tx,
              });
            }

            // NOTE: Truck and mechanic tracking removed as these properties don't exist on the Maintenance model
            // The Maintenance model only has itemId/item relation. If truck/mechanic tracking is needed,
            // the schema would need to be updated to include these fields.
          }
        }

        // Combine validation errors with execution errors
        const allFailed = [
          ...errors.map(e => ({
            index: e.index,
            ...(e.id && { id: e.id }),
            error: e.error,
            data: e.data!,
          })),
          ...updateResult.failed.map(f => ({
            index: validItems.find(v => v.id === f.id)?.index ?? f.index ?? 0,
            ...(f.id && { id: f.id }),
            error: f.error,
            data: f.data,
          })),
        ];

        return {
          success: updateResult.success,
          failed: allFailed,
          totalProcessed: data.maintenances.length,
          totalSuccess: updateResult.totalUpdated,
          totalFailed: allFailed.length,
        };
      });

      return {
        success: true,
        message: `${result.totalSuccess} manutenções atualizadas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar manutenções em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar manutenções em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: MaintenanceBatchDeleteFormData,
    userId?: string,
  ): Promise<MaintenanceBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const errors: Array<{ index: number; id?: string; error: string; data: any }> = [];
        const validIds: string[] = [];
        const idToIndex = new Map<string, number>();
        const maintenanceMap = new Map<string, any>();

        // Validate each ID
        for (let i = 0; i < data.maintenanceIds.length; i++) {
          const id = data.maintenanceIds[i];
          idToIndex.set(id, i);

          try {
            // Check if maintenance exists
            const existing = await this.maintenanceRepository.findById(id);
            if (!existing) {
              errors.push({
                index: i,
                id,
                error: 'Manutenção não encontrada.',
                data: { id },
              });
              continue;
            }

            validIds.push(id);
            maintenanceMap.set(id, existing);
          } catch (error) {
            errors.push({
              index: i,
              id,
              error:
                error instanceof BadRequestException || error instanceof NotFoundException
                  ? error.message
                  : 'Erro ao validar manutenção.',
              data: { id },
            });
          }
        }

        // If all items have errors, throw early
        if (errors.length === data.maintenanceIds.length) {
          throw new BadRequestException(
            'Nenhuma manutenção pôde ser removida devido a erros de validação.',
          );
        }

        const deleteResult = await this.maintenanceRepository.deleteMany(validIds);

        // Create changelog entries for successful deletes
        for (const success of deleteResult.success) {
          const maintenance = maintenanceMap.get(success.id);
          if (maintenance) {
            await logEntityChange({
              changeLogService: this.changelogService,
              entityType: ENTITY_TYPE.MAINTENANCE,
              entityId: success.id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: maintenance,
              reason: 'Manutenção removida em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        // Combine validation errors with execution errors
        const allFailed = [
          ...errors.map(e => ({
            index: e.index,
            ...(e.id && { id: e.id }),
            error: e.error,
            data: e.data!,
          })),
          ...deleteResult.failed.map(f => ({
            index: idToIndex.get(f.id || '') ?? f.index ?? 0,
            ...(f.id && { id: f.id }),
            error: f.error,
            data: f.data,
          })),
        ];

        return {
          success: deleteResult.success,
          failed: allFailed,
          totalProcessed: data.maintenanceIds.length,
          totalSuccess: deleteResult.totalDeleted,
          totalFailed: allFailed.length,
        };
      });

      return {
        success: true,
        message: `${result.totalSuccess} manutenções removidas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao remover manutenções em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao remover manutenções em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchFinish(
    data: { maintenanceIds: string[] },
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceBatchUpdateResponse<MaintenanceUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const errors: Array<{ index: number; id?: string; error: string; data: any }> = [];
        const successfulMaintenances: any[] = [];
        const idToIndex = new Map<string, number>();

        // Process each maintenance ID
        for (let i = 0; i < data.maintenanceIds.length; i++) {
          const id = data.maintenanceIds[i];
          idToIndex.set(id, i);

          try {
            // Use the regular finish logic for each maintenance
            // The update method already handles all the logic properly
            const updatedMaintenance = await this.update(
              id,
              { status: MAINTENANCE_STATUS.COMPLETED },
              include,
              userId,
            );

            if (updatedMaintenance.success && updatedMaintenance.data) {
              successfulMaintenances.push(updatedMaintenance.data);
            }
          } catch (error) {
            errors.push({
              index: i,
              id,
              error:
                error instanceof BadRequestException || error instanceof NotFoundException
                  ? error.message
                  : 'Erro ao concluir manutenção.',
              data: { id },
            });
          }
        }

        return {
          success: successfulMaintenances,
          failed: errors,
          totalProcessed: data.maintenanceIds.length,
          totalSuccess: successfulMaintenances.length,
          totalFailed: errors.length,
        };
      });

      return {
        success: true,
        message: `${result.totalSuccess} manutenções concluídas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao concluir manutenções em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao concluir manutenções em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchStart(
    data: { maintenanceIds: string[] },
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceBatchUpdateResponse<MaintenanceUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const errors: Array<{ index: number; id?: string; error: string; data: any }> = [];
        const successfulMaintenances: any[] = [];
        const idToIndex = new Map<string, number>();

        // Process each maintenance ID
        for (let i = 0; i < data.maintenanceIds.length; i++) {
          const id = data.maintenanceIds[i];
          idToIndex.set(id, i);

          try {
            // Get the existing maintenance to validate status
            const existing = await this.maintenanceRepository.findById(id);

            if (!existing) {
              throw new NotFoundException('Manutenção não encontrada.');
            }

            // Validate that maintenance can be started
            if (
              existing.status !== MAINTENANCE_STATUS.PENDING &&
              existing.status !== MAINTENANCE_STATUS.OVERDUE
            ) {
              throw new BadRequestException(
                `Manutenção não pode ser iniciada. Status atual: ${existing.status}`,
              );
            }

            // Start the maintenance
            const updatedMaintenance = await this.update(
              id,
              {
                status: MAINTENANCE_STATUS.IN_PROGRESS,
                startedAt: new Date(),
              },
              include,
              userId,
            );

            if (updatedMaintenance.success && updatedMaintenance.data) {
              successfulMaintenances.push(updatedMaintenance.data);
            }
          } catch (error) {
            errors.push({
              index: i,
              id,
              error:
                error instanceof BadRequestException || error instanceof NotFoundException
                  ? error.message
                  : 'Erro ao iniciar manutenção.',
              data: { id },
            });
          }
        }

        return {
          success: successfulMaintenances,
          failed: errors,
          totalProcessed: data.maintenanceIds.length,
          totalSuccess: successfulMaintenances.length,
          totalFailed: errors.length,
        };
      });

      return {
        success: true,
        message: `${result.totalSuccess} manutenções iniciadas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao iniciar manutenções em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao iniciar manutenções em lote. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // SCHEDULE-RELATED OPERATIONS
  // =====================

  /**
   * Create a maintenance from a schedule
   * This method should be called by the MaintenanceSchedule service when it's time to create a new maintenance instance
   */
  async createFromSchedule(
    maintenanceScheduleId: string,
    scheduledFor: Date,
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<MaintenanceCreateResponse> {
    try {
      const maintenance = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // This would ideally fetch the schedule configuration, but for now we'll require
        // the caller to provide the necessary data
        const maintenanceData: MaintenanceCreateFormData = {
          name: `Manutenção agendada para ${scheduledFor.toLocaleDateString('pt-BR')}`,
          description: 'Manutenção criada automaticamente a partir de um cronograma',
          itemId: '', // This would need to be provided by the caller or fetched from schedule
          maintenanceScheduleId: maintenanceScheduleId,
          scheduledFor: scheduledFor,
          status: MAINTENANCE_STATUS.PENDING,
        };

        // Check for late maintenance status
        if (new Date(scheduledFor) < new Date()) {
          maintenanceData.status = MAINTENANCE_STATUS.OVERDUE;
        }

        const newMaintenance = await this.maintenanceRepository.createWithTransaction(
          tx,
          maintenanceData,
          include ? { include } : undefined,
        );

        // Create changelog entry using helper
        await logEntityChange({
          changeLogService: this.changelogService,
          entityType: ENTITY_TYPE.MAINTENANCE,
          entityId: newMaintenance.id,
          action: CHANGE_ACTION.CREATE,
          entity: newMaintenance,
          reason: 'Manutenção criada automaticamente a partir de um cronograma',
          triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
          userId: userId || null,
          transaction: tx,
        });

        return newMaintenance;
      });

      return {
        success: true,
        message: 'Manutenção criada com sucesso a partir do cronograma',
        data: maintenance,
      };
    } catch (error) {
      this.logger.error('Erro ao criar manutenção a partir do cronograma:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar manutenção a partir do cronograma. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Create a maintenance within an existing transaction
   * This method should be used when creating maintenance as part of another transaction (e.g., from schedule creation)
   */
  async createWithinTransaction(
    data: MaintenanceCreateFormData,
    tx: PrismaTransaction,
    include?: MaintenanceInclude,
    userId?: string,
  ): Promise<Maintenance> {
    try {
      // Validate entity
      await this.validateMaintenance(data);

      // Set default scheduled date if not provided and not linked to a schedule
      if (!data.scheduledFor && !data.maintenanceScheduleId) {
        data.scheduledFor = new Date(); // Default to now for manual maintenances
      }

      // Check for late maintenance status
      if (
        data.scheduledFor &&
        new Date(data.scheduledFor) < new Date() &&
        (data.status as MAINTENANCE_STATUS) === MAINTENANCE_STATUS.PENDING
      ) {
        data.status = MAINTENANCE_STATUS.OVERDUE;
      }

      const newMaintenance = await this.maintenanceRepository.createWithTransaction(
        tx,
        data,
        include ? { include } : undefined,
      );

      // Create changelog entry using helper
      await logEntityChange({
        changeLogService: this.changelogService,
        entityType: ENTITY_TYPE.MAINTENANCE,
        entityId: newMaintenance.id,
        action: CHANGE_ACTION.CREATE,
        entity: newMaintenance,
        reason: 'Manutenção criada automaticamente pelo agendamento',
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
        userId: userId || null,
        transaction: tx,
      });

      return newMaintenance;
    } catch (error) {
      this.logger.error('Erro ao criar manutenção dentro da transação:', error);
      throw error;
    }
  }

  /**
   * Notify the maintenance schedule that a maintenance was completed
   * This method would ideally call the MaintenanceSchedule service to handle
   * the creation of the next maintenance occurrence based on the schedule configuration
   */
  private async notifyScheduleOfCompletion(
    maintenanceScheduleId: string,
    completedMaintenance: any,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      this.logger.log(
        `Notifying schedule ${maintenanceScheduleId} of maintenance completion: ${completedMaintenance.id}`,
      );

      // Call the MaintenanceSchedule service to handle next occurrence creation
      await this.maintenanceScheduleService.handleMaintenanceCompletion(
        maintenanceScheduleId,
        completedMaintenance,
        userId,
        tx,
      );

      // Log the schedule notification in changelog
      await this.changelogService.logChange({
        entityType: ENTITY_TYPE.MAINTENANCE,
        entityId: completedMaintenance.id,
        action: CHANGE_ACTION.COMPLETE,
        field: 'scheduleNotification',
        oldValue: null,
        newValue: maintenanceScheduleId,
        reason: `Cronograma ${maintenanceScheduleId} notificado da conclusão da manutenção e próxima manutenção criada`,
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULE,
        triggeredById: maintenanceScheduleId,
        userId: userId || null,
        transaction: tx,
      });

      this.logger.log(
        `Successfully notified schedule ${maintenanceScheduleId} of maintenance completion and created next maintenance`,
      );
    } catch (error) {
      this.logger.error(`Failed to notify schedule ${maintenanceScheduleId} of completion:`, error);
      // Don't throw error to not prevent maintenance status update
      // The maintenance is still completed, but the schedule wasn't notified
    }
  }

  // =====================
  // ADDITIONAL OPERATIONS
  // =====================

  async updateMaintenanceStatuses(): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Find all pending maintenances where scheduledFor is in the past
        const lateMaintenances = await this.maintenanceRepository.findMany({
          where: {
            status: MAINTENANCE_STATUS.PENDING,
            scheduledFor: {
              lt: new Date(),
            },
          },
        });

        // Update them to late status and track changes
        for (const maintenance of lateMaintenances.data) {
          const updated = await this.maintenanceRepository.update(maintenance.id, {
            status: MAINTENANCE_STATUS.OVERDUE,
          });

          // Track the status change
          await this.changelogService.logChange({
            entityType: ENTITY_TYPE.MAINTENANCE,
            entityId: maintenance.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'status',
            oldValue: MAINTENANCE_STATUS.PENDING,
            newValue: MAINTENANCE_STATUS.OVERDUE,
            reason: 'Status atualizado automaticamente - manutenção atrasada',
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: 'system',
            userId: null,
            transaction: tx,
          });
        }
      });
    } catch (error) {
      this.logger.error('Erro ao atualizar status das manutenções:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar status das manutenções. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Handle maintenance completion by creating outbound activities for consumed items
   */
  private async handleMaintenanceCompletion(
    maintenance: any,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      if (!maintenance.itemsNeeded || maintenance.itemsNeeded.length === 0) {
        this.logger.log(`Maintenance ${maintenance.id} completed with no items needed`);
        return;
      }

      this.logger.log(
        `Processing maintenance completion for ${maintenance.name} with ${maintenance.itemsNeeded.length} items`,
      );

      // Create outbound activities for each maintenance item
      for (const maintenanceItem of maintenance.itemsNeeded) {
        if (maintenanceItem.quantity > 0) {
          await this.activityService.create(
            {
              itemId: maintenanceItem.itemId,
              quantity: maintenanceItem.quantity,
              operation: ACTIVITY_OPERATION.OUTBOUND,
              reason: ACTIVITY_REASON.MAINTENANCE,
              userId: userId || null,
            },
            undefined,
            userId,
          );

          this.logger.log(
            `Created outbound activity for item ${maintenanceItem.itemId}: ${maintenanceItem.quantity} units consumed in maintenance ${maintenance.name}`,
          );
        }
      }

      this.logger.log(
        `Successfully processed ${maintenance.itemsNeeded.length} maintenance items for completion`,
      );
    } catch (error) {
      this.logger.error(`Failed to process maintenance completion for ${maintenance.id}:`, error);
      // Don't throw error to not prevent maintenance status update
    }
  }
}
