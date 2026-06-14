// src/schemas/leave.ts
// Afastamentos (Medicina do Trabalho)

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createBooleanWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
} from './common';
import { LEAVE_TYPE, LEAVE_STATUS, INSS_BENEFIT_SPECIES } from '@constants';

// =====================
// Leave Include Schema (Second Level Only)
// =====================

export const leaveIncludeSchema = z
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
    files: z.boolean().optional(),
  })
  .partial();

// =====================
// Leave OrderBy Schema
// =====================

const leaveOrderByFields = {
  id: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  type: orderByDirectionSchema.optional(),
  status: orderByDirectionSchema.optional(),
  statusOrder: orderByDirectionSchema.optional(),
  startDate: orderByDirectionSchema.optional(),
  expectedEndDate: orderByDirectionSchema.optional(),
  actualEndDate: orderByDirectionSchema.optional(),
  returnExamRequired: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const leaveOrderBySchema = z
  .union([z.object(leaveOrderByFields).partial(), z.array(z.object(leaveOrderByFields).partial())])
  .optional();

// =====================
// Leave Where Schema
// =====================

export const leaveWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(leaveWhereSchema).optional(),
      OR: z.array(leaveWhereSchema).optional(),
      NOT: leaveWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),

      type: createStringWhereSchema().optional(),
      status: createStringWhereSchema().optional(),
      cid: z.union([createStringWhereSchema(), z.null()]).optional(),
      inssBenefitNumber: z.union([createStringWhereSchema(), z.null()]).optional(),
      inssBenefitSpecies: z.union([createStringWhereSchema(), z.null()]).optional(),
      notes: z.union([createStringWhereSchema(), z.null()]).optional(),

      returnExamRequired: createBooleanWhereSchema().optional(),

      statusOrder: z
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
        .optional(),

      user: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      files: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      startDate: createDateWhereSchema().optional(),
      expectedEndDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      actualEndDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters + Transform
// =====================

const leaveFilters = {
  searchingFor: z.string().optional(),
  types: z
    .array(
      z.enum(Object.values(LEAVE_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de afastamento inválido' }),
      }),
    )
    .optional(),
  statuses: z
    .array(
      z.enum(Object.values(LEAVE_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status de afastamento inválido' }),
      }),
    )
    .optional(),
  userIds: z.array(z.string()).optional(),
  returnExamRequired: z.boolean().optional(),
};

const leaveTransform = (data: any) => {
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
        { user: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { inssBenefitNumber: { contains: searchTerm, mode: 'insensitive' } },
        { notes: { contains: searchTerm, mode: 'insensitive' } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.types && Array.isArray(data.types) && data.types.length > 0) {
    andConditions.push({ type: { in: data.types } });
    delete data.types;
  }

  if (data.statuses && Array.isArray(data.statuses) && data.statuses.length > 0) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (typeof data.returnExamRequired === 'boolean') {
    andConditions.push({ returnExamRequired: data.returnExamRequired });
    delete data.returnExamRequired;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const leaveGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: leaveWhereSchema.optional(),
    orderBy: leaveOrderBySchema.optional(),
    include: leaveIncludeSchema.optional(),
    ...leaveFilters,
  })
  .transform(leaveTransform);

export const leaveGetByIdSchema = z.object({
  include: leaveIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Afastamento inválido' }),
});

// =====================
// CRUD Schemas
// =====================

export const leaveCreateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }),
  type: z.enum(Object.values(LEAVE_TYPE) as [string, ...string[]], {
    errorMap: () => ({ message: 'tipo de afastamento inválido' }),
  }),
  status: z
    .enum(Object.values(LEAVE_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de afastamento inválido' }),
    })
    .default(LEAVE_STATUS.SCHEDULED),
  startDate: z.coerce.date({ required_error: 'A data de início é obrigatória' }),
  expectedEndDate: z.coerce.date().nullable().optional(),
  actualEndDate: z.coerce.date().nullable().optional(),
  cid: z.string().max(20).nullable().optional(),
  // Espécie estruturada do benefício INSS (preferir sobre o número livre).
  inssBenefitSpecies: z
    .enum(Object.values(INSS_BENEFIT_SPECIES) as [string, ...string[]], {
      errorMap: () => ({ message: 'espécie de benefício INSS inválida' }),
    })
    .nullable()
    .optional(),
  inssBenefitNumber: z.string().max(50).nullable().optional(),
  returnExamRequired: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
  fileIds: z.array(z.string().uuid({ message: 'Arquivo inválido' })).optional(),
});

export const leaveUpdateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }).optional(),
  type: z
    .enum(Object.values(LEAVE_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de afastamento inválido' }),
    })
    .optional(),
  status: z
    .enum(Object.values(LEAVE_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de afastamento inválido' }),
    })
    .optional(),
  startDate: z.coerce.date().optional(),
  expectedEndDate: z.coerce.date().nullable().optional(),
  actualEndDate: z.coerce.date().nullable().optional(),
  cid: z.string().max(20).nullable().optional(),
  inssBenefitSpecies: z
    .enum(Object.values(INSS_BENEFIT_SPECIES) as [string, ...string[]], {
      errorMap: () => ({ message: 'espécie de benefício INSS inválida' }),
    })
    .nullable()
    .optional(),
  inssBenefitNumber: z.string().max(50).nullable().optional(),
  returnExamRequired: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
  fileIds: z.array(z.string().uuid({ message: 'Arquivo inválido' })).optional(),
});

export const leaveFinishSchema = z.object({
  actualEndDate: z.coerce.date({ required_error: 'A data de retorno é obrigatória' }),
});

export const leaveBatchCreateSchema = z.object({
  leaves: z.array(leaveCreateSchema).min(1, 'Pelo menos um afastamento deve ser fornecido'),
});

export const leaveBatchUpdateSchema = z.object({
  leaves: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Afastamento inválido' }),
        data: leaveUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um afastamento deve ser fornecido'),
});

export const leaveBatchDeleteSchema = z.object({
  leaveIds: z
    .array(z.string().uuid({ message: 'Afastamento inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const leaveQuerySchema = z.object({
  include: leaveIncludeSchema.optional(),
});

export const leaveBatchQuerySchema = z.object({
  include: leaveIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type LeaveGetManyFormData = z.infer<typeof leaveGetManySchema>;
export type LeaveGetByIdFormData = z.infer<typeof leaveGetByIdSchema>;
export type LeaveQueryFormData = z.infer<typeof leaveQuerySchema>;
export type LeaveBatchQueryFormData = z.infer<typeof leaveBatchQuerySchema>;
export type LeaveCreateFormData = z.infer<typeof leaveCreateSchema>;
export type LeaveUpdateFormData = z.infer<typeof leaveUpdateSchema>;
export type LeaveFinishFormData = z.infer<typeof leaveFinishSchema>;
export type LeaveBatchCreateFormData = z.infer<typeof leaveBatchCreateSchema>;
export type LeaveBatchUpdateFormData = z.infer<typeof leaveBatchUpdateSchema>;
export type LeaveBatchDeleteFormData = z.infer<typeof leaveBatchDeleteSchema>;
export type LeaveInclude = z.infer<typeof leaveIncludeSchema>;
export type LeaveOrderBy = z.infer<typeof leaveOrderBySchema>;
export type LeaveWhere = z.infer<typeof leaveWhereSchema>;
