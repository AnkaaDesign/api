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
import { PersistentDiscountService } from './services/persistent-discount.service';
import { roundCurrency } from '@utils/currency-precision.util';
import { LoanKind, PayrollDiscountType } from '@prisma/client';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  CONTRACT_STATUS,
  PAYROLL_EMPLOYEE_TYPES,
} from '../../../constants';
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
  LoanMasterCreateFormData,
} from '../../../schemas/discount';

@Injectable()
export class DiscountService {
  private readonly logger = new Logger(DiscountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discountRepository: DiscountRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly persistentDiscountService: PersistentDiscountService,
  ) {}

  /**
   * ========================================================================
   * REGISTER EMPLOYEE-ANCHORED MASTER LOAN
   * ========================================================================
   * Cria um empréstimo/adiantamento ancorado no colaborador (PayrollDiscount
   * com payrollId=null). Ele é materializado automaticamente em cada folha
   * futura pela geração da folha — sem fluxo manual por competência.
   *
   * Valida que o colaborador é elegível à folha (CLT, não desligado).
   */
  async createLoanMaster(
    data: LoanMasterCreateFormData,
    userId?: string,
  ): Promise<DiscountCreateResponse> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
        select: {
          id: true,
          currentContractStatus: true,
          currentEmployeeType: true,
        },
      });

      if (!user) {
        throw new NotFoundException('Colaborador não encontrado');
      }
      if (user.currentContractStatus === CONTRACT_STATUS.TERMINATED) {
        throw new BadRequestException('Colaborador desligado — não é possível registrar empréstimo');
      }
      if (!PAYROLL_EMPLOYEE_TYPES.includes(user.currentEmployeeType as any)) {
        throw new BadRequestException('Colaborador não pertence à folha de pagamento (CLT)');
      }

      const master = await this.persistentDiscountService.createMasterLoan({
        userId: data.userId,
        value: data.value,
        totalInstallments: data.totalInstallments,
        startCompetence: data.startCompetence,
        discountType:
          data.discountType === 'ADVANCE'
            ? PayrollDiscountType.ADVANCE
            : PayrollDiscountType.LOAN,
        loanKind:
          data.loanKind === 'PAYROLL_CONSIGNED'
            ? LoanKind.PAYROLL_CONSIGNED
            : LoanKind.COMPANY,
        lenderName: data.lenderName,
        description: data.description,
      });

      if (userId) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.DISCOUNT,
          entityId: master.id,
          action: CHANGE_ACTION.CREATE,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          userId,
          newData: master,
          reason: `Empréstimo registrado para colaborador (${data.totalInstallments}x)`,
        });
      }

      const response = await this.discountRepository.findById(master.id);

      return {
        success: true,
        message: 'Empréstimo registrado com sucesso',
        data: response!,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error creating master loan: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao registrar empréstimo');
    }
  }

  /**
   * Recalcula totalDiscounts/netSalary da folha a partir das linhas de
   * desconto persistidas. Necessário porque o CRUD de descontos roda APÓS a
   * geração da folha (ex.: registrar um empréstimo consignado pela tela de
   * detalhe) — sem isso os totais salvos ficam defasados em relação às linhas.
   *
   * Regras (espelham CompletePayrollCalculatorService):
   * - Apenas linhas ativas (isActive) contam;
   * - FGTS é contribuição do EMPREGADOR — nunca entra em totalDiscounts;
   * - Linhas percentuais sem valor materializado incidem sobre o salário
   *   bruto da folha (ex.: pensão alimentícia 30% do bruto);
   * - netSalary = grossSalary − totalDiscounts.
   *
   * Nunca lança: uma falha aqui não pode derrubar o CRUD do desconto — mas o
   * erro é logado para investigação.
   */
  async recalculatePayrollTotals(payrollId: string): Promise<void> {
    try {
      const payroll = await this.prisma.payroll.findUnique({
        where: { id: payrollId },
        include: { discounts: true },
      });

      if (!payroll || payroll.grossSalary === null || payroll.grossSalary === undefined) {
        return;
      }

      const grossSalary = Number(payroll.grossSalary);

      let totalDiscounts = 0;
      for (const discount of payroll.discounts) {
        if (!discount.isActive) continue;
        if (discount.discountType === 'FGTS') continue; // employer-side, never deducted

        const value = discount.value !== null && discount.value !== undefined
          ? Number(discount.value)
          : null;
        const percentage = discount.percentage !== null && discount.percentage !== undefined
          ? Number(discount.percentage)
          : null;

        if (value !== null && value > 0) {
          totalDiscounts += value;
        } else if (percentage !== null && percentage > 0) {
          totalDiscounts += (grossSalary * percentage) / 100;
        }
      }

      totalDiscounts = roundCurrency(totalDiscounts);
      const netSalary = roundCurrency(grossSalary - totalDiscounts);

      await this.prisma.payroll.update({
        where: { id: payrollId },
        data: { totalDiscounts, netSalary },
      });

      this.logger.log(
        `Recalculated payroll ${payrollId} totals after discount change: totalDiscounts=${totalDiscounts.toFixed(2)}, netSalary=${netSalary.toFixed(2)}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to recalculate payroll totals for ${payrollId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

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

      // Keep the saved payroll's totalDiscounts/netSalary in sync with its rows
      if (discount.payrollId) {
        await this.recalculatePayrollTotals(discount.payrollId);
      }

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

      // Keep the saved payroll's totalDiscounts/netSalary in sync with its rows
      // (covers value/percentage edits and isActive toggles; also handles a
      // hypothetical payroll move by recalculating both sides)
      if (existingDiscount.payrollId) {
        await this.recalculatePayrollTotals(existingDiscount.payrollId);
      }
      if (updatedDiscount.payrollId && updatedDiscount.payrollId !== existingDiscount.payrollId) {
        await this.recalculatePayrollTotals(updatedDiscount.payrollId);
      }

      if (userId) {
        const changes = trackFieldChanges(existingDiscount, updatedDiscount, [
          'reference',
          'percentage',
          'value',
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

      // Keep the saved payroll's totalDiscounts/netSalary in sync with its rows
      if (existingDiscount.payrollId) {
        await this.recalculatePayrollTotals(existingDiscount.payrollId);
      }

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
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: DiscountCreateFormData;
      }> = [];

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
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: DiscountUpdateFormData;
      }> = [];

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

  // Validation methods
  private async validateCreateDiscount(data: DiscountCreateFormData): Promise<void> {
    // Validate that either percentage or value is provided, but not both
    if (data.percentage && data.value) {
      throw new BadRequestException('Desconto deve ter apenas percentual OU valor fixo, não ambos');
    }

    if (!data.percentage && !data.value) {
      throw new BadRequestException('Desconto deve ter percentual OU valor fixo');
    }

    // Validate percentage range
    if (data.percentage && (data.percentage < 0 || data.percentage > 100)) {
      throw new BadRequestException('Percentual deve estar entre 0 e 100');
    }

    // Validate fixed value
    if (data.value && data.value < 0) {
      throw new BadRequestException('Valor fixo não pode ser negativo');
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
        throw new BadRequestException('Desconto deve ter percentual OU valor fixo');
      }
    }

    if (data.percentage !== undefined && (data.percentage < 0 || data.percentage > 100)) {
      throw new BadRequestException('Percentual deve estar entre 0 e 100');
    }

    if (data.value !== undefined && data.value < 0) {
      throw new BadRequestException('Valor fixo não pode ser negativo');
    }
  }

  private async validateDeleteDiscount(discount: Discount): Promise<void> {
    // Discount validation logic can be added here if needed
    // Currently no validation required for discount deletion
  }
}
