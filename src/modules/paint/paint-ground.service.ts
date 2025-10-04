// paint-ground.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PaintGroundRepository } from './repositories/paint-ground/paint-ground.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import type {
  PaintGroundBatchCreateResponse,
  PaintGroundBatchDeleteResponse,
  PaintGroundBatchUpdateResponse,
  PaintGroundCreateResponse,
  PaintGroundDeleteResponse,
  PaintGroundGetManyResponse,
  PaintGroundGetUniqueResponse,
  PaintGroundUpdateResponse,
} from '../../types';
import { UpdateData } from '../../types';
import type {
  PaintGroundCreateFormData,
  PaintGroundUpdateFormData,
  PaintGroundGetManyFormData,
  PaintGroundBatchCreateFormData,
  PaintGroundBatchUpdateFormData,
  PaintGroundBatchDeleteFormData,
  PaintGroundInclude,
} from '../../schemas/paint';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';

@Injectable()
export class PaintGroundService {
  private readonly logger = new Logger(PaintGroundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paintGroundRepository: PaintGroundRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validate entity
   */
  private async validateEntity(
    data: Partial<PaintGroundCreateFormData | PaintGroundUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate paint exists
    if (data.paintId) {
      const paint = await transaction.paint.findUnique({ where: { id: data.paintId } });
      if (!paint) {
        throw new NotFoundException('Tinta não encontrada.');
      }
    }
  }

  /**
   * Find many paint bases with filters
   */
  async findMany(query: PaintGroundGetManyFormData): Promise<PaintGroundGetManyResponse> {
    try {
      const result = await this.paintGroundRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Bases de tinta carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar bases de tinta:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar bases de tinta. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Find a paint base by ID
   */
  async findById(id: string, include?: PaintGroundInclude): Promise<PaintGroundGetUniqueResponse> {
    try {
      const paintGround = await this.paintGroundRepository.findById(id, { include });

      if (!paintGround) {
        throw new NotFoundException('Fundo de tinta não encontrada.');
      }

      return { success: true, data: paintGround, message: 'Fundo de tinta carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar fundo de tinta por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar fundo de tinta. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Create new paint base
   */
  async create(
    data: PaintGroundCreateFormData,
    include?: PaintGroundInclude,
    userId?: string,
  ): Promise<PaintGroundCreateResponse> {
    try {
      const paintGround = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate entity
        await this.validateEntity(data, undefined, tx);

        // Create paint base
        const newPaintGround = await this.paintGroundRepository.createWithTransaction(tx, data, {
          include,
        });

        // Log entity creation with field-level tracking
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_GROUND,
          entityId: newPaintGround.id,
          action: CHANGE_ACTION.CREATE,
          entity: newPaintGround,
          reason: 'Fundo de tinta criada',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_GROUND_CREATE,
          transaction: tx,
        });

        return newPaintGround;
      });

      return {
        success: true,
        message: 'Fundo de tinta criada com sucesso.',
        data: paintGround,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar fundo de tinta:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar fundo de tinta. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Update paint base
   */
  async update(
    id: string,
    data: PaintGroundUpdateFormData,
    include?: PaintGroundInclude,
    userId?: string,
  ): Promise<PaintGroundUpdateResponse> {
    try {
      const updatedPaintGround = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Find existing paint base
        const existingPaintGround = await this.paintGroundRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingPaintGround) {
          throw new NotFoundException(
            'Fundo de tinta não encontrada. Verifique se o ID está correto.',
          );
        }

        // Validate unique constraints
        await this.validateEntity(data, id, tx);

        // Update paint base
        const updatedPaintGround = await this.paintGroundRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Track field-level changes
        const fieldsToTrack = ['paintId', 'groundPaintId'];
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_GROUND,
          entityId: id,
          oldEntity: existingPaintGround,
          newEntity: updatedPaintGround,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_GROUND_UPDATE,
          transaction: tx,
        });

        return updatedPaintGround;
      });

      return {
        success: true,
        message: 'Fundo de tinta atualizada com sucesso.',
        data: updatedPaintGround,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar fundo de tinta:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar fundo de tinta. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Delete paint base
   */
  async delete(id: string, userId?: string): Promise<PaintGroundDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const paintGround = await this.paintGroundRepository.findByIdWithTransaction(tx, id);

        if (!paintGround) {
          throw new NotFoundException(
            'Fundo de tinta não encontrada. Verifique se o ID está correto.',
          );
        }

        // Log deletion with field-level tracking
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_GROUND,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: paintGround,
          reason: 'Fundo de tinta excluída',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_GROUND_DELETE,
          transaction: tx,
        });

        await this.paintGroundRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Fundo de tinta excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir fundo de tinta:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir fundo de tinta. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Create multiple paint bases
   */
  async batchCreate(
    data: PaintGroundBatchCreateFormData,
    include?: PaintGroundInclude,
    userId?: string,
  ): Promise<PaintGroundBatchCreateResponse<PaintGroundCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.paintGroundRepository.createManyWithTransaction(
          tx,
          data.paintGrounds,
          { include },
        );

        // Log successful creations with field-level tracking
        for (const paintGround of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT_GROUND,
            entityId: paintGround.id,
            action: CHANGE_ACTION.CREATE,
            entity: paintGround,
            reason: 'Fundo de tinta criada em lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_GROUND_BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 fundo de tinta criada com sucesso'
          : `${result.totalCreated} bases de tinta criadas com sucesso`;
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
        'Erro ao criar bases de tinta em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Update multiple paint bases
   */
  async batchUpdate(
    data: PaintGroundBatchUpdateFormData,
    include?: PaintGroundInclude,
    userId?: string,
  ): Promise<PaintGroundBatchUpdateResponse<PaintGroundUpdateFormData>> {
    try {
      const updates: UpdateData<PaintGroundUpdateFormData>[] = data.paintGrounds.map(
        paintGround => ({
          id: paintGround.id,
          data: paintGround.data,
        }),
      );

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get old values for comparison
        const existingGrounds = new Map<string, any>();
        for (const update of updates) {
          const existing = await this.paintGroundRepository.findByIdWithTransaction(tx, update.id);
          if (existing) {
            existingGrounds.set(update.id, existing);
          }
        }

        const result = await this.paintGroundRepository.updateManyWithTransaction(tx, updates, {
          include,
        });

        // Log successful updates with field-level tracking
        const fieldsToTrack = ['paintId', 'groundPaintId'];
        for (const paintGround of result.success) {
          const oldEntity = existingGrounds.get(paintGround.id);
          if (oldEntity) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PAINT_GROUND,
              entityId: paintGround.id,
              oldEntity,
              newEntity: paintGround,
              fieldsToTrack,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_GROUND_BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 fundo de tinta atualizada com sucesso'
          : `${result.totalUpdated} bases de tinta atualizadas com sucesso`;
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
        'Erro ao atualizar bases de tinta em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Delete multiple paint bases
   */
  async batchDelete(
    data: PaintGroundBatchDeleteFormData,
    userId?: string,
  ): Promise<PaintGroundBatchDeleteResponse> {
    const result = await this.prisma.$transaction(async transaction => {
      // Get entities before deletion for logging
      const existingGrounds = new Map<string, any>();
      for (const id of data.paintGroundIds) {
        const existing = await this.paintGroundRepository.findByIdWithTransaction(transaction, id);
        if (existing) {
          existingGrounds.set(id, existing);
        }
      }

      const batchResult = await this.paintGroundRepository.deleteManyWithTransaction(
        transaction,
        data.paintGroundIds,
      );

      // Log deletion for each successful paint base with field-level tracking
      for (const deleted of batchResult.success) {
        const oldEntity = existingGrounds.get(deleted.id);
        if (oldEntity) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT_GROUND,
            entityId: deleted.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity,
            reason: 'Fundo de tinta deletada em lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_GROUND_BATCH_DELETE,
            transaction,
          });
        }
      }

      return batchResult;
    });

    const successMessage =
      result.totalDeleted === 1
        ? '1 fundo de tinta deletada com sucesso'
        : `${result.totalDeleted} bases de tinta deletadas com sucesso`;
    const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

    // Convert BatchDeleteResult to BatchOperationResult format
    const batchOperationResult = {
      success: result.success,
      failed: result.failed.map((error, index) => ({
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
  }
}
