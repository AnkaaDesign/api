import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { INSTALLMENT_STATUS, INVOICE_STATUS } from '@constants';
import {
  documentSearchDigits,
  normalizeSearchTerm,
  normalizeVehicleSearchTerm,
} from '../../../schemas/common';

/** Uma faixa de datas fechada nos dois lados, ou aberta num deles. */
export interface BillingDateRange {
  from?: Date;
  to?: Date;
}

/** Uma faixa numérica fechada nos dois lados, ou aberta num deles. */
export interface BillingNumberRange {
  min?: number;
  max?: number;
}

export type BillingOrderDir = 'asc' | 'desc';

/**
 * O QUE ESTA ROTA SABE ORDENAR — e por que é um MAPA e não uma lista de nomes.
 *
 * `budgetNumber` não é coluna de `Billing`: é do orçamento, e só ordena porque
 * `quote` é relação de-UM (`{ quote: { budgetNumber: dir } }`). Uma lista de
 * strings planas não conseguiria exprimir isso — o valor iria direto para o
 * `orderBy` do Prisma como `{ budgetNumber: 'asc' }`, campo que não existe em
 * `Billing`, e o erro nasceria dentro do driver (500, não 400).
 *
 * O controller valida contra as CHAVES daqui, para que o whitelist do 400 e o
 * que o Prisma realmente aceita nunca se separem: acrescentar uma ordenação é
 * uma linha, num lugar só.
 *
 * Fora daqui de propósito: `total` (o `Billing` não tem coluna de valor — ordenar
 * por `quote.total` ordenaria pelo CONTRATO, a mesma chave para as 60 linhas de
 * um `PER_TASK`) e tudo que vem de `tasks` (relação de-MUITOS: nome, série,
 * placa, `finishedAt` — o Prisma não ordena por isso).
 */
export const BILLING_ORDER_BY_FIELDS: Record<
  string,
  (dir: BillingOrderDir) => Record<string, unknown>
> = {
  statusOrder: dir => ({ statusOrder: dir }),
  createdAt: dir => ({ createdAt: dir }),
  approvedAt: dir => ({ approvedAt: dir }),
  budgetNumber: dir => ({ quote: { budgetNumber: dir } }),
};

export const BILLING_ORDER_BY = Object.keys(BILLING_ORDER_BY_FIELDS);

/**
 * O MAIOR `budgetNumber` QUE CABE NO BANCO (`Int` do Postgres é de 32 bits).
 *
 * A busca textual vira `quote.budgetNumber = Number(termo)` quando o termo é só
 * dígitos. Sem este teto, digitar um CNPJ sem pontuação (catorze dígitos) mandaria
 * um número maior que o tipo da coluna e o Prisma derrubaria a consulta inteira —
 * a busca por cliente respondendo com erro de servidor.
 */
const PG_INT4_MAX = 2147483647;

/** Parcela ainda EM ABERTO — o que o "Vencimento" da lista procura. */
const OPEN_INSTALLMENT_STATUSES = [
  INSTALLMENT_STATUS.PENDING,
  INSTALLMENT_STATUS.PROCESSING,
  INSTALLMENT_STATUS.OVERDUE,
];

/**
 * O FATURAMENTO COMO COISA QUE SE ABRE — e por que precisou de módulo próprio.
 *
 * A tela de cobrança era endereçada por VEÍCULO (`/faturamento/detalhes/:taskId`)
 * porque não havia mais nada para endereçar: "faturamento" era uma lista de
 * `TaskQuoteCustomerConfig` pendurada no orçamento, sem id que significasse a
 * cobrança. A consequência aparecia na tela: num orçamento de quatro caminhões
 * cobrados um a um, abrir qualquer veículo mostrava "Fatura 1 · 2 · 3 · 4" na
 * MESMA página, porque não havia quatro coisas — havia uma lista de
 * configurações de uma coisa só.
 *
 * Agora há. `Billing` tem id, tem cobertura e tem estado, e este serviço é o que
 * responde às três perguntas que a tela faz:
 *
 *   · de quais veículos é esta cobrança?   → `tasks`
 *   · quem paga, e em que termos?          → `customerConfigs`
 *   · já foi faturada?                     → `approvedAt`
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * O GRAFO DE UMA COBRANÇA — tudo que a página `/faturamento/:billingId` precisa,
   * numa consulta.
   *
   * Inclui o ORÇAMENTO inteiro de propósito: o valor de uma fatia é derivado do
   * contrato (`total ÷ vehicleCount × veículos cobertos`), e a tela que exibisse
   * só a cobrança não teria como conferir a conta nem mostrar de que contrato ela
   * é. O que NÃO vem é a lista das cobranças irmãs em detalhe — só o suficiente
   * para o navegador entre elas, que é `siblings`.
   */
  private static readonly DETAIL_INCLUDE = {
    quote: {
      select: {
        id: true,
        budgetNumber: true,
        status: true,
        statusOrder: true,
        subtotal: true,
        total: true,
        expiresAt: true,
        billingSplit: true,
        vehicleCount: true,
        billingApprovedAt: true,
        guaranteeYears: true,
        customGuaranteeText: true,
        services: {
          orderBy: { position: 'asc' as const },
          select: {
            id: true,
            description: true,
            amount: true,
            observation: true,
            position: true,
            invoiceToCustomerId: true,
          },
        },
        tasks: {
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
          select: {
            id: true,
            name: true,
            serialNumber: true,
            createdAt: true,
            customerOrderNumber: true,
            finishedAt: true,
            truck: { select: { plate: true, chassisNumber: true } },
          },
        },
      },
    },
    tasks: {
      orderBy: [{ task: { createdAt: 'asc' as const } }, { taskId: 'asc' as const }],
      select: {
        taskId: true,
        task: {
          select: {
            id: true,
            name: true,
            serialNumber: true,
            createdAt: true,
            finishedAt: true,
            customerOrderNumber: true,
            truck: { select: { plate: true, chassisNumber: true } },
          },
        },
      },
    },
    customerConfigs: {
      orderBy: { createdAt: 'asc' as const },
      include: {
        customer: true,
        responsible: true,
        installments: { orderBy: { number: 'asc' as const } },
        invoices: {
          orderBy: { createdAt: 'desc' as const },
          include: { nfseDocuments: { orderBy: { createdAt: 'desc' as const } } },
        },
      },
    },
  };

  /**
   * O GRAFO DA LISTA — só o que as dezesseis colunas leem, e nada além.
   *
   * Separado do `DETAIL_INCLUDE` porque a lista o servia QUARENTA VEZES por
   * página: cada linha trazia o orçamento inteiro (todos os serviços, todas as N
   * tarefas do contrato), os pagadores com o responsável, todas as parcelas, todas
   * as faturas e todas as NFS-e. Numa página de quarenta linhas de um orçamento de
   * sessenta veículos, o payload da lista era maior que o da tela de detalhe que o
   * grafo foi desenhado para servir.
   *
   * O que ficou, e por quê:
   *
   *  · `quote.tasks[id, customerOrderNumber]` — a coluna "N° do Pedido" tem de
   *    dizer "3 de 4", e a regra de atenção do pedido de compra tem de enxergar o
   *    CONTRATO inteiro. Lendo só as tarefas da página, um pedido em branco fora
   *    dela não acendia nada.
   *  · `tasks.task.customer` e `tasks.task.status` — a coluna "Cliente" e o
   *    desempate da atenção. Nenhum dos dois estava no `DETAIL_INCLUDE`, e sem eles
   *    a célula fica vazia e a linha se recusa a piscar.
   *  · `customerConfigs.customer` INTEIRO — a regra `billing-customer-incomplete`
   *    confere os campos que a NFS-e exige (inscrição, endereço, e-mail). Um
   *    `select` curto aqui faz o motor ler "cliente completo" e a cobrança
   *    incompleta atravessa a tela sem aviso.
   *  · `installments.bankSlip.status` e `invoices.nfseDocuments.status` — os selos
   *    de boleto e nota, que o grafo antigo trazia por inteiro ou não trazia.
   *
   * O que saiu: `quote.services`, `customerConfigs.responsible`, a garantia, e os
   * escalares de fatura que ninguém lê na lista.
   */
  private static readonly LIST_INCLUDE = {
    quote: {
      select: {
        id: true,
        budgetNumber: true,
        status: true,
        statusOrder: true,
        subtotal: true,
        total: true,
        vehicleCount: true,
        billingSplit: true,
        billingApprovedAt: true,
        createdAt: true,
        tasks: {
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
          select: { id: true, customerOrderNumber: true },
        },
      },
    },
    tasks: {
      orderBy: [{ task: { createdAt: 'asc' as const } }, { taskId: 'asc' as const }],
      select: {
        taskId: true,
        task: {
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            createdAt: true,
            finishedAt: true,
            customerOrderNumber: true,
            truck: { select: { plate: true } },
            customer: { select: { id: true, fantasyName: true, corporateName: true } },
          },
        },
      },
    },
    customerConfigs: {
      orderBy: { createdAt: 'asc' as const },
      select: {
        id: true,
        billingId: true,
        customerId: true,
        subtotal: true,
        total: true,
        paymentCondition: true,
        paymentConfig: true,
        generateInvoice: true,
        generateBankSlip: true,
        customer: true,
        installments: {
          orderBy: { number: 'asc' as const },
          select: {
            id: true,
            number: true,
            dueDate: true,
            amount: true,
            paidAmount: true,
            paidAt: true,
            status: true,
            paymentMethod: true,
            bankSlip: { select: { id: true, status: true, dueDate: true } },
          },
        },
        invoices: {
          orderBy: { createdAt: 'desc' as const },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            nfseDocuments: {
              orderBy: { createdAt: 'desc' as const },
              select: { id: true, status: true, nfseNumber: true },
            },
          },
        },
      },
    },
  };

  /**
   * `Decimal` VIRA `number` ANTES DE SAIR.
   *
   * O driver devolve `Prisma.Decimal`, que serializa como STRING no JSON. A tela
   * que soma os pagadores de uma cobrança fazia `"1200.00" + "800.00"` e mostrava
   * `"1200.00800.00"` — a soma de dois valores virando concatenação, sem erro
   * nenhum, num campo de dinheiro. O repositório de Task já converte campo a campo
   * (`task-prisma.repository.ts`); aqui a conversão é pela FORMA do valor, e não
   * por uma lista de nomes, porque o grafo tem dinheiro em cinco níveis
   * (`quote`, `customerConfigs`, `installments`, `invoices`, `bankSlip`) e uma
   * coluna nova acrescentada em qualquer um deles voltaria a sair como string sem
   * que nada acusasse.
   *
   * `Date` não é confundido: `Decimal` tem `toNumber`/`toFixed`, `Date` não tem
   * nenhum dos dois.
   */
  private static toPlainNumbers<T>(value: T): T {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map(v => BillingService.toPlainNumbers(v)) as unknown as T;
    }
    if (typeof value !== 'object') return value;
    if (value instanceof Date) return value;

    const candidate = value as unknown as { toNumber?: unknown; toFixed?: unknown };
    if (typeof candidate.toNumber === 'function' && typeof candidate.toFixed === 'function') {
      return (candidate.toNumber as () => number)() as unknown as T;
    }

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = BillingService.toPlainNumbers(v);
    }
    return out as unknown as T;
  }

  /**
   * UMA cobrança, pelo id dela.
   *
   * `siblings` é o que substitui os passos "Fatura 1 · 2 · 3 · 4" da tela antiga:
   * as outras cobranças do mesmo orçamento viram um NAVEGADOR, não abas de uma
   * página só. Cada uma tem a sua página, o seu estado e o seu endereço.
   */
  async findById(id: string) {
    const billing = await (this.prisma as any).billing.findUnique({
      where: { id },
      include: BillingService.DETAIL_INCLUDE,
    });
    if (!billing) {
      throw new NotFoundException(`Faturamento ${id} não encontrado.`);
    }

    const siblings = await (this.prisma as any).billing.findMany({
      where: { quoteId: billing.quoteId, id: { not: id } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        approvedAt: true,
        createdAt: true,
        tasks: {
          orderBy: [{ task: { createdAt: 'asc' } }, { taskId: 'asc' }],
          select: {
            taskId: true,
            task: { select: { id: true, serialNumber: true, truck: { select: { plate: true } } } },
          },
        },
        customerConfigs: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, customer: { select: { id: true, fantasyName: true } } },
        },
      },
    });

    return {
      success: true,
      message: 'Faturamento carregado com sucesso.',
      data: BillingService.toPlainNumbers({ ...billing, siblings }),
    };
  }

  /**
   * OS FATURAMENTOS DE UM ORÇAMENTO, na ordem de criação.
   *
   * É o que o compositor da tela de orçamento mostra depois de "junto / um por
   * veículo / em lotes": quantas cobranças aquilo produziu, e quais veículos cada
   * uma leva.
   */
  async findByQuote(quoteId: string) {
    const data = await (this.prisma as any).billing.findMany({
      where: { quoteId },
      orderBy: { createdAt: 'asc' },
      include: BillingService.DETAIL_INCLUDE,
    });
    return {
      success: true,
      message: `${data.length} faturamento(s) encontrado(s).`,
      data: BillingService.toPlainNumbers(data),
    };
  }

  /**
   * O FATURAMENTO QUE COBRA ESTE VEÍCULO.
   *
   * Existe para a ponte: toda a tela antiga, os dois apps e os links de
   * notificação endereçam por tarefa, e `BillingTask.@@unique([taskId])` garante
   * que a resposta é uma só. É isso que torna a migração do web um redirecionamento
   * e não uma quebra — `/faturamento/detalhes/:taskId` resolve aqui e manda para
   * `/faturamento/:billingId`.
   */
  async findByTask(taskId: string) {
    const row = await (this.prisma as any).billingTask.findUnique({
      where: { taskId },
      select: { billingId: true },
    });
    if (!row) {
      throw new NotFoundException(
        `O veículo ${taskId} não está em nenhum faturamento. ` +
          'Ou não pertence a um orçamento, ou o orçamento ainda não foi fatiado.',
      );
    }
    return this.findById(row.billingId);
  }

  /**
   * A FILA — "o que entreguei e ainda não cobrei?".
   *
   * Uma pergunta que a lista antiga não sabia fazer: as linhas eram TAREFAS, e um
   * orçamento de sessenta caminhões cobrado junto aparecia sessenta vezes, cada
   * linha repetindo o mesmo contrato. Aqui cada linha é uma COBRANÇA — sessenta
   * caminhões cobrados juntos são uma linha, cobrados um a um são sessenta, e a
   * diferença entre as duas coisas finalmente aparece.
   */
  async findMany(params: {
    page?: number;
    limit?: number;
    quoteId?: string;
    /** UM pagador. Mantido para os chamadores antigos; `customerIds` é o plural. */
    customerId?: string;
    /** `true` = já faturados; `false` = a faturar; ausente = ambos. */
    approved?: boolean;
    /** Só os que têm todos os veículos concluídos — a fila do financeiro. */
    deliveredOnly?: boolean;
    /** Filtro pelo ESTADO da cobrança (`BILLING_STATUS`), um ou vários. */
    statuses?: string[];
    /** Busca textual — veículo, quem paga e o número do orçamento. */
    searchingFor?: string;
    /** Estado do ORÇAMENTO (`TASK_QUOTE_STATUS`) — ver o comentário abaixo. */
    quoteStatuses?: string[];
    budgetNumber?: number;
    /** "Faturar Para" — os pagadores desta cobrança. */
    customerIds?: string[];
    /** "Cliente da Tarefa" — o dono do veículo coberto. */
    taskCustomerIds?: string[];
    totalRange?: BillingNumberRange;
    /** `true` = todos os veículos têm pedido; `false` = falta em pelo menos um. */
    hasOrderNumber?: boolean;
    dueDateRange?: BillingDateRange;
    finishedDateRange?: BillingDateRange;
    billingApprovedRange?: BillingDateRange;
    createdAtRange?: BillingDateRange;
    /** Uma chave de `BILLING_ORDER_BY_FIELDS`, ou várias, na ordem de precedência. */
    orderBy?: string | string[];
    orderDir?: BillingOrderDir | BillingOrderDir[];
  }) {
    const page = Math.max(1, params.page ?? 1);
    // TETO DE MIL, e não de duzentos.
    //
    // O pager do detalhe pede a lista inteira de irmãs para poder dizer "87 / 325",
    // e pedia mil. O teto de duzentos devolvia duzentas linhas sem avisar em lugar
    // nenhum — nem no `meta`, nem num erro — e o pager então afirmava que a lista
    // tinha duzentos registros. Um recorte silencioso é pior que uma recusa.
    const limit = Math.min(1000, Math.max(1, params.limit ?? 40));

    const where: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    const quoteWhere: Record<string, unknown> = {};

    if (params.quoteId) where.quoteId = params.quoteId;
    if (params.approved === true) where.approvedAt = { not: null };
    if (params.approved === false) where.approvedAt = null;
    if (params.customerId) where.customerConfigs = { some: { customerId: params.customerId } };
    // "Entregue" é do VEÍCULO, e a cobrança só está pronta quando TODOS os seus
    // estão: cobrar um lote de vinte com dezenove prontos é cobrar trabalho que
    // ainda não saiu. `none: { finishedAt: null }` é exatamente isso, e vale
    // também para a cobrança sem cobertura (que não está pronta para nada).
    if (params.deliveredOnly) {
      where.tasks = { some: {}, none: { task: { finishedAt: null } } };
    }
    if (params.statuses && params.statuses.length > 0) {
      where.status = { in: params.statuses };
    }

    // O ESTADO DO ORÇAMENTO — o filtro sem o qual esta lista mente.
    //
    // `Billing` nasce na MESMA transação que cria o orçamento, não na aprovação:
    // um orçamento PENDING que ninguém assinou já tem cobrança. A lista antiga
    // nunca mostrou isso porque era de TAREFAS e exigia a tarefa concluída; esta é
    // de cobranças e mostraria tudo. Daí o filtro ser o primeiro parâmetro que a
    // tela manda — `APPROVED` (e `CANCELLED`, quando se quer ver o que caiu).
    //
    // Fica OPCIONAL de propósito: quem chama `?quoteId=` quer as cobranças daquele
    // orçamento seja qual for o estado dele.
    if (params.quoteStatuses && params.quoteStatuses.length > 0) {
      quoteWhere.status = { in: params.quoteStatuses };
    }
    if (params.budgetNumber !== undefined) {
      quoteWhere.budgetNumber = params.budgetNumber;
    }

    if (params.customerIds && params.customerIds.length > 0) {
      and.push({ customerConfigs: { some: { customerId: { in: params.customerIds } } } });
    }
    if (params.taskCustomerIds && params.taskCustomerIds.length > 0) {
      and.push({ tasks: { some: { task: { customerId: { in: params.taskCustomerIds } } } } });
    }

    // O VALOR: a soma dos pagadores é o que a linha cobra, mas soma não é coluna e
    // não se filtra no banco. `some` é a aproximação honesta — num recorte de dois
    // pagadores ela acha a cobrança se QUALQUER um deles cair na faixa, e não a
    // soma dos dois. Errar assim é achar demais; o contrário seria esconder.
    const totalMin = params.totalRange?.min;
    const totalMax = params.totalRange?.max;
    if (totalMin !== undefined || totalMax !== undefined) {
      const bounds: Record<string, number> = {};
      if (totalMin !== undefined) bounds.gte = totalMin;
      if (totalMax !== undefined) bounds.lte = totalMax;
      and.push({ customerConfigs: { some: { total: bounds } } });
    }

    // O PEDIDO DE COMPRA: faltar em UM veículo já trava a nota do recorte inteiro,
    // então "sem pedido" é `some` (falta em algum), não `every`.
    if (params.hasOrderNumber !== undefined) {
      const missing = { task: { OR: [{ customerOrderNumber: null }, { customerOrderNumber: '' }] } };
      and.push(
        params.hasOrderNumber
          ? { tasks: { some: {}, none: missing } }
          : { tasks: { some: missing } },
      );
    }

    // O VENCIMENTO da linha é a parcela EM ABERTO mais antiga da cobrança — a
    // mesma que a coluna mostra. Filtrar só por "existe parcela em aberto na
    // faixa" traria a cobrança cuja PRIMEIRA em aberto venceu antes e cujo atraso
    // é o que interessa; daí o segundo ramo negativo, que exige que não haja
    // nenhuma mais antiga em aberto.
    if (params.dueDateRange?.from || params.dueDateRange?.to) {
      const bounds: Record<string, Date> = {};
      if (params.dueDateRange.from) bounds.gte = params.dueDateRange.from;
      if (params.dueDateRange.to) bounds.lte = params.dueDateRange.to;
      and.push({
        customerConfigs: {
          some: {
            installments: {
              some: { status: { in: OPEN_INSTALLMENT_STATUSES }, dueDate: bounds },
            },
          },
        },
      });
      if (params.dueDateRange.from) {
        and.push({
          customerConfigs: {
            none: {
              installments: {
                some: {
                  status: { in: OPEN_INSTALLMENT_STATUSES },
                  dueDate: { lt: params.dueDateRange.from },
                },
              },
            },
          },
        });
      }
    }

    // "FINALIZADO EM" da linha é o MAIOR `finishedAt` da cobertura, e `null`
    // enquanto um veículo estiver aberto. O filtro reproduz esse valor em três
    // cláusulas em vez de um `some` ingênuo: um `some` acharia o lote de vinte cujo
    // primeiro caminhão saiu em janeiro, ainda que o último não tenha saído.
    if (params.finishedDateRange?.from || params.finishedDateRange?.to) {
      and.push({ tasks: { some: {}, none: { task: { finishedAt: null } } } });
      if (params.finishedDateRange.from) {
        and.push({
          tasks: { some: { task: { finishedAt: { gte: params.finishedDateRange.from } } } },
        });
      }
      if (params.finishedDateRange.to) {
        and.push({ tasks: { none: { task: { finishedAt: { gt: params.finishedDateRange.to } } } } });
      }
    }

    // "Faturado em" e "Criado em" são escalares da PRÓPRIA linha — nada de relação.
    const approvedBounds = BillingService.dateBounds(params.billingApprovedRange);
    if (approvedBounds) and.push({ approvedAt: approvedBounds });
    const createdBounds = BillingService.dateBounds(params.createdAtRange);
    if (createdBounds) and.push({ createdAt: createdBounds });

    const search = BillingService.searchWhere(params.searchingFor);
    if (search) and.push(search);

    if (Object.keys(quoteWhere).length > 0) where.quote = quoteWhere;
    if (and.length > 0) where.AND = and;

    const [data, totalRecords] = await Promise.all([
      (this.prisma as any).billing.findMany({
        where,
        orderBy: BillingService.buildOrderBy(params.orderBy, params.orderDir),
        skip: (page - 1) * limit,
        take: limit,
        include: BillingService.LIST_INCLUDE,
      }),
      (this.prisma as any).billing.count({ where }),
    ]);

    const totalPages = Math.ceil(totalRecords / limit) || 1;
    return {
      success: true,
      message: `${totalRecords} faturamento(s).`,
      data: BillingService.toPlainNumbers(data),
      meta: {
        totalRecords,
        page,
        // `take` é o nome do tipo `Meta` da casa; `limit` fica ao lado porque esta
        // rota o emitiu desde o primeiro dia e há tela lendo. Os dois são o mesmo
        // número — nunca podem divergir.
        take: limit,
        limit,
        totalPages,
        hasNextPage: page * limit < totalRecords,
        hasPreviousPage: page > 1,
      },
    };
  }

  /** `{ from, to }` vira `{ gte, lte }`; faixa vazia vira `undefined`. */
  private static dateBounds(range?: BillingDateRange): Record<string, Date> | undefined {
    if (!range?.from && !range?.to) return undefined;
    const bounds: Record<string, Date> = {};
    if (range.from) bounds.gte = range.from;
    if (range.to) bounds.lte = range.to;
    return bounds;
  }

  /**
   * A ORDENAÇÃO, COMO LISTA.
   *
   * A tela ordena por duas colunas (estado da cobrança e depois data), e a rota
   * aceitava UMA — a segunda chave era descartada em silêncio, e a lista chegava
   * ordenada por um critério que ninguém pediu. As direções são pareadas por
   * posição; uma direção só vale para todas as chaves.
   *
   * `id` fecha a lista sempre: sem um desempate total, duas cobranças com o mesmo
   * `statusOrder` e o mesmo `createdAt` podem trocar de posição entre duas páginas
   * e a paginação repete uma e pula outra.
   */
  private static buildOrderBy(
    orderBy?: string | string[],
    orderDir?: BillingOrderDir | BillingOrderDir[],
  ): Record<string, unknown>[] {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).filter(
      key => BILLING_ORDER_BY_FIELDS[key] !== undefined,
    );
    const dirs = Array.isArray(orderDir) ? orderDir : orderDir ? [orderDir] : [];

    // ORDENAÇÃO PADRÃO: pelo ESTADO, que é a ordem da ação pendente — vencido
    // primeiro, depois o que espera a nossa aprovação, depois o que espera o
    // cliente pagar. Era por `approvedAt`, que ordenava por quando a cobrança
    // saiu e não por quanto ela urge: uma cobrança vencida há dois meses caía
    // no fim da lista por ter sido aprovada antes das outras.
    const resolved = keys.length > 0 ? keys : ['statusOrder'];
    const out = resolved.map((key, i) =>
      BILLING_ORDER_BY_FIELDS[key](dirs[i] ?? dirs[0] ?? 'asc'),
    );

    if (!resolved.includes('createdAt')) out.push({ createdAt: 'desc' });
    out.push({ id: 'asc' });
    return out;
  }

  /**
   * A BUSCA TEXTUAL — três famílias, porque a linha é uma cobrança.
   *
   * O veículo (via cobertura), quem paga, e o CONTRATO. A terceira é nova e é a
   * que o financeiro usa ao telefone: digitar "984" na lista de Faturamento não
   * achava nada, porque `budgetNumber` nunca esteve na busca da lista de tarefas
   * de onde esta tela veio.
   *
   * As comparações são contra as colunas `*Normalized` (geradas, sem acento e em
   * minúsculas) pelos mesmos auxiliares da busca antiga — reimplementar o
   * normalizador aqui faria a mesma palavra achar coisas diferentes em duas telas.
   */
  private static searchWhere(term?: string): Record<string, unknown> | null {
    const raw = (term ?? '').trim();
    if (!raw) return null;

    const n = normalizeSearchTerm(raw);
    const nv = normalizeVehicleSearchTerm(raw);
    const onTask = (cond: Record<string, unknown>) => ({ tasks: { some: { task: cond } } });
    const onPayer = (cond: Record<string, unknown>) => ({
      customerConfigs: { some: { customer: cond } },
    });

    const or: Record<string, unknown>[] = [
      onTask({ nameNormalized: { contains: n } }),
      onTask({ serialNumberNormalized: { contains: n } }),
      onTask({ detailsNormalized: { contains: n } }),
      onTask({ customer: { fantasyNameNormalized: { contains: n } } }),
      onTask({ customer: { corporateNameNormalized: { contains: n } } }),
      onPayer({ fantasyNameNormalized: { contains: n } }),
      onPayer({ corporateNameNormalized: { contains: n } }),
    ];

    if (nv) {
      or.push(onTask({ truck: { plateNormalized: { contains: nv } } }));
      or.push(onTask({ truck: { chassisNumberNormalized: { contains: nv } } }));
    }

    // O NÚMERO DO ORÇAMENTO. Só quando o termo é inteiro e cabe num `Int` do
    // Postgres — ver `PG_INT4_MAX`. O `#` é aceito porque é como a tela o escreve.
    const numeric = raw.replace(/^#/, '').trim();
    if (/^\d+$/.test(numeric) && Number(numeric) <= PG_INT4_MAX) {
      or.push({ quote: { budgetNumber: Number(numeric) } });
    }

    // CNPJ/CPF são gravados sem pontuação: "13.636.972" tem de achar "13636972".
    // `documentSearchDigits` devolve `null` quando o termo não é um documento —
    // sem essa guarda, "QA 4V" virava o dígito "4" e casava com quase todo cliente.
    const digits = documentSearchDigits(raw);
    if (digits) {
      or.push(onTask({ customer: { cnpjNormalized: { contains: digits } } }));
      or.push(onTask({ customer: { cpfNormalized: { contains: digits } } }));
      or.push(onPayer({ cnpjNormalized: { contains: digits } }));
      or.push(onPayer({ cpfNormalized: { contains: digits } }));
    }

    return { OR: or };
  }

  /** O orçamento a que um faturamento pertence — para as rotas que delegam. */
  async quoteIdOf(billingId: string): Promise<string> {
    const b = await (this.prisma as any).billing.findUnique({
      where: { id: billingId },
      select: { quoteId: true },
    });
    if (!b) throw new NotFoundException(`Faturamento ${billingId} não encontrado.`);
    return b.quoteId;
  }

  /**
   * ESTE FATURAMENTO ESTÁ CONGELADO? — aprovado, ou com fatura viva.
   *
   * O critério é o mesmo do reconciliador (`hasLiveInvoice || approvedAt`), e está
   * aqui para a TELA poder desabilitar o que o servidor vai recusar, em vez de
   * deixar o usuário descobrir pelo toast.
   */
  async isFrozen(billingId: string): Promise<boolean> {
    const [approved, live] = await Promise.all([
      (this.prisma as any).billing.count({
        where: { id: billingId, approvedAt: { not: null } },
      }),
      this.prisma.invoice.count({
        where: {
          customerConfig: { billingId },
          status: { not: INVOICE_STATUS.CANCELLED },
        },
      }),
    ]);
    return approved > 0 || live > 0;
  }
}
