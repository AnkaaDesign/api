// api/src/schemas/portal-artwork.ts
//
// A BORDA DAS ROTAS DE ARTE DO PORTAL (P13b; PLANO §5.1, §7.1).
//
// ⚠️ `.strict()` EM TODO CORPO. Zod descarta chave desconhecida em SILÊNCIO, e num
// corpo de uma chave só isso basta para `{ reason: '…' }` (o nome da API interna)
// chegar como corpo vazio e o 400 acusar um motivo que o cliente jurou ter
// escrito. Com `.strict()` a resposta nomeia a chave errada. É a mesma regra de
// `portal-decision.controller.ts`.
//
// ⚠️ A QUERY NÃO É `.strict()`, de propósito: a lista do portal recebe os
// parâmetros de paginação de sempre, e um parâmetro a mais num favorito salvo não
// pode derrubar a tela. O que é contrato ali é o NOME das chaves (`status`,
// `page`, `take`).
import { z } from 'zod';

/**
 * Os estados que o cliente VÊ (PLANO §6.3). `DRAFT` é conversa interna da Ankaa
 * (a arte ainda não foi proposta) e `SUPERSEDED` é história que a versão nova
 * substituiu: nenhum dos dois aparece, nem como filtro.
 */
export const PORTAL_ARTWORK_VISIBLE_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REPROVED',
] as const;
export type PortalArtworkVisibleStatus = (typeof PORTAL_ARTWORK_VISIBLE_STATUSES)[number];

/** O motivo da reprovação: o mesmo piso de `ImplementLayoutService.reproveFromPortal` (≥ 3). */
export const PORTAL_ARTWORK_REPROVE_MESSAGE = 'Diga o motivo da reprovação.';

export const portalArtworkReproveSchema = z
  .object({
    motivo: z
      .string({ required_error: PORTAL_ARTWORK_REPROVE_MESSAGE })
      .trim()
      .min(3, PORTAL_ARTWORK_REPROVE_MESSAGE)
      .max(2000, 'O motivo pode ter até 2000 caracteres.'),
  })
  .strict();
export type PortalArtworkReproveBody = z.infer<typeof portalArtworkReproveSchema>;

/**
 * O LOTE — "Aprovar esta arte para os N veículos" (PLANO §7.1, linha "Lote").
 *
 * Teto de 100: o maior orçamento do acervo tem 40 veículos, e um lote sem teto é
 * uma transação que cresce com o que o cliente mandar. Ids repetidos são
 * RECUSADOS e não deduplicados: um lote com o mesmo id duas vezes é um defeito da
 * tela, e aprová-lo "uma vez só" em silêncio esconderia o defeito.
 */
export const portalArtworkBatchApproveSchema = z
  .object({
    layoutIds: z
      .array(z.string().uuid('Arte inválida.'), {
        required_error: 'Informe as artes a aprovar.',
      })
      .min(1, 'Informe ao menos uma arte a aprovar.')
      .max(100, 'Aprove no máximo 100 artes de uma vez.')
      .refine(ids => new Set(ids).size === ids.length, 'A mesma arte veio duas vezes no lote.'),
  })
  .strict();
export type PortalArtworkBatchApproveBody = z.infer<typeof portalArtworkBatchApproveSchema>;

/**
 * `GET /cliente/me/artes?status=PENDING_APPROVAL[,APPROVED…]&page=&take=`
 *
 * `status` aceita a lista separada por vírgula ou repetida (`?status=A&status=B`),
 * como `/cliente/me/orcamentos`. Ausente = os três estados visíveis.
 */
export const portalArtworkListQuerySchema = z.object({
  status: z
    .preprocess(
      value => {
        if (value === undefined || value === null || value === '') return undefined;
        if (Array.isArray(value)) return value.map(String);
        return String(value)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      },
      z.array(z.enum(PORTAL_ARTWORK_VISIBLE_STATUSES)).optional(),
    )
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});
export type PortalArtworkListQuery = z.infer<typeof portalArtworkListQuerySchema>;
