// packages/schemas/src/order.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  moneySchema,
} from './common';
import type { Order, OrderItem, OrderSchedule } from '@types';
import { ORDER_STATUS, PAYMENT_METHOD, BANK_SLIP_DUE_DAYS_OPTIONS, SCHEDULE_FREQUENCY, WEEK_DAY, MONTH, MONTH_OCCURRENCE } from '@constants';

// =====================
// Order Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const orderIncludeSchema = z
  .object({
    // Direct Order relations
    budgets: z.boolean().optional(),
    invoices: z.boolean().optional(),
    invoiceReimbursements: z.boolean().optional(),
    receipts: z.boolean().optional(),
    reimbursements: z.boolean().optional(),
    supplier: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              logo: z.boolean().optional(),
              items: z.boolean().optional(),
              orderSchedules: z.boolean().optional(),
              orders: z.boolean().optional(),
              orderRules: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    orderSchedule: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              supplier: z.boolean().optional(),
              category: z.boolean().optional(),
              weeklySchedule: z.boolean().optional(),
              monthlySchedule: z.boolean().optional(),
              yearlySchedule: z.boolean().optional(),
              order: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    epiSchedule: z.boolean().optional(),
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
                        measures: z.boolean().optional(),
                        paints: z.boolean().optional(),
                        activities: z.boolean().optional(),
                        borrows: z.boolean().optional(),
                        orderItems: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              order: z.boolean().optional(),
              activities: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    activities: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z.boolean().optional(),
              user: z.boolean().optional(),
              order: z.boolean().optional(),
              orderItem: z.boolean().optional(),
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
              items: z.boolean().optional(),
              activities: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderItem Include Schema
// =====================

export const orderItemIncludeSchema = z
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
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              orderItems: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    order: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              budgets: z.boolean().optional(),
              invoices: z.boolean().optional(),
              invoiceReimbursements: z.boolean().optional(),
              receipts: z.boolean().optional(),
              reimbursements: z.boolean().optional(),
              supplier: z.boolean().optional(),
              orderSchedule: z.boolean().optional(),
              items: z.boolean().optional(),
              activities: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    activities: z.boolean().optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              activities: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderSchedule Include Schema
// =====================

export const orderScheduleIncludeSchema = z
  .object({
    supplier: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              logo: z.boolean().optional(),
              items: z.boolean().optional(),
              orderSchedules: z.boolean().optional(),
              orders: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    category: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              items: z.boolean().optional(),
              orderSchedule: z.boolean().optional(),
              ppeSchedules: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    weeklySchedule: z.boolean().optional(),
    monthlySchedule: z.boolean().optional(),
    yearlySchedule: z.boolean().optional(),
    order: z.boolean().optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z.object({}).optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Order OrderBy Schema
// =====================

export const orderOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      id: orderByDirectionSchema.optional(),
      description: orderByDirectionSchema.optional(),
      forecast: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      statusOrder: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial(),

  // Array of ordering objects
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        forecast: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// OrderItem OrderBy Schema
// =====================

export const orderItemOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      id: orderByDirectionSchema.optional(),
      orderedQuantity: orderByDirectionSchema.optional(),
      receivedQuantity: orderByDirectionSchema.optional(),
      price: orderByDirectionSchema.optional(),
      icms: orderByDirectionSchema.optional(),
      ipi: orderByDirectionSchema.optional(),
      receivedAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial(),

  // Array of ordering objects
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        orderedQuantity: orderByDirectionSchema.optional(),
        receivedQuantity: orderByDirectionSchema.optional(),
        price: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// OrderSchedule OrderBy Schema
// =====================

export const orderScheduleOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        id: orderByDirectionSchema.optional(),
        frequency: orderByDirectionSchema.optional(),
        frequencyCount: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        nextRun: orderByDirectionSchema.optional(),
        lastRun: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),

    // Array of ordering objects
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          frequency: orderByDirectionSchema.optional(),
          frequencyCount: orderByDirectionSchema.optional(),
          isActive: orderByDirectionSchema.optional(),
          nextRun: orderByDirectionSchema.optional(),
          lastRun: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .default({ nextRun: 'asc' });

// =====================
// Where Schemas
// =====================

export const orderWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([orderWhereSchema, z.array(orderWhereSchema)]).optional(),
      OR: z.array(orderWhereSchema).optional(),
      NOT: z.union([orderWhereSchema, z.array(orderWhereSchema)]).optional(),

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

      supplierId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      orderScheduleId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
          }),
        ])
        .optional(),

      // String fields
      description: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
          }),
        ])
        .optional(),

      status: z
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

      // Number fields
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

      // Date fields
      forecast: z
        .union([
          z.coerce.date(),
          z.null(),
          z.object({
            equals: z.union([z.coerce.date(), z.null()]).optional(),
            not: z.union([z.coerce.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      doneAt: z
        .union([
          z.coerce.date(),
          z.null(),
          z.object({
            equals: z.union([z.coerce.date(), z.null()]).optional(),
            not: z.union([z.coerce.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      items: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      supplier: z.any().optional(),
      orderSchedule: z.any().optional(),
    })
    .partial(),
);

export const orderItemWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([orderItemWhereSchema, z.array(orderItemWhereSchema)]).optional(),
      OR: z.array(orderItemWhereSchema).optional(),
      NOT: z.union([orderItemWhereSchema, z.array(orderItemWhereSchema)]).optional(),

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

      orderId: z
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

      // Number fields
      orderedQuantity: z
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

      receivedQuantity: z
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

      // Date fields
      receivedAt: z
        .union([
          z.coerce.date(),
          z.null(),
          z.object({
            equals: z.union([z.coerce.date(), z.null()]).optional(),
            not: z.union([z.coerce.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      item: z.any().optional(),
      order: z.any().optional(),
    })
    .partial(),
);

export const orderScheduleWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([orderScheduleWhereSchema, z.array(orderScheduleWhereSchema)]).optional(),
      OR: z.array(orderScheduleWhereSchema).optional(),
      NOT: z.union([orderScheduleWhereSchema, z.array(orderScheduleWhereSchema)]).optional(),

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

      supplierId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      categoryId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      // String fields
      status: z
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

      frequency: z
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

      // Boolean fields
      isActive: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      // Date fields
      nextRun: z
        .union([
          z.coerce.date(),
          z.null(),
          z.object({
            equals: z.union([z.coerce.date(), z.null()]).optional(),
            not: z.union([z.coerce.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      lastRun: z
        .union([
          z.coerce.date(),
          z.null(),
          z.object({
            equals: z.union([z.coerce.date(), z.null()]).optional(),
            not: z.union([z.coerce.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      supplier: z.any().optional(),
      category: z.any().optional(),
      order: z.any().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const orderFilters = {
  searchingFor: z.string().optional(),
  hasItems: z.boolean().optional(),
  isFromSchedule: z.boolean().optional(),
  status: z
    .array(
      z.enum(Object.values(ORDER_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status inválido' }),
      }),
    )
    .optional(),
  supplierIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  forecastRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .refine(
      data => {
        if (data.gte && data.lte) {
          return data.lte >= data.gte;
        }
        return true;
      },
      {
        message: 'Data final deve ser posterior ou igual à data inicial',
        path: ['lte'],
      },
    )
    .optional(),
};

const orderItemFilters = {
  searchingFor: z.string().optional(),
  orderIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  isReceived: z.boolean().optional(),
  quantityRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  priceRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

const orderScheduleFilters = {
  searchingFor: z.string().optional(),
  isActive: z.boolean().optional(),
  frequency: z
    .array(
      z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: 'frequência inválida' }),
      }),
    )
    .optional(),
  supplierIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  nextRunRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .refine(
      data => {
        if (data.gte && data.lte) {
          return data.lte >= data.gte;
        }
        return true;
      },
      {
        message: 'Data final deve ser posterior ou igual à data inicial',
        path: ['lte'],
      },
    )
    .optional(),
};

// =====================
// Transform Functions
// =====================

const orderTransform = (data: any) => {
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

  // Handle searchingFor - comprehensive search across order and related entities
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();

    andConditions.push({
      OR: [
        // Direct order fields
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { notes: { contains: searchTerm, mode: 'insensitive' } },

        // Supplier search
        { supplier: { fantasyName: { contains: searchTerm, mode: 'insensitive' } } },
        { supplier: { corporateName: { contains: searchTerm, mode: 'insensitive' } } },

        // Search by item name through order items
        { items: { some: { item: { name: { contains: searchTerm, mode: 'insensitive' } } } } },

        // Search by item brand through order items
        {
          items: {
            some: { item: { brand: { name: { contains: searchTerm, mode: 'insensitive' } } } },
          },
        },

        // Search by item category through order items
        {
          items: {
            some: { item: { category: { name: { contains: searchTerm, mode: 'insensitive' } } } },
          },
        },
      ],
    });
    delete data.searchingFor;
  }

  // Handle hasItems filter
  if (typeof data.hasItems === 'boolean') {
    if (data.hasItems) {
      andConditions.push({ items: { some: {} } });
    } else {
      andConditions.push({ items: { none: {} } });
    }
    delete data.hasItems;
  }

  // Handle isFromSchedule filter
  if (typeof data.isFromSchedule === 'boolean') {
    if (data.isFromSchedule) {
      andConditions.push({ orderScheduleId: { not: null } });
    } else {
      andConditions.push({ orderScheduleId: null });
    }
    delete data.isFromSchedule;
  }

  // Handle status filter
  if (data.status && Array.isArray(data.status) && data.status.length > 0) {
    andConditions.push({ status: { in: data.status } });
    delete data.status;
  }

  // Handle supplierIds filter
  if (data.supplierIds && Array.isArray(data.supplierIds) && data.supplierIds.length > 0) {
    andConditions.push({ supplierId: { in: data.supplierIds } });
    delete data.supplierIds;
  }

  // Handle itemIds filter - search for orders containing specific items
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ items: { some: { itemId: { in: data.itemIds } } } });
    delete data.itemIds;
  }

  // Handle forecastRange filter
  if (data.forecastRange && typeof data.forecastRange === 'object') {
    const forecastCondition: any = {};
    if (data.forecastRange.gte) {
      const fromDate =
        data.forecastRange.gte instanceof Date
          ? data.forecastRange.gte
          : new Date(data.forecastRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      forecastCondition.gte = fromDate;
    }
    if (data.forecastRange.lte) {
      const toDate =
        data.forecastRange.lte instanceof Date
          ? data.forecastRange.lte
          : new Date(data.forecastRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      forecastCondition.lte = toDate;
    }
    if (Object.keys(forecastCondition).length > 0) {
      andConditions.push({ forecast: forecastCondition });
    }
    delete data.forecastRange;
  }

  // Handle date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

const orderItemTransform = (data: any) => {
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

  // Handle searchingFor
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      item: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
    });
    delete data.searchingFor;
  }

  // Handle orderIds filter
  if (data.orderIds && Array.isArray(data.orderIds) && data.orderIds.length > 0) {
    andConditions.push({ orderId: { in: data.orderIds } });
    delete data.orderIds;
  }

  // Handle itemIds filter
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  // Handle isReceived filter
  if (typeof data.isReceived === 'boolean') {
    if (data.isReceived) {
      andConditions.push({ receivedAt: { not: null } });
    } else {
      andConditions.push({ receivedAt: null });
    }
    delete data.isReceived;
  }

  // Handle quantityRange filter
  if (data.quantityRange && typeof data.quantityRange === 'object') {
    const quantityCondition: any = {};
    if (typeof data.quantityRange.min === 'number') quantityCondition.gte = data.quantityRange.min;
    if (typeof data.quantityRange.max === 'number') quantityCondition.lte = data.quantityRange.max;
    if (Object.keys(quantityCondition).length > 0) {
      andConditions.push({ orderedQuantity: quantityCondition });
    }
    delete data.quantityRange;
  }

  // Handle priceRange filter
  if (data.priceRange && typeof data.priceRange === 'object') {
    const priceCondition: any = {};
    if (typeof data.priceRange.min === 'number') priceCondition.gte = data.priceRange.min;
    if (typeof data.priceRange.max === 'number') priceCondition.lte = data.priceRange.max;
    if (Object.keys(priceCondition).length > 0) {
      andConditions.push({ price: priceCondition });
    }
    delete data.priceRange;
  }

  // Handle date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

const orderScheduleTransform = (data: any) => {
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

  // Handle searchingFor
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      OR: [
        { supplier: { fantasyName: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
        { category: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
      ],
    });
    delete data.searchingFor;
  }

  // Handle isActive filter
  if (typeof data.isActive === 'boolean') {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  // Handle frequency filter
  if (data.frequency && Array.isArray(data.frequency) && data.frequency.length > 0) {
    andConditions.push({ frequency: { in: data.frequency } });
    delete data.frequency;
  }

  // Handle supplierIds filter
  if (data.supplierIds && Array.isArray(data.supplierIds) && data.supplierIds.length > 0) {
    andConditions.push({ supplierId: { in: data.supplierIds } });
    delete data.supplierIds;
  }

  // Handle categoryIds filter
  if (data.categoryIds && Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
    andConditions.push({ categoryId: { in: data.categoryIds } });
    delete data.categoryIds;
  }

  // Handle nextRunRange filter
  if (data.nextRunRange && typeof data.nextRunRange === 'object') {
    const nextRunCondition: any = {};
    if (data.nextRunRange.gte) {
      const fromDate =
        data.nextRunRange.gte instanceof Date
          ? data.nextRunRange.gte
          : new Date(data.nextRunRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      nextRunCondition.gte = fromDate;
    }
    if (data.nextRunRange.lte) {
      const toDate =
        data.nextRunRange.lte instanceof Date
          ? data.nextRunRange.lte
          : new Date(data.nextRunRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      nextRunCondition.lte = toDate;
    }
    if (Object.keys(nextRunCondition).length > 0) {
      andConditions.push({ nextRun: nextRunCondition });
    }
    delete data.nextRunRange;
  }

  // Handle date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schemas
// =====================

export const orderGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses with proper validation
    where: orderWhereSchema.optional(),
    orderBy: orderOrderBySchema.optional(),
    include: orderIncludeSchema.optional(),

    // Date filters (handled by where schema)
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

    // Convenience filters (will be transformed to where)
    ...orderFilters,
  })
  .transform(orderTransform);

export const orderItemGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses with proper validation
    where: orderItemWhereSchema.optional(),
    orderBy: orderItemOrderBySchema.optional(),
    include: orderItemIncludeSchema.optional(),

    // Date filters (handled by where schema)
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

    // Convenience filters (will be transformed to where)
    ...orderItemFilters,
  })
  .transform(orderItemTransform);

export const orderScheduleGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses with proper validation
    where: orderScheduleWhereSchema.optional(),
    orderBy: orderScheduleOrderBySchema.optional(),
    include: orderScheduleIncludeSchema.optional(),

    // Date filters (handled by where schema)
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

    // Convenience filters (will be transformed to where)
    ...orderScheduleFilters,
  })
  .transform(orderScheduleTransform);

// =====================
// Get By ID Schemas
// =====================

export const orderGetByIdSchema = z.object({
  include: orderIncludeSchema.optional(),
});

export const orderItemGetByIdSchema = z.object({
  include: orderItemIncludeSchema.optional(),
});

export const orderScheduleGetByIdSchema = z.object({
  include: orderScheduleIncludeSchema.optional(),
});

// =====================
// CRUD Schemas - Order
// =====================

const toFormData = <T>(data: T) => data;

export const orderCreateSchema = z
  .object({
    description: z
      .string({
        required_error: 'Descrição é obrigatória',
      })
      .min(1, 'Descrição é obrigatória')
      .max(500, 'Descrição deve ter no máximo 500 caracteres'),
    forecast: z.coerce
      .date({ invalid_type_error: 'Data de previsão inválida' })
      .nullable()
      .optional(),
    status: z
      .enum(Object.values(ORDER_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'Status inválido' }),
      })
      .default(ORDER_STATUS.CREATED),
    supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).optional(),
    orderScheduleId: z.string().uuid({ message: 'Cronograma inválido' }).optional(),
    orderRuleId: z.string().uuid({ message: 'Regra de pedido inválida' }).optional(),
    ppeScheduleId: z.string().uuid({ message: 'Agendamento EPI inválido' }).optional(),
    notes: z.string().optional(),
    // Payment fields
    paymentMethod: z
      .enum(Object.values(PAYMENT_METHOD) as [string, ...string[]], {
        errorMap: () => ({ message: 'Método de pagamento inválido' }),
      })
      .nullable()
      .optional(),
    paymentPix: z.string().max(100, 'Chave Pix deve ter no máximo 100 caracteres').nullable().optional(),
    paymentDueDays: z
      .number()
      .int('Prazo de vencimento deve ser um número inteiro')
      .positive('Prazo de vencimento deve ser positivo')
      .nullable()
      .optional(),
    // File arrays
    budgetIds: z.array(z.string().uuid('Orçamento inválido')).optional(),
    invoiceIds: z.array(z.string().uuid('NFe inválida')).optional(),
    receiptIds: z.array(z.string().uuid('Recibo inválido')).optional(),
    reimbursementIds: z.array(z.string().uuid('Reimbursement inválido')).optional(),
    reimbursementInvoiceIds: z.array(z.string().uuid('NFe de reimbursement inválida')).optional(),
    items: z
      .array(
        z
          .object({
            itemId: z.string().uuid({ message: 'Item inválido' }).optional(),
            temporaryItemDescription: z
              .string()
              .min(1, 'Descrição do item temporário é obrigatória')
              .max(500, 'Descrição muito longa')
              .optional(),
            orderedQuantity: z.number().positive('Quantidade deve ser positiva'),
            price: moneySchema,
            icms: z
              .number()
              .min(0, 'ICMS deve ser maior ou igual a 0')
              .max(100, 'ICMS deve ser menor ou igual a 100')
              .transform(val => Math.round(val * 100) / 100)
              .default(0),
            ipi: z
              .number()
              .min(0, 'IPI deve ser maior ou igual a 0')
              .max(100, 'IPI deve ser menor ou igual a 100')
              .transform(val => Math.round(val * 100) / 100)
              .default(0),
          })
          .superRefine((data, ctx) => {
            // Either itemId or temporaryItemDescription must be provided, but not both
            if (!data.itemId && !data.temporaryItemDescription) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Item de estoque ou descrição de item temporário deve ser fornecido',
                path: ['itemId'],
              });
            }
            if (data.itemId && data.temporaryItemDescription) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  'Não é possível fornecer item de estoque e descrição de item temporário ao mesmo tempo',
                path: ['itemId'],
              });
            }
          }),
      )
      .refine(
        items => {
          // Check for duplicate inventory items (ignore temporary items)
          const itemIds = items.filter(item => item.itemId).map(item => item.itemId);
          return new Set(itemIds).size === itemIds.length;
        },
        {
          message: 'Lista não pode conter itens de estoque duplicados',
        },
      )
      .optional(),
  })
  .transform(toFormData);

export const orderUpdateSchema = z
  .object({
    description: z.string().min(1).max(500).optional(),
    forecast: z.coerce.date({ invalid_type_error: 'Data de previsão inválida' }).nullable().optional(),
    status: z
      .enum(Object.values(ORDER_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'Status inválido' }),
      })
      .optional(),
    supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).optional(),
    orderScheduleId: z.string().uuid({ message: 'Cronograma inválido' }).optional(),
    orderRuleId: z.string().uuid({ message: 'Regra de pedido inválida' }).optional(),
    ppeScheduleId: z.string().uuid({ message: 'Agendamento EPI inválido' }).optional(),
    notes: z.string().optional(),
    // Payment fields
    paymentMethod: z
      .enum(Object.values(PAYMENT_METHOD) as [string, ...string[]], {
        errorMap: () => ({ message: 'Método de pagamento inválido' }),
      })
      .nullable()
      .optional(),
    paymentPix: z.string().max(100, 'Chave Pix deve ter no máximo 100 caracteres').nullable().optional(),
    paymentDueDays: z
      .number()
      .int('Prazo de vencimento deve ser um número inteiro')
      .positive('Prazo de vencimento deve ser positivo')
      .nullable()
      .optional(),
    // File arrays
    budgetIds: z.array(z.string().uuid('Orçamento inválido')).optional(),
    invoiceIds: z.array(z.string().uuid('NFe inválida')).optional(),
    receiptIds: z.array(z.string().uuid('Recibo inválido')).optional(),
    reimbursementIds: z.array(z.string().uuid('Reimbursement inválido')).optional(),
    reimbursementInvoiceIds: z.array(z.string().uuid('NFe de reimbursement inválida')).optional(),
    // Items array for updating order items
    items: z
      .array(
        z
          .object({
            itemId: z.string().uuid({ message: 'Item inválido' }).optional(),
            temporaryItemDescription: z
              .string()
              .min(1, 'Descrição do item temporário é obrigatória')
              .max(500, 'Descrição muito longa')
              .optional(),
            orderedQuantity: z.number().positive('Quantidade deve ser positiva'),
            price: moneySchema,
            icms: z
              .number()
              .min(0, 'ICMS deve ser maior ou igual a 0')
              .max(100, 'ICMS deve ser menor ou igual a 100')
              .transform(val => Math.round(val * 100) / 100)
              .default(0),
            ipi: z
              .number()
              .min(0, 'IPI deve ser maior ou igual a 0')
              .max(100, 'IPI deve ser menor ou igual a 100')
              .transform(val => Math.round(val * 100) / 100)
              .default(0),
          })
          .superRefine((data, ctx) => {
            // Either itemId or temporaryItemDescription must be provided, but not both
            if (!data.itemId && !data.temporaryItemDescription) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Item de estoque ou descrição de item temporário deve ser fornecido',
                path: ['itemId'],
              });
            }
            if (data.itemId && data.temporaryItemDescription) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  'Não é possível fornecer item de estoque e descrição de item temporário ao mesmo tempo',
                path: ['itemId'],
              });
            }
          }),
      )
      .refine(
        items => {
          // Check for duplicate inventory items (ignore temporary items)
          const itemIds = items.filter(item => item.itemId).map(item => item.itemId);
          return new Set(itemIds).size === itemIds.length;
        },
        {
          message: 'Lista não pode conter itens de estoque duplicados',
        },
      )
      .optional(),
  })
  .transform(toFormData);

// =====================
// CRUD Schemas - OrderItem
// =====================

export const orderItemCreateSchema = z
  .object({
    orderId: z.string().uuid({ message: 'Pedido inválido' }),
    itemId: z.string().uuid({ message: 'Item inválido' }).optional(),
    temporaryItemDescription: z
      .string()
      .min(1, 'Descrição do item temporário é obrigatória')
      .max(500, 'Descrição muito longa')
      .optional(),
    orderedQuantity: z.number().positive('Quantidade deve ser positiva'),
    price: moneySchema,
    icms: z
      .number()
      .min(0, 'ICMS deve ser maior ou igual a 0')
      .max(100, 'ICMS deve ser menor ou igual a 100')
      .transform(val => Math.round(val * 100) / 100)
      .default(0),
    ipi: z
      .number()
      .min(0, 'IPI deve ser maior ou igual a 0')
      .max(100, 'IPI deve ser menor ou igual a 100')
      .transform(val => Math.round(val * 100) / 100)
      .default(0),
  })
  .superRefine((data, ctx) => {
    // Either itemId or temporaryItemDescription must be provided, but not both
    if (!data.itemId && !data.temporaryItemDescription) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Item de estoque ou descrição de item temporário deve ser fornecido',
        path: ['itemId'],
      });
    }
    if (data.itemId && data.temporaryItemDescription) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Não é possível fornecer item de estoque e descrição de item temporário ao mesmo tempo',
        path: ['itemId'],
      });
    }
  })
  .transform(toFormData);

export const orderItemUpdateSchema = z
  .object({
    temporaryItemDescription: z
      .string()
      .min(1, 'Descrição do item temporário é obrigatória')
      .max(500, 'Descrição muito longa')
      .optional(),
    orderedQuantity: z.number().positive('Quantidade deve ser positiva').optional(),
    receivedQuantity: z.number().min(0, 'Quantidade recebida deve ser não negativa').optional(),
    price: moneySchema.optional(),
    icms: z
      .number()
      .min(0, 'ICMS deve ser maior ou igual a 0')
      .max(100, 'ICMS deve ser menor ou igual a 100')
      .transform(val => Math.round(val * 100) / 100)
      .optional(),
    ipi: z
      .number()
      .min(0, 'IPI deve ser maior ou igual a 0')
      .max(100, 'IPI deve ser menor ou igual a 100')
      .transform(val => Math.round(val * 100) / 100)
      .optional(),
    receivedAt: z.coerce.date().optional(),
    fulfilledAt: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    // If both orderedQuantity and receivedQuantity are present, validate the relationship
    if (data.orderedQuantity !== undefined && data.receivedQuantity !== undefined) {
      if (data.receivedQuantity > data.orderedQuantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantidade recebida não pode exceder quantidade pedida',
          path: ['receivedQuantity'],
        });
      }
    }
  })
  .transform(toFormData);

// =====================
// CRUD Schemas - OrderSchedule
// =====================

export const weeklyScheduleSchema = z
  .object({
    monday: z.boolean().default(false),
    tuesday: z.boolean().default(false),
    wednesday: z.boolean().default(false),
    thursday: z.boolean().default(false),
    friday: z.boolean().default(false),
    saturday: z.boolean().default(false),
    sunday: z.boolean().default(false),
  })
  .refine(
    data => {
      // At least one day must be selected
      return (
        data.monday ||
        data.tuesday ||
        data.wednesday ||
        data.thursday ||
        data.friday ||
        data.saturday ||
        data.sunday
      );
    },
    {
      message: 'Pelo menos um dia da semana deve ser selecionado',
    },
  );

export const monthlyScheduleSchema = z
  .object({
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    occurrence: z
      .enum(Object.values(MONTH_OCCURRENCE) as [string, ...string[]], {
        errorMap: () => ({ message: 'Ocorrência inválida' }),
      })
      .nullable()
      .optional(),
    dayOfWeek: z
      .enum(Object.values(WEEK_DAY) as [string, ...string[]], {
        errorMap: () => ({ message: 'Dia da semana inválido' }),
      })
      .nullable()
      .optional(),
  })
  .refine(
    data => {
      // Either dayOfMonth OR (occurrence + dayOfWeek) must be set
      const hasDayOfMonth = data.dayOfMonth !== null && data.dayOfMonth !== undefined;
      const hasOccurrencePattern =
        data.occurrence !== null &&
        data.occurrence !== undefined &&
        data.dayOfWeek !== null &&
        data.dayOfWeek !== undefined;
      return hasDayOfMonth || hasOccurrencePattern;
    },
    {
      message:
        'Deve especificar o dia do mês OU o padrão de ocorrência (ex: primeira segunda-feira)',
    },
  );

export const yearlyScheduleSchema = z
  .object({
    month: z.enum(Object.values(MONTH) as [string, ...string[]], {
      errorMap: () => ({ message: 'Mês inválido' }),
    }),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    occurrence: z
      .enum(Object.values(MONTH_OCCURRENCE) as [string, ...string[]], {
        errorMap: () => ({ message: 'Ocorrência inválida' }),
      })
      .nullable()
      .optional(),
    dayOfWeek: z
      .enum(Object.values(WEEK_DAY) as [string, ...string[]], {
        errorMap: () => ({ message: 'Dia da semana inválido' }),
      })
      .nullable()
      .optional(),
  })
  .refine(
    data => {
      // Either dayOfMonth OR (occurrence + dayOfWeek) must be set
      const hasDayOfMonth = data.dayOfMonth !== null && data.dayOfMonth !== undefined;
      const hasOccurrencePattern =
        data.occurrence !== null &&
        data.occurrence !== undefined &&
        data.dayOfWeek !== null &&
        data.dayOfWeek !== undefined;
      return hasDayOfMonth || hasOccurrencePattern;
    },
    {
      message:
        'Deve especificar o dia do mês OU o padrão de ocorrência (ex: primeira segunda-feira)',
    },
  );

export const orderScheduleCreateSchema = z
  .object({
    supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).optional(),
    categoryId: z.string().uuid({ message: 'Categoria inválida' }).optional(),
    frequency: z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
      errorMap: () => ({ message: 'Frequência inválida' }),
    }),
    frequencyCount: z
      .number()
      .int()
      .positive('Contagem de frequência deve ser positiva')
      .default(1),
    isActive: z.boolean().default(true),
    items: z
      .array(z.string().uuid({ message: 'Item inválido' }))
      .min(1, 'Deve incluir pelo menos um item'),
    weeklySchedule: weeklyScheduleSchema.optional(),
    monthlySchedule: monthlyScheduleSchema.optional(),
    yearlySchedule: yearlyScheduleSchema.optional(),
  })
  .refine(
    data => {
      // Validate that appropriate schedule config is provided based on frequency
      switch (data.frequency) {
        case SCHEDULE_FREQUENCY.WEEKLY:
          return data.weeklySchedule !== undefined;
        case SCHEDULE_FREQUENCY.MONTHLY:
          return data.monthlySchedule !== undefined;
        case SCHEDULE_FREQUENCY.ANNUAL:
          return data.yearlySchedule !== undefined;
        case SCHEDULE_FREQUENCY.ONCE:
          return true; // No specific schedule needed
        default:
          return false;
      }
    },
    {
      message: 'Configuração de agendamento necessária para a frequência selecionada',
    },
  )
  .refine(
    data => {
      // Either supplier or category must be specified
      return data.supplierId || data.categoryId;
    },
    {
      message: 'Deve especificar um fornecedor ou categoria',
    },
  )
  .transform(toFormData);

export const orderScheduleUpdateSchema = z
  .object({
    supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).optional(),
    categoryId: z.string().uuid({ message: 'Categoria inválida' }).optional(),
    frequency: z
      .enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: 'Frequência inválida' }),
      })
      .optional(),
    frequencyCount: z
      .number()
      .int()
      .positive('Contagem de frequência deve ser positiva')
      .optional(),
    isActive: z.boolean().optional(),
    items: z.array(z.string().uuid({ message: 'Item inválido' })).optional(),
    weeklySchedule: weeklyScheduleSchema.optional(),
    monthlySchedule: monthlyScheduleSchema.optional(),
    yearlySchedule: yearlyScheduleSchema.optional(),
  })
  .transform(toFormData);

// =====================
// Batch Schemas
// =====================

export const orderBatchCreateSchema = z.object({
  orders: z
    .array(orderCreateSchema)
    .min(1, 'Pelo menos um pedido deve ser fornecido')
    .max(100, 'Limite máximo de 100 pedidos por vez'),
});

export const orderBatchUpdateSchema = z.object({
  orders: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Pedido inválido' }),
        data: orderUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um pedido deve ser fornecido')
    .max(100, 'Limite máximo de 100 pedidos por vez'),
});

export const orderBatchDeleteSchema = z.object({
  orderIds: z
    .array(z.string().uuid({ message: 'Pedido inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido')
    .max(100, 'Limite máximo de 100 pedidos por vez'),
});

// Query schema for include parameter
export const orderQuerySchema = z.object({
  include: orderIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const orderBatchQuerySchema = z.object({
  include: orderIncludeSchema.optional(),
});

export const orderItemBatchCreateSchema = z.object({
  orderItems: z
    .array(orderItemCreateSchema)
    .min(1, 'Pelo menos um item de pedido deve ser fornecido')
    .max(100, 'Limite máximo de 100 itens por vez'),
});

export const orderItemBatchUpdateSchema = z.object({
  orderItems: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Item inválido' }),
        data: orderItemUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um item de pedido deve ser fornecido')
    .max(100, 'Limite máximo de 100 itens por vez'),
});

export const orderItemBatchDeleteSchema = z.object({
  orderItemIds: z
    .array(z.string().uuid({ message: 'Item inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido')
    .max(100, 'Limite máximo de 100 itens por vez'),
});

// Query schema for include parameter
export const orderItemQuerySchema = z.object({
  include: orderItemIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const orderItemBatchQuerySchema = z.object({
  include: orderItemIncludeSchema.optional(),
});

export const orderScheduleBatchCreateSchema = z.object({
  orderSchedules: z
    .array(orderScheduleCreateSchema)
    .min(1, 'Pelo menos um agendamento de pedido deve ser fornecido')
    .max(100, 'Limite máximo de 100 agendamentos por vez'),
});

export const orderScheduleBatchUpdateSchema = z.object({
  orderSchedules: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Cronograma inválido' }),
        data: orderScheduleUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um agendamento de pedido deve ser fornecido')
    .max(100, 'Limite máximo de 100 agendamentos por vez'),
});

export const orderScheduleBatchDeleteSchema = z.object({
  orderScheduleIds: z
    .array(z.string().uuid({ message: 'Cronograma inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido')
    .max(100, 'Limite máximo de 100 agendamentos por vez'),
});

// Query schema for include parameter
export const orderScheduleQuerySchema = z.object({
  include: orderScheduleIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const orderScheduleBatchQuerySchema = z.object({
  include: orderScheduleIncludeSchema.optional(),
});

// =====================
// Type Exports
// =====================

// Order types
export type OrderGetManyFormData = z.infer<typeof orderGetManySchema>;
export type OrderGetByIdFormData = z.infer<typeof orderGetByIdSchema>;
export type OrderQueryFormData = z.infer<typeof orderQuerySchema>;
export type OrderBatchQueryFormData = z.infer<typeof orderBatchQuerySchema>;

export type OrderCreateFormData = z.infer<typeof orderCreateSchema>;
export type OrderUpdateFormData = z.infer<typeof orderUpdateSchema>;

export type OrderBatchCreateFormData = z.infer<typeof orderBatchCreateSchema>;
export type OrderBatchUpdateFormData = z.infer<typeof orderBatchUpdateSchema>;
export type OrderBatchDeleteFormData = z.infer<typeof orderBatchDeleteSchema>;

export type OrderInclude = z.infer<typeof orderIncludeSchema>;
export type OrderOrderBy = z.infer<typeof orderOrderBySchema>;
export type OrderWhere = z.infer<typeof orderWhereSchema>;

// OrderItem types
export type OrderItemGetManyFormData = z.infer<typeof orderItemGetManySchema>;
export type OrderItemGetByIdFormData = z.infer<typeof orderItemGetByIdSchema>;
export type OrderItemQueryFormData = z.infer<typeof orderItemQuerySchema>;
export type OrderItemBatchQueryFormData = z.infer<typeof orderItemBatchQuerySchema>;

export type OrderItemCreateFormData = z.infer<typeof orderItemCreateSchema>;
export type OrderItemUpdateFormData = z.infer<typeof orderItemUpdateSchema>;

export type OrderItemBatchCreateFormData = z.infer<typeof orderItemBatchCreateSchema>;
export type OrderItemBatchUpdateFormData = z.infer<typeof orderItemBatchUpdateSchema>;
export type OrderItemBatchDeleteFormData = z.infer<typeof orderItemBatchDeleteSchema>;

export type OrderItemInclude = z.infer<typeof orderItemIncludeSchema>;
export type OrderItemOrderBy = z.infer<typeof orderItemOrderBySchema>;
export type OrderItemWhere = z.infer<typeof orderItemWhereSchema>;

// OrderSchedule types
export type OrderScheduleGetManyFormData = z.infer<typeof orderScheduleGetManySchema>;
export type OrderScheduleGetByIdFormData = z.infer<typeof orderScheduleGetByIdSchema>;
export type OrderScheduleQueryFormData = z.infer<typeof orderScheduleQuerySchema>;
export type OrderScheduleBatchQueryFormData = z.infer<typeof orderScheduleBatchQuerySchema>;

export type OrderScheduleCreateFormData = z.infer<typeof orderScheduleCreateSchema>;
export type OrderScheduleUpdateFormData = z.infer<typeof orderScheduleUpdateSchema>;

export type OrderScheduleBatchCreateFormData = z.infer<typeof orderScheduleBatchCreateSchema>;
export type OrderScheduleBatchUpdateFormData = z.infer<typeof orderScheduleBatchUpdateSchema>;
export type OrderScheduleBatchDeleteFormData = z.infer<typeof orderScheduleBatchDeleteSchema>;

export type OrderScheduleInclude = z.infer<typeof orderScheduleIncludeSchema>;
export type OrderScheduleOrderBy = z.infer<typeof orderScheduleOrderBySchema>;
export type OrderScheduleWhere = z.infer<typeof orderScheduleWhereSchema>;

// Weekly/Monthly/Yearly Schedule types
export type WeeklyScheduleFormData = z.infer<typeof weeklyScheduleSchema>;
export type MonthlyScheduleFormData = z.infer<typeof monthlyScheduleSchema>;
export type YearlyScheduleFormData = z.infer<typeof yearlyScheduleSchema>;

// =====================
// FormData Helpers
// =====================

export const mapOrderToFormData = createMapToFormDataHelper<Order, OrderUpdateFormData>(order => ({
  description: order.description,
  forecast: order.forecast || undefined,
  status: order.status as ORDER_STATUS,
  supplierId: order.supplierId || undefined,
  orderScheduleId: order.orderScheduleId || undefined,
  budgetIds: order.budgets?.map(budget => budget.id),
  invoiceIds: order.invoices?.map(invoice => invoice.id),
  receiptIds: order.receipts?.map(receipt => receipt.id),
  reimbursementIds: order.reimbursements?.map(reimbursement => reimbursement.id),
  reimbursementInvoiceIds: order.invoiceReimbursements?.map(
    reimbursementInvoice => reimbursementInvoice.id,
  ),
  notes: order.notes || undefined,
}));

export const mapOrderItemToFormData = createMapToFormDataHelper<OrderItem, OrderItemUpdateFormData>(
  orderItem => ({
    orderedQuantity: orderItem.orderedQuantity,
    receivedQuantity: orderItem.receivedQuantity,
    price: orderItem.price,
    icms: orderItem.icms,
    ipi: orderItem.ipi,
    receivedAt: orderItem.receivedAt || undefined,
  }),
);

export const mapOrderScheduleToFormData = createMapToFormDataHelper<
  OrderSchedule,
  OrderScheduleUpdateFormData
>(schedule => ({
  frequency: schedule.frequency as SCHEDULE_FREQUENCY,
  frequencyCount: schedule.frequencyCount,
  isActive: schedule.isActive,
  items: schedule.items,
}));
