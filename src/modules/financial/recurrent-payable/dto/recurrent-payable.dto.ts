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

/**
 * A BILLED INSTALLATION inside one bill: the SAMAE matrícula, the COPEL UC, the
 * operator's line. The same payee issues one invoice — and one nota — per
 * installation, and the statement carries one debit per installation with the
 * code in the memo, so each needs its own occurrence to bind to.
 *
 * `code` is stored as typed but always COMPARED as digits-only with leading zeros
 * trimmed, so "00113942" and "113942" are the same matrícula. Non-digit codes are
 * rejected here rather than silently never matching anything.
 */
const installationSchema = z.object({
  // Present when editing an existing row; absent when the form adds one.
  id: z.string().uuid().optional().nullable(),
  code: z
    .string()
    .trim()
    .min(1, 'Informe o código da instalação (matrícula, UC, linha)')
    .max(40, 'Código deve ter no máximo 40 caracteres')
    .refine(v => /\d/.test(v), 'O código precisa conter dígitos — é assim que ele é reconhecido no extrato'),
  label: z
    .string()
    .trim()
    .max(120, 'Apelido deve ter no máximo 120 caracteres')
    .transform(v => (v.length === 0 ? null : v))
    .optional()
    .nullable(),
  // Per-installation estimate for VARIABLE bills. Null → the installation's own
  // bank history, then the bill's estimate split across the active installations.
  estimatedAmount: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

const installationsSchema = z
  .array(installationSchema)
  .max(50, 'No máximo 50 instalações por conta')
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      const key = item.code.replace(/\D/g, '').replace(/^0+/, '');
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Código de instalação duplicado: "${item.code}".`,
          path: [index, 'code'],
        });
      }
      seen.add(key);
    });
  });

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
  // Omit to leave the current list untouched; send the full desired list to
  // reconcile it (the service adds, updates, and retires — never deletes rows
  // that already carry occurrences).
  installations: installationsSchema.optional(),
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

// Turning "espera nota" OFF can also quiet competences that are already closed
// (a bill that never issues a note — vale-transporte, aluguel de PF, diárias —
// would otherwise sit at "Aguardando nota" forever, since the settled bank line
// is never getting a document). That IS a retroactive write, so it must be asked
// for: the form ships it unchecked and every other edit stays strictly forward.
export const updateRecurrentPayableWithScopeSchema = z.intersection(
  updateRecurrentPayableSchema,
  z.object({ applyExpectsNfToPast: z.boolean().optional().default(false) }),
);

/**
 * A ONE-OFF payable (conta avulsa) — the quick-create modal on Contas a Pagar.
 *
 * Deliberately much smaller than the recurrent schema: no cadence, no amountKind
 * (a one-off is always a known amount), just who/what/how much/when. `dueDate` is
 * a plain calendar date; the service anchors it to SP-midnight so a browser in
 * another timezone cannot land the bill a day off.
 */
export const createOneOffPayableSchema = z.object({
  name: z.string().trim().min(1, 'Descrição é obrigatória').max(200),
  description: z.string().trim().max(500).optional().nullable(),
  payeeName: z.string().trim().max(200).optional().nullable(),
  payeeCnpj: z
    .string()
    .trim()
    .transform(v => v.replace(/\D/g, ''))
    .refine(v => v.length === 0 || v.length === 14, 'CNPJ deve ter 14 dígitos')
    .transform(v => (v.length === 0 ? null : v))
    .optional()
    .nullable(),
  payeeCpf: z
    .string()
    .trim()
    .transform(v => v.replace(/\D/g, ''))
    .refine(v => v.length === 0 || v.length === 11, 'CPF deve ter 11 dígitos')
    .transform(v => (v.length === 0 ? null : v))
    .optional()
    .nullable(),
  pixKey: z
    .string()
    .trim()
    .max(500, 'Chave Pix deve ter no máximo 500 caracteres')
    .transform(v => (v.length === 0 ? null : v))
    .optional()
    .nullable(),
  categoryId: z.string().uuid({ message: 'Categoria é obrigatória' }),
  amount: z.number().positive('Informe um valor maior que zero'),
  // Calendar date (YYYY-MM-DD), NOT a timestamp — see the note above.
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Vencimento inválido'),
  paymentMethod: paymentMethodSchema.optional().nullable(),
  expectsNf: z.boolean().default(false),
});

export const markOccurrencePaidSchema = z.object({
  // Required for VARIABLE occurrences (energy/water): the real amount paid.
  paidAmount: z.number().nonnegative().optional().nullable(),
  paymentMethod: paymentMethodSchema.optional().nullable(),
});

export type RecurrentPayableInstallationDto = z.infer<typeof installationSchema>;
export type CreateRecurrentPayableDto = z.infer<typeof createRecurrentPayableSchema>;
export type UpdateRecurrentPayableDto = z.infer<typeof updateRecurrentPayableWithScopeSchema>;
export type CreateOneOffPayableDto = z.infer<typeof createOneOffPayableSchema>;
export type MarkOccurrencePaidDto = z.infer<typeof markOccurrencePaidSchema>;
