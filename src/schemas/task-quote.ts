// packages/schemas/src/task-quote.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableDate,
  moneySchema,
  normalizeSearchTerm,
  normalizeVehicleSearchTerm,
} from './common';
import type { TaskQuote } from '@types';
import {
  TASK_QUOTE_STATUS,
  DISCOUNT_TYPE,
  PAYMENT_CONDITION,
  GUARANTEE_YEARS_OPTIONS,
} from '@constants';

// =====================
// TaskQuote Status Schema
// =====================

export const taskQuoteStatusSchema = z.enum([
  TASK_QUOTE_STATUS.PENDING,
  TASK_QUOTE_STATUS.BUDGET_APPROVED,
  TASK_QUOTE_STATUS.BILLING_APPROVED,
  TASK_QUOTE_STATUS.UPCOMING,
  TASK_QUOTE_STATUS.DUE,
  TASK_QUOTE_STATUS.PARTIAL,
  TASK_QUOTE_STATUS.SETTLED,
  TASK_QUOTE_STATUS.CANCELLED,
]);

// =====================
// Discount Type Schema
// =====================

export const discountTypeSchema = z.enum([
  DISCOUNT_TYPE.NONE,
  DISCOUNT_TYPE.PERCENTAGE,
  DISCOUNT_TYPE.FIXED_VALUE,
]);

// =====================
// Payment Condition Schema
// =====================

export const paymentConditionSchema = z.enum([
  PAYMENT_CONDITION.CASH_5,
  PAYMENT_CONDITION.CASH_40,
  PAYMENT_CONDITION.INSTALLMENTS_2,
  PAYMENT_CONDITION.INSTALLMENTS_3,
  PAYMENT_CONDITION.INSTALLMENTS_4,
  PAYMENT_CONDITION.INSTALLMENTS_5,
  PAYMENT_CONDITION.INSTALLMENTS_6,
  PAYMENT_CONDITION.INSTALLMENTS_7,
  PAYMENT_CONDITION.CUSTOM,
]);

// =====================
// Guarantee Years Schema
// =====================

export const guaranteeYearsSchema = z
  .number()
  .refine(val => (GUARANTEE_YEARS_OPTIONS as readonly number[]).includes(val), {
    message: 'Periodo de garantia invalido',
  });

// =====================
// TaskQuote Include Schema Based on Prisma Schema (Second Level Only)
// =====================

/**
 * Como se pede as TAREFAS do orçamento — a mesma forma nas duas chaves.
 *
 * `z.object()` do zod DESCARTA chave desconhecida em silêncio (não é `strict`
 * aqui). Enquanto só `task` estava declarada, o `include: { tasks: … }` que o
 * app manda desde o orçamento multitarefa era removido antes de chegar ao
 * repositório, e o orçamento voltava sem veículo nenhum: a lista ficava sem
 * LOGOMARCA e sem IDENTIFICADOR, e a tela de detalhe sem tarefa. Silencioso,
 * porque um `include` descartado não é erro — é só um campo que não veio.
 */
const quoteTasksIncludeSchema = z
  .union([
    z.boolean(),
    z.object({
      include: z
        .object({
          sector: z.boolean().optional(),
          customer: z.boolean().optional(),
          budgets: z.boolean().optional(),
          invoices: z.boolean().optional(),
          receipts: z.boolean().optional(),
          observation: z.boolean().optional(),
          generalPainting: z.boolean().optional(),
          createdBy: z.boolean().optional(),
          // `layouts` (renamed Artwork relation) carries a File. The mobile
          // budget/quote detail sends `layouts: { include: { file: true } }`
          // to render the layout thumbnail, so accept the nested form as well
          // as the plain boolean — a bare boolean here broke the whole `task`
          // union with invalid_union.
          layouts: z
            .union([
              z.boolean(),
              z.object({
                include: z.object({ file: z.boolean().optional() }).optional(),
              }),
            ])
            .optional(),
          logoPaints: z.boolean().optional(),
          serviceOrders: z.boolean().optional(),
          truck: z.boolean().optional(),
          airbrushing: z.boolean().optional(),
          quote: z.boolean().optional(),
        })
        .optional(),
    }),
  ])
  .optional();

export const taskQuoteIncludeSchema = z
  .object({
    /** As tarefas do orçamento — uma por veículo. A forma corrente. */
    tasks: quoteTasksIncludeSchema,
    /**
     * @deprecated Forma anterior ao orçamento multitarefa.
     *
     * Continua aceita porque o app Flutter instalado nos aparelhos e o
     * `kTaskQuoteDetailInclude` já gravado em cache mandam esta chave, e
     * recusá-la devolveria a tela de detalhe sem tarefa nenhuma.
     * `mapIncludeToDatabaseInclude` traduz as duas para a relação de LISTA.
     */
    task: quoteTasksIncludeSchema,
    services: z.boolean().optional(),
    layoutFiles: z.boolean().optional(),
    customerConfigs: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              customer: z
                .union([
                  z.boolean(),
                  z.object({
                    select: z
                      .object({
                        id: z.boolean().optional(),
                        fantasyName: z.boolean().optional(),
                        cnpj: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              customerSignature: z.boolean().optional(),
              responsible: z.boolean().optional(),
              installments: z
                .union([
                  z.boolean(),
                  z.object({
                    orderBy: z.object({ number: z.enum(['asc', 'desc']) }).optional(),
                  }),
                ])
                .optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// TaskQuote OrderBy Schema
// =====================

export const taskQuoteOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        total: orderByDirectionSchema.optional(),
        expiresAt: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        taskId: orderByDirectionSchema.optional(),
        budgetNumber: orderByDirectionSchema.optional(),
        simultaneousTasks: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        /**
         * @deprecated Ordenação por campo da tarefa, anterior ao multitarefa.
         *
         * O Prisma NÃO ordena um pai por campo de uma relação de LISTA — e
         * `tasks` virou lista. Não há resposta certa possível: qual dos sessenta
         * prazos ordenaria o orçamento? Continua aceito porque o app instalado
         * manda `{'task.term': 'asc'}` no `baseOrderBy`, e recusar derrubaria a
         * lista inteira; `mapOrderByToDatabaseOrderBy` DESCARTA a entrada antes
         * do banco. Ordene por `budgetNumber`, `createdAt` ou `expiresAt`.
         */
        task: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            status: orderByDirectionSchema.optional(),
            statusOrder: orderByDirectionSchema.optional(),
            serialNumber: orderByDirectionSchema.optional(),
            entryDate: orderByDirectionSchema.optional(),
            term: orderByDirectionSchema.optional(),
            startedAt: orderByDirectionSchema.optional(),
            finishedAt: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          total: orderByDirectionSchema.optional(),
          expiresAt: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          taskId: orderByDirectionSchema.optional(),
          budgetNumber: orderByDirectionSchema.optional(),
          simultaneousTasks: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
          // Aceito e DESCARTADO pelo repositório — ver a nota do ramo acima.
          // Continua declarado de propósito: `z.object` não-strict apagaria a
          // entrada em silêncio, e o repositório precisa VER a chave para poder
          // descartá-la de forma consciente.
          task: z
            .object({
              id: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
              status: orderByDirectionSchema.optional(),
              statusOrder: orderByDirectionSchema.optional(),
              serialNumber: orderByDirectionSchema.optional(),
              entryDate: orderByDirectionSchema.optional(),
              term: orderByDirectionSchema.optional(),
              startedAt: orderByDirectionSchema.optional(),
              finishedAt: orderByDirectionSchema.optional(),
              createdAt: orderByDirectionSchema.optional(),
              updatedAt: orderByDirectionSchema.optional(),
            })
            .optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// TaskQuote Where Schema
// =====================

export const taskQuoteWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.union([taskQuoteWhereSchema, z.array(taskQuoteWhereSchema)]).optional(),
      OR: z.array(taskQuoteWhereSchema).optional(),
      NOT: z.union([taskQuoteWhereSchema, z.array(taskQuoteWhereSchema)]).optional(),
      id: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.union([z.string(), z.object({ in: z.array(z.string()) })]).optional(),
          }),
        ])
        .optional(),
      total: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            not: z.number().optional(),
          }),
        ])
        .optional(),
      expiresAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            gt: z.date().optional(),
            gte: z.date().optional(),
            lt: z.date().optional(),
            lte: z.date().optional(),
            not: z.date().optional(),
          }),
        ])
        .optional(),
      status: z
        .union([
          taskQuoteStatusSchema,
          z.object({
            equals: taskQuoteStatusSchema.optional(),
            in: z.array(taskQuoteStatusSchema).optional(),
            notIn: z.array(taskQuoteStatusSchema).optional(),
            not: taskQuoteStatusSchema.optional(),
          }),
        ])
        .optional(),
      taskId: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            not: z.string().optional(),
          }),
        ])
        .optional(),
      simultaneousTasks: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            not: z.number().optional(),
          }),
        ])
        .optional(),
      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            gt: z.date().optional(),
            gte: z.date().optional(),
            lt: z.date().optional(),
            lte: z.date().optional(),
            not: z.date().optional(),
          }),
        ])
        .optional(),
      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            gt: z.date().optional(),
            gte: z.date().optional(),
            lt: z.date().optional(),
            lte: z.date().optional(),
            not: z.date().optional(),
          }),
        ])
        .optional(),
      // Filtro da relação de LISTA `tasks` — a forma corrente, na gramática do
      // Prisma para to-many. A lista de Orçamentos manda `{ some: {} }` ("tem
      // ao menos um veículo"), que é a pergunta que o antigo `{ isNot: null }`
      // respondia. Sem esta chave declarada, o `.strict()` recusava a consulta
      // inteira com unrecognized_keys: 'tasks'.
      tasks: z
        .object({
          some: z.record(z.any()).optional(),
          every: z.record(z.any()).optional(),
          none: z.record(z.any()).optional(),
        })
        .optional(),
      /**
       * @deprecated Filtro to-one, anterior ao orçamento multitarefa.
       *
       * `Task.quoteId` deixou de ser `@unique` e `TaskQuoteWhereInput.task` não
       * existe mais; mandá-lo ao Prisma estoura a consulta. Continua ACEITO aqui
       * porque o app instalado ainda o envia, e `mapWhereToDatabaseWhere` o
       * traduz para `tasks: { some: … }` antes do banco.
       */
      task: z
        .union([
          z.object({
            is: z.record(z.any()).nullable().optional(),
            isNot: z.record(z.any()).nullable().optional(),
          }),
          z.record(z.any()),
        ])
        .nullable()
        .optional(),
    })
    .partial()
    .strict(),
);

// =====================
// Convenience Filters
// =====================

const taskQuoteFilters = {
  searchingFor: z.string().optional(),
  taskId: z.string().uuid().optional(),
  hasTask: z.boolean().optional(),
  status: taskQuoteStatusSchema.optional(),
};

// =====================
// Transform Function for Filters
// =====================

const taskQuoteTransform = (data: any) => {
  const transformed: any = { ...data };

  // Handle searchingFor filter — search across logomarca (task name), série
  // (task serial number / truck plate), cliente (task customer + billing
  // customer configs) and the quote's service descriptions. Mirrors the Task
  // search surface so the Orçamentos/Faturamento list honours its
  // "Buscar por logomarca, série, cliente..." placeholder (previously it only
  // matched service descriptions, so a logomarca/série/cliente search found
  // nothing).
  if (typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const rawTerm = data.searchingFor.trim();
    const term = normalizeSearchTerm(rawTerm);
    const searchConditions: any[] = [
      // Logomarca + série — campos das TAREFAS do orçamento. `some` e não o
      // filtro to-one: um orçamento cobre N veículos, e achar o orçamento pela
      // série de QUALQUER um deles é justamente o que o operador quer quando
      // digita o número que está lendo no caminhão à frente dele.
      { tasks: { some: { nameNormalized: { contains: term } } } },
      { tasks: { some: { serialNumberNormalized: { contains: term } } } },
      {
        tasks: {
          some: { truck: { plateNormalized: { contains: normalizeVehicleSearchTerm(term) } } },
        },
      },
      // Cliente — task's own customer and each billing customer config
      { tasks: { some: { customer: { fantasyNameNormalized: { contains: term } } } } },
      { tasks: { some: { customer: { corporateNameNormalized: { contains: term } } } } },
      {
        customerConfigs: {
          some: { customer: { fantasyNameNormalized: { contains: term } } },
        },
      },
      {
        customerConfigs: {
          some: { customer: { corporateNameNormalized: { contains: term } } },
        },
      },
      // Service descriptions (original behaviour, preserved)
      { services: { some: { descriptionNormalized: { contains: term } } } },
    ];
    // CNPJ/CPF — stored digits-only, so match both the term as typed and its
    // stripped digits ("13.636" and "13636" both hit)
    const searchDigits = rawTerm.replace(/\D/g, '');
    if (searchDigits.length > 0) {
      const documentTerms = searchDigits === term ? [searchDigits] : [term, searchDigits];
      for (const documentTerm of documentTerms) {
        searchConditions.push(
          { tasks: { some: { customer: { cnpjNormalized: { contains: documentTerm } } } } },
          { tasks: { some: { customer: { cpfNormalized: { contains: documentTerm } } } } },
          {
            customerConfigs: {
              some: { customer: { cnpjNormalized: { contains: documentTerm } } },
            },
          },
          {
            customerConfigs: {
              some: { customer: { cpfNormalized: { contains: documentTerm } } },
            },
          },
        );
      }
    }
    transformed.where = {
      ...transformed.where,
      OR: searchConditions,
    };
    delete transformed.searchingFor;
  }

  // Handle taskId filter (FK lives on Task, not TaskQuote)
  // `some`: "o orçamento que cobre esta tarefa". Com um veículo é a mesma
  // consulta de sempre; com sessenta, é a única que responde.
  if (data.taskId) {
    transformed.where = {
      ...transformed.where,
      tasks: { some: { id: data.taskId } },
    };
    delete transformed.taskId;
  }

  // Handle hasTask filter
  // `some: {}` / `none: {}` é a forma to-many de "tem tarefa" / "não tem": o
  // `isNot: null` / `null` do to-one não existe mais no `TaskQuoteWhereInput`.
  if (data.hasTask !== undefined) {
    transformed.where = {
      ...transformed.where,
      tasks: data.hasTask ? { some: {} } : { none: {} },
    };
    delete transformed.hasTask;
  }

  // Handle status filter
  if (data.status) {
    transformed.where = {
      ...transformed.where,
      status: data.status,
    };
    delete transformed.status;
  }

  return transformed;
};

// =====================
// GetMany Schema - TaskQuote
// =====================

export const taskQuoteGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: taskQuoteWhereSchema.optional(),
    orderBy: taskQuoteOrderBySchema.optional(),
    include: taskQuoteIncludeSchema.optional(),

    // Convenience filters
    ...taskQuoteFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    expiresAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(taskQuoteTransform);

// =====================
// Nested Schemas for Relations
// =====================

// CustomerConfig nested schema (for per-customer billing config)
// Installment schema for direct installment input
export const installmentInputSchema = z.object({
  number: z.number().int().min(1),
  dueDate: z.coerce.date(),
  amount: moneySchema,
});

// Structured payment config (replaces paymentCondition going forward)
export const paymentConfigSchema = z.object({
  type: z.enum(['CASH', 'INSTALLMENTS']),
  // Intended settlement method — stamped onto every Installment this config generates
  // (invoice-generation.service.ts `resolveInstallmentPaymentMethod`). CASH configs carry
  // an explicit choice (web: "À Vista - Boleto" / "À Vista - Pix"); INSTALLMENTS configs
  // default to BANK_SLIP when omitted.
  method: z.enum(['PIX', 'BANK_SLIP']).optional(),
  cashDays: z.number().int().min(1).max(365).optional(),
  installmentCount: z.number().int().min(2).max(6).optional(),
  installmentStep: z.number().int().min(1).max(365).optional(),
  entryDays: z.number().int().min(1).max(365).optional(),
  specificDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const taskQuoteCustomerConfigCreateNestedSchema = z
  .object({
    customerId: z.string().uuid('ID de cliente invalido'),
    /**
     * A TAREFA que esta configuração fatura, ou ausente/nulo para "todas".
     *
     * Normalmente o cliente NÃO manda isto: quem deriva as configurações a partir
     * de `billingSplit` + as tarefas do orçamento é o servidor
     * (`expectedConfigTaskIds`), justamente para que a tela não precise montar
     * sessenta objetos idênticos a cada gravação. O campo existe para o caminho em
     * que a tela edita UMA fatia — mudar a condição de pagamento só do caminhão
     * 37, por exemplo.
     */
    taskId: z.string().uuid('Tarefa invalida').optional().nullable(),
    // NOTE on wrapper order: `.default(x).optional()` yields ZodOptional(ZodDefault),
    // which leaves an OMITTED key as `undefined`. The reverse, `.optional().default(x)`,
    // yields ZodDefault(ZodOptional) and MATERIALIZES x for an absent key — which
    // silently defeats the "absence = preserve" contract that
    // task-quote-customer-config-sync.ts relies on to keep DB-owned values. The two
    // orderings are one token apart with opposite semantics and no type-level signal,
    // so keep them all in this form. Real columns already carry @default in Prisma.
    subtotal: moneySchema.default(0).optional(),
    total: moneySchema.default(0).optional(),
    // Global customer discount
    discountType: discountTypeSchema.default(DISCOUNT_TYPE.NONE).optional(),
    discountValue: moneySchema.nullable().optional(),
    discountReference: z.string().max(500, 'Maximo de 500 caracteres').optional().nullable(),
    // Payment condition — legacy string enum (deprecated, use paymentConfig instead)
    paymentCondition: paymentConditionSchema.optional().nullable(),
    // Structured payment config (replaces paymentCondition for new billing flow)
    paymentConfig: paymentConfigSchema.optional().nullable(),
    customPaymentText: z.string().max(2000).optional().nullable(),
    // Must stay `.default().optional()` — see the ordering note above. With the
    // reverse order an update that omits these silently reset BOTH to true,
    // re-enabling NFS-e emission and boleto registration for a customer configured
    // not to receive them.
    generateInvoice: z.boolean().default(true).optional(),
    generateBankSlip: z.boolean().default(true).optional(),
    orderNumber: z.string().max(100, 'Máximo de 100 caracteres').optional().nullable(),
    responsibleId: z.string().uuid('ID de responsavel invalido').optional().nullable(),
    // Direct installments (alternative to paymentCondition-based generation)
    installments: z.array(installmentInputSchema).optional(),
  })
  .superRefine((data, ctx) => {
    // A PERCENTAGE discount must be within 0–100. Without this guard a value > 100
    // silently clamps the computed total to 0 (a free quote). FIXED_VALUE keeps its
    // own non-negative bound from moneySchema and has no upper limit.
    if (
      data.discountType === DISCOUNT_TYPE.PERCENTAGE &&
      data.discountValue != null &&
      (data.discountValue < 0 || data.discountValue > 100)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: 'Desconto em porcentagem deve estar entre 0 e 100.',
      });
    }
  });

// Simultaneous tasks schema
export const simultaneousTasksSchema = z
  .number()
  .int('Deve ser um numero inteiro')
  .min(1, 'Deve ter no minimo 1 tarefa simultanea')
  .max(100, 'Deve ter no maximo 100 tarefas simultaneas')
  .nullable()
  .optional();

// Discount reference schema
export const discountReferenceSchema = z
  .string()
  .max(500, 'Maximo de 500 caracteres atingido')
  .nullable()
  .optional();

// TaskQuoteService nested schema
// Amount is optional and defaults to 0 (courtesy services)
export const taskQuoteServiceCreateNestedSchema = z.object({
  id: z.string().uuid().optional(), // For updating existing services
  description: z
    .string()
    .min(1, 'Descricao e obrigatoria')
    .max(400, 'Maximo de 400 caracteres atingido'),
  observation: z.string().max(2000, 'Maximo de 2000 caracteres atingido').optional().nullable(),
  amount: z
    .number()
    .min(0, { message: 'Valor nao pode ser negativo' })
    .optional()
    .nullable()
    .default(0)
    .transform(val => val ?? 0),
  invoiceToCustomerId: z.string().uuid('Cliente invalido').optional().nullable(),
});

// TaskQuote nested schema for task create/update (matches Prisma TaskQuote model)
export const taskQuoteCreateNestedSchema = z.object({
  services: z
    .array(taskQuoteServiceCreateNestedSchema)
    .min(1, 'Pelo menos um servico e obrigatorio'),
  expiresAt: z.coerce.date({
    errorMap: () => ({ message: 'Data de validade invalida' }),
  }),
  status: taskQuoteStatusSchema.default(TASK_QUOTE_STATUS.PENDING),
  // Aggregate totals (computed from customerConfigs)
  subtotal: moneySchema.optional(),
  total: moneySchema.optional(),

  // Guarantee Terms
  guaranteeYears: guaranteeYearsSchema.optional().nullable(),
  customGuaranteeText: z.string().max(2000).optional().nullable(),

  // Custom Forecast - manual override for production days displayed in budget (1-30 days)
  customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

  // Layout Files (max 2, ordered File ids)
  layoutFileIds: z.array(z.string().uuid()).max(2).optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  customerConfigs: z
    .array(taskQuoteCustomerConfigCreateNestedSchema)
    .min(1, 'Pelo menos uma configuracao de cliente e obrigatoria'),
});

// =====================
// Junto ou separado
// =====================

/**
 * Como o cliente paga um orçamento que cobre mais de um veículo.
 *
 * `JOINT` (padrão) é o comportamento de sempre: uma configuração de faturamento
 * por cliente, uma fatura, um plano de parcelas, uma NFS-e. Num orçamento de uma
 * tarefa só, indistinguível do que existia antes desta feature.
 *
 * `PER_TASK` fatia por veículo: uma configuração por (cliente × tarefa), e o
 * financeiro aprova veículo a veículo.
 */
export const quoteBillingSplitSchema = z.enum(['JOINT', 'PER_TASK']);

// =====================
// CRUD Schemas - TaskQuote
// =====================

export const taskQuoteCreateSchema = z
  .object({
    subtotal: moneySchema,
    total: moneySchema,
    expiresAt: z.coerce.date({ errorMap: () => ({ message: 'Data de validade invalida' }) }),
    status: taskQuoteStatusSchema.default(TASK_QUOTE_STATUS.PENDING),
    /**
     * A TAREFA do orçamento — forma antiga, de UMA tarefa.
     *
     * Mantida e ainda aceita: o app Flutter instalado nos aparelhos envia este
     * campo, e ele não é atualizado no mesmo instante que a API. Quando `taskIds`
     * vem, ele é ignorado; quando não vem, `taskIds = [taskId]`.
     */
    taskId: z.string().uuid('Tarefa invalida').optional(),
    /**
     * AS TAREFAS do orçamento — uma por veículo.
     *
     * A tela de criação já produzia N tarefas do produto cartesiano de placas ×
     * números de série; o que mudou é que agora elas compartilham UM orçamento em
     * vez de gerar um por tarefa. Dois números de série ⇒ um orçamento para os
     * dois; um número de série ⇒ uma tarefa, como sempre.
     */
    taskIds: z
      .array(z.string().uuid('Tarefa invalida'))
      .min(1, 'Pelo menos uma tarefa e obrigatoria')
      .max(200, 'Maximo de 200 tarefas por orcamento')
      .optional(),
    billingSplit: quoteBillingSplitSchema.default('JOINT').optional(),
    services: z
      .array(taskQuoteServiceCreateNestedSchema)
      .min(1, 'Pelo menos um servico e obrigatorio')
      .optional(),

    // Guarantee Terms
    guaranteeYears: guaranteeYearsSchema.optional().nullable(),
    customGuaranteeText: z.string().max(2000).optional().nullable(),

    // Custom Forecast - manual override for production days displayed in budget (1-30 days)
    customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

    // Layout Files (max 2, ordered File ids)
    layoutFileIds: z.array(z.string().uuid()).max(2).optional().nullable(),

    simultaneousTasks: simultaneousTasksSchema,
    customerConfigs: z
      .array(taskQuoteCustomerConfigCreateNestedSchema)
      .min(1, 'Pelo menos uma configuracao de cliente e obrigatoria'),
  })
  .superRefine((data, ctx) => {
    // Uma das duas formas tem de vir. Sem isto, um payload sem nenhuma delas
    // criaria um orçamento SEM TAREFA — que compila, grava, e só se descobre na
    // tela do financeiro, onde o registro aparece sem veículo e sem como faturar.
    if (!data.taskIds?.length && !data.taskId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskIds'],
        message: 'Informe ao menos uma tarefa para o orçamento.',
      });
    }
    // Duplicata no array cria duas linhas de veículo idênticas no documento e
    // dobra o total. Vem de retentativa de envio, não de intenção.
    if (data.taskIds && new Set(data.taskIds).size !== data.taskIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskIds'],
        message: 'A mesma tarefa foi informada mais de uma vez.',
      });
    }
  });

export const taskQuoteUpdateSchema = z.object({
  subtotal: moneySchema.optional(),
  total: moneySchema.optional(),
  expiresAt: z.coerce
    .date({ errorMap: () => ({ message: 'Data de validade invalida' }) })
    .optional(),
  status: taskQuoteStatusSchema.optional(),
  taskId: z.string().uuid('Tarefa invalida').optional(),
  /**
   * O CONJUNTO de tarefas do orçamento. Ausente = não mexe; presente =
   * reconcilia (vincula as novas, desvincula as que saíram).
   *
   * Acrescentar ou retirar um veículo é alteração MATERIAL: muda o total e muda
   * o objeto do contrato. A detecção de mudança material derruba a coleta de
   * assinaturas em andamento, e é isso que se quer.
   */
  taskIds: z
    .array(z.string().uuid('Tarefa invalida'))
    .min(1, 'Pelo menos uma tarefa e obrigatoria')
    .max(200, 'Maximo de 200 tarefas por orcamento')
    .optional(),
  billingSplit: quoteBillingSplitSchema.optional(),
  services: z.array(taskQuoteServiceCreateNestedSchema).optional(),

  // Guarantee Terms
  guaranteeYears: guaranteeYearsSchema.optional().nullable(),
  customGuaranteeText: z.string().max(2000).optional().nullable(),

  // Custom Forecast - manual override for production days displayed in budget (1-30 days)
  customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

  // Layout Files (max 2, ordered File ids)
  layoutFileIds: z.array(z.string().uuid()).max(2).optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  // `.min(1)` mirrors the create schema: an empty array is not "no change", it
  // instructs the reconcile to DELETE every billing config, collapsing the quote to
  // the raw undiscounted services sum. No client intends that.
  customerConfigs: z
    .array(taskQuoteCustomerConfigCreateNestedSchema)
    .min(1, 'Pelo menos uma configuracao de cliente e obrigatoria')
    .optional(),
});

// =====================
// Batch Operations Schemas - TaskQuote
// =====================

export const taskQuoteBatchCreateSchema = z.object({
  quotes: z.array(taskQuoteCreateSchema).min(1, 'Pelo menos um orcamento deve ser fornecido'),
});

export const taskQuoteBatchUpdateSchema = z.object({
  quotes: z
    .array(
      z.object({
        id: z.string().uuid('Orcamento invalido'),
        data: taskQuoteUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um orcamento deve ser fornecido'),
});

export const taskQuoteBatchDeleteSchema = z.object({
  quoteIds: z
    .array(z.string().uuid('Orcamento invalido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const taskQuoteQuerySchema = z.object({
  include: taskQuoteIncludeSchema.optional(),
});

// =====================
// Export Inferred Types
// =====================

export type TaskQuoteCreateFormData = z.infer<typeof taskQuoteCreateSchema>;
export type TaskQuoteUpdateFormData = z.infer<typeof taskQuoteUpdateSchema>;
export type TaskQuoteGetManyFormData = z.infer<typeof taskQuoteGetManySchema>;
export type TaskQuoteInclude = z.infer<typeof taskQuoteIncludeSchema>;
export type TaskQuoteOrderBy = z.infer<typeof taskQuoteOrderBySchema>;
export type TaskQuoteWhere = z.infer<typeof taskQuoteWhereSchema>;
export type TaskQuoteServiceCreateNestedFormData = z.infer<
  typeof taskQuoteServiceCreateNestedSchema
>;
export type TaskQuoteCustomerConfigCreateNestedFormData = z.infer<
  typeof taskQuoteCustomerConfigCreateNestedSchema
>;
export type TaskQuoteCreateNestedFormData = z.infer<typeof taskQuoteCreateNestedSchema>;
