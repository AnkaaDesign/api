// vacation.schema.ts
// Férias (Departamento Pessoal) — Part C.
//
// NOTE (ownership): per the Phase-2/Part-C ownership rule, the vacation module
// owns ONLY `modules/human-resources/vacation/**`. To avoid editing the shared
// `src/schemas/index.ts` aggregator, the Férias zod schemas + inferred form-data
// types live HERE (module-local) instead of `src/schemas/vacation.ts`. The
// orchestrator may later relocate them to the global aggregator for web/mobile
// parity; the shapes are intentionally identical to the termination convention.

import { z } from 'zod';
import { VACATION_STATUS } from '../../../../constants';

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

export const vacationIncludeSchema = z
  .object({
    user: relationIncludeSchema.optional(),
    contract: relationIncludeSchema.optional(),
    group: relationIncludeSchema.optional(),
  })
  .partial();

// =====================
// Order By
// =====================

const orderByDirection = z.enum(['asc', 'desc']);

const vacationOrderByFields = z.object({
  id: orderByDirection.optional(),
  status: orderByDirection.optional(),
  acquisitiveStart: orderByDirection.optional(),
  acquisitiveEnd: orderByDirection.optional(),
  concessiveEnd: orderByDirection.optional(),
  startDate: orderByDirection.optional(),
  days: orderByDirection.optional(),
  entitledDays: orderByDirection.optional(),
  paymentDueDate: orderByDirection.optional(),
  paymentDate: orderByDirection.optional(),
  userId: orderByDirection.optional(),
  createdAt: orderByDirection.optional(),
  updatedAt: orderByDirection.optional(),
  user: z.object({ name: orderByDirection.optional() }).optional(),
});

export const vacationOrderBySchema = z
  .union([vacationOrderByFields, z.array(vacationOrderByFields)])
  .optional();

// =====================
// Where
// =====================

const stringWhere = z.union([
  z.string(),
  z.object({
    equals: z.string().optional(),
    in: z.array(z.string()).optional(),
    notIn: z.array(z.string()).optional(),
    contains: z.string().optional(),
    mode: z.enum(['default', 'insensitive']).optional(),
    not: z.string().optional(),
  }),
]);

const numberWhere = z.union([
  z.number(),
  z.object({
    equals: z.number().optional(),
    in: z.array(z.number()).optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    not: z.number().optional(),
  }),
]);

const dateWhere = z.union([
  z.coerce.date(),
  z.object({
    equals: z.coerce.date().optional(),
    lt: z.coerce.date().optional(),
    lte: z.coerce.date().optional(),
    gt: z.coerce.date().optional(),
    gte: z.coerce.date().optional(),
  }),
]);

export const vacationWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(vacationWhereSchema).optional(),
      OR: z.array(vacationWhereSchema).optional(),
      NOT: vacationWhereSchema.optional(),

      id: stringWhere.optional(),
      userId: stringWhere.optional(),
      contractId: z.union([stringWhere, z.null()]).optional(),
      groupId: z.union([stringWhere, z.null()]).optional(),
      status: stringWhere.optional(),
      entitledDays: numberWhere.optional(),
      days: numberWhere.optional(),
      unjustifiedAbsencesInPeriod: numberWhere.optional(),

      acquisitiveStart: dateWhere.optional(),
      acquisitiveEnd: dateWhere.optional(),
      concessiveEnd: z.union([dateWhere, z.null()]).optional(),
      startDate: z.union([dateWhere, z.null()]).optional(),
      paymentDueDate: z.union([dateWhere, z.null()]).optional(),
      paymentDate: z.union([dateWhere, z.null()]).optional(),
      createdAt: dateWhere.optional(),
      updatedAt: dateWhere.optional(),

      isDouble: z.boolean().optional(),

      user: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Filters + transform
// =====================

const vacationFilters = {
  searchingFor: z.string().optional(),
  statuses: z
    .array(z.enum(Object.values(VACATION_STATUS) as [string, ...string[]]))
    .optional(),
  userIds: z.array(z.string().uuid({ message: 'Colaborador inválido' })).optional(),
};

const paginationShape = {
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  take: z.coerce.number().int().positive().max(100).optional(),
};

const vacationTransform = (data: any) => {
  if (data.take && !data.limit) data.limit = data.take;
  delete data.take;

  const and: any[] = Array.isArray(data.AND) ? [...data.AND] : data.AND ? [data.AND] : [];

  if (data.searchingFor) {
    and.push({
      OR: [
        { notes: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        { user: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
      ],
    });
    delete data.searchingFor;
  }
  if (Array.isArray(data.statuses) && data.statuses.length > 0) {
    and.push({ status: { in: data.statuses } });
    delete data.statuses;
  }
  if (Array.isArray(data.userIds) && data.userIds.length > 0) {
    and.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (and.length > 0) {
    const where = data.where ?? {};
    where.AND = [...(where.AND ?? []), ...and];
    data.where = where;
  }
  return data;
};

// =====================
// Query schemas
// =====================

export const vacationGetManySchema = z
  .object({
    ...paginationShape,
    where: vacationWhereSchema.optional(),
    orderBy: vacationOrderBySchema.optional(),
    include: vacationIncludeSchema.optional(),
    ...vacationFilters,
  })
  .transform(vacationTransform);

export const vacationQuerySchema = z.object({
  include: vacationIncludeSchema.optional(),
});

export const vacationBatchQuerySchema = z.object({
  include: vacationIncludeSchema.optional(),
});

// =====================
// CRUD schemas (modelo FLAT: uma Vacation = uma tomada single-period)
// =====================

// Dias de gozo DESTA tomada (1..30). O guard de over-allocation (Σdias ≤
// gozoEntitled) é aplicado no service por grupo aquisitivo.
const gozoDaysSchema = z.coerce
  .number({ invalid_type_error: 'dias inválidos' })
  .int({ message: 'Dias deve ser inteiro' })
  .min(1, { message: 'A tomada deve ter ao menos 1 dia' })
  .max(30, { message: 'Uma tomada não pode exceder 30 dias' });

export const vacationCreateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }),
  // When omitted, the service derives the período aquisitivo from the current
  // contract's admissionDate.
  contractId: z.string().uuid({ message: 'Vínculo inválido' }).nullable().optional(),
  acquisitiveStart: z.coerce.date().optional(),
  acquisitiveEnd: z.coerce.date().optional(),
  // Início do gozo desta tomada — OBRIGATÓRIO (cria já agendada). Passado é
  // permitido (registro retroativo); ">= hoje" não é exigido.
  startDate: z.coerce.date({
    required_error: 'A data de início do gozo é obrigatória',
    invalid_type_error: 'data de início inválida',
  }),
  // Dias de gozo desta tomada.
  days: gozoDaysSchema,
  unjustifiedAbsencesInPeriod: z.coerce
    .number({ invalid_type_error: 'faltas injustificadas inválidas' })
    .int()
    .min(0, { message: 'Faltas não pode ser negativo' })
    .optional(),
  abonoPecuniarioDays: z.coerce
    .number({ invalid_type_error: 'dias de abono inválidos' })
    .int()
    .min(0, { message: 'Abono não pode ser negativo' })
    .max(10, { message: 'O abono pecuniário é limitado a 10 dias (art. 143 CLT)' })
    .optional(),
  soldThird: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const vacationUpdateSchema = z.object({
  startDate: z.coerce.date({ invalid_type_error: 'data de início inválida' }).nullable().optional(),
  days: gozoDaysSchema.optional(),
  unjustifiedAbsencesInPeriod: z.coerce.number().int().min(0).optional(),
  abonoPecuniarioDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(10, { message: 'O abono pecuniário é limitado a 10 dias (art. 143 CLT)' })
    .optional(),
  soldThird: z.boolean().optional(),
  acquisitiveStart: z.coerce.date().optional(),
  acquisitiveEnd: z.coerce.date().optional(),
  paymentDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const vacationBatchCreateSchema = z.object({
  vacations: z.array(vacationCreateSchema).min(1, 'Pelo menos um registro deve ser fornecido'),
});

export const vacationBatchUpdateSchema = z.object({
  vacations: z
    .array(z.object({ id: z.string().uuid(), data: vacationUpdateSchema }))
    .min(1, 'Pelo menos um registro deve ser fornecido'),
});

export const vacationBatchDeleteSchema = z.object({
  vacationIds: z.array(z.string().uuid()).min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Status machine
// =====================

export const vacationAdvanceSchema = z.object({
  status: z.enum(Object.values(VACATION_STATUS) as [string, ...string[]]).optional(),
});

// =====================
// Period balance query — GET /vacations/period-balance
// =====================

export const vacationPeriodBalanceSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }),
  acquisitiveStart: z.coerce.date({ invalid_type_error: 'data inválida' }),
  acquisitiveEnd: z.coerce.date({ invalid_type_error: 'data inválida' }),
});

// =====================
// Inferred types
// =====================

export type VacationGetManyFormData = z.infer<typeof vacationGetManySchema>;
export type VacationQueryFormData = z.infer<typeof vacationQuerySchema>;
export type VacationBatchQueryFormData = z.infer<typeof vacationBatchQuerySchema>;
export type VacationCreateFormData = z.infer<typeof vacationCreateSchema>;
export type VacationUpdateFormData = z.infer<typeof vacationUpdateSchema>;
export type VacationBatchCreateFormData = z.infer<typeof vacationBatchCreateSchema>;
export type VacationBatchUpdateFormData = z.infer<typeof vacationBatchUpdateSchema>;
export type VacationBatchDeleteFormData = z.infer<typeof vacationBatchDeleteSchema>;
export type VacationAdvanceFormData = z.infer<typeof vacationAdvanceSchema>;
export type VacationPeriodBalanceFormData = z.infer<typeof vacationPeriodBalanceSchema>;
export type VacationInclude = z.infer<typeof vacationIncludeSchema>;
