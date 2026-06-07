// packages/schemas/src/statistics-preferences.ts

import { z } from 'zod';

// =====================
// Helpers
// =====================

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

// A statistics page config is always a JSON object (page-specific shape is
// validated client-side; the API stores it opaquely like dashboard layouts).
const statisticsConfigSchema = z.record(jsonValueSchema);

const pageKeySchema = z
  .string()
  .min(1, 'Página inválida')
  .max(200, 'Página inválida');

// =====================
// Page Config (last-seen) Schemas
// =====================

export const statisticsPageConfigUpsertSchema = z.object({
  pageKey: pageKeySchema,
  config: statisticsConfigSchema,
});

export type StatisticsPageConfigUpsertFormData = z.infer<
  typeof statisticsPageConfigUpsertSchema
>;

// =====================
// Preset Schemas
// =====================

export const statisticsPresetCreateSchema = z.object({
  pageKey: pageKeySchema,
  name: z
    .string()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),
  config: statisticsConfigSchema,
});

export type StatisticsPresetCreateFormData = z.infer<typeof statisticsPresetCreateSchema>;

export const statisticsPresetUpdateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Nome é obrigatório')
      .max(100, 'Nome deve ter no máximo 100 caracteres')
      .optional(),
    config: statisticsConfigSchema.optional(),
  })
  .refine(data => data.name !== undefined || data.config !== undefined, {
    message: 'Nada para atualizar',
  });

export type StatisticsPresetUpdateFormData = z.infer<typeof statisticsPresetUpdateSchema>;

// =====================
// Query Schemas
// =====================

export const statisticsPreferencesGetSchema = z.object({
  pageKey: pageKeySchema.optional(),
});

export type StatisticsPreferencesGetFormData = z.infer<typeof statisticsPreferencesGetSchema>;
