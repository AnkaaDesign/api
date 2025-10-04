import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { DiscountRepository } from './repositories/discount/discount.repository';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import type {
  Discount,
  DiscountCreateResponse,
  DiscountDeleteResponse,
  DiscountGetManyResponse,
  DiscountGetUniqueResponse,
  DiscountUpdateResponse,
  DiscountBatchCreateResponse,
  DiscountBatchUpdateResponse,
  DiscountBatchDeleteResponse,
} from '../../../types';
import type {
  DiscountCreateFormData,
  DiscountUpdateFormData,
  DiscountGetManyFormData,
  DiscountInclude,
  DiscountBatchCreateFormData,
  DiscountBatchUpdateFormData,
  DiscountBatchDeleteFormData,
} from '../../../schemas/discount';

@Injectable()
export class DiscountService {
  private readonly logger = new Logger(DiscountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discountRepository: DiscountRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  async findMany(
    params: DiscountGetManyFormData,
    include?: DiscountInclude,
    userId?: string,
  ): Promise<DiscountGetManyResponse> {
    try {
      this.logger.log(`Finding discounts with params: ${JSON.stringify(params)}`);

      const [data, totalRecords] = await Promise.all([
        this.discountRepository.findMany({
          where: params.where,
          include,
          orderBy: params.orderBy,
          skip: ((params.page || 1) - 1) * (params.limit || 10),
          take: params.limit || 10,
        }),
        this.discountRepository.count(params.where),
      ]);

      const page = params.page || 1;
      const limit = params.limit || 10;
      const totalPages = Math.ceil(totalRecords / limit);
      const hasNextPage = page * limit < totalRecords;
      const hasPreviousPage = page > 1;

      return {
        success: true,
        message: 'Descontos encontrados com sucesso',
        data,
        meta: {
          totalRecords,
          page,
          take: limit,
          totalPages,
          hasNextPage,
          hasPreviousPage,
        },
      };
    } catch (error) {
      this.logger.error(`Error finding discounts: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar descontos');
    }
  }

  async findById(id: string, include?: DiscountInclude): Promise<DiscountGetUniqueResponse> {
    try {
      this.logger.log(`Finding discount by id: ${id}`);

      const discount = await this.discountRepository.findById(id);

      if (!discount) {
        throw new NotFoundException('Desconto não encontrado');
      }

      return {
        success: true,
        message: 'Desconto encontrado com sucesso',
        data: discount,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Error finding discount by id: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar desconto');
    }
  }

  async create(
    data: DiscountCreateFormData,
    include?: DiscountInclude,
    userId?: string,
  ): Promise<DiscountCreateResponse> {
    try {
      this.logger.log(`Creating discount: ${data.reference}`);

      await this.validateCreateDiscount(data);

      const discount = await this.discountRepository.create(data);

      if (userId) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.DISCOUNT,
          entityId: discount.id,
          action: CHANGE_ACTION.CREATE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          newData: discount,
          reason: `Desconto criado: ${data.reference}`,
        });
      }

      const response = include ? await this.discountRepository.findById(discount.id) : discount;

      return {
        success: true,
        message: 'Desconto criado com sucesso',
        data: response!,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Error creating discount: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao criar desconto');
    }
  }

  async update(
    id: string,
    data: DiscountUpdateFormData,
    include?: DiscountInclude,
    userId?: string,
  ): Promise<DiscountUpdateResponse> {
    try {
      this.logger.log(`Updating discount: ${id}`);

      const existingDiscount = await this.discountRepository.findById(id);

      if (!existingDiscount) {
        throw new NotFoundException('Desconto não encontrado');
      }

      await this.validateUpdateDiscount(id, data);

      const updatedDiscount = await this.discountRepository.update(id, data);

      if (userId) {
        const changes = trackFieldChanges(existingDiscount, updatedDiscount, [
          'reference',
          'percentage',
          'value',
          'calculationOrder',
        ]);

        if (Object.keys(changes).length > 0) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.DISCOUNT,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            triggeredBy: CHANGE_TRIGGERED_BY.USER,
            userId,
            oldData: existingDiscount,
            newData: updatedDiscount,
            changes,
            reason: 'Desconto atualizado',
          });
        }
      }

      const response = include ? await this.discountRepository.findById(id) : updatedDiscount;

      return {
        success: true,
        message: 'Desconto atualizado com sucesso',
        data: response!,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Error updating discount: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao atualizar desconto');
    }
  }

  async delete(id: string, userId?: string): Promise<DiscountDeleteResponse> {
    try {
      this.logger.log(`Deleting discount: ${id}`);

      const existingDiscount = await this.discountRepository.findById(id);

      if (!existingDiscount) {
        throw new NotFoundException('Desconto não encontrado');
      }

      await this.validateDeleteDiscount(existingDiscount);

      await this.discountRepository.delete(id);

      if (userId) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.DISCOUNT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          oldData: existingDiscount,
          reason: `Desconto excluído: ${existingDiscount.reference}`,
        });
      }

      return {
        success: true,
        message: 'Desconto excluído com sucesso',
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Error deleting discount: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao excluir desconto');
    }
  }

  // Batch Operations
  async batchCreate(
    data: DiscountBatchCreateFormData,
    include?: DiscountInclude,
    userId?: string,
  ): Promise<DiscountBatchCreateResponse<DiscountCreateFormData>> {
    try {
      this.logger.log(`Batch creating ${data.discounts.length} discounts`);

      const success: Discount[] = [];
      const failed: Array<{ index: number; id?: string; error: string; data: DiscountCreateFormData }> = [];

      for (let i = 0; i < data.discounts.length; i++) {
        try {
          const discount = await this.create(data.discounts[i], include, userId);
          success.push(discount.data);
        } catch (error) {
          failed.push({
            index: i,
            error: error.message,
            data: data.discounts[i],
          });
        }
      }

      return {
        success: failed.length === 0,
        message: `Operação concluída: ${success.length} criados, ${failed.length} falharam`,
        data: {
          success,
          failed,
          totalProcessed: data.discounts.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error) {
      this.logger.error(`Error in batch create discounts: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro na criação em lote de descontos');
    }
  }

  async batchUpdate(
    data: DiscountBatchUpdateFormData,
    include?: DiscountInclude,
    userId?: string,
  ): Promise<DiscountBatchUpdateResponse<DiscountUpdateFormData>> {
    try {
      this.logger.log(`Batch updating ${data.discounts.length} discounts`);

      const success: Discount[] = [];
      const failed: Array<{ index: number; id?: string; error: string; data: DiscountUpdateFormData }> = [];

      for (let i = 0; i < data.discounts.length; i++) {
        const update = data.discounts[i];
        try {
          const discount = await this.update(update.id, update.data, include, userId);
          success.push(discount.data);
        } catch (error) {
          failed.push({
            index: i,
            id: update.id,
            error: error.message,
            data: update.data,
          });
        }
      }

      return {
        success: failed.length === 0,
        message: `Operação concluída: ${success.length} atualizados, ${failed.length} falharam`,
        data: {
          success,
          failed,
          totalProcessed: data.discounts.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error) {
      this.logger.error(`Error in batch update discounts: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro na atualização em lote de descontos');
    }
  }

  async batchDelete(
    data: DiscountBatchDeleteFormData,
    userId?: string,
  ): Promise<DiscountBatchDeleteResponse> {
    try {
      this.logger.log(`Batch deleting ${data.discountIds.length} discounts`);

      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      for (let i = 0; i < data.discountIds.length; i++) {
        const id = data.discountIds[i];
        try {
          await this.delete(id, userId);
          success.push({ id, deleted: true });
        } catch (error) {
          failed.push({
            index: i,
            id,
            error: error.message,
            data: { id },
          });
        }
      }

      return {
        success: failed.length === 0,
        message: `Operação concluída: ${success.length} excluídos, ${failed.length} falharam`,
        data: {
          success,
          failed,
          totalProcessed: data.discountIds.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error) {
      this.logger.error(`Error in batch delete discounts: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro na exclusão em lote de descontos');
    }
  }

  // Special discount operations
  async findByPayroll(payrollId: string, include?: DiscountInclude): Promise<Discount[]> {
    try {
      this.logger.log(`Finding discounts for payroll: ${payrollId}`);

      const discounts = await this.discountRepository.findByPayroll(payrollId);

      return discounts;
    } catch (error) {
      this.logger.error(`Error finding discounts by payroll: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar descontos da folha de pagamento');
    }
  }

  async updateDiscountOrder(
    payrollId: string,
    updates: { id: string; calculationOrder: number }[],
    userId?: string,
  ): Promise<Discount[]> {
    try {
      this.logger.log(`Updating discount order for payroll: ${payrollId}`);

      return await this.prisma.$transaction(async (tx) => {
        const updatedDiscounts = await this.discountRepository.updateOrder(payrollId, updates, tx);

        if (userId) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAYROLL,
            entityId: payrollId,
            action: CHANGE_ACTION.UPDATE,
            triggeredBy: CHANGE_TRIGGERED_BY.USER,
            userId,
            reason: 'Ordem dos descontos alterada',
          });
        }

        return updatedDiscounts;
      });
    } catch (error) {
      this.logger.error(`Error updating discount order: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao alterar ordem dos descontos');
    }
  }

  // Validation methods
  private async validateCreateDiscount(data: DiscountCreateFormData): Promise<void> {
    // Validate that either percentage or value is provided, but not both
    if (data.percentage && data.value) {
      throw new BadRequestException(
        'Desconto deve ter apenas percentual OU valor fixo, não ambos',
      );
    }

    if (!data.percentage && !data.value) {
      throw new BadRequestException(
        'Desconto deve ter percentual OU valor fixo',
      );
    }

    // Validate percentage range
    if (data.percentage && (data.percentage < 0 || data.percentage > 100)) {
      throw new BadRequestException('Percentual deve estar entre 0 e 100');
    }

    // Validate fixed value
    if (data.value && data.value < 0) {
      throw new BadRequestException('Valor fixo não pode ser negativo');
    }

    // Validate discount order
    if (data.calculationOrder && data.calculationOrder < 1) {
      throw new BadRequestException('Ordem do desconto deve ser maior que 0');
    }
  }

  private async validateUpdateDiscount(id: string, data: DiscountUpdateFormData): Promise<void> {
    // Same validations as create, but only for fields being updated
    if (data.percentage !== undefined && data.value !== undefined) {
      const existingDiscount = await this.discountRepository.findById(id);
      if (!existingDiscount) return;

      const newPercentage = data.percentage ?? existingDiscount.percentage;
      const newFixedValue = data.value ?? existingDiscount.value;

      if (newPercentage && newFixedValue) {
        throw new BadRequestException(
          'Desconto deve ter apenas percentual OU valor fixo, não ambos',
        );
      }

      if (!newPercentage && !newFixedValue) {
        throw new BadRequestException(
          'Desconto deve ter percentual OU valor fixo',
        );
      }
    }

    if (data.percentage !== undefined && (data.percentage < 0 || data.percentage > 100)) {
      throw new BadRequestException('Percentual deve estar entre 0 e 100');
    }

    if (data.value !== undefined && data.value < 0) {
      throw new BadRequestException('Valor fixo não pode ser negativo');
    }

    if (data.calculationOrder !== undefined && data.calculationOrder < 1) {
      throw new BadRequestException('Ordem do desconto deve ser maior que 0');
    }
  }

  private async validateDeleteDiscount(discount: Discount): Promise<void> {
    // Discount validation logic can be added here if needed
    // Currently no validation required for discount deletion
  }
}