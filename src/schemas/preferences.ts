// packages/schemas/src/preference.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema } from "./common";
import { COLOR_SCHEMA, FAVORITE_PAGES } from '@constants';
import type { Preferences } from '@types';

// =====================
// Include Schema Based on Prisma Schema
// =====================

export const preferencesIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial()
  .optional();

// =====================
// OrderBy Schema
// =====================

export const preferencesOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        colorSchema: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        favorites: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          colorSchema: orderByDirectionSchema.optional(),
          userId: orderByDirectionSchema.optional(),
          favorites: orderByDirectionSchema.optional(),
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

export const preferencesWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([preferencesWhereSchema, z.array(preferencesWhereSchema)]).optional(),
      OR: z.array(preferencesWhereSchema).optional(),
      NOT: z.union([preferencesWhereSchema, z.array(preferencesWhereSchema)]).optional(),

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

      colorSchema: z
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

      favorites: z
        .object({
          has: z.enum(Object.values(FAVORITE_PAGES) as [string, ...string[]]).optional(),
          hasEvery: z.array(z.enum(Object.values(FAVORITE_PAGES) as [string, ...string[]])).optional(),
          hasSome: z.array(z.enum(Object.values(FAVORITE_PAGES) as [string, ...string[]])).optional(),
          isEmpty: z.boolean().optional(),
        })
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
    .partial(),
);

// =====================
// Query Schema
// =====================

export const preferencesGetManySchema = z.object({
  where: preferencesWhereSchema.optional(),
  orderBy: preferencesOrderBySchema.optional(),
  include: preferencesIncludeSchema.optional(),
  page: z.coerce.number().int().min(0).default(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20).optional(),

  // Convenience filters
  userId: z.string().uuid("Usuário inválido").optional(),
  colorSchema: z
    .enum(Object.values(COLOR_SCHEMA) as [string, ...string[]], {
      errorMap: () => ({ message: "esquema de cores inválido" }),
    })
    .optional(),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const preferencesCreateSchema = z
  .object({
    userId: z.string().uuid("Usuário inválido"),
    colorSchema: z
      .enum(Object.values(COLOR_SCHEMA) as [string, ...string[]], {
        errorMap: () => ({ message: "esquema de cores inválido" }),
      })
      .default(COLOR_SCHEMA.LIGHT),
    favorites: z
      .array(
        z.enum(Object.values(FAVORITE_PAGES) as [string, ...string[]], {
          errorMap: () => ({ message: "página favorita inválida" }),
        }),
      )
      .default([])
      .optional(),
  })
  .transform(toFormData);

export const preferencesUpdateSchema = z
  .object({
    colorSchema: z
      .enum(Object.values(COLOR_SCHEMA) as [string, ...string[]], {
        errorMap: () => ({ message: "esquema de cores inválido" }),
      })
      .optional(),
    favorites: z
      .array(
        z.enum(Object.values(FAVORITE_PAGES) as [string, ...string[]], {
          errorMap: () => ({ message: "página favorita inválida" }),
        }),
      )
      .default([])
      .optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const preferencesBatchCreateSchema = z.object({
  preferences: z.array(preferencesCreateSchema).min(1, "Pelo menos uma preferência deve ser fornecida"),
});

export const preferencesBatchUpdateSchema = z.object({
  preferences: z
    .array(
      z.object({
        id: z.string().uuid("Preferências inválidas"),
        data: preferencesUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma preferência deve ser fornecida"),
});

export const preferencesBatchDeleteSchema = z.object({
  preferenceIds: z.array(z.string().uuid("Preferências inválidas")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const preferencesQuerySchema = z.object({
  include: preferencesIncludeSchema.optional(),
});

// =====================
// Specialized Operations Schemas
// =====================

export const preferencesGetByIdSchema = z.object({
  include: preferencesIncludeSchema.optional(),
  id: z.string().uuid("Preferências inválidas"),
});

// =====================
// Type Inference (FormData types)
// =====================

export type PreferencesGetManyFormData = z.infer<typeof preferencesGetManySchema>;
export type PreferencesGetByIdFormData = z.infer<typeof preferencesGetByIdSchema>;
export type PreferencesQueryFormData = z.infer<typeof preferencesQuerySchema>;

export type PreferencesCreateFormData = z.infer<typeof preferencesCreateSchema>;
export type PreferencesUpdateFormData = z.infer<typeof preferencesUpdateSchema>;

export type PreferencesBatchCreateFormData = z.infer<typeof preferencesBatchCreateSchema>;
export type PreferencesBatchUpdateFormData = z.infer<typeof preferencesBatchUpdateSchema>;
export type PreferencesBatchDeleteFormData = z.infer<typeof preferencesBatchDeleteSchema>;

export type PreferencesInclude = z.infer<typeof preferencesIncludeSchema>;
export type PreferencesOrderBy = z.infer<typeof preferencesOrderBySchema>;
export type PreferencesWhere = z.infer<typeof preferencesWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapPreferencesToFormData = createMapToFormDataHelper<Preferences, PreferencesUpdateFormData>((preferences) => ({
  colorSchema: preferences.colorSchema,
  favorites: preferences.favorites,
}));
