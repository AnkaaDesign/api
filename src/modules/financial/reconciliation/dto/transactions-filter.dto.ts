import { z } from 'zod';
import {
  BankTransactionType,
  ReconciliationMatchStatus,
  ReconciliationMatchType,
  BankTransactionSubtype,
} from '@prisma/client';

export const transactionsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  statementId: z.string().uuid().optional(),
  matchStatus: z.nativeEnum(ReconciliationMatchStatus).optional(),
  matchType: z.nativeEnum(ReconciliationMatchType).optional(),
  type: z.nativeEnum(BankTransactionType).optional(),
  subtype: z.nativeEnum(BankTransactionSubtype).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  counterparty: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['postedAt', 'amount']).default('postedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type TransactionsFilterDto = z.infer<typeof transactionsFilterSchema>;
