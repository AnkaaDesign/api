// repositories/task-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
import { TASK_QUOTE_STATUS_ORDER } from '../../../../constants/sortOrders';
import { TASK_QUOTE_STATUS } from '../../../../constants';
import {
  getTaskStatusOrder,
  getBonificationStatusOrder,
  getServiceOrderStatusOrder,
  getCutStatusOrder,
  mapTaskStatusToPrisma,
  mapServiceOrderStatusToPrisma,
  mapWhereClause,
  transformPaintColorPreview,
} from '../../../../utils';
import { recalcQuoteTotals } from '../../../../utils/task-quote-totals';
import { reconcileQuoteCustomerConfigs } from '../../../../utils/task-quote-customer-config-sync';

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
  cleared: true,
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
  bonification: true,
  bonificationOrder: true,
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
  cleared: true,
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
  bonification: true,
  bonificationOrder: true,
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
  quote: {
    include: {
      services: {
        orderBy: { position: 'asc' },
        include: {
          invoiceToCustomer: {
            select: { id: true, fantasyName: true, cnpj: true },
          },
        },
      },
      layoutFiles: { orderBy: { createdAt: 'asc' } },
      customerConfigs: {
        include: {
          customer: {
            select: {
              id: true,
              fantasyName: true,
              corporateName: true,
              cnpj: true,
              cpf: true,
              address: true,
              addressNumber: true,
              addressComplement: true,
              neighborhood: true,
              city: true,
              state: true,
              zipCode: true,
              stateRegistration: true,
              streetType: true,
              registrationStatus: true,
            },
          },
          installments: {
            include: { bankSlip: true },
            orderBy: { number: 'asc' as const },
          },
          responsible: { select: { id: true, name: true, role: true } },
        },
      },
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
  bankSlips: {
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
  projectFiles: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  checkinFiles: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  checkoutFiles: {
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
  responsibles: {
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

  constructor(
    protected readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {
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

    // Convert Prisma Decimal fields in nested quote relation
    if (task.quote) {
      task.quote = {
        ...task.quote,
        subtotal: task.quote.subtotal ? Number(task.quote.subtotal) : 0,
        total: task.quote.total ? Number(task.quote.total) : 0,
        services: task.quote.services?.map((service: any) => ({
          ...service,
          amount: service.amount ? Number(service.amount) : 0,
        })),
        customerConfigs: task.quote.customerConfigs?.map((config: any) => ({
          ...config,
          subtotal: config.subtotal ? Number(config.subtotal) : 0,
          total: config.total ? Number(config.total) : 0,
          installments: config.installments?.map((inst: any) => ({
            ...inst,
            amount: inst.amount ? Number(inst.amount) : 0,
            paidAmount: inst.paidAmount ? Number(inst.paidAmount) : 0,
          })),
        })),
      };
    }

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

  // Override create to handle newResponsibles
  async create(
    data: TaskCreateFormData,
    options?: CreateOptions<TaskInclude>,
    tx?: PrismaTransaction,
  ): Promise<Task> {
    const prismaClient = tx || this.prisma;
    const { newResponsibles, ...dataWithoutNewResponsibles } = data as any;

    // If there are new responsibles to create, create them first
    let additionalResponsibleIds: string[] = [];
    if (newResponsibles && newResponsibles.length > 0) {
      const createdResponsibles = await Promise.all(
        newResponsibles.map(async responsibleData => {
          const companyId = responsibleData.companyId || data.customerId;

          return prismaClient.responsible.create({
            data: {
              ...responsibleData,
              companyId,
              password: responsibleData.password || null,
            },
          });
        }),
      );

      additionalResponsibleIds = createdResponsibles.map(responsible => responsible.id);
    }

    // Add the new responsible IDs to the existing ones
    if (additionalResponsibleIds.length > 0) {
      const existingResponsibleIds = (dataWithoutNewResponsibles.responsibleIds || []) as string[];
      dataWithoutNewResponsibles.responsibleIds = [
        ...existingResponsibleIds,
        ...additionalResponsibleIds,
      ];
    }

    // Call the concrete implementation (not super, since it's abstract in base)
    return this.createWithTransaction(tx || this.prisma, dataWithoutNewResponsibles, options);
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: TaskCreateFormData,
  ): Prisma.TaskCreateInput {
    const extendedData = formData as any;

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
      cleared,
      paintId,
      customerId,
      sectorId,
      bonification,
      budgetIds,
      invoiceIds,
      receiptIds,
      bankSlipIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      artworkIds,
      baseFileIds,
      projectFileIds,
      checkinFileIds,
      checkoutFileIds,
      quoteId,
      paintIds,
      responsibleIds,
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
      bonification: (bonification as any) || 'FULL_BONIFICATION',
      bonificationOrder: getBonificationStatusOrder((bonification as string) || 'FULL_BONIFICATION'),
    };

    if (serialNumber !== undefined) taskData.serialNumber = serialNumber;
    if (details !== undefined) taskData.details = details;
    if (entryDate !== undefined) taskData.entryDate = entryDate;
    if (term !== undefined) taskData.term = term;
    if (startedAt !== undefined) taskData.startedAt = startedAt;
    if (finishedAt !== undefined) taskData.finishedAt = finishedAt;
    if (forecastDate !== undefined) taskData.forecastDate = forecastDate;
    if (cleared !== undefined) taskData.cleared = cleared;

    if (customerId) taskData.customer = { connect: { id: customerId } };
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
    if (projectFileIds && projectFileIds.length > 0) {
      taskData.projectFiles = { connect: projectFileIds.map(id => ({ id })) };
    }
    if (checkinFileIds && checkinFileIds.length > 0) {
      taskData.checkinFiles = { connect: checkinFileIds.map(id => ({ id })) };
    }
    if (checkoutFileIds && checkoutFileIds.length > 0) {
      taskData.checkoutFiles = { connect: checkoutFileIds.map(id => ({ id })) };
    }
    if (quoteId) {
      taskData.quote = { connect: { id: quoteId } };
    }
    if (paintIds && paintIds.length > 0) {
      taskData.logoPaints = { connect: paintIds.map(id => ({ id })) };
    }
    if (responsibleIds && responsibleIds.length > 0) {
      taskData.responsibles = { connect: responsibleIds.map(id => ({ id })) };
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
    // ServiceOrder.createdBy is required, so SOs can only be created when a
    // creator id is known. Surface the silent drop — otherwise a caller that
    // forgot to pass userId loses every submitted SO with no signal.
    if (serviceOrders && serviceOrders.length > 0 && !creatorId) {
      this.logger.warn(
        `[mapCreateFormDataToDatabaseCreateInput] ${serviceOrders.length} service order(s) were dropped on task create: no creator id (userId) available to set ServiceOrder.createdBy.`,
      );
    }
    if (serviceOrders && serviceOrders.length > 0 && creatorId) {
      taskData.serviceOrders = {
        create: serviceOrders.map((service, index) => ({
          status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
          statusOrder:
            service.statusOrder ||
            getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
          type: (service.type || 'PRODUCTION') as any,
          description: service.description || '',
          observation: service.observation || null,
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
      // Spot starts as null — only set to YARD_WAIT when task is cleared
      truckData.spot = truck.spot !== undefined ? truck.spot : null;
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
      // Security (B7): a newly created airbrushing can never start with a
      // non-PENDING payment status — the payment gate requires the PERSISTED
      // status to be COMPLETED, which a new record cannot be.
      for (const item of airbrushings) {
        if (
          item?.paymentStatus !== undefined &&
          item?.paymentStatus !== null &&
          item.paymentStatus !== 'PENDING'
        ) {
          throw new BadRequestException(
            'O status de pagamento só pode ser definido após a conclusão da aerografia.',
          );
        }
      }
      taskData.airbrushings = {
        create: airbrushings.map((item: any) => ({
          status: item.status || 'PENDING',
          price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
          startDate: item.startDate || null,
          finishDate: item.finishDate || null,
          startedAt: item.startedAt || null,
          finishedAt: item.finishedAt || null,
          paymentStatus: item.paymentStatus || 'PENDING',
          painter: item.painterId ? { connect: { id: item.painterId } } : undefined,
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

  // Override update to handle newResponsibles
  async update(
    id: string,
    data: TaskUpdateFormData,
    options?: UpdateOptions<TaskInclude>,
    tx?: PrismaTransaction,
  ): Promise<Task> {
    const prismaClient = tx || this.prisma;
    const { newResponsibles, ...dataWithoutNewResponsibles } = data as any;

    let additionalResponsibleIds: string[] = [];
    if (newResponsibles && newResponsibles.length > 0) {
      const task = await prismaClient.task.findUnique({
        where: { id },
        select: { customerId: true },
      });

      const createdResponsibles = await Promise.all(
        newResponsibles.map(async responsibleData => {
          const companyId = responsibleData.companyId || task?.customerId;

          return prismaClient.responsible.create({
            data: {
              ...responsibleData,
              companyId,
              password: responsibleData.password || null,
            },
          });
        }),
      );

      additionalResponsibleIds = createdResponsibles.map(responsible => responsible.id);
    }

    if (additionalResponsibleIds.length > 0) {
      const existingResponsibleIds = (dataWithoutNewResponsibles.responsibleIds || []) as string[];
      dataWithoutNewResponsibles.responsibleIds = [
        ...existingResponsibleIds,
        ...additionalResponsibleIds,
      ];
    }

    // Call the concrete implementation (not super, since it's abstract in base)
    return this.updateWithTransaction(tx || this.prisma, id, dataWithoutNewResponsibles, options);
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
      cleared,
      paintId,
      customerId,
      sectorId,
      bonification,
      budgetIds,
      invoiceIds,
      receiptIds,
      bankSlipIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      artworkIds,
      baseFileIds,
      projectFileIds,
      checkinFileIds,
      checkoutFileIds,
      quoteId,
      paintIds,
      responsibleIds,
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
    if (entryDate !== undefined) {
      updateData.entryDate = entryDate;
      // Setting an entry date means the truck has arrived — auto-clear if not already cleared
      if (entryDate !== null && cleared === undefined) {
        updateData.cleared = true;
      }
    }
    if (term !== undefined) updateData.term = term;
    if (startedAt !== undefined) updateData.startedAt = startedAt;
    if (finishedAt !== undefined) updateData.finishedAt = finishedAt;
    if (forecastDate !== undefined) {
      updateData.forecastDate = forecastDate;
      // Reset cleared when forecastDate changes, unless cleared is explicitly set in the same update
      if (cleared === undefined) {
        updateData.cleared = false;
      }
    }
    if (cleared !== undefined) updateData.cleared = cleared;

    if (bonification !== undefined) {
      updateData.bonification = bonification as any;
      updateData.bonificationOrder = getBonificationStatusOrder(bonification as string);
    }

    if (status !== undefined) {
      updateData.status = mapTaskStatusToPrisma(status);
      updateData.statusOrder = getTaskStatusOrder(status);
    }

    if (customerId !== undefined) {
      updateData.customer = customerId ? { connect: { id: customerId } } : { disconnect: true };
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
    // Bank slips (TASK_BANK_SLIPS File[] relation). Absence = preserve: only
    // rewritten when bankSlipIds was explicitly sent. Mirrors how the
    // single-update service path connects bank slips — without this branch the
    // bulk-attached bankSlipIds the batch path computes were silently dropped.
    if (bankSlipIds !== undefined) {
      updateData.bankSlips = { set: bankSlipIds.map(id => ({ id })) };
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
    if (projectFileIds !== undefined) {
      updateData.projectFiles = { set: projectFileIds.map(id => ({ id })) };
    }
    if (checkinFileIds !== undefined) {
      updateData.checkinFiles = { set: checkinFileIds.map(id => ({ id })) };
    }
    if (checkoutFileIds !== undefined) {
      updateData.checkoutFiles = { set: checkoutFileIds.map(id => ({ id })) };
    }
    if (quoteId !== undefined) {
      updateData.quote = quoteId ? { connect: { id: quoteId } } : { disconnect: true };
    }
    if (paintIds !== undefined) {
      updateData.logoPaints = { set: paintIds.map(id => ({ id })) };
    }
    if (responsibleIds !== undefined) {
      updateData.responsibles = { set: responsibleIds.map(id => ({ id })) };
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
        // Spot starts as null — only set to YARD_WAIT when task is cleared
        if (truckCreateData.spot === undefined) {
          truckCreateData.spot = null;
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
    // The single-update SERVICE path handles airbrushing create/update itself
    // (painter validation, File→Artwork resolution, per-entity changelog) and
    // delegates ONLY the notIn-delete to this mapper. The batch path has no such
    // service-layer airbrushing handling, so it opts into full create+update
    // here via the `_applyAirbrushingsFully` marker. Without the marker we keep
    // the historical delete-only behavior so single-update never double-creates.
    const applyAirbrushingsFully = (extendedData as any)._applyAirbrushingsFully === true;

    if (airbrushings !== undefined) {
      if (airbrushings === null || (Array.isArray(airbrushings) && airbrushings.length === 0)) {
        updateData.airbrushings = { deleteMany: {} };
      } else if (Array.isArray(airbrushings) && airbrushings.length > 0) {
        // A persisted airbrushing carries a real UUID id; a brand-new one sent by
        // the form has a temp id (`airbrushing-...`) or no id at all.
        const existingAirbrushings = airbrushings.filter(
          (item: any) =>
            item.id && typeof item.id === 'string' && !item.id.startsWith('airbrushing-'),
        );
        const newAirbrushings = airbrushings.filter(
          (item: any) =>
            !item.id || typeof item.id !== 'string' || item.id.startsWith('airbrushing-'),
        );
        const idsToKeep = existingAirbrushings.map((item: any) => item.id);

        if (!applyAirbrushingsFully) {
          // Single-update path: delete-only (notIn), service layer does the rest.
          if (idsToKeep.length > 0) {
            updateData.airbrushings = {
              deleteMany: { id: { notIn: idsToKeep } },
            };
            this.logger.log(
              `[mapUpdateFormDataToDatabaseUpdateInput] Airbrushings: keeping ${idsToKeep.length} existing, deleting others`,
            );
          }
        } else {
          // Batch path: full create + update + notIn-delete in one nested write.
          //
          // Build a scalar/relation create payload for a new airbrushing.
          // NOTE: artworks are intentionally NOT touched here — the single-update
          // service path resolves File IDs → Artwork entity IDs via a service
          // helper the repository cannot reach. Leaving them out preserves
          // existing artworks (absence = preserve) instead of risking a wrong set.
          const buildCreate = (item: any) => ({
            status: item.status || 'PENDING',
            price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
            startDate: item.startDate || null,
            finishDate: item.finishDate || null,
            startedAt: item.startedAt || null,
            finishedAt: item.finishedAt || null,
            paymentStatus: item.paymentStatus || 'PENDING',
            painter: item.painterId ? { connect: { id: item.painterId } } : undefined,
            receipts:
              item.receiptIds && item.receiptIds.length > 0
                ? { connect: item.receiptIds.map((fid: string) => ({ id: fid })) }
                : undefined,
            invoices:
              item.invoiceIds && item.invoiceIds.length > 0
                ? { connect: item.invoiceIds.map((fid: string) => ({ id: fid })) }
                : undefined,
          });

          // Build a scalar/relation update payload for an existing airbrushing.
          // Only fields actually sent are written (absence = preserve). File
          // relations use `set` when explicitly provided (mirrors the service path).
          const buildUpdateData = (item: any) => {
            const d: any = {};
            if (item.status !== undefined) d.status = item.status || 'PENDING';
            if (item.price !== undefined) {
              d.price = item.price !== null ? Number(item.price) : null;
            }
            if (item.startDate !== undefined) d.startDate = item.startDate || null;
            if (item.finishDate !== undefined) d.finishDate = item.finishDate || null;
            if (item.startedAt !== undefined) d.startedAt = item.startedAt || null;
            if (item.finishedAt !== undefined) d.finishedAt = item.finishedAt || null;
            if (item.paymentStatus !== undefined) d.paymentStatus = item.paymentStatus;
            if (item.painterId !== undefined) {
              d.painter = item.painterId
                ? { connect: { id: item.painterId } }
                : { disconnect: true };
            }
            if (item.receiptIds !== undefined) {
              d.receipts = { set: (item.receiptIds || []).map((fid: string) => ({ id: fid })) };
            }
            if (item.invoiceIds !== undefined) {
              d.invoices = { set: (item.invoiceIds || []).map((fid: string) => ({ id: fid })) };
            }
            return d;
          };

          const airbrushingsUpdate: any = {};
          // Delete only the airbrushings the form dropped (notIn the kept set).
          // When every submitted airbrushing is new there is nothing to keep, so
          // wipe the prior set before recreating.
          airbrushingsUpdate.deleteMany =
            idsToKeep.length > 0 ? { id: { notIn: idsToKeep } } : {};
          if (newAirbrushings.length > 0) {
            airbrushingsUpdate.create = newAirbrushings.map(buildCreate);
          }
          if (existingAirbrushings.length > 0) {
            airbrushingsUpdate.update = existingAirbrushings.map((item: any) => ({
              where: { id: item.id },
              data: buildUpdateData(item),
            }));
          }
          updateData.airbrushings = airbrushingsUpdate;
          this.logger.log(
            `[mapUpdateFormDataToDatabaseUpdateInput] Airbrushings (batch full): ${existingAirbrushings.length} update, ${newAirbrushings.length} create, deleting others`,
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
      } else if (typeof value === 'object' && value !== null && 'select' in value) {
        // Handle objects with select (e.g., serviceOrders: { select: { id: true, type: true } })
        // Select replaces the default include entirely since it's more restrictive
        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = value;
        } else {
          databaseInclude[key] = this.sanitizeSelectFields(key, value);
        }
      }
    });

    this.logger.log(
      '[mapIncludeToDatabaseInclude] Output include for Prisma:',
      JSON.stringify(databaseInclude, null, 2),
    );

    return databaseInclude as Prisma.TaskInclude;
  }

  /**
   * Sanitizes select objects before passing to Prisma:
   * - ServiceOrder: maps `name` → `description` (ServiceOrder has no `name` field)
   */
  private sanitizeSelectFields(relationKey: string, value: any): any {
    if (!value || typeof value !== 'object' || !('select' in value)) return value;

    const select = { ...value.select };

    if (relationKey === 'serviceOrders') {
      // ServiceOrder has no `name` field — map to `description`
      if ('name' in select) {
        select.description = select.name;
        delete select.name;
      }
    }

    return { ...value, select };
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

      const quoteData = (data as any).quote;
      let createdPricingId: string | null = null;

      if (
        quoteData &&
        typeof quoteData === 'object' &&
        quoteData.services &&
        Array.isArray(quoteData.services) &&
        quoteData.services.length > 0
      ) {
        const calculatedSubtotal = quoteData.services.reduce(
          (sum: number, item: any) => sum + Number(item.amount || 0),
          0,
        );
        const subtotal =
          quoteData.subtotal !== undefined ? Number(quoteData.subtotal) : calculatedSubtotal;
        const total = quoteData.total !== undefined ? Number(quoteData.total) : calculatedSubtotal;

        const maxBudgetNumber = await transaction.taskQuote.aggregate({
          _max: { budgetNumber: true },
        });
        const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

        // Clone any layout File owned by another quote so the new quote owns an
        // INDEPENDENT copy — connecting the source ids would steal them (FK on File).
        const resolvedLayoutIds =
          quoteData.layoutFileIds !== undefined
            ? await this.fileService.resolveLayoutFileIdsForQuote(
                transaction,
                null,
                quoteData.layoutFileIds ?? [],
              )
            : undefined;
        const layoutFileConnect =
          resolvedLayoutIds !== undefined
            ? {
                layoutFiles: {
                  connect: resolvedLayoutIds.map((fid: string) => ({ id: fid })),
                },
              }
            : {};

        const newQuote = await transaction.taskQuote.create({
          data: {
            budgetNumber: nextBudgetNumber,
            subtotal,
            total,
            expiresAt: quoteData.expiresAt ? new Date(quoteData.expiresAt) : new Date(),
            status: quoteData.status || 'PENDING',
            // Persist the status sort key on create too — omitting it stored the
            // column @default(1) on every new quote (PENDING's real order is 8),
            // corrupting statusOrder-based sorting until the next update.
            statusOrder: TASK_QUOTE_STATUS_ORDER[(quoteData.status || 'PENDING') as TASK_QUOTE_STATUS],
            guaranteeYears: quoteData.guaranteeYears || null,
            customGuaranteeText: quoteData.customGuaranteeText || null,
            customForecastDays: quoteData.customForecastDays || null,
            simultaneousTasks: quoteData.simultaneousTasks ?? null,
            ...layoutFileConnect,
            ...(quoteData.customerConfigs &&
              quoteData.customerConfigs.length > 0 && {
                customerConfigs: {
                  create: quoteData.customerConfigs.map((config: any) => ({
                    customerId: config.customerId,
                    subtotal: config.subtotal !== undefined ? Number(config.subtotal) : 0,
                    total: config.total !== undefined ? Number(config.total) : 0,
                    discountType: config.discountType || 'NONE',
                    discountValue: config.discountValue ?? null,
                    discountReference: config.discountReference ?? null,
                    customPaymentText: config.customPaymentText || null,
                    generateInvoice:
                      config.generateInvoice !== undefined ? config.generateInvoice : true,
                    generateBankSlip:
                      config.generateBankSlip !== undefined ? config.generateBankSlip : true,
                    // Mirror the updateWithTransaction create branch — orderNumber
                    // (and customerSignatureId) were silently dropped on task
                    // CREATE, so a quote born with a pre-set order number lost it.
                    orderNumber: config.orderNumber ?? null,
                    responsibleId: config.responsibleId || null,
                    paymentCondition: config.paymentCondition || null,
                    paymentConfig: (config as any).paymentConfig ?? null,
                    customerSignatureId: config.customerSignatureId ?? null,
                  })),
                },
              }),
            services: {
              create: quoteData.services.map((item: any) => ({
                description: item.description,
                observation: item.observation || null,
                amount: Number(item.amount || 0),
                ...(item.invoiceToCustomerId && {
                  invoiceToCustomer: { connect: { id: item.invoiceToCustomerId } },
                }),
              })),
            },
          },
        });

        createdPricingId = newQuote.id;

        // Authoritative discount-aware recompute of BOTH money layers (aggregate
        // TaskQuote.subtotal/total + per-config subtotal/total), mirroring the
        // update path (recalcQuoteTotals at the new-quote branch below). Without
        // this, a quote created with a per-config discount persisted the
        // discount-unaware total straight from the payload (money drift / the
        // detail≠wizard class of bug at creation time).
        await recalcQuoteTotals(transaction, newQuote.id);
      }

      if (createdPricingId) {
        createInput.quote = {
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

    const baseOrderBy = this.mapOrderByToDatabaseOrderBy(orderBy) || { statusOrder: 'asc' };
    // Always append id as tiebreaker to guarantee stable pagination when sort values are equal
    const stableOrderBy: any = Array.isArray(baseOrderBy)
      ? [...baseOrderBy, { id: 'asc' }]
      : [baseOrderBy, { id: 'asc' }];

    const [total, tasks] = await Promise.all([
      transaction.task.count(countOptions),
      transaction.task.findMany({
        where: mappedWhere,
        orderBy: stableOrderBy,
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

      const quoteData = (data as any).quote;

      if (quoteData !== undefined && quoteData !== null) {
        const hasServices =
          typeof quoteData === 'object' &&
          Array.isArray(quoteData.services) &&
          quoteData.services.length > 0;
        const hasConfigs =
          typeof quoteData === 'object' && quoteData.customerConfigs !== undefined;
        const hasLayout =
          typeof quoteData === 'object' && quoteData.layoutFileIds !== undefined;
        const hasQuoteScalars =
          typeof quoteData === 'object' &&
          (quoteData.expiresAt !== undefined ||
            quoteData.status !== undefined ||
            quoteData.guaranteeYears !== undefined ||
            quoteData.customGuaranteeText !== undefined ||
            quoteData.customForecastDays !== undefined ||
            quoteData.simultaneousTasks !== undefined);

        // Decouple the quote-write decision from `services` presence. A config /
        // discount / layout / scalar-only edit (services stripped as no-ops
        // upstream) must still persist — gating the whole branch on
        // services.length>0 silently dropped discount-only edits (200 OK, change
        // vanished on reload).
        if (hasServices || hasConfigs || hasLayout || hasQuoteScalars) {
          const hasNewItems =
            hasServices && quoteData.services.some((item: any) => !item.id);

          const currentTask = await transaction.task.findUnique({
            where: { id },
            select: { quoteId: true },
          });

          if (currentTask?.quoteId) {
            // Clone any layout File owned by ANOTHER quote so this quote owns an
            // INDEPENDENT copy — a raw `set` of foreign ids would steal them.
            const resolvedLayoutIds = hasLayout
              ? await this.fileService.resolveLayoutFileIdsForQuote(
                  transaction,
                  currentTask.quoteId,
                  quoteData.layoutFileIds ?? [],
                )
              : undefined;
            const layoutFileUpdate =
              resolvedLayoutIds !== undefined
                ? { layoutFiles: { set: resolvedLayoutIds.map((fid: string) => ({ id: fid })) } }
                : {};

            await transaction.taskQuote.update({
              where: { id: currentTask.quoteId },
              data: {
                expiresAt: quoteData.expiresAt ? new Date(quoteData.expiresAt) : undefined,
                status: quoteData.status || undefined,
                ...(quoteData.status && {
                  statusOrder: TASK_QUOTE_STATUS_ORDER[quoteData.status as TASK_QUOTE_STATUS],
                }),
                guaranteeYears:
                  quoteData.guaranteeYears !== undefined ? quoteData.guaranteeYears : undefined,
                customGuaranteeText:
                  quoteData.customGuaranteeText !== undefined
                    ? quoteData.customGuaranteeText
                    : undefined,
                customForecastDays:
                  quoteData.customForecastDays !== undefined
                    ? quoteData.customForecastDays
                    : undefined,
                simultaneousTasks:
                  quoteData.simultaneousTasks !== undefined
                    ? quoteData.simultaneousTasks
                    : undefined,
                ...layoutFileUpdate,
                // Services: rewrite ONLY when actually sent. Omitting them (a
                // config/layout-only edit) must never wipe the existing services.
                ...(hasServices && {
                  services: {
                    deleteMany: {},
                    create: quoteData.services.map((item: any, index: number) => ({
                      description: item.description,
                      observation: item.observation || null,
                      amount: Number(item.amount || 0),
                      position: index,
                      ...(item.invoiceToCustomerId && {
                        invoiceToCustomer: { connect: { id: item.invoiceToCustomerId } },
                      }),
                    })),
                  },
                }),
              },
            });

            // Configs: non-destructive upsert by (quoteId, customerId) — preserves
            // issued Invoice/Installments and DB-owned fields (customerSignatureId,
            // orderNumber, paymentConfig) the task form never resends, and never
            // cascade-deletes an issued invoice.
            if (hasConfigs) {
              await reconcileQuoteCustomerConfigs(
                transaction,
                currentTask.quoteId,
                quoteData.customerConfigs as any,
              );
            }

            // Authoritative, discount-aware recompute from the persisted services +
            // configs — never trust the client-supplied subtotal/total.
            if (hasServices || hasConfigs) {
              await recalcQuoteTotals(transaction, currentTask.quoteId);
            }
          } else if (hasNewItems) {
            const maxBudgetNumber = await transaction.taskQuote.aggregate({
              _max: { budgetNumber: true },
            });
            const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

            const calculatedSubtotal = quoteData.services.reduce(
              (sum: number, item: any) => sum + Number(item.amount || 0),
              0,
            );

            // Clone any layout File owned by another quote so the new quote owns
            // an INDEPENDENT copy — connecting source ids would steal them.
            const resolvedLayoutIds =
              quoteData.layoutFileIds !== undefined
                ? await this.fileService.resolveLayoutFileIdsForQuote(
                    transaction,
                    null,
                    quoteData.layoutFileIds ?? [],
                  )
                : undefined;
            const layoutFileConnect =
              resolvedLayoutIds !== undefined
                ? { layoutFiles: { connect: resolvedLayoutIds.map((fid: string) => ({ id: fid })) } }
                : {};

            const newQuote = await transaction.taskQuote.create({
              data: {
                budgetNumber: nextBudgetNumber,
                subtotal: calculatedSubtotal,
                total: calculatedSubtotal,
                expiresAt: quoteData.expiresAt ? new Date(quoteData.expiresAt) : new Date(),
                status: quoteData.status || 'PENDING',
                statusOrder:
                  TASK_QUOTE_STATUS_ORDER[(quoteData.status || 'PENDING') as TASK_QUOTE_STATUS],
                guaranteeYears: quoteData.guaranteeYears || null,
                customGuaranteeText: quoteData.customGuaranteeText || null,
                customForecastDays: quoteData.customForecastDays || null,
                simultaneousTasks: quoteData.simultaneousTasks ?? null,
                ...layoutFileConnect,
                ...(quoteData.customerConfigs &&
                  quoteData.customerConfigs.length > 0 && {
                    customerConfigs: {
                      create: quoteData.customerConfigs.map((config: any) => ({
                        customerId: config.customerId,
                        subtotal: config.subtotal !== undefined ? Number(config.subtotal) : 0,
                        total: config.total !== undefined ? Number(config.total) : 0,
                        discountType: config.discountType || 'NONE',
                        discountValue: config.discountValue ?? null,
                        discountReference: config.discountReference ?? null,
                        customPaymentText: config.customPaymentText || null,
                        generateInvoice:
                          config.generateInvoice !== undefined ? config.generateInvoice : true,
                        generateBankSlip:
                          config.generateBankSlip !== undefined ? config.generateBankSlip : true,
                        orderNumber: config.orderNumber ?? null,
                        responsibleId: config.responsibleId || null,
                        paymentCondition: config.paymentCondition || null,
                        paymentConfig: (config as any).paymentConfig ?? null,
                        customerSignatureId: config.customerSignatureId ?? null,
                      })),
                    },
                  }),
                services: {
                  create: quoteData.services.map((item: any, index: number) => ({
                    description: item.description,
                    observation: item.observation || null,
                    amount: Number(item.amount || 0),
                    position: index,
                    ...(item.invoiceToCustomerId && {
                      invoiceToCustomer: { connect: { id: item.invoiceToCustomerId } },
                    }),
                  })),
                },
              },
            });

            // Recompute discount-aware totals from the freshly-created rows.
            await recalcQuoteTotals(transaction, newQuote.id);

            updateInput.quote = {
              connect: { id: newQuote.id },
            };
          }
        }
      }

      const result = await transaction.task.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      // When cleared becomes true, move truck to YARD_WAIT if spot is currently null
      if (data.cleared === true) {
        await transaction.truck.updateMany({
          where: { taskId: id, spot: null },
          data: { spot: 'YARD_WAIT' },
        });
      }

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
