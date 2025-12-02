// packages/schemas/src/bonus.ts
// Clean bonus schema - simplified structure
// Period dates and task counts are computed from year/month and tasks relation

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  moneySchema,
  nullableDate,
} from './common';
import type { Bonus } from '@types';

// =====================
// Include Schema
// =====================

export const bonusIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              position: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    users: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              position: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    tasks: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              customer: z.boolean().optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
    bonusDiscounts: z
      .union([
        z.boolean(),
        z.object({
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
    payroll: z.boolean().optional(),
  })
  .partial();

// =====================
// Where Schema
// =====================

export const bonusWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([bonusWhereSchema, z.array(bonusWhereSchema)]).optional(),
      OR: z.array(bonusWhereSchema).optional(),
      NOT: z.union([bonusWhereSchema, z.array(bonusWhereSchema)]).optional(),

      id: z
        .union([
          z.string(),
          z.object({
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),
      year: z
        .union([
          z.number(),
          z.object({
            in: z.array(z.number()).optional(),
            gte: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),
      month: z
        .union([
          z.number(),
          z.object({
            in: z.array(z.number()).optional(),
            gte: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),
      userId: z
        .union([
          z.string(),
          z.object({
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),
      performanceLevel: z
        .union([
          z.number(),
          z.object({
            in: z.array(z.number()).optional(),
            gte: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),
      baseBonus: z
        .union([
          z.number(),
          z.object({
            gte: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),
      createdAt: nullableDate.optional(),
      updatedAt: nullableDate.optional(),

      user: z
        .object({
          id: z.union([z.string(), z.object({ in: z.array(z.string()) })]).optional(),
          name: z
            .object({ contains: z.string(), mode: z.enum(['default', 'insensitive']).optional() })
            .optional(),
          sectorId: z.union([z.string(), z.object({ in: z.array(z.string()) })]).optional(),
          positionId: z.union([z.string(), z.object({ in: z.array(z.string()) })]).optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Order By Schema
// =====================

const bonusOrderByFieldsSchema = z
  .object({
    id: orderByDirectionSchema.optional(),
    year: orderByDirectionSchema.optional(),
    month: orderByDirectionSchema.optional(),
    performanceLevel: orderByDirectionSchema.optional(),
    baseBonus: orderByDirectionSchema.optional(),
    createdAt: orderByDirectionSchema.optional(),
    updatedAt: orderByDirectionSchema.optional(),
    user: z
      .object({
        name: orderByDirectionSchema.optional(),
      })
      .optional(),
    tasks: z
      .object({
        _count: orderByDirectionSchema.optional(),
      })
      .optional(),
  })
  .partial();

export const bonusOrderBySchema = z.union([
  bonusOrderByFieldsSchema,
  z.array(bonusOrderByFieldsSchema),
]);

// =====================
// CRUD Schemas
// =====================

export const bonusCreateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2099),
  month: z.coerce.number().int().min(1).max(12),
  userId: z.string().uuid(),
  performanceLevel: z.number().int().min(0).max(5),
  baseBonus: moneySchema,
  payrollId: z.string().uuid().optional(),
});

export const bonusUpdateSchema = z.object({
  performanceLevel: z.number().int().min(0).max(5).optional(),
  baseBonus: moneySchema.optional(),
  payrollId: z.string().uuid().nullable().optional(),
});

// =====================
// Query Schemas
// =====================

export const bonusGetManySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  include: bonusIncludeSchema.optional(),
  where: bonusWhereSchema.optional(),
  orderBy: bonusOrderBySchema.optional().default({ createdAt: 'desc' }),
  searchingFor: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2099).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  userId: z.string().uuid().optional(),
});

export const bonusGetByIdSchema = z.object({
  include: bonusIncludeSchema.optional(),
});

// =====================
// Period/Calculation Schemas
// =====================

export const bonusCalculateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2099),
  month: z.coerce.number().int().min(1).max(12),
  userId: z.string().uuid().optional(),
});

export const bonusLiveSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2099),
  month: z.coerce.number().int().min(1).max(12),
});

// =====================
// Batch Schemas
// =====================

export const bonusBatchCreateSchema = z.object({
  bonuses: z.array(bonusCreateSchema).min(1),
});

export const bonusBatchUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().uuid(),
        data: bonusUpdateSchema,
      }),
    )
    .min(1),
});

export const bonusBatchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

// =====================
// Transform for Search
// =====================

const bonusTransform = (data: any) => {
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.searchingFor && typeof data.searchingFor === 'string') {
    const searchTerm = data.searchingFor;
    data.where = {
      ...data.where,
      OR: [
        { year: { equals: parseInt(searchTerm) || undefined } },
        { month: { equals: parseInt(searchTerm) || undefined } },
        { user: { name: { contains: searchTerm, mode: 'insensitive' } } },
      ],
    };
    delete data.searchingFor;
  }
  return data;
};

export const bonusGetManyFormDataSchema = bonusGetManySchema.transform(bonusTransform);

// =====================
// Type Exports
// =====================

export type BonusInclude = z.infer<typeof bonusIncludeSchema>;
export type BonusWhere = z.infer<typeof bonusWhereSchema>;
export type BonusOrderBy = z.infer<typeof bonusOrderBySchema>;
export type BonusGetManyParams = z.infer<typeof bonusGetManySchema>;
export type BonusGetManyFormData = z.infer<typeof bonusGetManyFormDataSchema>;
export type BonusGetByIdParams = z.infer<typeof bonusGetByIdSchema>;
export type BonusGetByIdFormData = z.infer<typeof bonusGetByIdSchema>;
export type BonusCreateFormData = z.infer<typeof bonusCreateSchema>;
export type BonusUpdateFormData = z.infer<typeof bonusUpdateSchema>;
export type BonusCalculateParams = z.infer<typeof bonusCalculateSchema>;
export type BonusLiveParams = z.infer<typeof bonusLiveSchema>;
export type BonusBatchCreateFormData = z.infer<typeof bonusBatchCreateSchema>;
export type BonusBatchUpdateFormData = z.infer<typeof bonusBatchUpdateSchema>;
export type BonusBatchDeleteFormData = z.infer<typeof bonusBatchDeleteSchema>;

// =====================
// Utility Functions
// =====================

export const mapToBonusFormData = createMapToFormDataHelper<Bonus, BonusUpdateFormData>(bonus => ({
  baseBonus: typeof bonus.baseBonus === 'number' ? bonus.baseBonus : bonus.baseBonus.toNumber(),
  payrollId: bonus.payrollId ?? undefined,
  performanceLevel: bonus.performanceLevel,
}));

/**
 * Get period date range from year/month (26th prev month to 25th current month)
 */
export const getBonusPeriodRange = (year: number, month: number) => {
  const startDate =
    month === 1
      ? new Date(year - 1, 11, 26, 0, 0, 0, 0)
      : new Date(year, month - 2, 26, 0, 0, 0, 0);

  const endDate = new Date(year, month - 1, 25, 23, 59, 59, 999);

  return { startDate, endDate };
};
