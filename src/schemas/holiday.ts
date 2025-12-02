// packages/schemas/src/holiday.ts

import { z } from 'zod';
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from './common';
import type { Holiday } from '@types';
import { HOLIDAY_TYPE } from '@constants';

// =====================
// Include Schema
// =====================

export const holidayIncludeSchema = z
  .object({
    _count: z
      .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
      .optional(),
  })
  .optional();

// =====================
// OrderBy Schema
// =====================

export const holidayOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      date: orderByDirectionSchema.optional(),
      type: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          date: orderByDirectionSchema.optional(),
          type: orderByDirectionSchema.optional(),
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

export const holidayWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(holidayWhereSchema).optional(),
      OR: z.array(holidayWhereSchema).optional(),
      NOT: holidayWhereSchema.optional(),

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
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
          }),
        ])
        .optional(),

      // Enum fields
      type: z
        .union([
          z.enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]]).nullable(),
          z.object({
            equals: z
              .enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]])
              .nullable()
              .optional(),
            not: z
              .enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]])
              .nullable()
              .optional(),
            in: z.array(z.enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]])).optional(),
            notIn: z.array(z.enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]])).optional(),
          }),
        ])
        .optional(),

      // Date fields
      date: z
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
    })
    .optional(),
);

// =====================
// Convenience Filters
// =====================

const holidayFilters = {
  searchingFor: z.string().optional(),
  types: z.array(z.enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]])).optional(),
  names: z.array(z.string()).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  dateRange: z
    .object({
      start: z.coerce.date().optional(),
      end: z.coerce.date().optional(),
    })
    .refine(data => !data.start || !data.end || data.end >= data.start, {
      message: 'Data final deve ser posterior à inicial',
      path: ['end'],
    })
    .optional(),
  isRecurring: z.boolean().optional(),
  isNational: z.boolean().optional(),
  isUpcoming: z.boolean().optional(),
};

// =====================
// Transform Function
// =====================

const holidayTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const {
    searchingFor,
    types,
    names,
    year,
    month,
    dateRange,
    isRecurring: _isRecurring,
    isNational,
    isUpcoming,
  } = data;

  const andConditions: any[] = [];

  // Text search
  if (searchingFor) {
    andConditions.push({
      OR: [{ name: { contains: searchingFor, mode: 'insensitive' } }],
    });
  }

  // Type filter
  if (types?.length) {
    andConditions.push({ type: { in: types } });
  }

  // Names filter
  if (names?.length) {
    andConditions.push({ name: { in: names } });
  }

  // Year filter
  if (year) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    andConditions.push({
      date: {
        gte: yearStart,
        lt: yearEnd,
      },
    });
  }

  // Month filter (requires year or current year assumed)
  if (month) {
    const currentYear = year || new Date().getFullYear();
    const monthStart = new Date(currentYear, month - 1, 1);
    const monthEnd = new Date(currentYear, month, 1);
    andConditions.push({
      date: {
        gte: monthStart,
        lt: monthEnd,
      },
    });
  }

  // Date range filter
  if (dateRange) {
    const dateCondition: any = {};
    if (dateRange.start) dateCondition.gte = dateRange.start;
    if (dateRange.end) {
      // Include the end date by adding one day
      const endDate = new Date(dateRange.end);
      endDate.setDate(endDate.getDate() + 1);
      dateCondition.lt = endDate;
    }
    if (Object.keys(dateCondition).length > 0) {
      andConditions.push({ date: dateCondition });
    }
  }

  // National holiday filter
  if (isNational !== undefined) {
    andConditions.push({
      type: isNational ? HOLIDAY_TYPE.NATIONAL : { not: HOLIDAY_TYPE.NATIONAL },
    });
  }

  // Upcoming filter
  if (isUpcoming) {
    andConditions.push({
      date: {
        gte: new Date(),
      },
    });
  }

  // Apply conditions to where clause
  if (andConditions.length > 0) {
    if (data.where) {
      data.where = data.where.AND
        ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schema
// =====================

export const holidayGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: holidayWhereSchema.optional(),
    orderBy: holidayOrderBySchema.optional(),
    include: holidayIncludeSchema.optional(),

    // Convenience filters
    ...holidayFilters,

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
  })
  .transform(holidayTransform);

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const holidayCreateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Nome do feriado é obrigatório')
      .max(100, 'Nome deve ter no máximo 100 caracteres'),
    date: z.coerce.date({ required_error: 'Data é obrigatória' }),
    type: z
      .enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]])
      .nullable()
      .optional(),
  })
  .transform(toFormData);

export const holidayUpdateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Nome do feriado é obrigatório')
      .max(100, 'Nome deve ter no máximo 100 caracteres')
      .optional(),
    date: z.coerce.date().optional(),
    type: z
      .enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]])
      .nullable()
      .optional(),
  })
  .transform(toFormData);

export const holidayGetByIdSchema = z.object({
  include: holidayIncludeSchema.optional(),
  id: z.string().uuid('Feriado inválido'),
});

// =====================
// Batch Operations Schemas
// =====================

export const holidayBatchCreateSchema = z.object({
  holidays: z.array(holidayCreateSchema).min(1, 'Pelo menos um feriado deve ser fornecido'),
});

export const holidayBatchUpdateSchema = z.object({
  holidays: z
    .array(
      z.object({
        id: z.string().uuid('Feriado inválido'),
        data: holidayUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um feriado deve ser fornecido'),
});

export const holidayBatchDeleteSchema = z.object({
  holidayIds: z
    .array(z.string().uuid('Feriado inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const holidayQuerySchema = z.object({
  include: holidayIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type HolidayGetManyFormData = z.infer<typeof holidayGetManySchema>;
export type HolidayGetByIdFormData = z.infer<typeof holidayGetByIdSchema>;
export type HolidayQueryFormData = z.infer<typeof holidayQuerySchema>;
export type HolidayCreateFormData = z.infer<typeof holidayCreateSchema>;
export type HolidayUpdateFormData = z.infer<typeof holidayUpdateSchema>;
export type HolidayBatchCreateFormData = z.infer<typeof holidayBatchCreateSchema>;
export type HolidayBatchUpdateFormData = z.infer<typeof holidayBatchUpdateSchema>;
export type HolidayBatchDeleteFormData = z.infer<typeof holidayBatchDeleteSchema>;

export type HolidayInclude = z.infer<typeof holidayIncludeSchema>;
export type HolidayOrderBy = z.infer<typeof holidayOrderBySchema>;
export type HolidayWhere = z.infer<typeof holidayWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapHolidayToFormData = createMapToFormDataHelper<Holiday, HolidayUpdateFormData>(
  holiday => ({
    name: holiday.name,
    date: holiday.date,
    type: holiday.type,
  }),
);
