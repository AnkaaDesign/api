// packages/schemas/src/observation.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from "./common";
import type { Observation } from '@types';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const observationIncludeSchema = z
  .object({
    // Direct Observation relations
    files: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              tasksArtworks: z.boolean().optional(),
              customerLogo: z.boolean().optional(),
              taskBudget: z.boolean().optional(),
              taskNfe: z.boolean().optional(),
              supplierLogo: z.boolean().optional(),
              orderNfe: z.boolean().optional(),
              orderBudget: z.boolean().optional(),
              observations: z.boolean().optional(),
              reprimand: z.boolean().optional(),
              airbrushingReceipts: z.boolean().optional(),
              airbrushingInvoices: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
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
  })
  .partial();

// =====================
// OrderBy Schema Based on Prisma Schema Fields
// =====================

export const observationOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        // Observation direct fields (matching Prisma model)
        id: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        reason: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),

        // Nested relation ordering
        task: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            status: orderByDirectionSchema.optional(),
            entryDate: orderByDirectionSchema.optional(),
            term: orderByDirectionSchema.optional(),
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
          taskId: orderByDirectionSchema.optional(),
          reason: orderByDirectionSchema.optional(),
          description: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
          task: z
            .object({
              id: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
              status: orderByDirectionSchema.optional(),
              entryDate: orderByDirectionSchema.optional(),
              term: orderByDirectionSchema.optional(),
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

export const observationWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([observationWhereSchema, z.array(observationWhereSchema)]).optional(),
      OR: z.array(observationWhereSchema).optional(),
      NOT: z.union([observationWhereSchema, z.array(observationWhereSchema)]).optional(),

      // Observation fields
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

      taskId: z
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

      reason: z
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

      description: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
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

      updatedAt: z
        .object({
          equals: z.date().optional(),
          gte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          lt: z.coerce.date().optional(),
        })
        .optional(),

      // Relation filters
      task: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      files: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .strict(),
);

// =====================
// Query Filters
// =====================

const observationFilters = {
  searchingFor: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
  hasFiles: z.boolean().optional(),
  descriptionContains: z.string().optional(),
};

// =====================
// Transform Function
// =====================

const observationTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const { searchingFor, taskIds, hasFiles, descriptionContains, ...rest } = data;

  const andConditions: any[] = [];

  if (searchingFor) {
    andConditions.push({
      OR: [
        { description: { contains: searchingFor, mode: "insensitive" } },
        { task: { name: { contains: searchingFor, mode: "insensitive" } } },
        { task: { serialNumber: { contains: searchingFor, mode: "insensitive" } } },
      ],
    });
  }

  if (taskIds) {
    andConditions.push({ taskId: { in: taskIds } });
  }

  if (hasFiles !== undefined) {
    andConditions.push({
      files: hasFiles ? { some: {} } : { none: {} },
    });
  }

  if (descriptionContains) {
    andConditions.push({
      description: { contains: descriptionContains, mode: "insensitive" },
    });
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

export const observationGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: observationWhereSchema.optional(),
    orderBy: observationOrderBySchema.optional(),
    include: observationIncludeSchema.optional(),

    // Convenience filters
    ...observationFilters,

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
  .transform(observationTransform);

// =====================
// Additional Query Schemas
// =====================

export const observationGetByIdSchema = z.object({
  include: observationIncludeSchema.optional(),
  id: z.string().uuid("Observação inválida"),
});

// =====================
// Transform for Create/Update Schemas
// =====================

const toFormData = <T>(data: T) => data;

// =====================
// CRUD Schemas
// =====================

export const observationCreateSchema = z
  .object({
    reason: z.string().min(1, "Motivo é obrigatório"),
    description: z.string().min(1, "Descrição é obrigatória"),
    taskId: z.string().uuid("Tarefa inválida"),
    fileIds: z.array(z.string().uuid("Arquivo inválido")).optional(),
  })
  .transform(toFormData);

export const observationUpdateSchema = z
  .object({
    reason: z.string().optional(),
    description: z.string().min(1, "Descrição é obrigatória").optional(),
    taskId: z.string().uuid("Tarefa inválida").optional(),
    fileIds: z.array(z.string().uuid("Arquivo inválido")).optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const observationBatchCreateSchema = z.object({
  observations: z.array(observationCreateSchema).min(1, "Pelo menos uma observação deve ser fornecida"),
});

export const observationBatchUpdateSchema = z.object({
  observations: z
    .array(
      z.object({
        id: z.string().uuid("Observação inválida"),
        data: observationUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma observação deve ser fornecida"),
});

export const observationBatchDeleteSchema = z.object({
  observationIds: z.array(z.string().uuid("Observação inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const observationQuerySchema = z.object({
  include: observationIncludeSchema.optional(),
});

// =====================
// Type Inference
// =====================

export type ObservationGetManyFormData = z.infer<typeof observationGetManySchema>;
export type ObservationGetByIdFormData = z.infer<typeof observationGetByIdSchema>;
export type ObservationQueryFormData = z.infer<typeof observationQuerySchema>;

export type ObservationCreateFormData = z.infer<typeof observationCreateSchema>;
export type ObservationUpdateFormData = z.infer<typeof observationUpdateSchema>;

export type ObservationBatchCreateFormData = z.infer<typeof observationBatchCreateSchema>;
export type ObservationBatchUpdateFormData = z.infer<typeof observationBatchUpdateSchema>;
export type ObservationBatchDeleteFormData = z.infer<typeof observationBatchDeleteSchema>;

export type ObservationInclude = z.infer<typeof observationIncludeSchema>;
export type ObservationOrderBy = z.infer<typeof observationOrderBySchema>;
export type ObservationWhere = z.infer<typeof observationWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapObservationToFormData = createMapToFormDataHelper<Observation, ObservationUpdateFormData>((observation) => ({
  reason: observation.reason,
  description: observation.description,
  taskId: observation.taskId,
  fileIds: observation.files?.map((file) => file.id),
}));
