import { z } from 'zod';
import { ReconciliationCategory } from '@prisma/client';

export const changeCategorySchema = z.object({
  category: z.nativeEnum(ReconciliationCategory),
  // When true, persists a ReconciliationAlias mapping (memo fingerprint +
  // counterparty CNPJ) → category, so future imports auto-classify.
  saveAlias: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
});

export type ChangeCategoryDto = z.infer<typeof changeCategorySchema>;
