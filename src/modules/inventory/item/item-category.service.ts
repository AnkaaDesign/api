import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  ITEM_CATEGORY_TYPE,
} from '../../../constants/enums';
import { ItemCategoryRepository } from './repositories/item-category/item-category.repository';
import { ItemRepository } from './repositories/item/item.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  ItemCategoryCreateFormData,
  ItemCategoryUpdateFormData,
  ItemCategoryGetManyFormData,
  ItemCategoryInclude,
  ItemCategoryBatchCreateFormData,
  ItemCategoryBatchUpdateFormData,
  ItemCategoryBatchDeleteFormData,
} from '../../../schemas/item';
import {
  ItemCategoryGetUniqueResponse,
  ItemCategoryGetManyResponse,
  ItemCategoryCreateResponse,
  ItemCategoryUpdateResponse,
  ItemCategoryDeleteResponse,
  ItemCategoryBatchCreateResponse,
  ItemCategoryBatchUpdateResponse,
  ItemCategoryBatchDeleteResponse,
} from '../../../types';

@Injectable()
export class ItemCategoryService {
  // Define fields to track for item category changes
  private readonly ITEM_CATEGORY_FIELDS_TO_TRACK = ['name', 'type'];

  constructor(
    private readonly repository: ItemCategoryRepository,
    private readonly itemRepository: ItemRepository,
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  private async validateUniqueConstraints(
    data: { name?: string },
    excludeId?: string,
    tx?: any,
  ): Promise<void> {
    if (!data.name) return;

    const prismaClient = tx || this.prisma;

    const existing = await prismaClient.itemCategory.findFirst({
      where: {
        name: data.name,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });

    if (existing) {
      throw new ConflictException('Nome da categoria já está em uso');
    }
  }

  private validateCategoryType(type?: string): void {
    if (!type) return;

    const validTypes = Object.values(ITEM_CATEGORY_TYPE);
    if (!validTypes.includes(type as ITEM_CATEGORY_TYPE)) {
      throw new BadRequestException(
        `Tipo de categoria inválido. Valores válidos: ${validTypes.join(', ')}`,
      );
    }
  }

  private isSafetyEquipmentCategory(type: string): boolean {
    return type === ITEM_CATEGORY_TYPE.PPE;
  }

  private isToolCategory(type: string): boolean {
    return type === ITEM_CATEGORY_TYPE.TOOL;
  }

  private isRegularCategory(type: string): boolean {
    return type === ITEM_CATEGORY_TYPE.REGULAR;
  }

  private async validateCategorySpecificRules(categoryData: any): Promise<void> {
    if (!categoryData.type) return;

    // PPE categories might require additional validation
    if (this.isSafetyEquipmentCategory(categoryData.type)) {
      // Add any PPE-specific validation rules here
      // For example, checking if PPE categories have specific naming conventions
      if (
        categoryData.name &&
        !categoryData.name.toLowerCase().includes('epi') &&
        !categoryData.name.toLowerCase().includes('segurança') &&
        !categoryData.name.toLowerCase().includes('proteção')
      ) {
        // This is a warning, not an error - business might allow flexible naming
        // Could log a warning or add to audit trail
      }
    }

    // Tool categories might require different validation
    if (this.isToolCategory(categoryData.type)) {
      // Add any tool-specific validation rules here
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

  private async updateItemCategoryAssociations(
    categoryId: string,
    itemIds: string[],
    tx: PrismaTransaction,
    userId: string,
  ): Promise<void> {
    if (!itemIds || itemIds.length === 0) return;

    // Update all specified items to use this category
    await tx.item.updateMany({
      where: { id: { in: itemIds } },
      data: { categoryId: categoryId },
    });

    // Log the association changes
    for (const itemId of itemIds) {
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.ITEM,
        entityId: itemId,
        action: CHANGE_ACTION.UPDATE,
        reason: `Item associado à categoria ${categoryId}`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: tx,
      });
    }
  }

  private async handleItemCategoryAssociationChanges(
    categoryId: string,
    currentItemIds: string[],
    newItemIds: string[],
    tx: PrismaTransaction,
    userId: string,
  ): Promise<void> {
    const currentSet = new Set(currentItemIds);
    const newSet = new Set(newItemIds);

    // Items to remove from this category
    const itemsToRemove = currentItemIds.filter(id => !newSet.has(id));
    if (itemsToRemove.length > 0) {
      // Set categoryId to null for items being removed
      await tx.item.updateMany({
        where: { id: { in: itemsToRemove } },
        data: { categoryId: null },
      });

      // Log removal changes
      for (const itemId of itemsToRemove) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM,
          entityId: itemId,
          action: CHANGE_ACTION.UPDATE,
          reason: `Item removido da categoria ${categoryId}`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });
      }
    }

    // Items to add to this category
    const itemsToAdd = newItemIds.filter(id => !currentSet.has(id));
    if (itemsToAdd.length > 0) {
      // First check if these items belong to other categories
      const itemsToUpdate = await tx.item.findMany({
        where: { id: { in: itemsToAdd } },
        select: { id: true, categoryId: true, name: true },
      });

      // Update items to new category
      await tx.item.updateMany({
        where: { id: { in: itemsToAdd } },
        data: { categoryId: categoryId },
      });

      // Log additions with more context
      for (const item of itemsToUpdate) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM,
          entityId: item.id,
          action: CHANGE_ACTION.UPDATE,
          reason:
            item.categoryId !== categoryId
              ? `Item "${item.name}" movido da categoria ${item.categoryId} para ${categoryId}`
              : `Item "${item.name}" associado à categoria ${categoryId}`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });
      }
    }
  }

  // Single operations
  async create(
    data: ItemCategoryCreateFormData,
    include?: ItemCategoryInclude,
    userId?: string,
  ): Promise<ItemCategoryCreateResponse> {
    try {
      const { itemIds, ...categoryData } = data;

      // Validate unique constraints
      await this.validateUniqueConstraints({ name: categoryData.name });

      // Validate category type
      this.validateCategoryType(categoryData.type);

      // Validate category-specific rules
      await this.validateCategorySpecificRules(categoryData);

      // Validate item IDs if provided
      if (itemIds && itemIds.length > 0) {
        await this.validateItemIds(itemIds);
      }

      const created = await this.prisma.$transaction(async tx => {
        const category = await this.repository.createWithTransaction(tx, categoryData, { include });

        // Handle item associations if provided
        if (itemIds && itemIds.length > 0) {
          await this.updateItemCategoryAssociations(category.id, itemIds, tx, userId || '');
        }

        // Log creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM_CATEGORY,
          entityId: category.id,
          action: CHANGE_ACTION.CREATE,
          entity: category,
          reason:
            itemIds && itemIds.length > 0
              ? `Categoria criada com ${itemIds.length} ${itemIds.length === 1 ? 'item associado' : 'itens associados'}`
              : 'Categoria criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return category;
      });

      return {
        success: true,
        data: created,
        message: 'Categoria criada com sucesso.',
      };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao criar categoria: ${errorMessage}`);
    }
  }

  async update(
    id: string,
    data: ItemCategoryUpdateFormData,
    include?: ItemCategoryInclude,
    userId?: string,
  ): Promise<ItemCategoryUpdateResponse> {
    try {
      const { itemIds, ...categoryData } = data;

      // Check if category exists and get current associated items
      const existing = await this.repository.findById(id, { include: { items: true } });
      if (!existing) {
        throw new NotFoundException('Categoria não encontrada. Verifique se o ID está correto.');
      }

      // Validate unique constraints if name is being updated
      if (categoryData.name && categoryData.name !== existing.name) {
        await this.validateUniqueConstraints({ name: categoryData.name }, id);
      }

      // Validate category type
      this.validateCategoryType(categoryData.type);

      // Validate category-specific rules
      await this.validateCategorySpecificRules(categoryData);

      // Validate item IDs if provided
      if (itemIds && itemIds.length > 0) {
        await this.validateItemIds(itemIds);
      }

      const updated = await this.prisma.$transaction(async tx => {
        // Get existing category before update
        const existingCategory = await this.repository.findByIdWithTransaction(tx, id);
        if (!existingCategory) {
          throw new NotFoundException('Categoria não encontrada');
        }

        const category = await this.repository.updateWithTransaction(tx, id, categoryData, {
          include,
        });

        // Handle item associations if itemIds is provided
        if (itemIds !== undefined) {
          const currentItemIds = existing.items?.map(item => item.id) || [];
          await this.handleItemCategoryAssociationChanges(
            category.id,
            currentItemIds,
            itemIds,
            tx,
            userId || '',
          );
        }

        // Track field-level changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM_CATEGORY,
          entityId: id,
          oldEntity: existingCategory,
          newEntity: category,
          fieldsToTrack: this.ITEM_CATEGORY_FIELDS_TO_TRACK,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return category;
      });

      return {
        success: true,
        data: updated,
        message: 'Categoria atualizada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao atualizar categoria: ${errorMessage}`);
    }
  }

  async delete(id: string, userId?: string): Promise<ItemCategoryDeleteResponse> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if category exists
        const existing = await this.repository.findByIdWithTransaction(tx, id, {
          include: { items: true },
        });
        if (!existing) {
          throw new NotFoundException('Categoria não encontrada. Verifique se o ID está correto.');
        }

        // Check if category has items
        if (existing.items && existing.items.length > 0) {
          throw new ConflictException(
            'Não é possível excluir categoria que possui itens vinculados.',
          );
        }

        await this.repository.deleteWithTransaction(tx, id);

        // Log deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ITEM_CATEGORY,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason: `Categoria excluída: ${existing.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Categoria excluída com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao excluir categoria: ${errorMessage}`);
    }
  }

  async findById(
    id: string,
    include?: ItemCategoryInclude,
  ): Promise<ItemCategoryGetUniqueResponse> {
    try {
      const category = await this.repository.findById(id, { include });
      if (!category) {
        throw new NotFoundException('Categoria não encontrada. Verifique se o ID está correto.');
      }

      return {
        success: true,
        message: 'Categoria encontrada com sucesso.',
        data: category,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao buscar categoria: ${errorMessage}`);
    }
  }

  async findMany(query: ItemCategoryGetManyFormData): Promise<ItemCategoryGetManyResponse> {
    try {
      const result = await this.repository.findMany(query);

      return {
        success: true,
        message: 'Categorias carregadas com sucesso.',
        ...result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao buscar categorias: ${errorMessage}`);
    }
  }

  // Batch operations
  async batchCreate(
    data: ItemCategoryBatchCreateFormData,
    include?: ItemCategoryInclude,
    userId?: string,
  ): Promise<ItemCategoryBatchCreateResponse<ItemCategoryCreateFormData>> {
    const results: Array<{ success: boolean; data?: any; error?: string; index: number }> = [];
    let successCount = 0;
    let failureCount = 0;

    // Check for duplicate names in the batch
    const names = data.itemCategories.map(item => item.name);
    const uniqueNames = new Set(names);
    if (names.length !== uniqueNames.size) {
      // Find duplicates and create error results
      const nameCount = new Map<string, number[]>();
      names.forEach((name, index) => {
        if (!nameCount.has(name)) {
          nameCount.set(name, []);
        }
        nameCount.get(name)!.push(index);
      });

      for (let i = 0; i < data.itemCategories.length; i++) {
        const indices = nameCount.get(data.itemCategories[i].name) || [];
        if (indices.length > 1) {
          results.push({
            success: false,
            error: 'Nome duplicado no lote',
            index: i,
          });
          failureCount++;
        }
      }

      if (failureCount === data.itemCategories.length) {
        return {
          success: false,
          message: 'Falha ao criar categorias em lote',
          data: {
            success: [],
            failed: results
              .filter(r => !r.success)
              .map(r => ({
                index: r.index,
                id: undefined,
                error: r.error || 'Erro desconhecido',
                errorCode: 'CREATION_FAILED',
                data: data.itemCategories[r.index],
              })),
            totalProcessed: data.itemCategories.length,
            totalSuccess: 0,
            totalFailed: failureCount,
          },
        };
      }
    }

    // Process each item
    for (let i = 0; i < data.itemCategories.length; i++) {
      if (results.some(r => r.index === i && !r.success)) {
        continue; // Skip items that already failed
      }

      try {
        const { itemIds, ...categoryData } = data.itemCategories[i];

        await this.validateUniqueConstraints({ name: categoryData.name });

        // Validate category type
        this.validateCategoryType(categoryData.type);

        // Validate category-specific rules
        await this.validateCategorySpecificRules(categoryData);

        // Validate item IDs if provided
        if (itemIds && itemIds.length > 0) {
          await this.validateItemIds(itemIds);
        }

        const created = await this.prisma.$transaction(async tx => {
          const category = await this.repository.createWithTransaction(tx, categoryData, {
            include,
          });

          // Handle item associations if provided
          if (itemIds && itemIds.length > 0) {
            await this.updateItemCategoryAssociations(category.id, itemIds, tx, userId || '');
          }

          const itemCount = itemIds?.length || 0;
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ITEM_CATEGORY,
            entityId: category.id,
            action: CHANGE_ACTION.CREATE,
            entity: category,
            reason:
              itemCount > 0
                ? `Categoria criada em lote com ${itemCount} ${itemCount === 1 ? 'item associado' : 'itens associados'}`
                : 'Categoria criada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });

          return category;
        });

        results.push({
          success: true,
          data: created,
          index: i,
        });
        successCount++;
      } catch (error) {
        let errorMessage = 'Erro ao criar categoria';
        if (error instanceof ConflictException || error instanceof NotFoundException) {
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        results.push({
          success: false,
          error: errorMessage,
          index: i,
        });
        failureCount++;
      }
    }

    // Convert results to proper batch response format
    const batchOperationResult = {
      success: results.filter(r => r.success).map(r => r.data),
      failed: results
        .filter(r => !r.success)
        .map((r, idx) => ({
          index: r.index,
          id: undefined,
          error: r.error || 'Erro desconhecido',
          errorCode: 'CREATION_FAILED',
          data: data.itemCategories[r.index],
        })),
      totalProcessed: data.itemCategories.length,
      totalSuccess: successCount,
      totalFailed: failureCount,
    };

    return {
      success: true,
      message: `${successCount} categorias criadas com sucesso. ${failureCount} falharam.`,
      data: batchOperationResult,
    };
  }

  async batchUpdate(
    data: ItemCategoryBatchUpdateFormData,
    include?: ItemCategoryInclude,
    userId?: string,
  ): Promise<ItemCategoryBatchUpdateResponse<ItemCategoryUpdateFormData>> {
    const results: Array<{ success: boolean; data?: any; error?: string; index: number }> = [];
    let successCount = 0;
    let failureCount = 0;

    // First, get all existing categories to validate
    const ids = data.itemCategories.map(item => item.id);
    const existingCategories = await this.repository.findByIds(ids, { include: { items: true } });
    const existingMap = new Map(existingCategories.map(c => [c.id, c]));

    // Process each update
    for (let i = 0; i < data.itemCategories.length; i++) {
      const { id, data: updateData } = data.itemCategories[i];

      try {
        const existing = existingMap.get(id);
        if (!existing) {
          throw new NotFoundException('Categoria não encontrada');
        }

        const { itemIds, ...categoryData } = updateData;

        // Validate unique constraints if name is being updated
        if (categoryData.name && categoryData.name !== existing.name) {
          await this.validateUniqueConstraints({ name: categoryData.name }, id);
        }

        // Validate category type
        this.validateCategoryType(categoryData.type);

        // Validate category-specific rules
        await this.validateCategorySpecificRules(categoryData);

        // Validate item IDs if provided
        if (itemIds && itemIds.length > 0) {
          await this.validateItemIds(itemIds);
        }

        const updated = await this.prisma.$transaction(async tx => {
          // Get existing category before update
          const existingCategory = await this.repository.findByIdWithTransaction(tx, id);
          if (!existingCategory) {
            throw new NotFoundException('Categoria não encontrada');
          }

          const category = await this.repository.updateWithTransaction(tx, id, categoryData, {
            include,
          });

          // Handle item associations if itemIds is provided
          if (itemIds !== undefined) {
            const currentItemIds = existing.items?.map(item => item.id) || [];
            await this.handleItemCategoryAssociationChanges(
              category.id,
              currentItemIds,
              itemIds,
              tx,
              userId || '',
            );
          }

          // Track field-level changes
          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ITEM_CATEGORY,
            entityId: id,
            oldEntity: existingCategory,
            newEntity: category,
            fieldsToTrack: this.ITEM_CATEGORY_FIELDS_TO_TRACK,
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            transaction: tx,
          });

          return category;
        });

        results.push({
          success: true,
          data: updated,
          index: i,
        });
        successCount++;
      } catch (error) {
        let errorMessage = 'Erro ao atualizar categoria';
        if (error instanceof NotFoundException) {
          errorMessage = error.message;
        } else if (error instanceof ConflictException) {
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        results.push({
          success: false,
          error: errorMessage,
          index: i,
        });
        failureCount++;
      }
    }

    // Convert results to proper batch response format
    const batchOperationResult = {
      success: results.filter(r => r.success).map(r => r.data),
      failed: results
        .filter(r => !r.success)
        .map((r, idx) => ({
          index: r.index,
          id: data.itemCategories[r.index].id!,
          error: r.error || 'Erro desconhecido',
          errorCode: 'UPDATE_FAILED',
          data: {
            ...data.itemCategories[r.index].data,
            id: data.itemCategories[r.index].id!,
          },
        })),
      totalProcessed: data.itemCategories.length,
      totalSuccess: successCount,
      totalFailed: failureCount,
      totalUpdated: successCount,
    };

    return {
      success: true,
      message: `${successCount} categorias atualizadas com sucesso. ${failureCount} falharam.`,
      data: batchOperationResult,
    };
  }

  async batchDelete(
    data: ItemCategoryBatchDeleteFormData,
    userId?: string,
  ): Promise<ItemCategoryBatchDeleteResponse> {
    const results: Array<{ success: boolean; error?: string; index: number }> = [];
    let successCount = 0;
    let failureCount = 0;

    // Get all categories with their items
    const existingCategories = await this.repository.findByIds(data.itemCategoryIds, {
      include: { items: true },
    });
    const existingMap = new Map(existingCategories.map(c => [c.id, c]));

    // Process each deletion
    for (let i = 0; i < data.itemCategoryIds.length; i++) {
      const id = data.itemCategoryIds[i];

      try {
        const existing = existingMap.get(id);
        if (!existing) {
          throw new NotFoundException('Categoria não encontrada');
        }

        // Check if category has items
        if (existing.items && existing.items.length > 0) {
          throw new ConflictException(
            'Não é possível excluir categoria que possui itens vinculados',
          );
        }

        await this.prisma.$transaction(async tx => {
          await this.repository.deleteWithTransaction(tx, id);

          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.ITEM_CATEGORY,
            entityId: id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: existing,
            reason: `Categoria excluída em lote: ${existing.name}`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        });

        results.push({
          success: true,
          index: i,
        });
        successCount++;
      } catch (error) {
        let errorMessage = 'Erro ao excluir categoria';
        if (error instanceof NotFoundException) {
          errorMessage = error.message;
        } else if (error instanceof ConflictException) {
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        results.push({
          success: false,
          error: errorMessage,
          index: i,
        });
        failureCount++;
      }
    }

    // Convert results to proper batch response format
    const batchOperationResult = {
      success: results
        .filter(r => r.success)
        .map((r, idx) => ({ id: data.itemCategoryIds[r.index], deleted: true })),
      failed: results
        .filter(r => !r.success)
        .map((r, idx) => ({
          index: r.index,
          id: data.itemCategoryIds[r.index],
          error: r.error || 'Erro desconhecido',
          errorCode: 'DELETE_FAILED',
          data: { id: data.itemCategoryIds[r.index] },
        })),
      totalProcessed: data.itemCategoryIds.length,
      totalSuccess: successCount,
      totalFailed: failureCount,
      totalDeleted: successCount,
    };

    return {
      success: true,
      message: `${successCount} categorias excluídas com sucesso. ${failureCount} falharam.`,
      data: batchOperationResult,
    };
  }
}
