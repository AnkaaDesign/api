// src/schemas/work-accident-report.ts
// CAT — Comunicação de Acidente de Trabalho (Medicina do Trabalho, Part E)

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
  normalizeSearchTerm,
} from './common';
import { WORK_ACCIDENT_REPORT_TYPE } from '@constants';

// =====================
// Include Schema
// =====================

export const workAccidentReportIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    leave: z.boolean().optional(),
    file: z.boolean().optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================

const workAccidentReportOrderByFields = {
  id: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  type: orderByDirectionSchema.optional(),
  catNumber: orderByDirectionSchema.optional(),
  emissionDate: orderByDirectionSchema.optional(),
  accidentDate: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const workAccidentReportOrderBySchema = z
  .union([
    z.object(workAccidentReportOrderByFields).partial(),
    z.array(z.object(workAccidentReportOrderByFields).partial()),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const workAccidentReportWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(workAccidentReportWhereSchema).optional(),
      OR: z.array(workAccidentReportWhereSchema).optional(),
      NOT: workAccidentReportWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      leaveId: z.union([createUuidWhereSchema(), z.null()]).optional(),
      fileId: z.union([createUuidWhereSchema(), z.null()]).optional(),

      type: createStringWhereSchema().optional(),
      catNumber: z.union([createStringWhereSchema(), z.null()]).optional(),
      description: z.union([createStringWhereSchema(), z.null()]).optional(),

      emissionDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      accidentDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Filters + Transform
// =====================

const workAccidentReportFilters = {
  searchingFor: z.string().optional(),
  types: z
    .array(
      z.enum(Object.values(WORK_ACCIDENT_REPORT_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de CAT inválido' }),
      }),
    )
    .optional(),
  userIds: z.array(z.string()).optional(),
  leaveIds: z.array(z.string()).optional(),
};

const workAccidentReportTransform = (data: any) => {
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
        { user: { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } } },
        { catNumberNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { descriptionNormalized: { contains: normalizeSearchTerm(searchTerm) } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.types && Array.isArray(data.types) && data.types.length > 0) {
    andConditions.push({ type: { in: data.types } });
    delete data.types;
  }

  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.leaveIds && Array.isArray(data.leaveIds) && data.leaveIds.length > 0) {
    andConditions.push({ leaveId: { in: data.leaveIds } });
    delete data.leaveIds;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const workAccidentReportGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: workAccidentReportWhereSchema.optional(),
    orderBy: workAccidentReportOrderBySchema.optional(),
    include: workAccidentReportIncludeSchema.optional(),
    ...workAccidentReportFilters,
  })
  .transform(workAccidentReportTransform);

export const workAccidentReportGetByIdSchema = z.object({
  include: workAccidentReportIncludeSchema.optional(),
  id: z.string().uuid({ message: 'CAT inválida' }),
});

// =====================
// CRUD Schemas
// =====================

export const workAccidentReportCreateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }),
  leaveId: z.string().uuid({ message: 'Afastamento inválido' }).nullable().optional(),
  type: z
    .enum(Object.values(WORK_ACCIDENT_REPORT_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de CAT inválido' }),
    })
    .default(WORK_ACCIDENT_REPORT_TYPE.INITIAL),
  catNumber: z.string().max(50).nullable().optional(),
  emissionDate: z.coerce.date().nullable().optional(),
  accidentDate: z.coerce.date().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  fileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  // Se true e houver leaveId/afastamento de acidente, aplica a estabilidade
  // acidentária (12 meses a partir do retorno) ao vínculo do colaborador.
  confirmStability: z.boolean().optional(),
});

export const workAccidentReportUpdateSchema = z.object({
  leaveId: z.string().uuid({ message: 'Afastamento inválido' }).nullable().optional(),
  type: z
    .enum(Object.values(WORK_ACCIDENT_REPORT_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de CAT inválido' }),
    })
    .optional(),
  catNumber: z.string().max(50).nullable().optional(),
  emissionDate: z.coerce.date().nullable().optional(),
  accidentDate: z.coerce.date().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  fileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  confirmStability: z.boolean().optional(),
});

export const workAccidentReportBatchCreateSchema = z.object({
  workAccidentReports: z
    .array(workAccidentReportCreateSchema)
    .min(1, 'Pelo menos uma CAT deve ser fornecida'),
});

export const workAccidentReportBatchUpdateSchema = z.object({
  workAccidentReports: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'CAT inválida' }),
        data: workAccidentReportUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma CAT deve ser fornecida'),
});

export const workAccidentReportBatchDeleteSchema = z.object({
  workAccidentReportIds: z
    .array(z.string().uuid({ message: 'CAT inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const workAccidentReportQuerySchema = z.object({
  include: workAccidentReportIncludeSchema.optional(),
});

export const workAccidentReportBatchQuerySchema = z.object({
  include: workAccidentReportIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type WorkAccidentReportGetManyFormData = z.infer<typeof workAccidentReportGetManySchema>;
export type WorkAccidentReportGetByIdFormData = z.infer<typeof workAccidentReportGetByIdSchema>;
export type WorkAccidentReportQueryFormData = z.infer<typeof workAccidentReportQuerySchema>;
export type WorkAccidentReportBatchQueryFormData = z.infer<
  typeof workAccidentReportBatchQuerySchema
>;
export type WorkAccidentReportCreateFormData = z.infer<typeof workAccidentReportCreateSchema>;
export type WorkAccidentReportUpdateFormData = z.infer<typeof workAccidentReportUpdateSchema>;
export type WorkAccidentReportBatchCreateFormData = z.infer<
  typeof workAccidentReportBatchCreateSchema
>;
export type WorkAccidentReportBatchUpdateFormData = z.infer<
  typeof workAccidentReportBatchUpdateSchema
>;
export type WorkAccidentReportBatchDeleteFormData = z.infer<
  typeof workAccidentReportBatchDeleteSchema
>;
export type WorkAccidentReportInclude = z.infer<typeof workAccidentReportIncludeSchema>;
export type WorkAccidentReportOrderBy = z.infer<typeof workAccidentReportOrderBySchema>;
export type WorkAccidentReportWhere = z.infer<typeof workAccidentReportWhereSchema>;
