// packages/schemas/src/payroll.ts

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableDate,
  moneySchema,
  createUuidSchema,
  createNameSchema,
  percentageSchema,
} from './common';
import { BONUS_STATUS, PAYROLL_STATUS } from '@constants';

// =====================
// Discount Schemas
// =====================

export const discountCreateSchema = z
  .object({
    percentage: percentageSchema.nullable().optional(),
    value: moneySchema.nullable().optional(),
    reference: createNameSchema(1, 200, 'Referência'),
  })
  .refine(
    data =>
      (data.percentage !== null && data.percentage !== undefined) ||
      (data.value !== null && data.value !== undefined),
    { message: 'Deve informar porcentagem ou valor fixo para o desconto' },
  );

export type DiscountCreateFormData = z.infer<typeof discountCreateSchema>;

export const discountUpdateSchema = z
  .object({
    percentage: percentageSchema.nullable().optional(),
    value: moneySchema.nullable().optional(),
    reference: createNameSchema(1, 200, 'Referência').optional(),
  })
  .refine(
    data => {
      // If any field is provided, we need to validate the percentage/value constraint
      const hasFields = Object.keys(data).some(key => (data as any)[key] !== undefined);
      if (!hasFields) return true;

      // If percentage or value are explicitly provided, one must be valid
      const hasPercentage = data.percentage !== null && data.percentage !== undefined;
      const hasValue = data.value !== null && data.value !== undefined;

      return hasPercentage || hasValue;
    },
    { message: 'Deve informar porcentagem ou valor fixo para o desconto' },
  );
export type DiscountUpdateFormData = z.infer<typeof discountUpdateSchema>;

// =====================
// Payroll Create/Update Schemas
// =====================

export const payrollCreateSchema = z
  .object({
    baseRemuneration: moneySchema,
    year: z
      .number()
      .int()
      .min(2020, 'Ano deve ser pelo menos 2020')
      .max(2100, 'Ano deve ser no máximo 2100'),
    month: z
      .number()
      .int()
      .min(1, 'Mês deve ser entre 1 e 12')
      .max(12, 'Mês deve ser entre 1 e 12'),
    userId: createUuidSchema('Usuário'),
    positionId: createUuidSchema('Cargo').nullable().optional(),
    status: z
      .enum(Object.values(PAYROLL_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'Status da folha de pagamento inválido' }),
      })
      .default(PAYROLL_STATUS.DRAFT),
    discounts: z.array(discountCreateSchema).optional().default([]),
  })
  .refine(
    () => {
      // Validate unique year/month/user combination
      return true; // This will be handled at the service level
    },
    { message: 'Já existe uma folha de pagamento para este usuário no período especificado' },
  );

export type PayrollCreateFormData = z.infer<typeof payrollCreateSchema>;

export const payrollUpdateSchema = z.object({
  baseRemuneration: moneySchema.optional(),
  positionId: createUuidSchema('Cargo').nullable().optional(),
  status: z
    .enum(Object.values(PAYROLL_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'Status da folha de pagamento inválido' }),
    })
    .optional(),
  discounts: z.array(discountCreateSchema).optional(),
});

export type PayrollUpdateFormData = z.infer<typeof payrollUpdateSchema>;

// =====================
// Batch Operation Schemas
// =====================

export const payrollBatchCreateSchema = z.object({
  payrolls: z
    .array(payrollCreateSchema)
    .min(1, 'Deve incluir pelo menos uma folha de pagamento')
    .max(100, 'Limite máximo de 100 folhas de pagamento por operação')
    .refine(
      payrolls => {
        // Check for duplicate year/month/user combinations within the batch
        const combinations = payrolls.map(p => `${p.year}-${p.month}-${p.userId}`);
        return new Set(combinations).size === combinations.length;
      },
      {
        message:
          'Não é possível criar múltiplas folhas de pagamento para o mesmo usuário no mesmo período',
      },
    ),
});
export type PayrollBatchCreateFormData = z.infer<typeof payrollBatchCreateSchema>;

export const payrollBatchUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        id: createUuidSchema('Folha de pagamento'),
        data: payrollUpdateSchema,
      }),
    )
    .min(1, 'Deve incluir pelo menos uma atualização')
    .max(100, 'Limite máximo de 100 atualizações por operação')
    .refine(
      updates => {
        // Check for duplicate IDs within the batch
        const ids = updates.map(u => u.id);
        return new Set(ids).size === ids.length;
      },
      { message: 'Não é possível atualizar a mesma folha de pagamento múltiplas vezes' },
    ),
});
export type PayrollBatchUpdateFormData = z.infer<typeof payrollBatchUpdateSchema>;

export const payrollBatchDeleteSchema = z.object({
  ids: z
    .array(createUuidSchema('Folha de pagamento'))
    .min(1, 'Deve incluir pelo menos uma folha de pagamento para exclusão')
    .max(100, 'Limite máximo de 100 exclusões por operação')
    .refine(ids => new Set(ids).size === ids.length, { message: 'Lista de IDs contém duplicatas' }),
  reason: z
    .string()
    .min(3, 'Motivo da exclusão deve ter pelo menos 3 caracteres')
    .max(500, 'Motivo da exclusão deve ter no máximo 500 caracteres')
    .optional(),
});
export type PayrollBatchDeleteFormData = z.infer<typeof payrollBatchDeleteSchema>;

// Mapping function for form data
export const mapPayrollToFormData = (payroll: any): PayrollUpdateFormData => {
  return {
    baseRemuneration: payroll.baseRemuneration,
    discounts: payroll.discounts?.map((discount: any) => ({
      percentage: discount.percentage,
      value: discount.value,
      reference: discount.reference,
    })),
  };
};

// =====================
// Include Schema
// =====================

export const payrollIncludeSchema = z
  .object({
    bonus: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              tasks: z.union([z.boolean(), z.object({})]).optional(),
              users: z.union([z.boolean(), z.object({})]).optional(),
              user: z.union([z.boolean(), z.object({})]).optional(),
              discounts: z.union([z.boolean(), z.object({})]).optional(),
              bonusDiscounts: z.union([z.boolean(), z.object({})]).optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    discounts: z
      .union([
        z.boolean(),
        z.object({
          where: z.object({}).optional(),
          orderBy: z
            .object({
              createdAt: z.enum(['asc', 'desc']).optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        remunerations: z
                          .union([
                            z.boolean(),
                            z.object({
                              orderBy: z.object({ createdAt: z.enum(['asc', 'desc']) }).optional(),
                              take: z.number().optional(),
                            }),
                          ])
                          .optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    position: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    bonusDetails: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              user: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Where Schema for Filtering
// =====================

export const payrollWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([payrollWhereSchema, z.array(payrollWhereSchema)]).optional(),
      OR: z.array(payrollWhereSchema).optional(),
      NOT: z.union([payrollWhereSchema, z.array(payrollWhereSchema)]).optional(),

      // Field conditions
      year: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            in: z.array(z.number()).optional(),
          }),
        ])
        .optional(),
      month: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            in: z.array(z.number()).optional(),
          }),
        ])
        .optional(),
      userId: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),
      status: z
        .union([
          z.enum(Object.values(BONUS_STATUS) as [string, ...string[]]),
          z.object({
            equals: z.enum(Object.values(BONUS_STATUS) as [string, ...string[]]).optional(),
            not: z.enum(Object.values(BONUS_STATUS) as [string, ...string[]]).optional(),
            in: z.array(z.enum(Object.values(BONUS_STATUS) as [string, ...string[]])).optional(),
          }),
        ])
        .optional(),
      performanceLevel: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      bonusAmount: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      remunerationAmount: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      totalEarnings: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      baseRemuneration: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      createdAt: nullableDate.optional(),
      updatedAt: nullableDate.optional(),

      // Relation filters
      user: z
        .object({
          id: z
            .union([
              z.string(),
              z.object({
                equals: z.string().optional(),
                in: z.array(z.string()).optional(),
              }),
            ])
            .optional(),
          name: z
            .object({
              contains: z.string().optional(),
              mode: z.enum(['default', 'insensitive']).optional(),
            })
            .optional(),
          email: z
            .object({
              contains: z.string().optional(),
              mode: z.enum(['default', 'insensitive']).optional(),
            })
            .optional(),
          status: z
            .union([
              z.string(),
              z.object({
                equals: z.string().optional(),
                in: z.array(z.string()).optional(),
              }),
            ])
            .optional(),
          positionId: z
            .union([
              z.string(),
              z.object({
                equals: z.string().optional(),
                in: z.array(z.string()).optional(),
              }),
            ])
            .optional(),
          sectorId: z
            .union([
              z.string(),
              z.object({
                equals: z.string().optional(),
                in: z.array(z.string()).optional(),
              }),
            ])
            .optional(),
        })
        .optional(),
      position: z
        .object({
          id: z
            .union([
              z.string(),
              z.object({
                equals: z.string().optional(),
                in: z.array(z.string()).optional(),
              }),
            ])
            .optional(),
          name: z
            .object({
              contains: z.string().optional(),
              mode: z.enum(['default', 'insensitive']).optional(),
            })
            .optional(),
          level: z
            .union([
              z.number(),
              z.object({
                equals: z.number().optional(),
                gte: z.number().optional(),
                lte: z.number().optional(),
              }),
            ])
            .optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Order By Schema for Sorting
// =====================

export const payrollOrderBySchema = z.union([
  // Single field ordering
  z
    .object({
      year: orderByDirectionSchema.optional(),
      month: orderByDirectionSchema.optional(),
      userId: orderByDirectionSchema.optional(),
      performanceLevel: orderByDirectionSchema.optional(),
      bonusAmount: orderByDirectionSchema.optional(),
      remunerationAmount: orderByDirectionSchema.optional(),
      totalEarnings: orderByDirectionSchema.optional(),
      baseRemuneration: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering
      user: z
        .object({
          name: orderByDirectionSchema.optional(),
          email: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
        })
        .optional(),
      position: z
        .object({
          name: orderByDirectionSchema.optional(),
          level: orderByDirectionSchema.optional(),
        })
        .optional(),
    })
    .partial(),

  // Array of ordering objects for multiple field ordering
  z.array(
    z
      .object({
        year: orderByDirectionSchema.optional(),
        month: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        performanceLevel: orderByDirectionSchema.optional(),
        bonusAmount: orderByDirectionSchema.optional(),
        remunerationAmount: orderByDirectionSchema.optional(),
        totalEarnings: orderByDirectionSchema.optional(),
        baseRemuneration: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),

        user: z
          .object({
            name: orderByDirectionSchema.optional(),
            email: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
          })
          .optional(),
        position: z
          .object({
            name: orderByDirectionSchema.optional(),
            level: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
  ),
]);

// =====================
// Query Schemas for API
// =====================

// =====================
// Enhanced Query Schema with Comprehensive Validation
// =====================

export const payrollQuerySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(1, 'Página deve ser pelo menos 1').optional().default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limite deve ser pelo menos 1')
      .max(100, 'Limite máximo de 100 itens por página')
      .optional()
      .default(10),

    // Includes and filtering
    include: payrollIncludeSchema.optional(),
    where: payrollWhereSchema.optional(),
    orderBy: payrollOrderBySchema.optional().default({ createdAt: 'desc' }),
    searchingFor: z
      .string()
      .min(1, 'Termo de busca deve ter pelo menos 1 caractere')
      .max(100, 'Termo de busca deve ter no máximo 100 caracteres')
      .optional(),

    // Specific payroll filters with enhanced validation
    year: z.coerce
      .number()
      .int()
      .min(2020, 'Ano deve ser pelo menos 2020')
      .max(2100, 'Ano deve ser no máximo 2100')
      .optional(),
    month: z.coerce
      .number()
      .int()
      .min(1, 'Mês deve ser entre 1 e 12')
      .max(12, 'Mês deve ser entre 1 e 12')
      .optional(),
    userId: createUuidSchema('Usuário').optional(),
    positionId: createUuidSchema('Cargo').optional(),
    status: z
      .enum(Object.values(PAYROLL_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'Status da folha de pagamento inválido' }),
      })
      .optional(),

    // Multiple months support
    multipleMonths: z.boolean().optional().default(false),
    startMonth: z.coerce.number().int().min(1).max(12).optional(),
    endMonth: z.coerce.number().int().min(1).max(12).optional(),
  })
  .refine(
    data => {
      // If multipleMonths is true, validate month range
      if (data.multipleMonths && (data.startMonth || data.endMonth)) {
        if (data.startMonth && data.endMonth) {
          return data.endMonth >= data.startMonth;
        }
        return true; // Allow partial range specification
      }
      return true;
    },
    {
      message: 'Mês final deve ser maior ou igual ao mês inicial',
      path: ['endMonth'],
    },
  );

// Backward compatibility alias
export const payrollGetManySchema = payrollQuerySchema;

export const payrollGetByIdSchema = z.object({
  include: payrollIncludeSchema.optional(),
});

// =====================
// Payroll Generation Schema for Monthly Operations
// =====================

export const payrollGenerateMonthSchema = z
  .object({
    year: z.coerce
      .number()
      .int()
      .min(2020, 'Ano deve ser pelo menos 2020')
      .max(2100, 'Ano deve ser no máximo 2100'),
    month: z.coerce
      .number()
      .int()
      .min(1, 'Mês deve ser entre 1 e 12')
      .max(12, 'Mês deve ser entre 1 e 12'),
    overwriteExisting: z.boolean().optional().default(false),
    sectorIds: z.array(createUuidSchema('Setor')).optional().default([]),
    userIds: z.array(createUuidSchema('Usuário')).optional().default([]),
    excludeUserIds: z.array(createUuidSchema('Usuário')).optional().default([]),
    includeInactive: z.boolean().optional().default(false),
  })
  .refine(
    data => {
      // Can't have overlapping userIds and excludeUserIds
      if (
        data.userIds &&
        data.excludeUserIds &&
        data.userIds.length > 0 &&
        data.excludeUserIds.length > 0
      ) {
        const intersection = data.userIds.filter(id => data.excludeUserIds!.includes(id));
        return intersection.length === 0;
      }
      return true;
    },
    {
      message: 'Não é possível incluir e excluir o mesmo usuário',
      path: ['excludeUserIds'],
    },
  );

// =====================
// Live Calculation Schemas
// =====================

// Live bonus calculation schema with enhanced validation
export const liveBonusCalculationSchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(2020, 'Ano deve ser pelo menos 2020')
    .max(2100, 'Ano deve ser no máximo 2100'),
  month: z.coerce
    .number()
    .int()
    .min(1, 'Mês deve ser entre 1 e 12')
    .max(12, 'Mês deve ser entre 1 e 12'),
  userId: createUuidSchema('Usuário').optional(),
  includeProjections: z.boolean().optional().default(false),
  includeBonusBreakdown: z.boolean().optional().default(false),
});

// Payroll summary schema with enhanced validation
export const payrollSummarySchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(2020, 'Ano deve ser pelo menos 2020')
    .max(2100, 'Ano deve ser no máximo 2100'),
  month: z.coerce
    .number()
    .int()
    .min(1, 'Mês deve ser entre 1 e 12')
    .max(12, 'Mês deve ser entre 1 e 12'),
  sectorId: createUuidSchema('Setor').optional(),
  positionId: createUuidSchema('Cargo').optional(),
  includeInactive: z.boolean().optional().default(false),
  groupBy: z
    .enum(['sector', 'position', 'user'], {
      errorMap: () => ({ message: 'Agrupamento deve ser por setor, cargo ou usuário' }),
    })
    .optional()
    .default('user'),
});

// Bonus simulation schema with comprehensive validation
export const bonusSimulationSchema = z
  .object({
    year: z.coerce
      .number()
      .int()
      .min(2020, 'Ano deve ser pelo menos 2020')
      .max(2100, 'Ano deve ser no máximo 2100'),
    month: z.coerce
      .number()
      .int()
      .min(1, 'Mês deve ser entre 1 e 12')
      .max(12, 'Mês deve ser entre 1 e 12'),
    taskQuantity: z.coerce
      .number()
      .int()
      .min(1, 'Quantidade de tarefas deve ser pelo menos 1')
      .max(1000, 'Quantidade máxima de tarefas é 1000')
      .optional(),
    sectorIds: z
      .array(createUuidSchema('Setor'))
      .max(50, 'Máximo de 50 setores por simulação')
      .optional()
      .default([]),
    excludeUserIds: z
      .array(createUuidSchema('Usuário'))
      .max(100, 'Máximo de 100 usuários excluídos por simulação')
      .optional()
      .default([]),
    userIds: z
      .array(createUuidSchema('Usuário'))
      .max(100, 'Máximo de 100 usuários por simulação')
      .optional()
      .default([]),
    includeProjections: z.boolean().optional().default(true),
    performanceLevels: z
      .array(z.number().min(0).max(5))
      .max(6, 'Máximo de 6 níveis de performance')
      .optional()
      .default([1, 2, 3, 4, 5]),
  })
  .refine(
    data => {
      // Can't have overlapping userIds and excludeUserIds
      if (
        data.userIds &&
        data.excludeUserIds &&
        data.userIds.length > 0 &&
        data.excludeUserIds.length > 0
      ) {
        const intersection = data.userIds.filter(id => data.excludeUserIds!.includes(id));
        return intersection.length === 0;
      }
      return true;
    },
    {
      message: 'Não é possível incluir e excluir o mesmo usuário na simulação',
      path: ['excludeUserIds'],
    },
  );

// =====================
// Additional Specialized Schemas
// =====================

// Payroll comparison schema
export const payrollComparisonSchema = z
  .object({
    baseYear: z.coerce.number().int().min(2020).max(2100),
    baseMonth: z.coerce.number().int().min(1).max(12),
    compareYear: z.coerce.number().int().min(2020).max(2100),
    compareMonth: z.coerce.number().int().min(1).max(12),
    sectorIds: z.array(createUuidSchema('Setor')).optional(),
    userIds: z.array(createUuidSchema('Usuário')).optional(),
    includePercentageChange: z.boolean().optional().default(true),
  })
  .refine(
    data => {
      // Ensure we're not comparing the same month
      return !(data.baseYear === data.compareYear && data.baseMonth === data.compareMonth);
    },
    {
      message: 'Não é possível comparar o mesmo período',
    },
  );

// Payroll export schema
export const payrollExportSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  format: z
    .enum(['xlsx', 'csv', 'pdf'], {
      errorMap: () => ({ message: 'Formato deve ser xlsx, csv ou pdf' }),
    })
    .default('xlsx'),
  includeDiscounts: z.boolean().optional().default(true),
  includeBonusBreakdown: z.boolean().optional().default(true),
  sectorIds: z.array(createUuidSchema('Setor')).optional(),
  userIds: z.array(createUuidSchema('Usuário')).optional(),
  template: z
    .enum(['standard', 'detailed', 'summary'], {
      errorMap: () => ({ message: 'Template deve ser standard, detailed ou summary' }),
    })
    .optional()
    .default('standard'),
});

// Payroll approval schema
export const payrollApprovalSchema = z
  .object({
    payrollIds: z
      .array(createUuidSchema('Folha de pagamento'))
      .min(1, 'Deve incluir pelo menos uma folha de pagamento')
      .max(100, 'Máximo de 100 aprovações por vez'),
    action: z.enum(['approve', 'reject', 'request_changes'], {
      errorMap: () => ({ message: 'Ação deve ser approve, reject ou request_changes' }),
    }),
    comments: z.string().max(1000, 'Comentários devem ter no máximo 1000 caracteres').optional(),
    approverUserId: createUuidSchema('Usuário aprovador'),
  })
  .refine(
    data => {
      // Comments are required for reject and request_changes
      if (
        (data.action === 'reject' || data.action === 'request_changes') &&
        !data.comments?.trim()
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'Comentários são obrigatórios para rejeição ou solicitação de alterações',
      path: ['comments'],
    },
  );

// Live calculation schema with enhanced options
export const payrollLiveCalculationSchema = z.object({
  include: payrollIncludeSchema.optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  userId: createUuidSchema('Usuário').optional(),
  forceRecalculation: z.boolean().optional().default(false),
  includePendingTasks: z.boolean().optional().default(true),
});

// Transform function for searching
const payrollTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.searchingFor && typeof data.searchingFor === 'string') {
    data.where = {
      ...data.where,
      OR: [
        { user: { name: { contains: data.searchingFor, mode: 'insensitive' } } },
        { user: { email: { contains: data.searchingFor, mode: 'insensitive' } } },
        { position: { name: { contains: data.searchingFor, mode: 'insensitive' } } },
      ],
    };
    delete data.searchingFor;
  }
  return data;
};

// Apply transform
export const payrollGetManyFormDataSchema = payrollGetManySchema.transform(payrollTransform);

// =====================
// Form Data Types (Inferred from schemas)
// =====================

export type PayrollGetManyParams = z.infer<typeof payrollGetManySchema>;
export type PayrollGetManyFormData = z.infer<typeof payrollGetManyFormDataSchema>;
export type PayrollGetByIdFormData = z.infer<typeof payrollGetByIdSchema>;
export type PayrollQueryFormData = z.infer<typeof payrollQuerySchema>;
export type LiveBonusCalculationParams = z.infer<typeof liveBonusCalculationSchema>;
export type PayrollSummaryParams = z.infer<typeof payrollSummarySchema>;
export type PayrollInclude = z.infer<typeof payrollIncludeSchema>;
export type PayrollOrderBy = z.infer<typeof payrollOrderBySchema>;
export type PayrollWhere = z.infer<typeof payrollWhereSchema>;

// Additional new type exports
export type BonusSimulationParams = z.infer<typeof bonusSimulationSchema>;
export type PayrollGenerateMonthParams = z.infer<typeof payrollGenerateMonthSchema>;
export type PayrollLiveCalculationParams = z.infer<typeof payrollLiveCalculationSchema>;
export type PayrollComparisonParams = z.infer<typeof payrollComparisonSchema>;
export type PayrollExportParams = z.infer<typeof payrollExportSchema>;
export type PayrollApprovalParams = z.infer<typeof payrollApprovalSchema>;

// All schemas and types are now defined above - no duplicates needed
