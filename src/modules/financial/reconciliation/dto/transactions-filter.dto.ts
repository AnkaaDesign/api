import { z } from 'zod';
import {
  BankTransactionType,
  ReconciliationMatchStatus,
  ReconciliationMatchType,
  BankTransactionSubtype,
} from '@prisma/client';

export const transactionsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  matchStatus: z.nativeEnum(ReconciliationMatchStatus).optional(),
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
