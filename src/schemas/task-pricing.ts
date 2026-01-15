// packages/schemas/src/task-pricing.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableDate,
  moneySchema,
} from './common';
import type { TaskPricing } from '@types';
import { TASK_PRICING_STATUS, DISCOUNT_TYPE } from '@constants';

// =====================
// TaskPricing Status Schema
// =====================

export const taskPricingStatusSchema = z.enum([
  TASK_PRICING_STATUS.DRAFT,
  TASK_PRICING_STATUS.APPROVED,
  TASK_PRICING_STATUS.REJECTED,
  TASK_PRICING_STATUS.CANCELLED,
]);

// =====================
// Discount Type Schema
// =====================

export const discountTypeSchema = z.enum([
  DISCOUNT_TYPE.NONE,
  DISCOUNT_TYPE.PERCENTAGE,
  DISCOUNT_TYPE.FIXED_VALUE,
]);

// =====================
// TaskPricing Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const taskPricingIncludeSchema = z
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
              serviceOrders: z.boolean().optional(),
              truck: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
              pricing: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    items: z.boolean().optional(),
  })
  .partial();

// =====================
// TaskPricing OrderBy Schema
// =====================

export const taskPricingOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        total: orderByDirectionSchema.optional(),
        expiresAt: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
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
          total: orderByDirectionSchema.optional(),
          expiresAt: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// TaskPricing Where Schema
// =====================

export const taskPricingWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.union([taskPricingWhereSchema, z.array(taskPricingWhereSchema)]).optional(),
      OR: z.array(taskPricingWhereSchema).optional(),
      NOT: z.union([taskPricingWhereSchema, z.array(taskPricingWhereSchema)]).optional(),
      id: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.union([z.string(), z.object({ in: z.array(z.string()) })]).optional(),
          }),
        ])
        .optional(),
      total: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            not: z.number().optional(),
          }),
        ])
        .optional(),
      expiresAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            gt: z.date().optional(),
            gte: z.date().optional(),
            lt: z.date().optional(),
            lte: z.date().optional(),
            not: z.date().optional(),
          }),
        ])
        .optional(),
      status: z
        .union([
          taskPricingStatusSchema,
          z.object({
            equals: taskPricingStatusSchema.optional(),
            in: z.array(taskPricingStatusSchema).optional(),
            notIn: z.array(taskPricingStatusSchema).optional(),
            not: taskPricingStatusSchema.optional(),
          }),
        ])
        .optional(),
      taskId: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().optional(),
          }),
        ])
        .optional(),
      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            gt: z.date().optional(),
            gte: z.date().optional(),
            lt: z.date().optional(),
            lte: z.date().optional(),
            not: z.date().optional(),
          }),
        ])
        .optional(),
      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            gt: z.date().optional(),
            gte: z.date().optional(),
            lt: z.date().optional(),
            lte: z.date().optional(),
            not: z.date().optional(),
          }),
        ])
        .optional(),
    })
    .partial()
    .strict(),
);

// =====================
// Convenience Filters
// =====================

const taskPricingFilters = {
  searchingFor: z.string().optional(),
  taskId: z.string().uuid().optional(),
  hasTask: z.boolean().optional(),
  status: taskPricingStatusSchema.optional(),
};

// =====================
// Transform Function for Filters
// =====================

const taskPricingTransform = (data: any) => {
  const transformed: any = { ...data };

  // Handle searchingFor filter
  if (data.searchingFor) {
    transformed.where = {
      ...transformed.where,
      items: {
        some: {
          description: {
            contains: data.searchingFor,
            mode: 'insensitive',
          },
        },
      },
    };
    delete transformed.searchingFor;
  }

  // Handle taskId filter
  if (data.taskId) {
    transformed.where = {
      ...transformed.where,
      taskId: data.taskId,
    };
    delete transformed.taskId;
  }

  // Handle hasTask filter
  if (data.hasTask !== undefined) {
    transformed.where = {
      ...transformed.where,
      taskId: data.hasTask ? { not: null } : null,
    };
    delete transformed.hasTask;
  }

  // Handle status filter
  if (data.status) {
    transformed.where = {
      ...transformed.where,
      status: data.status,
    };
    delete transformed.status;
  }

  return transformed;
};

// =====================
// GetMany Schema - TaskPricing
// =====================

export const taskPricingGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: taskPricingWhereSchema.optional(),
    orderBy: taskPricingOrderBySchema.optional(),
    include: taskPricingIncludeSchema.optional(),

    // Convenience filters
    ...taskPricingFilters,

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
    expiresAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(taskPricingTransform);

// =====================
// Nested Schemas for Relations
// =====================

// TaskPricingItem nested schema
export const taskPricingItemCreateNestedSchema = z.object({
  description: z
    .string()
    .min(1, 'Descrição é obrigatória')
    .max(400, 'Máximo de 400 caracteres atingido'),
  amount: moneySchema,
});

// TaskPricing nested schema for task create/update (matches Prisma TaskPricing model)
export const taskPricingCreateNestedSchema = z.object({
  items: z
    .array(taskPricingItemCreateNestedSchema)
    .min(1, 'Pelo menos um item é obrigatório'),
  expiresAt: z.coerce.date({
    errorMap: () => ({ message: 'Data de validade inválida' }),
  }),
  status: taskPricingStatusSchema.default(TASK_PRICING_STATUS.DRAFT),
});

// =====================
// CRUD Schemas - TaskPricing
// =====================

export const taskPricingCreateSchema = z.object({
  subtotal: moneySchema,
  discountType: discountTypeSchema.default(DISCOUNT_TYPE.NONE),
  discountValue: moneySchema.optional(),
  total: moneySchema,
  expiresAt: z.coerce.date({ errorMap: () => ({ message: 'Data de validade inválida' }) }),
  status: taskPricingStatusSchema.default(TASK_PRICING_STATUS.DRAFT),
  taskId: z.string().uuid('Tarefa inválida'),
  items: z
    .array(taskPricingItemCreateNestedSchema)
    .min(1, 'Pelo menos um item é obrigatório')
    .optional(),
}).refine(
  (data) => {
    // If discount type is not NONE, discountValue must be provided
    if (data.discountType !== DISCOUNT_TYPE.NONE && !data.discountValue) {
      return false;
    }
    // If discount type is PERCENTAGE, discountValue must be between 0 and 100
    if (data.discountType === DISCOUNT_TYPE.PERCENTAGE && data.discountValue) {
      return data.discountValue >= 0 && data.discountValue <= 100;
    }
    return true;
  },
  {
    message: 'Valor de desconto inválido para o tipo selecionado',
    path: ['discountValue'],
  },
);

export const taskPricingUpdateSchema = z.object({
  subtotal: moneySchema.optional(),
  discountType: discountTypeSchema.optional(),
  discountValue: moneySchema.optional(),
  total: moneySchema.optional(),
  expiresAt: z.coerce
    .date({ errorMap: () => ({ message: 'Data de validade inválida' }) })
    .optional(),
  status: taskPricingStatusSchema.optional(),
  taskId: z.string().uuid('Tarefa inválida').optional(),
  items: z.array(taskPricingItemCreateNestedSchema).optional(),
}).refine(
  (data) => {
    // If discount type is provided and not NONE, discountValue must be provided
    if (data.discountType && data.discountType !== DISCOUNT_TYPE.NONE && !data.discountValue) {
      return false;
    }
    // If discount type is PERCENTAGE, discountValue must be between 0 and 100
    if (data.discountType === DISCOUNT_TYPE.PERCENTAGE && data.discountValue) {
      return data.discountValue >= 0 && data.discountValue <= 100;
    }
    return true;
  },
  {
    message: 'Valor de desconto inválido para o tipo selecionado',
    path: ['discountValue'],
  },
);

// =====================
// Batch Operations Schemas - TaskPricing
// =====================

export const taskPricingBatchCreateSchema = z.object({
  pricings: z
    .array(taskPricingCreateSchema)
    .min(1, 'Pelo menos um orçamento deve ser fornecido'),
});

export const taskPricingBatchUpdateSchema = z.object({
  pricings: z
    .array(
      z.object({
        id: z.string().uuid('Orçamento inválido'),
        data: taskPricingUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um orçamento deve ser fornecido'),
});

export const taskPricingBatchDeleteSchema = z.object({
  pricingIds: z
    .array(z.string().uuid('Orçamento inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const taskPricingQuerySchema = z.object({
  include: taskPricingIncludeSchema.optional(),
});

// =====================
// Export Inferred Types
// =====================

export type TaskPricingCreateFormData = z.infer<typeof taskPricingCreateSchema>;
export type TaskPricingUpdateFormData = z.infer<typeof taskPricingUpdateSchema>;
export type TaskPricingGetManyFormData = z.infer<typeof taskPricingGetManySchema>;
export type TaskPricingInclude = z.infer<typeof taskPricingIncludeSchema>;
export type TaskPricingOrderBy = z.infer<typeof taskPricingOrderBySchema>;
export type TaskPricingWhere = z.infer<typeof taskPricingWhereSchema>;
export type TaskPricingItemCreateNestedFormData = z.infer<
  typeof taskPricingItemCreateNestedSchema
>;
export type TaskPricingCreateNestedFormData = z.infer<typeof taskPricingCreateNestedSchema>;
