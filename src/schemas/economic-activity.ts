// packages/schemas/src/economic-activity.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from "./common";
import type { EconomicActivity } from '@types';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const economicActivityIncludeSchema = z
  .object({
    // Direct EconomicActivity relations
    customers: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              logo: z.boolean().optional(),
              tasks: z.boolean().optional(),
              economicActivity: z.boolean().optional(),
              _count: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              customers: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .optional();

// =====================
// Order By Schema
// =====================

export const economicActivityOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      code: orderByDirectionSchema.optional(),
      description: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          code: orderByDirectionSchema.optional(),
          description: orderByDirectionSchema.optional(),
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

export const economicActivityWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(economicActivityWhereSchema).optional(),
      OR: z.array(economicActivityWhereSchema).optional(),
      NOT: economicActivityWhereSchema.optional(),

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
      code: z
        .union([
          z.coerce.string(),
          z.object({
            equals: z.coerce.string().optional(),
            not: z.coerce.string().optional(),
            contains: z.coerce.string().optional(),
            startsWith: z.coerce.string().optional(),
            endsWith: z.coerce.string().optional(),
            in: z.array(z.coerce.string()).optional(),
            notIn: z.array(z.coerce.string()).optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      description: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
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

      // Relation filters
      customers: z
        .object({
          some: z.object({}).optional(),
          every: z.object({}).optional(),
          none: z.object({}).optional(),
        })
        .optional(),
    })
    .optional(),
);

// =====================
// Convenience Filters
// =====================

const economicActivityFilters = {
  searchingFor: z.string().optional(),
  hasCustomers: z.boolean().optional(),
};

// =====================
// Transform Function
// =====================

const economicActivityTransform = (data: any): any => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const { searchingFor, hasCustomers } = data;

  const andConditions: any[] = [];

  if (searchingFor) {
    andConditions.push({
      OR: [
        { code: { contains: searchingFor, mode: "insensitive" } },
        { description: { contains: searchingFor, mode: "insensitive" } },
      ],
    });
  }

  if (hasCustomers !== undefined) {
    andConditions.push(hasCustomers ? { customers: { some: {} } } : { customers: { none: {} } });
  }

  if (andConditions.length > 0) {
    if (data.where) {
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Clean up convenience filter fields
  delete data.searchingFor;
  delete data.hasCustomers;

  return data;
};

// =====================
// Query Schema
// =====================

export const economicActivityGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: economicActivityWhereSchema.optional(),
    orderBy: economicActivityOrderBySchema.optional(),
    include: economicActivityIncludeSchema.optional(),

    // Convenience filters
    ...economicActivityFilters,

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
  .transform(economicActivityTransform);

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const economicActivityCreateSchema = z
  .object({
    code: z
      .string({
        required_error: "Código CNAE é obrigatório",
        invalid_type_error: "Código CNAE inválido",
      })
      .min(1, "Código CNAE é obrigatório")
      .max(20, "Código CNAE deve ter no máximo 20 caracteres"),
    description: z
      .string({
        required_error: "Descrição é obrigatória",
        invalid_type_error: "Descrição inválida",
      })
      .min(1, "Descrição é obrigatória")
      .max(500, "Descrição deve ter no máximo 500 caracteres"),
  })
  .transform(toFormData);

export const economicActivityUpdateSchema = z
  .object({
    code: z
      .string({
        invalid_type_error: "Código CNAE inválido",
      })
      .min(1, "Código CNAE é obrigatório")
      .max(20, "Código CNAE deve ter no máximo 20 caracteres")
      .optional(),
    description: z
      .string({
        invalid_type_error: "Descrição inválida",
      })
      .min(1, "Descrição é obrigatória")
      .max(500, "Descrição deve ter no máximo 500 caracteres")
      .optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const economicActivityBatchCreateSchema = z.object({
  economicActivities: z.array(economicActivityCreateSchema).min(1, "Pelo menos uma atividade econômica deve ser fornecida"),
});

export const economicActivityBatchUpdateSchema = z.object({
  economicActivities: z
    .array(
      z.object({
        id: z.string().uuid("Atividade econômica inválida"),
        data: economicActivityUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atividade econômica deve ser fornecida"),
});

export const economicActivityBatchDeleteSchema = z.object({
  economicActivityIds: z.array(z.string().uuid("Atividade econômica inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const economicActivityQuerySchema = z.object({
  include: economicActivityIncludeSchema.optional(),
});

export const economicActivityGetByIdSchema = z.object({
  include: economicActivityIncludeSchema.optional(),
  id: z.string().uuid("Atividade econômica inválida"),
});

// =====================
// Inferred Types (for internal use only)
// =====================

// Note: FormData types are defined in @types as the single source of truth
export type EconomicActivityGetManyFormData = z.infer<typeof economicActivityGetManySchema>;
export type EconomicActivityGetByIdFormData = z.infer<typeof economicActivityGetByIdSchema>;
export type EconomicActivityCreateFormData = z.infer<typeof economicActivityCreateSchema>;
export type EconomicActivityUpdateFormData = z.infer<typeof economicActivityUpdateSchema>;
export type EconomicActivityBatchCreateFormData = z.infer<typeof economicActivityBatchCreateSchema>;
export type EconomicActivityBatchUpdateFormData = z.infer<typeof economicActivityBatchUpdateSchema>;
export type EconomicActivityBatchDeleteFormData = z.infer<typeof economicActivityBatchDeleteSchema>;
export type EconomicActivityQueryFormData = z.infer<typeof economicActivityQuerySchema>;

export type EconomicActivityInclude = z.infer<typeof economicActivityIncludeSchema>;
export type EconomicActivityOrderBy = z.infer<typeof economicActivityOrderBySchema>;
export type EconomicActivityWhere = z.infer<typeof economicActivityWhereSchema>;

export const mapEconomicActivityToFormData = createMapToFormDataHelper<EconomicActivity, EconomicActivityUpdateFormData>((economicActivity) => ({
  code: economicActivity.code,
  description: economicActivity.description,
}));
