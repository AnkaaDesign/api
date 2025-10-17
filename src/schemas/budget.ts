// packages/schemas/src/budget.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, nullableDate, moneySchema } from "./common";
import type { Budget } from '@types';

// =====================
// Budget Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const budgetIncludeSchema = z
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
              invoices: z.boolean().optional(),
              receipts: z.boolean().optional(),
              observation: z.boolean().optional(),
              generalPainting: z.boolean().optional(),
              createdBy: z.boolean().optional(),
              artworks: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              services: z.boolean().optional(),
              truck: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Budget OrderBy Schema
// =====================

export const budgetOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        referencia: orderByDirectionSchema.optional(),
        valor: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        task: z
          .object({
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
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          referencia: orderByDirectionSchema.optional(),
          valor: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Budget Where Schema
// =====================

export const budgetWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.union([budgetWhereSchema, z.array(budgetWhereSchema)]).optional(),
      OR: z.array(budgetWhereSchema).optional(),
      NOT: z.union([budgetWhereSchema, z.array(budgetWhereSchema)]).optional(),

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

      referencia: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      valor: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
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
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const budgetFilters = {
  searchingFor: z.string().optional(),
  taskId: z.string().uuid("Tarefa inválida").optional(),
  hasTask: z.boolean().optional(),
  referenciaContains: z.string().optional(),
};

// =====================
// Transform Functions
// =====================

const budgetTransform = (data: any) => {
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

  // Handle searchingFor - search in referencia
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    andConditions.push({
      referencia: { contains: data.searchingFor.trim(), mode: "insensitive" },
    });
    delete data.searchingFor;
  }

  // Handle referenciaContains filter
  if (data.referenciaContains && typeof data.referenciaContains === "string" && data.referenciaContains.trim()) {
    andConditions.push({
      referencia: { contains: data.referenciaContains.trim(), mode: "insensitive" },
    });
    delete data.referenciaContains;
  }

  // Handle taskId filter
  if (data.taskId && typeof data.taskId === "string") {
    andConditions.push({ taskId: data.taskId });
    delete data.taskId;
  }

  // Handle hasTask filter
  if (typeof data.hasTask === "boolean") {
    if (data.hasTask) {
      andConditions.push({ taskId: { not: null } });
    } else {
      andConditions.push({ taskId: null });
    }
    delete data.hasTask;
  }

  // Handle date filters
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
// Query Schemas
// =====================

export const budgetGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: budgetWhereSchema.optional(),
    orderBy: budgetOrderBySchema.optional(),
    include: budgetIncludeSchema.optional(),

    // Convenience filters
    ...budgetFilters,

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
  .transform(budgetTransform);

// =====================
// Nested Schemas for Relations
// =====================

export const budgetCreateNestedSchema = z.object({
  referencia: z.string().min(1, "Referência é obrigatória").max(400, "Máximo de 400 caracteres atingido"),
  valor: moneySchema,
});

// =====================
// CRUD Schemas - Budget
// =====================

export const budgetCreateSchema = z.object({
  referencia: z.string().min(1, "Referência é obrigatória").max(400, "Máximo de 400 caracteres atingido"),
  valor: moneySchema,
  taskId: z.string().uuid("Tarefa inválida"),
});

export const budgetUpdateSchema = z.object({
  referencia: z.string().min(1, "Referência é obrigatória").max(400, "Máximo de 400 caracteres atingido").optional(),
  valor: moneySchema.optional(),
  taskId: z.string().uuid("Tarefa inválida").optional(),
});

// =====================
// Batch Operations Schemas - Budget
// =====================

export const budgetBatchCreateSchema = z.object({
  budgets: z.array(budgetCreateSchema).min(1, "Pelo menos um orçamento deve ser fornecido"),
});

export const budgetBatchUpdateSchema = z.object({
  budgets: z
    .array(
      z.object({
        id: z.string().uuid("Orçamento inválido"),
        data: budgetUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um orçamento deve ser fornecido"),
});

export const budgetBatchDeleteSchema = z.object({
  budgetIds: z.array(z.string().uuid("Orçamento inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const budgetQuerySchema = z.object({
  include: budgetIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const budgetBatchQuerySchema = z.object({
  include: budgetIncludeSchema.optional(),
});

// =====================
// GetById Schemas
// =====================

export const budgetGetByIdSchema = z.object({
  include: budgetIncludeSchema.optional(),
  id: z.string().uuid("Orçamento inválido"),
});

// =====================
// Type Exports
// =====================

// Budget types
export type BudgetGetManyFormData = z.infer<typeof budgetGetManySchema>;
export type BudgetGetByIdFormData = z.infer<typeof budgetGetByIdSchema>;
export type BudgetQueryFormData = z.infer<typeof budgetQuerySchema>;

export type BudgetCreateFormData = z.infer<typeof budgetCreateSchema>;
export type BudgetUpdateFormData = z.infer<typeof budgetUpdateSchema>;

export type BudgetBatchCreateFormData = z.infer<typeof budgetBatchCreateSchema>;
export type BudgetBatchUpdateFormData = z.infer<typeof budgetBatchUpdateSchema>;
export type BudgetBatchDeleteFormData = z.infer<typeof budgetBatchDeleteSchema>;
export type BudgetBatchQueryFormData = z.infer<typeof budgetBatchQuerySchema>;

export type BudgetOrderBy = z.infer<typeof budgetOrderBySchema>;
export type BudgetWhere = z.infer<typeof budgetWhereSchema>;
export type BudgetInclude = z.infer<typeof budgetIncludeSchema>;

// Nested budget create schema type
export type BudgetCreateNestedFormData = z.infer<typeof budgetCreateNestedSchema>;

// =====================
// Helper Functions
// =====================

export const mapBudgetToFormData = createMapToFormDataHelper<Budget, BudgetUpdateFormData>((budget) => ({
  referencia: budget.referencia,
  valor: budget.valor,
  taskId: budget.taskId,
}));
