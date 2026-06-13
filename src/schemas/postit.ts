// postit.ts
// Post-its pessoais (mural de lembretes) — sempre restritos ao próprio usuário.

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createBooleanWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
} from './common';

// Paleta fixa de cores dos post-its (cores nomeadas, render no front).
export const POSTIT_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'] as const;

// =====================
// Include Schema
// =====================
export const postitIncludeSchema = z
  .object({
    user: z.boolean().optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================
const postitOrderByFields = {
  id: orderByDirectionSchema.optional(),
  position: orderByDirectionSchema.optional(),
  color: orderByDirectionSchema.optional(),
  isArchived: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const postitOrderBySchema = z
  .union([
    z.object(postitOrderByFields).partial(),
    z.array(z.object(postitOrderByFields).partial()),
  ])
  .optional();

// =====================
// Where Schema
// =====================
export const postitWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(postitWhereSchema).optional(),
      OR: z.array(postitWhereSchema).optional(),
      NOT: postitWhereSchema.optional(),
      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      content: createStringWhereSchema().optional(),
      color: createStringWhereSchema().optional(),
      isArchived: createBooleanWhereSchema().optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Filters & Transform
// =====================
const postitFilters = {
  searchingFor: z.string().optional(),
  isArchived: z.boolean().optional(),
};

const postitTransform = (data: any) => {
  if (data.orderBy) data.orderBy = normalizeOrderBy(data.orderBy);
  if (data.take && !data.limit) data.limit = data.take;
  delete data.take;

  const andConditions: any[] = [];
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      content: { contains: data.searchingFor.trim(), mode: 'insensitive' },
    });
    delete data.searchingFor;
  }
  if (typeof data.isArchived === 'boolean') {
    andConditions.push({ isArchived: data.isArchived });
    delete data.isArchived;
  }
  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================
export const postitGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: postitWhereSchema.optional(),
    orderBy: postitOrderBySchema.optional(),
    include: postitIncludeSchema.optional(),
    ...postitFilters,
  })
  .transform(postitTransform);

export const postitQuerySchema = z.object({
  include: postitIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================
export const postitCreateSchema = z.object({
  content: z.string().max(2000, 'Máximo de 2000 caracteres').default(''),
  color: z.enum(POSTIT_COLORS as unknown as [string, ...string[]]).optional(),
  position: z.number().int().min(0).optional(),
});

export const postitUpdateSchema = z.object({
  content: z.string().max(2000, 'Máximo de 2000 caracteres').optional(),
  color: z.enum(POSTIT_COLORS as unknown as [string, ...string[]]).optional(),
  position: z.number().int().min(0).optional(),
  isArchived: z.boolean().optional(),
});

// Reordenação por arrastar-e-soltar: lista completa de IDs na nova ordem.
export const postitReorderSchema = z.object({
  postitIds: z
    .array(z.string().uuid({ message: 'Post-it inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Inferred Types
// =====================
export type PostitGetManyFormData = z.infer<typeof postitGetManySchema>;
export type PostitQueryFormData = z.infer<typeof postitQuerySchema>;
export type PostitCreateFormData = z.infer<typeof postitCreateSchema>;
export type PostitUpdateFormData = z.infer<typeof postitUpdateSchema>;
export type PostitReorderFormData = z.infer<typeof postitReorderSchema>;
export type PostitInclude = z.infer<typeof postitIncludeSchema>;
export type PostitOrderBy = z.infer<typeof postitOrderBySchema>;
export type PostitWhere = z.infer<typeof postitWhereSchema>;
