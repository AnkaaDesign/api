// bonus-discount.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BonusDiscountRepository, PrismaTransaction } from './repositories/bonus-discount/bonus-discount.repository';
import type {
  BonusDiscount,
  BonusDiscountBatchResponse,
  BonusDiscountCreateResponse,
  BonusDiscountDeleteResponse,
  BonusDiscountGetManyResponse,
  BonusDiscountGetUniqueResponse,
  BonusDiscountUpdateResponse,
  FindManyOptions,
} from '../../../types';
import type {
  BonusDiscountCreateFormData,
  BonusDiscountUpdateFormData,
  BonusDiscountGetManyFormData,
  BonusDiscountBatchCreateFormData,
  BonusDiscountBatchUpdateFormData,
  BonusDiscountBatchDeleteFormData,
  BonusDiscountInclude,
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
} from '../../../constants/enums';

@Injectable()
export class BonusDiscountService {
  private readonly logger = new Logger(BonusDiscountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusDiscountRepository: BonusDiscountRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validate bonus discount data
   */
  private async bonusDiscountValidation(
    data: Partial<BonusDiscountCreateFormData | BonusDiscountUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    const isUpdate = !!existingId;

    // Validate required fields for creation
    if (!isUpdate) {
      if (!('bonusId' in data) || !data.bonusId) {
        throw new BadRequestException('ID do bônus é obrigatório.');
      }
      if (!data.reference || data.reference.trim().length === 0) {
        throw new BadRequestException('Referência é obrigatória.');
      }
    }

    // Validate reference
    if (data.reference !== undefined) {
      const trimmedReference = data.reference.trim();
      if (trimmedReference.length === 0) {
        throw new BadRequestException('Referência não pode ser vazia.');
      }
      if (trimmedReference.length < 1) {
        throw new BadRequestException('Referência deve ter pelo menos 1 caractere.');
      }
      if (trimmedReference.length > 200) {
        throw new BadRequestException('Referência deve ter no máximo 200 caracteres.');
      }
    }

    // Validate percentage
    if (data.percentage !== undefined) {
      if (data.percentage < 0) {
        throw new BadRequestException('Percentual deve ser maior ou igual a zero.');
      }
      if (data.percentage > 100) {
        throw new BadRequestException('Percentual deve ser menor ou igual a 100.');
      }
    }

    // Validate bonus exists (only if bonusId is provided - creation only)
    if ('bonusId' in data && data.bonusId !== undefined) {
      const bonus = await transaction.bonus.findUnique({
        where: { id: data.bonusId },
      });
      if (!bonus) {
        throw new BadRequestException('Bônus não encontrado.');
      }
    }
  }

  /**
   * Find many bonus discounts with pagination
   */
  async findMany(
    params: BonusDiscountGetManyFormData,
    include?: BonusDiscountInclude,
    userId?: string
  ): Promise<BonusDiscountGetManyResponse> {
    try {
      const options: FindManyOptions<any, any, any> = {
        page: params.page || 1,
        take: params.limit || 10,
        where: params.where,
        orderBy: params.orderBy || { createdAt: 'desc' },
        include: include || params.include,
      };

      const result = await this.bonusDiscountRepository.findMany(options);

      return {
        success: true,
        message: 'Descontos de bônus encontrados com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Error finding bonus discounts', { error, params });
      throw new InternalServerErrorException('Erro interno do servidor ao buscar descontos de bônus.');
    }
  }

  /**
   * Find bonus discount by ID
   */
  async findById(id: string, include?: BonusDiscountInclude, userId?: string): Promise<BonusDiscountGetUniqueResponse> {
    try {
      const bonusDiscount = await this.bonusDiscountRepository.findById(id, { include });

      if (!bonusDiscount) {
        throw new NotFoundException('Desconto de bônus não encontrado.');
      }

      return {
        success: true,
        message: 'Desconto de bônus encontrado com sucesso.',
        data: bonusDiscount,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error finding bonus discount by ID', { error, id });
      throw new InternalServerErrorException('Erro interno do servidor ao buscar desconto de bônus.');
    }
  }

  /**
   * Create a new bonus discount
   */
  async create(data: BonusDiscountCreateFormData, include?: BonusDiscountInclude, userId?: string): Promise<BonusDiscountCreateResponse> {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Validate data
        await this.bonusDiscountValidation(data, undefined, tx);

        // Create bonus discount
        const bonusDiscount = await this.bonusDiscountRepository.createWithTransaction(tx, data, { include });

        // Log change
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityId: bonusDiscount.id,
          entity: bonusDiscount,
          entityType: ENTITY_TYPE.BONUS,
          action: CHANGE_ACTION.CREATE,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return {
          success: true,
          message: 'Desconto de bônus criado com sucesso.',
          data: bonusDiscount,
        };
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        this.logger.error('Error creating bonus discount', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor ao criar desconto de bônus.');
      }
    });
  }

  /**
   * Update a bonus discount
   */
  async update(
    id: string,
    data: BonusDiscountUpdateFormData,
    include?: BonusDiscountInclude,
    userId?: string
  ): Promise<BonusDiscountUpdateResponse> {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Check if bonus discount exists
        const existingBonusDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(tx, id, {});
        if (!existingBonusDiscount) {
          throw new NotFoundException('Desconto de bônus não encontrado.');
        }

        // Validate data
        await this.bonusDiscountValidation(data, id, tx);

        // Update bonus discount
        const updatedBonusDiscount = await this.bonusDiscountRepository.updateWithTransaction(tx, id, data, { include });

        // Track and log field changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: id,
          oldEntity: existingBonusDiscount,
          newEntity: updatedBonusDiscount,
          fieldsToTrack: ['reference', 'percentage', 'value', 'calculationOrder'],
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return {
          success: true,
          message: 'Desconto de bônus atualizado com sucesso.',
          data: updatedBonusDiscount,
        };
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          throw error;
        }
        this.logger.error('Error updating bonus discount', { error, id, data });
        throw new InternalServerErrorException('Erro interno do servidor ao atualizar desconto de bônus.');
      }
    });
  }

  /**
   * Delete a bonus discount
   */
  async delete(id: string, userId?: string): Promise<BonusDiscountDeleteResponse> {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Check if bonus discount exists
        const existingBonusDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(tx, id, {});
        if (!existingBonusDiscount) {
          throw new NotFoundException('Desconto de bônus não encontrado.');
        }

        // Delete bonus discount
        await this.bonusDiscountRepository.deleteWithTransaction(tx, id);

        // Log change
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityId: existingBonusDiscount.id,
          entity: existingBonusDiscount,
          entityType: ENTITY_TYPE.BONUS,
          action: CHANGE_ACTION.DELETE,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return {
          success: true,
          message: 'Desconto de bônus deletado com sucesso.',
        };
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw error;
        }
        this.logger.error('Error deleting bonus discount', { error, id });
        throw new InternalServerErrorException('Erro interno do servidor ao deletar desconto de bônus.');
      }
    });
  }

  /**
   * Batch create bonus discounts
   */
  async batchCreate(
    data: BonusDiscountBatchCreateFormData,
    include?: BonusDiscountInclude,
    userId?: string
  ): Promise<BonusDiscountBatchResponse<BonusDiscountCreateFormData>> {
    return this.prisma.$transaction(async (tx) => {
      try {
        const results = [];
        const errors = [];

        for (let i = 0; i < data.discounts.length; i++) {
          try {
            const discountData = data.discounts[i];

            // Validate data
            await this.bonusDiscountValidation(discountData, undefined, tx);

            // Create bonus discount
            const bonusDiscount = await this.bonusDiscountRepository.createWithTransaction(tx, discountData, { include });

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityId: bonusDiscount.id,
              entity: bonusDiscount,
              entityType: ENTITY_TYPE.BONUS,
              action: CHANGE_ACTION.BATCH_CREATE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_OPERATION,
              transaction: tx,
            });

            results.push({ success: true, data: bonusDiscount });
          } catch (error) {
            errors.push({
              index: i,
              error: error.message || 'Erro desconhecido',
              data: data.discounts[i],
            });
          }
        }

        return {
          success: true,
          message: `${results.length} descontos de bônus criados com sucesso.`,
          totalSuccess: results.length,
          totalFailed: errors.length,
          results,
          errors,
        };
      } catch (error) {
        this.logger.error('Error in batch create bonus discounts', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor na criação em lote de descontos de bônus.');
      }
    });
  }

  /**
   * Batch update bonus discounts
   */
  async batchUpdate(
    data: BonusDiscountBatchUpdateFormData,
    include?: BonusDiscountInclude,
    userId?: string
  ): Promise<BonusDiscountBatchResponse<BonusDiscountUpdateFormData>> {
    return this.prisma.$transaction(async (tx) => {
      try {
        const results = [];
        const errors = [];

        for (let i = 0; i < data.discounts.length; i++) {
          try {
            const { id, data: updateData } = data.discounts[i];

            // Check if bonus discount exists
            const existingBonusDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(tx, id, {});
            if (!existingBonusDiscount) {
              throw new NotFoundException(`Desconto de bônus com ID ${id} não encontrado.`);
            }

            // Validate data
            await this.bonusDiscountValidation(updateData, id, tx);

            // Update bonus discount
            const updatedBonusDiscount = await this.bonusDiscountRepository.updateWithTransaction(tx, id, updateData, { include });

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityId: updatedBonusDiscount.id,
              entity: updatedBonusDiscount,
              entityType: ENTITY_TYPE.BONUS,
              action: CHANGE_ACTION.BATCH_UPDATE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_OPERATION,
              transaction: tx,
            });

            results.push({ success: true, data: updatedBonusDiscount });
          } catch (error) {
            errors.push({
              index: i,
              error: error.message || 'Erro desconhecido',
              data: data.discounts[i],
            });
          }
        }

        return {
          success: true,
          message: `${results.length} descontos de bônus atualizados com sucesso.`,
          totalSuccess: results.length,
          totalFailed: errors.length,
          results,
          errors,
        };
      } catch (error) {
        this.logger.error('Error in batch update bonus discounts', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor na atualização em lote de descontos de bônus.');
      }
    });
  }

  /**
   * Batch delete bonus discounts
   */
  async batchDelete(data: BonusDiscountBatchDeleteFormData, userId?: string): Promise<BonusDiscountBatchResponse<string>> {
    return this.prisma.$transaction(async (tx) => {
      try {
        const results = [];
        const errors = [];

        for (let i = 0; i < data.discountIds.length; i++) {
          try {
            const discountId = data.discountIds[i];

            // Check if bonus discount exists
            const existingBonusDiscount = await this.bonusDiscountRepository.findByIdWithTransaction(tx, discountId, {});
            if (!existingBonusDiscount) {
              throw new NotFoundException(`Desconto de bônus com ID ${discountId} não encontrado.`);
            }

            // Delete bonus discount
            await this.bonusDiscountRepository.deleteWithTransaction(tx, discountId);

            // Log change
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityId: existingBonusDiscount.id,
              entity: existingBonusDiscount,
              entityType: ENTITY_TYPE.BONUS,
              action: CHANGE_ACTION.BATCH_DELETE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_OPERATION,
              transaction: tx,
            });

            results.push({ success: true, data: discountId });
          } catch (error) {
            errors.push({
              index: i,
              error: error.message || 'Erro desconhecido',
              data: data.discountIds[i],
            });
          }
        }

        return {
          success: true,
          message: `${results.length} descontos de bônus deletados com sucesso.`,
          totalSuccess: results.length,
          totalFailed: errors.length,
          results,
          errors,
        };
      } catch (error) {
        this.logger.error('Error in batch delete bonus discounts', { error, data });
        throw new InternalServerErrorException('Erro interno do servidor na exclusão em lote de descontos de bônus.');
      }
    });
  }
}