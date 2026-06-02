import { z } from 'zod';
import {
  BankTransactionType,
  BankTransactionSubtype,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';

// String-aware boolean for query flags. `z.coerce.boolean()` treats the string
// "false" as truthy (Boolean of a non-empty string), inverting `?flag=false`.
const queryBoolean = z.preprocess(v => v === 'true' || v === true, z.boolean());

// Accepts a single value, an array, or a comma-separated string ("a,b,c") and
// normalizes to a string array.
const csvStringArray = z
  .union([z.string(), z.array(z.string())])
  .transform(v => (Array.isArray(v) ? v : v.split(',').map(s => s.trim()).filter(Boolean)));

export const transactionsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  // Lifecycle: PENDING / RECONCILED / PARTIAL / IGNORED / DISPUTED. Multi-select
  // via comma-separated values; the service splits on commas.
  reconciliationStatus: z
    .union([z.nativeEnum(ReconciliationStatus), z.array(z.nativeEnum(ReconciliationStatus))])
    .optional(),
  // Dynamic taxonomy: filter by one or more TransactionCategory ids.
  categoryIds: csvStringArray.optional(),
  // 'any' (default) → transaction has at least one of the ids; 'all' → it has
  // every requested id.
  categoryMatch: z.enum(['any', 'all']).default('any'),
  // Provenance of the category tag (AUTO fuzzy vs MANUAL).
  categorySource: z.nativeEnum(ReconciliationSource).optional(),
  // Whether the transaction expects an NF (replaces the old category=NF filter).
  expectsFiscalDocument: queryBoolean.optional(),
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
