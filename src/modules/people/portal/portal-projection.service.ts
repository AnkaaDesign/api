// api/src/modules/people/portal/portal-projection.service.ts
//
// QUAIS COLUNAS este contato pode ver. A outra metade do portão — a primeira é
// `PortalScopeService`, que diz quais LINHAS.
//
// UMA RÉGUA, DOIS CONSUMIDORES. `sectionsForRoles()`
// (`common/signature/quote-sections.ts:188`) já decide qual RECORTE DO PDF cada
// função de contato assina. A mesma função decide, aqui, qual recorte da TELA
// ela vê. Não existe um segundo mapa de seções, e criar um seria criar duas
// verdades sobre a mesma pergunta: a tela mostraria o que o PDF assinado pela
// MESMA pessoa esconde.
//
// ⛔ O RECORTE É DO SERVIDOR, NUM PROJETOR, NÃO NUM `.filter()` DE REACT.
// O defeito vivo que isto corrige tem nome e linha: `findPublic` devolve o
// cadastro fiscal, as parcelas, os boletos e as notas de TODOS os pagadores, e o
// recorte por cliente é um filtro no navegador
// (`web/src/pages/public/budget/[id].tsx:161-170`). Num orçamento de dois
// pagadores, A recebe o CNPJ, o endereço e o plano de pagamento de B — e o JSON
// cru está no DevTools mesmo quando a tela não desenha nada.
//
// COMO ESTE ARQUIVO IMPEDE A REPETIÇÃO — o projetor recebe a LINHA CRUA e
// devolve um DTO estreitado, campo a campo, copiado à mão. Nenhum caminho aqui
// devolve o objeto de entrada, nem o espalha (`...row`), nem o `JSON.parse`
// de volta. É deliberadamente chato: espalhar é o gesto que transforma um
// `select` que ganhou uma coluna nova num vazamento silencioso.
import { Injectable } from '@nestjs/common';
import {
  hasSection,
  sectionsForRoles,
  type QuoteSection,
} from '@/modules/common/signature/quote-sections';
import { PORTAL_CAPABILITY, hasCapability, portalSectionsFor } from './portal-capabilities';
import { commercialTaskLink } from './portal-scope.service';
import { IMPLEMENT_FACES, type ImplementFace } from '../../../constants/implement-faces';
import {
  BUDGET_SIGNATURE_STATUS_LABELS,
  BUDGET_VALUE_APPROVAL_SOURCE_LABELS,
  LAYOUT_APPROVAL_SOURCE_LABELS,
  LAYOUT_STATUS_LABELS,
} from '../../../constants/enum-labels';
import { quoteArtworkOf } from '../../../utils/quote-artwork';

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ O QUE NUNCA SAI, DE NENHUM PAPEL, EM NENHUMA SEÇÃO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Campos que o portal NUNCA expõe — `docs/PORTAL-CONTRATO.md` §9.
 *
 * Não é uma lista que o projetor consulta em tempo de execução: o projetor
 * simplesmente não copia nenhum deles. A lista existe para que
 * `tests/portal-recorte.test.ts` possa varrer a saída de todos os 9 papéis e
 * provar que nenhuma chave com estes nomes apareceu — inclusive depois de
 * alguém acrescentar um campo novo aqui dentro sem ler este bloco.
 *
 * Cada um tem um motivo distinto:
 *  · `totalActiveTimeSeconds`, `assignedTo`, `startedById`, `completedById`,
 *    `pausedAt` — quem trabalhou, quanto tempo e quando parou é gestão interna.
 *    "Pausado" ainda é o pior: para o cliente é sinal de problema, e a pausa é
 *    quase sempre almoço, troca de turno ou fila de cabine.
 *  · `spot` — onde o implemento está no pátio.
 *  · `bonification`, `bonificationOrder`, `bonusDiscountId` — folha.
 *  · `details` — texto interno da tarefa, escrito sem plateia.
 *  · `term` — o prazo INTERNO. `forecastDate` é o que se promete ao cliente;
 *    `term` é a data que a produção persegue, e as duas divergem de propósito.
 *
 * ⚠️ TRÊS AUSÊNCIAS QUE NÃO ESTÃO NESTA LISTA, e o motivo:
 * `Observation` (a observação interna da TAREFA), `Cut.reason` e
 * `Airbrushing.price`/`painterId` não aparecem aqui porque o nome colidiria com
 * campos legítimos — `BudgetItem.observation` É conteúdo da seção `SERVICES`
 * ("a relação numerada dos serviços, COM AS OBSERVAÇÕES DE CADA UM", diz
 * `QUOTE_SECTION_DESCRIPTIONS`), e barrar a chave `observation` em toda a
 * árvore apagaria o que o cliente tem direito de ler. Elas estão fora por
 * ESTRUTURA: `PortalTaskRow` não declara `observation`, `cuts` nem
 * `airbrushings`, e o projetor copia campo a campo — não há caminho por onde
 * entrem. `tests/portal-recorte.test.ts` verifica a subárvore do veículo
 * separadamente.
 */
export const PORTAL_NEVER_EXPOSED: readonly string[] = [
  'totalActiveTimeSeconds',
  'assignedTo',
  'assignedToId',
  'startedById',
  'startedBy',
  'completedById',
  'completedBy',
  'approvedById',
  'approvedBy',
  'createdById',
  'createdBy',
  'pausedAt',
  'pausedById',
  'pausedBy',
  'spot',
  'bonification',
  'bonificationOrder',
  'bonusDiscountId',
  'bonusDiscount',
  'details',
  'term',
  'commercialUserId',
  'commercialUser',
];

/**
 * Chaves proibidas DENTRO DA SUBÁRVORE DO VEÍCULO.
 *
 * Separada de `PORTAL_NEVER_EXPOSED` porque `observation` é conteúdo legítimo
 * da seção `SERVICES` no nível do ORÇAMENTO e conteúdo interno no nível da
 * TAREFA. A mesma palavra, dois donos.
 */
export const PORTAL_NEVER_EXPOSED_ON_VEHICLE: readonly string[] = [
  ...PORTAL_NEVER_EXPOSED,
  'observation',
  'reason',
  'price',
  'painterId',
  'cuts',
  'airbrushings',
];

/**
 * O TIPO de ordem de serviço que pode ir para o cliente.
 *
 * ⛔ NENHUMA `COMMERCIAL` sai daqui. São 52 descrições, e entre elas "Aplicar
 * Desconto", "Contraproposta" e "Tratar Reclamação". `GET /task-quotes/public/:id`
 * já as devolve hoje a quem tiver o link (`budget.service.ts:5640-5653`, sem
 * filtro de tipo); a página só desenha as que têm foto, mas o JSON cru está no
 * DevTools do cliente.
 *
 * `ARTWORK` e `LOGISTIC` ficam de fora nesta rodada por omissão deliberada: o
 * contrato §9 lista como marcos do cliente apenas produção e checklist, e uma
 * lista positiva é a única forma de um tipo novo de O.S. não nascer visível.
 */
export const PORTAL_VISIBLE_SERVICE_ORDER_TYPES: readonly string[] = ['PRODUCTION'];

// ─────────────────────────────────────────────────────────────────────────────
// AS LINHAS CRUAS — o que o chamador precisa ter carregado
// ─────────────────────────────────────────────────────────────────────────────
//
// Estas interfaces são o CONTRATO DE `select` das rotas: elas declaram, campo a
// campo, o que o projetor lê. Tudo é opcional porque uma rota de lista carrega
// menos que uma de detalhe, e o projetor tem de produzir o mesmo formato nas
// duas — o que não veio simplesmente não aparece.

export interface PortalPaintRow {
  id?: string;
  name?: string;
  hex?: string;
  finish?: string;
  /** Relação obrigatória no schema; o portal a recebe achatada em `type`. */
  paintType?: { name?: string | null } | null;
  type?: string | null;
}

export interface PortalFileRow {
  id?: string;
  filename?: string;
  originalName?: string;
  mimetype?: string;
  size?: number;
  thumbnailUrl?: string | null;
}

export interface PortalMeasureRow {
  height?: number | null;
  sections?: Array<{
    width?: number | null;
    isDoor?: boolean;
    doorHeight?: number | null;
    position?: number;
  }>;
}

export interface PortalServiceOrderRow {
  id?: string;
  type?: string;
  status?: string;
  description?: string;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  position?: number;
  [extra: string]: unknown;
}

/**
 * UMA LINHA DE ARTE do implemento, como `PORTAL_ARTWORK_LAYOUT_SELECT` a traz.
 *
 * `decisions` é a ÚLTIMA decisão que DECIDIU (`toStatus` APPROVED ou REPROVED):
 * o envio (`PENDING_APPROVAL`, gesto interno) não é decisão do cliente e não
 * pode aparecer como "decidida por". A arte migrada não tem decisão nenhuma na
 * trilha — aí valem as colunas da própria linha (`decidedAt`, `approvalSource`).
 */
export interface PortalLayoutRow {
  id?: string;
  status?: string;
  fileId?: string;
  file?: PortalFileRow | null;
  version?: number | null;
  sentAt?: Date | null;
  decidedAt?: Date | null;
  approvalSource?: string | null;
  decisionNote?: string | null;
  decidedByResponsible?: { name?: string | null } | null;
  decisions?: Array<{
    toStatus?: string | null;
    source?: string | null;
    createdAt?: Date | null;
    note?: string | null;
    responsible?: { name?: string | null } | null;
  }>;
}

export interface PortalTaskRow {
  id?: string;
  name?: string | null;
  status?: string;
  statusOrder?: number;
  serialNumber?: string | null;
  customerOrderNumber?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrder?: { id?: string; number?: string; issuedAt?: Date | null } | null;
  entryDate?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  forecastDate?: Date | null;
  customerId?: string | null;
  customer?: { id?: string; fantasyName?: string | null; corporateName?: string | null } | null;
  implement?: {
    id?: string | null;
    serialNumber?: string | null;
    plate?: string | null;
    chassisNumber?: string | null;
    category?: string | null;
    type?: string | null;
    vinPlate?: PortalFileRow | null;
    leftSideMeasure?: PortalMeasureRow | null;
    rightSideMeasure?: PortalMeasureRow | null;
    backSideMeasure?: PortalMeasureRow | null;
    frontSideMeasure?: PortalMeasureRow | null;
    rearDoorLeaves?: string | null;
    rearDoorBarCount?: number | null;
    rearDoorHatchCount?: number | null;
    projectFiles?: PortalFileRow[];
    /**
     * A arte do implemento (R2). Com a seção `LAYOUT`, o select traz as linhas
     * que o cliente pode ver (`PENDING_APPROVAL`, `APPROVED`, `REPROVED`) e as
     * `SUPERSEDED`, que só servem de PROVA do marco "Arte aprovada" e nunca são
     * projetadas; sem `LAYOUT` e com `DELIVERY`, só `status`/`decidedAt` das
     * aprovadas, para o marco. Ver `PORTAL_ARTWORK_LAYOUT_SELECT`.
     */
    layouts?: PortalLayoutRow[];
  } | null;
  /**
   * ⛔ SÓ PARA DECIDIR, NUNCA COPIADO: os pagadores DESTA empresa no faturamento
   * que cobre o veículo (o `select` já os recorta por `customerId`). É o que
   * `commercialTaskLink` precisa para responder "posso decidir a arte daqui?"
   * — o caminho (a) do escopo comercial. Sem ele o pagador (a Furgões) veria
   * `canDecide: false` numa arte que a rota deixaria aprovar.
   */
  billingEntry?: {
    billing?: { customerConfigs?: Array<{ customerId?: string | null }> | null } | null;
  } | null;
  generalPainting?: PortalPaintRow | null;
  logoPaints?: PortalPaintRow[];
  baseFiles?: PortalFileRow[];
  artworks?: PortalFileRow[];
  serviceOrders?: PortalServiceOrderRow[];
  [extra: string]: unknown;
}

export interface PortalBudgetRow {
  id?: string;
  budgetNumber?: number;
  status?: string;
  statusOrder?: number;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  expiresAt?: Date | null;
  vehicleCount?: number;
  subtotal?: unknown;
  total?: unknown;
  guaranteeYears?: number | null;
  customGuaranteeText?: string | null;
  customForecastDays?: number | null;
  simultaneousTasks?: number | null;
  billingSplit?: string;
  /** O eixo da assinatura (§2A.4, `Budget.signatureStatus`). */
  signatureStatus?: string | null;
  /**
   * A aprovação do valor VIGENTE (`revokedAt` nulo), a mais recente primeiro —
   * o select traz no máximo uma. Ver `projectValueApproval`.
   */
  valueApprovals?: Array<{
    source?: string | null;
    decidedAt?: Date | null;
    note?: string | null;
    total?: unknown;
    responsible?: { name?: string | null } | null;
  }>;
  services?: Array<{
    id?: string;
    description?: string;
    amount?: unknown;
    observation?: string | null;
    position?: number;
  }>;
  request?: {
    briefing?: string | null;
    logoName?: string | null;
    requestedAt?: Date | null;
    preApprovedAt?: Date | null;
    refusedAt?: Date | null;
    decisionNote?: string | null;
  } | null;
  /**
   * ⚠️ Carregue SEMPRE com `...scope.payerScopeSelect(principal)`. O projetor
   * copia o que receber: se o `include` trouxe os dois pagadores, ele projeta
   * os dois. Escopo é do `PortalScopeService`; projeção é daqui.
   */
  customerConfigs?: Array<{
    id?: string;
    customerId?: string;
    customer?: { id?: string; fantasyName?: string | null; corporateName?: string | null } | null;
    subtotal?: unknown;
    total?: unknown;
    discountType?: string | null;
    discountValue?: unknown;
    paymentCondition?: string | null;
    paymentConfig?: unknown;
    customPaymentText?: string | null;
    generateInvoice?: boolean | null;
    generateBankSlip?: boolean | null;
    installments?: Array<{
      id?: string;
      number?: number;
      amount?: unknown;
      dueDate?: Date | null;
      paidAmount?: unknown;
      paidAt?: Date | null;
      status?: string;
      bankSlip?: {
        id?: string;
        digitableLine?: string | null;
        dueDate?: Date | null;
        amount?: unknown;
        status?: string;
      } | null;
    }>;
  }>;
  /**
   * ⛔ AS NOTAS DO ORÇAMENTO SÃO DE TODOS OS PAGADORES, E A RELAÇÃO NÃO TEM DONO.
   *
   * `Budget.nfseDocuments` pendura TODA nota do orçamento. Diferente de
   * `customerConfigs`, aqui não bastava avisar "carregue com o `where` certo": a
   * versão anterior deste projetor copiava a lista inteira, e o `where` vivia no
   * `select` de UM chamador (`portal-read.service.ts`). O segundo chamador
   * esqueceria — e o esquecimento não dá erro, dá a nota fiscal do outro
   * pagador.
   *
   * Por isso `projectBudget` passou a EXIGIR `{ customerId }` e a recortar aqui
   * dentro. Para isso ele precisa do DONO de cada nota, e o dono são dois campos:
   *
   *   · `customerConfig.customerId` — o pagador; e
   *   · `invoice.customerId`        — a fatura (`Invoice.customerId` é NOT NULL).
   *
   * Os DOIS, em `OR`, porque `NfseDocument.customerConfigId` é `SetNull`: uma
   * reversão de faturamento apaga o vínculo com o pagador e a nota — que
   * continua viva na prefeitura — ficaria órfã e sumiria da tela de quem a
   * pagou.
   */
  nfseDocuments?: Array<{
    id?: string;
    nfseNumber?: number | null;
    status?: string;
    createdAt?: Date | null;
    customerConfig?: { customerId?: string | null } | null;
    invoice?: { customerId?: string | null } | null;
  }>;
  tasks?: PortalTaskRow[];
  [extra: string]: unknown;
}

/**
 * DE QUEM É esta resposta — o dado que o projetor não tem como adivinhar.
 *
 * Um objeto, e não um `customerId: string` solto, de propósito: o parâmetro é
 * OBRIGATÓRIO e posicional, e um terceiro argumento string ao lado de um array
 * de papéis é o tipo de assinatura em que se troca um pelo outro sem o
 * compilador reclamar.
 */
export interface PortalProjectionScope {
  /** `responsible.companyId`, já provado não-nulo por `PortalScopeService`. */
  customerId: string;
}

/**
 * ESTA NOTA É DESTA EMPRESA?
 *
 * ⛔ FALHA FECHADO. Sem `customerId`, ou com uma nota cujo `select` não trouxe
 * nem `customerConfig` nem `invoice`, a resposta é NÃO. É a direção certa do
 * erro: uma nota a menos numa tela é um chamado; uma nota a mais é o documento
 * fiscal de outra empresa na mão de um terceiro.
 */
export function nfseBelongsToCustomer(
  nfse: { customerConfig?: { customerId?: string | null } | null; invoice?: { customerId?: string | null } | null } | null | undefined,
  customerId: string | null | undefined,
): boolean {
  const alvo = customerId?.trim();
  if (!alvo || !nfse) return false;
  return (nfse.customerConfig?.customerId ?? null) === alvo || (nfse.invoice?.customerId ?? null) === alvo;
}

// ─────────────────────────────────────────────────────────────────────────────
// O DINHEIRO SAI COMO NÚMERO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `Decimal` VIRA `number` ANTES DE SAIR.
 *
 * O driver devolve `Prisma.Decimal`, que serializa como STRING no JSON. O portal
 * saiu ao ar com `pricing: { subtotal: "74100", total: "74100" }` e o web declara
 * `number | null` e guarda com `typeof === "number"` — resultado: os 118
 * orçamentos da lista mostravam TRAVESSÃO no lugar do preço, e o vendedor era
 * convidado a pré-aprovar sem ver o valor. Não houve erro em lugar nenhum: o
 * campo existia, tinha o nome certo e o tipo errado.
 *
 * A conversão é pela FORMA do valor, e não por uma lista de nomes, exatamente
 * como `BillingService.toPlainNumbers` (`financial/billing/billing.service.ts`
 * :292-320) — o grafo do portal tem dinheiro em cinco níveis (`quote`,
 * `customerConfigs`, `installments`, `bankSlip`, `invoices`) e uma coluna nova em
 * qualquer um deles voltaria a sair como string sem que nada acusasse.
 *
 * `Date` não é confundido: `Decimal` tem `toNumber`/`toFixed`, `Date` não tem
 * nenhum dos dois.
 */
function isDecimalLike(value: unknown): value is { toNumber: () => number } {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { toNumber?: unknown; toFixed?: unknown };
  return typeof candidate.toNumber === 'function' && typeof candidate.toFixed === 'function';
}

/**
 * UM campo de dinheiro, no ponto em que o projetor o copia.
 *
 * É esta função que faz o COMPILADOR cobrar quem esquecer: os campos de dinheiro
 * de `PortalBudgetView` são `number | null`, e a linha crua os traz como
 * `unknown` — copiar direto não compila mais.
 *
 * ⚠️ AQUI a string numérica É convertida, e na varredura abaixo NÃO é. A
 * diferença não é descuido: aqui quem chama já declarou "este campo é dinheiro",
 * e lá o valor está numa chave qualquer da árvore — onde string numérica é
 * `digitableLine`, `serialNumber`, `cnpj` ou `barcode`, e transformá-las em
 * número seria um defeito bem pior do que o que este arquivo conserta.
 */
export function toPortalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (isDecimalLike(value)) {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A REDE, no ponto de retorno: a árvore inteira, com todo `Decimal` virado
 * `number`.
 *
 * Existe ao lado de `toPortalNumber` porque as duas cobrem buracos diferentes.
 * `toPortalNumber` cobre o que o projetor copia à mão e o compilador vigia; esta
 * cobre o que sai por caminhos que o compilador não vê — os `map((b: any) => …)`
 * de `portal-read.service.ts`, onde a linha do Prisma é `any` e um `Decimal`
 * atravessa calado.
 *
 * ⛔ NÃO toca em string. Ver a nota em `toPortalNumber`.
 */
export function toPortalPlainNumbers<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(v => toPortalPlainNumbers(v)) as unknown as T;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (isDecimalLike(value)) return value.toNumber() as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toPortalPlainNumbers(v);
  }
  return out as unknown as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// AS VISTAS — o que sai
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O grupo por seção é `undefined` quando a seção não está no recorte — e não um
 * objeto de campos nulos.
 *
 * A distinção importa na tela: `undefined` quer dizer "você não vê isto", e o
 * portal esconde a aba inteira; um objeto com campos nulos quer dizer "isto
 * existe e está vazio", e a tela desenharia um cartão de preço com traços onde
 * deveria não haver cartão nenhum.
 */
export interface PortalVehicleView {
  id: string;
  name: string | null;
  status: string;
  /**
   * `DELIVERY` — A PREVISÃO DE ENTREGA, no topo e não só dentro de `progress`.
   *
   * "Quando fica pronto?" é a pergunta nº 1 do cliente, e a LISTA da frota
   * precisa da data numa coluna — cavar `progress.forecastDate` obrigaria a
   * lista a carregar o andamento inteiro (as O.S., a linha do tempo) para
   * imprimir um campo. Ela continua em `progress` também: lá é o contexto do
   * acompanhamento, aqui é a coluna.
   *
   * ⛔ `Task.forecastDate`, JAMAIS `Task.term`. `term` é o compromisso INTERNO
   * que a produção persegue, está em `PORTAL_NEVER_EXPOSED` e diverge da
   * previsão de propósito. Os dois são `DateTime?` em `Task` e trocar um pelo
   * outro não dá erro em lugar nenhum — dá uma data errada prometida ao cliente.
   */
  forecastDate?: Date | null;
  /** `VEHICLE` — o endereço do veículo: série, placa, chassi, plaqueta, pedido, cliente. */
  identity?: {
    serialNumber: string | null;
    plate: string | null;
    chassisNumber: string | null;
    vinPlate: PortalFileRow | null;
    customerOrderNumber: string | null;
    purchaseOrder: { id: string; number: string; issuedAt: Date | null } | null;
    customer: { id: string; name: string } | null;
  };
  /**
   * `VEHICLE` — o que é da Furgões/do cliente (R7, PLANO §7.4): tipo, categoria,
   * as medidas das 4 faces (METROS; a chave é `back`, nunca `rear`), a porta
   * traseira (`null` = nada informado) e o projeto do implemento.
   */
  implement?: {
    id: string | null;
    type: string | null;
    category: string | null;
    measures: Record<ImplementFace, PortalMeasureRow | null>;
    rearDoor: { leaves: string | null; barCount: number | null; hatchCount: number | null } | null;
    projectFiles: PortalFileRow[];
  };
  /**
   * `LAYOUT` — referência da TAREFA (cores, arquivos-base) e os ARQUIVOS da arte
   * APROVADA. `layout.artworks` continua só com a aprovada, como sempre foi: é o
   * que o web e o app leem hoje, e contrato só cresce na Fase B.
   */
  layout?: {
    generalPainting: PortalPaintRow | null;
    logoPaints: PortalPaintRow[];
    baseFiles: PortalFileRow[];
    artworks: PortalFileRow[];
  };
  /**
   * `LAYOUT` — A ARTE DO IMPLEMENTO COMO O CLIENTE A DECIDE (PLANO §7.4): as
   * pendentes (com `canDecide`), as aprovadas (com quem e quando) e as
   * reprovadas (com o motivo), na ordem das versões. `DRAFT` e `SUPERSEDED`
   * nunca aparecem. Ver `projectArtwork`.
   */
  artworks?: PortalArtworkView[];
  /** `DELIVERY` — previsão e andamento das O.S. */
  progress?: {
    entryDate: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    forecastDate: Date | null;
    steps: Array<{
      id: string;
      description: string;
      status: string;
      startedAt: Date | null;
      finishedAt: Date | null;
    }>;
  };
}

export interface PortalBudgetView {
  id: string;
  budgetNumber: number | null;
  status: string | null;
  statusOrder: number | null;
  createdAt: Date | null;
  expiresAt: Date | null;
  vehicleCount: number | null;
  /**
   * O EIXO DA ASSINATURA (§2A.4) e o rótulo dele — inclusive "Assinada fora do
   * sistema" (DD11). Cabeçalho, sem seção: é o mesmo fato que o estado do
   * orçamento, e o cliente que assinou tem de ver que assinou.
   */
  signatureStatus: string | null;
  signatureStatusLabel: string | null;
  /**
   * A APROVAÇÃO DO VALOR vigente (§2A.6, `BudgetValueApproval`), ou `null`.
   * Cabeçalho, exceto `total`, que é `PRICING` (o marketing sabe QUE o valor foi
   * aprovado, não QUAL). Ver `projectValueApproval`.
   */
  valueApproval: PortalValueApprovalView | null;
  /**
   * O RECORTE que este contato recebeu, devolvido junto com o dado.
   *
   * A tela precisa disto para esconder a aba, e não para filtrar o conteúdo — o
   * conteúdo já veio filtrado. Devolver a régua é o que permite a UI dizer "você
   * não tem acesso a valores" em vez de desenhar um cartão vazio.
   */
  sections: QuoteSection[];
  /** `SERVICES` */
  services?: Array<{
    id: string;
    description: string;
    observation: string | null;
    position: number;
  }>;
  /** `PRICING` — preço unitário, subtotal, total, desconto. */
  pricing?: {
    subtotal: number | null;
    total: number | null;
    vehicleCount: number | null;
    items: Array<{ id: string; description: string; amount: number | null; position: number }>;
  };
  /** `DELIVERY` — prazo e previsão no nível do contrato. */
  delivery?: { customForecastDays: number | null; simultaneousTasks: number | null };
  /** `PAYMENT` — parcelas, boletos, NFS-e. */
  payment?: {
    billingSplit: string | null;
    payers: Array<{
      id: string;
      customerId: string;
      customerName: string | null;
      /** O ACORDO que gerou as parcelas — ver o `select` em `portal-read.service.ts`. */
      subtotal: number | null;
      total: number | null;
      discountType: string | null;
      discountValue: number | null;
      paymentCondition: string | null;
      paymentConfig: unknown;
      customPaymentText: string | null;
      generateInvoice: boolean | null;
      generateBankSlip: boolean | null;
      installments: Array<{
        id: string;
        number: number | null;
        amount: number | null;
        dueDate: Date | null;
        /**
         * ⚠️ O VALOR já pago, ao lado da data. `paidAt` sozinho obriga a tela a
         * derivar o pago como `paidAt ? amount : null` — e a parcela paga PELA
         * METADE some: ou vira quitada, ou vira intocada. Nenhuma das duas é o
         * que aconteceu com o dinheiro de quem está lendo.
         */
        paidAmount: number | null;
        paidAt: Date | null;
        status: string | null;
        bankSlip: {
          id: string;
          digitableLine: string | null;
          dueDate: Date | null;
          amount: number | null;
          status: string | null;
        } | null;
      }>;
    }>;
    nfse: Array<{
      id: string;
      nfseNumber: number | null;
      status: string | null;
      createdAt: Date | null;
    }>;
  };
  /** `GUARANTEE` */
  guarantee?: { years: number | null; text: string | null };
  /** `LAYOUT` — os arquivos da arte APROVADA dos implementos (`quoteArtworkOf`). */
  layout?: { files: PortalFileRow[] };
  /**
   * `LAYOUT` — A ARTE DO ORÇAMENTO PELOS IMPLEMENTOS (PLANO §6.3, §7.5, §7.7):
   * os contadores por VEÍCULO e as artes AGRUPADAS POR ARQUIVO, para o lote
   * "Aprovar para os N veículos". Ver `projectBudgetArtwork`.
   */
  artwork?: PortalBudgetArtworkView;
  /**
   * A REQUISIÇÃO, quando o orçamento nasceu no portal.
   *
   * Não tem seção própria, e é de propósito: briefing e nome de logomarca são o
   * que o PRÓPRIO cliente escreveu. Recortar de volta o texto que ele mandou
   * seria esconder dele o que ele mesmo disse.
   */
  request?: {
    briefing: string | null;
    logoName: string | null;
    requestedAt: Date | null;
    preApprovedAt: Date | null;
    refusedAt: Date | null;
    /**
     * O MOTIVO DA DECISÃO — a nota da pré-aprovação ou o motivo da recusa.
     *
     * Sai no DETALHE e na LISTA, e sem portão de seção: quem escreveu foi o
     * próprio cliente, e o colega que abre o orçamento depois precisa ler por
     * que ele voltou para o comercial. Sem este campo a recusa chega ao portal
     * como um estado que mudou sozinho.
     */
    decisionNote: string | null;
  };
  /**
   * AS ETIQUETAS DOS VEÍCULOS — `VEHICLE`.
   *
   * O cliente não procura orçamento por número: procura pelo IMPLEMENTO ("o 1042",
   * "o da placa ABC1D23"). A lista precisa dessas duas palavras por linha, e
   * antes disto ela as obtinha cruzando `GET /cliente/me/veiculos` com
   * `take=300` — uma segunda consulta paginada que degradava em silêncio assim
   * que a frota passava do teto (os orçamentos que ficassem de fora voltavam a
   * dizer "N veículos").
   *
   * Três campos, e só: quem quiser o veículo inteiro tem `vehicles`. É a mesma
   * régua de seção — sem `VEHICLE`, nem etiqueta nem `identity`.
   */
  vehicleChips?: Array<{ taskId: string; serialNumber: string | null; plate: string | null }>;
  vehicles: PortalVehicleView[];
}

/**
 * A ARTE, como o cliente a lê (PLANO §7.4):
 * `{ id, file, status, version, decidedAt, decidedBy{name}, canDecide, note }`,
 * mais o rótulo do estado e a origem da decisão.
 */
export interface PortalArtworkView {
  id: string;
  fileId: string | null;
  file: PortalFileRow | null;
  status: string;
  statusLabel: string | null;
  version: number | null;
  /** Quando a Ankaa enviou para aprovar. */
  sentAt: Date | null;
  decidedAt: Date | null;
  /** `PORTAL`, `ON_BEHALF`, `INTERNAL`, `MIGRATED_*` — ou `null` enquanto pendente. */
  source: string | null;
  sourceLabel: string | null;
  /**
   * QUEM decidiu, pelo NOME — e só o nome. O contato do cliente pelo nome dele;
   * a Ankaa como "Ankaa", NUNCA o nome do funcionário (gente da Ankaa não sai do
   * portal: é a mesma regra de `commercialUser` em `PORTAL_NEVER_EXPOSED`). A
   * arte migrada não tem autor conhecido: `null`.
   */
  decidedBy: { name: string } | null;
  /**
   * O motivo da reprovação ou a nota da aprovação "em nome do cliente". A nota
   * de uma reprovação INTERNA (`INTERNAL`) é conversa da Ankaa e não sai.
   */
  note: string | null;
  /** O contato pode aprovar/reprovar AGORA (pendente ∧ `APPROVE_ARTWORK` ∧ escopo comercial). */
  canDecide: boolean;
}

export interface PortalValueApprovalView {
  decidedAt: Date | null;
  source: string | null;
  sourceLabel: string | null;
  /** Mesma regra de `PortalArtworkView.decidedBy`: o contato pelo nome, a Ankaa como "Ankaa". */
  decidedBy: { name: string } | null;
  note: string | null;
  /** `PRICING` — o total que foi aprovado; `null` para quem não vê preço. */
  total: number | null;
}

/**
 * O estado da arte de UM VEÍCULO, para os contadores (§7.7):
 *  · `AWAITING_CUSTOMER` — alguma arte `PENDING_APPROVAL` (o cliente deve uma
 *    decisão, mesmo que uma versão anterior já esteja aprovada);
 *  · `APPROVED` — nenhuma pendente e alguma `APPROVED` (é o mesmo critério do
 *    portão da emissão, `artworkGateFailure`: "tem arte aprovada");
 *  · `AT_ANKAA` — nada disso: sem arte, só rascunho ou só reprovada. A Ankaa
 *    está preparando.
 */
export type PortalVehicleArtworkState = 'AWAITING_CUSTOMER' | 'APPROVED' | 'AT_ANKAA';

export interface PortalBudgetArtworkView {
  /** Veículos VIVOS (não cancelados) do orçamento que este contato vê. */
  total: number;
  approved: number;
  awaitingCustomer: number;
  /** Dos que aguardam o cliente, os que ESTE contato pode decidir. */
  awaitingMe: number;
  atAnkaa: number;
  /**
   * As artes agrupadas por ARQUIVO, na ordem em que aparecem nos veículos: um
   * arquivo mandado aos N veículos do orçamento é UM grupo com N linhas, e
   * `pendingLayoutIds` é exatamente o corpo de `PUT /cliente/me/artes/aprovar`
   * ("Aprovar para os N veículos").
   */
  groups: Array<{
    fileId: string;
    file: PortalFileRow | null;
    vehicles: Array<{
      taskId: string;
      layoutId: string;
      status: string;
      statusLabel: string | null;
      version: number | null;
      canDecide: boolean;
    }>;
    pendingLayoutIds: string[];
  }>;
}

/** Os estados que o cliente vê. `DRAFT` e `SUPERSEDED` nunca. */
const PORTAL_ARTWORK_STATUSES = new Set(['PENDING_APPROVAL', 'APPROVED', 'REPROVED']);

/**
 * ESTA LINHA DE ARTE PODE IR AO CLIENTE?
 *
 * `PENDING_APPROVAL` e `APPROVED` sim. `REPROVED` só se foi ENVIADA (`sentAt`):
 * a reprovação interna de um rascunho (`reprove` aceita `DRAFT`) é a Ankaa
 * descartando uma proposta que o cliente nunca viu, e mostrá-la seria mostrar
 * a conversa interna pela porta dos fundos.
 */
export function isPortalVisibleArtwork(layout: PortalLayoutRow | null | undefined): boolean {
  if (!layout?.id || !PORTAL_ARTWORK_STATUSES.has(layout.status ?? '')) return false;
  if (layout.status === 'REPROVED' && !layout.sentAt) return false;
  return true;
}

/** Quem decidiu, pela origem. Ver `PortalArtworkView.decidedBy`. */
function deciderName(
  source: string | null,
  responsibleName: string | null | undefined,
): { name: string } | null {
  if (source === 'PORTAL') return { name: responsibleName?.trim() || 'Contato do cliente' };
  if (source === 'ON_BEHALF' || source === 'INTERNAL' || source === 'LEGACY_APP') {
    return { name: 'Ankaa' };
  }
  // MIGRATED_*, MIGRATED, SIGNATURE: o registro não diz quem; inventar seria pior.
  return responsibleName?.trim() ? { name: responsibleName.trim() } : null;
}

/**
 * A ARTE, projetada. `canDecideVehicle` é a resposta, já calculada pelo
 * chamador, a "este contato pode decidir a arte DESTE veículo?" (capacidade ∧
 * escopo comercial); a pendência é conferida aqui.
 */
export function projectArtwork(layout: PortalLayoutRow, canDecideVehicle: boolean): PortalArtworkView {
  const status = layout.status ?? null;
  const decided = status === 'APPROVED' || status === 'REPROVED';
  const decision = (layout.decisions ?? []).find(d => d?.toStatus === status) ?? null;
  const source = decided ? (decision?.source ?? layout.approvalSource ?? null) : null;
  const rawNote = decided ? (decision?.note ?? layout.decisionNote ?? null) : null;
  const file = layout.file
    ? {
        id: layout.file.id ?? null,
        filename: layout.file.filename ?? null,
        originalName: layout.file.originalName ?? null,
        mimetype: layout.file.mimetype ?? null,
        size: layout.file.size ?? null,
        thumbnailUrl: layout.file.thumbnailUrl ?? null,
      }
    : null;
  return {
    id: layout.id ?? null,
    fileId: layout.fileId ?? file?.id ?? null,
    file,
    status,
    statusLabel: status ? (LAYOUT_STATUS_LABELS as Record<string, string>)[status] ?? null : null,
    version: layout.version ?? null,
    sentAt: layout.sentAt ?? null,
    decidedAt: decided ? (decision?.createdAt ?? layout.decidedAt ?? null) : null,
    source,
    sourceLabel: source
      ? (LAYOUT_APPROVAL_SOURCE_LABELS as Record<string, string>)[source] ?? null
      : null,
    decidedBy: decided
      ? deciderName(source, decision?.responsible?.name ?? layout.decidedByResponsible?.name)
      : null,
    // A nota de uma decisão INTERNA é conversa da Ankaa; a do cliente e a feita
    // "em nome do cliente" são dele.
    note: source === 'PORTAL' || source === 'ON_BEHALF' ? rawNote : null,
    canDecide: status === 'PENDING_APPROVAL' && canDecideVehicle,
  } as PortalArtworkView;
}

/** O estado da arte de um veículo — ver `PortalVehicleArtworkState`. */
export function vehicleArtworkState(
  layouts: readonly PortalLayoutRow[] | null | undefined,
): PortalVehicleArtworkState {
  const statuses = (layouts ?? []).map(l => l?.status);
  if (statuses.includes('PENDING_APPROVAL')) return 'AWAITING_CUSTOMER';
  if (statuses.includes('APPROVED')) return 'APPROVED';
  return 'AT_ANKAA';
}

/**
 * A PROVA DO MARCO "ARTE APROVADA" (escada do portal): alguma arte do implemento
 * foi aprovada — a vigente (`APPROVED`) ou uma que a versão nova substituiu
 * (`SUPERSEDED` só nasce de uma aprovação, D-21). A data é a da PRIMEIRA
 * aprovação conhecida; arte migrada pode não ter data, e aí o marco fica
 * atingido "sem data registrada", como o "Orçamento aprovado".
 *
 * É monotônico por construção: arte aprovada não se desaprova (D-21), então a
 * prova nunca some.
 */
export function artworkApprovalEvidence(
  layouts: readonly PortalLayoutRow[] | null | undefined,
): { reached: boolean; at: Date | null } {
  const approved = (layouts ?? []).filter(
    l => l?.status === 'APPROVED' || l?.status === 'SUPERSEDED',
  );
  if (!approved.length) return { reached: false, at: null };
  const dates = approved
    .map(l => l.decidedAt ?? null)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());
  return { reached: true, at: dates[0] ?? null };
}

/**
 * O CONTEXTO DA DECISÃO — quem é o contato, para o projetor responder
 * `canDecide`. Sem ele (ou sem empresa), `canDecide` é sempre `false`: falha
 * fechado, como `commercialTaskLink`.
 */
export interface PortalDecisionContext {
  roles: readonly string[] | null | undefined;
  customerId: string | null;
}

/**
 * ESTE CONTATO PODE DECIDIR A ARTE DESTE VEÍCULO? A MESMA pergunta que as rotas
 * `…/artes/…/aprovar|reprovar` fazem (`portal-artwork.service.ts`): capacidade
 * `APPROVE_ARTWORK` ∧ escopo COMERCIAL (dono ∨ pagador; o caminho pessoal (c)
 * não decide) ∧ veículo vivo. A linha precisa ter vindo com `customerId` e com
 * `billingEntry` recortado pela empresa (`portalCommercialLinkSelect`); sem
 * eles, `false`.
 */
export function canDecideArtworkOf(
  row: Pick<PortalTaskRow, 'status' | 'customerId' | 'billingEntry'>,
  ctx: PortalDecisionContext | null,
): boolean {
  if (!ctx?.customerId) return false;
  if (!hasCapability(ctx.roles, PORTAL_CAPABILITY.APPROVE_ARTWORK)) return false;
  // Veículo cancelado não é pintado: não há o que aprovar.
  if (row.status === 'CANCELLED') return false;
  return commercialTaskLink(row, ctx.customerId) !== null;
}

@Injectable()
export class PortalProjectionService {
  /**
   * A RÉGUA, e o único ponto em que ela é consultada.
   *
   * Reexportada como método para que nenhum chamador do portal importe
   * `sectionsForRoles` direto e caia na tentação de "ajustar" o resultado antes
   * de projetar.
   *
   * ⛔ CONTRADIÇÃO CONHECIDA DO CONTRATO, registrada aqui para não ser
   * descoberta em produção: `sectionsForRoles(['FLEET_MANAGER'])` e
   * `sectionsForRoles(['DRIVER'])` devolvem `[]` — o conjunto vazio é
   * PRESERVADO vazio por `withAlwaysSections`, porque na cerimônia de assinatura
   * vazio significa "este contato não assina". Aplicada à TELA, a mesma régua
   * diz que esses dois papéis não veem NADA além do cabeçalho — enquanto a
   * tabela de capacidades (contrato §2.1) dá `WRITE_VEHICLE_IDENTITY` ao gestor
   * de frota e `TRACK` aos dois. O resultado é um gestor que pode ESCREVER a
   * placa e não pode LÊ-LA.
   *
   * Este projetor implementa o contrato como está escrito (nega), porque
   * expor a mais é o erro que não tem volta e porque inventar um segundo mapa de
   * seções é exatamente o que §2 proíbe. O conserto é uma linha em
   * `ROLE_DEFAULT_SECTIONS` — dar `['VEHICLE']` ao gestor de frota e
   * `['VEHICLE','DELIVERY']` ao motorista —, e é decisão do dono, não deste
   * pacote. Ver o retorno do API-1.
   */
  sectionsFor(roles: readonly string[] | null | undefined): QuoteSection[] {
    // ⚠️ `portalSectionsFor`, NÃO `sectionsForRoles`. A diferença é o gestor de
    // frota e o motorista: `sectionsForRoles` devolve `[]` para os dois — certo
    // para a assinatura ("não assina"), e um portal EM BRANCO para quem o
    // desenho deu trabalho a fazer. A derivação está documentada em
    // `portal-capabilities.ts` → `SECTION_IMPLIED_BY_CAPABILITY`, e a régua da
    // assinatura continua intocada.
    return portalSectionsFor(roles);
  }

  /**
   * O ORÇAMENTO, recortado.
   *
   * `roles` é a lista do principal (`request.responsible.roles`). Passar `[]`,
   * `null` ou um papel que saiu do enum produz o recorte VAZIO — só o cabeçalho.
   * A negação é o padrão em todos os caminhos: nenhum grupo aparece por omissão.
   *
   * ⛔ `scope` É OBRIGATÓRIO, e é isso que conserta o vazamento estrutural das
   * NFS-e. Ver a nota em `PortalBudgetRow.nfseDocuments`: a relação não tem dono
   * embutido, e enquanto o recorte morava no `select` de um chamador, o segundo
   * chamador o esqueceria em silêncio. Sendo parâmetro, `projectBudget` não pode
   * ser chamado sem dizer de quem é a resposta — o compilador cobra.
   */
  projectBudget(
    row: PortalBudgetRow | null | undefined,
    roles: readonly string[] | null | undefined,
    scope: PortalProjectionScope,
  ): PortalBudgetView | null {
    if (!row) return null;
    const sections = this.sectionsFor(roles);
    const customerId = scope?.customerId ?? null;
    const decision: PortalDecisionContext = { roles, customerId };
    const signatureStatus = row.signatureStatus ?? null;

    // O CABEÇALHO, que nenhuma seção recorta. É o "texto básico" da cerimônia de
    // assinatura, lido para a tela: sem número, status e data, a linha da lista
    // não é um orçamento — é uma linha em branco. Note o que NÃO está aqui:
    // `total`, que é `PRICING`, e `commercialUserId`, que é gente da Ankaa.
    const view: PortalBudgetView = {
      id: row.id ?? null,
      budgetNumber: row.budgetNumber ?? null,
      status: row.status ?? null,
      statusOrder: row.statusOrder ?? null,
      createdAt: row.createdAt ?? null,
      expiresAt: row.expiresAt ?? null,
      vehicleCount: row.vehicleCount ?? null,
      signatureStatus,
      signatureStatusLabel: signatureStatus
        ? (BUDGET_SIGNATURE_STATUS_LABELS as Record<string, string>)[signatureStatus] ?? null
        : null,
      valueApproval: this.projectValueApproval(row.valueApprovals?.[0], hasSection(sections, 'PRICING')),
      sections,
      vehicles: (row.tasks ?? []).map(t => this.projectVehicle(t, sections, decision)),
    };

    if (hasSection(sections, 'VEHICLE')) {
      view.vehicleChips = (row.tasks ?? []).map(t => ({
        taskId: t.id ?? null,
        serialNumber: t.implement?.serialNumber ?? null,
        plate: t.implement?.plate ?? null,
      })) as PortalBudgetView['vehicleChips'];
    }

    if (hasSection(sections, 'SERVICES')) {
      // SERVIÇOS SEM VALOR. A lista e o preço são seções DIFERENTES, e há um
      // papel real entre as duas: o marketing que pede o serviço e não vê o
      // preço. Copiar `amount` aqui apagaria `PRICING` na prática.
      view.services = (row.services ?? []).map(s => ({
        id: s.id ?? null,
        description: s.description ?? null,
        observation: s.observation ?? null,
        position: s.position ?? 0,
      })) as PortalBudgetView['services'];
    }

    if (hasSection(sections, 'PRICING')) {
      view.pricing = {
        subtotal: toPortalNumber(row.subtotal),
        total: toPortalNumber(row.total),
        vehicleCount: row.vehicleCount ?? null,
        items: (row.services ?? []).map(s => ({
          id: s.id ?? null,
          description: s.description ?? null,
          amount: toPortalNumber(s.amount),
          position: s.position ?? 0,
        })) as PortalBudgetView['pricing']['items'],
      };
    }

    if (hasSection(sections, 'DELIVERY')) {
      view.delivery = {
        customForecastDays: row.customForecastDays ?? null,
        simultaneousTasks: row.simultaneousTasks ?? null,
      };
    }

    if (hasSection(sections, 'PAYMENT')) {
      view.payment = {
        billingSplit: row.billingSplit ?? null,
        payers: (row.customerConfigs ?? []).map(c => ({
          id: c.id ?? null,
          customerId: c.customerId ?? null,
          customerName: c.customer?.fantasyName ?? c.customer?.corporateName ?? null,
          subtotal: toPortalNumber(c.subtotal),
          total: toPortalNumber(c.total),
          discountType: c.discountType ?? null,
          discountValue: toPortalNumber(c.discountValue),
          paymentCondition: c.paymentCondition ?? null,
          paymentConfig: c.paymentConfig ?? null,
          customPaymentText: c.customPaymentText ?? null,
          generateInvoice: c.generateInvoice ?? null,
          generateBankSlip: c.generateBankSlip ?? null,
          installments: (c.installments ?? []).map(i => ({
            id: i.id ?? null,
            number: i.number ?? null,
            amount: toPortalNumber(i.amount),
            dueDate: i.dueDate ?? null,
            paidAmount: toPortalNumber(i.paidAmount),
            paidAt: i.paidAt ?? null,
            status: i.status ?? null,
            bankSlip: i.bankSlip
              ? {
                  id: i.bankSlip.id ?? null,
                  digitableLine: i.bankSlip.digitableLine ?? null,
                  dueDate: i.bankSlip.dueDate ?? null,
                  amount: toPortalNumber(i.bankSlip.amount),
                  status: i.bankSlip.status ?? null,
                }
              : null,
          })),
        })),
        // ⛔ O RECORTE DA NOTA FISCAL, AQUI DENTRO — não no `select` de quem
        // chamou. Ver `PortalBudgetRow.nfseDocuments`. Note que o dono (`
        // customerConfig`/`invoice`) é usado e NÃO copiado: ele entra para
        // decidir, não para sair.
        nfse: (row.nfseDocuments ?? [])
          .filter(n => nfseBelongsToCustomer(n, customerId))
          .map(n => ({
            id: n.id ?? null,
            nfseNumber: n.nfseNumber ?? null,
            status: n.status ?? null,
            createdAt: n.createdAt ?? null,
          })),
      } as PortalBudgetView['payment'];
    }

    if (hasSection(sections, 'GUARANTEE')) {
      view.guarantee = {
        years: row.guaranteeYears ?? null,
        text: row.customGuaranteeText ?? null,
      };
    }

    if (hasSection(sections, 'LAYOUT')) {
      // A arte do orçamento é a aprovada dos implementos (`quoteArtworkOf`, a
      // mesma que o documento de assinatura imprime).
      view.layout = {
        files: quoteArtworkOf<PortalFileRow>({
          tasks: (row.tasks ?? []).map(t => ({
            id: t.id ?? '',
            status: t.status ?? null,
            implement: { layouts: (t.implement?.layouts ?? []) as any },
          })),
        })
          .files.map(f => this.projectFile(f))
          .filter((f): f is PortalFileRow => f !== null),
      };
      view.artwork = this.projectBudgetArtwork(row.tasks ?? [], decision);
    }

    if (row.request) {
      view.request = {
        briefing: row.request.briefing ?? null,
        logoName: row.request.logoName ?? null,
        requestedAt: row.request.requestedAt ?? null,
        preApprovedAt: row.request.preApprovedAt ?? null,
        refusedAt: row.request.refusedAt ?? null,
        decisionNote: row.request.decisionNote ?? null,
      };
    }

    // A REDE, no ponto de saída. Os seis campos acima já passaram por
    // `toPortalNumber` e o compilador os vigia; esta varredura pega o `Decimal`
    // que entrar por um campo NOVO — inclusive num grupo de seção acrescentado
    // por quem não leu este arquivo. Ver `toPortalPlainNumbers`.
    return toPortalPlainNumbers(view);
  }

  /**
   * O VEÍCULO, recortado. Também é o que `/cliente/me/veiculos` devolve.
   *
   * Aceita os papéis (e recalcula o recorte) ou o recorte já calculado, para que
   * projetar os N veículos de um orçamento não chame `sectionsForRoles` N vezes
   * — e, mais importante, para que não haja como os veículos saírem com um
   * recorte diferente do orçamento que os carrega.
   */
  projectTask(
    row: PortalTaskRow | null | undefined,
    roles: readonly string[] | null | undefined,
    /**
     * De quem é a resposta — só para `artworks[].canDecide`. Opcional porque o
     * veículo sem escopo continua projetável (a leitura não depende dele); sem
     * ele, `canDecide` é `false` em toda arte: falha fechado.
     */
    scope?: PortalProjectionScope,
  ): PortalVehicleView | null {
    if (!row) return null;
    return this.projectVehicle(row, this.sectionsFor(roles), {
      roles,
      customerId: scope?.customerId ?? null,
    });
  }

  private projectVehicle(
    row: PortalTaskRow,
    sections: QuoteSection[],
    decision: PortalDecisionContext | null,
  ): PortalVehicleView {
    // O cabeçalho do veículo: id, nome e status. `status` é `TaskStatus`
    // (PREPARATION / WAITING_PRODUCTION / IN_PRODUCTION / COMPLETED /
    // CANCELLED) — não tem PAUSED, e é por isso que ele pode sair sem recorte.
    // A pausa vive na O.S., e a O.S. pausada não sai daqui (ver `projectStep`).
    const view: PortalVehicleView = {
      id: row.id ?? null,
      name: row.name ?? null,
      status: row.status ?? null,
    };

    if (hasSection(sections, 'VEHICLE')) {
      const implement = row.implement ?? null;
      view.identity = {
        serialNumber: implement?.serialNumber ?? null,
        plate: implement?.plate ?? null,
        chassisNumber: implement?.chassisNumber ?? null,
        // A plaqueta é IMAGEM, não texto, desde `20260727150000_implement_vin_plate_image`.
        vinPlate: implement?.vinPlate ? this.projectFile(implement.vinPlate) : null,
        // O número do pedido de compra é do cliente, escrito pelo cliente. Fica
        // na identidade do veículo porque é isso que ele é: o endereço
        // administrativo daquela entrega.
        customerOrderNumber: row.customerOrderNumber ?? null,
        purchaseOrder: row.purchaseOrder
          ? {
              id: row.purchaseOrder.id ?? null,
              number: row.purchaseOrder.number ?? null,
              issuedAt: row.purchaseOrder.issuedAt ?? null,
            }
          : null,
        customer: row.customer
          ? {
              id: row.customer.id ?? null,
              name: row.customer.fantasyName ?? row.customer.corporateName ?? null,
            }
          : null,
      } as PortalVehicleView['identity'];

      // O IMPLEMENTO (§7.4): o que é da Furgões/do cliente, separado do endereço.
      const rearDoor = {
        leaves: implement?.rearDoorLeaves ?? null,
        barCount: implement?.rearDoorBarCount ?? null,
        hatchCount: implement?.rearDoorHatchCount ?? null,
      };
      view.implement = {
        id: implement?.id ?? null,
        type: implement?.type ?? null,
        category: implement?.category ?? null,
        // ⚠️ MEDIDAS SAEM EM METROS, como estão no banco. A conversão para
        // centímetros é da BORDA (o formulário divide por 100 ao enviar e
        // multiplica ao exibir). Convertê-las aqui faria o portal ter uma
        // unidade diferente do resto do sistema para o mesmo campo.
        measures: Object.fromEntries(
          IMPLEMENT_FACES.map(face => [face, this.projectMeasure(implement?.[`${face}SideMeasure`])]),
        ) as Record<ImplementFace, PortalMeasureRow | null>,
        rearDoor: Object.values(rearDoor).some(v => v !== null) ? rearDoor : null,
        projectFiles: (implement?.projectFiles ?? [])
          .map(f => this.projectFile(f))
          .filter((f): f is PortalFileRow => f !== null),
      };
    }

    if (hasSection(sections, 'LAYOUT')) {
      view.layout = {
        generalPainting: this.projectPaint(row.generalPainting),
        logoPaints: (row.logoPaints ?? []).map(p => this.projectPaint(p)),
        baseFiles: (row.baseFiles ?? []).map(f => this.projectFile(f)),
        // A ARTE vem de duas origens: os arquivos soltos e os `Layout`
        // aprovados. Só os APROVADOS saem: um layout em revisão é conversa
        // interna, e mandá-lo ao cliente é pedir aprovação do que ainda não
        // foi proposto.
        artworks: (row.implement?.layouts ?? [])
          .filter(l => l?.status === 'APPROVED' && l?.file)
          .map(l => this.projectFile(l.file)),
      };
      // A ARTE COMO O CLIENTE A DECIDE (§7.4). Um cálculo de `canDecide` por
      // VEÍCULO, e não por arte: capacidade e escopo comercial são do veículo;
      // a pendência é de cada linha.
      const canDecide = canDecideArtworkOf(row, decision);
      view.artworks = (row.implement?.layouts ?? [])
        .filter(isPortalVisibleArtwork)
        .sort((a, b) => (a.version ?? 0) - (b.version ?? 0))
        .map(l => projectArtwork(l, canDecide));
    }

    if (hasSection(sections, 'DELIVERY')) {
      // A MESMA data em dois lugares, e o mesmo portão de seção nos dois: a
      // coluna da lista lê daqui, o cartão de andamento lê de `progress`.
      view.forecastDate = row.forecastDate ?? null;
      view.progress = {
        entryDate: row.entryDate ?? null,
        startedAt: row.startedAt ?? null,
        finishedAt: row.finishedAt ?? null,
        // `forecastDate` é a PREVISÃO, que é o que se promete. `term` é o prazo
        // interno e está em `PORTAL_NEVER_EXPOSED`.
        forecastDate: row.forecastDate ?? null,
        steps: (row.serviceOrders ?? [])
          .filter(so => PORTAL_VISIBLE_SERVICE_ORDER_TYPES.includes(so?.type))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map(so => this.projectStep(so)),
      };
    }

    return view;
  }

  /**
   * A ARTE DO ORÇAMENTO PELOS IMPLEMENTOS — ver `PortalBudgetArtworkView`.
   *
   * Conta VEÍCULO, não arte: a pergunta do cliente é "de quantos caminhões falta
   * a arte?", e um veículo com duas artes pendentes é UM veículo esperando.
   * Cancelado não conta (não será pintado), como no portão da emissão.
   *
   * ⚠️ Os veículos são os que o `select` trouxe — já recortados por
   * `taskScopeWhere`. Quem paga o terceiro de dez veículos conta um.
   */
  private projectBudgetArtwork(
    tasks: readonly PortalTaskRow[],
    decision: PortalDecisionContext,
  ): PortalBudgetArtworkView {
    const out: PortalBudgetArtworkView = {
      total: 0,
      approved: 0,
      awaitingCustomer: 0,
      awaitingMe: 0,
      atAnkaa: 0,
      groups: [],
    };
    const groups = new Map<string, PortalBudgetArtworkView['groups'][number]>();
    for (const task of tasks) {
      if (!task?.id || task.status === 'CANCELLED') continue;
      const visible = (task.implement?.layouts ?? []).filter(isPortalVisibleArtwork);
      const canDecide = canDecideArtworkOf(task, decision);
      out.total++;
      const state = vehicleArtworkState(visible);
      if (state === 'AWAITING_CUSTOMER') {
        out.awaitingCustomer++;
        if (canDecide) out.awaitingMe++;
      } else if (state === 'APPROVED') {
        out.approved++;
      } else {
        out.atAnkaa++;
      }
      for (const layout of [...visible].sort((a, b) => (a.version ?? 0) - (b.version ?? 0))) {
        const art = projectArtwork(layout, canDecide);
        const key = art.fileId ?? art.id;
        const group = groups.get(key) ?? {
          fileId: key,
          file: art.file,
          vehicles: [],
          pendingLayoutIds: [],
        };
        group.vehicles.push({
          taskId: task.id,
          layoutId: art.id,
          status: art.status,
          statusLabel: art.statusLabel,
          version: art.version,
          canDecide: art.canDecide,
        });
        if (art.canDecide) group.pendingLayoutIds.push(art.id);
        groups.set(key, group);
      }
    }
    out.groups = [...groups.values()];
    return out;
  }

  /**
   * A APROVAÇÃO DO VALOR vigente — ver `PortalValueApprovalView`. `total` só com
   * `PRICING`: o fato de o valor estar aprovado é do cabeçalho; o número, não.
   */
  private projectValueApproval(
    approval: PortalBudgetRow['valueApprovals'][number] | null | undefined,
    seesPrice: boolean,
  ): PortalValueApprovalView | null {
    if (!approval) return null;
    const source = approval.source ?? null;
    return {
      decidedAt: approval.decidedAt ?? null,
      source,
      sourceLabel: source
        ? (BUDGET_VALUE_APPROVAL_SOURCE_LABELS as Record<string, string>)[source] ?? null
        : null,
      decidedBy: deciderName(source, approval.responsible?.name),
      // A nota do contato e a "em nome do cliente" são dele; as demais origens
      // (assinatura, app antigo, migração) não têm nota a mostrar.
      note: source === 'PORTAL' || source === 'ON_BEHALF' ? (approval.note ?? null) : null,
      total: seesPrice ? toPortalNumber(approval.total) : null,
    };
  }

  /**
   * A ETAPA — quatro campos, e só.
   *
   * `PAUSED` é reescrito para `IN_PROGRESS`: para o cliente, uma etapa pausada
   * é uma etapa em andamento. A pausa é almoço, troca de turno ou fila de
   * cabine, e mostrá-la cria um telefonema por dia sobre um estado que não
   * significa nada do lado de fora.
   *
   * ⚠️ E `pausedAt` não sai nem reescrito — ver `PORTAL_NEVER_EXPOSED`.
   */
  private projectStep(so: PortalServiceOrderRow) {
    const status = so?.status === 'PAUSED' ? 'IN_PROGRESS' : (so?.status ?? null);
    return {
      id: so?.id ?? null,
      description: so?.description ?? null,
      status,
      startedAt: so?.startedAt ?? null,
      finishedAt: so?.finishedAt ?? null,
    };
  }

  private projectPaint(paint: PortalPaintRow | null | undefined): PortalPaintRow | null {
    if (!paint) return null;
    return {
      id: paint.id ?? null,
      name: paint.name ?? null,
      hex: paint.hex ?? null,
      finish: paint.finish ?? null,
      // ACHATADO: a tela quer "Poliéster", não um objeto com uma chave. O
      // aninhamento só existe porque o Prisma o traz assim.
      type: paint.paintType?.name ?? null,
    };
  }

  /**
   * O ARQUIVO — metadado, NUNCA `path`.
   *
   * `File.path` é o caminho no disco do servidor e a árvore é literal
   * (`Clientes/{razão social}/Boletos/`). Mandá-lo ao cliente é mandar o mapa do
   * armazenamento junto do arquivo.
   *
   * ⚠️ E o acesso ao arquivo em si continua sendo o bloqueador de §9 do desenho:
   * todo arquivo é público por UUID hoje. Este projetor não o conserta; ele só
   * não piora, devolvendo o id e o nome e deixando a autorização para a rota de
   * arquivo (pacote R10).
   */
  private projectFile(file: PortalFileRow | null | undefined): PortalFileRow | null {
    if (!file) return null;
    return {
      id: file.id ?? null,
      filename: file.filename ?? null,
      originalName: file.originalName ?? null,
      mimetype: file.mimetype ?? null,
      size: file.size ?? null,
      thumbnailUrl: file.thumbnailUrl ?? null,
    };
  }

  private projectMeasure(measure: PortalMeasureRow | null | undefined): PortalMeasureRow | null {
    if (!measure) return null;
    return {
      height: measure.height ?? null,
      sections: (measure.sections ?? []).map(s => ({
        width: s.width ?? null,
        isDoor: s.isDoor ?? false,
        doorHeight: s.doorHeight ?? null,
        position: s.position ?? 0,
      })),
    };
  }
}
