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
import { BaseRepository, PrismaTransaction } from './base.repository';
import { PrismaService } from '../prisma/prisma.service';

export abstract class BasePrismaRepository<
  Entity,
  CreateFormData,
  UpdateFormData,
  Include = any,
  OrderBy = any,
  Where = any,
  DatabaseEntity = any,
  DatabaseCreateInput = any,
  DatabaseUpdateInput = any,
  DatabaseInclude = any,
  DatabaseOrderBy = any,
  DatabaseWhere = any,
> extends BaseRepository<Entity, CreateFormData, UpdateFormData, Include, OrderBy, Where> {
  protected abstract readonly logger: Logger;

  constructor(protected readonly prisma: PrismaService) {
    super();
  }

  // Abstract methods that must be implemented by each repository
  protected abstract mapDatabaseEntityToEntity(databaseEntity: DatabaseEntity): Entity;

  protected abstract mapCreateFormDataToDatabaseCreateInput(
    formData: CreateFormData,
  ): DatabaseCreateInput;

  protected abstract mapUpdateFormDataToDatabaseUpdateInput(
    formData: UpdateFormData,
  ): DatabaseUpdateInput;

  protected abstract mapIncludeToDatabaseInclude(include?: Include): DatabaseInclude | undefined;

  protected abstract mapOrderByToDatabaseOrderBy(orderBy?: OrderBy): DatabaseOrderBy | undefined;

  protected abstract mapWhereToDatabaseWhere(where?: Where): DatabaseWhere | undefined;

  protected abstract getDefaultInclude(): DatabaseInclude | undefined;

  // Create operations
  async create(data: CreateFormData, options?: CreateOptions<Include>): Promise<Entity> {
    return this.createWithTransaction(this.prisma, data, options);
  }

  abstract createWithTransaction(
    transaction: PrismaTransaction,
    data: CreateFormData,
    options?: CreateOptions<Include>,
  ): Promise<Entity>;

  async createMany(
    data: CreateFormData[],
    options?: CreateManyOptions<Include>,
  ): Promise<BatchCreateResult<Entity, CreateFormData>> {
    return this.createManyWithTransaction(this.prisma, data, options);
  }

  async createManyWithTransaction(
    transaction: PrismaTransaction,
    data: CreateFormData[],
    options?: CreateManyOptions<Include>,
  ): Promise<BatchCreateResult<Entity, CreateFormData>> {
    const result = this.createBatchCreateResult<Entity, CreateFormData>();

    for (let index = 0; index < data.length; index++) {
      const item = data[index];
      try {
        const created = await this.createWithTransaction(transaction, item, options);
        result.success.push(created);
        result.totalCreated++;
      } catch (error: any) {
        result.failed.push({
          index,
          error: error.message || 'Erro ao criar item',
          data: item,
        });
        result.totalFailed++;
        this.logError('createMany', error, { item });
      }
    }

    return result;
  }

  // Read operations
  async findById(id: number, options?: CreateOptions<Include>): Promise<Entity | null> {
    return this.findByIdWithTransaction(this.prisma, id, options);
  }

  abstract findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: number,
    options?: CreateOptions<Include>,
  ): Promise<Entity | null>;

  async findByIds(ids: number[], options?: CreateOptions<Include>): Promise<Entity[]> {
    return this.findByIdsWithTransaction(this.prisma, ids, options);
  }

  abstract findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: number[],
    options?: CreateOptions<Include>,
  ): Promise<Entity[]>;

  async findMany(
    options?: FindManyOptions<OrderBy, Where, Include>,
  ): Promise<FindManyResult<Entity>> {
    return this.findManyWithTransaction(this.prisma, options);
  }

  abstract findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<OrderBy, Where, Include>,
  ): Promise<FindManyResult<Entity>>;

  // Update operations
  async update(
    id: number,
    data: UpdateFormData,
    options?: UpdateOptions<Include>,
  ): Promise<Entity> {
    return this.updateWithTransaction(this.prisma, id, data, options);
  }

  abstract updateWithTransaction(
    transaction: PrismaTransaction,
    id: number,
    data: UpdateFormData,
    options?: UpdateOptions<Include>,
  ): Promise<Entity>;

  async updateMany(
    data: Array<{ id: number; data: UpdateFormData }>,
    options?: UpdateManyOptions<Include>,
  ): Promise<BatchUpdateResult<Entity, UpdateFormData>> {
    return this.updateManyWithTransaction(this.prisma, data, options);
  }

  async updateManyWithTransaction(
    transaction: PrismaTransaction,
    data: Array<{ id: number; data: UpdateFormData }>,
    options?: UpdateManyOptions<Include>,
  ): Promise<BatchUpdateResult<Entity, UpdateFormData>> {
    const result = this.createBatchUpdateResult<Entity, UpdateFormData>();

    for (let index = 0; index < data.length; index++) {
      const item = data[index];
      try {
        const updated = await this.updateWithTransaction(transaction, item.id, item.data, options);
        result.success.push(updated);
        result.totalUpdated++;
      } catch (error: any) {
        result.failed.push({
          index,
          id: String(item.id),
          error: error.message || 'Erro ao atualizar item',
          data: item.data,
        });
        result.totalFailed++;
        this.logError('updateMany', error, { item });
      }
    }

    return result;
  }

  // Delete operations
  async delete(id: number): Promise<Entity> {
    return this.deleteWithTransaction(this.prisma, id);
  }

  abstract deleteWithTransaction(transaction: PrismaTransaction, id: number): Promise<Entity>;

  async deleteMany(ids: number[]): Promise<BatchDeleteResult> {
    return this.deleteManyWithTransaction(this.prisma, ids);
  }

  async deleteManyWithTransaction(
    transaction: PrismaTransaction,
    ids: number[],
  ): Promise<BatchDeleteResult> {
    const result = this.createBatchDeleteResult();

    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      try {
        await this.deleteWithTransaction(transaction, id);
        result.success.push({ id: String(id), deleted: true });
        result.totalDeleted++;
      } catch (error: any) {
        result.failed.push({
          index,
          id: String(id),
          error: error.message || 'Erro ao deletar item',
          data: { id: String(id) },
        });
        result.totalFailed++;
        this.logError('deleteMany', error, { id });
      }
    }

    return result;
  }

  // Utility operations
  async count(where?: Where): Promise<number> {
    return this.countWithTransaction(this.prisma, where);
  }

  abstract countWithTransaction(transaction: PrismaTransaction, where?: Where): Promise<number>;
}
