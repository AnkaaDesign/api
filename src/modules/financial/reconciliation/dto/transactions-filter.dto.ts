import { z } from 'zod';
import {
  BankTransactionType,
  BankTransactionSubtype,
  ReconciliationCategory,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';

export const transactionsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  // Lifecycle: PENDING / RECONCILED / PARTIAL / IGNORED / DISPUTED. Multi-select
  // via comma-separated values; the service splits on commas.
  reconciliationStatus: z
    .union([z.nativeEnum(ReconciliationStatus), z.array(z.nativeEnum(ReconciliationStatus))])
    .optional(),
  // Category (NF / TRIBUTO / FOLHA / ...). Same multi-select semantics.
  category: z
    .union([z.nativeEnum(ReconciliationCategory), z.array(z.nativeEnum(ReconciliationCategory))])
    .optional(),
  reconciliationSource: z.nativeEnum(ReconciliationSource).optional(),
  matchType: z.nativeEnum(ReconciliationMatchType).optional(),
  type: z.nativeEnum(BankTransactionType).optional(),
  subtype: z.nativeEnum(BankTransactionSubtype).optional(),
  // ZodValidationPipe auto-converts ISO/`YYYY-MM-DD` strings to `Date` objects
  // before this schema runs, so we accept either form and normalize back to a
  // string for `new Date()` in the service.
  dateFrom: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
  dateTo: z
    .preprocess(v => (v instanceof Date ? v.toISOString() : v), z.string())
    .optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  counterparty: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['postedAt', 'amount']).default('postedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type TransactionsFilterDto = z.infer<typeof transactionsFilterSchema>;
