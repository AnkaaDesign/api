// packages/schemas/src/borrow.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableDate,
  toFormData,
} from './common';
import type { Borrow } from '@types';
import { BORROW_STATUS } from '@constants';

// =====================
// Select Schema Based on Prisma Schema
// =====================

export const borrowSelectSchema = z
  .object({
    id: z.boolean().optional(),
    itemId: z.boolean().optional(),
    userId: z.boolean().optional(),
    quantity: z.boolean().optional(),
    status: z.boolean().optional(),
    statusOrder: z.boolean().optional(),
    returnedAt: z.boolean().optional(),
    createdAt: z.boolean().optional(),
    updatedAt: z.boolean().optional(),
    // Relations
    item: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              id: z.boolean().optional(),
              name: z.boolean().optional(),
              uniCode: z.boolean().optional(),
              quantity: z.boolean().optional(),
              isActive: z.boolean().optional(),
              isPpe: z.boolean().optional(),
              brandId: z.boolean().optional(),
              categoryId: z.boolean().optional(),
              supplierId: z.boolean().optional(),
              createdAt: z.boolean().optional(),
              updatedAt: z.boolean().optional(),
              // Nested relations in select
              brand: z
                .union([
                  z.boolean(),
                  z.object({
                    select: z
                      .object({
                        id: z.boolean().optional(),
                        name: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              category: z
                .union([
                  z.boolean(),
                  z.object({
                    select: z
                      .object({
                        id: z.boolean().optional(),
                        name: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              supplier: z
                .union([
                  z.boolean(),
                  z.object({
                    select: z
                      .object({
                        id: z.boolean().optional(),
                        fantasyName: z.boolean().optional(),
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
    user: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              id: z.boolean().optional(),
              name: z.boolean().optional(),
              email: z.boolean().optional(),
              status: z.boolean().optional(),
              sectorId: z.boolean().optional(),
              positionId: z.boolean().optional(),
              createdAt: z.boolean().optional(),
              updatedAt: z.boolean().optional(),
              // Nested relations in select
              position: z
                .union([
                  z.boolean(),
                  z.object({
                    select: z
                      .object({
                        id: z.boolean().optional(),
                        name: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              sector: z
                .union([
                  z.boolean(),
                  z.object({
                    select: z
                      .object({
                        id: z.boolean().optional(),
                        name: z.boolean().optional(),
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
// Optimized Select Schemas for Different Views
// =====================

/**
 * Minimal select for table views - only essential fields
 * Use when displaying lists/tables of borrows
 */
export const borrowSelectTableSchema = borrowSelectSchema.parse({
  id: true,
  quantity: true,
  status: true,
  returnedAt: true,
  createdAt: true,
  item: {
    select: {
      id: true,
      name: true,
      uniCode: true,
      quantity: true,
      brand: {
        select: {
          name: true,
        },
      },
      category: {
        select: {
          name: true,
        },
      },
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      position: {
        select: {
          name: true,
        },
      },
      sector: {
        select: {
          name: true,
        },
      },
    },
  },
});

/**
 * Standard select for form views - common fields for editing
 * Use when displaying borrow forms
 */
export const borrowSelectFormSchema = borrowSelectSchema.parse({
  id: true,
  itemId: true,
  userId: true,
  quantity: true,
  status: true,
  statusOrder: true,
  returnedAt: true,
  createdAt: true,
  updatedAt: true,
  item: {
    select: {
      id: true,
      name: true,
      uniCode: true,
      quantity: true,
      isPpe: true,
      brand: {
        select: {
          id: true,
          name: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      sectorId: true,
      positionId: true,
      position: {
        select: {
          id: true,
          name: true,
        },
      },
      sector: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
});

/**
 * Complete select for detail views - all fields with full relations
 * Use when displaying full borrow details
 */
export const borrowSelectDetailSchema = borrowSelectSchema.parse({
  id: true,
  itemId: true,
  userId: true,
  quantity: true,
  status: true,
  statusOrder: true,
  returnedAt: true,
  createdAt: true,
  updatedAt: true,
  item: {
    select: {
      id: true,
      name: true,
      uniCode: true,
      quantity: true,
      isActive: true,
      isPpe: true,
      brandId: true,
      categoryId: true,
      supplierId: true,
      createdAt: true,
      updatedAt: true,
      brand: {
        select: {
          id: true,
          name: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      supplier: {
        select: {
          id: true,
          fantasyName: true,
        },
      },
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      sectorId: true,
      positionId: true,
      createdAt: true,
      updatedAt: true,
      position: {
        select: {
          id: true,
          name: true,
        },
      },
      sector: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
});

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
            notIn: z
              .array(z.enum(Object.values(BORROW_STATUS) as [string, ...string[]]))
              .optional(),
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
      OR: [
        { item: { name: { contains: data.searchingFor, mode: 'insensitive' } } },
        { user: { name: { contains: data.searchingFor, mode: 'insensitive' } } },
      ],
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
      const fromDate =
        data.createdAt.gte instanceof Date ? data.createdAt.gte : new Date(data.createdAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      createdAtCondition.gte = fromDate;
    }
    if (data.createdAt.lte) {
      const toDate =
        data.createdAt.lte instanceof Date ? data.createdAt.lte : new Date(data.createdAt.lte);
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
      const fromDate =
        data.returnedAt.gte instanceof Date ? data.returnedAt.gte : new Date(data.returnedAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      returnedAtCondition.gte = fromDate;
    }
    if (data.returnedAt.lte) {
      const toDate =
        data.returnedAt.lte instanceof Date ? data.returnedAt.lte : new Date(data.returnedAt.lte);
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
      const fromDate =
        data.updatedAt.gte instanceof Date ? data.updatedAt.gte : new Date(data.updatedAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      updatedAtCondition.gte = fromDate;
    }
    if (data.updatedAt.lte) {
      const toDate =
        data.updatedAt.lte instanceof Date ? data.updatedAt.lte : new Date(data.updatedAt.lte);
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
    select: borrowSelectSchema.optional(),

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
  .transform(borrowTransform)
  .refine(
    data => {
      // Validate that select and include are not used together
      return !(data.select && data.include);
    },
    {
      message: 'Cannot use both select and include at the same time',
      path: ['select'],
    },
  );

// =====================
// CRUD Schemas
// =====================

export const borrowCreateSchema = z
  .object({
    itemId: z
      .string({
        required_error: 'Item é obrigatório',
        invalid_type_error: 'Item inválido',
      })
      .uuid('Item inválido'),
    userId: z
      .string({
        required_error: 'Usuário é obrigatório',
        invalid_type_error: 'Usuário inválido',
      })
      .uuid('Usuário inválido'),
    quantity: z
      .number({
        required_error: 'Quantidade é obrigatória',
        invalid_type_error: 'Quantidade inválida',
      })
      .int('Quantidade deve ser um número inteiro')
      .positive('Quantidade deve ser positiva')
      .default(1),
    returnedAt: nullableDate.optional(),
  })
  .transform(toFormData);

export const borrowUpdateSchema = z
  .object({
    itemId: z
      .string({
        invalid_type_error: 'Item inválido',
      })
      .uuid('Item inválido')
      .optional(),
    userId: z
      .string({
        invalid_type_error: 'Usuário inválido',
      })
      .uuid('Usuário inválido')
      .optional(),
    quantity: z
      .number({
        invalid_type_error: 'Quantidade inválida',
      })
      .positive('Quantidade deve ser positiva')
      .optional(),
    status: z
      .enum(Object.values(BORROW_STATUS) as [string, ...string[]], {
        invalid_type_error: 'Status inválido',
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
  borrows: z.array(borrowCreateSchema).min(1, 'Pelo menos um empréstimo deve ser fornecido'),
});

export const borrowBatchUpdateSchema = z.object({
  borrows: z
    .array(
      z.object({
        id: z
          .string({
            required_error: 'Empréstimo é obrigatório',
            invalid_type_error: 'Empréstimo inválido',
          })
          .uuid('Empréstimo inválido'),
        data: borrowUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um empréstimo é necessário'),
});

export const borrowBatchDeleteSchema = z.object({
  borrowIds: z
    .array(
      z
        .string({
          required_error: 'Empréstimo é obrigatório',
          invalid_type_error: 'Empréstimo inválido',
        })
        .uuid('Empréstimo inválido'),
    )
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include/select parameters
export const borrowQuerySchema = z
  .object({
    include: borrowIncludeSchema.optional(),
    select: borrowSelectSchema.optional(),
  })
  .refine(
    data => {
      // Validate that select and include are not used together
      return !(data.select && data.include);
    },
    {
      message: 'Cannot use both select and include at the same time',
      path: ['select'],
    },
  );

// =====================
// GetById Schema
// =====================

export const borrowGetByIdSchema = z
  .object({
    include: borrowIncludeSchema.optional(),
    select: borrowSelectSchema.optional(),
  })
  .refine(
    data => {
      // Validate that select and include are not used together
      return !(data.select && data.include);
    },
    {
      message: 'Cannot use both select and include at the same time',
      path: ['select'],
    },
  );

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

export type BorrowSelect = z.infer<typeof borrowSelectSchema>;
export type BorrowInclude = z.infer<typeof borrowIncludeSchema>;
export type BorrowOrderBy = z.infer<typeof borrowOrderBySchema>;
export type BorrowWhere = z.infer<typeof borrowWhereSchema>;

// Optimized select types for different views
export type BorrowSelectTable = typeof borrowSelectTableSchema;
export type BorrowSelectForm = typeof borrowSelectFormSchema;
export type BorrowSelectDetail = typeof borrowSelectDetailSchema;

// =====================
// Helper Functions
// =====================

export const mapBorrowToFormData = createMapToFormDataHelper<Borrow, BorrowUpdateFormData>(
  borrow => ({
    itemId: borrow.itemId,
    userId: borrow.userId,
    quantity: borrow.quantity,
    status: borrow.status,
    statusOrder: borrow.statusOrder,
    returnedAt: borrow.returnedAt,
  }),
);

/**
 * Get optimized select for table view
 * Returns only fields needed for displaying borrows in a table/list
 */
export const getBorrowTableSelect = () => borrowSelectTableSchema;

/**
 * Get optimized select for form view
 * Returns fields needed for editing/creating borrows
 */
export const getBorrowFormSelect = () => borrowSelectFormSchema;

/**
 * Get optimized select for detail view
 * Returns all fields with full relation data for detailed views
 */
export const getBorrowDetailSelect = () => borrowSelectDetailSchema;

/**
 * Helper to build custom select with only specified fields
 * @param fields - Array of field names to select
 * @returns Select object with specified fields set to true
 */
export const buildBorrowSelect = (fields: (keyof z.infer<typeof borrowSelectSchema>)[]) => {
  return fields.reduce(
    (acc, field) => {
      acc[field] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );
};

/**
 * Merge custom fields into a base select schema
 * @param baseSelect - Base select schema (table, form, or detail)
 * @param additionalFields - Additional fields to include
 * @returns Merged select object
 */
export const mergeBorrowSelect = (
  baseSelect: Partial<z.infer<typeof borrowSelectSchema>>,
  additionalFields: Partial<z.infer<typeof borrowSelectSchema>>,
) => {
  return { ...baseSelect, ...additionalFields };
};
