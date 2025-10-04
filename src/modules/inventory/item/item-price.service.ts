import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import { ItemPriceRepository } from './repositories/item-price/item-price.repository';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  PriceCreateFormData,
  PriceUpdateFormData,
  PriceGetManyFormData,
  PriceInclude,
  PriceBatchCreateFormData,
  PriceBatchUpdateFormData,
  PriceBatchDeleteFormData,
} from '../../../schemas/item';
import {
  PriceGetUniqueResponse,
  PriceGetManyResponse,
  PriceCreateResponse,
  PriceUpdateResponse,
  PriceDeleteResponse,
  PriceBatchCreateResponse,
  PriceBatchUpdateResponse,
  PriceBatchDeleteResponse,
} from '../../../types';

@Injectable()
export class ItemPriceService {
  constructor(
    private readonly repository: ItemPriceRepository,
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  // Validation methods
  private async validateUniqueConstraints(
    data: PriceCreateFormData | PriceUpdateFormData,
    excludeId?: string,
  ): Promise<void> {
    // ItemPrice has no unique constraints
    // Method included for consistency with other services
  }

  // Single operations
  async create(
    data: PriceCreateFormData,
    include?: PriceInclude,
    userId?: string,
  ): Promise<PriceCreateResponse> {
    try {
      // Check if item exists
      const item = await this.prisma.item.findUnique({
        where: { id: data.itemId },
      });

      if (!item) {
        throw new NotFoundException('Item não encontrado. Verifique se o ID está correto.');
      }

      const created = await this.prisma.$transaction(async tx => {
        const price = await this.repository.createWithTransaction(tx, data, { include });

        // Update item's totalPrice with the new price
        const updatedItem = await tx.item.update({
          where: { id: data.itemId },
          data: {
            totalPrice: item.quantity * data.value,
          },
        });

        // Log price creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PRICE,
          entityId: price.id,
          action: CHANGE_ACTION.CREATE,
          entity: price,
          reason: 'Novo preço cadastrado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        // Log item totalPrice update
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: data.itemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'totalPrice',
          oldValue: item.totalPrice,
          newValue: updatedItem.totalPrice,
          reason: 'Preço total atualizado devido a novo preço',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: price.id,
          userId: userId || null,
          transaction: tx,
        });

        return price;
      });

      return {
        success: true,
        data: created,
        message: 'Preço criado com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao criar preço: ${errorMessage}`);
    }
  }

  async update(
    id: string,
    data: PriceUpdateFormData,
    include?: PriceInclude,
    userId?: string,
  ): Promise<PriceUpdateResponse> {
    try {
      const updated = await this.prisma.$transaction(async tx => {
        // Check if price exists
        const existing = await this.repository.findByIdWithTransaction(tx, id);
        if (!existing) {
          throw new NotFoundException('Preço não encontrado. Verifique se o ID está correto.');
        }

        const price = await this.repository.updateWithTransaction(tx, id, data, { include });

        // Track field-level changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PRICE,
          entityId: price.id,
          oldEntity: existing,
          newEntity: price,
          fieldsToTrack: ['value', 'tax', 'itemId'],
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // If value changed, update item's totalPrice
        if (existing.value !== price.value) {
          const item = await tx.item.findUnique({
            where: { id: price.itemId },
          });

          if (item) {
            const oldTotalPrice = item.totalPrice;
            const newTotalPrice = item.quantity * price.value;

            const updatedItem = await tx.item.update({
              where: { id: price.itemId },
              data: {
                totalPrice: newTotalPrice,
              },
            });

            // Log item totalPrice update
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: price.itemId,
              action: CHANGE_ACTION.UPDATE,
              field: 'totalPrice',
              oldValue: oldTotalPrice,
              newValue: newTotalPrice,
              reason: 'Preço total atualizado devido a mudança no preço unitário',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: price.id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return price;
      });

      return {
        success: true,
        data: updated,
        message: 'Preço atualizado com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao atualizar preço: ${errorMessage}`);
    }
  }

  async delete(id: string, userId?: string): Promise<PriceDeleteResponse> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if price exists
        const existing = await this.repository.findByIdWithTransaction(tx, id);
        if (!existing) {
          throw new NotFoundException('Preço não encontrado. Verifique se o ID está correto.');
        }

        await this.repository.deleteWithTransaction(tx, id);

        // Log deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PRICE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason: 'Preço excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Preço excluído com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao excluir preço: ${errorMessage}`);
    }
  }

  async findById(id: string, include?: PriceInclude): Promise<PriceGetUniqueResponse> {
    try {
      const price = await this.repository.findById(id, { include });
      if (!price) {
        throw new NotFoundException('Preço não encontrado. Verifique se o ID está correto.');
      }

      return {
        success: true,
        message: 'Preço encontrado com sucesso.',
        data: price,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao buscar preço: ${errorMessage}`);
    }
  }

  async findMany(query: PriceGetManyFormData): Promise<PriceGetManyResponse> {
    try {
      const result = await this.repository.findMany(query);

      return {
        success: true,
        message: 'Preços carregados com sucesso.',
        ...result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao buscar preços: ${errorMessage}`);
    }
  }

  // Batch operations
  async batchCreate(
    data: PriceBatchCreateFormData,
    include?: PriceInclude,
    userId?: string,
  ): Promise<PriceBatchCreateResponse<PriceCreateFormData>> {
    try {
      // Validate all items exist
      const itemIds = [...new Set(data.prices.map(p => p.itemId))];
      const existingItems = await this.prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true },
      });

      const existingItemIds = new Set(existingItems.map(i => i.id));
      const missingItemIds = itemIds.filter(id => !existingItemIds.has(id));

      if (missingItemIds.length > 0) {
        throw new NotFoundException(
          `Os seguintes itens não foram encontrados: ${missingItemIds.join(', ')}`,
        );
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.repository.createManyWithTransaction(tx, data.prices, {
          include,
        });

        // Log successful creations
        for (const price of batchResult.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PRICE,
            entityId: price.id,
            action: CHANGE_ACTION.CREATE,
            entity: price,
            reason: 'Preço criado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 preço criado com sucesso'
          : `${result.totalCreated} preços criados com sucesso`;
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
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao criar preços em lote: ${errorMessage}`);
    }
  }

  async batchUpdate(
    data: PriceBatchUpdateFormData,
    include?: PriceInclude,
    userId?: string,
  ): Promise<PriceBatchUpdateResponse<PriceUpdateFormData>> {
    try {
      // Validate IDs exist
      const ids = data.prices.map(item => item.id);
      const existingPrices = await this.repository.findByIds(ids);
      const existingIds = new Set(existingPrices.map(p => p.id));

      const missingIds = ids.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundException(
          `Os seguintes preços não foram encontrados: ${missingIds.join(', ')}`,
        );
      }

      const updateData = data.prices.map(item => ({ id: item.id, data: item.data }));
      const result = await this.prisma.$transaction(async tx => {
        // Get existing prices for comparison
        const existingPricesMap = new Map(existingPrices.map(p => [p.id, p]));

        const batchResult = await this.repository.updateManyWithTransaction(tx, updateData, {
          include,
        });

        // Log successful updates with field-level tracking
        for (const price of batchResult.success) {
          const oldPrice = existingPricesMap.get(price.id);
          if (oldPrice) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PRICE,
              entityId: price.id,
              oldEntity: oldPrice,
              newEntity: price,
              fieldsToTrack: ['value', 'tax', 'itemId'],
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return batchResult;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 preço atualizado com sucesso'
          : `${result.totalUpdated} preços atualizados com sucesso`;
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
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao atualizar preços em lote: ${errorMessage}`);
    }
  }

  async batchDelete(
    data: PriceBatchDeleteFormData,
    userId?: string,
  ): Promise<PriceBatchDeleteResponse> {
    try {
      // Check if all prices exist
      const existingPrices = await this.repository.findByIds(data.priceIds);
      const existingIds = new Set(existingPrices.map(p => p.id));

      const missingIds = data.priceIds.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundException(
          `Os seguintes preços não foram encontrados: ${missingIds.join(', ')}`,
        );
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.repository.deleteManyWithTransaction(tx, data.priceIds);

        // Log successful deletions
        for (const item of batchResult.success) {
          if (item.deleted) {
            const deletedPrice = existingPrices.find(p => p.id === item.id);
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PRICE,
              entityId: item.id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: deletedPrice,
              reason: 'Preço excluído em lote',
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
          ? '1 preço excluído com sucesso'
          : `${result.totalDeleted} preços excluídos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success.map(item => ({ id: item.id, deleted: true })),
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
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao excluir preços em lote: ${errorMessage}`);
    }
  }
}
