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
import {
  TASK_PRICING_STATUS,
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_LOG_ACTION,
  DISCOUNT_TYPE,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '@constants';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { CHANGE_TRIGGERED_BY } from '@constants';
import { logPricingItemChanges } from '@modules/common/changelog/utils/pricing-item-changelog';
import { serializeChangelogValue } from '@modules/common/changelog/utils/serialize-changelog-value';

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
    return Math.round(((subtotal * discountValue) / 100) * 100) / 100; // Round to 2 decimal places
  }

  if (discountType === DISCOUNT_TYPE.FIXED_VALUE) {
    return discountValue;
  }

  return 0;
}

/**
 * Calculate total from subtotal and discount
 */
function calculateTotal(subtotal: number, discountType: string, discountValue?: number): number {
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
  async findUnique(id: string, include?: any): Promise<TaskPricingGetUniqueResponse> {
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

      // Return null data when no pricing exists (not an error - task may not have pricing yet)
      if (!pricing) {
        return {
          success: true,
          data: null,
          message: 'Nenhum orçamento encontrado para esta tarefa.',
        };
      }

      return {
        success: true,
        data: pricing,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding pricing for task ${taskId}:`, error);
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
        where: { id: data.taskId },
      });

      if (!task) {
        throw new BadRequestException('Tarefa não encontrada.');
      }

      // Validate invoicesToCustomerIds if provided
      if (data.invoicesToCustomerIds && data.invoicesToCustomerIds.length > 0) {
        const customers = await this.prisma.customer.findMany({
          where: { id: { in: data.invoicesToCustomerIds } },
          select: { id: true },
        });

        if (customers.length !== data.invoicesToCustomerIds.length) {
          throw new BadRequestException(
            'Um ou mais clientes selecionados para faturamento não foram encontrados.',
          );
        }
      }

      // NOTE: Each task has its own independent pricing record.
      // When copying pricing (e.g. via copyFromTask), a new TaskPricing is created as a deep copy.

      // Validate items exist
      if (!data.items || data.items.length === 0) {
        throw new BadRequestException('Pelo menos um item é obrigatório.');
      }

      // Validate subtotal matches items sum
      const itemsTotal = data.items.reduce((sum, item) => sum + item.amount, 0);
      if (Math.abs(data.subtotal - itemsTotal) > 0.01) {
        throw new BadRequestException('O subtotal deve ser igual à soma dos itens do orçamento.');
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
        // Get next budget number (auto-increment)
        const maxBudgetNumber = await tx.taskPricing.aggregate({
          _max: { budgetNumber: true },
        });
        const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

        const newPricing = await tx.taskPricing.create({
          data: {
            budgetNumber: nextBudgetNumber,
            subtotal: data.subtotal,
            discountType: discountType,
            discountValue: data.discountValue || null,
            total: data.total,
            expiresAt: data.expiresAt,
            status: data.status || TASK_PRICING_STATUS.DRAFT,
            // Payment Terms (simplified)
            paymentCondition: data.paymentCondition || null,
            downPaymentDate: data.downPaymentDate || null,
            customPaymentText: data.customPaymentText || null,
            // Guarantee Terms
            guaranteeYears: data.guaranteeYears || null,
            customGuaranteeText: data.customGuaranteeText || null,
            // Layout File
            ...(data.layoutFileId && {
              layoutFile: { connect: { id: data.layoutFileId } },
            }),
            // New fields
            simultaneousTasks: data.simultaneousTasks || null,
            discountReference: data.discountReference || null,
            // Invoice To Customers (many-to-many relationship)
            ...(data.invoicesToCustomerIds &&
              data.invoicesToCustomerIds.length > 0 && {
                invoicesToCustomers: {
                  connect: data.invoicesToCustomerIds.map(customerId => ({ id: customerId })),
                },
              }),
            items: {
              create: data.items.map((item, index) => ({
                amount: item.amount || 0,
                description: item.description || '',
                observation: item.observation || null,
                shouldSync: item.shouldSync !== undefined ? item.shouldSync : true,
                position: index,
              })),
            },
          },
          include: {
            items: { orderBy: { position: 'asc' } },
            task: true,
            layoutFile: true,
            invoicesToCustomers: true,
          },
        });

        // Connect the task to this pricing (one-to-one via Task.pricingId FK)
        await tx.task.update({
          where: { id: data.taskId },
          data: { pricingId: newPricing.id },
        });

        // Log change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_PRICING,
          entityId: newPricing.id,
          action: CHANGE_ACTION.CREATE,
          userId,
          reason: 'Criação de orçamento',
          newValue: serializeChangelogValue({
            id: newPricing.id,
            budgetNumber: nextBudgetNumber,
            subtotal: data.subtotal,
            total: data.total,
            status: data.status || TASK_PRICING_STATUS.DRAFT,
            items: data.items.map(item => ({
              description: item.description,
              amount: item.amount,
              observation: item.observation || null,
            })),
          }),
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
      const existing = await this.taskPricingRepository.findById(id, {
        include: {
          items: { orderBy: { position: 'asc' } },
          invoicesToCustomers: true,
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Validate invoicesToCustomerIds if provided
      if (data.invoicesToCustomerIds && data.invoicesToCustomerIds.length > 0) {
        const customers = await this.prisma.customer.findMany({
          where: { id: { in: data.invoicesToCustomerIds } },
          select: { id: true },
        });

        if (customers.length !== data.invoicesToCustomerIds.length) {
          throw new BadRequestException(
            'Um ou mais clientes selecionados para faturamento não foram encontrados.',
          );
        }
      }

      // Determine current or new values
      const subtotal = data.subtotal !== undefined ? data.subtotal : existing.subtotal;
      const discountType =
        data.discountType !== undefined ? data.discountType : existing.discountType;
      const discountValue =
        data.discountValue !== undefined ? data.discountValue : existing.discountValue;

      // Validate items if provided (check against subtotal)
      if (data.items && data.items.length > 0) {
        const itemsTotal = data.items.reduce((sum, item) => sum + item.amount, 0);
        const targetSubtotal = data.subtotal !== undefined ? data.subtotal : existing.subtotal;
        if (Math.abs(targetSubtotal - itemsTotal) > 0.01) {
          throw new BadRequestException('O subtotal deve ser igual à soma dos itens do orçamento.');
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
            ...(data.customPaymentText !== undefined && {
              customPaymentText: data.customPaymentText,
            }),
            // Guarantee Terms
            ...(data.guaranteeYears !== undefined && { guaranteeYears: data.guaranteeYears }),
            ...(data.customGuaranteeText !== undefined && {
              customGuaranteeText: data.customGuaranteeText,
            }),
            // Layout File
            ...(data.layoutFileId !== undefined && {
              layoutFile: data.layoutFileId
                ? { connect: { id: data.layoutFileId } }
                : { disconnect: true },
            }),
            // New fields
            ...(data.simultaneousTasks !== undefined && {
              simultaneousTasks: data.simultaneousTasks,
            }),
            ...(data.discountReference !== undefined && { discountReference: data.discountReference }),
            // Invoice To Customers (many-to-many relationship - disconnect all + connect new)
            ...(data.invoicesToCustomerIds !== undefined && {
              invoicesToCustomers: {
                set: data.invoicesToCustomerIds.map(customerId => ({ id: customerId })),
              },
            }),
            ...(data.items && {
              items: {
                deleteMany: {},
                create: data.items.map((item, index) => ({
                  amount: item.amount || 0,
                  description: item.description || '',
                  observation: item.observation || null,
                  shouldSync: item.shouldSync !== undefined ? item.shouldSync : true,
                  position: index,
                })),
              },
            }),
          },
          include: {
            items: { orderBy: { position: 'asc' } },
            task: true,
            layoutFile: true,
            invoicesToCustomers: true,
          },
        });

        // Track individual field changes
        const { trackAndLogFieldChanges } = await import(
          '@modules/common/changelog/utils/changelog-helpers'
        );

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK_PRICING,
          entityId: id,
          oldEntity: existing,
          newEntity: updatedPricing,
          fieldsToTrack: [
            'subtotal',
            'discountType',
            'discountValue',
            'total',
            'expiresAt',
            'status',
            'paymentCondition',
            'downPaymentDate',
            'customPaymentText',
            'guaranteeYears',
            'customGuaranteeText',
            'layoutFileId',
            'customerSignatureId',
            'customForecastDays',
            'budgetNumber',
            'simultaneousTasks',
            'discountReference',
          ],
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
          transaction: tx,
        });

        // Special handling for invoicesToCustomers many-to-many changes
        if (data.invoicesToCustomerIds !== undefined) {
          const oldCustomers = (existing as any).invoicesToCustomers || [];
          const oldCustomerIds = oldCustomers.map((customer: any) => customer.id);
          const newCustomerIds = data.invoicesToCustomerIds;

          // Check if the arrays are different
          const oldSet = new Set(oldCustomerIds);
          const newSet = new Set(newCustomerIds);
          const hasChanged =
            oldSet.size !== newSet.size ||
            ![...oldSet].every((id: string) => newSet.has(id));

          if (hasChanged) {
            // Build readable values for changelog display
            const oldNames = oldCustomers
              .map((c: any) => c.fantasyName || c.corporateName || c.id)
              .join(', ') || 'Nenhum';
            const newCustomerData = (updatedPricing as any).invoicesToCustomers || [];
            const newNames = newCustomerData
              .map((c: any) => c.fantasyName || c.corporateName || c.id)
              .join(', ') || 'Nenhum';

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_PRICING,
              entityId: id,
              action: CHANGE_LOG_ACTION.UPDATE as any,
              field: 'invoicesToCustomerIds',
              oldValue: oldNames,
              newValue: newNames,
              userId: userId || '',
              reason: 'Atualização de clientes para faturamento',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }
        }

        // Track pricing items changes (per-item granular tracking)
        if (data.items !== undefined) {
          const oldItems = (existing as any).items || [];
          const newItems = (updatedPricing as any).items || [];

          // Log per-item changes (added, removed, field updates)
          await logPricingItemChanges({
            changeLogService: this.changeLogService,
            pricingId: id,
            oldItems,
            newItems,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          // Also keep a bulk snapshot for backward compatibility (field: 'items_snapshot')
          const formatItem = (item: any) =>
            `${item.description || ''}: R$ ${Number(item.amount || 0).toFixed(2)}`;
          const oldItemsSummary = oldItems.map(formatItem).sort();
          const newItemsSummary = newItems.map(formatItem).sort();
          const itemsChanged =
            oldItemsSummary.length !== newItemsSummary.length ||
            oldItemsSummary.some((s: string, i: number) => s !== newItemsSummary[i]);

          if (itemsChanged) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_PRICING,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'items_snapshot',
              oldValue: serializeChangelogValue({
                count: oldItems.length,
                items: oldItems.map((item: any) => ({
                  description: item.description,
                  amount: Number(item.amount),
                  observation: item.observation,
                })),
              }),
              newValue: serializeChangelogValue({
                count: newItems.length,
                items: newItems.map((item: any) => ({
                  description: item.description,
                  amount: Number(item.amount),
                  observation: item.observation,
                })),
              }),
              userId: userId || '',
              reason: 'Atualização dos itens do orçamento (snapshot)',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }

          // Fix R$ 0,00 snapshot: update pricingId changelog when real amounts are set
          const allOldAmountsZero = oldItems.every((item: any) => Number(item.amount) === 0);
          const anyNewAmountNonZero = newItems.some((item: any) => Number(item.amount) > 0);

          if (allOldAmountsZero && anyNewAmountNonZero) {
            const updatedWithTask = await tx.taskPricing.findUnique({
              where: { id },
              include: { task: { select: { id: true } }, items: { orderBy: { position: 'asc' } } },
            });

            const taskRef = updatedWithTask?.task;
            if (taskRef) {
              const pricingIdLog = await tx.changeLog.findFirst({
                where: { entityType: 'TASK', entityId: taskRef.id, field: 'pricingId' },
                orderBy: { createdAt: 'desc' },
              });
              if (pricingIdLog) {
                const realSnapshot = serializeChangelogValue({
                  id,
                  budgetNumber: (updatedWithTask as any).budgetNumber,
                  subtotal: (updatedWithTask as any).subtotal,
                  total: (updatedWithTask as any).total,
                  discountType: (updatedWithTask as any).discountType,
                  discountValue: (updatedWithTask as any).discountValue,
                  status: (updatedWithTask as any).status,
                  items: updatedWithTask!.items.map(item => ({
                    description: item.description,
                    amount: Number(item.amount),
                    observation: item.observation,
                  })),
                });
                await tx.changeLog.update({ where: { id: pricingIdLog.id }, data: { newValue: realSnapshot } });
              }
            }
          }
        }

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
  async delete(id: string, userId: string): Promise<TaskPricingDeleteResponse> {
    try {
      const existing = await this.prisma.taskPricing.findUnique({
        where: { id },
        include: {
          items: { orderBy: { position: 'asc' } },
          task: { select: { id: true } },
          invoicesToCustomers: { select: { id: true } },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Store the full pricing data for changelog (enables rollback restoration)
      const pricingSnapshot = {
        id: existing.id,
        budgetNumber: existing.budgetNumber,
        subtotal: existing.subtotal,
        total: existing.total,
        discountType: existing.discountType,
        discountValue: existing.discountValue,
        expiresAt: existing.expiresAt,
        status: existing.status,
        paymentCondition: existing.paymentCondition,
        downPaymentDate: existing.downPaymentDate,
        customPaymentText: existing.customPaymentText,
        guaranteeYears: existing.guaranteeYears,
        customGuaranteeText: existing.customGuaranteeText,
        customForecastDays: existing.customForecastDays,
        simultaneousTasks: existing.simultaneousTasks,
        discountReference: existing.discountReference,
        layoutFileId: existing.layoutFileId,
        customerSignatureId: existing.customerSignatureId,
        items: existing.items.map(item => ({
          description: item.description,
          amount: item.amount,
          observation: item.observation,
          shouldSync: item.shouldSync,
          position: item.position,
        })),
        invoicesToCustomerIds: existing.invoicesToCustomers.map(c => c.id),
      };

      const taskId = existing.task?.id;

      await this.prisma.$transaction(async tx => {
        // Nullify pricingId on the associated task before deleting
        if (taskId) {
          await tx.task.update({
            where: { id: taskId },
            data: { pricingId: null },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: taskId,
            action: CHANGE_ACTION.UPDATE,
            field: 'pricingId',
            oldValue: pricingSnapshot,
            newValue: null,
            userId,
            reason: 'Orçamento removido (exclusão do orçamento)',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            transaction: tx,
          });
        }

        await tx.taskPricing.delete({ where: { id } });

        // Log the pricing deletion itself
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_PRICING,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldValue: pricingSnapshot,
          userId,
          reason: 'Exclusão de orçamento',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
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
      const updated = await this.update(id, { status }, userId);

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
  async approve(id: string, userId: string): Promise<TaskPricingUpdateResponse> {
    return this.updateStatus(id, TASK_PRICING_STATUS.APPROVED, userId);
  }

  /**
   * Reject pricing (change status to REJECTED)
   */
  async reject(id: string, userId: string, reason?: string): Promise<TaskPricingUpdateResponse> {
    return this.updateStatus(id, TASK_PRICING_STATUS.REJECTED, userId, reason);
  }

  /**
   * Cancel pricing (change status to CANCELLED)
   */
  async cancel(id: string, userId: string): Promise<TaskPricingUpdateResponse> {
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

  // =====================
  // PUBLIC METHODS (No Authentication Required)
  // =====================

  /**
   * Find pricing for public view (customer budget page)
   * Only returns data if pricing is not expired
   */
  async findPublic(id: string): Promise<TaskPricingGetUniqueResponse> {
    try {
      const pricing = await this.prisma.taskPricing.findUnique({
        where: { id },
        include: {
          items: true,
          layoutFile: true,
          customerSignature: true,
          invoicesToCustomers: true,
          task: {
            include: {
              customer: true,
              truck: true,
              representatives: true,
            },
          },
        },
      });

      if (!pricing) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if pricing is expired
      const now = new Date();
      if (new Date(pricing.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou e não está mais disponível para visualização.',
        );
      }

      return {
        success: true,
        data: pricing as any,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding public pricing ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Upload customer signature for pricing (public endpoint)
   * Only allows upload if pricing is not expired
   */
  async uploadCustomerSignature(
    id: string,
    file: Express.Multer.File,
  ): Promise<TaskPricingUpdateResponse> {
    try {
      const pricing = await this.prisma.taskPricing.findUnique({
        where: { id },
        include: { customerSignature: true },
      });

      if (!pricing) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if pricing is expired
      const now = new Date();
      if (new Date(pricing.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou. Não é possível enviar a assinatura.',
        );
      }

      // Create file record for signature
      const signatureFile = await this.prisma.file.create({
        data: {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          path: file.path,
          size: file.size,
        },
      });

      // Update pricing with signature
      const updated = await this.prisma.taskPricing.update({
        where: { id },
        data: {
          customerSignatureId: signatureFile.id,
        },
        include: {
          items: true,
          layoutFile: true,
          customerSignature: true,
          task: {
            include: {
              customer: true,
            },
          },
        },
      });

      // Delete old signature file if it exists
      if (pricing.customerSignature) {
        await this.prisma.file
          .delete({
            where: { id: pricing.customerSignature.id },
          })
          .catch(() => {
            // Ignore errors when deleting old file
          });
      }

      // Log signature changelog
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK_PRICING,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'customerSignatureId',
        oldValue: pricing.customerSignatureId || null,
        newValue: signatureFile.id,
        userId: null,
        reason: 'Assinatura do cliente enviada',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
        triggeredById: null,
      });

      this.logger.log(`Customer signature uploaded for pricing ${id}`);

      return {
        success: true,
        data: updated as any,
        message: 'Assinatura enviada com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error uploading signature for pricing ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao enviar assinatura.');
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
    if (currentStatus === TASK_PRICING_STATUS.REJECTED && newStatus === TASK_PRICING_STATUS.DRAFT) {
      return;
    }

    // Disallow other transitions
    throw new BadRequestException(`Transição de status inválida: ${currentStatus} → ${newStatus}`);
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
