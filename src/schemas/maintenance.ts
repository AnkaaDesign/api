// packages/schemas/src/maintenance.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, dateRangeSchema } from "./common";
import type { Maintenance, MaintenanceItem } from '@types';
import { MAINTENANCE_STATUS, SCHEDULE_FREQUENCY } from '@constants';

// =====================
// Maintenance Include Schemas
// =====================

export const maintenanceIncludeSchema: z.ZodSchema = z.lazy(() =>
  z
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
              })
              .optional(),
          }),
        ])
        .optional(),
      itemsNeeded: z
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
      activities: z.boolean().optional(),
      weeklyConfig: z.boolean().optional(),
      monthlyConfig: z.boolean().optional(),
      yearlyConfig: z.boolean().optional(),
      originalMaintenance: z
        .union([
          z.boolean(),
          z.object({
            include: maintenanceIncludeSchema.optional(),
          }),
        ])
        .optional(),
      autoCreatedMaintenances: z
        .union([
          z.boolean(),
          z.object({
            include: maintenanceIncludeSchema.optional(),
          }),
        ])
        .optional(),
      lastRunMaintenance: z
        .union([
          z.boolean(),
          z.object({
            include: maintenanceIncludeSchema.optional(),
          }),
        ])
        .optional(),
      triggeredMaintenances: z
        .union([
          z.boolean(),
          z.object({
            include: maintenanceIncludeSchema.optional(),
          }),
        ])
        .optional(),
      _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
    })
    .partial(),
);

export const maintenanceItemIncludeSchema = z
  .object({
    maintenance: z
      .union([
        z.boolean(),
        z.object({
          include: maintenanceIncludeSchema.optional(),
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
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

// =====================
// OrderBy Schemas
// =====================

export const maintenanceOrderBySchema = z.union([
  z
    .object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      description: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      statusOrder: orderByDirectionSchema.optional(),
      frequency: orderByDirectionSchema.optional(),
      nextRun: orderByDirectionSchema.optional(),
      lastRun: orderByDirectionSchema.optional(),
      finishedAt: orderByDirectionSchema.optional(),
      startedAt: orderByDirectionSchema.optional(),
      timeTaken: orderByDirectionSchema.optional(),
      isActive: orderByDirectionSchema.optional(),
      rescheduleCount: orderByDirectionSchema.optional(),
      originalDate: orderByDirectionSchema.optional(),
      lastRescheduleDate: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial(),
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        frequency: orderByDirectionSchema.optional(),
        nextRun: orderByDirectionSchema.optional(),
        lastRun: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        rescheduleCount: orderByDirectionSchema.optional(),
        originalDate: orderByDirectionSchema.optional(),
        lastRescheduleDate: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

export const maintenanceItemOrderBySchema = z.union([
  z
    .object({
      id: orderByDirectionSchema.optional(),
      quantity: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial(),
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        quantity: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// Where Schemas
// =====================

export const maintenanceWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([maintenanceWhereSchema, z.array(maintenanceWhereSchema)]).optional(),
      OR: z.array(maintenanceWhereSchema).optional(),
      NOT: z.union([maintenanceWhereSchema, z.array(maintenanceWhereSchema)]).optional(),

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

      originalMaintenanceId: z
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

      lastRunId: z
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
      name: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
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
      nextRun: z
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

      lastRun: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      finishedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      originalDate: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      lastRescheduleDate: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
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

      // Number fields for new scheduling features
      rescheduleCount: z
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

      // Relations
      item: z.any().optional(),
      itemsNeeded: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      activities: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

export const maintenanceItemWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([maintenanceItemWhereSchema, z.array(maintenanceItemWhereSchema)]).optional(),
      OR: z.array(maintenanceItemWhereSchema).optional(),
      NOT: z.union([maintenanceItemWhereSchema, z.array(maintenanceItemWhereSchema)]).optional(),

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

      maintenanceId: z
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

      // Relations
      maintenance: z.any().optional(),
      item: z.any().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const maintenanceFilters = {
  searchingFor: z.string().optional(),
  status: z
    .array(
      z.enum(Object.values(MAINTENANCE_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "status inválido" }),
      }),
    )
    .optional(),
  frequency: z
    .array(
      z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: "frequência inválida" }),
      }),
    )
    .optional(),
  itemIds: z.array(z.string()).optional(),
  brandIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  supplierIds: z.array(z.string()).optional(),
  maintenanceScheduleIds: z.array(z.string()).optional(),
  isPending: z.boolean().optional(),
  isLate: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
  isRescheduled: z.boolean().optional(),
  nextRunRange: dateRangeSchema.optional(),
  lastRunRange: dateRangeSchema.optional(),
  finishedAtRange: dateRangeSchema.optional(),
  originalDateRange: dateRangeSchema.optional(),
};

const maintenanceItemFilters = {
  maintenanceIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  quantityRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

// =====================
// Transform Functions
// =====================

const maintenanceTransform = (data: any): any => {
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
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    andConditions.push({
      OR: [
        { name: { contains: data.searchingFor.trim(), mode: "insensitive" } },
        { description: { contains: data.searchingFor.trim(), mode: "insensitive" } },
        { item: { name: { contains: data.searchingFor.trim(), mode: "insensitive" } } },
        { item: { brand: { name: { contains: data.searchingFor.trim(), mode: "insensitive" } } } },
        { item: { category: { name: { contains: data.searchingFor.trim(), mode: "insensitive" } } } },
        { item: { supplier: { fantasyName: { contains: data.searchingFor.trim(), mode: "insensitive" } } } },
      ],
    });
    delete data.searchingFor;
  }

  // Handle status filter
  if (data.status && Array.isArray(data.status) && data.status.length > 0) {
    andConditions.push({ status: { in: data.status } });
    delete data.status;
  }

  // Handle frequency filter
  if (data.frequency && Array.isArray(data.frequency) && data.frequency.length > 0) {
    andConditions.push({ frequency: { in: data.frequency } });
    delete data.frequency;
  }

  // Handle itemIds filter
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  // Handle brandIds filter
  if (data.brandIds && Array.isArray(data.brandIds) && data.brandIds.length > 0) {
    andConditions.push({ item: { brandId: { in: data.brandIds } } });
    delete data.brandIds;
  }

  // Handle categoryIds filter
  if (data.categoryIds && Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
    andConditions.push({ item: { categoryId: { in: data.categoryIds } } });
    delete data.categoryIds;
  }

  // Handle supplierIds filter
  if (data.supplierIds && Array.isArray(data.supplierIds) && data.supplierIds.length > 0) {
    andConditions.push({ item: { supplierId: { in: data.supplierIds } } });
    delete data.supplierIds;
  }

  // Handle maintenanceScheduleIds filter
  if (data.maintenanceScheduleIds && Array.isArray(data.maintenanceScheduleIds) && data.maintenanceScheduleIds.length > 0) {
    andConditions.push({ maintenanceScheduleId: { in: data.maintenanceScheduleIds } });
    delete data.maintenanceScheduleIds;
  }

  // Handle isPending filter
  if (data.isPending === true) {
    andConditions.push({ status: MAINTENANCE_STATUS.PENDING });
    delete data.isPending;
  }

  // Handle isLate filter
  if (data.isLate === true) {
    andConditions.push({ status: MAINTENANCE_STATUS.OVERDUE });
    delete data.isLate;
  }

  // Handle isActive filter
  if (typeof data.isActive === "boolean") {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  // Handle isCompleted filter
  if (data.isCompleted === true) {
    andConditions.push({ status: MAINTENANCE_STATUS.COMPLETED });
    delete data.isCompleted;
  }

  // Handle isRescheduled filter
  if (data.isRescheduled === true) {
    andConditions.push({ rescheduleCount: { gt: 0 } });
    delete data.isRescheduled;
  }

  // Handle nextRunRange filter
  if (data.nextRunRange && typeof data.nextRunRange === "object") {
    const nextRunCondition: any = {};
    if (data.nextRunRange.gte) {
      const fromDate = data.nextRunRange.gte instanceof Date
        ? data.nextRunRange.gte
        : new Date(data.nextRunRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      nextRunCondition.gte = fromDate;
    }
    if (data.nextRunRange.lte) {
      const toDate = data.nextRunRange.lte instanceof Date
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

  // Handle lastRunRange filter
  if (data.lastRunRange && typeof data.lastRunRange === "object") {
    const lastRunCondition: any = {};
    if (data.lastRunRange.gte) {
      const fromDate = data.lastRunRange.gte instanceof Date
        ? data.lastRunRange.gte
        : new Date(data.lastRunRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      lastRunCondition.gte = fromDate;
    }
    if (data.lastRunRange.lte) {
      const toDate = data.lastRunRange.lte instanceof Date
        ? data.lastRunRange.lte
        : new Date(data.lastRunRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      lastRunCondition.lte = toDate;
    }
    if (Object.keys(lastRunCondition).length > 0) {
      andConditions.push({ lastRun: lastRunCondition });
    }
    delete data.lastRunRange;
  }

  // Handle finishedAtRange filter
  if (data.finishedAtRange && typeof data.finishedAtRange === "object") {
    const finishedAtCondition: any = {};
    if (data.finishedAtRange.gte) {
      const fromDate = data.finishedAtRange.gte instanceof Date
        ? data.finishedAtRange.gte
        : new Date(data.finishedAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      finishedAtCondition.gte = fromDate;
    }
    if (data.finishedAtRange.lte) {
      const toDate = data.finishedAtRange.lte instanceof Date
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

  // Handle originalDateRange filter
  if (data.originalDateRange && typeof data.originalDateRange === "object") {
    const originalDateCondition: any = {};
    if (data.originalDateRange.gte) {
      const fromDate = data.originalDateRange.gte instanceof Date
        ? data.originalDateRange.gte
        : new Date(data.originalDateRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      originalDateCondition.gte = fromDate;
    }
    if (data.originalDateRange.lte) {
      const toDate = data.originalDateRange.lte instanceof Date
        ? data.originalDateRange.lte
        : new Date(data.originalDateRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      originalDateCondition.lte = toDate;
    }
    if (Object.keys(originalDateCondition).length > 0) {
      andConditions.push({ originalDate: originalDateCondition });
    }
    delete data.originalDateRange;
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

const maintenanceItemTransform = (data: any): any => {
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

  // Handle maintenanceIds filter
  if (data.maintenanceIds && Array.isArray(data.maintenanceIds) && data.maintenanceIds.length > 0) {
    andConditions.push({ maintenanceId: { in: data.maintenanceIds } });
    delete data.maintenanceIds;
  }

  // Handle itemIds filter
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  // Handle quantityRange filter
  if (data.quantityRange && typeof data.quantityRange === "object") {
    const quantityCondition: any = {};
    if (typeof data.quantityRange.min === "number") quantityCondition.gte = data.quantityRange.min;
    if (typeof data.quantityRange.max === "number") quantityCondition.lte = data.quantityRange.max;
    if (Object.keys(quantityCondition).length > 0) {
      andConditions.push({ quantity: quantityCondition });
    }
    delete data.quantityRange;
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

export const maintenanceGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: maintenanceWhereSchema.optional(),
    orderBy: maintenanceOrderBySchema.optional(),
    include: maintenanceIncludeSchema.optional(),

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

    // Convenience filters
    ...maintenanceFilters,
  })
  .transform(maintenanceTransform);

export const maintenanceItemGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: maintenanceItemWhereSchema.optional(),
    orderBy: maintenanceItemOrderBySchema.optional(),
    include: maintenanceItemIncludeSchema.optional(),

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

    // Convenience filters
    ...maintenanceItemFilters,
  })
  .transform(maintenanceItemTransform);

// =====================
// Transform for Create/Update Schemas
// =====================

const toFormData = <T>(data: T) => data;

// =====================
// CRUD Schemas
// =====================

export const maintenanceCreateSchema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório").max(255, "Nome deve ter no máximo 255 caracteres"),
    description: z.string().optional(),
    status: z
      .enum(Object.values(MAINTENANCE_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "Status inválido" }),
      })
      .default(MAINTENANCE_STATUS.PENDING),
    itemId: z.string().uuid("Item inválido"),
    maintenanceScheduleId: z.string().uuid("Cronograma de manutenção inválido").optional(),
    scheduledFor: z.coerce.date({ invalid_type_error: "Data inválida" }).optional().nullable(),
    itemsNeeded: z
      .array(
        z.object({
          itemId: z.string().min(1, "Item é obrigatório"),
          quantity: z.number().positive("Quantidade deve ser positiva").default(1),
        }),
      )
      .optional()
      .nullable()
      .default([])
      .transform((items) => {
        // Handle null/undefined
        if (!items || items.length === 0) return [];
        // Filter out items with empty or invalid itemId
        return items.filter((item) => item.itemId && item.itemId.trim() !== "");
      }),
    // Auto-creation field
    originalMaintenanceId: z.string().uuid("Manutenção original inválida").optional(),
  })
  .transform(toFormData);

export const maintenanceUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().nullable().optional(),
    status: z
      .enum(Object.values(MAINTENANCE_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "Status inválido" }),
      })
      .optional(),
    itemId: z.string().uuid("Item inválido").optional(),
    maintenanceScheduleId: z.string().uuid("Cronograma de manutenção inválido").nullable().optional(),
    scheduledFor: z.coerce.date().nullable().optional(),
    startedAt: z.coerce.date().nullable().optional(),
    finishedAt: z.coerce.date().nullable().optional(),
    timeTaken: z.number().int().min(0).nullable().optional(),
    // Auto-creation field
    originalMaintenanceId: z.string().uuid("Manutenção original inválida").nullable().optional(),
  })
  .refine(
    (data) => {
      // Validate that finishedAt is only set when status is COMPLETED
      if (data.finishedAt && data.status && data.status !== MAINTENANCE_STATUS.COMPLETED) {
        return false;
      }
      return true;
    },
    {
      message: "Data de conclusão só pode ser definida quando o status é 'Concluído'",
      path: ["finishedAt"],
    },
  )
  .transform(toFormData);

export const maintenanceItemCreateSchema = z
  .object({
    maintenanceId: z.string().uuid("Manutenção inválida"),
    itemId: z.string().uuid("Item inválido"),
    quantity: z.number().positive("Quantidade deve ser positiva").default(1),
  })
  .transform(toFormData);

export const maintenanceItemUpdateSchema = z
  .object({
    quantity: z.number().positive("Quantidade deve ser positiva").optional(),
  })
  .transform(toFormData);

// =====================
// Batch Schemas
// =====================

export const maintenanceBatchCreateSchema = z.object({
  maintenances: z.array(maintenanceCreateSchema),
});

export const maintenanceBatchUpdateSchema = z.object({
  maintenances: z
    .array(
      z.object({
        id: z.string().uuid("Manutenção inválida"),
        data: maintenanceUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const maintenanceBatchDeleteSchema = z.object({
  maintenanceIds: z.array(z.string().uuid("Manutenção inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

export const maintenanceItemBatchCreateSchema = z.object({
  maintenanceItems: z.array(maintenanceItemCreateSchema),
});

export const maintenanceItemBatchUpdateSchema = z.object({
  maintenanceItems: z
    .array(
      z.object({
        id: z.string().uuid("Item de manutenção inválido"),
        data: maintenanceItemUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const maintenanceItemBatchDeleteSchema = z.object({
  maintenanceItemIds: z.array(z.string().uuid("Item de manutenção inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// =====================
// Additional Query Schemas
// =====================

export const maintenanceGetByIdSchema = z.object({
  include: maintenanceIncludeSchema.optional(),
  id: z.string().uuid("Manutenção inválida"),
});

export const maintenanceItemGetByIdSchema = z.object({
  include: maintenanceItemIncludeSchema.optional(),
  id: z.string().uuid("Item de manutenção inválido"),
});

// Query schema for include parameter
export const maintenanceQuerySchema = z.object({
  include: maintenanceIncludeSchema.optional(),
});

// Query schema for include parameter
export const maintenanceItemQuerySchema = z.object({
  include: maintenanceItemIncludeSchema.optional(),
});

// =====================
// Type Exports
// =====================

// Maintenance types
export type MaintenanceGetManyFormData = z.infer<typeof maintenanceGetManySchema>;
export type MaintenanceGetByIdFormData = z.infer<typeof maintenanceGetByIdSchema>;
export type MaintenanceQueryFormData = z.infer<typeof maintenanceQuerySchema>;

export type MaintenanceCreateFormData = z.infer<typeof maintenanceCreateSchema>;
export type MaintenanceUpdateFormData = z.infer<typeof maintenanceUpdateSchema>;

export type MaintenanceBatchCreateFormData = z.infer<typeof maintenanceBatchCreateSchema>;
export type MaintenanceBatchUpdateFormData = z.infer<typeof maintenanceBatchUpdateSchema>;
export type MaintenanceBatchDeleteFormData = z.infer<typeof maintenanceBatchDeleteSchema>;

export type MaintenanceInclude = z.infer<typeof maintenanceIncludeSchema>;
export type MaintenanceOrderBy = z.infer<typeof maintenanceOrderBySchema>;
export type MaintenanceWhere = z.infer<typeof maintenanceWhereSchema>;

// MaintenanceItem types
export type MaintenanceItemGetManyFormData = z.infer<typeof maintenanceItemGetManySchema>;
export type MaintenanceItemGetByIdFormData = z.infer<typeof maintenanceItemGetByIdSchema>;
export type MaintenanceItemQueryFormData = z.infer<typeof maintenanceItemQuerySchema>;

export type MaintenanceItemCreateFormData = z.infer<typeof maintenanceItemCreateSchema>;
export type MaintenanceItemUpdateFormData = z.infer<typeof maintenanceItemUpdateSchema>;

export type MaintenanceItemBatchCreateFormData = z.infer<typeof maintenanceItemBatchCreateSchema>;
export type MaintenanceItemBatchUpdateFormData = z.infer<typeof maintenanceItemBatchUpdateSchema>;
export type MaintenanceItemBatchDeleteFormData = z.infer<typeof maintenanceItemBatchDeleteSchema>;

export type MaintenanceItemInclude = z.infer<typeof maintenanceItemIncludeSchema>;
export type MaintenanceItemOrderBy = z.infer<typeof maintenanceItemOrderBySchema>;
export type MaintenanceItemWhere = z.infer<typeof maintenanceItemWhereSchema>;

// =====================
// FormData Helpers
// =====================

export const mapMaintenanceToFormData = createMapToFormDataHelper<Maintenance, MaintenanceUpdateFormData>((maintenance) => ({
  name: maintenance.name,
  description: maintenance.description,
  status: maintenance.status as MAINTENANCE_STATUS,
  itemId: maintenance.itemId,
  maintenanceScheduleId: maintenance.maintenanceScheduleId,
  scheduledFor: maintenance.scheduledFor,
  startedAt: maintenance.startedAt,
  finishedAt: maintenance.finishedAt,
  timeTaken: maintenance.timeTaken,
  originalMaintenanceId: maintenance.originalMaintenanceId,
}));

export const mapMaintenanceItemToFormData = createMapToFormDataHelper<MaintenanceItem, MaintenanceItemUpdateFormData>((maintenanceItem) => ({
  quantity: maintenanceItem.quantity,
}));

// =====================
// Maintenance Schedule Schemas
// =====================

// Maintenance Schedule Include Schema
export const maintenanceScheduleIncludeSchema = z
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
            })
            .optional(),
        }),
      ])
      .optional(),
    weeklyConfig: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              // weeklyConfig fields
            })
            .optional(),
        }),
      ])
      .optional(),
    monthlyConfig: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              // monthlyConfig fields
            })
            .optional(),
        }),
      ])
      .optional(),
    yearlyConfig: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              // yearlyConfig fields
            })
            .optional(),
        }),
      ])
      .optional(),
    maintenances: z
      .union([
        z.boolean(),
        z.object({
          include: maintenanceIncludeSchema.optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

// OrderBy Schema
export const maintenanceScheduleOrderBySchema = z.union([
  z
    .object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      description: orderByDirectionSchema.optional(),
      frequency: orderByDirectionSchema.optional(),
      frequencyCount: orderByDirectionSchema.optional(),
      isActive: orderByDirectionSchema.optional(),
      nextRun: orderByDirectionSchema.optional(),
      lastRun: orderByDirectionSchema.optional(),
      finishedAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial(),
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        frequency: orderByDirectionSchema.optional(),
        frequencyCount: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        nextRun: orderByDirectionSchema.optional(),
        lastRun: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// Where Schema
export const maintenanceScheduleWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([maintenanceScheduleWhereSchema, z.array(maintenanceScheduleWhereSchema)]).optional(),
      OR: z.array(maintenanceScheduleWhereSchema).optional(),
      NOT: z.union([maintenanceScheduleWhereSchema, z.array(maintenanceScheduleWhereSchema)]).optional(),

      // Fields
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
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      description: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      itemId: z
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

      frequencyCount: z
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
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      lastRun: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      finishedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
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

      // Relations
      item: z.any().optional(),
      weeklyConfig: z.any().optional(),
      monthlyConfig: z.any().optional(),
      yearlyConfig: z.any().optional(),
    })
    .partial(),
);

// Convenience Filters
const maintenanceScheduleFilters = {
  searchingFor: z.string().optional(),
  frequency: z
    .array(
      z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: "Frequência inválida" }),
      }),
    )
    .optional(),
  itemIds: z.array(z.string().uuid("Item inválido")).optional(),
  isActive: z.boolean().optional(),
  hasNextRun: z.boolean().optional(),
  nextRunRange: dateRangeSchema.optional(),
  lastRunRange: dateRangeSchema.optional(),
  finishedAtRange: dateRangeSchema.optional(),
  createdAtRange: dateRangeSchema.optional(),
};

// Transform Functions
const maintenanceScheduleTransform = (data: any): any => {
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

  // Handle searchingFor - search in names and descriptions
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    andConditions.push({
      OR: [{ name: { contains: data.searchingFor.trim(), mode: "insensitive" } }, { description: { contains: data.searchingFor.trim(), mode: "insensitive" } }],
    });
    delete data.searchingFor;
  }

  // Handle frequency filter
  if (data.frequency && Array.isArray(data.frequency) && data.frequency.length > 0) {
    andConditions.push({ frequency: { in: data.frequency } });
    delete data.frequency;
  }

  // Handle itemIds filter
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  // Handle isActive filter
  if (typeof data.isActive === "boolean") {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  // Handle hasNextRun filter
  if (data.hasNextRun === true) {
    andConditions.push({ nextRun: { not: null } });
    delete data.hasNextRun;
  } else if (data.hasNextRun === false) {
    andConditions.push({ nextRun: null });
    delete data.hasNextRun;
  }

  // Handle date range filters
  const dateRangeFields = ["nextRunRange", "lastRunRange", "finishedAtRange", "createdAtRange"];

  dateRangeFields.forEach((rangeField) => {
    const field = rangeField.replace("Range", "");
    if (data[rangeField] && typeof data[rangeField] === "object") {
      const dateCondition: any = {};
      if (data[rangeField].gte) {
        const fromDate = data[rangeField].gte instanceof Date
          ? data[rangeField].gte
          : new Date(data[rangeField].gte);
        // Set to start of day (00:00:00)
        fromDate.setHours(0, 0, 0, 0);
        dateCondition.gte = fromDate;
      }
      if (data[rangeField].lte) {
        const toDate = data[rangeField].lte instanceof Date
          ? data[rangeField].lte
          : new Date(data[rangeField].lte);
        // Set to end of day (23:59:59.999)
        toDate.setHours(23, 59, 59, 999);
        dateCondition.lte = toDate;
      }
      if (Object.keys(dateCondition).length > 0) {
        andConditions.push({ [field]: dateCondition });
      }
      delete data[rangeField];
    }
  });

  // Handle direct date filters
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

// Query Schema
export const maintenanceScheduleGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: maintenanceScheduleWhereSchema.optional(),
    orderBy: maintenanceScheduleOrderBySchema.optional(),
    include: maintenanceScheduleIncludeSchema.optional(),

    // Date filters
    createdAt: dateRangeSchema.optional(),
    updatedAt: dateRangeSchema.optional(),

    // Convenience filters
    ...maintenanceScheduleFilters,
  })
  .transform(maintenanceScheduleTransform);

// CRUD Schemas
export const maintenanceScheduleCreateSchema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório").max(255, "Nome deve ter no máximo 255 caracteres"),
    description: z.string().optional(),
    itemId: z.string().uuid("Item inválido").optional(),
    frequency: z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
      errorMap: () => ({ message: "Frequência inválida" }),
    }),
    frequencyCount: z.number().int().positive("Contagem de frequência deve ser positiva").default(1),
    isActive: z.boolean().default(true),
    maintenanceItemsConfig: z
      .array(
        z.object({
          itemId: z.string().uuid("Item inválido"),
          quantity: z.number().positive("Quantidade deve ser positiva").default(1),
        }),
      )
      .optional()
      .default([]),

    // Specific scheduling fields - conditionally required based on frequency
    specificDate: z.coerce.date().optional(),
    dayOfMonth: z.number().int().min(1, "Dia do mês deve ser entre 1 e 31").max(31, "Dia do mês deve ser entre 1 e 31").optional(),
    dayOfWeek: z.string().optional(), // DayOfWeek enum values
    month: z.string().optional(), // Month enum values
    customMonths: z.array(z.string()).optional(), // Array of Month enum values

    // Schedule configuration IDs (when using advanced configurations)
    weeklyConfigId: z.string().uuid("Configuração semanal inválida").optional(),
    monthlyConfigId: z.string().uuid("Configuração mensal inválida").optional(),
    yearlyConfigId: z.string().uuid("Configuração anual inválida").optional(),

    // Runtime fields
    nextRun: z.coerce.date().optional(),
  })
  .refine(
    (data) => {
      // Validate frequency-specific requirements
      // nextRun is sufficient for most frequencies if other specific fields are not provided
      switch (data.frequency) {
        case SCHEDULE_FREQUENCY.ONCE:
          return !!data.specificDate;
        case SCHEDULE_FREQUENCY.WEEKLY:
        case SCHEDULE_FREQUENCY.BIWEEKLY:
          return !!data.dayOfWeek || !!data.weeklyConfigId || !!data.nextRun;
        case SCHEDULE_FREQUENCY.MONTHLY:
        case SCHEDULE_FREQUENCY.BIMONTHLY:
        case SCHEDULE_FREQUENCY.QUARTERLY:
        case SCHEDULE_FREQUENCY.TRIANNUAL:
        case SCHEDULE_FREQUENCY.QUADRIMESTRAL:
        case SCHEDULE_FREQUENCY.SEMI_ANNUAL:
          return !!data.dayOfMonth || !!data.monthlyConfigId || !!data.nextRun;
        case SCHEDULE_FREQUENCY.ANNUAL:
          return (!!data.dayOfMonth && !!data.month) || !!data.yearlyConfigId || !!data.nextRun;
        case SCHEDULE_FREQUENCY.CUSTOM:
          return (!!data.customMonths && data.customMonths.length > 0) || !!data.nextRun;
        default:
          return true;
      }
    },
    {
      message: "Configuração de agendamento incompleta para a frequência selecionada",
      path: ["frequency"],
    },
  )
  .transform(toFormData);

export const maintenanceScheduleUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    itemId: z.string().uuid("Item inválido").nullable().optional(),
    frequency: z
      .enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: "Frequência inválida" }),
      })
      .optional(),
    frequencyCount: z.number().int().positive("Contagem de frequência deve ser positiva").optional(),
    isActive: z.boolean().optional(),
    maintenanceItemsConfig: z
      .array(
        z.object({
          itemId: z.string().uuid("Item inválido"),
          quantity: z.number().positive("Quantidade deve ser positiva").default(1),
        }),
      )
      .optional(),

    // Specific scheduling fields
    specificDate: z.coerce.date().nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    dayOfWeek: z.string().nullable().optional(),
    month: z.string().nullable().optional(),
    customMonths: z.array(z.string()).optional(),

    // Reschedule fields
    rescheduleCount: z.number().int().min(0).optional(),
    originalDate: z.coerce.date().nullable().optional(),
    lastRescheduleDate: z.coerce.date().nullable().optional(),
    rescheduleReason: z.string().optional(), // RescheduleReason enum

    // Schedule configuration IDs
    weeklyConfigId: z.string().uuid().nullable().optional(),
    monthlyConfigId: z.string().uuid().nullable().optional(),
    yearlyConfigId: z.string().uuid().nullable().optional(),

    // Auto-creation fields
    finishedAt: z.coerce.date().nullable().optional(),
    lastRunId: z.string().uuid("Última execução inválida").nullable().optional(),
    originalScheduleId: z.string().uuid("Agendamento original inválido").nullable().optional(),
    nextRun: z.coerce.date().nullable().optional(),
    lastRun: z.coerce.date().nullable().optional(),
  })
  .transform(toFormData);

// Batch Schemas
export const maintenanceScheduleBatchCreateSchema = z.object({
  maintenanceSchedules: z.array(maintenanceScheduleCreateSchema).min(1, "Deve incluir pelo menos um agendamento").max(50, "Máximo de 50 agendamentos por vez"),
});

export const maintenanceScheduleBatchUpdateSchema = z.object({
  maintenanceSchedules: z
    .array(
      z.object({
        id: z.string().uuid("Agendamento inválido"),
        data: maintenanceScheduleUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária")
    .max(50, "Máximo de 50 atualizações por vez"),
});

export const maintenanceScheduleBatchDeleteSchema = z.object({
  maintenanceScheduleIds: z.array(z.string().uuid("Agendamento inválido")).min(1, "Pelo menos um ID deve ser fornecido").max(50, "Máximo de 50 exclusões por vez"),
});

// Additional Query Schemas
export const maintenanceScheduleGetByIdSchema = z.object({
  include: maintenanceScheduleIncludeSchema.optional(),
  id: z.string().uuid("Agendamento inválido"),
});

// Query schema for include parameter
export const maintenanceScheduleQuerySchema = z.object({
  include: maintenanceScheduleIncludeSchema.optional(),
});

// Type Exports for Maintenance Schedule
export type MaintenanceScheduleGetManyFormData = z.infer<typeof maintenanceScheduleGetManySchema>;
export type MaintenanceScheduleGetByIdFormData = z.infer<typeof maintenanceScheduleGetByIdSchema>;
export type MaintenanceScheduleQueryFormData = z.infer<typeof maintenanceScheduleQuerySchema>;

export type MaintenanceScheduleCreateFormData = z.infer<typeof maintenanceScheduleCreateSchema>;
export type MaintenanceScheduleUpdateFormData = z.infer<typeof maintenanceScheduleUpdateSchema>;

export type MaintenanceScheduleBatchCreateFormData = z.infer<typeof maintenanceScheduleBatchCreateSchema>;
export type MaintenanceScheduleBatchUpdateFormData = z.infer<typeof maintenanceScheduleBatchUpdateSchema>;
export type MaintenanceScheduleBatchDeleteFormData = z.infer<typeof maintenanceScheduleBatchDeleteSchema>;

export type MaintenanceScheduleInclude = z.infer<typeof maintenanceScheduleIncludeSchema>;
export type MaintenanceScheduleOrderBy = z.infer<typeof maintenanceScheduleOrderBySchema>;
export type MaintenanceScheduleWhere = z.infer<typeof maintenanceScheduleWhereSchema>;
