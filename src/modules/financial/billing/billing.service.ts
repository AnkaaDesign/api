import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { INVOICE_STATUS } from '@constants';

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
      data: { ...billing, siblings },
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
      data,
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
    customerId?: string;
    /** `true` = já faturados; `false` = a faturar; ausente = ambos. */
    approved?: boolean;
    /** Só os que têm todos os veículos concluídos — a fila do financeiro. */
    deliveredOnly?: boolean;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 40));

    const where: Record<string, unknown> = {};
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

    const [data, totalRecords] = await Promise.all([
      (this.prisma as any).billing.findMany({
        where,
        orderBy: [{ approvedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: BillingService.DETAIL_INCLUDE,
      }),
      (this.prisma as any).billing.count({ where }),
    ]);

    return {
      success: true,
      message: `${totalRecords} faturamento(s).`,
      data,
      meta: {
        totalRecords,
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit) || 1,
        hasNextPage: page * limit < totalRecords,
      },
    };
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
