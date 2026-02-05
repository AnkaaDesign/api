// packages/schemas/src/task.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  orderByWithNullsSchema,
  normalizeOrderBy,
  createNameSchema,
  createDescriptionSchema,
  nullableDate,
  moneySchema,
} from './common';
import type { Task } from '@types';
import {
  TASK_STATUS,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  COMMISSION_STATUS,
  TRUCK_CATEGORY,
  IMPLEMENT_TYPE,
  TRUCK_SPOT,
} from '@constants';
import { cutCreateNestedSchema } from './cut';
import { airbrushingCreateNestedSchema } from './airbrushing';
import { taskPricingCreateNestedSchema } from './task-pricing';

// Helper to filter out empty strings from UUID arrays before validation
// This handles cases where FormData sends [''] for empty arrays
const uuidArraySchema = (errorMessage: string) =>
  z.preprocess(
    val => (Array.isArray(val) ? val.filter(v => v !== '' && v !== null && v !== undefined) : val),
    z.array(z.string().uuid(errorMessage)).optional(),
  );

// =====================
// Select Schema (Field-level selection)
// =====================

/**
 * Task Select Schema - enables partial field selection for optimal performance
 *
 * Usage:
 * - Reduces data transfer by selecting only needed fields
 * - Improves query performance by avoiding unnecessary joins
 * - Supports nested selects for related entities
 *
 * Examples:
 * ```typescript
 * // Select only id and name
 * { select: { id: true, name: true } }
 *
 * // Select task with customer fantasyName only
 * { select: { id: true, name: true, customer: { select: { id: true, fantasyName: true } } } }
 *
 * // Select task with paint but exclude formula
 * { select: { id: true, generalPainting: { select: { id: true, name: true, code: true } } } }
 * ```
 */
export const taskSelectSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Basic fields
      id: z.boolean().optional(),
      name: z.boolean().optional(),
      status: z.boolean().optional(),
      statusOrder: z.boolean().optional(),
      commission: z.boolean().optional(),
      serialNumber: z.boolean().optional(),
      details: z.boolean().optional(),
      entryDate: z.boolean().optional(),
      term: z.boolean().optional(),
      startedAt: z.boolean().optional(),
      finishedAt: z.boolean().optional(),
      forecastDate: z.boolean().optional(),
      createdAt: z.boolean().optional(),
      updatedAt: z.boolean().optional(),

      // Foreign keys
      paintId: z.boolean().optional(),
      customerId: z.boolean().optional(),
      invoiceToId: z.boolean().optional(),
      sectorId: z.boolean().optional(),
      createdById: z.boolean().optional(),
      pricingId: z.boolean().optional(),

      // Relations with nested select support
      sector: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                description: z.boolean().optional(),
                isActive: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      customer: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                fantasyName: z.boolean().optional(), // Most common - used in lists
                corporateName: z.boolean().optional(),
                cnpj: z.boolean().optional(),
                cpf: z.boolean().optional(),
                phone: z.boolean().optional(),
                email: z.boolean().optional(),
                address: z.boolean().optional(),
                city: z.boolean().optional(),
                state: z.boolean().optional(),
                zipCode: z.boolean().optional(),
                isActive: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      invoiceTo: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                fantasyName: z.boolean().optional(),
                corporateName: z.boolean().optional(),
                cnpj: z.boolean().optional(),
                cpf: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      budgets: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                path: z.boolean().optional(),
                mimetype: z.boolean().optional(),
                size: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      invoices: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                path: z.boolean().optional(),
                mimetype: z.boolean().optional(),
                size: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      receipts: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                path: z.boolean().optional(),
                mimetype: z.boolean().optional(),
                size: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      observation: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                description: z.boolean().optional(),
                taskId: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      generalPainting: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                code: z.boolean().optional(),
                hexColor: z.boolean().optional(),
                hslColor: z.boolean().optional(),
                finish: z.boolean().optional(),
                isActive: z.boolean().optional(),
                paintTypeId: z.boolean().optional(),
                paintBrandId: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
                // Note: formulas intentionally excluded for performance
                // Use include if formulas are needed
              })
              .optional(),
          }),
        ])
        .optional(),

      createdBy: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                email: z.boolean().optional(),
                avatar: z.boolean().optional(),
                positionId: z.boolean().optional(),
                sectorId: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      artworks: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                fileId: z.boolean().optional(),
                taskId: z.boolean().optional(),
                status: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
                file: z
                  .union([
                    z.boolean(),
                    z.object({
                      select: z
                        .object({
                          id: z.boolean().optional(),
                          name: z.boolean().optional(),
                          path: z.boolean().optional(),
                          mimetype: z.boolean().optional(),
                          size: z.boolean().optional(),
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

      baseFiles: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                path: z.boolean().optional(),
                mimetype: z.boolean().optional(),
                size: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      logoPaints: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                code: z.boolean().optional(),
                hexColor: z.boolean().optional(),
                hslColor: z.boolean().optional(),
                finish: z.boolean().optional(),
                isActive: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
                // Note: formulas excluded by default
              })
              .optional(),
          }),
        ])
        .optional(),

      serviceOrders: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                status: z.boolean().optional(),
                statusOrder: z.boolean().optional(),
                type: z.boolean().optional(),
                description: z.boolean().optional(),
                assignedToId: z.boolean().optional(),
                observation: z.boolean().optional(),
                startedAt: z.boolean().optional(),
                finishedAt: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      pricing: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                totalValue: z.boolean().optional(),
                profitMargin: z.boolean().optional(),
                status: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
                items: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      truck: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                plate: z.boolean().optional(),
                chassisNumber: z.boolean().optional(),
                spot: z.boolean().optional(),
                category: z.boolean().optional(),
                implementType: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),

      airbrushing: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                status: z.boolean().optional(),
                description: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
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
            select: z.lazy(() => taskSelectSchema).optional(),
          }),
        ])
        .optional(),

      relatedTo: z
        .union([
          z.boolean(),
          z.object({
            select: z.lazy(() => taskSelectSchema).optional(),
          }),
        ])
        .optional(),

      representatives: z
        .union([
          z.boolean(),
          z.object({
            select: z
              .object({
                id: z.boolean().optional(),
                name: z.boolean().optional(),
                phone: z.boolean().optional(),
                email: z.boolean().optional(),
                role: z.boolean().optional(),
                isActive: z.boolean().optional(),
                customerId: z.boolean().optional(),
                createdAt: z.boolean().optional(),
                updatedAt: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
    })
    .partial(),
);

// =====================
// Predefined Select Schemas for Common Use Cases
// =====================

/**
 * Minimal select for task lists (table views)
 * Use this for: preparation view, schedule view, history lists
 */
export const taskSelectMinimal = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  entryDate: true,
  term: true,
  forecastDate: true,
  customer: {
    select: {
      id: true,
      fantasyName: true, // Only fantasy name for performance
    },
  },
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  truck: {
    select: {
      id: true,
      plate: true,
      spot: true,
    },
  },
};

/**
 * Table view select (adds more details for main task table)
 */
export const taskSelectTable = {
  ...taskSelectMinimal,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
    },
  },
  generalPainting: {
    select: {
      id: true,
      name: true,
      code: true,
      hexColor: true,
      // No formulas for performance
    },
  },
  _count: {
    select: {
      serviceOrders: true,
      artworks: true,
      logoPaints: true,
    },
  },
};

/**
 * Detail view select (comprehensive data for single task view)
 */
export const taskSelectDetail = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  commission: true,
  serialNumber: true,
  details: true,
  entryDate: true,
  term: true,
  startedAt: true,
  finishedAt: true,
  forecastDate: true,
  createdAt: true,
  updatedAt: true,
  paintId: true,
  customerId: true,
  invoiceToId: true,
  sectorId: true,
  createdById: true,
  pricingId: true,
  sector: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
  customer: {
    select: {
      id: true,
      fantasyName: true,
      corporateName: true,
      cnpj: true,
      cpf: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      state: true,
      zipCode: true,
    },
  },
  invoiceTo: {
    select: {
      id: true,
      fantasyName: true,
      corporateName: true,
      cnpj: true,
      cpf: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
    },
  },
  generalPainting: {
    select: {
      id: true,
      name: true,
      code: true,
      hexColor: true,
      hslColor: true,
      finish: true,
      // Formulas excluded - use include if needed
    },
  },
  observation: {
    select: {
      id: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
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
  budgets: {
    select: {
      id: true,
      name: true,
      path: true,
      mimetype: true,
      size: true,
    },
  },
  invoices: {
    select: {
      id: true,
      name: true,
      path: true,
      mimetype: true,
      size: true,
    },
  },
  receipts: {
    select: {
      id: true,
      name: true,
      path: true,
      mimetype: true,
      size: true,
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
          name: true,
          path: true,
          mimetype: true,
          size: true,
        },
      },
    },
  },
  baseFiles: {
    select: {
      id: true,
      name: true,
      path: true,
      mimetype: true,
      size: true,
    },
  },
  logoPaints: {
    select: {
      id: true,
      name: true,
      code: true,
      hexColor: true,
      hslColor: true,
      finish: true,
      // No formulas for performance
    },
  },
  serviceOrders: {
    select: {
      id: true,
      status: true,
      statusOrder: true,
      type: true,
      description: true,
      assignedToId: true,
      observation: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  pricing: {
    select: {
      id: true,
      totalValue: true,
      profitMargin: true,
      status: true,
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
      },
    },
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

/**
 * Form select (optimized for form editing)
 */
export const taskSelectForm = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  commission: true,
  serialNumber: true,
  details: true,
  entryDate: true,
  term: true,
  startedAt: true,
  finishedAt: true,
  forecastDate: true,
  paintId: true,
  customerId: true,
  invoiceToId: true,
  sectorId: true,
  createdById: true,
  pricingId: true,
  // Only IDs for relations - form will load full data as needed
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  customer: {
    select: {
      id: true,
      fantasyName: true, // For display in form
    },
  },
  generalPainting: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
};

/**
 * Preparation list select (for production preparation view)
 */
export const taskSelectPreparation = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  entryDate: true,
  term: true,
  forecastDate: true,
  customer: {
    select: {
      id: true,
      fantasyName: true,
    },
  },
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  truck: {
    select: {
      id: true,
      plate: true,
      spot: true,
      category: true,
    },
  },
  generalPainting: {
    select: {
      id: true,
      name: true,
      hexColor: true,
    },
  },
  serviceOrders: {
    select: {
      id: true,
      status: true,
      type: true,
      description: true,
    },
  },
  _count: {
    select: {
      artworks: true,
      logoPaints: true,
    },
  },
};

/**
 * Schedule list select (for production schedule/agenda)
 */
export const taskSelectSchedule = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  term: true,
  forecastDate: true,
  startedAt: true,
  customer: {
    select: {
      id: true,
      fantasyName: true,
    },
  },
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  truck: {
    select: {
      id: true,
      plate: true,
      spot: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
    },
  },
};

/**
 * History list select (for completed/cancelled tasks)
 */
export const taskSelectHistory = {
  id: true,
  name: true,
  status: true,
  serialNumber: true,
  entryDate: true,
  startedAt: true,
  finishedAt: true,
  customer: {
    select: {
      id: true,
      fantasyName: true,
    },
  },
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  truck: {
    select: {
      id: true,
      plate: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
    },
  },
};

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
      invoiceTo: z
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
                file: z.boolean().optional(), // Include the File entity
                task: z.boolean().optional(), // Include the Task entity
                airbrushing: z.boolean().optional(), // Include the Airbrushing entity
              })
              .optional(),
          }),
        ])
        .optional(),
      baseFiles: z
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
      serviceOrders: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                task: z.boolean().optional(),
                assignedTo: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      pricing: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                tasks: z.boolean().optional(),
                items: z.boolean().optional(),
                layoutFile: z.boolean().optional(),
                customerSignature: z.boolean().optional(),
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
      representatives: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                customer: z.boolean().optional(),
              })
              .optional(),
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
      serialNumber: orderByWithNullsSchema.optional(),
      entryDate: orderByDirectionSchema.optional(),
      term: orderByDirectionSchema.optional(),
      startedAt: orderByDirectionSchema.optional(),
      finishedAt: orderByDirectionSchema.optional(),
      forecastDate: orderByWithNullsSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        serialNumber: orderByWithNullsSchema.optional(),
        entryDate: orderByDirectionSchema.optional(),
        term: orderByDirectionSchema.optional(),
        startedAt: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
        forecastDate: orderByWithNullsSchema.optional(),
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
      id: z
        .union([
          z.string(),
          z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() }),
        ])
        .optional(),
      name: z
        .union([
          z.string(),
          z.object({
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
          }),
        ])
        .optional(),
      status: z
        .union([
          z.nativeEnum(TASK_STATUS),
          z.object({ in: z.array(z.nativeEnum(TASK_STATUS)).optional() }),
        ])
        .optional(),
      statusOrder: z
        .union([z.number(), z.object({ gte: z.number().optional(), lte: z.number().optional() })])
        .optional(),
      serialNumber: z.union([z.string(), z.object({ contains: z.string().optional() })]).optional(),
      details: z.union([z.string(), z.object({ contains: z.string().optional() })]).optional(),
      commission: z
        .union([
          z.string(),
          z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() }),
        ])
        .optional(),
      entryDate: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      term: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      startedAt: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      finishedAt: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      createdAt: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      updatedAt: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      customerId: z
        .union([z.string(), z.object({ in: z.array(z.string()).optional() })])
        .optional(),
      sectorId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      paintId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      invoiceIds: z.array(z.string()).optional(),
      receiptIds: z.array(z.string()).optional(),
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
      serviceOrders: z
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
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    andConditions.push({
      OR: [
        // Direct task fields
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { serialNumber: { contains: searchTerm, mode: 'insensitive' } },
        { details: { contains: searchTerm, mode: 'insensitive' } },
        // Related entities
        { customer: { fantasyName: { contains: searchTerm, mode: 'insensitive' } } },
        { customer: { corporateName: { contains: searchTerm, mode: 'insensitive' } } },
        { customer: { cpf: { contains: searchTerm, mode: 'insensitive' } } },
        { customer: { cnpj: { contains: searchTerm, mode: 'insensitive' } } },
        { sector: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { createdBy: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { observation: { description: { contains: searchTerm, mode: 'insensitive' } } },
        // ProductionServiceOrder only has description field, no name field
        { serviceOrders: { some: { description: { contains: searchTerm, mode: 'insensitive' } } } },
        // Paint relations - search by paint name
        { generalPainting: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { generalPainting: { code: { contains: searchTerm, mode: 'insensitive' } } },
        { logoPaints: { some: { name: { contains: searchTerm, mode: 'insensitive' } } } },
        { logoPaints: { some: { code: { contains: searchTerm, mode: 'insensitive' } } } },
        // Truck search - plate, chassisNumber
        { truck: { plate: { contains: searchTerm, mode: 'insensitive' } } },
        { truck: { chassisNumber: { contains: searchTerm, mode: 'insensitive' } } },
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
    andConditions.push({ serviceOrders: { some: {} } });
    delete data.hasServices;
  } else if (data.hasServices === false) {
    andConditions.push({ serviceOrders: { none: {} } });
    delete data.hasServices;
  }

  // For financial users: show tasks with ANY incomplete service orders (all types)
  if (data.hasIncompleteServiceOrders === true) {
    andConditions.push({
      OR: [
        { serviceOrders: { none: {} } }, // No service orders
        {
          serviceOrders: {
            some: {
              status: { in: ['PENDING', 'IN_PROGRESS'] },
            },
          },
        },
      ],
    });
    delete data.hasIncompleteServiceOrders;
  }

  // For admin users: show tasks with incomplete COMMERCIAL/PRODUCTION/ARTWORK service orders
  if (data.hasIncompleteNonFinancialServiceOrders === true) {
    andConditions.push({
      OR: [
        { serviceOrders: { none: {} } }, // No service orders
        {
          serviceOrders: {
            some: {
              AND: [
                { type: { in: ['COMMERCIAL', 'PRODUCTION', 'ARTWORK'] } },
                { status: { in: ['PENDING', 'IN_PROGRESS'] } },
              ],
            },
          },
        },
      ],
    });
    delete data.hasIncompleteNonFinancialServiceOrders;
  }

  // Agenda display logic:
  // 1. CANCELLED tasks are never shown
  // 2. COMPLETED tasks are only hidden if they have required service order types AND all SOs are completed
  // 3. All other tasks are shown
  //
  // Role-based behavior (5 service order types: PRODUCTION, FINANCIAL, COMMERCIAL, ARTWORK, LOGISTIC):
  // - FINANCIAL users: Need PRODUCTION, COMMERCIAL, ARTWORK, FINANCIAL (exclude LOGISTIC)
  // - LOGISTIC users: Need PRODUCTION, COMMERCIAL, ARTWORK, LOGISTIC (exclude FINANCIAL)
  // - All other users (including ADMIN): Only need PRODUCTION, COMMERCIAL, ARTWORK (exclude both)
  if (data.shouldDisplayInPreparation === true) {
    const excludeFinancial = data.preparationExcludeFinancial === true;
    const excludeLogistic = data.preparationExcludeLogistic === true;

    // Build the required service order types check based on role
    // Base types that everyone needs
    const requiredTypesCheck: any[] = [
      { serviceOrders: { some: { type: 'PRODUCTION' } } },
      { serviceOrders: { some: { type: 'COMMERCIAL' } } },
      { serviceOrders: { some: { type: 'ARTWORK' } } },
    ];

    // Add FINANCIAL if not excluded
    if (!excludeFinancial) {
      requiredTypesCheck.push({ serviceOrders: { some: { type: 'FINANCIAL' } } });
    }

    // Add LOGISTIC if not excluded
    if (!excludeLogistic) {
      requiredTypesCheck.push({ serviceOrders: { some: { type: 'LOGISTIC' } } });
    }

    // Build the excluded types array for incomplete SO check
    const excludedTypes: string[] = [];
    if (excludeFinancial) excludedTypes.push('FINANCIAL');
    if (excludeLogistic) excludedTypes.push('LOGISTIC');

    // Build the incomplete service orders check based on role
    const incompleteSOCheck =
      excludedTypes.length > 0
        ? {
            // Check incomplete SOs excluding certain types
            serviceOrders: {
              some: {
                AND: [
                  { type: { notIn: excludedTypes } },
                  { status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING_APPROVE'] } },
                ],
              },
            },
          }
        : {
            // Check all incomplete SOs (admin view)
            serviceOrders: {
              some: {
                status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING_APPROVE'] },
              },
            },
          };

    andConditions.push({
      AND: [
        // 1. Not cancelled
        { status: { not: 'CANCELLED' } },
        // 2. Either not completed, OR doesn't meet full completion criteria
        {
          OR: [
            // Not completed (any active status)
            { status: { not: 'COMPLETED' } },
            // OR completed but has no service orders at all
            { serviceOrders: { none: {} } },
            // OR completed but missing at least one required service order type
            {
              NOT: {
                AND: requiredTypesCheck,
              },
            },
            // OR has at least one incomplete service order (role-aware)
            incompleteSOCheck,
          ],
        },
      ],
    });
    delete data.shouldDisplayInPreparation;
    delete data.preparationExcludeFinancial;
    delete data.preparationExcludeLogistic;
  }

  // Design-specific display logic:
  // Tasks should only display for design users until all artwork service orders are completed
  // Also shows tasks that don't have an artwork service order yet
  // Logic: Show task if:
  // 1. Task has no ARTWORK service orders, OR
  // 2. Task has at least one ARTWORK service order that is NOT COMPLETED/CANCELLED
  if (data.shouldDisplayForDesigner === true) {
    andConditions.push({
      AND: [
        // Not cancelled
        { status: { not: 'CANCELLED' } },
        // Either has no artwork service orders OR has incomplete artwork service orders
        {
          OR: [
            // No artwork service orders at all
            { serviceOrders: { none: { type: 'ARTWORK' } } },
            // Has at least one incomplete artwork service order
            {
              serviceOrders: {
                some: {
                  AND: [
                    { type: 'ARTWORK' },
                    { status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING_APPROVE'] } },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
    delete data.shouldDisplayForDesigner;
  }

  if (data.hasAirbrushing === true) {
    andConditions.push({ airbrushing: { some: {} } });
    delete data.hasAirbrushing;
  } else if (data.hasAirbrushing === false) {
    andConditions.push({ airbrushing: { none: {} } });
    delete data.hasAirbrushing;
  }

  if (data.hasNfe === true) {
    andConditions.push({ invoices: { some: {} } });
    delete data.hasNfe;
  } else if (data.hasNfe === false) {
    andConditions.push({ invoices: { none: {} } });
    delete data.hasNfe;
  }

  if (data.hasReceipt === true) {
    andConditions.push({ receipts: { some: {} } });
    delete data.hasReceipt;
  } else if (data.hasReceipt === false) {
    andConditions.push({ receipts: { none: {} } });
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
      AND: [
        { term: { not: null } },
        { term: { lt: new Date() } },
        { status: { notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED] } },
      ],
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
    andConditions.push({ status: TASK_STATUS.WAITING_PRODUCTION });
    delete data.isPending;
  } else if (data.isPending === false) {
    andConditions.push({ status: { not: TASK_STATUS.WAITING_PRODUCTION } });
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
    andConditions.push({ status: TASK_STATUS.PREPARATION });
    delete data.isOnHold;
  } else if (data.isOnHold === false) {
    andConditions.push({ status: { not: TASK_STATUS.PREPARATION } });
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
      createdById: { in: data.assigneeIds },
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

  // Filter by truck spot (garage position)
  if (data.spots && Array.isArray(data.spots) && data.spots.length > 0) {
    andConditions.push({ truck: { spot: { in: data.spots } } });
    delete data.spots;
  }

  // Date range filters
  if (data.entryDateRange && typeof data.entryDateRange === 'object') {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.entryDateRange.from) {
      const fromDate =
        data.entryDateRange.from instanceof Date
          ? data.entryDateRange.from
          : new Date(data.entryDateRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.entryDateRange.to) {
      const toDate =
        data.entryDateRange.to instanceof Date
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

  if (data.termRange && typeof data.termRange === 'object') {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.termRange.from) {
      const fromDate =
        data.termRange.from instanceof Date ? data.termRange.from : new Date(data.termRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.termRange.to) {
      const toDate =
        data.termRange.to instanceof Date ? data.termRange.to : new Date(data.termRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ term: condition });
    }
    delete data.termRange;
  }

  if (data.startedDateRange && typeof data.startedDateRange === 'object') {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.startedDateRange.from) {
      const fromDate =
        data.startedDateRange.from instanceof Date
          ? data.startedDateRange.from
          : new Date(data.startedDateRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.startedDateRange.to) {
      const toDate =
        data.startedDateRange.to instanceof Date
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

  if (data.finishedDateRange && typeof data.finishedDateRange === 'object') {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.finishedDateRange.from) {
      const fromDate =
        data.finishedDateRange.from instanceof Date
          ? data.finishedDateRange.from
          : new Date(data.finishedDateRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.finishedDateRange.to) {
      const toDate =
        data.finishedDateRange.to instanceof Date
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

  if (data.forecastDateRange && typeof data.forecastDateRange === 'object') {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.forecastDateRange.from) {
      const fromDate =
        data.forecastDateRange.from instanceof Date
          ? data.forecastDateRange.from
          : new Date(data.forecastDateRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.forecastDateRange.to) {
      const toDate =
        data.forecastDateRange.to instanceof Date
          ? data.forecastDateRange.to
          : new Date(data.forecastDateRange.to);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ forecastDate: condition });
    }
    delete data.forecastDateRange;
  }

  if (data.createdAtRange && typeof data.createdAtRange === 'object') {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.createdAtRange.from) {
      const fromDate =
        data.createdAtRange.from instanceof Date
          ? data.createdAtRange.from
          : new Date(data.createdAtRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.createdAtRange.to) {
      const toDate =
        data.createdAtRange.to instanceof Date
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

  if (data.updatedAtRange && typeof data.updatedAtRange === 'object') {
    const condition: any = {};
    // Handle both Date objects and ISO strings (from HTTP query params)
    if (data.updatedAtRange.from) {
      const fromDate =
        data.updatedAtRange.from instanceof Date
          ? data.updatedAtRange.from
          : new Date(data.updatedAtRange.from);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.updatedAtRange.to) {
      const toDate =
        data.updatedAtRange.to instanceof Date
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
    hasIncompleteServiceOrders: z.boolean().optional(), // For financial: tasks with ANY incomplete service orders
    hasIncompleteNonFinancialServiceOrders: z.boolean().optional(), // For admin: tasks with incomplete COMMERCIAL/PRODUCTION/ARTWORK service orders
    shouldDisplayInPreparation: z.boolean().optional(), // Preparation display logic: excludes CANCELLED and fully completed tasks
    preparationExcludeFinancial: z.boolean().optional(), // When true, excludes FINANCIAL SO from preparation completion check
    preparationExcludeLogistic: z.boolean().optional(), // When true, excludes LOGISTIC SO from preparation completion check
    shouldDisplayForDesigner: z.boolean().optional(), // Designer display logic: shows tasks with incomplete ARTWORK SOs or no ARTWORK SOs
    hasAirbrushing: z.boolean().optional(),
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
    spots: z.array(z.string()).optional(), // Filter tasks by truck spot/position
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
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    termRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    startedDateRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    finishedDateRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    forecastDateRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    createdAtRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    updatedAtRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['lte'],
        },
      )
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['lte'],
        },
      )
      .optional(),
    where: taskWhereSchema.optional(),
    orderBy: taskOrderBySchema.optional(),
    include: taskIncludeSchema.optional(),
    select: taskSelectSchema.optional(), // NEW: Select support
  })
  .transform(taskTransform);

// =====================
// Nested Schemas for Relations
// =====================

// Observation schema without taskId (will be auto-linked)
const taskObservationCreateSchema = z.object({
  description: z.string().min(1, 'Descrição é obrigatória'),
  // Accept any string for fileIds to support temporary file IDs (e.g., "1760878145245-xdmtocbjn")
  // These will be replaced with actual UUIDs after upload
  fileIds: z.array(z.string().min(1, 'ID do arquivo inválido')).optional(),
});

// ProductionServiceOrder schema without taskId (will be auto-linked)
const taskProductionServiceOrderCreateSchema = z.object({
  id: z.string().uuid().optional(), // For existing service orders (updates)
  status: z
    .enum(Object.values(SERVICE_ORDER_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status inválido' }),
    })
    .default(SERVICE_ORDER_STATUS.PENDING),
  statusOrder: z.number().int().min(1).max(5).default(1).optional(),
  type: z
    .enum(Object.values(SERVICE_ORDER_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo inválido' }),
    })
    .default(SERVICE_ORDER_TYPE.PRODUCTION)
    .optional(),
  description: z
    .string()
    .min(3, { message: 'Mínimo de 3 caracteres' })
    .max(400, { message: 'Máximo de 40 caracteres atingido' }),
  assignedToId: z.string().uuid('ID do colaborador inválido').nullable().optional(),
  observation: z.string().nullable().optional(), // For rejection/approval notes
  startedAt: nullableDate.optional(),
  finishedAt: nullableDate.optional(),
  // Controls bidirectional sync with TaskPricingItem
  // When false, prevents auto-recreation of pricing items from this service order
  shouldSync: z.boolean().optional().default(true),
});

// Layout section schema
const layoutSectionSchema = z.object({
  id: z.string().uuid().optional(), // Existing section ID for updates
  width: z.number().positive(),
  isDoor: z.boolean(),
  doorHeight: z.number().nullable(),
  position: z.number(),
});

// Layout side schema
const layoutSideSchema = z
  .object({
    id: z.string().uuid().optional(), // Existing layout ID for updates
    height: z.number().positive(),
    layoutSections: z.array(layoutSectionSchema),
    photoId: z.string().uuid().nullable().optional(),
  })
  .nullable()
  .optional();

// Truck category schema
const truckCategorySchema = z.nativeEnum(TRUCK_CATEGORY);

// Implement type schema
const implementTypeSchema = z.nativeEnum(IMPLEMENT_TYPE);

// Truck spot schema
const truckSpotSchema = z.nativeEnum(TRUCK_SPOT);

// Consolidated truck schema - ALL truck fields in one place
const taskTruckSchema = z
  .object({
    // Basic truck fields
    plate: z
      .string()
      .nullable()
      .optional()
      .refine(val => !val || /^[A-Z0-9-]+$/.test(val), {
        message: 'Placa deve conter apenas letras maiúsculas, números e hífens',
      }),
    chassisNumber: z
      .string()
      .nullable()
      .optional()
      .refine(
        val => {
          if (!val) return true;
          const cleaned = val.replace(/\s/g, '').toUpperCase();
          return /^[A-Z0-9]{17}$/.test(cleaned);
        },
        {
          message: 'Número do chassi deve ter exatamente 17 caracteres alfanuméricos',
        },
      ),
    spot: z.string().nullable().optional(), // TRUCK_SPOT enum value or null
    // Note: Garage is now static config - garage info is encoded in the spot (B1_F1_V1 = Garage B1, Lane F1, Spot V1)
    // Truck specifications
    category: truckCategorySchema.nullable().optional(),
    implementType: implementTypeSchema.nullable().optional(),
    // Layout data - embedded in truck for single payload
    leftSideLayout: layoutSideSchema,
    rightSideLayout: layoutSideSchema,
    backSideLayout: layoutSideSchema,
  })
  .nullable()
  .optional();

// =====================
// CRUD Schemas
// =====================

// Base task create schema with all relations
export const taskCreateSchema = z
  .object({
    // Basic fields
    name: createNameSchema(3, 200, 'nome da tarefa').nullable().optional(),
    status: z
      .enum(Object.values(TASK_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status inválido' }),
      })
      .default(TASK_STATUS.PREPARATION),
    serialNumber: z
      .string()
      .optional()
      .nullable()
      .transform(val => (val === '' ? null : val))
      .refine(val => !val || /^[A-Z0-9-]+$/.test(val), {
        message: 'Número de série deve conter apenas letras maiúsculas, números e hífens',
      }),
    serialNumberFrom: z
      .number({
        invalid_type_error: 'Número de série inicial deve ser um número',
      })
      .int('Número de série inicial deve ser um número inteiro')
      .positive('Número de série inicial deve ser positivo')
      .optional(),
    serialNumberTo: z
      .number({
        invalid_type_error: 'Número de série final deve ser um número',
      })
      .int('Número de série final deve ser um número inteiro')
      .positive('Número de série final deve ser positivo')
      .optional(),
    details: createDescriptionSchema(1, 1000, false).nullable().optional(),
    entryDate: nullableDate.optional(),
    term: nullableDate.optional(),
    startedAt: nullableDate.optional(),
    finishedAt: nullableDate.optional(),
    forecastDate: nullableDate.optional(),
    paintId: z.string().uuid('Tinta inválida').nullable().optional(),
    customerId: z.string().uuid('Cliente inválido').nullable().optional(),
    invoiceToId: z.string().uuid('Cliente para faturamento inválido').nullable().optional(),
    sectorId: z.string().uuid('Setor inválido').nullable().optional(),
    commission: z
      .enum(Object.values(COMMISSION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'Status de comissão inválido' }),
      })
      .nullable()
      .optional(),

    // Relations - Representatives
    representativeIds: uuidArraySchema('ID de representante inválido'),

    // New representatives to create inline
    newRepresentatives: z
      .array(
        z.object({
          name: z.string().min(1, 'Nome é obrigatório'),
          phone: z.string().min(10, 'Telefone inválido'),
          email: z.string().email('Email inválido').optional().or(z.literal('')),
          role: z.enum(['COMMERCIAL', 'TECHNICAL', 'FINANCIAL', 'ADMINISTRATIVE']),
          isActive: z.boolean().default(true),
          customerId: z.string().uuid('ID do cliente inválido').optional(),
        }),
      )
      .optional(),

    // Relations - File arrays (can be UUIDs of existing files or will be populated from uploaded files)
    // Using uuidArraySchema to filter empty strings from FormData before validation
    budgetIds: uuidArraySchema('Orçamento inválido'),
    invoiceIds: uuidArraySchema('NFe inválida'),
    receiptIds: uuidArraySchema('Recibo inválido'),
    reimbursementIds: uuidArraySchema('Reimbursement inválido'),
    reimbursementInvoiceIds: uuidArraySchema('NFe de reimbursement inválida'),
    artworkIds: uuidArraySchema('Arquivo inválido'),
    // Artwork statuses map - maps File ID to artwork status (for approval workflow)
    artworkStatuses: z
      .record(
        z.string().uuid(),
        z.enum(['DRAFT', 'APPROVED', 'REPROVED'], {
          errorMap: () => ({ message: 'Status de artwork inválido' }),
        }),
      )
      .optional(),
    baseFileIds: uuidArraySchema('Arquivo base inválido'),
    paintIds: uuidArraySchema('Tinta inválida'),
    pricingId: z.string().uuid('ID de precificação inválido').nullable().optional(), // ONE-TO-MANY: one task has one pricing, but pricing can be shared across tasks
    pricing: taskPricingCreateNestedSchema.optional().nullable(), // Nested pricing creation (one-to-many: one pricing can be shared across multiple tasks)
    observation: taskObservationCreateSchema.nullable().optional(),
    serviceOrders: z.array(taskProductionServiceOrderCreateSchema).optional(),
    truck: taskTruckSchema, // Consolidated truck with plate, chassis, spot, and layouts
    cut: cutCreateNestedSchema.nullable().optional(),
    cuts: z.array(cutCreateNestedSchema).optional(), // Support for multiple cuts
    airbrushings: z.array(airbrushingCreateNestedSchema).optional(), // Support for multiple airbrushings
  })
  // Auto-fill dates based on status changes (before validation)
  .transform(data => {
    // Auto-fill startedAt when status is IN_PRODUCTION
    if (data.status === TASK_STATUS.IN_PRODUCTION && !data.startedAt) {
      // If entryDate exists and is in the future, use entryDate, otherwise use current date
      const now = new Date();
      data.startedAt = data.entryDate && data.entryDate > now ? data.entryDate : now;
    }
    // Auto-fill finishedAt when status is COMPLETED
    if (data.status === TASK_STATUS.COMPLETED && !data.finishedAt) {
      const now = new Date();
      data.finishedAt = now;
      // Also auto-fill startedAt if not set (completing without starting)
      if (!data.startedAt) {
        // Use entryDate if it exists and is <= now, otherwise use now
        data.startedAt = data.entryDate && data.entryDate <= now ? data.entryDate : now;
      }
    }

    // DATE CASCADING SYNC: forecastDate → entryDate → startedAt
    // When a higher priority date is set, auto-fill lower priority dates if not set
    if (data.startedAt) {
      // startedAt set → auto-fill entryDate and forecastDate
      if (!data.entryDate) {
        data.entryDate = data.startedAt;
      }
      if (!data.forecastDate) {
        data.forecastDate = data.startedAt;
      }
    } else if (data.entryDate) {
      // entryDate set (without startedAt) → auto-fill forecastDate
      if (!data.forecastDate) {
        data.forecastDate = data.entryDate;
      }
    }

    return data;
  })
  .superRefine((data, ctx) => {
    // Require at least one of: customer, serialNumber, serialNumberFrom/To, plate, or name
    const hasCustomer = !!data.customerId;
    const hasSerialNumber = !!data.serialNumber;
    const hasSerialNumberRange =
      (data.serialNumberFrom !== undefined && data.serialNumberFrom !== null) ||
      (data.serialNumberTo !== undefined && data.serialNumberTo !== null);
    const hasPlate = !!data.truck?.plate;
    const hasName = !!data.name;

    if (!hasCustomer && !hasSerialNumber && !hasSerialNumberRange && !hasPlate && !hasName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Pelo menos um dos seguintes campos deve ser preenchido: Cliente, Número de série, Placa ou Nome',
        path: ['name'],
      });
    }

    if (data.entryDate && data.term && data.term <= data.entryDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data de término deve ser posterior à data de entrada',
        path: ['term'],
      });
    }

    if (data.entryDate && data.startedAt) {
      const startDate = new Date(
        data.startedAt.getFullYear(),
        data.startedAt.getMonth(),
        data.startedAt.getDate(),
      );
      const entryDateOnly = new Date(
        data.entryDate.getFullYear(),
        data.entryDate.getMonth(),
        data.entryDate.getDate(),
      );
      if (startDate < entryDateOnly) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Data de início deve ser posterior ou igual à data de entrada',
          path: ['startedAt'],
        });
      }
    }

    if (data.startedAt && data.finishedAt && data.finishedAt < data.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data de finalização deve ser posterior ou igual à data de início',
        path: ['finishedAt'],
      });
    }

    // Note: startedAt and finishedAt are now auto-filled by the transform above,
    // so we no longer validate their presence based on status.

    // Validate serial number range fields
    const hasSerialNumberFrom = data.serialNumberFrom !== undefined;
    const hasSerialNumberTo = data.serialNumberTo !== undefined;

    // Both must be provided together or both omitted
    if (hasSerialNumberFrom && !hasSerialNumberTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ambos os campos de intervalo devem ser preenchidos',
        path: ['serialNumberTo'],
      });
    }

    if (!hasSerialNumberFrom && hasSerialNumberTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ambos os campos de intervalo devem ser preenchidos',
        path: ['serialNumberFrom'],
      });
    }

    // Both fields are provided - perform additional validations
    if (hasSerialNumberFrom && hasSerialNumberTo) {
      // serialNumberTo must be >= serialNumberFrom
      if (data.serialNumberTo! < data.serialNumberFrom!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'O número final deve ser maior ou igual ao inicial',
          path: ['serialNumberTo'],
        });
      }

      // Validate range does not exceed 100 tasks
      const taskCount = data.serialNumberTo! - data.serialNumberFrom! + 1;
      if (taskCount > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `O intervalo não pode exceder 100 tarefas (tentando criar ${taskCount} tarefas)`,
          path: ['serialNumberTo'],
        });
      }
    }
  });

// Base task update schema with all relations
export const taskUpdateSchema = z
  .object({
    // Basic fields
    name: createNameSchema(3, 200, 'nome da tarefa').nullable().optional(),
    status: z
      .enum(Object.values(TASK_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status inválido' }),
      })
      .optional(),
    serialNumber: z
      .string()
      .optional()
      .nullable()
      .transform(val => (val === '' ? null : val))
      .refine(val => !val || /^[A-Z0-9-]+$/.test(val), {
        message: 'Número de série deve conter apenas letras maiúsculas, números e hífens',
      }),
    details: createDescriptionSchema(1, 1000, false).nullable().optional(),
    entryDate: nullableDate.optional(),
    term: nullableDate.optional(),
    startedAt: nullableDate.optional(),
    finishedAt: nullableDate.optional(),
    forecastDate: nullableDate.optional(),
    paintId: z.string().uuid('Tinta inválida').nullable().optional(),
    customerId: z.string().uuid('Cliente inválido').nullable().optional(),
    invoiceToId: z.string().uuid('Cliente para faturamento inválido').nullable().optional(),
    sectorId: z.string().uuid('Setor inválido').nullable().optional(),
    commission: z
      .enum(Object.values(COMMISSION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'Status de comissão inválido' }),
      })
      .nullable()
      .optional(),
    // Relations - Representatives
    representativeIds: uuidArraySchema('ID de representante inválido'),

    // New representatives to create inline
    newRepresentatives: z
      .array(
        z.object({
          name: z.string().min(1, 'Nome é obrigatório'),
          phone: z.string().min(10, 'Telefone inválido'),
          email: z.string().email('Email inválido').optional().or(z.literal('')),
          role: z.enum(['COMMERCIAL', 'TECHNICAL', 'FINANCIAL', 'ADMINISTRATIVE']),
          isActive: z.boolean().default(true),
          customerId: z.string().uuid('ID do cliente inválido').optional(),
        }),
      )
      .optional(),

    // Relations - File arrays
    // Using uuidArraySchema to filter empty strings from FormData before validation
    budgetIds: uuidArraySchema('Orçamento inválido'),
    invoiceIds: uuidArraySchema('NFe inválida'),
    receiptIds: uuidArraySchema('Recibo inválido'),
    reimbursementIds: uuidArraySchema('Reimbursement inválido'),
    reimbursementInvoiceIds: uuidArraySchema('NFe de reimbursement inválida'),
    artworkIds: uuidArraySchema('Arquivo inválido'),
    // Artwork statuses map - maps File ID to artwork status (for approval workflow on existing files)
    // PREPROCESS: Handle malformed FormData where artworkStatuses comes as array-like object with stringified JSON
    artworkStatuses: z
      .preprocess(
        val => {
          // If it's already a proper record, return as-is
          if (!val || typeof val !== 'object') return val;

          // Check if it looks like array-like object: { "0": "...", "1": "..." }
          const keys = Object.keys(val);
          const isArrayLike = keys.length > 0 && keys.every(k => !isNaN(Number(k)));

          if (isArrayLike) {
            // Merge all parsed values into single record
            const merged: any = {};
            for (const value of Object.values(val)) {
              if (typeof value === 'string') {
                try {
                  const parsed = JSON.parse(value);
                  if (typeof parsed === 'object') Object.assign(merged, parsed);
                } catch (e) {
                  // Skip invalid JSON
                }
              } else if (typeof value === 'object') {
                Object.assign(merged, value);
              }
            }
            return Object.keys(merged).length > 0 ? merged : val;
          }

          return val;
        },
        z.record(
          z.string().uuid(),
          z.enum(['DRAFT', 'APPROVED', 'REPROVED'], {
            errorMap: () => ({ message: 'Status de artwork inválido' }),
          }),
        ),
      )
      .optional(),
    // New artwork statuses array - array of statuses for new files being uploaded (matches files array order)
    newArtworkStatuses: z
      .array(
        z.enum(['DRAFT', 'APPROVED', 'REPROVED'], {
          errorMap: () => ({ message: 'Status de artwork inválido' }),
        }),
      )
      .optional(),
    baseFileIds: uuidArraySchema('Arquivo base inválido'),
    paintIds: uuidArraySchema('Tinta inválida'),
    pricingId: z.string().uuid('ID de precificação inválido').nullable().optional(), // ONE-TO-MANY: one task has one pricing, but pricing can be shared across tasks
    pricing: taskPricingCreateNestedSchema.optional().nullable(), // Nested pricing creation (one-to-many: one pricing can be shared across multiple tasks)
    observation: taskObservationCreateSchema.nullable().optional(),
    serviceOrders: z.array(taskProductionServiceOrderCreateSchema).optional(),
    truck: taskTruckSchema, // Consolidated truck with plate, chassis, spot, and layouts
    cut: cutCreateNestedSchema.nullable().optional(),
    cuts: z.array(cutCreateNestedSchema).optional(), // Support for multiple cuts
    airbrushings: z.array(airbrushingCreateNestedSchema).optional(), // Support for multiple airbrushings

    // Removal operation fields (for batch updates)
    removeGeneralPainting: z.boolean().optional(),
    removeLogoPaints: z.array(z.string().uuid()).optional(),
    removeCutIds: z.array(z.string().uuid()).optional(),
    removeBudgetIds: z.array(z.string().uuid()).optional(),
    removeInvoiceIds: z.array(z.string().uuid()).optional(),
    removeReceiptIds: z.array(z.string().uuid()).optional(),
    removeAirbrushingIds: z.array(z.string().uuid()).optional(),
    removeArtworkIds: z.array(z.string().uuid()).optional(),
    removeReimbursementIds: z.array(z.string().uuid()).optional(),
    removeReimbursementInvoiceIds: z.array(z.string().uuid()).optional(),
  })
  // Auto-fill dates based on status changes (before validation)
  // This ensures that when frontend sends status change without dates, backend auto-fills them
  // Note: Date cascading sync (forecastDate → entryDate → startedAt) is handled in the backend
  // task.service.ts where we have access to existing task values for partial updates
  .transform(data => {
    // Auto-fill startedAt when status changes to IN_PRODUCTION
    if (data.status === TASK_STATUS.IN_PRODUCTION && !data.startedAt) {
      // If entryDate exists and is in the future, use entryDate, otherwise use current date
      const now = new Date();
      data.startedAt = data.entryDate && data.entryDate > now ? data.entryDate : now;
    }
    // Auto-fill finishedAt when status changes to COMPLETED
    if (data.status === TASK_STATUS.COMPLETED && !data.finishedAt) {
      const now = new Date();
      data.finishedAt = now;
      // Also auto-fill startedAt if not set (completing without starting)
      if (!data.startedAt) {
        // Use entryDate if it exists and is <= now, otherwise use now
        data.startedAt = data.entryDate && data.entryDate <= now ? data.entryDate : now;
      }
    }
    return data;
  })
  .superRefine((data, ctx) => {
    if (data.entryDate && data.term && data.term <= data.entryDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data de término deve ser posterior à data de entrada',
        path: ['term'],
      });
    }

    if (data.entryDate && data.startedAt) {
      const startDate = new Date(
        data.startedAt.getFullYear(),
        data.startedAt.getMonth(),
        data.startedAt.getDate(),
      );
      const entryDateOnly = new Date(
        data.entryDate.getFullYear(),
        data.entryDate.getMonth(),
        data.entryDate.getDate(),
      );
      if (startDate < entryDateOnly) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Data de início deve ser posterior ou igual à data de entrada',
          path: ['startedAt'],
        });
      }
    }

    if (data.startedAt && data.finishedAt && data.finishedAt < data.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data de finalização deve ser posterior ou igual à data de início',
        path: ['finishedAt'],
      });
    }

    // Note: startedAt and finishedAt validation removed here because they are now auto-filled
    // by the transform above. The backend service layer will handle setting these dates
    // when status changes, so we don't need to enforce them at the schema level for updates.
  });

// =====================
// Batch Operations Schemas
// =====================

export const taskBatchCreateSchema = z.object({
  tasks: z.array(taskCreateSchema).min(1, 'Pelo menos uma tarefa deve ser fornecida'),
});

export const taskBatchUpdateSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().uuid('Tarefa inválida'),
        data: taskUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma tarefa deve ser fornecida'),
});

export const taskBatchDeleteSchema = z.object({
  taskIds: z
    .array(z.string().uuid('Tarefa inválida'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const taskQuerySchema = z.object({
  include: taskIncludeSchema.optional(),
  select: taskSelectSchema.optional(), // NEW: Select support
});

// =====================
// Duplicate Schema
// =====================

export const taskDuplicateSchema = z.object({
  taskId: z.string().uuid('Tarefa inválida'),
  modifications: taskUpdateSchema.optional(),
});

// =====================
// GetById Schema
// =====================

export const taskGetByIdSchema = z.object({
  include: taskIncludeSchema.optional(),
  select: taskSelectSchema.optional(), // NEW: Select support
  id: z.string().uuid('Tarefa inválida'),
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
export type TaskSelect = z.infer<typeof taskSelectSchema>;
export type TaskOrderBy = z.infer<typeof taskOrderBySchema>;
export type TaskWhere = z.infer<typeof taskWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapTaskToFormData = createMapToFormDataHelper<Task, TaskUpdateFormData>(task => ({
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
  budgetIds: task.budgets?.map(budget => budget.id),
  invoiceIds: task.invoices?.map(invoice => invoice.id),
  receiptIds: task.receipts?.map(receipt => receipt.id),
  reimbursementIds: task.reimbursements?.map(reimbursement => reimbursement.id),
  reimbursementInvoiceIds: task.invoiceReimbursements?.map(
    reimbursementInvoice => reimbursementInvoice.id,
  ),
  // CRITICAL: artworkIds should be File IDs (artwork.fileId), not Artwork entity IDs
  artworkIds: task.artworks?.map(artwork => artwork.fileId || (artwork as any).file?.id),
  // Map artwork statuses (File ID → status)
  artworkStatuses: task.artworks?.reduce(
    (acc, artwork) => {
      const fileId = artwork.fileId || (artwork as any).file?.id;
      if (fileId && artwork.status) {
        acc[fileId] = artwork.status as 'DRAFT' | 'APPROVED' | 'REPROVED';
      }
      return acc;
    },
    {} as Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>,
  ),
  baseFileIds: task.baseFiles?.map(baseFile => baseFile.id),
  paintIds: task.logoPaints?.map(paint => paint.id),
  generalPaintingId: task.generalPainting?.id,
  // Service orders mapping
  serviceOrders: task.serviceOrders,
  // Complex relations need to be handled separately
}));

// =====================
// Task Positioning Schemas
// =====================

// Schema for updating a single truck spot
export const taskPositionUpdateSchema = z.object({
  spot: truckSpotSchema.nullable().optional(),
});

export type TaskPositionUpdateFormData = z.infer<typeof taskPositionUpdateSchema>;

// Schema for bulk updating truck spots
export const taskBulkPositionUpdateSchema = z.object({
  updates: z.array(
    z.object({
      taskId: z.string().uuid(),
      spot: truckSpotSchema.nullable().optional(),
    }),
  ),
});

export type TaskBulkPositionUpdateFormData = z.infer<typeof taskBulkPositionUpdateSchema>;

// Schema for swapping two trucks
export const taskSwapPositionSchema = z.object({
  targetTaskId: z.string().uuid(),
});

export type TaskSwapPositionFormData = z.infer<typeof taskSwapPositionSchema>;
