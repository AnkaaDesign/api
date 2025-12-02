// external-withdrawal-item.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ExternalWithdrawalItemRepository } from './repositories/external-withdrawal-item/external-withdrawal-item.repository';
import { ExternalWithdrawalRepository } from './repositories/external-withdrawal/external-withdrawal.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  ExternalWithdrawalItemBatchCreateResponse,
  ExternalWithdrawalItemBatchDeleteResponse,
  ExternalWithdrawalItemBatchUpdateResponse,
  ExternalWithdrawalItemCreateResponse,
  ExternalWithdrawalItemDeleteResponse,
  ExternalWithdrawalItemGetManyResponse,
  ExternalWithdrawalItemGetUniqueResponse,
  ExternalWithdrawalItemUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import {
  ExternalWithdrawalItemCreateFormData,
  ExternalWithdrawalItemUpdateFormData,
  ExternalWithdrawalItemGetManyFormData,
  ExternalWithdrawalItemBatchCreateFormData,
  ExternalWithdrawalItemBatchUpdateFormData,
  ExternalWithdrawalItemBatchDeleteFormData,
  ExternalWithdrawalItemInclude,
} from '../../../schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ENTITY_TYPE,
  CHANGE_ACTION,
  EXTERNAL_WITHDRAWAL_STATUS,
  EXTERNAL_WITHDRAWAL_STATUS_ORDER,
} from '../../../constants';
import { ItemRepository } from '@modules/inventory/item/repositories/item/item.repository';
import { ActivityRepository } from '@modules/inventory/activity/repositories/activity.repository';
import { ActivityService } from '@modules/inventory/activity/activity.service';

@Injectable()
export class ExternalWithdrawalItemService {
  private readonly logger = new Logger(ExternalWithdrawalItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly externalWithdrawalItemRepository: ExternalWithdrawalItemRepository,
    private readonly externalWithdrawalRepository: ExternalWithdrawalRepository,
    private readonly itemRepository: ItemRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly activityRepository: ActivityRepository,
    @Inject(forwardRef(() => ActivityService))
    private readonly activityService: ActivityService,
  ) {}

  /**
   * Validate external withdrawal item data
   */
  private async validateExternalWithdrawalItem(
    data: Partial<ExternalWithdrawalItemCreateFormData | ExternalWithdrawalItemUpdateFormData>,
    existingItem?: any,
    tx?: PrismaTransaction,
  ): Promise<{ item: any }> {
    const transaction = tx || this.prisma;

    // Validate withdrawedQuantity is positive for create
    if ('withdrawedQuantity' in data && data.withdrawedQuantity !== undefined) {
      if (data.withdrawedQuantity <= 0) {
        // Log validation failure
        if (existingItem) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
            entityId: existingItem.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'withdrawedQuantity',
            oldValue: existingItem.withdrawedQuantity,
            newValue: data.withdrawedQuantity,
            reason: `Falha na validação: Quantidade retirada deve ser maior que zero (valor: ${data.withdrawedQuantity})`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: existingItem.id,
            transaction: tx,
            userId: null,
          });
        }
        throw new BadRequestException('Quantidade retirada deve ser maior que zero');
      }
    }

    // Validate returnedQuantity is non-negative for update
    if ('returnedQuantity' in data && data.returnedQuantity !== undefined) {
      if (data.returnedQuantity < 0) {
        // Log validation failure
        if (existingItem) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
            entityId: existingItem.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'returnedQuantity',
            oldValue: existingItem.returnedQuantity || 0,
            newValue: data.returnedQuantity,
            reason: `Falha na validação: Quantidade devolvida não pode ser negativa (valor: ${data.returnedQuantity})`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: existingItem.id,
            transaction: tx,
            userId: null,
          });
        }
        throw new BadRequestException('Quantidade devolvida não pode ser negativa');
      }
    }

    // Validate price is non-negative
    if (data.price !== undefined) {
      if (data.price !== null && data.price < 0) {
        // Log validation failure
        if (existingItem) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
            entityId: existingItem.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'price',
            oldValue: existingItem.price,
            newValue: data.price,
            reason: `Falha na validação: Preço não pode ser negativo (valor: ${data.price})`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: existingItem.id,
            transaction: tx,
            userId: null,
          });
        }
        throw new BadRequestException('Preço não pode ser negativo');
      }
    }

    // Validate item exists and has sufficient stock
    let item: any;
    const itemId = ('itemId' in data && data.itemId) || existingItem?.itemId;
    const withdrawedQuantity =
      ('withdrawedQuantity' in data && data.withdrawedQuantity) ||
      existingItem?.withdrawedQuantity ||
      0;

    if (itemId) {
      item = await this.itemRepository.findByIdWithTransaction(transaction, itemId);
      if (!item) {
        throw new NotFoundException(`Item com ID ${itemId} não encontrado`);
      }

      // For create, check stock availability
      if (!existingItem && 'withdrawedQuantity' in data) {
        if (item.quantity < withdrawedQuantity) {
          throw new BadRequestException(
            `Estoque insuficiente para o item ${item.name}. Disponível: ${item.quantity}, Necessário: ${withdrawedQuantity}`,
          );
        }
      }
    }

    return { item };
  }

  /**
   * Buscar muitos itens de retirada externa com filtros
   */
  async findMany(
    query: ExternalWithdrawalItemGetManyFormData,
  ): Promise<ExternalWithdrawalItemGetManyResponse> {
    try {
      const result = await this.externalWithdrawalItemRepository.findMany({
        page: query.page,
        take: query.limit,
        where: query.where,
        orderBy: query.orderBy,
        include: query.include,
      });

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Itens de retirada externa carregados com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar itens de retirada externa:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar itens de retirada externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar um item de retirada externa por ID
   */
  async findById(
    id: string,
    include?: ExternalWithdrawalItemInclude,
  ): Promise<ExternalWithdrawalItemGetUniqueResponse> {
    try {
      const item = await this.externalWithdrawalItemRepository.findById(id, { include });

      if (!item) {
        throw new NotFoundException('Item de retirada externa não encontrado');
      }

      return {
        success: true,
        data: item,
        message: 'Item de retirada externa carregado com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar item de retirada externa por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar item de retirada externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar novo item de retirada externa
   */
  async create(
    data: ExternalWithdrawalItemCreateFormData,
    include?: ExternalWithdrawalItemInclude,
    userId?: string,
  ): Promise<ExternalWithdrawalItemCreateResponse> {
    try {
      const item = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Verificar se a retirada externa existe
        const withdrawal = await this.externalWithdrawalRepository.findByIdWithTransaction(
          tx,
          data.externalWithdrawalId,
        );
        if (!withdrawal) {
          throw new NotFoundException('Retirada externa não encontrada');
        }

        // Validate item data
        const validation = await this.validateExternalWithdrawalItem(data, undefined, tx);
        const stockItem = validation.item;

        // Criar o item da retirada
        const newItem = await this.externalWithdrawalItemRepository.createWithTransaction(
          tx,
          data,
          { include },
        );

        // Atualizar estoque do item
        await this.itemRepository.updateWithTransaction(tx, data.itemId, {
          quantity: stockItem.quantity - data.withdrawedQuantity,
        });

        // Use activity service to handle both stock update and activity creation
        // This also triggers monthly consumption recalculation automatically
        await this.activityService.create(
          {
            itemId: data.itemId,
            quantity: data.withdrawedQuantity,
            operation: ACTIVITY_OPERATION.OUTBOUND,
            reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
            userId: userId || null,
          },
          undefined,
          userId,
        );

        // Registrar criação usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
          entityId: newItem.id,
          action: CHANGE_ACTION.CREATE,
          entity: newItem,
          reason: 'Item de retirada externa criado',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return newItem;
      });

      return {
        success: true,
        message: 'Item de retirada externa criado com sucesso',
        data: item,
      };
    } catch (error) {
      this.logger.error('Erro ao criar item de retirada externa:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar item de retirada externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar item de retirada externa
   */
  async update(
    id: string,
    data: ExternalWithdrawalItemUpdateFormData,
    include?: ExternalWithdrawalItemInclude,
    userId?: string,
  ): Promise<ExternalWithdrawalItemUpdateResponse> {
    try {
      const updatedItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar item existente
        const existingItem = await this.externalWithdrawalItemRepository.findByIdWithTransaction(
          tx,
          id,
          {
            include: {
              externalWithdrawal: true,
              item: true,
            },
          },
        );

        if (!existingItem) {
          throw new NotFoundException('Item de retirada externa não encontrado');
        }

        // Validate item data
        const validation = await this.validateExternalWithdrawalItem(data, existingItem, tx);

        // Lidar com mudança de quantidade retirada
        if (
          data.withdrawedQuantity !== undefined &&
          data.withdrawedQuantity !== existingItem.withdrawedQuantity
        ) {
          const quantityDiff = data.withdrawedQuantity - existingItem.withdrawedQuantity;

          // Create adjustment activity if quantity changed
          if (quantityDiff !== 0) {
            await this.activityService.create(
              {
                itemId: existingItem.itemId,
                quantity: Math.abs(quantityDiff),
                operation:
                  quantityDiff > 0 ? ACTIVITY_OPERATION.OUTBOUND : ACTIVITY_OPERATION.INBOUND,
                reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
                userId: userId || null,
              },
              undefined,
              userId,
            );
          }
        }

        // Lidar com mudança de quantidade devolvida - let activities handle stock updates
        let pendingActivityData: {
          itemId: string;
          quantity: number;
          operation: ACTIVITY_OPERATION;
        } | null = null;

        if (
          data.returnedQuantity !== undefined &&
          data.returnedQuantity !== (existingItem.returnedQuantity || 0)
        ) {
          const returnedDiff = data.returnedQuantity - (existingItem.returnedQuantity || 0);

          if (returnedDiff !== 0) {
            // Store activity data to create after transaction
            pendingActivityData = {
              itemId: existingItem.itemId,
              quantity: Math.abs(returnedDiff),
              operation:
                returnedDiff > 0 ? ACTIVITY_OPERATION.INBOUND : ACTIVITY_OPERATION.OUTBOUND,
            };
          }
        }

        // Atualizar o item
        const updated = await this.externalWithdrawalItemRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Rastrear mudanças em campos específicos - comprehensive field tracking
        const fieldsToTrack = [
          'itemId',
          'withdrawedQuantity',
          'returnedQuantity',
          'price',
          'unitPrice',
          'totalPrice',
          'discount',
          'notes',
          'condition',
          'serialNumber',
          'batchNumber',
          'expirationDate',
          'location',
          'isDefective',
          'defectDescription',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
          entityId: id,
          oldEntity: existingItem,
          newEntity: updated,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Check if returnedQuantity was updated and update withdrawal status accordingly
        if (
          data.returnedQuantity !== undefined &&
          existingItem.externalWithdrawal?.type === 'RETURNABLE'
        ) {
          // Log the item update in the withdrawal's changelog using a dynamic field name with item name
          const itemName = existingItem.item?.name || `Item ${existingItem.itemId.slice(0, 8)}...`;
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
            entityId: existingItem.externalWithdrawalId,
            action: CHANGE_ACTION.UPDATE,
            field: itemName, // Use the actual item name as the field name
            oldValue: existingItem.returnedQuantity || 0,
            newValue: data.returnedQuantity,
            reason: `Quantidade devolvida de "${itemName}" foi atualizada`,
            triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_ITEM_UPDATE,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });

          await this.checkAndUpdateWithdrawalStatus(existingItem.externalWithdrawalId, tx, userId);
        }

        return { updated, pendingActivityData };
      });

      // Create activity after transaction to avoid circular dependencies
      if (updatedItem.pendingActivityData) {
        try {
          await this.activityService.create(
            {
              itemId: updatedItem.pendingActivityData.itemId,
              quantity: updatedItem.pendingActivityData.quantity,
              operation: updatedItem.pendingActivityData.operation,
              reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN,
              userId: null, // No user - external withdrawal return is done by external person
            },
            undefined,
            userId,
            { skipSync: true }, // Skip sync since we already updated withdrawal items
          );
        } catch (error) {
          this.logger.error(`Failed to create activity for external withdrawal return:`, error);
        }
      }

      return {
        success: true,
        message: 'Item de retirada externa atualizado com sucesso',
        data: updatedItem.updated,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar item de retirada externa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar item de retirada externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir item de retirada externa
   */
  async delete(id: string, userId?: string): Promise<ExternalWithdrawalItemDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const item = await this.externalWithdrawalItemRepository.findByIdWithTransaction(tx, id, {
          include: { externalWithdrawal: true },
        });

        if (!item) {
          throw new NotFoundException('Item de retirada externa não encontrado');
        }

        // Restaurar quantidade de estoque
        const stockItem = await this.itemRepository.findByIdWithTransaction(tx, item.itemId);
        if (stockItem) {
          const newQuantity = stockItem.quantity + item.withdrawedQuantity;
          await this.itemRepository.updateWithTransaction(tx, item.itemId, {
            quantity: newQuantity,
          });

          // Registrar restauração do estoque
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: item.itemId,
            action: CHANGE_ACTION.UPDATE,
            field: 'quantity',
            oldValue: stockItem.quantity,
            newValue: newQuantity,
            reason: 'Estoque restaurado - Exclusão de item de retirada externa',
            triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_ITEM_DELETE,
            triggeredById: id,
            transaction: tx,
            userId: userId || null,
          });
        }

        // Registrar exclusão usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: item,
          reason: 'Item de retirada externa excluído',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.externalWithdrawalItemRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Item de retirada externa excluído com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir item de retirada externa:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir item de retirada externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplos itens de retirada externa
   */
  async batchCreate(
    data: ExternalWithdrawalItemBatchCreateFormData,
    include?: ExternalWithdrawalItemInclude,
    userId?: string,
  ): Promise<ExternalWithdrawalItemBatchCreateResponse<ExternalWithdrawalItemCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.externalWithdrawalItemRepository.createManyWithTransaction(
          tx,
          data.externalWithdrawalItems,
          { include },
        );

        // Registrar criações bem-sucedidas
        for (const item of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
            entityId: item.id,
            action: CHANGE_ACTION.CREATE,
            entity: item,
            reason: `Item de retirada externa criado em lote - Quantidade: ${item.withdrawedQuantity}, Preço: ${item.price || 'N/A'}`,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            transaction: tx,
          });
        }

        // Log batch operation summary
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
          entityId: 'batch_operation',
          action: CHANGE_ACTION.CREATE,
          field: 'batch_summary',
          oldValue: null,
          newValue: {
            totalProcessed: data.externalWithdrawalItems.length,
            totalSuccess: result.totalCreated,
            totalFailed: result.totalFailed,
            operation: 'batch_create_items',
            timestamp: new Date().toISOString(),
          },
          reason: `Operação em lote de itens concluída: ${result.totalCreated} criados, ${result.totalFailed} falharam`,
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
          triggeredById: 'batch_operation',
          transaction: tx,
          userId: userId || null,
        });

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 item criado com sucesso'
          : `${result.totalCreated} itens criados com sucesso`;
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
      this.logger.error('Erro na criação em lote de itens:', error);
      throw new InternalServerErrorException(
        'Erro ao criar itens em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar múltiplos itens de retirada externa
   */
  async batchUpdate(
    data: ExternalWithdrawalItemBatchUpdateFormData,
    include?: ExternalWithdrawalItemInclude,
    userId?: string,
  ): Promise<ExternalWithdrawalItemBatchUpdateResponse<ExternalWithdrawalItemUpdateFormData>> {
    try {
      const updates: UpdateData<ExternalWithdrawalItemUpdateFormData>[] =
        data.externalWithdrawalItems.map(item => ({
          id: item.id,
          data: item.data,
        }));

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar entidades existentes para comparação
        const existingItems = await this.externalWithdrawalItemRepository.findByIdsWithTransaction(
          tx,
          updates.map(u => u.id),
        );
        const existingMap = new Map(existingItems.map(i => [i.id, i]));

        const result = await this.externalWithdrawalItemRepository.updateManyWithTransaction(
          tx,
          updates,
          { include },
        );

        // Rastrear mudanças para atualizações bem-sucedidas - comprehensive field tracking
        const fieldsToTrack = [
          'itemId',
          'withdrawedQuantity',
          'returnedQuantity',
          'price',
          'unitPrice',
          'totalPrice',
          'discount',
          'notes',
          'condition',
          'serialNumber',
          'batchNumber',
          'expirationDate',
          'location',
          'isDefective',
          'defectDescription',
        ];

        // Track changes and check for withdrawal status updates
        const withdrawalIds = new Set<string>();
        const activityCreations: Array<{
          itemId: string;
          quantity: number;
          operation: ACTIVITY_OPERATION;
        }> = []; // Track activities to create after transaction

        for (const item of result.success) {
          const existingItem = existingMap.get(item.id);
          if (existingItem) {
            // Track field changes
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
              entityId: item.id,
              oldEntity: existingItem,
              newEntity: item,
              fieldsToTrack,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // Handle returned quantity changes - let activities handle stock updates
            if (
              item.returnedQuantity !== undefined &&
              item.returnedQuantity !== (existingItem.returnedQuantity || 0)
            ) {
              const returnedDiff = item.returnedQuantity - (existingItem.returnedQuantity || 0);

              if (returnedDiff !== 0) {
                // Track activity to create after transaction completes (activities will handle stock updates)
                activityCreations.push({
                  itemId: existingItem.itemId,
                  quantity: Math.abs(returnedDiff),
                  operation:
                    returnedDiff > 0 ? ACTIVITY_OPERATION.INBOUND : ACTIVITY_OPERATION.OUTBOUND,
                });

                this.logger.log(
                  `Scheduled ${returnedDiff > 0 ? 'INBOUND' : 'OUTBOUND'} activity for item ${existingItem.itemId} with quantity ${Math.abs(returnedDiff)}`,
                );
              }
            }

            // Check if returnedQuantity was updated and collect withdrawal IDs for status update
            if (
              item.returnedQuantity !== undefined &&
              item.returnedQuantity !== existingItem.returnedQuantity
            ) {
              withdrawalIds.add(item.externalWithdrawalId);

              // Log the item update in the withdrawal's changelog using dynamic field name with item name
              const fullItem = await this.externalWithdrawalItemRepository.findByIdWithTransaction(
                tx,
                item.id,
                {
                  include: { item: true, externalWithdrawal: true },
                },
              );

              if (fullItem?.externalWithdrawal?.type === 'RETURNABLE') {
                const itemName = fullItem.item?.name || `Item ${fullItem.itemId.slice(0, 8)}...`;
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
                  entityId: fullItem.externalWithdrawalId,
                  action: CHANGE_ACTION.UPDATE,
                  field: itemName,
                  oldValue: existingItem.returnedQuantity || 0,
                  newValue: item.returnedQuantity,
                  reason: `Quantidade devolvida de "${itemName}" foi atualizada (lote)`,
                  triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_ITEM_UPDATE,
                  triggeredById: item.id,
                  userId: userId || null,
                  transaction: tx,
                });
              }
            }
          }
        }

        // Stock updates are handled by activities created after transaction completes
        // This prevents duplicate stock updates and circular dependencies

        // Update withdrawal status for all affected withdrawals after all item updates are complete
        for (const withdrawalId of withdrawalIds) {
          await this.checkAndUpdateWithdrawalStatus(withdrawalId, tx, userId);
        }

        return { result, activityCreations };
      });

      // Create activities outside the transaction to avoid circular dependencies
      const transactionResult = result as any;
      for (const activity of transactionResult.activityCreations || []) {
        try {
          // Create activity with proper reason but skip sync to avoid circular updates
          await this.activityService.create(
            {
              itemId: activity.itemId,
              quantity: activity.quantity,
              operation: activity.operation,
              reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN,
              userId: null, // No user - external withdrawal return is done by external person
            },
            undefined, // include
            userId,
            { skipSync: true }, // options - Skip sync to prevent circular dependencies
          );
          this.logger.log(`Created ${activity.operation} activity for item ${activity.itemId}`);
        } catch (error) {
          this.logger.error(`Failed to create activity for item ${activity.itemId}:`, error);
          // Continue processing other activities even if one fails
        }
      }

      const successMessage =
        transactionResult.result.totalUpdated === 1
          ? '1 item atualizado com sucesso'
          : `${transactionResult.result.totalUpdated} itens atualizados com sucesso`;
      const failureMessage =
        transactionResult.result.totalFailed > 0
          ? `, ${transactionResult.result.totalFailed} falharam`
          : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: transactionResult.result.success,
        failed: transactionResult.result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
        totalProcessed:
          transactionResult.result.totalUpdated + transactionResult.result.totalFailed,
        totalSuccess: transactionResult.result.totalUpdated,
        totalFailed: transactionResult.result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote de itens:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar itens em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir múltiplos itens de retirada externa
   */
  async batchDelete(
    data: ExternalWithdrawalItemBatchDeleteFormData,
    userId?: string,
  ): Promise<ExternalWithdrawalItemBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar itens antes de excluir para o changelog
        const items = await this.externalWithdrawalItemRepository.findByIdsWithTransaction(
          tx,
          data.externalWithdrawalItemIds,
        );

        // Registrar exclusões
        for (const item of items) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
            entityId: item.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: item,
            reason: `Item de retirada externa excluído em lote - Quantidade: ${item.withdrawedQuantity}, Preço: ${item.price || 'N/A'}`,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        // Log batch operation summary
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM,
          entityId: 'batch_operation',
          action: CHANGE_ACTION.DELETE,
          field: 'batch_summary',
          oldValue: {
            totalProcessed: data.externalWithdrawalItemIds.length,
            items: items.map(i => ({ id: i.id, quantity: i.withdrawedQuantity, price: i.price })),
          },
          newValue: null,
          reason: `Operação em lote de exclusão concluída: ${items.length} itens processados`,
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
          triggeredById: 'batch_operation',
          transaction: tx,
          userId: userId || null,
        });

        return this.externalWithdrawalItemRepository.deleteManyWithTransaction(
          tx,
          data.externalWithdrawalItemIds,
        );
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 item excluído com sucesso'
          : `${result.totalDeleted} itens excluídos com sucesso`;
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
      this.logger.error('Erro na exclusão em lote de itens:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir itens em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Check and update external withdrawal status based on returned items
   */
  private async checkAndUpdateWithdrawalStatus(
    withdrawalId: string,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    try {
      // Get all items for this withdrawal
      const itemsResponse = await this.externalWithdrawalItemRepository.findManyWithTransaction(
        tx,
        {
          where: { externalWithdrawalId: withdrawalId },
        },
      );

      // Handle both array and response object formats
      const items = Array.isArray(itemsResponse) ? itemsResponse : itemsResponse.data || [];

      if (!items || items.length === 0) return;

      // Calculate totals
      let totalWithdrawed = 0;
      let totalReturned = 0;

      for (const item of items) {
        totalWithdrawed += item.withdrawedQuantity || 0;
        totalReturned += item.returnedQuantity || 0;
      }

      // Get current withdrawal
      const withdrawal = await this.externalWithdrawalRepository.findByIdWithTransaction(
        tx,
        withdrawalId,
      );
      if (!withdrawal || withdrawal.type !== 'RETURNABLE') return;

      let newStatus: EXTERNAL_WITHDRAWAL_STATUS | null = null;

      // Determine new status based on returned quantities
      if (totalReturned === 0) {
        // Nothing returned yet, keep current status (likely PENDING)
        return;
      } else if (totalReturned === totalWithdrawed) {
        // Everything returned
        newStatus = EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED;
      } else if (totalReturned > 0 && totalReturned < totalWithdrawed) {
        // Partially returned
        newStatus = EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED;
      }

      // Update status if it changed
      if (newStatus && withdrawal.status !== newStatus) {
        await this.externalWithdrawalRepository.updateWithTransaction(tx, withdrawalId, {
          status: newStatus,
        });

        // Log the automatic status change as a separate status transition entry
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
          entityId: withdrawalId,
          action: CHANGE_ACTION.UPDATE,
          field: 'status_transition', // Use special field name for status transitions
          oldValue: withdrawal.status,
          newValue: newStatus,
          reason: `Status atualizado automaticamente para ${this.getStatusLabel(newStatus)} baseado nos itens devolvidos`,
          triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_RETURN,
          triggeredById: withdrawalId,
          transaction: tx,
          userId: userId || null,
        });

        this.logger.log(
          `Automatic status update for withdrawal ${withdrawalId}: ${withdrawal.status} → ${newStatus} (${totalReturned}/${totalWithdrawed} returned)`,
        );
      }
    } catch (error) {
      this.logger.error('Error updating withdrawal status:', error);
      // Don't throw - this is a side effect that shouldn't break the main operation
    }
  }

  /**
   * Get status order for external withdrawal status
   */
  private getStatusOrder(status: EXTERNAL_WITHDRAWAL_STATUS): number {
    return EXTERNAL_WITHDRAWAL_STATUS_ORDER[status] || 1;
  }

  /**
   * Get status label in Portuguese for logging
   */
  private getStatusLabel(status: EXTERNAL_WITHDRAWAL_STATUS): string {
    const labels: Record<EXTERNAL_WITHDRAWAL_STATUS, string> = {
      [EXTERNAL_WITHDRAWAL_STATUS.PENDING]: 'Pendente',
      [EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED]: 'Parcialmente Devolvido',
      [EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED]: 'Totalmente Devolvido',
      [EXTERNAL_WITHDRAWAL_STATUS.CHARGED]: 'Cobrado',
      [EXTERNAL_WITHDRAWAL_STATUS.CANCELLED]: 'Cancelado',
      [EXTERNAL_WITHDRAWAL_STATUS.LIQUIDATED]: 'Liquidado',
      [EXTERNAL_WITHDRAWAL_STATUS.DELIVERED]: 'Entregue',
    };
    return labels[status] || status;
  }
}
