// api/src/modules/production/task-pricing/task-pricing.service.ts

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskPricingRepository } from './repositories/task-pricing.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import type {
  TaskPricingCreateFormData,
  TaskPricingUpdateFormData,
  TaskPricingGetManyFormData,
} from '@schemas/task-pricing';
import type {
  TaskPricingGetManyResponse,
  TaskPricingGetUniqueResponse,
  TaskPricingCreateResponse,
  TaskPricingUpdateResponse,
  TaskPricingDeleteResponse,
  TaskPricingBatchCreateResponse,
  TaskPricingBatchUpdateResponse,
  TaskPricingBatchDeleteResponse,
  TaskPricing,
} from '@types';
import { TASK_PRICING_STATUS, CHANGE_LOG_ENTITY_TYPE, CHANGE_LOG_ACTION, DISCOUNT_TYPE } from '@constants';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { CHANGE_TRIGGERED_BY } from '@constants';

/**
 * Calculate discount amount based on discount type and value
 */
function calculateDiscountAmount(
  subtotal: number,
  discountType: string,
  discountValue?: number,
): number {
  if (!discountValue || discountType === DISCOUNT_TYPE.NONE) {
    return 0;
  }

  if (discountType === DISCOUNT_TYPE.PERCENTAGE) {
    return Math.round((subtotal * discountValue) / 100 * 100) / 100; // Round to 2 decimal places
  }

  if (discountType === DISCOUNT_TYPE.FIXED_VALUE) {
    return discountValue;
  }

  return 0;
}

/**
 * Calculate total from subtotal and discount
 */
function calculateTotal(
  subtotal: number,
  discountType: string,
  discountValue?: number,
): number {
  const discountAmount = calculateDiscountAmount(subtotal, discountType, discountValue);
  return Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100); // Ensure non-negative and round to 2 decimals
}

/**
 * Service for managing TaskPricing entities
 * Handles CRUD operations, status management, and business logic
 */
@Injectable()
export class TaskPricingService {
  private readonly logger = new Logger(TaskPricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskPricingRepository: TaskPricingRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Find many pricings with filtering, pagination, and sorting
   */
  async findMany(query: TaskPricingGetManyFormData): Promise<TaskPricingGetManyResponse> {
    try {
      const result = await this.taskPricingRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Orçamentos carregados com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error finding task pricings:', error);
      throw new InternalServerErrorException('Erro ao carregar orçamentos.');
    }
  }

  /**
   * Find unique pricing by ID
   */
  async findUnique(
    id: string,
    include?: any,
  ): Promise<TaskPricingGetUniqueResponse> {
    try {
      const pricing = await this.taskPricingRepository.findById(id, include);

      if (!pricing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      return {
        success: true,
        data: pricing,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding task pricing ${id}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Find pricing by task ID
   */
  async findByTaskId(taskId: string): Promise<TaskPricingGetUniqueResponse> {
    try {
      const pricing = await this.taskPricingRepository.findByTaskId(taskId);

      if (!pricing) {
        throw new NotFoundException(`Orçamento para tarefa ${taskId} não encontrado.`);
      }

      return {
        success: true,
        data: pricing,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding pricing for task ${taskId}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Create new pricing
   */
  async create(
    data: TaskPricingCreateFormData,
    userId: string,
  ): Promise<TaskPricingCreateResponse> {
    try {
      // Validate task exists
      const task = await this.prisma.task.findUnique({
        where: { id: data.taskId }
      });

      if (!task) {
        throw new BadRequestException('Tarefa não encontrada.');
      }

      // Check if task already has pricing
      const existingPricing = await this.taskPricingRepository.findByTaskId(data.taskId);
      if (existingPricing) {
        throw new BadRequestException('Esta tarefa já possui um orçamento.');
      }

      // Validate items exist
      if (!data.items || data.items.length === 0) {
        throw new BadRequestException('Pelo menos um item é obrigatório.');
      }

      // Validate subtotal matches items sum
      const itemsTotal = data.items.reduce((sum, item) => sum + item.amount, 0);
      if (Math.abs(data.subtotal - itemsTotal) > 0.01) {
        throw new BadRequestException(
          'O subtotal deve ser igual à soma dos itens do orçamento.',
        );
      }

      // Calculate and validate total with discount
      const discountType = data.discountType || DISCOUNT_TYPE.NONE;
      const calculatedTotal = calculateTotal(data.subtotal, discountType, data.discountValue);
      if (Math.abs(data.total - calculatedTotal) > 0.01) {
        throw new BadRequestException(
          `O total calculado (${calculatedTotal.toFixed(2)}) não corresponde ao total fornecido (${data.total.toFixed(2)}).`,
        );
      }

      // Create pricing with items in transaction
      const pricing = await this.prisma.$transaction(async tx => {
        const newPricing = await tx.taskPricing.create({
          data: {
            subtotal: data.subtotal,
            discountType: discountType,
            discountValue: data.discountValue || null,
            total: data.total,
            expiresAt: data.expiresAt,
            status: data.status || TASK_PRICING_STATUS.DRAFT,
            taskId: data.taskId,
            // Payment Terms (simplified)
            paymentCondition: data.paymentCondition || null,
            downPaymentDate: data.downPaymentDate || null,
            customPaymentText: data.customPaymentText || null,
            // Guarantee Terms
            guaranteeYears: data.guaranteeYears || null,
            customGuaranteeText: data.customGuaranteeText || null,
            // Layout File
            layoutFileId: data.layoutFileId || null,
            items: {
              create: data.items.map(item => ({
                amount: item.amount || 0,
                description: item.description || '',
              })),
            },
          },
          include: { items: true, task: true, layoutFile: true },
        });

        // Log change
        await this.changeLogService.logChange({
          entityType: CHANGE_LOG_ENTITY_TYPE.TASK as any,
          entityId: newPricing.id,
          action: CHANGE_LOG_ACTION.CREATE as any,
          userId,
          reason: 'Criação de orçamento',
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          transaction: tx,
        });

        return newPricing;
      });

      return {
        success: true,
        data: pricing as any,
        message: 'Orçamento criado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error creating task pricing:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Erro ao criar orçamento.');
    }
  }

  /**
   * Update existing pricing
   */
  async update(
    id: string,
    data: TaskPricingUpdateFormData,
    userId: string,
  ): Promise<TaskPricingUpdateResponse> {
    try {
      const existing = await this.taskPricingRepository.findById(id, { include: { items: true } });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Determine current or new values
      const subtotal = data.subtotal !== undefined ? data.subtotal : existing.subtotal;
      const discountType = data.discountType !== undefined ? data.discountType : existing.discountType;
      const discountValue = data.discountValue !== undefined ? data.discountValue : existing.discountValue;

      // Validate items if provided (check against subtotal)
      if (data.items && data.items.length > 0) {
        const itemsTotal = data.items.reduce((sum, item) => sum + item.amount, 0);
        const targetSubtotal = data.subtotal !== undefined ? data.subtotal : existing.subtotal;
        if (Math.abs(targetSubtotal - itemsTotal) > 0.01) {
          throw new BadRequestException(
            'O subtotal deve ser igual à soma dos itens do orçamento.',
          );
        }
      }

      // Validate total with discount if total is being updated
      if (data.total !== undefined) {
        const calculatedTotal = calculateTotal(subtotal, discountType, discountValue || undefined);
        if (Math.abs(data.total - calculatedTotal) > 0.01) {
          throw new BadRequestException(
            `O total calculado (${calculatedTotal.toFixed(2)}) não corresponde ao total fornecido (${data.total.toFixed(2)}).`,
          );
        }
      }

      // Update pricing with items in transaction
      const updated = await this.prisma.$transaction(async tx => {
        const updatedPricing = await tx.taskPricing.update({
          where: { id },
          data: {
            ...(data.subtotal !== undefined && { subtotal: data.subtotal }),
            ...(data.discountType !== undefined && { discountType: data.discountType }),
            ...(data.discountValue !== undefined && { discountValue: data.discountValue }),
            ...(data.total !== undefined && { total: data.total }),
            ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt }),
            ...(data.status !== undefined && { status: data.status }),
            // Payment Terms (simplified)
            ...(data.paymentCondition !== undefined && { paymentCondition: data.paymentCondition }),
            ...(data.downPaymentDate !== undefined && { downPaymentDate: data.downPaymentDate }),
            ...(data.customPaymentText !== undefined && { customPaymentText: data.customPaymentText }),
            // Guarantee Terms
            ...(data.guaranteeYears !== undefined && { guaranteeYears: data.guaranteeYears }),
            ...(data.customGuaranteeText !== undefined && { customGuaranteeText: data.customGuaranteeText }),
            // Layout File
            ...(data.layoutFileId !== undefined && { layoutFileId: data.layoutFileId }),
            ...(data.items && {
              items: {
                deleteMany: {},
                create: data.items.map(item => ({
                  amount: item.amount || 0,
                  description: item.description || '',
                })),
              },
            }),
          },
          include: { items: true, task: true, layoutFile: true },
        });

        // Log change
        await this.changeLogService.logChange({
          entityType: CHANGE_LOG_ENTITY_TYPE.TASK as any,
          entityId: id,
          action: CHANGE_LOG_ACTION.UPDATE as any,
          userId,
          reason: 'Atualização de orçamento',
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          transaction: tx,
        });

        return updatedPricing;
      });

      return {
        success: true,
        data: updated as any,
        message: 'Orçamento atualizado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating task pricing ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar orçamento.');
    }
  }

  /**
   * Delete pricing
   */
  async delete(
    id: string,
    userId: string,
  ): Promise<TaskPricingDeleteResponse> {
    try {
      const existing = await this.taskPricingRepository.findById(id);

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      await this.prisma.$transaction(async tx => {
        await tx.taskPricing.delete({ where: { id } });

        // Log change
        await this.changeLogService.logChange({
          entityType: CHANGE_LOG_ENTITY_TYPE.TASK as any,
          entityId: id,
          action: CHANGE_LOG_ACTION.DELETE as any,
          userId,
          reason: 'Exclusão de orçamento',
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Orçamento deletado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error deleting task pricing ${id}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Erro ao deletar orçamento.');
    }
  }

  /**
   * Update pricing status (approve/reject/cancel)
   */
  async updateStatus(
    id: string,
    status: TASK_PRICING_STATUS,
    userId: string,
    rejectionReason?: string,
  ): Promise<TaskPricingUpdateResponse> {
    try {
      const existing = await this.taskPricingRepository.findById(id);

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Validate status transition
      this.validateStatusTransition(existing.status as TASK_PRICING_STATUS, status);

      // Update status
      const updated = await this.update(
        id,
        { status },
        userId,
      );

      return {
        success: true,
        data: updated.data,
        message: `Orçamento ${this.getStatusLabel(status)} com sucesso.`,
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating pricing status ${id}:`, error);
      throw error;
    }
  }

  /**
   * Approve pricing (change status to APPROVED)
   */
  async approve(
    id: string,
    userId: string,
  ): Promise<TaskPricingUpdateResponse> {
    return this.updateStatus(id, TASK_PRICING_STATUS.APPROVED, userId);
  }

  /**
   * Reject pricing (change status to REJECTED)
   */
  async reject(
    id: string,
    userId: string,
    reason?: string,
  ): Promise<TaskPricingUpdateResponse> {
    return this.updateStatus(id, TASK_PRICING_STATUS.REJECTED, userId, reason);
  }

  /**
   * Cancel pricing (change status to CANCELLED)
   */
  async cancel(
    id: string,
    userId: string,
  ): Promise<TaskPricingUpdateResponse> {
    return this.updateStatus(id, TASK_PRICING_STATUS.CANCELLED, userId);
  }

  /**
   * Get approved price for a task
   */
  async getApprovedPriceForTask(taskId: string): Promise<number> {
    const pricing = await this.taskPricingRepository.findApprovedByTaskId(taskId);
    return pricing?.total || 0;
  }

  /**
   * Find expired pricings and optionally mark them
   */
  async findAndMarkExpired(): Promise<TaskPricing[]> {
    try {
      const expired = await this.taskPricingRepository.findExpired();

      this.logger.log(`Found ${expired.length} expired pricings`);

      return expired;
    } catch (error: unknown) {
      this.logger.error('Error finding expired pricings:', error);
      throw new InternalServerErrorException('Erro ao buscar orçamentos expirados.');
    }
  }

  /**
   * Validate status transition
   * @private
   */
  private validateStatusTransition(
    currentStatus: TASK_PRICING_STATUS,
    newStatus: TASK_PRICING_STATUS,
  ): void {
    // Allow any transition from DRAFT
    if (currentStatus === TASK_PRICING_STATUS.DRAFT) {
      return;
    }

    // Allow APPROVED → CANCELLED
    if (
      currentStatus === TASK_PRICING_STATUS.APPROVED &&
      newStatus === TASK_PRICING_STATUS.CANCELLED
    ) {
      return;
    }

    // Allow REJECTED → DRAFT (for revision)
    if (
      currentStatus === TASK_PRICING_STATUS.REJECTED &&
      newStatus === TASK_PRICING_STATUS.DRAFT
    ) {
      return;
    }

    // Disallow other transitions
    throw new BadRequestException(
      `Transição de status inválida: ${currentStatus} → ${newStatus}`,
    );
  }

  /**
   * Get Portuguese label for status
   * @private
   */
  private getStatusLabel(status: TASK_PRICING_STATUS): string {
    const labels = {
      [TASK_PRICING_STATUS.DRAFT]: 'salvo como rascunho',
      [TASK_PRICING_STATUS.APPROVED]: 'aprovado',
      [TASK_PRICING_STATUS.REJECTED]: 'rejeitado',
      [TASK_PRICING_STATUS.CANCELLED]: 'cancelado',
    };

    return labels[status] || 'atualizado';
  }
}
