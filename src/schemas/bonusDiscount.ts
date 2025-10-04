// packages/schemas/src/bonusDiscount.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, createNameSchema, moneySchema, nullableDate } from "./common";
import type { BonusDiscount } from '@types';

// =====================
// Include Schema Based on Prisma Schema
// =====================

export const bonusDiscountIncludeSchema = z
  .object({
    bonus: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              user: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        position: z.boolean().optional(),
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
            })
            .optional(),
        }),
      ])
      .optional(),
    suspendedTasks: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Where Schema for Filtering
// =====================

export const bonusDiscountWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([bonusDiscountWhereSchema, z.array(bonusDiscountWhereSchema)]).optional(),
      OR: z.array(bonusDiscountWhereSchema).optional(),
      NOT: z.union([bonusDiscountWhereSchema, z.array(bonusDiscountWhereSchema)]).optional(),

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
      bonusId: z
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
      percentage: z
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
      value: z
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
      reference: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),
      calculationOrder: z
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
      bonus: z
        .object({
          id: z.string().optional(),
          userId: z.string().optional(),
          year: z.number().optional(),
          month: z.number().optional(),
          user: z
            .object({
              name: z
                .object({
                  contains: z.string().optional(),
                  mode: z.enum(["default", "insensitive"]).optional(),
                })
                .optional(),
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

export const bonusDiscountOrderBySchema = z.union([
  // Single field ordering
  z
    .object({
      id: orderByDirectionSchema.optional(),
      bonusId: orderByDirectionSchema.optional(),
      percentage: orderByDirectionSchema.optional(),
      value: orderByDirectionSchema.optional(),
      reference: orderByDirectionSchema.optional(),
      calculationOrder: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering
      bonus: z
        .object({
          id: orderByDirectionSchema.optional(),
          userId: orderByDirectionSchema.optional(),
          year: orderByDirectionSchema.optional(),
          month: orderByDirectionSchema.optional(),
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
        bonusId: orderByDirectionSchema.optional(),
        percentage: orderByDirectionSchema.optional(),
        value: orderByDirectionSchema.optional(),
        reference: orderByDirectionSchema.optional(),
        calculationOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),

        bonus: z
          .object({
            id: orderByDirectionSchema.optional(),
            userId: orderByDirectionSchema.optional(),
            year: orderByDirectionSchema.optional(),
            month: orderByDirectionSchema.optional(),
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

export const bonusDiscountCreateSchema = z
  .object({
    bonusId: z.string().uuid("Bônus inválido"),
    percentage: z
      .number()
      .min(0, "Percentual deve ser maior ou igual a 0")
      .max(100, "Percentual deve ser menor ou igual a 100")
      .multipleOf(0.01, "Percentual deve ter no máximo 2 casas decimais")
      .optional(),
    value: moneySchema.optional(),
    reference: createNameSchema(1, 200, "Referência"),
    calculationOrder: z
      .number()
      .int("Ordem de cálculo deve ser um número inteiro")
      .min(1, "Ordem de cálculo deve ser maior ou igual a 1"),
  })
  .refine(
    (data) => data.percentage !== undefined || data.value !== undefined,
    {
      message: "Pelo menos um dos campos 'percentual' ou 'valor' deve ser fornecido",
      path: ["percentage", "value"],
    }
  );

export const bonusDiscountUpdateSchema = z
  .object({
    percentage: z
      .number()
      .min(0, "Percentual deve ser maior ou igual a 0")
      .max(100, "Percentual deve ser menor ou igual a 100")
      .multipleOf(0.01, "Percentual deve ter no máximo 2 casas decimais")
      .optional(),
    value: moneySchema.optional(),
    reference: createNameSchema(1, 200, "Referência").optional(),
    calculationOrder: z
      .number()
      .int("Ordem de cálculo deve ser um número inteiro")
      .min(1, "Ordem de cálculo deve ser maior ou igual a 1")
      .optional(),
  })
  .refine(
    (data) => {
      // If both are provided as null/undefined, that's not valid
      const hasPercentage = data.percentage !== undefined && data.percentage !== null;
      const hasValue = data.value !== undefined && data.value !== null;

      // For updates, we only validate if both fields are explicitly being set
      // If neither is being updated, we assume the existing record is valid
      if (data.percentage !== undefined || data.value !== undefined) {
        return hasPercentage || hasValue;
      }
      return true;
    },
    {
      message: "Pelo menos um dos campos 'percentual' ou 'valor' deve ser fornecido",
      path: ["percentage", "value"],
    }
  );

// =====================
// Batch Operations
// =====================

export const bonusDiscountBatchCreateSchema = z.object({
  discounts: z
    .array(bonusDiscountCreateSchema)
    .min(1, "Pelo menos um desconto deve ser fornecido")
    .max(100, "Máximo de 100 descontos por operação"),
});

export const bonusDiscountBatchUpdateSchema = z.object({
  discounts: z
    .array(
      z.object({
        id: z.string().uuid("Desconto inválido"),
        data: bonusDiscountUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária")
    .max(100, "Máximo de 100 atualizações por operação"),
});

export const bonusDiscountBatchDeleteSchema = z.object({
  discountIds: z
    .array(z.string().uuid("Desconto inválido"))
    .min(1, "Pelo menos um ID deve ser fornecido")
    .max(100, "Máximo de 100 exclusões por operação"),
});

// =====================
// Query Schemas for API
// =====================

export const bonusDiscountGetManySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  include: bonusDiscountIncludeSchema.optional(),
  where: bonusDiscountWhereSchema.optional(),
  orderBy: bonusDiscountOrderBySchema.optional().default({ calculationOrder: "asc", createdAt: "desc" }),
  searchingFor: z.string().optional(),

  // Specific bonus discount filters
  bonusId: z.string().uuid("Bônus inválido").optional(),
});

export const bonusDiscountGetByIdSchema = z.object({
  include: bonusDiscountIncludeSchema.optional(),
});

export const bonusDiscountQuerySchema = z.object({
  include: bonusDiscountIncludeSchema.optional(),
});

// Transform function for searching
const bonusDiscountTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.searchingFor && typeof data.searchingFor === "string") {
    data.where = {
      ...data.where,
      OR: [
        { reference: { contains: data.searchingFor, mode: "insensitive" } },
        { bonus: { user: { name: { contains: data.searchingFor, mode: "insensitive" } } } },
      ],
    };
    delete data.searchingFor;
  }
  return data;
};

// Apply transform
export const bonusDiscountGetManyFormDataSchema = bonusDiscountGetManySchema.transform(bonusDiscountTransform);

// =====================
// Form Data Types (Inferred from schemas)
// =====================

export type BonusDiscountGetManyParams = z.infer<typeof bonusDiscountGetManySchema>;
export type BonusDiscountGetManyFormData = z.infer<typeof bonusDiscountGetManyFormDataSchema>;
export type BonusDiscountGetByIdFormData = z.infer<typeof bonusDiscountGetByIdSchema>;
export type BonusDiscountQueryFormData = z.infer<typeof bonusDiscountQuerySchema>;
export type BonusDiscountCreateFormData = z.infer<typeof bonusDiscountCreateSchema>;
export type BonusDiscountUpdateFormData = z.infer<typeof bonusDiscountUpdateSchema>;
export type BonusDiscountBatchCreateFormData = z.infer<typeof bonusDiscountBatchCreateSchema>;
export type BonusDiscountBatchUpdateFormData = z.infer<typeof bonusDiscountBatchUpdateSchema>;
export type BonusDiscountBatchDeleteFormData = z.infer<typeof bonusDiscountBatchDeleteSchema>;
export type BonusDiscountInclude = z.infer<typeof bonusDiscountIncludeSchema>;
export type BonusDiscountOrderBy = z.infer<typeof bonusDiscountOrderBySchema>;
export type BonusDiscountWhere = z.infer<typeof bonusDiscountWhereSchema>;

// =====================
// Utility Functions
// =====================

export const mapToBonusDiscountFormData = createMapToFormDataHelper<BonusDiscount, BonusDiscountUpdateFormData>((bonusDiscount) => ({
  percentage: bonusDiscount.percentage ?? undefined,
  value: bonusDiscount.value ?? undefined,
  reference: bonusDiscount.reference,
  calculationOrder: bonusDiscount.calculationOrder,
}));