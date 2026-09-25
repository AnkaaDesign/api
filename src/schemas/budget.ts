// packages/schemas/src/budget.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableDate,
  moneySchema,
  normalizeSearchTerm,
  normalizeVehicleSearchTerm,
  documentSearchDigits,
} from './common';
import type { Budget } from '@types';
import {
  TASK_QUOTE_STATUS,
  BILLING_STATUS,
  DISCOUNT_TYPE,
  PAYMENT_CONDITION,
  GUARANTEE_YEARS_OPTIONS,
} from '@constants';

// =====================
// Budget Status Schema
// =====================

// ⚠️ ESTA LISTA É ESCRITA À MÃO e o `tsc` não a confere contra o enum: um
// estado que exista no banco e falte aqui não vira erro de tipo — o zod o APAGA
// do filtro, e a lista volta sem ele em silêncio. Ver
// `reference_untyped_prisma_paths_hide_migrations`. Estado novo entra AQUI
// também, sempre.
export const budgetStatusSchema = z.enum([
  // Os TRÊS do portal do responsável entraram em 20/09/2026 junto com o enum.
  // Sem eles aqui a advertência acima se cumpria à risca: `updateStatus` não
  // tipava (`pnpm build` vermelho) e um filtro `status=IN_NEGOTIATION` na lista
  // era APAGADO pelo zod, devolvendo a tabela inteira sem dizer nada.
  TASK_QUOTE_STATUS.REQUESTED,
  TASK_QUOTE_STATUS.IN_NEGOTIATION,
  TASK_QUOTE_STATUS.PRE_APPROVED,
  TASK_QUOTE_STATUS.EXPIRED,
  TASK_QUOTE_STATUS.SIGNED,
  TASK_QUOTE_STATUS.PENDING,
  TASK_QUOTE_STATUS.APPROVED,
  TASK_QUOTE_STATUS.CANCELLED,
]);

// O ciclo do FATURAMENTO, que saiu do orçamento em 16/09/2026. Mesmo aviso da
// lista acima: escrita à mão, não conferida pelo compilador.
export const billingStatusSchema = z.enum([
  BILLING_STATUS.OVERDUE,
  BILLING_STATUS.PENDING,
  BILLING_STATUS.APPROVED,
  BILLING_STATUS.PARTIAL,
  BILLING_STATUS.SETTLED,
  BILLING_STATUS.CANCELLED,
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
// Budget Include Schema Based on Prisma Schema (Second Level Only)
// =====================

/**
 * Como se pede as TAREFAS do orçamento.
 *
 * `z.object()` do zod DESCARTA chave desconhecida em silêncio (não é `strict`
 * aqui): um `include` descartado não é erro — é só um campo que não veio. A
 * chave `task` no singular (anterior ao orçamento multitarefa) não é aceita:
 * chega ao repositório como ausente, e o orçamento volta sem veículo.
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
          logoPaints: z.boolean().optional(),
          serviceOrders: z.boolean().optional(),
          // A arte é do implemento (R2): a miniatura do detalhe pede
          // `implement: { include: { layouts: { include: { file: true } } } }`.
          implement: z
            .union([
              z.boolean(),
              z.object({
                include: z
                  .object({
                    layouts: z
                      .union([
                        z.boolean(),
                        z.object({
                          include: z.object({ file: z.boolean().optional() }).optional(),
                        }),
                      ])
                      .optional(),
                  })
                  .optional(),
              }),
            ])
            .optional(),
          airbrushing: z.boolean().optional(),
          quote: z.boolean().optional(),
        })
        .optional(),
    }),
  ])
  .optional();

export const budgetIncludeSchema = z
  .object({
    /** As tarefas do orçamento — uma por veículo. */
    tasks: quoteTasksIncludeSchema,
    services: z.boolean().optional(),
    /**
     * A REQUISIÇÃO que originou o orçamento, quando ele nasceu no portal.
     *
     * ⚠️ SEM ESTA CHAVE O `include` É DESCARTADO EM SILÊNCIO. Este objeto zod não
     * é `.strict()`, então `include: { request: true }` não dá erro — ele
     * simplesmente some, e a tela do comercial abre o painel da requisição VAZIO,
     * sem briefing, sem arquivos e sem o motivo da recusa. É a mesma armadilha
     * que o comentário de `customerConfigs` já documenta: o que o schema não
     * conhece, ele apaga.
     */
    request: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              requestedBy: z.boolean().optional(),
              preApprovedBy: z.boolean().optional(),
              refusedBy: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
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
              // `responsible` NÃO existe mais em `BudgetPayer` (migration
              // `20260918120000`). Deixar a chave no zod fazia o include do
              // cliente atravessar a borda e estourar no Prisma.
              installments: z
                .union([
                  z.boolean(),
                  z.object({
                    orderBy: z.object({ number: z.enum(['asc', 'desc']) }).optional(),
                  }),
                ])
                .optional(),
              /**
               * O FATURAMENTO do pagador.
               *
               * ⚠️ Sem esta chave o zod ESTRIPAVA `billing` do include em silêncio:
               * um objeto zod comum descarta o que não conhece, sem erro e sem
               * aviso. O app e a web pediam `billing` à mão e ele nunca chegava ao
               * mapper — de modo que a promessa de `withCoverageInclude` ("um
               * chamador que JÁ pediu `billing` é respeitado") não podia ser
               * verdade nesta rota, só na de `/tasks`, cujo include é um
               * `z.record` recursivo e passa inteiro.
               *
               * `z.any()` porque a forma é a do Prisma (select/include/orderBy
               * aninhados à vontade) e reescrevê-la aqui criaria um segundo
               * contrato para divergir do primeiro.
               */
              billing: z.any().optional(),
            })
            .optional(),
          /** Mesma razão, para quem monta o nó com `select` em vez de `include`. */
          select: z.any().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Budget OrderBy Schema
// =====================

export const budgetOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        total: orderByDirectionSchema.optional(),
        // `subtotal` e `vehicleCount` são ESCALARES do orçamento e a lista os
        // oferece como coluna ordenável. Faltavam aqui — e `orderBy` NÃO é
        // `.strict()`, então o zod os descartava em silêncio: a seta aparecia no
        // cabeçalho e nada acontecia.
        subtotal: orderByDirectionSchema.optional(),
        vehicleCount: orderByDirectionSchema.optional(),
        expiresAt: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        // A FILA. Coluna gerada pelo banco: o instante de criação em segundos,
        // negado para APPROVED e CANCELLED. Ordenar por `statusOrder` e depois
        // por ela, ambas `asc`, dá pendente mais ANTIGO primeiro e aprovado mais
        // RECENTE primeiro — é a ordenação padrão da lista.
        queueRank: orderByDirectionSchema.optional(),
        budgetNumber: orderByDirectionSchema.optional(),
        simultaneousTasks: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        // Sem `task`: o Prisma não ordena um pai por campo de relação de LISTA
        // (qual dos sessenta prazos ordenaria o orçamento?). Como o `orderBy`
        // não é `.strict()`, a chave é descartada aqui em silêncio.
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
          // Ver o ramo de objeto acima. `subtotal` e `vehicleCount` faltavam
          // SÓ aqui — e a lista manda ORDENAÇÃO EM ARRAY, então era este ramo
          // que os apagava.
          subtotal: orderByDirectionSchema.optional(),
          vehicleCount: orderByDirectionSchema.optional(),
          queueRank: orderByDirectionSchema.optional(),
          budgetNumber: orderByDirectionSchema.optional(),
          simultaneousTasks: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Budget Where Schema
// =====================

export const budgetWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.union([budgetWhereSchema, z.array(budgetWhereSchema)]).optional(),
      OR: z.array(budgetWhereSchema).optional(),
      NOT: z.union([budgetWhereSchema, z.array(budgetWhereSchema)]).optional(),
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
      /**
       * ⚠️ `z.coerce.date()`, não `z.coerce.date()`.
       *
       * O filtro chega como STRING ISO no query param, e o pipe de validação
       * revive booleano e número aninhados, mas não datas. Com `z.coerce.date()` o
       * filtro de Validade levava 400 — e, por ser `.strict()`, derrubava a
       * lista inteira. O schema de Task já usa `coerce` por este mesmo motivo.
       */
      expiresAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
          }),
        ])
        .optional(),
      status: z
        .union([
          budgetStatusSchema,
          z.object({
            equals: budgetStatusSchema.optional(),
            in: z.array(budgetStatusSchema).optional(),
            notIn: z.array(budgetStatusSchema).optional(),
            not: budgetStatusSchema.optional(),
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
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
          }),
        ])
        .optional(),
      updatedAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
          }),
        ])
        .optional(),
      /**
       * O NÚMERO DO ORÇAMENTO como filtro.
       *
       * ⚠️ `where` é `.strict()`: enquanto a chave não existiu aqui, mandá-la
       * derrubava a CONSULTA INTEIRA com `unrecognized_keys` — não o filtro, a
       * lista. É a diferença entre o `where` (estrito, recusa) e o `orderBy` (não
       * estrito, apaga em silêncio), e as duas formas de falhar já morderam.
       */
      budgetNumber: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            not: z.number().optional(),
          }),
        ])
        .optional(),
      /** Quantos veículos o orçamento cobre — escalar desnormalizado. */
      vehicleCount: z
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
      /** Modo de cobrança declarado (`JOINT` | `PER_TASK` | `CUSTOM`). */
      billingSplit: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),
      /**
       * Filtro pelos PAGADORES — é por aqui que a lista filtra por cliente de
       * faturamento, e é a relação de lista que responde "este orçamento cobra
       * deste cliente?".
       */
      customerConfigs: z
        .object({
          some: z.record(z.any()).optional(),
          every: z.record(z.any()).optional(),
          none: z.record(z.any()).optional(),
        })
        .optional(),
      /** Filtro pelos FATURAMENTOS do orçamento (estado da cobrança). */
      billings: z
        .object({
          some: z.record(z.any()).optional(),
          every: z.record(z.any()).optional(),
          none: z.record(z.any()).optional(),
        })
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
      // ⚠️ `task` e `taskId` NÃO EXISTEM AQUI: `Task.quoteId` deixou de ser
      // `@unique` e a FK mudou de lado, então nenhuma das duas é campo de
      // `BudgetWhereInput`. O `.strict()` as recusa com 400 — "o orçamento
      // deste veículo" é `tasks: { some: { id } }`.
    })
    .partial()
    .strict(),
);

// =====================
// Convenience Filters
// =====================

const budgetFilters = {
  searchingFor: z.string().optional(),
  taskId: z.string().uuid().optional(),
  hasTask: z.boolean().optional(),
  status: budgetStatusSchema.optional(),
};

// =====================
// Transform Function for Filters
// =====================

const budgetTransform = (data: any) => {
  const transformed: any = { ...data };

  // Handle searchingFor filter — search across logomarca (task name), série
  // (task serial number / implement plate), cliente (task customer + billing
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
      // digita o número que está lendo no implemento à frente dele.
      { tasks: { some: { nameNormalized: { contains: term } } } },
      { tasks: { some: { implement: { serialNumberNormalized: { contains: term } } } } },
      {
        tasks: {
          some: { implement: { plateNormalized: { contains: normalizeVehicleSearchTerm(term) } } },
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
    // `documentSearchDigits` devolve `null` quando o termo não é um documento:
    // um `replace(/\D/g,'')` cru transformava "QA 4V" nos dígitos "4" e o
    // `contains` resultante casava com quase todo CNPJ do cadastro.
    const searchDigits = documentSearchDigits(rawTerm);
    if (searchDigits) {
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

  // Handle taskId filter (FK lives on Task, not Budget)
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
  // `isNot: null` / `null` do to-one não existe mais no `BudgetWhereInput`.
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
// GetMany Schema - Budget
// =====================

export const budgetGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    // Teto de 1000, não 100: a lista exporta tudo em páginas de 200 e o pager
    // anterior/próximo reconstrói a ordem inteira com até 1000 ids. Com o teto em
    // 100 os dois levavam 400 — e o exportador só descobriria isso em produção,
    // porque a tela nunca pede mais que 40.
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    take: z.coerce.number().int().positive().max(1000).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: budgetWhereSchema.optional(),
    orderBy: budgetOrderBySchema.optional(),
    include: budgetIncludeSchema.optional(),

    // Convenience filters
    ...budgetFilters,

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
  .transform(budgetTransform);

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

export const budgetPayerCreateNestedSchema = z
  .object({
    /**
     * O ID DESTA FATIA, quando a tela edita uma que já existe.
     *
     * ⚠️ NÃO É DECORATIVO, e a ausência dele foi um defeito real. O objeto não é
     * `.strict()`: enquanto a chave não existiu aqui, o zod APAGOU em silêncio o
     * `id` que os assistentes já mandavam, a reconciliação ficou sem identidade
     * para casar as fatias e quatro faturamentos do mesmo cliente chegavam
     * indistinguíveis — a última gravação vencia sobre as outras três, levando
     * junto desconto, condição de pagamento e "gerar NF/boleto" de cada uma.
     */
    id: z.string().uuid('ID de faturamento invalido').optional(),
    customerId: z.string().uuid('ID de cliente invalido'),
    /**
     * A COBERTURA — os VEÍCULOS que esta fatura cobra.
     *
     * Ausente = "decida pelo modo" (`billingSplit` + as tarefas do orçamento),
     * que é o que as telas mandam quando não estão compondo lotes: não precisam
     * montar sessenta objetos idênticos a cada gravação. Presente = a tela está
     * dizendo exatamente quem cobra quem, e o modo não sobrescreve.
     *
     * Um veículo só pode estar na cobertura de UM faturamento por cliente — é
     * índice único no banco (`BillingTask`), não convenção.
     */
    taskIds: z
      .array(z.string().uuid('Tarefa invalida'))
      .max(200, 'Maximo de 200 tarefas por faturamento')
      .optional(),
    /**
     * @deprecated Forma anterior à cobertura explícita: UMA tarefa, `null` para
     * "todas". Equivale a `taskIds: [taskId]`; `null` equivale a ausência.
     *
     * ⚠️ NÃO remova a chave achando que "o campo não existe mais" — ver a nota
     * sobre `.strict()` em `id`.
     */
    taskId: z.string().uuid('Tarefa invalida').optional().nullable(),
    // NOTE on wrapper order: `.default(x).optional()` yields ZodOptional(ZodDefault),
    // which leaves an OMITTED key as `undefined`. The reverse, `.optional().default(x)`,
    // yields ZodDefault(ZodOptional) and MATERIALIZES x for an absent key — which
    // silently defeats the "absence = preserve" contract that
    // budget-customer-config-sync.ts relies on to keep DB-owned values. The two
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
    /**
     * ⚠️ `orderNumber` NÃO EXISTE AQUI: o número do pedido de compra é do
     * VEÍCULO (`Task.customerOrderNumber`, escrito por `PUT /tasks/:id`) — um
     * orçamento cobre N implementos e o pedido é por entrega. O objeto não é
     * `.strict()`, então o zod descarta a chave em silêncio.
     */
    /**
     * `responsibleId` SAIU: a coluna do pagador foi dropada, e quem responde
     * pelo orçamento é `Task.responsibles`. Sem a chave, o zod APAGA o que um
     * cliente antigo mandar, que é exatamente o desejado: o valor
     * seria descartado de qualquer forma, e deixá-lo passar faria o Prisma
     * responder "Unknown argument `responsibleId`" e derrubar a gravação inteira.
     */
    /**
     * ⚠️ `installments` NÃO EXISTE AQUI, e a remoção é a correção.
     *
     * A chave era aceita — "parcelas diretas, alternativa à geração por condição
     * de pagamento" — e NUNCA foi lida por ninguém: nem a criação, nem a
     * reconciliação de pagadores, nem a geração de faturas a consultam. Quem
     * mandasse um plano de parcelas explícito recebia 200 e um orçamento em que
     * nada tinha acontecido, e as parcelas que apareciam depois eram as que a
     * `paymentCondition` derivou — outro plano, com outras datas e outros valores.
     *
     * Um campo aceito e ignorado é pior do que um campo recusado: o cliente da
     * API não tem como descobrir que o pedido dele evaporou. Agora o zod o
     * descarta (o objeto não é `.strict()`), e quem precisa de parcelas fora do
     * padrão usa `paymentConfig` (`CASH`/`INSTALLMENTS` com dias e passo) ou a
     * condição personalizada (`paymentCondition: 'CUSTOM'` + `customPaymentText`).
     *
     * O SCHEMA `installmentInputSchema` continua exportado: ele descreve a forma
     * de uma parcela e é usado fora deste objeto.
     */
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

// BudgetItem nested schema
// Amount is optional and defaults to 0 (courtesy services)
export const budgetItemCreateNestedSchema = z.object({
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

// Budget nested schema for task create/update (matches Prisma Budget model)
export const budgetCreateNestedSchema = z.object({
  services: z
    .array(budgetItemCreateNestedSchema)
    .min(1, 'Pelo menos um servico e obrigatorio'),
  expiresAt: z.coerce.date({
    errorMap: () => ({ message: 'Data de validade invalida' }),
  }),
  status: budgetStatusSchema.default(TASK_QUOTE_STATUS.PENDING),
  // Aggregate totals (computed from customerConfigs)
  subtotal: moneySchema.optional(),
  total: moneySchema.optional(),

  // Guarantee Terms
  guaranteeYears: guaranteeYearsSchema.optional().nullable(),
  customGuaranteeText: z.string().max(2000).optional().nullable(),

  // Custom Forecast - manual override for production days displayed in budget (1-30 days)
  customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  customerConfigs: z
    .array(budgetPayerCreateNestedSchema)
    .min(1, 'Pelo menos uma configuracao de cliente e obrigatoria'),
});

// =====================
// Junto ou separado
// =====================

/**
 * Como o cliente paga um orçamento que cobre mais de um veículo.
 *
 * `JOINT` (padrão) é o comportamento de sempre: um faturamento por cliente, uma
 * fatura, um plano de parcelas, uma NFS-e. Num orçamento de uma tarefa só,
 * indistinguível do que existia antes desta feature.
 *
 * `PER_TASK` fatia por veículo: um faturamento por (cliente × tarefa), e o
 * financeiro aprova veículo a veículo.
 *
 * `CUSTOM` são lotes livres — "1 a 20 no pedido 8842, 21 a 60 no 9013". Aqui o
 * modo não DERIVA a cobertura: ela vem em `customerConfigs[].taskIds`, e o
 * servidor só sameia (descarta veículo que não é do orçamento) e isola o que
 * nenhum lote reivindicou.
 */
export const quoteBillingSplitSchema = z.enum(['JOINT', 'PER_TASK', 'CUSTOM']);

// =====================
// CRUD Schemas - Budget
// =====================

export const budgetCreateBaseSchema = z.object({
  subtotal: moneySchema,
  total: moneySchema,
  expiresAt: z.coerce.date({ errorMap: () => ({ message: 'Data de validade invalida' }) }),
  status: budgetStatusSchema.default(TASK_QUOTE_STATUS.PENDING),
  /**
   * AS TAREFAS do orçamento — uma por veículo. Obrigatório: sem ele o orçamento
   * nasceria SEM TAREFA — compila, grava, e só se descobre na tela do
   * financeiro, onde o registro aparece sem veículo e sem como faturar.
   *
   * ⚠️ `taskId` no singular NÃO é aceito: o objeto não é `.strict()`, então o
   * zod o descarta e a falta de `taskIds` responde 400. UM veículo é
   * `taskIds: [id]`.
   *
   * A tela de criação já produzia N tarefas do produto cartesiano de placas ×
   * números de série; o que mudou é que agora elas compartilham UM orçamento em
   * vez de gerar um por tarefa. Dois números de série ⇒ um orçamento para os
   * dois; um número de série ⇒ uma tarefa, como sempre.
   */
  taskIds: z
    .array(z.string().uuid('Tarefa invalida'), {
      required_error: 'Informe ao menos uma tarefa para o orçamento.',
    })
    .min(1, 'Informe ao menos uma tarefa para o orçamento.')
    .max(200, 'Maximo de 200 tarefas por orcamento'),
  billingSplit: quoteBillingSplitSchema.default('JOINT').optional(),
  services: z
    .array(budgetItemCreateNestedSchema)
    .min(1, 'Pelo menos um servico e obrigatorio')
    .optional(),

  // Guarantee Terms
  guaranteeYears: guaranteeYearsSchema.optional().nullable(),
  customGuaranteeText: z.string().max(2000).optional().nullable(),

  // Custom Forecast - manual override for production days displayed in budget (1-30 days)
  customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  customerConfigs: z
    .array(budgetPayerCreateNestedSchema)
    .min(1, 'Pelo menos uma configuracao de cliente e obrigatoria'),
});

export const budgetCreateSchema = budgetCreateBaseSchema.superRefine((data, ctx) => {
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

/**
 * O orçamento de uma criação ATÔMICA de tarefas + orçamento.
 *
 * É o mesmo corpo, sem `taskIds`: as tarefas ainda não existem quando o
 * pedido chega — elas nascem na MESMA transação, e é o servidor que liga uma
 * coisa na outra. Exigir os ids aqui obrigaria a tela a criar as tarefas antes,
 * que é exatamente o que deixava N tarefas órfãs quando o orçamento falhava.
 */
export const budgetCreateNestedInBatchSchema = budgetCreateBaseSchema.omit({
  taskIds: true,
});

/**
 * SIMPLIFICAR ORÇAMENTO — o corpo das duas rotas de união.
 *
 * Recebe TAREFAS e não orçamentos porque é assim que a tela seleciona: na Agenda
 * e no Cronograma a linha é um veículo. A deduplicação por orçamento é do
 * serviço.
 *
 * O teto de 200 não é medo de carga: é o tamanho em que a união deixa de ser uma
 * simplificação e vira uma migração — e migração se faz por script, com alguém
 * olhando. O maior grupo real em produção tem trinta.
 */
/**
 * O corpo de `PATCH /budgets/:id/customer-config-order-number` — o número do
 * pedido de compra de UM veículo do orçamento.
 *
 * `taskId` é obrigatório: o pedido é do VEÍCULO desde a migração
 * `20260909170000`, e num orçamento de sessenta implementos escrever nos sessenta
 * apagaria os pedidos dos outros cinquenta e nove. `customerId` não é aceito —
 * o pedido não é mais por cliente; o objeto não é `.strict()`, então o zod o
 * descarta.
 *
 * ⚠️ `orderNumber` é `nullable` mas NÃO aceita string vazia: quem quer apagar
 * manda `null` explícito.
 */
export const customerConfigOrderNumberSchema = z
  .object({
    taskId: z.string({ required_error: 'Informe o veículo (taskId).' }).uuid('Veículo inválido'),
    orderNumber: z
      .string()
      .max(100, 'Máximo de 100 caracteres')
      .nullable()
      .refine(v => v === null || v.trim().length > 0, {
        message: 'Informe o número do pedido ou envie null para apagar.',
      }),
  });

export type CustomerConfigOrderNumberFormData = z.infer<typeof customerConfigOrderNumberSchema>;

export const budgetMergeSchema = z.object({
  taskIds: z
    .array(z.string().uuid('Veículo inválido'))
    .min(2, 'Selecione pelo menos dois veículos.')
    .max(200, 'Selecione no máximo 200 veículos por vez.'),
  /**
   * O modo de cobrança do resultado. Padrão `PER_TASK` — ver a decisão em
   * `BudgetService.mergeQuotes`: quatro orçamentos de um veículo JÁ ERAM
   * quatro faturamentos independentes, e `JOINT` os colapsaria numa fatura só.
   */
  billingSplit: z.enum(['JOINT', 'PER_TASK']).optional(),
});

export type BudgetMergeFormData = z.infer<typeof budgetMergeSchema>;

export const budgetUpdateSchema = z.object({
  subtotal: moneySchema.optional(),
  total: moneySchema.optional(),
  /**
   * O NÚMERO DO ORÇAMENTO — corrigível, e só por quem a rota já deixa entrar.
   *
   * `PUT /budgets/:id` é `@Roles(ADMIN, FINANCIAL, COMMERCIAL)`, que é
   * exatamente quem pode renumerar. Não há gate extra aqui porque não há
   * ninguém a mais para barrar.
   *
   * Sem esta declaração o campo era rastreado no changelog e inalcançável pela
   * API: `fieldsToTrack` listava `budgetNumber` e nenhuma rota o escrevia.
   *
   * `@unique` no banco — colisão volta como P2002 e é traduzida em
   * `describePrismaFailure` para a frase que nomeia o número ocupado.
   */
  budgetNumber: z
    .number({ invalid_type_error: 'Número do orçamento deve ser um número' })
    .int('Número do orçamento deve ser inteiro')
    .positive('Número do orçamento deve ser maior que zero')
    .max(999999, 'Número do orçamento fora da faixa')
    .optional(),
  expiresAt: z.coerce
    .date({ errorMap: () => ({ message: 'Data de validade invalida' }) })
    .optional(),
  status: budgetStatusSchema.optional(),
  /**
   * ⚠️ `taskId` NÃO EXISTE AQUI, e a ausência é deliberada.
   *
   * `Budget` não tem essa coluna — a FK mudou de lado e hoje mora em
   * `Task.quoteId` —, mas o campo continuava declarado neste update e a tela
   * continuava mandando. Como o objeto não é `.strict()`, o zod agora o DESCARTA,
   * que é exatamente o que se quer: nada lê `data.taskId` no caminho de
   * atualização, e aceitá-lo produzia um 400 em toda gravação de orçamento com
   * cobrança aprovada. `isScalarChanged(undefined, "<uuid>")` responde sempre
   * "mudou", então a chave nunca era filtrada, e a trava do dinheiro recusava a
   * requisição inteira — inclusive prorrogar `expiresAt`, que a trava existe para
   * PERMITIR.
   *
   * Quem muda o conjunto de veículos usa `taskIds` (abaixo), que é lido.
   */
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
  services: z.array(budgetItemCreateNestedSchema).optional(),

  // Guarantee Terms
  guaranteeYears: guaranteeYearsSchema.optional().nullable(),
  customGuaranteeText: z.string().max(2000).optional().nullable(),

  // Custom Forecast - manual override for production days displayed in budget (1-30 days)
  customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  // `.min(1)` mirrors the create schema: an empty array is not "no change", it
  // instructs the reconcile to DELETE every billing config, collapsing the quote to
  // the raw undiscounted services sum. No client intends that.
  customerConfigs: z
    .array(budgetPayerCreateNestedSchema)
    .min(1, 'Pelo menos uma configuracao de cliente e obrigatoria')
    .optional(),
});

// =====================
// Batch Operations Schemas - Budget
// =====================

export const budgetBatchCreateSchema = z.object({
  quotes: z.array(budgetCreateSchema).min(1, 'Pelo menos um orcamento deve ser fornecido'),
});

export const budgetBatchUpdateSchema = z.object({
  quotes: z
    .array(
      z.object({
        id: z.string().uuid('Orcamento invalido'),
        data: budgetUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um orcamento deve ser fornecido'),
});

export const budgetBatchDeleteSchema = z.object({
  quoteIds: z
    .array(z.string().uuid('Orcamento invalido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const budgetQuerySchema = z.object({
  include: budgetIncludeSchema.optional(),
});

// =====================
// Export Inferred Types
// =====================

export type BudgetCreateFormData = z.infer<typeof budgetCreateSchema>;
export type BudgetUpdateFormData = z.infer<typeof budgetUpdateSchema>;
export type BudgetGetManyFormData = z.infer<typeof budgetGetManySchema>;
export type BudgetInclude = z.infer<typeof budgetIncludeSchema>;
export type BudgetOrderBy = z.infer<typeof budgetOrderBySchema>;
export type BudgetWhere = z.infer<typeof budgetWhereSchema>;
export type BudgetItemCreateNestedFormData = z.infer<
  typeof budgetItemCreateNestedSchema
>;
export type BudgetPayerCreateNestedFormData = z.infer<
  typeof budgetPayerCreateNestedSchema
>;
export type BudgetCreateNestedFormData = z.infer<typeof budgetCreateNestedSchema>;
