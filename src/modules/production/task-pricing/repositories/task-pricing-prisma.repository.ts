// api/src/modules/production/task-pricing/repositories/task-pricing-prisma.repository.ts

import { Injectable, Logger } from '@nestjs/common';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { TaskPricingRepository } from './task-pricing.repository';
import type {
  TaskPricing,
  TaskPricingInclude,
  TaskPricingOrderBy,
  TaskPricingWhere,
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '@types';
import type {
  TaskPricingCreateFormData,
  TaskPricingUpdateFormData,
} from '@schemas/task-pricing';
import { TASK_PRICING_STATUS } from '@constants';
import { TaskPricing as PrismaTaskPricing, Prisma } from '@prisma/client';

/**
 * Prisma implementation of TaskPricingRepository
 */
@Injectable()
export class TaskPricingPrismaRepository
  extends BaseStringPrismaRepository<
    TaskPricing,
    TaskPricingCreateFormData,
    TaskPricingUpdateFormData,
    TaskPricingInclude,
    TaskPricingOrderBy,
    TaskPricingWhere,
    PrismaTaskPricing,
    Prisma.TaskPricingCreateInput,
    Prisma.TaskPricingUpdateInput,
    Prisma.TaskPricingInclude,
    Prisma.TaskPricingOrderByWithRelationInput,
    Prisma.TaskPricingWhereInput
  >
  implements TaskPricingRepository
{
  protected readonly logger = new Logger(TaskPricingPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): TaskPricing {
    return {
      ...databaseEntity,
      total: databaseEntity.total ? Number(databaseEntity.total) : 0,
      items: databaseEntity.items?.map((item: any) => ({
        ...item,
        amount: item.amount ? Number(item.amount) : 0,
      })),
    } as TaskPricing;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: TaskPricingCreateFormData,
  ): Prisma.TaskPricingCreateInput {
    const createInput: Prisma.TaskPricingCreateInput = {
      // budgetNumber is set to 0 as placeholder - will be replaced at runtime in createWithTransaction
      budgetNumber: 0,
      subtotal: formData.subtotal || 0,
      discountType: (formData.discountType as any) || 'NONE',
      discountValue: formData.discountValue || null,
      total: formData.total || 0,
      expiresAt: formData.expiresAt || new Date(),
      status: (formData.status as any) || TASK_PRICING_STATUS.DRAFT,
      // Payment Terms (simplified)
      paymentCondition: (formData.paymentCondition as any) || null,
      downPaymentDate: formData.downPaymentDate || null,
      customPaymentText: formData.customPaymentText || null,
      // Guarantee Terms
      guaranteeYears: formData.guaranteeYears || null,
      customGuaranteeText: formData.customGuaranteeText || null,
      // Layout File
      ...(formData.layoutFileId && {
        layoutFile: { connect: { id: formData.layoutFileId } },
      }),
      task: {
        connect: { id: formData.taskId },
      },
    };

    // Handle items if provided
    if (formData.items && formData.items.length > 0) {
      createInput.items = {
        create: formData.items.map(item => ({
          amount: item.amount || 0,
          description: item.description || '',
        })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: TaskPricingUpdateFormData,
  ): Prisma.TaskPricingUpdateInput {
    const updateInput: Prisma.TaskPricingUpdateInput = {};

    if (formData.subtotal !== undefined) updateInput.subtotal = formData.subtotal;
    if (formData.discountType !== undefined) updateInput.discountType = formData.discountType as any;
    if (formData.discountValue !== undefined) updateInput.discountValue = formData.discountValue;
    if (formData.total !== undefined) updateInput.total = formData.total;
    if (formData.expiresAt !== undefined) updateInput.expiresAt = formData.expiresAt;
    if (formData.status !== undefined) updateInput.status = formData.status as any;

    // Payment Terms (simplified)
    if (formData.paymentCondition !== undefined) updateInput.paymentCondition = formData.paymentCondition as any;
    if (formData.downPaymentDate !== undefined) updateInput.downPaymentDate = formData.downPaymentDate;
    if (formData.customPaymentText !== undefined) updateInput.customPaymentText = formData.customPaymentText;

    // Guarantee Terms
    if (formData.guaranteeYears !== undefined) updateInput.guaranteeYears = formData.guaranteeYears;
    if (formData.customGuaranteeText !== undefined) updateInput.customGuaranteeText = formData.customGuaranteeText;

    // Layout File
    if (formData.layoutFileId !== undefined) {
      if (formData.layoutFileId) {
        updateInput.layoutFile = { connect: { id: formData.layoutFileId } };
      } else {
        updateInput.layoutFile = { disconnect: true };
      }
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: TaskPricingInclude,
  ): Prisma.TaskPricingInclude | undefined {
    if (!include) return undefined;

    const mappedInclude: Prisma.TaskPricingInclude = {};

    if (include.items !== undefined) mappedInclude.items = include.items;
    if (include.task !== undefined) {
      if (typeof include.task === 'boolean') {
        mappedInclude.task = include.task;
      } else {
        mappedInclude.task = { include: include.task.include as any };
      }
    }
    if ((include as any).layoutFile !== undefined) mappedInclude.layoutFile = (include as any).layoutFile;

    return mappedInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: TaskPricingOrderBy,
  ): Prisma.TaskPricingOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;
    return orderBy as any;
  }

  protected mapWhereToDatabaseWhere(
    where?: TaskPricingWhere,
  ): Prisma.TaskPricingWhereInput | undefined {
    if (!where) return undefined;
    return where as any;
  }

  protected getDefaultInclude(): Prisma.TaskPricingInclude | undefined {
    return { items: true };
  }

  // Create with transaction
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: TaskPricingCreateFormData,
    options?: CreateOptions<TaskPricingInclude>,
  ): Promise<TaskPricing> {
    const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    // Generate budgetNumber - required field that must be auto-generated
    const maxBudgetNumber = await transaction.taskPricing.aggregate({
      _max: { budgetNumber: true },
    });
    const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

    // Inject budgetNumber into create input
    (createInput as any).budgetNumber = nextBudgetNumber;

    const created = await transaction.taskPricing.create({
      data: createInput,
      include,
    });

    return this.mapDatabaseEntityToEntity(created);
  }

  // Update with transaction
  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: TaskPricingUpdateFormData,
    options?: UpdateOptions<TaskPricingInclude>,
  ): Promise<TaskPricing> {
    const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const updated = await transaction.taskPricing.update({
      where: { id },
      data: updateInput,
      include,
    });

    return this.mapDatabaseEntityToEntity(updated);
  }

  // Find many with transaction
  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<TaskPricingOrderBy, TaskPricingWhere, TaskPricingInclude>,
  ): Promise<FindManyResult<TaskPricing>> {
    const where = this.mapWhereToDatabaseWhere(options?.where);
    const orderBy = this.mapOrderByToDatabaseOrderBy(options?.orderBy);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const [data, total] = await Promise.all([
      transaction.taskPricing.findMany({
        where,
        orderBy,
        include,
        skip: options?.skip,
        take: options?.take,
      }),
      transaction.taskPricing.count({ where }),
    ]);

    const take = options?.take || 10;
    const page = options?.skip ? Math.floor(options.skip / take) + 1 : 1;
    const totalPages = Math.ceil(total / take);

    return {
      data: data.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: {
        totalRecords: total,
        page,
        take,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // Find one by ID with transaction
  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: { include?: TaskPricingInclude },
  ): Promise<TaskPricing | null> {
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const found = await transaction.taskPricing.findUnique({
      where: { id },
      include,
    });

    return found ? this.mapDatabaseEntityToEntity(found) : null;
  }

  // Delete with transaction
  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<TaskPricing> {
    const deleted = await transaction.taskPricing.delete({
      where: { id },
      include: this.getDefaultInclude(),
    });
    return this.mapDatabaseEntityToEntity(deleted);
  }

  // Find by IDs with transaction
  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: TaskPricingInclude },
  ): Promise<TaskPricing[]> {
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const found = await transaction.taskPricing.findMany({
      where: { id: { in: ids } },
      include,
    });

    return found.map(item => this.mapDatabaseEntityToEntity(item));
  }

  // Count with transaction
  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: TaskPricingWhere,
  ): Promise<number> {
    const databaseWhere = this.mapWhereToDatabaseWhere(where);
    return transaction.taskPricing.count({ where: databaseWhere });
  }

  /**
   * Find pricing by task ID (with items)
   */
  async findByTaskId(taskId: string): Promise<TaskPricing | null> {
    const pricing = await this.prisma.taskPricing.findUnique({
      where: { taskId },
      include: { items: true },
    });

    return pricing ? this.mapDatabaseEntityToEntity(pricing) : null;
  }

  /**
   * Find all pricings by status
   */
  async findByStatus(status: string): Promise<TaskPricing[]> {
    const pricings = await this.prisma.taskPricing.findMany({
      where: { status: status as any },
      include: { items: true, task: true },
      orderBy: { createdAt: 'desc' },
    });

    return pricings.map(p => this.mapDatabaseEntityToEntity(p));
  }

  /**
   * Find expired pricings (expiresAt < now)
   */
  async findExpired(): Promise<TaskPricing[]> {
    const now = new Date();
    const pricings = await this.prisma.taskPricing.findMany({
      where: {
        expiresAt: { lt: now },
        status: {
          in: [TASK_PRICING_STATUS.DRAFT, TASK_PRICING_STATUS.APPROVED],
        },
      },
      include: { items: true, task: true },
    });

    return pricings.map(p => this.mapDatabaseEntityToEntity(p));
  }

  /**
   * Find approved pricing for a task
   */
  async findApprovedByTaskId(taskId: string): Promise<TaskPricing | null> {
    const pricing = await this.prisma.taskPricing.findFirst({
      where: {
        taskId,
        status: TASK_PRICING_STATUS.APPROVED,
      },
      include: { items: true },
    });

    return pricing ? this.mapDatabaseEntityToEntity(pricing) : null;
  }
}
