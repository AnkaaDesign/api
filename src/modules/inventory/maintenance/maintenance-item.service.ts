import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { MaintenanceItemRepository } from './repositories/maintenance-item/maintenance-item.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  MaintenanceItem,
  MaintenanceItemBatchCreateResponse,
  MaintenanceItemBatchDeleteResponse,
  MaintenanceItemBatchUpdateResponse,
  MaintenanceItemCreateResponse,
  MaintenanceItemDeleteResponse,
  MaintenanceItemGetManyResponse,
  MaintenanceItemGetUniqueResponse,
  MaintenanceItemUpdateResponse,
} from '../../../types';
import {
  MaintenanceItemCreateFormData,
  MaintenanceItemUpdateFormData,
  MaintenanceItemGetManyFormData,
  MaintenanceItemBatchCreateFormData,
  MaintenanceItemBatchUpdateFormData,
  MaintenanceItemBatchDeleteFormData,
  MaintenanceItemInclude,
} from '../../../schemas/maintenance';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';

@Injectable()
export class MaintenanceItemService {
  private readonly logger = new Logger(MaintenanceItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenanceItemRepository: MaintenanceItemRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Buscar muitos itens de manutenção com filtros
   */
  async findMany(query: MaintenanceItemGetManyFormData): Promise<MaintenanceItemGetManyResponse> {
    try {
      const result = await this.maintenanceItemRepository.findMany(query);
      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Itens de manutenção carregados com sucesso',
      };
    } catch (error) {
      this.logger.error('Error finding maintenance items', error);
      throw new InternalServerErrorException('Erro ao buscar itens de manutenção');
    }
  }

  /**
   * Buscar item de manutenção por ID
   */
  async findById(
    id: string,
    include?: MaintenanceItemInclude,
  ): Promise<MaintenanceItemGetUniqueResponse> {
    try {
      const maintenanceItem = await this.maintenanceItemRepository.findById(id, { include });
      if (!maintenanceItem) {
        throw new NotFoundException('Item de manutenção não encontrado');
      }
      return {
        success: true,
        data: maintenanceItem,
        message: 'Item de manutenção carregado com sucesso',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Error finding maintenance item by ID', error);
      throw new InternalServerErrorException('Erro ao buscar item de manutenção');
    }
  }

  /**
   * Validar dados do item de manutenção
   */
  private async validateMaintenanceItem(
    data: Partial<MaintenanceItemCreateFormData | MaintenanceItemUpdateFormData>,
    existingId?: string,
  ) {
    // Type guard to check if data has maintenanceId
    const hasMaintenanceId = 'maintenanceId' in data && data.maintenanceId;

    // Validar se a manutenção existe
    if (hasMaintenanceId) {
      const maintenance = await this.prisma.maintenance.findUnique({
        where: { id: (data as any).maintenanceId },
      });
      if (!maintenance) {
        throw new BadRequestException('Manutenção não encontrada');
      }
    }

    // Type guard to check if data has itemId
    const hasItemId = 'itemId' in data && data.itemId;

    // Validar se o item existe e tem quantidade suficiente
    if (hasItemId) {
      const item = await this.prisma.item.findUnique({ where: { id: (data as any).itemId } });
      if (!item) {
        throw new BadRequestException('Item não encontrado');
      }

      // Verificar se o item tem quantidade suficiente para a manutenção
      if (data.quantity !== undefined) {
        // Se estamos atualizando, precisamos considerar a quantidade anterior
        let currentlyAllocated = 0;
        if (existingId) {
          const existing = await this.prisma.maintenanceItem.findUnique({
            where: { id: existingId },
          });
          currentlyAllocated = existing?.quantity || 0;
        }

        const availableQuantity = item.quantity + currentlyAllocated;
        if (data.quantity > availableQuantity) {
          throw new BadRequestException(
            `Quantidade insuficiente em estoque. Disponível: ${availableQuantity}, Solicitado: ${data.quantity}`,
          );
        }
      }
    }

    // Validar quantidade positiva
    if (data.quantity !== undefined && data.quantity <= 0) {
      throw new BadRequestException('Quantidade deve ser maior que zero');
    }

    // Prevenir itens duplicados na mesma manutenção (apenas para criação)
    if (hasMaintenanceId && hasItemId && !existingId) {
      const existingItem = await this.prisma.maintenanceItem.findFirst({
        where: {
          maintenanceId: (data as any).maintenanceId,
          itemId: (data as any).itemId,
        },
      });

      if (existingItem) {
        throw new BadRequestException('Este item já foi adicionado a esta manutenção');
      }
    }
  }

  /**
   * Criar novo item de manutenção
   */
  async create(
    data: MaintenanceItemCreateFormData,
    include?: MaintenanceItemInclude,
    userId?: string,
  ): Promise<MaintenanceItemCreateResponse> {
    try {
      await this.validateMaintenanceItem(data);

      const maintenanceItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const created = await this.maintenanceItemRepository.createWithTransaction(tx, data, {
          include,
        });

        // Use logEntityChange helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: created,
          reason: 'Novo item adicionado à manutenção',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return created;
      });

      return {
        success: true,
        data: maintenanceItem,
        message: 'Item de manutenção criado com sucesso',
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Error creating maintenance item', error);
      throw new InternalServerErrorException('Erro ao criar item de manutenção');
    }
  }

  /**
   * Atualizar item de manutenção existente
   */
  async update(
    id: string,
    data: MaintenanceItemUpdateFormData,
    include?: MaintenanceItemInclude,
    userId?: string,
  ): Promise<MaintenanceItemUpdateResponse> {
    try {
      await this.validateMaintenanceItem(data, id);

      const maintenanceItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await this.maintenanceItemRepository.findByIdWithTransaction(tx, id, {
          include: {
            maintenance: true,
            item: true,
          },
        });
        if (!existing) {
          throw new NotFoundException('Item de manutenção não encontrado');
        }

        const updated = await this.maintenanceItemRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Track field changes
        const fieldsToTrack = ['quantity', 'price'];
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: fieldsToTrack.filter(field => data.hasOwnProperty(field)),
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Track item relationship changes
        if (data.hasOwnProperty('itemId') && existing.itemId !== updated.itemId) {
          const oldItem = existing.item?.name || 'Nenhum';
          const newItem = updated.item?.name || 'Nenhum';
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'item',
            oldValue: oldItem,
            newValue: newItem,
            reason: `Item alterado de "${oldItem}" para "${newItem}"`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        // Track maintenance relationship changes (rare but possible)
        if (
          data.hasOwnProperty('maintenanceId') &&
          existing.maintenanceId !== updated.maintenanceId
        ) {
          const oldMaintenance = existing.maintenance?.name || 'Nenhuma';
          const newMaintenance = updated.maintenance?.name || 'Nenhuma';
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'maintenance',
            oldValue: oldMaintenance,
            newValue: newMaintenance,
            reason: `Manutenção alterada de "${oldMaintenance}" para "${newMaintenance}"`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return updated;
      });

      return {
        success: true,
        data: maintenanceItem,
        message: 'Item de manutenção atualizado com sucesso',
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Error updating maintenance item', error);
      throw new InternalServerErrorException('Erro ao atualizar item de manutenção');
    }
  }

  /**
   * Excluir item de manutenção
   */
  async delete(id: string, userId?: string): Promise<MaintenanceItemDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await this.maintenanceItemRepository.findByIdWithTransaction(tx, id);
        if (!existing) {
          throw new NotFoundException('Item de manutenção não encontrado');
        }

        await this.maintenanceItemRepository.deleteWithTransaction(tx, id);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason: 'Item removido da manutenção',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });
      });

      return { success: true, message: 'Item de manutenção excluído com sucesso' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Error deleting maintenance item', error);
      throw new InternalServerErrorException('Erro ao excluir item de manutenção');
    }
  }

  /**
   * Criar múltiplos itens de manutenção
   */
  async batchCreate(
    data: MaintenanceItemBatchCreateFormData,
    include?: MaintenanceItemInclude,
    userId?: string,
  ): Promise<MaintenanceItemBatchCreateResponse<MaintenanceItem>> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const { maintenanceItems } = data;
      const results = {
        success: [] as MaintenanceItem[],
        failed: [] as any[],
        totalProcessed: maintenanceItems.length,
        totalSuccess: 0,
        totalFailed: 0,
      };

      for (let i = 0; i < maintenanceItems.length; i++) {
        const itemData = maintenanceItems[i];
        try {
          await this.validateMaintenanceItem(itemData);
          const created = await this.maintenanceItemRepository.createWithTransaction(
            transaction,
            itemData,
            { include },
          );

          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
            entityId: created.id,
            action: CHANGE_ACTION.CREATE,
            entity: created,
            reason: 'Item de manutenção criado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction,
          });

          results.success.push(created);
          results.totalSuccess++;
        } catch (error) {
          results.failed.push({
            index: i,
            data: itemData,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
          results.totalFailed++;
        }
      }

      return {
        success: true,
        message: `${results.totalSuccess} itens de manutenção criados com sucesso. ${results.totalFailed} falharam.`,
        data: results,
      };
    });
  }

  /**
   * Atualizar múltiplos itens de manutenção
   */
  async batchUpdate(
    data: MaintenanceItemBatchUpdateFormData,
    include?: MaintenanceItemInclude,
    userId?: string,
  ): Promise<MaintenanceItemBatchUpdateResponse<MaintenanceItem>> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const updates = data.maintenanceItems;
      const results = {
        success: [] as MaintenanceItem[],
        failed: [] as any[],
        totalProcessed: updates.length,
        totalSuccess: 0,
        totalFailed: 0,
      };

      for (let i = 0; i < updates.length; i++) {
        const { id, data: updateData } = updates[i];
        try {
          await this.validateMaintenanceItem(updateData, id);

          // Get existing for tracking
          const existing = await this.maintenanceItemRepository.findByIdWithTransaction(
            transaction,
            id,
            {
              include: {
                maintenance: true,
                item: true,
              },
            },
          );

          if (!existing) {
            throw new NotFoundException('Item de manutenção não encontrado');
          }

          const updated = await this.maintenanceItemRepository.updateWithTransaction(
            transaction,
            id,
            updateData,
            { include },
          );

          // Track field changes
          const fieldsToTrack = ['quantity', 'price'];
          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
            entityId: id,
            oldEntity: existing,
            newEntity: updated,
            fieldsToTrack: fieldsToTrack.filter(field => updateData.hasOwnProperty(field)),
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            transaction,
          });

          results.success.push(updated);
          results.totalSuccess++;
        } catch (error) {
          results.failed.push({
            index: i,
            id,
            data: updateData,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
          results.totalFailed++;
        }
      }

      return {
        success: true,
        message: `${results.totalSuccess} itens de manutenção atualizados com sucesso. ${results.totalFailed} falharam.`,
        data: results,
      };
    });
  }

  /**
   * Excluir múltiplos itens de manutenção
   */
  async batchDelete(
    data: MaintenanceItemBatchDeleteFormData,
    userId?: string,
  ): Promise<MaintenanceItemBatchDeleteResponse> {
    return this.prisma.$transaction(async (transaction: PrismaTransaction) => {
      const ids = data.maintenanceItemIds;
      const results = {
        success: [] as { id: string; deleted: boolean }[],
        failed: [] as any[],
        totalProcessed: ids.length,
        totalSuccess: 0,
        totalFailed: 0,
      };

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
          // Get existing for tracking
          const existing = await this.maintenanceItemRepository.findByIdWithTransaction(
            transaction,
            id,
          );
          if (!existing) {
            throw new NotFoundException('Item de manutenção não encontrado');
          }

          await this.maintenanceItemRepository.deleteWithTransaction(transaction, id);

          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.MAINTENANCE_ITEM,
            entityId: id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: existing,
            reason: 'Item de manutenção excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction,
          });

          results.success.push({ id, deleted: true });
          results.totalSuccess++;
        } catch (error) {
          results.failed.push({
            index: i,
            id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
          results.totalFailed++;
        }
      }

      return {
        success: true,
        message: `${results.totalSuccess} itens de manutenção excluídos com sucesso. ${results.totalFailed} falharam.`,
        data: results,
      };
    });
  }
}
