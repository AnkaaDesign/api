// api/src/modules/production/task-pricing/repositories/task-pricing-prisma.repository.ts

import { Injectable } from '@nestjs/common';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskPricingRepository } from './task-pricing.repository';
import type {
  TaskPricing,
  TaskPricingInclude,
  TaskPricingOrderBy,
  TaskPricingWhere,
} from '@types';
import type {
  TaskPricingCreateFormData,
  TaskPricingUpdateFormData,
} from '@schemas/task-pricing';
import { TASK_PRICING_STATUS } from '@constants';

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
    TaskPricingWhere
  >
  implements TaskPricingRepository
{
  constructor(protected readonly prisma: PrismaService) {
    super(prisma, 'taskPricing');
  }

  /**
   * Find pricing by task ID (with items)
   */
  async findByTaskId(taskId: string): Promise<TaskPricing | null> {
    const pricing = await this.prisma.taskPricing.findUnique({
      where: { taskId },
      include: { items: true },
    });

    return pricing as TaskPricing | null;
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

    return pricings as TaskPricing[];
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

    return pricings as TaskPricing[];
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

    return pricing as TaskPricing | null;
  }
}
