// external-operation-item.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ExternalOperationItemRepository } from './repositories/external-operation-item/external-operation-item.repository';
import { ExternalOperationRepository } from './repositories/external-operation/external-operation.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  ExternalOperationItemBatchCreateResponse,
  ExternalOperationItemBatchDeleteResponse,
  ExternalOperationItemBatchUpdateResponse,
  ExternalOperationItemCreateResponse,
  ExternalOperationItemDeleteResponse,
  ExternalOperationItemGetManyResponse,
  ExternalOperationItemGetUniqueResponse,
  ExternalOperationItemUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import {
  ExternalOperationItemCreateFormData,
  ExternalOperationItemUpdateFormData,
  ExternalOperationItemGetManyFormData,
  ExternalOperationItemBatchCreateFormData,
  ExternalOperationItemBatchUpdateFormData,
  ExternalOperationItemBatchDeleteFormData,
  ExternalOperationItemInclude,
} from '../../../schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  EXTERNAL_OPERATION_STATUS,
  EXTERNAL_OPERATION_STATUS_ORDER,
} from '../../../constants';
import { ItemRepository } from '@modules/inventory/item/repositories/item/item.repository';

@Injectable()
export class ExternalOperationItemService {
  private readonly logger = new Logger(ExternalOperationItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly externalOperationItemRepository: ExternalOperationItemRepository,
    private readonly externalOperationRepository: ExternalOperationRepository,
    private readonly itemRepository: ItemRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validate external withdrawal item data
   */
  private async validateExternalOperationItem(
    data: Partial<ExternalOperationItemCreateFormData | ExternalOperationItemUpdateFormData>,
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
            entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
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

    // Validate returnedQuantity is non-negative and never exceeds the withdrawn quantity
    if ('returnedQuantity' in data && data.returnedQuantity !== undefined) {
      const effectiveWithdrawedQuantity =
        'withdrawedQuantity' in data && data.withdrawedQuantity !== undefined
          ? data.withdrawedQuantity
          : existingItem?.withdrawedQuantity;
      if (
        effectiveWithdrawedQuantity !== undefined &&
        data.returnedQuantity > effectiveWithdrawedQuantity
      ) {
        throw new BadRequestException(
          `Quantidade devolvida (${data.returnedQuantity}) não pode ser maior que a quantidade retirada (${effectiveWithdrawedQuantity})`,
        );
      }
      if (data.returnedQuantity < 0) {
        // Log validation failure
        if (existingItem) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
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
            entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
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
   * Buscar muitos itens de operação externa com filtros
   */
  async findMany(
    query: ExternalOperationItemGetManyFormData,
  ): Promise<ExternalOperationItemGetManyResponse> {
    try {
      const result = await this.externalOperationItemRepository.findMany({
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
        message: 'Itens de operação externa carregados com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar itens de operação externa:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar itens de operação externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar um item de operação externa por ID
   */
  async findById(
    id: string,
    include?: ExternalOperationItemInclude,
  ): Promise<ExternalOperationItemGetUniqueResponse> {
    try {
      const item = await this.externalOperationItemRepository.findById(id, { include });

      if (!item) {
        throw new NotFoundException('Item de operação externa não encontrado');
      }

      return {
        success: true,
        data: item,
        message: 'Item de operação externa carregado com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar item de operação externa por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar item de operação externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar novo item de operação externa
   */
  async create(
    data: ExternalOperationItemCreateFormData,
    include?: ExternalOperationItemInclude,
    userId?: string,
  ): Promise<ExternalOperationItemCreateResponse> {
    try {
      const item = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Verificar se a operação externa existe
        const withdrawal = await this.externalOperationRepository.findByIdWithTransaction(
          tx,
          data.externalOperationId,
        );
        if (!withdrawal) {
          throw new NotFoundException('Operação externa não encontrada');
        }

        // H2: items can only be added while the operation is a PENDING draft.
        // While PENDING, stock must NOT move — the main service decrements stock
        // exactly once at the PENDING → delivered transition.
        if (withdrawal.status !== EXTERNAL_OPERATION_STATUS.PENDING) {
          throw new BadRequestException(
            'Itens só podem ser adicionados enquanto a operação externa está Pendente',
          );
        }

        // Validate item data (stock availability check included)
        await this.validateExternalOperationItem(data, undefined, tx);

        // Criar o item da operação — NO stock movement and NO activity here:
        // for PENDING operations the stock authority is the status transition.
        const newItem = await this.externalOperationItemRepository.createWithTransaction(
          tx,
          data,
          { include },
        );

        // Registrar criação usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
          entityId: newItem.id,
          action: CHANGE_ACTION.CREATE,
          entity: newItem,
          reason: 'Item de operação externa criado',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return newItem;
      });

      return {
        success: true,
        message: 'Item de operação externa criado com sucesso',
        data: item,
      };
    } catch (error) {
      this.logger.error('Erro ao criar item de operação externa:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar item de operação externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar item de operação externa
   */
  async update(
    id: string,
    data: ExternalOperationItemUpdateFormData,
    include?: ExternalOperationItemInclude,
    userId?: string,
  ): Promise<ExternalOperationItemUpdateResponse> {
    try {
      const updatedItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar item existente
        const existingItem = await this.externalOperationItemRepository.findByIdWithTransaction(
          tx,
          id,
          {
            include: {
              externalOperation: true,
              item: true,
            },
          },
        );

        if (!existingItem) {
          throw new NotFoundException('Item de operação externa não encontrado');
        }

        // H2: item edits are only allowed while the parent operation is a PENDING
        // draft. While PENDING, stock must NOT move (the main service handles stock
        // at status transitions), so no adjustment/return activities are created here.
        if (existingItem.externalOperation?.status !== EXTERNAL_OPERATION_STATUS.PENDING) {
          throw new BadRequestException(
            'Itens só podem ser alterados enquanto a operação externa está Pendente',
          );
        }

        // Validate item data (includes returnedQuantity ≤ withdrawedQuantity)
        await this.validateExternalOperationItem(data, existingItem, tx);

        // Atualizar o item
        const updated = await this.externalOperationItemRepository.updateWithTransaction(
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
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
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
          existingItem.externalOperation?.type === 'RETURNABLE'
        ) {
          // Log the item update in the withdrawal's changelog using a dynamic field name with item name
          const itemName = existingItem.item?.name || `Item ${existingItem.itemId.slice(0, 8)}...`;
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
            entityId: existingItem.externalOperationId,
            action: CHANGE_ACTION.UPDATE,
            field: itemName, // Use the actual item name as the field name
            oldValue: existingItem.returnedQuantity || 0,
            newValue: data.returnedQuantity,
            reason: `Quantidade devolvida de "${itemName}" foi atualizada`,
            triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_ITEM_UPDATE,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });

          await this.checkAndUpdateWithdrawalStatus(existingItem.externalOperationId, tx, userId);
        }

        return updated;
      });

      return {
        success: true,
        message: 'Item de operação externa atualizado com sucesso',
        data: updatedItem,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar item de operação externa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar item de operação externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir item de operação externa
   */
  async delete(id: string, userId?: string): Promise<ExternalOperationItemDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const item = await this.externalOperationItemRepository.findByIdWithTransaction(tx, id, {
          include: { externalOperation: true },
        });

        if (!item) {
          throw new NotFoundException('Item de operação externa não encontrado');
        }

        // H2: item removal is only allowed while the parent operation is a PENDING
        // draft. While PENDING, stock was never decremented, so there is NOTHING to
        // restore — no stock movement and no activity here.
        if (item.externalOperation?.status !== EXTERNAL_OPERATION_STATUS.PENDING) {
          throw new BadRequestException(
            'Itens só podem ser removidos enquanto a operação externa está Pendente',
          );
        }

        // Registrar exclusão usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: item,
          reason: 'Item de operação externa excluído',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.externalOperationItemRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Item de operação externa excluído com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir item de operação externa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir item de operação externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplos itens de operação externa
   */
  async batchCreate(
    data: ExternalOperationItemBatchCreateFormData,
    include?: ExternalOperationItemInclude,
    userId?: string,
  ): Promise<ExternalOperationItemBatchCreateResponse<ExternalOperationItemCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // H2: per-element gate + validation — items can only be added to PENDING
        // operations and never move stock here (deferred-stock model).
        const validItems: typeof data.externalOperationItems = [];
        const gateFailed: Array<{
          index: number;
          error: string;
          errorCode: string;
          data: any;
        }> = [];

        for (let index = 0; index < data.externalOperationItems.length; index++) {
          const itemData = data.externalOperationItems[index];
          try {
            const withdrawal = await this.externalOperationRepository.findByIdWithTransaction(
              tx,
              itemData.externalOperationId,
            );
            if (!withdrawal) {
              throw new NotFoundException('Operação externa não encontrada');
            }
            if (withdrawal.status !== EXTERNAL_OPERATION_STATUS.PENDING) {
              throw new BadRequestException(
                'Itens só podem ser adicionados enquanto a operação externa está Pendente',
              );
            }
            await this.validateExternalOperationItem(itemData, undefined, tx);
            validItems.push(itemData);
          } catch (error: any) {
            gateFailed.push({
              index,
              error: error?.message || 'Erro ao validar item de operação externa',
              errorCode: error?.constructor?.name || 'UNKNOWN_ERROR',
              data: itemData,
            });
          }
        }

        const result =
          validItems.length > 0
            ? await this.externalOperationItemRepository.createManyWithTransaction(
                tx,
                validItems,
                { include },
              )
            : { success: [], failed: [], totalCreated: 0, totalFailed: 0 };

        result.failed.push(...(gateFailed as any[]));
        result.totalFailed += gateFailed.length;

        // Registrar criações bem-sucedidas
        for (const item of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
            entityId: item.id,
            action: CHANGE_ACTION.CREATE,
            entity: item,
            reason: `Item de operação externa criado em lote - Quantidade: ${item.withdrawedQuantity}, Preço: ${item.price || 'N/A'}`,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            transaction: tx,
          });
        }

        // Log batch operation summary
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
          entityId: 'batch_operation',
          action: CHANGE_ACTION.CREATE,
          field: 'batch_summary',
          oldValue: null,
          newValue: {
            totalProcessed: data.externalOperationItems.length,
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
   * Atualizar múltiplos itens de operação externa
   *
   * H2: per-element gate to PENDING parents; no stock movement and no activities —
   * for PENDING operations the stock authority is the main service's status transition.
   */
  async batchUpdate(
    data: ExternalOperationItemBatchUpdateFormData,
    include?: ExternalOperationItemInclude,
    userId?: string,
  ): Promise<ExternalOperationItemBatchUpdateResponse<ExternalOperationItemUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar entidades existentes (com a operação pai) para comparação e gates
        const existingItems = await this.externalOperationItemRepository.findByIdsWithTransaction(
          tx,
          data.externalOperationItems.map(u => u.id),
          { include: { externalOperation: true } } as any,
        );
        const existingMap = new Map(existingItems.map(i => [i.id, i]));

        const updates: UpdateData<ExternalOperationItemUpdateFormData>[] = [];
        const gateFailed: Array<{
          index: number;
          id: string;
          error: string;
          errorCode: string;
          data: any;
        }> = [];

        for (let index = 0; index < data.externalOperationItems.length; index++) {
          const { id, data: updateData } = data.externalOperationItems[index];
          try {
            const existingItem = existingMap.get(id);
            if (!existingItem) {
              throw new NotFoundException('Item de operação externa não encontrado');
            }
            if (
              (existingItem as any).externalOperation?.status !==
              EXTERNAL_OPERATION_STATUS.PENDING
            ) {
              throw new BadRequestException(
                'Itens só podem ser alterados enquanto a operação externa está Pendente',
              );
            }
            // Includes returnedQuantity ≤ withdrawedQuantity validation
            await this.validateExternalOperationItem(updateData, existingItem, tx);
            updates.push({ id, data: updateData });
          } catch (error: any) {
            gateFailed.push({
              index,
              id,
              error: error?.message || 'Erro ao validar item de operação externa',
              errorCode: error?.constructor?.name || 'UNKNOWN_ERROR',
              data: { ...updateData, id },
            });
          }
        }

        const result =
          updates.length > 0
            ? await this.externalOperationItemRepository.updateManyWithTransaction(tx, updates, {
                include,
              })
            : { success: [], failed: [], totalUpdated: 0, totalFailed: 0 };

        result.failed.push(...(gateFailed as any[]));
        result.totalFailed += gateFailed.length;

        // Rastrear mudanças para atualizações bem-sucedidas
        const fieldsToTrack = ['itemId', 'withdrawedQuantity', 'returnedQuantity', 'price'];

        // Track changes and check for withdrawal status updates
        const withdrawalIds = new Set<string>();

        for (const item of result.success) {
          const existingItem = existingMap.get(item.id);
          if (existingItem) {
            // Track field changes
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
              entityId: item.id,
              oldEntity: existingItem,
              newEntity: item,
              fieldsToTrack,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // Check if returnedQuantity was updated and collect withdrawal IDs for status update
            if (
              item.returnedQuantity !== undefined &&
              item.returnedQuantity !== existingItem.returnedQuantity
            ) {
              withdrawalIds.add(item.externalOperationId);

              // Log the item update in the withdrawal's changelog using dynamic field name with item name
              const fullItem = await this.externalOperationItemRepository.findByIdWithTransaction(
                tx,
                item.id,
                {
                  include: { item: true, externalOperation: true },
                },
              );

              if (fullItem?.externalOperation?.type === 'RETURNABLE') {
                const itemName = fullItem.item?.name || `Item ${fullItem.itemId.slice(0, 8)}...`;
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
                  entityId: fullItem.externalOperationId,
                  action: CHANGE_ACTION.UPDATE,
                  field: itemName,
                  oldValue: existingItem.returnedQuantity || 0,
                  newValue: item.returnedQuantity,
                  reason: `Quantidade devolvida de "${itemName}" foi atualizada (lote)`,
                  triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_ITEM_UPDATE,
                  triggeredById: item.id,
                  userId: userId || null,
                  transaction: tx,
                });
              }
            }
          }
        }

        // Update withdrawal status for all affected withdrawals after all item updates are complete
        for (const withdrawalId of withdrawalIds) {
          await this.checkAndUpdateWithdrawalStatus(withdrawalId, tx, userId);
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 item atualizado com sucesso'
          : `${result.totalUpdated} itens atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index ?? index,
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
    } catch (error) {
      this.logger.error('Erro na atualização em lote de itens:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar itens em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir múltiplos itens de operação externa
   */
  async batchDelete(
    data: ExternalOperationItemBatchDeleteFormData,
    userId?: string,
  ): Promise<ExternalOperationItemBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar itens antes de excluir (com a operação pai para o gate de status)
        const items = await this.externalOperationItemRepository.findByIdsWithTransaction(
          tx,
          data.externalOperationItemIds,
          { include: { externalOperation: true } } as any,
        );

        // H2: items can only be removed from PENDING operations; while PENDING
        // stock never moved, so nothing is restored here.
        const indexById = new Map(
          data.externalOperationItemIds.map((itemId, index) => [itemId, index]),
        );
        const gateFailed: Array<{
          index: number;
          id: string;
          error: string;
          errorCode: string;
          data: any;
        }> = [];
        const deletableItems: typeof items = [];

        for (const item of items) {
          if ((item as any).externalOperation?.status !== EXTERNAL_OPERATION_STATUS.PENDING) {
            gateFailed.push({
              index: indexById.get(item.id) ?? 0,
              id: item.id,
              error: 'Itens só podem ser removidos enquanto a operação externa está Pendente',
              errorCode: 'BadRequestException',
              data: { id: item.id },
            });
            continue;
          }
          deletableItems.push(item);
        }

        // Registrar exclusões
        for (const item of deletableItems) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
            entityId: item.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: item,
            reason: `Item de operação externa excluído em lote - Quantidade: ${item.withdrawedQuantity}, Preço: ${item.price || 'N/A'}`,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        // Log batch operation summary
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION_ITEM,
          entityId: 'batch_operation',
          action: CHANGE_ACTION.DELETE,
          field: 'batch_summary',
          oldValue: {
            totalProcessed: data.externalOperationItemIds.length,
            items: items.map(i => ({ id: i.id, quantity: i.withdrawedQuantity, price: i.price })),
          },
          newValue: null,
          reason: `Operação em lote de exclusão concluída: ${items.length} itens processados`,
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
          triggeredById: 'batch_operation',
          transaction: tx,
          userId: userId || null,
        });

        const deleteResult =
          deletableItems.length > 0
            ? await this.externalOperationItemRepository.deleteManyWithTransaction(
                tx,
                deletableItems.map(item => item.id),
              )
            : { success: [], failed: [], totalDeleted: 0, totalFailed: 0 };

        deleteResult.failed.push(...(gateFailed as any[]));
        deleteResult.totalFailed += gateFailed.length;

        return deleteResult;
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
      const itemsResponse = await this.externalOperationItemRepository.findManyWithTransaction(
        tx,
        {
          where: { externalOperationId: withdrawalId },
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
      const withdrawal = await this.externalOperationRepository.findByIdWithTransaction(
        tx,
        withdrawalId,
      );
      if (!withdrawal || withdrawal.type !== 'RETURNABLE') return;

      let newStatus: EXTERNAL_OPERATION_STATUS | null = null;

      // Determine new status based on returned quantities
      if (totalReturned === 0) {
        // Nothing returned yet, keep current status (likely PENDING)
        return;
      } else if (totalReturned === totalWithdrawed) {
        // Everything returned
        newStatus = EXTERNAL_OPERATION_STATUS.FULLY_RETURNED;
      } else if (totalReturned > 0 && totalReturned < totalWithdrawed) {
        // Partially returned
        newStatus = EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED;
      }

      // Update status if it changed
      if (newStatus && withdrawal.status !== newStatus) {
        await this.externalOperationRepository.updateWithTransaction(tx, withdrawalId, {
          status: newStatus,
        });

        // Log the automatic status change as a separate status transition entry
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
          entityId: withdrawalId,
          action: CHANGE_ACTION.UPDATE,
          field: 'status_transition', // Use special field name for status transitions
          oldValue: withdrawal.status,
          newValue: newStatus,
          reason: `Status atualizado automaticamente para ${this.getStatusLabel(newStatus)} baseado nos itens devolvidos`,
          triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_RETURN,
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
  private getStatusOrder(status: EXTERNAL_OPERATION_STATUS): number {
    return EXTERNAL_OPERATION_STATUS_ORDER[status] || 1;
  }

  /**
   * Get status label in Portuguese for logging
   */
  private getStatusLabel(status: EXTERNAL_OPERATION_STATUS): string {
    const labels: Record<EXTERNAL_OPERATION_STATUS, string> = {
      [EXTERNAL_OPERATION_STATUS.PENDING]: 'Pendente',
      [EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED]: 'Parcialmente Devolvido',
      [EXTERNAL_OPERATION_STATUS.FULLY_RETURNED]: 'Totalmente Devolvido',
      [EXTERNAL_OPERATION_STATUS.CHARGED]: 'Cobrado',
      [EXTERNAL_OPERATION_STATUS.CANCELLED]: 'Cancelado',
      [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: 'Liquidado',
      [EXTERNAL_OPERATION_STATUS.DELIVERED]: 'Entregue',
    };
    return labels[status] || status;
  }
}
