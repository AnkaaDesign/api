import { z } from 'zod';
import {
  FiscalDocumentOperation,
  FiscalDocumentStatus,
  FiscalDocumentType,
} from '@prisma/client';

export const fiscalDocumentsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  docType: z.nativeEnum(FiscalDocumentType).optional(),
  operationType: z.nativeEnum(FiscalDocumentOperation).optional(),
  status: z.nativeEnum(FiscalDocumentStatus).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  emitCnpj: z.string().optional(),
  destCnpj: z.string().optional(),
  search: z.string().optional(),
  valueMin: z.coerce.number().optional(),
  valueMax: z.coerce.number().optional(),
  hasMatch: z.coerce.boolean().optional(),
  sortBy: z.enum(['issueDate', 'totalValue']).default('issueDate'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type FiscalDocumentsFilterDto = z.infer<typeof fiscalDocumentsFilterSchema>;
