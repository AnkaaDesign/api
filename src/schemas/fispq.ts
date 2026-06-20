// src/schemas/fispq.ts
// FISPQ / FDS — Ficha de Informações de Segurança de Produtos Químicos (Medicina
// do Trabalho — inventário de produtos químicos). Espelha medical-exam.ts.

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
} from './common';
import { GHS_PICTOGRAM, GHS_SIGNAL_WORD, FISPQ_STATUS } from '@constants';

// =====================
// Fispq Include Schema (Second Level Only)
// =====================

export const fispqIncludeSchema = z
  .object({
    item: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              brands: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    pdfFile: z.boolean().optional(),
    requiredPpeItems: z.boolean().optional(),
  })
  .partial();

// =====================
// Fispq OrderBy Schema
// =====================

const fispqOrderByFields = {
  id: orderByDirectionSchema.optional(),
  itemId: orderByDirectionSchema.optional(),
  productName: orderByDirectionSchema.optional(),
  manufacturer: orderByDirectionSchema.optional(),
  casNumber: orderByDirectionSchema.optional(),
  onuNumber: orderByDirectionSchema.optional(),
  status: orderByDirectionSchema.optional(),
  signalWord: orderByDirectionSchema.optional(),
  issueDate: orderByDirectionSchema.optional(),
  revisionDate: orderByDirectionSchema.optional(),
  validUntil: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const fispqOrderBySchema = z
  .union([
    z.object(fispqOrderByFields).partial(),
    z.array(z.object(fispqOrderByFields).partial()),
  ])
  .optional();

// =====================
// Fispq Where Schema
// =====================

export const fispqWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(fispqWhereSchema).optional(),
      OR: z.array(fispqWhereSchema).optional(),
      NOT: fispqWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      itemId: createUuidWhereSchema().optional(),
      pdfFileId: z.union([createUuidWhereSchema(), z.null()]).optional(),

      status: createStringWhereSchema().optional(),
      signalWord: z.union([createStringWhereSchema(), z.null()]).optional(),
      productName: z.union([createStringWhereSchema(), z.null()]).optional(),
      manufacturer: z.union([createStringWhereSchema(), z.null()]).optional(),
      supplierName: z.union([createStringWhereSchema(), z.null()]).optional(),
      casNumber: z.union([createStringWhereSchema(), z.null()]).optional(),
      onuNumber: z.union([createStringWhereSchema(), z.null()]).optional(),
      unRiskClass: z.union([createStringWhereSchema(), z.null()]).optional(),
      notes: z.union([createStringWhereSchema(), z.null()]).optional(),

      isActive: z.boolean().optional(),

      item: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      issueDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      revisionDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      validUntil: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters + Transform
// =====================

const fispqFilters = {
  searchingFor: z.string().optional(),
  statuses: z
    .array(
      z.enum(Object.values(FISPQ_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status de FISPQ inválido' }),
      }),
    )
    .optional(),
  signalWords: z
    .array(
      z.enum(Object.values(GHS_SIGNAL_WORD) as [string, ...string[]], {
        errorMap: () => ({ message: 'palavra de advertência inválida' }),
      }),
    )
    .optional(),
  pictograms: z
    .array(
      z.enum(Object.values(GHS_PICTOGRAM) as [string, ...string[]], {
        errorMap: () => ({ message: 'pictograma GHS inválido' }),
      }),
    )
    .optional(),
  itemIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  // Only FISPQ records with / without an attached PDF.
  hasPdf: z.coerce.boolean().optional(),
  // Only records whose validity is within N days (or already past).
  expiringInDays: z.coerce.number().int().min(0).max(730).optional(),
};

const fispqTransform = (data: any) => {
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    andConditions.push({
      OR: [
        { productName: { contains: searchTerm, mode: 'insensitive' } },
        { manufacturer: { contains: searchTerm, mode: 'insensitive' } },
        { casNumber: { contains: searchTerm, mode: 'insensitive' } },
        { onuNumber: { contains: searchTerm, mode: 'insensitive' } },
        { notes: { contains: searchTerm, mode: 'insensitive' } },
        { item: { name: { contains: searchTerm, mode: 'insensitive' } } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.statuses && Array.isArray(data.statuses) && data.statuses.length > 0) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  if (data.signalWords && Array.isArray(data.signalWords) && data.signalWords.length > 0) {
    andConditions.push({ signalWord: { in: data.signalWords } });
    delete data.signalWords;
  }

  if (data.pictograms && Array.isArray(data.pictograms) && data.pictograms.length > 0) {
    andConditions.push({ ghsPictograms: { hasSome: data.pictograms } });
    delete data.pictograms;
  }

  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.categoryIds && Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
    andConditions.push({ item: { categoryId: { in: data.categoryIds } } });
    delete data.categoryIds;
  }

  if (typeof data.hasPdf === 'boolean') {
    andConditions.push(data.hasPdf ? { pdfFileId: { not: null } } : { pdfFileId: null });
    delete data.hasPdf;
  }

  if (typeof data.expiringInDays === 'number') {
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() + data.expiringInDays);
    andConditions.push({ validUntil: { not: null, lte: limitDate } });
    delete data.expiringInDays;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const fispqGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: fispqWhereSchema.optional(),
    orderBy: fispqOrderBySchema.optional(),
    include: fispqIncludeSchema.optional(),
    ...fispqFilters,
  })
  .transform(fispqTransform);

export const fispqGetByIdSchema = z.object({
  include: fispqIncludeSchema.optional(),
  id: z.string().uuid({ message: 'FISPQ inválida' }),
});

// =====================
// Shared field schemas
// =====================

const ghsPictogramEnum = z.enum(Object.values(GHS_PICTOGRAM) as [string, ...string[]], {
  errorMap: () => ({ message: 'pictograma GHS inválido' }),
});

const signalWordEnum = z.enum(Object.values(GHS_SIGNAL_WORD) as [string, ...string[]], {
  errorMap: () => ({ message: 'palavra de advertência inválida' }),
});

const statusEnum = z.enum(Object.values(FISPQ_STATUS) as [string, ...string[]], {
  errorMap: () => ({ message: 'status de FISPQ inválido' }),
});

// =====================
// CRUD Schemas
// =====================

export const fispqCreateSchema = z.object({
  itemId: z.string().uuid({ message: 'Produto químico inválido' }),

  // Section 1
  productName: z.string().max(300).nullable().optional(),
  manufacturer: z.string().max(300).nullable().optional(),
  supplierName: z.string().max(300).nullable().optional(),
  recommendedUse: z.string().max(1000).nullable().optional(),
  emergencyPhone: z.string().max(100).nullable().optional(),

  // Section 2
  ghsPictograms: z.array(ghsPictogramEnum).optional(),
  signalWord: signalWordEnum.nullable().optional(),
  hazardStatements: z.array(z.string().max(500)).optional(),
  precautionStatements: z.array(z.string().max(500)).optional(),

  // Sections 3 + 14
  casNumber: z.string().max(100).nullable().optional(),
  onuNumber: z.string().max(50).nullable().optional(),
  unRiskClass: z.string().max(100).nullable().optional(),
  packingGroup: z.string().max(50).nullable().optional(),

  // Section 9
  physicalState: z.string().max(200).nullable().optional(),
  color: z.string().max(200).nullable().optional(),
  odor: z.string().max(200).nullable().optional(),
  flashPoint: z.string().max(200).nullable().optional(),
  phValue: z.string().max(100).nullable().optional(),

  // Sections 4–7
  firstAidMeasures: z.string().max(5000).nullable().optional(),
  fireFightingMeasures: z.string().max(5000).nullable().optional(),
  accidentalRelease: z.string().max(5000).nullable().optional(),
  handlingStorage: z.string().max(5000).nullable().optional(),

  // Section 8
  requiredPpeText: z.string().max(2000).nullable().optional(),
  requiredPpeItemIds: z.array(z.string().uuid({ message: 'EPI inválido' })).optional(),

  // Document + lifecycle
  pdfFileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  revisionNumber: z.string().max(100).nullable().optional(),
  issueDate: z.coerce.date().nullable().optional(),
  revisionDate: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  // Status é normalmente derivado pelo serviço; aceito para override manual (ex.: ARCHIVED).
  status: statusEnum.optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const fispqUpdateSchema = z.object({
  itemId: z.string().uuid({ message: 'Produto químico inválido' }).optional(),

  productName: z.string().max(300).nullable().optional(),
  manufacturer: z.string().max(300).nullable().optional(),
  supplierName: z.string().max(300).nullable().optional(),
  recommendedUse: z.string().max(1000).nullable().optional(),
  emergencyPhone: z.string().max(100).nullable().optional(),

  ghsPictograms: z.array(ghsPictogramEnum).optional(),
  signalWord: signalWordEnum.nullable().optional(),
  hazardStatements: z.array(z.string().max(500)).optional(),
  precautionStatements: z.array(z.string().max(500)).optional(),

  casNumber: z.string().max(100).nullable().optional(),
  onuNumber: z.string().max(50).nullable().optional(),
  unRiskClass: z.string().max(100).nullable().optional(),
  packingGroup: z.string().max(50).nullable().optional(),

  physicalState: z.string().max(200).nullable().optional(),
  color: z.string().max(200).nullable().optional(),
  odor: z.string().max(200).nullable().optional(),
  flashPoint: z.string().max(200).nullable().optional(),
  phValue: z.string().max(100).nullable().optional(),

  firstAidMeasures: z.string().max(5000).nullable().optional(),
  fireFightingMeasures: z.string().max(5000).nullable().optional(),
  accidentalRelease: z.string().max(5000).nullable().optional(),
  handlingStorage: z.string().max(5000).nullable().optional(),

  requiredPpeText: z.string().max(2000).nullable().optional(),
  requiredPpeItemIds: z.array(z.string().uuid({ message: 'EPI inválido' })).optional(),

  pdfFileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  revisionNumber: z.string().max(100).nullable().optional(),
  issueDate: z.coerce.date().nullable().optional(),
  revisionDate: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  status: statusEnum.optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const fispqBatchCreateSchema = z.object({
  fispqs: z.array(fispqCreateSchema).min(1, 'Pelo menos uma FISPQ deve ser fornecida'),
});

export const fispqBatchUpdateSchema = z.object({
  fispqs: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'FISPQ inválida' }),
        data: fispqUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma FISPQ deve ser fornecida'),
});

export const fispqBatchDeleteSchema = z.object({
  fispqIds: z
    .array(z.string().uuid({ message: 'FISPQ inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const fispqQuerySchema = z.object({
  include: fispqIncludeSchema.optional(),
});

export const fispqBatchQuerySchema = z.object({
  include: fispqIncludeSchema.optional(),
});

// Inventory export query: format + reuses the list filters (so the export
// honours the same filters the user sees on screen).
export const fispqExportSchema = z
  .object({
    format: z.enum(['pdf', 'xlsx']).default('pdf'),
    where: fispqWhereSchema.optional(),
    orderBy: fispqOrderBySchema.optional(),
    ...fispqFilters,
  })
  .transform(fispqTransform);

// =====================
// Inferred Types
// =====================

export type FispqGetManyFormData = z.infer<typeof fispqGetManySchema>;
export type FispqGetByIdFormData = z.infer<typeof fispqGetByIdSchema>;
export type FispqQueryFormData = z.infer<typeof fispqQuerySchema>;
export type FispqBatchQueryFormData = z.infer<typeof fispqBatchQuerySchema>;
export type FispqExportFormData = z.infer<typeof fispqExportSchema>;
export type FispqCreateFormData = z.infer<typeof fispqCreateSchema>;
export type FispqUpdateFormData = z.infer<typeof fispqUpdateSchema>;
export type FispqBatchCreateFormData = z.infer<typeof fispqBatchCreateSchema>;
export type FispqBatchUpdateFormData = z.infer<typeof fispqBatchUpdateSchema>;
export type FispqBatchDeleteFormData = z.infer<typeof fispqBatchDeleteSchema>;
export type FispqInclude = z.infer<typeof fispqIncludeSchema>;
export type FispqOrderBy = z.infer<typeof fispqOrderBySchema>;
export type FispqWhere = z.infer<typeof fispqWhereSchema>;
