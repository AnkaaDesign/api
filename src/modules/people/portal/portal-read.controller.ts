// api/src/modules/people/portal/portal-read.controller.ts
//
// AS LEITURAS DO PORTAL DO CLIENTE — `/cliente/me/*`.
//
// Vive ao lado de `/cliente/auth/*` e NÃO colide com ele: o Nest casa o caminho
// inteiro, e o segundo segmento (`auth` × `me`) já separa os dois controllers.
// A colisão que o contrato fixa em teste (§10) é do REACT ROUTER, no `web`:
// `/cliente/:customerId/orcamento/:id` engole `/cliente/painel/orcamento`. É por
// isso que a seção é `orcamentos`, no PLURAL — e este controller usa o plural
// também, para que rota de API e rota de tela não divirjam de nome.
//
// NÃO HÁ `@UseGuards` NESTE ARQUIVO, e isso é a estrutura funcionando.
// `@ResponsibleOnly()` na CLASSE basta: `ResponsibleAuthGuard` é global
// (`APP_GUARD`) e as duas guardas se dividem por este metadado com respostas
// invertidas. Marcar a rota É guardá-la.
//
// ⚠️ E NÃO HÁ `@UserId()`. Em lugar nenhum. O principal é `request.responsible`,
// lido por `@CurrentResponsible()`. São 827 pontos de `@UserId()` no sistema e
// 46 FKs NOT NULL apontando para `User`: um único ponto onde os dois sujeitos se
// misturem grava UUID de contato em coluna de funcionário.
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { TASK_QUOTE_STATUS } from '@constants';
import { CurrentResponsible } from '../responsible-auth/current-responsible.decorator';
import { ResponsibleOnly } from '../responsible-auth/responsible-auth.decorators';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import { PortalReadService, type PortalListQuery } from './portal-read.service';

/**
 * A paginação e os filtros da borda.
 *
 * ⚠️ Nada aqui é `.strict()` por herança — o zod DESCARTA chave desconhecida em
 * silêncio, e é assim que um filtro escrito errado no `web` some sem erro. Os
 * nomes abaixo são, portanto, contrato: `page`, `take`, `status`, `searchingFor`,
 * `orderBy`.
 *
 * ⚠️ `.default(x).optional()` e `.optional().default(x)` têm semântica OPOSTA.
 * Aqui não se usa nenhuma das duas: o serviço aplica os padrões (20/1), num
 * lugar só, porque ele é quem também aplica o TETO de 100.
 */
const statusSchema = z
  .preprocess(
    value => {
      if (value === undefined || value === null || value === '') return undefined;
      if (Array.isArray(value)) return value.map(String);
      return String(value)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    },
    z.array(z.nativeEnum(TASK_QUOTE_STATUS)).optional(),
  )
  .optional();

const portalListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  searchingFor: z.string().trim().min(1).max(200).optional(),
  orderBy: z.enum(['fila', 'recentes']).optional(),
});

const portalBudgetListQuerySchema = portalListQuerySchema.extend({
  status: statusSchema,
});

/**
 * TRÊS ESTADOS, e o terceiro é "não perguntei".
 *
 * `true` = só os veículos SEM número de pedido de compra; `false` = só os que já
 * têm; ausente = todos. É o filtro que permitiu o diálogo de "novo pedido"
 * parar de ler a frota inteira: a pergunta dele é "quais ainda estão sem
 * número?", e a resposta certa para um cliente de 358 veículos é uma PÁGINA
 * deles mais `meta.totalRecords`, não as 358 linhas.
 *
 * ⛔ `z.coerce.boolean()` ESTÁ DESCARTADO DE PROPÓSITO: ele é `Boolean(value)`,
 * e a string `"false"` — que é exatamente o que um `?semPedido=false` entrega —
 * é `true`. O filtro inverteria em silêncio. Aqui a leitura é explícita, e
 * qualquer outra coisa é `undefined` (sem filtro), nunca um palpite.
 */
const semPedidoSchema = z
  .preprocess(value => {
    if (value === undefined || value === null || value === '') return undefined;
    const texto = String(value).trim().toLowerCase();
    if (texto === 'true' || texto === '1') return true;
    if (texto === 'false' || texto === '0') return false;
    return undefined;
  }, z.boolean().optional())
  .optional();

/**
 * A ORDENAÇÃO DA FROTA — ALLOWLIST, nunca um objeto do Prisma.
 *
 * ⛔ A tela manda `campo:direção` (`name:asc`, `plate:desc`), exatamente como a
 * lista de Faturamento já manda (`BILLING_SORT_FIELD_MAP` no `web`). NUNCA um
 * `{ truck: { plate: 'asc' } }` vindo do cliente: além de ser injeção de
 * consulta, uma rodada anterior mandou justamente isso e o `orderBy` daqui era
 * um `z.enum(['fila','recentes'])` — TODO clique de cabeçalho voltava 400.
 *
 * ⚠️ E O `orderBy` DESTA ROTA NÃO É O DA ROTA DE ORÇAMENTOS. Lá ele é o par
 * `fila|recentes` (a ordem de ATENÇÃO, que é do contrato e não de uma coluna);
 * aqui a linha é um VEÍCULO e não existe fila de atenção a preservar. Por isso
 * a chave é a mesma e o schema é outro — declarado neste `extend`, que
 * SOBRESCREVE a definição herdada.
 *
 * ⚠️ ENTRADA DESCONHECIDA É DESCARTADA, não recusada. Um `?orderBy=` guardado
 * num favorito com o id de uma coluna que já não existe não pode derrubar a
 * tela: as entradas válidas sobrevivem, e se não sobrar nenhuma a rota devolve
 * a ordem padrão. O `web` só emite o que está em `VEICULO_SORT_FIELD_MAP`, que
 * é o espelho desta lista.
 *
 * ⚠️ A ordenação também é RECORTADA por seção, e isso é feito no serviço
 * (`vehicleOrderBy`), junto do recorte do dado: ordenar por placa é um oráculo
 * sobre a placa, e quem não tem `VEHICLE` não o recebe.
 */
export const PORTAL_VEHICLE_SORT_FIELDS = [
  'name',
  'serialNumber',
  'plate',
  'chassisNumber',
  'customer',
  'purchaseOrderNumber',
  'budgetNumber',
  'forecastDate',
  'createdAt',
] as const;

export type PortalVehicleSortField = (typeof PORTAL_VEHICLE_SORT_FIELDS)[number];

const SORT_ENTRY = /^([A-Za-z]+):(asc|desc)$/;

const vehicleOrderBySchema = z
  .preprocess(value => {
    if (value === undefined || value === null || value === '') return undefined;
    const bruto = Array.isArray(value) ? value.map(String) : String(value).split(',');
    const limpas = bruto
      .map(s => s.trim())
      .filter(s => {
        const m = SORT_ENTRY.exec(s);
        return !!m && (PORTAL_VEHICLE_SORT_FIELDS as readonly string[]).includes(m[1]);
      });
    return limpas.length ? limpas : undefined;
  }, z.array(z.string()).optional())
  .optional();

const portalVehicleListQuerySchema = portalListQuerySchema.extend({
  semPedido: semPedidoSchema,
  orderBy: vehicleOrderBySchema,
});

/**
 * As cobranças, com o filtro por ORÇAMENTO.
 *
 * ⚠️ `budgetId` é FILTRO, não escopo — ele estreita o que o escopo já permitiu.
 * Nome idêntico ao do `web`: chave desconhecida some em silêncio no zod, e um
 * `?quoteId=` ali chegaria como "sem filtro" e devolveria as cobranças de todos
 * os orçamentos parecendo estar funcionando.
 */
const portalChargeListQuerySchema = portalListQuerySchema.extend({
  budgetId: z.string().uuid('Orçamento inválido').optional(),
});

@Controller('cliente/me')
@ResponsibleOnly()
export class PortalReadController {
  constructor(private readonly portal: PortalReadService) {}

  /**
   * GET /cliente/me/resumo
   *
   * Contadores por estado do orçamento + "o que espera por mim": os orçamentos
   * em `IN_NEGOTIATION` que este contato pode pré-aprovar, os envelopes parados
   * na assinatura DELE e os veículos que estão na fábrica agora.
   */
  @Get('resumo')
  async resumo(@CurrentResponsible() principal: ResponsiblePrincipal) {
    return this.portal.resumo(principal);
  }

  /**
   * GET /cliente/me/orcamentos
   *
   * Lista escopada (§3) e recortada por seção (§2), paginada.
   * `?page=1&take=20&status=PENDING,IN_NEGOTIATION&searchingFor=&orderBy=fila`
   */
  @Get('orcamentos')
  async listBudgets(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Query(new ZodValidationPipe(portalBudgetListQuerySchema)) query: PortalListQuery,
  ) {
    return this.portal.listBudgets(principal, query ?? {});
  }

  /**
   * GET /cliente/me/orcamentos/:id
   *
   * Detalhe recortado por seção. O escopo entra no MESMO `where` do id: orçamento
   * fora do alcance deste contato responde 404, não 403 — a existência de um
   * orçamento de outro cliente não é informação que o portal confirme.
   */
  @Get('orcamentos/:id')
  async getBudget(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.getBudget(principal, id);
  }

  /**
   * GET /cliente/me/veiculos
   *
   * A frota escopada. Inclui veículo SEM orçamento (`Task.quoteId` nulo) quando
   * ele é da empresa deste contato.
   *
   * `?page=1&take=20&searchingFor=&semPedido=true&orderBy=name:asc` — e o teto
   * de `take` continua sendo 100. Quem precisa de "todos os que estão sem
   * pedido" pede `semPedido=true` e lê `meta.totalRecords`; não existe `take`
   * grande o bastante para a frota da Marquespan (358 veículos), e não deve
   * existir.
   *
   * ⚠️ `orderBy` AQUI É A LISTA DE `campo:direção` (ver
   * `PORTAL_VEHICLE_SORT_FIELDS`), e não o par `fila|recentes` da rota de
   * orçamentos. O motor de tabela do `web` marca `manualSorting` em modo
   * servidor: sem este parâmetro, o cabeçalho girava a seta e a lista voltava
   * na mesma ordem.
   */
  @Get('veiculos')
  async listVehicles(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Query(new ZodValidationPipe(portalVehicleListQuerySchema)) query: PortalListQuery,
  ) {
    return this.portal.listVehicles(principal, query ?? {});
  }

  /**
   * GET /cliente/me/veiculos/:taskId
   *
   * Veículo + andamento. O andamento é PROJEÇÃO MONOTÔNICA (§9): carimbo de
   * produção é apagado em operação normal, e quem viu "Concluído" não pode ver
   * "Em Preparação" na semana seguinte.
   */
  @Get('veiculos/:taskId')
  async getVehicle(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.portal.getVehicle(principal, taskId);
  }

  /**
   * GET /cliente/me/cobrancas
   *
   * Parcelas, boletos e NFS-e. Portão de SEÇÃO, não de capacidade: o §4 dá esta
   * rota a quem tem `PAYMENT`, e `PAYMENT` é o que `sectionsForRoles` já decide —
   * FINANCEIRO e os cinco papéis de documento inteiro têm; MARKETING, GESTOR DE
   * FROTA e MOTORISTA não. O 403 sai de dentro do serviço, junto do recorte, para
   * que o portão e a projeção não possam divergir.
   */
  @Get('cobrancas')
  async listCharges(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Query(new ZodValidationPipe(portalChargeListQuerySchema)) query: PortalListQuery,
  ) {
    return this.portal.listCharges(principal, query ?? {});
  }
}
