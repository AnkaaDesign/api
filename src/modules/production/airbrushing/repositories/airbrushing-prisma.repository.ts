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
    // Transform layouts from nested Layout+File structure to flattened File structure
    // Frontend expects: { id: fileId, filename, size, mimetype, thumbnailUrl, status }
    // Backend returns: { id: layoutId, fileId, status, file: { id, filename, ... } }
    if (databaseEntity.layouts && Array.isArray(databaseEntity.layouts)) {
      databaseEntity.layouts = databaseEntity.layouts.map((layout: any) => {
        if (layout.file) {
          return {
            // Use file ID as the primary identifier (needed for URL construction)
            id: layout.file.id,
            // Include layout-specific fields
            layoutId: layout.id,
            status: layout.status,
            // Spread all file properties
            filename: layout.file.filename,
            originalName: layout.file.originalName,
            path: layout.file.path,
            mimetype: layout.file.mimetype,
            size: layout.file.size,
            thumbnailUrl: layout.file.thumbnailUrl,
            createdAt: layout.file.createdAt,
            updatedAt: layout.file.updatedAt,
          };
        }
        return layout;
      });
    }
    return databaseEntity as Airbrushing;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: AirbrushingCreateFormData,
  ): Prisma.AirbrushingCreateInput {
    // NOTE: layoutIds are File IDs (not Layout entity IDs). Layout rows are
    // created by the service (convertFileIdsToLayoutIds) AFTER the airbrushing
    // exists, since Layout requires airbrushingId. They are intentionally not
    // connected here.
    const { taskId, painterId, invoiceIds, receiptIds, layoutIds: _layoutIds, ...rest } = formData;

    const createInput: Prisma.AirbrushingCreateInput = {
      ...rest,
      status: mapAirbrushingStatusToPrisma(formData.status),
      statusOrder: getAirbrushingStatusOrder(formData.status),
      task: { connect: { id: taskId } },
    };

    // Stamp paidAt when an airbrushing is created already PAID (mirrors update()).
    if (formData.paymentStatus === 'PAID') {
      createInput.paidAt = new Date();
    }

    if (painterId) {
      createInput.painter = { connect: { id: painterId } };
    }

    // Handle file attachments (File relations)
    if (invoiceIds && invoiceIds.length > 0) {
      createInput.invoices = {
        connect: invoiceIds.map(id => ({ id })),
      };
    }

    if (receiptIds && receiptIds.length > 0) {
      createInput.receipts = {
        connect: receiptIds.map(id => ({ id })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: AirbrushingUpdateFormData,
  ): Prisma.AirbrushingUpdateInput {
    const { taskId, painterId, status, invoiceIds, receiptIds, layoutIds, ...rest } = formData;

    const updateData: Prisma.AirbrushingUpdateInput = {
      ...rest,
    };

    // Update status order if status is being changed
    if (status !== undefined) {
      updateData.status = mapAirbrushingStatusToPrisma(status);
      updateData.statusOrder = getAirbrushingStatusOrder(status);
    }

    // Stamp/clear paidAt to mirror the payment status (PAID = settled now) so
    // Contas a Pagar can window "paid this month".
    if (formData.paymentStatus !== undefined) {
      updateData.paidAt = formData.paymentStatus === "PAID" ? new Date() : null;
    }

    // Handle optional relations with proper null handling
    if (taskId !== undefined) {
      updateData.task = { connect: { id: taskId } };
    }

    if (painterId !== undefined) {
      updateData.painter = painterId ? { connect: { id: painterId } } : { disconnect: true };
    }

    // Handle file attachments - use set to replace all connections
    if (invoiceIds !== undefined) {
      updateData.invoices = {
        set: invoiceIds.map(id => ({ id })),
      };
    }

    if (receiptIds !== undefined) {
      updateData.receipts = {
        set: receiptIds.map(id => ({ id })),
      };
    }

    if (layoutIds !== undefined) {
      updateData.layouts = {
        set: layoutIds.map(id => ({ id })),
      };
    }

    return updateData;
  }

  protected mapIncludeToDatabaseInclude(
    include?: AirbrushingInclude,
  ): Prisma.AirbrushingInclude | undefined {
    if (!include) return undefined;

    // Ensure layouts always includes nested file data when layouts is requested
    // This is required for proper frontend display (FileItem component needs file properties)
    const mappedInclude = { ...include } as Prisma.AirbrushingInclude;
    if (mappedInclude.layouts === true) {
      mappedInclude.layouts = {
        include: {
          file: true,
        },
      };
    }

    return mappedInclude;
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
      invoices: true,
      layouts: {
        include: {
          file: true,
        },
      },
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
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
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
