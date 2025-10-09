// packages/schemas/src/externalWithdrawal.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, createNameSchema } from "./common";
import type { ExternalWithdrawal, ExternalWithdrawalItem } from '@types';
import { EXTERNAL_WITHDRAWAL_STATUS } from '@constants';

// =====================
// EXTERNAL WITHDRAWAL SCHEMAS
// =====================

// Include Schema
export const externalWithdrawalIncludeSchema = z
  .object({
    nfe: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              // File relations can be included here if needed
            })
            .optional(),
        }),
      ])
      .optional(),
    receipt: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              // File relations can be included here if needed
            })
            .optional(),
        }),
      ])
      .optional(),
    items: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        brand: z.boolean().optional(),
                        category: z.boolean().optional(),
                        supplier: z.boolean().optional(),
                        prices: z
                          .union([
                            z.boolean(),
                            z.object({
                              include: z.object({}).optional(),
                              where: z.object({}).optional(),
                              orderBy: z
                                .union([
                                  z.object({
                                    id: orderByDirectionSchema.optional(),
                                    value: orderByDirectionSchema.optional(),
                                    createdAt: orderByDirectionSchema.optional(),
                                    updatedAt: orderByDirectionSchema.optional(),
                                  }),
                                  z.array(
                                    z.object({
                                      id: orderByDirectionSchema.optional(),
                                      value: orderByDirectionSchema.optional(),
                                      createdAt: orderByDirectionSchema.optional(),
                                      updatedAt: orderByDirectionSchema.optional(),
                                    }),
                                  ),
                                ])
                                .optional(),
                              take: z.coerce.number().optional(),
                              skip: z.coerce.number().optional(),
                            }),
                          ])
                          .optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              externalWithdrawal: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// OrderBy Schema
export const externalWithdrawalOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        withdrawerName: orderByDirectionSchema.optional(),
        willReturn: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        notes: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          withdrawerName: orderByDirectionSchema.optional(),
          willReturn: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// Where Schema
export const externalWithdrawalWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.array(z.lazy(() => externalWithdrawalWhereSchema)).optional(),
    OR: z.array(z.lazy(() => externalWithdrawalWhereSchema)).optional(),
    NOT: z.lazy(() => externalWithdrawalWhereSchema).optional(),

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

    withdrawerName: z
      .union([
        z.string(),
        z.object({
          equals: z.string().optional(),
          not: z.string().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    status: z
      .union([
        z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS),
        z.object({
          equals: z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS).optional(),
          not: z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS).optional(),
          in: z.array(z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS)).optional(),
          notIn: z.array(z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS)).optional(),
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

    willReturn: z
      .union([
        z.boolean(),
        z.object({
          equals: z.boolean().optional(),
          not: z.boolean().optional(),
        }),
      ])
      .optional(),

    nfeId: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    receiptId: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    notes: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    createdAt: z
      .union([
        z.date(),
        z.object({
          equals: z.date().optional(),
          not: z.date().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    updatedAt: z
      .union([
        z.date(),
        z.object({
          equals: z.date().optional(),
          not: z.date().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// Convenience filters
const externalWithdrawalFilters = {
  withdrawerNames: z.array(z.string()).optional(),
  statuses: z.array(z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS)).optional(),
  willReturn: z.boolean().optional(),
  hasNfe: z.boolean().optional(),
  hasReceipt: z.boolean().optional(),
  hasItems: z.boolean().optional(),
  searchingFor: z.string().optional(),
};

// Transform function
const externalWithdrawalTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  if (data.withdrawerNames?.length) {
    andConditions.push({ withdrawerName: { in: data.withdrawerNames } });
    delete data.withdrawerNames;
  }

  if (data.statuses?.length) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  if (data.willReturn !== undefined) {
    andConditions.push({ willReturn: data.willReturn });
    delete data.willReturn;
  }

  if (data.hasNfe !== undefined) {
    andConditions.push({ nfeId: data.hasNfe ? { not: null } : null });
    delete data.hasNfe;
  }

  if (data.hasReceipt !== undefined) {
    andConditions.push({ receiptId: data.hasReceipt ? { not: null } : null });
    delete data.hasReceipt;
  }

  if (data.hasItems !== undefined) {
    andConditions.push({
      items: data.hasItems ? { some: {} } : { none: {} },
    });
    delete data.hasItems;
  }

  if (data.searchingFor) {
    andConditions.push({
      OR: [{ withdrawerName: { contains: data.searchingFor, mode: "insensitive" } }, { notes: { contains: data.searchingFor, mode: "insensitive" } }],
    });
    delete data.searchingFor;
  }

  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  if (andConditions.length > 0) {
    if (data.where) {
      data.where = { ...data.where, AND: [...(data.where.AND || []), ...andConditions] };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// Query Schema
export const externalWithdrawalGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    where: externalWithdrawalWhereSchema.optional(),
    orderBy: externalWithdrawalOrderBySchema.optional(),
    include: externalWithdrawalIncludeSchema.optional(),
    ...externalWithdrawalFilters,
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
  })
  .transform(externalWithdrawalTransform);

// =====================
// MULTI-STAGE FORM SCHEMAS
// =====================

// Stage 1: Basic Information Schema (withdrawer, willReturn, observations)
export const externalWithdrawalStage1Schema = z.object({
  withdrawerName: createNameSchema(2, 200, "Nome do retirador"),
  willReturn: z.boolean().default(true),
  notes: z.string().max(500, "Observações devem ter no máximo 500 caracteres").nullable().optional(),
});

// Stage 2: Item Selection Schema (selected items with quantities and conditional prices)
export const externalWithdrawalItemSelectionSchema = z.object({
  itemId: z.string().uuid("Item inválido"),
  withdrawedQuantity: z.number().positive("Quantidade deve ser positiva"),
  // Monetary value is required only if willReturn is false - validated at form level
  price: z.number().min(0, "Preço não pode ser negativo").nullable().optional(),
});

export const externalWithdrawalStage2Schema = z.object({
  items: z.array(externalWithdrawalItemSelectionSchema).min(1, "Selecione pelo menos um item").max(100, "Limite máximo de 100 itens por retirada"),
});

// Complete Form Schema with conditional price validation
export const externalWithdrawalCompleteFormSchema = z
  .object({
    // Stage 1 data
    withdrawerName: createNameSchema(2, 200, "Nome do retirador"),
    willReturn: z.boolean().default(true),
    notes: z.string().max(500, "Observações devem ter no máximo 500 caracteres").nullable().optional(),

    // Stage 2 data
    items: z.array(externalWithdrawalItemSelectionSchema).min(1, "Selecione pelo menos um item").max(100, "Limite máximo de 100 itens por retirada"),

    // Optional fields for complete form
    status: z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS).default(EXTERNAL_WITHDRAWAL_STATUS.PENDING).optional(),
    invoiceIds: z.array(z.string().uuid("NFe inválida")).optional(),
    receiptIds: z.array(z.string().uuid("Recibo inválido")).optional(),
  })
  // Conditional validation: if willReturn is false (items NOT returned), all items must have price
  .refine(
    (data) => {
      if (data.willReturn) return true;
      return data.items.every((item) => item.price !== null && item.price !== undefined && item.price >= 0);
    },
    {
      message: "Todos os itens selecionados devem ter preço definido",
      path: ["items"],
    },
  );

// Form step validation schemas
export const externalWithdrawalFormStepSchema = z.object({
  step: z.number().int().min(1).max(3).default(1),
  mode: z.enum(["create", "edit"]).default("create"),
});

// =====================
// CRUD SCHEMAS (Updated for backward compatibility)
// =====================

// Create schema - maintains compatibility with existing API
export const externalWithdrawalCreateSchema = z
  .object({
    withdrawerName: createNameSchema(2, 200, "Nome do retirador"),
    willReturn: z.boolean().default(true),
    status: z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS).default(EXTERNAL_WITHDRAWAL_STATUS.PENDING).optional(),
    notes: z.string().max(500, "Observações devem ter no máximo 500 caracteres").nullable().optional(),
    // File arrays
    invoiceIds: z.array(z.string().uuid("NFe inválida")).optional(),
    receiptIds: z.array(z.string().uuid("Recibo inválido")).optional(),
    items: z
      .array(
        z.object({
          itemId: z.string().uuid("Item inválido"),
          withdrawedQuantity: z.number().positive("Quantidade retirada deve ser positiva"),
          price: z.number().min(0, "Preço unitário não pode ser negativo").nullable().optional(),
        }),
      )
      .optional(),
  })
  // Apply the same conditional validation for backward compatibility
  .refine(
    (data) => {
      if (data.willReturn || !data.items) return true;
      return data.items.every((item) => item.price !== null && item.price !== undefined && item.price >= 0);
    },
    {
      message: "Todos os itens selecionados devem ter preço definido",
      path: ["items"],
    },
  );

export const externalWithdrawalUpdateSchema = z.object({
  withdrawerName: z
    .string()
    .min(1, "Nome do retirador é obrigatório")
    .max(200, "Nome do retirador deve ter no máximo 200 caracteres")
    .transform((val) => val.trim())
    .refine((val) => val.length >= 2, { message: "Nome do retirador deve ter pelo menos 2 caracteres" })
    .optional(),
  willReturn: z.boolean().optional(),
  status: z.nativeEnum(EXTERNAL_WITHDRAWAL_STATUS).optional(),
  notes: z.string().max(500, "Observações devem ter no máximo 500 caracteres").nullable().optional(),
  // File arrays
  invoiceIds: z.array(z.string().uuid("NFe inválida")).optional(),
  receiptIds: z.array(z.string().uuid("Recibo inválido")).optional(),
});

// Batch Schemas
export const externalWithdrawalBatchCreateSchema = z.object({
  externalWithdrawals: z.array(externalWithdrawalCreateSchema),
});

export const externalWithdrawalBatchUpdateSchema = z.object({
  externalWithdrawals: z
    .array(
      z.object({
        id: z.string().uuid("Retirada externa inválida"),
        data: externalWithdrawalUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma retirada deve ser fornecida"),
});

export const externalWithdrawalBatchDeleteSchema = z.object({
  externalWithdrawalIds: z.array(z.string().uuid("Retirada externa inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const externalWithdrawalQuerySchema = z.object({
  include: externalWithdrawalIncludeSchema.optional(),
});

// GetById Schema
export const externalWithdrawalGetByIdSchema = z.object({
  include: externalWithdrawalIncludeSchema.optional(),
});

// =====================
// EXTERNAL WITHDRAWAL ITEM SCHEMAS
// =====================

// Include Schema
export const externalWithdrawalItemIncludeSchema = z
  .object({
    externalWithdrawal: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              nfe: z.boolean().optional(),
              receipt: z.boolean().optional(),
              items: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    item: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              prices: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z.object({}).optional(),
                    where: z.object({}).optional(),
                    orderBy: z
                      .union([
                        z.object({
                          id: orderByDirectionSchema.optional(),
                          value: orderByDirectionSchema.optional(),
                          createdAt: orderByDirectionSchema.optional(),
                          updatedAt: orderByDirectionSchema.optional(),
                        }),
                        z.array(
                          z.object({
                            id: orderByDirectionSchema.optional(),
                            value: orderByDirectionSchema.optional(),
                            createdAt: orderByDirectionSchema.optional(),
                            updatedAt: orderByDirectionSchema.optional(),
                          }),
                        ),
                      ])
                      .optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              orderItems: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              orderRules: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// OrderBy Schema
export const externalWithdrawalItemOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        externalWithdrawalId: orderByDirectionSchema.optional(),
        itemId: orderByDirectionSchema.optional(),
        withdrawedQuantity: orderByDirectionSchema.optional(),
        returnedQuantity: orderByDirectionSchema.optional(),
        price: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          quantity: orderByDirectionSchema.optional(),
          price: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// Where Schema
export const externalWithdrawalItemWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.array(z.lazy(() => externalWithdrawalItemWhereSchema)).optional(),
    OR: z.array(z.lazy(() => externalWithdrawalItemWhereSchema)).optional(),
    NOT: z.lazy(() => externalWithdrawalItemWhereSchema).optional(),

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

    externalWithdrawalId: z
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

    itemId: z
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

    withdrawedQuantity: z
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

    returnedQuantity: z
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

    price: z
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
  })
  .partial();

// Convenience filters
const externalWithdrawalItemFilters = {
  externalWithdrawalIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  withdrawedQuantityRange: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
    })
    .optional(),
  returnedQuantityRange: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
    })
    .optional(),
  priceRange: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
    })
    .optional(),
  searchingFor: z.string().optional(),
};

// Transform function
const externalWithdrawalItemTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  if (data.externalWithdrawalIds?.length) {
    andConditions.push({ externalWithdrawalId: { in: data.externalWithdrawalIds } });
    delete data.externalWithdrawalIds;
  }

  if (data.itemIds?.length) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.withdrawedQuantityRange) {
    const withdrawedQuantityCondition: any = {};
    if (data.withdrawedQuantityRange.min !== undefined) withdrawedQuantityCondition.gte = data.withdrawedQuantityRange.min;
    if (data.withdrawedQuantityRange.max !== undefined) withdrawedQuantityCondition.lte = data.withdrawedQuantityRange.max;
    if (Object.keys(withdrawedQuantityCondition).length > 0) {
      andConditions.push({ withdrawedQuantity: withdrawedQuantityCondition });
    }
    delete data.withdrawedQuantityRange;
  }

  if (data.returnedQuantityRange) {
    const returnedQuantityCondition: any = {};
    if (data.returnedQuantityRange.min !== undefined) returnedQuantityCondition.gte = data.returnedQuantityRange.min;
    if (data.returnedQuantityRange.max !== undefined) returnedQuantityCondition.lte = data.returnedQuantityRange.max;
    if (Object.keys(returnedQuantityCondition).length > 0) {
      andConditions.push({ returnedQuantity: returnedQuantityCondition });
    }
    delete data.returnedQuantityRange;
  }

  if (data.priceRange) {
    const priceCondition: any = {};
    if (data.priceRange.min !== undefined) priceCondition.gte = data.priceRange.min;
    if (data.priceRange.max !== undefined) priceCondition.lte = data.priceRange.max;
    if (Object.keys(priceCondition).length > 0) {
      andConditions.push({ price: priceCondition });
    }
    delete data.priceRange;
  }

  if (data.searchingFor) {
    andConditions.push({
      item: { name: { contains: data.searchingFor, mode: "insensitive" } },
    });
    delete data.searchingFor;
  }

  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  if (andConditions.length > 0) {
    if (data.where) {
      data.where = { ...data.where, AND: [...(data.where.AND || []), ...andConditions] };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// Query Schema
export const externalWithdrawalItemGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    where: externalWithdrawalItemWhereSchema.optional(),
    orderBy: externalWithdrawalItemOrderBySchema.optional(),
    include: externalWithdrawalItemIncludeSchema.optional(),
    ...externalWithdrawalItemFilters,
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
  })
  .transform(externalWithdrawalItemTransform);

// CRUD Schemas
export const externalWithdrawalItemCreateSchema = z.object({
  externalWithdrawalId: z.string().uuid("Retirada externa inválida"),
  itemId: z.string().uuid("Item inválido"),
  withdrawedQuantity: z.number().positive("Quantidade retirada deve ser positiva"),
  price: z.number().min(0, "Preço não pode ser negativo").nullable().optional(),
});

export const externalWithdrawalItemUpdateSchema = z.object({
  withdrawedQuantity: z.number().positive("Quantidade retirada deve ser positiva").optional(),
  returnedQuantity: z.number().min(0, "Quantidade devolvida não pode ser negativa").optional(),
  price: z.number().min(0, "Preço não pode ser negativo").nullable().optional(),
});

// Batch Schemas
export const externalWithdrawalItemBatchCreateSchema = z.object({
  externalWithdrawalItems: z.array(externalWithdrawalItemCreateSchema),
});

export const externalWithdrawalItemBatchUpdateSchema = z.object({
  externalWithdrawalItems: z
    .array(
      z.object({
        id: z.string().uuid("Item de retirada externa inválido"),
        data: externalWithdrawalItemUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um item deve ser fornecido"),
});

export const externalWithdrawalItemBatchDeleteSchema = z.object({
  externalWithdrawalItemIds: z.array(z.string().uuid("Item de retirada externa inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const externalWithdrawalItemQuerySchema = z.object({
  include: externalWithdrawalItemIncludeSchema.optional(),
});

// GetById Schema
export const externalWithdrawalItemGetByIdSchema = z.object({
  include: externalWithdrawalItemIncludeSchema.optional(),
});

// =====================
// INFERRED TYPES
// =====================

// Multi-stage form types
export type ExternalWithdrawalStage1FormData = z.infer<typeof externalWithdrawalStage1Schema>;
export type ExternalWithdrawalStage2FormData = z.infer<typeof externalWithdrawalStage2Schema>;
export type ExternalWithdrawalCompleteFormData = z.infer<typeof externalWithdrawalCompleteFormSchema>;
export type ExternalWithdrawalItemSelectionFormData = z.infer<typeof externalWithdrawalItemSelectionSchema>;
export type ExternalWithdrawalFormStepFormData = z.infer<typeof externalWithdrawalFormStepSchema>;

// ExternalWithdrawal types (existing)
export type ExternalWithdrawalGetManyFormData = z.infer<typeof externalWithdrawalGetManySchema>;
export type ExternalWithdrawalGetByIdFormData = z.infer<typeof externalWithdrawalGetByIdSchema>;
export type ExternalWithdrawalQueryFormData = z.infer<typeof externalWithdrawalQuerySchema>;

export type ExternalWithdrawalCreateFormData = z.infer<typeof externalWithdrawalCreateSchema>;
export type ExternalWithdrawalUpdateFormData = z.infer<typeof externalWithdrawalUpdateSchema>;

export type ExternalWithdrawalBatchCreateFormData = z.infer<typeof externalWithdrawalBatchCreateSchema>;
export type ExternalWithdrawalBatchUpdateFormData = z.infer<typeof externalWithdrawalBatchUpdateSchema>;
export type ExternalWithdrawalBatchDeleteFormData = z.infer<typeof externalWithdrawalBatchDeleteSchema>;

export type ExternalWithdrawalInclude = z.infer<typeof externalWithdrawalIncludeSchema>;
export type ExternalWithdrawalWhere = z.infer<typeof externalWithdrawalWhereSchema>;
export type ExternalWithdrawalOrderBy = z.infer<typeof externalWithdrawalOrderBySchema>;

// ExternalWithdrawalItem types
export type ExternalWithdrawalItemGetManyFormData = z.infer<typeof externalWithdrawalItemGetManySchema>;
export type ExternalWithdrawalItemGetByIdFormData = z.infer<typeof externalWithdrawalItemGetByIdSchema>;
export type ExternalWithdrawalItemQueryFormData = z.infer<typeof externalWithdrawalItemQuerySchema>;

export type ExternalWithdrawalItemCreateFormData = z.infer<typeof externalWithdrawalItemCreateSchema>;
export type ExternalWithdrawalItemUpdateFormData = z.infer<typeof externalWithdrawalItemUpdateSchema>;

export type ExternalWithdrawalItemBatchCreateFormData = z.infer<typeof externalWithdrawalItemBatchCreateSchema>;
export type ExternalWithdrawalItemBatchUpdateFormData = z.infer<typeof externalWithdrawalItemBatchUpdateSchema>;
export type ExternalWithdrawalItemBatchDeleteFormData = z.infer<typeof externalWithdrawalItemBatchDeleteSchema>;

export type ExternalWithdrawalItemInclude = z.infer<typeof externalWithdrawalItemIncludeSchema>;
export type ExternalWithdrawalItemWhere = z.infer<typeof externalWithdrawalItemWhereSchema>;
export type ExternalWithdrawalItemOrderBy = z.infer<typeof externalWithdrawalItemOrderBySchema>;

// =====================
// HELPER FUNCTIONS
// =====================

// Multi-stage form helpers
export const mapExternalWithdrawalToStage1FormData = createMapToFormDataHelper<ExternalWithdrawal, ExternalWithdrawalStage1FormData>((externalWithdrawal) => ({
  withdrawerName: externalWithdrawal.withdrawerName,
  willReturn: externalWithdrawal.willReturn,
  notes: externalWithdrawal.notes,
}));

export const mapExternalWithdrawalToCompleteFormData = createMapToFormDataHelper<ExternalWithdrawal & { items?: ExternalWithdrawalItem[] }, ExternalWithdrawalCompleteFormData>(
  (externalWithdrawal) => ({
    withdrawerName: externalWithdrawal.withdrawerName,
    willReturn: externalWithdrawal.willReturn,
    notes: externalWithdrawal.notes,
    items:
      externalWithdrawal.items?.map((item) => ({
        itemId: item.itemId,
        withdrawedQuantity: item.withdrawedQuantity,
        price: item.price,
      })) || [],
    status: externalWithdrawal.status,
    invoiceIds: externalWithdrawal.nfes?.map((nfe) => nfe.id) || [],
    receiptIds: externalWithdrawal.receipts?.map((receipt) => receipt.id) || [],
  }),
);

// Existing helpers (backward compatibility)
export const mapExternalWithdrawalToFormData = createMapToFormDataHelper<ExternalWithdrawal, ExternalWithdrawalUpdateFormData>((externalWithdrawal) => ({
  withdrawerName: externalWithdrawal.withdrawerName,
  willReturn: externalWithdrawal.willReturn,
  status: externalWithdrawal.status,
  invoiceIds: externalWithdrawal.nfes?.map((nfe) => nfe.id),
  receiptIds: externalWithdrawal.receipts?.map((receipt) => receipt.id),
  notes: externalWithdrawal.notes,
}));

export const mapExternalWithdrawalItemToFormData = createMapToFormDataHelper<ExternalWithdrawalItem, ExternalWithdrawalItemUpdateFormData>((item) => ({
  withdrawedQuantity: item.withdrawedQuantity,
  returnedQuantity: item.returnedQuantity,
  price: item.price,
}));

// Validation helpers for multi-stage forms
export const validateStage1FormData = (data: unknown): data is ExternalWithdrawalStage1FormData => {
  return externalWithdrawalStage1Schema.safeParse(data).success;
};

export const validateStage2FormData = (data: unknown): data is ExternalWithdrawalStage2FormData => {
  return externalWithdrawalStage2Schema.safeParse(data).success;
};

export const validateCompleteFormData = (data: unknown): data is ExternalWithdrawalCompleteFormData => {
  return externalWithdrawalCompleteFormSchema.safeParse(data).success;
};

// Form data combination helper
export const combineFormStages = (
  stage1Data: ExternalWithdrawalStage1FormData,
  stage2Data: ExternalWithdrawalStage2FormData,
  additionalData?: {
    status?: EXTERNAL_WITHDRAWAL_STATUS;
    invoiceIds?: string[];
    receiptIds?: string[];
  },
): ExternalWithdrawalCompleteFormData => {
  return {
    ...stage1Data,
    ...stage2Data,
    status: additionalData?.status || EXTERNAL_WITHDRAWAL_STATUS.PENDING,
    invoiceIds: additionalData?.invoiceIds || [],
    receiptIds: additionalData?.receiptIds || [],
  };
};

// Convert complete form data to create schema format
export const convertCompleteFormToCreateData = (completeData: ExternalWithdrawalCompleteFormData): ExternalWithdrawalCreateFormData => {
  return {
    withdrawerName: completeData.withdrawerName,
    willReturn: completeData.willReturn,
    notes: completeData.notes,
    items: completeData.items.map((item) => ({
      itemId: item.itemId,
      withdrawedQuantity: item.withdrawedQuantity,
      price: item.price,
    })),
    status: completeData.status,
    invoiceIds: completeData.invoiceIds,
    receiptIds: completeData.receiptIds,
  };
};
