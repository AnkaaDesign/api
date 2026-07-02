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
    // Optional: resolve the part of the payment NOT backed by an NF with a
    // reason only (frete, seguro estendido, taxas de marketplace…) — NO
    // category tag. When present, the tx is reconciled and the reason is
    // appended to the notes. Omit to leave the remainder open (→ Parcial).
    remainderReason: z.enum(['FRETE', 'SEGURO', 'TAXAS', 'OUTROS']).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine(data => {
    if (!data.allocations) return true;
    return data.allocations.every(a => data.fiscalDocumentIds.includes(a.fiscalDocumentId));
  }, 'Alocações devem referenciar documentos selecionados');

export type ManualMatchDto = z.infer<typeof manualMatchSchema>;
