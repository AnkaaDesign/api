// packages/schemas/src/task-quote.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableDate,
  moneySchema,
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
  TASK_QUOTE_STATUS.VERIFIED_BY_FINANCIAL,
  TASK_QUOTE_STATUS.BILLING_APPROVED,
  TASK_QUOTE_STATUS.UPCOMING,
  TASK_QUOTE_STATUS.DUE,
  TASK_QUOTE_STATUS.PARTIAL,
  TASK_QUOTE_STATUS.SETTLED,
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

export const taskQuoteIncludeSchema = z
  .object({
    task: z
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
              artworks: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              serviceOrders: z.boolean().optional(),
              truck: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
              quote: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    services: z.boolean().optional(),
    layoutFile: z.boolean().optional(),
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
        simultaneousTasks: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
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
          simultaneousTasks: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
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

  // Handle searchingFor filter
  if (data.searchingFor) {
    transformed.where = {
      ...transformed.where,
      services: {
        some: {
          description: {
            contains: data.searchingFor,
            mode: 'insensitive',
          },
        },
      },
    };
    delete transformed.searchingFor;
  }

  // Handle taskId filter (FK lives on Task, not TaskQuote)
  if (data.taskId) {
    transformed.where = {
      ...transformed.where,
      task: { id: data.taskId },
    };
    delete transformed.taskId;
  }

  // Handle hasTask filter
  if (data.hasTask !== undefined) {
    transformed.where = {
      ...transformed.where,
      task: data.hasTask ? { isNot: null } : null,
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

export const taskQuoteCustomerConfigCreateNestedSchema = z.object({
  customerId: z.string().uuid('ID de cliente invalido'),
  subtotal: moneySchema.optional().default(0),
  total: moneySchema.optional().default(0),
  // Payment condition used to generate installments at BILLING_APPROVED time
  paymentCondition: paymentConditionSchema.optional().nullable(),
  customPaymentText: z.string().max(2000).optional().nullable(),
  generateInvoice: z.boolean().optional().default(true),
  orderNumber: z.string().max(100, 'Máximo de 100 caracteres').optional().nullable(),
  responsibleId: z.string().uuid('ID de responsavel invalido').optional().nullable(),
  // Direct installments (alternative to paymentCondition-based generation)
  installments: z.array(installmentInputSchema).optional(),
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
  // Per-service discount (moved from CustomerConfig)
  discountType: discountTypeSchema.default(DISCOUNT_TYPE.NONE).optional(),
  discountValue: moneySchema.nullable().optional(),
  discountReference: z.string().max(500, 'Maximo de 500 caracteres').optional().nullable(),
});

// TaskQuote nested schema for task create/update (matches Prisma TaskQuote model)
export const taskQuoteCreateNestedSchema = z.object({
  services: z.array(taskQuoteServiceCreateNestedSchema).min(1, 'Pelo menos um servico e obrigatorio'),
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

  // Layout File
  layoutFileId: z.string().uuid().optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  customerConfigs: z.array(taskQuoteCustomerConfigCreateNestedSchema).min(1, 'Pelo menos uma configuracao de cliente e obrigatoria'),
});

// =====================
// CRUD Schemas - TaskQuote
// =====================

export const taskQuoteCreateSchema = z.object({
  subtotal: moneySchema,
  total: moneySchema,
  expiresAt: z.coerce.date({ errorMap: () => ({ message: 'Data de validade invalida' }) }),
  status: taskQuoteStatusSchema.default(TASK_QUOTE_STATUS.PENDING),
  taskId: z.string().uuid('Tarefa invalida'),
  services: z
    .array(taskQuoteServiceCreateNestedSchema)
    .min(1, 'Pelo menos um servico e obrigatorio')
    .optional(),

  // Guarantee Terms
  guaranteeYears: guaranteeYearsSchema.optional().nullable(),
  customGuaranteeText: z.string().max(2000).optional().nullable(),

  // Custom Forecast - manual override for production days displayed in budget (1-30 days)
  customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

  // Layout File
  layoutFileId: z.string().uuid().optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  customerConfigs: z.array(taskQuoteCustomerConfigCreateNestedSchema).min(1, 'Pelo menos uma configuracao de cliente e obrigatoria'),
});

export const taskQuoteUpdateSchema = z.object({
  subtotal: moneySchema.optional(),
  total: moneySchema.optional(),
  expiresAt: z.coerce
    .date({ errorMap: () => ({ message: 'Data de validade invalida' }) })
    .optional(),
  status: taskQuoteStatusSchema.optional(),
  taskId: z.string().uuid('Tarefa invalida').optional(),
  services: z.array(taskQuoteServiceCreateNestedSchema).optional(),

  // Guarantee Terms
  guaranteeYears: guaranteeYearsSchema.optional().nullable(),
  customGuaranteeText: z.string().max(2000).optional().nullable(),

  // Custom Forecast - manual override for production days displayed in budget (1-30 days)
  customForecastDays: z.number().int().min(1).max(30).optional().nullable(),

  // Layout File
  layoutFileId: z.string().uuid().optional().nullable(),

  simultaneousTasks: simultaneousTasksSchema,
  customerConfigs: z.array(taskQuoteCustomerConfigCreateNestedSchema).optional(),
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
export type TaskQuoteServiceCreateNestedFormData = z.infer<typeof taskQuoteServiceCreateNestedSchema>;
export type TaskQuoteCustomerConfigCreateNestedFormData = z.infer<typeof taskQuoteCustomerConfigCreateNestedSchema>;
export type TaskQuoteCreateNestedFormData = z.infer<typeof taskQuoteCreateNestedSchema>;
