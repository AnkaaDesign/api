// src/schemas/medical-exam.ts
// ASO / Exames ocupacionais (Medicina do Trabalho)

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
import { MEDICAL_EXAM_TYPE, MEDICAL_EXAM_STATUS, MEDICAL_EXAM_RESULT } from '@constants';

// =====================
// MedicalExam Include Schema (Second Level Only)
// =====================

export const medicalExamIncludeSchema = z
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
    file: z.boolean().optional(),
    admission: z.boolean().optional(),
    termination: z.boolean().optional(),
  })
  .partial();

// =====================
// MedicalExam OrderBy Schema
// =====================

const medicalExamOrderByFields = {
  id: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  type: orderByDirectionSchema.optional(),
  status: orderByDirectionSchema.optional(),
  statusOrder: orderByDirectionSchema.optional(),
  result: orderByDirectionSchema.optional(),
  scheduledAt: orderByDirectionSchema.optional(),
  examDate: orderByDirectionSchema.optional(),
  expiresAt: orderByDirectionSchema.optional(),
  physicianName: orderByDirectionSchema.optional(),
  clinic: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const medicalExamOrderBySchema = z
  .union([
    z.object(medicalExamOrderByFields).partial(),
    z.array(z.object(medicalExamOrderByFields).partial()),
  ])
  .optional();

// =====================
// MedicalExam Where Schema
// =====================

export const medicalExamWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(medicalExamWhereSchema).optional(),
      OR: z.array(medicalExamWhereSchema).optional(),
      NOT: medicalExamWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      fileId: z.union([createUuidWhereSchema(), z.null()]).optional(),

      type: createStringWhereSchema().optional(),
      status: createStringWhereSchema().optional(),
      result: createStringWhereSchema().optional(),
      physicianName: z.union([createStringWhereSchema(), z.null()]).optional(),
      crm: z.union([createStringWhereSchema(), z.null()]).optional(),
      clinic: z.union([createStringWhereSchema(), z.null()]).optional(),
      notes: z.union([createStringWhereSchema(), z.null()]).optional(),
      restrictions: z.union([createStringWhereSchema(), z.null()]).optional(),

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

      scheduledAt: z.union([createDateWhereSchema(), z.null()]).optional(),
      examDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      expiresAt: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters + Transform
// =====================

const medicalExamFilters = {
  searchingFor: z.string().optional(),
  types: z
    .array(
      z.enum(Object.values(MEDICAL_EXAM_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de exame inválido' }),
      }),
    )
    .optional(),
  statuses: z
    .array(
      z.enum(Object.values(MEDICAL_EXAM_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status de exame inválido' }),
      }),
    )
    .optional(),
  results: z
    .array(
      z.enum(Object.values(MEDICAL_EXAM_RESULT) as [string, ...string[]], {
        errorMap: () => ({ message: 'resultado de exame inválido' }),
      }),
    )
    .optional(),
  userIds: z.array(z.string()).optional(),
};

const medicalExamTransform = (data: any) => {
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
        { physicianName: { contains: searchTerm, mode: 'insensitive' } },
        { clinic: { contains: searchTerm, mode: 'insensitive' } },
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

  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    andConditions.push({ result: { in: data.results } });
    delete data.results;
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

export const medicalExamGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: medicalExamWhereSchema.optional(),
    orderBy: medicalExamOrderBySchema.optional(),
    include: medicalExamIncludeSchema.optional(),
    ...medicalExamFilters,
  })
  .transform(medicalExamTransform);

export const medicalExamGetByIdSchema = z.object({
  include: medicalExamIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Exame inválido' }),
});

// Expiring exams dashboard query (Exames Periódicos): COMPLETED exams whose
// expiresAt is within the next N days — or already past (overdue).
export const medicalExamExpiringSchema = z.object({
  days: z.coerce
    .number()
    .int('O número de dias deve ser um inteiro')
    .min(0, 'O número de dias não pode ser negativo')
    .max(730, 'O número de dias não pode exceder 730')
    .default(60),
});

// =====================
// CRUD Schemas
// =====================

export const medicalExamCreateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }),
  type: z.enum(Object.values(MEDICAL_EXAM_TYPE) as [string, ...string[]], {
    errorMap: () => ({ message: 'tipo de exame inválido' }),
  }),
  status: z
    .enum(Object.values(MEDICAL_EXAM_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de exame inválido' }),
    })
    .default(MEDICAL_EXAM_STATUS.SCHEDULED),
  result: z
    .enum(Object.values(MEDICAL_EXAM_RESULT) as [string, ...string[]], {
      errorMap: () => ({ message: 'resultado de exame inválido' }),
    })
    .default(MEDICAL_EXAM_RESULT.PENDING),
  // Restrições laborais — preenchidas quando result = FIT_WITH_RESTRICTIONS.
  restrictions: z.string().max(2000).nullable().optional(),
  // Periodicidade (meses) do próximo exame periódico. NULL = usa Position/legal default.
  periodicityMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  examDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  physicianName: z.string().max(200).nullable().optional(),
  crm: z.string().max(50).nullable().optional(),
  clinic: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  fileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  // FKs linking an auto-created ASO to its originating admission / termination
  // process (preferred over the legacy userId+type heuristic). Set by the
  // admission/termination services; rarely supplied by clients directly.
  admissionId: z.string().uuid({ message: 'Admissão inválida' }).nullable().optional(),
  terminationId: z.string().uuid({ message: 'Rescisão inválida' }).nullable().optional(),
});

export const medicalExamUpdateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }).optional(),
  type: z
    .enum(Object.values(MEDICAL_EXAM_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de exame inválido' }),
    })
    .optional(),
  status: z
    .enum(Object.values(MEDICAL_EXAM_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de exame inválido' }),
    })
    .optional(),
  result: z
    .enum(Object.values(MEDICAL_EXAM_RESULT) as [string, ...string[]], {
      errorMap: () => ({ message: 'resultado de exame inválido' }),
    })
    .optional(),
  restrictions: z.string().max(2000).nullable().optional(),
  periodicityMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  examDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  physicianName: z.string().max(200).nullable().optional(),
  crm: z.string().max(50).nullable().optional(),
  clinic: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  fileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  admissionId: z.string().uuid({ message: 'Admissão inválida' }).nullable().optional(),
  terminationId: z.string().uuid({ message: 'Rescisão inválida' }).nullable().optional(),
});

export const medicalExamCompleteSchema = z.object({
  examDate: z.coerce.date({ required_error: 'A data do exame é obrigatória' }),
  result: z.enum(Object.values(MEDICAL_EXAM_RESULT) as [string, ...string[]], {
    errorMap: () => ({ message: 'resultado de exame inválido' }),
  }),
  // Obrigatório (via service) quando result = FIT_WITH_RESTRICTIONS.
  restrictions: z.string().max(2000).nullable().optional(),
  // Periodicidade do próximo periódico (meses). Só usada quando type = PERIODIC.
  periodicityMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  physicianName: z.string().max(200).nullable().optional(),
  crm: z.string().max(50).nullable().optional(),
  clinic: z.string().max(200).nullable().optional(),
  fileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
});

export const medicalExamBatchCreateSchema = z.object({
  medicalExams: z.array(medicalExamCreateSchema).min(1, 'Pelo menos um exame deve ser fornecido'),
});

export const medicalExamBatchUpdateSchema = z.object({
  medicalExams: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Exame inválido' }),
        data: medicalExamUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um exame deve ser fornecido'),
});

export const medicalExamBatchDeleteSchema = z.object({
  medicalExamIds: z
    .array(z.string().uuid({ message: 'Exame inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const medicalExamQuerySchema = z.object({
  include: medicalExamIncludeSchema.optional(),
});

export const medicalExamBatchQuerySchema = z.object({
  include: medicalExamIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type MedicalExamGetManyFormData = z.infer<typeof medicalExamGetManySchema>;
export type MedicalExamGetByIdFormData = z.infer<typeof medicalExamGetByIdSchema>;
export type MedicalExamExpiringFormData = z.infer<typeof medicalExamExpiringSchema>;
export type MedicalExamQueryFormData = z.infer<typeof medicalExamQuerySchema>;
export type MedicalExamBatchQueryFormData = z.infer<typeof medicalExamBatchQuerySchema>;
export type MedicalExamCreateFormData = z.infer<typeof medicalExamCreateSchema>;
export type MedicalExamUpdateFormData = z.infer<typeof medicalExamUpdateSchema>;
export type MedicalExamCompleteFormData = z.infer<typeof medicalExamCompleteSchema>;
export type MedicalExamBatchCreateFormData = z.infer<typeof medicalExamBatchCreateSchema>;
export type MedicalExamBatchUpdateFormData = z.infer<typeof medicalExamBatchUpdateSchema>;
export type MedicalExamBatchDeleteFormData = z.infer<typeof medicalExamBatchDeleteSchema>;
export type MedicalExamInclude = z.infer<typeof medicalExamIncludeSchema>;
export type MedicalExamOrderBy = z.infer<typeof medicalExamOrderBySchema>;
export type MedicalExamWhere = z.infer<typeof medicalExamWhereSchema>;
