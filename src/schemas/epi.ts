// packages/schemas/src/epi.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  dateRangeSchema,
} from './common';
import type { PpeSize, PpeDelivery } from '@types';
import {
  PPE_DELIVERY_STATUS,
  SCHEDULE_FREQUENCY,
  WEEK_DAY,
  MONTH,
  PANTS_SIZE,
  SHIRT_SIZE,
  BOOT_SIZE,
  PPE_TYPE,
  MASK_SIZE,
  SLEEVES_SIZE,
  GLOVES_SIZE,
  RAIN_BOOTS_SIZE,
  ASSIGNMENT_TYPE,
  RESCHEDULE_REASON,
} from '@constants';
import { PPE_DELIVERY_STATUS_ORDER } from '@constants';

// =====================
// PPE SIZE SCHEMAS
// =====================

// Include Schema
export const ppeSizeIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              notifications: z.boolean().optional(),
              tasks: z.boolean().optional(),
              vacations: z.boolean().optional(),
              commissions: z.boolean().optional(),
              warningsCollaborator: z.boolean().optional(),
              warningsSupervisor: z.boolean().optional(),
              warningsWitness: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              ppeDeliveredBy: z.boolean().optional(),
              ppeDeliverySchedules: z.boolean().optional(),
              changeLogs: z.boolean().optional(),
              seenNotifications: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// OrderBy Schema
export const ppeSizeOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        shirts: orderByDirectionSchema.optional(),
        boots: orderByDirectionSchema.optional(),
        pants: orderByDirectionSchema.optional(),
        sleeves: orderByDirectionSchema.optional(),
        mask: orderByDirectionSchema.optional(),
        gloves: orderByDirectionSchema.optional(),
        rainBoots: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        user: z
          .object({
            id: orderByDirectionSchema.optional(),
            email: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            status: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          shirts: orderByDirectionSchema.optional(),
          boots: orderByDirectionSchema.optional(),
          pants: orderByDirectionSchema.optional(),
          sleeves: orderByDirectionSchema.optional(),
          mask: orderByDirectionSchema.optional(),
          userId: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// Where Schema
export const ppeSizeWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.array(z.lazy(() => ppeSizeWhereSchema)).optional(),
    OR: z.array(z.lazy(() => ppeSizeWhereSchema)).optional(),
    NOT: z.lazy(() => ppeSizeWhereSchema).optional(),

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

    shirts: z
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
          mode: z.enum(['default', 'insensitive']).optional(),
        }),
      ])
      .optional(),

    boots: z
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
          mode: z.enum(['default', 'insensitive']).optional(),
        }),
      ])
      .optional(),

    pants: z
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
          mode: z.enum(['default', 'insensitive']).optional(),
        }),
      ])
      .optional(),

    sleeves: z
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
          mode: z.enum(['default', 'insensitive']).optional(),
        }),
      ])
      .optional(),

    mask: z
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
          mode: z.enum(['default', 'insensitive']).optional(),
        }),
      ])
      .optional(),

    gloves: z
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
          mode: z.enum(['default', 'insensitive']).optional(),
        }),
      ])
      .optional(),

    rainBoots: z
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
          mode: z.enum(['default', 'insensitive']).optional(),
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
const ppeSizeFilters = {
  userIds: z.array(z.string()).optional(),
  hasAllSizes: z.boolean().optional(),
  searchingFor: z.string().optional(),
};

// Transform function
const ppeSizeTransform = (data: any) => {
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

  if (data.userIds?.length) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.hasAllSizes !== undefined) {
    if (data.hasAllSizes) {
      andConditions.push({
        AND: [
          { shirts: { not: null } },
          { boots: { not: null } },
          { pants: { not: null } },
          { sleeves: { not: null } },
          { mask: { not: null } },
        ],
      });
    } else {
      andConditions.push({
        OR: [{ shirts: null }, { boots: null }, { pants: null }, { sleeves: null }, { mask: null }],
      });
    }
    delete data.hasAllSizes;
  }

  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { user: { name: { contains: data.searchingFor, mode: 'insensitive' } } },
        { user: { email: { contains: data.searchingFor, mode: 'insensitive' } } },
      ],
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
export const ppeSizeGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    where: ppeSizeWhereSchema.optional(),
    orderBy: ppeSizeOrderBySchema.optional(),
    include: ppeSizeIncludeSchema.optional(),
    ...ppeSizeFilters,
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
  .transform(ppeSizeTransform);

// CRUD Schemas
export const ppeSizeCreateSchema = z.object({
  shirts: z
    .nativeEnum(SHIRT_SIZE, {
      errorMap: () => ({ message: 'Tamanho da camisa inválido' }),
    })
    .nullable()
    .optional(),
  boots: z
    .nativeEnum(BOOT_SIZE, {
      errorMap: () => ({ message: 'Tamanho da bota inválido' }),
    })
    .nullable()
    .optional(),
  pants: z
    .nativeEnum(PANTS_SIZE, {
      errorMap: () => ({ message: 'Tamanho da calça inválido' }),
    })
    .nullable()
    .optional(),
  sleeves: z
    .nativeEnum(SLEEVES_SIZE, {
      errorMap: () => ({ message: 'Tamanho da manga inválido' }),
    })
    .nullable()
    .optional(),
  mask: z
    .nativeEnum(MASK_SIZE, {
      errorMap: () => ({ message: 'Tamanho da máscara inválido' }),
    })
    .nullable()
    .optional(),
  gloves: z
    .nativeEnum(GLOVES_SIZE, {
      errorMap: () => ({ message: 'Tamanho das luvas inválido' }),
    })
    .nullable()
    .optional(),
  rainBoots: z
    .nativeEnum(RAIN_BOOTS_SIZE, {
      errorMap: () => ({ message: 'Tamanho da galocha inválido' }),
    })
    .nullable()
    .optional(),
  userId: z.string().uuid('Usuário inválido'),
});

export const ppeSizeUpdateSchema = z.object({
  shirts: z
    .nativeEnum(SHIRT_SIZE, {
      errorMap: () => ({ message: 'Tamanho da camisa inválido' }),
    })
    .nullable()
    .optional(),
  boots: z
    .nativeEnum(BOOT_SIZE, {
      errorMap: () => ({ message: 'Tamanho da bota inválido' }),
    })
    .nullable()
    .optional(),
  pants: z
    .nativeEnum(PANTS_SIZE, {
      errorMap: () => ({ message: 'Tamanho da calça inválido' }),
    })
    .nullable()
    .optional(),
  sleeves: z
    .nativeEnum(SLEEVES_SIZE, {
      errorMap: () => ({ message: 'Tamanho da manga inválido' }),
    })
    .nullable()
    .optional(),
  mask: z
    .nativeEnum(MASK_SIZE, {
      errorMap: () => ({ message: 'Tamanho da máscara inválido' }),
    })
    .nullable()
    .optional(),
  gloves: z
    .nativeEnum(GLOVES_SIZE, {
      errorMap: () => ({ message: 'Tamanho das luvas inválido' }),
    })
    .nullable()
    .optional(),
  rainBoots: z
    .nativeEnum(RAIN_BOOTS_SIZE, {
      errorMap: () => ({ message: 'Tamanho da galocha inválido' }),
    })
    .nullable()
    .optional(),
});

// Batch Schemas
export const ppeSizeBatchCreateSchema = z.object({
  ppeSizes: z.array(ppeSizeCreateSchema),
});

export const ppeSizeBatchUpdateSchema = z.object({
  ppeSizes: z
    .array(
      z.object({
        id: z.string().uuid('Tamanho de PPE inválido'),
        data: ppeSizeUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um tamanho de PPE deve ser fornecido'),
});

export const ppeSizeBatchDeleteSchema = z.object({
  ppeSizeIds: z
    .array(z.string().uuid('Tamanho de PPE inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const ppeSizeQuerySchema = z.object({
  include: ppeSizeIncludeSchema.optional(),
});

// GetById Schema
export const ppeSizeGetByIdSchema = z.object({
  include: ppeSizeIncludeSchema.optional(),
  id: z.string().uuid('PPE inválido'),
});

// =====================
// PPE DELIVERY SCHEMAS
// =====================

// Include Schema
export const ppeDeliveryIncludeSchema = z
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
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              orderItems: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              ppeDeliverySchedules: z.boolean().optional(),
              relatedItems: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
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
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    reviewedByUser: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    ppeSchedule: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z.boolean().optional(),
              user: z.boolean().optional(),
              category: z.boolean().optional(),
              weeklyConfig: z.boolean().optional(),
              monthlyConfig: z.boolean().optional(),
              yearlyConfig: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// OrderBy Schema
export const ppeDeliveryOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        itemId: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        quantity: orderByDirectionSchema.optional(),
        reviewedBy: orderByDirectionSchema.optional(),
        scheduledDate: orderByDirectionSchema.optional(),
        actualDeliveryDate: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          quantity: orderByDirectionSchema.optional(),
          scheduledDate: orderByDirectionSchema.optional(),
          actualDeliveryDate: orderByDirectionSchema.optional(),
          finishedAt: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          statusOrder: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// Where Schema
export const ppeDeliveryWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.array(z.lazy(() => ppeDeliveryWhereSchema)).optional(),
    OR: z.array(z.lazy(() => ppeDeliveryWhereSchema)).optional(),
    NOT: z.lazy(() => ppeDeliveryWhereSchema).optional(),

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

    reviewedBy: z
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

    ppeScheduleId: z
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

    quantity: z
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

    scheduledDate: z
      .union([
        z.date().nullable(),
        z.object({
          equals: z.date().nullable().optional(),
          not: z.date().nullable().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    actualDeliveryDate: z
      .union([
        z.date().nullable(),
        z.object({
          equals: z.date().nullable().optional(),
          not: z.date().nullable().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    finishedAt: z
      .union([
        z.date().nullable(),
        z.object({
          equals: z.date().nullable().optional(),
          not: z.date().nullable().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    status: z
      .union([
        z.enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]]),
        z.object({
          equals: z.enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]]).optional(),
          not: z.enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]]).optional(),
          in: z
            .array(z.enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]]))
            .optional(),
          notIn: z
            .array(z.enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]]))
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
const ppeDeliveryFilters = {
  itemIds: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  reviewedByIds: z.array(z.string()).optional(),
  ppeScheduleIds: z.array(z.string()).optional(),
  isDelivered: z.boolean().optional(),
  isScheduled: z.boolean().optional(),
  isPending: z.boolean().optional(),
  isApproved: z.boolean().optional(),
  isCancelled: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
  searchingFor: z.string().optional(),
  status: z
    .array(
      z.enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'Status inválido' }),
      }),
    )
    .optional(),
  statusOrder: z.number().optional(),
  scheduledDateRange: dateRangeSchema.optional(),
  actualDeliveryDateRange: dateRangeSchema.optional(),
  finishedAtRange: dateRangeSchema.optional(),
  createdAtRange: dateRangeSchema.optional(),
};

// Transform function
const ppeDeliveryTransform = (data: any) => {
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

  if (data.itemIds?.length) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.userIds?.length) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.reviewedByIds?.length) {
    andConditions.push({ reviewedBy: { in: data.reviewedByIds } });
    delete data.reviewedByIds;
  }

  if (data.ppeScheduleIds?.length) {
    andConditions.push({ ppeScheduleId: { in: data.ppeScheduleIds } });
    delete data.ppeScheduleIds;
  }

  if (data.isDelivered !== undefined) {
    andConditions.push({
      actualDeliveryDate: data.isDelivered ? { not: null } : null,
    });
    delete data.isDelivered;
  }

  if (data.isScheduled !== undefined) {
    andConditions.push({
      scheduledDate: data.isScheduled ? { not: null } : null,
    });
    delete data.isScheduled;
  }

  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { user: { name: { contains: data.searchingFor, mode: 'insensitive' } } },
        { item: { name: { contains: data.searchingFor, mode: 'insensitive' } } },
      ],
    });
    delete data.searchingFor;
  }

  // Handle status filter
  if (data.status && Array.isArray(data.status) && data.status.length > 0) {
    andConditions.push({ status: { in: data.status } });
    delete data.status;
  }

  // Handle status-based boolean filters
  if (data.isPending === true) {
    andConditions.push({ status: PPE_DELIVERY_STATUS.PENDING });
    delete data.isPending;
  }

  if (data.isApproved === true) {
    andConditions.push({ status: PPE_DELIVERY_STATUS.APPROVED });
    delete data.isApproved;
  }

  if (data.isCancelled === true) {
    andConditions.push({ status: PPE_DELIVERY_STATUS.REPROVED });
    delete data.isCancelled;
  }

  if (data.isCompleted === true) {
    andConditions.push({ status: PPE_DELIVERY_STATUS.DELIVERED });
    delete data.isCompleted;
  }

  // Handle date range filters
  if (data.scheduledDateRange && typeof data.scheduledDateRange === 'object') {
    const scheduledDateCondition: any = {};
    if (data.scheduledDateRange.gte) {
      const fromDate =
        data.scheduledDateRange.gte instanceof Date
          ? data.scheduledDateRange.gte
          : new Date(data.scheduledDateRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      scheduledDateCondition.gte = fromDate;
    }
    if (data.scheduledDateRange.lte) {
      const toDate =
        data.scheduledDateRange.lte instanceof Date
          ? data.scheduledDateRange.lte
          : new Date(data.scheduledDateRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      scheduledDateCondition.lte = toDate;
    }
    if (Object.keys(scheduledDateCondition).length > 0) {
      andConditions.push({ scheduledDate: scheduledDateCondition });
    }
    delete data.scheduledDateRange;
  }

  if (data.actualDeliveryDateRange && typeof data.actualDeliveryDateRange === 'object') {
    const deliveryDateCondition: any = {};
    if (data.actualDeliveryDateRange.gte) {
      const fromDate =
        data.actualDeliveryDateRange.gte instanceof Date
          ? data.actualDeliveryDateRange.gte
          : new Date(data.actualDeliveryDateRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      deliveryDateCondition.gte = fromDate;
    }
    if (data.actualDeliveryDateRange.lte) {
      const toDate =
        data.actualDeliveryDateRange.lte instanceof Date
          ? data.actualDeliveryDateRange.lte
          : new Date(data.actualDeliveryDateRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      deliveryDateCondition.lte = toDate;
    }
    if (Object.keys(deliveryDateCondition).length > 0) {
      andConditions.push({ actualDeliveryDate: deliveryDateCondition });
    }
    delete data.actualDeliveryDateRange;
  }

  if (data.finishedAtRange && typeof data.finishedAtRange === 'object') {
    const finishedAtCondition: any = {};
    if (data.finishedAtRange.gte) {
      const fromDate =
        data.finishedAtRange.gte instanceof Date
          ? data.finishedAtRange.gte
          : new Date(data.finishedAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      finishedAtCondition.gte = fromDate;
    }
    if (data.finishedAtRange.lte) {
      const toDate =
        data.finishedAtRange.lte instanceof Date
          ? data.finishedAtRange.lte
          : new Date(data.finishedAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      finishedAtCondition.lte = toDate;
    }
    if (Object.keys(finishedAtCondition).length > 0) {
      andConditions.push({ finishedAt: finishedAtCondition });
    }
    delete data.finishedAtRange;
  }

  if (data.createdAtRange && typeof data.createdAtRange === 'object') {
    const createdAtCondition: any = {};
    if (data.createdAtRange.gte) {
      const fromDate =
        data.createdAtRange.gte instanceof Date
          ? data.createdAtRange.gte
          : new Date(data.createdAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      createdAtCondition.gte = fromDate;
    }
    if (data.createdAtRange.lte) {
      const toDate =
        data.createdAtRange.lte instanceof Date
          ? data.createdAtRange.lte
          : new Date(data.createdAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      createdAtCondition.lte = toDate;
    }
    if (Object.keys(createdAtCondition).length > 0) {
      andConditions.push({ createdAt: createdAtCondition });
    }
    delete data.createdAtRange;
  }

  if (data.scheduledDate) {
    andConditions.push({ scheduledDate: data.scheduledDate });
    delete data.scheduledDate;
  }

  if (data.actualDeliveryDate) {
    andConditions.push({ actualDeliveryDate: data.actualDeliveryDate });
    delete data.actualDeliveryDate;
  }

  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  if (data.status) {
    andConditions.push({ status: data.status });
    delete data.status;
  }

  if (data.statusOrder !== undefined) {
    andConditions.push({ statusOrder: data.statusOrder });
    delete data.statusOrder;
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
export const ppeDeliveryGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    where: ppeDeliveryWhereSchema.optional(),
    orderBy: ppeDeliveryOrderBySchema.optional(),
    include: ppeDeliveryIncludeSchema.optional(),
    ...ppeDeliveryFilters,
    scheduledDate: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    actualDeliveryDate: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
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
  .transform(ppeDeliveryTransform);

// CRUD Schemas
export const ppeDeliveryCreateSchema = z.object({
  userId: z.string().uuid('Usuário inválido'),
  itemId: z.string().uuid('Item inválido'),
  quantity: z.number().positive('Quantidade deve ser positiva'),
  reason: z.string().nullable().optional(),
  reviewedBy: z.string().uuid('Responsável pela revisão inválido').nullable().optional(),
  ppeScheduleId: z.string().uuid('Agendamento inválido').nullable().optional(),
  scheduledDate: z.coerce.date().nullable().optional(),
  actualDeliveryDate: z.coerce.date().nullable().optional(),
  status: z
    .enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]])
    .optional()
    .default(PPE_DELIVERY_STATUS.PENDING),
  statusOrder: z
    .number()
    .optional()
    .default(PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.PENDING]),
});

// Schema for personal PPE requests (without userId, status, statusOrder)
export const ppeDeliveryPersonalRequestSchema = z.object({
  itemId: z.string().uuid('Item inválido'),
  quantity: z.number().positive('Quantidade deve ser positiva'),
  reason: z.string().min(1, 'Justificativa é obrigatória'),
  scheduledDate: z.coerce.date().nullable().optional(),
});

export const ppeDeliveryUpdateSchema = z.object({
  itemId: z.string().uuid('Item inválido').optional(),
  quantity: z.number().positive('Quantidade deve ser positiva').optional(),
  reason: z.string().nullable().optional(),
  scheduledDate: z.coerce.date().nullable().optional(),
  actualDeliveryDate: z.coerce.date().nullable().optional(),
  reviewedBy: z.string().uuid('Responsável pela revisão inválido').nullable().optional(),
  status: z.enum(Object.values(PPE_DELIVERY_STATUS) as [string, ...string[]]).optional(),
  statusOrder: z.number().optional(),
});

// GetById Schema
export const ppeDeliveryGetByIdSchema = z.object({
  include: ppeDeliveryIncludeSchema.optional(),
});
// Batch Schemas
export const ppeDeliveryBatchCreateSchema = z.object({
  ppeDeliveries: z.array(ppeDeliveryCreateSchema),
});

export const ppeDeliveryBatchUpdateSchema = z.object({
  ppeDeliveries: z
    .array(
      z.object({
        id: z.string().uuid('Entrega de PPE inválida'),
        data: ppeDeliveryUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma entrega de PPE deve ser fornecida'),
});

export const ppeDeliveryBatchDeleteSchema = z.object({
  ppeDeliveryIds: z
    .array(z.string().uuid('Entrega de PPE inválida'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const ppeDeliveryQuerySchema = z.object({
  include: ppeDeliveryIncludeSchema.optional(),
});

// Specialized operation schemas
export const ppeDeliveryByScheduleSchema = z.object({
  ppeScheduleId: z.string().uuid('Agendamento inválido'),
  reviewedBy: z.string().uuid('Responsável pela revisão inválido'),
  userId: z.string().uuid('Usuário inválido'),
  itemId: z.string().uuid('Item inválido'),
  quantity: z.number().int().positive('Quantidade deve ser um número inteiro positivo'),
});

// =====================
// PPE CONFIG NOTE
// =====================
// PPE configuration is now stored directly on the Item model.
// Items with PPE configuration have the following fields:
// - ppeType: PPE_TYPE enum
// - ppeSize: PPE_SIZE enum
// - ppeCA: string (Certificate of Approval)
// - ppeDeliveryMode: PPE_DELIVERY_MODE enum
// - ppeStandardQuantity: number

// =====================
// PPE SCHEDULE SCHEMAS
// =====================

// Include Schema
export const ppeDeliveryScheduleIncludeSchema = z
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
              prices: z.boolean().optional(),
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
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
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
            })
            .optional(),
        }),
      ])
      .optional(),
    weeklyConfig: z.boolean().optional(),
    monthlyConfig: z.boolean().optional(),
    yearlyConfig: z.boolean().optional(),
    deliveries: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z.boolean().optional(),
              user: z.boolean().optional(),
              reviewedByUser: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    autoOrders: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              responsible: z.boolean().optional(),
              supplier: z.boolean().optional(),
              orderItems: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// OrderBy Schema
export const ppeDeliveryScheduleOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        itemId: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        categoryId: orderByDirectionSchema.optional(),
        frequency: orderByDirectionSchema.optional(),
        frequencyCount: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        quantity: orderByDirectionSchema.optional(),
        specificDate: orderByDirectionSchema.optional(),
        dayOfMonth: orderByDirectionSchema.optional(),
        dayOfWeek: orderByDirectionSchema.optional(),
        month: orderByDirectionSchema.optional(),
        nextRun: orderByDirectionSchema.optional(),
        lastRun: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          frequency: orderByDirectionSchema.optional(),
          isActive: orderByDirectionSchema.optional(),
          nextRun: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// Where Schema
export const ppeDeliveryScheduleWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.array(z.lazy(() => ppeDeliveryScheduleWhereSchema)).optional(),
    OR: z.array(z.lazy(() => ppeDeliveryScheduleWhereSchema)).optional(),
    NOT: z.lazy(() => ppeDeliveryScheduleWhereSchema).optional(),

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

    name: z
      .union([
        z.string(),
        z.object({
          equals: z.string().optional(),
          not: z.string().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(['insensitive', 'default']).optional(),
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
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    categoryId: z
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

    frequency: z
      .union([
        z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
          errorMap: () => ({ message: 'Frequência inválida' }),
        }),
        z.object({
          equals: z
            .enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
              errorMap: () => ({ message: 'Frequência inválida' }),
            })
            .optional(),
          not: z
            .enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
              errorMap: () => ({ message: 'Frequência inválida' }),
            })
            .optional(),
          in: z
            .array(
              z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
                errorMap: () => ({ message: 'Frequência inválida' }),
              }),
            )
            .optional(),
          notIn: z
            .array(
              z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
                errorMap: () => ({ message: 'Frequência inválida' }),
              }),
            )
            .optional(),
        }),
      ])
      .optional(),

    isActive: z
      .union([
        z.boolean(),
        z.object({
          equals: z.boolean().optional(),
          not: z.boolean().optional(),
        }),
      ])
      .optional(),

    nextRun: z
      .union([
        z.date().nullable(),
        z.object({
          equals: z.date().nullable().optional(),
          not: z.date().nullable().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    lastRun: z
      .union([
        z.date().nullable(),
        z.object({
          equals: z.date().nullable().optional(),
          not: z.date().nullable().optional(),
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
const ppeDeliveryScheduleFilters = {
  itemIds: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  frequencies: z
    .array(
      z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: 'Frequência inválida' }),
      }),
    )
    .optional(),
  isActive: z.boolean().optional(),
  searchingFor: z.string().optional(),
};

// Transform function
const ppeDeliveryScheduleTransform = (data: any) => {
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

  if (data.itemIds?.length) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.userIds?.length) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.categoryIds?.length) {
    andConditions.push({ categoryId: { in: data.categoryIds } });
    delete data.categoryIds;
  }

  if (data.frequencies?.length) {
    andConditions.push({ frequency: { in: data.frequencies } });
    delete data.frequencies;
  }

  if (data.isActive !== undefined) {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  if (data.searchingFor) {
    andConditions.push({
      name: { contains: data.searchingFor, mode: 'insensitive' },
    });
    delete data.searchingFor;
  }

  if (data.nextRun) {
    andConditions.push({ nextRun: data.nextRun });
    delete data.nextRun;
  }

  if (data.lastRun) {
    andConditions.push({ lastRun: data.lastRun });
    delete data.lastRun;
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
export const ppeDeliveryScheduleGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    where: ppeDeliveryScheduleWhereSchema.optional(),
    orderBy: ppeDeliveryScheduleOrderBySchema.optional(),
    include: ppeDeliveryScheduleIncludeSchema.optional(),
    ...ppeDeliveryScheduleFilters,
    nextRun: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    lastRun: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
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
  .transform(ppeDeliveryScheduleTransform);

// PPE Item Schema for schedules
export const ppeScheduleItemSchema = z.object({
  ppeType: z.nativeEnum(PPE_TYPE, {
    errorMap: () => ({ message: 'Tipo de PPE inválido' }),
  }),
  quantity: z
    .number()
    .positive('Quantidade deve ser positiva')
    .int('Quantidade deve ser um número inteiro'),
});

// CRUD Schemas
export const ppeDeliveryScheduleCreateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(255, 'Nome muito longo'),
  ppeItems: z
    .array(ppeScheduleItemSchema)
    .min(1, 'Pelo menos um item de PPE deve ser especificado')
    .refine(
      items => {
        const types = items.map(item => item.ppeType);
        return new Set(types).size === types.length;
      },
      { message: 'Cada tipo de PPE pode aparecer apenas uma vez' },
    ),
  userId: z.string().uuid('Usuário inválido').nullable().optional(),
  categoryId: z.string().uuid('Categoria inválida').nullable().optional(),
  assignmentType: z
    .nativeEnum(ASSIGNMENT_TYPE, {
      errorMap: () => ({ message: 'Tipo de atribuição inválido' }),
    })
    .default(ASSIGNMENT_TYPE.ALL),
  excludedUserIds: z.array(z.string().uuid()).default([]),
  includedUserIds: z.array(z.string().uuid()).default([]),
  frequency: z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
    errorMap: () => ({ message: 'Frequência inválida' }),
  }),
  frequencyCount: z.number().int().positive('Frequência deve ser positiva').default(1),
  isActive: z.boolean().default(true),
  specificDate: z.coerce.date().nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dayOfWeek: z
    .nativeEnum(WEEK_DAY, {
      errorMap: () => ({ message: 'Dia da semana inválido' }),
    })
    .nullable()
    .optional(),
  month: z
    .nativeEnum(MONTH, {
      errorMap: () => ({ message: 'Mês inválido' }),
    })
    .nullable()
    .optional(),
  customMonths: z.array(z.nativeEnum(MONTH)).default([]),
  nextRun: z.coerce.date().nullable().optional(),
});

export const ppeDeliveryScheduleUpdateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(255, 'Nome muito longo').optional(),
  ppeItems: z
    .array(ppeScheduleItemSchema)
    .min(1, 'Pelo menos um item de PPE deve ser especificado')
    .refine(
      items => {
        const types = items.map(item => item.ppeType);
        return new Set(types).size === types.length;
      },
      { message: 'Cada tipo de PPE pode aparecer apenas uma vez' },
    )
    .optional(),
  assignmentType: z
    .nativeEnum(ASSIGNMENT_TYPE, {
      errorMap: () => ({ message: 'Tipo de atribuição inválido' }),
    })
    .optional(),
  excludedUserIds: z.array(z.string().uuid()).optional(),
  includedUserIds: z.array(z.string().uuid()).optional(),
  frequency: z
    .enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
      errorMap: () => ({ message: 'Frequência inválida' }),
    })
    .optional(),
  frequencyCount: z.number().int().positive('Frequência deve ser positiva').optional(),
  isActive: z.boolean().optional(),
  specificDate: z.coerce.date().nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dayOfWeek: z
    .nativeEnum(WEEK_DAY, {
      errorMap: () => ({ message: 'Dia da semana inválido' }),
    })
    .nullable()
    .optional(),
  month: z
    .nativeEnum(MONTH, {
      errorMap: () => ({ message: 'Mês inválido' }),
    })
    .nullable()
    .optional(),
  customMonths: z.array(z.nativeEnum(MONTH)).optional(),
  nextRun: z.coerce.date().nullable().optional(),
  lastRun: z.coerce.date().nullable().optional(),
});

// Batch Schemas
export const ppeDeliveryScheduleBatchCreateSchema = z.object({
  ppeDeliverySchedules: z.array(ppeDeliveryScheduleCreateSchema),
});

export const ppeDeliveryScheduleBatchUpdateSchema = z.object({
  ppeDeliverySchedules: z
    .array(
      z.object({
        id: z.string().uuid('Agendamento de PPE inválido'),
        data: ppeDeliveryScheduleUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um agendamento de PPE deve ser fornecido'),
});

export const ppeDeliveryScheduleBatchDeleteSchema = z.object({
  ppeScheduleIds: z
    .array(z.string().uuid('Agendamento de PPE inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const ppeDeliveryScheduleQuerySchema = z.object({
  include: ppeDeliveryScheduleIncludeSchema.optional(),
});

// GetById Schema
export const ppeDeliveryScheduleGetByIdSchema = z.object({
  include: ppeDeliveryScheduleIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

// PpeSize types
export type PpeSizeGetManyFormData = z.infer<typeof ppeSizeGetManySchema>;
export type PpeSizeGetByIdFormData = z.infer<typeof ppeSizeGetByIdSchema>;
export type PpeSizeQueryFormData = z.infer<typeof ppeSizeQuerySchema>;

export type PpeSizeCreateFormData = z.infer<typeof ppeSizeCreateSchema>;
export type PpeSizeUpdateFormData = z.infer<typeof ppeSizeUpdateSchema>;

export type PpeSizeBatchCreateFormData = z.infer<typeof ppeSizeBatchCreateSchema>;
export type PpeSizeBatchUpdateFormData = z.infer<typeof ppeSizeBatchUpdateSchema>;
export type PpeSizeBatchDeleteFormData = z.infer<typeof ppeSizeBatchDeleteSchema>;

export type PpeSizeInclude = z.infer<typeof ppeSizeIncludeSchema>;
export type PpeSizeOrderBy = z.infer<typeof ppeSizeOrderBySchema>;
export type PpeSizeWhere = z.infer<typeof ppeSizeWhereSchema>;

// PpeDelivery types
export type PpeDeliveryGetManyFormData = z.infer<typeof ppeDeliveryGetManySchema>;
export type PpeDeliveryGetByIdFormData = z.infer<typeof ppeDeliveryGetByIdSchema>;
export type PpeDeliveryQueryFormData = z.infer<typeof ppeDeliveryQuerySchema>;

export type PpeDeliveryCreateFormData = z.infer<typeof ppeDeliveryCreateSchema>;
export type PpeDeliveryUpdateFormData = z.infer<typeof ppeDeliveryUpdateSchema>;

export type PpeDeliveryBatchCreateFormData = z.infer<typeof ppeDeliveryBatchCreateSchema>;
export type PpeDeliveryBatchUpdateFormData = z.infer<typeof ppeDeliveryBatchUpdateSchema>;
export type PpeDeliveryBatchDeleteFormData = z.infer<typeof ppeDeliveryBatchDeleteSchema>;
export type PpeDeliveryByScheduleFormData = z.infer<typeof ppeDeliveryByScheduleSchema>;

export type PpeDeliveryInclude = z.infer<typeof ppeDeliveryIncludeSchema>;
export type PpeDeliveryOrderBy = z.infer<typeof ppeDeliveryOrderBySchema>;
export type PpeDeliveryWhere = z.infer<typeof ppeDeliveryWhereSchema>;

// PPE Schedule Item type
export type PpeScheduleItem = z.infer<typeof ppeScheduleItemSchema>;

// PpeDeliverySchedule types
export type PpeDeliveryScheduleGetManyFormData = z.infer<typeof ppeDeliveryScheduleGetManySchema>;
export type PpeDeliveryScheduleGetByIdFormData = z.infer<typeof ppeDeliveryScheduleGetByIdSchema>;
export type PpeDeliveryScheduleQueryFormData = z.infer<typeof ppeDeliveryScheduleQuerySchema>;

export type PpeDeliveryScheduleCreateFormData = z.infer<typeof ppeDeliveryScheduleCreateSchema>;
export type PpeDeliveryScheduleUpdateFormData = z.infer<typeof ppeDeliveryScheduleUpdateSchema>;

export type PpeDeliveryScheduleBatchCreateFormData = z.infer<
  typeof ppeDeliveryScheduleBatchCreateSchema
>;
export type PpeDeliveryScheduleBatchUpdateFormData = z.infer<
  typeof ppeDeliveryScheduleBatchUpdateSchema
>;
export type PpeDeliveryScheduleBatchDeleteFormData = z.infer<
  typeof ppeDeliveryScheduleBatchDeleteSchema
>;

export type PpeDeliveryScheduleInclude = z.infer<typeof ppeDeliveryScheduleIncludeSchema>;
export type PpeDeliveryScheduleOrderBy = z.infer<typeof ppeDeliveryScheduleOrderBySchema>;
export type PpeDeliveryScheduleWhere = z.infer<typeof ppeDeliveryScheduleWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapPpeSizeToFormData = createMapToFormDataHelper<PpeSize, PpeSizeUpdateFormData>(
  ppeSize => ({
    shirts: ppeSize.shirts,
    boots: ppeSize.boots,
    pants: ppeSize.pants,
    sleeves: ppeSize.sleeves,
    mask: ppeSize.mask,
  }),
);

export const mapPpeDeliveryToFormData = createMapToFormDataHelper<
  PpeDelivery,
  PpeDeliveryUpdateFormData
>(ppeDelivery => ({
  itemId: ppeDelivery.itemId,
  quantity: ppeDelivery.quantity,
  scheduledDate: ppeDelivery.scheduledDate,
  actualDeliveryDate: ppeDelivery.actualDeliveryDate,
  reviewedBy: ppeDelivery.reviewedBy || undefined,
  status: ppeDelivery.status,
}));

export const mapPpeDeliveryScheduleToFormData = createMapToFormDataHelper<
  any,
  PpeDeliveryScheduleUpdateFormData
>(ppeDeliverySchedule => ({
  frequency: ppeDeliverySchedule.frequency,
  frequencyCount: ppeDeliverySchedule.frequencyCount,
  isActive: ppeDeliverySchedule.isActive,
  quantity: ppeDeliverySchedule.quantity,
  specificDate: ppeDeliverySchedule.specificDate,
  dayOfMonth: ppeDeliverySchedule.dayOfMonth,
  dayOfWeek: ppeDeliverySchedule.dayOfWeek,
  month: ppeDeliverySchedule.month,
  nextRun: ppeDeliverySchedule.nextRun,
  lastRun: ppeDeliverySchedule.lastRun,
}));
