// packages/schemas/src/measure.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from "./common";
import type { Measure } from '@types';
import { MEASURE_UNIT, MEASURE_TYPE } from '@constants';

// =====================
// Include Schemas
// =====================

export const measureIncludeSchema = z
  .object({
    item: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(), // Avoid circular dependency with Item
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================

export const measureOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        value: orderByDirectionSchema.optional(),
        unit: orderByDirectionSchema.optional(),
        measureType: orderByDirectionSchema.optional(),
        itemId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          value: orderByDirectionSchema.optional(),
          unit: orderByDirectionSchema.optional(),
          measureType: orderByDirectionSchema.optional(),
          itemId: orderByDirectionSchema.optional(),
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

export const measureWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([measureWhereSchema, z.array(measureWhereSchema)]).optional(),
      OR: z.array(measureWhereSchema).optional(),
      NOT: z.union([measureWhereSchema, z.array(measureWhereSchema)]).optional(),

      // Fields
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

      value: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

      unit: z
        .union([
          z.nativeEnum(MEASURE_UNIT),
          z.null(),
          z.object({
            equals: z.union([z.nativeEnum(MEASURE_UNIT), z.null()]).optional(),
            not: z.union([z.nativeEnum(MEASURE_UNIT), z.null()]).optional(),
            in: z.array(z.nativeEnum(MEASURE_UNIT)).optional(),
            notIn: z.array(z.nativeEnum(MEASURE_UNIT)).optional(),
          }),
        ])
        .optional(),

      measureType: z
        .union([
          z.nativeEnum(MEASURE_TYPE),
          z.object({
            equals: z.nativeEnum(MEASURE_TYPE).optional(),
            not: z.nativeEnum(MEASURE_TYPE).optional(),
            in: z.array(z.nativeEnum(MEASURE_TYPE)).optional(),
            notIn: z.array(z.nativeEnum(MEASURE_TYPE)).optional(),
          }),
        ])
        .optional(),

      itemId: z
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
      item: z.any().optional(),
    })
    .partial(),
);

// =====================
// CRUD Schemas
// =====================

// Create schema with validation for SIZE type measures
export const measureCreateSchema = z
  .object({
    value: z.number().positive("Valor da medida deve ser positivo").nullish(),
    unit: z
      .enum(Object.values(MEASURE_UNIT) as [string, ...string[]], {
        errorMap: () => ({ message: "Unidade de medida inválida" }),
      })
      .nullish(),
    measureType: z.enum(Object.values(MEASURE_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: "Tipo de medida inválido" }),
    }),
    itemId: z.string().uuid({ message: "Item inválido" }),
  })
  .refine(
    (data) => {
      // For SIZE type measures (PPE sizes), validate value and unit requirements
      if (data.measureType === MEASURE_TYPE.SIZE) {
        // At least one of value or unit must be provided
        if (!data.value && !data.unit) {
          return false;
        }
        return true;
      }

      // For other measure types, both value and unit are required
      return data.value !== undefined && data.value !== null && data.unit !== undefined && data.unit !== null;
    },
    {
      message: "Para medidas de tamanho (PPE), pelo menos valor OU unidade deve ser fornecido. Para outros tipos, ambos valor e unidade são obrigatórios.",
    },
  );

// Update schema with same validation
export const measureUpdateSchema = z
  .object({
    value: z.number().positive("Valor da medida deve ser positivo").nullish(),
    unit: z
      .enum(Object.values(MEASURE_UNIT) as [string, ...string[]], {
        errorMap: () => ({ message: "Unidade de medida inválida" }),
      })
      .nullish(),
    measureType: z
      .enum(Object.values(MEASURE_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: "Tipo de medida inválido" }),
      })
      .optional(),
    itemId: z.string().uuid({ message: "Item inválido" }).optional(),
  })
  .refine(
    (data) => {
      // If measureType is being updated to SIZE, validate accordingly
      if (data.measureType === MEASURE_TYPE.SIZE) {
        // At least one of value or unit must be provided
        if (!data.value && !data.unit) {
          return false;
        }
        return true;
      }

      // For other measure types, if provided, both value and unit should be provided
      if (data.measureType && data.measureType !== MEASURE_TYPE.SIZE) {
        // If updating measureType to non-SIZE type, ensure both value and unit are provided if either is being updated
        if ((data.value !== undefined && data.value !== null) || (data.unit !== undefined && data.unit !== null)) {
          // If one is provided, both must be provided for non-SIZE types
          if (!(data.value !== undefined && data.value !== null && data.unit !== undefined && data.unit !== null)) {
            return false;
          }
        }
      }

      return true;
    },
    {
      message: "Para medidas de tamanho (PPE), pelo menos valor OU unidade deve ser fornecido. Para outros tipos, ambos valor e unidade são obrigatórios.",
    },
  );

// =====================
// Query Schemas
// =====================

export const measureGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: measureWhereSchema.optional(),
    orderBy: measureOrderBySchema.optional(),
    include: measureIncludeSchema.optional(),

    // Convenience filters
    itemIds: z.array(z.string().uuid()).optional(),
    measureTypes: z.array(z.nativeEnum(MEASURE_TYPE)).optional(),
    units: z.array(z.nativeEnum(MEASURE_UNIT)).optional(),

    valueRange: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .optional(),

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
  .transform((data) => {
    // Normalize orderBy to Prisma format
    if (data.orderBy) {
      data.orderBy = normalizeOrderBy(data.orderBy);
    }

    const andConditions: any[] = [];

    // Handle convenience filters
    if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
      andConditions.push({ itemId: { in: data.itemIds } });
      delete data.itemIds;
    }

    if (data.measureTypes && Array.isArray(data.measureTypes) && data.measureTypes.length > 0) {
      andConditions.push({ measureType: { in: data.measureTypes } });
      delete data.measureTypes;
    }

    if (data.units && Array.isArray(data.units) && data.units.length > 0) {
      andConditions.push({ unit: { in: data.units } });
      delete data.units;
    }

    if (data.valueRange && typeof data.valueRange === "object") {
      const condition: any = {};
      if (typeof data.valueRange.min === "number") condition.gte = data.valueRange.min;
      if (typeof data.valueRange.max === "number") condition.lte = data.valueRange.max;
      if (Object.keys(condition).length > 0) {
        andConditions.push({ value: condition });
      }
      delete data.valueRange;
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
  });

export const measureGetByIdSchema = z.object({
  include: measureIncludeSchema.optional(),
});

// =====================
// Batch Operations Schemas
// =====================

export const measureBatchCreateSchema = z.object({
  measures: z.array(measureCreateSchema).min(1, "Pelo menos uma medida deve ser fornecida"),
});

export const measureBatchUpdateSchema = z.object({
  measures: z
    .array(
      z.object({
        id: z.string().uuid({ message: "Medida inválida" }),
        data: measureUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const measureBatchDeleteSchema = z.object({
  measureIds: z.array(z.string().uuid({ message: "Medida inválida" })).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const measureQuerySchema = z.object({
  include: measureIncludeSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

export type MeasureGetManyFormData = z.infer<typeof measureGetManySchema>;
export type MeasureGetByIdFormData = z.infer<typeof measureGetByIdSchema>;
export type MeasureQueryFormData = z.infer<typeof measureQuerySchema>;

export type MeasureCreateFormData = z.infer<typeof measureCreateSchema>;
export type MeasureUpdateFormData = z.infer<typeof measureUpdateSchema>;

export type MeasureBatchCreateFormData = z.infer<typeof measureBatchCreateSchema>;
export type MeasureBatchUpdateFormData = z.infer<typeof measureBatchUpdateSchema>;
export type MeasureBatchDeleteFormData = z.infer<typeof measureBatchDeleteSchema>;

export type MeasureInclude = z.infer<typeof measureIncludeSchema>;
export type MeasureOrderBy = z.infer<typeof measureOrderBySchema>;
export type MeasureWhere = z.infer<typeof measureWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapMeasureToFormData = createMapToFormDataHelper<Measure, MeasureUpdateFormData>((measure) => ({
  value: measure.value || undefined,
  unit: measure.unit || undefined,
  measureType: measure.measureType,
  itemId: measure.itemId,
}));
