// position-remuneration.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PositionRemunerationRepository } from './repositories/position-remuneration/position-remuneration.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  PositionRemunerationBatchCreateResponse,
  PositionRemunerationBatchDeleteResponse,
  PositionRemunerationBatchUpdateResponse,
  PositionRemunerationCreateResponse,
  PositionRemunerationDeleteResponse,
  PositionRemunerationGetManyResponse,
  PositionRemunerationGetUniqueResponse,
  PositionRemunerationUpdateResponse,
  PositionRemuneration,
} from '../../../types';
import { UpdateData } from '../../../types';
import { convertToBatchOperationResult } from '@modules/common/utils/batch-operation.utils';
import {
  PositionRemunerationCreateFormData,
  PositionRemunerationUpdateFormData,
  PositionRemunerationGetManyFormData,
  PositionRemunerationBatchCreateFormData,
  PositionRemunerationBatchUpdateFormData,
  PositionRemunerationBatchDeleteFormData,
  PositionRemunerationInclude,
} from '../../../schemas/position';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
@Injectable()
export class PositionRemunerationService {
  private readonly logger = new Logger(PositionRemunerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly positionRemunerationRepository: PositionRemunerationRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Buscar muitas remunerações com filtros
   */
  async findMany(
    query: PositionRemunerationGetManyFormData,
  ): Promise<PositionRemunerationGetManyResponse> {
    try {
      const result = await this.positionRemunerationRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Remunerações carregadas com sucesso',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar remunerações:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar remunerações. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar uma remuneração por ID
   */
  async findById(
    id: string,
    include?: PositionRemunerationInclude,
  ): Promise<PositionRemunerationGetUniqueResponse> {
    try {
      const remuneration = await this.positionRemunerationRepository.findById(id, { include });

      if (!remuneration) {
        throw new NotFoundException('Remuneração não encontrada. Verifique se o ID está correto.');
      }

      return { success: true, data: remuneration, message: 'Remuneração carregada com sucesso' };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar remuneração por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar remuneração. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar uma nova remuneração
   */
  async create(
    data: PositionRemunerationCreateFormData,
    include?: PositionRemunerationInclude,
    userId?: string,
  ): Promise<PositionRemunerationCreateResponse> {
    try {
      // Validações
      if (data.value <= 0) {
        throw new BadRequestException('O valor da remuneração deve ser maior que zero');
      }

      if (data.value > 999999.99) {
        throw new BadRequestException('O valor da remuneração deve ser menor que R$ 1.000.000,00');
      }

      const remuneration = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Verificar se o cargo existe
        const position = await tx.position.findUnique({ where: { id: data.positionId } });
        if (!position) {
          throw new NotFoundException('Cargo não encontrado. Verifique se o ID está correto.');
        }

        // Criar a remuneração
        const newRemuneration = await this.positionRemunerationRepository.createWithTransaction(
          tx,
          data,
          { include },
        );

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSITION_REMUNERATION,
          entityId: newRemuneration.id,
          action: CHANGE_ACTION.CREATE,
          entity: newRemuneration,
          reason: `Remuneração criada para o cargo ${position.name}: R$ ${data.value.toFixed(2)}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || 'system',
          transaction: tx,
        });

        return newRemuneration;
      });

      return {
        success: true,
        message: 'Remuneração criada com sucesso',
        data: remuneration,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao criar remuneração:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar remuneração. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar uma remuneração
   */
  async update(
    id: string,
    data: PositionRemunerationUpdateFormData,
    include?: PositionRemunerationInclude,
    userId?: string,
  ): Promise<PositionRemunerationUpdateResponse> {
    try {
      // Validações
      if (data.value !== undefined) {
        if (data.value <= 0) {
          throw new BadRequestException('O valor da remuneração deve ser maior que zero');
        }
        if (data.value > 999999.99) {
          throw new BadRequestException(
            'O valor da remuneração deve ser menor que R$ 1.000.000,00',
          );
        }
      }

      const updatedRemuneration = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar remuneração existente
        const existingRemuneration =
          await this.positionRemunerationRepository.findByIdWithTransaction(tx, id);

        if (!existingRemuneration) {
          throw new NotFoundException(
            'Remuneração não encontrada. Verifique se o ID está correto.',
          );
        }

        // Verificar se o novo cargo existe (se fornecido)
        if (data.positionId && data.positionId !== existingRemuneration.positionId) {
          const position = await tx.position.findUnique({ where: { id: data.positionId } });
          if (!position) {
            throw new NotFoundException('Cargo não encontrado. Verifique se o ID está correto.');
          }
        }

        // Atualizar a remuneração
        const updatedRemuneration = await this.positionRemunerationRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Registrar mudanças no changelog - campo por campo
        const fieldsToTrack = ['value', 'positionId'];
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSITION_REMUNERATION,
          entityId: id,
          oldEntity: existingRemuneration,
          newEntity: updatedRemuneration,
          fieldsToTrack,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedRemuneration;
      });

      return {
        success: true,
        message: 'Remuneração atualizada com sucesso',
        data: updatedRemuneration,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao atualizar remuneração:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar remuneração. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir uma remuneração
   */
  async delete(id: string, userId?: string): Promise<PositionRemunerationDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const remuneration = await this.positionRemunerationRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!remuneration) {
          throw new NotFoundException(
            'Remuneração não encontrada. Verifique se o ID está correto.',
          );
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSITION_REMUNERATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: remuneration,
          reason: 'Remuneração excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || 'system',
          transaction: tx,
        });

        await this.positionRemunerationRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Remuneração excluída com sucesso',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao excluir remuneração:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir remuneração. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplas remunerações
   */
  async batchCreate(
    data: PositionRemunerationBatchCreateFormData,
    include?: PositionRemunerationInclude,
    userId?: string,
  ): Promise<PositionRemunerationBatchCreateResponse<PositionRemunerationCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.positionRemunerationRepository.createManyWithTransaction(
          tx,
          data.positionRemunerations,
          { include },
        );

        // Registrar criações bem-sucedidas
        for (const remuneration of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.POSITION_REMUNERATION,
            entityId: remuneration.id,
            action: CHANGE_ACTION.CREATE,
            entity: remuneration,
            reason: 'Remuneração criada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || 'system',
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 remuneração criada com sucesso'
          : `${result.totalCreated} remunerações criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = convertToBatchOperationResult<
        PositionRemuneration,
        PositionRemunerationCreateFormData
      >({
        success: result.success,
        failed: result.failed,
        totalCreated: result.totalCreated,
        totalFailed: result.totalFailed,
      });

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: unknown) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar remunerações em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar múltiplas remunerações
   */
  async batchUpdate(
    data: PositionRemunerationBatchUpdateFormData,
    include?: PositionRemunerationInclude,
    userId?: string,
  ): Promise<PositionRemunerationBatchUpdateResponse<PositionRemunerationUpdateFormData>> {
    try {
      const updates: UpdateData<PositionRemunerationUpdateFormData>[] =
        data.positionRemunerations.map(remuneration => ({
          id: remuneration.id,
          data: remuneration.data,
        }));

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar estados anteriores antes de atualizar
        const oldRemunerations = new Map<string, any>();
        for (const update of updates) {
          const oldRemuneration = await this.positionRemunerationRepository.findByIdWithTransaction(
            tx,
            update.id,
          );
          if (oldRemuneration) {
            oldRemunerations.set(update.id, oldRemuneration);
          }
        }

        const result = await this.positionRemunerationRepository.updateManyWithTransaction(
          tx,
          updates,
          { include },
        );

        // Registrar atualizações bem-sucedidas
        for (const remuneration of result.success) {
          const oldRemuneration = oldRemunerations.get(remuneration.id);

          if (oldRemuneration) {
            const fieldsToTrack = ['value', 'positionId'];
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.POSITION_REMUNERATION,
              entityId: remuneration.id,
              oldEntity: oldRemuneration,
              newEntity: remuneration,
              fieldsToTrack,
              userId: userId || 'system',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 remuneração atualizada com sucesso'
          : `${result.totalUpdated} remunerações atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = convertToBatchOperationResult<
        PositionRemuneration,
        PositionRemunerationUpdateFormData
      >({
        success: result.success,
        failed: result.failed,
        totalUpdated: result.totalUpdated,
        totalFailed: result.totalFailed,
      });

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: unknown) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar remunerações em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir múltiplas remunerações
   */
  async batchDelete(
    data: PositionRemunerationBatchDeleteFormData,
    userId?: string,
  ): Promise<PositionRemunerationBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar remunerações antes de excluir para o changelog
        const remunerations = await this.positionRemunerationRepository.findByIdsWithTransaction(
          tx,
          data.positionRemunerationIds,
        );

        // Registrar exclusões
        for (const remuneration of remunerations) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.POSITION_REMUNERATION,
            entityId: remuneration.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: remuneration,
            reason: 'Remuneração excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || 'system',
            transaction: tx,
          });
        }

        return this.positionRemunerationRepository.deleteManyWithTransaction(
          tx,
          data.positionRemunerationIds,
        );
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 remuneração excluída com sucesso'
          : `${result.totalDeleted} remunerações excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = convertToBatchOperationResult<
        { id: string; deleted: boolean },
        { id: string }
      >({
        success: result.success,
        failed: result.failed,
        totalDeleted: result.totalDeleted,
        totalFailed: result.totalFailed,
      });

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: unknown) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir remunerações em lote. Por favor, tente novamente',
      );
    }
  }
}
