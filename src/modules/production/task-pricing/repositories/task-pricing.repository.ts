// api/src/modules/production/task-pricing/repositories/task-pricing.repository.ts

import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import type { TaskPricing, TaskPricingInclude, TaskPricingOrderBy, TaskPricingWhere } from '@types';
import type { TaskPricingCreateFormData, TaskPricingUpdateFormData } from '@schemas/task-pricing';

/**
 * Abstract repository for TaskPricing entity
 * Extends BaseStringRepository for standard CRUD operations
 */
export abstract class TaskPricingRepository extends BaseStringRepository<
  TaskPricing,
  TaskPricingCreateFormData,
  TaskPricingUpdateFormData,
  TaskPricingInclude,
  TaskPricingOrderBy,
  TaskPricingWhere
> {
  /**
   * Find pricing by task ID
   * @param taskId - UUID of the task
   * @returns TaskPricing or null if not found
   */
  abstract findByTaskId(taskId: string): Promise<TaskPricing | null>;

  /**
   * Find all pricings by status
   * @param status - Pricing status (DRAFT, APPROVED, REJECTED, CANCELLED)
   * @returns Array of TaskPricing
   */
  abstract findByStatus(status: string): Promise<TaskPricing[]>;

  /**
   * Find expired pricings
   * @returns Array of TaskPricing with expiresAt < now
   */
  abstract findExpired(): Promise<TaskPricing[]>;

  /**
   * Find approved pricings for a task
   * @param taskId - UUID of the task
   * @returns Approved pricing or null
   */
  abstract findApprovedByTaskId(taskId: string): Promise<TaskPricing | null>;
}
