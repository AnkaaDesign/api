// packages/schemas/src/artwork.ts

import { z } from 'zod';
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from './common';
import type { Artwork } from '@types';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const artworkIncludeSchema = z
  .object({
    // Direct Artwork relations
    file: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              artworks: z.boolean().optional(),
              customerLogo: z.boolean().optional(),
              supplierLogo: z.boolean().optional(),
              observations: z.boolean().optional(),
              warning: z.boolean().optional(),
              airbrushingReceipts: z.boolean().optional(),
              airbrushingInvoices: z.boolean().optional(),
              airbrushingArtworks: z.boolean().optional(),
              orderBudgets: z.boolean().optional(),
              orderInvoices: z.boolean().optional(),
              orderReceipts: z.boolean().optional(),
              taskBudgets: z.boolean().optional(),
              taskInvoices: z.boolean().optional(),
              taskReceipts: z.boolean().optional(),
              externalWithdrawalBudgets: z.boolean().optional(),
              externalWithdrawalInvoices: z.boolean().optional(),
              externalWithdrawalReceipts: z.boolean().optional(),
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
              budgets: z.boolean().optional(),
              invoices: z.boolean().optional(),
              receipts: z.boolean().optional(),
              reimbursements: z.boolean().optional(),
              invoiceReimbursements: z.boolean().optional(),
              baseFiles: z.boolean().optional(),
              observation: z.boolean().optional(),
              generalPainting: z.boolean().optional(),
              createdBy: z.boolean().optional(),
              artworks: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              serviceOrders: z.boolean().optional(),
              pricing: z.boolean().optional(),
              airbrushings: z.boolean().optional(),
              cuts: z.boolean().optional(),
              truck: z.boolean().optional(),
              relatedTasks: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    airbrushing: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              task: z.boolean().optional(),
              budgets: z.boolean().optional(),
              invoices: z.boolean().optional(),
              receipts: z.boolean().optional(),
              reimbursements: z.boolean().optional(),
              invoiceReimbursements: z.boolean().optional(),
              artworks: z.boolean().optional(),
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

export const artworkOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        // Artwork direct fields (matching Prisma model)
        id: orderByDirectionSchema.optional(),
        fileId: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        airbrushingId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),

        // Nested relation ordering
        file: z
          .object({
            id: orderByDirectionSchema.optional(),
            filename: orderByDirectionSchema.optional(),
            originalName: orderByDirectionSchema.optional(),
            mimetype: orderByDirectionSchema.optional(),
            size: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .optional(),
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
        airbrushing: z
          .object({
            id: orderByDirectionSchema.optional(),
            startDate: orderByDirectionSchema.optional(),
            finishDate: orderByDirectionSchema.optional(),
            status: orderByDirectionSchema.optional(),
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
          fileId: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          airbrushingId: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
          file: z
            .object({
              id: orderByDirectionSchema.optional(),
              filename: orderByDirectionSchema.optional(),
              originalName: orderByDirectionSchema.optional(),
              mimetype: orderByDirectionSchema.optional(),
              size: orderByDirectionSchema.optional(),
              createdAt: orderByDirectionSchema.optional(),
              updatedAt: orderByDirectionSchema.optional(),
            })
            .optional(),
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
          airbrushing: z
            .object({
              id: orderByDirectionSchema.optional(),
              startDate: orderByDirectionSchema.optional(),
              finishDate: orderByDirectionSchema.optional(),
              status: orderByDirectionSchema.optional(),
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

export const artworkWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([artworkWhereSchema, z.array(artworkWhereSchema)]).optional(),
      OR: z.array(artworkWhereSchema).optional(),
      NOT: z.union([artworkWhereSchema, z.array(artworkWhereSchema)]).optional(),

      // Artwork fields
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

      fileId: z
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

      status: z
        .union([
          z.enum(['DRAFT', 'APPROVED', 'REPROVED']),
          z.object({
            equals: z.enum(['DRAFT', 'APPROVED', 'REPROVED']).optional(),
            in: z.array(z.enum(['DRAFT', 'APPROVED', 'REPROVED'])).optional(),
            notIn: z.array(z.enum(['DRAFT', 'APPROVED', 'REPROVED'])).optional(),
            not: z.enum(['DRAFT', 'APPROVED', 'REPROVED']).optional(),
          }),
        ])
        .optional(),

      taskId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().nullable().optional(),
          }),
        ])
        .optional(),

      airbrushingId: z
        .union([
          z.string(),
          z.null(),
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
      file: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      task: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      airbrushing: z
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

const artworkFilters = {
  searchingFor: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
  airbrushingIds: z.array(z.string()).optional(),
  fileIds: z.array(z.string()).optional(),
  statuses: z.array(z.enum(['DRAFT', 'APPROVED', 'REPROVED'])).optional(),
};

// =====================
// Transform Function
// =====================

const artworkTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const { searchingFor, taskIds, airbrushingIds, fileIds, statuses, ...rest } = data;

  const andConditions: any[] = [];

  if (searchingFor) {
    andConditions.push({
      OR: [
        { file: { filename: { contains: searchingFor, mode: 'insensitive' } } },
        { file: { originalName: { contains: searchingFor, mode: 'insensitive' } } },
        { task: { name: { contains: searchingFor, mode: 'insensitive' } } },
        { task: { serialNumber: { contains: searchingFor, mode: 'insensitive' } } },
      ],
    });
  }

  if (taskIds) {
    andConditions.push({ taskId: { in: taskIds } });
  }

  if (airbrushingIds) {
    andConditions.push({ airbrushingId: { in: airbrushingIds } });
  }

  if (fileIds) {
    andConditions.push({ fileId: { in: fileIds } });
  }

  if (statuses) {
    andConditions.push({ status: { in: statuses } });
  }

  if (andConditions.length > 0) {
    if (rest.where) {
      rest.where = rest.where.AND
        ? { ...rest.where, AND: [...rest.where.AND, ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    } else {
      rest.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return rest;
};

// =====================
// Query Schema
// =====================

export const artworkGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: artworkWhereSchema.optional(),
    orderBy: artworkOrderBySchema.optional(),
    include: artworkIncludeSchema.optional(),

    // Convenience filters
    ...artworkFilters,

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
  .transform(artworkTransform);

// =====================
// Additional Query Schemas
// =====================

export const artworkGetByIdSchema = z.object({
  include: artworkIncludeSchema.optional(),
  id: z.string().uuid('Artwork inválido'),
});

// =====================
// Transform for Create/Update Schemas
// =====================

const toFormData = <T>(data: T) => data;

// =====================
// CRUD Schemas
// =====================

export const artworkCreateSchema = z.preprocess(
  toFormData,
  z.object({
    fileId: z.string().uuid('Arquivo inválido'),
    status: z.enum(['DRAFT', 'APPROVED', 'REPROVED']).default('APPROVED'),
    taskId: z.string().uuid('Tarefa inválida').optional().nullable(),
    airbrushingId: z.string().uuid('Aerografia inválida').optional().nullable(),
  }),
);

export const artworkUpdateSchema = z.preprocess(
  toFormData,
  z.object({
    fileId: z.string().uuid('Arquivo inválido').optional(),
    status: z.enum(['DRAFT', 'APPROVED', 'REPROVED']).optional(),
    taskId: z.string().uuid('Tarefa inválida').optional().nullable(),
    airbrushingId: z.string().uuid('Aerografia inválida').optional().nullable(),
  }),
);

// =====================
// Batch Operations Schemas
// =====================

export const artworkBatchCreateSchema = z.object({
  artworks: z.array(artworkCreateSchema).min(1, 'Pelo menos um artwork deve ser fornecido'),
});

export const artworkBatchUpdateSchema = z.object({
  artworks: z
    .array(
      z.object({
        id: z.string().uuid('Artwork inválido'),
        data: artworkUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um artwork deve ser fornecido'),
});

export const artworkBatchDeleteSchema = z.object({
  artworkIds: z
    .array(z.string().uuid('Artwork inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const artworkQuerySchema = z.object({
  include: artworkIncludeSchema.optional(),
});

// =====================
// Type Inference
// =====================

export type ArtworkGetManyFormData = z.infer<typeof artworkGetManySchema>;
export type ArtworkGetByIdFormData = z.infer<typeof artworkGetByIdSchema>;
export type ArtworkQueryFormData = z.infer<typeof artworkQuerySchema>;

export type ArtworkCreateFormData = z.infer<typeof artworkCreateSchema>;
export type ArtworkUpdateFormData = z.infer<typeof artworkUpdateSchema>;

export type ArtworkBatchCreateFormData = z.infer<typeof artworkBatchCreateSchema>;
export type ArtworkBatchUpdateFormData = z.infer<typeof artworkBatchUpdateSchema>;
export type ArtworkBatchDeleteFormData = z.infer<typeof artworkBatchDeleteSchema>;

export type ArtworkInclude = z.infer<typeof artworkIncludeSchema>;
export type ArtworkOrderBy = z.infer<typeof artworkOrderBySchema>;
export type ArtworkWhere = z.infer<typeof artworkWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapArtworkToFormData = createMapToFormDataHelper<Artwork, ArtworkUpdateFormData>(
  artwork => ({
    fileId: artwork.fileId,
    status: artwork.status,
    taskId: artwork.taskId,
    airbrushingId: artwork.airbrushingId,
  }),
);
