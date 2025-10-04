import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PaintBrandRepository } from './repositories/paint-brand/paint-brand.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ChangeLogService } from '../common/changelog/changelog.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../constants/enums';
import { trackFieldChanges, trackAndLogFieldChanges, logEntityChange } from '../common/changelog/utils/changelog-helpers';
import {
  PaintBrandCreateFormData,
  PaintBrandUpdateFormData,
  PaintBrandGetManyFormData,
  PaintBrandBatchCreateFormData,
  PaintBrandBatchUpdateFormData,
  PaintBrandBatchDeleteFormData,
  PaintBrandInclude,
} from '../../schemas/paint';
import {
  PaintBrandGetManyResponse,
  PaintBrandGetUniqueResponse,
  PaintBrandCreateResponse,
  PaintBrandUpdateResponse,
  PaintBrandDeleteResponse,
  PaintBrandBatchCreateResponse,
  PaintBrandBatchUpdateResponse,
  PaintBrandBatchDeleteResponse,
} from '../../types';
import { BatchOperationResult } from '../../types';

@Injectable()
export class PaintBrandService {
  private readonly logger = new Logger(PaintBrandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paintBrandRepository: PaintBrandRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validate paint brand data
   */
  private async validatePaintBrand(
    data: Partial<PaintBrandCreateFormData | PaintBrandUpdateFormData>,
    excludeId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const errors: string[] = [];

    // Check name uniqueness if provided
    if (data.name) {
      const existing = await (tx
        ? this.paintBrandRepository.findByNameWithTransaction(tx, data.name)
        : this.paintBrandRepository.findByName(data.name));

      if (existing && existing.id !== excludeId) {
        errors.push(`Já existe uma marca de tinta com o nome "${data.name}"`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors.join(', '));
    }
  }

  /**
   * Find many paint brands
   */
  async findMany(params?: PaintBrandGetManyFormData): Promise<PaintBrandGetManyResponse> {
    try {
      const result = await this.paintBrandRepository.findMany(params);

      return {
        success: true,
        message: 'Marcas de tinta encontradas com sucesso',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar marcas de tinta', error);
      throw new InternalServerErrorException('Erro ao buscar marcas de tinta');
    }
  }

  /**
   * Find paint brand by ID
   */
  async findById(id: string, include?: PaintBrandInclude): Promise<PaintBrandGetUniqueResponse> {
    const paintBrand = await this.paintBrandRepository.findById(id, { include });

    if (!paintBrand) {
      throw new NotFoundException('Marca de tinta não encontrada');
    }

    return {
      success: true,
      message: 'Marca de tinta encontrada com sucesso',
      data: paintBrand,
    };
  }

  /**
   * Create a new paint brand
   */
  async create(
    data: PaintBrandCreateFormData,
    include?: PaintBrandInclude,
    userId?: string,
  ): Promise<PaintBrandCreateResponse> {
    return await this.prisma.$transaction(async tx => {
      // Validate data
      await this.validatePaintBrand(data, undefined, tx);

      // Create paint brand
      const paintBrand = await this.paintBrandRepository.createWithTransaction(tx, data, {
        include,
      });

      // Log the creation with field-level tracking
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT_BRAND,
        entityId: paintBrand.id,
        action: CHANGE_ACTION.CREATE,
        entity: paintBrand,
        reason: 'Marca de tinta criada',
        userId: userId || 'system',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BRAND_CREATE,
        transaction: tx,
      });

      return {
        success: true,
        message: 'Marca de tinta criada com sucesso',
        data: paintBrand,
      };
    });
  }

  /**
   * Update a paint brand
   */
  async update(
    id: string,
    data: PaintBrandUpdateFormData,
    include?: PaintBrandInclude,
    userId?: string,
  ): Promise<PaintBrandUpdateResponse> {
    return await this.prisma.$transaction(async tx => {
      // Check if exists
      const existing = await this.paintBrandRepository.findByIdWithTransaction(tx, id);
      if (!existing) {
        throw new NotFoundException('Marca de tinta não encontrada');
      }

      // Validate data
      await this.validatePaintBrand(data, id, tx);

      // Update paint brand
      const paintBrand = await this.paintBrandRepository.updateWithTransaction(tx, id, data, {
        include,
      });

      // Track field-level changes for: name
      const fieldsToTrack: string[] = ['name'];

      // Only track fields that were actually provided in the update data
      const fieldsToTrackFiltered = fieldsToTrack.filter(field => field in data);

      if (fieldsToTrackFiltered.length > 0) {
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_BRAND,
          entityId: id,
          oldEntity: existing,
          newEntity: paintBrand,
          fieldsToTrack: fieldsToTrackFiltered,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BRAND_UPDATE,
          transaction: tx,
        });
      }

      return {
        success: true,
        message: 'Marca de tinta atualizada com sucesso',
        data: paintBrand,
      };
    });
  }

  /**
   * Delete a paint brand
   */
  async delete(id: string, userId?: string): Promise<PaintBrandDeleteResponse> {
    return await this.prisma.$transaction(async tx => {
      // Check if exists
      const existing = await this.paintBrandRepository.findByIdWithTransaction(tx, id);
      if (!existing) {
        throw new NotFoundException('Marca de tinta não encontrada');
      }

      // Check if has related paints
      const paintCount = await tx.paint.count({
        where: { paintBrandId: id },
      });

      if (paintCount > 0) {
        throw new BadRequestException(
          `Não é possível excluir esta marca de tinta pois existem ${paintCount} tintas associadas`,
        );
      }

      // Check if has related component items
      const componentItemCount = await tx.item.count({
        where: {
          paintTypes: {
            some: {
              paints: {
                some: {
                  paintBrandId: id,
                },
              },
            },
          },
        },
      });

      if (componentItemCount > 0) {
        throw new BadRequestException(
          `Não é possível excluir esta marca de tinta pois existem ${componentItemCount} componentes associados`,
        );
      }

      // Delete paint brand
      await this.paintBrandRepository.deleteWithTransaction(tx, id);

      // Log the deletion with field-level tracking
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT_BRAND,
        entityId: id,
        action: CHANGE_ACTION.DELETE,
        oldEntity: existing,
        reason: 'Marca de tinta excluída',
        userId: userId || 'system',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BRAND_DELETE,
        transaction: tx,
      });

      return {
        success: true,
        message: 'Marca de tinta excluída com sucesso',
      };
    });
  }

  /**
   * Batch create paint brands
   */
  async batchCreate(
    data: PaintBrandBatchCreateFormData,
    include?: PaintBrandInclude,
    userId?: string,
  ): Promise<PaintBrandBatchCreateResponse<PaintBrandCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.paintBrandRepository.createManyWithTransaction(
          tx,
          data.paintBrands,
          { include },
        );

        // Log successful creations with field-level tracking
        for (const paintBrand of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT_BRAND,
            entityId: paintBrand.id,
            action: CHANGE_ACTION.CREATE,
            entity: paintBrand,
            reason: 'Marca de tinta criada em lote',
            userId: userId || 'system',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BRAND_BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 marca de tinta criada com sucesso'
          : `${result.totalCreated} marcas de tinta criadas com sucesso`;
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
      this.logger.error('Erro ao criar marcas de tinta em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar marcas de tinta em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch update paint brands
   */
  async batchUpdate(
    data: PaintBrandBatchUpdateFormData,
    include?: PaintBrandInclude,
    userId?: string,
  ): Promise<PaintBrandBatchUpdateResponse<PaintBrandUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // First fetch all existing entities for comparison
        const idsToUpdate = data.paintBrands.map(item => item.id);
        const existingEntities = await tx.paintBrand.findMany({
          where: { id: { in: idsToUpdate } },
        });

        // Create a map for quick lookup
        const existingMap = new Map(existingEntities.map(entity => [entity.id, entity]));

        // Ensure all items have required id and data fields
        const validatedItems = data.paintBrands.map(item => ({
          id: item.id!,
          data: item.data!,
        }));
        const result = await this.paintBrandRepository.updateManyWithTransaction(
          tx,
          validatedItems,
          { include },
        );

        // Log successful updates with field-level tracking
        for (const paintBrand of result.success) {
          const existing = existingMap.get(paintBrand.id);
          if (existing) {
            // Track field-level changes for: name
            const fieldsToTrack: string[] = ['name'];

            // Find which update data corresponds to this paintBrand
            const updateData = data.paintBrands.find(item => item.id === paintBrand.id)?.data;

            if (updateData) {
              // Only track fields that were actually provided in the update data
              const fieldsToTrackFiltered = fieldsToTrack.filter(field => field in updateData);

              if (fieldsToTrackFiltered.length > 0) {
                await trackAndLogFieldChanges({
                  changeLogService: this.changeLogService,
                  entityType: ENTITY_TYPE.PAINT_BRAND,
                  entityId: paintBrand.id,
                  oldEntity: existing,
                  newEntity: paintBrand,
                  fieldsToTrack: fieldsToTrackFiltered,
                  userId: userId || 'system',
                  triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BRAND_BATCH_UPDATE,
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
          ? '1 marca de tinta atualizada com sucesso'
          : `${result.totalUpdated} marcas de tinta atualizadas com sucesso`;
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
      this.logger.error('Erro ao atualizar marcas de tinta em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar marcas de tinta em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete paint brands
   */
  async batchDelete(
    data: PaintBrandBatchDeleteFormData,
    userId?: string,
  ): Promise<PaintBrandBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // First fetch all existing entities for logging before deletion
        const existingEntities = await tx.paintBrand.findMany({
          where: { id: { in: data.paintBrandIds } },
        });

        // Create a map for quick lookup
        const existingMap = new Map(existingEntities.map(entity => [entity.id, entity]));

        const result = await this.paintBrandRepository.deleteManyWithTransaction(
          tx,
          data.paintBrandIds,
        );

        // Log successful deletions with field-level tracking
        for (const deleted of result.success) {
          const existing = existingMap.get(deleted.id);
          if (existing) {
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PAINT_BRAND,
              entityId: deleted.id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: existing,
              reason: 'Marca de tinta deletada em lote',
              userId: userId || 'system',
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BRAND_BATCH_DELETE,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 marca de tinta deletada com sucesso'
          : `${result.totalDeleted} marcas de tinta deletadas com sucesso`;
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
      this.logger.error('Erro ao deletar marcas de tinta em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao deletar marcas de tinta em lote. Por favor, tente novamente.',
      );
    }
  }
}
