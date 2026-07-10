// note.ts
// Notas unificadas (antigos post-its + bloco de anotações). Visibilidade por
// dono OU compartilhamento; regras de edição/gestão aplicadas no service.

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
  normalizeSearchTerm,
} from './common';

// Paleta fixa de cores das notas (cores nomeadas, render no front).
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'] as const;

// =====================
// Include Schema
// =====================
export const noteIncludeSchema = z
  .object({
    owner: z.boolean().optional(),
    shares: z.boolean().optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================
const noteOrderByFields = {
  id: orderByDirectionSchema.optional(),
  title: orderByDirectionSchema.optional(),
  position: orderByDirectionSchema.optional(),
  color: orderByDirectionSchema.optional(),
  isArchived: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const noteOrderBySchema = z
  .union([z.object(noteOrderByFields).partial(), z.array(z.object(noteOrderByFields).partial())])
  .optional();

// =====================
// Where Schema
// =====================
export const noteWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(noteWhereSchema).optional(),
      OR: z.array(noteWhereSchema).optional(),
      NOT: noteWhereSchema.optional(),
      id: createUuidWhereSchema().optional(),
      ownerId: createUuidWhereSchema().optional(),
      title: createStringWhereSchema().optional(),
      content: createStringWhereSchema().optional(),
      color: createStringWhereSchema().optional(),
      isArchived: createBooleanWhereSchema().optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Shared-with input (compartilhamento com usuário)
// =====================
export const noteShareInputSchema = z.object({
  userId: z.string().uuid({ message: 'Usuário inválido' }),
  canEdit: z.boolean().default(false),
});

// =====================
// Filters & Transform
// =====================
const noteFilters = {
  searchingFor: z.string().optional(),
  isArchived: z.boolean().optional(),
  // Escopo de visibilidade — o filtro por dono/compartilhamento é aplicado no
  // service (depende do usuário autenticado). Mantido no objeto para leitura.
  scope: z.enum(['owned', 'shared', 'all']).optional(),
};

const noteTransform = (data: any) => {
  if (data.orderBy) data.orderBy = normalizeOrderBy(data.orderBy);
  if (data.take && !data.limit) data.limit = data.take;
  delete data.take;

  const andConditions: any[] = [];
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const term = normalizeSearchTerm(data.searchingFor.trim());
    andConditions.push({
      OR: [{ contentNormalized: { contains: term } }, { titleNormalized: { contains: term } }],
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
export const noteGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: noteWhereSchema.optional(),
    orderBy: noteOrderBySchema.optional(),
    include: noteIncludeSchema.optional(),
    ...noteFilters,
  })
  .transform(noteTransform);

export const noteQuerySchema = z.object({
  include: noteIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================
export const noteCreateSchema = z.object({
  title: z.string().max(200, 'Máximo de 200 caracteres').nullable().optional(),
  content: z.string().max(2000, 'Máximo de 2000 caracteres').default(''),
  color: z.enum(NOTE_COLORS as unknown as [string, ...string[]]).optional(),
  // No canvas livre, `position` funciona como z-index (ordem de empilhamento) e
  // pode ser negativo (enviar para trás). Sem piso em 0.
  position: z.number().int().optional(),
  // Canvas livre: coordenadas e tamanho (px / unidades do board). Nuláveis.
  positionX: z.number().nullable().optional(),
  positionY: z.number().nullable().optional(),
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
  // Compartilhamento opcional já na criação.
  shareWith: z.array(noteShareInputSchema).optional(),
});

export const noteUpdateSchema = z.object({
  title: z.string().max(200, 'Máximo de 200 caracteres').nullable().optional(),
  content: z.string().max(2000, 'Máximo de 2000 caracteres').optional(),
  color: z.enum(NOTE_COLORS as unknown as [string, ...string[]]).optional(),
  // z-index do canvas — pode ser negativo (enviar para trás).
  position: z.number().int().optional(),
  isArchived: z.boolean().optional(),
  // Canvas livre: coordenadas e tamanho (px / unidades do board). Nuláveis.
  positionX: z.number().nullable().optional(),
  positionY: z.number().nullable().optional(),
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
});

// Substituição completa do conjunto de compartilhamentos da nota.
export const noteShareSchema = z.object({
  shares: z.array(noteShareInputSchema),
});

// Reordenação por arrastar-e-soltar: lista completa de IDs na nova ordem.
export const noteReorderSchema = z.object({
  noteIds: z
    .array(z.string().uuid({ message: 'Nota inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Inferred Types
// =====================
export type NoteGetManyFormData = z.infer<typeof noteGetManySchema>;
export type NoteQueryFormData = z.infer<typeof noteQuerySchema>;
export type NoteCreateFormData = z.infer<typeof noteCreateSchema>;
export type NoteUpdateFormData = z.infer<typeof noteUpdateSchema>;
export type NoteShareFormData = z.infer<typeof noteShareSchema>;
export type NoteShareInput = z.infer<typeof noteShareInputSchema>;
export type NoteReorderFormData = z.infer<typeof noteReorderSchema>;
export type NoteInclude = z.infer<typeof noteIncludeSchema>;
export type NoteOrderBy = z.infer<typeof noteOrderBySchema>;
export type NoteWhere = z.infer<typeof noteWhereSchema>;
