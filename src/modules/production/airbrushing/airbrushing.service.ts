import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { AirbrushingRepository, PrismaTransaction } from './repositories/airbrushing.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, CHANGE_ACTION, ENTITY_TYPE } from '../../../constants/enums';
import type {
  AirbrushingBatchCreateResponse,
  AirbrushingBatchDeleteResponse,
  AirbrushingBatchUpdateResponse,
  AirbrushingCreateResponse,
  AirbrushingDeleteResponse,
  AirbrushingGetManyResponse,
  AirbrushingGetUniqueResponse,
  AirbrushingUpdateResponse,
} from '../../../types';
import { Airbrushing } from '../../../types';
import type {
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingGetManyFormData,
  AirbrushingBatchCreateFormData,
  AirbrushingBatchUpdateFormData,
  AirbrushingBatchDeleteFormData,
  AirbrushingInclude,
} from '../../../schemas/airbrushing';

@Injectable()
export class AirbrushingService {
  private readonly logger = new Logger(AirbrushingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly airbrushingRepository: AirbrushingRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar entidade completa
   */
  private async validateAirbrushing(
    data: Partial<AirbrushingCreateFormData | AirbrushingUpdateFormData>,
    existingId?: string,
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

    // Aerografia não tem campos únicos para validar
  }

  /**
   * Buscar muitas aerografias com filtros
   */
  async findMany(query: AirbrushingGetManyFormData): Promise<AirbrushingGetManyResponse> {
    try {
      const result = await this.airbrushingRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Aerografias carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar aerografias:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar aerografias. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar uma aerografia por ID
   */
  async findById(id: string, include?: AirbrushingInclude): Promise<AirbrushingGetUniqueResponse> {
    try {
      const airbrushing = await this.airbrushingRepository.findById(id, { include });

      if (!airbrushing) {
        throw new NotFoundException('Aerografia não encontrada.');
      }

      return { success: true, data: airbrushing, message: 'Aerografia carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar aerografia por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar nova aerografia
   */
  async create(
    data: AirbrushingCreateFormData,
    include?: AirbrushingInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
    },
  ): Promise<AirbrushingCreateResponse> {
    try {
      const airbrushing = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.validateAirbrushing(data, undefined, tx);

        // Criar a aerografia
        const newAirbrushing = await this.airbrushingRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.AIRBRUSHING,
          entityId: newAirbrushing.id,
          action: CHANGE_ACTION.CREATE,
          field: null,
          oldValue: null,
          newValue: newAirbrushing,
          reason: 'Aerografia criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: newAirbrushing.id,
          userId: userId || null,
          transaction: tx,
        });

        return newAirbrushing;
      });

      return {
        success: true,
        message: 'Aerografia criada com sucesso.',
        data: airbrushing,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar aerografia:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar aerografia
   */
  async update(
    id: string,
    data: AirbrushingUpdateFormData,
    include?: AirbrushingInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
    },
  ): Promise<AirbrushingUpdateResponse> {
    try {
      const updatedAirbrushing = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar aerografia existente
        const existingAirbrushing = await this.airbrushingRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingAirbrushing) {
          throw new NotFoundException('Aerografia não encontrada.');
        }

        // Validar entidade completa
        await this.validateAirbrushing(data, id, tx);

        // Atualizar a aerografia
        const updatedAirbrushing = await this.airbrushingRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Registrar mudanças no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.AIRBRUSHING,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: null,
          oldValue: existingAirbrushing,
          newValue: updatedAirbrushing,
          reason: 'Aerografia atualizada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updatedAirbrushing;
      });

      return {
        success: true,
        message: 'Aerografia atualizada com sucesso.',
        data: updatedAirbrushing,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar aerografia:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir aerografia
   */
  async delete(id: string, userId?: string): Promise<AirbrushingDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const airbrushing = await this.airbrushingRepository.findByIdWithTransaction(tx, id);

        if (!airbrushing) {
          throw new NotFoundException('Aerografia não encontrada.');
        }

        // Registrar exclusão
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.AIRBRUSHING,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          field: null,
          oldValue: airbrushing,
          newValue: null,
          reason: 'Aerografia excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        await this.airbrushingRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Aerografia excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir aerografia:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplas aerografias
   */
  async batchCreate(
    data: AirbrushingBatchCreateFormData,
    include?: AirbrushingInclude,
    userId?: string,
  ): Promise<AirbrushingBatchCreateResponse<AirbrushingCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: Airbrushing[] = [];
        const failedCreations: any[] = [];

        // Processar cada aerografia individualmente para validação detalhada
        for (let index = 0; index < data.airbrushings.length; index++) {
          const airbrushingData = data.airbrushings[index];
          try {
            // Validar entidade completa
            await this.validateAirbrushing(airbrushingData, undefined, tx);

            // Criar a aerografia
            const newAirbrushing = await this.airbrushingRepository.createWithTransaction(
              tx,
              airbrushingData,
              { include },
            );
            successfulCreations.push(newAirbrushing);

            // Registrar no changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.AIRBRUSHING,
              entityId: newAirbrushing.id,
              action: CHANGE_ACTION.CREATE,
              field: null,
              oldValue: null,
              newValue: newAirbrushing,
              reason: 'Aerografia criada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              triggeredById: newAirbrushing.id,
              userId: userId || null,
              transaction: tx,
            });
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar aerografia.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: airbrushingData,
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
          ? '1 aerografia criada com sucesso'
          : `${result.totalCreated} aerografias criadas com sucesso`;
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
        'Erro ao criar aerografias em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas aerografias
   */
  async batchUpdate(
    data: AirbrushingBatchUpdateFormData,
    include?: AirbrushingInclude,
    userId?: string,
  ): Promise<AirbrushingBatchUpdateResponse<AirbrushingUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: Airbrushing[] = [];
        const failedUpdates: any[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.airbrushings.length; index++) {
          const { id, data: updateData } = data.airbrushings[index];
          try {
            // Buscar aerografia existente
            const existingAirbrushing = await this.airbrushingRepository.findByIdWithTransaction(
              tx,
              id,
            );
            if (!existingAirbrushing) {
              throw new NotFoundException('Aerografia não encontrada.');
            }

            // Validar entidade completa
            await this.validateAirbrushing(updateData, id, tx);

            // Atualizar a aerografia
            const updatedAirbrushing = await this.airbrushingRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedAirbrushing);

            // Registrar no changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.AIRBRUSHING,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: null,
              oldValue: existingAirbrushing,
              newValue: updatedAirbrushing,
              reason: 'Aerografia atualizada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar aerografia.',
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
          ? '1 aerografia atualizada com sucesso'
          : `${result.totalUpdated} aerografias atualizadas com sucesso`;
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
        'Erro ao atualizar aerografias em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete airbrushings
   */
  async batchDelete(
    data: AirbrushingBatchDeleteFormData,
    userId?: string,
  ): Promise<AirbrushingBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar aerografias antes de excluir para o changelog
        const airbrushings = await this.airbrushingRepository.findByIdsWithTransaction(
          tx,
          data.airbrushingIds,
        );

        // Registrar exclusões
        for (const airbrushing of airbrushings) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.AIRBRUSHING,
            entityId: airbrushing.id,
            action: CHANGE_ACTION.DELETE,
            field: null,
            oldValue: airbrushing,
            newValue: null,
            reason: 'Aerografia excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            triggeredById: airbrushing.id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.airbrushingRepository.deleteManyWithTransaction(tx, data.airbrushingIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 aerografia excluída com sucesso'
          : `${result.totalDeleted} aerografias excluídas com sucesso`;
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
