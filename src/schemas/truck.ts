// packages/schemas/src/truck.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, createNameSchema } from "./common";
import type { Truck } from '@types';
import { TRUCK_MANUFACTURER } from '@constants';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const truckIncludeSchema = z
  .object({
    // Direct Truck relations
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
              receipt: z.boolean().optional(),
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
    garage: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              lanes: z.boolean().optional(),
              trucks: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    leftSideLayout: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              photo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    rightSideLayout: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              photo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    backSideLayout: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              photo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

// =====================
// OrderBy Schema Based on Prisma Schema Fields
// =====================

export const truckOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      // Truck direct fields
      id: orderByDirectionSchema.optional(),
      plate: orderByDirectionSchema.optional(),
      model: orderByDirectionSchema.optional(),
      manufacturer: orderByDirectionSchema.optional(),
      xPosition: orderByDirectionSchema.optional(),
      yPosition: orderByDirectionSchema.optional(),
      taskId: orderByDirectionSchema.optional(),
      garageId: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering - Task
      task: z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
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

      // Nested relation ordering - Garage
      garage: z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          width: orderByDirectionSchema.optional(),
          length: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .optional(),
    })
    .partial(),

  // Array of ordering objects
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        plate: orderByDirectionSchema.optional(),
        model: orderByDirectionSchema.optional(),
        manufacturer: orderByDirectionSchema.optional(),
        xPosition: orderByDirectionSchema.optional(),
        yPosition: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        garageId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// Where Schema Based on Prisma Schema
// =====================

export const truckWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([truckWhereSchema, z.array(truckWhereSchema)]).optional(),
      OR: z.array(truckWhereSchema).optional(),
      NOT: z.union([truckWhereSchema, z.array(truckWhereSchema)]).optional(),

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

      garageId: z
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

      // String fields
      plate: z
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

      model: z
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

      // Enum fields
      manufacturer: z
        .union([
          z.nativeEnum(TRUCK_MANUFACTURER),
          z.object({
            equals: z.nativeEnum(TRUCK_MANUFACTURER).optional(),
            not: z.nativeEnum(TRUCK_MANUFACTURER).optional(),
            in: z.array(z.nativeEnum(TRUCK_MANUFACTURER)).optional(),
            notIn: z.array(z.nativeEnum(TRUCK_MANUFACTURER)).optional(),
          }),
        ])
        .optional(),

      // Numeric fields
      xPosition: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

      yPosition: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

      // Date timestamp fields
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
      task: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      garage: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const truckFilters = {
  // Search and filtering
  searchingFor: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
  garageIds: z.array(z.string()).optional(),
  manufacturers: z.array(z.nativeEnum(TRUCK_MANUFACTURER)).optional(),
  plates: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  hasGarage: z.boolean().optional(),
  hasPosition: z.boolean().optional(),
  isParked: z.boolean().optional(),

  // Position ranges
  xPositionRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  yPositionRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

// =====================
// Transform Function
// =====================

const truckTransform = (data: any) => {
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

  // Handle searchingFor
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    andConditions.push({
      OR: [
        { plate: { contains: data.searchingFor.trim(), mode: "insensitive" } },
        { model: { contains: data.searchingFor.trim(), mode: "insensitive" } },
        { task: { name: { contains: data.searchingFor.trim(), mode: "insensitive" } } },
        { task: { serialNumber: { contains: data.searchingFor.trim(), mode: "insensitive" } } },
        { garage: { name: { contains: data.searchingFor.trim(), mode: "insensitive" } } },
        { task: { customer: { fantasyName: { contains: data.searchingFor.trim(), mode: "insensitive" } } } },
        { task: { customer: { corporateName: { contains: data.searchingFor.trim(), mode: "insensitive" } } } },
      ],
    });
    delete data.searchingFor;
  }

  // Handle taskIds filter
  if (data.taskIds && Array.isArray(data.taskIds) && data.taskIds.length > 0) {
    andConditions.push({ taskId: { in: data.taskIds } });
    delete data.taskIds;
  }

  // Handle garageIds filter
  if (data.garageIds && Array.isArray(data.garageIds) && data.garageIds.length > 0) {
    andConditions.push({ garageId: { in: data.garageIds } });
    delete data.garageIds;
  }

  // Handle manufacturers filter
  if (data.manufacturers && Array.isArray(data.manufacturers) && data.manufacturers.length > 0) {
    andConditions.push({ manufacturer: { in: data.manufacturers } });
    delete data.manufacturers;
  }

  // Handle plates filter
  if (data.plates && Array.isArray(data.plates) && data.plates.length > 0) {
    andConditions.push({ plate: { in: data.plates } });
    delete data.plates;
  }

  // Handle models filter
  if (data.models && Array.isArray(data.models) && data.models.length > 0) {
    andConditions.push({ model: { in: data.models } });
    delete data.models;
  }

  // Handle hasGarage filter
  if (typeof data.hasGarage === "boolean") {
    if (data.hasGarage) {
      andConditions.push({ garageId: { not: null } });
    } else {
      andConditions.push({ garageId: null });
    }
    delete data.hasGarage;
  }

  // Handle hasPosition filter
  if (typeof data.hasPosition === "boolean") {
    if (data.hasPosition) {
      andConditions.push({
        AND: [{ xPosition: { not: null } }, { yPosition: { not: null } }],
      });
    } else {
      andConditions.push({
        OR: [{ xPosition: null }, { yPosition: null }],
      });
    }
    delete data.hasPosition;
  }

  // Handle isParked filter
  if (typeof data.isParked === "boolean") {
    if (data.isParked) {
      andConditions.push({
        AND: [{ garageId: { not: null } }, { xPosition: { not: null } }, { yPosition: { not: null } }],
      });
    } else {
      andConditions.push({
        OR: [{ garageId: null }, { xPosition: null }, { yPosition: null }],
      });
    }
    delete data.isParked;
  }


  // Handle position ranges
  if (data.xPositionRange && typeof data.xPositionRange === "object") {
    const condition: any = {};
    if (typeof data.xPositionRange.min === "number") condition.gte = data.xPositionRange.min;
    if (typeof data.xPositionRange.max === "number") condition.lte = data.xPositionRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ xPosition: condition });
    }
    delete data.xPositionRange;
  }

  if (data.yPositionRange && typeof data.yPositionRange === "object") {
    const condition: any = {};
    if (typeof data.yPositionRange.min === "number") condition.gte = data.yPositionRange.min;
    if (typeof data.yPositionRange.max === "number") condition.lte = data.yPositionRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ yPosition: condition });
    }
    delete data.yPositionRange;
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
// Query Schema
// =====================

export const truckGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses with proper validation
    where: truckWhereSchema.optional(),
    orderBy: truckOrderBySchema.optional(),
    include: truckIncludeSchema.optional(),

    // Date filters (handled by where schema)
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

    // Convenience filters (will be transformed to where)
    ...truckFilters,
  })
  .transform(truckTransform);

// Brazilian license plate pattern (ABC-1234 or ABC1234)
const brazilianPlateRegex = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$|^[A-Z]{3}-?[0-9]{4}$/i;

// =====================
// CRUD Schemas
// =====================

export const truckCreateSchema = z.object({
  // Required identification fields
  plate: z
    .string()
    .min(1, "Placa é obrigatória")
    .max(8, "Placa deve ter no máximo 8 caracteres")
    .transform((val) => val.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .refine((val) => brazilianPlateRegex.test(val), "Formato de placa inválido (ex: ABC1234 ou ABC-1234)"),

  model: createNameSchema(1, 100, "Modelo"),

  manufacturer: z.enum(Object.values(TRUCK_MANUFACTURER) as [string, ...string[]], {
    errorMap: () => ({ message: "Montadora inválida" }),
  }),

  // Optional position fields
  xPosition: z.number().nullable().optional(),
  yPosition: z.number().nullable().optional(),

  // Required relation
  taskId: z.string().uuid("Tarefa inválida"),

  // Optional relations
  garageId: z.string().uuid("Garagem inválida").nullable().optional(),
  leftSideLayoutId: z.string().uuid("Layout inválido").nullable().optional(),
  rightSideLayoutId: z.string().uuid("Layout inválido").nullable().optional(),
  backSideLayoutId: z.string().uuid("Layout inválido").nullable().optional(),
});

export const truckUpdateSchema = z.object({
  // Optional identification fields
  plate: z
    .string()
    .min(1, "Placa é obrigatória")
    .max(8, "Placa deve ter no máximo 8 caracteres")
    .transform((val) => val.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .refine((val) => brazilianPlateRegex.test(val), "Formato de placa inválido (ex: ABC1234 ou ABC-1234)")
    .optional(),

  model: createNameSchema(1, 100, "Modelo").optional(),

  manufacturer: z
    .enum(Object.values(TRUCK_MANUFACTURER) as [string, ...string[]], {
      errorMap: () => ({ message: "Montadora inválida" }),
    })
    .optional(),

  // Optional position fields
  xPosition: z.number().nullable().optional(),
  yPosition: z.number().nullable().optional(),

  // Optional relations
  taskId: z.string().uuid("Tarefa inválida").optional(),
  garageId: z.string().uuid("Garagem inválida").nullable().optional(),
  leftSideLayoutId: z.string().uuid("Layout inválido").nullable().optional(),
  rightSideLayoutId: z.string().uuid("Layout inválido").nullable().optional(),
  backSideLayoutId: z.string().uuid("Layout inválido").nullable().optional(),
});

// =====================
// Batch Operations Schemas
// =====================

export const truckBatchCreateSchema = z.object({
  trucks: z.array(truckCreateSchema).min(1, "Pelo menos um caminhão deve ser fornecido"),
});

export const truckBatchUpdateSchema = z.object({
  trucks: z
    .array(
      z.object({
        id: z.string().uuid("Caminhão inválido"),
        data: truckUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um caminhão deve ser fornecido"),
});

export const truckBatchDeleteSchema = z.object({
  truckIds: z.array(z.string().uuid("Caminhão inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const truckQuerySchema = z.object({
  include: truckIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const truckBatchQuerySchema = z.object({
  include: truckIncludeSchema.optional(),
});

// =====================
// Additional Query Schemas
// =====================

export const truckGetByIdSchema = z.object({
  include: truckIncludeSchema.optional(),
  id: z.string().uuid("Caminhão inválido"),
});

// =====================
// Type Inference
// =====================

export type TruckGetManyFormData = z.infer<typeof truckGetManySchema>;
export type TruckGetByIdFormData = z.infer<typeof truckGetByIdSchema>;
export type TruckCreateFormData = z.infer<typeof truckCreateSchema>;
export type TruckUpdateFormData = z.infer<typeof truckUpdateSchema>;
export type TruckBatchCreateFormData = z.infer<typeof truckBatchCreateSchema>;
export type TruckBatchUpdateFormData = z.infer<typeof truckBatchUpdateSchema>;
export type TruckBatchDeleteFormData = z.infer<typeof truckBatchDeleteSchema>;

export type TruckInclude = z.infer<typeof truckIncludeSchema>;
export type TruckOrderBy = z.infer<typeof truckOrderBySchema>;
export type TruckWhere = z.infer<typeof truckWhereSchema>;

export type TruckQueryFormData = z.infer<typeof truckQuerySchema>;
export type TruckBatchQueryFormData = z.infer<typeof truckBatchQuerySchema>;

// =====================
// Helper Functions
// =====================

export const mapTruckToFormData = createMapToFormDataHelper<Truck, TruckUpdateFormData>((truck) => ({
  plate: truck.plate,
  model: truck.model,
  manufacturer: truck.manufacturer,
  xPosition: truck.xPosition || undefined,
  yPosition: truck.yPosition || undefined,
  taskId: truck.taskId,
  garageId: truck.garageId || undefined,
  leftSideLayoutId: truck.leftSideLayoutId || undefined,
  rightSideLayoutId: truck.rightSideLayoutId || undefined,
  backSideLayoutId: truck.backSideLayoutId || undefined,
}));
