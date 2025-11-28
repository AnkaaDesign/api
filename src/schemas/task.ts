// packages/schemas/src/task.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, createNameSchema, createDescriptionSchema, nullableDate, moneySchema } from "./common";
import type { Task } from '@types';
import { TASK_STATUS, SERVICE_ORDER_STATUS, COMMISSION_STATUS } from '@constants';
import { cutCreateNestedSchema } from "./cut";
import { airbrushingCreateNestedSchema } from "./airbrushing";
import { budgetCreateNestedSchema } from "./budget";

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const taskIncludeSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      sector: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                users: z.boolean().optional(),
                tasks: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      customer: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                logo: z.boolean().optional(),
                tasks: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      budgets: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                tasksArtworks: z.boolean().optional(),
                customerLogo: z.boolean().optional(),
                taskBudget: z.boolean().optional(),
                taskNfe: z.boolean().optional(),
                supplierLogo: z.boolean().optional(),
                orderNfe: z.boolean().optional(),
                orderBudget: z.boolean().optional(),
                orderReceipt: z.boolean().optional(),
                observations: z.boolean().optional(),
                airbrushingReceipts: z.boolean().optional(),
                airbrushingInvoices: z.boolean().optional(),
                vacation: z.boolean().optional(),
                externalWithdrawalBudget: z.boolean().optional(),
                externalWithdrawalNfe: z.boolean().optional(),
                externalWithdrawalReceipt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      invoices: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                tasksArtworks: z.boolean().optional(),
                customerLogo: z.boolean().optional(),
                taskBudget: z.boolean().optional(),
                taskNfe: z.boolean().optional(),
                supplierLogo: z.boolean().optional(),
                orderNfe: z.boolean().optional(),
                orderBudget: z.boolean().optional(),
                orderReceipt: z.boolean().optional(),
                observations: z.boolean().optional(),
                airbrushingReceipts: z.boolean().optional(),
                airbrushingInvoices: z.boolean().optional(),
                vacation: z.boolean().optional(),
                externalWithdrawalBudget: z.boolean().optional(),
                externalWithdrawalNfe: z.boolean().optional(),
                externalWithdrawalReceipt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      receipts: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                tasksArtworks: z.boolean().optional(),
                customerLogo: z.boolean().optional(),
                taskBudget: z.boolean().optional(),
                taskNfe: z.boolean().optional(),
                taskReceipt: z.boolean().optional(),
                supplierLogo: z.boolean().optional(),
                orderNfe: z.boolean().optional(),
                orderBudget: z.boolean().optional(),
                orderReceipt: z.boolean().optional(),
                observations: z.boolean().optional(),
                airbrushingReceipts: z.boolean().optional(),
                airbrushingInvoices: z.boolean().optional(),
                vacation: z.boolean().optional(),
                externalWithdrawalBudget: z.boolean().optional(),
                externalWithdrawalNfe: z.boolean().optional(),
                externalWithdrawalReceipt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      observation: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                artworks: z.boolean().optional(),
                task: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      generalPainting: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                formulas: z.boolean().optional(),
                generalPaintings: z.boolean().optional(),
                logoTasks: z.boolean().optional(),
                relatedPaints: z.boolean().optional(),
                relatedTo: z.boolean().optional(),
                paintType: z.boolean().optional(),
                paintBrand: z.boolean().optional(),
                paintGrounds: z
                  .union([
                    z.boolean(),
                    z.object({
                      include: z
                        .object({
                          paint: z.boolean().optional(),
                          groundPaint: z
                            .union([
                              z.boolean(),
                              z.object({
                                include: z
                                  .object({
                                    paintType: z.boolean().optional(),
                                    paintBrand: z.boolean().optional(),
                                  })
                                  .optional(),
                              }),
                            ])
                            .optional(),
                        })
                        .optional(),
                    }),
                  ])
                  .optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      createdBy: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                position: z.boolean().optional(),
                sector: z.boolean().optional(),
                ppeSize: z.boolean().optional(),
                preference: z.boolean().optional(),
                activities: z.boolean().optional(),
                borrows: z.boolean().optional(),
                notifications: z.boolean().optional(),
                tasks: z.boolean().optional(),
                vacations: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      artworks: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                tasksArtworks: z.boolean().optional(),
                customerLogo: z.boolean().optional(),
                taskBudget: z.boolean().optional(),
                taskNfe: z.boolean().optional(),
                supplierLogo: z.boolean().optional(),
                orderNfe: z.boolean().optional(),
                orderBudget: z.boolean().optional(),
                orderReceipt: z.boolean().optional(),
                observations: z.boolean().optional(),
                reprimand: z.boolean().optional(),
                airbrushingReceipts: z.boolean().optional(),
                airbrushingInvoices: z.boolean().optional(),
                vacation: z.boolean().optional(),
                externalWithdrawalBudget: z.boolean().optional(),
                externalWithdrawalNfe: z.boolean().optional(),
                externalWithdrawalReceipt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      logoPaints: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                formulas: z.boolean().optional(),
                generalPaintings: z.boolean().optional(),
                logoTasks: z.boolean().optional(),
                relatedPaints: z.boolean().optional(),
                relatedTo: z.boolean().optional(),
                paintType: z.boolean().optional(),
                paintBrand: z.boolean().optional(),
                paintGrounds: z
                  .union([
                    z.boolean(),
                    z.object({
                      include: z
                        .object({
                          paint: z.boolean().optional(),
                          groundPaint: z
                            .union([
                              z.boolean(),
                              z.object({
                                include: z
                                  .object({
                                    paintType: z.boolean().optional(),
                                    paintBrand: z.boolean().optional(),
                                  })
                                  .optional(),
                              }),
                            ])
                            .optional(),
                        })
                        .optional(),
                    }),
                  ])
                  .optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      services: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                task: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      budget: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                task: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      truck: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                task: z.boolean().optional(),
                garage: z.boolean().optional(),
                leftSideLayout: z
                  .union([
                    z.boolean(),
                    z.object({
                      include: z
                        .object({
                          layoutSections: z.boolean().optional(),
                        })
                        .optional(),
                    }),
                  ])
                  .optional(),
                rightSideLayout: z
                  .union([
                    z.boolean(),
                    z.object({
                      include: z
                        .object({
                          layoutSections: z.boolean().optional(),
                        })
                        .optional(),
                    }),
                  ])
                  .optional(),
                backSideLayout: z
                  .union([
                    z.boolean(),
                    z.object({
                      include: z
                        .object({
                          layoutSections: z.boolean().optional(),
                        })
                        .optional(),
                    }),
                  ])
                  .optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      airbrushing: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                task: z.boolean().optional(),
                artworks: z.boolean().optional(),
                budgets: z.boolean().optional(),
                invoices: z.boolean().optional(),
                invoiceReimbursements: z.boolean().optional(),
                receipts: z.boolean().optional(),
                reimbursements: z.boolean().optional(),
              })
              .optional(),
            orderBy: z
              .object({
                createdAt: orderByDirectionSchema.optional(),
                updatedAt: orderByDirectionSchema.optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      cutRequest: z.boolean().optional(),
      cutPlan: z.boolean().optional(),
      relatedTasks: z
        .union([
          z.boolean(),
          z.object({
            include: z.lazy(() => taskIncludeSchema).optional(),
          }),
        ])
        .optional(),
      relatedTo: z
        .union([
          z.boolean(),
          z.object({
            include: z.lazy(() => taskIncludeSchema).optional(),
          }),
        ])
        .optional(),
    })
    .partial(),
);

// =====================
// Order By Schema
// =====================

export const taskOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      statusOrder: orderByDirectionSchema.optional(),
      serialNumber: orderByDirectionSchema.optional(),
      entryDate: orderByDirectionSchema.optional(),
      term: orderByDirectionSchema.optional(),
      startedAt: orderByDirectionSchema.optional(),
      finishedAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        serialNumber: orderByDirectionSchema.optional(),
        entryDate: orderByDirectionSchema.optional(),
        term: orderByDirectionSchema.optional(),
        startedAt: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const taskWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([taskWhereSchema, z.array(taskWhereSchema)]).optional(),
      OR: z.array(taskWhereSchema).optional(),
      NOT: z.union([taskWhereSchema, z.array(taskWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      name: z.union([z.string(), z.object({ contains: z.string().optional(), startsWith: z.string().optional(), endsWith: z.string().optional() })]).optional(),
      status: z.union([z.nativeEnum(TASK_STATUS), z.object({ in: z.array(z.nativeEnum(TASK_STATUS)).optional() })]).optional(),
      statusOrder: z.union([z.number(), z.object({ gte: z.number().optional(), lte: z.number().optional() })]).optional(),
      serialNumber: z.union([z.string(), z.object({ contains: z.string().optional() })]).optional(),
      details: z.union([z.string(), z.object({ contains: z.string().optional() })]).optional(),
      commission: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      entryDate: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      term: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      startedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      finishedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      customerId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      sectorId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      paintId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      budgetId: z.string().optional(),
      nfeId: z.string().optional(),
      receiptId: z.string().optional(),
      // Relations
      sector: z.any().optional(),
      customer: z.any().optional(),
      budgets: z.any().optional(),
      invoices: z.any().optional(),
      receipts: z.any().optional(),
      observation: z.any().optional(),
      generalPainting: z.any().optional(),
      createdBy: z.any().optional(),
      artworks: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      logoPaints: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      commissions: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      services: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      truck: z.any().optional(),
      airbrushing: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      cutRequest: z.any().optional(),
      cutPlan: z.any().optional(),
      relatedTasks: z
        .object({
          some: taskWhereSchema.optional(),
          every: taskWhereSchema.optional(),
          none: taskWhereSchema.optional(),
        })
        .optional(),
      relatedTo: z
        .object({
          some: taskWhereSchema.optional(),
          every: taskWhereSchema.optional(),
          none: taskWhereSchema.optional(),
        })
        .optional(),
    })
    .strict(),
);

// =====================
// Transform Function
// =====================

const taskTransform = (data: any): any => {
  console.log("[TaskTransform] Input data:", {
    searchingFor: data.searchingFor,
    hasWhere: !!data.where,
    whereKeys: data.where ? Object.keys(data.where) : [],
    status: data.status,
  });

  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  // Enhanced search filter - search across multiple fields and relations
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    console.log("[TaskTransform] Processing search term:", searchTerm);
    andConditions.push({
      OR: [
        // Direct task fields
        { name: { contains: searchTerm, mode: "insensitive" } },
        { serialNumber: { contains: searchTerm, mode: "insensitive" } },
        { details: { contains: searchTerm, mode: "insensitive" } },
        // Related entities
        { customer: { fantasyName: { contains: searchTerm, mode: "insensitive" } } },
        { customer: { corporateName: { contains: searchTerm, mode: "insensitive" } } },
        { customer: { cpf: { contains: searchTerm, mode: "insensitive" } } },
        { customer: { cnpj: { contains: searchTerm, mode: "insensitive" } } },
        { sector: { name: { contains: searchTerm, mode: "insensitive" } } },
        { createdBy: { name: { contains: searchTerm, mode: "insensitive" } } },
        { observation: { description: { contains: searchTerm, mode: "insensitive" } } },
        // ServiceOrder only has description field, no name field
        { services: { some: { description: { contains: searchTerm, mode: "insensitive" } } } },
        // Paint relations - search by paint name
        { generalPainting: { name: { contains: searchTerm, mode: "insensitive" } } },
        { generalPainting: { code: { contains: searchTerm, mode: "insensitive" } } },
        { logoPaints: { some: { name: { contains: searchTerm, mode: "insensitive" } } } },
        { logoPaints: { some: { code: { contains: searchTerm, mode: "insensitive" } } } },
        // Truck search - plate, chassisNumber
        { truck: { plate: { contains: searchTerm, mode: "insensitive" } } },
        { truck: { chassisNumber: { contains: searchTerm, mode: "insensitive" } } },
        { truck: { garage: { name: { contains: searchTerm, mode: "insensitive" } } } },
      ],
    });
    delete data.searchingFor;
  }

  // Status filters
  if (data.status) {
    // Handle both single value and array
    const statusArray = Array.isArray(data.status) ? data.status : [data.status];
    if (statusArray.length > 0) {
      andConditions.push({ status: { in: statusArray } });
      delete data.status;
    }
  }

  if (data.statusOrder && Array.isArray(data.statusOrder) && data.statusOrder.length > 0) {
    andConditions.push({ statusOrder: { in: data.statusOrder } });
    delete data.statusOrder;
  }

  // Boolean has* filters for relations
  if (data.hasSector === true) {
    andConditions.push({ sectorId: { not: null } });
    delete data.hasSector;
  } else if (data.hasSector === false) {
    andConditions.push({ sectorId: null });
    delete data.hasSector;
  }

  if (data.hasCustomer === true) {
    andConditions.push({ customerId: { not: null } });
    delete data.hasCustomer;
  } else if (data.hasCustomer === false) {
    andConditions.push({ customerId: null });
    delete data.hasCustomer;
  }

  if (data.hasTruck === true) {
    andConditions.push({ truck: { isNot: null } });
    delete data.hasTruck;
  } else if (data.hasTruck === false) {
    andConditions.push({ truck: { is: null } });
    delete data.hasTruck;
  }

  if (data.hasObservation === true) {
    andConditions.push({ observation: { isNot: null } });
    delete data.hasObservation;
  } else if (data.hasObservation === false) {
    andConditions.push({ observation: { is: null } });
    delete data.hasObservation;
  }

  if (data.hasArtworks === true) {
    andConditions.push({ artworks: { some: {} } });
    delete data.hasArtworks;
  } else if (data.hasArtworks === false) {
    andConditions.push({ artworks: { none: {} } });
    delete data.hasArtworks;
  }

  if (data.hasPaints === true) {
    andConditions.push({ logoPaints: { some: {} } });
    delete data.hasPaints;
  } else if (data.hasPaints === false) {
    andConditions.push({ logoPaints: { none: {} } });
    delete data.hasPaints;
  }

  // Commission functionality has been removed
  if (data.hasCommissions !== undefined) {
    delete data.hasCommissions;
  }

  if (data.hasServices === true) {
    andConditions.push({ services: { some: {} } });
    delete data.hasServices;
  } else if (data.hasServices === false) {
    andConditions.push({ services: { none: {} } });
    delete data.hasServices;
  }

  if (data.hasAirbrushing === true) {
    andConditions.push({ airbrushing: { some: {} } });
    delete data.hasAirbrushing;
  } else if (data.hasAirbrushing === false) {
    andConditions.push({ airbrushing: { none: {} } });
    delete data.hasAirbrushing;
  }

  if (data.hasBudget === true) {
    andConditions.push({ budgetId: { not: null } });
    delete data.hasBudget;
  } else if (data.hasBudget === false) {
    andConditions.push({ budgetId: null });
    delete data.hasBudget;
  }

  if (data.hasNfe === true) {
    andConditions.push({ nfeId: { not: null } });
    delete data.hasNfe;
  } else if (data.hasNfe === false) {
    andConditions.push({ nfeId: null });
    delete data.hasNfe;
  }

  if (data.hasReceipt === true) {
    andConditions.push({ receiptId: { not: null } });
    delete data.hasReceipt;
  } else if (data.hasReceipt === false) {
    andConditions.push({ receiptId: null });
    delete data.hasReceipt;
  }

  if (data.hasAssignee === true) {
    andConditions.push({
      createdById: { not: null },
    });
    delete data.hasAssignee;
  } else if (data.hasAssignee === false) {
    andConditions.push({
      createdById: null,
    });
    delete data.hasAssignee;
  }

  if (data.hasPaint === true) {
    andConditions.push({ paintId: { not: null } });
    delete data.hasPaint;
  } else if (data.hasPaint === false) {
    andConditions.push({ paintId: null });
    delete data.hasPaint;
  }

  if (data.hasLogoPaints === true) {
    andConditions.push({ logoPaints: { some: {} } });
    delete data.hasLogoPaints;
  } else if (data.hasLogoPaints === false) {
    andConditions.push({ logoPaints: { none: {} } });
    delete data.hasLogoPaints;
  }

  if (data.hasCuts === true) {
    andConditions.push({ cuts: { some: {} } });
    delete data.hasCuts;
  } else if (data.hasCuts === false) {
    andConditions.push({ cuts: { none: {} } });
    delete data.hasCuts;
  }

  if (data.hasRelatedTasks === true) {
    andConditions.push({ relatedTasks: { some: {} } });
    delete data.hasRelatedTasks;
  } else if (data.hasRelatedTasks === false) {
    andConditions.push({ relatedTasks: { none: {} } });
    delete data.hasRelatedTasks;
  }

  // Boolean is* filters
  if (data.isOverdue === true) {
    andConditions.push({
      AND: [{ term: { not: null } }, { term: { lt: new Date() } }, { status: { notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED] } }],
    });
    delete data.isOverdue;
  }

  if (data.isActive === true) {
    andConditions.push({
      status: { notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED] },
    });
    delete data.isActive;
  } else if (data.isActive === false) {
    andConditions.push({
      status: { in: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED] },
    });
    delete data.isActive;
  }

  if (data.isCompleted === true) {
    andConditions.push({ status: TASK_STATUS.COMPLETED });
    delete data.isCompleted;
  } else if (data.isCompleted === false) {
    andConditions.push({ status: { not: TASK_STATUS.COMPLETED } });
    delete data.isCompleted;
  }

  if (data.isPending === true) {
    andConditions.push({ status: TASK_STATUS.PENDING });
    delete data.isPending;
  } else if (data.isPending === false) {
    andConditions.push({ status: { not: TASK_STATUS.PENDING } });
    delete data.isPending;
  }

  if (data.isInProgress === true) {
    andConditions.push({ status: TASK_STATUS.IN_PRODUCTION });
    delete data.isInProgress;
  } else if (data.isInProgress === false) {
    andConditions.push({ status: { not: TASK_STATUS.IN_PRODUCTION } });
    delete data.isInProgress;
  }

  if (data.isOnHold === true) {
    andConditions.push({ status: TASK_STATUS.ON_HOLD });
    delete data.isOnHold;
  } else if (data.isOnHold === false) {
    andConditions.push({ status: { not: TASK_STATUS.ON_HOLD } });
    delete data.isOnHold;
  }

  if (data.isCancelled === true) {
    andConditions.push({ status: TASK_STATUS.CANCELLED });
    delete data.isCancelled;
  } else if (data.isCancelled === false) {
    andConditions.push({ status: { not: TASK_STATUS.CANCELLED } });
    delete data.isCancelled;
  }

  // Array filters with "in" operator
  if (data.sectorIds && Array.isArray(data.sectorIds) && data.sectorIds.length > 0) {
    andConditions.push({ sectorId: { in: data.sectorIds } });
    delete data.sectorIds;
  }

  if (data.customerIds && Array.isArray(data.customerIds) && data.customerIds.length > 0) {
    andConditions.push({ customerId: { in: data.customerIds } });
    delete data.customerIds;
  }

  // Assignee filtering - filter by users who created the task
  if (data.assigneeIds && Array.isArray(data.assigneeIds) && data.assigneeIds.length > 0) {
    andConditions.push({
      createdById: { in: data.assigneeIds }
    });
    delete data.assigneeIds;
  }

  if (data.createdByIds && Array.isArray(data.createdByIds) && data.createdByIds.length > 0) {
    andConditions.push({ createdById: { in: data.createdByIds } });
    delete data.createdByIds;
  }

  if (data.truckIds && Array.isArray(data.truckIds) && data.truckIds.length > 0) {
    andConditions.push({ truck: { id: { in: data.truckIds } } });
    delete data.truckIds;
  }

  if (data.paintIds && Array.isArray(data.paintIds) && data.paintIds.length > 0) {
    andConditions.push({ paintId: { in: data.paintIds } });
    delete data.paintIds;
  }

  if (data.logoPaintIds && Array.isArray(data.logoPaintIds) && data.logoPaintIds.length > 0) {
    andConditions.push({ logoPaints: { some: { id: { in: data.logoPaintIds } } } });
    delete data.logoPaintIds;
  }

  if (data.garageIds && Array.isArray(data.garageIds) && data.garageIds.length > 0) {
    andConditions.push({ truck: { garageId: { in: data.garageIds } } });
    delete data.garageIds;
  }


  // Date range filters
  if (data.entryDateRange && typeof data.entryDateRange === "object") {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.entryDateRange.from) {
      const fromDate = data.entryDateRange.from instanceof Date
        ? data.entryDateRange.from
        : new Date(data.entryDateRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.entryDateRange.to) {
      const toDate = data.entryDateRange.to instanceof Date
        ? data.entryDateRange.to
        : new Date(data.entryDateRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ entryDate: condition });
    }
    delete data.entryDateRange;
  }

  if (data.termRange && typeof data.termRange === "object") {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.termRange.from) {
      const fromDate = data.termRange.from instanceof Date
        ? data.termRange.from
        : new Date(data.termRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.termRange.to) {
      const toDate = data.termRange.to instanceof Date
        ? data.termRange.to
        : new Date(data.termRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ term: condition });
    }
    delete data.termRange;
  }

  if (data.startedDateRange && typeof data.startedDateRange === "object") {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.startedDateRange.from) {
      const fromDate = data.startedDateRange.from instanceof Date
        ? data.startedDateRange.from
        : new Date(data.startedDateRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.startedDateRange.to) {
      const toDate = data.startedDateRange.to instanceof Date
        ? data.startedDateRange.to
        : new Date(data.startedDateRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ startedAt: condition });
    }
    delete data.startedDateRange;
  }

  if (data.finishedDateRange && typeof data.finishedDateRange === "object") {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.finishedDateRange.from) {
      const fromDate = data.finishedDateRange.from instanceof Date
        ? data.finishedDateRange.from
        : new Date(data.finishedDateRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.finishedDateRange.to) {
      const toDate = data.finishedDateRange.to instanceof Date
        ? data.finishedDateRange.to
        : new Date(data.finishedDateRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ finishedAt: condition });
    }
    delete data.finishedDateRange;
  }

  if (data.createdAtRange && typeof data.createdAtRange === "object") {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.createdAtRange.from) {
      const fromDate = data.createdAtRange.from instanceof Date
        ? data.createdAtRange.from
        : new Date(data.createdAtRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.createdAtRange.to) {
      const toDate = data.createdAtRange.to instanceof Date
        ? data.createdAtRange.to
        : new Date(data.createdAtRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ createdAt: condition });
    }
    delete data.createdAtRange;
  }

  if (data.updatedAtRange && typeof data.updatedAtRange === "object") {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.updatedAtRange.from) {
      const fromDate = data.updatedAtRange.from instanceof Date
        ? data.updatedAtRange.from
        : new Date(data.updatedAtRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.updatedAtRange.to) {
      const toDate = data.updatedAtRange.to instanceof Date
        ? data.updatedAtRange.to
        : new Date(data.updatedAtRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ updatedAt: condition });
    }
    delete data.updatedAtRange;
  }

  // Direct date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    console.log("[TaskTransform] andConditions count:", andConditions.length);
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  console.log("[TaskTransform] Final output:", {
    hasWhere: !!data.where,
    whereKeys: data.where ? Object.keys(data.where) : [],
    whereStringified: data.where ? JSON.stringify(data.where).substring(0, 200) : "undefined",
    searchingFor: data.searchingFor,
  });

  return data;
};

// =====================
// Query Schema
// =====================

export const taskGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    take: z.coerce.number().int().positive().max(1000).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    searchingFor: z.string().optional(),
    status: z.union([z.nativeEnum(TASK_STATUS), z.array(z.nativeEnum(TASK_STATUS))]).optional(),
    statusOrder: z.array(z.number()).optional(),
    // Boolean relation filters
    hasSector: z.boolean().optional(),
    hasCustomer: z.boolean().optional(),
    hasAssignee: z.boolean().optional(),
    hasTruck: z.boolean().optional(),
    hasObservation: z.boolean().optional(),
    hasArtworks: z.boolean().optional(),
    hasPaints: z.boolean().optional(),
    hasServices: z.boolean().optional(),
    hasAirbrushing: z.boolean().optional(),
    hasBudget: z.boolean().optional(),
    hasNfe: z.boolean().optional(),
    hasReceipt: z.boolean().optional(),
    hasPaint: z.boolean().optional(), // Filter by whether task has a general painting/paint assigned
    hasLogoPaints: z.boolean().optional(), // Filter by whether task has logo paints
    hasCuts: z.boolean().optional(), // Filter by whether task has cut requests/plans
    hasRelatedTasks: z.boolean().optional(), // Filter by whether task has related tasks
    // Boolean status convenience filters
    isOverdue: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isCompleted: z.boolean().optional(),
    isPending: z.boolean().optional(),
    isInProgress: z.boolean().optional(),
    isOnHold: z.boolean().optional(),
    isCancelled: z.boolean().optional(),
    // Entity ID filters
    sectorIds: z.array(z.string()).optional(),
    customerIds: z.array(z.string()).optional(),
    assigneeIds: z.array(z.string()).optional(),
    createdByIds: z.array(z.string()).optional(),
    truckIds: z.array(z.string()).optional(),
    paintIds: z.array(z.string()).optional(), // Filter by general painting/paint ID
    logoPaintIds: z.array(z.string()).optional(), // Filter by logo paint IDs
    garageIds: z.array(z.string()).optional(), // Filter tasks by truck garage location
    // Numeric range filters
    progressRange: z
      .object({
        from: z.number().min(0).max(100).optional(),
        to: z.number().min(0).max(100).optional(),
      })
      .optional(),
    ageRange: z
      .object({
        from: z.number().min(0).optional(),
        to: z.number().min(0).optional(),
      })
      .optional(),
    durationRange: z
      .object({
        from: z.number().min(0).optional(),
        to: z.number().min(0).optional(),
      })
      .optional(),
    daysUntilDeadlineRange: z
      .object({
        from: z.number().optional(),
        to: z.number().optional(),
      })
      .optional(),
    entryDateRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["to"],
        },
      )
      .optional(),
    termRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["to"],
        },
      )
      .optional(),
    startedDateRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["to"],
        },
      )
      .optional(),
    finishedDateRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["to"],
        },
      )
      .optional(),
    createdAtRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["to"],
        },
      )
      .optional(),
    updatedAtRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["to"],
        },
      )
      .optional(),
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["lte"],
        },
      )
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["lte"],
        },
      )
      .optional(),
    where: taskWhereSchema.optional(),
    orderBy: taskOrderBySchema.optional(),
    include: taskIncludeSchema.optional(),
  })
  .transform(taskTransform);

// =====================
// Nested Schemas for Relations
// =====================

// Observation schema without taskId (will be auto-linked)
const taskObservationCreateSchema = z.object({
  description: z.string().min(1, "Descrição é obrigatória"),
  // Accept any string for fileIds to support temporary file IDs (e.g., "1760878145245-xdmtocbjn")
  // These will be replaced with actual UUIDs after upload
  fileIds: z.array(z.string().min(1, "ID do arquivo inválido")).optional(),
});

// ServiceOrder schema without taskId (will be auto-linked)
const taskServiceOrderCreateSchema = z.object({
  status: z
    .enum(Object.values(SERVICE_ORDER_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: "status inválido" }),
    })
    .default(SERVICE_ORDER_STATUS.PENDING),
  statusOrder: z.number().int().min(1).max(4).default(1).optional(),
  description: z.string().min(3, { message: "Mínimo de 3 caracteres" }).max(400, { message: "Máximo de 40 caracteres atingido" }),
  startedAt: nullableDate.optional(),
  finishedAt: nullableDate.optional(),
});

// Truck schema
const taskTruckCreateSchema = z.object({
  xPosition: z.number().nullable().optional(),
  yPosition: z.number().nullable().optional(),
  garageId: z.string().uuid("Garagem inválida").nullable().optional(),
});

// Layout data schema for embedding in task create/update
const taskLayoutDataSchema = z.object({
  leftSide: z.object({
    height: z.number().positive(),
    layoutSections: z.array(z.object({
      width: z.number().positive(),
      isDoor: z.boolean(),
      doorHeight: z.number().nullable(),
      position: z.number(),
    })),
    photoId: z.string().uuid().nullable().optional(),
  }).nullable().optional(),
  rightSide: z.object({
    height: z.number().positive(),
    layoutSections: z.array(z.object({
      width: z.number().positive(),
      isDoor: z.boolean(),
      doorHeight: z.number().nullable(),
      position: z.number(),
    })),
    photoId: z.string().uuid().nullable().optional(),
  }).nullable().optional(),
  backSide: z.object({
    height: z.number().positive(),
    layoutSections: z.array(z.object({
      width: z.number().positive(),
      isDoor: z.boolean(),
      doorHeight: z.number().nullable(),
      position: z.number(),
    })),
    photoId: z.string().uuid().nullable().optional(),
  }).nullable().optional(),
}).nullable().optional();

// =====================
// CRUD Schemas
// =====================

// Base task create schema with all relations
export const taskCreateSchema = z
  .object({
    // Basic fields
    name: createNameSchema(3, 200, "nome da tarefa"),
    status: z
      .enum(Object.values(TASK_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "status inválido" }),
      })
      .default(TASK_STATUS.PENDING),
    serialNumber: z
      .string()
      .optional()
      .nullable()
      .transform((val) => (val === "" ? null : val))
      .refine((val) => !val || /^[A-Z0-9-]+$/.test(val), {
        message: "Número de série deve conter apenas letras maiúsculas, números e hífens",
      }),
    details: createDescriptionSchema(1, 1000, false).nullable().optional(),
    entryDate: nullableDate.optional(),
    term: nullableDate.optional(),
    startedAt: nullableDate.optional(),
    finishedAt: nullableDate.optional(),
    paintId: z.string().uuid("Tinta inválida").nullable().optional(),
    customerId: z.string().uuid("Cliente inválido").min(1, "Cliente é obrigatório"),
    sectorId: z.string().uuid("Setor inválido").nullable().optional(),
    commission: z
      .enum(Object.values(COMMISSION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "Status de comissão inválido" }),
      })
      .default(COMMISSION_STATUS.FULL_COMMISSION),

    // Relations - File arrays (can be UUIDs of existing files or will be populated from uploaded files)
    budgetIds: z.array(z.string().uuid("Orçamento inválido")).optional(),
    invoiceIds: z.array(z.string().uuid("NFe inválida")).optional(),
    receiptIds: z.array(z.string().uuid("Recibo inválido")).optional(),
    reimbursementIds: z.array(z.string().uuid("Reimbursement inválido")).optional(),
    reimbursementInvoiceIds: z.array(z.string().uuid("NFe de reimbursement inválida")).optional(),
    artworkIds: z.array(z.string().uuid("Arquivo inválido")).optional(),
    paintIds: z.array(z.string().uuid("Tinta inválida")).optional(),
    // Single file IDs (alternative to arrays for budget, nfe, receipt) - used by frontend form
    budgetId: z.string().uuid("Orçamento inválido").nullable().optional(),
    nfeId: z.string().uuid("NFe inválida").nullable().optional(),
    receiptId: z.string().uuid("Recibo inválido").nullable().optional(),
    observation: taskObservationCreateSchema.nullable().optional(),
    services: z.array(taskServiceOrderCreateSchema).min(1, "Pelo menos um serviço é obrigatório"),
    budget: budgetCreateNestedSchema.nullable().optional(),
    truck: taskTruckCreateSchema.nullable().optional(),
    truckLayoutData: taskLayoutDataSchema, // Layout data for truck
    cut: cutCreateNestedSchema.nullable().optional(),
    cuts: z.array(cutCreateNestedSchema).optional(), // Support for multiple cuts
    airbrushings: z.array(airbrushingCreateNestedSchema).optional(), // Support for multiple airbrushings
  })
  .superRefine((data, ctx) => {
    if (data.entryDate && data.term && data.term <= data.entryDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de término deve ser posterior à data de entrada",
        path: ["term"],
      });
    }

    if (data.entryDate && data.startedAt && data.startedAt < data.entryDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de início deve ser posterior ou igual à data de entrada",
        path: ["startedAt"],
      });
    }

    if (data.startedAt && data.finishedAt && data.finishedAt <= data.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de finalização deve ser posterior à data de início",
        path: ["finishedAt"],
      });
    }

    // Validate status-based requirements
    if (data.status === TASK_STATUS.IN_PRODUCTION && !data.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de início é obrigatória para tarefas em produção",
        path: ["startedAt"],
      });
    }

    if (data.status === TASK_STATUS.COMPLETED && !data.finishedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de conclusão é obrigatória para tarefas concluídas",
        path: ["finishedAt"],
      });
    }
  })
  .transform((data) => {
    // Map artworkIds to fileIds for backend compatibility
    const transformed: any = { ...data };
    if (transformed.artworkIds) {
      transformed.fileIds = transformed.artworkIds;
      delete transformed.artworkIds;
    }
    return transformed;
  });

// Base task update schema with all relations
export const taskUpdateSchema = z
  .object({
    // Basic fields
    name: createNameSchema(3, 200, "nome da tarefa").optional(),
    status: z
      .enum(Object.values(TASK_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "status inválido" }),
      })
      .optional(),
    serialNumber: z
      .string()
      .regex(/^[A-Z0-9-]+$/, "Número de série deve conter apenas letras maiúsculas, números e hífens")
      .nullable()
      .optional(),
    details: createDescriptionSchema(1, 1000, false).nullable().optional(),
    entryDate: nullableDate.optional(),
    term: nullableDate.optional(),
    startedAt: nullableDate.optional(),
    finishedAt: nullableDate.optional(),
    paintId: z.string().uuid("Tinta inválida").nullable().optional(),
    customerId: z.string().uuid("Cliente inválido").nullable().optional(),
    sectorId: z.string().uuid("Setor inválido").nullable().optional(),
    commission: z
      .enum(Object.values(COMMISSION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "Status de comissão inválido" }),
      })
      .optional(),

    // Relations - File arrays
    budgetIds: z.array(z.string().uuid("Orçamento inválido")).optional(),
    invoiceIds: z.array(z.string().uuid("NFe inválida")).optional(),
    receiptIds: z.array(z.string().uuid("Recibo inválido")).optional(),
    reimbursementIds: z.array(z.string().uuid("Reimbursement inválido")).optional(),
    reimbursementInvoiceIds: z.array(z.string().uuid("NFe de reimbursement inválida")).optional(),
    artworkIds: z.array(z.string().uuid("Arquivo inválido")).optional(),
    paintIds: z.array(z.string().uuid("Tinta inválida")).optional(),
    observation: taskObservationCreateSchema.nullable().optional(),
    services: z.array(taskServiceOrderCreateSchema).optional(),
    budget: budgetCreateNestedSchema.nullable().optional(),
    truck: taskTruckCreateSchema.nullable().optional(),
    truckLayoutData: taskLayoutDataSchema, // Layout data for truck
    cut: cutCreateNestedSchema.nullable().optional(),
    cuts: z.array(cutCreateNestedSchema).optional(), // Support for multiple cuts
    airbrushings: z.array(airbrushingCreateNestedSchema).optional(), // Support for multiple airbrushings
  })
  .superRefine((data, ctx) => {
    if (data.entryDate && data.term && data.term <= data.entryDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de término deve ser posterior à data de entrada",
        path: ["term"],
      });
    }

    if (data.entryDate && data.startedAt && data.startedAt < data.entryDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de início deve ser posterior ou igual à data de entrada",
        path: ["startedAt"],
      });
    }

    if (data.startedAt && data.finishedAt && data.finishedAt <= data.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de finalização deve ser posterior à data de início",
        path: ["finishedAt"],
      });
    }

    // Validate status-based requirements
    if (data.status === TASK_STATUS.IN_PRODUCTION && !data.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de início é obrigatória para tarefas em produção",
        path: ["startedAt"],
      });
    }

    if (data.status === TASK_STATUS.COMPLETED && !data.finishedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de conclusão é obrigatória para tarefas concluídas",
        path: ["finishedAt"],
      });
    }
  })
  .transform((data) => {
    // Map artworkIds to fileIds for backend compatibility
    const transformed: any = { ...data };
    if (transformed.artworkIds) {
      transformed.fileIds = transformed.artworkIds;
      delete transformed.artworkIds;
    }
    return transformed;
  });

// =====================
// Batch Operations Schemas
// =====================

export const taskBatchCreateSchema = z.object({
  tasks: z.array(taskCreateSchema).min(1, "Pelo menos uma tarefa deve ser fornecida"),
});

export const taskBatchUpdateSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().uuid("Tarefa inválida"),
        data: taskUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma tarefa deve ser fornecida"),
});

export const taskBatchDeleteSchema = z.object({
  taskIds: z.array(z.string().uuid("Tarefa inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const taskQuerySchema = z.object({
  include: taskIncludeSchema.optional(),
});

// =====================
// Duplicate Schema
// =====================

export const taskDuplicateSchema = z.object({
  taskId: z.string().uuid("Tarefa inválida"),
  modifications: taskUpdateSchema.optional(),
});

// =====================
// GetById Schema
// =====================

export const taskGetByIdSchema = z.object({
  include: taskIncludeSchema.optional(),
  id: z.string().uuid("Tarefa inválida"),
});

// =====================
// Type Inference (FormData types)
// =====================

export type TaskGetManyFormData = z.infer<typeof taskGetManySchema>;
export type TaskGetByIdFormData = z.infer<typeof taskGetByIdSchema>;
export type TaskQueryFormData = z.infer<typeof taskQuerySchema>;

export type TaskCreateFormData = z.infer<typeof taskCreateSchema>;
export type TaskUpdateFormData = z.infer<typeof taskUpdateSchema>;
export type TaskDuplicateFormData = z.infer<typeof taskDuplicateSchema>;

export type TaskBatchCreateFormData = z.infer<typeof taskBatchCreateSchema>;
export type TaskBatchUpdateFormData = z.infer<typeof taskBatchUpdateSchema>;
export type TaskBatchDeleteFormData = z.infer<typeof taskBatchDeleteSchema>;

export type TaskInclude = z.infer<typeof taskIncludeSchema>;
export type TaskOrderBy = z.infer<typeof taskOrderBySchema>;
export type TaskWhere = z.infer<typeof taskWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapTaskToFormData = createMapToFormDataHelper<Task, TaskUpdateFormData>((task) => ({
  name: task.name,
  status: task.status,
  statusOrder: task.statusOrder || undefined,
  serialNumber: task.serialNumber,
  details: task.details,
  entryDate: task.entryDate,
  term: task.term,
  startedAt: task.startedAt,
  finishedAt: task.finishedAt,
  paintId: task.paintId,
  customerId: task.customerId,
  sectorId: task.sectorId,
  // Relations - File arrays
  budgetIds: task.budgets?.map((budget) => budget.id),
  invoiceIds: task.invoices?.map((invoice) => invoice.id),
  receiptIds: task.receipts?.map((receipt) => receipt.id),
  reimbursementIds: task.reimbursements?.map((reimbursement) => reimbursement.id),
  reimbursementInvoiceIds: task.invoiceReimbursements?.map((reimbursementInvoice) => reimbursementInvoice.id),
  artworkIds: task.artworks?.map((artwork) => artwork.id),
  paintIds: task.logoPaints?.map((paint) => paint.id),
  generalPaintingId: task.generalPainting?.id,
  // Complex relations need to be handled separately
}));

// =====================
// Task Positioning Schemas
// =====================

// Schema for updating a single truck position
export const taskPositionUpdateSchema = z.object({
  xPosition: z.number().nullable().optional(),
  yPosition: z.number().nullable().optional(),
  garageId: z.string().uuid().nullable().optional(),
});

export type TaskPositionUpdateFormData = z.infer<typeof taskPositionUpdateSchema>;

// Schema for bulk updating truck positions
export const taskBulkPositionUpdateSchema = z.object({
  updates: z.array(
    z.object({
      taskId: z.string().uuid(),
      xPosition: z.number().nullable().optional(),
      yPosition: z.number().nullable().optional(),
      garageId: z.string().uuid().nullable().optional(),
    })
  ),
});

export type TaskBulkPositionUpdateFormData = z.infer<typeof taskBulkPositionUpdateSchema>;

// Schema for swapping two trucks
export const taskSwapPositionSchema = z.object({
  targetTaskId: z.string().uuid(),
});

export type TaskSwapPositionFormData = z.infer<typeof taskSwapPositionSchema>;
