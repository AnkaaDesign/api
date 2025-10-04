// packages/schemas/src/borrow.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, nullableDate, toFormData } from "./common";
import type { Borrow } from '@types';
import { BORROW_STATUS } from '@constants';

// =====================
// Include Schema Based on Prisma Schema
// =====================

export const borrowIncludeSchema = z
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
              price: z.boolean().optional(),
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
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
              position: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        users: z.boolean().optional(),
                        remunerations: z.boolean().optional(),
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
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              item: z.boolean().optional(),
              user: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================

export const borrowOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        id: orderByDirectionSchema.optional(),
        itemId: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        quantity: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        returnedAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        item: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            quantity: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .partial()
          .optional(),
        user: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            email: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .partial()
          .optional(),
      })
      .partial(),

    // Array of ordering objects
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          itemId: orderByDirectionSchema.optional(),
          userId: orderByDirectionSchema.optional(),
          quantity: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          returnedAt: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const borrowWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(borrowWhereSchema).optional(),
      OR: z.array(borrowWhereSchema).optional(),
      NOT: borrowWhereSchema.optional(),

      // UUID fields
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

      // Numeric fields
      quantity: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
          }),
        ])
        .optional(),

      // Status field
      status: z
        .union([
          z.enum(Object.values(BORROW_STATUS) as [string, ...string[]]),
          z.object({
            equals: z.enum(Object.values(BORROW_STATUS) as [string, ...string[]]).optional(),
            not: z.enum(Object.values(BORROW_STATUS) as [string, ...string[]]).optional(),
            in: z.array(z.enum(Object.values(BORROW_STATUS) as [string, ...string[]])).optional(),
            notIn: z.array(z.enum(Object.values(BORROW_STATUS) as [string, ...string[]])).optional(),
          }),
        ])
        .optional(),

      statusOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
          }),
        ])
        .optional(),

      // Date fields
      returnedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      item: z.lazy(() => z.any()).optional(),
      user: z.lazy(() => z.any()).optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const borrowFilters = {
  searchingFor: z.string().optional(),
  isReturned: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isPast: z.boolean().optional(),
  itemIds: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  statusIds: z.array(z.enum(Object.values(BORROW_STATUS) as [string, ...string[]])).optional(),
  categoryIds: z.array(z.string()).optional(),
  brandIds: z.array(z.string()).optional(),
  quantityRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  year: z.number().int().min(2000).max(3000).optional(),
  month: z.number().int().min(1).max(12).optional(),
  dateRange: z
    .object({
      start: z.date().optional(),
      end: z.date().optional(),
    })
    .optional(),
};

// =====================
// Transform Function
// =====================

const borrowTransform = (data: any) => {
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

  // Transform convenience filters to where conditions
  if (data.searchingFor) {
    andConditions.push({
      OR: [{ item: { name: { contains: data.searchingFor, mode: "insensitive" } } }, { user: { name: { contains: data.searchingFor, mode: "insensitive" } } }],
    });
    delete data.searchingFor;
  }

  if (data.isReturned !== undefined) {
    if (data.isReturned) {
      andConditions.push({ returnedAt: { not: null } });
    } else {
      andConditions.push({ returnedAt: null });
    }
    delete data.isReturned;
  }

  if (data.isActive !== undefined) {
    if (data.isActive) {
      andConditions.push({ returnedAt: null });
    }
    delete data.isActive;
  }

  if (data.isPast !== undefined) {
    if (data.isPast) {
      andConditions.push({ returnedAt: { not: null } });
    }
    delete data.isPast;
  }

  if (data.itemIds?.length) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.userIds?.length) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.statusIds?.length) {
    andConditions.push({ status: { in: data.statusIds } });
    delete data.statusIds;
  }

  if (data.categoryIds?.length) {
    andConditions.push({ item: { categoryId: { in: data.categoryIds } } });
    delete data.categoryIds;
  }

  if (data.brandIds?.length) {
    andConditions.push({ item: { brandId: { in: data.brandIds } } });
    delete data.brandIds;
  }

  if (data.quantityRange) {
    const quantityCondition: any = {};
    if (data.quantityRange.min !== undefined) quantityCondition.gte = data.quantityRange.min;
    if (data.quantityRange.max !== undefined) quantityCondition.lte = data.quantityRange.max;
    if (Object.keys(quantityCondition).length > 0) {
      andConditions.push({ quantity: quantityCondition });
    }
    delete data.quantityRange;
  }

  if (data.year) {
    const startOfYear = new Date(data.year, 0, 1);
    const endOfYear = new Date(data.year, 11, 31, 23, 59, 59, 999);
    andConditions.push({
      createdAt: {
        gte: startOfYear,
        lte: endOfYear,
      },
    });
    delete data.year;
  }

  if (data.month && data.year) {
    const startOfMonth = new Date(data.year, data.month - 1, 1);
    const endOfMonth = new Date(data.year, data.month, 0, 23, 59, 59, 999);
    andConditions.push({
      createdAt: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    });
    delete data.month;
  }

  if (data.dateRange) {
    const createdAtCondition: any = {};
    if (data.dateRange.start) createdAtCondition.gte = data.dateRange.start;
    if (data.dateRange.end) createdAtCondition.lte = data.dateRange.end;
    if (Object.keys(createdAtCondition).length > 0) {
      andConditions.push({ createdAt: createdAtCondition });
    }
    delete data.dateRange;
  }

  if (data.createdAt) {
    const createdAtCondition: any = {};
    if (data.createdAt.gte) {
      const fromDate = data.createdAt.gte instanceof Date
        ? data.createdAt.gte
        : new Date(data.createdAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      createdAtCondition.gte = fromDate;
    }
    if (data.createdAt.lte) {
      const toDate = data.createdAt.lte instanceof Date
        ? data.createdAt.lte
        : new Date(data.createdAt.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      createdAtCondition.lte = toDate;
    }
    if (Object.keys(createdAtCondition).length > 0) {
      andConditions.push({ createdAt: createdAtCondition });
    }
    delete data.createdAt;
  }

  if (data.returnedAt) {
    const returnedAtCondition: any = {};
    if (data.returnedAt.gte) {
      const fromDate = data.returnedAt.gte instanceof Date
        ? data.returnedAt.gte
        : new Date(data.returnedAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      returnedAtCondition.gte = fromDate;
    }
    if (data.returnedAt.lte) {
      const toDate = data.returnedAt.lte instanceof Date
        ? data.returnedAt.lte
        : new Date(data.returnedAt.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      returnedAtCondition.lte = toDate;
    }
    if (Object.keys(returnedAtCondition).length > 0) {
      andConditions.push({ returnedAt: returnedAtCondition });
    }
    delete data.returnedAt;
  }

  if (data.updatedAt) {
    const updatedAtCondition: any = {};
    if (data.updatedAt.gte) {
      const fromDate = data.updatedAt.gte instanceof Date
        ? data.updatedAt.gte
        : new Date(data.updatedAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      updatedAtCondition.gte = fromDate;
    }
    if (data.updatedAt.lte) {
      const toDate = data.updatedAt.lte instanceof Date
        ? data.updatedAt.lte
        : new Date(data.updatedAt.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      updatedAtCondition.lte = toDate;
    }
    if (Object.keys(updatedAtCondition).length > 0) {
      andConditions.push({ updatedAt: updatedAtCondition });
    }
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = {
          AND: [data.where, ...andConditions],
        };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schema
// =====================

export const borrowGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: borrowWhereSchema.optional(),
    orderBy: borrowOrderBySchema.optional(),
    include: borrowIncludeSchema.optional(),

    // Convenience filters
    ...borrowFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    returnedAt: z
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
  .transform(borrowTransform);

// =====================
// CRUD Schemas
// =====================

export const borrowCreateSchema = z
  .object({
    itemId: z
      .string({
        required_error: "Item é obrigatório",
        invalid_type_error: "Item inválido",
      })
      .uuid("Item inválido"),
    userId: z
      .string({
        required_error: "Usuário é obrigatório",
        invalid_type_error: "Usuário inválido",
      })
      .uuid("Usuário inválido"),
    quantity: z
      .number({
        required_error: "Quantidade é obrigatória",
        invalid_type_error: "Quantidade inválida",
      })
      .positive("Quantidade deve ser positiva")
      .default(1),
    returnedAt: nullableDate.optional(),
  })
  .transform(toFormData);

export const borrowUpdateSchema = z
  .object({
    itemId: z
      .string({
        invalid_type_error: "Item inválido",
      })
      .uuid("Item inválido")
      .optional(),
    userId: z
      .string({
        invalid_type_error: "Usuário inválido",
      })
      .uuid("Usuário inválido")
      .optional(),
    quantity: z
      .number({
        invalid_type_error: "Quantidade inválida",
      })
      .positive("Quantidade deve ser positiva")
      .optional(),
    status: z
      .enum(Object.values(BORROW_STATUS) as [string, ...string[]], {
        invalid_type_error: "Status inválido",
      })
      .optional(),
    statusOrder: z.number().int().positive().optional(),
    returnedAt: nullableDate.optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const borrowBatchCreateSchema = z.object({
  borrows: z.array(borrowCreateSchema).min(1, "Pelo menos um empréstimo deve ser fornecido"),
});

export const borrowBatchUpdateSchema = z.object({
  borrows: z
    .array(
      z.object({
        id: z
          .string({
            required_error: "Empréstimo é obrigatório",
            invalid_type_error: "Empréstimo inválido",
          })
          .uuid("Empréstimo inválido"),
        data: borrowUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um empréstimo é necessário"),
});

export const borrowBatchDeleteSchema = z.object({
  borrowIds: z
    .array(
      z
        .string({
          required_error: "Empréstimo é obrigatório",
          invalid_type_error: "Empréstimo inválido",
        })
        .uuid("Empréstimo inválido"),
    )
    .min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const borrowQuerySchema = z.object({
  include: borrowIncludeSchema.optional(),
});

// =====================
// GetById Schema
// =====================

export const borrowGetByIdSchema = z.object({
  include: borrowIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type BorrowGetManyFormData = z.infer<typeof borrowGetManySchema>;
export type BorrowGetByIdFormData = z.infer<typeof borrowGetByIdSchema>;
export type BorrowQueryFormData = z.infer<typeof borrowQuerySchema>;

export type BorrowCreateFormData = z.infer<typeof borrowCreateSchema>;
export type BorrowUpdateFormData = z.infer<typeof borrowUpdateSchema>;

export type BorrowBatchCreateFormData = z.infer<typeof borrowBatchCreateSchema>;
export type BorrowBatchUpdateFormData = z.infer<typeof borrowBatchUpdateSchema>;
export type BorrowBatchDeleteFormData = z.infer<typeof borrowBatchDeleteSchema>;

export type BorrowInclude = z.infer<typeof borrowIncludeSchema>;
export type BorrowOrderBy = z.infer<typeof borrowOrderBySchema>;
export type BorrowWhere = z.infer<typeof borrowWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapBorrowToFormData = createMapToFormDataHelper<Borrow, BorrowUpdateFormData>((borrow) => ({
  itemId: borrow.itemId,
  userId: borrow.userId,
  quantity: borrow.quantity,
  status: borrow.status,
  statusOrder: borrow.statusOrder,
  returnedAt: borrow.returnedAt,
}));
