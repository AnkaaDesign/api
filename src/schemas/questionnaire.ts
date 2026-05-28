// src/schemas/questionnaire.ts
//
// Zod schemas for the self-fill Questionnaire domain (QuestionnaireGroup /
// Question / Option / Questionnaire / Entry / Answer). Mirrors the conventions
// in api/src/schemas/skill.ts (where/orderBy/include/getMany transforms +
// create/update + query), trimmed to the core workflow (no batch / analytics).

import { z } from 'zod';
import { orderByDirectionSchema, normalizeOrderBy } from './common';

// =====================
// Enum schemas
// =====================

export const questionnaireStatusSchema = z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']);
export const questionnaireEntryStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'SUBMITTED']);

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
  .union([z.boolean(), z.object({ equals: z.boolean().optional(), not: z.boolean().optional() })])
  .optional();

const dateFilter = z
  .union([
    z.coerce.date(),
    z.object({
      equals: z.coerce.date().optional(),
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
      gt: z.coerce.number().int().optional(),
      gte: z.coerce.number().int().optional(),
      lt: z.coerce.number().int().optional(),
      lte: z.coerce.number().int().optional(),
      in: z.array(z.coerce.number().int()).optional(),
    }),
  ])
  .optional();

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
// Include schemas (permissive — passed through to Prisma)
// =====================

const recordBool = z
  .union([z.boolean(), z.object({}).passthrough(), z.record(z.any())])
  .optional();

export const questionnaireGroupIncludeSchema = z
  .object({ questions: recordBool, _count: recordBool })
  .partial()
  .optional();

export const questionnaireQuestionIncludeSchema = z
  .object({ group: recordBool, options: recordBool, links: recordBool, answers: recordBool, _count: recordBool })
  .partial()
  .optional();

export const questionnaireIncludeSchema = z
  .object({
    createdBy: recordBool,
    questions: recordBool,
    entries: recordBool,
    _count: recordBool,
  })
  .partial()
  .optional();

export const questionnaireEntryIncludeSchema = z
  .object({
    questionnaire: recordBool,
    respondent: recordBool,
    answers: recordBool,
    _count: recordBool,
  })
  .partial()
  .optional();

// =====================
// OrderBy schemas
// =====================

const buildOrderBySchema = (fields: string[]) => {
  const shape: Record<string, z.ZodOptional<typeof orderByDirectionSchema>> = {};
  for (const f of fields) shape[f] = orderByDirectionSchema.optional();
  const object = z.object(shape);
  return z.union([object, z.array(object.partial())]).optional();
};

export const questionnaireGroupOrderBySchema = buildOrderBySchema(['id', 'name', 'order', 'createdAt', 'updatedAt']);
export const questionnaireQuestionOrderBySchema = buildOrderBySchema(['id', 'groupId', 'order', 'title', 'createdAt', 'updatedAt']);
export const questionnaireOrderBySchema = buildOrderBySchema(['id', 'name', 'status', 'periodStart', 'periodEnd', 'createdAt', 'updatedAt']);
export const questionnaireEntryOrderBySchema = buildOrderBySchema(['id', 'status', 'startedAt', 'submittedAt', 'createdAt', 'updatedAt']);

// =====================
// Where schemas
// =====================

export const questionnaireGroupWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(questionnaireGroupWhereSchema).optional(),
      OR: z.array(questionnaireGroupWhereSchema).optional(),
      NOT: questionnaireGroupWhereSchema.optional(),
      id: uuidFilter,
      name: stringFilter,
      order: intFilter,
      isActive: boolFilter,
      deletedAt: z.union([z.null(), dateFilter, z.object({ not: z.null().optional() })]).optional(),
      createdAt: dateFilter,
      updatedAt: dateFilter,
    })
    .optional(),
);

export const questionnaireQuestionWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(questionnaireQuestionWhereSchema).optional(),
      OR: z.array(questionnaireQuestionWhereSchema).optional(),
      NOT: questionnaireQuestionWhereSchema.optional(),
      id: uuidFilter,
      groupId: uuidFilter,
      order: intFilter,
      title: stringFilter,
      isActive: boolFilter,
      deletedAt: z.union([z.null(), dateFilter, z.object({ not: z.null().optional() })]).optional(),
      createdAt: dateFilter,
      updatedAt: dateFilter,
    })
    .optional(),
);

export const questionnaireWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(questionnaireWhereSchema).optional(),
      OR: z.array(questionnaireWhereSchema).optional(),
      NOT: questionnaireWhereSchema.optional(),
      id: uuidFilter,
      name: stringFilter,
      status: z.union([questionnaireStatusSchema, z.object({ in: z.array(questionnaireStatusSchema).optional() })]).optional(),
      createdById: uuidFilter,
      periodStart: dateFilter,
      periodEnd: dateFilter,
      deletedAt: z.union([z.null(), dateFilter, z.object({ not: z.null().optional() })]).optional(),
      createdAt: dateFilter,
      updatedAt: dateFilter,
    })
    .optional(),
);

export const questionnaireEntryWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.array(questionnaireEntryWhereSchema).optional(),
      OR: z.array(questionnaireEntryWhereSchema).optional(),
      NOT: questionnaireEntryWhereSchema.optional(),
      id: uuidFilter,
      questionnaireId: uuidFilter,
      respondentId: uuidFilter,
      status: z.union([questionnaireEntryStatusSchema, z.object({ in: z.array(questionnaireEntryStatusSchema).optional() })]).optional(),
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

const mergeAnd = (data: any, andConditions: any[]) => {
  if (andConditions.length) {
    data.where = data.where
      ? { AND: [...(data.where.AND ?? [data.where]), ...andConditions] }
      : andConditions.length === 1
        ? andConditions[0]
        : { AND: andConditions };
  }
  return data;
};

export const questionnaireGroupGetManySchema = z
  .object({
    ...catalogPaginationFields,
    where: maybeParseJson(questionnaireGroupWhereSchema).optional(),
    orderBy: questionnaireGroupOrderBySchema,
    include: questionnaireGroupIncludeSchema,
    searchingFor: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { searchingFor, isActive } = data;
    const and: any[] = [];
    if (searchingFor) {
      and.push({
        OR: [
          { name: { contains: searchingFor, mode: 'insensitive' } },
          { description: { contains: searchingFor, mode: 'insensitive' } },
        ],
      });
    }
    if (typeof isActive === 'boolean') and.push({ isActive });
    return mergeAnd(data, and);
  });

export const questionnaireQuestionGetManySchema = z
  .object({
    ...catalogPaginationFields,
    where: maybeParseJson(questionnaireQuestionWhereSchema).optional(),
    orderBy: questionnaireQuestionOrderBySchema,
    include: questionnaireQuestionIncludeSchema,
    searchingFor: z.string().optional(),
    groupId: z.string().uuid().optional(),
    groupIds: z.array(z.string().uuid()).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { searchingFor, groupId, groupIds, isActive } = data;
    const and: any[] = [];
    if (searchingFor) {
      and.push({
        OR: [
          { title: { contains: searchingFor, mode: 'insensitive' } },
          { description: { contains: searchingFor, mode: 'insensitive' } },
        ],
      });
    }
    if (groupId) and.push({ groupId });
    if (groupIds?.length) and.push({ groupId: { in: groupIds } });
    if (typeof isActive === 'boolean') and.push({ isActive });
    return mergeAnd(data, and);
  });

export const questionnaireGetManySchema = z
  .object({
    ...paginationFields,
    where: maybeParseJson(questionnaireWhereSchema).optional(),
    orderBy: questionnaireOrderBySchema,
    include: questionnaireIncludeSchema,
    searchingFor: z.string().optional(),
    status: z.union([questionnaireStatusSchema, z.array(questionnaireStatusSchema)]).optional(),
    createdById: z.string().uuid().optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { searchingFor, status, createdById } = data;
    const and: any[] = [];
    if (searchingFor) {
      and.push({
        OR: [
          { name: { contains: searchingFor, mode: 'insensitive' } },
          { description: { contains: searchingFor, mode: 'insensitive' } },
        ],
      });
    }
    if (status) and.push({ status: Array.isArray(status) ? { in: status } : status });
    if (createdById) and.push({ createdById });
    return mergeAnd(data, and);
  });

export const questionnaireEntryGetManySchema = z
  .object({
    ...paginationFields,
    where: maybeParseJson(questionnaireEntryWhereSchema).optional(),
    orderBy: questionnaireEntryOrderBySchema,
    include: questionnaireEntryIncludeSchema,
    status: z.union([questionnaireEntryStatusSchema, z.array(questionnaireEntryStatusSchema)]).optional(),
    questionnaireId: z.string().uuid().optional(),
    respondentId: z.union([z.string().uuid(), z.literal('me')]).optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { status, questionnaireId, respondentId } = data;
    const and: any[] = [];
    if (status) and.push({ status: Array.isArray(status) ? { in: status } : status });
    if (questionnaireId) and.push({ questionnaireId });
    // respondentId === 'me' is resolved by the controller using current user id.
    if (respondentId && respondentId !== 'me') and.push({ respondentId });
    return mergeAnd(data, and);
  });

// =====================
// Query (?include=) schemas
// =====================

export const questionnaireGroupQuerySchema = z.object({ include: questionnaireGroupIncludeSchema });
export const questionnaireQuestionQuerySchema = z.object({ include: questionnaireQuestionIncludeSchema });
export const questionnaireQuerySchema = z.object({ include: questionnaireIncludeSchema });
export const questionnaireEntryQuerySchema = z.object({ include: questionnaireEntryIncludeSchema });

// =====================
// CRUD: Group
// =====================

export const questionnaireGroupCreateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(120),
  description: z.string().max(2000).nullable().optional(),
  order: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean().default(true).optional(),
});
export const questionnaireGroupUpdateSchema = questionnaireGroupCreateSchema.partial();

// =====================
// CRUD: Question + Options
// =====================

export const questionnaireOptionFormSchema = z.object({
  order: z.coerce.number().int().min(0).max(99),
  value: z.coerce.number().int().min(0).max(5),
  label: z.string().min(1, 'Rótulo é obrigatório').max(120),
  description: z.string().max(2000).nullable().optional(),
});

const optionsArray = z
  .array(questionnaireOptionFormSchema)
  .min(2, 'Pelo menos duas opções')
  .max(6, 'No máximo 6 opções (valor 0..5)')
  .refine(arr => new Set(arr.map(o => o.value)).size === arr.length, 'Valores duplicados não são permitidos')
  .refine(arr => new Set(arr.map(o => o.order)).size === arr.length, 'Ordens duplicadas não são permitidas');

export const questionnaireQuestionCreateSchema = z.object({
  groupId: z.string().uuid('Grupo inválido'),
  order: z.coerce.number().int().min(0).max(9999),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  helpText: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().default(true).optional(),
  options: optionsArray.optional(),
});

export const questionnaireQuestionUpdateSchema = z.object({
  groupId: z.string().uuid().optional(),
  order: z.coerce.number().int().min(0).max(9999).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  helpText: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const questionnaireOptionsUpsertSchema = z.object({
  options: optionsArray,
});

// =====================
// CRUD: Questionnaire (campaign)
// =====================

export const questionnaireCreateSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório').max(200),
    description: z.string().max(2000).nullable().optional(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    targetAllUsers: z.boolean().default(false).optional(),
    isAnonymous: z.boolean().default(false).optional(),
    userIds: z.array(z.string().uuid()).optional(),
    questionIds: z.array(z.string().uuid()).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
  })
  .refine(d => d.periodEnd >= d.periodStart, {
    message: 'Período final deve ser maior ou igual ao inicial',
    path: ['periodEnd'],
  })
  .refine(d => (d.questionIds?.length ?? 0) + (d.groupIds?.length ?? 0) > 0, {
    message: 'Selecione ao menos uma pergunta',
    path: ['questionIds'],
  })
  .refine(d => d.targetAllUsers === true || (d.userIds?.length ?? 0) > 0, {
    message: 'Selecione colaboradores ou marque "todos os colaboradores"',
    path: ['userIds'],
  });

export const questionnaireUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    targetAllUsers: z.boolean().optional(),
    isAnonymous: z.boolean().optional(),
    userIds: z.array(z.string().uuid()).optional(),
    questionIds: z.array(z.string().uuid()).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    d => d.periodStart === undefined || d.periodEnd === undefined || d.periodEnd >= d.periodStart,
    { message: 'Período final deve ser maior ou igual ao inicial', path: ['periodEnd'] },
  );

// =====================
// Entry: answers & metadata
// =====================

export const questionnaireAnswerFormSchema = z.object({
  questionId: z.string().uuid(),
  value: z.coerce.number().int().min(0).max(5),
  comment: z.string().max(2000).nullable().optional(),
});

export const questionnaireEntryAnswersUpsertSchema = z.object({
  answers: z.array(questionnaireAnswerFormSchema).min(1, 'Pelo menos uma resposta deve ser fornecida'),
});

export const questionnaireEntryUpdateSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

// =====================
// Inferred types
// =====================

export type QuestionnaireGroupGetManyFormData = z.infer<typeof questionnaireGroupGetManySchema>;
export type QuestionnaireQuestionGetManyFormData = z.infer<typeof questionnaireQuestionGetManySchema>;
export type QuestionnaireGetManyFormData = z.infer<typeof questionnaireGetManySchema>;
export type QuestionnaireEntryGetManyFormData = z.infer<typeof questionnaireEntryGetManySchema>;
