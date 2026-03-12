// api/src/modules/production/task-quote/repositories/task-quote.repository.ts

import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import type { TaskQuote, TaskQuoteInclude, TaskQuoteOrderBy, TaskQuoteWhere } from '@types';
import type { TaskQuoteCreateFormData, TaskQuoteUpdateFormData } from '@schemas/task-quote';

/**
 * Abstract repository for TaskQuote entity
 * Extends BaseStringRepository for standard CRUD operations
 */
export abstract class TaskQuoteRepository extends BaseStringRepository<
  TaskQuote,
  TaskQuoteCreateFormData,
  TaskQuoteUpdateFormData,
  TaskQuoteInclude,
  TaskQuoteOrderBy,
  TaskQuoteWhere
> {
  /**
   * Find quote by task ID
   * @param taskId - UUID of the task
   * @returns TaskQuote or null if not found
   */
  abstract findByTaskId(taskId: string): Promise<TaskQuote | null>;

  /**
   * Find all quotes by status
   * @param status - Quote status (PENDING, BUDGET_APPROVED, VERIFIED_BY_FINANCIAL, INTERNAL_APPROVED, UPCOMING, DUE, PARTIAL, SETTLED)
   * @returns Array of TaskQuote
   */
  abstract findByStatus(status: string): Promise<TaskQuote[]>;

  /**
   * Find expired quotes
   * @returns Array of TaskQuote with expiresAt < now
   */
  abstract findExpired(): Promise<TaskQuote[]>;

  /**
   * Find approved quotes for a task
   * @param taskId - UUID of the task
   * @returns Approved quote or null
   */
  abstract findApprovedByTaskId(taskId: string): Promise<TaskQuote | null>;
}
