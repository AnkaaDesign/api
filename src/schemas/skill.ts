// packages/schemas/src/skill.ts
//
// Zod schemas for the new Skill-Assessment domain (Skill / Topic / TopicLevel /
// Assessment / AssessmentEntry / AssessmentResponse).
//
// Conventions mirrored from api/src/schemas/item.ts:
//   - <entity>WhereSchema, <entity>OrderBySchema, <entity>IncludeSchema
//   - <entity>GetManySchema (.transform): page/limit, where, orderBy, include,
//     plus convenience filters (searchingFor, isActive, status, sectorId, ...)
//   - <entity>CreateSchema / <entity>UpdateSchema
//   - <entity>BatchCreateSchema / BatchUpdateSchema / BatchDeleteSchema
//   - <entity>QuerySchema (?include= for single-entity endpoints)

import { z } from 'zod';
import { orderByDirectionSchema, normalizeOrderBy, createMapToFormDataHelper } from './common';
import type {
  Skill,
  Topic,
  Assessment,
  AssessmentEntry,
  SkillUpdateFormData,
  TopicUpdateFormData,
  AssessmentUpdateFormData,
  AssessmentEntryUpdateFormData,
} from '@types';

// =====================
// Enum schemas
// =====================

export const assessmentStatusSchema = z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']);
export const assessmentEntryStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'SUBMITTED']);

// =====================
// Common reusable shapes
// =====================

const uuidFilter = z
  .union([
    z.string().uuid(),
    z.object({
      equals: z.string().uuid().optional(),
      not: z.string().uuid().optional(),
      in: z.array(z.string().uuid()).optional(),
      notIn: z.array(z.string().uuid()).optional(),
    }),
  ])
  .optional();

const stringFilter = z
  .union([
    z.string(),
    z.object({
      equals: z.string().optional(),
      not: z.string().optional(),
      contains: z.string().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      in: z.array(z.string()).optional(),
      notIn: z.array(z.string()).optional(),
      mode: z.enum(['default', 'insensitive']).optional(),
    }),
  ])
  .optional();

const boolFilter = z
  .union([
    z.boolean(),
    z.object({
      equals: z.boolean().optional(),
      not: z.boolean().optional(),
    }),
  ])
  .optional();

const dateFilter = z
  .union([
    z.coerce.date(),
    z.object({
      equals: z.coerce.date().optional(),
      not: z.coerce.date().optional(),
      gt: z.coerce.date().optional(),
      gte: z.coerce.date().optional(),
      lt: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    }),
  ])
  .optional();

const intFilter = z
  .union([
    z.coerce.number().int(),
    z.object({
      equals: z.coerce.number().int().optional(),
      not: z.coerce.number().int().optional(),
      gt: z.coerce.number().int().optional(),
      gte: z.coerce.number().int().optional(),
      lt: z.coerce.number().int().optional(),
      lte: z.coerce.number().int().optional(),
      in: z.array(z.coerce.number().int()).optional(),
      notIn: z.array(z.coerce.number().int()).optional(),
    }),
  ])
  .optional();

/**
 * If a nested object (typically `where`) was JSON-encoded by the client
 * (web's `paramsSerializer` workaround), parse it before validation.
 * See: web/src/api-client/axiosClient.ts (paramsSerializer rule).
 */
const maybeParseJson = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    value =>
      typeof value === 'string'
        ? (() => {
            try {
              return JSON.parse(value);
            } catch {
              return value;
            }
          })()
        : value,
    schema,
  );

// =====================
// Include schemas
// =====================

export const topicLevelIncludeSchema = z
  .object({
    topic: z.boolean().optional(),
  })
  .optional();

export const topicIncludeSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      skill: z.boolean().optional(),
      levels: z
        .union([z.boolean(), z.object({ include: topicLevelIncludeSchema })])
        .optional(),
      assessmentTopics: z.boolean().optional(),
      responses: z.boolean().optional(),
      _count: z
        .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
        .optional(),
    })
    .optional(),
);

export const skillIncludeSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      topics: z.union([z.boolean(), z.object({ include: topicIncludeSchema })]).optional(),
      assessmentSkills: z.boolean().optional(),
      _count: z
        .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
        .optional(),
    })
    .optional(),
);

export const assessmentEntryIncludeSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      assessment: z.boolean().optional(),
      evaluatee: z
        .union([z.boolean(), z.object({ include: z.record(z.any()).optional() })])
        .optional(),
      evaluator: z
        .union([z.boolean(), z.object({ include: z.record(z.any()).optional() })])
        .optional(),
      responses: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                // topic can be a plain boolean OR pull its parent skill (used by
                // the stats drill-down to label/sort by competência).
                topic: z
                  .union([
                    z.boolean(),
                    z.object({ include: z.object({ skill: z.boolean().optional() }).optional() }),
                  ])
                  .optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      _count: z
        .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
        .optional(),
    })
    .optional(),
);

export const assessmentIncludeSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      createdBy: z
        .union([z.boolean(), z.object({ include: z.record(z.any()).optional() })])
        .optional(),
      sectors: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                sector: z.any().optional(),
                appraiser: z.any().optional(),
                evaluatees: z
                  .union([z.boolean(), z.object({ include: z.record(z.any()).optional() })])
                  .optional(),
                _count: z
                  .union([
                    z.boolean(),
                    z.object({ select: z.record(z.boolean()).optional() }),
                  ])
                  .optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      skills: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                skill: z
                  .union([z.boolean(), z.object({ include: skillIncludeSchema })])
                  .optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      topics: z
        .union([
          z.boolean(),
          z.object({
            include: z
              .object({
                topic: z
                  .union([z.boolean(), z.object({ include: topicIncludeSchema })])
                  .optional(),
              })
              .optional(),
          }),
        ])
        .optional(),
      entries: z
        .union([z.boolean(), z.object({ include: assessmentEntryIncludeSchema })])
        .optional(),
      _count: z
        .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
        .optional(),
    })
    .optional(),
);

// =====================
// OrderBy schemas
// =====================

const buildOrderBySchema = (fields: string[]) => {
  const shape: Record<string, z.ZodOptional<typeof orderByDirectionSchema>> = {};
  for (const f of fields) shape[f] = orderByDirectionSchema.optional();
  const object = z.object(shape);
  return z.union([object, z.array(object.partial())]).optional();
};

export const skillOrderBySchema = buildOrderBySchema([
  'id',
  'name',
  'order',
  'createdAt',
  'updatedAt',
]);

// Topics support nested ordering by their parent competency (skill) — e.g.
// `[{ skill: { order } }, { order }]` to sort by competency order then topic
// order. A plain field list (buildOrderBySchema) would strip the `skill` key.
const topicOrderByObject = z.object({
  id: orderByDirectionSchema.optional(),
  skillId: orderByDirectionSchema.optional(),
  order: orderByDirectionSchema.optional(),
  title: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
  skill: z
    .object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      order: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial()
    .optional(),
});

export const topicOrderBySchema = z
  .union([topicOrderByObject, z.array(topicOrderByObject.partial())])
  .optional();

export const assessmentOrderBySchema = buildOrderBySchema([
  'id',
  'name',
  'status',
  'periodStart',
  'periodEnd',
  'createdAt',
  'updatedAt',
]);

export const assessmentEntryOrderBySchema = buildOrderBySchema([
  'id',
  'status',
  'startedAt',
  'submittedAt',
  'createdAt',
  'updatedAt',
]);

// =====================
// Where schemas
// =====================

export const skillWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(skillWhereSchema).optional(),
      OR: z.array(skillWhereSchema).optional(),
      NOT: skillWhereSchema.optional(),
      id: uuidFilter,
      name: stringFilter,
      order: intFilter,
      isActive: boolFilter,
      deletedAt: z
        .union([
          z.null(),
          dateFilter,
          z.object({ not: z.null().optional() }),
        ])
        .optional(),
      createdAt: dateFilter,
      updatedAt: dateFilter,
    })
    .optional(),
);

export const topicWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(topicWhereSchema).optional(),
      OR: z.array(topicWhereSchema).optional(),
      NOT: topicWhereSchema.optional(),
      id: uuidFilter,
      skillId: uuidFilter,
      order: intFilter,
      title: stringFilter,
      isActive: boolFilter,
      deletedAt: z.union([z.null(), dateFilter, z.object({ not: z.null().optional() })]).optional(),
      createdAt: dateFilter,
      updatedAt: dateFilter,
    })
    .optional(),
);

export const assessmentWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(assessmentWhereSchema).optional(),
      OR: z.array(assessmentWhereSchema).optional(),
      NOT: assessmentWhereSchema.optional(),
      id: uuidFilter,
      name: stringFilter,
      status: z
        .union([assessmentStatusSchema, z.object({ in: z.array(assessmentStatusSchema).optional() })])
        .optional(),
      createdById: uuidFilter,
      periodStart: dateFilter,
      periodEnd: dateFilter,
      deletedAt: z.union([z.null(), dateFilter, z.object({ not: z.null().optional() })]).optional(),
      createdAt: dateFilter,
      updatedAt: dateFilter,
    })
    .optional(),
);

export const assessmentEntryWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(assessmentEntryWhereSchema).optional(),
      OR: z.array(assessmentEntryWhereSchema).optional(),
      NOT: assessmentEntryWhereSchema.optional(),
      id: uuidFilter,
      assessmentId: uuidFilter,
      evaluateeId: uuidFilter,
      evaluatorId: uuidFilter,
      status: z
        .union([
          assessmentEntryStatusSchema,
          z.object({ in: z.array(assessmentEntryStatusSchema).optional() }),
        ])
        .optional(),
      // Relation filters used by the stats drill-down: exclude dismissed
      // evaluatees, narrow by sector/position, and scope by topic/skill/score.
      // Kept permissive (Prisma validates the concrete shape) so the modal's
      // `evaluatee.is` / `responses.some` filters reach the query instead of
      // being silently stripped.
      evaluatee: z.record(z.any()).optional(),
      responses: z.record(z.any()).optional(),
      deletedAt: z.union([z.null(), dateFilter, z.object({ not: z.null().optional() })]).optional(),
      createdAt: dateFilter,
      updatedAt: dateFilter,
    })
    .optional(),
);

// =====================
// GetMany schemas (with convenience-filter transforms)
// =====================

const paginationFields = {
  page: z.coerce.number().int().min(0).default(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(20).optional(),
  take: z.coerce.number().int().positive().max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
};

// Skill and Topic are bounded catalogues — the campaign-create form needs to
// fetch them all at once to render the grouped multi-select. Raise the cap to
// 1000 for these two entities only.
const catalogPaginationFields = {
  page: z.coerce.number().int().min(0).default(1).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
  take: z.coerce.number().int().positive().max(1000).optional(),
  skip: z.coerce.number().int().min(0).optional(),
};

const baseTransform = (data: any) => {
  if (data.orderBy) data.orderBy = normalizeOrderBy(data.orderBy);
  if (data.take && !data.limit) data.limit = data.take;
  delete data.take;
  return data;
};

export const skillGetManySchema = z
  .object({
    ...catalogPaginationFields,
    where: maybeParseJson(skillWhereSchema).optional(),
    orderBy: skillOrderBySchema,
    include: skillIncludeSchema,
    // convenience
    searchingFor: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { searchingFor, isActive } = data;
    const andConditions: any[] = [];
    if (searchingFor) {
      andConditions.push({
        OR: [
          { name: { contains: searchingFor, mode: 'insensitive' } },
          { description: { contains: searchingFor, mode: 'insensitive' } },
        ],
      });
    }
    if (typeof isActive === 'boolean') {
      andConditions.push({ isActive });
    }
    if (andConditions.length) {
      data.where = data.where
        ? { AND: [...(data.where.AND ?? [data.where]), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    }
    return data;
  });

export const topicGetManySchema = z
  .object({
    ...catalogPaginationFields,
    where: maybeParseJson(topicWhereSchema).optional(),
    orderBy: topicOrderBySchema,
    include: topicIncludeSchema,
    // convenience
    searchingFor: z.string().optional(),
    skillId: z.string().uuid().optional(),
    skillIds: z.array(z.string().uuid()).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { searchingFor, skillId, skillIds, isActive } = data;
    const andConditions: any[] = [];
    if (searchingFor) {
      andConditions.push({
        OR: [
          { title: { contains: searchingFor, mode: 'insensitive' } },
          { description: { contains: searchingFor, mode: 'insensitive' } },
        ],
      });
    }
    if (skillId) andConditions.push({ skillId });
    if (skillIds?.length) andConditions.push({ skillId: { in: skillIds } });
    if (typeof isActive === 'boolean') andConditions.push({ isActive });
    if (andConditions.length) {
      data.where = data.where
        ? { AND: [...(data.where.AND ?? [data.where]), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    }
    return data;
  });

export const assessmentGetManySchema = z
  .object({
    ...paginationFields,
    where: maybeParseJson(assessmentWhereSchema).optional(),
    orderBy: assessmentOrderBySchema,
    include: assessmentIncludeSchema,
    // convenience
    searchingFor: z.string().optional(),
    status: z
      .union([assessmentStatusSchema, z.array(assessmentStatusSchema)])
      .optional(),
    sectorId: z.string().uuid().optional(),
    sectorIds: z.array(z.string().uuid()).optional(),
    createdById: z.string().uuid().optional(),
    periodStart: z
      .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
      .optional(),
    periodEnd: z
      .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
      .optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { searchingFor, status, sectorId, sectorIds, createdById, periodStart, periodEnd } = data;
    const andConditions: any[] = [];
    if (searchingFor) {
      andConditions.push({
        OR: [
          { name: { contains: searchingFor, mode: 'insensitive' } },
          { description: { contains: searchingFor, mode: 'insensitive' } },
        ],
      });
    }
    if (status) {
      andConditions.push({ status: Array.isArray(status) ? { in: status } : status });
    }
    if (sectorId) {
      andConditions.push({ sectors: { some: { sectorId } } });
    }
    if (sectorIds?.length) {
      andConditions.push({ sectors: { some: { sectorId: { in: sectorIds } } } });
    }
    if (createdById) andConditions.push({ createdById });
    if (periodStart) andConditions.push({ periodStart });
    if (periodEnd) andConditions.push({ periodEnd });
    if (andConditions.length) {
      data.where = data.where
        ? { AND: [...(data.where.AND ?? [data.where]), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    }
    return data;
  });

export const assessmentEntryGetManySchema = z
  .object({
    ...paginationFields,
    where: maybeParseJson(assessmentEntryWhereSchema).optional(),
    orderBy: assessmentEntryOrderBySchema,
    include: assessmentEntryIncludeSchema,
    // convenience
    status: z
      .union([assessmentEntryStatusSchema, z.array(assessmentEntryStatusSchema)])
      .optional(),
    assessmentId: z.string().uuid().optional(),
    evaluatorId: z.union([z.string().uuid(), z.literal('me')]).optional(),
    evaluateeId: z.string().uuid().optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { status, assessmentId, evaluatorId, evaluateeId } = data;
    const andConditions: any[] = [];
    if (status) {
      andConditions.push({ status: Array.isArray(status) ? { in: status } : status });
    }
    if (assessmentId) andConditions.push({ assessmentId });
    // evaluatorId === 'me' is resolved by the controller using current user id.
    if (evaluatorId && evaluatorId !== 'me') andConditions.push({ evaluatorId });
    if (evaluateeId) andConditions.push({ evaluateeId });
    if (andConditions.length) {
      data.where = data.where
        ? { AND: [...(data.where.AND ?? [data.where]), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    }
    return data;
  });

// =====================
// Query (?include=) schemas for single-entity endpoints
// =====================

export const skillQuerySchema = z.object({ include: skillIncludeSchema });
export const topicQuerySchema = z.object({ include: topicIncludeSchema });
export const assessmentQuerySchema = z.object({ include: assessmentIncludeSchema });
export const assessmentEntryQuerySchema = z.object({ include: assessmentEntryIncludeSchema });

// =====================
// CRUD: Skill
// =====================

export const skillCreateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(120),
  description: z.string().max(2000).nullable().optional(),
  order: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean().default(true).optional(),
});

export const skillUpdateSchema = skillCreateSchema.partial();

export const skillBatchCreateSchema = z.object({
  skills: z.array(skillCreateSchema).min(1),
});

export const skillBatchUpdateSchema = z.object({
  skills: z
    .array(
      z.object({
        id: z.string().uuid(),
        data: skillUpdateSchema,
      }),
    )
    .min(1),
});

export const skillBatchDeleteSchema = z.object({
  skillIds: z.array(z.string().uuid()).min(1),
});

// =====================
// CRUD: Topic
// =====================

export const topicLevelFormSchema = z.object({
  score: z.coerce.number().int().min(0).max(5),
  name: z.string().min(1, 'Nome do nível é obrigatório').max(120),
  description: z.string().min(1, 'Descrição é obrigatória').max(2000),
});

export const topicCreateSchema = z.object({
  skillId: z.string().uuid('Skill inválido'),
  order: z.coerce.number().int().min(0).max(9999),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  counterBehaviors: z.string().min(1).max(2000),
  isActive: z.boolean().default(true).optional(),
  levels: z.array(topicLevelFormSchema).max(6).optional(),
});

export const topicUpdateSchema = z
  .object({
    skillId: z.string().uuid().optional(),
    order: z.coerce.number().int().min(0).max(9999).optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2000).optional(),
    counterBehaviors: z.string().min(1).max(2000).optional(),
    isActive: z.boolean().optional(),
  });

export const topicLevelsUpsertSchema = z.object({
  levels: z
    .array(topicLevelFormSchema)
    .min(1, 'Pelo menos um nível')
    .max(6, 'No máximo 6 níveis (score 0..5)')
    .refine(arr => {
      const scores = arr.map(l => l.score);
      return new Set(scores).size === scores.length;
    }, 'Scores duplicados não são permitidos'),
});

export const topicBatchCreateSchema = z.object({
  topics: z.array(topicCreateSchema).min(1),
});

export const topicBatchUpdateSchema = z.object({
  topics: z
    .array(z.object({ id: z.string().uuid(), data: topicUpdateSchema }))
    .min(1),
});

export const topicBatchDeleteSchema = z.object({
  topicIds: z.array(z.string().uuid()).min(1),
});

// =====================
// CRUD: Assessment
// =====================

// Per-sector campaign configuration. `appraiserId === null` means "use the
// sector's leader at open-time". `evaluateeIds` is the explicit list of users
// who will become AssessmentEntry rows when the campaign opens.
export const assessmentSectorConfigSchema = z
  .object({
    sectorId: z.string().uuid(),
    appraiserId: z.string().uuid().nullable().optional(),
    evaluateeIds: z.array(z.string().uuid()).default([]),
  })
  .refine(
    d => !d.appraiserId || !d.evaluateeIds.includes(d.appraiserId),
    {
      message: 'O avaliador não pode estar na lista de avaliados do mesmo setor',
      path: ['evaluateeIds'],
    },
  );

export const assessmentCreateSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório').max(200),
    description: z.string().max(2000).nullable().optional(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    sectors: z.array(assessmentSectorConfigSchema).min(1, 'Selecione ao menos um setor'),
    topicIds: z.array(z.string().uuid()).optional(),
    skillIds: z.array(z.string().uuid()).optional(),
  })
  .refine(d => d.periodEnd >= d.periodStart, {
    message: 'Período final deve ser maior ou igual ao inicial',
    path: ['periodEnd'],
  })
  .refine(d => (d.topicIds?.length ?? 0) + (d.skillIds?.length ?? 0) > 0, {
    message: 'Selecione ao menos um tópico ou skill',
    path: ['topicIds'],
  });

export const assessmentUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    sectors: z.array(assessmentSectorConfigSchema).min(1).optional(),
    topicIds: z.array(z.string().uuid()).optional(),
    skillIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    d =>
      d.periodStart === undefined || d.periodEnd === undefined || d.periodEnd >= d.periodStart,
    { message: 'Período final deve ser maior ou igual ao inicial', path: ['periodEnd'] },
  );

// =====================
// AssessmentEntry: responses & metadata
// =====================

export const assessmentResponseFormSchema = z.object({
  topicId: z.string().uuid(),
  score: z.coerce.number().int().min(0).max(5),
  justification: z.string().max(2000).nullable().optional(),
});

export const assessmentEntryResponsesUpsertSchema = z.object({
  responses: z
    .array(assessmentResponseFormSchema)
    .min(1, 'Pelo menos uma resposta deve ser fornecida'),
});

export const assessmentEntryUpdateSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

// =====================
// Map-to-form helpers
// =====================

export const mapSkillToFormData = createMapToFormDataHelper<Skill, SkillUpdateFormData>(s => ({
  name: s.name,
  description: s.description,
  order: s.order,
  isActive: s.isActive,
}));

export const mapTopicToFormData = createMapToFormDataHelper<Topic, TopicUpdateFormData>(t => ({
  skillId: t.skillId,
  order: t.order,
  title: t.title,
  description: t.description,
  counterBehaviors: t.counterBehaviors,
  isActive: t.isActive,
}));

export const mapAssessmentToFormData = createMapToFormDataHelper<
  Assessment,
  AssessmentUpdateFormData
>(a => ({
  name: a.name,
  description: a.description,
  periodStart: a.periodStart,
  periodEnd: a.periodEnd,
}));

export const mapAssessmentEntryToFormData = createMapToFormDataHelper<
  AssessmentEntry,
  AssessmentEntryUpdateFormData
>(e => ({
  notes: e.notes,
}));

// =====================
// Inferred types
// =====================

export type SkillGetManyFormData = z.infer<typeof skillGetManySchema>;
export type SkillQueryFormData = z.infer<typeof skillQuerySchema>;
export type SkillCreateFormDataInferred = z.infer<typeof skillCreateSchema>;
export type SkillUpdateFormDataInferred = z.infer<typeof skillUpdateSchema>;
export type SkillBatchCreateFormData = z.infer<typeof skillBatchCreateSchema>;
export type SkillBatchUpdateFormData = z.infer<typeof skillBatchUpdateSchema>;
export type SkillBatchDeleteFormData = z.infer<typeof skillBatchDeleteSchema>;

export type TopicGetManyFormData = z.infer<typeof topicGetManySchema>;
export type TopicQueryFormData = z.infer<typeof topicQuerySchema>;
export type TopicCreateFormDataInferred = z.infer<typeof topicCreateSchema>;
export type TopicUpdateFormDataInferred = z.infer<typeof topicUpdateSchema>;
export type TopicLevelsUpsertFormDataInferred = z.infer<typeof topicLevelsUpsertSchema>;
export type TopicBatchCreateFormData = z.infer<typeof topicBatchCreateSchema>;
export type TopicBatchUpdateFormData = z.infer<typeof topicBatchUpdateSchema>;
export type TopicBatchDeleteFormData = z.infer<typeof topicBatchDeleteSchema>;

export type AssessmentGetManyFormData = z.infer<typeof assessmentGetManySchema>;
export type AssessmentQueryFormData = z.infer<typeof assessmentQuerySchema>;
export type AssessmentCreateFormDataInferred = z.infer<typeof assessmentCreateSchema>;
export type AssessmentUpdateFormDataInferred = z.infer<typeof assessmentUpdateSchema>;

export type AssessmentEntryGetManyFormData = z.infer<typeof assessmentEntryGetManySchema>;
export type AssessmentEntryQueryFormData = z.infer<typeof assessmentEntryQuerySchema>;
export type AssessmentEntryUpdateFormDataInferred = z.infer<typeof assessmentEntryUpdateSchema>;
export type AssessmentEntryResponsesUpsertFormDataInferred = z.infer<
  typeof assessmentEntryResponsesUpsertSchema
>;

// =====================
// Legacy schema re-exports (no-op stubs)
// =====================
// The OLD skill module (skillModel / skillAssessmentPeriod) was removed from
// Prisma. We intentionally do NOT re-export the old names so stale imports
// fail loudly at typecheck instead of silently calling missing tables.
