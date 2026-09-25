// api/src/modules/production/purchase-order/purchase-order.service.ts
//
// O PEDIDO DE COMPRA DO CLIENTE — a entidade que faltava.
//
// O QUE EXISTIA ANTES
//   `Task.customerOrderNumber`: texto livre, não-único, máximo 100, um por
//   veículo. Ele nasceu no PAGADOR (`BudgetPayer`) e desceu para a tarefa em
//   17/09, quando um orçamento passou a cobrir N implementos — porque o pedido é
//   por ENTREGA, não por fatura. O que a coluna nunca soube representar é o fato
//   óbvio: um pedido COBRE VÁRIOS VEÍCULOS. "Os vinte primeiros no pedido 8842,
//   os quarenta no 9013" existia só como a mesma string repetida em sessenta
//   linhas, sem nada que garantisse que ela era a mesma.
//
// A ESCRITA É DUPLA, E ISSO NÃO É TRANSIÇÃO FROUXA — É REQUISITO
//   Toda vez que `Task.purchaseOrderId` é escrito, `Task.customerOrderNumber`
//   recebe o MESMO texto. A coluna legada é o que lêem, HOJE, em produção:
//
//     · a regra de atenção `budget.ibipora-missing-order-number`
//       (`attention.service.ts` — `{ OR: [{ customerOrderNumber: null }, … ] }`);
//     · a discriminação da NFS-e (`nfse-emission.scheduler.ts`, via
//       `orderNumberLabel(tasks)`);
//     · o `seuNumero` do boleto no Sicredi;
//     · o quadro do tomador impresso no orçamento assinado
//       (`signature-envelope.service.ts` → `buildRenderInput`).
//
//   Nenhum dos quatro conhece `PurchaseOrder`. Escrever só a FK nova deixaria a
//   nota sair sem o pedido que o cliente exige e a regra de atenção continuar
//   apontando um veículo que já tem pedido — um defeito que só apareceria na
//   prefeitura, semanas depois. Os dois lados têm de concordar sempre, e o único
//   jeito de garantir isso é escrevê-los no MESMO `update`, na MESMA transação.
//
// ⚠️ E A CONVERSA É DE MÃO DUPLA: quem escreve `customerOrderNumber` pelos
//   caminhos antigos (`PUT /tasks/:id`, a grade de edição em lote, o detalhe do
//   faturamento) NÃO passa por aqui e deixa `purchaseOrderId` nulo. Por isso o
//   portão do pedido de compra (`purchase-order-gate.ts`) pergunta pelo FATO —
//   "existe número?" — e aceita qualquer um dos dois lados. Unificar os
//   caminhos de escrita é limpeza de outra rodada; enquanto ela não vem, ler
//   pelos dois é o que impede o portão de barrar um veículo que tem pedido.
//
// ⛔ E O NÚMERO É IMPRESSO NO DOCUMENTO ASSINADO — a guarda que faltava
//   `Task.customerOrderNumber` aparece na tabela de identificação do veículo do
//   orçamento, e o PDF é CONGELADO no envio para assinatura. Trocar por aqui um
//   número que a folha já imprime faria o documento que as pessoas assinaram
//   passar a mentir. `portal-identity.service.ts` trancava essa porta desde
//   20/09; ESTA aqui escrevia o mesmo campo sem guarda nenhuma, e era por ela
//   que um contato com `WRITE_PURCHASE_ORDER` passava.
//
//   Fechado em 20/09 com `guardFrozenDocument`, que chama
//   `assertIdentidadeNaoContradizDocumento` — a MESMA função da outra rota, não
//   uma segunda cópia da regra. ⚠️ Só no caminho do PORTAL: o funcionário
//   sempre pôde corrigir este número, e isso continua valendo (ver a nota em
//   `upsertAndLink`).

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  commercialTaskLink,
  commercialTaskWhereForCustomer,
  PortalScopeService,
  type PortalScopePrincipal,
} from '@modules/people/portal/portal-scope.service';
import {
  assertIdentidadeNaoContradizDocumento,
  mudancaDePedido,
} from '@modules/people/portal/portal-frozen-document';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '@constants/enums';

/** O que a listagem devolve por linha. */
export interface PurchaseOrderRow {
  id: string;
  number: string;
  issuedAt: Date | null;
  createdAt: Date;
  customerId: string;
  emitidoPor: { id: string; name: string } | null;
  veiculos: Array<{
    /** `Task.id` — o mesmo que `taskIds` recebe na escrita. */
    taskId: string;
    label: string;
    name: string | null;
    serialNumber: string | null;
    plate: string | null;
    /** Espelho da coluna legada. Iguais é o estado correto; divergir é defeito. */
    customerOrderNumber: string | null;
  }>;
}

interface UpsertArgs {
  customerId: string;
  number: string;
  issuedAt: Date | null;
  taskIds: string[];
  /** Contato do portal que informou o número. Nulo quando foi um funcionário. */
  issuedByResponsibleId: string | null;
  /** Funcionário que informou, para o changelog. Nulo quando foi o portal. */
  actorUserId: string | null;
  /** `where` extra que as tarefas têm de satisfazer. O escopo do portal entra aqui. */
  taskScope?: Prisma.TaskWhereInput | null;
  /**
   * ⛔ RECUSA (409) TROCAR UM NÚMERO QUE O DOCUMENTO ASSINADO JÁ IMPRIME.
   *
   * Ligado no caminho do PORTAL, desligado no do funcionário — e a assimetria é
   * a regra, não um descuido. Ver a nota longa em `upsertAndLink`.
   */
  guardFrozenDocument?: boolean;
}

const TASK_SELECT = {
  id: true,
  name: true,
  customerId: true,
  customerOrderNumber: true,
  purchaseOrderId: true,
  // ⚠️ `quoteId` é o que liga o veículo ao DOCUMENTO. Sem ele a guarda da
  // coleta de assinaturas não teria onde procurar o envelope — e uma guarda que
  // não acha envelope passa TUDO, em silêncio.
  quoteId: true,
  implement: { select: { serialNumber: true, plate: true } },
} as const;

/**
 * O MESMO `select`, MAIS a prova do laço comercial.
 *
 * `commercialTaskLink` falha FECHADO quando `billingEntry` não veio — e é por
 * isso que este `select` é uma função e não uma constante: o recorte do pagador
 * depende de QUAL empresa está perguntando.
 *
 * ⚠️ `customerConfigs` vai com `where: { customerId }`, como TODO include de
 * pagador do portal (contrato §3). Nunca `customerConfigs: true`: aqui a
 * pergunta é só "esta empresa está na conta?", e trazer os outros pagadores
 * seria trazer o cadastro deles para responder um booleano.
 */
const taskSelectFor = (customerId: string) =>
  ({
    ...TASK_SELECT,
    billingEntry: {
      select: {
        billing: {
          select: {
            customerConfigs: { where: { customerId }, select: { customerId: true } },
          },
        },
      },
    },
  }) as const;

function vehicleLabel(task: {
  id: string;
  name?: string | null;
  implement?: { serialNumber?: string | null; plate?: string | null } | null;
}): string {
  return (
    (task.implement?.serialNumber || undefined) ??
    (task.implement?.plate || undefined) ??
    (task.name || undefined) ??
    task.id.slice(0, 8)
  );
}

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScopeService,
    private readonly changeLogs: ChangeLogService,
  ) {}

  // ===========================================================================
  // LEITURA
  // ===========================================================================

  /**
   * Os pedidos de UM cliente, paginados.
   *
   * ⚠️ `customerId` é obrigatório e NÃO tem valor padrão. `Prisma` trata
   * `undefined` como "sem filtro", não como "nenhum": um parâmetro opcional aqui
   * devolveria, no primeiro descuido, os pedidos de compra de todos os clientes
   * do acervo — com número, data e placa.
   */
  async listForCustomer(
    customerId: string,
    // ⚠️ TIPO FROUXO DE PROPÓSITO, como o `geo` de `signWithOtp` e o `signers`
    // de `createEnvelope`: `strictNullChecks` está DESLIGADO no projeto, o que
    // faz `z.infer` marcar TODA chave como opcional — inclusive as que têm
    // `.default()`. Declarar `{ page: number }` aqui compila contra o schema
    // que já garantiu o valor e quebra o build contra o TIPO dele. Quem impõe a
    // forma é o zod da borda; aqui há rede de baixo, porque este serviço também
    // é chamado por outro serviço.
    query?: { page?: number; take?: number; searchingFor?: string } | null,
  ): Promise<{ rows: PurchaseOrderRow[]; totalRecords: number; page: number; take: number }> {
    if (!customerId?.trim()) {
      throw new BadRequestException('Informe o cliente para listar os pedidos de compra.');
    }

    const page = query?.page && query.page > 0 ? query.page : 1;
    const take = query?.take && query.take > 0 ? Math.min(query.take, 100) : 40;

    /**
     * A BUSCA, no servidor — e por isso a tela não precisa do universo.
     *
     * O portal lia esta lista com `take: 500` e filtrava no navegador, porque a
     * tabela rodava em modo `client`. Duas coisas estavam erradas: o teto do
     * schema é 100 (a requisição voltava 400), e "buscar em tudo" é trabalho de
     * `WHERE`. Procura-se pelo NÚMERO do pedido e pelo que identifica os
     * veículos que ele cobre — série, placa e nome —, que é como o Compras do
     * cliente procura: ele lembra da placa, não do UUID.
     *
     * ⚠️ `customerId` continua ENTRANDO SEMPRE no `where`, fora do `OR`. Um
     * termo de busca não pode alargar o escopo, só estreitá-lo.
     */
    const termo = query?.searchingFor?.trim();
    const where: Prisma.PurchaseOrderWhereInput = {
      customerId,
      ...(termo
        ? {
            OR: [
              { number: { contains: termo, mode: 'insensitive' as const } },
              {
                tasks: {
                  some: {
                    OR: [
                      { implement: { serialNumber: { contains: termo, mode: 'insensitive' as const } } },
                      { name: { contains: termo, mode: 'insensitive' as const } },
                      { implement: { plate: { contains: termo, mode: 'insensitive' as const } } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [totalRecords, orders] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        // Emitido primeiro, e o não-datado por último: `issuedAt` é opcional e
        // ordenar só por ele jogaria os nulos para uma ponta imprevisível
        // conforme o banco. `createdAt` desempata e sustenta a paginação.
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * take,
        take,
        include: {
          issuedBy: { select: { id: true, name: true } },
          tasks: { select: TASK_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      }),
    ]);

    return { rows: orders.map(o => this.toRow(o)), totalRecords, page, take };
  }

  /**
   * A mesma listagem, pela sessão do portal.
   *
   * O dono do pedido é a EMPRESA DO CONTATO, e `assertScoped` é quem garante que
   * ela existe: `Responsible.companyId` é nullable, e um `where` montado sem a
   * guarda não vira "nada" — vira `WHERE customerId IS NULL`, que casa com todos
   * os órfãos.
   */
  async listForPortal(
    principal: PortalScopePrincipal,
    query?: { page?: number; take?: number; searchingFor?: string } | null,
  ): Promise<{ rows: PurchaseOrderRow[]; totalRecords: number; page: number; take: number }> {
    const { companyId } = this.scope.assertScoped(principal);
    return this.listForCustomer(companyId, query);
  }

  // ===========================================================================
  // ESCRITA
  // ===========================================================================

  /**
   * `POST /cliente/me/pedidos` — o Compras do cliente informa o pedido.
   *
   * O `customerId` NUNCA vem do corpo: sai de `responsible.companyId` — o pedido
   * é de quem o EMITE, e é esse nome que a NFS-e cita.
   *
   * ⛔ O ESCOPO AQUI É O `commercialTaskScopeWhere`, e NÃO o `taskScopeWhere`.
   * A diferença é o caminho (c), "eu sou contato deste veículo", que é PESSOAL e
   * atravessa empresas sem nenhum laço comercial. Ver a nota longa em
   * `portal-scope.service.ts`: com o escopo inteiro, um contato pendurado por
   * engano num implemento de outra empresa carimbaria o pedido da empresa dele
   * nele; com a igualdade `task.customerId === companyId`, o Compras da Furgões
   * não conseguiria ligar o pedido a implemento NENHUM — que é o caso que a
   * feature existe para atender.
   */
  async createFromPortal(
    principal: PortalScopePrincipal,
    // Frouxo pelo mesmo motivo de `listForCustomer` — ver a nota lá.
    dto: { number?: string; issuedAt?: Date | null; taskIds?: string[] },
  ): Promise<PurchaseOrderRow> {
    const { companyId, responsibleId } = this.scope.assertScoped(principal);
    return this.upsertAndLink({
      customerId: companyId,
      number: dto?.number ?? '',
      issuedAt: dto?.issuedAt ?? null,
      taskIds: dto?.taskIds ?? [],
      issuedByResponsibleId: responsibleId,
      actorUserId: null,
      taskScope: this.scope.commercialTaskScopeWhere(principal),
      // ⛔ A GUARDA DO DOCUMENTO ASSINADO, e só neste caminho. Ver `upsertAndLink`.
      guardFrozenDocument: true,
    });
  }

  /**
   * `POST /purchase-orders` — o mesmo ato, por dentro.
   *
   * Sem `customerId` no corpo, ele sai do cliente DAS TAREFAS — e tem de ser um
   * só. Recusar a mistura não é preciosismo: `@@unique([customerId, number])`
   * significa que o pedido "8842" da Ibiporã e o "8842" da RKO são pedidos
   * DIFERENTES, e adivinhar qual deles o operador quis ligaria sessenta veículos
   * ao pedido errado sem nenhum aviso.
   */
  async createInternal(
    dto: {
      customerId?: string | null;
      number?: string;
      issuedAt?: Date | null;
      taskIds?: string[];
    },
    actorUserId: string | null,
  ): Promise<PurchaseOrderRow> {
    let customerId = dto?.customerId?.trim() || null;
    const taskIds = dto?.taskIds ?? [];

    if (!customerId) {
      const tasks = await this.prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, customerId: true },
      });
      const donos = [...new Set(tasks.map(t => t.customerId).filter(Boolean))] as string[];
      if (donos.length === 0) {
        throw new BadRequestException(
          'Os veículos selecionados não têm cliente. Informe o cliente do pedido de compra.',
        );
      }
      if (donos.length > 1) {
        throw new BadRequestException(
          `Os veículos selecionados pertencem a ${donos.length} clientes diferentes. ` +
            'O número do pedido é único DENTRO de um cliente — informe de quem é este pedido, ' +
            'ou faça um pedido por cliente.',
        );
      }
      customerId = donos[0];
    }

    return this.upsertAndLink({
      customerId,
      number: dto?.number ?? '',
      issuedAt: dto?.issuedAt ?? null,
      taskIds,
      issuedByResponsibleId: null,
      actorUserId,
      taskScope: null,
      // ⛔ DESLIGADA, e de propósito. O funcionário sempre pôde corrigir este
      // número: ele tem a tela do envelope na frente e reemite num clique.
      // Ver a nota da guarda em `upsertAndLink`.
      guardFrozenDocument: false,
    });
  }

  /**
   * O coração: acha-ou-cria o pedido e liga os veículos, com ESCRITA DUPLA.
   *
   * ⚠️ TUDO NUMA TRANSAÇÃO. São N+1 escritas (o pedido e cada tarefa) e elas
   * descrevem UM fato. Metade aplicada é o pior estado possível: alguns veículos
   * com a FK e a coluna preenchidas, outros sem — e a nota conjunta sairia
   * citando um pedido que cobre só parte do que ela cobra.
   */
  private async upsertAndLink(args: UpsertArgs): Promise<PurchaseOrderRow> {
    const number = (args.number ?? '').trim();
    if (!number) {
      throw new BadRequestException('Informe o número do pedido de compra.');
    }
    if (!args.taskIds?.length) {
      throw new BadRequestException('Selecione ao menos um veículo para o pedido.');
    }

    // ── OS VEÍCULOS, CONFERIDOS ANTES DE QUALQUER ESCRITA ────────────────────
    //
    // O `where` junta os ids pedidos, o ESCOPO (no portal) e o cliente do
    // pedido. Conferir por contagem e devolver QUAIS faltaram é o que separa
    // "você não tem acesso a este veículo" de um 500 mudo lá na frente.
    const where: Prisma.TaskWhereInput = {
      id: { in: args.taskIds },
      ...(args.taskScope ? { AND: [args.taskScope] } : {}),
    };
    const tasks = await this.prisma.task.findMany({
      where,
      select: taskSelectFor(args.customerId),
    });

    const encontrados = new Set(tasks.map(t => t.id));
    const faltando = args.taskIds.filter(id => !encontrados.has(id));
    if (faltando.length) {
      throw new NotFoundException(
        `${faltando.length} veículo(s) da lista não existem ou não estão no seu acesso. ` +
          'Recarregue a página e tente de novo.',
      );
    }

    // ⛔ O VEÍCULO TEM DE TER CONTA COM QUEM EMITE O PEDIDO — e "ter conta" é
    //    SER DONO **ou** SER PAGADOR, nunca só "ser dono".
    //
    // A versão anterior desta checagem era `t.customerId !== args.customerId`, e
    // ela RECUSAVA o caso principal da feature: a Furgões Ibiporã emite o pedido
    // e o implemento é da RKO (orçamentos 259–262, migration `20260917150100`). O
    // Compras da Furgões não conseguia ligar o pedido dela a implemento nenhum.
    //
    // A intenção original era boa e continua valendo: impedir que um comprador
    // carimbe o pedido dele num veículo com que não tem nenhuma relação
    // comercial — o `@@unique([customerId, number])` não perceberia, porque o
    // pedido está correto; errado está o vínculo. O predicado certo é
    // `commercialTaskLink`, que aceita DONO e PAGADOR e recusa o resto,
    // inclusive o caminho pessoal "sou contato deste veículo".
    //
    // ⚠️ Vale nos DOIS caminhos. No portal o `where` já cortou e isto é rede; no
    // caminho interno (`taskScope: null`) é a ÚNICA conferência que existe.
    const semVinculo = tasks.filter(t => commercialTaskLink(t, args.customerId) === null);
    if (semVinculo.length) {
      throw new ForbiddenException(
        `${semVinculo.length} veículo(s) selecionado(s) não são do cliente que emite o pedido ` +
          'nem estão em faturamento pago por ele ' +
          `(${semVinculo.map(t => vehicleLabel(t)).join(', ')}). ` +
          'O pedido de compra vale onde existe conta entre as duas empresas.',
      );
    }

    // ── ⛔ A COLETA DE ASSINATURAS, no caminho do PORTAL ─────────────────────
    //
    // `Task.customerOrderNumber` é IMPRESSO na tabela de identificação do
    // veículo do orçamento, e o PDF é congelado no envio para assinatura.
    // Preencher a lacuna que o documento deixou em branco é o caso de uso
    // (`lateSlotHtml` + `stampLateValues` existem para isso); TROCAR o que ele
    // já imprime faria a folha que as pessoas assinaram passar a mentir.
    //
    // ⛔ ESTE ERA O BURACO. `portal-identity.service.ts` tranca os quatro campos
    // impressos desde 20/09, e esta rota escrevia o MESMO número sem guarda
    // nenhuma: um contato com `WRITE_PURCHASE_ORDER` trocava por aqui, com 201
    // na cara, o que a outra porta recusava com 409.
    //
    // ⚠️ A MESMA FUNÇÃO dos dois lados, nunca uma segunda cópia da regra — duas
    // guardas divergem no primeiro conserto e a que ficar para trás é a que o
    // cliente encontra.
    //
    // ⛔ E SÓ NO PORTAL. O funcionário sempre pôde corrigir este número, e não é
    // disto que a guarda trata: do lado de dentro, invalidar a coleta é a
    // resposta CERTA — ele vê a tela do envelope e reemite num clique. O contato
    // do cliente não emite envelope nem reconvoca quem já assinou; para ele, a
    // mesma escrita seria um alçapão. O porquê inteiro está em
    // `portal-vehicle-identity.ts`.
    //
    // ⚠️ Roda ANTES da transação, sobre TODOS os veículos: um lote em que o
    // décimo contradiz o documento não pode gravar os nove primeiros e abortar.
    if (args.guardFrozenDocument) {
      for (const task of tasks) {
        // Só o que DE FATO muda é julgado — relink com o mesmo número é no-op e
        // não pode contradizer documento nenhum. `mudancaDePedido` devolve `{}`
        // nesse caso, e `{}` não classifica campo nenhum.
        await assertIdentidadeNaoContradizDocumento(
          this.prisma,
          task.quoteId,
          task.id,
          mudancaDePedido(task.customerOrderNumber, number),
        );
      }
    }

    const order = await this.prisma.$transaction(async tx => {
      // ACHA-OU-CRIA pelo par único. `upsert` e não `create`+catch: o mesmo
      // pedido chega em lotes ("os vinte primeiros agora, os quarenta amanhã") e
      // a segunda chamada tem de REUSAR a linha, senão o par único estoura e o
      // cliente vê um erro por ter feito exatamente o que o modelo prevê.
      const po = await tx.purchaseOrder.upsert({
        where: { customerId_number: { customerId: args.customerId, number } },
        create: {
          customerId: args.customerId,
          number,
          issuedAt: args.issuedAt,
          issuedByResponsibleId: args.issuedByResponsibleId,
        },
        // ⚠️ O `update` NÃO reescreve `issuedByResponsibleId`. Quem emitiu o
        // pedido foi quem o criou; um segundo lote informado por outra pessoa
        // não transfere a emissão. `issuedAt` só é preenchido quando ainda está
        // vazio, pela mesma razão: a data é do pedido, não desta chamada.
        update: args.issuedAt ? { issuedAt: { set: args.issuedAt } } : {},
        select: { id: true, number: true },
      });

      for (const task of tasks) {
        // Nada a fazer quando os dois lados já dizem o mesmo. Pular aqui não é
        // otimização: é o que impede uma linha de changelog vazia por veículo a
        // cada reenvio do formulário.
        if (task.purchaseOrderId === po.id && (task.customerOrderNumber ?? '') === number) {
          continue;
        }

        await tx.task.update({
          where: { id: task.id },
          data: {
            purchaseOrderId: po.id,
            // ⚠️ A ESCRITA DUPLA, no MESMO `update`. Ver o cabeçalho deste
            // arquivo: quatro consumidores em produção leem esta coluna e
            // NENHUM conhece `PurchaseOrder`.
            customerOrderNumber: number,
          },
        });

        // O HISTÓRICO DA COLUNA LEGADA continua sendo alimentado.
        //
        // Não é enfeite: `signature-envelope.service.ts` lê o changelog de
        // `customerOrderNumber` para saber QUANDO o número chegou e decidir o
        // aditivo de identificação do veículo. Gravar a tarefa por fora do
        // caminho que registra deixaria aquele aditivo cego justamente para o
        // dado que o portal existe para trazer mais cedo.
        //
        // ⚠️ `userId` é o FUNCIONÁRIO, e é `null` no portal. `ChangeLog.userId`
        // é FK para `User` e o repositório grava por `connect`: um id de
        // contato ali vira P2025 e derruba a transação de NEGÓCIO que estava
        // sendo auditada — foi assim que sumiram 7 linhas de bonificação em
        // 07/2026. Quem informou pelo portal fica em `metadata`.
        await this.changeLogs.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: task.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'customerOrderNumber',
          oldValue: task.customerOrderNumber ?? null,
          newValue: number,
          reason: args.issuedByResponsibleId
            ? 'Número do pedido de compra informado pelo cliente no portal'
            : 'Número do pedido de compra informado',
          triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
          triggeredById: po.id,
          userId: args.actorUserId,
          transaction: tx,
          metadata: {
            purchaseOrderId: po.id,
            ...(args.issuedByResponsibleId
              ? { origem: 'portal', responsibleId: args.issuedByResponsibleId }
              : { origem: 'interno' }),
          },
        });
      }

      return po;
    });

    this.logger.log(
      `Pedido de compra ${order.number} (${order.id}) ligado a ${tasks.length} veículo(s) ` +
        `do cliente ${args.customerId}` +
        (args.issuedByResponsibleId ? ` — informado pelo portal (${args.issuedByResponsibleId})` : ''),
    );

    const fresh = await this.prisma.purchaseOrder.findUnique({
      where: { id: order.id },
      include: {
        issuedBy: { select: { id: true, name: true } },
        tasks: { select: TASK_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    return this.toRow(fresh!);
  }

  private toRow(order: {
    id: string;
    number: string;
    issuedAt: Date | null;
    createdAt: Date;
    customerId: string;
    issuedBy?: { id: string; name: string } | null;
    tasks?: Array<{
      id: string;
      name?: string | null;
      customerOrderNumber?: string | null;
      implement?: { serialNumber?: string | null; plate?: string | null } | null;
    }>;
  }): PurchaseOrderRow {
    return {
      id: order.id,
      number: order.number,
      issuedAt: order.issuedAt ?? null,
      createdAt: order.createdAt,
      customerId: order.customerId,
      emitidoPor: order.issuedBy ?? null,
      veiculos: (order.tasks ?? []).map(t => ({
        taskId: t.id,
        label: vehicleLabel(t),
        name: t.name ?? null,
        serialNumber: t.implement?.serialNumber ?? null,
        plate: t.implement?.plate ?? null,
        // ESPELHO DA COLUNA LEGADA, exposto de propósito. Quando ele divergir de
        // `number`, alguém escreveu a tarefa por um caminho que não passa por
        // aqui — e é melhor que isso apareça numa tela do que na prefeitura.
        customerOrderNumber: t.customerOrderNumber ?? null,
      })),
    };
  }
}
