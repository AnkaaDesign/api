// repositories/task.repository.ts

import { Task } from '../../../../types';
import {
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskInclude,
  TaskOrderBy,
  TaskWhere,
} from '../../../../schemas/task';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

// Re-export PrismaTransaction for services to use
export type { PrismaTransaction };

export abstract class TaskRepository extends BaseStringRepository<
  Task,
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskInclude,
  TaskOrderBy,
  TaskWhere
> {
  // Task-specific methods

  // These methods are inherited from base class but need to be declared here for TypeScript
  abstract createWithTransaction(
    transaction: PrismaTransaction,
    data: TaskCreateFormData,
    options?: any,
  ): Promise<Task>;
  abstract createManyWithTransaction(
    transaction: PrismaTransaction,
    data: TaskCreateFormData[],
    options?: any,
  ): Promise<any>;
  abstract findById(id: string, options?: any): Promise<Task | null>;
  abstract findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: any,
  ): Promise<Task | null>;
  abstract findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: any,
  ): Promise<Task[]>;
  abstract findMany(options?: any): Promise<any>;
  abstract findManyWithTransaction(transaction: PrismaTransaction, options?: any): Promise<any>;
  abstract updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: TaskUpdateFormData,
    options?: any,
    userId?: string,
  ): Promise<Task>;
  abstract updateManyWithTransaction(
    transaction: PrismaTransaction,
    data: Array<{ id: string; data: TaskUpdateFormData }>,
    options?: any,
  ): Promise<any>;
  abstract deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Task>;
  abstract deleteManyWithTransaction(transaction: PrismaTransaction, ids: string[]): Promise<any>;
  abstract countWithTransaction(transaction: PrismaTransaction, where?: TaskWhere): Promise<number>;
}
