import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BorrowRepository, PrismaTransaction } from './repositories/borrow.repository';
import {
  BatchCreateResult,
  BorrowBatchCreateResponse,
  BorrowBatchDeleteResponse,
  BorrowBatchUpdateResponse,
  BorrowCreateResponse,
  BorrowDeleteResponse,
  BorrowGetManyResponse,
  BorrowGetUniqueResponse,
  BorrowUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import {
  BorrowCreateFormData,
  BorrowUpdateFormData,
  BorrowGetManyFormData,
  BorrowBatchCreateFormData,
  BorrowBatchUpdateFormData,
  BorrowBatchDeleteFormData,
  BorrowInclude,
} from '../../../schemas/borrow';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import {
  CHANGE_TRIGGERED_BY,
  USER_STATUS,
  ENTITY_TYPE,
  CHANGE_ACTION,
  BORROW_STATUS,
  ACTIVITY_REASON,
  ACTIVITY_OPERATION,
  ACTIVE_USER_STATUSES,
} from '../../../constants/enums';
import { BORROW_STATUS_ORDER } from '../../../constants';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
@Injectable()
export class BorrowService {
  private readonly logger = new Logger(BorrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly borrowRepository: BorrowRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly activityService: ActivityService,
  ) {}

  /**
   * Validar empréstimo com regras de negócio completas
   */
  private async borrowValidation(
    data: BorrowCreateFormData | BorrowUpdateFormData,
    tx: PrismaTransaction,
    excludeId?: string,
  ): Promise<void> {
    const isUpdate = !!excludeId;

    // Validar campos obrigatórios para criação
    if (!isUpdate) {
      if (!data.itemId) {
        throw new BadRequestException('ID do item é obrigatório');
      }
      if (!data.userId) {
        throw new BadRequestException('ID do usuário é obrigatório');
      }
    }

    // Determinar IDs a serem usados
    let itemId = data.itemId;
    let userId = data.userId;
    let existingBorrow: any = null;

    if (isUpdate) {
      existingBorrow = await tx.borrow.findUnique({
        where: { id: excludeId },
        include: {
          item: true,
          user: true,
        },
      });

      if (!existingBorrow) {
        throw new NotFoundException('Empréstimo não encontrado');
      }

      // Usar IDs existentes se não fornecidos
      itemId = itemId || existingBorrow.itemId;
      userId = userId || existingBorrow.userId;
    }

    // Verificar se o item existe e está disponível
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        name: true,
        uniCode: true,
        quantity: true,
        maxQuantity: true,
        reorderPoint: true,
        category: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Item não encontrado');
    }

    // Note: Item entity doesn't have a status field

    // Note: Category entity doesn't have an isBorrowable field

    // Verificar se o usuário existe e está ativo
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        isActive: true,
        sectorId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (!user.isActive) {
      throw new BadRequestException('Usuário não está ativo e não pode fazer empréstimos');
    }

    // Validar quantidade
    const quantity = data.quantity ?? 1;

    if (!Number.isInteger(quantity)) {
      throw new BadRequestException('Quantidade deve ser um número inteiro');
    }

    if (quantity <= 0) {
      throw new BadRequestException('Quantidade deve ser maior que zero');
    }

    if (quantity > 100) {
      throw new BadRequestException('Quantidade máxima por empréstimo é 100 unidades');
    }

    // Validar data de devolução se fornecida
    if ('returnedAt' in data && data.returnedAt !== null && data.returnedAt !== undefined) {
      const returnedAt = new Date(data.returnedAt);

      // Verificar se é uma data válida
      if (isNaN(returnedAt.getTime())) {
        throw new BadRequestException('Data de devolução inválida');
      }

      if (isUpdate) {
        // Se estiver atualizando, verificar contra a data de criação
        if (returnedAt < existingBorrow.createdAt) {
          throw new BadRequestException(
            'Data de devolução deve ser posterior à data de empréstimo',
          );
        }

        // Verificar se não está no futuro (permite até 1 dia de tolerância)
        const maxFutureDate = new Date();
        maxFutureDate.setDate(maxFutureDate.getDate() + 1);
        if (returnedAt > maxFutureDate) {
          throw new BadRequestException('Data de devolução não pode ser mais de 1 dia no futuro');
        }

        // Se está marcando como devolvido, log the action
        if (!existingBorrow.returnedAt && data.returnedAt) {
          // Está devolvendo - validações específicas de devolução
          console.log(
            `Devolução do empréstimo ${excludeId} - Item: ${item.name}, Usuário: ${user.name}`,
          );
        } else if (existingBorrow.returnedAt && !data.returnedAt) {
          // Está desfazendo uma devolução - permitir a mudança
          console.log(
            `Desfazendo devolução do empréstimo ${excludeId} - Item: ${item.name}, Usuário: ${user.name}`,
          );
        }
      } else {
        // Se estiver criando com data de devolução, não faz sentido
        throw new BadRequestException('Não é possível criar um empréstimo já devolvido');
      }
    }

    // Validar disponibilidade de estoque apenas se o item não foi/será devolvido
    const isReturned = isUpdate && existingBorrow?.returnedAt;
    const willBeReturned =
      'returnedAt' in data && data.returnedAt !== null && data.returnedAt !== undefined;
    const isUnreturning = isUpdate && existingBorrow?.returnedAt && !willBeReturned;
    const willBeLost = 'status' in data && data.status === BORROW_STATUS.LOST;

    // Validate stock if:
    // 1. Item is not returned and will not be returned (normal active borrow)
    // 2. Item is being unreturned to ACTIVE status (not LOST)
    if ((!isReturned && !willBeReturned) || (isUnreturning && !willBeLost)) {
      // Calcular quantidade total não devolvida para o item (excluindo o empréstimo atual se for atualização)
      // Não incluir empréstimos com status RETURNED ou LOST
      const unreturnedBorrows = await tx.borrow.findMany({
        where: {
          itemId: itemId,
          status: {
            notIn: [BORROW_STATUS.RETURNED, BORROW_STATUS.LOST],
          },
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: {
          quantity: true,
          user: {
            select: {
              name: true,
            },
          },
        },
      });

      const totalUnreturnedQuantity = unreturnedBorrows.reduce(
        (sum, borrow) => sum + borrow.quantity,
        0,
      );

      // Verificar se há estoque suficiente
      const availableQuantity = item.quantity - totalUnreturnedQuantity;

      if (availableQuantity < quantity) {
        // Criar mensagem detalhada sobre empréstimos atuais
        const borrowDetails =
          unreturnedBorrows.length > 0
            ? `\nEmpréstimos ativos: ${unreturnedBorrows.map(b => `${b.user.name} (${b.quantity})`).join(', ')}`
            : '';

        throw new BadRequestException(
          `Estoque insuficiente. Disponível: ${availableQuantity}, Solicitado: ${quantity}` +
            `\nEstoque total: ${item.quantity}, Emprestado: ${totalUnreturnedQuantity}${borrowDetails}`,
        );
      }

      // Avisar se o estoque ficará baixo após o empréstimo
      const remainingAfterBorrow = availableQuantity - quantity;
      if (item.reorderPoint && remainingAfterBorrow <= item.reorderPoint) {
        console.warn(
          `AVISO: Item "${item.name}" ficará com estoque baixo após o empréstimo. ` +
            `Disponível após empréstimo: ${remainingAfterBorrow}, Ponto de reposição: ${item.reorderPoint}`,
        );
      }
    }

    // Verificar limite de empréstimos simultâneos do usuário
    if (!isUpdate || (isUpdate && !existingBorrow.returnedAt)) {
      const activeUserBorrows = await tx.borrow.count({
        where: {
          userId: userId,
          status: {
            notIn: [BORROW_STATUS.RETURNED, BORROW_STATUS.LOST],
          },
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
      });

      const maxSimultaneousBorrows = 10; // Limite configurável
      if (activeUserBorrows >= maxSimultaneousBorrows) {
        throw new BadRequestException(
          `Usuário já possui ${activeUserBorrows} empréstimos ativos. ` +
            `Limite máximo: ${maxSimultaneousBorrows}`,
        );
      }
    }

    // Verificar se o usuário já tem um empréstimo ativo do mesmo item (evitar duplicação)
    if (!isUpdate) {
      const existingUserItemBorrow = await tx.borrow.findFirst({
        where: {
          userId: userId,
          itemId: itemId,
          status: {
            notIn: [BORROW_STATUS.RETURNED, BORROW_STATUS.LOST],
          },
        },
      });

      if (existingUserItemBorrow) {
        throw new BadRequestException(
          `Usuário já possui um empréstimo ativo deste item (${existingUserItemBorrow.quantity} unidade(s)). ` +
            `Devolva o empréstimo anterior antes de criar um novo.`,
        );
      }
    }

    // Validações específicas para atualização
    if (isUpdate) {
      // Não permitir mudança de item ou usuário em empréstimos não devolvidos
      if (!existingBorrow.returnedAt) {
        if (data.itemId && data.itemId !== existingBorrow.itemId) {
          throw new BadRequestException(
            'Não é permitido alterar o item de um empréstimo não devolvido',
          );
        }

        if (data.userId && data.userId !== existingBorrow.userId) {
          throw new BadRequestException(
            'Não é permitido alterar o usuário de um empréstimo não devolvido',
          );
        }
      }
    }
  }

  /**
   * Buscar muitos empréstimos com filtros
   */
  async findMany(query: BorrowGetManyFormData): Promise<BorrowGetManyResponse> {
    try {
      const result = await this.borrowRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Empréstimos carregados com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar empréstimos:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar empréstimos. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar um empréstimo por ID
   */
  async findById(id: string, include?: BorrowInclude): Promise<BorrowGetUniqueResponse> {
    try {
      const borrow = await this.borrowRepository.findById(id, { include });

      if (!borrow) {
        throw new NotFoundException('Empréstimo não encontrado');
      }

      return { success: true, data: borrow, message: 'Empréstimo carregado com sucesso' };
    } catch (error) {
      this.logger.error('Erro ao buscar empréstimo por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar empréstimo. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar novo empréstimo
   */
  async create(
    data: BorrowCreateFormData,
    include?: BorrowInclude,
    userId?: string,
  ): Promise<BorrowCreateResponse> {
    try {
      const borrow = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar o empréstimo
        await this.borrowValidation(data, tx);

        // Criar o empréstimo
        const newBorrow = await this.borrowRepository.createWithTransaction(tx, data, { include });

        // Registrar no changelog usando logEntityChange
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BORROW,
          entityId: newBorrow.id,
          action: CHANGE_ACTION.CREATE,
          entity: newBorrow,
          reason: `Empréstimo criado: ${data.quantity || 1} unidade(s) do item`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newBorrow;
      });

      return {
        success: true,
        message: 'Empréstimo criado com sucesso',
        data: borrow,
      };
    } catch (error) {
      this.logger.error('Erro ao criar empréstimo:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar empréstimo. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar empréstimo
   */
  async update(
    id: string,
    data: BorrowUpdateFormData,
    include?: BorrowInclude,
    userId?: string,
  ): Promise<BorrowUpdateResponse> {
    try {
      const updatedBorrow = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar empréstimo existente
        const existingBorrow = await this.borrowRepository.findByIdWithTransaction(tx, id);

        if (!existingBorrow) {
          throw new NotFoundException('Empréstimo não encontrado');
        }

        // Validar o empréstimo com as novas informações
        await this.borrowValidation(data, tx, id);

        // Handle status changes from RETURNED to LOST
        let updateData = { ...data };
        if (
          existingBorrow.status === BORROW_STATUS.RETURNED &&
          data.status === BORROW_STATUS.LOST &&
          existingBorrow.returnedAt
        ) {
          // When changing from RETURNED to LOST, set returnedAt to null
          updateData.returnedAt = null;
        }

        // Atualizar o empréstimo
        const updatedBorrow = await this.borrowRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          { include },
        );

        // Registrar mudanças de campos usando trackAndLogFieldChanges
        const fieldsToTrack = [
          'status',
          'statusOrder',
          'itemId',
          'userId',
          'quantity',
          'returnedAt',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BORROW,
          entityId: id,
          oldEntity: existingBorrow,
          newEntity: updatedBorrow,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedBorrow;
      });

      return {
        success: true,
        message: 'Empréstimo atualizado com sucesso',
        data: updatedBorrow,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar empréstimo:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar empréstimo. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir empréstimo
   */
  async delete(id: string, userId?: string): Promise<BorrowDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const borrow = await this.borrowRepository.findByIdWithTransaction(tx, id);

        if (!borrow) {
          throw new NotFoundException('Empréstimo não encontrado');
        }

        // Registrar exclusão usando logEntityChange
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BORROW,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: borrow,
          reason: 'Empréstimo excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await this.borrowRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Empréstimo excluído com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir empréstimo:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir empréstimo. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplos empréstimos
   */
  async batchCreate(
    data: BorrowBatchCreateFormData,
    include?: BorrowInclude,
    userId?: string,
  ): Promise<BorrowBatchCreateResponse<BorrowCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Instead of pre-validating all items, let repository handle individual validation
        // Create custom batch result to capture detailed validation errors
        const batchResult: BatchCreateResult<any, BorrowCreateFormData> = {
          success: [],
          failed: [],
          totalCreated: 0,
          totalFailed: 0,
        };

        // Process each borrow individually to preserve detailed error messages
        for (let index = 0; index < data.borrows.length; index++) {
          const borrowData = data.borrows[index];

          // Get item and user names for detailed feedback
          const item = await tx.item.findUnique({
            where: { id: borrowData.itemId },
            select: { name: true, uniCode: true },
          });
          const user = await tx.user.findUnique({
            where: { id: borrowData.userId },
            select: { name: true },
          });

          const itemName = item?.uniCode
            ? `${item.uniCode} - ${item.name}`
            : item?.name || 'Item desconhecido';
          const userName = user?.name || 'Usuário desconhecido';

          try {
            // Validate individual item (this is where "Estoque insuficiente" error is thrown)
            await this.borrowValidation(borrowData, tx);

            // Create individual item
            const created = await this.borrowRepository.createWithTransaction(tx, borrowData, {
              include,
            });

            // Log successful creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.BORROW,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: 'Empréstimo criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            // Add success with detailed info
            const successWithDetails = {
              ...created,
              itemName,
              userName,
              status: 'success' as const,
            };

            batchResult.success.push(successWithDetails);
            batchResult.totalCreated++;
          } catch (error: any) {
            // Preserve detailed error information with context
            const failedItem = {
              index,
              error: error.message || 'Erro ao criar empréstimo',
              errorCode: error.constructor?.name || 'UNKNOWN_ERROR',
              data: {
                ...borrowData,
                itemName,
                userName,
              },
            };

            batchResult.failed.push(failedItem);
            batchResult.totalFailed++;
            this.logger.warn(
              `Erro ao criar empréstimo ${index} (${itemName} - ${userName}):`,
              error.message,
            );
          }
        }

        const result = batchResult;

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 empréstimo criado com sucesso'
          : `${result.totalCreated} empréstimos criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success.map((item: any) => ({
          ...item,
          itemName: item.itemName,
          userName: item.userName,
        })),
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data, // data already includes itemName and userName
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
      // This ensures the frontend gets the batch result format instead of a generic error
      if (
        error.message?.includes('insuficiente') ||
        error.message?.includes('máximo') ||
        error.message?.includes('Invalid') ||
        error.message?.includes('não encontrado') ||
        error.message?.includes('validation') ||
        error.message?.includes('já possui um empréstimo') ||
        error.message?.includes('limite')
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
                data: {} as BorrowCreateFormData,
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
        'Erro ao criar empréstimos em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar múltiplos empréstimos
   */
  async batchUpdate(
    data: BorrowBatchUpdateFormData,
    include?: BorrowInclude,
    userId?: string,
  ): Promise<BorrowBatchUpdateResponse<BorrowUpdateFormData>> {
    try {
      const updates: UpdateData<BorrowUpdateFormData>[] = data.borrows.map(borrow => ({
        id: borrow.id,
        data: borrow.data,
      }));

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar empréstimos antigos antes de atualizar para o changelog
        const oldBorrows = new Map<string, any>();
        for (const update of updates) {
          const oldBorrow = await tx.borrow.findUnique({ where: { id: update.id } });
          if (oldBorrow) {
            oldBorrows.set(update.id, oldBorrow);
          }
        }

        // Validar cada atualização antes de aplicar
        for (const update of updates) {
          await this.borrowValidation(update.data, tx, update.id);
        }

        const result = await this.borrowRepository.updateManyWithTransaction(tx, updates, {
          include,
        });

        // Registrar atualizações bem-sucedidas
        for (const updatedBorrow of result.success) {
          const oldBorrow = oldBorrows.get(updatedBorrow.id);

          if (oldBorrow) {
            const fieldsToTrack = [
              'status',
              'statusOrder',
              'itemId',
              'userId',
              'quantity',
              'returnedAt',
            ];

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.BORROW,
              entityId: updatedBorrow.id,
              oldEntity: oldBorrow,
              newEntity: updatedBorrow,
              fieldsToTrack,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 empréstimo atualizado com sucesso'
          : `${result.totalUpdated} empréstimos atualizados com sucesso`;
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
    } catch (error) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar empréstimos em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir múltiplos empréstimos
   */
  async batchDelete(
    data: BorrowBatchDeleteFormData,
    userId?: string,
  ): Promise<BorrowBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar empréstimos antes de excluir para o changelog
        const borrows = await this.borrowRepository.findByIdsWithTransaction(tx, data.borrowIds);

        // Registrar exclusões usando logEntityChange
        for (const borrow of borrows) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.BORROW,
            entityId: borrow.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: borrow,
            reason: 'Empréstimo excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.borrowRepository.deleteManyWithTransaction(tx, data.borrowIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 empréstimo excluído com sucesso'
          : `${result.totalDeleted} empréstimos excluídos com sucesso`;
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
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir empréstimos em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Marcar empréstimo como perdido
   */
  async markAsLost(
    id: string,
    include?: BorrowInclude,
    userId?: string,
  ): Promise<BorrowUpdateResponse> {
    try {
      const updatedBorrow = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar empréstimo existente com item e user inclusos
        const existingBorrow = await this.borrowRepository.findByIdWithTransaction(tx, id, {
          include: {
            item: true,
            user: true,
          },
        });

        if (!existingBorrow) {
          throw new NotFoundException('Empréstimo não encontrado');
        }

        // Verificar se o empréstimo pode ser marcado como perdido
        if (existingBorrow.status === BORROW_STATUS.LOST) {
          throw new BadRequestException('Empréstimo já está marcado como perdido');
        }

        if (existingBorrow.status === BORROW_STATUS.RETURNED) {
          throw new BadRequestException(
            'Não é possível marcar um empréstimo devolvido como perdido',
          );
        }

        // Atualizar o empréstimo para status LOST
        const updateData = {
          status: BORROW_STATUS.LOST,
          statusOrder: BORROW_STATUS_ORDER[BORROW_STATUS.LOST],
          returnedAt: null, // Keep returnedAt null to maintain consistency
        };

        const updatedBorrow = await this.borrowRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          { include },
        );

        // Criar atividade de perda - quantidade positiva com operação OUTBOUND para reduzir estoque
        await this.activityService.create(
          {
            itemId: existingBorrow.itemId,
            quantity: existingBorrow.quantity, // Positive quantity with OUTBOUND operation
            operation: ACTIVITY_OPERATION.OUTBOUND,
            reason: ACTIVITY_REASON.LOSS,
            userId: existingBorrow.userId, // Associate the activity with the borrower
          },
          undefined,
          userId,
        );

        // Registrar mudança usando trackAndLogFieldChanges
        const fieldsToTrack = ['status', 'statusOrder', 'returnedAt'];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BORROW,
          entityId: id,
          oldEntity: existingBorrow,
          newEntity: updatedBorrow,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedBorrow;
      });

      return {
        success: true,
        message: 'Empréstimo marcado como perdido com sucesso',
        data: updatedBorrow,
      };
    } catch (error) {
      this.logger.error('Erro ao marcar empréstimo como perdido:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao marcar empréstimo como perdido. Por favor, tente novamente',
      );
    }
  }
}
