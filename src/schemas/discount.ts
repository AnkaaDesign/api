import { z } from "zod";
import { orderByDirectionSchema, normalizeOrderBy, nullableDate, createNameSchema, createMapToFormDataHelper } from "./common";
import type { Discount } from '@types';

// =====================
// Include Schema Based on Prisma Schema
// =====================

export const discountIncludeSchema = z
  .object({
    payroll: z
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

export const discountWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([discountWhereSchema, z.array(discountWhereSchema)]).optional(),
      OR: z.array(discountWhereSchema).optional(),
      NOT: z.union([discountWhereSchema, z.array(discountWhereSchema)]).optional(),

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
      payrollId: z
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
            endsWith: z.string().optional(),
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
      payroll: z
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

export const calculationOrderBySchema = z.union([
  // Single field ordering
  z
    .object({
      id: orderByDirectionSchema.optional(),
      payrollId: orderByDirectionSchema.optional(),
      percentage: orderByDirectionSchema.optional(),
      value: orderByDirectionSchema.optional(),
      reference: orderByDirectionSchema.optional(),
      calculationOrder: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering
      payroll: z
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
        payrollId: orderByDirectionSchema.optional(),
        percentage: orderByDirectionSchema.optional(),
        value: orderByDirectionSchema.optional(),
        reference: orderByDirectionSchema.optional(),
        calculationOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),

        payroll: z
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

export const discountCreateSchema = z
  .object({
    payrollId: z.string().uuid("Folha de pagamento inválida"),
    percentage: z
      .number()
      .min(0, "Percentual deve ser maior ou igual a 0")
      .max(100, "Percentual deve ser menor ou igual a 100")
      .multipleOf(0.01, "Percentual deve ter no máximo 2 casas decimais")
      .optional(),
    value: z
      .number()
      .min(0, "Valor fixo deve ser maior ou igual a 0")
      .multipleOf(0.01, "Valor fixo deve ter no máximo 2 casas decimais")
      .optional(),
    reference: createNameSchema(1, 200, "Referência"),
    calculationOrder: z
      .number()
      .int("Ordem de desconto deve ser um número inteiro")
      .min(1, "Ordem de desconto deve ser maior ou igual a 1")
      .default(1),
  })
  .refine(
    (data) => data.percentage !== undefined || data.value !== undefined,
    {
      message: "Pelo menos um dos campos 'percentual' ou 'valor fixo' deve ser fornecido",
      path: ["percentage", "value"],
    }
  );

export const discountUpdateSchema = z
  .object({
    percentage: z
      .number()
      .min(0, "Percentual deve ser maior ou igual a 0")
      .max(100, "Percentual deve ser menor ou igual a 100")
      .multipleOf(0.01, "Percentual deve ter no máximo 2 casas decimais")
      .optional(),
    value: z
      .number()
      .min(0, "Valor fixo deve ser maior ou igual a 0")
      .multipleOf(0.01, "Valor fixo deve ter no máximo 2 casas decimais")
      .optional(),
    reference: createNameSchema(1, 200, "Referência").optional(),
    calculationOrder: z
      .number()
      .int("Ordem de desconto deve ser um número inteiro")
      .min(1, "Ordem de desconto deve ser maior ou igual a 1")
      .optional(),
  })
  .refine(
    (data) => {
      // If both are provided as null/undefined, that's not valid
      const hasPercentage = data.percentage !== undefined && data.percentage !== null;
      const hasFixedValue = data.value !== undefined && data.value !== null;

      // For updates, we only validate if both fields are explicitly being set
      // If neither is being updated, we assume the existing record is valid
      if (data.percentage !== undefined || data.value !== undefined) {
        return hasPercentage || hasFixedValue;
      }
      return true;
    },
    {
      message: "Pelo menos um dos campos 'percentual' ou 'valor fixo' deve ser fornecido",
      path: ["percentage", "value"],
    }
  );

// =====================
// Batch Operations
// =====================

export const discountBatchCreateSchema = z.object({
  discounts: z
    .array(discountCreateSchema)
    .min(1, "Pelo menos um desconto deve ser fornecido")
    .max(100, "Máximo de 100 descontos por operação"),
});

export const discountBatchUpdateSchema = z.object({
  discounts: z
    .array(
      z.object({
        id: z.string().uuid("Desconto inválido"),
        data: discountUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária")
    .max(100, "Máximo de 100 atualizações por operação"),
});

export const discountBatchDeleteSchema = z.object({
  discountIds: z
    .array(z.string().uuid("Desconto inválido"))
    .min(1, "Pelo menos um ID deve ser fornecido")
    .max(100, "Máximo de 100 exclusões por operação"),
});

// =====================
// Query Schemas for API
// =====================

export const discountGetManySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  include: discountIncludeSchema.optional(),
  where: discountWhereSchema.optional(),
  orderBy: calculationOrderBySchema.optional().default({ calculationOrder: "asc", createdAt: "desc" }),
  searchingFor: z.string().optional(),

  // Specific discount filters
  payrollId: z.string().uuid("Folha de pagamento inválida").optional(),
});

export const discountGetByIdSchema = z.object({
  include: discountIncludeSchema.optional(),
});

export const discountQuerySchema = z.object({
  where: discountWhereSchema.optional(),
  orderBy: calculationOrderBySchema.optional(),
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).transform(data => {
  if (data.page && data.limit) {
    data.skip = (data.page - 1) * data.limit;
    data.take = data.limit;
    delete data.page;
    delete data.limit;
  }
  return data;
});

// Transform function for searching
const discountTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.searchingFor && typeof data.searchingFor === "string") {
    data.where = {
      ...data.where,
      OR: [
        { reference: { contains: data.searchingFor, mode: "insensitive" } },
        { payroll: { user: { name: { contains: data.searchingFor, mode: "insensitive" } } } },
      ],
    };
    delete data.searchingFor;
  }
  return data;
};

// Apply transform
export const discountGetManyFormDataSchema = discountGetManySchema.transform(discountTransform);

// =====================
// Form Data Types (Inferred from schemas)
// =====================

export type DiscountGetManyParams = z.infer<typeof discountGetManySchema>;
export type DiscountGetManyFormData = z.infer<typeof discountGetManyFormDataSchema>;
export type DiscountGetByIdFormData = z.infer<typeof discountGetByIdSchema>;
export type DiscountQueryFormData = z.infer<typeof discountQuerySchema>;
export type DiscountCreateFormData = z.infer<typeof discountCreateSchema>;
export type DiscountUpdateFormData = z.infer<typeof discountUpdateSchema>;
export type DiscountBatchCreateFormData = z.infer<typeof discountBatchCreateSchema>;
export type DiscountBatchUpdateFormData = z.infer<typeof discountBatchUpdateSchema>;
export type DiscountBatchDeleteFormData = z.infer<typeof discountBatchDeleteSchema>;
export type DiscountInclude = z.infer<typeof discountIncludeSchema>;
export type DiscountOrderBy = z.infer<typeof calculationOrderBySchema>;
export type DiscountWhere = z.infer<typeof discountWhereSchema>;

// =====================
// Utility Functions
// =====================

export const mapToDiscountFormData = createMapToFormDataHelper<Discount, DiscountUpdateFormData>((discount) => ({
  percentage: discount.percentage ?? undefined,
  value: discount.value ?? undefined,
  reference: discount.reference,
  calculationOrder: discount.calculationOrder,
}));