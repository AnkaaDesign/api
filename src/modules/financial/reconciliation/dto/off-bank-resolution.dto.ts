import { FiscalDocOffBankResolution } from '@prisma/client';
import { z } from 'zod';

/**
 * Manually set (or clear) the off-bank settlement of a received note — a note
 * that will never match a bank line (credit-card / bonificação / no-payment).
 * `resolution: null` clears it so the note expects a bank match again.
 */
export const offBankResolutionSchema = z.object({
  resolution: z.nativeEnum(FiscalDocOffBankResolution).nullable(),
  notes: z.string().trim().max(500).optional(),
});

export type OffBankResolutionDto = z.infer<typeof offBankResolutionSchema>;
