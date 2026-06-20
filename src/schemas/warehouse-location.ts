// packages/schemas/src/warehouse-location.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
} from './common';
import type { WarehouseLocation } from '@types';
import { WAREHOUSE_LOCATION_TYPE } from '@constants';

// =====================
// Field helpers
// =====================

const typeSchema = z.nativeEnum(WAREHOUSE_LOCATION_TYPE);

const gridCountSchema = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} deve ser um número` })
    .int(`${label} deve ser um número inteiro`)
    .min(1, `${label} deve ser no mínimo 1`)
    .max(100, `${label} deve ser no máximo 100`);

const coordSchema = z.coerce.number();

const nameSchema = z
  .string({ required_error: 'Nome é obrigatório' })
  .trim()
  .min(1, 'Nome é obrigatório')
  .max(200, 'Nome deve ter no máximo 200 caracteres');

const optionalTextSchema = (max: number, label: string) =>
  z.preprocess(
    val => (val === '' || val === null || val === undefined ? null : val),
    z
      .string()
      .trim()
      .max(max, `${label} deve ter no máximo ${max} caracteres`)
      .nullable()
      .optional(),
  );

// =====================
// Include Schema
// =====================

export const warehouseLocationIncludeSchema = z
  .object({
    items: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brands: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              prices: z.boolean().optional(),
              measures: z.boolean().optional(),
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
              items: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .optional();

// =====================
// OrderBy Schema
// =====================

export const warehouseLocationOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        type: orderByDirectionSchema.optional(),
        section: orderByDirectionSchema.optional(),
        code: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        levels: orderByDirectionSchema.optional(),
        columns: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        _count: z
          .object({
            items: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          section: orderByDirectionSchema.optional(),
          code: orderByDirectionSchema.optional(),
          isActive: orderByDirectionSchema.optional(),
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

export const warehouseLocationWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z
        .union([warehouseLocationWhereSchema, z.array(warehouseLocationWhereSchema)])
        .optional(),
      OR: z.array(warehouseLocationWhereSchema).optional(),
      NOT: z
        .union([warehouseLocationWhereSchema, z.array(warehouseLocationWhereSchema)])
        .optional(),

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
      name: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),
      section: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),
      code: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
          }),
        ])
        .optional(),
      isActive: z.boolean().optional(),
      createdAt: z
        .object({
          gte: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          lt: z.coerce.date().optional(),
        })
        .optional(),
      updatedAt: z
        .object({
          gte: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          lt: z.coerce.date().optional(),
        })
        .optional(),
      items: z
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
// Transform (convenience filters -> where)
// =====================

const warehouseLocationTransform = (data: any): any => {
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

  // searchingFor - search in name, section, code, description and item names
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    andConditions.push({
      OR: [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { section: { contains: searchTerm, mode: 'insensitive' } },
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { items: { some: { name: { contains: searchTerm, mode: 'insensitive' } } } },
      ],
    });
    delete data.searchingFor;
  }

  // isActive convenience filter
  if (typeof data.isActive === 'boolean') {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  // sections filter
  if (data.sections && Array.isArray(data.sections) && data.sections.length > 0) {
    andConditions.push({ section: { in: data.sections } });
    delete data.sections;
  }

  // types filter
  if (data.types && Array.isArray(data.types) && data.types.length > 0) {
    andConditions.push({ type: { in: data.types } });
    delete data.types;
  }

  // hasItems filter
  if (typeof data.hasItems === 'boolean') {
    if (data.hasItems) {
      andConditions.push({ items: { some: {} } });
    } else {
      andConditions.push({ items: { none: {} } });
    }
    delete data.hasItems;
  }

  // Date filters
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
// GetMany Schema
// =====================

export const warehouseLocationGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Convenience filter fields
    searchingFor: z.string().optional(),
    isActive: z.boolean().optional(),
    sections: z.array(z.string()).optional(),
    types: z.array(typeSchema).optional(),
    hasItems: z.boolean().optional(),
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

    // Standard query fields
    where: warehouseLocationWhereSchema.optional(),
    orderBy: warehouseLocationOrderBySchema.optional(),
    include: warehouseLocationIncludeSchema.optional(),
  })
  .transform(warehouseLocationTransform);

// =====================
// CRUD Schemas
// =====================

export const warehouseLocationCreateSchema = z.object({
  name: nameSchema,
  type: typeSchema.default(WAREHOUSE_LOCATION_TYPE.ESTANTE).optional(),
  section: optionalTextSchema(100, 'Setor'),
  code: optionalTextSchema(50, 'Código'),
  description: optionalTextSchema(500, 'Descrição'),
  isActive: z.boolean().default(true).optional(),
  // Internal grid
  levels: gridCountSchema('Níveis').default(1).optional(),
  columns: gridCountSchema('Colunas').default(1).optional(),
  columnsPerLevel: z.array(z.coerce.number().int().min(1).max(100)).optional(),
  // Map placement (invented on create if omitted)
  positionX: coordSchema.optional(),
  positionY: coordSchema.optional(),
  width: coordSchema.positive().optional(),
  height: coordSchema.positive().optional(),
  rotation: coordSchema.optional(),
});

export const warehouseLocationUpdateSchema = z.object({
  name: nameSchema.optional(),
  type: typeSchema.optional(),
  section: optionalTextSchema(100, 'Setor'),
  code: optionalTextSchema(50, 'Código'),
  description: optionalTextSchema(500, 'Descrição'),
  isActive: z.boolean().optional(),
  levels: gridCountSchema('Níveis').optional(),
  columns: gridCountSchema('Colunas').optional(),
  columnsPerLevel: z.array(z.coerce.number().int().min(1).max(100)).optional(),
  positionX: coordSchema.optional(),
  positionY: coordSchema.optional(),
  width: coordSchema.positive().optional(),
  height: coordSchema.positive().optional(),
  rotation: coordSchema.optional(),
});

export const warehouseLocationBatchCreateSchema = z.object({
  warehouseLocations: z.array(warehouseLocationCreateSchema),
});

export const warehouseLocationBatchUpdateSchema = z.object({
  warehouseLocations: z
    .array(
      z.object({
        id: z.string().uuid('Localização inválida'),
        data: warehouseLocationUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma localização deve ser fornecida'),
});

export const warehouseLocationBatchDeleteSchema = z.object({
  warehouseLocationIds: z
    .array(z.string().uuid('Localização inválida'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const warehouseLocationQuerySchema = z.object({
  include: warehouseLocationIncludeSchema.optional(),
});

export const warehouseLocationGetByIdSchema = z.object({
  include: warehouseLocationIncludeSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

export type WarehouseLocationGetManyFormData = z.infer<typeof warehouseLocationGetManySchema>;
export type WarehouseLocationGetByIdFormData = z.infer<typeof warehouseLocationGetByIdSchema>;
export type WarehouseLocationQueryFormData = z.infer<typeof warehouseLocationQuerySchema>;

export type WarehouseLocationCreateFormData = z.infer<typeof warehouseLocationCreateSchema>;
export type WarehouseLocationUpdateFormData = z.infer<typeof warehouseLocationUpdateSchema>;

export type WarehouseLocationBatchCreateFormData = z.infer<
  typeof warehouseLocationBatchCreateSchema
>;
export type WarehouseLocationBatchUpdateFormData = z.infer<
  typeof warehouseLocationBatchUpdateSchema
>;
export type WarehouseLocationBatchDeleteFormData = z.infer<
  typeof warehouseLocationBatchDeleteSchema
>;

export type WarehouseLocationInclude = z.infer<typeof warehouseLocationIncludeSchema>;
export type WarehouseLocationOrderBy = z.infer<typeof warehouseLocationOrderBySchema>;
export type WarehouseLocationWhere = z.infer<typeof warehouseLocationWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapWarehouseLocationToFormData = createMapToFormDataHelper<
  WarehouseLocation,
  WarehouseLocationUpdateFormData
>(location => ({
  name: location.name,
  type: location.type,
  section: location.section,
  code: location.code,
  description: location.description,
  isActive: location.isActive,
  levels: location.levels,
  columns: location.columns,
  columnsPerLevel: location.columnsPerLevel,
  positionX: location.positionX,
  positionY: location.positionY,
  width: location.width,
  height: location.height,
  rotation: location.rotation,
}));
