// repositories/external-withdrawal-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ExternalWithdrawal } from '../../../../../types';
import {
  ExternalWithdrawalCreateFormData,
  ExternalWithdrawalUpdateFormData,
  ExternalWithdrawalInclude,
  ExternalWithdrawalOrderBy,
  ExternalWithdrawalWhere,
} from '../../../../../schemas';
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
} from '../../../../../types';
import { ExternalWithdrawalRepository } from './external-withdrawal.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, ExternalWithdrawal as PrismaExternalWithdrawal } from '@prisma/client';
import { EXTERNAL_WITHDRAWAL_STATUS_ORDER, EXTERNAL_WITHDRAWAL_STATUS } from '../../../../../constants';

@Injectable()
export class ExternalWithdrawalPrismaRepository
  extends BaseStringPrismaRepository<
    ExternalWithdrawal,
    ExternalWithdrawalCreateFormData,
    ExternalWithdrawalUpdateFormData,
    ExternalWithdrawalInclude,
    ExternalWithdrawalOrderBy,
    ExternalWithdrawalWhere,
    PrismaExternalWithdrawal,
    Prisma.ExternalWithdrawalCreateInput,
    Prisma.ExternalWithdrawalUpdateInput,
    Prisma.ExternalWithdrawalInclude,
    Prisma.ExternalWithdrawalOrderByWithRelationInput,
    Prisma.ExternalWithdrawalWhereInput
  >
  implements ExternalWithdrawalRepository
{
  protected readonly logger = new Logger(ExternalWithdrawalPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): ExternalWithdrawal {
    return {
      id: databaseEntity.id,
      withdrawerName: databaseEntity.withdrawerName,
      willReturn: databaseEntity.willReturn,
      status: databaseEntity.status,
      statusOrder: databaseEntity.statusOrder,
      nfeId: databaseEntity.nfeId,
      receiptId: databaseEntity.receiptId,
      notes: databaseEntity.notes,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      // Relations
      nfe: databaseEntity.nfe,
      receipt: databaseEntity.receipt,
      items: databaseEntity.items,
    };
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ExternalWithdrawalCreateFormData,
  ): Prisma.ExternalWithdrawalCreateInput {
    const { nfeId, receiptId, items, status, ...rest } = formData;

    // Validate required fields
    if (!formData.withdrawerName) {
      throw new Error('Withdrawer name is required for creating an external withdrawal');
    }

    const createInput: Prisma.ExternalWithdrawalCreateInput = {
      ...rest,
      withdrawerName: formData.withdrawerName!, // Ensure it's required
      willReturn: formData.willReturn ?? true,
      // Set status and statusOrder
      status: status || EXTERNAL_WITHDRAWAL_STATUS.PENDING,
      statusOrder:
        EXTERNAL_WITHDRAWAL_STATUS_ORDER[status || EXTERNAL_WITHDRAWAL_STATUS.PENDING] || 1,
    };

    if (nfeId) {
      createInput.nfe = { connect: { id: nfeId } };
    }

    if (receiptId) {
      createInput.receipt = { connect: { id: receiptId } };
    }

    if (items && items.length > 0) {
      createInput.items = {
        create: items.map(item => ({
          withdrawedQuantity: item.withdrawedQuantity,
          returnedQuantity: 0,
          price: item.price,
          item: { connect: { id: item.itemId } },
        })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ExternalWithdrawalUpdateFormData,
  ): Prisma.ExternalWithdrawalUpdateInput {
    const { nfeId, receiptId, status, ...rest } = formData;

    const updateInput: Prisma.ExternalWithdrawalUpdateInput = {
      ...rest,
    };

    // Handle status update with statusOrder
    if (status !== undefined) {
      updateInput.status = status;
      updateInput.statusOrder = EXTERNAL_WITHDRAWAL_STATUS_ORDER[status] || 1;
    }

    if (nfeId !== undefined) {
      updateInput.nfe = nfeId ? { connect: { id: nfeId } } : { disconnect: true };
    }

    if (receiptId !== undefined) {
      updateInput.receipt = receiptId ? { connect: { id: receiptId } } : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ExternalWithdrawalInclude,
  ): Prisma.ExternalWithdrawalInclude | undefined {
    return include as Prisma.ExternalWithdrawalInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: ExternalWithdrawalOrderBy): any {
    return orderBy || { createdAt: 'desc' };
  }

  protected mapWhereToDatabaseWhere(
    where?: ExternalWithdrawalWhere,
  ): Prisma.ExternalWithdrawalWhereInput | undefined {
    return where as Prisma.ExternalWithdrawalWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.ExternalWithdrawalInclude {
    return {
      items: {
        include: {
          item: true,
        },
      },
      nfe: true,
      receipt: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ExternalWithdrawalCreateFormData,
    options?: CreateOptions<ExternalWithdrawalInclude>,
  ): Promise<ExternalWithdrawal> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalWithdrawal.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar retirada externa', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ExternalWithdrawalInclude>,
  ): Promise<ExternalWithdrawal | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalWithdrawal.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar retirada externa por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ExternalWithdrawalInclude>,
  ): Promise<ExternalWithdrawal[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.externalWithdrawal.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar retiradas externas por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      ExternalWithdrawalOrderBy,
      ExternalWithdrawalWhere,
      ExternalWithdrawalInclude
    >,
  ): Promise<FindManyResult<ExternalWithdrawal>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, externalWithdrawals] = await Promise.all([
      transaction.externalWithdrawal.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.externalWithdrawal.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: externalWithdrawals.map(withdrawal => this.mapDatabaseEntityToEntity(withdrawal)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ExternalWithdrawalUpdateFormData,
    options?: UpdateOptions<ExternalWithdrawalInclude>,
  ): Promise<ExternalWithdrawal> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalWithdrawal.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar retirada externa ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<ExternalWithdrawal> {
    try {
      const result = await transaction.externalWithdrawal.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar retirada externa ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ExternalWithdrawalWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.externalWithdrawal.count({ where: whereInput });
    } catch (error) {
      this.logError('contar retiradas externas', error, { where });
      throw error;
    }
  }
}
