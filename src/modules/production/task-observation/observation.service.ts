import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ObservationRepository, PrismaTransaction } from './repositories/observation.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import type {
  ObservationBatchCreateResponse,
  ObservationBatchDeleteResponse,
  ObservationBatchUpdateResponse,
  ObservationCreateResponse,
  ObservationDeleteResponse,
  ObservationGetManyResponse,
  ObservationGetUniqueResponse,
  ObservationUpdateResponse,
} from '../../../types';
import { Observation } from '../../../types';
import type {
  ObservationCreateFormData,
  ObservationUpdateFormData,
  ObservationGetManyFormData,
  ObservationBatchCreateFormData,
  ObservationBatchUpdateFormData,
  ObservationBatchDeleteFormData,
  ObservationInclude,
} from '../../../schemas/observation';

@Injectable()
export class ObservationService {
  private readonly logger = new Logger(ObservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly observationRepository: ObservationRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar entidade completa
   */
  private async validateEntity(
    data: Partial<ObservationCreateFormData | ObservationUpdateFormData>,
    _existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar se a tarefa existe
    if (data.taskId) {
      const taskExists = await transaction.task.findUnique({
        where: { id: data.taskId },
      });
      if (!taskExists) {
        throw new NotFoundException('Tarefa não encontrada.');
      }
    }

    // Validar descrição
    if (data.description !== undefined) {
      if (data.description.length < 3) {
        throw new BadRequestException('Descrição deve ter pelo menos 3 caracteres.');
      }
      if (data.description.length > 1000) {
        throw new BadRequestException('Descrição não pode ter mais de 1000 caracteres.');
      }
    }

    // Validar arquivos se fornecidos
    if (data.fileIds && data.fileIds.length > 0) {
      const files = await transaction.file.findMany({
        where: { id: { in: data.fileIds } },
      });
      if (files.length !== data.fileIds.length) {
        throw new BadRequestException('Um ou mais arquivos não foram encontrados.');
      }
    }
  }



  /**
   * Buscar muitas observações com filtros
   */
  async findMany(query: ObservationGetManyFormData): Promise<ObservationGetManyResponse> {
    try {
      const result = await this.observationRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Observações carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar observações:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar observações. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar uma observação por ID
   */
  async findById(id: string, include?: ObservationInclude): Promise<ObservationGetUniqueResponse> {
    try {
      const observation = await this.observationRepository.findById(id, { include });

      if (!observation) {
        throw new NotFoundException('Observação não encontrada.');
      }

      return { success: true, data: observation, message: 'Observação carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar observação por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar observação. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar nova observação
   */
  async create(
    data: ObservationCreateFormData,
    include?: ObservationInclude,
    userId?: string,
  ): Promise<ObservationCreateResponse> {
    try {
      const observation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.validateEntity(data, undefined, tx);

        // Criar a observação
        const newObservation = await this.observationRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar criação da entidade
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.OBSERVATION,
          entityId: newObservation.id,
          action: CHANGE_ACTION.CREATE,
          entity: newObservation,
          reason: 'Observação criada',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
          transaction: tx,
        });

        // Registrar anexação de arquivos se houver
        if (data.fileIds && data.fileIds.length > 0) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.OBSERVATION,
            entityId: newObservation.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'files',
            oldValue: null,
            newValue: data.fileIds,
            reason: `${data.fileIds.length} arquivo(s) anexado(s)`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
            triggeredById: newObservation.id,
            userId: userId || null,
            transaction: tx,
          });
        }


        return newObservation;
      });

      return {
        success: true,
        message: 'Observação criada com sucesso.',
        data: observation,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar observação:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar observação. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar observação
   */
  async update(
    id: string,
    data: ObservationUpdateFormData,
    include?: ObservationInclude,
    userId?: string,
  ): Promise<ObservationUpdateResponse> {
    try {
      const updatedObservation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar observação existente
        const existingObservation = await this.observationRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingObservation) {
          throw new NotFoundException('Observação não encontrada.');
        }

        // Validar entidade completa
        await this.validateEntity(data, id, tx);

        // Capturar arquivos atuais antes da atualização
        const existingWithFiles = await this.observationRepository.findByIdWithTransaction(tx, id, {
          include: { files: true },
        });
        const oldFileIds = existingWithFiles?.files?.map(f => f.id) || [];

        // Atualizar a observação
        const updatedObservation = await this.observationRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Rastrear mudanças nos campos principais
        const fieldsToTrack = ['description', 'taskId'];
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.OBSERVATION,
          entityId: id,
          oldEntity: existingObservation,
          newEntity: updatedObservation,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
          transaction: tx,
        });

        // Rastrear mudanças nos arquivos anexados
        if (data.fileIds !== undefined) {
          const newFileIds = data.fileIds || [];
          const addedFiles = newFileIds.filter(fileId => !oldFileIds.includes(fileId));
          const removedFiles = oldFileIds.filter(fileId => !newFileIds.includes(fileId));

          if (addedFiles.length > 0 || removedFiles.length > 0) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.OBSERVATION,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'files',
              oldValue: oldFileIds,
              newValue: newFileIds,
              reason:
                `Arquivos ${addedFiles.length > 0 ? `anexados: ${addedFiles.length}` : ''} ${removedFiles.length > 0 ? `removidos: ${removedFiles.length}` : ''}`.trim(),
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return updatedObservation;
      });

      return {
        success: true,
        message: 'Observação atualizada com sucesso.',
        data: updatedObservation,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar observação:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar observação. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir observação
   */
  async delete(id: string, userId?: string): Promise<ObservationDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const observation = await this.observationRepository.findByIdWithTransaction(tx, id);

        if (!observation) {
          throw new NotFoundException('Observação não encontrada.');
        }


        // Registrar exclusão da entidade
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.OBSERVATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: observation,
          reason: 'Observação excluída',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
          transaction: tx,
        });

        await this.observationRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Observação excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir observação:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir observação. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplas observações
   */
  async batchCreate(
    data: ObservationBatchCreateFormData,
    include?: ObservationInclude,
    userId?: string,
  ): Promise<ObservationBatchCreateResponse<ObservationCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: Observation[] = [];
        const failedCreations: any[] = [];

        // Processar cada observação individualmente para validação detalhada
        for (let index = 0; index < data.observations.length; index++) {
          const observationData = data.observations[index];
          try {
            // Validar entidade completa
            await this.validateEntity(observationData, undefined, tx);

            // Criar a observação
            const newObservation = await this.observationRepository.createWithTransaction(
              tx,
              observationData,
              { include },
            );
            successfulCreations.push(newObservation);

            // Registrar criação da entidade
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.OBSERVATION,
              entityId: newObservation.id,
              action: CHANGE_ACTION.CREATE,
              entity: newObservation,
              reason: 'Observação criada em lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            // Registrar anexação de arquivos se houver
            if (observationData.fileIds && observationData.fileIds.length > 0) {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.OBSERVATION,
                entityId: newObservation.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'files',
                oldValue: null,
                newValue: observationData.fileIds,
                reason: `${observationData.fileIds.length} arquivo(s) anexado(s) em lote`,
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
                triggeredById: newObservation.id,
                userId: userId || null,
                transaction: tx,
              });
            }
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar observação.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: observationData,
            });
          }
        }

        return {
          success: successfulCreations,
          failed: failedCreations,
          totalCreated: successfulCreations.length,
          totalFailed: failedCreations.length,
        };
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 observação criada com sucesso'
          : `${result.totalCreated} observações criadas com sucesso`;
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
        'Erro ao criar observações em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas observações
   */
  async batchUpdate(
    data: ObservationBatchUpdateFormData,
    include?: ObservationInclude,
    userId?: string,
  ): Promise<ObservationBatchUpdateResponse<ObservationUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: Observation[] = [];
        const failedUpdates: any[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.observations.length; index++) {
          const { id, data: updateData } = data.observations[index];
          try {
            // Buscar observação existente
            const existingObservation = await this.observationRepository.findByIdWithTransaction(
              tx,
              id,
            );
            if (!existingObservation) {
              throw new NotFoundException('Observação não encontrada.');
            }

            // Validar entidade completa
            await this.validateEntity(updateData, id, tx);

            // Capturar arquivos atuais antes da atualização
            const existingWithFiles = await this.observationRepository.findByIdWithTransaction(
              tx,
              id,
              {
                include: { files: true },
              },
            );
            const oldFileIds = existingWithFiles?.files?.map(f => f.id) || [];

            // Atualizar a observação
            const updatedObservation = await this.observationRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedObservation);

            // Rastrear mudanças nos campos principais
            const fieldsToTrack = ['description', 'taskId'];
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.OBSERVATION,
              entityId: id,
              oldEntity: existingObservation,
              newEntity: updatedObservation,
              fieldsToTrack,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // Rastrear mudanças nos arquivos anexados
            if (updateData.fileIds !== undefined) {
              const newFileIds = updateData.fileIds || [];
              const addedFiles = newFileIds.filter(fileId => !oldFileIds.includes(fileId));
              const removedFiles = oldFileIds.filter(fileId => !newFileIds.includes(fileId));

              if (addedFiles.length > 0 || removedFiles.length > 0) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.OBSERVATION,
                  entityId: id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'files',
                  oldValue: oldFileIds,
                  newValue: newFileIds,
                  reason:
                    `Arquivos ${addedFiles.length > 0 ? `anexados: ${addedFiles.length}` : ''} ${removedFiles.length > 0 ? `removidos: ${removedFiles.length}` : ''}`.trim(),
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: id,
                  userId: userId || null,
                  transaction: tx,
                });
              }
            }
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar observação.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: { id, ...updateData },
            });
          }
        }

        return {
          success: successfulUpdates,
          failed: failedUpdates,
          totalUpdated: successfulUpdates.length,
          totalFailed: failedUpdates.length,
        };
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 observação atualizada com sucesso'
          : `${result.totalUpdated} observações atualizadas com sucesso`;
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
        'Erro ao atualizar observações em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete observations
   */
  async batchDelete(
    data: ObservationBatchDeleteFormData,
    userId?: string,
  ): Promise<ObservationBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar observações antes de excluir para o changelog
        const observations = await this.observationRepository.findByIdsWithTransaction(
          tx,
          data.observationIds,
        );

        // Registrar exclusões
        for (const observation of observations) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.OBSERVATION,
            entityId: observation.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: observation,
            reason: 'Observação excluída em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        return this.observationRepository.deleteManyWithTransaction(tx, data.observationIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 observação excluída com sucesso'
          : `${result.totalDeleted} observações excluídas com sucesso`;
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
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }
}
