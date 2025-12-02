// packages/schemas/src/serviceOrder.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableDate,
} from './common';
import type { ServiceOrder } from '@types';
import { SERVICE_ORDER_STATUS } from '@constants';

// =====================
// ServiceOrder Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const serviceOrderIncludeSchema = z
  .object({
    task: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              customer: z.boolean().optional(),
              budget: z.boolean().optional(),
              nfe: z.boolean().optional(),
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
  })
  .partial();

// =====================
// Service OrderBy Schema
// =====================

export const serviceOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          description: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// ServiceOrder OrderBy Schema
// =====================

export const serviceOrderOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        startedAt: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
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
            commission: orderByDirectionSchema.optional(),
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
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          description: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          startedAt: orderByDirectionSchema.optional(),
          finishedAt: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// ServiceOrder Where Schema
// =====================

export const serviceOrderWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.union([serviceOrderWhereSchema, z.array(serviceOrderWhereSchema)]).optional(),
      OR: z.array(serviceOrderWhereSchema).optional(),
      NOT: z.union([serviceOrderWhereSchema, z.array(serviceOrderWhereSchema)]).optional(),

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

      status: z
        .union([
          z.nativeEnum(SERVICE_ORDER_STATUS),
          z.object({
            equals: z.nativeEnum(SERVICE_ORDER_STATUS).optional(),
            not: z.nativeEnum(SERVICE_ORDER_STATUS).optional(),
            in: z.array(z.nativeEnum(SERVICE_ORDER_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(SERVICE_ORDER_STATUS)).optional(),
          }),
        ])
        .optional(),

      statusOrder: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.number().nullable().optional(),
            not: z.number().nullable().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      description: z
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
            mode: z.enum(['default', 'insensitive']).optional(),
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

      startedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.date().nullable().optional(),
            not: z.date().nullable().optional(),
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
            equals: z.date().nullable().optional(),
            not: z.date().nullable().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
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

const serviceOrderFilters = {
  searchingFor: z.string().optional(),
  taskId: z.string().uuid('Tarefa inválida').optional(),
  hasTask: z.boolean().optional(),
  hasItems: z.boolean().optional(),
  hasInstallment: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
  statusIn: z.array(z.string()).optional(),
  descriptionContains: z.string().optional(),
};

// =====================
// Transform Functions
// =====================

const serviceOrderTransform = (data: any) => {
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

  // Handle searchingFor - search in description
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      description: { contains: data.searchingFor.trim(), mode: 'insensitive' },
    });
    delete data.searchingFor;
  }

  // Handle descriptionContains filter
  if (
    data.descriptionContains &&
    typeof data.descriptionContains === 'string' &&
    data.descriptionContains.trim()
  ) {
    andConditions.push({
      description: { contains: data.descriptionContains.trim(), mode: 'insensitive' },
    });
    delete data.descriptionContains;
  }

  // Handle taskId filter
  if (data.taskId && typeof data.taskId === 'string') {
    andConditions.push({ taskId: data.taskId });
    delete data.taskId;
  }

  // Handle hasTask filter
  if (typeof data.hasTask === 'boolean') {
    if (data.hasTask) {
      andConditions.push({ taskId: { not: null } });
    } else {
      andConditions.push({ taskId: null });
    }
    delete data.hasTask;
  }

  // Handle hasItems filter (assuming there's a relation to items)
  if (typeof data.hasItems === 'boolean') {
    if (data.hasItems) {
      andConditions.push({ items: { some: {} } });
    } else {
      andConditions.push({ items: { none: {} } });
    }
    delete data.hasItems;
  }

  // Handle hasInstallment filter (assuming there's a relation to installments)
  if (typeof data.hasInstallment === 'boolean') {
    if (data.hasInstallment) {
      andConditions.push({ installments: { some: {} } });
    } else {
      andConditions.push({ installments: { none: {} } });
    }
    delete data.hasInstallment;
  }

  // Handle isActive filter (not finished)
  if (typeof data.isActive === 'boolean') {
    if (data.isActive) {
      andConditions.push({ finishedAt: null });
    } else {
      andConditions.push({ finishedAt: { not: null } });
    }
    delete data.isActive;
  }

  // Handle isCompleted filter (finished)
  if (typeof data.isCompleted === 'boolean') {
    if (data.isCompleted) {
      andConditions.push({ finishedAt: { not: null } });
    } else {
      andConditions.push({ finishedAt: null });
    }
    delete data.isCompleted;
  }

  // Handle statusIn filter
  if (data.statusIn && Array.isArray(data.statusIn) && data.statusIn.length > 0) {
    andConditions.push({ status: { in: data.statusIn } });
    delete data.statusIn;
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

  if (data.startedAt) {
    andConditions.push({ startedAt: data.startedAt });
    delete data.startedAt;
  }

  if (data.finishedAt) {
    andConditions.push({ finishedAt: data.finishedAt });
    delete data.finishedAt;
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

export const serviceOrderGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: serviceOrderWhereSchema.optional(),
    orderBy: serviceOrderOrderBySchema.optional(),
    include: serviceOrderIncludeSchema.optional(),

    // Convenience filters
    ...serviceOrderFilters,

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
    startedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    finishedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(serviceOrderTransform);

// =====================
// CRUD Schemas - ServiceOrder
// =====================

export const serviceOrderCreateSchema = z.object({
  status: z
    .enum(Object.values(SERVICE_ORDER_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status inválido' }),
    })
    .default(SERVICE_ORDER_STATUS.PENDING),
  description: z
    .string()
    .min(3, { message: 'Minímo de 3 caracteres' })
    .max(400, { message: 'Maxímo de 400 caracteres atingido' }),
  taskId: z.string().uuid('Tarefa inválida'),
  startedAt: nullableDate.optional(),
  finishedAt: nullableDate.optional(),
});

export const serviceOrderUpdateSchema = z.object({
  status: z
    .enum(Object.values(SERVICE_ORDER_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status inválido' }),
    })
    .optional(),
  description: z
    .string()
    .min(3, { message: 'Minímo de 3 caracteres' })
    .max(400, { message: 'Maxímo de 400 caracteres atingido' })
    .optional(),
  taskId: z.string().uuid('Tarefa inválida').optional(),
  startedAt: nullableDate.optional(),
  finishedAt: nullableDate.optional(),
});

// =====================
// Batch Operations Schemas - ServiceOrder
// =====================

export const serviceOrderBatchCreateSchema = z.object({
  serviceOrders: z
    .array(serviceOrderCreateSchema)
    .min(1, 'Pelo menos uma ordem de serviço deve ser fornecida'),
});

export const serviceOrderBatchUpdateSchema = z.object({
  serviceOrders: z
    .array(
      z.object({
        id: z.string().uuid('Ordem de serviço inválida'),
        data: serviceOrderUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma ordem de serviço deve ser fornecida'),
});

export const serviceOrderBatchDeleteSchema = z.object({
  serviceOrderIds: z
    .array(z.string().uuid('Ordem de serviço inválida'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const serviceOrderQuerySchema = z.object({
  include: serviceOrderIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const serviceOrderBatchQuerySchema = z.object({
  include: serviceOrderIncludeSchema.optional(),
});

// =====================
// GetById Schemas
// =====================

export const serviceOrderGetByIdSchema = z.object({
  include: serviceOrderIncludeSchema.optional(),
  id: z.string().uuid('Ordem de serviço inválida'),
});

// =====================
// Type Exports
// =====================

// ServiceOrder types
export type ServiceOrderGetManyFormData = z.infer<typeof serviceOrderGetManySchema>;
export type ServiceOrderGetByIdFormData = z.infer<typeof serviceOrderGetByIdSchema>;
export type ServiceOrderQueryFormData = z.infer<typeof serviceOrderQuerySchema>;

export type ServiceOrderCreateFormData = z.infer<typeof serviceOrderCreateSchema>;
export type ServiceOrderUpdateFormData = z.infer<typeof serviceOrderUpdateSchema>;

export type ServiceOrderBatchCreateFormData = z.infer<typeof serviceOrderBatchCreateSchema>;
export type ServiceOrderBatchUpdateFormData = z.infer<typeof serviceOrderBatchUpdateSchema>;
export type ServiceOrderBatchDeleteFormData = z.infer<typeof serviceOrderBatchDeleteSchema>;
export type ServiceOrderBatchQueryFormData = z.infer<typeof serviceOrderBatchQuerySchema>;

export type ServiceOrderOrderBy = z.infer<typeof serviceOrderOrderBySchema>;
export type ServiceOrderWhere = z.infer<typeof serviceOrderWhereSchema>;
export type ServiceOrderInclude = z.infer<typeof serviceOrderIncludeSchema>;

// =====================
// Helper Functions
// =====================

export const mapServiceOrderToFormData = createMapToFormDataHelper<
  ServiceOrder,
  ServiceOrderUpdateFormData
>(serviceOrder => ({
  status: serviceOrder.status || undefined,
  statusOrder: serviceOrder.statusOrder,
  description: serviceOrder.description,
  taskId: serviceOrder.taskId,
  startedAt: serviceOrder.startedAt,
  finishedAt: serviceOrder.finishedAt,
}));
