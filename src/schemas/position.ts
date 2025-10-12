// packages/schemas/src/position.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, createNameSchema } from "./common";
import type { Position } from '@types';

// =====================
// Include Schemas (Second Level Only)
// =====================

export const monetaryValueIncludeSchema = z
  .object({
    item: z.boolean().optional(),
    position: z.boolean().optional(),
  })
  .partial();

// MonetaryValue Where Schema - defines valid filter fields
export const monetaryValueWhereSchema = z
  .object({
    id: z.union([z.string(), z.object({ in: z.array(z.string()) }).optional()]).optional(),
    value: z.union([z.number(), z.object({ gte: z.number(), lte: z.number() }).partial()]).optional(),
    current: z.boolean().optional(),
    createdAt: z.union([z.date(), z.object({ gte: z.date(), lte: z.date() }).partial()]).optional(),
    updatedAt: z.union([z.date(), z.object({ gte: z.date(), lte: z.date() }).partial()]).optional(),
    itemId: z.string().optional(),
    positionId: z.string().optional(),
  })
  .partial()
  .strict(); // Only allow defined fields - reject unknown fields like 'isActive'

// MonetaryValue OrderBy Schema
export const monetaryValueOrderBySchema = z.union([
  z.object({
    id: orderByDirectionSchema.optional(),
    value: orderByDirectionSchema.optional(),
    current: orderByDirectionSchema.optional(),
    createdAt: orderByDirectionSchema.optional(),
    updatedAt: orderByDirectionSchema.optional(),
  }).partial(),
  z.array(z.object({
    id: orderByDirectionSchema.optional(),
    value: orderByDirectionSchema.optional(),
    current: orderByDirectionSchema.optional(),
    createdAt: orderByDirectionSchema.optional(),
    updatedAt: orderByDirectionSchema.optional(),
  }).partial()),
]);

export const positionIncludeSchema = z
  .object({
    users: z
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
              warningsCollaborator: z.boolean().optional(),
              warningsSupervisor: z.boolean().optional(),
              warningsWitness: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              ppeDeliveredBy: z.boolean().optional(),
              ppeSchedules: z.boolean().optional(),
              changeLogs: z.boolean().optional(),
              seenNotification: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    remunerations: z
      .union([
        z.boolean(),
        z.object({
          include: monetaryValueIncludeSchema.optional(),
          orderBy: monetaryValueOrderBySchema.optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
          where: monetaryValueWhereSchema.optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial()
  .strip();

// =====================
// OrderBy Schemas
// =====================

export const positionOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      hierarchy: orderByDirectionSchema.optional(),
      remuneration: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial(),
  // Array of ordering objects
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        hierarchy: orderByDirectionSchema.optional(),
        remuneration: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// Where Schemas
// =====================

export const positionWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.union([z.lazy(() => positionWhereSchema), z.array(z.lazy(() => positionWhereSchema))]).optional(),
    OR: z.array(z.lazy(() => positionWhereSchema)).optional(),
    NOT: z.lazy(() => positionWhereSchema).optional(),

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

    // String fields
    name: z
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

    // Numeric fields
    remuneration: z
      .union([
        z.number(),
        z.object({
          equals: z.number().optional(),
          not: z.number().optional(),
          in: z.array(z.number()).optional(),
          notIn: z.array(z.number()).optional(),
          lt: z.number().optional(),
          lte: z.number().optional(),
          gt: z.number().optional(),
          gte: z.number().optional(),
        }),
      ])
      .optional(),

    hierarchy: z
      .union([
        z.number(),
        z.object({
          equals: z.number().optional(),
          not: z.number().optional(),
          in: z.array(z.number()).optional(),
          notIn: z.array(z.number()).optional(),
          lt: z.number().optional(),
          lte: z.number().optional(),
          gt: z.number().optional(),
          gte: z.number().optional(),
        }),
      ])
      .optional(),

    // Boolean fields
    bonifiable: z
      .union([
        z.boolean(),
        z.object({
          equals: z.boolean().optional(),
          not: z.boolean().optional(),
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
          in: z.array(z.date()).optional(),
          notIn: z.array(z.date()).optional(),
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
          in: z.array(z.date()).optional(),
          notIn: z.array(z.date()).optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    // Relations
    users: z
      .object({
        some: z.any().optional(),
        every: z.any().optional(),
        none: z.any().optional(),
      })
      .optional(),

    remunerations: z
      .object({
        some: z.any().optional(),
        every: z.any().optional(),
        none: z.any().optional(),
      })
      .optional(),
  })
  .partial();

// =====================
// Position Filters and Transform
// =====================

const positionFilters = {
  searchingFor: z.string().optional(),
  hasUsers: z.boolean().optional(),
  remunerationRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

const positionTransform = (data: any) => {
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

  if (data.searchingFor) {
    andConditions.push({
      name: { contains: data.searchingFor, mode: "insensitive" },
    });
    delete data.searchingFor;
  }

  if (data.hasUsers !== undefined) {
    andConditions.push({
      users: data.hasUsers ? { some: {} } : { none: {} },
    });
    delete data.hasUsers;
  }

  if (data.remunerationRange) {
    const remunerationCondition: any = {};
    if (data.remunerationRange.min !== undefined) remunerationCondition.gte = data.remunerationRange.min;
    if (data.remunerationRange.max !== undefined) remunerationCondition.lte = data.remunerationRange.max;
    andConditions.push({ remuneration: remunerationCondition });
    delete data.remunerationRange;
  }

  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

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
// Query Schemas
// =====================

export const positionGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: positionWhereSchema.optional(),
    orderBy: positionOrderBySchema.optional(),
    include: positionIncludeSchema.optional(),

    // Convenience filters
    ...positionFilters,

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
  .transform(positionTransform);

// =====================
// Get By ID Schemas
// =====================

export const positionGetByIdSchema = z.object({
  include: positionIncludeSchema.optional(),
  id: z.string().uuid("Cargo inválido"),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const positionCreateSchema = z
  .object({
    name: createNameSchema(1, 100, "Nome do cargo"),
    hierarchy: z.number().int("Hierarquia deve ser um número inteiro").min(0, "Hierarquia deve ser maior ou igual a zero").max(999, "Hierarquia deve ser menor que 1000").optional().nullable(),
    remuneration: z.number().min(0, "Remuneração deve ser maior ou igual a zero").max(999999.99, "Remuneração deve ser menor que R$ 1.000.000,00"),
    bonifiable: z.boolean().optional(),
  })
  .transform(toFormData);

export const positionUpdateSchema = z
  .object({
    name: createNameSchema(1, 100, "Nome do cargo").optional(),
    hierarchy: z.number().int("Hierarquia deve ser um número inteiro").min(0, "Hierarquia deve ser maior ou igual a zero").max(999, "Hierarquia deve ser menor que 1000").optional().nullable(),
    remuneration: z.number().min(0, "Remuneração deve ser maior ou igual a zero").max(999999.99, "Remuneração deve ser menor que R$ 1.000.000,00").optional(),
    bonifiable: z.boolean().optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const positionBatchCreateSchema = z.object({
  positions: z.array(positionCreateSchema).min(1, "Pelo menos um cargo deve ser fornecido"),
});

export const positionBatchUpdateSchema = z.object({
  positions: z
    .array(
      z.object({
        id: z.string().uuid("Cargo inválido"),
        data: positionUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const positionBatchDeleteSchema = z.object({
  positionIds: z.array(z.string().uuid("Cargo inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const positionQuerySchema = z.object({
  include: positionIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

// Position types
export type PositionGetManyFormData = z.infer<typeof positionGetManySchema>;
export type PositionGetByIdFormData = z.infer<typeof positionGetByIdSchema>;
export type PositionQueryFormData = z.infer<typeof positionQuerySchema>;

export type PositionCreateFormData = z.infer<typeof positionCreateSchema>;
export type PositionUpdateFormData = z.infer<typeof positionUpdateSchema>;

export type PositionBatchCreateFormData = z.infer<typeof positionBatchCreateSchema>;
export type PositionBatchUpdateFormData = z.infer<typeof positionBatchUpdateSchema>;
export type PositionBatchDeleteFormData = z.infer<typeof positionBatchDeleteSchema>;

export type PositionInclude = z.infer<typeof positionIncludeSchema>;
export type PositionOrderBy = z.infer<typeof positionOrderBySchema>;
export type PositionWhere = z.infer<typeof positionWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapPositionToFormData = createMapToFormDataHelper<Position, PositionUpdateFormData>((position) => ({
  name: position.name,
  hierarchy: position.hierarchy,
  remuneration: position.remuneration,
  bonifiable: position.bonifiable,
}));
