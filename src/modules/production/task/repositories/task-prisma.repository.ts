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
  getCommissionStatusOrder,
  getServiceOrderStatusOrder,
  getCutStatusOrder,
  mapTaskStatusToPrisma,
  mapServiceOrderStatusToPrisma,
  mapWhereClause,
  transformPaintColorPreview,
} from '../../../../utils';

// =====================
// Query Pattern Definitions
// =====================

/**
 * Minimal select for list/table views - only essential fields
 * Use for: Preparation page, Schedule page, History tables
 */
const TASK_SELECT_MINIMAL: Prisma.TaskSelect = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  term: true,
  forecastDate: true,
  customerId: true,
  sectorId: true,
  createdAt: true,
  updatedAt: true,
  // Minimal relations
  sector: {
    select: { id: true, name: true },
  },
  customer: {
    select: { id: true, fantasyName: true }, // Only fantasyName for list views
  },
};

/**
 * Card select for grid/card views - includes more context
 * Use for: Card-based layouts, Kanban boards
 */
const TASK_SELECT_CARD: Prisma.TaskSelect = {
  ...TASK_SELECT_MINIMAL,
  details: true,
  entryDate: true,
  startedAt: true,
  finishedAt: true,
  commission: true,
  commissionOrder: true,
  createdById: true,
  // Additional relations
  createdBy: {
    select: { id: true, name: true },
  },
  truck: {
    select: {
      id: true,
      plate: true,
      spot: true,
    },
  },
  // Service orders with minimal data
  serviceOrders: {
    select: {
      id: true,
      status: true,
      type: true,
    },
  },
};

/**
 * Schedule select - optimized for schedule/calendar views
 * Use for: Schedule page, Gantt charts
 */
const TASK_SELECT_SCHEDULE: Prisma.TaskSelect = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  entryDate: true,
  term: true,
  startedAt: true,
  finishedAt: true,
  forecastDate: true,
  customerId: true,
  sectorId: true,
  createdAt: true,
  updatedAt: true,
  // Essential relations for scheduling
  sector: {
    select: { id: true, name: true },
  },
  customer: {
    select: { id: true, fantasyName: true },
  },
  truck: {
    select: {
      id: true,
      plate: true,
      spot: true,
      category: true,
    },
  },
  serviceOrders: {
    select: {
      id: true,
      status: true,
      type: true,
      assignedToId: true,
      assignedTo: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ type: 'asc' as const }, { position: 'asc' as const }],
  },
};

/**
 * Preparation select - optimized for preparation workflow
 * Use for: Preparation page, Pre-production tasks
 */
const TASK_SELECT_PREPARATION: Prisma.TaskSelect = {
  ...TASK_SELECT_MINIMAL,
  details: true,
  commission: true,
  commissionOrder: true,
  paintId: true,
  // Paint info without formulas
  generalPainting: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      colorPreview: true,
      paintType: {
        select: { id: true, name: true },
      },
      paintBrand: {
        select: { id: true, name: true },
      },
    },
  },
  logoPaints: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      colorPreview: true,
      paintType: {
        select: { id: true, name: true },
      },
      paintBrand: {
        select: { id: true, name: true },
      },
    },
  },
  serviceOrders: {
    select: {
      id: true,
      status: true,
      type: true,
      description: true,
      assignedToId: true,
      assignedTo: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ type: 'asc' as const }, { position: 'asc' as const }],
  },
  truck: {
    select: {
      id: true,
      plate: true,
      chassisNumber: true,
      spot: true,
      category: true,
      implementType: true,
    },
  },
};

/**
 * Full include for detail views - all relations loaded
 * Use for: Task detail page, Edit forms
 */
const DEFAULT_TASK_INCLUDE: Prisma.TaskInclude = {
  sector: { select: { id: true, name: true } },
  customer: { select: { id: true, fantasyName: true, cnpj: true } },
  invoiceTo: { select: { id: true, fantasyName: true } }, // Removed cnpj - not displayed anywhere
  pricing: {
    include: {
      items: { orderBy: { position: 'asc' } },
      layoutFile: true,
    },
  },
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
  // Paint info without formulas (formulas are heavy and rarely needed)
  generalPainting: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      manufacturer: true,
      tags: true,
      colorPreview: true,
      colorOrder: true,
      paintType: {
        select: {
          id: true,
          name: true,
          needGround: true,
        },
      },
      paintBrand: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  artworks: {
    select: {
      id: true,
      fileId: true,
      status: true,
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
  },
  logoPaints: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      manufacturer: true,
      tags: true,
      colorPreview: true,
      colorOrder: true,
      paintType: {
        select: {
          id: true,
          name: true,
          needGround: true,
        },
      },
      paintBrand: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  serviceOrders: {
    include: {
      assignedTo: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: [{ type: 'asc' }, { position: 'asc' }],
  },
  truck: {
    select: {
      id: true,
      plate: true,
      chassisNumber: true,
      spot: true,
      category: true,
      implementType: true,
      // Layout references for detail page
      leftSideLayoutId: true,
      rightSideLayoutId: true,
      backSideLayoutId: true,
      // Don't include full layout data by default - fetch separately when needed
      // This reduces payload by 60-70% for tasks with layouts
    },
  },
  airbrushings: {
    include: {
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
      artworks: {
        select: {
          id: true,
          fileId: true,
          status: true,
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
      },
    },
    orderBy: { createdAt: 'asc' },
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
  representatives: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isActive: true,
    },
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

  // =====================
  // Query Pattern Selection
  // =====================

  /**
   * Determines optimal query pattern based on context
   */
  private getOptimalQueryPattern(
    options?: FindManyOptions<TaskOrderBy, TaskWhere, TaskInclude>,
  ): any {
    // If specific includes requested, use custom mapping
    if (options?.include) {
      return { include: this.mapIncludeToDatabaseInclude(options.include) };
    }

    // Check where clause to determine context
    const where = options?.where as any;

    // Schedule context: filtering by dates or forecast
    if (where?.forecastDate || where?.forecastDateRange || where?.termRange) {
      return { select: TASK_SELECT_SCHEDULE };
    }

    // Preparation context: filtering by preparation-related flags
    if (where?.shouldDisplayInPreparation || where?.hasIncompleteServiceOrders) {
      return { select: TASK_SELECT_PREPARATION };
    }

    // Default to minimal for list views
    return { select: TASK_SELECT_MINIMAL };
  }

  // =====================
  // Mapping Methods
  // =====================

  protected mapDatabaseEntityToEntity(databaseEntity: any): Task {
    const task: Task = {
      ...databaseEntity,
      price: databaseEntity.price ? Number(databaseEntity.price) : null,
    };

    // Transform generalPainting.colorPreview path to URL
    if (task.generalPainting) {
      task.generalPainting = transformPaintColorPreview(task.generalPainting);
    }

    // Transform logoPaints colorPreview paths to URLs
    if (task.logoPaints && Array.isArray(task.logoPaints)) {
      task.logoPaints = task.logoPaints.map((paint: any) => transformPaintColorPreview(paint));
    }

    // Transform task artworks from nested Artwork+File structure to flattened File structure
    if (task.artworks && Array.isArray(task.artworks)) {
      task.artworks = task.artworks.map((artwork: any) => {
        if (artwork.file) {
          return {
            id: artwork.file.id,
            artworkId: artwork.id,
            status: artwork.status,
            filename: artwork.file.filename,
            originalName: artwork.file.originalName,
            path: artwork.file.path,
            mimetype: artwork.file.mimetype,
            size: artwork.file.size,
            thumbnailUrl: artwork.file.thumbnailUrl,
            createdAt: artwork.file.createdAt,
            updatedAt: artwork.file.updatedAt,
          };
        }
        return artwork;
      });
    }

    // Transform airbrushing artworks
    if (task.airbrushings && Array.isArray(task.airbrushings)) {
      task.airbrushings = task.airbrushings.map((airbrushing: any) => {
        if (airbrushing.artworks && Array.isArray(airbrushing.artworks)) {
          return {
            ...airbrushing,
            artworks: airbrushing.artworks.map((artwork: any) => {
              if (artwork.file) {
                return {
                  id: artwork.file.id,
                  artworkId: artwork.id,
                  status: artwork.status,
                  filename: artwork.file.filename,
                  originalName: artwork.file.originalName,
                  path: artwork.file.path,
                  mimetype: artwork.file.mimetype,
                  size: artwork.file.size,
                  thumbnailUrl: artwork.file.thumbnailUrl,
                  createdAt: artwork.file.createdAt,
                  updatedAt: artwork.file.updatedAt,
                };
              }
              return artwork;
            }),
          };
        }
        return airbrushing;
      });
    }

    return task;
  }

  // Override create to handle newRepresentatives
  async create(
    data: TaskCreateFormData,
    options?: CreateOptions<TaskInclude>,
    tx?: PrismaTransaction,
  ): Promise<Task> {
    const prismaClient = tx || this.prisma;
    const { newRepresentatives, ...dataWithoutNewReps } = data as any;

    // If there are new representatives to create, create them first
    let additionalRepIds: string[] = [];
    if (newRepresentatives && newRepresentatives.length > 0) {
      const createdReps = await Promise.all(
        newRepresentatives.map(repData =>
          prismaClient.representative.create({
            data: {
              ...repData,
              customerId: repData.customerId || data.customerId,
              password: repData.password || null,
            },
          }),
        ),
      );

      additionalRepIds = createdReps.map(rep => rep.id);
    }

    // Add the new representative IDs to the existing ones
    if (additionalRepIds.length > 0) {
      const existingRepIds = (dataWithoutNewReps.representativeIds || []) as string[];
      dataWithoutNewReps.representativeIds = [...existingRepIds, ...additionalRepIds];
    }

    // Call the concrete implementation (not super, since it's abstract in base)
    return this.createWithTransaction(tx || this.prisma, dataWithoutNewReps, options);
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: TaskCreateFormData,
  ): Prisma.TaskCreateInput {
    const extendedData = formData as TaskCreateFormData;

    const {
      name,
      status,
      serialNumber,
      details,
      entryDate,
      term,
      startedAt,
      finishedAt,
      forecastDate,
      paintId,
      customerId,
      invoiceToId,
      sectorId,
      commission,
      budgetIds,
      invoiceIds,
      receiptIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      artworkIds,
      baseFileIds,
      pricingId,
      paintIds,
      representativeIds,
      serviceOrders,
      observation,
      truck,
      cut,
      cuts,
    } = extendedData;

    const taskData: Prisma.TaskCreateInput = {
      name,
      status: mapTaskStatusToPrisma(status || TASK_STATUS.PREPARATION),
      statusOrder: getTaskStatusOrder(status || TASK_STATUS.PREPARATION),
      commission: (commission as any) || 'NO_COMMISSION',
      commissionOrder: getCommissionStatusOrder((commission as string) || 'NO_COMMISSION'),
    };

    if (serialNumber !== undefined) taskData.serialNumber = serialNumber;
    if (details !== undefined) taskData.details = details;
    if (entryDate !== undefined) taskData.entryDate = entryDate;
    if (term !== undefined) taskData.term = term;
    if (startedAt !== undefined) taskData.startedAt = startedAt;
    if (finishedAt !== undefined) taskData.finishedAt = finishedAt;
    if (forecastDate !== undefined) taskData.forecastDate = forecastDate;

    if (customerId) taskData.customer = { connect: { id: customerId } };
    if (invoiceToId) taskData.invoiceTo = { connect: { id: invoiceToId } };
    if (paintId) taskData.generalPainting = { connect: { id: paintId } };
    if (sectorId) taskData.sector = { connect: { id: sectorId } };

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
    if (artworkIds && artworkIds.length > 0) {
      taskData.artworks = { connect: artworkIds.map(id => ({ id })) };
    }
    if (baseFileIds && baseFileIds.length > 0) {
      taskData.baseFiles = { connect: baseFileIds.map(id => ({ id })) };
    }
    if (pricingId) {
      taskData.pricing = { connect: { id: pricingId } };
    }
    if (paintIds && paintIds.length > 0) {
      taskData.logoPaints = { connect: paintIds.map(id => ({ id })) };
    }
    if (representativeIds && representativeIds.length > 0) {
      taskData.representatives = { connect: representativeIds.map(id => ({ id })) };
    }

    if (observation) {
      const { fileIds: obsFileIds, description: obsDescription, ...obsData } = observation;
      taskData.observation = {
        create: {
          ...obsData,
          description: obsDescription || '',
          files:
            obsFileIds && obsFileIds.length > 0
              ? { connect: obsFileIds.map(id => ({ id })) }
              : undefined,
        },
      };
    }

    const creatorId = (extendedData as any).createdById;
    if (serviceOrders && serviceOrders.length > 0 && creatorId) {
      taskData.serviceOrders = {
        create: serviceOrders.map((service, index) => ({
          status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
          statusOrder:
            service.statusOrder ||
            getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
          type: (service.type || 'PRODUCTION') as any,
          description: service.description || '',
          position: index,
          ...(service.assignedToId
            ? { assignedTo: { connect: { id: service.assignedToId } } }
            : {}),
          startedAt: service.startedAt || null,
          finishedAt: service.finishedAt || null,
          createdBy: { connect: { id: (service as any).createdById || creatorId } },
        })),
      };
    }

    if (truck) {
      const truckData: any = {};
      if (truck.plate !== undefined) truckData.plate = truck.plate;
      if (truck.chassisNumber !== undefined) truckData.chassisNumber = truck.chassisNumber;
      if (truck.spot !== undefined) truckData.spot = truck.spot;
      if (truck.category !== undefined && truck.category !== null) {
        truckData.category = truck.category;
      }
      if (truck.implementType !== undefined && truck.implementType !== null) {
        truckData.implementType = truck.implementType;
      }
      taskData.truck = { create: truckData };
    }

    // Handle cuts
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

    if (cuts && Array.isArray(cuts)) {
      for (const cutItem of cuts) {
        if (!cutItem.fileId) continue;
        const quantity = (cutItem as any).quantity || 1;
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
    } else if (cut) {
      if (cut.fileId) {
        const quantity = (cut as any).quantity || 1;
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
    }

    if (cutRecords.length > 0) {
      taskData.cuts = {
        create: cutRecords,
      };
    }

    // Handle airbrushings
    const airbrushings = (extendedData as any).airbrushings;
    if (airbrushings && Array.isArray(airbrushings) && airbrushings.length > 0) {
      taskData.airbrushings = {
        create: airbrushings.map((item: any) => ({
          status: item.status || 'PENDING',
          price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
          startDate: item.startDate || null,
          finishDate: item.finishDate || null,
          receipts:
            item.receiptIds && item.receiptIds.length > 0
              ? { connect: item.receiptIds.map((id: string) => ({ id })) }
              : undefined,
          invoices:
            item.invoiceIds && item.invoiceIds.length > 0
              ? { connect: item.invoiceIds.map((id: string) => ({ id })) }
              : undefined,
          artworks:
            item.artworkIds && item.artworkIds.length > 0
              ? { connect: item.artworkIds.map((id: string) => ({ id })) }
              : undefined,
        })),
      };
    }

    return taskData;
  }

  // Override update to handle newRepresentatives
  async update(
    id: string,
    data: TaskUpdateFormData,
    options?: UpdateOptions<TaskInclude>,
    tx?: PrismaTransaction,
  ): Promise<Task> {
    const prismaClient = tx || this.prisma;
    const { newRepresentatives, ...dataWithoutNewReps } = data as any;

    let additionalRepIds: string[] = [];
    if (newRepresentatives && newRepresentatives.length > 0) {
      const task = await prismaClient.task.findUnique({
        where: { id },
        select: { customerId: true },
      });

      const createdReps = await Promise.all(
        newRepresentatives.map(repData =>
          prismaClient.representative.create({
            data: {
              ...repData,
              customerId: repData.customerId || task?.customerId,
              password: repData.password || null,
            },
          }),
        ),
      );

      additionalRepIds = createdReps.map(rep => rep.id);
    }

    if (additionalRepIds.length > 0) {
      const existingRepIds = (dataWithoutNewReps.representativeIds || []) as string[];
      dataWithoutNewReps.representativeIds = [...existingRepIds, ...additionalRepIds];
    }

    // Call the concrete implementation (not super, since it's abstract in base)
    return this.updateWithTransaction(tx || this.prisma, id, dataWithoutNewReps, options);
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: TaskUpdateFormData,
    userId?: string,
  ): Prisma.TaskUpdateInput {
    this.logger.log(
      '[mapUpdateFormDataToDatabaseUpdateInput] Incoming formData:',
      JSON.stringify(formData, null, 2),
    );

    const extendedData = formData as TaskUpdateFormData;

    const {
      name,
      status,
      serialNumber,
      details,
      entryDate,
      term,
      startedAt,
      finishedAt,
      forecastDate,
      paintId,
      customerId,
      invoiceToId,
      sectorId,
      commission,
      budgetIds,
      invoiceIds,
      receiptIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      artworkIds,
      baseFileIds,
      pricingId,
      paintIds,
      representativeIds,
      serviceOrders,
      observation,
      truck,
      cut,
      cuts,
    } = extendedData as any;

    const updateData: Prisma.TaskUpdateInput = {};

    if (name !== undefined) updateData.name = name;
    if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
    if (details !== undefined) updateData.details = details;
    if (entryDate !== undefined) updateData.entryDate = entryDate;
    if (term !== undefined) updateData.term = term;
    if (startedAt !== undefined) updateData.startedAt = startedAt;
    if (finishedAt !== undefined) updateData.finishedAt = finishedAt;
    if (forecastDate !== undefined) updateData.forecastDate = forecastDate;

    if (commission !== undefined) {
      updateData.commission = commission as any;
      updateData.commissionOrder = getCommissionStatusOrder(commission as string);
    }

    if (status !== undefined) {
      updateData.status = mapTaskStatusToPrisma(status);
      updateData.statusOrder = getTaskStatusOrder(status);
    }

    if (customerId !== undefined) {
      updateData.customer = customerId ? { connect: { id: customerId } } : { disconnect: true };
    }
    if (invoiceToId !== undefined) {
      updateData.invoiceTo = invoiceToId ? { connect: { id: invoiceToId } } : { disconnect: true };
    }
    if (paintId !== undefined) {
      updateData.generalPainting = paintId ? { connect: { id: paintId } } : { disconnect: true };
    }
    if (sectorId !== undefined) {
      updateData.sector = sectorId ? { connect: { id: sectorId } } : { disconnect: true };
    }

    if (budgetIds !== undefined) {
      updateData.budgets = { set: budgetIds.map(id => ({ id })) };
    }
    if (invoiceIds !== undefined) {
      updateData.invoices = { set: invoiceIds.map(id => ({ id })) };
    }
    if (receiptIds !== undefined) {
      updateData.receipts = { set: receiptIds.map(id => ({ id })) };
    }
    if (reimbursementIds !== undefined) {
      updateData.reimbursements = { set: reimbursementIds.map(id => ({ id })) };
    }
    if (reimbursementInvoiceIds !== undefined) {
      updateData.invoiceReimbursements = { set: reimbursementInvoiceIds.map(id => ({ id })) };
    }
    if (artworkIds !== undefined) {
      updateData.artworks = { set: artworkIds.map(id => ({ id })) };
    }
    if (baseFileIds !== undefined) {
      updateData.baseFiles = { set: baseFileIds.map(id => ({ id })) };
    }
    if (pricingId !== undefined) {
      updateData.pricing = pricingId ? { connect: { id: pricingId } } : { disconnect: true };
    }
    if (paintIds !== undefined) {
      updateData.logoPaints = { set: paintIds.map(id => ({ id })) };
    }
    if (representativeIds !== undefined) {
      updateData.representatives = { set: representativeIds.map(id => ({ id })) };
    }

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

    if (serviceOrders !== undefined) {
      const existingOrdersWithIndex: { service: any; index: number }[] = [];
      const newOrdersWithIndex: { service: any; index: number }[] = [];

      serviceOrders.forEach((service: any, index: number) => {
        if (service.id) {
          existingOrdersWithIndex.push({ service, index });
        } else {
          newOrdersWithIndex.push({ service, index });
        }
      });

      const serviceOrdersUpdate: any = {};

      if (existingOrdersWithIndex.length > 0) {
        serviceOrdersUpdate.updateMany = existingOrdersWithIndex.map(({ service, index }) => ({
          where: { id: service.id },
          data: {
            ...(service.status !== undefined && {
              status: mapServiceOrderStatusToPrisma(service.status),
            }),
            ...(service.status !== undefined && {
              statusOrder: getServiceOrderStatusOrder(service.status),
            }),
            ...(service.type !== undefined && { type: service.type }),
            ...(service.description !== undefined && { description: service.description }),
            ...(service.observation !== undefined && { observation: service.observation }),
            ...(service.startedAt !== undefined && { startedAt: service.startedAt }),
            ...(service.finishedAt !== undefined && { finishedAt: service.finishedAt }),
            ...(service.assignedToId !== undefined && { assignedToId: service.assignedToId }),
            position: index,
          },
        }));
      }

      if (newOrdersWithIndex.length > 0) {
        serviceOrdersUpdate.create = newOrdersWithIndex.map(({ service, index }) => {
          const serviceData: any = {
            status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
            statusOrder:
              service.statusOrder ||
              getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
            type: service.type || 'PRODUCTION',
            description: service.description,
            observation: service.observation || null,
            position: index,
            startedAt: service.startedAt || null,
            finishedAt: service.finishedAt || null,
            createdBy: userId ? { connect: { id: userId } } : undefined,
          };

          if (service.assignedToId) {
            serviceData.assignedTo = { connect: { id: service.assignedToId } };
          }

          return serviceData;
        });
      }

      if (Object.keys(serviceOrdersUpdate).length > 0) {
        updateData.serviceOrders = serviceOrdersUpdate;
      }
    }

    if (truck !== undefined) {
      if (truck === null) {
        updateData.truck = { delete: true };
      } else {
        const truckCreateData: any = {};
        const truckUpdateData: any = {};

        if (truck.plate !== undefined) {
          truckCreateData.plate = truck.plate;
          truckUpdateData.plate = truck.plate;
        }
        if (truck.chassisNumber !== undefined) {
          truckCreateData.chassisNumber = truck.chassisNumber;
          truckUpdateData.chassisNumber = truck.chassisNumber;
        }
        if (truck.spot !== undefined) {
          truckCreateData.spot = truck.spot;
          truckUpdateData.spot = truck.spot;
        }
        if (truck.category !== undefined && truck.category !== '') {
          truckCreateData.category = truck.category;
          truckUpdateData.category = truck.category;
        }
        if (truck.implementType !== undefined && truck.implementType !== '') {
          truckCreateData.implementType = truck.implementType;
          truckUpdateData.implementType = truck.implementType;
        }

        if (Object.keys(truckCreateData).length > 0 || Object.keys(truckUpdateData).length > 0) {
          updateData.truck = {
            upsert: {
              create: truckCreateData,
              update: truckUpdateData,
            },
          };
        }
      }
    }

    const shouldUpdateCuts = cut !== undefined || cuts !== undefined;

    if (shouldUpdateCuts) {
      const cutRecords: any[] = [];

      if (cuts !== undefined && cuts !== null && Array.isArray(cuts)) {
        for (const cutItem of cuts) {
          if (!cutItem.fileId) continue;
          const quantity = (cutItem as any).quantity || 1;
          const cutStatus = (cutItem as any).status || CUT_STATUS.PENDING;
          for (let i = 0; i < quantity; i++) {
            cutRecords.push({
              fileId: cutItem.fileId,
              type: cutItem.type as any,
              status: cutStatus as any,
              statusOrder: getCutStatusOrder(cutStatus),
              origin: cutItem.origin as any,
              reason: cutItem.reason ? (cutItem.reason as any) : null,
              parentCutId: cutItem.parentCutId || null,
            } as any);
          }
        }
      } else if (cut !== undefined && cut !== null) {
        if (cut.fileId) {
          const quantity = (cut as any).quantity || 1;
          const cutStatus = (cut as any).status || CUT_STATUS.PENDING;
          for (let i = 0; i < quantity; i++) {
            cutRecords.push({
              fileId: cut.fileId,
              type: cut.type as any,
              status: cutStatus as any,
              statusOrder: getCutStatusOrder(cutStatus),
              origin: cut.origin as any,
              reason: cut.reason ? (cut.reason as any) : null,
              parentCutId: cut.parentCutId || null,
            } as any);
          }
        }
      }

      if (cutRecords.length > 0) {
        // Use create-only (additive) when cuts array was provided.
        // The deleteMany+create pattern destroys existing cuts (including in-progress ones).
        // Callers that need to remove specific cuts should use removeCutIds instead.
        updateData.cuts = {
          create: cutRecords,
        };
      } else if (
        (cut === null && cuts === undefined) ||
        cuts === null ||
        (cuts !== undefined && cuts.length === 0)
      ) {
        updateData.cuts = { deleteMany: {} };
      }
    }

    const airbrushings = (extendedData as any).airbrushings;

    if (airbrushings !== undefined) {
      if (airbrushings === null || (Array.isArray(airbrushings) && airbrushings.length === 0)) {
        updateData.airbrushings = { deleteMany: {} };
      } else if (Array.isArray(airbrushings) && airbrushings.length > 0) {
        const idsToKeep = airbrushings
          .filter(
            (item: any) =>
              item.id && typeof item.id === 'string' && !item.id.startsWith('airbrushing-'),
          )
          .map((item: any) => item.id);

        if (idsToKeep.length > 0) {
          updateData.airbrushings = {
            deleteMany: { id: { notIn: idsToKeep } },
          };
          this.logger.log(
            `[mapUpdateFormDataToDatabaseUpdateInput] Airbrushings: keeping ${idsToKeep.length} existing, deleting others`,
          );
        }
      }
    }

    this.logger.log(
      '[mapUpdateFormDataToDatabaseUpdateInput] Final updateData:',
      JSON.stringify(updateData, null, 2),
    );

    return updateData;
  }

  private processNestedInclude(value: any): any {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'object' && value !== null) {
      if ('include' in value) {
        const processedInclude: any = {};
        Object.keys(value.include).forEach(nestedKey => {
          processedInclude[nestedKey] = this.processNestedInclude(value.include[nestedKey]);
        });

        return {
          ...value,
          include: processedInclude,
        };
      }

      const processed: any = {};
      Object.keys(value).forEach(k => {
        processed[k] = this.processNestedInclude(value[k]);
      });
      return processed;
    }

    return value;
  }

  protected mapIncludeToDatabaseInclude(include?: TaskInclude): Prisma.TaskInclude | undefined {
    if (!include) {
      return this.getDefaultInclude();
    }

    this.logger.log(
      '[mapIncludeToDatabaseInclude] Input include:',
      JSON.stringify(include, null, 2),
    );

    const databaseInclude: any = { ...this.getDefaultInclude() };

    Object.keys(include).forEach(key => {
      const value = include[key as keyof TaskInclude];

      if (typeof value === 'boolean') {
        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = value;
        } else if (key === 'serviceOrders') {
          if (value === false) {
            databaseInclude.serviceOrders = false;
          }
        } else {
          if (value === false || !databaseInclude[key]) {
            databaseInclude[key] = value;
          }
        }
      } else if (typeof value === 'object' && value !== null && 'include' in value) {
        const processedValue = this.processNestedInclude(value);

        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = processedValue;
        } else if (key === 'serviceOrders') {
          const existingValue = databaseInclude.serviceOrders;
          if (existingValue && typeof existingValue === 'object' && 'include' in existingValue) {
            databaseInclude.serviceOrders = {
              ...existingValue,
              include: { ...existingValue.include, ...processedValue.include },
            };
          } else {
            databaseInclude.serviceOrders = processedValue;
          }
        } else {
          const existingValue = databaseInclude[key];
          if (existingValue && typeof existingValue === 'object' && 'include' in existingValue) {
            databaseInclude[key] = {
              ...existingValue,
              include: { ...existingValue.include, ...processedValue.include },
            };
          } else {
            databaseInclude[key] = processedValue;
          }
        }
      }
    });

    this.logger.log(
      '[mapIncludeToDatabaseInclude] Output include for Prisma:',
      JSON.stringify(databaseInclude, null, 2),
    );

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

  // =====================
  // Transaction Methods
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: TaskCreateFormData,
    options?: CreateOptions<TaskInclude>,
  ): Promise<Task> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const pricingData = (data as any).pricing;
      let createdPricingId: string | null = null;

      if (
        pricingData &&
        typeof pricingData === 'object' &&
        pricingData.items &&
        Array.isArray(pricingData.items) &&
        pricingData.items.length > 0
      ) {
        const calculatedSubtotal = pricingData.items.reduce(
          (sum: number, item: any) => sum + Number(item.amount || 0),
          0,
        );
        const subtotal =
          pricingData.subtotal !== undefined ? Number(pricingData.subtotal) : calculatedSubtotal;
        const total =
          pricingData.total !== undefined ? Number(pricingData.total) : calculatedSubtotal;

        const maxBudgetNumber = await transaction.taskPricing.aggregate({
          _max: { budgetNumber: true },
        });
        const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

        const layoutFileConnect = pricingData.layoutFileId
          ? { layoutFile: { connect: { id: pricingData.layoutFileId } } }
          : {};

        const newPricing = await transaction.taskPricing.create({
          data: {
            budgetNumber: nextBudgetNumber,
            subtotal,
            total,
            discountType: pricingData.discountType || 'NONE',
            discountValue:
              pricingData.discountValue !== undefined ? Number(pricingData.discountValue) : null,
            expiresAt: pricingData.expiresAt ? new Date(pricingData.expiresAt) : new Date(),
            status: pricingData.status || 'DRAFT',
            paymentCondition: pricingData.paymentCondition || null,
            downPaymentDate: pricingData.downPaymentDate
              ? new Date(pricingData.downPaymentDate)
              : null,
            customPaymentText: pricingData.customPaymentText || null,
            guaranteeYears: pricingData.guaranteeYears || null,
            customGuaranteeText: pricingData.customGuaranteeText || null,
            customForecastDays: pricingData.customForecastDays || null,
            ...layoutFileConnect,
            items: {
              create: pricingData.items.map((item: any) => ({
                description: item.description,
                observation: item.observation || null,
                amount: Number(item.amount || 0),
                shouldSync: item.shouldSync !== false,
              })),
            },
          },
        });

        createdPricingId = newPricing.id;
      }

      if (createdPricingId) {
        createInput.pricing = {
          connect: { id: createdPricingId },
        };
      }

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
    const queryOptions = (options as any) || {};
    const { where, orderBy, page = 1, include, select } = queryOptions;
    const take = queryOptions.take || queryOptions.limit || 20;
    const skip = Math.max(0, (page - 1) * take);

    const mappedWhere = this.mapWhereToDatabaseWhere(where);
    const countOptions = mappedWhere ? { where: mappedWhere } : undefined;

    // Prioritize explicit select over include and optimal query pattern
    const useProvidedSelect = select && Object.keys(select).length > 0;
    const queryPattern = useProvidedSelect ? { select } : this.getOptimalQueryPattern(options);

    const [total, tasks] = await Promise.all([
      transaction.task.count(countOptions),
      transaction.task.findMany({
        where: mappedWhere,
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { statusOrder: 'asc' },
        skip,
        take,
        ...queryPattern,
      }),
    ]);

    if (total > 0 && tasks.length === 0 && skip === 0) {
      this.logger.warn(
        '[TaskRepository] WARNING: Count returned records but findMany returned empty!',
      );
    }

    // When using custom select, don't try to map the entity (just return as-is)
    return {
      data: useProvidedSelect
        ? (tasks as any[])
        : tasks.map(task => this.mapDatabaseEntityToEntity(task)),
      meta: super.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: TaskUpdateFormData,
    options?: UpdateOptions<TaskInclude>,
    userId?: string,
  ): Promise<Task> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data, userId);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const pricingData = (data as any).pricing;

      if (pricingData !== undefined && pricingData !== null) {
        if (
          typeof pricingData === 'object' &&
          pricingData.items &&
          Array.isArray(pricingData.items) &&
          pricingData.items.length > 0
        ) {
          const hasNewItems = pricingData.items.some((item: any) => !item.id);

          const currentTask = await transaction.task.findUnique({
            where: { id },
            select: { pricingId: true },
          });

          const calculatedSubtotal = pricingData.items.reduce(
            (sum: number, item: any) => sum + Number(item.amount || 0),
            0,
          );
          const subtotal =
            pricingData.subtotal !== undefined ? Number(pricingData.subtotal) : calculatedSubtotal;
          const total =
            pricingData.total !== undefined ? Number(pricingData.total) : calculatedSubtotal;

          if (currentTask?.pricingId) {
            const layoutFileUpdate =
              pricingData.layoutFileId !== undefined
                ? { layoutFileId: pricingData.layoutFileId }
                : {};

            await transaction.taskPricing.update({
              where: { id: currentTask.pricingId },
              data: {
                subtotal,
                total,
                discountType: pricingData.discountType || 'NONE',
                discountValue:
                  pricingData.discountValue !== undefined
                    ? Number(pricingData.discountValue)
                    : null,
                expiresAt: pricingData.expiresAt ? new Date(pricingData.expiresAt) : undefined,
                status: pricingData.status || undefined,
                paymentCondition:
                  pricingData.paymentCondition !== undefined
                    ? pricingData.paymentCondition
                    : undefined,
                downPaymentDate:
                  pricingData.downPaymentDate !== undefined
                    ? pricingData.downPaymentDate
                      ? new Date(pricingData.downPaymentDate)
                      : null
                    : undefined,
                customPaymentText:
                  pricingData.customPaymentText !== undefined
                    ? pricingData.customPaymentText
                    : undefined,
                guaranteeYears:
                  pricingData.guaranteeYears !== undefined ? pricingData.guaranteeYears : undefined,
                customGuaranteeText:
                  pricingData.customGuaranteeText !== undefined
                    ? pricingData.customGuaranteeText
                    : undefined,
                customForecastDays:
                  pricingData.customForecastDays !== undefined
                    ? pricingData.customForecastDays
                    : undefined,
                ...layoutFileUpdate,
                items: {
                  deleteMany: {},
                  create: pricingData.items.map((item: any, index: number) => ({
                    description: item.description,
                    observation: item.observation || null,
                    amount: Number(item.amount || 0),
                    shouldSync: item.shouldSync !== false,
                    position: index,
                  })),
                },
              },
            });
          } else if (hasNewItems) {
            const maxBudgetNumber = await transaction.taskPricing.aggregate({
              _max: { budgetNumber: true },
            });
            const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

            const layoutFileConnect = pricingData.layoutFileId
              ? { layoutFile: { connect: { id: pricingData.layoutFileId } } }
              : {};

            const newPricing = await transaction.taskPricing.create({
              data: {
                budgetNumber: nextBudgetNumber,
                subtotal,
                total,
                discountType: pricingData.discountType || 'NONE',
                discountValue:
                  pricingData.discountValue !== undefined
                    ? Number(pricingData.discountValue)
                    : null,
                expiresAt: pricingData.expiresAt ? new Date(pricingData.expiresAt) : new Date(),
                status: pricingData.status || 'DRAFT',
                paymentCondition: pricingData.paymentCondition || null,
                downPaymentDate: pricingData.downPaymentDate
                  ? new Date(pricingData.downPaymentDate)
                  : null,
                customPaymentText: pricingData.customPaymentText || null,
                guaranteeYears: pricingData.guaranteeYears || null,
                customGuaranteeText: pricingData.customGuaranteeText || null,
                customForecastDays: pricingData.customForecastDays || null,
                ...layoutFileConnect,
                items: {
                  create: pricingData.items.map((item: any, index: number) => ({
                    description: item.description,
                    observation: item.observation || null,
                    amount: Number(item.amount || 0),
                    shouldSync: item.shouldSync !== false,
                    position: index,
                  })),
                },
              },
            });

            updateInput.pricing = {
              connect: { id: newPricing.id },
            };
          }
        }
      }

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
