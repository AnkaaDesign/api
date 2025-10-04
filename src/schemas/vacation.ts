// packages/schemas/src/vacation.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from "./common";
import type { Vacation } from '@types';
import { VACATION_STATUS, VACATION_TYPE } from '@constants';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const vacationIncludeSchema = z
  .object({
    // Direct Vacation relations
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
              ppeSchedules: z.boolean().optional(),
              changeLogs: z.boolean().optional(),
              seenNotification: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

// =====================
// OrderBy Schema Based on Prisma Schema Fields
// =====================

export const vacationOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      // Vacation direct fields
      id: orderByDirectionSchema.optional(),
      userId: orderByDirectionSchema.optional(),
      startAt: orderByDirectionSchema.optional(),
      endAt: orderByDirectionSchema.optional(),
      isCollective: orderByDirectionSchema.optional(),
      type: orderByDirectionSchema.optional(),
      typeOrder: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      statusOrder: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering - User
      user: z
        .object({
          id: orderByDirectionSchema.optional(),
          email: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          phone: orderByDirectionSchema.optional(),
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
        userId: orderByDirectionSchema.optional(),
        startAt: orderByDirectionSchema.optional(),
        endAt: orderByDirectionSchema.optional(),
        isCollective: orderByDirectionSchema.optional(),
        type: orderByDirectionSchema.optional(),
        typeOrder: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// Where Schema Based on Prisma Schema Fields
// =====================

export const vacationWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([vacationWhereSchema, z.array(vacationWhereSchema)]).optional(),
      OR: z.array(vacationWhereSchema).optional(),
      NOT: z.union([vacationWhereSchema, z.array(vacationWhereSchema)]).optional(),

      // Vacation fields
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
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      startAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      endAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      isCollective: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      type: z
        .union([
          z.nativeEnum(VACATION_TYPE),
          z.object({
            equals: z.nativeEnum(VACATION_TYPE).optional(),
            not: z.nativeEnum(VACATION_TYPE).optional(),
            in: z.array(z.nativeEnum(VACATION_TYPE)).optional(),
            notIn: z.array(z.nativeEnum(VACATION_TYPE)).optional(),
          }),
        ])
        .optional(),

      typeOrder: z
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

      status: z
        .union([
          z.nativeEnum(VACATION_STATUS),
          z.object({
            equals: z.nativeEnum(VACATION_STATUS).optional(),
            not: z.nativeEnum(VACATION_STATUS).optional(),
            in: z.array(z.nativeEnum(VACATION_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(VACATION_STATUS)).optional(),
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

      createdAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.coerce.date(),
          z.object({
            equals: z.coerce.date().optional(),
            not: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relation filters
      user: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const vacationFilters = {
  searchingFor: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  statuses: z.array(z.nativeEnum(VACATION_STATUS)).optional(),
  types: z.array(z.nativeEnum(VACATION_TYPE)).optional(),
  isCollective: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isPast: z.boolean().optional(),
  isFuture: z.boolean().optional(),
  year: z.number().int().min(2000).max(3000).optional(),
  month: z.number().int().min(1).max(12).optional(),
  startAtRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .refine(
      (data) => {
        if (data.gte && data.lte) {
          return data.lte >= data.gte;
        }
        return true;
      },
      {
        message: "Data final deve ser posterior ou igual à data inicial",
        path: ["lte"],
      },
    )
    .optional(),
  endAtRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .refine(
      (data) => {
        if (data.gte && data.lte) {
          return data.lte >= data.gte;
        }
        return true;
      },
      {
        message: "Data final deve ser posterior ou igual à data inicial",
        path: ["lte"],
      },
    )
    .optional(),
};

// =====================
// Transform Function
// =====================

const vacationTransform = (data: any) => {
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
      user: {
        OR: [{ name: { contains: data.searchingFor.trim(), mode: "insensitive" } }, { email: { contains: data.searchingFor.trim(), mode: "insensitive" } }],
      },
    });
    delete data.searchingFor;
  }

  // Handle userIds filter
  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  // Handle statuses filter
  if (data.statuses && Array.isArray(data.statuses) && data.statuses.length > 0) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  // Handle types filter
  if (data.types && Array.isArray(data.types) && data.types.length > 0) {
    andConditions.push({ type: { in: data.types } });
    delete data.types;
  }

  // Handle isCollective filter
  if (typeof data.isCollective === "boolean") {
    andConditions.push({ isCollective: data.isCollective });
    delete data.isCollective;
  }

  // Handle time-based filters
  const now = new Date();

  if (data.isActive === true) {
    andConditions.push({
      AND: [{ startAt: { lte: now } }, { endAt: { gte: now } }, { status: VACATION_STATUS.APPROVED }],
    });
    delete data.isActive;
  }

  if (data.isPast === true) {
    andConditions.push({ endAt: { lt: now } });
    delete data.isPast;
  }

  if (data.isFuture === true) {
    andConditions.push({ startAt: { gt: now } });
    delete data.isFuture;
  }

  // Handle year filter
  if (data.year) {
    const yearStart = new Date(data.year, 0, 1);
    const yearEnd = new Date(data.year, 11, 31, 23, 59, 59);
    andConditions.push({
      OR: [
        {
          AND: [{ startAt: { gte: yearStart } }, { startAt: { lte: yearEnd } }],
        },
        {
          AND: [{ endAt: { gte: yearStart } }, { endAt: { lte: yearEnd } }],
        },
        {
          AND: [{ startAt: { lte: yearStart } }, { endAt: { gte: yearEnd } }],
        },
      ],
    });
    delete data.year;
  }

  // Handle month filter
  if (data.month && data.year) {
    const monthStart = new Date(data.year, data.month - 1, 1);
    const monthEnd = new Date(data.year, data.month, 0, 23, 59, 59);
    andConditions.push({
      OR: [
        {
          AND: [{ startAt: { gte: monthStart } }, { startAt: { lte: monthEnd } }],
        },
        {
          AND: [{ endAt: { gte: monthStart } }, { endAt: { lte: monthEnd } }],
        },
        {
          AND: [{ startAt: { lte: monthStart } }, { endAt: { gte: monthEnd } }],
        },
      ],
    });
    delete data.month;
  }

  // Handle startAtRange filter
  if (data.startAtRange && typeof data.startAtRange === "object") {
    const condition: any = {};
    if (data.startAtRange.gte) {
      const fromDate = data.startAtRange.gte instanceof Date
        ? data.startAtRange.gte
        : new Date(data.startAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.startAtRange.lte) {
      const toDate = data.startAtRange.lte instanceof Date
        ? data.startAtRange.lte
        : new Date(data.startAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ startAt: condition });
    }
    delete data.startAtRange;
  }

  // Handle endAtRange filter
  if (data.endAtRange && typeof data.endAtRange === "object") {
    const condition: any = {};
    if (data.endAtRange.gte) {
      const fromDate = data.endAtRange.gte instanceof Date
        ? data.endAtRange.gte
        : new Date(data.endAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      condition.gte = fromDate;
    }
    if (data.endAtRange.lte) {
      const toDate = data.endAtRange.lte instanceof Date
        ? data.endAtRange.lte
        : new Date(data.endAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      condition.lte = toDate;
    }
    if (Object.keys(condition).length > 0) {
      andConditions.push({ endAt: condition });
    }
    delete data.endAtRange;
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
// Query Schema
// =====================

export const vacationGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: vacationWhereSchema.optional(),
    orderBy: vacationOrderBySchema.optional(),
    include: vacationIncludeSchema.optional(),

    // Convenience filters
    ...vacationFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["lte"],
        },
      )
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .refine(
        (data) => {
          if (data.gte && data.lte) {
            return data.lte >= data.gte;
          }
          return true;
        },
        {
          message: "Data final deve ser posterior ou igual à data inicial",
          path: ["lte"],
        },
      )
      .optional(),
  })
  .transform(vacationTransform);

// =====================
// CRUD Schemas
// =====================

export const vacationCreateSchema = z
  .object({
    userId: z.string().uuid("Usuário inválido").nullable().optional(),
    startAt: z.coerce.date({
      required_error: "Data de início é obrigatória",
      invalid_type_error: "Data de início inválida",
    }),
    endAt: z.coerce.date({
      required_error: "Data de término é obrigatória",
      invalid_type_error: "Data de término inválida",
    }),
    isCollective: z.boolean().default(false),
    type: z
      .enum(Object.values(VACATION_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: "tipo inválido" }),
      })
      .default(VACATION_TYPE.ANNUAL),
    status: z
      .enum(Object.values(VACATION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "status inválido" }),
      })
      .default(VACATION_STATUS.PENDING),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "Data de término deve ser posterior à data de início",
    path: ["endAt"],
  });

export const vacationUpdateSchema = z
  .object({
    userId: z.string().uuid("Usuário inválido").nullable().optional(),
    startAt: z.coerce.date({ invalid_type_error: "Data de início inválida" }).optional(),
    endAt: z.coerce.date({ invalid_type_error: "Data de término inválida" }).optional(),
    type: z
      .enum(Object.values(VACATION_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: "tipo inválido" }),
      })
      .optional(),
    status: z
      .enum(Object.values(VACATION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "status inválido" }),
      })
      .optional(),
    isCollective: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // Validate date range
    if (data.startAt && data.endAt) {
      if (data.endAt <= data.startAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Data de término deve ser posterior à data de início",
          path: ["endAt"],
        });
      }
    }

    // Validate status-based requirements

    if (data.status === VACATION_STATUS.IN_PROGRESS) {
      // For IN_PROGRESS status, current date should be within vacation period
      // This validation is done at service level with actual vacation dates
    }

    if (data.status === VACATION_STATUS.COMPLETED) {
      // For COMPLETED status, vacation should have ended
      // This validation is done at service level with actual vacation dates
    }
  });

// =====================
// Batch Operations Schemas
// =====================

export const vacationBatchCreateSchema = z.object({
  vacations: z.array(vacationCreateSchema),
});

export const vacationBatchUpdateSchema = z.object({
  vacations: z
    .array(
      z.object({
        id: z.string().uuid("Férias inválidas"),
        data: vacationUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma férias deve ser fornecida"),
});

export const vacationBatchDeleteSchema = z.object({
  vacationIds: z.array(z.string().uuid("Férias inválidas")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const vacationQuerySchema = z.object({
  include: vacationIncludeSchema.optional(),
});

// =====================
// Specialized Operations Schemas
// =====================

export const vacationGetByIdSchema = z.object({
  include: vacationIncludeSchema.optional(),
  id: z.string().uuid("Férias inválidas"),
});

// =====================
// Inferred Types
// =====================

export type VacationGetManyFormData = z.infer<typeof vacationGetManySchema>;
export type VacationGetByIdFormData = z.infer<typeof vacationGetByIdSchema>;
export type VacationQueryFormData = z.infer<typeof vacationQuerySchema>;

export type VacationCreateFormData = z.infer<typeof vacationCreateSchema>;
export type VacationUpdateFormData = z.infer<typeof vacationUpdateSchema>;

export type VacationBatchCreateFormData = z.infer<typeof vacationBatchCreateSchema>;
export type VacationBatchUpdateFormData = z.infer<typeof vacationBatchUpdateSchema>;
export type VacationBatchDeleteFormData = z.infer<typeof vacationBatchDeleteSchema>;

export type VacationInclude = z.infer<typeof vacationIncludeSchema>;
export type VacationOrderBy = z.infer<typeof vacationOrderBySchema>;
export type VacationWhere = z.infer<typeof vacationWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapVacationToFormData = createMapToFormDataHelper<Vacation, VacationUpdateFormData>((vacation) => ({
  startAt: vacation.startAt,
  endAt: vacation.endAt,
  type: vacation.type,
  status: vacation.status,
}));
