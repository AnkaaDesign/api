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
  transformPaintColorPreview,
} from '../../../../utils';

// Removed TaskIncludeProfile - using direct include parameters instead

// Default include for task repository
const DEFAULT_TASK_INCLUDE: Prisma.TaskInclude = {
  sector: { select: { id: true, name: true } },
  customer: { select: { id: true, fantasyName: true, cnpj: true } },
  invoiceTo: { select: { id: true, fantasyName: true, cnpj: true } },
  budget: { include: { items: true } }, // Budget with items (description/amount)
  pricing: { include: { items: true } }, // Task pricing with status and items
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
    include: {
      paintType: true,
      paintBrand: true,
    },
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
    include: {
      paintType: true,
      paintBrand: true,
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
    orderBy: { createdAt: 'desc' },
  },
  truck: true,
  airbrushings: {
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
    const task: Task = {
      ...databaseEntity,
      price: databaseEntity.price ? Number(databaseEntity.price) : null,
      // Alias serviceOrders to services for backward compatibility
      services: databaseEntity.serviceOrders || databaseEntity.services,
    };

    // Transform generalPainting.colorPreview path to URL
    if (task.generalPainting) {
      task.generalPainting = transformPaintColorPreview(task.generalPainting);
    }

    // Transform logoPaints colorPreview paths to URLs
    if (task.logoPaints && Array.isArray(task.logoPaints)) {
      task.logoPaints = task.logoPaints.map((paint: any) => transformPaintColorPreview(paint));
    }

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
      chassisNumber,
      plate,
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
      negotiatingWith,
      // Extended properties - File arrays
      budgetIds,
      invoiceIds,
      receiptIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      fileIds,
      paintIds,
      serviceOrders,
      observation,
      truck,
      cut,
      cuts,
      budget,
    } = extendedData;

    // Build create input with proper null handling
    const taskData: Prisma.TaskCreateInput = {
      name,
      status: mapTaskStatusToPrisma(status || TASK_STATUS.PREPARATION),
      statusOrder: getTaskStatusOrder(status || TASK_STATUS.PREPARATION),
      commission: (commission as any) || 'NO_COMMISSION', // Default to NO_COMMISSION if not provided
    };

    // Add optional scalar fields
    if (serialNumber !== undefined) taskData.serialNumber = serialNumber;
    if (details !== undefined) taskData.details = details;
    if (entryDate !== undefined) taskData.entryDate = entryDate;
    if (term !== undefined) taskData.term = term;
    if (startedAt !== undefined) taskData.startedAt = startedAt;
    if (finishedAt !== undefined) taskData.finishedAt = finishedAt;
    if (forecastDate !== undefined) taskData.forecastDate = forecastDate;

    // Only set negotiatingWith if it has meaningful values (not empty object)
    if (negotiatingWith !== undefined) {
      const hasValues = negotiatingWith &&
                       typeof negotiatingWith === 'object' &&
                       Object.keys(negotiatingWith).length > 0 &&
                       Object.values(negotiatingWith).some(v => v !== null && v !== undefined);

      if (hasValues || negotiatingWith === null) {
        taskData.negotiatingWith = negotiatingWith;
      }
    }

    // Handle relations with proper null checks
    if (customerId) taskData.customer = { connect: { id: customerId } };
    if (invoiceToId) taskData.invoiceTo = { connect: { id: invoiceToId } };
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
    if (serviceOrders && serviceOrders.length > 0) {
      taskData.serviceOrders = {
        create: serviceOrders.map(service => ({
          status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
          statusOrder:
            service.statusOrder ||
            getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
          type: service.type || 'PRODUCTION',
          description: service.description,
          assignedToId: service.assignedToId || null,
          startedAt: service.startedAt || null,
          finishedAt: service.finishedAt || null,
        })),
      };
    }

    // Handle truck creation
    if (truck) {
      const truckData: any = {};

      // Add plate and chassisNumber if provided (from top-level or truck object)
      if (plate !== undefined) truckData.plate = plate;
      else if (truck.plate !== undefined) truckData.plate = truck.plate;

      if (chassisNumber !== undefined) truckData.chassisNumber = chassisNumber;
      else if (truck.chassisNumber !== undefined) truckData.chassisNumber = truck.chassisNumber;

      // Add spot if provided
      if (truck.spot !== undefined) truckData.spot = truck.spot;

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

    // Handle multiple cuts field (preferred way)
    if (cuts && Array.isArray(cuts)) {
      for (const cutItem of cuts) {
        // Skip cuts without fileId (file must be uploaded first)
        if (!cutItem.fileId) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              '⚠️  Skipping cut without fileId - file must be uploaded before creating cut',
            );
          }
          continue;
        }
        // If quantity is specified, create multiple records
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
    }
    // Handle single cut field ONLY if cuts array is not present (deprecated - kept for backward compatibility)
    else if (cut) {
      // Skip cut without fileId (file must be uploaded first)
      if (!cut.fileId) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '⚠️  Skipping cut without fileId - file must be uploaded before creating cut',
          );
        }
      } else {
        // Extract quantity and create multiple cut records
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

    // Add cuts to task data if any were created
    if (cutRecords.length > 0) {
      taskData.cuts = {
        create: cutRecords,
      };
    }

    // Handle budget creation (object with items and expiresIn)
    if (
      budget &&
      typeof budget === 'object' &&
      budget.items &&
      Array.isArray(budget.items) &&
      budget.items.length > 0
    ) {
      // Calculate total from items
      const total = budget.items.reduce(
        (sum: number, item: any) => sum + Number(item.amount || 0),
        0,
      );
      taskData.budget = {
        create: {
          total,
          expiresIn: budget.expiresIn ? new Date(budget.expiresIn) : new Date(),
          items: {
            create: budget.items.map((item: any) => ({
              description: item.description,
              amount: Number(item.amount || 0),
            })),
          },
        },
      };
    }

    // Handle pricing creation (object with items, expiresAt, and status)
    const pricing = (extendedData as any).pricing;
    if (
      pricing &&
      typeof pricing === 'object' &&
      pricing.items &&
      Array.isArray(pricing.items) &&
      pricing.items.length > 0
    ) {
      // Calculate total from items
      const total = pricing.items.reduce(
        (sum: number, item: any) => sum + Number(item.amount || 0),
        0,
      );
      taskData.pricing = {
        create: {
          total,
          expiresAt: pricing.expiresAt ? new Date(pricing.expiresAt) : new Date(),
          status: pricing.status || 'DRAFT',
          items: {
            create: pricing.items.map((item: any) => ({
              description: item.description,
              amount: Number(item.amount || 0),
            })),
          },
        },
      };
    }

    // Handle airbrushings creation (array of airbrushing items)
    const airbrushings = (extendedData as any).airbrushings;
    if (airbrushings && Array.isArray(airbrushings) && airbrushings.length > 0) {
      taskData.airbrushings = {
        create: airbrushings.map((item: any, index: number) => {
          const airbrushingData = {
            status: item.status || 'PENDING',
            price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
            startDate: item.startDate || null,
            finishDate: item.finishDate || null,
            // Connect existing file IDs if provided
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
          };
          return airbrushingData;
        }),
      };
    }

    return taskData;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: TaskUpdateFormData,
    userId?: string,
  ): Prisma.TaskUpdateInput {
    // Cast to extended type to access all properties
    const extendedData = formData as TaskUpdateFormData;

    // Extract known properties
    const {
      name,
      status,
      serialNumber,
      chassisNumber,
      plate,
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
      negotiatingWith,
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
      serviceOrders,
      observation,
      truck,
      cut,
      cuts,
      budget,
    } = extendedData as any;

    const updateData: Prisma.TaskUpdateInput = {};

    // Handle scalar fields
    if (name !== undefined) updateData.name = name;
    if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
    if (details !== undefined) updateData.details = details;
    if (entryDate !== undefined) updateData.entryDate = entryDate;
    if (term !== undefined) updateData.term = term;
    if (startedAt !== undefined) updateData.startedAt = startedAt;
    if (finishedAt !== undefined) updateData.finishedAt = finishedAt;
    if (forecastDate !== undefined) updateData.forecastDate = forecastDate;

    // Only update negotiatingWith if it's not undefined and not an empty object
    // This prevents false positive change detection when frontend sends {}
    if (negotiatingWith !== undefined) {
      // Check if it's an empty object or has meaningful values
      const hasValues = negotiatingWith &&
                       typeof negotiatingWith === 'object' &&
                       Object.keys(negotiatingWith).length > 0 &&
                       Object.values(negotiatingWith).some(v => v !== null && v !== undefined);

      // Only set if it has values or is explicitly null (to clear the field)
      if (hasValues || negotiatingWith === null) {
        updateData.negotiatingWith = negotiatingWith;
      }
      // If it's an empty object {}, don't include it in update - prevents false positives
    }

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
    if (invoiceToId !== undefined) {
      updateData.invoiceTo = invoiceToId ? { connect: { id: invoiceToId } } : { disconnect: true };
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
    if (serviceOrders !== undefined) {
      console.log('[TaskRepo] Creating service orders:', JSON.stringify(serviceOrders, null, 2));
      updateData.serviceOrders = {
        deleteMany: {}, // Delete all existing services
        create: serviceOrders.map(service => {
          const serviceData: any = {
            status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
            statusOrder:
              service.statusOrder ||
              getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
            type: service.type || 'PRODUCTION',
            description: service.description,
            startedAt: service.startedAt || null,
            finishedAt: service.finishedAt || null,
            // Set createdBy to the user performing the update
            createdBy: userId ? { connect: { id: userId } } : undefined,
          };

          // Handle assignedTo relation - use connect if assignedToId is provided
          if (service.assignedToId) {
            serviceData.assignedTo = { connect: { id: service.assignedToId } };
          }

          return serviceData;
        }),
      };
    }

    // Handle consolidated truck update (all fields including layouts)
    // This handles: plate, chassisNumber, serialNumber, spot, and layouts
    if (truck !== undefined) {
      if (truck === null) {
        updateData.truck = { delete: true };
      } else {
        const truckCreateData: any = {};
        const truckUpdateData: any = {};

        // Basic truck fields from nested truck object
        // Note: serialNumber is a Task field, not a Truck field
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

        // Legacy support: also check top-level plate and chassisNumber
        if (plate !== undefined && truck.plate === undefined) {
          truckCreateData.plate = plate;
          truckUpdateData.plate = plate;
        }
        if (chassisNumber !== undefined && truck.chassisNumber === undefined) {
          truckCreateData.chassisNumber = chassisNumber;
          truckUpdateData.chassisNumber = chassisNumber;
        }

        // Note: Layout updates (leftSideLayout, rightSideLayout, backSideLayout) are handled
        // entirely in the service layer because they require complex operations
        // (create/update/delete layout sections). Do NOT pass them to Prisma here.

        // Only add truck upsert if there are actual fields to update
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

    // Handle cut update - support both single cut and multiple cuts
    const shouldUpdateCuts = cut !== undefined || cuts !== undefined;

    if (shouldUpdateCuts) {
      const cutRecords: any[] = [];

      // Handle multiple cuts field (preferred way)
      if (cuts !== undefined && cuts !== null && Array.isArray(cuts)) {
        for (const cutItem of cuts) {
          // Skip cuts without fileId (file must be uploaded first)
          if (!cutItem.fileId) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn(
                '⚠️  Skipping cut without fileId - file must be uploaded before creating cut',
              );
            }
            continue;
          }
          // If quantity is specified, create multiple records
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
      }
      // Handle single cut field ONLY if cuts array is not present (deprecated - kept for backward compatibility)
      else if (cut !== undefined && cut !== null) {
        // Skip cut without fileId (file must be uploaded first)
        if (!cut.fileId) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              '⚠️  Skipping cut without fileId - file must be uploaded before creating cut',
            );
          }
        } else {
          // Extract quantity and create multiple cut records
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

    // Handle budget update (object with items and expiresIn) - upsert budget
    if (budget !== undefined) {
      if (budget === null) {
        updateData.budget = { delete: true };
      } else if (
        typeof budget === 'object' &&
        budget.items &&
        Array.isArray(budget.items) &&
        budget.items.length > 0
      ) {
        // Calculate total from items
        const total = budget.items.reduce(
          (sum: number, item: any) => sum + Number(item.amount || 0),
          0,
        );
        updateData.budget = {
          upsert: {
            create: {
              total,
              expiresIn: budget.expiresIn ? new Date(budget.expiresIn) : new Date(),
              items: {
                create: budget.items.map((item: any) => ({
                  description: item.description,
                  amount: Number(item.amount || 0),
                })),
              },
            },
            update: {
              total,
              expiresIn: budget.expiresIn ? new Date(budget.expiresIn) : new Date(),
              items: {
                deleteMany: {}, // Delete all existing items
                create: budget.items.map((item: any) => ({
                  description: item.description,
                  amount: Number(item.amount || 0),
                })),
              },
            },
          },
        };
      }
    }

    // Handle pricing update (object with items, expiresAt, and status) - upsert pricing
    const pricing = (extendedData as any).pricing;
    console.log('[TaskRepo] ========================================');
    console.log('[TaskRepo] PRICING UPDATE DEBUG');
    console.log('[TaskRepo] pricing !== undefined:', pricing !== undefined);
    console.log('[TaskRepo] pricing value:', JSON.stringify(pricing, null, 2));
    console.log('[TaskRepo] typeof pricing:', typeof pricing);
    console.log('[TaskRepo] pricing.items:', pricing?.items);
    console.log('[TaskRepo] Array.isArray(pricing.items):', Array.isArray(pricing?.items));
    console.log('[TaskRepo] pricing.items.length:', pricing?.items?.length);
    console.log('[TaskRepo] ========================================');

    if (pricing !== undefined) {
      console.log('[TaskRepo] ✅ Pricing is defined');
      if (pricing === null) {
        console.log('[TaskRepo] 🗑️  Pricing is null - deleting');
        updateData.pricing = { delete: true };
      } else if (
        typeof pricing === 'object' &&
        pricing.items &&
        Array.isArray(pricing.items) &&
        pricing.items.length > 0
      ) {
        console.log('[TaskRepo] ✅ Pricing has items - upserting');
        // Calculate total from items
        const total = pricing.items.reduce(
          (sum: number, item: any) => sum + Number(item.amount || 0),
          0,
        );
        updateData.pricing = {
          upsert: {
            create: {
              total,
              expiresAt: pricing.expiresAt ? new Date(pricing.expiresAt) : new Date(),
              status: pricing.status || 'DRAFT',
              items: {
                create: pricing.items.map((item: any) => ({
                  description: item.description,
                  amount: Number(item.amount || 0),
                })),
              },
            },
            update: {
              total,
              expiresAt: pricing.expiresAt ? new Date(pricing.expiresAt) : new Date(),
              status: pricing.status || 'DRAFT',
              items: {
                deleteMany: {}, // Delete all existing items
                create: pricing.items.map((item: any) => ({
                  description: item.description,
                  amount: Number(item.amount || 0),
                })),
              },
            },
          },
        };
        console.log('[TaskRepo] ✅ Pricing updateData set');
      } else {
        console.log('[TaskRepo] ❌ Pricing conditions NOT met:');
        console.log('[TaskRepo]    - typeof pricing === "object":', typeof pricing === 'object');
        console.log('[TaskRepo]    - pricing.items exists:', !!pricing.items);
        console.log('[TaskRepo]    - Array.isArray(pricing.items):', Array.isArray(pricing?.items));
        console.log('[TaskRepo]    - pricing.items.length > 0:', (pricing?.items?.length || 0) > 0);
      }
    } else {
      console.log('[TaskRepo] ❌ Pricing is undefined - not updating');
    }
    console.log('[TaskRepo] Final updateData.pricing:', updateData.pricing ? 'SET' : 'NOT SET');
    console.log('[TaskRepo] ========================================');

    // Handle airbrushings update (array of airbrushing items) - replace all existing airbrushings
    const airbrushings = (extendedData as any).airbrushings;

    if (airbrushings !== undefined) {
      if (airbrushings === null || (Array.isArray(airbrushings) && airbrushings.length === 0)) {
        updateData.airbrushings = { deleteMany: {} };
      } else if (Array.isArray(airbrushings) && airbrushings.length > 0) {
        updateData.airbrushings = {
          deleteMany: {}, // Delete all existing airbrushings
          create: airbrushings.map((item: any, index: number) => {
            const airbrushingData = {
              status: item.status || 'PENDING',
              price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
              startDate: item.startDate || null,
              finishDate: item.finishDate || null,
              // Connect existing file IDs if provided
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
            };
            return airbrushingData;
          }),
        };
      }
    }

    return updateData;
  }

  // Helper function to recursively process nested includes
  private processNestedInclude(value: any): any {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'object' && value !== null) {
      if ('include' in value) {
        // Recursively process the nested include
        const processedInclude: any = {};
        Object.keys(value.include).forEach(nestedKey => {
          processedInclude[nestedKey] = this.processNestedInclude(value.include[nestedKey]);
        });

        return {
          ...value,
          include: processedInclude,
        };
      }

      // If it's an object but doesn't have 'include', process its properties
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

    // LOG: Input includes
    this.logger.log(
      '[mapIncludeToDatabaseInclude] Input include:',
      JSON.stringify(include, null, 2),
    );

    // Start with default include to ensure observation.files are always included
    const databaseInclude: any = { ...this.getDefaultInclude() };

    Object.keys(include).forEach(key => {
      const value = include[key as keyof TaskInclude];

      if (typeof value === 'boolean') {
        // Handle field name mappings for backwards compatibility
        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = value;
        } else {
          databaseInclude[key] = value;
        }
      } else if (typeof value === 'object' && value !== null && 'include' in value) {
        // Handle nested includes with field name mappings and recursive processing
        const processedValue = this.processNestedInclude(value);

        // Special handling for relations that need deep merging with defaults
        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = processedValue;
        } else {
          // Deep merge nested includes to preserve default nested relations
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

    // LOG: Output includes being sent to Prisma
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

    const includeForQuery = this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude();

    const [total, tasks] = await Promise.all([
      transaction.task.count(countOptions),
      transaction.task.findMany({
        where: mappedWhere,
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { statusOrder: 'asc' },
        skip,
        take,
        include: includeForQuery,
      }),
    ]);

    // LOG: Check first task's truck data structure
    if (tasks.length > 0 && tasks[0].truck) {
      const truck: any = tasks[0].truck; // Cast to any to check actual runtime data
      this.logger.log(
        '[findManyWithTransaction] First task truck data:',
        JSON.stringify(
          {
            hasTruck: !!truck,
            truckId: truck?.id,
            leftLayoutId: truck?.leftSideLayoutId,
            rightLayoutId: truck?.rightSideLayoutId,
            hasLeftLayoutId: !!truck?.leftSideLayoutId,
            hasRightLayoutId: !!truck?.rightSideLayoutId,
          },
          null,
          2,
        ),
      );
    }

    // Verify count matches expectations
    if (total > 0 && tasks.length === 0 && skip === 0) {
      this.logger.warn(
        '[TaskRepository] WARNING: Count returned records but findMany returned empty!',
      );
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
    userId?: string,
  ): Promise<Task> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data, userId);
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
