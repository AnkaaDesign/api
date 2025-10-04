// packages/schemas/src/schemas/file.ts

import { z } from "zod";
import { orderByDirectionSchema, normalizeOrderBy } from "./common";

// =====================
// Base Schema Components
// =====================

// Include Schema
export const fileIncludeSchema = z
  .object({
    // File associations - matching the types file exactly
    tasksArtworks: z.boolean().optional(),
    customerLogo: z.boolean().optional(),
    supplierLogo: z.boolean().optional(),
    observations: z.boolean().optional(),
    warning: z.boolean().optional(),
    airbrushingReceipts: z.boolean().optional(),
    airbrushingNfes: z.boolean().optional(),
    orderBudgets: z.boolean().optional(),
    orderNfes: z.boolean().optional(),
    orderReceipts: z.boolean().optional(),
    taskBudgets: z.boolean().optional(),
    taskNfes: z.boolean().optional(),
    taskReceipts: z.boolean().optional(),
    externalWithdrawalBudgets: z.boolean().optional(),
    externalWithdrawalNfes: z.boolean().optional(),
    externalWithdrawalReceipts: z.boolean().optional(),
  })
  .strict();

// Order By Schema
export const fileOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      filename: orderByDirectionSchema.optional(),
      originalName: orderByDirectionSchema.optional(),
      mimetype: orderByDirectionSchema.optional(),
      path: orderByDirectionSchema.optional(),
      size: orderByDirectionSchema.optional(),
      thumbnailUrl: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        filename: orderByDirectionSchema.optional(),
        originalName: orderByDirectionSchema.optional(),
        mimetype: orderByDirectionSchema.optional(),
        path: orderByDirectionSchema.optional(),
        size: orderByDirectionSchema.optional(),
        thumbnailUrl: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

// Where Schema
export const fileWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Base conditions
      AND: z.array(z.lazy(() => fileWhereSchema)).optional(),
      OR: z.array(z.lazy(() => fileWhereSchema)).optional(),
      NOT: z.lazy(() => fileWhereSchema).optional(),

      // Field conditions
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

      filename: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      originalName: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      mimetype: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      path: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      thumbnailUrl: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
            isSet: z.boolean().optional(),
          }),
        ])
        .optional(),

      size: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
            not: z.number().optional(),
          }),
        ])
        .optional(),

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

      // Relation filters - matching the types file exactly
      tasksArtworks: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      customerLogo: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      supplierLogo: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      observations: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      warning: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      airbrushingReceipts: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      airbrushingNfes: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      orderBudgets: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      orderNfes: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      orderReceipts: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      taskBudgets: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      taskNfes: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      taskReceipts: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      externalWithdrawalBudgets: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      externalWithdrawalNfes: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      externalWithdrawalReceipts: z
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
// Query Filters
// =====================

const fileFilters = {
  searchingFor: z.string().optional(),
  filenameContains: z.string().optional(),
  originalNameContains: z.string().optional(),
  pathContains: z.string().optional(),
  mimetypes: z.array(z.string()).optional(),
  sizeRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  hasThumbnail: z.boolean().optional(),
  isOrphaned: z.boolean().optional(),
  hasRelations: z.boolean().optional(),
  extensions: z.array(z.string()).optional(),
  isImage: z.boolean().optional(),
  isPdf: z.boolean().optional(),
  isDocument: z.boolean().optional(),
  isVideo: z.boolean().optional(),
  isAudio: z.boolean().optional(),
};

// =====================
// Transform Function
// =====================

const fileTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const {
    searchingFor,
    filenameContains,
    originalNameContains,
    pathContains,
    mimetypes,
    sizeRange,
    hasThumbnail,
    isOrphaned,
    hasRelations,
    extensions,
    isImage,
    isPdf,
    isDocument,
    isVideo,
    isAudio,
    createdAt,
    updatedAt,
    ...rest
  } = data;

  const andConditions: any[] = [];

  // Handle searchingFor - search in filename, originalName, and mimetype
  if (searchingFor) {
    andConditions.push({
      OR: [
        { filename: { contains: searchingFor, mode: "insensitive" } },
        { originalName: { contains: searchingFor, mode: "insensitive" } },
        { mimetype: { contains: searchingFor, mode: "insensitive" } },
      ],
    });
  }

  // Handle filenameContains filter
  if (filenameContains) {
    andConditions.push({
      filename: { contains: filenameContains, mode: "insensitive" },
    });
  }

  // Handle originalNameContains filter
  if (originalNameContains) {
    andConditions.push({
      originalName: { contains: originalNameContains, mode: "insensitive" },
    });
  }

  // Handle pathContains filter
  if (pathContains) {
    andConditions.push({
      path: { contains: pathContains, mode: "insensitive" },
    });
  }

  // Handle mimetypes filter
  if (mimetypes && mimetypes.length > 0) {
    andConditions.push({ mimetype: { in: mimetypes } });
  }

  // Handle sizeRange filter
  if (sizeRange) {
    const sizeCondition: any = {};
    if (sizeRange.min !== undefined) sizeCondition.gte = sizeRange.min;
    if (sizeRange.max !== undefined) sizeCondition.lte = sizeRange.max;
    if (Object.keys(sizeCondition).length > 0) {
      andConditions.push({ size: sizeCondition });
    }
  }

  // Handle hasThumbnail filter
  if (hasThumbnail !== undefined) {
    if (hasThumbnail) {
      andConditions.push({
        thumbnailUrl: { not: null },
      });
    } else {
      andConditions.push({
        thumbnailUrl: null,
      });
    }
  }

  // Handle isOrphaned filter
  if (isOrphaned !== undefined) {
    if (isOrphaned) {
      // File is orphaned if it has no relations
      andConditions.push({
        AND: [
          { tasksArtworks: { none: {} } },
          { customerLogo: { none: {} } },
          { supplierLogo: { none: {} } },
          { observations: { none: {} } },
          { warning: { none: {} } },
          { airbrushingReceipts: { none: {} } },
          { airbrushingNfes: { none: {} } },
          { orderBudgets: { none: {} } },
          { orderNfes: { none: {} } },
          { orderReceipts: { none: {} } },
          { taskBudgets: { none: {} } },
          { taskNfes: { none: {} } },
          { taskReceipts: { none: {} } },
          { externalWithdrawalBudgets: { none: {} } },
          { externalWithdrawalNfes: { none: {} } },
          { externalWithdrawalReceipts: { none: {} } },
        ],
      });
    } else {
      // File is not orphaned if it has at least one relation
      andConditions.push({
        OR: [
          { tasksArtworks: { some: {} } },
          { customerLogo: { some: {} } },
          { supplierLogo: { some: {} } },
          { observations: { some: {} } },
          { warning: { some: {} } },
          { airbrushingReceipts: { some: {} } },
          { airbrushingNfes: { some: {} } },
          { orderBudgets: { some: {} } },
          { orderNfes: { some: {} } },
          { orderReceipts: { some: {} } },
          { taskBudgets: { some: {} } },
          { taskNfes: { some: {} } },
          { taskReceipts: { some: {} } },
          { externalWithdrawalBudgets: { some: {} } },
          { externalWithdrawalNfes: { some: {} } },
          { externalWithdrawalReceipts: { some: {} } },
        ],
      });
    }
  }

  // Handle hasRelations filter (similar to isOrphaned but inverted logic)
  if (hasRelations !== undefined) {
    if (hasRelations) {
      andConditions.push({
        OR: [
          { tasksArtworks: { some: {} } },
          { customerLogo: { some: {} } },
          { supplierLogo: { some: {} } },
          { observations: { some: {} } },
          { warning: { some: {} } },
          { airbrushingReceipts: { some: {} } },
          { airbrushingNfes: { some: {} } },
          { orderBudgets: { some: {} } },
          { orderNfes: { some: {} } },
          { orderReceipts: { some: {} } },
          { taskBudgets: { some: {} } },
          { taskNfes: { some: {} } },
          { taskReceipts: { some: {} } },
          { externalWithdrawalBudgets: { some: {} } },
          { externalWithdrawalNfes: { some: {} } },
          { externalWithdrawalReceipts: { some: {} } },
        ],
      });
    } else {
      andConditions.push({
        AND: [
          { tasksArtworks: { none: {} } },
          { customerLogo: { none: {} } },
          { supplierLogo: { none: {} } },
          { observations: { none: {} } },
          { warning: { none: {} } },
          { airbrushingReceipts: { none: {} } },
          { airbrushingNfes: { none: {} } },
          { orderBudgets: { none: {} } },
          { orderNfes: { none: {} } },
          { orderReceipts: { none: {} } },
          { taskBudgets: { none: {} } },
          { taskNfes: { none: {} } },
          { taskReceipts: { none: {} } },
          { externalWithdrawalBudgets: { none: {} } },
          { externalWithdrawalNfes: { none: {} } },
          { externalWithdrawalReceipts: { none: {} } },
        ],
      });
    }
  }

  // Handle file extension filters
  if (extensions && extensions.length > 0) {
    const extensionConditions = extensions.map((ext: string) => ({
      filename: { endsWith: ext.startsWith(".") ? ext : `.${ext}`, mode: "insensitive" },
    }));
    andConditions.push({ OR: extensionConditions });
  }

  // Handle file type filters based on mime types
  if (isImage) {
    andConditions.push({
      mimetype: {
        in: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp"],
      },
    });
  }

  if (isPdf) {
    andConditions.push({ mimetype: "application/pdf" });
  }

  if (isDocument) {
    andConditions.push({
      mimetype: {
        in: [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/plain",
          "text/csv",
        ],
      },
    });
  }

  if (isVideo) {
    andConditions.push({
      mimetype: {
        in: ["video/mp4", "video/mpeg", "video/quicktime", "video/x-msvideo", "video/webm"],
      },
    });
  }

  if (isAudio) {
    andConditions.push({
      mimetype: {
        in: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
      },
    });
  }

  // Handle date filters
  if (createdAt) {
    const createdAtCondition: any = {};
    if (createdAt.gte) createdAtCondition.gte = createdAt.gte;
    if (createdAt.lte) createdAtCondition.lte = createdAt.lte;
    if (Object.keys(createdAtCondition).length > 0) {
      andConditions.push({ createdAt: createdAtCondition });
    }
  }

  if (updatedAt) {
    const updatedAtCondition: any = {};
    if (updatedAt.gte) updatedAtCondition.gte = updatedAt.gte;
    if (updatedAt.lte) updatedAtCondition.lte = updatedAt.lte;
    if (Object.keys(updatedAtCondition).length > 0) {
      andConditions.push({ updatedAt: updatedAtCondition });
    }
  }

  // Merge with existing where conditions
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

export const fileGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: fileWhereSchema.optional(),
    orderBy: fileOrderBySchema.optional(),
    include: fileIncludeSchema.optional(),

    // Convenience filters
    ...fileFilters,

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
  .transform(fileTransform);

// =====================
// CRUD Schemas
// =====================

// MIME type validation
const mimeTypeSchema = z.string().regex(/^[\w-]+\/[\w-]+$/, "Tipo MIME inválido");

export const fileCreateSchema = z.object({
  filename: z
    .string()
    .min(1, "Nome do arquivo é obrigatório")
    .max(255, "Nome do arquivo deve ter no máximo 255 caracteres")
    .regex(/^[^<>:"/\\|?*\x00-\x1f]+$/, "Nome do arquivo contém caracteres inválidos")
    .refine((filename) => {
      // Security: prevent directory traversal in filename
      return !filename.includes("../") && !filename.includes("..\\");
    }, "Nome do arquivo contém caracteres de navegação de diretório não permitidos")
    .refine((filename) => {
      // Ensure filename has an extension
      return filename.includes(".") && filename.split(".").pop()!.length > 0;
    }, "Nome do arquivo deve ter uma extensão"),
  originalName: z.string().min(1, "Nome original do arquivo é obrigatório").max(255, "Nome original do arquivo deve ter no máximo 255 caracteres"),
  mimetype: mimeTypeSchema,
  path: z
    .string()
    .min(1, "Caminho do arquivo é obrigatório")
    .max(500, "Caminho do arquivo deve ter no máximo 500 caracteres")
    .refine((path) => {
      // Security: prevent path traversal
      return !path.includes("../") && !path.includes("..\\");
    }, "Caminho contém caracteres de navegação de diretório não permitidos"),
  size: z
    .number()
    .int()
    .min(1, "Tamanho do arquivo deve ser maior que 0")
    .max(500 * 1024 * 1024, "Tamanho máximo do arquivo é 500MB"),
  thumbnailUrl: z.string().url("URL da miniatura deve ser uma URL válida").optional().nullable(),
});

export const fileUpdateSchema = z.object({
  filename: z
    .string()
    .min(1, "Nome do arquivo é obrigatório")
    .max(255, "Nome do arquivo deve ter no máximo 255 caracteres")
    .regex(/^[^<>:"/\\|?*\x00-\x1f]+$/, "Nome do arquivo contém caracteres inválidos")
    .refine((filename) => {
      // Security: prevent directory traversal in filename
      return !filename.includes("../") && !filename.includes("..\\");
    }, "Nome do arquivo contém caracteres de navegação de diretório não permitidos")
    .refine((filename) => {
      // Ensure filename has an extension
      return filename.includes(".") && filename.split(".").pop()!.length > 0;
    }, "Nome do arquivo deve ter uma extensão")
    .optional(),
  originalName: z.string().min(1, "Nome original do arquivo é obrigatório").max(255, "Nome original do arquivo deve ter no máximo 255 caracteres").optional(),
  mimetype: mimeTypeSchema.optional(),
  path: z
    .string()
    .min(1, "Caminho do arquivo é obrigatório")
    .max(500, "Caminho do arquivo deve ter no máximo 500 caracteres")
    .refine((path) => {
      // Security: prevent path traversal
      return !path.includes("../") && !path.includes("..\\");
    }, "Caminho contém caracteres de navegação de diretório não permitidos")
    .optional(),
  size: z
    .number()
    .int()
    .min(1, "Tamanho do arquivo deve ser maior que 0")
    .max(500 * 1024 * 1024, "Tamanho máximo do arquivo é 500MB")
    .optional(),
  thumbnailUrl: z.string().url("URL da miniatura deve ser uma URL válida").optional().nullable(),
});

// =====================
// Multiple File Upload Schema
// =====================

export const fileMultipleUploadSchema = z.object({
  files: z.array(fileCreateSchema).min(1, "Pelo menos um arquivo deve ser fornecido").max(10, "Máximo de 10 arquivos por upload"),
});

// =====================
// Batch Operations Schemas
// =====================

export const fileBatchCreateSchema = z.object({
  files: z.array(fileCreateSchema).min(1, "Pelo menos um arquivo deve ser fornecido").max(50, "Máximo de 50 arquivos por operação em lote"),
});

export const fileBatchUpdateSchema = z.object({
  files: z
    .array(
      z.object({
        id: z.string().uuid("Arquivo inválido"),
        data: fileUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um arquivo deve ser fornecido")
    .max(50, "Máximo de 50 arquivos por operação em lote"),
});

export const fileBatchDeleteSchema = z.object({
  fileIds: z.array(z.string().uuid("Arquivo inválido")).min(1, "Pelo menos um ID deve ser fornecido").max(50, "Máximo de 50 arquivos por operação em lote"),
});

// Query schema for include parameter
export const fileQuerySchema = z.object({
  include: fileIncludeSchema.optional(),
});

// GetById Schema
export const fileGetByIdSchema = z.object({
  include: fileIncludeSchema.optional(),
  id: z.string().uuid("Arquivo inválido"),
});

// =====================
// Inferred Types
// =====================

export type FileGetManyFormData = z.infer<typeof fileGetManySchema>;
export type FileGetByIdFormData = z.infer<typeof fileGetByIdSchema>;
export type FileQueryFormData = z.infer<typeof fileQuerySchema>;

export type FileCreateFormData = z.infer<typeof fileCreateSchema>;
export type FileUpdateFormData = z.infer<typeof fileUpdateSchema>;

export type FileMultipleUploadFormData = z.infer<typeof fileMultipleUploadSchema>;
export type FileBatchCreateFormData = z.infer<typeof fileBatchCreateSchema>;
export type FileBatchUpdateFormData = z.infer<typeof fileBatchUpdateSchema>;
export type FileBatchDeleteFormData = z.infer<typeof fileBatchDeleteSchema>;

export type FileInclude = z.infer<typeof fileIncludeSchema>;
export type FileOrderBy = z.infer<typeof fileOrderBySchema>;
export type FileWhere = z.infer<typeof fileWhereSchema>;
