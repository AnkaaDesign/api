// external-withdrawal.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ExternalWithdrawalRepository } from './repositories/external-withdrawal/external-withdrawal.repository';
import { ExternalWithdrawalItemRepository } from './repositories/external-withdrawal-item/external-withdrawal-item.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  ExternalWithdrawalBatchCreateResponse,
  ExternalWithdrawalBatchDeleteResponse,
  ExternalWithdrawalBatchUpdateResponse,
  ExternalWithdrawalCreateResponse,
  ExternalWithdrawalDeleteResponse,
  ExternalWithdrawalGetManyResponse,
  ExternalWithdrawalGetUniqueResponse,
  ExternalWithdrawalUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import {
  ExternalWithdrawalCreateFormData,
  ExternalWithdrawalUpdateFormData,
  ExternalWithdrawalGetManyFormData,
  ExternalWithdrawalBatchCreateFormData,
  ExternalWithdrawalBatchUpdateFormData,
  ExternalWithdrawalBatchDeleteFormData,
  ExternalWithdrawalInclude,
} from '../../../schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { ItemService } from '@modules/inventory/item/item.service';
import { ItemRepository } from '@modules/inventory/item/repositories/item/item.repository';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import { ActivityRepository } from '@modules/inventory/activity/repositories/activity.repository';
import {
  CHANGE_TRIGGERED_BY,
  ACTIVITY_REASON,
  ACTIVITY_OPERATION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  EXTERNAL_WITHDRAWAL_STATUS,
  EXTERNAL_WITHDRAWAL_STATUS_ORDER,
} from '../../../constants';

@Injectable()
export class ExternalWithdrawalService {
  private readonly logger = new Logger(ExternalWithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly externalWithdrawalRepository: ExternalWithdrawalRepository,
    private readonly externalWithdrawalItemRepository: ExternalWithdrawalItemRepository,
    private readonly itemService: ItemService,
    private readonly itemRepository: ItemRepository,
    private readonly activityService: ActivityService,
    private readonly activityRepository: ActivityRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validate external withdrawal data
   */
  private async externalWithdrawalValidation(
    data: Partial<ExternalWithdrawalCreateFormData | ExternalWithdrawalUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    const isUpdate = !!existingId;

    // Validate required fields for creation
    if (!isUpdate) {
      if (!data.withdrawerName || data.withdrawerName.trim().length === 0) {
        throw new BadRequestException('Nome do retirador é obrigatório');
      }

      // For create operations, validate that at least one item is being withdrawn
      if ('items' in data) {
        if (!data.items || data.items.length === 0) {
          throw new BadRequestException('Pelo menos um item deve ser retirado');
        }

        // Validate maximum items per withdrawal
        if (data.items.length > 100) {
          throw new BadRequestException('Máximo de 100 itens por retirada');
        }
      }
    }

    // Validate withdrawerName
    if (data.withdrawerName !== undefined) {
      const trimmedName = data.withdrawerName.trim();

      if (trimmedName.length === 0) {
        throw new BadRequestException('Nome do retirador não pode ser vazio');
      }
      if (trimmedName.length < 2) {
        throw new BadRequestException('Nome do retirador deve ter pelo menos 2 caracteres');
      }
      if (trimmedName.length > 200) {
        throw new BadRequestException('Nome do retirador deve ter no máximo 200 caracteres');
      }

      // Validate name format (basic validation)
      if (!/^[a-zA-ZÀ-ÿ\s\-'.]+$/.test(trimmedName)) {
        throw new BadRequestException('Nome do retirador contém caracteres inválidos');
      }
    }

    // Validate file references with enhanced logging
    const fileIds: string[] = [];

    if (data.invoiceIds && data.invoiceIds.length > 0) {
      fileIds.push(...data.invoiceIds);
    }
    if (data.receiptIds && data.receiptIds.length > 0) {
      fileIds.push(...data.receiptIds);
    }

    for (const fileId of fileIds) {
      if (fileId) {
        const file = await transaction.file.findUnique({
          where: { id: fileId },
          select: { id: true, filename: true },
        });

        if (!file) {
          // Log file validation failure
          if (existingId) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'fileIds',
              oldValue: null,
              newValue: fileId,
              reason: `Falha na validação: Arquivo não encontrado (ID: ${fileId})`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
          }
          throw new NotFoundException(`Arquivo não encontrado (ID: ${fileId})`);
        } else {
          // Log successful file attachment validation
          if (existingId) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'fileIds',
              oldValue: null,
              newValue: { id: file.id, filename: file.filename },
              reason: `Arquivo validado: ${file.filename}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
          }
        }
      }
    }

    // Validate that the withdrawal is not being updated after a certain period (e.g., 30 days)
    if (isUpdate) {
      const existingWithdrawal = await transaction.externalWithdrawal.findUnique({
        where: { id: existingId },
        select: { createdAt: true },
      });

      if (existingWithdrawal) {
        const daysSinceCreation = Math.floor(
          (new Date().getTime() - existingWithdrawal.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysSinceCreation > 30) {
          throw new BadRequestException('Retirada não pode ser alterada após 30 dias da criação');
        }
      }
    }

    // Validate willReturn and pricing logic
    if (!isUpdate && 'willReturn' in data && !data.willReturn && 'items' in data) {
      // If items won't be returned, validate that all items have prices
      for (const item of data.items || []) {
        if (item.price === null || item.price === undefined || item.price < 0) {
          throw new BadRequestException('Preço é obrigatório para itens que não serão devolvidos');
        }
      }
    }

    // Validate status if provided
    if (data.status !== undefined) {
      if (
        !Object.values(EXTERNAL_WITHDRAWAL_STATUS).includes(
          data.status as EXTERNAL_WITHDRAWAL_STATUS,
        )
      ) {
        // Log validation failure
        if (existingId) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
            entityId: existingId,
            action: CHANGE_ACTION.UPDATE,
            field: 'status',
            oldValue: null,
            newValue: data.status,
            reason: `Falha na validação: Status inválido '${data.status}'`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: existingId,
            transaction: tx,
            userId: null,
          });
        }
        throw new BadRequestException('Status de retirada externa inválido');
      }

      // Validate status transitions for updates
      if (isUpdate && existingId) {
        const existingWithdrawal = await transaction.externalWithdrawal.findUnique({
          where: { id: existingId },
          select: { status: true },
        });

        if (existingWithdrawal && existingWithdrawal.status !== data.status) {
          try {
            // Validate status transition
            this.validateStatusTransition(
              existingWithdrawal.status as EXTERNAL_WITHDRAWAL_STATUS,
              data.status as EXTERNAL_WITHDRAWAL_STATUS,
            );

            // Log successful status transition validation
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'status_transition',
              oldValue: existingWithdrawal.status,
              newValue: data.status,
              reason: `Validação de transição de status aprovada: ${existingWithdrawal.status} → ${data.status}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
          } catch (error) {
            // Log failed status transition validation
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'status_transition',
              oldValue: existingWithdrawal.status,
              newValue: data.status,
              reason: `Falha na validação de transição de status: ${existingWithdrawal.status} → ${data.status} - ${error.message}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
            throw error;
          }
        }
      }
    }
  }

  /**
   * Validate status transition for external withdrawal devolution/charging workflow
   */
  private validateStatusTransition(
    fromStatus: EXTERNAL_WITHDRAWAL_STATUS,
    toStatus: EXTERNAL_WITHDRAWAL_STATUS,
  ): void {
    const validTransitions: Record<EXTERNAL_WITHDRAWAL_STATUS, EXTERNAL_WITHDRAWAL_STATUS[]> = {
      [EXTERNAL_WITHDRAWAL_STATUS.PENDING]: [
        EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED,
        EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED,
        EXTERNAL_WITHDRAWAL_STATUS.CHARGED,
        EXTERNAL_WITHDRAWAL_STATUS.CANCELLED,
      ],
      [EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED]: [
        EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED,
        EXTERNAL_WITHDRAWAL_STATUS.CHARGED,
        EXTERNAL_WITHDRAWAL_STATUS.CANCELLED,
      ],
      [EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED]: [], // Final state
      [EXTERNAL_WITHDRAWAL_STATUS.CHARGED]: [], // Final state
      [EXTERNAL_WITHDRAWAL_STATUS.CANCELLED]: [], // Final state
    };

    const allowedTransitions = validTransitions[fromStatus];

    if (!allowedTransitions || !allowedTransitions.includes(toStatus)) {
      const statusLabels: Record<EXTERNAL_WITHDRAWAL_STATUS, string> = {
        [EXTERNAL_WITHDRAWAL_STATUS.PENDING]: 'Pendente',
        [EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED]: 'Parcialmente Devolvido',
        [EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED]: 'Totalmente Devolvido',
        [EXTERNAL_WITHDRAWAL_STATUS.CHARGED]: 'Cobrado',
        [EXTERNAL_WITHDRAWAL_STATUS.CANCELLED]: 'Cancelado',
      };

      throw new BadRequestException(
        `Transição de status inválida: não é possível alterar de "${statusLabels[fromStatus]}" para "${statusLabels[toStatus]}"`,
      );
    }
  }

  /**
   * Validate external withdrawal item data
   */
  private async externalWithdrawalItemValidation(
    data: {
      itemId: string;
      quantity: number;
      price: number | null;
    },
    willReturn: boolean,
    tx?: PrismaTransaction,
    existingWithdrawalId?: string,
  ): Promise<{ item: any }> {
    const transaction = tx || this.prisma;

    // Validate required fields
    if (!data.itemId) {
      throw new BadRequestException('ID do item é obrigatório');
    }

    // Validate quantity
    if (data.quantity === undefined || data.quantity === null) {
      throw new BadRequestException('Quantidade é obrigatória');
    }

    if (!Number.isFinite(data.quantity)) {
      throw new BadRequestException('Quantidade deve ser um número válido');
    }

    if (!Number.isInteger(data.quantity)) {
      throw new BadRequestException('Quantidade deve ser um número inteiro');
    }

    if (data.quantity <= 0) {
      throw new BadRequestException('Quantidade deve ser maior que zero');
    }

    if (data.quantity > 9999) {
      throw new BadRequestException('Quantidade máxima por item é 9999');
    }

    // Validate unit price only if items won't be returned
    if (!willReturn) {
      if (data.price === undefined || data.price === null) {
        throw new BadRequestException('Preço é obrigatório para itens que não serão devolvidos');
      }

      if (!Number.isFinite(data.price)) {
        throw new BadRequestException('Preço deve ser um número válido');
      }

      if (data.price < 0) {
        throw new BadRequestException('Preço não pode ser negativo');
      }

      if (data.price > 999999.99) {
        throw new BadRequestException('Preço excede o limite máximo permitido');
      }

      // Validate precision (max 2 decimal places)
      if (data.price !== Math.round(data.price * 100) / 100) {
        throw new BadRequestException('Preço deve ter no máximo 2 casas decimais');
      }
    }

    // Validate item exists and get details
    const item = await transaction.item.findUnique({
      where: { id: data.itemId },
      include: {
        category: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        } as any,
      },
    });

    if (!item) {
      throw new NotFoundException(`Item não encontrado`);
    }

    // Calculate available quantity considering:
    // 1. Current stock
    // 2. Pending borrows
    // 3. Other external withdrawals (if updating)

    // Get total unreturned borrows
    const unreturnedBorrows = await transaction.borrow.aggregate({
      where: {
        itemId: data.itemId,
        returnedAt: null,
      },
      _sum: {
        quantity: true,
      },
    });
    const totalBorrowed = unreturnedBorrows._sum?.quantity ?? 0;

    // Since we now create OUTBOUND activities and decrease stock immediately when creating withdrawals,
    // we don't need to count other withdrawals - the stock already reflects them
    // We only need to count borrowed items that don't affect stock directly

    // Calculate truly available quantity
    const availableQuantity = item.quantity - totalBorrowed;

    // Check if item has enough available quantity
    if (availableQuantity < data.quantity) {
      const details: string[] = [];
      if (totalBorrowed > 0) {
        details.push(`${totalBorrowed} emprestado(s)`);
      }

      throw new BadRequestException(
        `Estoque insuficiente para o item "${item.name}". ` +
          `Disponível: ${availableQuantity}, Solicitado: ${data.quantity}. ` +
          `Estoque atual: ${item.quantity}${details.length > 0 ? ', ' + details.join(', ') : ''}`,
      );
    }

    // Warn if stock will be low after withdrawal
    const remainingAfterWithdrawal = availableQuantity - data.quantity;
    if (item.reorderPoint && remainingAfterWithdrawal <= item.reorderPoint) {
      console.warn(
        `AVISO: Item "${item.name}" ficará com estoque baixo após a retirada. ` +
          `Disponível após retirada: ${remainingAfterWithdrawal}, Ponto de reposição: ${item.reorderPoint}`,
      );
    }

    // Validate price consistency only if not returning
    if (!willReturn && data.price !== null && item.prices && item.prices.length > 0) {
      const currentPrice = item.prices[0]?.value ?? 0;
      const priceDifference = Math.abs(data.price - currentPrice);
      const priceVariationPercent = (priceDifference / currentPrice) * 100;

      // Warn if price varies more than 20% from current price
      if (priceVariationPercent > 20) {
        console.warn(
          `AVISO: Preço informado (R$ ${data.price.toFixed(2)}) ` +
            `varia ${priceVariationPercent.toFixed(1)}% do preço atual do item (R$ ${currentPrice.toFixed(2)})`,
        );
      }
    }

    return { item };
  }

  // =====================
  // EXTERNAL WITHDRAWAL OPERATIONS
  // =====================

  /**
   * Buscar muitas retiradas externas com filtros
   */
  async findMany(
    query: ExternalWithdrawalGetManyFormData,
  ): Promise<ExternalWithdrawalGetManyResponse> {
    try {
      const result = await this.externalWithdrawalRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Retiradas externas carregadas com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar retiradas externas:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar retiradas externas. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar uma retirada externa por ID
   */
  async findById(
    id: string,
    include?: ExternalWithdrawalInclude,
  ): Promise<ExternalWithdrawalGetUniqueResponse> {
    try {
      const externalWithdrawal = await this.externalWithdrawalRepository.findById(id, { include });

      if (!externalWithdrawal) {
        throw new NotFoundException('Retirada externa não encontrada');
      }

      return {
        success: true,
        data: externalWithdrawal,
        message: 'Retirada externa carregada com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar retirada externa por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar retirada externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar nova retirada externa
   */
  async create(
    data: ExternalWithdrawalCreateFormData,
    include?: ExternalWithdrawalInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalWithdrawalCreateResponse> {
    try {
      const externalWithdrawal = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate external withdrawal data
        await this.externalWithdrawalValidation(data, undefined, tx);

        // Validate willReturn field (default to true)
        const willReturn = data.willReturn ?? true;

        const validatedItems: Array<{
          itemId: string;
          withdrawedQuantity: number;
          price: number | null;
        }> = [];

        // Validate all items before creating anything
        if (data.items && data.items.length > 0) {
          for (const itemData of data.items) {
            const validation = await this.externalWithdrawalItemValidation(
              {
                itemId: itemData.itemId,
                quantity: itemData.withdrawedQuantity,
                price: itemData.price ?? null,
              },
              willReturn,
              tx,
            );
            validatedItems.push({
              itemId: itemData.itemId,
              withdrawedQuantity: itemData.withdrawedQuantity,
              price: willReturn ? null : (itemData.price ?? null),
            });
          }
        }

        // Criar a retirada externa
        const newWithdrawal = await this.externalWithdrawalRepository.createWithTransaction(
          tx,
          {
            ...data,
            willReturn,
            items: undefined, // Remover itens dos dados principais
          },
          { include },
        );

        // Criar itens se fornecidos (já validados)
        if (validatedItems.length > 0) {
          for (const validatedItem of validatedItems) {
            // Buscar item novamente para atualização
            const item = await tx.item.findUnique({ where: { id: validatedItem.itemId } });
            if (!item) {
              throw new NotFoundException(`Item com ID ${validatedItem.itemId} não encontrado`);
            }

            // Criar item da retirada
            await this.externalWithdrawalItemRepository.createWithTransaction(tx, {
              externalWithdrawalId: newWithdrawal.id,
              itemId: validatedItem.itemId,
              withdrawedQuantity: validatedItem.withdrawedQuantity,
              price: validatedItem.price,
            });

            // Always create OUTBOUND activity for external withdrawals
            // The items are being taken out of stock regardless of whether they'll be returned
            // When they're returned later, we'll create INBOUND activities

            // Create activity directly through Prisma (bypassing ActivityService to avoid nested transactions)
            // External withdrawals should NOT have a userId as they're for external people
            await tx.activity.create({
              data: {
                itemId: validatedItem.itemId,
                quantity: validatedItem.withdrawedQuantity,
                operation: ACTIVITY_OPERATION.OUTBOUND,
                reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
                reasonOrder: 6, // External withdrawal
                userId: null, // No user - this is for external people
              },
            });

            // Update item stock manually since we're using direct Prisma
            const currentItem = await tx.item.findUnique({ where: { id: validatedItem.itemId } });
            if (currentItem) {
              const newQuantity = Math.max(
                0,
                currentItem.quantity - validatedItem.withdrawedQuantity,
              );
              await tx.item.update({
                where: { id: validatedItem.itemId },
                data: { quantity: newQuantity },
              });

              // Log the stock update
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.ITEM,
                entityId: validatedItem.itemId,
                action: CHANGE_ACTION.UPDATE,
                field: 'quantity',
                oldValue: currentItem.quantity,
                newValue: newQuantity,
                reason: `Estoque atualizado - Retirada externa`,
                triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL,
                triggeredById: newWithdrawal.id,
                transaction: tx,
                userId: userId || null,
              });
            }
          }
        }

        // Registrar no changelog usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
          entityId: newWithdrawal.id,
          action: CHANGE_ACTION.CREATE,
          entity: newWithdrawal,
          reason: `Retirada externa criada para ${data.withdrawerName}`,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Retornar com itens incluídos
        return await this.externalWithdrawalRepository.findByIdWithTransaction(
          tx,
          newWithdrawal.id,
          { include },
        );
      });

      return {
        success: true,
        message: 'Retirada externa criada com sucesso',
        data: externalWithdrawal!,
      };
    } catch (error) {
      this.logger.error('Erro ao criar retirada externa:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      // Preserve the original error message for better debugging
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao criar retirada externa';
      throw new InternalServerErrorException(
        `Erro ao criar retirada externa: ${errorMessage}`,
      );
    }
  }

  /**
   * Atualizar retirada externa
   */
  async update(
    id: string,
    data: ExternalWithdrawalUpdateFormData,
    include?: ExternalWithdrawalInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalWithdrawalUpdateResponse> {
    try {
      const updatedWithdrawal = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar retirada existente
        const existingWithdrawal = await this.externalWithdrawalRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingWithdrawal) {
          throw new NotFoundException('Retirada externa não encontrada');
        }

        // Validate external withdrawal data
        await this.externalWithdrawalValidation(data, id, tx);

        // Atualizar a retirada
        const updatedWithdrawal = await this.externalWithdrawalRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Handle stock return when status changes to FULLY_RETURNED or PARTIALLY_RETURNED
        console.log(`[UPDATE METHOD] Checking status change:`, {
          withdrawalId: id,
          dataStatus: data.status,
          existingStatus: existingWithdrawal.status,
          willReturn: existingWithdrawal.willReturn,
          statusChanged: existingWithdrawal.status !== data.status,
          isReturnStatus:
            data.status === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED ||
            data.status === EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED,
          shouldProcessReturn:
            data.status &&
            existingWithdrawal.willReturn &&
            existingWithdrawal.status !== data.status &&
            (data.status === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED ||
              data.status === EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED),
        });

        if (
          data.status &&
          existingWithdrawal.willReturn &&
          existingWithdrawal.status !== data.status &&
          (data.status === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED ||
            data.status === EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED)
        ) {
          console.log(`[UPDATE METHOD] Processing return for status change to ${data.status}`);
          // Validate status transition
          this.validateStatusTransition(
            existingWithdrawal.status as EXTERNAL_WITHDRAWAL_STATUS,
            data.status as EXTERNAL_WITHDRAWAL_STATUS,
          );

          // Get withdrawal items
          const withdrawalWithItems =
            await this.externalWithdrawalRepository.findByIdWithTransaction(tx, id, {
              include: { items: true },
            });

          if (withdrawalWithItems?.items && withdrawalWithItems.items.length > 0) {
            console.log(
              `[UPDATE METHOD] Processing ${withdrawalWithItems.items.length} items for return`,
            );

            for (const item of withdrawalWithItems.items) {
              // Calculate how much is still to be returned (avoid double-counting)
              const alreadyReturned = item.returnedQuantity || 0;
              const stillToReturn = item.withdrawedQuantity - alreadyReturned;

              // For FULLY_RETURNED, return remaining quantity only
              // For PARTIALLY_RETURNED, we don't automatically return anything
              const returnedQuantity =
                data.status === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED ? stillToReturn : 0;

              // Update the withdrawal item's returnedQuantity field
              if (data.status === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED && stillToReturn > 0) {
                await tx.externalWithdrawalItem.update({
                  where: { id: item.id },
                  data: { returnedQuantity: item.withdrawedQuantity },
                });
              }

              if (returnedQuantity > 0) {
                console.log(
                  `[UPDATE METHOD] Processing return for item ${item.itemId}, already returned: ${alreadyReturned}, still to return: ${stillToReturn}, returning now: ${returnedQuantity}`,
                );

                // Create inbound activity for the return
                // Using Prisma directly (bypassing ActivityService)
                await tx.activity.create({
                  data: {
                    itemId: item.itemId,
                    quantity: returnedQuantity,
                    operation: ACTIVITY_OPERATION.INBOUND,
                    reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN,
                    reasonOrder: 7, // External withdrawal return
                    userId: null, // No user - this is for external people
                  },
                });

                // Update item stock manually since we're bypassing the activity service
                const currentItem = await tx.item.findUnique({
                  where: { id: item.itemId },
                });

                if (currentItem) {
                  const newQuantity = currentItem.quantity + returnedQuantity;

                  console.log(
                    `[UPDATE METHOD] Updating stock for item ${item.itemId}: ${currentItem.quantity} -> ${newQuantity}`,
                  );

                  await tx.item.update({
                    where: { id: item.itemId },
                    data: { quantity: newQuantity },
                  });

                  // Log the stock update
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.ITEM,
                    entityId: item.itemId,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'quantity',
                    oldValue: currentItem.quantity,
                    newValue: newQuantity,
                    reason: `Estoque atualizado - Devolução de retirada externa`,
                    triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_RETURN,
                    triggeredById: id,
                    transaction: tx,
                    userId: userId || null,
                  });
                }
              }
            }
          }
        }

        // Rastrear mudanças em campos específicos - comprehensive field tracking
        const fieldsToTrack = [
          'withdrawerName',
          'withdrawerDocument',
          'withdrawerContact',
          // "status" is handled separately with status_transition for better context
          // "statusOrder" is internal and shouldn't be tracked
          'nfeId',
          'receiptId',
          'budgetId',
          'willReturn',
          'notes',
          'withdrawalDate',
          'expectedReturnDate',
          'actualReturnDate',
          'totalValue',
          'isPaid',
          'paymentDate',
          'withdrawalType',
          'responsibleUserId',
          'reason',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
          entityId: id,
          oldEntity: existingWithdrawal,
          newEntity: updatedWithdrawal,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedWithdrawal;
      });

      return {
        success: true,
        message: 'Retirada externa atualizada com sucesso',
        data: updatedWithdrawal,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar retirada externa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      // Preserve the original error message for better debugging
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao atualizar retirada externa';
      throw new InternalServerErrorException(
        `Erro ao atualizar retirada externa: ${errorMessage}`,
      );
    }
  }

  /**
   * Excluir retirada externa
   */
  async delete(id: string, userId?: string): Promise<ExternalWithdrawalDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const withdrawal = await this.externalWithdrawalRepository.findByIdWithTransaction(tx, id, {
          include: { items: true },
        });

        if (!withdrawal) {
          throw new NotFoundException('Retirada externa não encontrada');
        }

        // Restaurar quantidades de estoque para todos os itens
        if (withdrawal.items && withdrawal.items.length > 0) {
          for (const withdrawalItem of withdrawal.items) {
            const item = await tx.item.findUnique({ where: { id: withdrawalItem.itemId } });
            if (item) {
              const newQuantity = item.quantity + withdrawalItem.withdrawedQuantity;
              await tx.item.update({
                where: { id: withdrawalItem.itemId },
                data: { quantity: newQuantity },
              });

              // Criar atividade para rastrear a restauração
              await this.activityRepository.createWithTransaction(tx, {
                itemId: withdrawalItem.itemId,
                quantity: withdrawalItem.withdrawedQuantity,
                operation: ACTIVITY_OPERATION.INBOUND,
                reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
                userId: userId || null,
              });

              // Registrar restauração do estoque
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.ITEM,
                entityId: withdrawalItem.itemId,
                action: CHANGE_ACTION.UPDATE,
                field: 'quantity',
                oldValue: item.quantity,
                newValue: newQuantity,
                reason: 'Estoque restaurado - Exclusão de retirada externa',
                triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_DELETE,
                triggeredById: id,
                transaction: tx,
                userId: userId || null,
              });
            }
          }
        }

        // Registrar exclusão usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: withdrawal,
          reason: 'Retirada externa excluída',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.externalWithdrawalRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Retirada externa excluída com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir retirada externa:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir retirada externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplas retiradas externas
   */
  async batchCreate(
    data: ExternalWithdrawalBatchCreateFormData,
    include?: ExternalWithdrawalInclude,
    userId?: string,
  ): Promise<ExternalWithdrawalBatchCreateResponse<ExternalWithdrawalCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = {
          success: [] as any[],
          failed: [] as any[],
          totalCreated: 0,
          totalFailed: 0,
        };

        // Process each withdrawal individually to capture detailed errors
        for (let index = 0; index < data.externalWithdrawals.length; index++) {
          const withdrawalData = data.externalWithdrawals[index];

          try {
            // Get additional context for better error messages
            let itemNames: string[] = [];
            if (withdrawalData.items && withdrawalData.items.length > 0) {
              const itemIds = withdrawalData.items.map(item => item.itemId);
              const items = await this.itemRepository.findByIdsWithTransaction(tx, itemIds);
              itemNames = items.map(item => item.name);
            }

            // Create withdrawal
            const created = await this.externalWithdrawalRepository.createWithTransaction(
              tx,
              withdrawalData,
              { include },
            );

            // Log successful creation with enhanced context
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: `Retirada externa criada em lote - Retirador: ${withdrawalData.withdrawerName}, Itens: ${itemNames.join(', ') || 'N/A'}`,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            // Add success with detailed info
            const successWithDetails = {
              ...created,
              withdrawerName: withdrawalData.withdrawerName,
              itemNames: itemNames.join(', '),
              status: 'success' as const,
            };

            batchResult.success.push(successWithDetails);
            batchResult.totalCreated++;
          } catch (error: any) {
            // Get item names for error context
            let itemNames: string[] = [];
            if (withdrawalData.items && withdrawalData.items.length > 0) {
              try {
                const itemIds = withdrawalData.items.map(item => item.itemId);
                const items = await this.itemRepository.findByIdsWithTransaction(tx, itemIds);
                itemNames = items.map(item => item.name);
              } catch {
                // If we can't get item names, continue without them
              }
            }

            // Preserve detailed error information with context
            batchResult.failed.push({
              index,
              error: error.message || 'Erro ao criar retirada externa',
              errorCode: error.constructor?.name || 'UNKNOWN_ERROR',
              data: {
                ...withdrawalData,
                withdrawerName: withdrawalData.withdrawerName,
                itemNames: itemNames.join(', ') || 'Itens desconhecidos',
              },
              status: 'failed' as const,
            });
            batchResult.totalFailed++;
            this.logger.warn(
              `Erro ao criar retirada externa ${index} (${withdrawalData.withdrawerName}):`,
              error.message,
            );
          }
        }

        // Log batch operation summary
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
          entityId: 'batch_operation',
          action: CHANGE_ACTION.CREATE,
          field: 'batch_summary',
          oldValue: null,
          newValue: {
            totalProcessed: data.externalWithdrawals.length,
            totalSuccess: batchResult.totalCreated,
            totalFailed: batchResult.totalFailed,
            operation: 'batch_create',
            timestamp: new Date().toISOString(),
          },
          reason: `Operação em lote concluída: ${batchResult.totalCreated} criadas, ${batchResult.totalFailed} falharam`,
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
          triggeredById: 'batch_operation',
          transaction: tx,
          userId: userId || null,
        });

        return batchResult;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 retirada externa criada com sucesso'
          : `${result.totalCreated} retiradas externas criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format with enhanced details
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

      // Always try to return partial results for validation errors
      if (
        error.message?.includes('insuficiente') ||
        error.message?.includes('Invalid') ||
        error.message?.includes('não encontrado') ||
        error.message?.includes('validation') ||
        error.message?.includes('deve ter preço')
      ) {
        // Return as successful response but with failed items
        return {
          success: true, // Important: Keep as true so frontend shows the modal
          message: 'Operação processada com erros de validação',
          data: {
            success: [],
            failed: [
              {
                index: 0,
                error: error.message,
                errorCode: error.constructor?.name || 'VALIDATION_ERROR',
                data: {} as ExternalWithdrawalCreateFormData,
              },
            ],
            totalProcessed: 1,
            totalSuccess: 0,
            totalFailed: 1,
          },
        };
      }

      // Only throw generic error for unexpected system errors
      throw new InternalServerErrorException(
        'Erro ao criar retiradas externas em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar múltiplas retiradas externas
   */
  async batchUpdate(
    data: ExternalWithdrawalBatchUpdateFormData,
    include?: ExternalWithdrawalInclude,
    userId?: string,
  ): Promise<ExternalWithdrawalBatchUpdateResponse<ExternalWithdrawalUpdateFormData>> {
    try {
      const updates: UpdateData<ExternalWithdrawalUpdateFormData>[] = data.externalWithdrawals.map(
        withdrawal => ({
          id: withdrawal.id,
          data: withdrawal.data,
        }),
      );

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar entidades existentes para comparação
        const existingWithdrawals =
          await this.externalWithdrawalRepository.findByIdsWithTransaction(
            tx,
            updates.map(u => u.id),
          );
        const existingMap = new Map(existingWithdrawals.map(w => [w.id, w]));

        const result = await this.externalWithdrawalRepository.updateManyWithTransaction(
          tx,
          updates,
          { include },
        );

        // Rastrear mudanças para atualizações bem-sucedidas - comprehensive field tracking
        const fieldsToTrack = [
          'withdrawerName',
          'withdrawerDocument',
          'withdrawerContact',
          // "status" is handled separately with status_transition for better context
          // "statusOrder" is internal and shouldn't be tracked
          'nfeId',
          'receiptId',
          'budgetId',
          'willReturn',
          'notes',
          'withdrawalDate',
          'expectedReturnDate',
          'actualReturnDate',
          'totalValue',
          'isPaid',
          'paymentDate',
          'withdrawalType',
          'responsibleUserId',
          'reason',
        ];

        for (const withdrawal of result.success) {
          const existingWithdrawal = existingMap.get(withdrawal.id);
          if (existingWithdrawal) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
              entityId: withdrawal.id,
              oldEntity: existingWithdrawal,
              newEntity: withdrawal,
              fieldsToTrack,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 retirada externa atualizada com sucesso'
          : `${result.totalUpdated} retiradas externas atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
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
    } catch (error) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar retiradas externas em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir múltiplas retiradas externas
   */
  async batchDelete(
    data: ExternalWithdrawalBatchDeleteFormData,
    userId?: string,
  ): Promise<ExternalWithdrawalBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar retiradas antes de excluir para o changelog
        const withdrawals = await this.externalWithdrawalRepository.findByIdsWithTransaction(
          tx,
          data.externalWithdrawalIds,
          {
            include: { items: true },
          },
        );

        // Restaurar estoque e registrar exclusões
        for (const withdrawal of withdrawals) {
          // Restaurar quantidades de estoque
          if (withdrawal.items && withdrawal.items.length > 0) {
            for (const withdrawalItem of withdrawal.items) {
              const item = await tx.item.findUnique({ where: { id: withdrawalItem.itemId } });
              if (item) {
                const newQuantity = item.quantity + withdrawalItem.withdrawedQuantity;
                await tx.item.update({
                  where: { id: withdrawalItem.itemId },
                  data: { quantity: newQuantity },
                });

                // Criar atividade para rastrear a restauração
                await this.activityRepository.createWithTransaction(tx, {
                  itemId: withdrawalItem.itemId,
                  quantity: withdrawalItem.withdrawedQuantity,
                  operation: ACTIVITY_OPERATION.INBOUND,
                  reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
                });

                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ITEM,
                  entityId: withdrawalItem.itemId,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'quantity',
                  oldValue: item.quantity,
                  newValue: newQuantity,
                  reason: 'Estoque restaurado - Exclusão em lote de retirada externa',
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
                  triggeredById: withdrawal.id,
                  transaction: tx,
                  userId: userId || null,
                });
              }
            }
          }

          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
            entityId: withdrawal.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: withdrawal,
            reason: 'Retirada externa excluída em lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        return this.externalWithdrawalRepository.deleteManyWithTransaction(
          tx,
          data.externalWithdrawalIds,
        );
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 retirada externa excluída com sucesso'
          : `${result.totalDeleted} retiradas externas excluídas com sucesso`;
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
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir retiradas externas em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Update external withdrawal status to PARTIALLY_RETURNED
   */
  async markAsPartiallyReturned(
    id: string,
    data?: { notes?: string },
    userId?: string,
  ): Promise<ExternalWithdrawalUpdateResponse> {
    return this.updateStatus(
      id,
      EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED,
      data?.notes,
      userId,
    );
  }

  /**
   * Update external withdrawal status to FULLY_RETURNED
   */
  async markAsFullyReturned(
    id: string,
    data?: { notes?: string },
    userId?: string,
  ): Promise<ExternalWithdrawalUpdateResponse> {
    return this.updateStatus(id, EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED, data?.notes, userId);
  }

  /**
   * Update external withdrawal status to CHARGED
   */
  async markAsCharged(
    id: string,
    data?: { notes?: string },
    userId?: string,
  ): Promise<ExternalWithdrawalUpdateResponse> {
    return this.updateStatus(id, EXTERNAL_WITHDRAWAL_STATUS.CHARGED, data?.notes, userId);
  }

  /**
   * Update external withdrawal status to CANCELLED
   */
  async cancel(
    id: string,
    data?: { notes?: string },
    userId?: string,
  ): Promise<ExternalWithdrawalUpdateResponse> {
    return this.updateStatus(id, EXTERNAL_WITHDRAWAL_STATUS.CANCELLED, data?.notes, userId);
  }

  /**
   * Internal method to update external withdrawal status with validation
   */
  private async updateStatus(
    id: string,
    newStatus: EXTERNAL_WITHDRAWAL_STATUS,
    notes?: string,
    userId?: string,
  ): Promise<ExternalWithdrawalUpdateResponse> {
    try {
      const updatedWithdrawal = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing withdrawal
        const existingWithdrawal = await this.externalWithdrawalRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingWithdrawal) {
          throw new NotFoundException('Retirada externa não encontrada');
        }

        // Validate status transition
        this.validateStatusTransition(
          existingWithdrawal.status as EXTERNAL_WITHDRAWAL_STATUS,
          newStatus,
        );

        // Prepare update data
        const updateData: ExternalWithdrawalUpdateFormData = {
          status: newStatus,
        };

        // If notes provided, append to existing notes
        if (notes) {
          const existingNotes = existingWithdrawal.notes || '';
          const timestamp = new Date().toLocaleString('pt-BR');
          const statusLabel = this.getStatusLabel(newStatus);
          const newNote = `[${timestamp}] Status alterado para ${statusLabel}: ${notes}`;
          updateData.notes = existingNotes ? `${existingNotes}\n${newNote}` : newNote;
        }

        // Update withdrawal
        const updatedWithdrawal = await this.externalWithdrawalRepository.updateWithTransaction(
          tx,
          id,
          updateData,
        );

        // Handle stock return when status changes to FULLY_RETURNED or PARTIALLY_RETURNED
        console.log(`[EXTERNAL_WITHDRAWAL_RETURN] Status update check:`, {
          withdrawalId: id,
          existingStatus: existingWithdrawal.status,
          newStatus: newStatus,
          willReturn: existingWithdrawal.willReturn,
          shouldProcessReturn:
            existingWithdrawal.willReturn &&
            (newStatus === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED ||
              newStatus === EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED),
        });

        if (
          existingWithdrawal.willReturn &&
          (newStatus === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED ||
            newStatus === EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED)
        ) {
          // Get withdrawal items
          const withdrawalWithItems =
            await this.externalWithdrawalRepository.findByIdWithTransaction(tx, id, {
              include: { items: true },
            });

          console.log(
            `[EXTERNAL_WITHDRAWAL_RETURN] Processing return for ${withdrawalWithItems?.items?.length || 0} items`,
          );

          if (withdrawalWithItems?.items && withdrawalWithItems.items.length > 0) {
            for (const item of withdrawalWithItems.items) {
              // Calculate how much is still to be returned (avoid double-counting)
              const alreadyReturned = item.returnedQuantity || 0;
              const stillToReturn = item.withdrawedQuantity - alreadyReturned;

              // For FULLY_RETURNED, return remaining quantity only
              // For PARTIALLY_RETURNED, we don't automatically return anything
              const returnedQuantity =
                newStatus === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED ? stillToReturn : 0;

              // Update the withdrawal item's returnedQuantity field
              if (newStatus === EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED && stillToReturn > 0) {
                await tx.externalWithdrawalItem.update({
                  where: { id: item.id },
                  data: { returnedQuantity: item.withdrawedQuantity },
                });
              }

              if (returnedQuantity > 0) {
                try {
                  console.log(`[EXTERNAL_WITHDRAWAL_RETURN] Processing item return:`, {
                    withdrawalItemId: item.id,
                    itemId: item.itemId,
                    withdrawedQuantity: item.withdrawedQuantity,
                    alreadyReturned: alreadyReturned,
                    stillToReturn: stillToReturn,
                    returningNow: returnedQuantity,
                  });

                  // Create inbound activity for the return
                  // Using Prisma directly (bypassing ActivityService)
                  // So we need to update item stock manually
                  await tx.activity.create({
                    data: {
                      itemId: item.itemId,
                      quantity: returnedQuantity,
                      operation: ACTIVITY_OPERATION.INBOUND,
                      reason: ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN,
                      reasonOrder: 7, // External withdrawal return
                      userId: null, // No user - this is for external people
                    },
                  });

                  console.log(
                    `[EXTERNAL_WITHDRAWAL_RETURN] Activity created, now updating stock...`,
                  );

                  // Update item stock manually since we're bypassing the activity service
                  const currentItem = await tx.item.findUnique({
                    where: { id: item.itemId },
                  });

                  if (currentItem) {
                    const newQuantity = currentItem.quantity + returnedQuantity;

                    // Debug logging
                    console.log(
                      `[EXTERNAL_WITHDRAWAL_RETURN] Updating stock for item ${item.itemId}:`,
                      {
                        itemName: currentItem.name,
                        currentQuantity: currentItem.quantity,
                        returnedQuantity: returnedQuantity,
                        newQuantity: newQuantity,
                      },
                    );

                    const updatedItem = await tx.item.update({
                      where: { id: item.itemId },
                      data: { quantity: newQuantity },
                    });

                    console.log(`[EXTERNAL_WITHDRAWAL_RETURN] Stock updated successfully:`, {
                      itemId: item.itemId,
                      updatedQuantity: updatedItem.quantity,
                      expectedQuantity: newQuantity,
                    });

                    // Log the stock update
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.ITEM,
                      entityId: item.itemId,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'quantity',
                      oldValue: currentItem.quantity,
                      newValue: newQuantity,
                      reason: `Estoque atualizado - Devolução de retirada externa`,
                      triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_RETURN,
                      triggeredById: id,
                      transaction: tx,
                      userId: userId || null,
                    });
                  } else {
                    console.error(`[EXTERNAL_WITHDRAWAL_RETURN] Item not found for return:`, {
                      itemId: item.itemId,
                      withdrawalItemId: item.id,
                    });
                  }
                } catch (error) {
                  console.error(`[EXTERNAL_WITHDRAWAL_RETURN] Error processing return for item:`, {
                    itemId: item.itemId,
                    error: error,
                  });
                  throw error;
                }
              }
            }
          }
        }

        // Log status change
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          entity: updatedWithdrawal,
          oldEntity: existingWithdrawal,
          reason: `Status alterado de ${this.getStatusLabel(existingWithdrawal.status as EXTERNAL_WITHDRAWAL_STATUS)} para ${this.getStatusLabel(newStatus)}${notes ? `: ${notes}` : ''}`,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedWithdrawal;
      });

      return {
        success: true,
        message: `Status atualizado para ${this.getStatusLabel(newStatus)} com sucesso`,
        data: updatedWithdrawal,
      };
    } catch (error) {
      this.logger.error(`Erro ao atualizar status para ${newStatus}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar status. Por favor, tente novamente',
      );
    }
  }

  /**
   * Get status label in Portuguese
   */
  private getStatusLabel(status: EXTERNAL_WITHDRAWAL_STATUS): string {
    const labels: Record<EXTERNAL_WITHDRAWAL_STATUS, string> = {
      [EXTERNAL_WITHDRAWAL_STATUS.PENDING]: 'Pendente',
      [EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED]: 'Parcialmente Devolvido',
      [EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED]: 'Totalmente Devolvido',
      [EXTERNAL_WITHDRAWAL_STATUS.CHARGED]: 'Cobrado',
      [EXTERNAL_WITHDRAWAL_STATUS.CANCELLED]: 'Cancelado',
    };
    return labels[status] || status;
  }
}
