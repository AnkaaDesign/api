import { z } from 'zod';
import { orderByDirectionSchema, normalizeOrderBy } from './common';
import type { Goal } from '@types';
import { GOAL_METRIC, SECTOR_SCOPED_GOAL_METRICS } from '@constants';

const goalMetricEnum = z.enum(Object.values(GOAL_METRIC) as [string, ...string[]], {
  errorMap: () => ({ message: 'métrica inválida' }),
});

const monthSchema = z.coerce.number().int().min(1, 'mês deve ser entre 1 e 12').max(12, 'mês deve ser entre 1 e 12');
const yearSchema = z.coerce.number().int().min(2000, 'ano inválido').max(2100, 'ano inválido');

// =====================
// Include Schema
// =====================

export const goalIncludeSchema = z
  .object({
    sector: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              leader: z.boolean().optional(),
              users: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .optional();

// =====================
// Order By Schema
// =====================

export const goalOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      metric: orderByDirectionSchema.optional(),
      year: orderByDirectionSchema.optional(),
      month: orderByDirectionSchema.optional(),
      targetValue: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          metric: orderByDirectionSchema.optional(),
          year: orderByDirectionSchema.optional(),
          month: orderByDirectionSchema.optional(),
          targetValue: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const goalWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(goalWhereSchema).optional(),
      OR: z.array(goalWhereSchema).optional(),
      NOT: goalWhereSchema.optional(),

      id: z.union([z.string(), z.object({ equals: z.string().optional(), in: z.array(z.string()).optional() })]).optional(),

      metric: z
        .union([
          goalMetricEnum,
          z.object({
            equals: goalMetricEnum.optional(),
            in: z.array(goalMetricEnum).optional(),
            notIn: z.array(goalMetricEnum).optional(),
          }),
        ])
        .optional(),

      year: z
        .union([
          z.number().int(),
          z.object({
            equals: z.number().int().optional(),
            in: z.array(z.number().int()).optional(),
            gte: z.number().int().optional(),
            lte: z.number().int().optional(),
          }),
        ])
        .optional(),

      month: z
        .union([
          z.number().int(),
          z.object({
            equals: z.number().int().optional(),
            in: z.array(z.number().int()).optional(),
            gte: z.number().int().optional(),
            lte: z.number().int().optional(),
          }),
        ])
        .optional(),

      sectorId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            not: z.union([z.string(), z.null()]).optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .object({
          equals: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
        })
        .optional(),
    })
    .optional(),
);

// =====================
// Convenience Filters
// =====================

const goalFilters = {
  metric: z.union([goalMetricEnum, z.array(goalMetricEnum)]).optional(),
  year: yearSchema.optional(),
  month: monthSchema.optional(),
  sectorId: z.string().uuid('Setor inválido').nullable().optional(),
};

// =====================
// Transform
// =====================

const goalTransform = (data: any): any => {
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];
  const { metric, year, month, sectorId } = data;

  if (metric !== undefined) {
    andConditions.push({ metric: Array.isArray(metric) ? { in: metric } : metric });
  }
  if (year !== undefined) {
    andConditions.push({ year });
  }
  if (month !== undefined) {
    andConditions.push({ month });
  }
  if (sectorId !== undefined) {
    andConditions.push({ sectorId });
  }

  if (andConditions.length > 0) {
    if (data.where) {
      data.where = { AND: [...(data.where.AND || [data.where]), ...andConditions] };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Strip convenience filters so they don't leak to Prisma.
  delete data.metric;
  delete data.year;
  delete data.month;
  delete data.sectorId;

  return data;
};

// =====================
// Query Schema (GET /goals)
// =====================

export const goalGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
    take: z.coerce.number().int().positive().max(500).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    where: goalWhereSchema.optional(),
    orderBy: goalOrderBySchema.optional(),
    include: goalIncludeSchema.optional(),

    ...goalFilters,
  })
  .transform(goalTransform);

export const goalQuerySchema = z.object({
  include: goalIncludeSchema.optional(),
});

export const goalGetByIdSchema = z.object({
  include: goalIncludeSchema.optional(),
  id: z.string().uuid('Meta inválida'),
});

// =====================
// CRUD Schemas
// =====================

const goalBaseShape = {
  metric: goalMetricEnum,
  year: yearSchema,
  month: monthSchema,
  targetValue: z.coerce
    .number({ invalid_type_error: 'Valor da meta inválido' })
    .nonnegative('Valor da meta não pode ser negativo'),
  sectorId: z.string().uuid('Setor inválido').nullable().optional(),
};

const requireSectorForScopedMetrics = (data: any, ctx: z.RefinementCtx) => {
  const requiresSector = (SECTOR_SCOPED_GOAL_METRICS as readonly string[]).includes(data.metric);
  if (requiresSector && !data.sectorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sectorId'],
      message: 'Setor é obrigatório para esta métrica',
    });
  }
  if (!requiresSector && data.sectorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sectorId'],
      message: 'Esta métrica não é por setor',
    });
  }
};

export const goalCreateSchema = z.object(goalBaseShape).superRefine(requireSectorForScopedMetrics);

export const goalUpdateSchema = z.object({
  targetValue: z.coerce
    .number({ invalid_type_error: 'Valor da meta inválido' })
    .nonnegative('Valor da meta não pode ser negativo')
    .optional(),
});

// =====================
// Batch Operations
// =====================

export const goalBatchCreateSchema = z.object({
  goals: z.array(goalCreateSchema).min(1, 'Pelo menos uma meta deve ser fornecida'),
});

export const goalBatchUpdateSchema = z.object({
  goals: z
    .array(
      z.object({
        id: z.string().uuid('Meta inválida'),
        data: goalUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma meta deve ser fornecida'),
});

export const goalBatchDeleteSchema = z.object({
  goalIds: z.array(z.string().uuid('Meta inválida')).min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Bulk Year Upsert (the modal "save 12 months" flow)
// =====================

export const goalUpsertYearSchema = z
  .object({
    metric: goalMetricEnum,
    year: yearSchema,
    sectorId: z.string().uuid('Setor inválido').nullable().optional(),
    values: z
      .array(
        z.object({
          month: monthSchema,
          targetValue: z.coerce
            .number({ invalid_type_error: 'Valor da meta inválido' })
            .nonnegative('Valor da meta não pode ser negativo')
            .nullable(),
        }),
      )
      .min(1, 'Pelo menos um mês deve ser informado')
      .max(12, 'No máximo 12 meses')
      .refine(
        values => {
          const months = values.map(v => v.month);
          return new Set(months).size === months.length;
        },
        { message: 'Meses duplicados não são permitidos' },
      ),
  })
  .superRefine((data, ctx) => {
    const requiresSector = (SECTOR_SCOPED_GOAL_METRICS as readonly string[]).includes(data.metric);
    if (requiresSector && !data.sectorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectorId'],
        message: 'Setor é obrigatório para esta métrica',
      });
    }
    if (!requiresSector && data.sectorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectorId'],
        message: 'Esta métrica não é por setor',
      });
    }
  });

export const goalDeleteRowSchema = z
  .object({
    metric: goalMetricEnum,
    year: yearSchema,
    sectorId: z.string().uuid('Setor inválido').nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const requiresSector = (SECTOR_SCOPED_GOAL_METRICS as readonly string[]).includes(data.metric);
    if (requiresSector && !data.sectorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectorId'],
        message: 'Setor é obrigatório para esta métrica',
      });
    }
  });

// =====================
// Inferred Types
// =====================

export type GoalGetManyFormData = z.infer<typeof goalGetManySchema>;
export type GoalGetByIdFormData = z.infer<typeof goalGetByIdSchema>;
export type GoalCreateFormData = z.infer<typeof goalCreateSchema>;
export type GoalUpdateFormData = z.infer<typeof goalUpdateSchema>;
export type GoalBatchCreateFormData = z.infer<typeof goalBatchCreateSchema>;
export type GoalBatchUpdateFormData = z.infer<typeof goalBatchUpdateSchema>;
export type GoalBatchDeleteFormData = z.infer<typeof goalBatchDeleteSchema>;
export type GoalQueryFormData = z.infer<typeof goalQuerySchema>;
export type GoalUpsertYearFormData = z.infer<typeof goalUpsertYearSchema>;
export type GoalDeleteRowFormData = z.infer<typeof goalDeleteRowSchema>;

export type GoalInclude = z.infer<typeof goalIncludeSchema>;
export type GoalOrderBy = z.infer<typeof goalOrderBySchema>;
export type GoalWhere = z.infer<typeof goalWhereSchema>;

// Reference Goal to silence unused-import warnings when the file is imported via @types.
export type _GoalEntity = Goal;
