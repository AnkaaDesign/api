import { Logger } from '@nestjs/common';
import {
  BatchCreateResult,
  BatchDeleteResult,
  BatchUpdateResult,
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
  CreateManyOptions,
  UpdateManyOptions,
} from '../../../types';
import { PrismaTransaction } from './base.repository';

export abstract class BaseStringRepository<
  Entity,
  CreateFormData,
  UpdateFormData,
  Include = any,
  OrderBy = any,
  Where = any,
> {
  protected abstract readonly logger: Logger;

  // Create operations
  abstract create(data: CreateFormData, options?: CreateOptions<Include>): Promise<Entity>;
  abstract createWithTransaction(
    transaction: PrismaTransaction,
    data: CreateFormData,
    options?: CreateOptions<Include>,
  ): Promise<Entity>;

  abstract createMany(
    data: CreateFormData[],
    options?: CreateManyOptions<Include>,
  ): Promise<BatchCreateResult<Entity, CreateFormData>>;
  abstract createManyWithTransaction(
    transaction: PrismaTransaction,
    data: CreateFormData[],
    options?: CreateManyOptions<Include>,
  ): Promise<BatchCreateResult<Entity, CreateFormData>>;

  // Read operations
  abstract findById(id: string, options?: CreateOptions<Include>): Promise<Entity | null>;
  abstract findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<Include>,
  ): Promise<Entity | null>;

  abstract findByIds(ids: string[], options?: CreateOptions<Include>): Promise<Entity[]>;
  abstract findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<Include>,
  ): Promise<Entity[]>;

  abstract findMany(
    options?: FindManyOptions<OrderBy, Where, Include>,
  ): Promise<FindManyResult<Entity>>;
  abstract findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<OrderBy, Where, Include>,
  ): Promise<FindManyResult<Entity>>;

  // Update operations
  abstract update(
    id: string,
    data: UpdateFormData,
    options?: UpdateOptions<Include>,
  ): Promise<Entity>;
  abstract updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: UpdateFormData,
    options?: UpdateOptions<Include>,
  ): Promise<Entity>;

  /**
   * Update multiple entities with optional includes for returned data
   * @param data Array of ID and data pairs to update
   * @param options Optional includes and other update options
   * @returns Batch result with updated entities including requested relations
   */
  abstract updateMany(
    data: Array<{ id: string; data: UpdateFormData }>,
    options?: UpdateManyOptions<Include>,
  ): Promise<BatchUpdateResult<Entity, UpdateFormData>>;
  abstract updateManyWithTransaction(
    transaction: PrismaTransaction,
    data: Array<{ id: string; data: UpdateFormData }>,
    options?: UpdateManyOptions<Include>,
  ): Promise<BatchUpdateResult<Entity, UpdateFormData>>;

  // Delete operations
  abstract delete(id: string): Promise<Entity>;
  abstract deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Entity>;

  abstract deleteMany(ids: string[]): Promise<BatchDeleteResult>;
  abstract deleteManyWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
  ): Promise<BatchDeleteResult>;

  // Utility operations
  abstract count(where?: Where): Promise<number>;
  abstract countWithTransaction(transaction: PrismaTransaction, where?: Where): Promise<number>;

  // Helper methods for batch operations
  protected createBatchCreateResult<T, D>(): BatchCreateResult<T, D> {
    return {
      success: [],
      failed: [],
      totalCreated: 0,
      totalFailed: 0,
    };
  }

  protected createBatchUpdateResult<T, D>(): BatchUpdateResult<T, D> {
    return {
      success: [],
      failed: [],
      totalUpdated: 0,
      totalFailed: 0,
    };
  }

  protected createBatchDeleteResult(): BatchDeleteResult {
    return {
      success: [],
      failed: [],
      totalDeleted: 0,
      totalFailed: 0,
    };
  }

  protected logError(operation: string, error: any, context?: any): void {
    this.logger.error(
      `Erro em ${operation}: ${error.message}`,
      error.stack,
      context ? JSON.stringify(context) : undefined,
    );
  }

  protected calculatePagination(totalRecords: number, page: number, take: number) {
    const totalPages = Math.ceil(totalRecords / take);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return {
      totalRecords,
      totalPages,
      page,
      take,
      hasNextPage,
      hasPreviousPage,
    };
  }
}
