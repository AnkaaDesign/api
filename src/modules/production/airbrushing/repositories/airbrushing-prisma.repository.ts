import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Airbrushing } from '../../../../types';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import {
  getAirbrushingStatusOrder,
  mapAirbrushingStatusToPrisma,
  mapWhereClause,
} from '../../../../utils';
import {
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingInclude,
  AirbrushingWhere,
  AirbrushingOrderBy,
} from '../../../../schemas/airbrushing';
import { AirbrushingRepository } from './airbrushing.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class AirbrushingPrismaRepository
  extends BaseStringPrismaRepository<
    Airbrushing,
    AirbrushingCreateFormData,
    AirbrushingUpdateFormData,
    AirbrushingInclude,
    AirbrushingOrderBy,
    AirbrushingWhere,
    Prisma.AirbrushingGetPayload<{ include: any }>,
    Prisma.AirbrushingCreateInput,
    Prisma.AirbrushingUpdateInput,
    Prisma.AirbrushingInclude,
    Prisma.AirbrushingOrderByWithRelationInput,
    Prisma.AirbrushingWhereInput
  >
  implements AirbrushingRepository
{
  protected readonly logger = new Logger(AirbrushingPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): Airbrushing {
    return databaseEntity as Airbrushing;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: AirbrushingCreateFormData,
  ): Prisma.AirbrushingCreateInput {
    const { taskId, budgetIds, invoiceIds, receiptIds, reimbursementIds, reimbursementInvoiceIds, artworkIds, ...rest } = formData;

    const createInput: Prisma.AirbrushingCreateInput = {
      ...rest,
      status: mapAirbrushingStatusToPrisma(formData.status),
      statusOrder: getAirbrushingStatusOrder(formData.status),
      task: { connect: { id: taskId } },
    };

    // Handle file attachments
    if (budgetIds && budgetIds.length > 0) {
      createInput.budgets = {
        connect: budgetIds.map(id => ({ id })),
      };
    }

    if (invoiceIds && invoiceIds.length > 0) {
      createInput.nfes = {
        connect: invoiceIds.map(id => ({ id })),
      };
    }

    if (receiptIds && receiptIds.length > 0) {
      createInput.receipts = {
        connect: receiptIds.map(id => ({ id })),
      };
    }

    if (reimbursementIds && reimbursementIds.length > 0) {
      createInput.reimbursements = {
        connect: reimbursementIds.map(id => ({ id })),
      };
    }

    if (reimbursementInvoiceIds && reimbursementInvoiceIds.length > 0) {
      createInput.nfeReimbursements = {
        connect: reimbursementInvoiceIds.map(id => ({ id })),
      };
    }

    if (artworkIds && artworkIds.length > 0) {
      createInput.artworks = {
        connect: artworkIds.map(id => ({ id })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: AirbrushingUpdateFormData,
  ): Prisma.AirbrushingUpdateInput {
    const { taskId, status, budgetIds, invoiceIds, receiptIds, reimbursementIds, reimbursementInvoiceIds, artworkIds, ...rest } = formData;

    const updateData: Prisma.AirbrushingUpdateInput = {
      ...rest,
    };

    // Update status order if status is being changed
    if (status !== undefined) {
      updateData.status = mapAirbrushingStatusToPrisma(status);
      updateData.statusOrder = getAirbrushingStatusOrder(status);
    }

    // Handle optional relations with proper null handling
    if (taskId !== undefined) {
      updateData.task = { connect: { id: taskId } };
    }

    // Handle file attachments - use set to replace all connections
    if (budgetIds !== undefined) {
      updateData.budgets = {
        set: budgetIds.map(id => ({ id })),
      };
    }

    if (invoiceIds !== undefined) {
      updateData.nfes = {
        set: invoiceIds.map(id => ({ id })),
      };
    }

    if (receiptIds !== undefined) {
      updateData.receipts = {
        set: receiptIds.map(id => ({ id })),
      };
    }

    if (reimbursementIds !== undefined) {
      updateData.reimbursements = {
        set: reimbursementIds.map(id => ({ id })),
      };
    }

    if (reimbursementInvoiceIds !== undefined) {
      updateData.nfeReimbursements = {
        set: reimbursementInvoiceIds.map(id => ({ id })),
      };
    }

    if (artworkIds !== undefined) {
      updateData.artworks = {
        set: artworkIds.map(id => ({ id })),
      };
    }

    return updateData;
  }

  protected mapIncludeToDatabaseInclude(
    include?: AirbrushingInclude,
  ): Prisma.AirbrushingInclude | undefined {
    return include as Prisma.AirbrushingInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: AirbrushingOrderBy,
  ): Prisma.AirbrushingOrderByWithRelationInput | undefined {
    return orderBy as Prisma.AirbrushingOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(
    where?: AirbrushingWhere,
  ): Prisma.AirbrushingWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.AirbrushingWhereInput;
  }

  protected getDefaultInclude(): Prisma.AirbrushingInclude {
    return {
      task: true,
      receipts: true,
      nfes: true,
      artworks: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: AirbrushingCreateFormData,
    options?: CreateOptions<AirbrushingInclude>,
  ): Promise<Airbrushing> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.airbrushing.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar aerografia', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<AirbrushingInclude>,
  ): Promise<Airbrushing | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.airbrushing.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar aerografia por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<AirbrushingInclude>,
  ): Promise<Airbrushing[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.airbrushing.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar aerografias por IDs', error, { ids });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: AirbrushingUpdateFormData,
    options?: UpdateOptions<AirbrushingInclude>,
  ): Promise<Airbrushing> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.airbrushing.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar aerografia ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Airbrushing> {
    try {
      const result = await transaction.airbrushing.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar aerografia ${id}`, error);
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<AirbrushingOrderBy, AirbrushingWhere, AirbrushingInclude>,
  ): Promise<FindManyResult<Airbrushing>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, data] = await Promise.all([
      transaction.airbrushing.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.airbrushing.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        include: this.mapIncludeToDatabaseInclude(include),
        skip,
        take,
      }),
    ]);

    return {
      data: data.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: AirbrushingWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.airbrushing.count({ where: whereInput });
    } catch (error) {
      this.logError('contar aerografias', error, { where });
      throw error;
    }
  }
}
