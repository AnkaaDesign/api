// repositories/external-operation-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ExternalOperation } from '../../../../../types';
import {
  ExternalOperationCreateFormData,
  ExternalOperationUpdateFormData,
  ExternalOperationInclude,
  ExternalOperationOrderBy,
  ExternalOperationWhere,
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
import { ExternalOperationRepository } from './external-operation.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, ExternalOperation as PrismaExternalOperation } from '@prisma/client';
import {
  EXTERNAL_OPERATION_STATUS_ORDER,
  EXTERNAL_OPERATION_STATUS,
  EXTERNAL_OPERATION_TYPE,
} from '../../../../../constants';

@Injectable()
export class ExternalOperationPrismaRepository
  extends BaseStringPrismaRepository<
    ExternalOperation,
    ExternalOperationCreateFormData,
    ExternalOperationUpdateFormData,
    ExternalOperationInclude,
    ExternalOperationOrderBy,
    ExternalOperationWhere,
    PrismaExternalOperation,
    Prisma.ExternalOperationCreateInput,
    Prisma.ExternalOperationUpdateInput,
    Prisma.ExternalOperationInclude,
    Prisma.ExternalOperationOrderByWithRelationInput,
    Prisma.ExternalOperationWhereInput
  >
  implements ExternalOperationRepository
{
  protected readonly logger = new Logger(ExternalOperationPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): ExternalOperation {
    return {
      id: databaseEntity.id,
      withdrawerName: databaseEntity.withdrawerName,
      type: databaseEntity.type,
      status: databaseEntity.status,
      statusOrder: databaseEntity.statusOrder,
      notes: databaseEntity.notes,
      // Billing fields
      customerId: databaseEntity.customerId,
      generateInvoice: databaseEntity.generateInvoice,
      generateBankSlip: databaseEntity.generateBankSlip,
      paymentCondition: databaseEntity.paymentCondition,
      paymentConfig: databaseEntity.paymentConfig,
      billedAt: databaseEntity.billedAt,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      // Relations
      invoices: databaseEntity.invoices,
      invoiceReimbursements: databaseEntity.invoiceReimbursements,
      receipts: databaseEntity.receipts,
      reimbursements: databaseEntity.reimbursements,
      items: databaseEntity.items,
      customer: databaseEntity.customer,
      services: databaseEntity.services?.map((service: any) => ({
        ...service,
        amount: service.amount !== null && service.amount !== undefined ? Number(service.amount) : service.amount,
      })),
      billingInvoice: databaseEntity.billingInvoice,
      installments: databaseEntity.installments,
    };
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: ExternalOperationCreateFormData,
  ): Prisma.ExternalOperationCreateInput {
    const {
      items,
      services,
      customerId,
      paymentConfig,
      status,
      invoiceIds,
      receiptIds,
      ...rest
    } = formData;

    const createInput: Prisma.ExternalOperationCreateInput = {
      ...rest,
      // withdrawerName is optional — a customer OR a responsible name is required
      // (enforced in the service layer)
      withdrawerName: formData.withdrawerName ?? null,
      type: formData.type ?? EXTERNAL_OPERATION_TYPE.RETURNABLE,
      // Set status and statusOrder
      status: status || EXTERNAL_OPERATION_STATUS.PENDING,
      statusOrder:
        EXTERNAL_OPERATION_STATUS_ORDER[status || EXTERNAL_OPERATION_STATUS.PENDING] || 1,
    };

    // Billing relations/fields
    if (customerId) {
      createInput.customer = { connect: { id: customerId } };
    }
    if (paymentConfig !== undefined) {
      createInput.paymentConfig =
        paymentConfig === null ? Prisma.JsonNull : (paymentConfig as Prisma.InputJsonValue);
    }

    // File relations (existing File ids referenced at create time)
    if (invoiceIds && invoiceIds.length > 0) {
      createInput.invoices = { connect: invoiceIds.map(id => ({ id })) };
    }
    if (receiptIds && receiptIds.length > 0) {
      createInput.receipts = { connect: receiptIds.map(id => ({ id })) };
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

    if (services && services.length > 0) {
      createInput.services = {
        create: services.map((service, index) => ({
          description: service.description,
          amount: service.amount,
          position: service.position ?? index,
        })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: ExternalOperationUpdateFormData,
  ): Prisma.ExternalOperationUpdateInput {
    const { invoiceIds, receiptIds, status, customerId, paymentConfig, services, items, ...rest } =
      formData;

    const updateInput: Prisma.ExternalOperationUpdateInput = {
      ...rest,
    };

    // Handle status update with statusOrder
    if (status !== undefined) {
      updateInput.status = status;
      updateInput.statusOrder = EXTERNAL_OPERATION_STATUS_ORDER[status] || 1;
    }

    // Handle customer relation (connect/disconnect)
    if (customerId !== undefined) {
      updateInput.customer = customerId ? { connect: { id: customerId } } : { disconnect: true };
    }

    // Handle paymentConfig JSON
    if (paymentConfig !== undefined) {
      updateInput.paymentConfig =
        paymentConfig === null ? Prisma.JsonNull : (paymentConfig as Prisma.InputJsonValue);
    }

    // Handle items: delete-then-recreate whenever an items array is provided.
    // Only allowed while PENDING (enforced in the service layer), so nothing has been
    // withdrawn/returned yet and recreating with returnedQuantity 0 is correct.
    if (items !== undefined) {
      updateInput.items = {
        deleteMany: {},
        create: items.map(item => ({
          withdrawedQuantity: item.withdrawedQuantity,
          returnedQuantity: 0,
          price: item.price ?? null,
          item: { connect: { id: item.itemId } },
        })),
      };
    }

    // Handle services: delete-then-recreate whenever a services array is provided
    // (mirrors the nested-write pattern used for items on create)
    if (services !== undefined) {
      updateInput.services = {
        deleteMany: {},
        create: services.map((service, index) => ({
          description: service.description,
          amount: service.amount,
          position: service.position ?? index,
        })),
      };
    }

    // Handle file arrays with set operation
    if (invoiceIds !== undefined) {
      updateInput.invoices = { set: invoiceIds.map(id => ({ id })) };
    }

    if (receiptIds !== undefined) {
      updateInput.receipts = { set: receiptIds.map(id => ({ id })) };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: ExternalOperationInclude,
  ): Prisma.ExternalOperationInclude | undefined {
    return include as Prisma.ExternalOperationInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: ExternalOperationOrderBy): any {
    return orderBy || { createdAt: 'desc' };
  }

  protected mapWhereToDatabaseWhere(
    where?: ExternalOperationWhere,
  ): Prisma.ExternalOperationWhereInput | undefined {
    return where as Prisma.ExternalOperationWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.ExternalOperationInclude {
    return {
      items: {
        include: {
          item: true,
        },
      },
      invoices: true,
      receipts: true,
      customer: true,
      services: { orderBy: { position: 'asc' } },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: ExternalOperationCreateFormData,
    options?: CreateOptions<ExternalOperationInclude>,
  ): Promise<ExternalOperation> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalOperation.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar operação externa', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<ExternalOperationInclude>,
  ): Promise<ExternalOperation | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalOperation.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar operação externa por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<ExternalOperationInclude>,
  ): Promise<ExternalOperation[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.externalOperation.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar operações externas por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      ExternalOperationOrderBy,
      ExternalOperationWhere,
      ExternalOperationInclude
    >,
  ): Promise<FindManyResult<ExternalOperation>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, externalOperations] = await Promise.all([
      transaction.externalOperation.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.externalOperation.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: externalOperations.map(withdrawal => this.mapDatabaseEntityToEntity(withdrawal)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: ExternalOperationUpdateFormData,
    options?: UpdateOptions<ExternalOperationInclude>,
  ): Promise<ExternalOperation> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.externalOperation.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar operação externa ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<ExternalOperation> {
    try {
      const result = await transaction.externalOperation.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar operação externa ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: ExternalOperationWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.externalOperation.count({ where: whereInput });
    } catch (error) {
      this.logError('contar operações externas', error, { where });
      throw error;
    }
  }
}
