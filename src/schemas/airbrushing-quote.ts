// Corpos das ações da cotação da aerografia — ver utils/airbrushing-quote.ts.

import { z } from 'zod';
import { EXECUTION_TIME_UNIT } from '@constants';

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

const executionTimeSchema = z.coerce
  .number({ invalid_type_error: 'Tempo de execução inválido' })
  .int('O tempo de execução deve ser um número inteiro')
  .min(1, 'O tempo de execução deve ser maior que zero')
  .max(999, 'Tempo de execução acima do permitido');

const executionTimeUnitSchema = z.nativeEnum(EXECUTION_TIME_UNIT, {
  errorMap: () => ({ message: 'Informe se o tempo é em horas ou dias' }),
});

/**
 * Proposta do aerografista — primeira, revisão ou resposta a uma contraproposta.
 * Sempre traz as DUAS condições: valor e tempo de execução.
 */
export const airbrushingQuoteProposeSchema = z.object({
  amount: quoteAmountSchema,
  executionTime: executionTimeSchema,
  executionTimeUnit: executionTimeUnitSchema,
  note: quoteNoteSchema,
});

/**
 * Contraproposta do comercial: valor, tempo ou os dois. O que não vier continua
 * o que estava em jogo em cada negociação (ver mergeCounterTerms).
 */
export const airbrushingQuoteCounterSchema = z
  .object({
    amount: quoteAmountSchema.nullable().optional(),
    executionTime: executionTimeSchema.nullable().optional(),
    executionTimeUnit: executionTimeUnitSchema.nullable().optional(),
    note: quoteNoteSchema,
  })
  .refine(v => (v.executionTime == null) === (v.executionTimeUnit == null), {
    message: 'Informe o tempo de execução junto com a unidade (horas ou dias)',
    path: ['executionTime'],
  })
  .refine(v => v.amount != null || v.executionTime != null, {
    message: 'Informe um novo valor, um novo tempo de execução ou os dois',
    path: ['amount'],
  });

/** Recusa e seleção carregam só uma observação opcional. */
export const airbrushingQuoteNoteSchema = z.object({
  note: quoteNoteSchema,
});

/**
 * Aceite. Aceitar um orçamento de abertura SEM tempo pede o prazo do
 * aerografista — nos demais casos o tempo é ignorado.
 */
export const airbrushingQuoteAcceptSchema = z
  .object({
    note: quoteNoteSchema,
    executionTime: executionTimeSchema.nullable().optional(),
    executionTimeUnit: executionTimeUnitSchema.nullable().optional(),
  })
  .refine(v => (v.executionTime == null) === (v.executionTimeUnit == null), {
    message: 'Informe o tempo de execução junto com a unidade (horas ou dias)',
    path: ['executionTime'],
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
export type AirbrushingQuoteAcceptFormData = z.infer<typeof airbrushingQuoteAcceptSchema>;
export type AirbrushingQuoteRequestsQuery = z.infer<typeof airbrushingQuoteRequestsQuerySchema>;
