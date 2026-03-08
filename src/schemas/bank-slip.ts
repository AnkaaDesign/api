import { z } from 'zod';
import { BANK_SLIP_STATUS } from '../constants/enums';

export const bankSlipStatusSchema = z.nativeEnum(BANK_SLIP_STATUS);

export const bankSlipRegenerateSchema = z.object({
  installmentId: z.string().uuid(),
});

export type BankSlipRegenerateFormData = z.infer<typeof bankSlipRegenerateSchema>;

export const bankSlipCancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type BankSlipCancelFormData = z.infer<typeof bankSlipCancelSchema>;
