// position.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PositionRepository } from './repositories/position/position.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import type {
  Position,
  PositionBatchCreateResponse,
  PositionBatchDeleteResponse,
  PositionBatchUpdateResponse,
  PositionCreateResponse,
  PositionDeleteResponse,
  PositionGetManyResponse,
  PositionGetUniqueResponse,
  PositionUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import { convertToBatchOperationResult } from '@modules/common/utils/batch-operation.utils';
import type {
  PositionCreateFormData,
  PositionUpdateFormData,
  PositionGetManyFormData,
  PositionBatchCreateFormData,
  PositionBatchUpdateFormData,
  PositionBatchDeleteFormData,
  PositionInclude,
} from '../../../schemas/position';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
@Injectable()
export class PositionService {
  private readonly logger = new Logger(PositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly positionRepository: PositionRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar cargo completo
   */
  private async validatePosition(
    data: Partial<PositionCreateFormData | PositionUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar nome único dentro do setor
    if (data.name) {
      const whereClause: Prisma.PositionWhereInput = {
        name: data.name,
        ...(existingId && { id: { not: existingId } }),
      };

      const existingPosition = await transaction.position.findFirst({
        where: whereClause,
      });

      if (existingPosition) {
        throw new BadRequestException('Nome do cargo já está em uso.');
      }
    }

    // Validar remuneração se fornecida
    if (data.remuneration !== undefined && data.remuneration <= 0) {
      throw new BadRequestException('Remuneração deve ser maior que zero.');
    }
  }

  /**
   * Buscar muitos cargos com filtros
   */
  async findMany(query: PositionGetManyFormData): Promise<PositionGetManyResponse> {
    try {
      const result = await this.positionRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Cargos carregados com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar cargos:', error);
      throw new InternalServerErrorException('Erro ao buscar cargos. Por favor, tente novamente.');
    }
  }

  /**
   * Buscar um cargo por ID
   */
  async findById(id: string, include?: PositionInclude): Promise<PositionGetUniqueResponse> {
    try {
      const position = await this.positionRepository.findById(id, { include });

      if (!position) {
        throw new NotFoundException('Cargo não encontrado.');
      }

      return { success: true, data: position, message: 'Cargo carregado com sucesso.' };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar cargo por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar cargo. Por favor, tente novamente.');
    }
  }

  /**
   * Criar novo cargo com remuneração inicial
   */
  async create(
    data: PositionCreateFormData,
    include?: PositionInclude,
    userId?: string,
  ): Promise<PositionCreateResponse> {
    try {
      // Validar cargo completo
      await this.validatePosition(data, undefined, undefined);

      const position = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Criar o cargo
        const newPosition = await this.positionRepository.createWithTransaction(tx, data, {
          include,
        });

        // Criar registro de remuneração inicial usando MonetaryValue
        if (data.remuneration && data.remuneration > 0) {
          await tx.monetaryValue.create({
            data: {
              value: data.remuneration,
              current: true, // Mark as current value
              positionId: newPosition.id,
            },
          });
        }

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSITION,
          entityId: newPosition.id,
          action: CHANGE_ACTION.CREATE,
          entity: newPosition,
          reason: 'Novo cargo criado no sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newPosition;
      });

      return {
        success: true,
        message: 'Cargo criado com sucesso.',
        data: position,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao criar cargo:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar cargo. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar cargo
   */
  async update(
    id: string,
    data: PositionUpdateFormData,
    include?: PositionInclude,
    userId?: string,
  ): Promise<PositionUpdateResponse> {
    try {
      const updatedPosition = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar cargo existente com remunerações
        const existingPosition = await this.positionRepository.findByIdWithTransaction(tx, id, {
          include: { remunerations: true },
        });

        if (!existingPosition) {
          throw new NotFoundException('Cargo não encontrado. Verifique se o ID está correto.');
        }

        // Validar cargo completo
        await this.validatePosition(data, id, tx);

        // Atualizar o cargo
        const updatedPosition = await this.positionRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Define fields to track for positions
        const fieldsToTrack = [
          'name',
          'level',
          'sectorId',
          'privileges',
          'commissionEligible',
          'maxAllowedVacationDays',
          'hierarchy',
          'bonifiable',
        ];

        // Track field-level changes (excluding remuneration which has special handling)
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSITION,
          entityId: id,
          oldEntity: existingPosition,
          newEntity: updatedPosition,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Special handling for remuneration changes
        const currentRemuneration = existingPosition.remuneration || 0;

        if (data.remuneration && data.remuneration !== currentRemuneration) {
          // Mark all existing monetary values as not current
          await tx.monetaryValue.updateMany({
            where: { positionId: id, current: true },
            data: { current: false },
          });

          // Create new monetary value marked as current
          await tx.monetaryValue.create({
            data: {
              value: data.remuneration,
              current: true,
              positionId: id,
            },
          });

          // Log remuneration change with additional context
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.POSITION,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'remuneration',
            oldValue: currentRemuneration,
            newValue: data.remuneration,
            reason: 'Remuneração atualizada',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return updatedPosition;
      });

      return {
        success: true,
        message: 'Cargo atualizado com sucesso.',
        data: updatedPosition,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar cargo:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar cargo. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Deletar cargo
   */
  async delete(id: string, userId?: string): Promise<PositionDeleteResponse> {
    try {
      const deletedPosition = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar cargo existente
        const existingPosition = await this.positionRepository.findByIdWithTransaction(tx, id, {
          include: { users: true, remunerations: true },
        });

        if (!existingPosition) {
          throw new NotFoundException('Cargo não encontrado. Verifique se o ID está correto.');
        }

        // Verificar se há usuários vinculados
        if (existingPosition.users && existingPosition.users.length > 0) {
          throw new BadRequestException('Não é possível deletar um cargo com usuários vinculados.');
        }

        // Deletar o cargo
        const deletedPosition = await this.positionRepository.deleteWithTransaction(tx, id);

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSITION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existingPosition,
          reason: 'Cargo excluído do sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return deletedPosition;
      });

      return {
        success: true,
        message: 'Cargo deletado com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao deletar cargo:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao deletar cargo. Por favor, tente novamente.');
    }
  }

  /**
   * Criar cargos em lote
   */
  async batchCreate(
    data: PositionBatchCreateFormData,
    include?: PositionInclude,
    userId?: string,
  ): Promise<PositionBatchCreateResponse<PositionCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar todos os cargos antes de criar
        const names = data.positions.map(p => p.name);
        const uniqueNames = new Set(names);
        if (names.length !== uniqueNames.size) {
          throw new BadRequestException('Existem nomes duplicados na lista de cargos.');
        }

        // Validar cada cargo individualmente
        const errors: Array<{ index: number; error: string }> = [];
        for (let i = 0; i < data.positions.length; i++) {
          try {
            await this.validatePosition(data.positions[i], undefined, tx);
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : 'Erro desconhecido durante validação';
            errors.push({ index: i, error: errorMessage });
          }
        }

        if (errors.length > 0) {
          const errorMessages = errors.map(e => `Item ${e.index + 1}: ${e.error}`).join('; ');
          throw new BadRequestException(`Erros de validação: ${errorMessages}`);
        }

        // Criar cargos em lote
        const batchResult = await this.positionRepository.createManyWithTransaction(
          tx,
          data.positions,
          { include },
        );

        // Criar registros de remuneração (MonetaryValue) para cargos criados com sucesso
        for (let i = 0; i < batchResult.success.length; i++) {
          const position = batchResult.success[i];
          const originalData = data.positions.find(p => p.name === position.name);
          if (originalData && originalData.remuneration) {
            await tx.monetaryValue.create({
              data: {
                value: originalData.remuneration,
                current: true,
                positionId: position.id,
              },
            });
          }

          // Registrar no changelog
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.POSITION,
            entityId: position.id,
            action: CHANGE_ACTION.CREATE,
            entity: position,
            reason: 'Cargo criado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 cargo criado com sucesso'
          : `${result.totalCreated} cargos criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = convertToBatchOperationResult<Position, PositionCreateFormData>({
        success: result.success,
        failed: result.failed,
        totalCreated: result.totalCreated,
        totalFailed: result.totalFailed,
      });

      return {
        success: true,
        message: `${successMessage}${failureMessage}.`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro na criação em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar cargos em lote
   */
  async batchUpdate(
    data: PositionBatchUpdateFormData,
    include?: PositionInclude,
    userId?: string,
  ): Promise<PositionBatchUpdateResponse<PositionUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Preparar atualizações
        const updates: UpdateData<PositionUpdateFormData>[] = data.positions.map(item => ({
          id: item.id,
          data: item.data,
        }));

        // Validar unicidade de nomes
        const namesToCheck: { id: string; name: string }[] = [];
        for (const update of data.positions) {
          if (update.data.name) {
            namesToCheck.push({ id: update.id, name: update.data.name });
          }
        }

        if (namesToCheck.length > 0) {
          const names = namesToCheck.map(n => n.name);
          const uniqueNames = new Set(names);
          if (names.length !== uniqueNames.size) {
            throw new BadRequestException('Existem nomes duplicados na lista de atualizações.');
          }

          // Validar cada atualização individualmente
          const errors: Array<{ index: number; id: string; error: string }> = [];
          for (let i = 0; i < data.positions.length; i++) {
            const update = data.positions[i];
            try {
              await this.validatePosition(update.data, update.id, tx);
            } catch (error: unknown) {
              const errorMessage =
                error instanceof Error ? error.message : 'Erro desconhecido durante validação';
              errors.push({ index: i, id: update.id, error: errorMessage });
            }
          }

          if (errors.length > 0) {
            const errorMessages = errors
              .map(e => `Item ${e.index + 1} (ID: ${e.id}): ${e.error}`)
              .join('; ');
            throw new BadRequestException(`Erros de validação: ${errorMessages}`);
          }
        }

        // Obter cargos existentes para verificar mudanças de remuneração
        const ids = updates.map(u => u.id);
        const existingPositions = await this.positionRepository.findByIdsWithTransaction(tx, ids, {
          include: { remunerations: true },
        });
        const existingMap = new Map(existingPositions.map(p => [p.id, p]));

        // Atualizar cargos em lote
        const batchResult = await this.positionRepository.updateManyWithTransaction(tx, updates, {
          include,
        });

        // Criar registros de remuneração para mudanças bem-sucedidas
        for (const position of batchResult.success) {
          const existing = existingMap.get(position.id);
          const updateData = data.positions.find(d => d.id === position.id);

          if (existing && updateData?.data.remuneration) {
            // Get current remuneration from latest remuneration record
            const currentRemuneration =
              existing.remunerations && existing.remunerations.length > 0
                ? existing.remunerations[0].value
                : existing.remuneration || 0;

            if (updateData.data.remuneration !== currentRemuneration) {
              // Mark existing monetary values as not current
              await tx.monetaryValue.updateMany({
                where: { positionId: position.id, current: true },
                data: { current: false },
              });

              // Create new monetary value marked as current
              await tx.monetaryValue.create({
                data: {
                  value: updateData.data.remuneration,
                  current: true,
                  positionId: position.id,
                },
              });

              // Registrar mudança de remuneração
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.POSITION,
                entityId: position.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'remuneration',
                oldValue: currentRemuneration,
                newValue: updateData.data.remuneration,
                reason: 'Remuneração atualizada em lote',
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                triggeredById: position.id,
                userId: userId || null,
                transaction: tx,
              });
            }
          }

          // Track field-level changes
          const fieldsToTrack = [
            'name',
            'level',
            'sectorId',
            'privileges',
            'commissionEligible',
            'maxAllowedVacationDays',
          ];

          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.POSITION,
            entityId: position.id,
            oldEntity: existing,
            newEntity: position,
            fieldsToTrack,
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            transaction: tx,
          });
        }

        return batchResult;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 cargo atualizado com sucesso'
          : `${result.totalUpdated} cargos atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = convertToBatchOperationResult<
        Position,
        PositionUpdateFormData & { id: string }
      >({
        success: result.success,
        failed: result.failed,
        totalUpdated: result.totalUpdated,
        totalFailed: result.totalFailed,
      });

      return {
        success: true,
        message: `${successMessage}${failureMessage}.`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro na atualização em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Deletar cargos em lote
   */
  async batchDelete(
    data: PositionBatchDeleteFormData,
    userId?: string,
  ): Promise<PositionBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Verificar se cargos existem e não têm usuários vinculados
        const positions = await this.positionRepository.findByIdsWithTransaction(
          tx,
          data.positionIds,
        );

        // Verificar dependências com contagem de relacionamentos
        const positionChecks = await Promise.all(
          data.positionIds.map(async id => {
            const userCount = await tx.user.count({ where: { positionId: id } });
            return { id, userCount };
          }),
        );

        const positionsWithUsers = positionChecks.filter(check => check.userCount > 0);
        if (positionsWithUsers.length > 0) {
          const errorMessages = positionsWithUsers.map(check => {
            const position = positions.find(p => p.id === check.id);
            return `${position?.name || check.id}: ${check.userCount} usuário(s)`;
          });
          throw new BadRequestException(
            `Não é possível excluir cargos com usuários vinculados:\n${errorMessages.join('\n')}`,
          );
        }

        // Deletar registros de valores monetários (remunerações) para todos os cargos
        for (const position of positions) {
          // Delete all monetary values (remunerations) for this position
          await tx.monetaryValue.deleteMany({
            where: { positionId: position.id },
          });
        }

        // Deletar cargos em lote
        const batchResult = await this.positionRepository.deleteManyWithTransaction(
          tx,
          data.positionIds,
        );

        // Registrar deleções no changelog
        for (const successItem of batchResult.success) {
          const position = positions.find(p => p.id === successItem.id);
          if (position) {
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.POSITION,
              entityId: successItem.id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: position,
              reason: 'Cargo excluído em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return batchResult;
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 cargo deletado com sucesso'
          : `${result.totalDeleted} cargos deletados com sucesso`;
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
        message: `${successMessage}${failureMessage}.`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na deleção em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro na deleção em lote. Por favor, tente novamente.',
      );
    }
  }
}
