// packages/schemas/src/bonus.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, moneySchema, nullableDate } from "./common";
import { BONUS_STATUS } from '@constants';
import type { Bonus } from '@types';

// =====================
// Include Schema Based on Prisma Schema
// =====================

export const bonusIncludeSchema = z
  .object({
    user: z
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
    tasks: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              customer: z.boolean().optional(),
              sector: z.boolean().optional(),
              services: z.boolean().optional(),
              commissions: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
    bonusDiscounts: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              bonus: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
    payroll: z
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

export const bonusWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([bonusWhereSchema, z.array(bonusWhereSchema)]).optional(),
      OR: z.array(bonusWhereSchema).optional(),
      NOT: z.union([bonusWhereSchema, z.array(bonusWhereSchema)]).optional(),

      // Field conditions
      id: z
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
      baseBonus: z
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
      ponderedTaskCount: z
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
      averageTasksPerUser: z
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
      calculationPeriodStart: nullableDate.optional(),
      calculationPeriodEnd: nullableDate.optional(),
      status: z
        .union([
          z.enum(Object.values(BONUS_STATUS) as [string, ...string[]]),
          z.object({
            equals: z.enum(Object.values(BONUS_STATUS) as [string, ...string[]]).optional(),
            not: z.enum(Object.values(BONUS_STATUS) as [string, ...string[]]).optional(),
            in: z.array(z.enum(Object.values(BONUS_STATUS) as [string, ...string[]])).optional(),
            notIn: z.array(z.enum(Object.values(BONUS_STATUS) as [string, ...string[]])).optional(),
          }),
        ])
        .optional(),
      statusOrder: z
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
          id: z.string().optional(),
          name: z
            .object({
              contains: z.string().optional(),
              mode: z.enum(["default", "insensitive"]).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Order By Schema for Sorting
// =====================

export const bonusOrderBySchema = z.union([
  // Single field ordering
  z
    .object({
      id: orderByDirectionSchema.optional(),
      year: orderByDirectionSchema.optional(),
      month: orderByDirectionSchema.optional(),
      userId: orderByDirectionSchema.optional(),
      performanceLevel: orderByDirectionSchema.optional(),
      baseBonus: orderByDirectionSchema.optional(),
      ponderedTaskCount: orderByDirectionSchema.optional(),
      averageTasksPerUser: orderByDirectionSchema.optional(),
      calculationPeriodStart: orderByDirectionSchema.optional(),
      calculationPeriodEnd: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      statusOrder: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering
      user: z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .optional(),
    })
    .partial(),

  // Array of ordering objects for multiple field ordering
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        year: orderByDirectionSchema.optional(),
        month: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        performanceLevel: orderByDirectionSchema.optional(),
        baseBonus: orderByDirectionSchema.optional(),
        ponderedTaskCount: orderByDirectionSchema.optional(),
        averageTasksPerUser: orderByDirectionSchema.optional(),
        calculationPeriodStart: orderByDirectionSchema.optional(),
        calculationPeriodEnd: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),

        user: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
  ),
]);

// =====================
// CRUD Schemas
// =====================

export const bonusCreateSchema = z
  .object({
    year: z.coerce.number().int().min(2000, "Ano deve ser maior que 2000").max(2099, "Ano deve ser menor que 2099"),
    month: z.coerce.number().int().min(1, "Mês deve ser entre 1 e 12").max(12, "Mês deve ser entre 1 e 12"),
    userId: z.string().uuid("Usuário inválido"),
    payrollId: z.string().uuid("Folha de pagamento inválida").optional(),
    performanceLevel: z.number().int().min(0, "Nível de performance deve ser maior ou igual a 0").max(5, "Nível de performance deve ser menor ou igual a 5"),
    baseBonus: moneySchema,
  })
  .refine(
    (data) => {
      // Validate that the period is not in the future
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      return !(data.year > currentYear || (data.year === currentYear && data.month > currentMonth));
    },
    {
      message: "Não é possível criar bônus para períodos futuros",
      path: ["month"],
    }
  )
  .refine(
    (data) => {
      // Validate that the period is not too old (more than 24 months ago)
      const periodDate = new Date(data.year, data.month - 1);
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 24);

      return periodDate >= cutoffDate;
    },
    {
      message: "Não é possível criar bônus para períodos mais antigos que 24 meses",
      path: ["month"],
    }
  );

export const bonusUpdateSchema = z.object({
  year: z.coerce.number().int().min(2000, "Ano deve ser maior que 2000").max(2099, "Ano deve ser menor que 2099").optional(),
  month: z.coerce.number().int().min(1, "Mês deve ser entre 1 e 12").max(12, "Mês deve ser entre 1 e 12").optional(),
  userId: z.string().uuid("Usuário inválido").optional(),
  payrollId: z.string().uuid("Folha de pagamento inválida").optional(),
  performanceLevel: z.number().int().min(0, "Nível de performance deve ser maior ou igual a 0").max(5, "Nível de performance deve ser menor ou igual a 5").optional(),
  baseBonus: moneySchema.optional(),
});

// =====================
// Batch Operations
// =====================

export const bonusBatchCreateSchema = z.object({
  bonuses: z.array(bonusCreateSchema),
});

export const bonusBatchUpdateSchema = z.object({
  bonuses: z
    .array(
      z.object({
        id: z.string().uuid("Bônus inválido"),
        data: bonusUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const bonusBatchDeleteSchema = z.object({
  ids: z.array(z.string().uuid("Bônus inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// =====================
// Query Schemas for API
// =====================

export const bonusGetManySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  include: bonusIncludeSchema.optional(),
  where: bonusWhereSchema.optional(),
  orderBy: bonusOrderBySchema.optional().default({ createdAt: "desc" }),
  searchingFor: z.string().optional(),

  // Specific bonus filters
  year: z.coerce.number().int().min(2000, "Ano deve ser maior que 2000").max(2099, "Ano deve ser menor que 2099").optional(),
  month: z.coerce.number().int().min(1, "Mês deve ser entre 1 e 12").max(12, "Mês deve ser entre 1 e 12").optional(),
  userId: z.string().uuid("Usuário inválido").optional(),
  payrollId: z.string().uuid("Folha de pagamento inválida").optional(),
});

export const bonusGetByIdSchema = z.object({
  include: bonusIncludeSchema.optional(),
});

export const bonusQuerySchema = z.object({
  include: bonusIncludeSchema.optional(),
});

// =====================
// Period Generation Schema
// =====================

export const bonusGeneratePeriodSchema = z
  .object({
    year: z.coerce.number().int().min(2000, "Ano deve ser maior que 2000").max(2099, "Ano deve ser menor que 2099"),
    month: z.coerce.number().int().min(1, "Mês deve ser entre 1 e 12").max(12, "Mês deve ser entre 1 e 12"),
    overrideExisting: z.boolean().optional().default(false),
    userIds: z.array(z.string().uuid("Usuário inválido")).optional(),
    sectorIds: z.array(z.string().uuid("Setor inválido")).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      // Validate that the period is not in the future
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      return !(data.year > currentYear || (data.year === currentYear && data.month > currentMonth));
    },
    {
      message: "Não é possível gerar bônus para períodos futuros",
      path: ["month"],
    }
  )
  .refine(
    (data) => {
      // Validate that the period is not too old (more than 24 months ago)
      const periodDate = new Date(data.year, data.month - 1);
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 24);

      return periodDate >= cutoffDate;
    },
    {
      message: "Não é possível gerar bônus para períodos mais antigos que 24 meses",
      path: ["month"],
    }
  );

// Payroll specific schemas
export const payrollGetSchema = z.object({
  year: z.coerce.number().int().min(2000, "Ano deve ser maior que 2000").max(2099, "Ano deve ser menor que 2099"),
  month: z.coerce.number().int().min(1, "Mês deve ser entre 1 e 12").max(12, "Mês deve ser entre 1 e 12"),
  userId: z.string().uuid("Usuário inválido").optional(),
  sectorId: z.string().uuid("Setor inválido").optional(),
});

export const payrollBonusesLiveSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2099),
  month: z.coerce.number().int().min(1).max(12),
  userId: z.string().uuid("Usuário inválido").optional(),
});

// Transform function for searching
const bonusTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.searchingFor && typeof data.searchingFor === "string") {
    const searchTerm = data.searchingFor;
    data.where = {
      ...data.where,
      OR: [
        { year: { equals: parseInt(searchTerm) || undefined } },
        { month: { equals: parseInt(searchTerm) || undefined } },
        { user: { name: { contains: searchTerm, mode: "insensitive" } } },
      ],
    };
    delete data.searchingFor;
  }
  return data;
};

// Apply transforms
export const bonusGetManyFormDataSchema = bonusGetManySchema.transform(bonusTransform);

// =====================
// Additional Validation Schemas
// =====================

// Schema for confirming bonuses (changing from DRAFT to CONFIRMED)
export const bonusConfirmSchema = z.object({
  bonusIds: z.array(z.string().uuid("Bônus inválido")).min(1, "Pelo menos um bônus deve ser selecionado"),
  confirmAll: z.boolean().optional().default(false),
});

// Schema for reverting bonuses (changing from CONFIRMED to DRAFT)
export const bonusRevertSchema = z.object({
  bonusIds: z.array(z.string().uuid("Bônus inválido")).min(1, "Pelo menos um bônus deve ser selecionado"),
  reason: z.string().min(5, "Motivo deve ter pelo menos 5 caracteres").max(500, "Motivo deve ter no máximo 500 caracteres"),
});

// Schema for bulk status update
export const bonusUpdateStatusSchema = z.object({
  bonusIds: z.array(z.string().uuid("Bônus inválido")).min(1, "Pelo menos um bônus deve ser selecionado"),
  status: z.enum(Object.values(BONUS_STATUS) as [string, ...string[]], {
    errorMap: () => ({ message: "Status inválido" }),
  }),
  reason: z.string().optional(),
});

// Schema for period validation (used by frontend)
export const bonusPeriodValidationSchema = z
  .object({
    year: z.coerce.number().int().min(2000, "Ano deve ser maior que 2000").max(2099, "Ano deve ser menor que 2099"),
    month: z.coerce.number().int().min(1, "Mês deve ser entre 1 e 12").max(12, "Mês deve ser entre 1 e 12"),
  })
  .refine(
    (data) => {
      // Validate that the period is not in the future
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      return !(data.year > currentYear || (data.year === currentYear && data.month > currentMonth));
    },
    {
      message: "Período não pode ser futuro",
      path: ["month"],
    }
  );

// =====================
// Form Data Types (Inferred from schemas)
// =====================

export type BonusGetManyParams = z.infer<typeof bonusGetManySchema>;
export type BonusGetManyFormData = z.infer<typeof bonusGetManyFormDataSchema>;
export type BonusGetByIdFormData = z.infer<typeof bonusGetByIdSchema>;
export type BonusQueryFormData = z.infer<typeof bonusQuerySchema>;
export type BonusCreateFormData = z.infer<typeof bonusCreateSchema>;
export type BonusUpdateFormData = z.infer<typeof bonusUpdateSchema>;
export type BonusBatchCreateFormData = z.infer<typeof bonusBatchCreateSchema>;
export type BonusBatchUpdateFormData = z.infer<typeof bonusBatchUpdateSchema>;
export type BonusBatchDeleteFormData = z.infer<typeof bonusBatchDeleteSchema>;
export type BonusInclude = z.infer<typeof bonusIncludeSchema>;
export type BonusOrderBy = z.infer<typeof bonusOrderBySchema>;
export type BonusWhere = z.infer<typeof bonusWhereSchema>;

// Period generation types
export type BonusGeneratePeriodFormData = z.infer<typeof bonusGeneratePeriodSchema>;
export type BonusConfirmFormData = z.infer<typeof bonusConfirmSchema>;
export type BonusRevertFormData = z.infer<typeof bonusRevertSchema>;
export type BonusUpdateStatusFormData = z.infer<typeof bonusUpdateStatusSchema>;
export type BonusPeriodValidationFormData = z.infer<typeof bonusPeriodValidationSchema>;

// Payroll types
export type PayrollGetParams = z.infer<typeof payrollGetSchema>;
export type PayrollBonusesLiveParams = z.infer<typeof payrollBonusesLiveSchema>;

// =====================
// Utility Functions
// =====================

export const mapToBonusFormData = createMapToFormDataHelper<Bonus, BonusUpdateFormData>((bonus) => ({
  baseBonus: typeof bonus.baseBonus === 'number' ? bonus.baseBonus : bonus.baseBonus.toNumber(),
  userId: bonus.userId,
  payrollId: bonus.payrollId ?? undefined,
  year: bonus.year,
  month: bonus.month,
  performanceLevel: bonus.performanceLevel,
  ponderedTaskCount: typeof bonus.ponderedTaskCount === 'number' ? bonus.ponderedTaskCount : bonus.ponderedTaskCount.toNumber(),
  averageTasksPerUser: typeof bonus.averageTasksPerUser === 'number' ? bonus.averageTasksPerUser : bonus.averageTasksPerUser.toNumber(),
  calculationPeriodStart: bonus.calculationPeriodStart,
  calculationPeriodEnd: bonus.calculationPeriodEnd,
}));

// =====================
// Validation Helper Functions
// =====================

/**
 * Validates if a period (year/month) is within allowed range for bonus operations
 */
export const validateBonusPeriod = (year: number, month: number): { isValid: boolean; error?: string } => {
  const result = bonusPeriodValidationSchema.safeParse({ year, month });

  if (!result.success) {
    return {
      isValid: false,
      error: result.error.issues[0]?.message || "Período inválido",
    };
  }

  return { isValid: true };
};

/**
 * Validates if bonus generation parameters are correct
 */
export const validateBonusGeneration = (data: BonusGeneratePeriodFormData): { isValid: boolean; errors?: string[] } => {
  const result = bonusGeneratePeriodSchema.safeParse(data);

  if (!result.success) {
    return {
      isValid: false,
      errors: result.error.issues.map(issue => issue.message),
    };
  }

  return { isValid: true };
};

/**
 * Gets period date range for bonus calculation (26th to 25th)
 */
export const getBonusPeriodRange = (year: number, month: number) => {
  // Start date: 26th of previous month
  const startDate = new Date(year, month - 2, 26);

  // End date: 25th of current month
  const endDate = new Date(year, month - 1, 25, 23, 59, 59, 999);

  return { startDate, endDate };
};