import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PpeSizeRepository, PrismaTransaction } from './repositories/ppe-size/ppe-size.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION, MASK_SIZE } from '../../../constants';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  PpeSize,
  PpeSizeGetUniqueResponse,
  PpeSizeGetManyResponse,
  PpeSizeCreateResponse,
  PpeSizeUpdateResponse,
  PpeSizeDeleteResponse,
  PpeSizeBatchCreateResponse,
  PpeSizeBatchUpdateResponse,
  PpeSizeBatchDeleteResponse,
} from '../../../types';
import {
  PpeSizeCreateFormData,
  PpeSizeUpdateFormData,
  PpeSizeInclude,
  PpeSizeGetManyFormData,
  PpeSizeBatchCreateFormData,
  PpeSizeBatchUpdateFormData,
  PpeSizeBatchDeleteFormData,
} from '../../../schemas';

@Injectable()
export class PpeSizeService {
  private readonly logger = new Logger(PpeSizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ppeSizeRepository: PpeSizeRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  private async validateEntity(
    data: Partial<PpeSizeCreateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.userId) {
      // Validar userId único para PpeSize
      const existingPpeSize = await transaction.ppeSize.findFirst({
        where: {
          userId: data.userId,
          ...(existingId && { NOT: { id: existingId } }),
        },
      });

      if (existingPpeSize) {
        throw new BadRequestException('Usuário já possui tamanhos de PPE cadastrados');
      }
    }

    // Validate mask field
    if (data.mask !== undefined && data.mask !== null) {
      // Trim the mask value
      const trimmedMask = data.mask.trim() as MASK_SIZE;

      // Ensure it's not empty after trimming
      if (trimmedMask.length === 0) {
        data.mask = null;
      } else {
        data.mask = trimmedMask;
      }
    }
  }

  // =====================
  // PPE SIZE OPERATIONS
  // =====================

  /**
   * Create a new PPE size
   */
  async create(
    data: PpeSizeCreateFormData,
    include?: PpeSizeInclude,
    userId?: string,
  ): Promise<PpeSizeCreateResponse> {
    try {
      const ppeSize = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar restrições únicas
        await this.validateEntity(data, undefined, tx);

        const newPpeSize = await this.ppeSizeRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_SIZE,
          entityId: newPpeSize.id,
          action: CHANGE_ACTION.CREATE,
          field: null,
          oldValue: null,
          newValue: newPpeSize,
          reason: 'Tamanhos PPE criados',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: newPpeSize.id,
          userId: userId || null,
          transaction: tx,
        });

        return newPpeSize;
      });

      return {
        success: true,
        message: 'Tamanhos PPE criados com sucesso.',
        data: ppeSize,
      };
    } catch (error) {
      this.logger.error('Erro ao criar tamanhos PPE:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar tamanhos PPE. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing PPE size
   */
  async update(
    id: string,
    data: PpeSizeUpdateFormData,
    include?: PpeSizeInclude,
    userId?: string,
  ): Promise<PpeSizeUpdateResponse> {
    try {
      const updatedPpeSize = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existingPpeSize = await this.ppeSizeRepository.findByIdWithTransaction(tx, id);
        if (!existingPpeSize) {
          throw new NotFoundException(
            'Tamanhos PPE não encontrados. Verifique se o ID está correto.',
          );
        }

        // userId não pode ser alterado em update

        const updatedPpeSize = await this.ppeSizeRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Track field-level changes
        const fieldsToTrack = [
          'shirts',
          'pants',
          'boots',
          'sleeves',
          'mask',
          'gloves',
          'rainBoots',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PPE_SIZE,
          entityId: id,
          oldEntity: existingPpeSize,
          newEntity: updatedPpeSize,
          fieldsToTrack: fieldsToTrack.filter(field => data.hasOwnProperty(field)),
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedPpeSize;
      });

      return {
        success: true,
        message: 'Tamanhos PPE atualizados com sucesso.',
        data: updatedPpeSize,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar tamanhos PPE:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar tamanhos PPE. Tente novamente.',
      );
    }
  }

  /**
   * Delete an PPE size
   */
  async delete(id: string, userId?: string): Promise<PpeSizeDeleteResponse> {
    try {
      const deletedPpeSize = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const ppeSize = await this.ppeSizeRepository.findByIdWithTransaction(tx, id);
        if (!ppeSize) {
          throw new NotFoundException(
            'Tamanhos PPE não encontrados. Verifique se o ID está correto.',
          );
        }

        // Registrar exclusão
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PPE_SIZE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          field: null,
          oldValue: ppeSize,
          newValue: null,
          reason: 'Tamanhos PPE excluídos',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        const deletedPpeSize = await this.ppeSizeRepository.deleteWithTransaction(tx, id);

        return deletedPpeSize;
      });

      return {
        success: true,
        message: 'Tamanhos PPE excluídos com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir tamanhos PPE:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir tamanhos PPE. Tente novamente.',
      );
    }
  }

  /**
   * Find an PPE size by ID
   */
  async findById(id: string, include?: PpeSizeInclude): Promise<PpeSizeGetUniqueResponse> {
    try {
      const ppeSize = await this.ppeSizeRepository.findById(id, { include });
      if (!ppeSize) {
        throw new NotFoundException(
          'Tamanhos PPE não encontrados. Verifique se o ID está correto.',
        );
      }

      return {
        success: true,
        message: 'Tamanhos PPE carregados com sucesso.',
        data: ppeSize,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tamanhos PPE por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar tamanhos PPE. Tente novamente.',
      );
    }
  }

  /**
   * Find an PPE size by user ID
   */
  async findByUserId(userId: string, include?: PpeSizeInclude): Promise<PpeSizeGetUniqueResponse> {
    try {
      const ppeSize = await this.ppeSizeRepository.findByUserId(userId, { include });
      if (!ppeSize) {
        throw new NotFoundException(
          'Tamanhos PPE não encontrados para o usuário. Verifique se o ID está correto.',
        );
      }

      return {
        success: true,
        message: 'Tamanhos PPE carregados com sucesso.',
        data: ppeSize,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tamanhos PPE por ID do usuário:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar tamanhos PPE. Tente novamente.',
      );
    }
  }

  /**
   * Find many PPE sizes with filtering
   */
  async findMany(query: PpeSizeGetManyFormData): Promise<PpeSizeGetManyResponse> {
    try {
      const result = await this.ppeSizeRepository.findMany(query);

      return {
        success: true,
        message: 'Tamanhos PPE carregados com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tamanhos PPE:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar tamanhos PPE. Tente novamente.',
      );
    }
  }

  /**
   * Batch create PPE sizes
   */
  async batchCreate(
    data: PpeSizeBatchCreateFormData,
    include?: PpeSizeInclude,
    userId?: string,
  ): Promise<PpeSizeBatchCreateResponse<PpeSizeCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.ppeSizeRepository.createManyWithTransaction(
          tx,
          data.ppeSizes,
          { include },
        );

        // Registrar criações bem-sucedidas
        for (const ppeSize of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_SIZE,
            entityId: ppeSize.id,
            action: CHANGE_ACTION.CREATE,
            field: null,
            oldValue: null,
            newValue: ppeSize,
            reason: 'Tamanhos PPE criados em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            triggeredById: ppeSize.id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      return {
        success: true,
        message: `${result.totalCreated} tamanhos PPE criados com sucesso. ${result.totalFailed} falharam.`,
        data: {
          success: result.success,
          failed: result.failed.map((error, idx) => ({
            index: error.index ?? idx,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: error.data,
          })),
          totalProcessed: result.totalCreated + result.totalFailed,
          totalSuccess: result.totalCreated,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote de tamanhos PPE:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na criação em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch update PPE sizes
   */
  async batchUpdate(
    data: PpeSizeBatchUpdateFormData,
    include?: PpeSizeInclude,
    userId?: string,
  ): Promise<PpeSizeBatchUpdateResponse<PpeSizeUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Ensure all items have required id and data fields
        const validatedItems = data.ppeSizes.map(item => ({
          id: item.id!,
          data: item.data!,
        }));
        const batchResult = await this.ppeSizeRepository.updateManyWithTransaction(
          tx,
          validatedItems,
          { include },
        );

        // Registrar atualizações bem-sucedidas
        for (const ppeSize of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PPE_SIZE,
            entityId: ppeSize.id,
            action: CHANGE_ACTION.UPDATE,
            field: null,
            oldValue: null,
            newValue: ppeSize,
            reason: 'Tamanhos PPE atualizados em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: ppeSize.id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      return {
        success: true,
        message: `${result.totalUpdated} tamanhos PPE atualizados com sucesso. ${result.totalFailed} falharam.`,
        data: {
          success: result.success,
          failed: result.failed.map((error, idx) => ({
            index: error.index ?? idx,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: { ...error.data, id: error.id || '' },
          })),
          totalProcessed: result.totalUpdated + result.totalFailed,
          totalSuccess: result.totalUpdated,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote de tamanhos PPE:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na atualização em lote. Tente novamente.',
      );
    }
  }

  /**
   * Find PPE sizes by mask size
   */
  async findByMaskSize(
    maskSize: string,
    include?: PpeSizeInclude,
  ): Promise<PpeSizeGetManyResponse> {
    try {
      const result = await this.ppeSizeRepository.findMany({
        where: { mask: maskSize },
        include,
      });

      return {
        success: true,
        message: 'Tamanhos PPE por tamanho de máscara carregados com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tamanhos PPE por tamanho de máscara:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar tamanhos PPE. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete PPE sizes
   */
  async batchDelete(
    data: PpeSizeBatchDeleteFormData,
    userId?: string,
  ): Promise<PpeSizeBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.ppeSizeRepository.deleteManyWithTransaction(
          tx,
          data.ppeSizeIds,
        );

        // Registrar exclusões bem-sucedidas
        for (const item of batchResult.success) {
          if (item.deleted) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.PPE_SIZE,
              entityId: item.id,
              action: CHANGE_ACTION.DELETE,
              field: null,
              oldValue: null,
              newValue: null,
              reason: 'Tamanhos PPE excluídos em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              triggeredById: item.id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return batchResult;
      });

      return {
        success: true,
        message: `${result.totalDeleted} tamanhos PPE excluídos com sucesso. ${result.totalFailed} falharam.`,
        data: {
          success: result.success,
          failed: result.failed.map((error, idx) => ({
            index: error.index ?? idx,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: error.data,
          })),
          totalProcessed: result.totalDeleted + result.totalFailed,
          totalSuccess: result.totalDeleted,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote de tamanhos PPE:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }
}
