import { z } from 'zod';

// Monthly-family cadences advance by months and use dueDayOfMonth; WEEKLY /
// BIWEEKLY advance by weeks and use daysOfWeek (e.g. a housemaid paid 2× a week).
const frequencySchema = z
  .enum([
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'BIMONTHLY',
    'QUARTERLY',
    'TRIANNUAL',
    'QUADRIMESTRAL',
    'SEMI_ANNUAL',
    'ANNUAL',
  ])
  .default('MONTHLY');

const WEEKLY_FREQUENCIES = ['WEEKLY', 'BIWEEKLY'];

const paymentMethodSchema = z.enum(['PIX', 'BANK_SLIP', 'CREDIT_CARD']);

const recurrentPayableBaseSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  description: z.string().trim().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  payeeName: z.string().trim().optional().nullable(),
  // Optional CNPJ of the payee (digits only, 14). Enables NF auto-linking.
  payeeCnpj: z
    .string()
    .trim()
    .transform(v => v.replace(/\D/g, ''))
    .refine(v => v.length === 0 || v.length === 14, 'CNPJ deve ter 14 dígitos')
    .transform(v => (v.length === 0 ? null : v))
    .optional()
    .nullable(),
  // Optional CPF of the payee (digits only, 11) — individuals. The Tomador is a
  // CPF OR a CNPJ; both are accepted but at most one is set by the UI.
  payeeCpf: z
    .string()
    .trim()
    .transform(v => v.replace(/\D/g, ''))
    .refine(v => v.length === 0 || v.length === 11, 'CPF deve ter 11 dígitos')
    .transform(v => (v.length === 0 ? null : v))
    .optional()
    .nullable(),
  // PIX key to pay this bill (only meaningful when paymentMethod = PIX). Stored
  // as entered; format detection/normalization happens client-side.
  pixKey: z
    .string()
    .trim()
    .max(500, 'Chave Pix deve ter no máximo 500 caracteres')
    .transform(v => (v.length === 0 ? null : v))
    .optional()
    .nullable(),
  categoryId: z.string().uuid({ message: 'Categoria é obrigatória' }),
  amountKind: z.enum(['FIXED', 'VARIABLE']).default('VARIABLE'),
  fixedAmount: z.number().nonnegative().optional().nullable(),
  estimatedAmount: z.number().nonnegative().optional().nullable(),
  frequency: frequencySchema,
  frequencyCount: z.number().int().min(1).default(1),
  // Monthly-family only (1-31); omit for weekly bills.
  dueDayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  // Weekly-family only: weekdays 0=Sun … 6=Sat; one or more.
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional().default([]),
  paymentMethod: paymentMethodSchema.optional().nullable(),
  expectsNf: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const createRecurrentPayableSchema = recurrentPayableBaseSchema
  .refine(d => d.amountKind !== 'FIXED' || (d.fixedAmount != null && d.fixedAmount > 0), {
    message: 'Contas fixas exigem um valor fixo (fixedAmount).',
    path: ['fixedAmount'],
  })
  .refine(
    d => !WEEKLY_FREQUENCIES.includes(d.frequency) || (d.daysOfWeek != null && d.daysOfWeek.length > 0),
    { message: 'Contas semanais exigem ao menos um dia da semana.', path: ['daysOfWeek'] },
  )
  .refine(d => WEEKLY_FREQUENCIES.includes(d.frequency) || d.dueDayOfMonth != null, {
    message: 'Informe o dia do vencimento (1-31).',
    path: ['dueDayOfMonth'],
  });

// On update the schema is partial, so the cadence refinements only apply when
// `frequency` is actually present in the payload — an amount-only PATCH must not
// be rejected. But when the caller DOES change the cadence they must supply the
// matching field (weekly → daysOfWeek, monthly-family → dueDayOfMonth); without
// this guard a switch to WEEKLY with no daysOfWeek silently materializes zero
// occurrences — a dead bill that never appears in Contas a Pagar.
export const updateRecurrentPayableSchema = recurrentPayableBaseSchema
  .partial()
  .refine(
    d => {
      // Cadence explicitly (re)set to weekly → daysOfWeek must be non-empty.
      if (d.frequency !== undefined) {
        return (
          !WEEKLY_FREQUENCIES.includes(d.frequency) ||
          (d.daysOfWeek != null && d.daysOfWeek.length > 0)
        );
      }
      // Frequency unchanged but the caller explicitly sends an empty daysOfWeek. On an
      // existing WEEKLY bill this would blank the schedule and silently materialize zero
      // occurrences (a dead bill). Clearing weekdays is only valid alongside a switch to a
      // monthly-family frequency, which must be sent explicitly (handled above).
      if (d.daysOfWeek !== undefined) {
        return d.daysOfWeek.length > 0;
      }
      return true;
    },
    { message: 'Contas semanais exigem ao menos um dia da semana.', path: ['daysOfWeek'] },
  )
  .refine(
    d => d.frequency === undefined || WEEKLY_FREQUENCIES.includes(d.frequency) || d.dueDayOfMonth != null,
    { message: 'Informe o dia do vencimento (1-31).', path: ['dueDayOfMonth'] },
  );

export const markOccurrencePaidSchema = z.object({
  // Required for VARIABLE occurrences (energy/water): the real amount paid.
  paidAmount: z.number().nonnegative().optional().nullable(),
  paymentMethod: paymentMethodSchema.optional().nullable(),
});

export type CreateRecurrentPayableDto = z.infer<typeof createRecurrentPayableSchema>;
export type UpdateRecurrentPayableDto = z.infer<typeof updateRecurrentPayableSchema>;
export type MarkOccurrencePaidDto = z.infer<typeof markOccurrencePaidSchema>;
