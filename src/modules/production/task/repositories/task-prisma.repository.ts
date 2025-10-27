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
  budget: true, // Budget items (referencia/valor)
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
  services: {
    orderBy: { createdAt: 'desc' },
  },
  truck: {
    include: {
      garage: { select: { id: true, name: true } },
    },
  },
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
    };

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
      paintId,
      customerId,
      sectorId,
      commission,
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
      budget,
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
    if (chassisNumber !== undefined) taskData.chassisNumber = chassisNumber;
    if (plate !== undefined) taskData.plate = plate;
    if (details !== undefined) taskData.details = details;
    if (entryDate !== undefined) taskData.entryDate = entryDate;
    if (term !== undefined) taskData.term = term;
    if (startedAt !== undefined) taskData.startedAt = startedAt;
    if (finishedAt !== undefined) taskData.finishedAt = finishedAt;

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
        // Skip cuts without fileId (file must be uploaded first)
        if (!cutItem.fileId) {
          console.warn('⚠️  Skipping cut without fileId - file must be uploaded before creating cut');
          continue;
        }
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
      // Skip cut without fileId (file must be uploaded first)
      if (!cut.fileId) {
        console.warn('⚠️  Skipping cut without fileId - file must be uploaded before creating cut');
      } else {
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
    }

    console.log(`📊 Total cut records to create: ${cutRecords.length}`);

    // Add cuts to task data if any were created
    if (cutRecords.length > 0) {
      taskData.cuts = {
        create: cutRecords,
      };
    }

    // Handle budget creation (array of budget items)
    if (budget && Array.isArray(budget) && budget.length > 0) {
      console.log('✅ Processing budget array:', budget.length, 'items');
      taskData.budget = {
        create: budget.map((item: any) => ({
          referencia: item.referencia,
          valor: item.valor,
        })),
      };
    }

    // Handle airbrushings creation (array of airbrushing items)
    const airbrushings = (extendedData as any).airbrushings;
    console.log('[TaskRepository] ========== AIRBRUSHINGS DEBUG ==========');
    console.log('[TaskRepository] airbrushings from formData:', airbrushings);
    console.log('[TaskRepository] airbrushings is array?', Array.isArray(airbrushings));
    console.log('[TaskRepository] airbrushings length:', airbrushings?.length);
    if (airbrushings && Array.isArray(airbrushings) && airbrushings.length > 0) {
      console.log('✅ Processing airbrushings array:', airbrushings.length, 'items');
      console.log('[TaskRepository] Airbrushing items:', JSON.stringify(airbrushings, null, 2));
      taskData.airbrushings = {
        create: airbrushings.map((item: any, index: number) => {
          console.log(`[TaskRepository] Creating airbrushing ${index}:`, item);
          console.log(`[TaskRepository] Price value:`, item.price, 'type:', typeof item.price);
          const airbrushingData = {
            status: item.status || 'PENDING',
            price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
            startDate: item.startDate || null,
            finishDate: item.finishDate || null,
            // Connect existing file IDs if provided
            receipts: item.receiptIds && item.receiptIds.length > 0
              ? { connect: item.receiptIds.map((id: string) => ({ id })) }
              : undefined,
            invoices: item.invoiceIds && item.invoiceIds.length > 0
              ? { connect: item.invoiceIds.map((id: string) => ({ id })) }
              : undefined,
            artworks: item.artworkIds && item.artworkIds.length > 0
              ? { connect: item.artworkIds.map((id: string) => ({ id })) }
              : undefined,
          };
          console.log(`[TaskRepository] Final airbrushing data:`, airbrushingData);
          return airbrushingData;
        }),
      };
      console.log('[TaskRepository] taskData.airbrushings:', JSON.stringify(taskData.airbrushings, null, 2));
    } else {
      console.log('❌ No airbrushings to process');
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
      chassisNumber,
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
      budget,
    } = extendedData as any;

    const updateData: Prisma.TaskUpdateInput = {};

    // Handle scalar fields
    if (name !== undefined) updateData.name = name;
    if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
    if (chassisNumber !== undefined) updateData.chassisNumber = chassisNumber;
    if (plate !== undefined) updateData.plate = plate;
    if (details !== undefined) updateData.details = details;
    if (entryDate !== undefined) updateData.entryDate = entryDate;
    if (term !== undefined) updateData.term = term;
    if (startedAt !== undefined) updateData.startedAt = startedAt;
    if (finishedAt !== undefined) updateData.finishedAt = finishedAt;
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
          // Skip cuts without fileId (file must be uploaded first)
          if (!cutItem.fileId) {
            console.warn('⚠️  Skipping cut without fileId - file must be uploaded before creating cut');
            continue;
          }
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
        // Skip cut without fileId (file must be uploaded first)
        if (!cut.fileId) {
          console.warn('⚠️  Skipping cut without fileId - file must be uploaded before creating cut');
        } else {
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

    // Handle budget update (array of budget items) - replace all existing budget items
    if (budget !== undefined) {
      if (budget === null || (Array.isArray(budget) && budget.length === 0)) {
        console.log('🗑️ Deleting all budget items');
        updateData.budget = { deleteMany: {} };
      } else if (Array.isArray(budget) && budget.length > 0) {
        console.log('✅ Updating budget array:', budget.length, 'items');
        updateData.budget = {
          deleteMany: {}, // Delete all existing budget items
          create: budget.map((item: any) => ({
            referencia: item.referencia,
            valor: item.valor,
          })),
        };
      }
    }

    // Handle airbrushings update (array of airbrushing items) - replace all existing airbrushings
    const airbrushings = (extendedData as any).airbrushings;
    console.log('[TaskRepository.UPDATE] ========== AIRBRUSHINGS DEBUG ==========');
    console.log('[TaskRepository.UPDATE] airbrushings from formData:', airbrushings);
    console.log('[TaskRepository.UPDATE] airbrushings is array?', Array.isArray(airbrushings));
    console.log('[TaskRepository.UPDATE] airbrushings length:', airbrushings?.length);

    if (airbrushings !== undefined) {
      if (airbrushings === null || (Array.isArray(airbrushings) && airbrushings.length === 0)) {
        console.log('🗑️ Deleting all airbrushings');
        updateData.airbrushings = { deleteMany: {} };
      } else if (Array.isArray(airbrushings) && airbrushings.length > 0) {
        console.log('✅ Updating airbrushings array:', airbrushings.length, 'items');
        console.log('[TaskRepository.UPDATE] Airbrushing items:', JSON.stringify(airbrushings, null, 2));
        updateData.airbrushings = {
          deleteMany: {}, // Delete all existing airbrushings
          create: airbrushings.map((item: any, index: number) => {
            console.log(`[TaskRepository.UPDATE] Creating airbrushing ${index}:`, item);
            console.log(`[TaskRepository.UPDATE] Price value:`, item.price, 'type:', typeof item.price);
            const airbrushingData = {
              status: item.status || 'PENDING',
              price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
              startDate: item.startDate || null,
              finishDate: item.finishDate || null,
              // Connect existing file IDs if provided
              receipts: item.receiptIds && item.receiptIds.length > 0
                ? { connect: item.receiptIds.map((id: string) => ({ id })) }
                : undefined,
              invoices: item.invoiceIds && item.invoiceIds.length > 0
                ? { connect: item.invoiceIds.map((id: string) => ({ id })) }
                : undefined,
              artworks: item.artworkIds && item.artworkIds.length > 0
                ? { connect: item.artworkIds.map((id: string) => ({ id })) }
                : undefined,
            };
            console.log(`[TaskRepository.UPDATE] Final airbrushing data:`, airbrushingData);
            return airbrushingData;
          }),
        };
        console.log('[TaskRepository.UPDATE] updateData.airbrushings:', JSON.stringify(updateData.airbrushings, null, 2));
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
          include: processedInclude
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
    this.logger.log('[mapIncludeToDatabaseInclude] Input include:', JSON.stringify(include, null, 2));

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
              include: { ...existingValue.include, ...processedValue.include }
            };
          } else {
            databaseInclude[key] = processedValue;
          }
        }
      }
    });

    // LOG: Output includes being sent to Prisma
    this.logger.log('[mapIncludeToDatabaseInclude] Output include for Prisma:', JSON.stringify(databaseInclude, null, 2));

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
      this.logger.log('[findManyWithTransaction] First task truck data:', JSON.stringify({
        hasTruck: !!truck,
        truckId: truck?.id,
        leftLayoutId: truck?.leftSideLayoutId,
        rightLayoutId: truck?.rightSideLayoutId,
        hasLeftLayoutId: !!truck?.leftSideLayoutId,
        hasRightLayoutId: !!truck?.rightSideLayoutId,
      }, null, 2));
    }

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
