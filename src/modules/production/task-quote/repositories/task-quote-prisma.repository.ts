// api/src/modules/production/task-quote/repositories/task-quote-prisma.repository.ts

import { Injectable, Logger } from '@nestjs/common';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { allocateBudgetNumber } from '../../../../utils/budget-number';
import { TaskQuoteRepository } from './task-quote.repository';
import { QUOTE_TASKS_ORDER_BY } from '@utils/quote-tasks';

/** A ordem canônica das tarefas de um orçamento — ver `QUOTE_TASKS_ORDER_BY`. */
const TASK_ORDER = QUOTE_TASKS_ORDER_BY;
import type {
  TaskQuote,
  TaskQuoteInclude,
  TaskQuoteOrderBy,
  TaskQuoteWhere,
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
} from '@types';
import type { TaskQuoteCreateFormData, TaskQuoteUpdateFormData } from '@schemas/task-quote';
import { TASK_QUOTE_STATUS, TASK_QUOTE_STATUS_ORDER } from '@constants';
import { TaskQuote as PrismaTaskQuote, Prisma } from '@prisma/client';

/**
 * Prisma implementation of TaskQuoteRepository
 */
/**
 * Traduz o filtro to-one `task` — a forma anterior ao orçamento multitarefa —
 * para a relação de LISTA `tasks`.
 *
 * POR QUE EXISTE. `Task.quoteId` deixou de ser `@unique`, então
 * `TaskQuoteWhereInput.task` não existe mais: mandá-lo ao Prisma derruba a
 * consulta inteira com "Unknown argument `task`". E o `where` chega aqui como
 * `Record<string, unknown>` — o `tsc` não vê nada. Quem ainda manda a chave
 * antiga é o app instalado nos aparelhos, que não se atualiza no mesmo instante
 * que a API; recusar a consulta deixaria a lista de Orçamentos vazia em campo.
 *
 * A tradução é `some`: "existe uma tarefa do orçamento que casa". Com um veículo
 * é exatamente a consulta de antes; com sessenta, é a única leitura útil —
 * procurar pela série de qualquer um dos caminhões tem de achar o orçamento.
 *
 * Recorre por `AND`/`OR`/`NOT` porque é lá que os filtros compostos da lista
 * montam suas condições, e uma chave `task` escondida dentro de um `OR` estoura
 * do mesmo jeito que no topo.
 */
export function translateLegacyTaskFilter(where: any): any {
  if (!where || typeof where !== 'object') return where;
  if (Array.isArray(where)) return where.map(translateLegacyTaskFilter);

  const out: any = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      out[key] = translateLegacyTaskFilter(value);
      continue;
    }
    if (key !== 'task') {
      out[key] = value;
      continue;
    }
    // Cliente que manda as DUAS formas: a corrente vence. Mesclar dois `some`
    // seria adivinhar (um `AND` ou um `OR`?), e sobrescrever com a legada
    // desfaria o filtro que o cliente novo quis.
    if ('tasks' in where) continue;

    // `task: null` — "orçamento SEM tarefa". No to-many é `none: {}`.
    if (value === null || value === undefined) {
      out.tasks = { none: {} };
      continue;
    }
    if (typeof value !== 'object') continue;

    const v = value as Record<string, unknown>;
    if ('is' in v || 'isNot' in v) {
      // `isNot: null` era "tem tarefa" ⇒ `some: {}`. `is: null` era "não tem"
      // ⇒ `none: {}`. Com um objeto, `is` vira `some` e `isNot` vira `none`.
      if ('is' in v) out.tasks = v.is === null ? { none: {} } : { some: v.is as object };
      if ('isNot' in v) {
        const asNone = v.isNot === null ? { some: {} } : { none: v.isNot as object };
        out.tasks = { ...(out.tasks as object), ...asNone };
      }
      continue;
    }
    // Nested where direto (ex.: `{ id }`, `{ status }`).
    out.tasks = { some: v };
  }
  return out;
}

/**
 * Remove as entradas de ordenação por campo da TAREFA.
 *
 * O Prisma não ordena um pai por campo de relação de lista, e não existe
 * resposta certa a inventar: num orçamento de sessenta caminhões, qual dos
 * sessenta prazos ordenaria a linha? O app instalado manda
 * `[{statusOrder:'asc'},{task:{term:'asc'}}]`; descartar a segunda entrada
 * degrada a ordenação, mandá-la ao banco derruba a tela. Ordenações por campo
 * do próprio orçamento (`budgetNumber`, `createdAt`, `expiresAt`) passam
 * intactas, e é para elas que os clientes novos apontam.
 */
export function stripUnorderableTaskEntries(orderBy: any): any {
  const clean = (entry: any): any | null => {
    if (!entry || typeof entry !== 'object') return entry;
    const { task: _dropped, ...rest } = entry as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : null;
  };
  if (Array.isArray(orderBy)) {
    const kept = orderBy.map(clean).filter((e): e is object => e !== null);
    return kept.length > 0 ? kept : undefined;
  }
  return clean(orderBy) ?? undefined;
}

@Injectable()
export class TaskQuotePrismaRepository
  extends BaseStringPrismaRepository<
    TaskQuote,
    TaskQuoteCreateFormData,
    TaskQuoteUpdateFormData,
    TaskQuoteInclude,
    TaskQuoteOrderBy,
    TaskQuoteWhere,
    PrismaTaskQuote,
    Prisma.TaskQuoteCreateInput,
    Prisma.TaskQuoteUpdateInput,
    Prisma.TaskQuoteInclude,
    Prisma.TaskQuoteOrderByWithRelationInput,
    Prisma.TaskQuoteWhereInput
  >
  implements TaskQuoteRepository
{
  protected readonly logger = new Logger(TaskQuotePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): TaskQuote {
    return {
      ...databaseEntity,
      total: databaseEntity.total ? Number(databaseEntity.total) : 0,
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
    } as TaskQuote;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: TaskQuoteCreateFormData,
  ): Prisma.TaskQuoteCreateInput {
    const createInput: Prisma.TaskQuoteCreateInput = {
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
      // unreached (controller routes create/update to TaskQuoteService's inline
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

    // Handle customerConfigs
    if ((formData as any).customerConfigs && (formData as any).customerConfigs.length > 0) {
      (createInput as any).customerConfigs = {
        create: (formData as any).customerConfigs.map((config: any) => ({
          customer: { connect: { id: config.customerId } },
          subtotal: config.subtotal || 0,
          total: config.total || 0,
          discountType: config.discountType || 'NONE',
          discountValue: config.discountValue ?? null,
          discountReference: config.discountReference ?? null,
          customPaymentText: config.customPaymentText || null,
          generateInvoice: config.generateInvoice !== undefined ? config.generateInvoice : true,
          generateBankSlip: config.generateBankSlip !== undefined ? config.generateBankSlip : true,
          orderNumber: config.orderNumber || null,
          paymentCondition: config.paymentCondition || null,
          paymentConfig: (config as any).paymentConfig ?? null,
          responsibleId: config.responsibleId || null,
        })),
      };
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
    formData: TaskQuoteUpdateFormData,
  ): Prisma.TaskQuoteUpdateInput {
    const updateInput: Prisma.TaskQuoteUpdateInput = {};

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
    // update to TaskQuoteService's inline transaction, which clones via
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
    include?: TaskQuoteInclude,
  ): Prisma.TaskQuoteInclude | undefined {
    if (!include) return undefined;

    const mappedInclude: Prisma.TaskQuoteInclude = {};

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
    // `include: { task: … }` do cliente é traduzido para a relação de LISTA.
    //
    // A chave `task` continua aceita de propósito: ela vem do app Flutter
    // instalado nos aparelhos e do `kTaskQuoteDetailInclude` gravado em cache, e
    // recusá-la faria a tela de detalhe do orçamento voltar sem tarefa nenhuma.
    // A ordem canônica é imposta aqui, não pelo cliente.
    const requestedTaskInclude = (include as any).tasks ?? (include as any).task;
    if (requestedTaskInclude !== undefined) {
      mappedInclude.tasks =
        typeof requestedTaskInclude === 'boolean'
          ? { orderBy: TASK_ORDER }
          : { orderBy: TASK_ORDER, include: requestedTaskInclude.include as any };
    }
    if ((include as any).layoutFiles !== undefined)
      mappedInclude.layoutFiles = (include as any).layoutFiles;
    if ((include as any).customerConfigs !== undefined) {
      mappedInclude.customerConfigs =
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
                responsible: {
                  select: { id: true, name: true, roles: true },
                },
              },
            }
          : (include as any).customerConfigs;
    }

    return mappedInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: TaskQuoteOrderBy,
  ): Prisma.TaskQuoteOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;
    return stripUnorderableTaskEntries(orderBy) as any;
  }

  protected mapWhereToDatabaseWhere(
    where?: TaskQuoteWhere,
  ): Prisma.TaskQuoteWhereInput | undefined {
    if (!where) return undefined;
    return translateLegacyTaskFilter(where) as any;
  }

  protected getDefaultInclude(): Prisma.TaskQuoteInclude | undefined {
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
          customer: {
            select: { id: true, fantasyName: true, cnpj: true },
          },
          responsible: {
            select: { id: true, name: true, roles: true },
          },
          installments: {
            include: {
              bankSlip: true,
            },
            orderBy: { number: 'asc' },
          },
          invoice: {
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
    data: TaskQuoteCreateFormData,
    options?: CreateOptions<TaskQuoteInclude>,
  ): Promise<TaskQuote> {
    const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    // Generate budgetNumber - required field that must be auto-generated
    // (advisory-locked; the bare MAX+1 read raced itself into P2002 under concurrency)
    const nextBudgetNumber = await allocateBudgetNumber(transaction);

    // Inject budgetNumber into create input
    (createInput as any).budgetNumber = nextBudgetNumber;

    const created = await transaction.taskQuote.create({
      data: createInput,
      include,
    });

    return this.mapDatabaseEntityToEntity(created);
  }

  // Update with transaction
  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: TaskQuoteUpdateFormData,
    options?: UpdateOptions<TaskQuoteInclude>,
  ): Promise<TaskQuote> {
    const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const updated = await transaction.taskQuote.update({
      where: { id },
      data: updateInput,
      include,
    });

    return this.mapDatabaseEntityToEntity(updated);
  }

  // Find many with transaction
  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<TaskQuoteOrderBy, TaskQuoteWhere, TaskQuoteInclude>,
  ): Promise<FindManyResult<TaskQuote>> {
    const where = this.mapWhereToDatabaseWhere(options?.where);
    const orderBy = this.mapOrderByToDatabaseOrderBy(options?.orderBy);
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const [data, total] = await Promise.all([
      transaction.taskQuote.findMany({
        where,
        orderBy,
        include,
        skip: options?.skip,
        take: options?.take,
      }),
      transaction.taskQuote.count({ where }),
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
    options?: { include?: TaskQuoteInclude },
  ): Promise<TaskQuote | null> {
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const found = await transaction.taskQuote.findUnique({
      where: { id },
      include,
    });

    return found ? this.mapDatabaseEntityToEntity(found) : null;
  }

  // Delete with transaction
  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<TaskQuote> {
    const deleted = await transaction.taskQuote.delete({
      where: { id },
      include: this.getDefaultInclude(),
    });
    return this.mapDatabaseEntityToEntity(deleted);
  }

  // Find by IDs with transaction
  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: TaskQuoteInclude },
  ): Promise<TaskQuote[]> {
    const include = this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

    const found = await transaction.taskQuote.findMany({
      where: { id: { in: ids } },
      include,
    });

    return found.map(item => this.mapDatabaseEntityToEntity(item));
  }

  // Count with transaction
  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: TaskQuoteWhere,
  ): Promise<number> {
    const databaseWhere = this.mapWhereToDatabaseWhere(where);
    return transaction.taskQuote.count({ where: databaseWhere });
  }

  /**
   * Find quote by task ID (with services)
   */
  async findByTaskId(taskId: string): Promise<TaskQuote | null> {
    const quote = await this.prisma.taskQuote.findFirst({
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
            truck: { select: { id: true, plate: true, chassisNumber: true } },
          },
        },
        layoutFiles: { orderBy: { createdAt: 'asc' } },
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
            responsible: {
              select: { id: true, name: true, roles: true },
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
  async findByStatus(status: string): Promise<TaskQuote[]> {
    const quotes = await this.prisma.taskQuote.findMany({
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
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
            responsible: {
              select: { id: true, name: true, roles: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return quotes.map(q => this.mapDatabaseEntityToEntity(q));
  }

  /**
   * Find expired quotes (expiresAt < now)
   */
  async findExpired(): Promise<TaskQuote[]> {
    const now = new Date();
    const quotes = await this.prisma.taskQuote.findMany({
      where: {
        expiresAt: { lt: now },
        status: {
          in: [
            TASK_QUOTE_STATUS.PENDING,
            TASK_QUOTE_STATUS.BUDGET_APPROVED,
            TASK_QUOTE_STATUS.BILLING_APPROVED,
          ],
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
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
            responsible: {
              select: { id: true, name: true, roles: true },
            },
          },
        },
      },
    });

    return quotes.map(q => this.mapDatabaseEntityToEntity(q));
  }

  /**
   * Find approved quote for a task
   */
  async findApprovedByTaskId(taskId: string): Promise<TaskQuote | null> {
    const quote = await this.prisma.taskQuote.findFirst({
      where: {
        tasks: { some: { id: taskId } },
        status: {
          in: [
            TASK_QUOTE_STATUS.BILLING_APPROVED,
            TASK_QUOTE_STATUS.UPCOMING,
            TASK_QUOTE_STATUS.DUE,
            TASK_QUOTE_STATUS.PARTIAL,
            TASK_QUOTE_STATUS.SETTLED,
          ],
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
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
            responsible: {
              select: { id: true, name: true, roles: true },
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
    let quote = await this.prisma.taskQuote.findFirst({
      where: {
        tasks: { some: { ...baseWhere, name: { equals: params.name, mode: 'insensitive' } } },
      },
      include: includeClause,
      orderBy: { createdAt: 'desc' },
    });

    // 2. Fallback: startsWith (case-insensitive) — e.g. "Martini" matches "Martini Frutas"
    if (!quote) {
      quote = await this.prisma.taskQuote.findFirst({
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
