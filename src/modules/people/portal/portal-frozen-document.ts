// api/src/modules/people/portal/portal-frozen-document.ts
//
// ⛔ A GUARDA DO DOCUMENTO CONGELADO — UMA SÓ, PARA OS DOIS CAMINHOS DE ESCRITA.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO NÃO MORA DENTRO DE UM SERVIÇO
// ─────────────────────────────────────────────────────────────────────────────
// A regra ("o documento que as pessoas assinaram passaria a mentir?") é pura e
// mora em `portal-vehicle-identity.ts`. O que este arquivo acrescenta é a única
// parte que precisa do banco: ACHAR a coleta viva e o nome de quem a conduz.
//
// Ela nasceu privada em `portal-identity.service.ts`, guardando
// `PATCH /cliente/me/veiculos/:taskId/identificacao`. E deixou um buraco
// nomeado no próprio comentário daquele arquivo: `POST /cliente/me/pedidos`
// escreve o MESMO `Task.customerOrderNumber`, pelo `PurchaseOrderService`, e
// não passava por guarda nenhuma. Um contato com `WRITE_PURCHASE_ORDER` trocava
// por lá, com 201 na cara, um número que o documento assinado imprime — a porta
// dos fundos da porta que o outro caminho tranca.
//
// ⛔ E A CORREÇÃO NÃO PODIA SER UMA SEGUNDA CÓPIA DA REGRA. Duas guardas
// divergem no primeiro conserto, e a que ficar para trás é a que um cliente vai
// encontrar. Por isso a guarda saiu do serviço e virou ESTA função, que os dois
// caminhos chamam — `portal-identity.service.ts` e
// `purchase-order.service.ts` — e que `tests/portal-identificacao.test.ts`
// exercita com um `prisma` de mentira, provando que os dois recebem o MESMO
// veredicto para a MESMA entrada.
//
// ⚠️ NÃO É INJETÁVEL DE PROPÓSITO. `PortalIdentityService` já injeta
// `PurchaseOrderService`; um serviço Nest aqui, injetado pelos dois, ou obrigaria
// um `forwardRef` (que esconde ciclo em vez de evitá-lo) ou um módulo a mais para
// carregar uma função sem estado. O `prisma` entra como ARGUMENTO — é também o
// que a deixa testável sem banco e sem container.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE ESTA GUARDA NÃO FAZ
// ─────────────────────────────────────────────────────────────────────────────
// NÃO chama `onQuoteContentChanged`. O único caso que chegaria até ele por estes
// caminhos é o preenchimento tardio, que as tolerâncias já absolvem
// (`tolerateLateRegistration`); e chamá-lo faria o cliente apagar, ao salvar uma
// placa, assinaturas derrubadas por uma divergência que não foi dele. O
// raciocínio inteiro está no cabeçalho de `portal-identity.service.ts`.
//
// ⛔ E NÃO VALE PARA O FUNCIONÁRIO. `POST /purchase-orders` e `PUT /tasks/:id`
// continuam podendo corrigir o número: quem está do lado de dentro tem a tela do
// envelope na frente e reemite num clique — invalidar é, para ele, a resposta
// certa. A assimetria é a razão de ser desta guarda, não um descuido dela; ver
// "POR QUE O PORTAL RECUSA EM VEZ DE DEIXAR INVALIDAR" em
// `portal-vehicle-identity.ts`.

import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '@modules/common/prisma/prisma.service';
import type { QuoteSnapshot } from '@modules/common/signature/services/quote-snapshot.service';
import {
  classifyVehicleIdentityWrite,
  frozenIdentityInSnapshot,
  overwritesAmong,
  vehicleIdentityConflictMessage,
  type DesiredVehicleIdentity,
  type LiveEnvelopeKind,
} from './portal-vehicle-identity';

/**
 * AS DUAS SITUAÇÕES EM QUE EXISTE DOCUMENTO A CONTRADIZER.
 *
 * `RUNNING` — coleta viva, assinaturas sendo colhidas agora.
 * `COMPLETED` — coleta concluída e SELADA. Também conta, e essa é a correção de
 * 17/09/2026: uma alteração material num orçamento já assinado não produzia
 * nada — nem invalidação, nem linha de deriva —, e `createEnvelope` recusa
 * emitir sobre coleta concluída, de modo que não havia como recolher a
 * assinatura da versão nova. O documento e o cadastro divergiam em silêncio.
 *
 * Os demais estados (`DRAFT`, `REFUSED`, `EXPIRED`, `CANCELLED`, `INVALIDATED`,
 * `SUPERSEDED`) não têm o que proteger: ou o documento nunca foi emitido, ou já
 * não vale.
 */
export const ENVELOPES_VIVOS = ['RUNNING', 'COMPLETED'] as const;
const [ENVELOPE_RUNNING, ENVELOPE_COMPLETED] = ENVELOPES_VIVOS;

const SELECT = {
  id: true,
  status: true,
  quoteSnapshot: true,
  quote: {
    select: {
      budgetNumber: true,
      // Quem conduz a coleta do lado da Ankaa. É o nome que a mensagem de
      // recusa entrega ao contato — "fale com o comercial" é justamente o
      // que ele NÃO consegue resolver sozinho: ele não sabe quem é.
      commercialUser: { select: { name: true } },
    },
  },
} as const;

/**
 * O cliente de banco que esta guarda usa — uma consulta, uma tabela.
 *
 * Declarado ESTRUTURALMENTE, e não como `PrismaService`, porque é o que permite
 * ao teste passar um objeto de mentira e exercitar os dois ramos sem container.
 * `PrismaService` satisfaz esta forma.
 */
export type LeitorDeEnvelope = Pick<PrismaService, 'signatureEnvelope'>;

/**
 * Recusa a SOBRESCRITA de um dado que o documento congelado já imprime.
 *
 * ⚠️ `RUNNING` primeiro, `COMPLETED` depois — a MESMA ordem de
 * `onQuoteContentChanged`. Só existe um de cada por orçamento (`createEnvelope`
 * recusa a segunda coleta), então a busca é determinada; e com uma coleta viva
 * é ela que governa, porque é ela que ainda pode ser estragada.
 *
 * Veículo SEM orçamento (`Task.quoteId` nulo) e orçamento sem envelope não têm
 * documento a contradizer: a escrita passa direto, que é o caso comum e o
 * motivo de as duas rotas existirem.
 *
 * ⚠️ `desejado` tem de chegar JÁ REDUZIDO ao que de fato muda — ver
 * `apenasOQueMuda`/`mudancaDePedido`. Um campo cujo valor pedido é o que já está
 * gravado é NO-OP: não escreve nada, não pode contradizer documento nenhum, e
 * julgá-lo produziria um 409 sobre nada. O caso não é hipotético: `PUT /tasks/:id`
 * escreve placa e chassi sem chamar o gancho de invalidação, de modo que o
 * congelado e o cadastro PODEM divergir sem que ninguém tenha passado por aqui.
 */
export async function assertIdentidadeNaoContradizDocumento(
  prisma: LeitorDeEnvelope,
  quoteId: string | null | undefined,
  taskId: string,
  desejado: DesiredVehicleIdentity,
): Promise<void> {
  if (!quoteId) return;

  // ⛔ DUAS CONSULTAS, NA ORDEM, e não um `in` com `orderBy: { status }`.
  //
  // Ordenar por um enum do Postgres ordena pela ORDEM DE DECLARAÇÃO do tipo,
  // não pelo alfabeto — hoje `RUNNING` vem antes de `COMPLETED` por acidente
  // de como o enum foi escrito em `schema.prisma`, e uma reordenação daquele
  // bloco (ou uma migração que recrie o tipo, como a `20260920120000` faz com
  // `BudgetStatus`) inverteria esta prioridade em silêncio.
  //
  // A ordem IMPORTA: havendo coleta VIVA é ela que governa, porque é ela que
  // ainda pode ser estragada. Tratar as duas juntas faria uma reemissão
  // pendente ser julgada pelo contrato anterior. É a mesma escolha, pelo mesmo
  // motivo, de `onQuoteContentChanged` (`signature-envelope.service.ts:6513`).
  const envelope =
    (await prisma.signatureEnvelope.findFirst({
      where: { quoteId, status: ENVELOPE_RUNNING },
      select: SELECT,
    })) ??
    (await prisma.signatureEnvelope.findFirst({
      where: { quoteId, status: ENVELOPE_COMPLETED },
      // Entre dois concluídos vale o de MAIOR versão: é o contrato em vigor.
      orderBy: { version: 'desc' },
      select: SELECT,
    }));
  if (!envelope) return;

  // `snapshotVehicles` é a ÚNICA porta de entrada dos veículos de um snapshot
  // — ela responde pelas formas v1/v2 (`task`+`truck` no singular) e pela v3+
  // (`vehicles`). Ler `snapshot.vehicles` direto deixaria esta guarda CEGA
  // para toda coleta anterior à multitarefa, que é justamente a mais antiga e
  // a mais cara de estragar.
  const congelado = frozenIdentityInSnapshot(
    envelope.quoteSnapshot as unknown as QuoteSnapshot,
    taskId,
  );

  const decisoes = classifyVehicleIdentityWrite(congelado, desejado);
  const sobrescritas = overwritesAmong(decisoes);
  if (!sobrescritas.length) return;

  throw new ConflictException(
    vehicleIdentityConflictMessage(
      sobrescritas,
      envelope.status as LiveEnvelopeKind,
      envelope.quote?.commercialUser?.name ?? null,
    ),
  );
}

/**
 * A REDUÇÃO DO NÚMERO DO PEDIDO ao que de fato muda — a mesma que
 * `apenasOQueMuda` faz para os quatro campos, aqui para o único que o pedido de
 * compra escreve.
 *
 * ⚠️ Comparação por TEXTO APARADO, e não por identidade de string: o
 * `customerOrderNumber` gravado veio de `number.trim()` no mesmo serviço, e um
 * espaço à direita numa linha antiga faria um relink idêntico parecer mudança —
 * e virar 409 sobre nada.
 *
 * Devolve `{}` quando nada muda: `classifyVehicleIdentityWrite` não classifica
 * campo ausente, então a guarda vira no-op sem ramo especial.
 */
export function mudancaDePedido(
  atual: string | null | undefined,
  novo: string,
): DesiredVehicleIdentity {
  if ((atual ?? '').trim() === novo.trim()) return {};
  return { orderNumber: novo };
}
