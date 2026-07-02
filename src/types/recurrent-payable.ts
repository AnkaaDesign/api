// src/types/recurrent-payable.ts
// Contas Recorrentes — first-class rent/internet/energy/water bills that
// materialize a monthly occurrence into Contas a Pagar.
//
// Source-of-truth type for the RecurrentPayable / RecurrentPayableOccurrence
// Prisma models (api/prisma/schema.prisma). web/src/types/recurrent-payable.ts
// mirrors this. Not wired into controllers/services — documentation only.

import type { BaseEntity } from './common';
import type { PAYMENT_METHOD, SCHEDULE_FREQUENCY, SCHEDULE_RUN_STATUS } from '@constants';
import type { Supplier } from './supplier';

// FIXED = known monthly amount (rent); VARIABLE = estimated, real value typed on
// payment (energy/water). No Prisma-exported enum exists for these in this repo,
// so they are modeled as string-literal unions (matching the schema's
// RecurrenceKind / RecurrentPayableStatus).
export type RECURRENCE_KIND = 'FIXED' | 'VARIABLE';

export type RECURRENT_PAYABLE_STATUS = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';

// =====================
// Main Entity Interfaces
// =====================

export interface RecurrentPayable extends BaseEntity {
  name: string;
  description: string | null;
  // Payee: a real Supplier (preferred) or a free-text fallback.
  supplierId: string | null;
  payeeName: string | null;
  // Tomador document — a CNPJ (companies; drives NF auto-linking) or a CPF
  // (individuals). At most one is set.
  payeeCnpj: string | null;
  payeeCpf: string | null;
  // PIX key to pay this bill — only meaningful when paymentMethod = PIX.
  pixKey: string | null;
  categoryId: string;
  amountKind: RECURRENCE_KIND;
  // Decimal(12,2) columns; serialized as number (api convention).
  fixedAmount: number | null;
  estimatedAmount: number | null;
  frequency: SCHEDULE_FREQUENCY;
  frequencyCount: number;
  dueDayOfMonth: number;
  paymentMethod: PAYMENT_METHOD | null;
  expectsNf: boolean;
  isActive: boolean;
  // Cron-claim fields (same semantics as OrderSchedule).
  nextRun: Date | null;
  lastRun: Date | null;
  lastFiredAt: Date | null;
  lastRunStatus: SCHEDULE_RUN_STATUS | null;
  lastRunError: string | null;
  finishedAt: Date | null;
  createdById: string | null;

  // Relations (optional, populated based on query)
  // Detail/list endpoints select a Supplier subset (id, fantasyName, cnpj).
  supplier?: Pick<Supplier, 'id' | 'fantasyName' | 'cnpj'> | null;
  // TransactionCategory (no api source-of-truth type yet) — minimal shape.
  category?: { id: string; name: string } | null;
  // findById returns the last 12 occurrences.
  occurrences?: RecurrentPayableOccurrence[];
}

export interface RecurrentPayableOccurrence extends BaseEntity {
  recurrentPayableId: string;
  // Competence month (YYYY-MM).
  competence: string;
  dueDate: Date;
  estimatedAmount: number;
  paidAmount: number | null;
  status: RECURRENT_PAYABLE_STATUS;
  paidAt: Date | null;
  paidById: string | null;
  paymentMethod: PAYMENT_METHOD | null;
  expectsNf: boolean;
  // Set by the daily recurrent-payable sweeps (RecurrentPayableService).
  fiscalDocumentId: string | null;
  bankTransactionId: string | null;
  nfLinkedAt: Date | null;
  reconciledAt: Date | null;

  // Relations (optional, populated based on query)
  recurrentPayable?: RecurrentPayable;
}
