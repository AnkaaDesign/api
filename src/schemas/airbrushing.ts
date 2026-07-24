// packages/schemas/src/airbrushing.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  orderByWithNullsSchema,
  normalizeOrderBy,
  nullableDate,
  toFormData,
  normalizeSearchTerm,
} from './common';
import type { Airbrushing } from '@types';
import { AIRBRUSHING_STATUS, AIRBRUSHING_PAYMENT_STATUS } from '@constants';

// =====================
// Include Schema Based on Prisma Schema
// =====================

export const airbrushingIncludeSchema = z
  .object({
    task: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              customer: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        logo: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              budgets: z.boolean().optional(),
              invoices: z.boolean().optional(),
              receipts: z.boolean().optional(),
              reimbursements: z.boolean().optional(),
              invoiceReimbursements: z.boolean().optional(),
              observation: z.boolean().optional(),
              generalPainting: z.boolean().optional(),
              createdBy: z.boolean().optional(),
              files: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              bonifications: z.boolean().optional(),
              serviceOrders: z.boolean().optional(),
              // `truck` is a KNOWN key, so a nested include here is an invalid_type error (a 400 on
              // the whole list), not a silent strip. The airbrushing table's "Medidas" column needs
              // truck.leftSideMeasure/rightSideMeasure + their sections, so accept the nested form.
              truck: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        leftSideMeasure: z
                          .union([z.boolean(), z.object({ include: z.object({ sections: z.boolean().optional() }).optional() })])
                          .optional(),
                        rightSideMeasure: z
                          .union([z.boolean(), z.object({ include: z.object({ sections: z.boolean().optional() }).optional() })])
                          .optional(),
                        backSideMeasure: z
                          .union([z.boolean(), z.object({ include: z.object({ sections: z.boolean().optional() }).optional() })])
                          .optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              airbrushing: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    painter: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              position: z.boolean().optional(),
              avatar: z.boolean().optional(),
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
              tasksLayouts: z.boolean().optional(),
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
              externalOperationBudget: z.boolean().optional(),
              externalOperationNfe: z.boolean().optional(),
              externalOperationReceipt: z.boolean().optional(),
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
              tasksLayouts: z.boolean().optional(),
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
              externalOperationBudget: z.boolean().optional(),
              externalOperationNfe: z.boolean().optional(),
              externalOperationReceipt: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    layouts: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              tasksLayouts: z.boolean().optional(),
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
              airbrushingLayouts: z.boolean().optional(),
              externalOperationBudget: z.boolean().optional(),
              externalOperationNfe: z.boolean().optional(),
              externalOperationReceipt: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================

export const airbrushingOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        id: orderByDirectionSchema.optional(),
        startDate: orderByDirectionSchema.optional(),
        finishDate: orderByDirectionSchema.optional(),
        startedAt: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
        price: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        paymentStatus: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        painterId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        task: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            // "Identificador" sorts on the serial with NULLS LAST in both directions — the
            // plate-fallback rows would otherwise jump to the top on DESC (Postgres default).
            serialNumber: orderByWithNullsSchema.optional(),
            status: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
            customer: z
              .object({
                id: orderByDirectionSchema.optional(),
                fantasyName: orderByDirectionSchema.optional(),
                corporateName: orderByDirectionSchema.optional(),
              })
              .partial()
              .optional(),
          })
          .partial()
          .optional(),
        painter: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
          })
          .partial()
          .optional(),
      })
      .partial(),

    // Array of ordering objects
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          startDate: orderByDirectionSchema.optional(),
          finishDate: orderByDirectionSchema.optional(),
          startedAt: orderByDirectionSchema.optional(),
          finishedAt: orderByDirectionSchema.optional(),
          price: orderByDirectionSchema.optional(),
          description: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          paymentStatus: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          painterId: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
          task: z
            .object({
              id: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
              serialNumber: orderByWithNullsSchema.optional(),
              status: orderByDirectionSchema.optional(),
              createdAt: orderByDirectionSchema.optional(),
              updatedAt: orderByDirectionSchema.optional(),
              customer: z
                .object({
                  id: orderByDirectionSchema.optional(),
                  fantasyName: orderByDirectionSchema.optional(),
                  corporateName: orderByDirectionSchema.optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          painter: z
            .object({
              id: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
            })
            .partial()
            .optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const airbrushingWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([airbrushingWhereSchema, z.array(airbrushingWhereSchema)]).optional(),
      OR: z.array(airbrushingWhereSchema).optional(),
      NOT: z.union([airbrushingWhereSchema, z.array(airbrushingWhereSchema)]).optional(),

      // UUID fields
      id: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      taskId: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      painterId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      // Date fields
      startDate: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      finishDate: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      startedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.coerce.date().nullable().optional(),
            not: z.coerce.date().nullable().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      finishedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.coerce.date().nullable().optional(),
            not: z.coerce.date().nullable().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Numeric fields
      price: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
          }),
        ])
        .optional(),

      statusOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
          }),
        ])
        .optional(),

      // String fields
      description: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
          }),
        ])
        .optional(),
      status: z
        .union([
          z.nativeEnum(AIRBRUSHING_STATUS),
          z.object({
            equals: z.nativeEnum(AIRBRUSHING_STATUS).optional(),
            not: z.nativeEnum(AIRBRUSHING_STATUS).optional(),
            in: z.array(z.nativeEnum(AIRBRUSHING_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(AIRBRUSHING_STATUS)).optional(),
          }),
        ])
        .optional(),

      paymentStatus: z
        .union([
          z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS),
          z.object({
            equals: z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS).optional(),
            not: z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS).optional(),
            in: z.array(z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS)).optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      task: z.lazy(() => z.any()).optional(),
      painter: z.lazy(() => z.any()).optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const airbrushingFilters = {
  searchingFor: z.string().optional(),
  status: z.array(z.nativeEnum(AIRBRUSHING_STATUS)).optional(),
  paymentStatuses: z.array(z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS)).optional(),
  taskIds: z.array(z.string()).optional(),
  painterIds: z.array(z.string()).optional(),
  customerIds: z.array(z.string()).optional(),
  priceRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  hasStartDate: z.boolean().optional(),
  hasFinishDate: z.boolean().optional(),
  // "Período de Início" / "Período de Término" — de/até ranges over the PLANNED dates.
  // Named *Range so they never collide with the `startDate`/`finishDate` where-clause fields.
  startDateRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
  finishDateRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
};

// =====================
// Transform Function
// =====================

const airbrushingTransform = (data: any): any => {
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

  // Transform convenience filters to where conditions
  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { task: { nameNormalized: { contains: normalizeSearchTerm(data.searchingFor) } } },
        { task: { customer: { fantasyNameNormalized: { contains: normalizeSearchTerm(data.searchingFor) } } } },
        // The airbrushing's own description.
        { descriptionNormalized: { contains: normalizeSearchTerm(data.searchingFor) } },
        // "Identificador" — the task serial, falling back to the truck plate (both are what the
        // Identificador column renders, so searching either must find the row).
        { task: { serialNumberNormalized: { contains: normalizeSearchTerm(data.searchingFor) } } },
        { task: { truck: { plateNormalized: { contains: normalizeSearchTerm(data.searchingFor) } } } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.status?.length) {
    andConditions.push({ status: { in: data.status } });
    delete data.status;
  }

  if (data.paymentStatuses?.length) {
    andConditions.push({ paymentStatus: { in: data.paymentStatuses } });
    delete data.paymentStatuses;
  }

  if (data.taskIds?.length) {
    andConditions.push({ taskId: { in: data.taskIds } });
    delete data.taskIds;
  }

  if (data.painterIds?.length) {
    andConditions.push({ painterId: { in: data.painterIds } });
    delete data.painterIds;
  }

  // "Cliente" filter — the customer hangs off the task, so filter through the relation.
  // Shorthand (no `is:`) matches the style used by the searchingFor block below.
  if (data.customerIds?.length) {
    andConditions.push({ task: { customerId: { in: data.customerIds } } });
    delete data.customerIds;
  }

  if (data.priceRange) {
    const priceCondition: any = {};
    if (data.priceRange.min !== undefined) priceCondition.gte = data.priceRange.min;
    if (data.priceRange.max !== undefined) priceCondition.lte = data.priceRange.max;
    if (Object.keys(priceCondition).length > 0) {
      andConditions.push({ price: priceCondition });
    }
    delete data.priceRange;
  }

  if (data.hasStartDate !== undefined) {
    if (data.hasStartDate) {
      andConditions.push({ startDate: { not: null } });
    } else {
      andConditions.push({ startDate: null });
    }
    delete data.hasStartDate;
  }

  if (data.hasFinishDate !== undefined) {
    if (data.hasFinishDate) {
      andConditions.push({ finishDate: { not: null } });
    } else {
      andConditions.push({ finishDate: null });
    }
    delete data.hasFinishDate;
  }

  if (data.startDateRange) {
    const startDateCondition: any = {};
    if (data.startDateRange.gte) startDateCondition.gte = data.startDateRange.gte;
    if (data.startDateRange.lte) startDateCondition.lte = data.startDateRange.lte;
    if (Object.keys(startDateCondition).length > 0) {
      andConditions.push({ startDate: startDateCondition });
    }
    delete data.startDateRange;
  }

  if (data.finishDateRange) {
    const finishDateCondition: any = {};
    if (data.finishDateRange.gte) finishDateCondition.gte = data.finishDateRange.gte;
    if (data.finishDateRange.lte) finishDateCondition.lte = data.finishDateRange.lte;
    if (Object.keys(finishDateCondition).length > 0) {
      andConditions.push({ finishDate: finishDateCondition });
    }
    delete data.finishDateRange;
  }

  if (data.createdAt) {
    const createdAtCondition: any = {};
    if (data.createdAt.gte) createdAtCondition.gte = data.createdAt.gte;
    if (data.createdAt.lte) createdAtCondition.lte = data.createdAt.lte;
    if (Object.keys(createdAtCondition).length > 0) {
      andConditions.push({ createdAt: createdAtCondition });
    }
    delete data.createdAt;
  }

  if (data.updatedAt) {
    const updatedAtCondition: any = {};
    if (data.updatedAt.gte) updatedAtCondition.gte = data.updatedAt.gte;
    if (data.updatedAt.lte) updatedAtCondition.lte = data.updatedAt.lte;
    if (Object.keys(updatedAtCondition).length > 0) {
      andConditions.push({ updatedAt: updatedAtCondition });
    }
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    if (data.where) {
      data.where = data.where.AND
        ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schema
// =====================

export const airbrushingGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: airbrushingWhereSchema.optional(),
    orderBy: airbrushingOrderBySchema.optional(),
    include: airbrushingIncludeSchema.optional(),

    // Convenience filters
    ...airbrushingFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(airbrushingTransform);

// =====================
// CRUD Schemas
// =====================

export const airbrushingCreateSchema = z.preprocess(
  toFormData,
  z.object({
    startDate: nullableDate.optional(),
    finishDate: nullableDate.optional(),
    // MUST stay .nullable(): the web FormData helper encodes JS null as the literal string "null",
    // which ArrayFixPipe turns back into null — clearing the field would otherwise 400.
    description: z.string().trim().max(500, 'Descrição deve ter no máximo 500 caracteres').nullable().optional(),
    price: z
      .number({
        invalid_type_error: 'Preço inválido',
      })
      .min(0, 'Preço deve ser maior ou igual a zero')
      .nullable()
      .optional(),
    startedAt: nullableDate.optional(),
    finishedAt: nullableDate.optional(),
    status: z.nativeEnum(AIRBRUSHING_STATUS).default(AIRBRUSHING_STATUS.PREPARATION),
    paymentStatus: z
      .nativeEnum(AIRBRUSHING_PAYMENT_STATUS)
      .default(AIRBRUSHING_PAYMENT_STATUS.PENDING),
    taskId: z.string().uuid('Tarefa inválida'),
    painterId: z.string().uuid('Pintor inválido').nullable().optional(),
    invoiceIds: z.array(z.string().uuid()).optional(),
    receiptIds: z.array(z.string().uuid()).optional(),
    layoutIds: z.array(z.string().uuid()).optional(),
    // Layout statuses map - maps File ID to layout status (for approval workflow)
    // PREPROCESS: Handle malformed FormData where layoutStatuses comes as array-like object with stringified JSON
    layoutStatuses: z
      .preprocess(
        val => {
          if (!val || typeof val !== 'object') return val;
          const keys = Object.keys(val);
          const isArrayLike = keys.length > 0 && keys.every(k => !isNaN(Number(k)));
          if (isArrayLike) {
            const merged: any = {};
            for (const value of Object.values(val)) {
              if (typeof value === 'string') {
                try {
                  const parsed = JSON.parse(value);
                  if (typeof parsed === 'object') Object.assign(merged, parsed);
                } catch (e) {
                  /* Skip invalid JSON */
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
            errorMap: () => ({ message: 'Status de layout inválido' }),
          }),
        ),
      )
      .optional(),
  }),
);

export const airbrushingUpdateSchema = z.preprocess(
  toFormData,
  z.object({
    startDate: nullableDate.optional(),
    finishDate: nullableDate.optional(),
    description: z.string().trim().max(500, 'Descrição deve ter no máximo 500 caracteres').nullable().optional(),
    price: z
      .number({
        invalid_type_error: 'Preço inválido',
      })
      .min(0, 'Preço deve ser maior ou igual a zero')
      .nullable()
      .optional(),
    startedAt: nullableDate.optional(),
    finishedAt: nullableDate.optional(),
    status: z.nativeEnum(AIRBRUSHING_STATUS).optional(),
    paymentStatus: z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS).optional(),
    taskId: z.string().uuid('Tarefa inválida').optional(),
    painterId: z.string().uuid('Pintor inválido').nullable().optional(),
    invoiceIds: z.array(z.string().uuid()).optional(),
    receiptIds: z.array(z.string().uuid()).optional(),
    layoutIds: z.array(z.string().uuid()).optional(),
    // Layout statuses map - maps File ID to layout status (for approval workflow)
    // PREPROCESS: Handle malformed FormData where layoutStatuses comes as array-like object with stringified JSON
    layoutStatuses: z
      .preprocess(
        val => {
          if (!val || typeof val !== 'object') return val;
          const keys = Object.keys(val);
          const isArrayLike = keys.length > 0 && keys.every(k => !isNaN(Number(k)));
          if (isArrayLike) {
            const merged: any = {};
            for (const value of Object.values(val)) {
              if (typeof value === 'string') {
                try {
                  const parsed = JSON.parse(value);
                  if (typeof parsed === 'object') Object.assign(merged, parsed);
                } catch (e) {
                  /* Skip invalid JSON */
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
            errorMap: () => ({ message: 'Status de layout inválido' }),
          }),
        ),
      )
      .optional(),
  }),
);

// =====================
// Batch Operations Schemas
// =====================

export const airbrushingBatchCreateSchema = z.object({
  airbrushings: z.array(airbrushingCreateSchema),
});

export const airbrushingBatchUpdateSchema = z.object({
  airbrushings: z
    .array(
      z.object({
        id: z.string().uuid('Airbrushing inválido'),
        data: airbrushingUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma atualização é necessária'),
});

export const airbrushingBatchDeleteSchema = z.object({
  airbrushingIds: z
    .array(z.string().uuid('Airbrushing inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const airbrushingQuerySchema = z.object({
  include: airbrushingIncludeSchema.optional(),
});

// =====================
// GetById Schema
// =====================

export const airbrushingGetByIdSchema = z.object({
  include: airbrushingIncludeSchema.optional(),
  id: z.string().uuid('Airbrushing inválido'),
});

// =====================
// Inferred Types
// =====================

export type AirbrushingGetManyFormData = z.infer<typeof airbrushingGetManySchema>;
export type AirbrushingGetByIdFormData = z.infer<typeof airbrushingGetByIdSchema>;
export type AirbrushingQueryFormData = z.infer<typeof airbrushingQuerySchema>;

export type AirbrushingCreateFormData = z.infer<typeof airbrushingCreateSchema>;
export type AirbrushingUpdateFormData = z.infer<typeof airbrushingUpdateSchema>;

export type AirbrushingBatchCreateFormData = z.infer<typeof airbrushingBatchCreateSchema>;
export type AirbrushingBatchUpdateFormData = z.infer<typeof airbrushingBatchUpdateSchema>;
export type AirbrushingBatchDeleteFormData = z.infer<typeof airbrushingBatchDeleteSchema>;

export type AirbrushingInclude = z.infer<typeof airbrushingIncludeSchema>;
export type AirbrushingOrderBy = z.infer<typeof airbrushingOrderBySchema>;
export type AirbrushingWhere = z.infer<typeof airbrushingWhereSchema>;

// =====================
// Nested Creation Schema for Task Forms
// =====================

export const airbrushingCreateNestedSchema = z
  .object({
    // Existing airbrushing UUID or temporary client id ("airbrushing-*").
    // The task update flow branches on this to update-in-place instead of
    // recreating (which would cascade-delete layouts).
    id: z.string().optional(),
    startDate: nullableDate.optional(),
    finishDate: nullableDate.optional(),
    description: z.string().trim().max(500, 'Descrição deve ter no máximo 500 caracteres').nullable().optional(),
    price: z
      .number({
        invalid_type_error: 'Preço inválido',
      })
      .min(0, 'Preço deve ser maior ou igual a zero')
      .nullable()
      .optional(),
    startedAt: nullableDate.optional(),
    finishedAt: nullableDate.optional(),
    status: z.nativeEnum(AIRBRUSHING_STATUS).default(AIRBRUSHING_STATUS.PREPARATION),
    paymentStatus: z.nativeEnum(AIRBRUSHING_PAYMENT_STATUS).optional(),
    painterId: z.string().uuid('Pintor inválido').nullable().optional(),
    invoiceIds: z.array(z.string().uuid()).optional(),
    receiptIds: z.array(z.string().uuid()).optional(),
    layoutIds: z.array(z.string().uuid()).optional(),
  })
  .transform(toFormData);

export type AirbrushingCreateNestedFormData = z.infer<typeof airbrushingCreateNestedSchema>;

// =====================
// Helper Functions
// =====================

export const mapAirbrushingToFormData = createMapToFormDataHelper<
  Airbrushing,
  AirbrushingUpdateFormData
>(airbrushing => ({
  startDate: airbrushing.startDate,
  finishDate: airbrushing.finishDate,
  startedAt: airbrushing.startedAt,
  finishedAt: airbrushing.finishedAt,
  price: airbrushing.price,
  description: airbrushing.description,
  status: airbrushing.status,
  paymentStatus: airbrushing.paymentStatus,
  taskId: airbrushing.taskId,
  painterId: airbrushing.painterId,
  invoiceIds: airbrushing.invoices?.map(file => file.id),
  receiptIds: airbrushing.receipts?.map(file => file.id),
  layoutIds: airbrushing.layouts?.map(layout => layout.id),
}));
