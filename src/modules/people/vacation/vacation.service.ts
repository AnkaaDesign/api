// vacation.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { VacationRepository, PrismaTransaction } from './repositories/vacation.repository';
import type {
  VacationBatchCreateResponse,
  VacationBatchDeleteResponse,
  VacationBatchUpdateResponse,
  VacationCreateResponse,
  VacationDeleteResponse,
  VacationGetManyResponse,
  VacationGetUniqueResponse,
  VacationUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import type {
  VacationCreateFormData,
  VacationUpdateFormData,
  VacationGetManyFormData,
  VacationBatchCreateFormData,
  VacationBatchUpdateFormData,
  VacationBatchDeleteFormData,
  VacationInclude,
} from '../../../schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  VACATION_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import {
  isValidVacationStatusTransition,
  getVacationStatusOrder,
  getVacationTypeOrder,
} from '../../../utils';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';

@Injectable()
export class VacationService {
  private readonly logger = new Logger(VacationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vacationRepository: VacationRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Buscar muitas férias com filtros
   */
  async findMany(query: VacationGetManyFormData): Promise<VacationGetManyResponse> {
    try {
      const result = await this.vacationRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Férias carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar férias:', error);
      throw new InternalServerErrorException('Erro ao buscar férias. Por favor, tente novamente.');
    }
  }

  /**
   * Buscar uma férias por ID
   */
  async findById(id: string, include?: VacationInclude): Promise<VacationGetUniqueResponse> {
    try {
      const vacation = await this.vacationRepository.findById(id, { include });

      if (!vacation) {
        throw new NotFoundException('Férias não encontrada.');
      }

      return { success: true, data: vacation, message: 'Férias carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar férias por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar férias. Por favor, tente novamente.');
    }
  }

  /**
   * Criar novas férias
   */
  async create(
    data: VacationCreateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationCreateResponse> {
    try {
      const vacation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.vacationValidation(data, undefined, tx);

        // Criar as férias
        const newVacation = await this.vacationRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar no changelog
        const vacationPeriod = `${new Date(newVacation.startAt).toLocaleDateString('pt-BR')} a ${new Date(newVacation.endAt).toLocaleDateString('pt-BR')}`;
        const vacationType = data.isCollective
          ? 'Férias coletivas'
          : `Férias individuais para ${newVacation.user?.name || 'funcionário'}`;

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION,
          entityId: newVacation.id,
          action: CHANGE_ACTION.CREATE,
          entity: newVacation,
          reason: `Nova solicitação de férias criada: ${vacationType} - ${vacationPeriod}`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return newVacation;
      });

      return {
        success: true,
        message: 'Férias criada com sucesso.',
        data: vacation,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar férias:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar férias. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar férias
   */
  async update(
    id: string,
    data: VacationUpdateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationUpdateResponse> {
    try {
      const updatedVacation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar férias existente
        const existingVacation = await this.vacationRepository.findByIdWithTransaction(tx, id);

        if (!existingVacation) {
          throw new NotFoundException('Férias não encontrada.');
        }

        // Preparar dados para validação
        const validateData = {
          ...data,
          startAt: data.startAt || existingVacation.startAt,
          endAt: data.endAt || existingVacation.endAt,
          userId: data.userId !== undefined ? data.userId : existingVacation.userId,
          isCollective:
            data.isCollective !== undefined ? data.isCollective : existingVacation.isCollective,
        };

        // Validar entidade completa
        await this.vacationValidation(validateData, id, tx);

        // Validate status transition if status is being updated
        if (data.status && data.status !== existingVacation.status) {
          if (
            !isValidVacationStatusTransition(
              existingVacation.status as VACATION_STATUS,
              data.status as VACATION_STATUS,
            )
          ) {
            throw new BadRequestException(
              `Transição de status inválida: ${existingVacation.status} → ${data.status}`,
            );
          }

          // Validate date requirements based on status
          const now = new Date();
          if (
            (data.status as VACATION_STATUS) === VACATION_STATUS.IN_PROGRESS &&
            new Date(existingVacation.startAt) > now
          ) {
            throw new BadRequestException(
              'Não é possível mover férias para EM ANDAMENTO antes da data de início',
            );
          }
          if (
            (data.status as VACATION_STATUS) === VACATION_STATUS.COMPLETED &&
            new Date(existingVacation.endAt) > now
          ) {
            throw new BadRequestException(
              'Não é possível mover férias para CONCLUÍDO antes da data de término',
            );
          }
        }

        // Ensure statusOrder is updated when status changes
        const updateData = {
          ...data,
          ...(data.status && {
            statusOrder: getVacationStatusOrder(data.status as VACATION_STATUS),
          }),
        };

        // Atualizar as férias
        const updatedVacation = await this.vacationRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          { include },
        );

        // Track individual field changes
        const fieldsToTrack = [
          'status',
          'statusOrder',
          'startAt',
          'endAt',
          'isCollective',
          'userId',
          'type',
          'typeOrder',
          'approvedBy',
          'approvedAt',
          'rejectedBy',
          'rejectedAt',
          'cancelledBy',
          'cancelledAt',
          'observation',
        ];

        // Only track fields that were actually provided in the update
        const fieldsToActuallyTrack = fieldsToTrack.filter(field => data.hasOwnProperty(field));
        if (fieldsToActuallyTrack.length > 0) {
          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.VACATION,
            entityId: id,
            oldEntity: existingVacation,
            newEntity: updatedVacation,
            fieldsToTrack: fieldsToActuallyTrack,
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });
        }

        // Special handling for status transitions
        if (data.status && data.status !== existingVacation.status) {
          const statusMessage = this.getStatusTransitionMessage(
            existingVacation.status as VACATION_STATUS,
            data.status as VACATION_STATUS,
          );

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.VACATION,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'statusTransition',
            oldValue: existingVacation.status,
            newValue: data.status,
            reason: statusMessage,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return updatedVacation;
      });

      return {
        success: true,
        message: 'Férias atualizada com sucesso.',
        data: updatedVacation,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar férias:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar férias. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir férias
   */
  async delete(id: string, userId?: string): Promise<VacationDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const vacation = await this.vacationRepository.findByIdWithTransaction(tx, id);

        if (!vacation) {
          throw new NotFoundException('Férias não encontrada.');
        }

        // Registrar exclusão
        const vacationPeriod = `${new Date(vacation.startAt).toLocaleDateString('pt-BR')} a ${new Date(vacation.endAt).toLocaleDateString('pt-BR')}`;
        const vacationType = vacation.isCollective
          ? 'Férias coletivas'
          : `Férias de ${vacation.user?.name || 'funcionário'}`;

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: vacation,
          reason: `Solicitação de férias excluída: ${vacationType} - ${vacationPeriod} (Status: ${vacation.status})`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.vacationRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Férias excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir férias:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao excluir férias. Por favor, tente novamente.');
    }
  }

  /**
   * Criar múltiplas férias
   */
  async batchCreate(
    data: VacationBatchCreateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationBatchCreateResponse<VacationCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.vacationRepository.createManyWithTransaction(tx, data.vacations, {
          include,
        });

        // Registrar criações bem-sucedidas
        for (const vacation of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.VACATION,
            entityId: vacation.id,
            action: CHANGE_ACTION.CREATE,
            entity: vacation,
            reason: 'Férias criada em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 férias criada com sucesso'
          : `${result.totalCreated} férias criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
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
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar férias em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas férias
   */
  async batchUpdate(
    data: VacationBatchUpdateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationBatchUpdateResponse<VacationUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate and prepare updates
        const validatedUpdates: UpdateData<VacationUpdateFormData>[] = [];
        const validationErrors: Array<{ id: string; error: string }> = [];

        for (const vacation of data.vacations) {
          try {
            const existingVacation = await this.vacationRepository.findByIdWithTransaction(
              tx,
              vacation.id,
            );
            if (!existingVacation) {
              validationErrors.push({ id: vacation.id, error: 'Férias não encontrada' });
              continue;
            }

            // Validate status transition if status is being updated
            if (vacation.data.status && vacation.data.status !== existingVacation.status) {
              if (
                !isValidVacationStatusTransition(
                  existingVacation.status as VACATION_STATUS,
                  vacation.data.status as VACATION_STATUS,
                )
              ) {
                validationErrors.push({
                  id: vacation.id,
                  error: `Transição de status inválida: ${existingVacation.status} → ${vacation.data.status}`,
                });
                continue;
              }

              // Validate date requirements based on status
              const now = new Date();
              if (
                (vacation.data.status as VACATION_STATUS) === VACATION_STATUS.IN_PROGRESS &&
                new Date(existingVacation.startAt) > now
              ) {
                validationErrors.push({
                  id: vacation.id,
                  error: 'Não é possível mover férias para EM ANDAMENTO antes da data de início',
                });
                continue;
              }
              if (
                (vacation.data.status as VACATION_STATUS) === VACATION_STATUS.COMPLETED &&
                new Date(existingVacation.endAt) > now
              ) {
                validationErrors.push({
                  id: vacation.id,
                  error: 'Não é possível mover férias para CONCLUÍDO antes da data de término',
                });
                continue;
              }
            }

            // Prepare validated update with statusOrder
            const updateData = {
              ...vacation.data,
              ...(vacation.data.status && {
                statusOrder: getVacationStatusOrder(vacation.data.status as VACATION_STATUS),
              }),
            };

            validatedUpdates.push({
              id: vacation.id,
              data: updateData,
            });
          } catch (error) {
            if (error instanceof BadRequestException) {
              validationErrors.push({ id: vacation.id, error: error.message });
            }
          }
        }

        // Store original vacation data before updates for changelog
        const originalVacations = new Map<string, any>();
        for (const update of validatedUpdates) {
          const original = await this.vacationRepository.findByIdWithTransaction(tx, update.id);
          if (original) {
            originalVacations.set(update.id, original);
          }
        }

        // Process validated updates
        const result = await this.vacationRepository.updateManyWithTransaction(
          tx,
          validatedUpdates,
          { include },
        );

        // Add validation errors to failed items
        if (validationErrors.length > 0) {
          result.failed = [
            ...(result.failed || []),
            ...validationErrors.map(e => ({
              id: e.id,
              error: e.error,
              data: data.vacations.find(v => v.id === e.id)?.data || ({} as VacationUpdateFormData),
            })),
          ];
          result.totalFailed = (result.totalFailed || 0) + validationErrors.length;
        }

        // Registrar atualizações bem-sucedidas com field-level tracking
        for (const vacation of result.success) {
          // Get the original vacation data from our map
          const originalVacation = originalVacations.get(vacation.id);
          if (!originalVacation) continue;

          // Find the corresponding update data
          const updateItem = validatedUpdates.find(u => u.id === vacation.id);
          if (!updateItem) continue;

          // Track only the fields that were actually updated
          const fieldsToTrack = Object.keys(updateItem.data);

          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.VACATION,
            entityId: vacation.id,
            oldEntity: originalVacation,
            newEntity: vacation,
            fieldsToTrack,
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            transaction: tx,
          });

          // Special handling for status transitions in batch
          if (updateItem.data.status && updateItem.data.status !== originalVacation.status) {
            const statusMessage = this.getStatusTransitionMessage(
              originalVacation.status as VACATION_STATUS,
              updateItem.data.status as VACATION_STATUS,
            );

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.VACATION,
              entityId: vacation.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'statusTransition',
              oldValue: originalVacation.status,
              newValue: updateItem.data.status,
              reason: statusMessage,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              triggeredById: vacation.id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 férias atualizada com sucesso'
          : `${result.totalUpdated} férias atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar férias em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir múltiplas férias
   */
  async batchDelete(
    data: VacationBatchDeleteFormData,
    userId?: string,
  ): Promise<VacationBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar férias antes de excluir para o changelog
        const vacations = await this.vacationRepository.findByIdsWithTransaction(
          tx,
          data.vacationIds,
        );

        // Registrar exclusões
        for (const vacation of vacations) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.VACATION,
            entityId: vacation.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: vacation,
            reason: 'Férias excluída em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        return this.vacationRepository.deleteManyWithTransaction(tx, data.vacationIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 férias excluída com sucesso'
          : `${result.totalDeleted} férias excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
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
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir férias em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Get descriptive message for status transitions
   */
  private getStatusTransitionMessage(
    oldStatus: VACATION_STATUS,
    newStatus: VACATION_STATUS,
  ): string {
    const transitions: Record<string, string> = {
      [`${VACATION_STATUS.PENDING}_${VACATION_STATUS.APPROVED}`]:
        'Solicitação de férias aprovada pela gestão',
      [`${VACATION_STATUS.PENDING}_${VACATION_STATUS.REJECTED}`]:
        'Solicitação de férias rejeitada pela gestão',
      [`${VACATION_STATUS.PENDING}_${VACATION_STATUS.CANCELLED}`]:
        'Solicitação de férias cancelada pelo solicitante',
      [`${VACATION_STATUS.APPROVED}_${VACATION_STATUS.IN_PROGRESS}`]:
        'Férias iniciadas - funcionário em período de descanso',
      [`${VACATION_STATUS.APPROVED}_${VACATION_STATUS.CANCELLED}`]:
        'Férias aprovadas foram canceladas antes do início',
      [`${VACATION_STATUS.IN_PROGRESS}_${VACATION_STATUS.COMPLETED}`]:
        'Férias concluídas - funcionário retornou ao trabalho',
      [`${VACATION_STATUS.IN_PROGRESS}_${VACATION_STATUS.CANCELLED}`]:
        'Férias em andamento foram interrompidas',
    };

    const key = `${oldStatus}_${newStatus}`;
    return transitions[key] || `Status alterado de ${oldStatus} para ${newStatus}`;
  }

  /**
   * Validar entidade completa
   */
  private async vacationValidation(
    data: Partial<VacationCreateFormData | VacationUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar datas
    if (data.startAt && data.endAt) {
      const startDate = new Date(data.startAt);
      const endDate = new Date(data.endAt);
      if (endDate <= startDate) {
        throw new BadRequestException('A data de término deve ser posterior à data de início.');
      }
    }

    // Validar usuário para férias individuais
    if (data.userId && !data.isCollective) {
      const user = await transaction.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }
    }

    // Verificar sobreposição de férias
    if (data.userId && data.startAt && data.endAt && !data.isCollective) {
      const startDate = new Date(data.startAt);
      const endDate = new Date(data.endAt);
      const where: any = {
        userId: data.userId,
        AND: [
          {
            OR: [
              {
                AND: [{ startAt: { lte: startDate } }, { endAt: { gte: startDate } }],
              },
              {
                AND: [{ startAt: { lte: endDate } }, { endAt: { gte: endDate } }],
              },
              {
                AND: [{ startAt: { gte: startDate } }, { endAt: { lte: endDate } }],
              },
            ],
          },
        ],
      };

      if (existingId) {
        where.id = { not: existingId };
      }

      const overlapping = await transaction.vacation.findFirst({ where });
      if (overlapping) {
        throw new BadRequestException(
          'Já existem férias agendadas neste período para este usuário.',
        );
      }
    }
  }

  /**
   * Get user's managed sector for team filtering
   */
  async getUserManagedSector(userId: string): Promise<{ managedSectorId: string | null } | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { managedSectorId: true },
      });
      return user;
    } catch (error: any) {
      this.logger.error('Error fetching user managed sector:', error);
      return null;
    }
  }
}
