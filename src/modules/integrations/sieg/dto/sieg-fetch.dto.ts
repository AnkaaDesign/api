import { z } from 'zod';
import { FiscalDocumentType } from '@prisma/client';

export const siegFetchSchema = z.object({
  dateStart: z.string().refine(v => !Number.isNaN(Date.parse(v)), 'dateStart inválido'),
  dateEnd: z.string().refine(v => !Number.isNaN(Date.parse(v)), 'dateEnd inválido'),
  xmlType: z
    .enum([
      FiscalDocumentType.NFE,
      FiscalDocumentType.NFSE,
      FiscalDocumentType.CTE,
      FiscalDocumentType.NFCE,
      FiscalDocumentType.CFE,
    ])
    .optional(),
  cnpjEmit: z.string().regex(/^\d{14}$/).optional(),
  cnpjDest: z.string().regex(/^\d{14}$/).optional(),
});

export type SiegFetchDto = z.infer<typeof siegFetchSchema>;
