// packages/schemas/src/airbrushing.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, nullableDate, toFormData } from "./common";
import type { Airbrushing } from '@types';
import { AIRBRUSHING_STATUS } from '@constants';

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
              customer: z.boolean().optional(),
              budgets: z.boolean().optional(),
              nfes: z.boolean().optional(),
              receipts: z.boolean().optional(),
              reimbursements: z.boolean().optional(),
              nfeReimbursements: z.boolean().optional(),
              observation: z.boolean().optional(),
              generalPainting: z.boolean().optional(),
              createdBy: z.boolean().optional(),
              files: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              commissions: z.boolean().optional(),
              services: z.boolean().optional(),
              truck: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
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
              supplierLogo: z.boolean().optional(),
              orderNfe: z.boolean().optional(),
              orderBudget: z.boolean().optional(),
              orderReceipt: z.boolean().optional(),
              observations: z.boolean().optional(),
              airbrushingReceipts: z.boolean().optional(),
              airbrushingNfes: z.boolean().optional(),
              vacation: z.boolean().optional(),
              externalWithdrawalBudget: z.boolean().optional(),
              externalWithdrawalNfe: z.boolean().optional(),
              externalWithdrawalReceipt: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    nfes: z
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
              airbrushingNfes: z.boolean().optional(),
              vacation: z.boolean().optional(),
              externalWithdrawalBudget: z.boolean().optional(),
              externalWithdrawalNfe: z.boolean().optional(),
              externalWithdrawalReceipt: z.boolean().optional(),
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
              airbrushingNfes: z.boolean().optional(),
              vacation: z.boolean().optional(),
              externalWithdrawalBudget: z.boolean().optional(),
              externalWithdrawalNfe: z.boolean().optional(),
              externalWithdrawalReceipt: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    reimbursements: z
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
              airbrushingNfes: z.boolean().optional(),
              vacation: z.boolean().optional(),
              externalWithdrawalBudget: z.boolean().optional(),
              externalWithdrawalNfe: z.boolean().optional(),
              externalWithdrawalReceipt: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    nfeReimbursements: z
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
              airbrushingNfes: z.boolean().optional(),
              vacation: z.boolean().optional(),
              externalWithdrawalBudget: z.boolean().optional(),
              externalWithdrawalNfe: z.boolean().optional(),
              externalWithdrawalReceipt: z.boolean().optional(),
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
              airbrushingReceipts: z.boolean().optional(),
              airbrushingNfes: z.boolean().optional(),
              airbrushingArtworks: z.boolean().optional(),
              vacation: z.boolean().optional(),
              externalWithdrawalBudget: z.boolean().optional(),
              externalWithdrawalNfe: z.boolean().optional(),
              externalWithdrawalReceipt: z.boolean().optional(),
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
        price: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        task: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            status: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
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
          price: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
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
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const airbrushingFilters = {
  searchingFor: z.string().optional(),
  status: z.array(z.nativeEnum(AIRBRUSHING_STATUS)).optional(),
  taskIds: z.array(z.string()).optional(),
  priceRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  hasStartDate: z.boolean().optional(),
  hasFinishDate: z.boolean().optional(),
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
      OR: [{ task: { name: { contains: data.searchingFor, mode: "insensitive" } } }, { task: { customer: { name: { contains: data.searchingFor, mode: "insensitive" } } } }],
    });
    delete data.searchingFor;
  }

  if (data.status?.length) {
    andConditions.push({ status: { in: data.status } });
    delete data.status;
  }

  if (data.taskIds?.length) {
    andConditions.push({ taskId: { in: data.taskIds } });
    delete data.taskIds;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
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

export const airbrushingCreateSchema = z
  .object({
    startDate: nullableDate.optional(),
    finishDate: nullableDate.optional(),
    price: z
      .number({
        invalid_type_error: "Preço inválido",
      })
      .min(0, "Preço deve ser maior ou igual a zero")
      .nullable()
      .optional(),
    status: z.nativeEnum(AIRBRUSHING_STATUS).default(AIRBRUSHING_STATUS.PENDING),
    taskId: z.string().uuid("Tarefa inválida"),
    budgetIds: z.array(z.string().uuid()).optional(),
    invoiceIds: z.array(z.string().uuid()).optional(),
    receiptIds: z.array(z.string().uuid()).optional(),
    reimbursementIds: z.array(z.string().uuid()).optional(),
    reimbursementInvoiceIds: z.array(z.string().uuid()).optional(),
    artworkIds: z.array(z.string().uuid()).optional(),
  })
  .transform(toFormData);

export const airbrushingUpdateSchema = z
  .object({
    startDate: nullableDate.optional(),
    finishDate: nullableDate.optional(),
    price: z
      .number({
        invalid_type_error: "Preço inválido",
      })
      .min(0, "Preço deve ser maior ou igual a zero")
      .nullable()
      .optional(),
    status: z.nativeEnum(AIRBRUSHING_STATUS).optional(),
    taskId: z.string().uuid("Tarefa inválida").optional(),
    budgetIds: z.array(z.string().uuid()).optional(),
    invoiceIds: z.array(z.string().uuid()).optional(),
    receiptIds: z.array(z.string().uuid()).optional(),
    reimbursementIds: z.array(z.string().uuid()).optional(),
    reimbursementInvoiceIds: z.array(z.string().uuid()).optional(),
    artworkIds: z.array(z.string().uuid()).optional(),
  })
  .transform(toFormData);

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
        id: z.string().uuid("Airbrushing inválido"),
        data: airbrushingUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const airbrushingBatchDeleteSchema = z.object({
  airbrushingIds: z.array(z.string().uuid("Airbrushing inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
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
  id: z.string().uuid("Airbrushing inválido"),
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
    startDate: nullableDate.optional(),
    finishDate: nullableDate.optional(),
    price: z
      .number({
        invalid_type_error: "Preço inválido",
      })
      .min(0, "Preço deve ser maior ou igual a zero")
      .nullable()
      .optional(),
    status: z.nativeEnum(AIRBRUSHING_STATUS).default(AIRBRUSHING_STATUS.PENDING),
    budgetIds: z.array(z.string().uuid()).optional(),
    invoiceIds: z.array(z.string().uuid()).optional(),
    receiptIds: z.array(z.string().uuid()).optional(),
    reimbursementIds: z.array(z.string().uuid()).optional(),
    reimbursementInvoiceIds: z.array(z.string().uuid()).optional(),
    artworkIds: z.array(z.string().uuid()).optional(),
  })
  .transform(toFormData);

export type AirbrushingCreateNestedFormData = z.infer<typeof airbrushingCreateNestedSchema>;

// =====================
// Helper Functions
// =====================

export const mapAirbrushingToFormData = createMapToFormDataHelper<Airbrushing, AirbrushingUpdateFormData>((airbrushing) => ({
  startDate: airbrushing.startDate,
  finishDate: airbrushing.finishDate,
  price: airbrushing.price,
  status: airbrushing.status,
  taskId: airbrushing.taskId,
  budgetIds: airbrushing.budgets?.map((file) => file.id),
  invoiceIds: airbrushing.nfes?.map((file) => file.id),
  receiptIds: airbrushing.receipts?.map((file) => file.id),
  reimbursementIds: airbrushing.reimbursements?.map((file) => file.id),
  reimbursementInvoiceIds: airbrushing.nfeReimbursements?.map((file) => file.id),
  artworkIds: airbrushing.artworks?.map((file) => file.id),
}));
