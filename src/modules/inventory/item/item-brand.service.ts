import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { trackFieldChanges, trackAndLogFieldChanges, logEntityChange } from '@modules/common/changelog/utils';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import { ItemBrandRepository } from './repositories/item-brand/item-brand.repository';
import { ItemRepository } from './repositories/item/item.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  ItemBrandCreateFormData,
  ItemBrandUpdateFormData,
  ItemBrandGetManyFormData,
  ItemBrandInclude,
  ItemBrandBatchCreateFormData,
  ItemBrandBatchUpdateFormData,
  ItemBrandBatchDeleteFormData,
} from '../../../schemas/item';
import {
  ItemBrand,
  ItemBrandGetUniqueResponse,
  ItemBrandGetManyResponse,
  ItemBrandCreateResponse,
  ItemBrandUpdateResponse,
  ItemBrandDeleteResponse,
  ItemBrandBatchCreateResponse,
  ItemBrandBatchUpdateResponse,
  ItemBrandBatchDeleteResponse,
} from '../../../types';

@Injectable()
export class ItemBrandService {
  constructor(
    private readonly repository: ItemBrandRepository,
    private readonly itemRepository: ItemRepository,
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  private async validateUniqueConstraints(
    name: string,
    excludeId?: string,
    tx?: any,
  ): Promise<void> {
    const prismaClient = tx || this.prisma;

    const existing = await prismaClient.itemBrand.findFirst({
      where: {
        name,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });

    if (existing) {
      throw new ConflictException('Nome da marca já está em uso');
    }
  }

  private async validateItemIds(itemIds: string[], tx?: PrismaTransaction): Promise<void> {
    if (!itemIds || itemIds.length === 0) return;

    const items = tx
      ? await this.itemRepository.findByIdsWithTransaction(tx, itemIds)
      : await this.itemRepository.findByIds(itemIds);

    const foundIds = new Set(items.map(item => item.id));
    const missingIds = itemIds.filter(id => !foundIds.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Os seguintes itens não foram encontrados: ${missingIds.join(', ')}`,
      );
    }
  }

  private async updateItemBrandAssociations(
    brandId: string,
    itemIds: string[],
    tx: PrismaTransaction,
    userId: string,
  ): Promise<void> {
    if (!itemIds || itemIds.length === 0) return;

    // Update all specified items to use this brand
    await tx.item.updateMany({
      where: { id: { in: itemIds } },
      data: { brandId: brandId },
    });

    // Log the association changes
    for (const itemId of itemIds) {
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.ITEM,
        entityId: itemId,
        action: CHANGE_ACTION.UPDATE,
        reason: `Item associado à marca ${brandId}`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: tx,
      });
    }
  }

  private async handleItemBrandAssociationChanges(
    brandId: string,
    currentItemIds: string[],
    newItemIds: string[],
    tx: PrismaTransaction,
    userId: string,
  ): Promise<void> {
    const currentSet = new Set(currentItemIds);
    const newSet = new Set(newItemIds);

    // Items to remove from this brand
    const itemsToRemove = currentItemIds.filter(id => !newSet.has(id));
    if (itemsToRemove.length > 0) {
      // Set brandId to null for items being removed from this brand
      await tx.item.updateMany({
        where: { id: { in: itemsToRemove } },
        data: { brandId: null },
      });

      // Log removal for each item
      for (const itemId of itemsToRemove) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM,
          entityId: itemId,
          action: CHANGE_ACTION.UPDATE,
          reason: `Item removido da marca ${brandId}`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });
      }
    }

    // Items to add to this brand
    const itemsToAdd = newItemIds.filter(id => !currentSet.has(id));
    if (itemsToAdd.length > 0) {
      // First check if these items belong to other brands
      const itemsToUpdate = await tx.item.findMany({
        where: { id: { in: itemsToAdd } },
        select: { id: true, brandId: true, name: true },
      });

      // Update items to new brand
      await tx.item.updateMany({
        where: { id: { in: itemsToAdd } },
        data: { brandId: brandId },
      });

      // Log additions with more context
      for (const item of itemsToUpdate) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM,
          entityId: item.id,
          action: CHANGE_ACTION.UPDATE,
          reason:
            item.brandId !== brandId
              ? `Item "${item.name}" movido da marca ${item.brandId} para ${brandId}`
              : `Item "${item.name}" associado à marca ${brandId}`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });
      }
    }
  }

  // Single operations
  async create(
    data: ItemBrandCreateFormData,
    include?: ItemBrandInclude,
    userId?: string,
  ): Promise<ItemBrandCreateResponse> {
    try {
      const { itemIds, ...brandData } = data;

      // Validate unique constraints
      await this.validateUniqueConstraints(brandData.name);

      // Validate item IDs if provided
      if (itemIds && itemIds.length > 0) {
        await this.validateItemIds(itemIds);
      }

      const created = await this.prisma.$transaction(async tx => {
        const brand = await this.repository.createWithTransaction(tx, brandData, { include });

        // Handle item associations if provided
        if (itemIds && itemIds.length > 0) {
          await this.updateItemBrandAssociations(brand.id, itemIds, tx, userId || '');
        }

        // Log creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM_BRAND,
          entityId: brand.id,
          action: CHANGE_ACTION.CREATE,
          entity: brand,
          reason:
            itemIds && itemIds.length > 0
              ? `Marca criada com ${itemIds.length} ${itemIds.length === 1 ? 'item associado' : 'itens associados'}`
              : 'Marca criada',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return brand;
      });

      return {
        success: true,
        data: created,
        message: 'Marca criada com sucesso.',
      };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao criar marca: ${errorMessage}`);
    }
  }

  async update(
    id: string,
    data: ItemBrandUpdateFormData,
    include?: ItemBrandInclude,
    userId?: string,
  ): Promise<ItemBrandUpdateResponse> {
    try {
      const { itemIds, ...brandData } = data;

      // Check if brand exists and get current associated items
      const existing = await this.repository.findById(id, { include: { items: true } });
      if (!existing) {
        throw new NotFoundException('Marca não encontrada. Verifique se o ID está correto.');
      }

      // Validate unique constraints if name is being updated
      if (brandData.name && brandData.name !== existing.name) {
        await this.validateUniqueConstraints(brandData.name, id);
      }

      // Validate item IDs if provided
      if (itemIds && itemIds.length > 0) {
        await this.validateItemIds(itemIds);
      }

      const updated = await this.prisma.$transaction(async tx => {
        // Get existing brand before update
        const existingBrand = await this.repository.findByIdWithTransaction(tx, id);
        if (!existingBrand) {
          throw new NotFoundException('Marca não encontrada');
        }

        const brand = await this.repository.updateWithTransaction(tx, id, brandData, { include });

        // Handle item associations if itemIds is provided
        if (itemIds !== undefined) {
          const currentItemIds = existing.items?.map(item => item.id) || [];
          await this.handleItemBrandAssociationChanges(
            brand.id,
            currentItemIds,
            itemIds,
            tx,
            userId || '',
          );
        }

        // Track field-level changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM_BRAND,
          entityId: brand.id,
          oldEntity: existingBrand,
          newEntity: brand,
          fieldsToTrack: ['name'],
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return brand;
      });

      return {
        success: true,
        data: updated,
        message: 'Marca atualizada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao atualizar marca: ${errorMessage}`);
    }
  }

  async delete(id: string, userId?: string): Promise<ItemBrandDeleteResponse> {
    try {
      // Check if brand exists
      const existing = await this.repository.findById(id, { include: { items: true } });
      if (!existing) {
        throw new NotFoundException('Marca não encontrada. Verifique se o ID está correto.');
      }

      await this.prisma.$transaction(async tx => {
        // If brand has items, set their brandId to null
        if (existing.items && existing.items.length > 0) {
          await tx.item.updateMany({
            where: { brandId: id },
            data: { brandId: null },
          });

          // Log the update for each item
          for (const item of existing.items) {
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ITEM,
              entityId: item.id,
              action: CHANGE_ACTION.UPDATE,
              reason: `Item removido da marca ${existing.name} devido à exclusão da marca`,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              transaction: tx,
            });
          }
        }

        await this.repository.deleteWithTransaction(tx, id);

        // Log deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM_BRAND,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason:
            existing.items && existing.items.length > 0
              ? `Marca excluída e ${existing.items.length} ${existing.items.length === 1 ? 'item removido' : 'itens removidos'} da marca`
              : 'Marca excluída',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });
      });

      return {
        success: true,
        message:
          existing.items && existing.items.length > 0
            ? `Marca excluída com sucesso. ${existing.items.length} ${existing.items.length === 1 ? 'item foi removido' : 'itens foram removidos'} da marca.`
            : 'Marca excluída com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao excluir marca: ${errorMessage}`);
    }
  }

  async findById(id: string, include?: ItemBrandInclude): Promise<ItemBrandGetUniqueResponse> {
    try {
      const brand = await this.repository.findById(id, { include });
      if (!brand) {
        throw new NotFoundException('Marca não encontrada. Verifique se o ID está correto.');
      }

      return {
        success: true,
        message: 'Marca encontrada com sucesso.',
        data: brand,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao buscar marca: ${errorMessage}`);
    }
  }

  async findMany(query: ItemBrandGetManyFormData): Promise<ItemBrandGetManyResponse> {
    try {
      const result = await this.repository.findMany(query);

      return {
        success: true,
        message: 'Marcas carregadas com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao buscar marcas: ${errorMessage}`);
    }
  }

  // Batch operations
  async batchCreate(
    data: ItemBrandBatchCreateFormData,
    include?: ItemBrandInclude,
    userId?: string,
  ): Promise<ItemBrandBatchCreateResponse<ItemBrandCreateFormData>> {
    try {
      // Check for duplicate names in the batch
      const names = data.itemBrands.map(item => item.name);
      const uniqueNames = new Set(names);
      if (names.length !== uniqueNames.size) {
        // Find duplicates and create detailed error response
        const nameCount = new Map<string, number[]>();
        names.forEach((name, index) => {
          if (!nameCount.has(name)) {
            nameCount.set(name, []);
          }
          nameCount.get(name)!.push(index);
        });

        const duplicates = Array.from(nameCount.entries())
          .filter(([_, indexes]) => indexes.length > 1)
          .map(([name, indexes]) => ({ name, indexes }));

        const failed = duplicates.flatMap(({ name, indexes }) =>
          indexes.slice(1).map(index => ({
            index,
            id: '',
            error: 'Nome da marca já está em uso',
            errorCode: 'DUPLICATE_NAME',
            data: data.itemBrands[index],
          })),
        );

        return {
          success: false,
          message: 'Existem nomes duplicados no lote de criação',
          data: {
            success: [],
            failed,
            totalProcessed: data.itemBrands.length,
            totalSuccess: 0,
            totalFailed: failed.length,
          },
        };
      }

      // Validate unique constraints for all items
      const failed: Array<{
        index: number;
        id: string;
        error: string;
        errorCode: string;
        data: any;
      }> = [];
      const validItems: Array<{ index: number; data: ItemBrandCreateFormData }> = [];

      for (let i = 0; i < data.itemBrands.length; i++) {
        const item = data.itemBrands[i];
        try {
          await this.validateUniqueConstraints(item.name);

          // Validate item IDs if provided
          if (item.itemIds && item.itemIds.length > 0) {
            await this.validateItemIds(item.itemIds);
          }

          validItems.push({ index: i, data: item });
        } catch (error) {
          failed.push({
            index: i,
            id: '',
            error:
              error instanceof ConflictException || error instanceof NotFoundException
                ? error.message
                : 'Erro ao validar marca',
            errorCode: 'VALIDATION_ERROR',
            data: item,
          });
        }
      }

      if (validItems.length === 0) {
        return {
          success: false,
          message: 'Nenhuma marca pôde ser criada devido a erros de validação',
          data: {
            success: [],
            failed,
            totalProcessed: data.itemBrands.length,
            totalSuccess: 0,
            totalFailed: failed.length,
          },
        };
      }

      const result = await this.prisma.$transaction(async tx => {
        // Split data into brand data and item associations
        const brandDataArray = validItems.map(item => {
          const { itemIds, ...brandData } = item.data;
          return { ...item, brandData, itemIds };
        });

        const createResult = await this.repository.createManyWithTransaction(
          tx,
          brandDataArray.map(item => item.brandData),
          { include },
        );

        // Handle item associations for each successfully created brand
        for (let i = 0; i < createResult.success.length; i++) {
          const brand = createResult.success[i];
          const originalItem = brandDataArray.find(item => item.brandData.name === brand.name);

          if (originalItem?.itemIds && originalItem.itemIds.length > 0) {
            await this.updateItemBrandAssociations(
              brand.id,
              originalItem.itemIds,
              tx,
              userId || '',
            );
          }

          // Log creation with item count if applicable
          const itemCount = originalItem?.itemIds?.length || 0;
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ITEM_BRAND,
            entityId: brand.id,
            action: CHANGE_ACTION.CREATE,
            entity: brand,
            reason:
              itemCount > 0
                ? `Marca criada em lote com ${itemCount} ${itemCount === 1 ? 'item associado' : 'itens associados'}`
                : 'Marca criada em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            transaction: tx,
          });
        }

        return createResult;
      });

      // Merge failed items from validation with failed items from creation
      const allFailed = [
        ...failed,
        ...result.failed.map((error: any) => ({
          index: error.index || 0,
          id: error.id || '',
          error: error.error,
          errorCode: error.errorCode || 'CREATE_ERROR',
          data: error.data,
        })),
      ];

      const successMessage =
        result.totalCreated === 1
          ? '1 marca criada com sucesso'
          : `${result.totalCreated} marcas criadas com sucesso`;
      const failureMessage = allFailed.length > 0 ? `, ${allFailed.length} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: allFailed,
        totalProcessed: data.itemBrands.length,
        totalSuccess: result.totalCreated,
        totalFailed: allFailed.length,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao criar marcas em lote: ${errorMessage}`);
    }
  }

  async batchUpdate(
    data: ItemBrandBatchUpdateFormData,
    include?: ItemBrandInclude,
    userId?: string,
  ): Promise<ItemBrandBatchUpdateResponse<ItemBrand>> {
    try {
      // Validate IDs exist and get current item associations
      const ids = data.itemBrands.map(item => item.id);
      const existingBrands = await this.repository.findByIds(ids, { include: { items: true } });
      const existingBrandsMap = new Map(existingBrands.map(b => [b.id, b]));

      // Check for missing IDs and prepare detailed errors
      const failed: Array<{
        index: number;
        id: string;
        error: string;
        errorCode: string;
        data: any;
      }> = [];
      const validItems: Array<{
        index: number;
        id: string;
        data: ItemBrandUpdateFormData;
        currentName: string;
        currentItemIds: string[];
      }> = [];

      for (let i = 0; i < data.itemBrands.length; i++) {
        const item = data.itemBrands[i];
        const existing = existingBrandsMap.get(item.id);

        if (!existing) {
          failed.push({
            index: i,
            id: item.id,
            error: 'Marca não encontrada',
            errorCode: 'NOT_FOUND',
            data: { id: item.id, ...item.data },
          });
        } else {
          try {
            // Validate unique constraint if name is being changed
            if (item.data.name && item.data.name !== existing.name) {
              await this.validateUniqueConstraints(item.data.name, item.id);
            }

            // Validate item IDs if provided
            if (item.data.itemIds && item.data.itemIds.length > 0) {
              await this.validateItemIds(item.data.itemIds);
            }

            validItems.push({
              index: i,
              id: item.id,
              data: item.data,
              currentName: existing.name,
              currentItemIds: existing.items?.map(item => item.id) || [],
            });
          } catch (error) {
            failed.push({
              index: i,
              id: item.id,
              error:
                error instanceof ConflictException || error instanceof NotFoundException
                  ? error.message
                  : 'Erro ao validar marca',
              errorCode: 'VALIDATION_ERROR',
              data: { id: item.id, ...item.data },
            });
          }
        }
      }

      if (validItems.length === 0) {
        return {
          success: false,
          message: 'Nenhuma marca pôde ser atualizada devido a erros de validação',
          data: {
            success: [],
            failed,
            totalProcessed: data.itemBrands.length,
            totalSuccess: 0,
            totalFailed: failed.length,
          },
        };
      }

      const result = await this.prisma.$transaction(async tx => {
        const successItems: any[] = [];
        const failedItems: any[] = [];

        // Process each update individually to capture errors and log changes
        for (const item of validItems) {
          try {
            const { itemIds, ...brandData } = item.data;

            // Get existing brand before update
            const existingBrand = await this.repository.findByIdWithTransaction(tx, item.id);
            if (!existingBrand) {
              throw new NotFoundException('Marca não encontrada');
            }

            const updatedBrand = await this.repository.updateWithTransaction(
              tx,
              item.id,
              brandData,
              { include },
            );

            // Handle item associations if itemIds is provided
            if (itemIds !== undefined) {
              await this.handleItemBrandAssociationChanges(
                updatedBrand.id,
                item.currentItemIds,
                itemIds,
                tx,
                userId || '',
              );
            }

            successItems.push(updatedBrand);

            // Track field-level changes
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ITEM_BRAND,
              entityId: updatedBrand.id,
              oldEntity: existingBrand,
              newEntity: updatedBrand,
              fieldsToTrack: ['name'],
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          } catch (error: any) {
            failedItems.push({
              index: item.index,
              id: item.id,
              error: error.message || 'Erro desconhecido ao atualizar marca',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: { id: item.id, ...item.data },
            });
          }
        }

        return {
          success: successItems,
          failed: failedItems,
          totalUpdated: successItems.length,
          totalFailed: failedItems.length,
        };
      });

      // Merge failed items from validation with failed items from update
      const allFailed = [
        ...failed,
        ...result.failed.map((error: any) => ({
          index: error.index || 0,
          id: error.id || '',
          error: error.error,
          errorCode: error.errorCode || 'UPDATE_ERROR',
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
      ];

      const successMessage =
        result.totalUpdated === 1
          ? '1 marca atualizada com sucesso'
          : `${result.totalUpdated} marcas atualizadas com sucesso`;
      const failureMessage = allFailed.length > 0 ? `, ${allFailed.length} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: allFailed,
        totalProcessed: data.itemBrands.length,
        totalSuccess: result.totalUpdated,
        totalFailed: allFailed.length,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao atualizar marcas em lote: ${errorMessage}`);
    }
  }

  async batchDelete(
    data: ItemBrandBatchDeleteFormData,
    userId?: string,
  ): Promise<ItemBrandBatchDeleteResponse> {
    try {
      // Check if all brands exist
      const existingBrands = await this.repository.findByIds(data.itemBrandIds, {
        include: { items: true },
      });
      const existingIds = new Set(existingBrands.map(b => b.id));

      const missingIds = data.itemBrandIds.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundException(
          `As seguintes marcas não foram encontradas: ${missingIds.join(', ')}`,
        );
      }

      const result = await this.prisma.$transaction(async tx => {
        const successItems: any[] = [];
        const failedItems: any[] = [];

        // Process each deletion individually to log changes
        for (let index = 0; index < data.itemBrandIds.length; index++) {
          const brandId = data.itemBrandIds[index];
          try {
            const brand = existingBrands.find(b => b.id === brandId);
            if (!brand) {
              throw new NotFoundException('Marca não encontrada');
            }

            // If brand has items, set their brandId to null
            if (brand.items && brand.items.length > 0) {
              await tx.item.updateMany({
                where: { brandId: brandId },
                data: { brandId: null },
              });

              // Log the update for each item
              for (const item of brand.items) {
                await logEntityChange({
                  changeLogService: this.changeLogService,
                  entityType: ENTITY_TYPE.ITEM,
                  entityId: item.id,
                  action: CHANGE_ACTION.UPDATE,
                  reason: `Item removido da marca ${brand.name} devido à exclusão em lote da marca`,
                  userId: userId || null,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
                  transaction: tx,
                });
              }
            }

            await this.repository.deleteWithTransaction(tx, brandId);
            successItems.push({ id: brandId, deleted: true });

            // Log deletion
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.ITEM_BRAND,
              entityId: brandId,
              action: CHANGE_ACTION.DELETE,
              oldEntity: brand,
              reason:
                brand.items && brand.items.length > 0
                  ? `Marca excluída em lote e ${brand.items.length} ${brand.items.length === 1 ? 'item removido' : 'itens removidos'} da marca`
                  : 'Marca excluída em lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              transaction: tx,
            });
          } catch (error: any) {
            failedItems.push({
              index,
              id: brandId,
              error: error.message || 'Erro desconhecido ao excluir marca',
              errorCode: error.name || 'UNKNOWN_ERROR',
            });
          }
        }

        return {
          success: successItems,
          failed: failedItems,
          totalDeleted: successItems.length,
          totalFailed: failedItems.length,
        };
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 marca excluída com sucesso'
          : `${result.totalDeleted} marcas excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: { id: error.id || '' },
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
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao excluir marcas em lote: ${errorMessage}`);
    }
  }
}
