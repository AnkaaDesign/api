import { z } from 'zod';

// Global spotlight search query (GET /search)
export const globalSearchSchema = z.object({
  searchingFor: z
    .string({ required_error: 'Termo de busca é obrigatório' })
    .trim()
    .min(2, 'Digite pelo menos 2 caracteres')
    .max(200, 'Termo de busca muito longo'),
  limit: z.coerce.number().int().min(1).max(10).optional().default(5),
});

export type GlobalSearchFormData = z.infer<typeof globalSearchSchema>;
