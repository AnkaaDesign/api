// api/src/modules/production/budget/repositories/budget-prisma.repository.ts

import { Injectable, Logger } from '@nestjs/common';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { allocateBudgetNumber } from '../../../../utils/budget-number';
import { BudgetRepository } from './budget.repository';
import {
  QUOTE_TASKS_ORDER_BY,
  QUOTE_BILLING_INCLUDE,
  withCoverageInclude,
} from '@utils/quote-tasks';
import {
  QUOTE_LAYOUT_FILES_INCLUDE,
  withLayoutCoverageInclude,
} from '@utils/quote-layout-coverage';

/** A ordem canônica das tarefas de um orçamento — ver `QUOTE_TASKS_ORDER_BY`. */
const TASK_ORDER = QUOTE_TASKS_ORDER_BY;
import type {
  Budget,
  BudgetInclude,
  BudgetOrderBy,
  BudgetWhere,
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '@types';
import type { BudgetCreateFormData, BudgetUpdateFormData } from '@schemas/budget';
import { TASK_QUOTE_STATUS, TASK_QUOTE_STATUS_ORDER } from '@constants';
import { Budget as PrismaBudget, Prisma } from '@prisma/client';

/**
 * Prisma implementation of BudgetRepository
 */
/**
 * A FILA, como último critério — sempre.
 *
 * `queueRank` é coluna GERADA: o instante de criação em segundos, negado para
 * APPROVED e CANCELLED. Ascendente, ela dá pendente mais ANTIGO primeiro e
 * aprovado mais RECENTE primeiro, que é a leitura que a casa pediu.
 */
export const BUDGET_QUEUE_TIEBREAKER = { queueRank: 'asc' as const };
export const BUDGET_QUEUE_ORDER = [{ statusOrder: 'asc' as const }, BUDGET_QUEUE_TIEBREAKER];

export function withQueueTiebreaker(orderBy: any): any {
  // Entrada vazia (`{}`) é o que sobra quando o zod descarta uma chave que o
  // `orderBy` não declara — ex.: `{task: {term: 'asc'}}`. O Prisma não sabe o
  // que fazer com ela, então sai daqui.
  const clean = (entry: any): any | null =>
    entry && typeof entry === 'object' && Object.keys(entry).length === 0 ? null : entry;

  const hasQueueKey = (es: any[]) => es.some(e => e && typeof e === 'object' && 'queueRank' in e);

  // Anexar sempre é o que torna a PAGINAÇÃO estável: sem uma última chave
  // praticamente única, duas linhas de mesmo valor trocam de lugar entre uma
  // página e outra, e a página 2 repete uma linha e some com outra. Dentro de
  // "pendente", só `statusOrder` deixaria o Postgres devolver a ordem física do
  // heap, que muda a cada UPDATE.
  if (Array.isArray(orderBy)) {
    const kept = orderBy.map(clean).filter((e): e is object => e !== null);
    if (kept.length === 0) return BUDGET_QUEUE_ORDER;
    return hasQueueKey(kept) ? kept : [...kept, BUDGET_QUEUE_TIEBREAKER];
  }

  const single = clean(orderBy);
  if (!single) return BUDGET_QUEUE_ORDER;
  return hasQueueKey([single]) ? single : [single, BUDGET_QUEUE_TIEBREAKER];
}

@Injectable()
export class BudgetPrismaRepository
  extends BaseStringPrismaRepository<
    Budget,
    BudgetCreateFormData,
    BudgetUpdateFormData,
    BudgetInclude,
    BudgetOrderBy,
    BudgetWhere,
    PrismaBudget,
    Prisma.BudgetCreateInput,
    Prisma.BudgetUpdateInput,
    Prisma.BudgetInclude,
    Prisma.BudgetOrderByWithRelationInput,
    Prisma.BudgetWhereInput
  >
  implements BudgetRepository
{
  protected readonly logger = new Logger(BudgetPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): Budget {
    return {
      ...databaseEntity,
      total: databaseEntity.total ? Number(databaseEntity.total) : 0,
      // ⚠️ `subtotal` FALTAVA na conversão, e só ele.
      //
      // `Decimal` do Prisma serializa como STRING no JSON, e o tipo `Budget`
      // declara `number`. A lista de Orçamentos nunca consumiu esta rota (ela
      // lia tarefas), então a divergência nunca apareceu — e apareceria como uma
      // coluna de dinheiro ordenando por texto, "R$ 9.000,00" antes de
      // "R$ 10.000,00", que é o tipo de defeito que se lê como "a tabela está
      // errada" e não como "o tipo está errado".
      subtotal: databaseEntity.subtotal ? Number(databaseEntity.subtotal) : 0,
      services: databaseEntity.services?.map((service: any) => ({
        ...service,
        amount: service.amount ? Number(service.amount) : 0,
      })),
      // Pass through customerConfigs data if present
      customerConfigs: databaseEntity.customerConfigs?.map((config: any) => ({
        ...config,
        subtotal: config.subtotal ? Number(config.subtotal) : 0,
        total: config.total ? Number(config.total) : 0,
        discountValue: config.discountValue ? Number(config.discountValue) : null,
        installments: config.installments?.map((inst: any) => ({
          ...inst,
          amount: inst.amount ? Number(inst.amount) : 0,
          paidAmount: inst.paidAmount ? Number(inst.paidAmount) : 0,
        })),
      })),
    } as Budget;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: BudgetCreateFormData,
  ): Prisma.BudgetCreateInput {
    const createInput: Prisma.BudgetCreateInput = {
      // budgetNumber is set to 0 as placeholder - will be replaced at runtime in createWithTransaction
      budgetNumber: 0,
      subtotal: formData.subtotal || 0,
      total: formData.total || 0,
      expiresAt: formData.expiresAt || new Date(),
      status: (formData.status as any) || TASK_QUOTE_STATUS.PENDING,
      statusOrder:
        TASK_QUOTE_STATUS_ORDER[
          (formData.status || TASK_QUOTE_STATUS.PENDING) as TASK_QUOTE_STATUS
        ] ?? 8,
      // Guarantee Terms
      guaranteeYears: formData.guaranteeYears || null,
      customGuaranteeText: formData.customGuaranteeText || null,
      // Layout Files (max 2). NOTE: this raw connect does NOT clone foreign
      // Files — it would steal ownership (FK lives on File). It is currently
      // unreached (controller routes create/update to BudgetService's inline
      // transaction, which clones via resolveLayoutFileIdsForQuote). Do NOT wire
      // this mapper to user input without routing ids through that resolver.
      ...(formData.layoutFileIds !== undefined && {
        layoutFiles: {
          connect: (formData.layoutFileIds ?? []).map((id: string) => ({ id })),
        },
      }),
      // New fields
      simultaneousTasks: (formData as any).simultaneousTasks || null,
      customForecastDays: (formData as any).customForecastDays || null,
      // Task will be connected separately via one-to-one relationship (Task.quoteId FK)
    };

    // ─── OS PAGADORES NÃO CABEM NESTE MAPEADOR ───────────────────────
    //
    // Aqui havia um `customerConfigs: { create: [...] }` aninhado no
    // `budget.create`. Essa é a forma de ANTES de o faturamento existir como
    // entidade: hoje `BudgetPayer.billingId` é OBRIGATÓRIO, o pagador mora
    // dentro de um `Billing`, e o `Billing` precisa declarar quais veículos
    // cobre — veículos que, na criação, ainda não existem quando este mapeador
    // roda. O Prisma respondia "Argument `billing` is missing" e derrubava a
    // gravação inteira em 500. Foi exatamente esse o defeito que a criação de
    // tarefa a partir do histórico sofreu em `task-prisma.repository.ts`.
    //
    // Um mapeador síncrono que devolve UM `BudgetCreateInput` não tem como
    // exprimir isso: faturamento, cobertura e pagador são três gravações
    // ordenadas, e a do meio depende de tarefas que nascem depois. Quem sabe
    // fazê-lo é `reconcileQuoteCustomerConfigs`, chamado DEPOIS do vínculo com
    // as tarefas — é o que a transação inline de `BudgetService` faz, e por
    // isso ela, e não este mapeador, é o caminho do controller.
    //
    // Recusar é deliberado, e em voz alta: engolir as fatias em silêncio criaria
    // um orçamento sem pagador — sem fatura, sem boleto, sem cerimônia de
    // assinatura — que só apareceria lá na frente, no faturamento vazio.
    if ((formData as any).customerConfigs && (formData as any).customerConfigs.length > 0) {
      throw new Error(
        'BudgetPrismaRepository.mapCreateFormDataToDatabaseCreateInput não cria pagadores: ' +
          '`BudgetPayer` exige um `Billing`, que exige a cobertura de tarefas. ' +
          'Use a transação de criação de `BudgetService` (que chama ' +
          '`reconcileQuoteCustomerConfigs` após vincular as tarefas).',
      );
    }

    // Handle services if provided
    if (formData.services && formData.services.length > 0) {
      (createInput as any).services = {
        create: formData.services.map((service, index) => ({
          amount: service.amount || 0,
          description: service.description || '',
          observation: service.observation || null,
          position: index,
          ...((service as any).invoiceToCustomerId && {
            invoiceToCustomer: { connect: { id: (service as any).invoiceToCustomerId } },
          }),
        })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: BudgetUpdateFormData,
  ): Prisma.BudgetUpdateInput {
    const updateInput: Prisma.BudgetUpdateInput = {};

    if (formData.subtotal !== undefined) updateInput.subtotal = formData.subtotal;
    if (formData.total !== undefined) updateInput.total = formData.total;
    if (formData.expiresAt !== undefined) updateInput.expiresAt = formData.expiresAt;
    if (formData.status !== undefined) {
      updateInput.status = formData.status as any;
      updateInput.statusOrder = TASK_QUOTE_STATUS_ORDER[formData.status as TASK_QUOTE_STATUS];
    }

    // Guarantee Terms
    if (formData.guaranteeYears !== undefined) updateInput.guaranteeYears = formData.guaranteeYears;
    if (formData.customGuaranteeText !== undefined)
      updateInput.customGuaranteeText = formData.customGuaranteeText;

    // Layout Files (max 2) — `set` replaces the relation wholesale ([] clears).
    // NOTE: this raw set does NOT clone foreign Files — it would steal ownership
    // (FK lives on File). It is currently unreached (controller routes create/
    // update to BudgetService's inline transaction, which clones via
    // resolveLayoutFileIdsForQuote). Do NOT wire this mapper to user input
    // without routing ids through that resolver.
    if (formData.layoutFileIds !== undefined) {
      updateInput.layoutFiles = {
        set: (formData.layoutFileIds ?? []).map((id: string) => ({ id })),
      };
    }

    // New fields
    if ((formData as any).simultaneousTasks !== undefined)
      updateInput.simultaneousTasks = (formData as any).simultaneousTasks;
    if ((formData as any).customForecastDays !== undefined)
      updateInput.customForecastDays = (formData as any).customForecastDays;

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: BudgetInclude,
  ): Prisma.BudgetInclude | undefined {
    if (!include) return undefined;

    const mappedInclude: Prisma.BudgetInclude = {};

    if (include.services !== undefined) {
      mappedInclude.services =
        include.services === true
          ? {
              orderBy: { position: 'asc' as const },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            }
          : include.services;
    }
    // A ordem canônica das tarefas é imposta aqui, não pelo cliente.
    const requestedTaskInclude = include.tasks;
    if (requestedTaskInclude !== undefined) {
      // ⚠️ O `select` TAMBÉM PASSA. Só `include` era repassado, e um `select`
      // chegava aqui para ser DESCARTADO em silêncio: o Prisma devolvia todos os
      // escalares (por isso "quase funcionava") e nenhuma relação. A lista de
      // Orçamentos do app pede `tasks: { select: { …, truck: { select: { plate } } } }`
      // justamente para não trazer o veículo inteiro, e o caminhão não voltava —
      // a coluna IDENTIFICADOR, que recua de `serialNumber` para a placa, ficava
      // vazia em todo veículo sem número de série.
      //
      // `select` e `include` são mutuamente exclusivos no Prisma, então é um ou
      // outro, com o `select` tendo precedência por ser o mais específico.
      mappedInclude.tasks =
        typeof requestedTaskInclude === 'boolean'
          ? { orderBy: TASK_ORDER }
          : (requestedTaskInclude as any).select
            ? { orderBy: TASK_ORDER, select: (requestedTaskInclude as any).select }
            : { orderBy: TASK_ORDER, include: requestedTaskInclude.include as any };
    }
    // A COBERTURA DE CADA ARTE ENTRA SEMPRE — gêmea da injeção de `billing`
    // logo abaixo. `layoutFiles: true` é o que toda tela manda, e sem a
    // injeção o layout por veículo chegaria sem dizer de quem é cada arte.
    if ((include as any).layoutFiles !== undefined)
      mappedInclude.layoutFiles = withLayoutCoverageInclude((include as any).layoutFiles) as any;
    if ((include as any).customerConfigs !== undefined) {
      // A COBERTURA ENTRA SEMPRE, seja qual for a forma que o chamador pediu.
      // Ver `withCoverageInclude`: uma fatura que chega à tela sem a cobertura é
      // uma fatura sem resposta para "de quais veículos é isto?".
      mappedInclude.customerConfigs = withCoverageInclude(
        (include as any).customerConfigs === true
          ? {
              include: {
                customer: {
                  select: {
                    id: true,
                    fantasyName: true,
                    corporateName: true,
                    cnpj: true,
                    cpf: true,
                    address: true,
                    addressNumber: true,
                    addressComplement: true,
                    neighborhood: true,
                    city: true,
                    state: true,
                    zipCode: true,
                    stateRegistration: true,
                    streetType: true,
                  },
                },
              },
            }
          : (include as any).customerConfigs,
      ) as any;
    }

    return mappedInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: BudgetOrderBy,
  ): Prisma.BudgetOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;
    return withQueueTiebreaker(orderBy) as any;
  }

  protected mapWhereToDatabaseWhere(
    where?: BudgetWhere,
  ): Prisma.BudgetWhereInput | undefined {
    if (!where) return undefined;
    return where as any;
  }

  protected getDefaultInclude(): Prisma.BudgetInclude | undefined {
    return {
      services: {
        orderBy: { position: 'asc' },
        include: {
          invoiceToCustomer: {
            select: { id: true, fantasyName: true, cnpj: true },
          },
        },
      },
      customerConfigs: {
        include: {
          billing: QUOTE_BILLING_INCLUDE,
          customer: {
            select: { id: true, fantasyName: true, cnpj: true },
          },
          installments: {
            include: {
              bankSlip: true,
            },
            orderBy: { number: 'asc' },
          },
          // `invoices` (plural) porque o banco sempre permitiu a viva MAIS as
          // canceladas dos ciclos anteriores. Sem filtro aqui de propósito: a tela
          // de faturamento precisa mostrar o ciclo anterior ao lado do vigente.
          invoices: {
            orderBy: { createdAt: 'asc' },
            include: {
              nfseDocuments: true,
            },
          },
        },
      },
    };
  }

  // Create with transaction
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: BudgetCreateFormData,
    options?: CreateOptions<BudgetInclude>,
  ): Promise<Budget> {
    const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    // Generate budgetNumber - required field that must be auto-generated
    // (advisory-locked; the bare MAX+1 read raced itself into P2002 under concurrency)
    const nextBudgetNumber = await allocateBudgetNumber(transaction);

    // Inject budgetNumber into create input
    (createInput as any).budgetNumber = nextBudgetNumber;

    const created = await transaction.budget.create({
      data: createInput,
      include,
    });

    return this.mapDatabaseEntityToEntity(created);
  }

  // Update with transaction
  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: BudgetUpdateFormData,
    options?: UpdateOptions<BudgetInclude>,
  ): Promise<Budget> {
    const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const updated = await transaction.budget.update({
      where: { id },
      data: updateInput,
      include,
    });

    return this.mapDatabaseEntityToEntity(updated);
  }

  // Find many with transaction
  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<BudgetOrderBy, BudgetWhere, BudgetInclude>,
  ): Promise<FindManyResult<Budget>> {
    const where = this.mapWhereToDatabaseWhere(options?.where);
    const orderBy = this.mapOrderByToDatabaseOrderBy(options?.orderBy);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const [data, total] = await Promise.all([
      transaction.budget.findMany({
        where,
        orderBy,
        include,
        skip: options?.skip,
        take: options?.take,
      }),
      transaction.budget.count({ where }),
    ]);

    const take = options?.take || 10;
    const page = options?.skip ? Math.floor(options.skip / take) + 1 : 1;
    const totalPages = Math.ceil(total / take);

    return {
      data: data.map(item => this.mapDatabaseEntityToEntity(item)),
      meta: {
        totalRecords: total,
        page,
        take,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // Find one by ID with transaction
  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: { include?: BudgetInclude },
  ): Promise<Budget | null> {
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const found = await transaction.budget.findUnique({
      where: { id },
      include,
    });

    return found ? this.mapDatabaseEntityToEntity(found) : null;
  }

  // Delete with transaction
  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Budget> {
    const deleted = await transaction.budget.delete({
      where: { id },
      include: this.getDefaultInclude(),
    });
    return this.mapDatabaseEntityToEntity(deleted);
  }

  // Find by IDs with transaction
  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: BudgetInclude },
  ): Promise<Budget[]> {
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const found = await transaction.budget.findMany({
      where: { id: { in: ids } },
      include,
    });

    return found.map(item => this.mapDatabaseEntityToEntity(item));
  }

  // Count with transaction
  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: BudgetWhere,
  ): Promise<number> {
    const databaseWhere = this.mapWhereToDatabaseWhere(where);
    return transaction.budget.count({ where: databaseWhere });
  }

  /**
   * Find quote by task ID (with services)
   */
  async findByTaskId(taskId: string): Promise<Budget | null> {
    const quote = await this.prisma.budget.findFirst({
      where: { tasks: { some: { id: taskId } } },
      include: {
        // TODAS as tarefas do orçamento, não só aquela por onde se entrou.
        //
        // A tela de Orçamento é aberta pelo `taskId` de UM veículo, mas o que
        // ela edita é o orçamento — e o orçamento cobre N. Sem esta lista a tela
        // não tem como saber que são sessenta: o seletor "junto ou separado"
        // some (a contagem daria 1) e não há como trocar `JOINT` por `PER_TASK`
        // depois que o erro aparece no faturamento.
        tasks: {
          orderBy: TASK_ORDER,
          select: {
            id: true,
            name: true,
            serialNumber: true,
            status: true,
            createdAt: true,
            term: true,
            forecastDate: true,
            // O pedido de compra é do VEÍCULO. Fora deste `select` a tela de
            // Orçamento abriria o campo em branco e o gravaria por cima do que o
            // cliente já tinha informado.
            customerOrderNumber: true,
            // Categoria e implemento junto: a relação de veículos do Resumo tem
            // as MESMAS colunas do documento e da página pública, e sem estes
            // dois campos ela sairia com duas colunas a menos que o PDF que o
            // cliente vai receber — a conferência deixaria de ser a mesma.
            truck: {
              select: {
                id: true,
                plate: true,
                chassisNumber: true,
                category: true,
                implementType: true,
              },
            },
          },
        },
        // As artes COM a cobertura de cada uma: é esta a leitura da tela de
        // Orçamento, e é nela que o layout se atribui veículo a veículo.
        // (`layoutScope` vem sozinho — é escalar, e este é um `include`.)
        layoutFiles: QUOTE_LAYOUT_FILES_INCLUDE,
        services: {
          orderBy: { position: 'asc' },
          include: {
            invoiceToCustomer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
          },
        },
        customerConfigs: {
          include: {
            billing: QUOTE_BILLING_INCLUDE,
            customer: {
              select: {
                id: true,
                fantasyName: true,
                corporateName: true,
                cnpj: true,
                cpf: true,
                address: true,
                addressNumber: true,
                addressComplement: true,
                neighborhood: true,
                city: true,
                state: true,
                zipCode: true,
                stateRegistration: true,
                streetType: true,
              },
            },
            installments: {
              orderBy: { number: 'asc' },
            },
          },
        },
      },
    });

    return quote ? this.mapDatabaseEntityToEntity(quote) : null;
  }

  /**
   * Find all quotes by status
   */
  async findByStatus(status: string): Promise<Budget[]> {
    const quotes = await this.prisma.budget.findMany({
      where: { status: status as any },
      include: {
        services: {
          orderBy: { position: 'asc' },
          include: {
            invoiceToCustomer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
          },
        },
        tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        customerConfigs: {
          include: {
            billing: QUOTE_BILLING_INCLUDE,
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return quotes.map(q => this.mapDatabaseEntityToEntity(q));
  }

  /**
   * Os orçamentos que passaram da validade e ainda esperam alguma coisa.
   *
   * A VALIDADE É A JANELA EM QUE A PROPOSTA PODE SER ACEITA, e só isso — por
   * isso a lista encolheu:
   *   - `SIGNED` sai: o cliente aceitou dentro do prazo e o relógio parou. O que
   *     falta é a contra-assinatura da Ankaa, atraso NOSSO (ver
   *     `SignatureExpiryScheduler`).
   *   - `APPROVED` sai: é o ÚLTIMO estado do orçamento, negócio fechado. Vencer
   *     a validade de um contrato fechado não quer dizer nada.
   *   - o que era `BILLING_APPROVED` sai por não existir mais: cobrança vencida
   *     é `BILLING_STATUS.OVERDUE`, mora em `Billing` e se consulta por lá.
   * Fica `PENDING` (passou do prazo sem todas as assinaturas) e `EXPIRED` (a
   * varredura já marcou e o comercial ainda não reanalisou).
   */
  async findExpired(): Promise<Budget[]> {
    const now = new Date();
    const quotes = await this.prisma.budget.findMany({
      where: {
        expiresAt: { lt: now },
        status: {
          in: [TASK_QUOTE_STATUS.PENDING, TASK_QUOTE_STATUS.EXPIRED],
        },
      },
      include: {
        services: {
          orderBy: { position: 'asc' },
          include: {
            invoiceToCustomer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
          },
        },
        tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        customerConfigs: {
          include: {
            billing: QUOTE_BILLING_INCLUDE,
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
          },
        },
      },
    });

    return quotes.map(q => this.mapDatabaseEntityToEntity(q));
  }

  /**
   * O orçamento de um veículo cuja COBRANÇA já foi aprovada.
   *
   * "Aprovado" aqui sempre quis dizer FATURAMENTO aprovado — a lista era
   * `BILLING_APPROVED`..`SETTLED`, cinco estados que hoje são um só fato do
   * `Billing`: ter `approvedAt`. E a pergunta é do VEÍCULO, não do contrato: num
   * orçamento de sessenta caminhões faturados um a um, o caminhão 7 pode estar
   * cobrado e o 8 não. Por isso a condição é sobre a cobrança QUE COBRE ESTA
   * TAREFA, e não sobre qualquer cobrança do orçamento.
   */
  async findApprovedByTaskId(taskId: string): Promise<Budget | null> {
    const quote = await this.prisma.budget.findFirst({
      where: {
        tasks: { some: { id: taskId } },
        billings: {
          some: {
            approvedAt: { not: null },
            tasks: { some: { taskId } },
          },
        },
      },
      include: {
        services: {
          orderBy: { position: 'asc' },
          include: {
            invoiceToCustomer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
          },
        },
        customerConfigs: {
          include: {
            billing: QUOTE_BILLING_INCLUDE,
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
          },
        },
      },
    });

    return quote ? this.mapDatabaseEntityToEntity(quote) : null;
  }

  /**
   * Find the most recent quote matching task name, customerId, truck category, and implement type.
   * Tries exact name match first (case-insensitive), then falls back to startsWith.
   * Customer, category, and implementType must always match exactly.
   */
  async findSuggestion(params: {
    name: string;
    customerId: string;
    category: string;
    implementType: string;
  }): Promise<(any & { taskCreatedAt: Date }) | null> {
    const baseWhere = {
      customerId: params.customerId,
      truck: {
        category: params.category as any,
        implementType: params.implementType as any,
      },
    };

    const includeClause = {
      services: {
        orderBy: { position: 'asc' } as const,
        include: {
          invoiceToCustomer: {
            select: { id: true, fantasyName: true, cnpj: true },
          },
        },
      },
      tasks: {
        orderBy: TASK_ORDER,
        select: { id: true, name: true, createdAt: true },
      },
    };

    // 1. Try exact match (case-insensitive)
    let quote = await this.prisma.budget.findFirst({
      where: {
        tasks: { some: { ...baseWhere, name: { equals: params.name, mode: 'insensitive' } } },
      },
      include: includeClause,
      orderBy: { createdAt: 'desc' },
    });

    // 2. Fallback: startsWith (case-insensitive) — e.g. "Martini" matches "Martini Frutas"
    if (!quote) {
      quote = await this.prisma.budget.findFirst({
        where: {
          tasks: { some: { ...baseWhere, name: { startsWith: params.name, mode: 'insensitive' } } },
        },
        include: includeClause,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!quote) return null;

    const mapped = this.mapDatabaseEntityToEntity(quote);
    return {
      ...mapped,
      taskCreatedAt: quote.tasks?.[0]?.createdAt || quote.createdAt,
    };
  }
}
