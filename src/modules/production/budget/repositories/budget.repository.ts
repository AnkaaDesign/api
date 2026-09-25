// api/src/modules/production/budget/repositories/budget.repository.ts

import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import type { Budget, BudgetInclude, BudgetOrderBy, BudgetWhere } from '@types';
import type { BudgetCreateFormData, BudgetUpdateFormData } from '@schemas/budget';

/**
 * Abstract repository for Budget entity
 * Extends BaseStringRepository for standard CRUD operations
 */
export abstract class BudgetRepository extends BaseStringRepository<
  Budget,
  BudgetCreateFormData,
  BudgetUpdateFormData,
  BudgetInclude,
  BudgetOrderBy,
  BudgetWhere
> {
  /**
   * Find quote by task ID
   * @param taskId - UUID of the task
   * @returns Budget or null if not found
   */
  abstract findByTaskId(taskId: string): Promise<Budget | null>;

  /**
   * Find all quotes by status
   * @param status - Quote status (PENDING, BUDGET_APPROVED, BILLING_APPROVED, UPCOMING, DUE, PARTIAL, SETTLED)
   * @returns Array of Budget
   */
  abstract findByStatus(status: string): Promise<Budget[]>;

  /**
   * Find expired quotes
   * @returns Array of Budget with expiresAt < now
   */
  abstract findExpired(): Promise<Budget[]>;

  /**
   * Find approved quotes for a task
   * @param taskId - UUID of the task
   * @returns Approved quote or null
   */
  abstract findApprovedByTaskId(taskId: string): Promise<Budget | null>;

  /**
   * Find the most recent quote matching task name, customerId, implement category, and implement type
   */
  abstract findSuggestion(params: {
    name: string;
    customerId: string;
    category: string;
    implementType: string;
  }): Promise<(Budget & { taskCreatedAt: Date }) | null>;
}
