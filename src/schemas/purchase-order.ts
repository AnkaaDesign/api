// api/src/schemas/purchase-order.ts
//
// Corpo das rotas de PEDIDO DE COMPRA — a do portal (`/cliente/me/pedidos`) e a
// interna (`/purchase-orders`).
//
// Divisão de trabalho, a mesma do resto de `src/schemas`: aqui se valida FORMA
// (tipo, tamanho, parseabilidade, cardinalidade). Regras de domínio — o escopo
// do cliente, a reutilização do pedido existente, a escrita dupla na coluna
// legada — moram no serviço, que tem contexto para produzir a mensagem certa.
//
// ⚠️ NADA AQUI É `.strict()`, como nada no projeto é. Uma chave fora do lugar
// some em SILÊNCIO — foi assim que `chassisNumber` no topo do corpo (em vez de
// dentro de `truck`) sumiu com 200 no Flutter. Quem escrever cliente para estas
// rotas manda `taskIds`, não `tasks`, e manda `number`, não `orderNumber`.

import { z } from 'zod';

/**
 * Teto do número do pedido — o MESMO de `Task.customerOrderNumber`
 * (`schemas/task.ts`), e tem de continuar sendo.
 *
 * A escrita é DUPLA: o mesmo texto vai para `PurchaseOrder.number` e para a
 * coluna legada da tarefa. Um teto maior aqui aceitaria um número que a segunda
 * escrita trunca ou recusa, e as duas passariam a discordar — que é exatamente
 * o que a escrita dupla existe para impedir.
 */
export const PURCHASE_ORDER_NUMBER_MAX_LENGTH = 100;

/**
 * Data livre, tolerante à forma e INTOLERANTE ao lixo.
 *
 * `z.coerce.date()` está descartado de propósito: ele transforma `null` em
 * `new Date(null)`, que é 01/01/1970 — gravar a epoch como "data de emissão do
 * pedido" é pior do que não gravar nada. E uma string que o `Date` não parseia
 * vira `Invalid Date`, que o driver do Prisma rejeita NO MEIO da gravação, com
 * as tarefas já ligadas.
 */
const issuedAtSchema = z
  .union([z.string().max(64, 'Data de emissão inválida.'), z.date()])
  .nullish()
  .refine(
    value =>
      value == null ||
      value === '' ||
      !Number.isNaN(new Date(value as string | Date).getTime()),
    { message: 'Data de emissão inválida.' },
  )
  .transform(value =>
    value == null || value === '' ? null : new Date(value as string | Date),
  );

const numberSchema = z
  .string({ required_error: 'Informe o número do pedido de compra.' })
  .trim()
  .min(1, 'Informe o número do pedido de compra.')
  .max(
    PURCHASE_ORDER_NUMBER_MAX_LENGTH,
    `O número do pedido deve ter no máximo ${PURCHASE_ORDER_NUMBER_MAX_LENGTH} caracteres.`,
  );

/**
 * Os veículos que este pedido cobre.
 *
 * ⚠️ `min(1)`: pedido sem veículo não existe como fato. O número do pedido é por
 * ENTREGA — foi por isso que ele desceu do pagador para a tarefa em 17/09 —, e
 * um `PurchaseOrder` órfão seria uma linha que a NFS-e, o `seuNumero` do boleto
 * e a regra de atenção nunca leriam, porque os três leem a TAREFA.
 *
 * `max(200)`: teto de payload. O maior orçamento do acervo tem sessenta
 * veículos; duzentos é folga larga e ainda impede que a lista vire vetor de
 * corpo gigante.
 */
const taskIdsSchema = z
  .array(z.string().uuid('Veículo inválido.'), {
    required_error: 'Selecione ao menos um veículo para o pedido.',
  })
  .min(1, 'Selecione ao menos um veículo para o pedido.')
  .max(200, 'Lista de veículos inválida.');

/**
 * `POST /cliente/me/pedidos` — o Compras do cliente informa o pedido.
 *
 * NÃO ACEITA `customerId`. O dono do pedido é a empresa do contato logado
 * (`responsible.companyId`), resolvida no servidor — e essa ausência é
 * deliberada: o desenho anterior do portal tinha um `POST /responsibles/register`
 * `@Public()` que aceitava `companyId` do CORPO, ou seja, qualquer pessoa se
 * anexava ao cliente que quisesse. Um `customerId` opcional aqui seria a mesma
 * porta, com outro nome.
 */
export const portalPurchaseOrderCreateSchema = z.object({
  number: numberSchema,
  issuedAt: issuedAtSchema,
  taskIds: taskIdsSchema,
});

export type PortalPurchaseOrderCreateFormData = z.infer<typeof portalPurchaseOrderCreateSchema>;

/**
 * `POST /purchase-orders` — o mesmo ato, por dentro.
 *
 * Aqui `customerId` É aceito, e é opcional: quando omitido, sai do cliente das
 * tarefas — que tem de ser UM só, e o serviço recusa quando não é. O
 * funcionário pode precisar registrar o pedido de um intermediário que não é o
 * dono do caminhão (o caso Furgões), e é para isso que o campo existe.
 */
export const purchaseOrderCreateSchema = z.object({
  customerId: z.string().uuid('Cliente inválido.').nullish(),
  number: numberSchema,
  issuedAt: issuedAtSchema,
  taskIds: taskIdsSchema,
});

export type PurchaseOrderCreateFormData = z.infer<typeof purchaseOrderCreateSchema>;

/**
 * Paginação e BUSCA das listagens. Mesmo envelope do resto da API.
 *
 * ⚠️ O nome é `searchingFor`, o MESMO de `portal-read.controller.ts` e o mesmo
 * que o cliente do `web` manda. Nada aqui é `.strict()`: um `?q=` chegaria como
 * "sem busca" e devolveria a primeira página inteira parecendo estar
 * funcionando — que é exatamente o modo de falhar que este arquivo já documenta
 * para `tasks`/`taskIds`.
 *
 * ⚠️ E o teto de `take` é 100, como em todo o portal. A tela que precisava do
 * universo (a de pedidos, que rodava em modo `client` com `take: 500`) passou a
 * paginar no SERVIDOR e a buscar por aqui; o teto não sobe para acomodar tela
 * nenhuma.
 */
export const purchaseOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(100).default(40),
  searchingFor: z.string().trim().min(1).max(200).optional(),
});

export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;
