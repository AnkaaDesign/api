// packages/schemas/src/sector.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from "./common";
import type { Sector } from '@types';
import { SECTOR_PRIVILEGES } from '@constants';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const sectorIncludeSchema = z
  .object({
    // Direct Sector relations
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
            })
            .optional(),
        }),
      ])
      .optional(),
    tasks: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              customer: z.boolean().optional(),
              budget: z.boolean().optional(),
              nfe: z.boolean().optional(),
              receipt: z.boolean().optional(),
              observation: z.boolean().optional(),
              generalPainting: z.boolean().optional(),
              createdBy: z.boolean().optional(),
              files: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              commissions: z.boolean().optional(),
              services: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
              truck: z.boolean().optional(),
              relatedTasks: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .optional();

// =====================
// Order By Schema
// =====================

export const sectorOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      privileges: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          privileges: orderByDirectionSchema.optional(),
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

export const sectorWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(sectorWhereSchema).optional(),
      OR: z.array(sectorWhereSchema).optional(),
      NOT: sectorWhereSchema.optional(),

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
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      // String enum field
      privileges: z
        .union([
          z.enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
            errorMap: () => ({ message: "privilégio inválido" }),
          }),
          z.object({
            equals: z
              .enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
                errorMap: () => ({ message: "privilégio inválido" }),
              })
              .optional(),
            not: z
              .enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
                errorMap: () => ({ message: "privilégio inválido" }),
              })
              .optional(),
            in: z
              .array(
                z.enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
                  errorMap: () => ({ message: "privilégio inválido" }),
                }),
              )
              .optional(),
            notIn: z
              .array(
                z.enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
                  errorMap: () => ({ message: "privilégio inválido" }),
                }),
              )
              .optional(),
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
      users: z
        .object({
          some: z.object({}).optional(),
          every: z.object({}).optional(),
          none: z.object({}).optional(),
        })
        .optional(),

      tasks: z
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

const sectorFilters = {
  searchingFor: z.string().optional(),
  privilege: z
    .enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
      errorMap: () => ({ message: "privilégio inválido" }),
    })
    .optional(),
  hasUsers: z.boolean().optional(),
};

// =====================
// Transform Function
// =====================

const sectorTransform = (data: any): any => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const { searchingFor, privilege, hasUsers } = data;

  const andConditions: any[] = [];

  if (searchingFor) {
    andConditions.push({
      OR: [{ name: { contains: searchingFor, mode: "insensitive" } }],
    });
  }

  if (privilege) {
    andConditions.push({
      privileges: privilege,
    });
  }

  if (hasUsers !== undefined) {
    andConditions.push(hasUsers ? { users: { some: {} } } : { users: { none: {} } });
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
// Query Schema
// =====================

export const sectorGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: sectorWhereSchema.optional(),
    orderBy: sectorOrderBySchema.optional(),
    include: sectorIncludeSchema.optional(),

    // Convenience filters
    ...sectorFilters,

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
  .transform(sectorTransform);

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const sectorCreateSchema = z
  .object({
    name: z
      .string({
        required_error: "Nome do setor é obrigatório",
        invalid_type_error: "Nome do setor inválido",
      })
      .min(2, "Nome do setor deve ter pelo menos 2 caracteres")
      .max(100, "Nome do setor deve ter no máximo 100 caracteres"),
    privileges: z
      .enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
        errorMap: () => ({ message: "privilégio inválido" }),
      })
      .default(SECTOR_PRIVILEGES.BASIC),
  })
  .transform(toFormData);

export const sectorUpdateSchema = z
  .object({
    name: z
      .string({
        invalid_type_error: "Nome do setor inválido",
      })
      .min(2, "Nome do setor deve ter pelo menos 2 caracteres")
      .max(100, "Nome do setor deve ter no máximo 100 caracteres")
      .optional(),
    privileges: z
      .enum(Object.values(SECTOR_PRIVILEGES) as [string, ...string[]], {
        errorMap: () => ({ message: "privilégio inválido" }),
      })
      .optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const sectorBatchCreateSchema = z.object({
  sectors: z.array(sectorCreateSchema).min(1, "Pelo menos um setor deve ser fornecido"),
});

export const sectorBatchUpdateSchema = z.object({
  sectors: z
    .array(
      z.object({
        id: z.string().uuid("Setor inválido"),
        data: sectorUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um setor deve ser fornecido"),
});

export const sectorBatchDeleteSchema = z.object({
  sectorIds: z.array(z.string().uuid("Setor inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const sectorQuerySchema = z.object({
  include: sectorIncludeSchema.optional(),
});

export const sectorGetByIdSchema = z.object({
  include: sectorIncludeSchema.optional(),
  id: z.string().uuid("Setor inválido"),
});

// =====================
// Inferred Types (for internal use only)
// =====================

// Note: FormData types are defined in @ankaa/types as the single source of truth
export type SectorGetManyFormData = z.infer<typeof sectorGetManySchema>;
export type SectorGetByIdFormData = z.infer<typeof sectorGetByIdSchema>;
export type SectorCreateFormData = z.infer<typeof sectorCreateSchema>;
export type SectorUpdateFormData = z.infer<typeof sectorUpdateSchema>;
export type SectorBatchCreateFormData = z.infer<typeof sectorBatchCreateSchema>;
export type SectorBatchUpdateFormData = z.infer<typeof sectorBatchUpdateSchema>;
export type SectorBatchDeleteFormData = z.infer<typeof sectorBatchDeleteSchema>;
export type SectorQueryFormData = z.infer<typeof sectorQuerySchema>;

export type SectorInclude = z.infer<typeof sectorIncludeSchema>;
export type SectorOrderBy = z.infer<typeof sectorOrderBySchema>;
export type SectorWhere = z.infer<typeof sectorWhereSchema>;

export const mapSectorToFormData = createMapToFormDataHelper<Sector, SectorUpdateFormData>((sector) => ({
  privileges: sector.privileges,
  name: sector.name,
}));
