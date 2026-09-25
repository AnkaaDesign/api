// api/src/modules/people/portal/portal-read.service.ts
//
// AS LEITURAS DO PORTAL DO CLIENTE — a superfície de dado que `/cliente/me/*`
// entrega.
//
// Este arquivo não decide quem vê o quê. Ele CARREGA e PROJETA, e as duas
// réguas vêm prontas de outro lugar:
//
//   · QUAIS LINHAS  → `PortalScopeService` (§3 do contrato). Nunca um `where`
//     de escopo escrito à mão aqui dentro.
//   · QUAIS COLUNAS → `PortalProjectionService` (§2). Nunca um segundo mapa de
//     seções, e nunca um `.filter()` depois da consulta.
//
// O que É deste arquivo, e não existe em nenhum dos dois, é a TERCEIRA garantia
// do §9: a linha do tempo do cliente é PROJEÇÃO MONOTÔNICA. Ver a seção
// "A ESCADA" mais abaixo.
//
// ⛔ TRÊS COISAS QUE NÃO PODEM SER AFROUXADAS AQUI
//
// 1. `customerConfigs` SEMPRE com `...scope.payerScopeSelect(principal)`.
//    `GET /budgets/public/:id` erra exatamente isso hoje (`budget.service.ts`
//    :5502-5608) e entrega a A o cadastro fiscal, as parcelas, os boletos e as
//    notas de B. O projetor COPIA o que recebe — se o `include` trouxe os dois
//    pagadores, ele projeta os dois. O corte é do `select`.
//
// 2. `Budget.nfseDocuments` NÃO TEM dono embutido. A relação pendura TODAS as
//    notas do orçamento, de todos os pagadores; `PortalBudgetRow.nfseDocuments`
//    é copiada sem filtro. Quem escopa é o `where` daqui — por
//    `customerConfig.customerId` OU `invoice.customerId`, porque `customerConfigId`
//    é `SetNull` e some numa reversão de faturamento.
//
// 3. Âncora do dinheiro é `Invoice.customerId` (NOT NULL), via
//    `scope.invoiceScopeWhere`. NUNCA `Installment.customerConfigId`, que é
//    opcional e fica órfão na reversão.

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, EnvelopeStatus, EnvelopeSignerStatus } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { hasSection, type QuoteSection } from '@modules/common/signature/quote-sections';
import { LIVE_INVOICE_WHERE } from '@/utils/billing-invoice';
import {
  ENTITY_TYPE,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  TASK_QUOTE_STATUS,
  TASK_STATUS,
} from '@constants';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import { PortalScopeService } from './portal-scope.service';
import { PortalProjectionService, toPortalPlainNumbers } from './portal-projection.service';
import { PORTAL_CAPABILITY, capabilitiesForRoles } from './portal-capabilities';

// ═══════════════════════════════════════════════════════════════════════════
// A ORDEM DA LISTA DO CLIENTE — parecida com a da fila interna, e NÃO é ela
// ═══════════════════════════════════════════════════════════════════════════
//
// `statusOrder` primeiro nos dois lados: é a ordem de ATENÇÃO (o que precisa de
// decisão vem antes do que já está resolvido), e ela vale para quem trabalha a
// fila e para quem acompanha o próprio histórico.
//
// O DESEMPATE É QUE DIVERGE, de propósito:
//
//   · A fila INTERNA é uma FILA DE TRABALHO. Lá o pendente mais ANTIGO é o mais
//     urgente — é justamente para isso que `queueRank` existe (coluna GERADA: o
//     instante de criação em segundos, negado nos estados terminais), e
//     `{ queueRank: 'asc' }` põe o mais velho no topo. Continua assim; ver
//     `BUDGET_QUEUE_ORDER` em `budget-prisma.repository.ts`, que este arquivo
//     NÃO usa mais e NÃO altera.
//
//   · A lista do CLIENTE é o HISTÓRICO DELE. Ninguém abre o próprio portal para
//     descobrir qual pedido está esperando há mais tempo: abre para ver o que
//     acabou de mandar. Com `queueRank asc`, a requisição recém-aberta caía no
//     FIM do grupo de pendentes — o dono abriu uma e não a encontrou na tela.
//     `{ createdAt: 'desc' }` põe o mais novo em cima, que é o que a página é.
//
// ⛔ NÃO troque isto por `BUDGET_QUEUE_ORDER` "para unificar": as duas listas
// respondem a perguntas diferentes, e a igualdade anterior era coincidência de
// forma, não de intenção.
const PORTAL_BUDGET_ORDER: Prisma.BudgetOrderByWithRelationInput[] = [
  { statusOrder: 'asc' },
  { createdAt: 'desc' },
];

// ═══════════════════════════════════════════════════════════════════════════
// A ESCADA — o acompanhamento como projeção monotônica
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE NÃO SE LÊ O CARIMBO AO VIVO (contrato §9):
//   · O.S. → `PENDING` zera TODAS as datas dela (`service-order.service.ts`
//     :824-841): `startedAt`, `finishedAt`, `approvedAt`, `pausedAt`;
//   · cancelar toda O.S. de produção zera `Task.startedAt` (`:1050-1066`);
//   · `COMPLETED → PREPARATION` é transição LEGAL da tarefa.
// Os três acontecem em operação normal. Um cliente que viu "Concluído" veria
// "Em Preparação" na semana seguinte, e não há como explicar isso a ele.
//
// A ESCADA resolve com duas ideias:
//   (i)  evidência REDUNDANTE — cada marco tem várias provas independentes, e
//        basta UMA sobreviver. A mais forte é o `ChangeLog`, que é append-only:
//        a mesma transação que zera `Task.startedAt` grava a linha do
//        rebaixamento, e a linha fica.
//   (ii) MONOTONIA — o marco atual é o MAIOR índice com evidência, e todo
//        índice abaixo dele é dado por atingido mesmo sem carimbo próprio.
//
// ⛔ E `Task.status` NÃO SAI NA RESPOSTA. É a coluna que regride; devolvê-la ao
// lado de uma escada monotônica seria publicar as duas verdades e deixar a tela
// escolher qual mostrar. `PortalProjectionService` a copia para
// `PortalVehicleView.status` — este serviço a RETIRA e põe o marco no lugar.

/** A escada, NA ORDEM. O índice É a ordem. */
export const PORTAL_MILESTONES = [
  { key: 'ORCAMENTO_ENVIADO', label: 'Orçamento enviado' },
  { key: 'ORCAMENTO_APROVADO', label: 'Orçamento aprovado' },
  { key: 'VEICULO_RECEBIDO', label: 'Veículo recebido' },
  { key: 'EM_PRODUCAO', label: 'Em produção' },
  { key: 'CONCLUIDO', label: 'Concluído' },
] as const;

export type PortalMilestoneKey = (typeof PORTAL_MILESTONES)[number]['key'];

const MILESTONE_INDEX = PORTAL_MILESTONES.reduce<Record<string, number>>((acc, m, i) => {
  acc[m.key] = i;
  return acc;
}, {});

export interface PortalTimelineEntry {
  key: PortalMilestoneKey;
  label: string;
  order: number;
  reached: boolean;
  /** `null` num marco ATINGIDO significa "o carimbo foi apagado e só o
   *  changelog prova o fato". Inventar a data seria pior que omiti-la. */
  reachedAt: Date | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SELECTS — allowlists, nunca "tudo menos"
// ═══════════════════════════════════════════════════════════════════════════

const FILE_SELECT = {
  id: true,
  filename: true,
  originalName: true,
  mimetype: true,
  size: true,
  thumbnailUrl: true,
} as const;

// ⚠️ O TIPO DA TINTA VEM JUNTO (`paintType.name`: "Poliéster", "Acrílica", …).
// Acabamento e tipo respondem coisas diferentes e o cliente precisa dos dois
// para levar a cor ao funileiro dele: "Perolizado" diz como reflete, "Poliéster"
// diz do que é feita. A relação é obrigatória no schema, então não há ramo nulo
// a tratar além do próprio recorte.
const PAINT_SELECT = {
  id: true,
  name: true,
  hex: true,
  finish: true,
  paintType: { select: { name: true } },
} as const;

const MEASURE_SELECT = {
  height: true,
  sections: {
    orderBy: { position: 'asc' as const },
    select: { width: true, isDoor: true, doorHeight: true, position: true },
  },
} as const;

/**
 * ⛔ FILTRO DE TIPO NO SERVIDOR. Nenhuma O.S. `COMMERCIAL` chega ao cliente:
 * são 52 descrições, entre elas "Aplicar Desconto", "Contraproposta" e "Tratar
 * Reclamação". `GET /task-quotes/public/:id` as devolve HOJE a quem tiver o link
 * (`budget.service.ts:5640-5653`, sem filtro de tipo) — a página só desenha as
 * que têm foto, e o JSON cru fica no DevTools.
 *
 * `PortalProjectionService` também filtra, por lista positiva, ao projetar. Os
 * dois filtros são de propósito: o de lá protege quem chamar o projetor com uma
 * linha carregada por outro caminho; o daqui garante que os bytes nunca saiam do
 * banco.
 */
const PORTAL_SERVICE_ORDER_WHERE: Prisma.ServiceOrderWhereInput = {
  type: SERVICE_ORDER_TYPE.PRODUCTION as any,
  status: { not: SERVICE_ORDER_STATUS.CANCELLED as any },
};

const SERVICE_ORDER_SELECT = {
  id: true,
  description: true,
  type: true,
  status: true,
  position: true,
  startedAt: true,
  finishedAt: true,
} as const;

/**
 * O VEÍCULO. `status` entra no `select` como EVIDÊNCIA da escada e é retirado da
 * resposta em `overlayVehicle`. Fora daqui: nada de `details`, `term`,
 * `bonification`, `sectorId`, `createdById`, `Implement.spot`, `Observation`,
 * `Cut`, `Airbrushing` (§9).
 */
const TASK_BASE_SELECT = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  customerOrderNumber: true,
  entryDate: true,
  startedAt: true,
  finishedAt: true,
  forecastDate: true,
  createdAt: true,
  customerId: true,
  customer: { select: { id: true, fantasyName: true, corporateName: true } },
  purchaseOrder: { select: { id: true, number: true, issuedAt: true } },
  implement: {
    select: {
      id: true,
      serialNumber: true,
      plate: true,
      chassisNumber: true,
      category: true,
      type: true,
      vinPlate: { select: FILE_SELECT },
      leftSideMeasure: { select: MEASURE_SELECT },
      rightSideMeasure: { select: MEASURE_SELECT },
      backSideMeasure: { select: MEASURE_SELECT },
      frontSideMeasure: { select: MEASURE_SELECT },
      // Porta traseira (R5, DD4) e o projeto do implemento (R6, a Furgões): §7.4.
      rearDoorLeaves: true,
      rearDoorBarCount: true,
      rearDoorHatchCount: true,
      projectFiles: { select: FILE_SELECT },
    },
  },
} as const;

/**
 * A TRADUÇÃO DA ORDENAÇÃO DA FROTA — allowlist fechada, `campo` → `orderBy` do
 * Prisma.
 *
 * ⛔ É esta tabela, e SÓ ela, que decide o que entra num `orderBy`. Nada que
 * venha do cliente é interpolado: o cliente manda um nome, o nome é chave desta
 * tabela ou é descartado no schema, e o VALOR é literal escrito aqui.
 *
 * ⚠️ TODA relação usada aqui é de-UM (`implement`, `customer`, `quote`,
 * `purchaseOrder`). O Prisma não ordena por relação de-MUITOS, e um `orderBy`
 * que ele recusa é 500 no driver, não um aviso. Foi por isso que "Logomarca" e
 * "Cliente" perderam a seta na lista INTERNA de orçamentos (lá `name` mora na
 * TAREFA, que é lista do orçamento) — e é por isso que aqui elas TÊM a seta: a
 * linha é a própria tarefa, e `name` é coluna dela.
 *
 * ⚠️ `customer` ordena por `fantasyName`, que é o nome que a coluna DESENHA
 * (`fantasyName ?? corporateName`). Ordenar por `corporateName` produziria uma
 * ordem que não é a da coluna — o defeito mais difícil de ver que existe numa
 * tabela ordenável.
 *
 * O terceiro elemento é a SEÇÃO que o campo exige. Ordenar por placa é um
 * oráculo sobre a placa: quem não recebe `identity` não pode ordenar por ela,
 * mesmo digitando o parâmetro à mão. `null` = campo do cabeçalho, sem recorte
 * (`name` é o título da linha e já sai sem seção nenhuma em `projectVehicle`).
 */
/**
 * ⚠️ VAZIO VAI PARA O FIM NOS DOIS SENTIDOS.
 *
 * O Postgres ordena `NULLS LAST` no `ASC` e `NULLS FIRST` no `DESC` — e o
 * segundo é péssimo aqui: clicar duas vezes em "Previsão" numa frota onde
 * metade ainda não tem data entrega uma página inteira de traço, e o contato
 * conclui que a ordenação quebrou. Célula vazia é ausência de informação e
 * pertence ao fim da lista, tanto faz a direção.
 *
 * ⛔ Só vale para campo ESCALAR NULÁVEL. `Customer.fantasyName` é `NOT NULL`,
 * `Budget.budgetNumber` é `NOT NULL`, e `Task.createdAt` também — declarar
 * `nulls` neles é erro de tipo do Prisma, não preferência.
 */
const vazioNoFim = (dir: 'asc' | 'desc') => ({ sort: dir, nulls: 'last' as const });

const VEHICLE_ORDER_BY: Record<
  string,
  { build: (dir: 'asc' | 'desc') => Prisma.TaskOrderByWithRelationInput; section: QuoteSection | null }
> = {
  name: { build: dir => ({ name: vazioNoFim(dir) }), section: null },
  budgetNumber: { build: dir => ({ quote: { budgetNumber: dir } }), section: null },
  createdAt: { build: dir => ({ createdAt: dir }), section: null },
  serialNumber: { build: dir => ({ implement: { serialNumber: vazioNoFim(dir) } }), section: 'VEHICLE' },
  plate: { build: dir => ({ implement: { plate: vazioNoFim(dir) } }), section: 'VEHICLE' },
  chassisNumber: { build: dir => ({ implement: { chassisNumber: vazioNoFim(dir) } }), section: 'VEHICLE' },
  customer: { build: dir => ({ customer: { fantasyName: dir } }), section: 'VEHICLE' },
  purchaseOrderNumber: {
    build: dir => ({ customerOrderNumber: vazioNoFim(dir) }),
    section: 'VEHICLE',
  },
  forecastDate: { build: dir => ({ forecastDate: vazioNoFim(dir) }), section: 'DELIVERY' },
};

/**
 * O DESEMPATE, sempre no fim.
 *
 * Sem ele duas linhas empatadas (e numa frota de 358 "Marquespan 5,20" empatam
 * às dezenas) podem trocar de posição entre a consulta da página 1 e a da
 * página 2 — e o contato vê o mesmo implemento duas vezes e nunca vê outro. É o
 * mesmo motivo pelo qual `listVehicles` já carregava `{ id: 'asc' }`.
 */
const VEHICLE_ORDER_TIEBREAK: Prisma.TaskOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

// ═══════════════════════════════════════════════════════════════════════════

export interface PortalListQuery {
  page?: number;
  take?: number;
  status?: string[];
  searchingFor?: string;
  /**
   * DUAS GRAMÁTICAS, UMA CHAVE — e a rota decide qual lê.
   *
   * · `'fila' | 'recentes'` em `/cliente/me/orcamentos`. A linha é um CONTRATO
   *   e a ordem que importa é a de ATENÇÃO (`PORTAL_BUDGET_ORDER`), não a de uma
   *   coluna. É por isso que aquela rota não ganhou ordenação por cabeçalho.
   * · `string[]` de `campo:direção` em `/cliente/me/veiculos`. Ali a linha é um
   *   VEÍCULO, não há fila a preservar, e o dono pediu cabeçalho ordenável. A
   *   allowlist é `PORTAL_VEHICLE_SORT_FIELDS` (no controller) e a tradução
   *   para Prisma é `VEHICLE_ORDER_BY`, aqui embaixo.
   *
   * ⚠️ Os dois schemas são declarados em `portal-read.controller.ts` e o do
   * veículo SOBRESCREVE o herdado — nenhuma rota recebe as duas formas.
   */
  orderBy?: 'fila' | 'recentes' | string[];
  /**
   * `GET /cliente/me/cobrancas?budgetId=…` — as cobranças de UM orçamento.
   *
   * ⚠️ Filtro, nunca escopo. Ele ESTREITA o que `invoiceScopeWhere` +
   * `budgetScopeWhere` já permitiram; um id de orçamento de outra empresa
   * devolve lista vazia, não a cobrança dela.
   */
  budgetId?: string;
  /**
   * `GET /cliente/me/veiculos?semPedido=true` — só os que ainda não têm número
   * de pedido de compra (`true`), só os que têm (`false`), todos (ausente).
   *
   * ⚠️ Filtro, nunca escopo — como `budgetId`. E é ele que substitui o
   * `take: 500` que a tela de pedidos usava para responder, no navegador,
   * "quantos ainda estão sem número?": a resposta certa é `meta.totalRecords`
   * de uma página de um.
   */
  semPedido?: boolean;
}

interface PortalMeta {
  totalRecords: number;
  page: number;
  take: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

@Injectable()
export class PortalReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScopeService,
    private readonly projection: PortalProjectionService,
  ) {}

  // ═════════════════════════════════════════════════════════════════════════
  // AS RÉGUAS — consultadas, nunca reimplementadas
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * ⛔ `sectionsFor` é o ÚNICO ponto em que a régua de seções é consultada, e
   * o resultado NÃO é ajustado aqui.
   *
   * Isso tem uma consequência conhecida e registrada: `FLEET_MANAGER` e `DRIVER`
   * recebem `[]` — na cerimônia de assinatura, vazio quer dizer "este contato
   * não assina", e aplicado à TELA quer dizer "não vê nada além do cabeçalho".
   * A tabela de capacidades (§2.1) dá `WRITE_VEHICLE_IDENTITY` ao gestor de
   * frota e `TRACK` aos dois, então os dois podem ESCREVER a placa e não podem
   * LÊ-LA. O conserto é uma linha em `ROLE_DEFAULT_SECTIONS`
   * (`quote-sections.ts`) e é decisão do dono — não deste pacote, e não de um
   * remendo local, que só faria a tela e o PDF divergirem.
   */
  private sectionsOf(principal: ResponsiblePrincipal): QuoteSection[] {
    return this.projection.sectionsFor(principal.roles);
  }

  private capabilitiesOf(principal: ResponsiblePrincipal): PORTAL_CAPABILITY[] {
    return capabilitiesForRoles(principal.roles);
  }

  /** O andamento é a seção `DELIVERY` — a mesma que libera `progress` no projetor. */
  private canSeeProgress(sections: readonly QuoteSection[]): boolean {
    return hasSection(sections, 'DELIVERY');
  }

  private requireSection(sections: readonly QuoteSection[], section: QuoteSection): void {
    if (!hasSection(sections, section)) {
      throw new ForbiddenException(
        'Seu perfil de contato não tem acesso a esta informação. Fale com o comercial.',
      );
    }
  }

  private paginate(query: PortalListQuery): { skip: number; take: number; page: number } {
    const take = Math.min(Math.max(Number(query?.take) || 20, 1), 100);
    const page = Math.max(Number(query?.page) || 1, 1);
    return { skip: (page - 1) * take, take, page };
  }

  /**
   * A ordenação pedida pela tela → o `orderBy` do Prisma, RECORTADA.
   *
   * Três recusas, todas silenciosas e todas com a mesma saída (a ordem padrão),
   * porque nenhuma delas é erro de quem clicou:
   *   · campo fora da allowlist — o schema já o descartou, isto é o cinto;
   *   · campo de uma seção que este contato não tem — ordenar por placa é um
   *     oráculo sobre a placa;
   *   · nada sobrou — a lista volta em `createdAt desc`, como sempre voltou.
   *
   * ⚠️ 400 seria a alternativa, e é a errada: um `?orderBy=` guardado num
   * favorito com o id de uma coluna que saiu derrubaria a tela inteira, e a
   * rodada passada já pagou esse preço com o `orderBy` em formato de Prisma.
   */
  private vehicleOrderBy(
    query: PortalListQuery,
    sections: readonly QuoteSection[],
  ): Prisma.TaskOrderByWithRelationInput[] {
    const pedido = Array.isArray(query?.orderBy) ? query.orderBy : [];
    const ordens: Prisma.TaskOrderByWithRelationInput[] = [];
    const usados = new Set<string>();

    for (const entrada of pedido) {
      const [campo, direcao] = String(entrada).split(':');
      const regra = VEHICLE_ORDER_BY[campo];
      if (!regra || usados.has(campo)) continue;
      if (regra.section && !hasSection(sections, regra.section)) continue;
      usados.add(campo);
      ordens.push(regra.build(direcao === 'desc' ? 'desc' : 'asc'));
    }

    // O desempate entra SEMPRE, e sem repetir o que já foi pedido: um
    // `createdAt` duas vezes no mesmo `orderBy` é ordem indefinida no Postgres.
    return [
      ...ordens,
      ...VEHICLE_ORDER_TIEBREAK.filter(t => !usados.has(Object.keys(t)[0])),
    ];
  }

  private meta(totalRecords: number, page: number, take: number): PortalMeta {
    const totalPages = Math.max(Math.ceil(totalRecords / take), 1);
    return {
      totalRecords,
      page,
      take,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // A EVIDÊNCIA APPEND-ONLY
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * O que este veículo JÁ FOI, segundo o changelog.
   *
   * `oldValue` conta tanto quanto `newValue`: num rebaixamento
   * `COMPLETED → PREPARATION`, a prova do `COMPLETED` está no lado VELHO — é a
   * única linha do sistema que registra que aquele estado existiu.
   *
   * Uma consulta por PÁGINA, não por linha: `@@index([entityType, entityId])`
   * serve o `in` diretamente.
   */
  private async statusHistory(
    entityType: string,
    ids: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return out;

    const rows = await this.prisma.changeLog.findMany({
      where: { entityType: entityType as any, entityId: { in: unique }, field: 'status' },
      select: { entityId: true, oldValue: true, newValue: true },
    });

    for (const row of rows) {
      const seen = out.get(row.entityId) ?? [];
      for (const raw of [row.oldValue, row.newValue]) {
        if (typeof raw === 'string' && raw) seen.push(raw);
      }
      out.set(row.entityId, seen);
    }
    return out;
  }

  /**
   * QUANDO O ORÇAMENTO FOI APROVADO — a data, não só o fato.
   *
   * ⛔ O marco "Orçamento aprovado" vinha SEM DATA ("data não registrada") em
   * todo orçamento do sistema, e não por falta de evidência: `statusHistory` já
   * provava que a transição aconteceu — ela só descartava o `createdAt` da
   * linha do changelog ao achatar tudo num array de strings. O fato chegava, a
   * data ficava para trás.
   *
   * ⚠️ NÃO EXISTE COLUNA para isto. `Budget.billingApprovedAt` é a aprovação do
   * FATURAMENTO, outro ato e outro momento; inventar uma coluna nova exigiria
   * backfill de 9 mil orçamentos a partir deste mesmo changelog. Ler daqui é
   * ler a fonte, não uma cópia.
   *
   * ⚠️ A MAIS ANTIGA, e `SIGNED` conta junto: um orçamento que foi assinado,
   * cancelado e reaprovado tem duas entradas, e a que interessa é a primeira —
   * é a data em que o acordo passou a existir para o cliente.
   */
  private async quoteApprovalDates(ids: readonly string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return out;

    // ⛔ O FILTRO DE `newValue` NÃO VAI NO `where`, e a tentativa custou um 500:
    // `ChangeLog.newValue` é `Json?`, e `in` de string não existe para Json
    // ("Unknown argument `in`. Did you mean `lt`?"). É a mesma razão pela qual
    // `statusHistory`, logo acima, também traz os valores e peneira em JS.
    const rows = await this.prisma.changeLog.findMany({
      where: {
        entityType: ENTITY_TYPE.TASK_QUOTE as any,
        entityId: { in: unique },
        field: 'status',
      },
      select: { entityId: true, newValue: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const aprovacoes = new Set<string>([TASK_QUOTE_STATUS.APPROVED, TASK_QUOTE_STATUS.SIGNED]);
    for (const row of rows) {
      if (!row.createdAt) continue;
      const valor = typeof row.newValue === 'string' ? row.newValue : null;
      if (!valor || !aprovacoes.has(valor)) continue;
      if (!out.has(row.entityId)) out.set(row.entityId, row.createdAt);
    }
    return out;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // A PROJEÇÃO MONOTÔNICA
  // ═════════════════════════════════════════════════════════════════════════

  private projectTimeline(
    task: {
      status?: string | null;
      entryDate?: Date | null;
      startedAt?: Date | null;
      finishedAt?: Date | null;
      createdAt?: Date | null;
    },
    quote: { createdAt?: Date | null; status?: string | null } | null,
    serviceOrders: readonly { startedAt?: Date | null; finishedAt?: Date | null; status?: string }[],
    history: readonly string[],
    quoteHistory: readonly string[],
    /** Ver `quoteApprovalDates`. `null` = o changelog não guarda a transição. */
    quoteApprovedAt: Date | null,
  ): {
    milestone: PortalMilestoneKey;
    milestoneLabel: string;
    cancelled: boolean;
    timeline: PortalTimelineEntry[];
  } {
    const at: (Date | null)[] = [null, null, null, null, null];
    const evidence: boolean[] = [false, false, false, false, false];

    // 0 — Orçamento enviado. Sempre atingido: o veículo só é visível ao cliente
    //     porque existe um contrato (ou, sem orçamento, porque a tarefa existe).
    at[0] = quote?.createdAt ?? task.createdAt ?? null;
    evidence[0] = true;

    // 1 — Orçamento aprovado.
    //
    // ⚠️ `APPROVED` é REVERSÍVEL: `APPROVED → PENDING` é transição legal (o
    //    cliente desiste antes de haver cobrança). Ler só o estado vivo faria o
    //    marco RECUAR na tela de quem já o tinha visto — exatamente o que a
    //    escada existe para impedir. Por isso o changelog entra como prova
    //    independente: ele é append-only e guarda o `APPROVED` nos dois lados da
    //    linha (`oldValue` inclusive), então sobrevive à volta.
    //
    // ⚠️ NÃO existe coluna `Budget.approvedAt` — só `billingApprovedAt`, que é
    //    do FATURAMENTO e responde outra pergunta. Quando a prova vem só do
    //    changelog, o marco fica `reached: true` com `reachedAt: null`, que a
    //    tela já sabe desenhar ("aconteceu, a data não sobreviveu").
    //
    // `SIGNED` conta: o cliente assinou e o que falta é a contra-assinatura da
    // Ankaa — do lado de fora, o acordo está fechado.
    if (
      quote?.status === TASK_QUOTE_STATUS.APPROVED ||
      quote?.status === TASK_QUOTE_STATUS.SIGNED ||
      quoteHistory.includes(TASK_QUOTE_STATUS.APPROVED) ||
      quoteHistory.includes(TASK_QUOTE_STATUS.SIGNED)
    ) {
      evidence[1] = true;
      // ⚠️ A DATA VEM DO CHANGELOG, e pode faltar: orçamento aprovado antes de
      // o changelog existir chega aqui sem carimbo. `null` num marco atingido é
      // exatamente o caso que a tela já sabe dizer ("data não registrada") — e
      // é mais honesto do que carimbar `updatedAt`, que muda a cada toque.
      at[1] = quoteApprovedAt;
    }

    // 2 — Veículo recebido.
    if (task.entryDate) {
      at[2] = task.entryDate;
      evidence[2] = true;
    }

    // 3 — Em produção. Quatro provas independentes; basta uma sobreviver.
    const earliestSoStart = serviceOrders
      .map(so => so?.startedAt ?? null)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (task.startedAt || earliestSoStart) {
      at[3] = task.startedAt ?? earliestSoStart ?? null;
      evidence[3] = true;
    }
    if (
      task.status === TASK_STATUS.IN_PRODUCTION ||
      serviceOrders.some(so => so?.finishedAt || so?.status === SERVICE_ORDER_STATUS.COMPLETED) ||
      history.includes(TASK_STATUS.IN_PRODUCTION)
    ) {
      evidence[3] = true;
    }

    // 4 — Concluído.
    if (task.finishedAt) {
      at[4] = task.finishedAt;
      evidence[4] = true;
    }
    if (task.status === TASK_STATUS.COMPLETED || history.includes(TASK_STATUS.COMPLETED)) {
      evidence[4] = true;
    }

    // A MONOTONIA, numa linha: o maior índice com evidência arrasta todos os
    // anteriores. É isto — e não a ordem das checagens acima — que faz
    // "Concluído" nunca virar "Em Preparação".
    let reached = 0;
    for (let i = 0; i < evidence.length; i++) if (evidence[i]) reached = i;

    const timeline: PortalTimelineEntry[] = PORTAL_MILESTONES.map((m, i) => ({
      key: m.key,
      label: m.label,
      order: i,
      reached: i <= reached,
      reachedAt: i <= reached ? at[i] : null,
    }));

    return {
      milestone: PORTAL_MILESTONES[reached].key,
      milestoneLabel: PORTAL_MILESTONES[reached].label,
      cancelled: task.status === TASK_STATUS.CANCELLED,
      timeline,
    };
  }

  /**
   * O estado da ETAPA, monotônico pelo mesmo motivo — `→ PENDING` zera as datas
   * da O.S. e o changelog é a única prova que sobra.
   *
   * O vocabulário é o de `PortalProjectionService.projectStep`
   * (`PENDING`/`IN_PROGRESS`/`COMPLETED`, com `PAUSED` reescrito para
   * `IN_PROGRESS`) de propósito: a tela já sabe ler esses três, e um quarto
   * conjunto de rótulos só existiria para dizer a mesma coisa.
   */
  private projectStepState(
    so: { status?: string | null; startedAt?: Date | null; finishedAt?: Date | null },
    history: readonly string[],
  ): 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' {
    if (
      so?.finishedAt ||
      so?.status === SERVICE_ORDER_STATUS.COMPLETED ||
      history.includes(SERVICE_ORDER_STATUS.COMPLETED)
    ) {
      return 'COMPLETED';
    }
    if (
      so?.startedAt ||
      (so?.status && so.status !== SERVICE_ORDER_STATUS.PENDING) ||
      history.includes(SERVICE_ORDER_STATUS.IN_PROGRESS) ||
      history.includes(SERVICE_ORDER_STATUS.PAUSED) ||
      history.includes(SERVICE_ORDER_STATUS.WAITING_APPROVE) ||
      history.includes(SERVICE_ORDER_STATUS.WAITING_ARTWORK)
    ) {
      return 'IN_PROGRESS';
    }
    return 'PENDING';
  }

  /**
   * O VEÍCULO PROJETADO + A ESCADA.
   *
   * Recebe a vista JÁ RECORTADA pelo `PortalProjectionService` e o registro CRU
   * que a produziu. Retira o `status` cru (`Task.status`, que regride) e põe
   * `milestone`/`milestoneLabel`/`cancelled` no lugar, mais `progress.timeline`
   * e `progress.steps[].status` recalculado monotonicamente.
   *
   * A vista vem pronta de fora, e não é recalculada aqui, por um motivo: o
   * recorte é calculado UMA VEZ por requisição, e recalculá-lo por veículo
   * abriria a porta para dois veículos do mesmo orçamento saírem com recortes
   * diferentes.
   */
  private overlayVehicle(
    view: any,
    raw: any,
    quote: { id?: string | null; createdAt?: Date | null; status?: string | null } | null,
    sections: readonly QuoteSection[],
    taskHistory: Map<string, string[]>,
    soHistory: Map<string, string[]>,
    quoteHistory: Map<string, string[]>,
    quoteApprovals: Map<string, Date>,
  ) {
    const { status: _regressiveTaskStatus, ...rest } = view ?? {};

    if (!this.canSeeProgress(sections)) {
      return { ...rest, milestone: null, milestoneLabel: null, cancelled: null };
    }

    const serviceOrders: any[] = raw?.serviceOrders ?? [];
    const escada = this.projectTimeline(
      raw ?? {},
      quote,
      serviceOrders,
      taskHistory.get(raw?.id) ?? [],
      (quote?.id && quoteHistory.get(quote.id)) || [],
      (quote?.id && quoteApprovals.get(quote.id)) || null,
    );

    const progress = rest.progress
      ? {
          ...rest.progress,
          timeline: escada.timeline,
          steps: (rest.progress.steps ?? []).map((step: any) => {
            const source = serviceOrders.find(so => so?.id === step.id) ?? step;
            return {
              ...step,
              status: this.projectStepState(source, soHistory.get(step.id) ?? []),
            };
          }),
          // As fotos de entrada e saída vêm de `Task.checkinFiles`/`checkoutFiles`,
          // que são relações de ARQUIVO e não dependem de comparar texto livre de
          // descrição de O.S. Só vêm no DETALHE — ver `taskSelect`.
          checkinFiles: raw?.checkinFiles ?? [],
          checkoutFiles: raw?.checkoutFiles ?? [],
        }
      : undefined;

    return {
      ...rest,
      progress,
      milestone: escada.milestone,
      milestoneLabel: escada.milestoneLabel,
      cancelled: escada.cancelled,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/resumo
  // ═════════════════════════════════════════════════════════════════════════

  async resumo(principal: ResponsiblePrincipal) {
    const sections = this.sectionsOf(principal);
    const capabilities = this.capabilitiesOf(principal);
    const budgetWhere = this.scope.budgetScopeWhere(principal);
    const taskWhere = this.scope.taskScopeWhere(principal);
    const podeTrack = this.canSeeProgress(sections);
    const podePreAprovar = capabilities.includes(PORTAL_CAPABILITY.PRE_APPROVE);
    const verPreco = hasSection(sections, 'PRICING');

    const agrupado = await this.prisma.budget.groupBy({
      by: ['status'],
      where: budgetWhere,
      _count: { _all: true },
    });

    // Toda chave presente, zerada. Contador ausente vira `undefined` na tela e
    // "—" onde deveria estar "0".
    const byStatus: Record<string, number> = {};
    for (const value of Object.values(TASK_QUOTE_STATUS)) byStatus[value as string] = 0;
    let total = 0;
    for (const linha of agrupado) {
      byStatus[linha.status as string] = linha._count._all;
      total += linha._count._all;
    }

    const preApprovalWhere: Prisma.BudgetWhereInput = {
      AND: [budgetWhere, { status: TASK_QUOTE_STATUS.IN_NEGOTIATION as any }],
    };

    const [preApprovalTotal, preApprovalRows] = podePreAprovar
      ? await Promise.all([
          this.prisma.budget.count({ where: preApprovalWhere }),
          this.prisma.budget.findMany({
            where: preApprovalWhere,
            orderBy: [{ createdAt: 'asc' }],
            take: 10,
            select: {
              id: true,
              budgetNumber: true,
              status: true,
              statusOrder: true,
              createdAt: true,
              expiresAt: true,
              vehicleCount: true,
              subtotal: true,
              total: true,
              tasks: {
                where: taskWhere,
                orderBy: [{ createdAt: 'asc' }],
                take: 1,
                select: { customer: { select: { id: true, fantasyName: true, corporateName: true } } },
              },
            },
          }),
        ])
      : [0, [] as any[]];

    // Envelopes esperando ESTA pessoa. A consulta é por `responsibleId` — hoje
    // nenhuma outra consulta do sistema procura `EnvelopeSigner` por ele (§7).
    const signerWhere: Prisma.EnvelopeSignerWhereInput = {
      responsibleId: principal.id,
      status: { in: ['PENDING', 'VIEWED', 'AUTHENTICATED'] as any },
      envelope: { status: 'RUNNING' as any },
    };

    const [signatureTotal, signatureRows] = await Promise.all([
      this.prisma.envelopeSigner.count({ where: signerWhere }),
      this.prisma.envelopeSigner.findMany({
        where: signerWhere,
        orderBy: [{ createdAt: 'asc' }],
        take: 10,
        select: {
          id: true,
          status: true,
          authMethod: true,
          envelopeId: true,
          envelope: {
            select: {
              deadlineAt: true,
              quote: { select: { id: true, budgetNumber: true, status: true } },
            },
          },
          document: { select: { sections: true } },
        },
      }),
    ]);

    // Em produção AGORA. É contador de presente, não marco da escada: não há
    // monotonia a preservar em "quantos estão na fábrica hoje".
    const inProductionWhere: Prisma.TaskWhereInput = {
      AND: [
        taskWhere,
        { status: { not: TASK_STATUS.CANCELLED as any } },
        {
          OR: [
            { status: TASK_STATUS.IN_PRODUCTION as any },
            { startedAt: { not: null }, finishedAt: null },
          ],
        },
      ],
    };

    const [inProductionTotal, inProductionRows] = podeTrack
      ? await Promise.all([
          this.prisma.task.count({ where: inProductionWhere }),
          this.prisma.task.findMany({
            where: inProductionWhere,
            orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
            take: 10,
            select: {
              id: true,
              name: true,
              startedAt: true,
              forecastDate: true,
              implement: { select: { serialNumber: true, plate: true } },
              quote: { select: { id: true, budgetNumber: true } },
            },
          }),
        ])
      : [0, [] as any[]];

    return {
      success: true,
      message: 'Resumo carregado com sucesso.',
      // ⚠️ `subtotal`/`total` abaixo saem de um `map((b: any) => …)`: a linha do
      // Prisma é `any` aqui e o `Decimal` atravessa calado — foi assim que o
      // resumo publicou `total: "74100"` num campo que o web declara
      // `number | null` e guarda com `typeof === "number"`, apagando o preço da
      // tela. A varredura converte pela FORMA; ver `toPortalPlainNumbers`.
      data: toPortalPlainNumbers({
        responsible: {
          id: principal.id,
          name: principal.name,
          roles: principal.roles,
          companyId: principal.companyId,
          companyName: principal.companyName,
        },
        sections,
        capabilities,
        budgets: { total, byStatus },
        waitingOnMe: {
          preApproval: {
            available: podePreAprovar,
            total: preApprovalTotal,
            budgets: preApprovalRows.map((b: any) => ({
              id: b.id,
              budgetNumber: b.budgetNumber,
              status: b.status,
              statusOrder: b.statusOrder,
              createdAt: b.createdAt,
              expiresAt: b.expiresAt,
              vehicleCount: b.vehicleCount,
              subtotal: verPreco ? b.subtotal : null,
              total: verPreco ? b.total : null,
              customer: b.tasks?.[0]?.customer ?? null,
            })),
          },
          signatures: {
            available: true,
            total: signatureTotal,
            envelopes: signatureRows.map(s => ({
              signerId: s.id,
              signerStatus: s.status,
              authMethod: s.authMethod,
              envelopeId: s.envelopeId,
              deadlineAt: s.envelope?.deadlineAt ?? null,
              sections: s.document?.sections ?? [],
              budget: s.envelope?.quote
                ? {
                    id: s.envelope.quote.id,
                    budgetNumber: s.envelope.quote.budgetNumber,
                    status: s.envelope.quote.status,
                  }
                : null,
            })),
          },
          inProduction: {
            available: podeTrack,
            total: inProductionTotal,
            vehicles: inProductionRows.map((t: any) => ({
              taskId: t.id,
              name: t.name,
              serialNumber: t.implement?.serialNumber ?? null,
              plate: t.implement?.plate ?? null,
              startedAt: t.startedAt,
              forecastDate: t.forecastDate,
              budget: t.quote ? { id: t.quote.id, budgetNumber: t.quote.budgetNumber } : null,
            })),
          },
        },
      }),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/orcamentos
  // ═════════════════════════════════════════════════════════════════════════

  async listBudgets(principal: ResponsiblePrincipal, query: PortalListQuery) {
    const sections = this.sectionsOf(principal);
    const capabilities = this.capabilitiesOf(principal);
    const { skip, take, page } = this.paginate(query ?? {});

    const filtros: Prisma.BudgetWhereInput[] = [this.scope.budgetScopeWhere(principal)];
    if (query?.status?.length) filtros.push({ status: { in: query.status as any[] } });
    if (query?.searchingFor?.trim()) {
      const termo = query.searchingFor.trim();
      const digits = termo.replace(/\D/g, '');
      const numero = digits ? Number(digits) : NaN;
      filtros.push({
        OR: [
          ...(Number.isFinite(numero) && numero > 0 ? [{ budgetNumber: numero }] : []),
          { tasks: { some: { name: { contains: termo, mode: 'insensitive' as const } } } },
          { tasks: { some: { implement: { serialNumber: { contains: termo, mode: 'insensitive' as const } } } } },
          {
            tasks: { some: { implement: { plate: { contains: termo, mode: 'insensitive' as const } } } },
          },
        ],
      });
    }

    const where: Prisma.BudgetWhereInput = { AND: filtros };
    // ⛔ A ORDEM É INTEIRAMENTE DO SERVIDOR. A lista do portal NÃO tem parâmetro
    // `orderBy` de coluna (só o par `fila`/`recentes`), e o motor de tabela do
    // web marca `manualSorting` — nenhum cabeçalho de lá reordena nada. Se o
    // servidor não ordenar direito, a lista simplesmente sai errada.
    const orderBy: Prisma.BudgetOrderByWithRelationInput[] =
      query?.orderBy === 'recentes' ? [{ createdAt: 'desc' }] : [...PORTAL_BUDGET_ORDER];

    const [totalRecords, rows] = await Promise.all([
      this.prisma.budget.count({ where }),
      this.prisma.budget.findMany({
        where,
        orderBy,
        skip,
        take,
        select: this.budgetSelect(principal, sections, { detail: false }),
      }),
    ]);

    const data = await this.assembleBudgets(rows, principal, sections, capabilities);

    return {
      success: true,
      message: 'Orçamentos carregados com sucesso.',
      data,
      meta: this.meta(totalRecords, page, take),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/orcamentos/:id
  // ═════════════════════════════════════════════════════════════════════════

  async getBudget(principal: ResponsiblePrincipal, id: string) {
    const sections = this.sectionsOf(principal);
    const capabilities = this.capabilitiesOf(principal);

    const row = await this.prisma.budget.findFirst({
      // O escopo entra no MESMO `where` do id. Orçamento fora do alcance deste
      // contato responde 404 e não 403: a EXISTÊNCIA de um orçamento de outro
      // cliente não é informação que o portal confirme.
      where: { AND: [{ id }, this.scope.budgetScopeWhere(principal)] },
      select: this.budgetSelect(principal, sections, { detail: true }),
    });

    if (!row) throw new NotFoundException('Orçamento não encontrado.');

    const [data] = await this.assembleBudgets([row], principal, sections, capabilities);
    return { success: true, message: 'Orçamento carregado com sucesso.', data };
  }

  /**
   * O `select` do orçamento — montado a partir do RECORTE, e não filtrado depois.
   *
   * Seção fora do recorte não vira `null` na resposta: o dado nem sai do banco.
   * É a diferença entre o cliente não ver o preço e o preço não existir no JSON
   * que o DevTools dele mostra.
   */
  private budgetSelect(
    principal: ResponsiblePrincipal,
    sections: readonly QuoteSection[],
    opts: { detail: boolean },
  ): any {
    const verServicos = hasSection(sections, 'SERVICES');
    const verPreco = hasSection(sections, 'PRICING');
    const verPagamento = hasSection(sections, 'PAYMENT');
    const verLayout = hasSection(sections, 'LAYOUT');
    const verEntrega = hasSection(sections, 'DELIVERY');
    const verGarantia = hasSection(sections, 'GUARANTEE');
    const companyId = this.scope.assertScoped(principal).companyId;

    const select: any = {
      id: true,
      budgetNumber: true,
      status: true,
      statusOrder: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
      vehicleCount: true,
      billingSplit: true,
      request: {
        select: {
          briefing: true,
          logoName: true,
          requestedAt: true,
          preApprovedAt: true,
          refusedAt: true,
          decisionNote: true,
          ...(opts.detail
            ? {
                requestedBy: { select: { id: true, name: true } },
                preApprovedBy: { select: { id: true, name: true } },
                refusedBy: { select: { id: true, name: true } },
              }
            : {}),
        },
      },
      tasks: {
        // ⚠️ O escopo do VEÍCULO também vale dentro do orçamento. Sem ele, num
        // orçamento `PER_TASK` de dez implementos, quem paga o terceiro receberia
        // a placa e o chassi dos outros nove — o recorte por seção não salva,
        // porque `VEHICLE` libera exatamente esses campos.
        where: this.scope.taskScopeWhere(principal),
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        select: this.taskSelect(sections, { detail: opts.detail }),
      },
    };

    if (verServicos || verPreco) {
      select.services = {
        orderBy: { position: 'asc' as const },
        select: {
          id: true,
          description: true,
          observation: true,
          position: true,
          ...(verPreco ? { amount: true } : {}),
        },
      };
    }
    if (verPreco) {
      select.subtotal = true;
      select.total = true;
    }
    if (verEntrega) {
      select.customForecastDays = true;
      select.simultaneousTasks = true;
    }
    if (verGarantia) {
      select.guaranteeYears = true;
      select.customGuaranteeText = true;
    }
    if (verLayout) {
      select.layoutFiles = { orderBy: { createdAt: 'asc' as const }, select: FILE_SELECT };
    }
    if (verPagamento) {
      // ⛔ `payerScopeSelect` espalhado — nunca `customerConfigs: true`, nunca um
      // `select` de pagador sem o `where`. Ver o cabeçalho deste arquivo.
      select.customerConfigs = {
        ...this.scope.payerScopeSelect(principal),
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          customerId: true,
          customer: { select: { id: true, fantasyName: true, corporateName: true } },
          // ── A CONFIGURAÇÃO DE PAGAMENTO ────────────────────────────────────
          //
          // O portal mostrava as PARCELAS e nada do acordo que as gerou: forma
          // de pagamento, condição, desconto, se sai nota e se sai boleto. O
          // cliente via "3 parcelas de R$ X" sem saber se paga em boleto ou Pix,
          // a partir de quando conta o prazo, nem por que o total difere da soma
          // dos serviços. É o mesmo conjunto que o documento impresso já cita —
          // esconder aqui não protege nada, só obriga a procurar o PDF.
          //
          // ⚠️ Continua DENTRO do `payerScopeSelect`: é o acordo DESTE pagador,
          // e num orçamento de dois pagadores cada um só enxerga o seu.
          subtotal: true,
          total: true,
          discountType: true,
          discountValue: true,
          paymentCondition: true,
          paymentConfig: true,
          customPaymentText: true,
          generateInvoice: true,
          generateBankSlip: true,
          installments: {
            orderBy: { number: 'asc' as const },
            select: {
              id: true,
              number: true,
              amount: true,
              dueDate: true,
              // ⚠️ O VALOR PAGO, e não só a DATA. Sem esta coluna a tela só pode
              // derivar "pago" de `paidAt ? amount : null`, e uma parcela
              // QUITADA PELA METADE fica irrepresentável: ou aparece paga por
              // inteiro (o que não é verdade e some com o saldo devedor), ou
              // aparece em aberto (o que ignora o dinheiro que o cliente já
              // mandou). O dado é do PRÓPRIO PAGADOR — é o pagamento dele.
              paidAmount: true,
              paidAt: true,
              status: true,
              bankSlip: {
                select: {
                  id: true,
                  digitableLine: true,
                  dueDate: true,
                  amount: true,
                  status: true,
                },
              },
            },
          },
        },
      };
      // ⛔ AS NOTAS DO ORÇAMENTO SÃO DE TODOS OS PAGADORES. A relação não tem
      // dono embutido e o projetor a copia inteira. O corte é aqui: minha, pelo
      // pagador OU pela fatura — `customerConfigId` é `SetNull` e some numa
      // reversão de faturamento, então sozinho ele deixaria notas legítimas de
      // fora.
      select.nfseDocuments = {
        where: {
          status: 'AUTHORIZED' as any,
          elotechNfseId: { not: null },
          OR: [
            { customerConfig: { customerId: companyId } },
            { invoice: { customerId: companyId } },
          ],
        },
        orderBy: { createdAt: 'desc' as const },
        select: {
          id: true,
          nfseNumber: true,
          status: true,
          createdAt: true,
          // ⚠️ O DONO DE CADA NOTA, carregado para que o PROJETOR possa recortar.
          // O `where` acima continua — os dois filtros são de propósito, e este
          // `select` é o que torna o de lá redundante em vez de único. Quem
          // escrever a segunda rota de orçamento vai esquecer o `where`; não vai
          // conseguir esquecer o parâmetro `scope` de `projectBudget`.
          customerConfig: { select: { customerId: true } },
          invoice: { select: { customerId: true } },
        },
      };
    }

    return select;
  }

  private taskSelect(sections: readonly QuoteSection[], opts: { detail: boolean }): any {
    const select: any = { ...TASK_BASE_SELECT };

    if (hasSection(sections, 'LAYOUT')) {
      select.generalPainting = { select: PAINT_SELECT };
      select.logoPaints = { select: PAINT_SELECT };
      select.baseFiles = { select: FILE_SELECT };
      select.layouts = {
        // Só o layout APROVADO: um layout em revisão é conversa interna, e
        // mandá-lo ao cliente é pedir aprovação do que ainda não foi proposto.
        where: { status: 'APPROVED' as any },
        select: { id: true, status: true, file: { select: FILE_SELECT } },
      };
    }

    if (this.canSeeProgress(sections)) {
      select.serviceOrders = {
        where: PORTAL_SERVICE_ORDER_WHERE,
        orderBy: { position: 'asc' as const },
        select: SERVICE_ORDER_SELECT,
      };
      if (opts.detail) {
        select.checkinFiles = { select: FILE_SELECT };
        select.checkoutFiles = { select: FILE_SELECT };
      }
    }

    return select;
  }

  /**
   * Monta a resposta dos orçamentos: projeta pelo recorte, sobrepõe a escada e
   * acrescenta o que é do PORTAL e não da projeção (`canPreApprove`, o marco do
   * contrato, os autores da decisão).
   */
  private async assembleBudgets(
    rows: any[],
    principal: ResponsiblePrincipal,
    sections: readonly QuoteSection[],
    capabilities: PORTAL_CAPABILITY[],
  ) {
    const podeTrack = this.canSeeProgress(sections);
    // DE QUEM É esta resposta. O projetor EXIGE isto: `Budget.nfseDocuments` não
    // tem dono embutido, e sem o parâmetro a nota do outro pagador sairia junto.
    const { companyId } = this.scope.assertScoped(principal);
    const allTaskIds = rows.flatMap(b => (b.tasks ?? []).map((t: any) => t.id));
    const allSoIds = rows.flatMap(b =>
      (b.tasks ?? []).flatMap((t: any) => (t.serviceOrders ?? []).map((so: any) => so.id)),
    );

    // ⚠️ `ENTITY_TYPE.TASK_QUOTE` e não `BUDGET`: o rename de 17/09 trocou o
    // NOME do modelo e deixou os 3.863 valores de changelog como estavam. Quem
    // procurar por 'BUDGET' aqui não acha linha nenhuma — e o marco "Orçamento
    // aprovado" simplesmente nunca acenderia, sem erro.
    const [taskHistory, soHistory, quoteHistory, quoteApprovals] = podeTrack
      ? await Promise.all([
          this.statusHistory(ENTITY_TYPE.TASK, allTaskIds),
          this.statusHistory(ENTITY_TYPE.SERVICE_ORDER, allSoIds),
          this.statusHistory(
            ENTITY_TYPE.TASK_QUOTE,
            rows.map(b => b.id),
          ),
          // A DATA da aprovação — mesma consulta de changelog, outra coluna.
          this.quoteApprovalDates(rows.map(b => b.id)),
        ])
      : [
          new Map<string, string[]>(),
          new Map<string, string[]>(),
          new Map<string, string[]>(),
          new Map<string, Date>(),
        ];

    const assinatura = await this.signatureFacts(
      rows.map(b => b.id),
      principal.id,
    );

    return rows.map(row => {
      // O projetor recebe os PAPÉIS — é a API pública dele, e é ele quem
      // consulta a régua. `sections` aqui embaixo é a MESMA régua, já calculada,
      // usada só para decidir o que a escada acrescenta.
      const view = this.projection.projectBudget(row, principal.roles, { customerId: companyId }) as any;
      const vehicles = (view?.vehicles ?? []).map((v: any, i: number) =>
        this.overlayVehicle(
          v,
          row.tasks?.[i],
          { id: row.id, createdAt: row.createdAt ?? null, status: row.status ?? null },
          sections,
          taskHistory,
          soHistory,
          quoteHistory,
          quoteApprovals,
        ),
      );

      // O marco do CONTRATO é o MENOR dos veículos vivos: o orçamento só está
      // concluído quando o último implemento saiu.
      let milestone: string | null = null;
      if (podeTrack) {
        for (const v of vehicles as any[]) {
          if (!v?.milestone || v.cancelled) continue;
          if (milestone === null || MILESTONE_INDEX[v.milestone] < MILESTONE_INDEX[milestone]) {
            milestone = v.milestone;
          }
        }
      }

      return {
        ...view,
        updatedAt: row.updatedAt ?? null,
        billingSplit: row.billingSplit ?? null,
        capabilities,
        canPreApprove:
          capabilities.includes(PORTAL_CAPABILITY.PRE_APPROVE) &&
          row.status === TASK_QUOTE_STATUS.IN_NEGOTIATION,
        request: view?.request
          ? {
              ...view.request,
              requestedBy: row.request?.requestedBy ?? null,
              preApprovedBy: row.request?.preApprovedBy ?? null,
              refusedBy: row.request?.refusedBy ?? null,
            }
          : undefined,
        milestone,
        milestoneLabel: milestone ? PORTAL_MILESTONES[MILESTONE_INDEX[milestone]].label : null,
        signature: assinatura.get(row.id) ?? { emitted: false, awaitingMe: false },
        vehicles,
      };
    });
  }

  /**
   * A VERDADE SOBRE A ASSINATURA, orçamento a orçamento.
   *
   * ⛔ POR QUE ISTO PRECISOU EXISTIR. A coluna "Esperando" da lista derivava só
   * do ESTADO: `PENDING` ⇒ "Com você". A dedução parecia segura — o estado diz
   * de quem é a vez — e estava errada de duas maneiras ao mesmo tempo:
   *
   *   1. "Aguardando a assinatura dos responsáveis" não quer dizer ESTE
   *      responsável. Quem já assinou continuava lendo "Com você".
   *   2. E, pior, um orçamento pode estar em `PENDING` sem que a coleta tenha
   *      sido emitida. No acervo do dono são **18 de 18** assim: `PENDING`,
   *      nenhum envelope. O portal anunciava dezoito documentos esperando por
   *      ele e a tela de Assinaturas — que olha a realidade — dizia, corretamente,
   *      "Nada para assinar". Duas telas do mesmo produto se contradizendo, e a
   *      que mentia era a mais visível.
   *
   * Uma consulta em lote, não uma por linha: a lista traz até 100 orçamentos.
   */
  private async signatureFacts(
    budgetIds: string[],
    responsibleId: string,
  ): Promise<Map<string, { emitted: boolean; awaitingMe: boolean }>> {
    const mapa = new Map<string, { emitted: boolean; awaitingMe: boolean }>();
    if (!budgetIds.length) return mapa;

    const envelopes = await this.prisma.signatureEnvelope.findMany({
      where: {
        quoteId: { in: budgetIds },
        // EMITIDO é o que importa para a primeira pergunta, e um envelope
        // concluído também foi emitido. Os terminais de fracasso (REFUSED,
        // CANCELLED, INVALIDATED, SUPERSEDED, EXPIRED) ficam de fora: eles não
        // são um documento que o cliente possa abrir e assinar.
        status: { in: [EnvelopeStatus.RUNNING, EnvelopeStatus.COMPLETED] },
      },
      select: {
        quoteId: true,
        status: true,
        signers: {
          where: {
            responsibleId,
            // A MESMA lista de `minhasAssinaturas` — se as duas divergirem, a
            // lista volta a prometer o que a tela de Assinaturas não entrega.
            status: {
              in: [
                EnvelopeSignerStatus.PENDING,
                EnvelopeSignerStatus.VIEWED,
                EnvelopeSignerStatus.AUTHENTICATED,
              ],
            },
          },
          select: { id: true },
        },
      },
    });

    for (const env of envelopes) {
      const antes = mapa.get(env.quoteId) ?? { emitted: false, awaitingMe: false };
      mapa.set(env.quoteId, {
        emitted: true,
        // Só envelope RUNNING pede ato: `assertSignable` recusa qualquer outro,
        // e oferecer o botão para um COMPLETED seria oferecer o que o servidor
        // nega no clique.
        awaitingMe:
          antes.awaitingMe || (env.status === EnvelopeStatus.RUNNING && env.signers.length > 0),
      });
    }
    return mapa;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/veiculos
  // ═════════════════════════════════════════════════════════════════════════

  async listVehicles(principal: ResponsiblePrincipal, query: PortalListQuery) {
    const sections = this.sectionsOf(principal);
    const { skip, take, page } = this.paginate(query ?? {});

    const filtros: Prisma.TaskWhereInput[] = [this.scope.taskScopeWhere(principal)];
    if (query?.searchingFor?.trim()) {
      const termo = query.searchingFor.trim();
      filtros.push({
        OR: [
          { name: { contains: termo, mode: 'insensitive' } },
          { implement: { serialNumber: { contains: termo, mode: 'insensitive' } } },
          { customerOrderNumber: { contains: termo, mode: 'insensitive' } },
          { implement: { plate: { contains: termo, mode: 'insensitive' } } },
          { implement: { chassisNumber: { contains: termo, mode: 'insensitive' } } },
        ],
      });
    }

    /**
     * ⛔ OS DOIS LADOS DA ESCRITA DUPLA, como em `taskHasPurchaseOrder`.
     *
     * A entidade nova é `PurchaseOrder` (`Task.purchaseOrderId`); a coluna
     * legada `Task.customerOrderNumber` é a que a NFS-e, o `seuNumero` do boleto
     * e a regra de atenção leem hoje. Um filtro que olhasse só a FK diria que um
     * veículo carimbado por caminho antigo está sem pedido — e mandaria o
     * Compras do cliente gravar de novo por cima de um número que já existe,
     * que é exatamente o 409 do documento congelado.
     *
     * ⚠️ `AND` de dois `not` e não `{ not: null, not: '' }`: a segunda chave
     * sobrescreve a primeira no literal e o filtro passaria a ser só `!= ''`.
     */
    const comPedido: Prisma.TaskWhereInput = {
      OR: [
        { purchaseOrderId: { not: null } },
        { AND: [{ customerOrderNumber: { not: null } }, { customerOrderNumber: { not: '' } }] },
      ],
    };
    if (query?.semPedido === true) filtros.push({ NOT: comPedido });
    if (query?.semPedido === false) filtros.push(comPedido);

    const where: Prisma.TaskWhereInput = { AND: filtros };

    const [totalRecords, rows] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy: this.vehicleOrderBy(query ?? {}, sections),
        skip,
        take,
        select: {
          ...this.taskSelect(sections, { detail: false }),
          quote: {
            select: {
              id: true,
              budgetNumber: true,
              status: true,
              statusOrder: true,
              createdAt: true,
              expiresAt: true,
              vehicleCount: true,
            },
          },
        },
      }),
    ]);

    const data = await this.assembleVehicles(rows, principal, sections);

    return {
      success: true,
      message: 'Veículos carregados com sucesso.',
      data,
      meta: this.meta(totalRecords, page, take),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/veiculos/:taskId
  // ═════════════════════════════════════════════════════════════════════════

  async getVehicle(principal: ResponsiblePrincipal, taskId: string) {
    const sections = this.sectionsOf(principal);

    const row = await this.prisma.task.findFirst({
      where: { AND: [{ id: taskId }, this.scope.taskScopeWhere(principal)] },
      select: {
        ...this.taskSelect(sections, { detail: true }),
        quote: {
          select: {
            id: true,
            budgetNumber: true,
            status: true,
            statusOrder: true,
            createdAt: true,
            expiresAt: true,
            vehicleCount: true,
          },
        },
      },
    });

    if (!row) throw new NotFoundException('Veículo não encontrado.');

    const [data] = await this.assembleVehicles([row], principal, sections);
    return { success: true, message: 'Veículo carregado com sucesso.', data };
  }

  private async assembleVehicles(
    rows: any[],
    principal: ResponsiblePrincipal,
    sections: readonly QuoteSection[],
  ) {
    const podeTrack = this.canSeeProgress(sections);
    const [taskHistory, soHistory, quoteHistory, quoteApprovals] = podeTrack
      ? await Promise.all([
          this.statusHistory(
            ENTITY_TYPE.TASK,
            rows.map(t => t.id),
          ),
          this.statusHistory(
            ENTITY_TYPE.SERVICE_ORDER,
            rows.flatMap(t => (t.serviceOrders ?? []).map((so: any) => so.id)),
          ),
          // Ver a nota sobre `TASK_QUOTE` no outro ponto de chamada.
          this.statusHistory(
            ENTITY_TYPE.TASK_QUOTE,
            rows.map(t => t.quote?.id).filter(Boolean),
          ),
          this.quoteApprovalDates(rows.map(t => t.quote?.id).filter(Boolean) as string[]),
        ])
      : [
          new Map<string, string[]>(),
          new Map<string, string[]>(),
          new Map<string, string[]>(),
          new Map<string, Date>(),
        ];

    return rows.map(row => ({
      ...this.overlayVehicle(
        this.projection.projectTask(row, principal.roles),
        row,
        row.quote
          ? { id: row.quote.id, createdAt: row.quote.createdAt ?? null, status: row.quote.status ?? null }
          : null,
        sections,
        taskHistory,
        soHistory,
        quoteHistory,
        quoteApprovals,
      ),
      sections,
      budget: row.quote
        ? {
            id: row.quote.id,
            budgetNumber: row.quote.budgetNumber,
            status: row.quote.status,
            statusOrder: row.quote.statusOrder,
            expiresAt: row.quote.expiresAt,
            vehicleCount: row.quote.vehicleCount,
          }
        : null,
    }));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/cobrancas
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * O DINHEIRO.
   *
   * Duas condições, as duas obrigatórias:
   *   · a fatura é DA MINHA EMPRESA — `scope.invoiceScopeWhere`, que é
   *     `Invoice.customerId` (NOT NULL), o mesmo critério de
   *     `DossierAssemblerService.listBankSlips`/`listNfse`;
   *   · o orçamento dela está no MEU ESCOPO (§3).
   * A primeira sozinha ignoraria o escopo; a segunda sozinha entregaria a fatura
   * do outro pagador do mesmo orçamento — que é o vazamento do §3.
   *
   * ⚠️ `LIVE_INVOICE_WHERE`: a relação é 1:N no banco (a viva mais as canceladas
   * dos ciclos anteriores) e ciclo cancelado não é cobrança do cliente.
   */
  async listCharges(principal: ResponsiblePrincipal, query: PortalListQuery) {
    const sections = this.sectionsOf(principal);
    this.requireSection(sections, 'PAYMENT');

    const budgetWhere = this.scope.budgetScopeWhere(principal);
    const { skip, take, page } = this.paginate(query ?? {});

    // ⚠️ Tudo em `AND`, e NUNCA duas chaves `OR` no mesmo nível: a segunda
    // sobrescreve a primeira em silêncio, e o que se perderia aqui é justamente
    // a metade que escopa. É a mesma família do defeito já registrado nesta
    // base, em que `{ AND: [{ OR: [] }] }` devolve a TABELA inteira.
    const filtros: Prisma.InvoiceWhereInput[] = [
      { OR: [{ customerConfig: { quote: budgetWhere } }, { task: { quote: budgetWhere } }] },
    ];

    // O FILTRO POR ORÇAMENTO — `?budgetId=`. A fatura pende do pagador (que tem
    // `quoteId`) OU da tarefa (que tem `quoteId`), exatamente como no escopo
    // acima: filtrar só por um dos dois deixaria de fora metade das faturas
    // legítimas, conforme o orçamento seja `JOINT` ou `PER_TASK`.
    const budgetId = query?.budgetId?.trim();
    if (budgetId) {
      filtros.push({
        OR: [{ customerConfig: { quoteId: budgetId } }, { task: { quoteId: budgetId } }],
      });
    }

    const where: Prisma.InvoiceWhereInput = {
      ...this.scope.invoiceScopeWhere(principal),
      ...LIVE_INVOICE_WHERE,
      AND: filtros,
    };

    const [totalRecords, rows] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
          createdAt: true,
          updatedAt: true,
          customerConfig: {
            select: {
              id: true,
              customerId: true,
              paymentCondition: true,
              customPaymentText: true,
              discountType: true,
              discountValue: true,
              // O QUADRO DO TOMADOR: é o cadastro DA PRÓPRIA EMPRESA do contato,
              // que ele está ali para conferir, e é o que a prefeitura exige na
              // NFS-e. `payerScopeSelect` garantiu que só ele chegou aqui.
              customer: {
                select: {
                  id: true,
                  fantasyName: true,
                  corporateName: true,
                  cnpj: true,
                  cpf: true,
                  stateRegistration: true,
                  municipalRegistration: true,
                  streetType: true,
                  address: true,
                  addressNumber: true,
                  addressComplement: true,
                  neighborhood: true,
                  city: true,
                  state: true,
                  zipCode: true,
                },
              },
              quote: { select: { id: true, budgetNumber: true, status: true, statusOrder: true } },
              billing: {
                select: {
                  id: true,
                  status: true,
                  statusOrder: true,
                  approvedAt: true,
                  tasks: {
                    select: {
                      task: {
                        select: {
                          id: true,
                          name: true,
                          customerOrderNumber: true,
                          implement: { select: { serialNumber: true, plate: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          task: {
            select: {
              id: true,
              name: true,
              customerOrderNumber: true,
              implement: { select: { serialNumber: true, plate: true } },
              quote: { select: { id: true, budgetNumber: true, status: true, statusOrder: true } },
            },
          },
          installments: {
            orderBy: { number: 'asc' },
            select: {
              id: true,
              number: true,
              dueDate: true,
              amount: true,
              paidAmount: true,
              paidAt: true,
              status: true,
              paymentMethod: true,
              // O BOLETO, do ponto de vista de quem PAGA. Linha digitável, código
              // de barras e copia-e-cola do PIX ENTRAM: são o instrumento de
              // pagamento, e quem lê esta rota é o pagador autenticado daquela
              // fatura. O que NÃO entra é a operação interna — `nossoNumero`,
              // `txid`, `sicrediStatus`, `errorMessage`, `errorCount`,
              // `liquidationData`, `lastSyncAt`, `pdfFileId`.
              bankSlip: {
                select: {
                  id: true,
                  status: true,
                  type: true,
                  amount: true,
                  dueDate: true,
                  digitableLine: true,
                  barcode: true,
                  pixQrCode: true,
                  paidAt: true,
                },
              },
            },
          },
          // Só nota AUTORIZADA e com id na prefeitura. `PENDING`, `ERROR` e todo
          // o ciclo de cancelamento são operação interna, não fato fiscal do
          // cliente — e `errorMessage` de NFS-e carrega texto da prefeitura.
          nfseDocuments: {
            where: { status: 'AUTHORIZED' as any, elotechNfseId: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              nfseNumber: true,
              elotechNfseId: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const data = rows.map(inv => {
      const config: any = inv.customerConfig;
      const coverage: any[] = config?.billing?.tasks?.map((bt: any) => bt.task) ?? [];
      const vehicles = coverage.length ? coverage : inv.task ? [inv.task] : [];
      const budget = config?.quote ?? (inv.task as any)?.quote ?? null;

      return {
        id: inv.id,
        status: inv.status,
        totalAmount: inv.totalAmount,
        paidAmount: inv.paidAmount,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
        budget: budget
          ? {
              id: budget.id,
              budgetNumber: budget.budgetNumber,
              status: budget.status,
              statusOrder: budget.statusOrder,
            }
          : null,
        billing: config?.billing
          ? {
              id: config.billing.id,
              status: config.billing.status,
              statusOrder: config.billing.statusOrder,
              approvedAt: config.billing.approvedAt,
            }
          : null,
        payer: config
          ? {
              id: config.id,
              customerId: config.customerId,
              customer: config.customer,
              paymentCondition: config.paymentCondition,
              customPaymentText: config.customPaymentText,
              discountType: config.discountType,
              discountValue: config.discountValue,
            }
          : null,
        vehicles: vehicles.map((t: any) => ({
          taskId: t.id,
          name: t.name,
          serialNumber: t.implement?.serialNumber ?? null,
          plate: t.implement?.plate ?? null,
          customerOrderNumber: t.customerOrderNumber ?? null,
        })),
        installments: inv.installments.map(p => ({
          id: p.id,
          number: p.number,
          dueDate: p.dueDate,
          amount: p.amount,
          paidAmount: p.paidAmount,
          paidAt: p.paidAt,
          status: p.status,
          paymentMethod: p.paymentMethod,
          bankSlip: p.bankSlip
            ? {
                id: p.bankSlip.id,
                status: p.bankSlip.status,
                type: p.bankSlip.type,
                amount: p.bankSlip.amount,
                dueDate: p.bankSlip.dueDate,
                digitableLine: p.bankSlip.digitableLine,
                barcode: p.bankSlip.barcode,
                pixQrCode: p.bankSlip.pixQrCode,
                paidAt: p.bankSlip.paidAt,
              }
            : null,
        })),
        nfse: inv.nfseDocuments.map(n => ({
          id: n.id,
          status: n.status,
          nfseNumber: n.nfseNumber,
          elotechNfseId: n.elotechNfseId,
          createdAt: n.createdAt,
        })),
      };
    });

    return {
      success: true,
      message: 'Cobranças carregadas com sucesso.',
      // ⛔ A TELA QUE MAIS PRECISA DISTO. `totalAmount`, `paidAmount`, o valor de
      // cada parcela, o do boleto e o `discountValue` do pagador vêm todos de
      // `inv`/`config`, que são `any` — cinco campos de dinheiro num só payload,
      // e a soma de dois deles no navegador vira CONCATENAÇÃO de strings sem
      // erro nenhum ("1200.00" + "800.00" = "1200.00800.00").
      data: toPortalPlainNumbers(data),
      meta: this.meta(totalRecords, page, take),
    };
  }
}
