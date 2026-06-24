import { z } from 'zod';

// Monthly-family frequencies are the meaningful ones for a recurring bill.
const frequencySchema = z
  .enum([
    'MONTHLY',
    'BIMONTHLY',
    'QUARTERLY',
    'TRIANNUAL',
    'QUADRIMESTRAL',
    'SEMI_ANNUAL',
    'ANNUAL',
  ])
  .default('MONTHLY');

const paymentMethodSchema = z.enum(['PIX', 'BANK_SLIP', 'CREDIT_CARD']);

export const createRecurrentPayableSchema = z
  .object({
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
    categoryId: z.string().uuid({ message: 'Categoria é obrigatória' }),
    amountKind: z.enum(['FIXED', 'VARIABLE']).default('VARIABLE'),
    fixedAmount: z.number().nonnegative().optional().nullable(),
    estimatedAmount: z.number().nonnegative().optional().nullable(),
    frequency: frequencySchema,
    frequencyCount: z.number().int().min(1).default(1),
    dueDayOfMonth: z.number().int().min(1).max(31),
    paymentMethod: paymentMethodSchema.optional().nullable(),
    expectsNf: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine(d => d.amountKind !== 'FIXED' || (d.fixedAmount != null && d.fixedAmount > 0), {
    message: 'Contas fixas exigem um valor fixo (fixedAmount).',
    path: ['fixedAmount'],
  });

export const updateRecurrentPayableSchema = createRecurrentPayableSchema
  .innerType()
  .partial();

export const markOccurrencePaidSchema = z.object({
  // Required for VARIABLE occurrences (energy/water): the real amount paid.
  paidAmount: z.number().nonnegative().optional().nullable(),
  paymentMethod: paymentMethodSchema.optional().nullable(),
});

export type CreateRecurrentPayableDto = z.infer<typeof createRecurrentPayableSchema>;
export type UpdateRecurrentPayableDto = z.infer<typeof updateRecurrentPayableSchema>;
export type MarkOccurrencePaidDto = z.infer<typeof markOccurrencePaidSchema>;
