// src/schemas/questionnaire.ts
//
// Zod schemas for the self-fill Questionnaire domain (QuestionnaireGroup /
// Question / Option / Questionnaire / Entry / Answer). Mirrors the conventions
// in api/src/schemas/skill.ts (where/orderBy/include/getMany transforms +
// create/update + query), trimmed to the core workflow (no batch / analytics).

import { z } from 'zod';
import { orderByDirectionSchema, normalizeOrderBy,
  normalizeSearchTerm,
} from './common';

// =====================
// Enum schemas
// =====================

export const questionnaireStatusSchema = z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']);
export const questionnaireEntryStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'SUBMITTED']);
export const questionnaireQuestionTypeSchema = z.enum(['OPTIONS', 'TEXT']);
export const questionnaireAudienceSchema = z.enum([
  'ALL_USERS',
  'SECTORS',
  'POSITIONS',
  'USERS',
]);

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

export const questionnaireGroupOrderBySchema = buildOrderBySchema(['id', 'name', 'order', 'isActive', 'createdAt', 'updatedAt']);

/// Perguntas ordenam também PELO TEMA — e por `group.order`/`group.name`, não
/// por `groupId`: ordenar pelo uuid do tema agrupa as perguntas, mas numa
/// sequência aleatória, que é como a listagem se comportava.
const questionOrderByObject = z.object({
  id: orderByDirectionSchema.optional(),
  groupId: orderByDirectionSchema.optional(),
  order: orderByDirectionSchema.optional(),
  title: orderByDirectionSchema.optional(),
  type: orderByDirectionSchema.optional(),
  isRequired: orderByDirectionSchema.optional(),
  isActive: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
  group: z
    .object({
      name: orderByDirectionSchema.optional(),
      order: orderByDirectionSchema.optional(),
    })
    .optional(),
});
export const questionnaireQuestionOrderBySchema = z
  .union([questionOrderByObject, z.array(questionOrderByObject.partial())])
  .optional();
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
      type: z
        .union([
          questionnaireQuestionTypeSchema,
          z.object({ in: z.array(questionnaireQuestionTypeSchema).optional() }),
        ])
        .optional(),
      isRequired: boolFilter,
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
          { nameNormalized: { contains: normalizeSearchTerm(searchingFor) } },
          { descriptionNormalized: { contains: normalizeSearchTerm(searchingFor) } },
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
    isRequired: z.coerce.boolean().optional(),
    // União: `?types=TEXT` (valor único) é a forma natural de chamar e o pipe
    // não a converte em array — só `?types[]=TEXT` virava lista, e o resto 400.
    types: z
      .union([questionnaireQuestionTypeSchema, z.array(questionnaireQuestionTypeSchema)])
      .optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { searchingFor, groupId, groupIds, isActive, isRequired, types } = data;
    const and: any[] = [];
    if (searchingFor) {
      and.push({
        OR: [
          { titleNormalized: { contains: normalizeSearchTerm(searchingFor) } },
          { descriptionNormalized: { contains: normalizeSearchTerm(searchingFor) } },
        ],
      });
    }
    if (groupId) and.push({ groupId });
    if (groupIds?.length) and.push({ groupId: { in: groupIds } });
    if (typeof isActive === 'boolean') and.push({ isActive });
    if (typeof isRequired === 'boolean') and.push({ isRequired });
    if (types) and.push({ type: { in: Array.isArray(types) ? types : [types] } });
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
          { nameNormalized: { contains: normalizeSearchTerm(searchingFor) } },
          { descriptionNormalized: { contains: normalizeSearchTerm(searchingFor) } },
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
    // Estado da CAMPANHA (não da ficha). Filtrar por ele é o que tira da fila
    // pessoal a ficha de campanha já encerrada — sem isto o usuário era
    // redirecionado para um preenchimento que só devolve 400.
    //
    // Precisa ser param de RAIZ, e não `where.questionnaire`, por dois motivos
    // independentes, cada um bastando sozinho: `questionnaireEntryWhereSchema`
    // não tem a chave `questionnaire` (z.object descarta em silêncio), e
    // findManyEntries monta `finalWhere` com `questionnaire: { deletedAt: null }`
    // LITERAL, sobrescrevendo qualquer filtro homônimo que viesse do cliente.
    // Como convenience param a condição entra em `where.AND`, que sobrevive aos
    // dois — e o Prisma emite um segundo JOIN, aplicando as duas restrições.
    questionnaireStatus: z
      .union([questionnaireStatusSchema, z.array(questionnaireStatusSchema)])
      .optional(),
  })
  .transform(data => {
    data = baseTransform(data);
    const { status, questionnaireId, respondentId, questionnaireStatus } = data;
    const and: any[] = [];
    if (status) and.push({ status: Array.isArray(status) ? { in: status } : status });
    if (questionnaireId) and.push({ questionnaireId });
    // respondentId === 'me' is resolved by the controller using current user id.
    if (respondentId && respondentId !== 'me') and.push({ respondentId });
    if (questionnaireStatus)
      and.push({
        questionnaire: {
          status: Array.isArray(questionnaireStatus) ? { in: questionnaireStatus } : questionnaireStatus,
        },
      });
    const merged = mergeAnd(data, and);
    // `questionnaire` NÃO PODE FICAR NA RAIZ do where. findManyEntries monta o
    // where final com a chave `questionnaire` LITERAL (`{ deletedAt: null }`),
    // que sobrescreve qualquer homônima vinda daqui — o filtro sumiria sem erro
    // nenhum. Dentro de `AND` ele sobrevive: o Prisma emite um segundo JOIN e
    // aplica as duas restrições.
    //
    // Só cai na raiz quando `mergeAnd` recebe UMA condição e nenhum `where`
    // prévio (ele devolve a condição crua nesse caso). Com `status` junto, como
    // a fila pessoal manda, já viria em `AND` — depender disso seria depender de
    // um acidente do chamador.
    if (merged.where?.questionnaire) merged.where = { AND: [merged.where] };
    return merged;
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

/// 2..6 opções com valor 0..5. O valor cresce junto com a ordem — é ele que
/// pinta a opção na régua de notas (0 roxo … 5 verde), então uma escala com os
/// valores fora de ordem exibiria as cores embaralhadas. Uma escala de 6 opções
/// obrigatoriamente começa no 0 (só existem seis valores).
const optionsArray = z
  .array(questionnaireOptionFormSchema)
  .min(2, 'Pelo menos duas opções')
  .max(6, 'No máximo 6 opções (valor 0..5)')
  .refine(
    arr => new Set(arr.map(o => o.value)).size === arr.length,
    'Valores duplicados não são permitidos',
  )
  .refine(
    arr => new Set(arr.map(o => o.order)).size === arr.length,
    'Ordens duplicadas não são permitidas',
  )
  .refine(arr => {
    const sorted = [...arr].sort((a, b) => a.order - b.order);
    return sorted.every((o, i) => i === 0 || o.value > sorted[i - 1].value);
  }, 'Os valores das opções devem crescer junto com a ordem');

export const questionnaireQuestionCreateSchema = z
  .object({
    groupId: z.string().uuid('Grupo inválido'),
    /// Opcional: sem valor, o serviço usa a última ordem do tema + 1. A ordem é
    /// única por tema, então deixá-la a cargo do servidor evita colisão e
    /// dispensa o admin de adivinhar o próximo número.
    order: z.coerce.number().int().min(0).max(9999).optional(),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    helpText: z.string().max(2000).nullable().optional(),
    type: questionnaireQuestionTypeSchema.default('OPTIONS').optional(),
    isRequired: z.boolean().default(true).optional(),
    isActive: z.boolean().default(true).optional(),
    options: optionsArray.optional(),
  })
  .superRefine((d, ctx) => {
    const type = d.type ?? 'OPTIONS';
    if (type === 'OPTIONS' && !d.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Perguntas fechadas precisam de opções de resposta',
        path: ['options'],
      });
    }
    if (type === 'TEXT' && d.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Perguntas de texto livre não podem ter opções de resposta',
        path: ['options'],
      });
    }
  });

export const questionnaireQuestionUpdateSchema = z.object({
  groupId: z.string().uuid().optional(),
  order: z.coerce.number().int().min(0).max(9999).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  helpText: z.string().max(2000).nullable().optional(),
  type: questionnaireQuestionTypeSchema.optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const questionnaireOptionsUpsertSchema = z.object({
  options: optionsArray,
});

// =====================
// CRUD: Questionnaire (campaign)
// =====================

/// Cada modo de público exige a SUA coleção de critérios e ignora as demais.
/// Aplicado no create (onde o modo é obrigatório) e no update (onde só vale se
/// o modo vier no payload).
const audienceIssue = (
  ctx: z.RefinementCtx,
  audience: 'ALL_USERS' | 'SECTORS' | 'POSITIONS' | 'USERS',
  d: { userIds?: string[]; sectorIds?: string[]; positionIds?: string[] },
) => {
  const required: Record<typeof audience, { list?: string[]; path: string; message: string }> = {
    ALL_USERS: { list: undefined, path: 'audience', message: '' },
    SECTORS: { list: d.sectorIds, path: 'sectorIds', message: 'Selecione ao menos um setor' },
    POSITIONS: { list: d.positionIds, path: 'positionIds', message: 'Selecione ao menos um cargo' },
    USERS: { list: d.userIds, path: 'userIds', message: 'Selecione ao menos um colaborador' },
  };
  const rule = required[audience];
  if (rule.message && !(rule.list?.length ?? 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: rule.message, path: [rule.path] });
  }
};

export const questionnaireCreateSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório').max(200),
    description: z.string().max(2000).nullable().optional(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    audience: questionnaireAudienceSchema.default('ALL_USERS').optional(),
    isAnonymous: z.boolean().default(false).optional(),
    userIds: z.array(z.string().uuid()).optional(),
    sectorIds: z.array(z.string().uuid()).optional(),
    positionIds: z.array(z.string().uuid()).optional(),
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
  .superRefine((d, ctx) => audienceIssue(ctx, d.audience ?? 'ALL_USERS', d));

export const questionnaireUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    audience: questionnaireAudienceSchema.optional(),
    isAnonymous: z.boolean().optional(),
    userIds: z.array(z.string().uuid()).optional(),
    sectorIds: z.array(z.string().uuid()).optional(),
    positionIds: z.array(z.string().uuid()).optional(),
    questionIds: z.array(z.string().uuid()).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.audience) audienceIssue(ctx, d.audience, d);
  })
  .refine(
    d => d.periodStart === undefined || d.periodEnd === undefined || d.periodEnd >= d.periodStart,
    { message: 'Período final deve ser maior ou igual ao inicial', path: ['periodEnd'] },
  );

// =====================
// Entry: answers & metadata
// =====================

/// Uma resposta traz OU a nota da opção escolhida (pergunta fechada) OU o texto
/// livre (pergunta de texto). `comment` continua sendo o comentário opcional de
/// uma resposta fechada — nunca o conteúdo de uma pergunta de texto.
///
/// Sem nota E sem texto significa APAGAR a resposta: é assim que o respondente
/// esvazia uma pergunta opcional que já tinha respondido (o autosave manda o
/// campo vazio e a linha some, em vez de gravar uma resposta em branco).
export const questionnaireAnswerFormSchema = z.object({
  questionId: z.string().uuid(),
  value: z.coerce.number().int().min(0).max(5).nullable().optional(),
  textValue: z.string().max(5000).nullable().optional(),
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
