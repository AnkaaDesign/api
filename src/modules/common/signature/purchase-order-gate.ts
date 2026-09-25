// api/src/modules/common/signature/purchase-order-gate.ts
//
// O PORTÃO DO PEDIDO DE COMPRA — exigência explícita do dono.
//
//   "Responsável cujo ÚNICO papel é `PURCHASING` só assina se o veículo tiver
//    número de pedido de compra. Sem número: 403."
//
// POR QUE A REGRA EXISTE
//   O Compras do cliente é quem EMITE o pedido. Quando ele é a única função
//   daquele contato, a assinatura dele é o ato do departamento de compras — e um
//   departamento de compras que aprova sem emitir pedido deixa a Ankaa com um
//   contrato assinado e uma nota que não pode sair: `Task.customerOrderNumber` é
//   o que a NFS-e imprime, o que vai no `seuNumero` do boleto e o que a regra de
//   atenção `budget.ibipora-missing-order-number` cobra. O portão põe a cobrança
//   no instante em que ela ainda é barata — antes da assinatura, com a pessoa
//   certa na tela —, em vez de virar um telefonema semanas depois com o implemento
//   pronto no pátio.
//
// POR QUE O TESTE É LITERALMENTE `roles.length === 1`
//   Não é uma checagem de "tem PURCHASING". Quem acumula Compras com Comercial,
//   Vendedor, Representante ou Coordenador assina como essas funções também —
//   essas quatro recebem o documento INTEIRO e aprovam o negócio, e barrá-las
//   por um campo administrativo travaria a aprovação de um orçamento inteiro na
//   pessoa errada. A regra mira o caso em que a ÚNICA função é comprar.
//
//   Consequência deliberada: um contato com `roles: []` NÃO é barrado aqui.
//   Ele também não assina — `sectionsForRoles([])` devolve `[]` e a emissão nem
//   o inclui na coleta. Duplicar aquela recusa aqui só criaria um segundo lugar
//   onde a mesma decisão pode divergir.
//
// PURO DE PROPÓSITO: sem Nest, sem Prisma-client de runtime, sem `this`. É o
// que permite `tests/portal-assinatura-compras.test.ts` percorrer a
// tabela-verdade inteira sem banco.

import { ResponsibleRole } from '@prisma/client';

/**
 * A MENSAGEM, literal e única.
 *
 * Constante exportada porque ela é contratada em três lugares — a recusa do
 * servidor, o teste que a fixa e a tela do portal que precisa reconhecê-la — e
 * uma vírgula de diferença entre eles é uma tela que não sabe o que mostrar.
 */
export const PURCHASE_ORDER_REQUIRED_MESSAGE =
  'Informe o número do pedido de compra antes de assinar.';

/**
 * O contato cuja ÚNICA função é Compras.
 *
 * `roles.length === 1 && roles[0] === 'PURCHASING'` — o teste do dono, escrito
 * como ele o enunciou. Repare que NÃO é `roles.includes(PURCHASING)`: a
 * diferença entre as duas expressões é exatamente a regra.
 */
export function isSolePurchasingContact(roles: readonly string[] | null | undefined): boolean {
  const list = roles ?? [];
  return list.length === 1 && list[0] === ResponsibleRole.PURCHASING;
}

/**
 * Este veículo já tem pedido de compra?
 *
 * ACEITA OS DOIS LADOS DA ESCRITA DUPLA, e isso é intencional. A entidade nova é
 * `PurchaseOrder` (`Task.purchaseOrderId`); a coluna legada
 * `Task.customerOrderNumber` é a que a NFS-e, o `seuNumero` do boleto e a regra
 * de atenção leem HOJE. Enquanto as duas convivem, o portão pergunta pelo FATO
 * ("existe número de pedido para este veículo?"), não por uma das duas
 * representações dele — senão uma linha escrita por um caminho antigo seria
 * barrada por um portão que só sabe olhar para o caminho novo.
 */
export function taskHasPurchaseOrder(task: {
  purchaseOrderId?: string | null;
  customerOrderNumber?: string | null;
}): boolean {
  if (task.purchaseOrderId) return true;
  return (task.customerOrderNumber ?? '').trim().length > 0;
}

export interface PurchaseOrderGateVehicle {
  id?: string | null;
  /** Como o veículo aparece para o cliente: série, placa ou o nome da tarefa. */
  label?: string | null;
  purchaseOrderId?: string | null;
  customerOrderNumber?: string | null;
  /**
   * ESTE CONTATO PODE EMITIR O PEDIDO DESTE VEÍCULO?
   *
   * ⛔ AUSENTE (`undefined`) SIGNIFICA "PODE" — e a escolha do padrão é a
   * regra de segurança desta interface. Quem não calcula o campo continua
   * recebendo o comportamento antigo (o portão morde); só um `false`
   * EXPLÍCITO, calculado com o dado na mão, relaxa a cobrança. O contrário —
   * tratar ausência como "não pode" — faria um `select` incompleto DESLIGAR o
   * portão em silêncio, que é o pior desfecho possível para uma trava que
   * existe justamente para não deixar passar.
   */
  canIssuePurchaseOrder?: boolean;
}

export interface PurchaseOrderGateVerdict {
  blocked: boolean;
  /** Vazio quando não bloqueia. Os veículos SEM número, para a mensagem. */
  missing: PurchaseOrderGateVehicle[];
  /** A mensagem exata do 403, ou `null`. */
  message: string | null;
}

/**
 * O veredito do portão.
 *
 * ⚠️ TODOS OS VEÍCULOS, e não "algum". Um orçamento cobre N implementos e o
 * documento que este contato assina cobre todos eles; o pedido de compra é por
 * ENTREGA (foi por isso que o número desceu do pagador para a tarefa). Deixar
 * passar porque UM dos sessenta tem número faria a nota dos outros cinquenta e
 * nove nascer sem o pedido que o cliente exige — que é literalmente o defeito
 * que a regra de atenção `budget.ibipora-missing-order-number` existe para
 * apontar, e que este portão existe para não deixar chegar lá.
 *
 * Um envelope sem veículo nenhum NÃO bloqueia: não há entrega a cobrir, e
 * inventar uma recusa para um caso impossível só produziria uma parede sem
 * saída na primeira vez que o dado fosse estranho.
 *
 * ⚠️ "TODOS" QUER DIZER "TODOS OS QUE ELE PODE EMITIR". Ver
 * `canIssuePurchaseOrder`: um veículo de empresa com quem ele não tem conta
 * não entra na cobrança, porque o pedido dele não é deste contato para
 * emitir — e cobrá-lo assim mesmo era um beco sem saída.
 */
export function purchaseOrderGateVerdict(args: {
  roles: readonly string[] | null | undefined;
  vehicles: readonly PurchaseOrderGateVehicle[] | null | undefined;
}): PurchaseOrderGateVerdict {
  const livre: PurchaseOrderGateVerdict = { blocked: false, missing: [], message: null };

  if (!isSolePurchasingContact(args.roles)) return livre;

  const vehicles = args.vehicles ?? [];
  if (vehicles.length === 0) return livre;

  // ⛔ SÓ OS VEÍCULOS QUE ELE PODE EMITIR — e isto fecha um beco sem saída.
  //
  // `POST /cliente/me/pedidos` é escopado por (a) PAGADOR ∨ (b) DONO: o caminho
  // pessoal "eu sou contato desta tarefa" NÃO autoriza ato comercial, e está
  // certo que não autorize — `Task.customerOrderNumber` é o documento de quem
  // paga, é ele que a NFS-e imprime. Mas a EMISSÃO convoca todo
  // `Task.responsibles`, sem conferir empresa nenhuma. O cruzamento das duas
  // regras produzia uma pessoa CONVOCADA a assinar, BARRADA por falta do
  // pedido, e RECUSADA no único endereço que criaria o pedido. Sem saída, e
  // sem que nada no sistema pudesse desatolá-la.
  //
  // Exigir dela um documento que não é dela para emitir não protege ninguém: o
  // pedido daqueles veículos continua sendo cobrado de quem pode emiti-lo, que
  // é quem o portão mira. No caso normal — o contato de Compras da empresa que
  // paga ou é dona — NADA muda, e é o único caso em que a regra fazia sentido.
  const meus = vehicles.filter(v => v.canIssuePurchaseOrder !== false);
  if (meus.length === 0) return livre;

  const missing = meus.filter(v => !taskHasPurchaseOrder(v));
  if (missing.length === 0) return livre;

  return { blocked: true, missing: [...missing], message: PURCHASE_ORDER_REQUIRED_MESSAGE };
}
