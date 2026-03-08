import { z } from 'zod';
import { NFSE_STATUS } from '../constants/enums';

export const nfseStatusSchema = z.nativeEnum(NFSE_STATUS);

export const nfseEmitSchema = z.object({
  invoiceId: z.string().uuid(),
});

export type NfseEmitFormData = z.infer<typeof nfseEmitSchema>;

export const nfseCancelSchema = z.object({
  reason: z.string().min(15).max(500),
});

export type NfseCancelFormData = z.infer<typeof nfseCancelSchema>;
