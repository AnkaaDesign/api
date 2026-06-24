// src/schemas/termination.ts
// Rescisões (Departamento Pessoal)

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
  createDescriptionSchema,
  normalizeSearchTerm,
} from './common';
import {
  TERMINATION_TYPE,
  TERMINATION_STATUS,
  TERMINATION_ITEM_TYPE,
  TERMINATION_DOCUMENT_TYPE,
  TERMINATION_DOCUMENT_STATUS,
  NOTICE_TYPE,
  NOTICE_REDUCTION,
} from '@constants';

// =====================
// Generic relation include (Prisma passthrough)
// =====================

const relationIncludeSchema = z.union([
  z.boolean(),
  z.object({
    include: z.any().optional(),
    select: z.any().optional(),
    where: z.any().optional(),
    orderBy: z.any().optional(),
  }),
]);

// =====================
// Termination Include Schema
// =====================

export const terminationIncludeSchema = z
  .object({
    user: relationIncludeSchema.optional(),
    initiatedBy: relationIncludeSchema.optional(),
    items: relationIncludeSchema.optional(),
    documents: relationIncludeSchema.optional(),
    dismissalExam: relationIncludeSchema.optional(),
  })
  .partial();

// =====================
// Termination Order By Schema
// =====================

const terminationOrderByFields = z.object({
  id: orderByDirectionSchema.optional(),
  type: orderByDirectionSchema.optional(),
  status: orderByDirectionSchema.optional(),
  statusOrder: orderByDirectionSchema.optional(),
  noticeType: orderByDirectionSchema.optional(),
  noticeDays: orderByDirectionSchema.optional(),
  noticeStartDate: orderByDirectionSchema.optional(),
  lastWorkingDate: orderByDirectionSchema.optional(),
  terminationDate: orderByDirectionSchema.optional(),
  projectedEndDate: orderByDirectionSchema.optional(),
  paymentDueDate: orderByDirectionSchema.optional(),
  paymentDate: orderByDirectionSchema.optional(),
  paidAmount: orderByDirectionSchema.optional(),
  baseRemuneration: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
  user: z.object({ name: orderByDirectionSchema.optional() }).optional(),
});

export const terminationOrderBySchema = z
  .union([terminationOrderByFields, z.array(terminationOrderByFields)])
  .optional();

// =====================
// Termination Where Schema
// =====================

const numberWhereSchema = z
  .union([
    z.number(),
    z.object({
      equals: z.number().optional(),
      in: z.array(z.number()).optional(),
      notIn: z.array(z.number()).optional(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      not: z.number().optional(),
    }),
  ])
  .optional();

export const terminationWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(terminationWhereSchema).optional(),
      OR: z.array(terminationWhereSchema).optional(),
      NOT: terminationWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      initiatedById: z.union([createUuidWhereSchema(), z.null()]).optional(),

      type: createStringWhereSchema().optional(),
      status: createStringWhereSchema().optional(),
      noticeType: z.union([createStringWhereSchema(), z.null()]).optional(),
      noticeReduction: createStringWhereSchema().optional(),
      reason: z.union([createStringWhereSchema(), z.null()]).optional(),
      justCauseArticle: z.union([createStringWhereSchema(), z.null()]).optional(),

      statusOrder: numberWhereSchema,
      noticeDays: z.union([numberWhereSchema, z.null()]).optional(),
      paidAmount: z.union([numberWhereSchema, z.null()]).optional(),
      baseRemuneration: z.union([numberWhereSchema, z.null()]).optional(),
      fgtsBalance: z.union([numberWhereSchema, z.null()]).optional(),
      accruedVacationPeriods: numberWhereSchema,

      noticeStartDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      lastWorkingDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      terminationDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      projectedEndDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      paymentDueDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      paymentDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),

      user: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
      items: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),
      documents: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Termination Filters and Transform
// =====================

const terminationFilters = {
  searchingFor: z.string().optional(),
  statuses: z
    .array(
      z.enum(Object.values(TERMINATION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status inválido' }),
      }),
    )
    .optional(),
  types: z
    .array(
      z.enum(Object.values(TERMINATION_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de rescisão inválido' }),
      }),
    )
    .optional(),
  userIds: z.array(z.string().uuid({ message: 'Colaborador inválido' })).optional(),
};

const terminationTransform = (data: any) => {
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { reasonNormalized: { contains: normalizeSearchTerm(data.searchingFor.trim()) } },
        { justCauseArticleNormalized: { contains: normalizeSearchTerm(data.searchingFor.trim()) } },
        { user: { nameNormalized: { contains: normalizeSearchTerm(data.searchingFor.trim()) } } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.statuses && Array.isArray(data.statuses) && data.statuses.length > 0) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  if (data.types && Array.isArray(data.types) && data.types.length > 0) {
    andConditions.push({ type: { in: data.types } });
    delete data.types;
  }

  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const terminationGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: terminationWhereSchema.optional(),
    orderBy: terminationOrderBySchema.optional(),
    include: terminationIncludeSchema.optional(),
    ...terminationFilters,
  })
  .transform(terminationTransform);

export const terminationGetByIdSchema = z.object({
  include: terminationIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Rescisão inválida' }),
});

export const terminationQuerySchema = z.object({
  include: terminationIncludeSchema.optional(),
});

export const terminationBatchQuerySchema = z.object({
  include: terminationIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const terminationCreateSchema = z
  .object({
    userId: z.string().uuid({ message: 'Colaborador inválido' }),
    type: z.enum(Object.values(TERMINATION_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de rescisão inválido' }),
    }),
    noticeType: z
      .enum(Object.values(NOTICE_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de aviso prévio inválido' }),
      })
      .nullable()
      .optional(),
    noticeReduction: z
      .enum(Object.values(NOTICE_REDUCTION) as [string, ...string[]], {
        errorMap: () => ({ message: 'redução de aviso prévio inválida' }),
      })
      .optional(),
    noticeStartDate: z.coerce.date().nullable().optional(),
    terminationDate: z.coerce.date().nullable().optional(),
    baseRemuneration: z.coerce
      .number({ invalid_type_error: 'remuneração base inválida' })
      .nonnegative({ message: 'A remuneração base não pode ser negativa' })
      .nullable()
      .optional(),
    fgtsBalance: z.coerce
      .number({ invalid_type_error: 'saldo de FGTS inválido' })
      .nonnegative({ message: 'O saldo de FGTS não pode ser negativo' })
      .nullable()
      .optional(),
    accruedVacationPeriods: z.coerce
      .number({ invalid_type_error: 'períodos de férias vencidas inválidos' })
      .int({ message: 'Períodos de férias vencidas deve ser um número inteiro' })
      .min(0, { message: 'Períodos de férias vencidas não pode ser negativo' })
      .optional(),
    reason: createDescriptionSchema(0, 2000).nullable().optional(),
    justCauseArticle: createDescriptionSchema(0, 200).nullable().optional(),
  })
  .transform(toFormData);

export const terminationUpdateSchema = z
  .object({
    noticeType: z
      .enum(Object.values(NOTICE_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de aviso prévio inválido' }),
      })
      .nullable()
      .optional(),
    noticeReduction: z
      .enum(Object.values(NOTICE_REDUCTION) as [string, ...string[]], {
        errorMap: () => ({ message: 'redução de aviso prévio inválida' }),
      })
      .optional(),
    noticeDays: z.coerce
      .number({ invalid_type_error: 'dias de aviso prévio inválidos' })
      .int({ message: 'Dias de aviso prévio deve ser um número inteiro' })
      .min(0, { message: 'Dias de aviso prévio não pode ser negativo' })
      .nullable()
      .optional(),
    noticeStartDate: z.coerce.date().nullable().optional(),
    lastWorkingDate: z.coerce.date().nullable().optional(),
    terminationDate: z.coerce.date().nullable().optional(),
    paymentDate: z.coerce.date().nullable().optional(),
    paidAmount: z.coerce
      .number({ invalid_type_error: 'valor pago inválido' })
      .nonnegative({ message: 'O valor pago não pode ser negativo' })
      .nullable()
      .optional(),
    baseRemuneration: z.coerce
      .number({ invalid_type_error: 'remuneração base inválida' })
      .nonnegative({ message: 'A remuneração base não pode ser negativa' })
      .nullable()
      .optional(),
    fgtsBalance: z.coerce
      .number({ invalid_type_error: 'saldo de FGTS inválido' })
      .nonnegative({ message: 'O saldo de FGTS não pode ser negativo' })
      .nullable()
      .optional(),
    accruedVacationPeriods: z.coerce
      .number({ invalid_type_error: 'períodos de férias vencidas inválidos' })
      .int({ message: 'Períodos de férias vencidas deve ser um número inteiro' })
      .min(0, { message: 'Períodos de férias vencidas não pode ser negativo' })
      .optional(),
    reason: createDescriptionSchema(0, 2000).nullable().optional(),
    justCauseArticle: createDescriptionSchema(0, 200).nullable().optional(),
  })
  .transform(toFormData);

export const terminationBatchCreateSchema = z.object({
  terminations: z
    .array(terminationCreateSchema)
    .min(1, 'Pelo menos uma rescisão deve ser fornecida'),
});

export const terminationBatchUpdateSchema = z.object({
  terminations: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Rescisão inválida' }),
        data: terminationUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma rescisão deve ser fornecida'),
});

export const terminationBatchDeleteSchema = z.object({
  terminationIds: z
    .array(z.string().uuid({ message: 'Rescisão inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Status Machine / Documents / Items Schemas
// =====================

export const terminationAdvanceSchema = z.object({
  // Target status; when omitted, advances to the next status in the chain.
  status: z
    .enum(Object.values(TERMINATION_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status inválido' }),
    })
    .optional(),
  // Justificativa obrigatória ao cancelar (por que a rescisão não foi concluída).
  reason: createDescriptionSchema(0, 2000).nullable().optional(),
});

export const terminationDocumentUploadSchema = z.object({
  type: z.enum(Object.values(TERMINATION_DOCUMENT_TYPE) as [string, ...string[]], {
    errorMap: () => ({ message: 'tipo de documento inválido' }),
  }),
  note: createDescriptionSchema(0, 1000).nullable().optional(),
});

export const terminationDocumentUpdateSchema = z.object({
  status: z
    .enum(Object.values(TERMINATION_DOCUMENT_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de documento inválido' }),
    })
    .optional(),
  note: createDescriptionSchema(0, 1000).nullable().optional(),
});

export const terminationItemCreateSchema = z
  .object({
    type: z.enum(Object.values(TERMINATION_ITEM_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de verba inválido' }),
    }),
    description: createDescriptionSchema(0, 500).nullable().optional(),
    referenceQuantity: z.coerce.number().nullable().optional(),
    baseValue: z.coerce.number().nullable().optional(),
    // Negative amounts are discounts.
    amount: z.coerce.number({ invalid_type_error: 'valor inválido' }),
  })
  .transform(toFormData);

export const terminationItemUpdateSchema = z
  .object({
    type: z
      .enum(Object.values(TERMINATION_ITEM_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de verba inválido' }),
      })
      .optional(),
    description: createDescriptionSchema(0, 500).nullable().optional(),
    referenceQuantity: z.coerce.number().nullable().optional(),
    baseValue: z.coerce.number().nullable().optional(),
    amount: z.coerce.number({ invalid_type_error: 'valor inválido' }).optional(),
  })
  .transform(toFormData);

// =====================
// Inferred Types
// =====================

export type TerminationGetManyFormData = z.infer<typeof terminationGetManySchema>;
export type TerminationGetByIdFormData = z.infer<typeof terminationGetByIdSchema>;
export type TerminationQueryFormData = z.infer<typeof terminationQuerySchema>;
export type TerminationBatchQueryFormData = z.infer<typeof terminationBatchQuerySchema>;

export type TerminationCreateFormData = z.infer<typeof terminationCreateSchema>;
export type TerminationUpdateFormData = z.infer<typeof terminationUpdateSchema>;

export type TerminationBatchCreateFormData = z.infer<typeof terminationBatchCreateSchema>;
export type TerminationBatchUpdateFormData = z.infer<typeof terminationBatchUpdateSchema>;
export type TerminationBatchDeleteFormData = z.infer<typeof terminationBatchDeleteSchema>;

export type TerminationAdvanceFormData = z.infer<typeof terminationAdvanceSchema>;
export type TerminationDocumentUploadFormData = z.infer<typeof terminationDocumentUploadSchema>;
export type TerminationDocumentUpdateFormData = z.infer<typeof terminationDocumentUpdateSchema>;
export type TerminationItemCreateFormData = z.infer<typeof terminationItemCreateSchema>;
export type TerminationItemUpdateFormData = z.infer<typeof terminationItemUpdateSchema>;

export type TerminationInclude = z.infer<typeof terminationIncludeSchema>;
export type TerminationOrderBy = z.infer<typeof terminationOrderBySchema>;
export type TerminationWhere = z.infer<typeof terminationWhereSchema>;
