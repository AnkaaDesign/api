// repositories/task-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Task } from '../../../../types';
import {
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskInclude,
  TaskOrderBy,
  TaskWhere,
} from '../../../../schemas/task';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { TaskRepository } from './task.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import { TASK_STATUS, SERVICE_ORDER_STATUS, CUT_STATUS } from '../../../../constants/enums';
import {
  getTaskStatusOrder,
  getServiceOrderStatusOrder,
  getCutStatusOrder,
  mapTaskStatusToPrisma,
  mapServiceOrderStatusToPrisma,
  mapWhereClause,
} from '../../../../utils';

// Removed TaskIncludeProfile - using direct include parameters instead

// Default include for task repository
const DEFAULT_TASK_INCLUDE: Prisma.TaskInclude = {
  sector: { select: { id: true, name: true } },
  customer: { select: { id: true, fantasyName: true, cnpj: true } },
  budgets: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  invoices: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  receipts: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  // reimbursements: {
  //   select: {
  //     id: true,
  //     filename: true,
  //     path: true,
  //     mimetype: true,
  //     size: true,
  //     thumbnailUrl: true,
  //   },
  // },
  // reimbursementInvoices: {
  //   select: {
  //     id: true,
  //     filename: true,
  //     path: true,
  //     mimetype: true,
  //     size: true,
  //     thumbnailUrl: true,
  //   },
  // },
  observation: {
    include: {
      files: {
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          size: true,
          thumbnailUrl: true,
        },
      },
    },
  },
  generalPainting: {
    select: { id: true, name: true, hex: true, paintBrand: { select: { name: true } } },
  },
  artworks: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  logoPaints: {
    select: { id: true, name: true, hex: true, paintBrand: { select: { name: true } } },
  },
  services: {
    orderBy: { createdAt: 'desc' },
  },
  truck: {
    include: {
      garage: { select: { id: true, name: true } },
    },
  },
  airbrushing: {
    orderBy: { createdAt: 'desc' },
  },
  cuts: {
    include: {
      file: {
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          size: true,
          thumbnailUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
};

@Injectable()
export class TaskPrismaRepository
  extends BaseStringPrismaRepository<
    Task,
    TaskCreateFormData,
    TaskUpdateFormData,
    TaskInclude,
    TaskOrderBy,
    TaskWhere,
    Prisma.TaskGetPayload<{ include: any }>,
    Prisma.TaskCreateInput,
    Prisma.TaskUpdateInput,
    Prisma.TaskInclude,
    Prisma.TaskOrderByWithRelationInput,
    Prisma.TaskWhereInput
  >
  implements TaskRepository
{
  protected readonly logger = new Logger(TaskPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Task {
    // Map logoPaints back to paints for the interface
    const task: Task = {
      ...databaseEntity,
      paints: databaseEntity.logoPaints,
      price: databaseEntity.price ? Number(databaseEntity.price) : null,
    };

    // Remove the logoPaints property since we've mapped it to paints
    delete (task as any).logoPaints;

    return task;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: TaskCreateFormData,
  ): Prisma.TaskCreateInput {
    // Cast to extended type to access all properties
    const extendedData = formData as TaskCreateFormData;

    // Extract known properties
    const {
      name,
      status,
      serialNumber,
      plate,
      details,
      entryDate,
      term,
      startedAt,
      finishedAt,
      paintId,
      customerId,
      sectorId,
      commission,
      price,
      // Extended properties - File arrays
      budgetIds,
      invoiceIds,
      receiptIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      fileIds,
      paintIds,
      services,
      observation,
      truck,
      cut,
      cuts,
    } = extendedData;

    // Build create input with proper null handling
    const taskData: Prisma.TaskCreateInput = {
      name,
      status: mapTaskStatusToPrisma(status || TASK_STATUS.PENDING),
      statusOrder: getTaskStatusOrder(status || TASK_STATUS.PENDING),
      commission: (commission as any) || 'NO_COMMISSION', // Default to NO_COMMISSION if not provided
    };

    // Add optional scalar fields
    if (serialNumber !== undefined) taskData.serialNumber = serialNumber;
    if (plate !== undefined) taskData.plate = plate;
    if (details !== undefined) taskData.details = details;
    if (entryDate !== undefined) taskData.entryDate = entryDate;
    if (term !== undefined) taskData.term = term;
    if (startedAt !== undefined) taskData.startedAt = startedAt;
    if (finishedAt !== undefined) taskData.finishedAt = finishedAt;
    if (price !== undefined) taskData.price = price;

    // Handle relations with proper null checks
    if (customerId) taskData.customer = { connect: { id: customerId } };
    if (paintId) taskData.generalPainting = { connect: { id: paintId } };
    if (sectorId) taskData.sector = { connect: { id: sectorId } };

    // Handle many-to-many file relations
    if (budgetIds && budgetIds.length > 0) {
      taskData.budgets = { connect: budgetIds.map(id => ({ id })) };
    }
    if (invoiceIds && invoiceIds.length > 0) {
      taskData.invoices = { connect: invoiceIds.map(id => ({ id })) };
    }
    if (receiptIds && receiptIds.length > 0) {
      taskData.receipts = { connect: receiptIds.map(id => ({ id })) };
    }
    if (reimbursementIds && reimbursementIds.length > 0) {
      taskData.reimbursements = { connect: reimbursementIds.map(id => ({ id })) };
    }
    if (reimbursementInvoiceIds && reimbursementInvoiceIds.length > 0) {
      taskData.invoiceReimbursements = { connect: reimbursementInvoiceIds.map(id => ({ id })) };
    }
    if (fileIds && fileIds.length > 0) {
      taskData.artworks = { connect: fileIds.map(id => ({ id })) };
    }
    if (paintIds && paintIds.length > 0) {
      taskData.logoPaints = { connect: paintIds.map(id => ({ id })) };
    }

    // Handle observation creation
    if (observation) {
      const { fileIds: obsFileIds, ...obsData } = observation;
      taskData.observation = {
        create: {
          ...obsData,
          files:
            obsFileIds && obsFileIds.length > 0
              ? { connect: obsFileIds.map(id => ({ id })) }
              : undefined,
        },
      };
    }

    // Handle services creation
    if (services && services.length > 0) {
      taskData.services = {
        create: services.map(service => ({
          status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
          statusOrder:
            service.statusOrder ||
            getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
          description: service.description,
          startedAt: service.startedAt || null,
          finishedAt: service.finishedAt || null,
        })),
      };
    }

    // Handle truck creation
    if (truck) {
      const truckData: any = {
        xPosition: truck.xPosition ?? null,
        yPosition: truck.yPosition ?? null,
      };

      // Add garage connection if garageId is provided
      if (truck.garageId) {
        truckData.garage = { connect: { id: truck.garageId } };
      }

      taskData.truck = { create: truckData };
    }

    // Handle cut creation - support both single cut and multiple cuts
    type CutRecord = {
      fileId: string;
      type: any;
      status: any;
      statusOrder: number;
      origin: any;
      reason: any;
      parentCutId: string | null;
    };
    const cutRecords: CutRecord[] = [];

    // DEBUG: Log what we're receiving
    console.log('🔍 CREATE TASK - Cut fields received:', {
      hasCut: !!cut,
      hasCuts: !!cuts,
      cutsIsArray: Array.isArray(cuts),
      cutsLength: Array.isArray(cuts) ? cuts.length : 'N/A',
      cutData: cut,
      cutsData: cuts,
    });

    // Handle multiple cuts field (preferred way)
    if (cuts && Array.isArray(cuts)) {
      console.log('✅ Processing cuts array (preferred method)');
      for (const cutItem of cuts) {
        // If quantity is specified, create multiple records
        const quantity = (cutItem as any).quantity || 1;
        console.log(`  → Creating ${quantity} cut(s) of type ${cutItem.type}`);
        for (let i = 0; i < quantity; i++) {
          cutRecords.push({
            fileId: cutItem.fileId,
            type: cutItem.type as any,
            status: CUT_STATUS.PENDING as any,
            statusOrder: getCutStatusOrder(CUT_STATUS.PENDING),
            origin: cutItem.origin as any,
            reason: cutItem.reason ? (cutItem.reason as any) : null,
            parentCutId: cutItem.parentCutId || null,
          } as any);
        }
      }
    }
    // Handle single cut field ONLY if cuts array is not present (deprecated - kept for backward compatibility)
    else if (cut) {
      console.log('⚠️  Processing single cut field (deprecated method)');
      // Extract quantity and create multiple cut records
      const quantity = (cut as any).quantity || 1;
      console.log(`  → Creating ${quantity} cut(s) of type ${cut.type}`);

      for (let i = 0; i < quantity; i++) {
        cutRecords.push({
          fileId: cut.fileId,
          type: cut.type as any,
          status: CUT_STATUS.PENDING as any,
          statusOrder: getCutStatusOrder(CUT_STATUS.PENDING),
          origin: cut.origin as any,
          reason: cut.reason ? (cut.reason as any) : null,
          parentCutId: cut.parentCutId || null,
        } as any);
      }
    }

    console.log(`📊 Total cut records to create: ${cutRecords.length}`);

    // Add cuts to task data if any were created
    if (cutRecords.length > 0) {
      taskData.cuts = {
        create: cutRecords,
      };
    }

    return taskData;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: TaskUpdateFormData,
  ): Prisma.TaskUpdateInput {
    // Cast to extended type to access all properties
    const extendedData = formData as TaskUpdateFormData;

    // Extract known properties
    const {
      name,
      status,
      serialNumber,
      plate,
      details,
      entryDate,
      term,
      startedAt,
      finishedAt,
      paintId,
      customerId,
      sectorId,
      commission,
      price,
      // Extended properties - File arrays
      budgetIds,
      invoiceIds,
      receiptIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      fileIds,
      paintIds,
      // Single file IDs (convert to arrays for compatibility)
      budgetId,
      nfeId,
      receiptId,
      services,
      observation,
      truck,
      cut,
      cuts,
    } = extendedData as any;

    const updateData: Prisma.TaskUpdateInput = {};

    // Handle scalar fields
    if (name !== undefined) updateData.name = name;
    if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
    if (plate !== undefined) updateData.plate = plate;
    if (details !== undefined) updateData.details = details;
    if (entryDate !== undefined) updateData.entryDate = entryDate;
    if (term !== undefined) updateData.term = term;
    if (startedAt !== undefined) updateData.startedAt = startedAt;
    if (finishedAt !== undefined) updateData.finishedAt = finishedAt;
    if (price !== undefined) updateData.price = price;
    if (commission !== undefined) updateData.commission = commission as any;

    // Handle enums
    if (status !== undefined) {
      updateData.status = mapTaskStatusToPrisma(status);
      updateData.statusOrder = getTaskStatusOrder(status);
    }


    // Handle optional relations with proper null handling
    if (customerId !== undefined) {
      updateData.customer = customerId ? { connect: { id: customerId } } : { disconnect: true };
    }
    if (paintId !== undefined) {
      updateData.generalPainting = paintId ? { connect: { id: paintId } } : { disconnect: true };
    }
    if (sectorId !== undefined) {
      updateData.sector = sectorId ? { connect: { id: sectorId } } : { disconnect: true };
    }

    // Handle many-to-many file relations with set operation
    // Support both array format (budgetIds) and single ID format (budgetId)
    if (budgetIds !== undefined) {
      updateData.budgets = { set: budgetIds.map(id => ({ id })) };
    } else if (budgetId !== undefined) {
      updateData.budgets = budgetId ? { set: [{ id: budgetId }] } : { set: [] };
    }

    if (invoiceIds !== undefined) {
      updateData.invoices = { set: invoiceIds.map(id => ({ id })) };
    } else if (nfeId !== undefined) {
      updateData.invoices = nfeId ? { set: [{ id: nfeId }] } : { set: [] };
    }

    if (receiptIds !== undefined) {
      updateData.receipts = { set: receiptIds.map(id => ({ id })) };
    } else if (receiptId !== undefined) {
      updateData.receipts = receiptId ? { set: [{ id: receiptId }] } : { set: [] };
    }

    if (reimbursementIds !== undefined) {
      updateData.reimbursements = { set: reimbursementIds.map(id => ({ id })) };
    }
    if (reimbursementInvoiceIds !== undefined) {
      updateData.invoiceReimbursements = { set: reimbursementInvoiceIds.map(id => ({ id })) };
    }
    if (fileIds !== undefined) {
      updateData.artworks = { set: fileIds.map(id => ({ id })) };
    }
    if (paintIds !== undefined) {
      updateData.logoPaints = { set: paintIds.map(id => ({ id })) };
    }

    // Handle observation update
    if (observation !== undefined) {
      if (observation === null) {
        updateData.observation = { delete: true };
      } else {
        const { fileIds: obsFileIds, ...obsData } = observation;
        updateData.observation = {
          upsert: {
            create: {
              ...obsData,
              files:
                obsFileIds && obsFileIds.length > 0
                  ? { connect: obsFileIds.map(id => ({ id })) }
                  : undefined,
            },
            update: {
              ...obsData,
              files: obsFileIds !== undefined ? { set: obsFileIds.map(id => ({ id })) } : undefined,
            },
          },
        };
      }
    }

    // Handle services update - replace all existing services
    if (services !== undefined) {
      updateData.services = {
        deleteMany: {}, // Delete all existing services
        create: services.map(service => ({
          status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
          statusOrder:
            service.statusOrder ||
            getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
          description: service.description,
          startedAt: service.startedAt || null,
          finishedAt: service.finishedAt || null,
        })),
      };
    }

    // Handle truck update
    if (truck !== undefined) {
      if (truck === null) {
        updateData.truck = { delete: true };
      } else {
        const truckCreateData = {
          xPosition: truck.xPosition ?? null,
          yPosition: truck.yPosition ?? null,
          garage: truck.garageId ? { connect: { id: truck.garageId } } : undefined,
        };

        const truckUpdateData: any = {};
        if (truck.xPosition !== undefined) truckUpdateData.xPosition = truck.xPosition ?? null;
        if (truck.yPosition !== undefined) truckUpdateData.yPosition = truck.yPosition ?? null;
        if (truck.garageId !== undefined) {
          truckUpdateData.garage =
            truck.garageId === null ? { disconnect: true } : { connect: { id: truck.garageId } };
        }

        updateData.truck = {
          upsert: {
            create: truckCreateData,
            update: truckUpdateData,
          },
        };
      }
    }

    // Handle cut update - support both single cut and multiple cuts
    const shouldUpdateCuts = cut !== undefined || cuts !== undefined;

    if (shouldUpdateCuts) {
      const cutRecords: any[] = [];

      // DEBUG: Log what we're receiving
      console.log('🔍 UPDATE TASK - Cut fields received:', {
        hasCut: cut !== undefined,
        hasCuts: cuts !== undefined,
        cutsIsArray: Array.isArray(cuts),
        cutsLength: Array.isArray(cuts) ? cuts.length : 'N/A',
        cutData: cut,
        cutsData: cuts,
      });

      // Handle multiple cuts field (preferred way)
      if (cuts !== undefined && cuts !== null && Array.isArray(cuts)) {
        console.log('✅ Processing cuts array (preferred method)');
        for (const cutItem of cuts) {
          // If quantity is specified, create multiple records
          const quantity = (cutItem as any).quantity || 1;
          console.log(`  → Creating ${quantity} cut(s) of type ${cutItem.type}`);
          for (let i = 0; i < quantity; i++) {
            cutRecords.push({
              fileId: cutItem.fileId,
              type: cutItem.type as any,
              status: CUT_STATUS.PENDING as any,
              statusOrder: getCutStatusOrder(CUT_STATUS.PENDING),
              origin: cutItem.origin as any,
              reason: cutItem.reason ? (cutItem.reason as any) : null,
              parentCutId: cutItem.parentCutId || null,
            } as any);
          }
        }
      }
      // Handle single cut field ONLY if cuts array is not present (deprecated - kept for backward compatibility)
      else if (cut !== undefined && cut !== null) {
        console.log('⚠️  Processing single cut field (deprecated method)');
        // Extract quantity and create multiple cut records
        const quantity = (cut as any).quantity || 1;
        console.log(`  → Creating ${quantity} cut(s) of type ${cut.type}`);

        for (let i = 0; i < quantity; i++) {
          cutRecords.push({
            fileId: cut.fileId,
            type: cut.type as any,
            status: CUT_STATUS.PENDING as any,
            statusOrder: getCutStatusOrder(CUT_STATUS.PENDING),
            origin: cut.origin as any,
            reason: cut.reason ? (cut.reason as any) : null,
            parentCutId: cut.parentCutId || null,
          } as any);
        }
      }

      console.log(`📊 Total cut records to create: ${cutRecords.length}`);

      // Update cuts - replace all existing cuts with new ones
      // If both cut and cuts are null/empty, delete all cuts
      if (cutRecords.length > 0) {
        updateData.cuts = {
          deleteMany: {}, // Delete all existing cuts
          create: cutRecords, // Create new cuts
        };
      } else if (
        (cut === null && cuts === undefined) ||
        cuts === null ||
        (cuts !== undefined && cuts.length === 0)
      ) {
        // Delete all cuts if explicitly set to null or empty array
        updateData.cuts = { deleteMany: {} };
      }
    }

    return updateData;
  }

  protected mapIncludeToDatabaseInclude(include?: TaskInclude): Prisma.TaskInclude | undefined {
    if (!include) {
      return this.getDefaultInclude();
    }

    const databaseInclude: any = {};

    Object.keys(include).forEach(key => {
      const value = include[key as keyof TaskInclude];

      if (typeof value === 'boolean') {
        // Handle field name mappings for backwards compatibility
        // Frontend might use old singular/Portuguese names, map them to new plural English names
        if (key === 'paints') {
          databaseInclude.logoPaints = value;
        } else if (key === 'airbrushings') {
          databaseInclude.airbrushing = value;
        } else if (key === 'reimbursements') {
          databaseInclude.reimbursements = value;
        } else if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = value;
        } else {
          databaseInclude[key] = value;
        }
      } else if (typeof value === 'object' && value !== null && 'include' in value) {
        // Handle nested includes with field name mappings
        if (key === 'paints') {
          databaseInclude.logoPaints = { include: value.include };
        } else if (key === 'airbrushings') {
          databaseInclude.airbrushing = { include: value.include, orderBy: (value as any).orderBy };
        } else if (key === 'reimbursements') {
          databaseInclude.reimbursements = { include: value.include };
        } else if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = { include: value.include };
        } else {
          databaseInclude[key] = { include: value.include };
        }
      }
    });

    return databaseInclude as Prisma.TaskInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: TaskOrderBy,
  ): Prisma.TaskOrderByWithRelationInput | undefined {
    return orderBy as Prisma.TaskOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: TaskWhere): Prisma.TaskWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.TaskWhereInput;
  }

  protected getDefaultInclude(): Prisma.TaskInclude {
    return DEFAULT_TASK_INCLUDE;
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: TaskCreateFormData,
    options?: CreateOptions<TaskInclude>,
  ): Promise<Task> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.task.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      super.logError('criar tarefa', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<TaskInclude>,
  ): Promise<Task | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.task.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      super.logError(`buscar tarefa por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<TaskInclude>,
  ): Promise<Task[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.task.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      super.logError('buscar tarefas por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<TaskOrderBy, TaskWhere, TaskInclude>,
  ): Promise<FindManyResult<Task>> {
    // Handle both TaskGetManyFormData format (with limit) and FindManyOptions format (with take)
    const queryOptions = (options as any) || {};
    const { where, orderBy, page = 1, include } = queryOptions;
    const take = queryOptions.take || queryOptions.limit || 20;
    const skip = Math.max(0, (page - 1) * take);

    const mappedWhere = this.mapWhereToDatabaseWhere(where);
    const countOptions = mappedWhere ? { where: mappedWhere } : undefined;

    const [total, tasks] = await Promise.all([
      transaction.task.count(countOptions),
      transaction.task.findMany({
        where: mappedWhere,
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { statusOrder: 'asc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    // Verify count matches expectations
    if (total > 0 && tasks.length === 0 && skip === 0) {
      this.logger.warn('[TaskRepository] WARNING: Count returned records but findMany returned empty!');
    }

    return {
      data: tasks.map(task => this.mapDatabaseEntityToEntity(task)),
      meta: super.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: TaskUpdateFormData,
    options?: UpdateOptions<TaskInclude>,
  ): Promise<Task> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.task.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      super.logError(`atualizar tarefa ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Task> {
    try {
      const result = await transaction.task.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      super.logError(`deletar tarefa ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: TaskWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.task.count(whereInput ? { where: whereInput } : undefined);
    } catch (error) {
      super.logError('contar tarefas', error, { where });
      throw error;
    }
  }
}
