// packages/schemas/src/changelog.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from "./common";
import type { ChangeLog } from '@types';
import { CHANGE_TRIGGERED_BY } from '@constants';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const changeLogIncludeSchema = z
  .object({
    // Direct ChangeLog relations
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              notifications: z.boolean().optional(),
              tasks: z.boolean().optional(),
              vacations: z.boolean().optional(),
              commissions: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schema Based on Prisma Schema Fields
// =====================

export const changeLogOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        // ChangeLog direct fields
        id: orderByDirectionSchema.optional(),
        entityType: orderByDirectionSchema.optional(),
        entityId: orderByDirectionSchema.optional(),
        action: orderByDirectionSchema.optional(),
        field: orderByDirectionSchema.optional(),
        reason: orderByDirectionSchema.optional(),
        triggeredBy: orderByDirectionSchema.optional(),
        triggeredById: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),

        // Nested relation ordering - User
        user: z
          .object({
            id: orderByDirectionSchema.optional(),
            email: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            status: orderByDirectionSchema.optional(),
            phone: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .optional(),

    // Array of ordering objects for multiple field ordering
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          entityType: orderByDirectionSchema.optional(),
          entityId: orderByDirectionSchema.optional(),
          action: orderByDirectionSchema.optional(),
          field: orderByDirectionSchema.optional(),
          reason: orderByDirectionSchema.optional(),
          triggeredBy: orderByDirectionSchema.optional(),
          triggeredById: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          user: z
            .object({
              id: orderByDirectionSchema.optional(),
              email: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
              status: orderByDirectionSchema.optional(),
              phone: orderByDirectionSchema.optional(),
              createdAt: orderByDirectionSchema.optional(),
              updatedAt: orderByDirectionSchema.optional(),
            })
            .optional(),
        })
        .optional(),
    ),
  ])
  .optional();

// =====================
// Where Schema Based on Prisma Schema Fields
// =====================

export const changeLogWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([changeLogWhereSchema, z.array(changeLogWhereSchema)]).optional(),
      OR: z.array(changeLogWhereSchema).optional(),
      NOT: z.union([changeLogWhereSchema, z.array(changeLogWhereSchema)]).optional(),

      // ChangeLog fields
      id: z
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

      entityType: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      entityId: z
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

      action: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      field: z
        .union([
          z.string().nullable(),
          z.object({
            equals: z.string().nullable().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            not: z.string().nullable().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      reason: z
        .union([
          z.string().nullable(),
          z.object({
            equals: z.string().nullable().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            not: z.string().nullable().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      userId: z
        .union([
          z.string().nullable(),
          z.object({
            equals: z.string().nullable().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().nullable().optional(),
          }),
        ])
        .optional(),

      triggeredBy: z
        .union([
          z.string().nullable(),
          z.object({
            equals: z.string().nullable().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            not: z.string().nullable().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      triggeredById: z
        .union([
          z.string().nullable(),
          z.object({
            equals: z.string().nullable().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().nullable().optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .object({
          equals: z.date().optional(),
          gte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          lt: z.coerce.date().optional(),
        })
        .optional(),

      // Relation filters
      user: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),
    })
    .strict(),
);

// =====================
// Query Filters
// =====================

const changeLogFilters = {
  searchingFor: z.string().optional(),
  entityTypes: z.array(z.string()).optional(),
  entityIds: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  hasUser: z.boolean().optional(),
  hasField: z.boolean().optional(),
  hasReason: z.boolean().optional(),
};

// =====================
// Transform Function
// =====================

const changeLogTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const { searchingFor, entityTypes, entityIds, actions, userIds, hasUser, hasField, hasReason, ...rest } = data;

  const andConditions: any[] = [];

  if (searchingFor) {
    andConditions.push({
      OR: [
        { entityType: { contains: searchingFor, mode: "insensitive" } },
        { action: { contains: searchingFor, mode: "insensitive" } },
        { field: { contains: searchingFor, mode: "insensitive" } },
        { reason: { contains: searchingFor, mode: "insensitive" } },
        { user: { name: { contains: searchingFor, mode: "insensitive" } } },
      ],
    });
  }

  if (entityTypes) {
    andConditions.push({ entityType: { in: entityTypes } });
  }

  if (entityIds) {
    andConditions.push({ entityId: { in: entityIds } });
  }

  if (actions) {
    andConditions.push({ action: { in: actions } });
  }

  if (userIds) {
    andConditions.push({ userId: { in: userIds } });
  }

  if (hasUser !== undefined) {
    andConditions.push(hasUser ? { userId: { not: null } } : { userId: null });
  }

  if (hasField !== undefined) {
    andConditions.push(hasField ? { field: { not: null } } : { field: null });
  }

  if (hasReason !== undefined) {
    andConditions.push(hasReason ? { reason: { not: null } } : { reason: null });
  }

  if (andConditions.length > 0) {
    if (rest.where) {
      rest.where = rest.where.AND ? { ...rest.where, AND: [...rest.where.AND, ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      rest.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return rest;
};

// =====================
// Query Schema
// =====================

export const changeLogGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(), // alias for limit
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: changeLogWhereSchema.optional(),
    orderBy: changeLogOrderBySchema.optional(),
    include: changeLogIncludeSchema.optional(),

    // Convenience filters
    ...changeLogFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(changeLogTransform);

// =====================
// GetById Schema
// =====================

export const changeLogGetByIdSchema = z.object({
  include: changeLogIncludeSchema.optional(),
  id: z.string().uuid({ message: "Registro de alteração inválido" }),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const changeLogCreateSchema = z
  .object({
    entityType: z.string().min(1, "Tipo de entidade é obrigatório"),
    entityId: z.string().uuid({ message: "Entidade inválida" }),
    action: z.string().min(1, "Ação é obrigatória"),
    field: z.string().nullable().optional(),
    oldValue: z.any().nullable().optional(),
    newValue: z.any().nullable().optional(),
    reason: z.string().nullable().optional(),
    metadata: z.any().nullable().optional(),
    userId: z.string().uuid({ message: "Usuário inválido" }).nullable().optional(),
    triggeredBy: z
      .enum(Object.values(CHANGE_TRIGGERED_BY) as [string, ...string[]])
      .nullable()
      .optional(),
    triggeredById: z.string().nullable().optional(),
  })
  .transform(toFormData);

export const changeLogUpdateSchema = z
  .object({
    entityType: z.string().optional(),
    entityId: z.string().uuid({ message: "Entidade inválida" }).optional(),
    action: z.string().optional(),
    field: z.string().nullable().optional(),
    oldValue: z.any().nullable().optional(),
    newValue: z.any().nullable().optional(),
    reason: z.string().nullable().optional(),
    metadata: z.any().nullable().optional(),
    userId: z.string().uuid({ message: "Usuário inválido" }).nullable().optional(),
    triggeredBy: z
      .enum(Object.values(CHANGE_TRIGGERED_BY) as [string, ...string[]])
      .nullable()
      .optional(),
    triggeredById: z.string().nullable().optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const changeLogBatchCreateSchema = z.object({
  changelogs: z.array(changeLogCreateSchema).min(1, "Pelo menos um log de alteração deve ser fornecido"),
});

export const changeLogBatchUpdateSchema = z.object({
  changelogs: z
    .array(
      z.object({
        id: z.string().uuid({ message: "Registro de alteração inválido" }),
        data: changeLogUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um log de alteração deve ser fornecido"),
});

export const changeLogBatchDeleteSchema = z.object({
  changelogIds: z.array(z.string().uuid({ message: "Registro de alteração inválido" })).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const changeLogQuerySchema = z.object({
  include: changeLogIncludeSchema.optional(),
});

// =====================
// Type Inference
// =====================

export type ChangeLogGetManyFormData = z.infer<typeof changeLogGetManySchema>;
export type ChangeLogGetByIdFormData = z.infer<typeof changeLogGetByIdSchema>;
export type ChangeLogQueryFormData = z.infer<typeof changeLogQuerySchema>;

export type ChangeLogCreateFormData = z.infer<typeof changeLogCreateSchema>;
export type ChangeLogUpdateFormData = z.infer<typeof changeLogUpdateSchema>;

export type ChangeLogBatchCreateFormData = z.infer<typeof changeLogBatchCreateSchema>;
export type ChangeLogBatchUpdateFormData = z.infer<typeof changeLogBatchUpdateSchema>;
export type ChangeLogBatchDeleteFormData = z.infer<typeof changeLogBatchDeleteSchema>;

export type ChangeLogInclude = z.infer<typeof changeLogIncludeSchema>;
export type ChangeLogOrderBy = z.infer<typeof changeLogOrderBySchema>;
export type ChangeLogWhere = z.infer<typeof changeLogWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapChangeLogToFormData = createMapToFormDataHelper<ChangeLog, ChangeLogUpdateFormData>((changeLog) => ({
  entityType: changeLog.entityType,
  entityId: changeLog.entityId,
  action: changeLog.action,
  field: changeLog.field,
  oldValue: changeLog.oldValue,
  newValue: changeLog.newValue,
  reason: changeLog.reason,
  metadata: changeLog.metadata,
  userId: changeLog.userId,
  triggeredBy: changeLog.triggeredBy,
  triggeredById: changeLog.triggeredById,
}));
