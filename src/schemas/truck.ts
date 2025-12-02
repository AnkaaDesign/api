// packages/schemas/src/truck.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  createNameSchema,
} from './common';
import type { Truck } from '@types';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const truckIncludeSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      task: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                sector: z.boolean().optional(),
                customer: z.boolean().optional(),
                budgets: z.boolean().optional(),
                invoices: z.boolean().optional(),
                receipts: z.boolean().optional(),
                observation: z.boolean().optional(),
                generalPainting: z.boolean().optional(),
                createdBy: z.boolean().optional(),
                artworks: z.boolean().optional(),
                logoPaints: z.boolean().optional(),
                services: z.boolean().optional(),
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
                layoutSections: z.boolean().optional(),
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
                layoutSections: z.boolean().optional(),
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
                layoutSections: z.boolean().optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
    })
    .partial(),
);

// =====================
// Order By Schema
// =====================

export const truckOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      plate: orderByDirectionSchema.optional(),
      chassisNumber: orderByDirectionSchema.optional(),
      xPosition: orderByDirectionSchema.optional(),
      yPosition: orderByDirectionSchema.optional(),
      taskId: orderByDirectionSchema.optional(),
      garageId: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        plate: orderByDirectionSchema.optional(),
        chassisNumber: orderByDirectionSchema.optional(),
        xPosition: orderByDirectionSchema.optional(),
        yPosition: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        garageId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const truckWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([truckWhereSchema, z.array(truckWhereSchema)]).optional(),
      OR: z.array(truckWhereSchema).optional(),
      NOT: z.union([truckWhereSchema, z.array(truckWhereSchema)]).optional(),
      id: z
        .union([
          z.string(),
          z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() }),
        ])
        .optional(),
      plate: z
        .union([
          z.string(),
          z.object({
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
          }),
        ])
        .optional(),
      chassisNumber: z
        .union([z.string(), z.object({ contains: z.string().optional() })])
        .optional(),
      xPosition: z
        .union([z.number(), z.object({ gte: z.number().optional(), lte: z.number().optional() })])
        .optional(),
      yPosition: z
        .union([z.number(), z.object({ gte: z.number().optional(), lte: z.number().optional() })])
        .optional(),
      taskId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      garageId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      createdAt: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      updatedAt: z
        .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
        .optional(),
      // Relations
      task: z.any().optional(),
      garage: z.any().optional(),
      leftSideLayout: z.any().optional(),
      rightSideLayout: z.any().optional(),
      backSideLayout: z.any().optional(),
    })
    .strict(),
);

// =====================
// Transform Function
// =====================

const truckTransform = (data: any): any => {
  console.log('[TruckTransform] Input data:', {
    searchingFor: data.searchingFor,
    hasWhere: !!data.where,
    whereKeys: data.where ? Object.keys(data.where) : [],
  });

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

  // Enhanced search filter - search across multiple fields and relations
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    console.log('[TruckTransform] Processing search term:', searchTerm);
    andConditions.push({
      OR: [
        // Direct truck fields
        { plate: { contains: searchTerm, mode: 'insensitive' } },
        { chassisNumber: { contains: searchTerm, mode: 'insensitive' } },
        // Related task
        { task: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { task: { serialNumber: { contains: searchTerm, mode: 'insensitive' } } },
        // Related garage
        { garage: { name: { contains: searchTerm, mode: 'insensitive' } } },
      ],
    });
    delete data.searchingFor;
  }

  // Boolean filters for relations
  if (data.hasTask === true) {
    andConditions.push({ taskId: { not: null } });
    delete data.hasTask;
  } else if (data.hasTask === false) {
    andConditions.push({ taskId: null });
    delete data.hasTask;
  }

  if (data.hasGarage === true) {
    andConditions.push({ garageId: { not: null } });
    delete data.hasGarage;
  } else if (data.hasGarage === false) {
    andConditions.push({ garageId: null });
    delete data.hasGarage;
  }

  // Array filters with "in" operator
  if (data.garageIds && Array.isArray(data.garageIds) && data.garageIds.length > 0) {
    andConditions.push({ garageId: { in: data.garageIds } });
    delete data.garageIds;
  }

  if (data.taskIds && Array.isArray(data.taskIds) && data.taskIds.length > 0) {
    andConditions.push({ taskId: { in: data.taskIds } });
    delete data.taskIds;
  }

  // Date range filters
  if (data.createdAtRange && typeof data.createdAtRange === 'object') {
    const condition: any = {};
    if (data.createdAtRange.from) {
      const fromDate =
        data.createdAtRange.from instanceof Date
          ? data.createdAtRange.from
          : new Date(data.createdAtRange.from);
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.createdAtRange.to) {
      const toDate =
        data.createdAtRange.to instanceof Date
          ? data.createdAtRange.to
          : new Date(data.createdAtRange.to);
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ createdAt: condition });
    }
    delete data.createdAtRange;
  }

  if (data.updatedAtRange && typeof data.updatedAtRange === 'object') {
    const condition: any = {};
    if (data.updatedAtRange.from) {
      const fromDate =
        data.updatedAtRange.from instanceof Date
          ? data.updatedAtRange.from
          : new Date(data.updatedAtRange.from);
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.updatedAtRange.to) {
      const toDate =
        data.updatedAtRange.to instanceof Date
          ? data.updatedAtRange.to
          : new Date(data.updatedAtRange.to);
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ updatedAt: condition });
    }
    delete data.updatedAtRange;
  }

  // Direct date filters
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
    console.log('[TruckTransform] andConditions count:', andConditions.length);
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

  console.log('[TruckTransform] Final output:', {
    hasWhere: !!data.where,
    whereKeys: data.where ? Object.keys(data.where) : [],
    searchingFor: data.searchingFor,
  });

  return data;
};

// =====================
// Query Schema
// =====================

export const truckGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    take: z.coerce.number().int().positive().max(1000).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    searchingFor: z.string().optional(),
    // Boolean relation filters
    hasTask: z.boolean().optional(),
    hasGarage: z.boolean().optional(),
    // Entity ID filters
    garageIds: z.array(z.string()).optional(),
    taskIds: z.array(z.string()).optional(),
    // Date range filters
    createdAtRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    updatedAtRange: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.from && data.to) {
            return data.to >= data.from;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['to'],
        },
      )
      .optional(),
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['lte'],
        },
      )
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        data => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: 'Data final deve ser posterior ou igual à data inicial',
          path: ['lte'],
        },
      )
      .optional(),
    where: truckWhereSchema.optional(),
    orderBy: truckOrderBySchema.optional(),
    include: truckIncludeSchema.optional(),
  })
  .transform(truckTransform);

// =====================
// CRUD Schemas
// =====================

// Create schema
export const truckCreateSchema = z.object({
  // Identification fields
  plate: z
    .string()
    .max(8, 'Placa deve ter no máximo 8 caracteres')
    .transform(val => val.toUpperCase())
    .refine(val => /^[A-Z0-9-]+$/.test(val), {
      message: 'A placa deve conter apenas letras maiúsculas, números e hífens',
    })
    .nullable()
    .optional()
    .transform(val => (val === '' ? null : val)),
  chassisNumber: z
    .string()
    .nullable()
    .optional()
    .transform(val => (val === '' ? null : val)),

  // Position fields
  xPosition: z.number().nullable().optional(),
  yPosition: z.number().nullable().optional(),

  // Relations
  taskId: z.string().uuid('Tarefa inválida'),
  garageId: z.string().uuid('Garagem inválida').nullable().optional(),
  leftSideLayoutId: z.string().uuid('Layout inválido').nullable().optional(),
  rightSideLayoutId: z.string().uuid('Layout inválido').nullable().optional(),
  backSideLayoutId: z.string().uuid('Layout inválido').nullable().optional(),
});

// Update schema
export const truckUpdateSchema = z.object({
  // Identification fields
  plate: z
    .string()
    .max(8, 'Placa deve ter no máximo 8 caracteres')
    .transform(val => val.toUpperCase())
    .refine(val => /^[A-Z0-9-]+$/.test(val), {
      message: 'A placa deve conter apenas letras maiúsculas, números e hífens',
    })
    .nullable()
    .optional()
    .transform(val => (val === '' ? null : val)),
  chassisNumber: z
    .string()
    .nullable()
    .optional()
    .transform(val => (val === '' ? null : val)),

  // Position fields
  xPosition: z.number().nullable().optional(),
  yPosition: z.number().nullable().optional(),

  // Relations
  taskId: z.string().uuid('Tarefa inválida').optional(),
  garageId: z.string().uuid('Garagem inválida').nullable().optional(),
  leftSideLayoutId: z.string().uuid('Layout inválido').nullable().optional(),
  rightSideLayoutId: z.string().uuid('Layout inválido').nullable().optional(),
  backSideLayoutId: z.string().uuid('Layout inválido').nullable().optional(),
});

// =====================
// Batch Operations Schemas
// =====================

export const truckBatchCreateSchema = z.object({
  trucks: z.array(truckCreateSchema).min(1, 'Pelo menos um caminhão deve ser fornecido'),
});

export const truckBatchUpdateSchema = z.object({
  trucks: z
    .array(
      z.object({
        id: z.string().uuid('Caminhão inválido'),
        data: truckUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um caminhão deve ser fornecido'),
});

export const truckBatchDeleteSchema = z.object({
  truckIds: z
    .array(z.string().uuid('Caminhão inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const truckQuerySchema = z.object({
  include: truckIncludeSchema.optional(),
});

// =====================
// GetById Schema
// =====================

export const truckGetByIdSchema = z.object({
  include: truckIncludeSchema.optional(),
  id: z.string().uuid('Caminhão inválido'),
});

// =====================
// Type Inference (FormData types)
// =====================

export type TruckGetManyFormData = z.infer<typeof truckGetManySchema>;
export type TruckGetByIdFormData = z.infer<typeof truckGetByIdSchema>;
export type TruckQueryFormData = z.infer<typeof truckQuerySchema>;

export type TruckCreateFormData = z.infer<typeof truckCreateSchema>;
export type TruckUpdateFormData = z.infer<typeof truckUpdateSchema>;

export type TruckBatchCreateFormData = z.infer<typeof truckBatchCreateSchema>;
export type TruckBatchUpdateFormData = z.infer<typeof truckBatchUpdateSchema>;
export type TruckBatchDeleteFormData = z.infer<typeof truckBatchDeleteSchema>;

export type TruckInclude = z.infer<typeof truckIncludeSchema>;
export type TruckOrderBy = z.infer<typeof truckOrderBySchema>;
export type TruckWhere = z.infer<typeof truckWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapTruckToFormData = createMapToFormDataHelper<Truck, TruckUpdateFormData>(truck => ({
  plate: truck.plate,
  chassisNumber: truck.chassisNumber,
  xPosition: truck.xPosition,
  yPosition: truck.yPosition,
  taskId: truck.taskId,
  garageId: truck.garageId,
  leftSideLayoutId: truck.leftSideLayoutId,
  rightSideLayoutId: truck.rightSideLayoutId,
  backSideLayoutId: truck.backSideLayoutId,
}));

// =====================
// Truck Positioning Schemas
// =====================

// Schema for updating a single truck position
export const truckPositionUpdateSchema = z.object({
  xPosition: z.number().nullable().optional(),
  yPosition: z.number().nullable().optional(),
  garageId: z.string().uuid().nullable().optional(),
});

export type TruckPositionUpdateFormData = z.infer<typeof truckPositionUpdateSchema>;

// Schema for bulk updating truck positions
export const truckBulkPositionUpdateSchema = z.object({
  updates: z.array(
    z.object({
      truckId: z.string().uuid(),
      xPosition: z.number().nullable().optional(),
      yPosition: z.number().nullable().optional(),
      garageId: z.string().uuid().nullable().optional(),
    }),
  ),
});

export type TruckBulkPositionUpdateFormData = z.infer<typeof truckBulkPositionUpdateSchema>;

// Schema for swapping two trucks
export const truckSwapPositionSchema = z.object({
  targetTruckId: z.string().uuid(),
});

export type TruckSwapPositionFormData = z.infer<typeof truckSwapPositionSchema>;
