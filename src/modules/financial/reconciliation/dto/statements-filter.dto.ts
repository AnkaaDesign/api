import { z } from 'zod';
import { BankStatementImportStatus, BankStatementSource } from '@prisma/client';

export const statementsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(BankStatementImportStatus).optional(),
  source: z.nativeEnum(BankStatementSource).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(['importedAt', 'periodStart']).default('importedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type StatementsFilterDto = z.infer<typeof statementsFilterSchema>;
