import { z } from 'zod';

export const manualMatchSchema = z
  .object({
    fiscalDocumentIds: z.array(z.string().uuid()).min(1, 'Selecione pelo menos uma nota fiscal'),
    allocations: z
      .array(
        z.object({
          fiscalDocumentId: z.string().uuid(),
          amount: z.number().positive('Valor alocado deve ser positivo'),
        }),
      )
      .optional(),
    notes: z.string().max(500).optional(),
  })
  .refine(data => {
    if (!data.allocations) return true;
    return data.allocations.every(a => data.fiscalDocumentIds.includes(a.fiscalDocumentId));
  }, 'Alocações devem referenciar documentos selecionados');

export type ManualMatchDto = z.infer<typeof manualMatchSchema>;
