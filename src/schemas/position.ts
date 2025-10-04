// packages/schemas/src/position.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, createNameSchema } from "./common";
import type { Position, PositionRemuneration } from '@types';

// =====================
// Include Schemas (Second Level Only)
// =====================

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
          include: z
            .object({
              position: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

export const positionRemunerationIncludeSchema = z
  .object({
    position: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              users: z.boolean().optional(),
              remunerations: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schemas
// =====================

export const positionOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
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
        remuneration: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

export const positionRemunerationOrderBySchema = z.union([
  z
    .object({
      id: orderByDirectionSchema.optional(),
      value: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
      position: positionOrderBySchema.optional(),
    })
    .partial(),
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        value: orderByDirectionSchema.optional(),
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

// PositionRemuneration Where Schema
export const positionRemunerationWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.union([z.lazy(() => positionRemunerationWhereSchema), z.array(z.lazy(() => positionRemunerationWhereSchema))]).optional(),
    OR: z.array(z.lazy(() => positionRemunerationWhereSchema)).optional(),
    NOT: z.lazy(() => positionRemunerationWhereSchema).optional(),

    id: z
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
        }),
      ])
      .optional(),

    value: z
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

    positionId: z
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
    position: z.lazy(() => positionWhereSchema).optional(),
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

export const positionRemunerationGetByIdSchema = z.object({
  include: positionRemunerationIncludeSchema.optional(),
  id: z.string().uuid("Remuneração inválida"),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const positionCreateSchema = z
  .object({
    name: createNameSchema(1, 100, "Nome do cargo"),
    remuneration: z.number().min(0, "Remuneração deve ser maior ou igual a zero").max(999999.99, "Remuneração deve ser menor que R$ 1.000.000,00"),
    bonifiable: z.boolean().optional(),
  })
  .transform(toFormData);

export const positionUpdateSchema = z
  .object({
    name: createNameSchema(1, 100, "Nome do cargo").optional(),
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
// Position Remuneration Schemas
// =====================

const positionRemunerationFilters = {
  searchingFor: z.string().optional(),
  positionIds: z.array(z.string()).optional(),
  valueRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

const positionRemunerationTransform = (data: any) => {
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
      position: { name: { contains: data.searchingFor, mode: "insensitive" } },
    });
    delete data.searchingFor;
  }

  if (data.positionIds) {
    andConditions.push({ positionId: { in: data.positionIds } });
    delete data.positionIds;
  }

  if (data.valueRange) {
    const valueCondition: any = {};
    if (data.valueRange.min !== undefined) valueCondition.gte = data.valueRange.min;
    if (data.valueRange.max !== undefined) valueCondition.lte = data.valueRange.max;
    andConditions.push({ value: valueCondition });
    delete data.valueRange;
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

export const positionRemunerationGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    where: positionRemunerationWhereSchema.optional(),
    orderBy: positionRemunerationOrderBySchema.optional(),
    include: positionRemunerationIncludeSchema.optional(),
    ...positionRemunerationFilters,
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
  .transform(positionRemunerationTransform);

export const positionRemunerationCreateSchema = z
  .object({
    value: z.number().min(0, "Valor deve ser maior ou igual a zero").max(999999.99, "Valor deve ser menor que R$ 1.000.000,00"),
    positionId: z.string().uuid("Cargo inválido"),
  })
  .transform(toFormData);

export const positionRemunerationUpdateSchema = z
  .object({
    value: z.number().min(0, "Valor deve ser maior ou igual a zero").max(999999.99, "Valor deve ser menor que R$ 1.000.000,00").optional(),
    positionId: z.string().uuid("Cargo inválido").optional(),
  })
  .transform(toFormData);

export const positionRemunerationBatchCreateSchema = z.object({
  positionRemunerations: z.array(positionRemunerationCreateSchema).min(1, "Pelo menos uma remuneração de cargo deve ser fornecida"),
});

export const positionRemunerationBatchUpdateSchema = z.object({
  positionRemunerations: z
    .array(
      z.object({
        id: z.string().uuid("Remuneração inválida"),
        data: positionRemunerationUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const positionRemunerationBatchDeleteSchema = z.object({
  positionRemunerationIds: z.array(z.string().uuid("Remuneração inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const positionRemunerationQuerySchema = z.object({
  include: positionRemunerationIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const positionRemunerationBatchQuerySchema = z.object({
  include: positionRemunerationIncludeSchema.optional(),
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

// Position Remuneration types
export type PositionRemunerationGetManyFormData = z.infer<typeof positionRemunerationGetManySchema>;
export type PositionRemunerationGetByIdFormData = z.infer<typeof positionRemunerationGetByIdSchema>;
export type PositionRemunerationQueryFormData = z.infer<typeof positionRemunerationQuerySchema>;
export type PositionRemunerationBatchQueryFormData = z.infer<typeof positionRemunerationBatchQuerySchema>;

export type PositionRemunerationCreateFormData = z.infer<typeof positionRemunerationCreateSchema>;
export type PositionRemunerationUpdateFormData = z.infer<typeof positionRemunerationUpdateSchema>;

export type PositionRemunerationBatchCreateFormData = z.infer<typeof positionRemunerationBatchCreateSchema>;
export type PositionRemunerationBatchUpdateFormData = z.infer<typeof positionRemunerationBatchUpdateSchema>;
export type PositionRemunerationBatchDeleteFormData = z.infer<typeof positionRemunerationBatchDeleteSchema>;

export type PositionRemunerationInclude = z.infer<typeof positionRemunerationIncludeSchema>;
export type PositionRemunerationOrderBy = z.infer<typeof positionRemunerationOrderBySchema>;
export type PositionRemunerationWhere = z.infer<typeof positionRemunerationWhereSchema>;

// Include and other types

// =====================
// Helper Functions
// =====================

export const mapPositionToFormData = createMapToFormDataHelper<Position, PositionUpdateFormData>((position) => ({
  name: position.name,
  remuneration: position.remuneration,
  bonifiable: position.bonifiable,
}));

export const mapPositionRemunerationToFormData = createMapToFormDataHelper<PositionRemuneration, PositionRemunerationUpdateFormData>((remuneration) => ({
  value: remuneration.value,
  positionId: remuneration.positionId,
}));
