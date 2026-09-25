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

/** A mesma arte (um arquivo já no sistema) para N implementos, numa transação. */
export const implementLayoutBulkSchema = z
  .object({
    implementIds: z
      .array(z.string().uuid('Implemento inválido'))
      .min(1, 'Escolha ao menos um implemento.')
      .max(200, 'No máximo 200 implementos por vez.'),
    fileId: z.string().uuid('Arquivo inválido'),
  })
  .strict();
export type ImplementLayoutBulkFormData = z.infer<typeof implementLayoutBulkSchema>;
