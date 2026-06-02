import { z } from 'zod';
import {
  FiscalDocumentOperation,
  FiscalDocumentStatus,
  FiscalDocumentType,
} from '@prisma/client';

// String-aware boolean for query flags. `z.coerce.boolean()` treats the string
// "false" as truthy (Boolean of a non-empty string), inverting `?flag=false`.
const queryBoolean = z.preprocess(v => v === 'true' || v === true, z.boolean());

export const fiscalDocumentsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  docType: z.nativeEnum(FiscalDocumentType).optional(),
  operationType: z.nativeEnum(FiscalDocumentOperation).optional(),
  status: z.nativeEnum(FiscalDocumentStatus).optional(),
  // ZodValidationPipe auto-converts ISO/`YYYY-MM-DD` strings to `Date` objects
  // before this schema runs, so we accept either form and normalize back to a
  // string for `new Date()` in the service.
  dateFrom: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
  dateTo: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
  emitCnpj: z.string().optional(),
  destCnpj: z.string().optional(),
  search: z.string().optional(),
  valueMin: z.coerce.number().optional(),
  valueMax: z.coerce.number().optional(),
  hasMatch: queryBoolean.optional(),
  sortBy: z.enum(['issueDate', 'totalValue']).default('issueDate'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type FiscalDocumentsFilterDto = z.infer<typeof fiscalDocumentsFilterSchema>;
