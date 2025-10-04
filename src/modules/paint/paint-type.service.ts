import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PaintTypeRepository } from './repositories/paint-type/paint-type.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ChangeLogService } from '../common/changelog/changelog.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../constants/enums';
import { trackFieldChanges, trackAndLogFieldChanges, logEntityChange } from '../common/changelog/utils/changelog-helpers';
import {
  PaintTypeCreateFormData,
  PaintTypeUpdateFormData,
  PaintTypeGetManyFormData,
  PaintTypeBatchCreateFormData,
  PaintTypeBatchUpdateFormData,
  PaintTypeBatchDeleteFormData,
  PaintTypeInclude,
} from '../../schemas/paint';
import {
  PaintTypeGetManyResponse,
  PaintTypeGetUniqueResponse,
  PaintTypeCreateResponse,
  PaintTypeUpdateResponse,
  PaintTypeDeleteResponse,
  PaintTypeBatchCreateResponse,
  PaintTypeBatchUpdateResponse,
  PaintTypeBatchDeleteResponse,
} from '../../types';
import { BatchOperationResult } from '../../types';

@Injectable()
export class PaintTypeService {
  private readonly logger = new Logger(PaintTypeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paintTypeRepository: PaintTypeRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validate paint type data
   */
  private async validatePaintType(
    data: Partial<PaintTypeCreateFormData | PaintTypeUpdateFormData>,
    excludeId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const errors: string[] = [];

    // Check name uniqueness if provided
    if (data.name) {
      const existing = await (tx
        ? this.paintTypeRepository.findByNameWithTransaction(tx, data.name)
        : this.paintTypeRepository.findByName(data.name));

      if (existing && existing.id !== excludeId) {
        errors.push(`Já existe um tipo de tinta com o nome "${data.name}"`);
      }
    }

    // Validate component items exist if provided
    if (data.componentItemIds && data.componentItemIds.length > 0) {
      const prismaClient = tx || this.prisma;
      const items = await prismaClient.item.findMany({
        where: { id: { in: data.componentItemIds } },
        select: { id: true },
      });

      if (items.length !== data.componentItemIds.length) {
        errors.push('Um ou mais itens componentes não foram encontrados');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors.join(', '));
    }
  }

  /**
   * Find many paint types
   */
  async findMany(params?: PaintTypeGetManyFormData): Promise<PaintTypeGetManyResponse> {
    try {
      const result = await this.paintTypeRepository.findMany(params);

      return {
        success: true,
        message: 'Tipos de tinta encontrados com sucesso',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tipos de tinta', error);
      throw new InternalServerErrorException('Erro ao buscar tipos de tinta');
    }
  }

  /**
   * Find paint type by ID
   */
  async findById(id: string, include?: PaintTypeInclude): Promise<PaintTypeGetUniqueResponse> {
    const paintType = await this.paintTypeRepository.findById(id, { include });

    if (!paintType) {
      throw new NotFoundException('Tipo de tinta não encontrado');
    }

    return {
      success: true,
      message: 'Tipo de tinta encontrado com sucesso',
      data: paintType,
    };
  }

  /**
   * Create a new paint type
   */
  async create(
    data: PaintTypeCreateFormData,
    include?: PaintTypeInclude,
    userId?: string,
  ): Promise<PaintTypeCreateResponse> {
    return await this.prisma.$transaction(async tx => {
      // Validate data
      await this.validatePaintType(data, undefined, tx);

      // Create paint type
      const paintType = await this.paintTypeRepository.createWithTransaction(tx, data, { include });

      // Log the creation with field-level tracking
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT_TYPE,
        entityId: paintType.id,
        action: CHANGE_ACTION.CREATE,
        entity: paintType,
        reason: 'Tipo de tinta criado',
        userId: userId || 'system',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_TYPE_CREATE,
        transaction: tx,
      });

      return {
        success: true,
        message: 'Tipo de tinta criado com sucesso',
        data: paintType,
      };
    });
  }

  /**
   * Update a paint type
   */
  async update(
    id: string,
    data: PaintTypeUpdateFormData,
    include?: PaintTypeInclude,
    userId?: string,
  ): Promise<PaintTypeUpdateResponse> {
    return await this.prisma.$transaction(async tx => {
      // Check if exists
      const existing = await this.paintTypeRepository.findByIdWithTransaction(tx, id);
      if (!existing) {
        throw new NotFoundException('Tipo de tinta não encontrado');
      }

      // Validate data
      await this.validatePaintType(data, id, tx);

      // Update paint type
      const paintType = await this.paintTypeRepository.updateWithTransaction(tx, id, data, {
        include,
      });

      // Track field-level changes for: name, type
      const fieldsToTrack: string[] = ['name', 'type'];

      // Only track fields that were actually provided in the update data
      const fieldsToTrackFiltered = fieldsToTrack.filter(field => field in data);

      if (fieldsToTrackFiltered.length > 0) {
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_TYPE,
          entityId: id,
          oldEntity: existing,
          newEntity: paintType,
          fieldsToTrack: fieldsToTrackFiltered,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_TYPE_UPDATE,
          transaction: tx,
        });
      }

      return {
        success: true,
        message: 'Tipo de tinta atualizado com sucesso',
        data: paintType,
      };
    });
  }

  /**
   * Delete a paint type
   */
  async delete(id: string, userId?: string): Promise<PaintTypeDeleteResponse> {
    return await this.prisma.$transaction(async tx => {
      // Check if exists
      const existing = await this.paintTypeRepository.findByIdWithTransaction(tx, id);
      if (!existing) {
        throw new NotFoundException('Tipo de tinta não encontrado');
      }

      // Check if has related paints
      const paintCount = await tx.paint.count({
        where: { paintTypeId: id },
      });

      if (paintCount > 0) {
        throw new BadRequestException(
          `Não é possível excluir este tipo de tinta pois existem ${paintCount} tintas associadas`,
        );
      }

      // Delete paint type
      await this.paintTypeRepository.deleteWithTransaction(tx, id);

      // Log the deletion with field-level tracking
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT_TYPE,
        entityId: id,
        action: CHANGE_ACTION.DELETE,
        oldEntity: existing,
        reason: 'Tipo de tinta excluído',
        userId: userId || 'system',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_TYPE_DELETE,
        transaction: tx,
      });

      return {
        success: true,
        message: 'Tipo de tinta excluído com sucesso',
      };
    });
  }

  /**
   * Batch create paint types
   */
  async batchCreate(
    data: PaintTypeBatchCreateFormData,
    include?: PaintTypeInclude,
    userId?: string,
  ): Promise<PaintTypeBatchCreateResponse<PaintTypeCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.paintTypeRepository.createManyWithTransaction(
          tx,
          data.paintTypes,
          { include },
        );

        // Log successful creations with field-level tracking
        for (const paintType of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT_TYPE,
            entityId: paintType.id,
            action: CHANGE_ACTION.CREATE,
            entity: paintType,
            reason: 'Tipo de tinta criado em lote',
            userId: userId || 'system',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_TYPE_BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 tipo de tinta criado com sucesso'
          : `${result.totalCreated} tipos de tinta criados com sucesso`;
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
    } catch (error) {
      this.logger.error('Erro ao criar tipos de tinta em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar tipos de tinta em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch update paint types
   */
  async batchUpdate(
    data: PaintTypeBatchUpdateFormData,
    include?: PaintTypeInclude,
    userId?: string,
  ): Promise<PaintTypeBatchUpdateResponse<PaintTypeUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // First fetch all existing entities for comparison
        const idsToUpdate = data.paintTypes.map(item => item.id);
        const existingEntities = await tx.paintType.findMany({
          where: { id: { in: idsToUpdate } },
        });

        // Create a map for quick lookup
        const existingMap = new Map(existingEntities.map(entity => [entity.id, entity]));

        // Ensure all items have required id and data fields
        const validatedItems = data.paintTypes.map(item => ({
          id: item.id!,
          data: item.data!,
        }));
        const result = await this.paintTypeRepository.updateManyWithTransaction(
          tx,
          validatedItems,
          { include },
        );

        // Log successful updates with field-level tracking
        for (const paintType of result.success) {
          const existing = existingMap.get(paintType.id);
          if (existing) {
            // Track field-level changes for: name, type
            const fieldsToTrack: string[] = ['name', 'type'];

            // Find which update data corresponds to this paintType
            const updateData = data.paintTypes.find(item => item.id === paintType.id)?.data;

            if (updateData) {
              // Only track fields that were actually provided in the update data
              const fieldsToTrackFiltered = fieldsToTrack.filter(field => field in updateData);

              if (fieldsToTrackFiltered.length > 0) {
                await trackAndLogFieldChanges({
                  changeLogService: this.changeLogService,
                  entityType: ENTITY_TYPE.PAINT_TYPE,
                  entityId: paintType.id,
                  oldEntity: existing,
                  newEntity: paintType,
                  fieldsToTrack: fieldsToTrackFiltered,
                  userId: userId || 'system',
                  triggeredBy: CHANGE_TRIGGERED_BY.PAINT_TYPE_BATCH_UPDATE,
                  transaction: tx,
                });
              }
            }
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 tipo de tinta atualizado com sucesso'
          : `${result.totalUpdated} tipos de tinta atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
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
    } catch (error) {
      this.logger.error('Erro ao atualizar tipos de tinta em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar tipos de tinta em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete paint types
   */
  async batchDelete(
    data: PaintTypeBatchDeleteFormData,
    userId?: string,
  ): Promise<PaintTypeBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // First fetch all existing entities for logging before deletion
        const existingEntities = await tx.paintType.findMany({
          where: { id: { in: data.paintTypeIds } },
        });

        // Create a map for quick lookup
        const existingMap = new Map(existingEntities.map(entity => [entity.id, entity]));

        const result = await this.paintTypeRepository.deleteManyWithTransaction(
          tx,
          data.paintTypeIds,
        );

        // Log successful deletions with field-level tracking
        for (const deleted of result.success) {
          const existing = existingMap.get(deleted.id);
          if (existing) {
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PAINT_TYPE,
              entityId: deleted.id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: existing,
              reason: 'Tipo de tinta deletado em lote',
              userId: userId || 'system',
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_TYPE_BATCH_DELETE,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 tipo de tinta deletado com sucesso'
          : `${result.totalDeleted} tipos de tinta deletados com sucesso`;
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
      this.logger.error('Erro ao deletar tipos de tinta em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao deletar tipos de tinta em lote. Por favor, tente novamente.',
      );
    }
  }
}
