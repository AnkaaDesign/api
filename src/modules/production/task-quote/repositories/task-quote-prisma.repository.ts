// api/src/modules/production/task-quote/repositories/task-quote-prisma.repository.ts

import { Injectable, Logger } from '@nestjs/common';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { TaskQuoteRepository } from './task-quote.repository';
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
      statusOrder: TASK_QUOTE_STATUS_ORDER[(formData.status || TASK_QUOTE_STATUS.PENDING) as TASK_QUOTE_STATUS] ?? 8,
      // Guarantee Terms
      guaranteeYears: formData.guaranteeYears || null,
      customGuaranteeText: formData.customGuaranteeText || null,
      // Layout File
      ...(formData.layoutFileId && {
        layoutFile: { connect: { id: formData.layoutFileId } },
      }),
      // New fields
      simultaneousTasks: (formData as any).simultaneousTasks || null,
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
          orderNumber: config.orderNumber || null,
          paymentCondition: config.paymentCondition || null,
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

    // Layout File
    if (formData.layoutFileId !== undefined) {
      if (formData.layoutFileId) {
        updateInput.layoutFile = { connect: { id: formData.layoutFileId } };
      } else {
        updateInput.layoutFile = { disconnect: true };
      }
    }

    // New fields
    if ((formData as any).simultaneousTasks !== undefined)
      updateInput.simultaneousTasks = (formData as any).simultaneousTasks;

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
    if ((include as any).task !== undefined) {
      if (typeof (include as any).task === 'boolean') {
        mappedInclude.task = (include as any).task;
      } else {
        mappedInclude.task = { include: (include as any).task.include as any };
      }
    }
    if ((include as any).layoutFile !== undefined)
      mappedInclude.layoutFile = (include as any).layoutFile;
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
                  select: { id: true, name: true, role: true },
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
    return orderBy as any;
  }

  protected mapWhereToDatabaseWhere(
    where?: TaskQuoteWhere,
  ): Prisma.TaskQuoteWhereInput | undefined {
    if (!where) return undefined;
    return where as any;
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
            select: { id: true, name: true, role: true },
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
    const maxBudgetNumber = await transaction.taskQuote.aggregate({
      _max: { budgetNumber: true },
    });
    const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

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
      where: { task: { id: taskId } },
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
              select: { id: true, name: true, role: true },
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
        task: true,
        customerConfigs: {
          include: {
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
            responsible: {
              select: { id: true, name: true, role: true },
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
          in: [TASK_QUOTE_STATUS.PENDING, TASK_QUOTE_STATUS.BUDGET_APPROVED, TASK_QUOTE_STATUS.COMMERCIAL_APPROVED, TASK_QUOTE_STATUS.BILLING_APPROVED],
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
        task: true,
        customerConfigs: {
          include: {
            customer: {
              select: { id: true, fantasyName: true, cnpj: true },
            },
            responsible: {
              select: { id: true, name: true, role: true },
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
        task: { id: taskId },
        status: { in: [TASK_QUOTE_STATUS.BILLING_APPROVED, TASK_QUOTE_STATUS.UPCOMING, TASK_QUOTE_STATUS.DUE, TASK_QUOTE_STATUS.PARTIAL, TASK_QUOTE_STATUS.SETTLED] },
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
              select: { id: true, name: true, role: true },
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
      task: {
        select: { id: true, name: true, createdAt: true },
      },
    };

    // 1. Try exact match (case-insensitive)
    let quote = await this.prisma.taskQuote.findFirst({
      where: {
        task: {
          ...baseWhere,
          name: { equals: params.name, mode: 'insensitive' },
        },
      },
      include: includeClause,
      orderBy: { createdAt: 'desc' },
    });

    // 2. Fallback: startsWith (case-insensitive) — e.g. "Martini" matches "Martini Frutas"
    if (!quote) {
      quote = await this.prisma.taskQuote.findFirst({
        where: {
          task: {
            ...baseWhere,
            name: { startsWith: params.name, mode: 'insensitive' },
          },
        },
        include: includeClause,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!quote) return null;

    const mapped = this.mapDatabaseEntityToEntity(quote);
    return {
      ...mapped,
      taskCreatedAt: quote.task?.createdAt || quote.createdAt,
    };
  }
}
