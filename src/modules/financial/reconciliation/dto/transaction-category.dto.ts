import { z } from 'zod';
import { TransactionCategoryKind } from '@prisma/client';

export const listCategoriesQuerySchema = z.object({
  kind: z.nativeEnum(TransactionCategoryKind).optional(),
  isRecurring: z.coerce.boolean().optional(),
  includeInactive: z.coerce.boolean().optional(),
});
export type ListCategoriesQueryDto = z.infer<typeof listCategoriesQuerySchema>;

export const createCategorySchema = z.object({
  name: z.string().min(1).max(80),
  // Runtime-created categories are transaction-only or service. Item-derived
  // ones are mirrored from ItemCategory and not hand-created here.
  kind: z
    .nativeEnum(TransactionCategoryKind)
    .refine(k => k !== TransactionCategoryKind.ITEM_DERIVED, {
      message: 'Categorias derivadas de item não podem ser criadas manualmente',
    }),
  isResolving: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  color: z.string().max(32).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateCategoryDto = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isResolving: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  color: z.string().max(32).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;
