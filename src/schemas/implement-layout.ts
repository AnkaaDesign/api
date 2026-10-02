/**
 * A ARTE DO IMPLEMENTO — corpos das rotas `/implements/:id/layouts/*` (PLANO §5.1, §7.1).
 *
 * Os arquivos vão por multipart (`files`); aqui só os corpos JSON. Todos
 * `.strict()`: chave errada é 400 nomeado, nunca um valor descartado em silêncio.
 */
import { z } from 'zod';

/** A nota da decisão interna: obrigatória em "aprovar em nome do cliente" e na reprovação. */
const decisionNoteSchema = z
  .string({ required_error: 'A nota é obrigatória.' })
  .trim()
  .min(
    3,
    'Escreva a nota: quem aprovou, por onde e quando (ex.: "aprovado por WhatsApp em 23/09, contato Fulano").',
  )
  .max(2000, 'Nota longa demais (máximo de 2000 caracteres).');

export const implementLayoutApproveOnBehalfSchema = z.object({ note: decisionNoteSchema }).strict();
export type ImplementLayoutApproveOnBehalfFormData = z.infer<
  typeof implementLayoutApproveOnBehalfSchema
>;

export const implementLayoutReproveSchema = z.object({ note: decisionNoteSchema }).strict();
export type ImplementLayoutReproveFormData = z.infer<typeof implementLayoutReproveSchema>;

/**
 * A mesma arte (um arquivo já no sistema) para N implementos, numa transação.
 *
 * Os implementos vêm por UM de dois caminhos:
 *  · `implementIds` — a lista explícita;
 *  · `budgetId` — todos os veículos vivos do orçamento (decisão 5 de 02/10: na
 *    criação com N veículos sobe-se UMA imagem que vale para todos; depois cada
 *    veículo é editado sozinho pelas rotas `/implements/:id/layouts/*`).
 */
export const implementLayoutBulkSchema = z
  .object({
    implementIds: z
      .array(z.string().uuid('Implemento inválido'))
      .min(1, 'Escolha ao menos um implemento.')
      .max(200, 'No máximo 200 implementos por vez.')
      .optional(),
    budgetId: z.string().uuid('Orçamento inválido').optional(),
    fileId: z.string().uuid('Arquivo inválido'),
  })
  .strict()
  .refine(d => (d.implementIds ? 1 : 0) + (d.budgetId ? 1 : 0) === 1, {
    message: 'Informe os implementos OU o orçamento (um dos dois).',
    path: ['implementIds'],
  });
export type ImplementLayoutBulkFormData = z.infer<typeof implementLayoutBulkSchema>;
