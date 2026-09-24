// Corpos das ações da cotação da aerografia — ver utils/airbrushing-quote.ts.

import { z } from 'zod';

/** Maior lance aceito: um teto de sanidade contra dígito a mais, não uma regra de negócio. */
const MAX_QUOTE_AMOUNT = 1_000_000;

const quoteAmountSchema = z.coerce
  .number({
    required_error: 'Informe o valor',
    invalid_type_error: 'Valor inválido',
  })
  .finite('Valor inválido')
  .positive('O valor deve ser maior que zero')
  .max(MAX_QUOTE_AMOUNT, 'Valor acima do permitido');

const quoteNoteSchema = z
  .string()
  .trim()
  .max(1000, 'A observação deve ter no máximo 1000 caracteres')
  .nullable()
  .optional()
  .transform(value => (value ? value : null));

/** Proposta do aerografista — primeira, revisão ou resposta a uma contraproposta. */
export const airbrushingQuoteProposeSchema = z.object({
  amount: quoteAmountSchema,
  note: quoteNoteSchema,
});

/** Contraproposta do comercial. */
export const airbrushingQuoteCounterSchema = z.object({
  amount: quoteAmountSchema,
  note: quoteNoteSchema,
});

/** Aceite, recusa e seleção carregam só uma observação opcional. */
export const airbrushingQuoteNoteSchema = z.object({
  note: quoteNoteSchema,
});

/**
 * Lista do aerografista. `open` = aerografias em cotação (com ou sem proposta
 * dele); `closed` = cotações das quais ele participou e que já terminaram.
 */
export const airbrushingQuoteRequestsQuerySchema = z.object({
  scope: z.enum(['open', 'closed']).default('open'),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type AirbrushingQuoteProposeFormData = z.infer<typeof airbrushingQuoteProposeSchema>;
export type AirbrushingQuoteCounterFormData = z.infer<typeof airbrushingQuoteCounterSchema>;
export type AirbrushingQuoteNoteFormData = z.infer<typeof airbrushingQuoteNoteSchema>;
export type AirbrushingQuoteRequestsQuery = z.infer<typeof airbrushingQuoteRequestsQuerySchema>;
