// packages/schemas/src/order-schedule.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, dateRangeSchema, uuidArraySchema } from "./common";
import type { OrderSchedule } from '@types';
import { SCHEDULE_FREQUENCY } from '@constants';

// =====================
// OrderSchedule Include Schemas
// =====================

export const orderScheduleIncludeSchema = z
  .object({
    supplier: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              contact: z.boolean().optional(),
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
              daysOfWeek: z.boolean().optional(),
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
              occurrences: z.boolean().optional(),
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
              monthlyConfigs: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    order: z.boolean().optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

// =====================
// OrderBy Schemas
// =====================

export const orderScheduleOrderBySchema = z.union([
  z
    .object({
      id: orderByDirectionSchema.optional(),
      frequency: orderByDirectionSchema.optional(),
      frequencyCount: orderByDirectionSchema.optional(),
      isActive: orderByDirectionSchema.optional(),
      specificDate: orderByDirectionSchema.optional(),
      dayOfMonth: orderByDirectionSchema.optional(),
      dayOfWeek: orderByDirectionSchema.optional(),
      month: orderByDirectionSchema.optional(),
      rescheduleCount: orderByDirectionSchema.optional(),
      originalDate: orderByDirectionSchema.optional(),
      lastRescheduleDate: orderByDirectionSchema.optional(),
      finishedAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    })
    .partial(),
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        frequency: orderByDirectionSchema.optional(),
        frequencyCount: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        specificDate: orderByDirectionSchema.optional(),
        finishedAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// Where Schemas
// =====================

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

      originalScheduleId: z
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

      // Enum fields
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

      dayOfWeek: z
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

      month: z
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

      // Number fields
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

      dayOfMonth: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

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
      specificDate: z
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
      supplier: z.any().optional(),
      category: z.any().optional(),
      weeklyConfig: z.any().optional(),
      monthlyConfig: z.any().optional(),
      yearlyConfig: z.any().optional(),
      order: z.any().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const orderScheduleFilters = {
  searchingFor: z.string().optional(),
  frequency: z
    .array(
      z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: "Frequência inválida" }),
      }),
    )
    .optional(),
  supplierIds: z.array(z.string().uuid("Fornecedor inválido")).optional(),
  itemIds: z.array(z.string().uuid("Item inválido")).optional(),
  isActive: z.boolean().optional(),
  hasReschedules: z.boolean().optional(),
  specificDateRange: dateRangeSchema.optional(),
  finishedAtRange: dateRangeSchema.optional(),
  createdAtRange: dateRangeSchema.optional(),
};

// =====================
// Transform Functions
// =====================

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

  // Handle searchingFor - search in related supplier names
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    andConditions.push({
      OR: [{ supplier: { name: { contains: data.searchingFor.trim(), mode: "insensitive" } } }],
    });
    delete data.searchingFor;
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

  // Handle itemIds filter (search in items array)
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({
      OR: data.itemIds.map((itemId: string) => ({
        items: { has: itemId },
      })),
    });
    delete data.itemIds;
  }

  // Handle isActive filter
  if (typeof data.isActive === "boolean") {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  // Handle hasReschedules filter
  if (data.hasReschedules === true) {
    andConditions.push({ rescheduleCount: { gt: 0 } });
    delete data.hasReschedules;
  }

  // Handle specificDateRange filter
  if (data.specificDateRange && typeof data.specificDateRange === "object") {
    const dateCondition: any = {};
    if (data.specificDateRange.gte) {
      const fromDate = data.specificDateRange.gte instanceof Date
        ? data.specificDateRange.gte
        : new Date(data.specificDateRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      dateCondition.gte = fromDate;
    }
    if (data.specificDateRange.lte) {
      const toDate = data.specificDateRange.lte instanceof Date
        ? data.specificDateRange.lte
        : new Date(data.specificDateRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      dateCondition.lte = toDate;
    }
    if (Object.keys(dateCondition).length > 0) {
      andConditions.push({ specificDate: dateCondition });
    }
    delete data.specificDateRange;
  }

  // Handle finishedAtRange filter
  if (data.finishedAtRange && typeof data.finishedAtRange === "object") {
    const dateCondition: any = {};
    if (data.finishedAtRange.gte) {
      const fromDate = data.finishedAtRange.gte instanceof Date
        ? data.finishedAtRange.gte
        : new Date(data.finishedAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      dateCondition.gte = fromDate;
    }
    if (data.finishedAtRange.lte) {
      const toDate = data.finishedAtRange.lte instanceof Date
        ? data.finishedAtRange.lte
        : new Date(data.finishedAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      dateCondition.lte = toDate;
    }
    if (Object.keys(dateCondition).length > 0) {
      andConditions.push({ finishedAt: dateCondition });
    }
    delete data.finishedAtRange;
  }

  // Handle createdAtRange filter
  if (data.createdAtRange && typeof data.createdAtRange === "object") {
    const dateCondition: any = {};
    if (data.createdAtRange.gte) {
      const fromDate = data.createdAtRange.gte instanceof Date
        ? data.createdAtRange.gte
        : new Date(data.createdAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      dateCondition.gte = fromDate;
    }
    if (data.createdAtRange.lte) {
      const toDate = data.createdAtRange.lte instanceof Date
        ? data.createdAtRange.lte
        : new Date(data.createdAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      dateCondition.lte = toDate;
    }
    if (Object.keys(dateCondition).length > 0) {
      andConditions.push({ createdAt: dateCondition });
    }
    delete data.createdAtRange;
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

export const orderScheduleGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: orderScheduleWhereSchema.optional(),
    orderBy: orderScheduleOrderBySchema.optional(),
    include: orderScheduleIncludeSchema.optional(),

    // Date filters
    createdAt: dateRangeSchema.optional(),
    updatedAt: dateRangeSchema.optional(),

    // Convenience filters
    ...orderScheduleFilters,
  })
  .transform(orderScheduleTransform);

// =====================
// Transform for Create/Update Schemas
// =====================

const toFormData = <T>(data: T) => data;

// =====================
// CRUD Schemas
// =====================

export const orderScheduleCreateSchema = z
  .object({
    frequency: z.enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
      errorMap: () => ({ message: "Frequência inválida" }),
    }),
    frequencyCount: z.number().int().positive("Contagem de frequência deve ser positiva").default(1),
    isActive: z.boolean().default(true),
    items: uuidArraySchema("item"),

    // Supplier selection (optional)
    supplierId: z.string().uuid("Fornecedor inválido").optional(),

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
  })
  .refine(
    (data) => {
      // Validate frequency-specific requirements
      switch (data.frequency) {
        case SCHEDULE_FREQUENCY.ONCE:
          return !!data.specificDate;
        case SCHEDULE_FREQUENCY.WEEKLY:
          return !!data.dayOfWeek || !!data.weeklyConfigId;
        case SCHEDULE_FREQUENCY.MONTHLY:
          return !!data.dayOfMonth || !!data.monthlyConfigId;
        case SCHEDULE_FREQUENCY.ANNUAL:
          return (!!data.dayOfMonth && !!data.month) || !!data.yearlyConfigId;
        case SCHEDULE_FREQUENCY.CUSTOM:
          return !!data.customMonths && data.customMonths.length > 0;
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

export const orderScheduleUpdateSchema = z
  .object({
    frequency: z
      .enum(Object.values(SCHEDULE_FREQUENCY) as [string, ...string[]], {
        errorMap: () => ({ message: "Frequência inválida" }),
      })
      .optional(),
    frequencyCount: z.number().int().positive("Contagem de frequência deve ser positiva").optional(),
    isActive: z.boolean().optional(),
    items: uuidArraySchema("item").optional(),

    // Supplier selection (optional)
    supplierId: z.string().uuid("Fornecedor inválido").nullable().optional(),

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

    // New auto-creation fields
    finishedAt: z.coerce.date().nullable().optional(),
    lastRunId: z.string().uuid("Último agendamento inválido").nullable().optional(),
    originalScheduleId: z.string().uuid("Agendamento original inválido").nullable().optional(),
  })
  .transform(toFormData);

// =====================
// Batch Schemas
// =====================

export const orderScheduleBatchCreateSchema = z.object({
  orderSchedules: z.array(orderScheduleCreateSchema).min(1, "Deve incluir pelo menos um agendamento").max(50, "Máximo de 50 agendamentos por vez"),
});

export const orderScheduleBatchUpdateSchema = z.object({
  orderSchedules: z
    .array(
      z.object({
        id: z.string().uuid("Agendamento inválido"),
        data: orderScheduleUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária")
    .max(50, "Máximo de 50 atualizações por vez"),
});

export const orderScheduleBatchDeleteSchema = z.object({
  orderScheduleIds: z.array(z.string().uuid("Agendamento inválido")).min(1, "Pelo menos um ID deve ser fornecido").max(50, "Máximo de 50 exclusões por vez"),
});

// =====================
// Additional Query Schemas
// =====================

export const orderScheduleGetByIdSchema = z.object({
  include: orderScheduleIncludeSchema.optional(),
  id: z.string().uuid("Agendamento inválido"),
});

// Query schema for include parameter
export const orderScheduleQuerySchema = z.object({
  include: orderScheduleIncludeSchema.optional(),
});

// =====================
// Type Exports
// =====================

// OrderSchedule types
export type OrderScheduleGetManyFormData = z.infer<typeof orderScheduleGetManySchema>;
export type OrderScheduleGetByIdFormData = z.infer<typeof orderScheduleGetByIdSchema>;
export type OrderScheduleQueryFormData = z.infer<typeof orderScheduleQuerySchema>;

export type OrderScheduleCreateFormData = z.infer<typeof orderScheduleCreateSchema>;
export type OrderScheduleUpdateFormData = z.infer<typeof orderScheduleUpdateSchema>;

export type OrderScheduleBatchCreateFormData = z.infer<typeof orderScheduleBatchCreateSchema>;
export type OrderScheduleBatchUpdateFormData = z.infer<typeof orderScheduleBatchUpdateSchema>;
export type OrderScheduleBatchDeleteFormData = z.infer<typeof orderScheduleBatchDeleteSchema>;

export type OrderScheduleInclude = z.infer<typeof orderScheduleIncludeSchema>;
export type OrderScheduleOrderBy = z.infer<typeof orderScheduleOrderBySchema>;
export type OrderScheduleWhere = z.infer<typeof orderScheduleWhereSchema>;

// =====================
// FormData Helpers
// =====================

export const mapOrderScheduleToFormData = createMapToFormDataHelper<OrderSchedule, OrderScheduleUpdateFormData>((orderSchedule) => ({
  frequency: orderSchedule.frequency as SCHEDULE_FREQUENCY,
  frequencyCount: orderSchedule.frequencyCount,
  isActive: orderSchedule.isActive,
  items: orderSchedule.items,
  supplierId: orderSchedule.supplierId || null,
  specificDate: orderSchedule.specificDate || null,
  dayOfMonth: orderSchedule.dayOfMonth || null,
  dayOfWeek: orderSchedule.dayOfWeek || null,
  month: orderSchedule.month || null,
  customMonths: orderSchedule.customMonths || [],
  rescheduleCount: orderSchedule.rescheduleCount,
  originalDate: orderSchedule.originalDate || null,
  lastRescheduleDate: orderSchedule.lastRescheduleDate || null,
  rescheduleReason: orderSchedule.rescheduleReason ?? undefined,
  weeklyConfigId: orderSchedule.weeklyConfigId || null,
  monthlyConfigId: orderSchedule.monthlyConfigId || null,
  yearlyConfigId: orderSchedule.yearlyConfigId || null,
  finishedAt: orderSchedule.finishedAt || null,
  lastRunId: orderSchedule.lastRunId || null,
  originalScheduleId: orderSchedule.originalScheduleId || null,
}));
