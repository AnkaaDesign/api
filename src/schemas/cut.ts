// packages/schemas/src/cut.ts

import { z } from 'zod';
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from './common';
import type { Cut } from '@types';
import { CUT_TYPE, CUT_STATUS, CUT_ORIGIN, CUT_REQUEST_REASON } from '@constants';

// =====================
// CUT SCHEMAS
// =====================

// Include Schema
export const cutIncludeSchema = z
  .object({
    file: z.boolean().optional(),
    task: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              customer: z.boolean().optional(),
              sector: z.boolean().optional(),
              serviceOrders: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    parentCut: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              file: z.boolean().optional(),
              task: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    childCuts: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              file: z.boolean().optional(),
              task: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// OrderBy Schema
export const cutOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        id: orderByDirectionSchema.optional(),
        fileId: orderByDirectionSchema.optional(),
        type: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        origin: orderByDirectionSchema.optional(),
        reason: orderByDirectionSchema.optional(),
        parentCutId: orderByDirectionSchema.optional(),
        startedAt: orderByDirectionSchema.optional(),
        completedAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    // Array of ordering objects for multiple field ordering
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          fileId: orderByDirectionSchema.optional(),
          type: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          origin: orderByDirectionSchema.optional(),
          reason: orderByDirectionSchema.optional(),
          parentCutId: orderByDirectionSchema.optional(),
          startedAt: orderByDirectionSchema.optional(),
          completedAt: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
    // String enum for simple field names
    z.enum([
      'id',
      'fileId',
      'type',
      'status',
      'statusOrder',
      'taskId',
      'origin',
      'reason',
      'parentCutId',
      'startedAt',
      'completedAt',
      'createdAt',
      'updatedAt',
    ]),
  ])
  .optional();

// Where Schema
export const cutWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([cutWhereSchema, z.array(cutWhereSchema)]).optional(),
      OR: z.array(cutWhereSchema).optional(),
      NOT: z.union([cutWhereSchema, z.array(cutWhereSchema)]).optional(),

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

      fileId: z
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
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      parentCutId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      // Enum fields
      type: z
        .union([
          z.nativeEnum(CUT_TYPE),
          z.object({
            equals: z.nativeEnum(CUT_TYPE).optional(),
            not: z.nativeEnum(CUT_TYPE).optional(),
            in: z.array(z.nativeEnum(CUT_TYPE)).optional(),
            notIn: z.array(z.nativeEnum(CUT_TYPE)).optional(),
          }),
        ])
        .optional(),

      status: z
        .union([
          z.nativeEnum(CUT_STATUS),
          z.object({
            equals: z.nativeEnum(CUT_STATUS).optional(),
            not: z.nativeEnum(CUT_STATUS).optional(),
            in: z.array(z.nativeEnum(CUT_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(CUT_STATUS)).optional(),
          }),
        ])
        .optional(),

      origin: z
        .union([
          z.nativeEnum(CUT_ORIGIN),
          z.object({
            equals: z.nativeEnum(CUT_ORIGIN).optional(),
            not: z.nativeEnum(CUT_ORIGIN).optional(),
            in: z.array(z.nativeEnum(CUT_ORIGIN)).optional(),
            notIn: z.array(z.nativeEnum(CUT_ORIGIN)).optional(),
          }),
        ])
        .optional(),

      reason: z
        .union([
          z.nativeEnum(CUT_REQUEST_REASON),
          z.null(),
          z.object({
            equals: z.union([z.nativeEnum(CUT_REQUEST_REASON), z.null()]).optional(),
            not: z.union([z.nativeEnum(CUT_REQUEST_REASON), z.null()]).optional(),
            in: z.array(z.nativeEnum(CUT_REQUEST_REASON)).optional(),
            notIn: z.array(z.nativeEnum(CUT_REQUEST_REASON)).optional(),
          }),
        ])
        .optional(),

      // Number fields
      statusOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

      // Date fields for tracking
      startedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      completedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Date fields
      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      file: z.any().optional(),
      task: z.any().optional(),
      parentCut: z.any().optional(),
      childCuts: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const cutFilters = {
  searchingFor: z.string().optional(),
  type: z.array(z.nativeEnum(CUT_TYPE)).optional(),
  status: z.array(z.nativeEnum(CUT_STATUS)).optional(),
  origin: z.array(z.nativeEnum(CUT_ORIGIN)).optional(),
  reason: z.array(z.nativeEnum(CUT_REQUEST_REASON)).optional(),
  fileIds: z.array(z.string()).optional(),
  taskIds: z.array(z.string()).optional(),
  parentCutIds: z.array(z.string()).optional(),
};

// =====================
// Transform Functions
// =====================

const cutTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  const andConditions: any[] = [];

  // Handle searchingFor
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      OR: [
        { file: { filename: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
        { task: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
        {
          task: {
            customer: { fantasyName: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
          },
        },
      ],
    });
    delete data.searchingFor;
  }

  // Handle type filter
  if (data.type && Array.isArray(data.type) && data.type.length > 0) {
    andConditions.push({ type: { in: data.type } });
    delete data.type;
  }

  // Handle status filter
  if (data.status && Array.isArray(data.status) && data.status.length > 0) {
    andConditions.push({ status: { in: data.status } });
    delete data.status;
  }

  // Handle origin filter
  if (data.origin && Array.isArray(data.origin) && data.origin.length > 0) {
    andConditions.push({ origin: { in: data.origin } });
    delete data.origin;
  }

  // Handle reason filter
  if (data.reason && Array.isArray(data.reason) && data.reason.length > 0) {
    andConditions.push({ reason: { in: data.reason } });
    delete data.reason;
  }

  // Handle fileIds filter
  if (data.fileIds && Array.isArray(data.fileIds) && data.fileIds.length > 0) {
    andConditions.push({ fileId: { in: data.fileIds } });
    delete data.fileIds;
  }

  // Handle taskIds filter
  if (data.taskIds && Array.isArray(data.taskIds) && data.taskIds.length > 0) {
    andConditions.push({ taskId: { in: data.taskIds } });
    delete data.taskIds;
  }

  // Handle parentCutIds filter
  if (data.parentCutIds && Array.isArray(data.parentCutIds) && data.parentCutIds.length > 0) {
    andConditions.push({ parentCutId: { in: data.parentCutIds } });
    delete data.parentCutIds;
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

export const cutGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(), // alias for limit

    // Direct Prisma clauses
    where: cutWhereSchema.optional(),
    orderBy: cutOrderBySchema.optional(),
    include: cutIncludeSchema.optional(),

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

    // Convenience filters
    ...cutFilters,
  })
  .transform(data => {
    // Handle take/limit alias
    if (data.take && !data.limit) {
      data.limit = data.take;
    }
    delete data.take;
    return cutTransform(data);
  });

// Additional query schema for simple queries
export const cutQuerySchema = z.object({
  take: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(0).optional(),
  where: cutWhereSchema.optional(),
  orderBy: cutOrderBySchema.optional(),
  include: cutIncludeSchema.optional(),
});

// GetById schema
export const cutGetByIdSchema = z.object({
  include: cutIncludeSchema.optional(),
  id: z.string().uuid('Corte inválido'),
});

// Query schema for include parameter only
export const cutQueryParamsSchema = z.object({
  include: cutIncludeSchema.optional(),
});

// =====================
// Transform for Create/Update Schemas
// =====================

const toFormData = <T>(data: T) => data;

// =====================
// CRUD Schemas
// =====================

export const cutCreateSchema = z
  .object({
    fileId: z.string().uuid('Arquivo inválido').optional(),
    type: z.nativeEnum(CUT_TYPE, {
      errorMap: () => ({ message: 'Tipo de corte inválido' }),
    }),
    status: z
      .nativeEnum(CUT_STATUS, {
        errorMap: () => ({ message: 'Status de corte inválido' }),
      })
      .optional(),
    taskId: z.string().uuid('Tarefa inválida').nullable().optional(),
    origin: z.nativeEnum(CUT_ORIGIN, {
      errorMap: () => ({ message: 'Origem do corte inválida' }),
    }),
    reason: z
      .nativeEnum(CUT_REQUEST_REASON, {
        errorMap: () => ({ message: 'Motivo da solicitação inválido' }),
      })
      .nullable()
      .optional(),
    parentCutId: z.string().uuid('Corte pai inválido').nullable().optional(),
    startedAt: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
  })
  .transform(toFormData);

export const cutUpdateSchema = z
  .object({
    fileId: z.string().uuid('Arquivo inválido').optional(),
    type: z
      .nativeEnum(CUT_TYPE, {
        errorMap: () => ({ message: 'Tipo de corte inválido' }),
      })
      .optional(),
    status: z
      .nativeEnum(CUT_STATUS, {
        errorMap: () => ({ message: 'Status de corte inválido' }),
      })
      .optional(),
    taskId: z.string().uuid('Tarefa inválida').nullable().optional(),
    origin: z
      .nativeEnum(CUT_ORIGIN, {
        errorMap: () => ({ message: 'Origem do corte inválida' }),
      })
      .optional(),
    reason: z
      .nativeEnum(CUT_REQUEST_REASON, {
        errorMap: () => ({ message: 'Motivo da solicitação inválido' }),
      })
      .nullable()
      .optional(),
    parentCutId: z.string().uuid('Corte pai inválido').nullable().optional(),
    startedAt: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
  })
  .transform(toFormData);

// Batch Schemas
export const cutBatchCreateSchema = z.object({
  cuts: z.array(cutCreateSchema),
});

export const cutBatchUpdateSchema = z.object({
  cuts: z.array(
    z.object({
      id: z.string().uuid('Corte inválido'),
      fileId: z.string().uuid('Arquivo inválido').optional(),
      type: z
        .nativeEnum(CUT_TYPE, {
          errorMap: () => ({ message: 'Tipo de corte inválido' }),
        })
        .optional(),
      status: z
        .nativeEnum(CUT_STATUS, {
          errorMap: () => ({ message: 'Status de corte inválido' }),
        })
        .optional(),
      taskId: z.string().uuid('Tarefa inválida').nullable().optional(),
      origin: z
        .nativeEnum(CUT_ORIGIN, {
          errorMap: () => ({ message: 'Origem do corte inválida' }),
        })
        .optional(),
      reason: z
        .nativeEnum(CUT_REQUEST_REASON, {
          errorMap: () => ({ message: 'Motivo da solicitação inválido' }),
        })
        .nullable()
        .optional(),
      parentCutId: z.string().uuid('Corte pai inválido').nullable().optional(),
      startedAt: z.date().nullable().optional(),
      completedAt: z.date().nullable().optional(),
    }),
  ),
});

export const cutBatchDeleteSchema = z.object({
  cutIds: z.array(z.string().uuid('Corte inválido')),
});

// =====================
// Type Exports
// =====================

// Cut types
export type CutGetManyFormData = z.infer<typeof cutGetManySchema>;
export type CutGetByIdFormData = z.infer<typeof cutGetByIdSchema>;
export type CutQuery = z.infer<typeof cutQuerySchema>;
export type CutQueryFormData = z.infer<typeof cutQueryParamsSchema>;

export type CutCreateFormData = z.infer<typeof cutCreateSchema>;
export type CutUpdateFormData = z.infer<typeof cutUpdateSchema>;

export type CutBatchCreateFormData = z.infer<typeof cutBatchCreateSchema>;
export type CutBatchUpdateFormData = z.infer<typeof cutBatchUpdateSchema>;
export type CutBatchDeleteFormData = z.infer<typeof cutBatchDeleteSchema>;

export type CutInclude = z.infer<typeof cutIncludeSchema>;
export type CutOrderBy = z.infer<typeof cutOrderBySchema>;
export type CutWhere = z.infer<typeof cutWhereSchema>;

// =====================
// Nested Schema for Relations
// =====================

// Nested schema for creating cuts from other entities (like tasks)
export const cutCreateNestedSchema = z
  .object({
    fileId: z.string().uuid('Arquivo inválido').optional(),
    type: z.nativeEnum(CUT_TYPE, {
      errorMap: () => ({ message: 'Tipo de corte inválido' }),
    }),
    origin: z.nativeEnum(CUT_ORIGIN, {
      errorMap: () => ({ message: 'Origem do corte inválida' }),
    }),
    reason: z
      .nativeEnum(CUT_REQUEST_REASON, {
        errorMap: () => ({ message: 'Motivo da solicitação inválido' }),
      })
      .nullable()
      .optional(),
    parentCutId: z.string().uuid('Corte pai inválido').nullable().optional(),
    _fileIndex: z.number().optional(), // Temporary field for file mapping (frontend optimization)
  })
  .transform(toFormData);

// Map helper
export const mapCutToFormData = createMapToFormDataHelper<Cut, CutUpdateFormData>(cut => ({
  fileId: cut.fileId,
  type: cut.type,
  status: cut.status,
  taskId: cut.taskId,
  origin: cut.origin,
  reason: cut.reason,
  parentCutId: cut.parentCutId,
  startedAt: cut.startedAt,
  completedAt: cut.completedAt,
}));
