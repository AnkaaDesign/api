// repositories/task-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Task } from '../../../../types';
import {
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskInclude,
  TaskOrderBy,
  TaskWhere,
} from '../../../../schemas/task';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { TaskRepository } from './task.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import {
  TASK_STATUS,
  SERVICE_ORDER_STATUS,
  CUT_STATUS,
  AIRBRUSHING_STATUS,
} from '../../../../constants/enums';
import {
  computeExpectedFinishDate,
  resolveNewAirbrushingStatus,
} from '../../../../utils/airbrushing-quote';
import { getAirbrushingStatusOrder } from '../../../../utils/sortOrder';
import { TASK_QUOTE_STATUS_ORDER } from '../../../../constants/sortOrders';
import { TASK_QUOTE_STATUS } from '../../../../constants';
import {
  getTaskStatusOrder,
  getBonificationStatusOrder,
  getServiceOrderStatusOrder,
  getCutStatusOrder,
  mapTaskStatusToPrisma,
  mapServiceOrderStatusToPrisma,
  mapWhereClause,
  transformPaintColorPreview,
} from '../../../../utils';
import { recalcQuoteTotals } from '../../../../utils/budget-totals';
import {
  reconcileQuoteCustomerConfigs,
  resliceQuoteCoverage,
} from '../../../../utils/budget-customer-config-sync';
import { syncTaskLayoutsFromQuote } from '../../../../utils/sync-quote-task-layouts';
import { allocateBudgetNumber } from '../../../../utils/budget-number';
import { syncTruckSpotWithCleared } from '../../../../utils/task-truck-spot';
import { hasEntered } from '../../../../utils/task-cleared';
import { QUOTE_BILLING_INCLUDE, withCoverageInclude } from '../../../../utils/quote-tasks';
import {
  PER_VEHICLE_LEGACY_WRITE_MESSAGE,
  pruneQuoteLayoutCoverage,
  QUOTE_LAYOUT_FILES_INCLUDE,
  withLayoutCoverageInclude,
} from '../../../../utils/quote-layout-coverage';

// =====================
// Query Pattern Definitions
// =====================

/**
 * Minimal select for list/table views - only essential fields
 * Use for: Preparation page, Schedule page, History tables
 */
const TASK_SELECT_MINIMAL: Prisma.TaskSelect = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  term: true,
  forecastDate: true,
  cleared: true,
  customerId: true,
  sectorId: true,
  createdAt: true,
  updatedAt: true,
  // Minimal relations
  sector: {
    select: { id: true, name: true },
  },
  customer: {
    select: { id: true, fantasyName: true }, // Only fantasyName for list views
  },
};

/**
 * Card select for grid/card views - includes more context
 * Use for: Card-based implementMeasures, Kanban boards
 */
const TASK_SELECT_CARD: Prisma.TaskSelect = {
  ...TASK_SELECT_MINIMAL,
  details: true,
  entryDate: true,
  startedAt: true,
  finishedAt: true,
  bonification: true,
  bonificationOrder: true,
  createdById: true,
  // Additional relations
  createdBy: {
    select: { id: true, name: true },
  },
  implement: {
    select: {
      id: true,
      plate: true,
      spot: true,
    },
  },
  // Service orders with minimal data
  serviceOrders: {
    select: {
      id: true,
      status: true,
      type: true,
    },
  },
};

/**
 * Schedule select - optimized for schedule/calendar views
 * Use for: Schedule page, Gantt charts
 */
const TASK_SELECT_SCHEDULE: Prisma.TaskSelect = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  entryDate: true,
  term: true,
  startedAt: true,
  finishedAt: true,
  forecastDate: true,
  cleared: true,
  customerId: true,
  sectorId: true,
  createdAt: true,
  updatedAt: true,
  // Essential relations for scheduling
  sector: {
    select: { id: true, name: true },
  },
  customer: {
    select: { id: true, fantasyName: true },
  },
  implement: {
    select: {
      id: true,
      plate: true,
      spot: true,
      category: true,
    },
  },
  serviceOrders: {
    select: {
      id: true,
      status: true,
      type: true,
      assignedToId: true,
      assignedTo: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ type: 'asc' as const }, { position: 'asc' as const }],
  },
};

/**
 * Preparation select - optimized for preparation workflow
 * Use for: Preparation page, Pre-production tasks
 */
const TASK_SELECT_PREPARATION: Prisma.TaskSelect = {
  ...TASK_SELECT_MINIMAL,
  details: true,
  bonification: true,
  bonificationOrder: true,
  paintId: true,
  // Paint info without formulas
  generalPainting: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      colorPreview: true,
      paintType: {
        select: { id: true, name: true },
      },
      paintBrand: {
        select: { id: true, name: true },
      },
    },
  },
  logoPaints: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      colorPreview: true,
      paintType: {
        select: { id: true, name: true },
      },
      paintBrand: {
        select: { id: true, name: true },
      },
    },
  },
  serviceOrders: {
    select: {
      id: true,
      status: true,
      type: true,
      description: true,
      assignedToId: true,
      assignedTo: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ type: 'asc' as const }, { position: 'asc' as const }],
  },
  implement: {
    select: {
      id: true,
      plate: true,
      chassisNumber: true,
      // Só o escalar: a regra de atenção R3c ("Entrada sem foto da plaqueta") testa
      // `truck.vinPlateId`, e undefined seria lido como null e dispararia em tudo.
      // O File da foto vem apenas no include de detalhe.
      vinPlateId: true,
      spot: true,
      category: true,
      type: true,
    },
  },
};

/**
 * Full include for detail views - all relations loaded
 * Use for: Task detail page, Edit forms
 */
const DEFAULT_TASK_INCLUDE: Prisma.TaskInclude = {
  sector: { select: { id: true, name: true } },
  customer: { select: { id: true, fantasyName: true, cnpj: true } },
  quote: {
    include: {
      services: {
        orderBy: { position: 'asc' },
        include: {
          invoiceToCustomer: {
            select: { id: true, fantasyName: true, cnpj: true },
          },
        },
      },
      // Com a cobertura de cada arte — ver `withLayoutCoverageInclude`.
      layoutFiles: QUOTE_LAYOUT_FILES_INCLUDE,
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
              registrationStatus: true,
            },
          },
          installments: {
            include: { bankSlip: true },
            orderBy: { number: 'asc' as const },
          },
        },
      },
    },
  },
  budgets: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  invoices: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  receipts: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  bankSlips: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  observation: {
    include: {
      files: {
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          size: true,
          thumbnailUrl: true,
        },
      },
    },
  },
  // Paint info without formulas (formulas are heavy and rarely needed)
  generalPainting: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      manufacturer: true,
      tags: true,
      colorPreview: true,
      colorOrder: true,
      paintType: {
        select: {
          id: true,
          name: true,
          needGround: true,
        },
      },
      paintBrand: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  layouts: {
    select: {
      id: true,
      fileId: true,
      status: true,
      file: {
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          size: true,
          thumbnailUrl: true,
        },
      },
    },
  },
  projectFiles: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  checkinFiles: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  checkoutFiles: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  logoPaints: {
    select: {
      id: true,
      name: true,
      code: true,
      hex: true,
      finish: true,
      manufacturer: true,
      tags: true,
      colorPreview: true,
      colorOrder: true,
      paintType: {
        select: {
          id: true,
          name: true,
          needGround: true,
        },
      },
      paintBrand: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  serviceOrders: {
    include: {
      assignedTo: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: [{ type: 'asc' }, { position: 'asc' }],
  },
  implement: {
    select: {
      id: true,
      plate: true,
      chassisNumber: true,
      vinPlateId: true,
      // A relação (File) vem junto no detalhe — é o que a miniatura da Plaqueta usa.
      vinPlate: true,
      spot: true,
      category: true,
      type: true,
      // ImplementMeasure references for detail page
      leftSideMeasureId: true,
      rightSideMeasureId: true,
      backSideMeasureId: true,
      // Don't include full implementMeasure data by default - fetch separately when needed
      // This reduces payload by 60-70% for tasks with implementMeasures
    },
  },
  airbrushings: {
    include: {
      receipts: {
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          size: true,
          thumbnailUrl: true,
        },
      },
      invoices: {
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          size: true,
          thumbnailUrl: true,
        },
      },
      layouts: {
        select: {
          id: true,
          fileId: true,
          status: true,
          file: {
            select: {
              id: true,
              filename: true,
              path: true,
              mimetype: true,
              size: true,
              thumbnailUrl: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  cuts: {
    include: {
      file: {
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          size: true,
          thumbnailUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
  responsibles: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      roles: true,
      isActive: true,
    },
  },
};

// =====================
// Vencimento (first installment due date) sorting
// =====================

/**
 * Computed orderBy key used by the billing list ("VENCIMENTO" column). The value
 * lives two relations deep (task -> quote -> customerConfigs -> installments),
 * which Prisma cannot express in orderBy. Sorting it over the already-paginated
 * page only reorders those rows, which makes every page look sorted while the
 * global order is wrong (rows with a due date pile up at the top of *each* page).
 * So the repository scans every matching row with a light select, sorts the whole
 * set in memory, and only then slices the requested page.
 */
const DUE_DATE_SORT_KEY = 'currentInstallmentDueDate';

/** Light select used for the full scan that backs the due-date sort. */
const TASK_SELECT_DUE_DATE_SORT: Prisma.TaskSelect = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  bonificationOrder: true,
  entryDate: true,
  term: true,
  startedAt: true,
  finishedAt: true,
  forecastDate: true,
  cleared: true,
  createdAt: true,
  updatedAt: true,
  // Every key `taskOrderByFieldsSchema` accepts under `quote` / `customer` has to be selected
  // here, not just the ones the due-date sort itself needs. `resolveSortValue` returns undefined
  // for an unselected path, the comparator then treats both sides as null and SKIPS the key —
  // so a secondary (or even primary) sort by Cliente or Nº Orçamento was silently doing nothing
  // whenever Vencimento was part of the sort, which a plain shift-click reaches.
  quote: {
    select: {
      statusOrder: true,
      total: true,
      subtotal: true,
      budgetNumber: true,
      expiresAt: true,
      billingApprovedAt: true,
      customerConfigs: {
        select: {
          // ⚠️ `billingId` e `status` da parcela NÃO são decoração: sem eles
          // `resolveCurrentInstallmentDueDate` não sabe de qual cobrança é a linha
          // nem se a parcela já foi paga, e volta a devolver a primeira parcela do
          // orçamento inteiro. `select` sem a chave não dá erro — dá silêncio.
          billingId: true,
          installments: { select: { number: true, dueDate: true, status: true } },
        },
      },
    },
  },
  // A cobrança DESTA linha. A lista é por VEÍCULO, e o vencimento que interessa é
  // o da cobrança que cobra este veículo — não o do orçamento.
  //
  // ⚠️ `billing` NÃO é decoração, é a invariante declarada acima: toda chave que
  // `taskOrderByFieldsSchema` aceita tem de estar neste select. A lista de
  // Faturamento ordena por `billingEntry.billing.statusOrder` POR PADRÃO
  // (`billingStatus asc, finishedAt desc`), e sem esta linha `resolveSortValue`
  // devolvia `undefined` para os dois lados: o comparador tratava tudo como nulo
  // e PULAVA a chave. O primeiro clique em "Vencimento" jogava a ordenação
  // primária fora, sem aviso e sem erro.
  billingEntry: {
    select: { billingId: true, billing: { select: { statusOrder: true, status: true } } },
  },
  customer: { select: { fantasyName: true, corporateName: true } },
};

interface FlatSortEntry {
  path: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

/**
 * Flattens a Prisma-style orderBy (object, array of objects, or nested relation
 * objects) into an ordered list of { path, direction } entries. Priority order is
 * preserved, so the first entry is the primary sort.
 */
function flattenOrderBy(orderBy: any): FlatSortEntry[] {
  const entries: FlatSortEntry[] = [];

  const visit = (node: any, prefix: string[]) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (value === 'asc' || value === 'desc') {
        entries.push({ path: path.join('.'), direction: value });
      } else if (value && typeof value === 'object') {
        const sortValue = (value as any).sort;
        if (sortValue === 'asc' || sortValue === 'desc') {
          entries.push({ path: path.join('.'), direction: sortValue, nulls: (value as any).nulls });
        } else {
          visit(value, path);
        }
      }
    }
  };

  if (Array.isArray(orderBy)) orderBy.forEach(item => visit(item, []));
  else visit(orderBy, []);

  return entries;
}

/**
 * O VENCIMENTO QUE INTERESSA: a parcela EM ABERTO mais antiga da cobrança desta
 * linha. Sem nenhuma em aberto, a última — a data em que o contrato terminou de
 * ser pago.
 *
 * ⚠️ Era "a parcela nº 1, qualquer que fosse o estado dela", e isso produzia uma
 * mentira exatamente na linha que mais precisa da verdade. Caso real, orçamento
 * 903 (KI Distribuidora): parcela 1 vence 27/08 e está PAGA, parcela 2 vence
 * 16/09 e está VENCIDA. A linha vinha marcada "Vencido" e mostrava 27/08 — uma
 * data que ninguém deve, ao lado de um selo dizendo que se deve.
 *
 * ⚠️ E varria os pagadores do ORÇAMENTO inteiro. Num orçamento de sessenta
 * caminhões faturados um a um, as sessenta linhas mostravam o mesmo vencimento —
 * o da primeira parcela de quem calhasse de ter a parcela nº 1.
 *
 * Espelhado em `findFirstInstallmentDueDate` no web (colunas de faturamento). Os
 * dois TÊM de concordar, senão a data desenhada e a ordenação discordam.
 */
function resolveCurrentInstallmentDueDate(row: any): Date | null {
  const configs = row?.quote?.customerConfigs;
  if (!Array.isArray(configs) || configs.length === 0) return null;

  // A cobrança desta linha. Sem ela (orçamento de acervo, sem cobertura), cai no
  // orçamento inteiro — que é o comportamento antigo, e o melhor disponível ali.
  const billingId = row?.billingEntry?.billingId ?? null;
  const doRecorte = billingId ? configs.filter((c: any) => c?.billingId === billingId) : configs;
  const escopo = doRecorte.length > 0 ? doRecorte : configs;

  let emAberto: Date | null = null;
  let ultima: Date | null = null;
  for (const config of escopo) {
    for (const installment of config?.installments || []) {
      if (!installment?.dueDate) continue;
      const due = new Date(installment.dueDate);
      if (Number.isNaN(due.getTime())) continue;
      if (!ultima || due.getTime() > ultima.getTime()) ultima = due;
      // Cancelada não se deve; paga já se pagou. Nenhuma das duas é "vencimento".
      if (installment.status === 'PAID' || installment.status === 'CANCELLED') continue;
      if (!emAberto || due.getTime() < emAberto.getTime()) emAberto = due;
    }
  }
  return emAberto ?? ultima;
}

function resolveSortValue(row: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), row);
}

function compareSortValues(a: any, b: any): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'pt-BR');
  const aNum = Number(a);
  const bNum = Number(b);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
  return String(a).localeCompare(String(b), 'pt-BR');
}

@Injectable()
export class TaskPrismaRepository
  extends BaseStringPrismaRepository<
    Task,
    TaskCreateFormData,
    TaskUpdateFormData,
    TaskInclude,
    TaskOrderBy,
    TaskWhere,
    Prisma.TaskGetPayload<{ include: any }>,
    Prisma.TaskCreateInput,
    Prisma.TaskUpdateInput,
    Prisma.TaskInclude,
    Prisma.TaskOrderByWithRelationInput,
    Prisma.TaskWhereInput
  >
  implements TaskRepository
{
  protected readonly logger = new Logger(TaskPrismaRepository.name);

  constructor(
    protected readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {
    super(prisma);
  }

  // =====================
  // Query Pattern Selection
  // =====================

  /**
   * Determines optimal query pattern based on context
   */
  private getOptimalQueryPattern(
    options?: FindManyOptions<TaskOrderBy, TaskWhere, TaskInclude>,
  ): any {
    // If specific includes requested, use custom mapping
    if (options?.include) {
      return { include: this.mapIncludeToDatabaseInclude(options.include) };
    }

    // Check where clause to determine context
    const where = options?.where as any;

    // Schedule context: filtering by dates or forecast
    if (where?.forecastDate || where?.forecastDateRange || where?.termRange) {
      return { select: TASK_SELECT_SCHEDULE };
    }

    // Preparation context: filtering by preparation-related flags
    if (where?.shouldDisplayInPreparation || where?.hasIncompleteServiceOrders) {
      return { select: TASK_SELECT_PREPARATION };
    }

    // Default to minimal for list views
    return { select: TASK_SELECT_MINIMAL };
  }

  // =====================
  // Mapping Methods
  // =====================

  protected mapDatabaseEntityToEntity(databaseEntity: any): Task {
    const task: Task = {
      ...databaseEntity,
      price: databaseEntity.price ? Number(databaseEntity.price) : null,
    };

    // Convert Prisma Decimal fields in nested quote relation
    if (task.quote) {
      task.quote = {
        ...task.quote,
        subtotal: task.quote.subtotal ? Number(task.quote.subtotal) : 0,
        total: task.quote.total ? Number(task.quote.total) : 0,
        services: task.quote.services?.map((service: any) => ({
          ...service,
          amount: service.amount ? Number(service.amount) : 0,
        })),
        customerConfigs: task.quote.customerConfigs?.map((config: any) => ({
          ...config,
          subtotal: config.subtotal ? Number(config.subtotal) : 0,
          total: config.total ? Number(config.total) : 0,
          installments: config.installments?.map((inst: any) => ({
            ...inst,
            amount: inst.amount ? Number(inst.amount) : 0,
            paidAmount: inst.paidAmount ? Number(inst.paidAmount) : 0,
          })),
        })),
      };
    }

    // Transform generalPainting.colorPreview path to URL
    if (task.generalPainting) {
      task.generalPainting = transformPaintColorPreview(task.generalPainting);
    }

    // Transform logoPaints colorPreview paths to URLs
    if (task.logoPaints && Array.isArray(task.logoPaints)) {
      task.logoPaints = task.logoPaints.map((paint: any) => transformPaintColorPreview(paint));
    }

    // Transform task layouts from nested Layout+File structure to flattened File structure
    if (task.layouts && Array.isArray(task.layouts)) {
      task.layouts = task.layouts.map((layout: any) => {
        if (layout.file) {
          return {
            id: layout.file.id,
            layoutId: layout.id,
            status: layout.status,
            filename: layout.file.filename,
            originalName: layout.file.originalName,
            path: layout.file.path,
            mimetype: layout.file.mimetype,
            size: layout.file.size,
            thumbnailUrl: layout.file.thumbnailUrl,
            createdAt: layout.file.createdAt,
            updatedAt: layout.file.updatedAt,
          };
        }
        return layout;
      });
    }

    // Transform airbrushing layouts
    if (task.airbrushings && Array.isArray(task.airbrushings)) {
      task.airbrushings = task.airbrushings.map((airbrushing: any) => {
        if (airbrushing.layouts && Array.isArray(airbrushing.layouts)) {
          return {
            ...airbrushing,
            layouts: airbrushing.layouts.map((layout: any) => {
              if (layout.file) {
                return {
                  id: layout.file.id,
                  layoutId: layout.id,
                  status: layout.status,
                  filename: layout.file.filename,
                  originalName: layout.file.originalName,
                  path: layout.file.path,
                  mimetype: layout.file.mimetype,
                  size: layout.file.size,
                  thumbnailUrl: layout.file.thumbnailUrl,
                  createdAt: layout.file.createdAt,
                  updatedAt: layout.file.updatedAt,
                };
              }
              return layout;
            }),
          };
        }
        return airbrushing;
      });
    }

    return task;
  }

  // Override create to handle newResponsibles
  async create(
    data: TaskCreateFormData,
    options?: CreateOptions<TaskInclude>,
    tx?: PrismaTransaction,
  ): Promise<Task> {
    const prismaClient = tx || this.prisma;
    const { newResponsibles, ...dataWithoutNewResponsibles } = data as any;

    // If there are new responsibles to create, create them first
    let additionalResponsibleIds: string[] = [];
    if (newResponsibles && newResponsibles.length > 0) {
      const createdResponsibles = await Promise.all(
        newResponsibles.map(async responsibleData => {
          const companyId = responsibleData.companyId || data.customerId;

          return prismaClient.responsible.create({
            data: {
              ...responsibleData,
              companyId,
            },
          });
        }),
      );

      additionalResponsibleIds = createdResponsibles.map(responsible => responsible.id);
    }

    // Add the new responsible IDs to the existing ones
    if (additionalResponsibleIds.length > 0) {
      const existingResponsibleIds = (dataWithoutNewResponsibles.responsibleIds || []) as string[];
      dataWithoutNewResponsibles.responsibleIds = [
        ...existingResponsibleIds,
        ...additionalResponsibleIds,
      ];
    }

    // Call the concrete implementation (not super, since it's abstract in base)
    return this.createWithTransaction(tx || this.prisma, dataWithoutNewResponsibles, options);
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: TaskCreateFormData,
  ): Prisma.TaskCreateInput {
    const extendedData = formData as any;

    const {
      name,
      status,
      serialNumber,
      // O PEDIDO DE COMPRA DO CLIENTE, deste veículo. Sem estar nesta
      // desestruturação o campo é ACEITO pelo zod e DESCARTADO aqui: a tela
      // grava, a API responde 200, e o valor nunca chega ao banco.
      customerOrderNumber,
      details,
      entryDate,
      term,
      startedAt,
      finishedAt,
      forecastDate,
      cleared,
      paintId,
      customerId,
      sectorId,
      bonification,
      budgetIds,
      invoiceIds,
      receiptIds,
      bankSlipIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      layoutIds,
      baseFileIds,
      projectFileIds,
      checkinFileIds,
      checkoutFileIds,
      quoteId,
      paintIds,
      responsibleIds,
      serviceOrders,
      observation,
      implement: truck,
      cut,
      cuts,
    } = extendedData;

    const taskData: Prisma.TaskCreateInput = {
      name,
      status: mapTaskStatusToPrisma(status || TASK_STATUS.PREPARATION),
      statusOrder: getTaskStatusOrder(status || TASK_STATUS.PREPARATION),
      bonification: (bonification as any) || 'FULL_BONIFICATION',
      bonificationOrder: getBonificationStatusOrder(
        (bonification as string) || 'FULL_BONIFICATION',
      ),
    };

    // A SÉRIE NÃO vai para `Task` (W1, DD1): `Task.serialNumber` é espelho
    // somente leitura (gatilho da M1s) — ela nasce no implemento, logo abaixo.
    if (customerOrderNumber !== undefined) {
      taskData.customerOrderNumber = customerOrderNumber;
    }
    if (details !== undefined) taskData.details = details;
    if (entryDate !== undefined) taskData.entryDate = entryDate;
    if (term !== undefined) taskData.term = term;
    if (startedAt !== undefined) taskData.startedAt = startedAt;
    if (finishedAt !== undefined) taskData.finishedAt = finishedAt;
    if (forecastDate !== undefined) taskData.forecastDate = forecastDate;
    if (cleared !== undefined) taskData.cleared = cleared;

    if (customerId) taskData.customer = { connect: { id: customerId } };
    if (paintId) taskData.generalPainting = { connect: { id: paintId } };
    if (sectorId) taskData.sector = { connect: { id: sectorId } };

    if (budgetIds && budgetIds.length > 0) {
      taskData.budgets = { connect: budgetIds.map(id => ({ id })) };
    }
    if (invoiceIds && invoiceIds.length > 0) {
      taskData.invoices = { connect: invoiceIds.map(id => ({ id })) };
    }
    if (receiptIds && receiptIds.length > 0) {
      taskData.receipts = { connect: receiptIds.map(id => ({ id })) };
    }
    if (reimbursementIds && reimbursementIds.length > 0) {
      taskData.reimbursements = { connect: reimbursementIds.map(id => ({ id })) };
    }
    if (reimbursementInvoiceIds && reimbursementInvoiceIds.length > 0) {
      taskData.invoiceReimbursements = { connect: reimbursementInvoiceIds.map(id => ({ id })) };
    }
    if (layoutIds && layoutIds.length > 0) {
      taskData.layouts = { connect: layoutIds.map(id => ({ id })) };
    }
    if (baseFileIds && baseFileIds.length > 0) {
      taskData.baseFiles = { connect: baseFileIds.map(id => ({ id })) };
    }
    if (projectFileIds && projectFileIds.length > 0) {
      taskData.projectFiles = { connect: projectFileIds.map(id => ({ id })) };
    }
    if (checkinFileIds && checkinFileIds.length > 0) {
      taskData.checkinFiles = { connect: checkinFileIds.map(id => ({ id })) };
    }
    if (checkoutFileIds && checkoutFileIds.length > 0) {
      taskData.checkoutFiles = { connect: checkoutFileIds.map(id => ({ id })) };
    }
    if (quoteId) {
      taskData.quote = { connect: { id: quoteId } };
    }
    if (paintIds && paintIds.length > 0) {
      taskData.logoPaints = { connect: paintIds.map(id => ({ id })) };
    }
    if (responsibleIds && responsibleIds.length > 0) {
      taskData.responsibles = { connect: responsibleIds.map(id => ({ id })) };
    }

    if (observation) {
      const { fileIds: obsFileIds, description: obsDescription, ...obsData } = observation;
      taskData.observation = {
        create: {
          ...obsData,
          description: obsDescription || '',
          files:
            obsFileIds && obsFileIds.length > 0
              ? { connect: obsFileIds.map(id => ({ id })) }
              : undefined,
        },
      };
    }

    const creatorId = (extendedData as any).createdById;
    // ServiceOrder.createdBy is required, so SOs can only be created when a
    // creator id is known. Surface the silent drop — otherwise a caller that
    // forgot to pass userId loses every submitted SO with no signal.
    if (serviceOrders && serviceOrders.length > 0 && !creatorId) {
      this.logger.warn(
        `[mapCreateFormDataToDatabaseCreateInput] ${serviceOrders.length} service order(s) were dropped on task create: no creator id (userId) available to set ServiceOrder.createdBy.`,
      );
    }
    if (serviceOrders && serviceOrders.length > 0 && creatorId) {
      taskData.serviceOrders = {
        create: serviceOrders.map((service, index) => ({
          status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
          statusOrder:
            service.statusOrder ||
            getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
          type: (service.type || 'PRODUCTION') as any,
          description: service.description || '',
          observation: service.observation || null,
          position: index,
          ...(service.assignedToId
            ? { assignedTo: { connect: { id: service.assignedToId } } }
            : {}),
          startedAt: service.startedAt || null,
          finishedAt: service.finishedAt || null,
          createdBy: { connect: { id: (service as any).createdById || creatorId } },
        })),
      };
    }

    // W1 (DD1): TODA tarefa nasce com implemento — mesmo sem nenhum campo (o
    // gatilho diferido "Task_has_implement" recusa, no COMMIT, a que nascer sem).
    // `spot` SEMPRE explícito: null até a tarefa ser liberada (o default antigo
    // punha o veículo "no pátio"). A série do topo (legado, D-32) cai aqui
    // quando o corpo não a trouxe dentro do implemento.
    {
      const implementInput: Record<string, any> =
        truck && typeof truck === 'object' ? truck : {};
      const implementData: Record<string, unknown> = {
        spot: implementInput.spot !== undefined ? implementInput.spot : null,
      };
      const serial =
        implementInput.serialNumber !== undefined ? implementInput.serialNumber : serialNumber;
      if (serial !== undefined) implementData.serialNumber = serial ?? null;
      if (implementInput.plate !== undefined) implementData.plate = implementInput.plate;
      if (implementInput.chassisNumber !== undefined) {
        implementData.chassisNumber = implementInput.chassisNumber;
      }
      if (implementInput.vinPlateId !== undefined) implementData.vinPlateId = implementInput.vinPlateId;
      if (implementInput.category !== undefined && implementInput.category !== null) {
        implementData.category = implementInput.category;
      }
      if (implementInput.type !== undefined && implementInput.type !== null) {
        implementData.type = implementInput.type;
      }
      taskData.implement = { create: implementData as any };
    }

    // Handle cuts
    type CutRecord = {
      fileId: string;
      type: any;
      status: any;
      statusOrder: number;
      origin: any;
      reason: any;
      parentCutId: string | null;
    };
    const cutRecords: CutRecord[] = [];

    if (cuts && Array.isArray(cuts)) {
      for (const cutItem of cuts) {
        if (!cutItem.fileId) continue;
        const quantity = (cutItem as any).quantity || 1;
        for (let i = 0; i < quantity; i++) {
          cutRecords.push({
            fileId: cutItem.fileId,
            type: cutItem.type as any,
            status: CUT_STATUS.PENDING as any,
            statusOrder: getCutStatusOrder(CUT_STATUS.PENDING),
            origin: cutItem.origin as any,
            reason: cutItem.reason ? (cutItem.reason as any) : null,
            parentCutId: cutItem.parentCutId || null,
          } as any);
        }
      }
    } else if (cut) {
      if (cut.fileId) {
        const quantity = (cut as any).quantity || 1;
        for (let i = 0; i < quantity; i++) {
          cutRecords.push({
            fileId: cut.fileId,
            type: cut.type as any,
            status: CUT_STATUS.PENDING as any,
            statusOrder: getCutStatusOrder(CUT_STATUS.PENDING),
            origin: cut.origin as any,
            reason: cut.reason ? (cut.reason as any) : null,
            parentCutId: cut.parentCutId || null,
          } as any);
        }
      }
    }

    if (cutRecords.length > 0) {
      taskData.cuts = {
        create: cutRecords,
      };
    }

    // Handle airbrushings
    const airbrushings = (extendedData as any).airbrushings;
    if (airbrushings && Array.isArray(airbrushings) && airbrushings.length > 0) {
      // Security (B7): a newly created airbrushing can never start with a
      // non-PENDING payment status — the payment gate requires the PERSISTED
      // status to be COMPLETED, which a new record cannot be.
      for (const item of airbrushings) {
        if (
          item?.paymentStatus !== undefined &&
          item?.paymentStatus !== null &&
          item.paymentStatus !== 'PENDING'
        ) {
          throw new BadRequestException(
            'O status de pagamento só pode ser definido após a conclusão da aerografia.',
          );
        }
      }
      taskData.airbrushings = {
        create: airbrushings.map((item: any) => {
          // Sem aerografista, a aerografia nasce EM COTAÇÃO: sem valor, e os
          // aerografistas são avisados depois do commit (TaskService.create).
          const status = resolveNewAirbrushingStatus(item.status, item.painterId);
          const quoting = status === AIRBRUSHING_STATUS.QUOTING;
          return {
            status,
            statusOrder: getAirbrushingStatusOrder(status),
            quotationOpenedAt: quoting ? new Date() : null,
            price:
              !quoting && item.price !== undefined && item.price !== null
                ? Number(item.price)
                : null,
            description: item.description || null,
            startDate: item.startDate || null,
            finishDate:
              computeExpectedFinishDate(
                item.startDate,
                item.executionTime,
                item.executionTimeUnit,
              ) ??
              (item.finishDate || null),
            executionTime: item.executionTime ?? null,
            executionTimeUnit: item.executionTimeUnit ?? null,
            quotationOfferAmount: quoting ? (item.quotationOfferAmount ?? null) : null,
            quotationOfferExecutionTime: quoting
              ? (item.quotationOfferExecutionTime ?? null)
              : null,
            quotationOfferExecutionTimeUnit: quoting
              ? (item.quotationOfferExecutionTimeUnit ?? null)
              : null,
            startedAt: item.startedAt || null,
            finishedAt: item.finishedAt || null,
            paymentStatus: item.paymentStatus || 'PENDING',
            painter: !quoting && item.painterId ? { connect: { id: item.painterId } } : undefined,
            receipts:
              item.receiptIds && item.receiptIds.length > 0
                ? { connect: item.receiptIds.map((id: string) => ({ id })) }
                : undefined,
            invoices:
              item.invoiceIds && item.invoiceIds.length > 0
                ? { connect: item.invoiceIds.map((id: string) => ({ id })) }
                : undefined,
            layouts:
              item.layoutIds && item.layoutIds.length > 0
                ? { connect: item.layoutIds.map((id: string) => ({ id })) }
                : undefined,
          };
        }),
      };
    }

    return taskData;
  }

  // Override update to handle newResponsibles
  async update(
    id: string,
    data: TaskUpdateFormData,
    options?: UpdateOptions<TaskInclude>,
    tx?: PrismaTransaction,
  ): Promise<Task> {
    const prismaClient = tx || this.prisma;
    const { newResponsibles, ...dataWithoutNewResponsibles } = data as any;

    let additionalResponsibleIds: string[] = [];
    if (newResponsibles && newResponsibles.length > 0) {
      const task = await prismaClient.task.findUnique({
        where: { id },
        select: { customerId: true },
      });

      const createdResponsibles = await Promise.all(
        newResponsibles.map(async responsibleData => {
          const companyId = responsibleData.companyId || task?.customerId;

          return prismaClient.responsible.create({
            data: {
              ...responsibleData,
              companyId,
            },
          });
        }),
      );

      additionalResponsibleIds = createdResponsibles.map(responsible => responsible.id);
    }

    if (additionalResponsibleIds.length > 0) {
      const existingResponsibleIds = (dataWithoutNewResponsibles.responsibleIds || []) as string[];
      dataWithoutNewResponsibles.responsibleIds = [
        ...existingResponsibleIds,
        ...additionalResponsibleIds,
      ];
    }

    // Call the concrete implementation (not super, since it's abstract in base)
    return this.updateWithTransaction(tx || this.prisma, id, dataWithoutNewResponsibles, options);
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: TaskUpdateFormData,
    userId?: string,
  ): Prisma.TaskUpdateInput {
    this.logger.log(
      '[mapUpdateFormDataToDatabaseUpdateInput] Incoming formData:',
      JSON.stringify(formData, null, 2),
    );

    const extendedData = formData as TaskUpdateFormData;

    const {
      name,
      status,
      serialNumber,
      // O PEDIDO DE COMPRA DO CLIENTE, deste veículo. Sem estar nesta
      // desestruturação o campo é ACEITO pelo zod e DESCARTADO aqui: a tela
      // grava, a API responde 200, e o valor nunca chega ao banco.
      customerOrderNumber,
      details,
      entryDate,
      term,
      startedAt,
      finishedAt,
      forecastDate,
      cleared,
      paintId,
      customerId,
      sectorId,
      bonification,
      budgetIds,
      invoiceIds,
      receiptIds,
      bankSlipIds,
      reimbursementIds,
      reimbursementInvoiceIds,
      layoutIds,
      baseFileIds,
      projectFileIds,
      checkinFileIds,
      checkoutFileIds,
      quoteId,
      paintIds,
      responsibleIds,
      serviceOrders,
      observation,
      implement: truck,
      cut,
      cuts,
    } = extendedData as any;

    const updateData: Prisma.TaskUpdateInput = {};

    if (name !== undefined) updateData.name = name;
    // A SÉRIE vai para o implemento (W2, logo abaixo): `Task.serialNumber` é espelho.
    if (customerOrderNumber !== undefined) {
      updateData.customerOrderNumber = customerOrderNumber;
    }
    if (details !== undefined) updateData.details = details;
    if (entryDate !== undefined) {
      updateData.entryDate = entryDate;
      // Setting an entry date means the truck has arrived — auto-clear if not already cleared
      if (entryDate !== null && cleared === undefined) {
        updateData.cleared = true;
      }
    }
    if (term !== undefined) updateData.term = term;
    if (startedAt !== undefined) updateData.startedAt = startedAt;
    if (finishedAt !== undefined) updateData.finishedAt = finishedAt;
    if (forecastDate !== undefined) {
      updateData.forecastDate = forecastDate;
      // Reset cleared when forecastDate changes, unless cleared is explicitly set in the same update
      if (cleared === undefined) {
        updateData.cleared = false;
      }
    }
    if (cleared !== undefined) updateData.cleared = cleared;

    if (bonification !== undefined) {
      updateData.bonification = bonification as any;
      updateData.bonificationOrder = getBonificationStatusOrder(bonification as string);
    }

    if (status !== undefined) {
      updateData.status = mapTaskStatusToPrisma(status);
      updateData.statusOrder = getTaskStatusOrder(status);
    }

    if (customerId !== undefined) {
      updateData.customer = customerId ? { connect: { id: customerId } } : { disconnect: true };
    }
    if (paintId !== undefined) {
      updateData.generalPainting = paintId ? { connect: { id: paintId } } : { disconnect: true };
    }
    if (sectorId !== undefined) {
      updateData.sector = sectorId ? { connect: { id: sectorId } } : { disconnect: true };
    }

    if (budgetIds !== undefined) {
      updateData.budgets = { set: budgetIds.map(id => ({ id })) };
    }
    if (invoiceIds !== undefined) {
      updateData.invoices = { set: invoiceIds.map(id => ({ id })) };
    }
    if (receiptIds !== undefined) {
      updateData.receipts = { set: receiptIds.map(id => ({ id })) };
    }
    // Bank slips (TASK_BANK_SLIPS File[] relation). Absence = preserve: only
    // rewritten when bankSlipIds was explicitly sent. Mirrors how the
    // single-update service path connects bank slips — without this branch the
    // bulk-attached bankSlipIds the batch path computes were silently dropped.
    if (bankSlipIds !== undefined) {
      updateData.bankSlips = { set: bankSlipIds.map(id => ({ id })) };
    }
    if (reimbursementIds !== undefined) {
      updateData.reimbursements = { set: reimbursementIds.map(id => ({ id })) };
    }
    if (reimbursementInvoiceIds !== undefined) {
      updateData.invoiceReimbursements = { set: reimbursementInvoiceIds.map(id => ({ id })) };
    }
    if (layoutIds !== undefined) {
      updateData.layouts = { set: layoutIds.map(id => ({ id })) };
    }
    if (baseFileIds !== undefined) {
      updateData.baseFiles = { set: baseFileIds.map(id => ({ id })) };
    }
    if (projectFileIds !== undefined) {
      updateData.projectFiles = { set: projectFileIds.map(id => ({ id })) };
    }
    if (checkinFileIds !== undefined) {
      updateData.checkinFiles = { set: checkinFileIds.map(id => ({ id })) };
    }
    if (checkoutFileIds !== undefined) {
      updateData.checkoutFiles = { set: checkoutFileIds.map(id => ({ id })) };
    }
    if (quoteId !== undefined) {
      updateData.quote = quoteId ? { connect: { id: quoteId } } : { disconnect: true };
    }
    if (paintIds !== undefined) {
      updateData.logoPaints = { set: paintIds.map(id => ({ id })) };
    }
    if (responsibleIds !== undefined) {
      updateData.responsibles = { set: responsibleIds.map(id => ({ id })) };
    }

    if (observation !== undefined) {
      if (observation === null) {
        updateData.observation = { delete: true };
      } else {
        const { fileIds: obsFileIds, ...obsData } = observation;
        updateData.observation = {
          upsert: {
            create: {
              ...obsData,
              files:
                obsFileIds && obsFileIds.length > 0
                  ? { connect: obsFileIds.map(id => ({ id })) }
                  : undefined,
            },
            update: {
              ...obsData,
              files: obsFileIds !== undefined ? { set: obsFileIds.map(id => ({ id })) } : undefined,
            },
          },
        };
      }
    }

    if (serviceOrders !== undefined) {
      const existingOrdersWithIndex: { service: any; index: number }[] = [];
      const newOrdersWithIndex: { service: any; index: number }[] = [];

      serviceOrders.forEach((service: any, index: number) => {
        if (service.id) {
          existingOrdersWithIndex.push({ service, index });
        } else {
          newOrdersWithIndex.push({ service, index });
        }
      });

      const serviceOrdersUpdate: any = {};

      if (existingOrdersWithIndex.length > 0) {
        serviceOrdersUpdate.updateMany = existingOrdersWithIndex.map(({ service, index }) => ({
          where: { id: service.id },
          data: {
            ...(service.status !== undefined && {
              status: mapServiceOrderStatusToPrisma(service.status),
            }),
            ...(service.status !== undefined && {
              statusOrder: getServiceOrderStatusOrder(service.status),
            }),
            ...(service.type !== undefined && { type: service.type }),
            ...(service.description !== undefined && { description: service.description }),
            ...(service.observation !== undefined && { observation: service.observation }),
            ...(service.startedAt !== undefined && { startedAt: service.startedAt }),
            ...(service.finishedAt !== undefined && { finishedAt: service.finishedAt }),
            ...(service.assignedToId !== undefined && { assignedToId: service.assignedToId }),
            position: index,
          },
        }));
      }

      if (newOrdersWithIndex.length > 0) {
        serviceOrdersUpdate.create = newOrdersWithIndex.map(({ service, index }) => {
          const serviceData: any = {
            status: mapServiceOrderStatusToPrisma(service.status || SERVICE_ORDER_STATUS.PENDING),
            statusOrder:
              service.statusOrder ||
              getServiceOrderStatusOrder(service.status || SERVICE_ORDER_STATUS.PENDING),
            type: service.type || 'PRODUCTION',
            description: service.description,
            observation: service.observation || null,
            position: index,
            startedAt: service.startedAt || null,
            finishedAt: service.finishedAt || null,
            createdBy: userId ? { connect: { id: userId } } : undefined,
          };

          if (service.assignedToId) {
            serviceData.assignedTo = { connect: { id: service.assignedToId } };
          }

          return serviceData;
        });
      }

      if (Object.keys(serviceOrdersUpdate).length > 0) {
        updateData.serviceOrders = serviceOrdersUpdate;
      }
    }

    // W2 (DD1): o implemento SEMPRE existe — `update`, nunca `upsert`/`delete`.
    // `implement: null` (ou o velho `truck: null`) já foi recusado com 400 pelo
    // tradutor; aqui é a segunda cerca. A série do topo (legado, D-32) cai no
    // implemento quando o corpo não a trouxe dentro dele.
    if (truck === null) {
      throw new BadRequestException(
        'O implemento não pode ser removido da tarefa; limpe os campos.',
      );
    }
    {
      const implementInput: Record<string, any> =
        truck && typeof truck === 'object' ? truck : {};
      const implementUpdate: Record<string, unknown> = {};
      const serial =
        implementInput.serialNumber !== undefined ? implementInput.serialNumber : serialNumber;
      if (serial !== undefined) implementUpdate.serialNumber = serial ?? null;
      if (implementInput.plate !== undefined) implementUpdate.plate = implementInput.plate;
      if (implementInput.chassisNumber !== undefined) {
        implementUpdate.chassisNumber = implementInput.chassisNumber;
      }
      if (implementInput.vinPlateId !== undefined) {
        implementUpdate.vinPlate = implementInput.vinPlateId
          ? { connect: { id: implementInput.vinPlateId } }
          : { disconnect: true };
      }
      if (implementInput.spot !== undefined) implementUpdate.spot = implementInput.spot;
      if (implementInput.category !== undefined && implementInput.category !== '') {
        implementUpdate.category = implementInput.category;
      }
      if (implementInput.type !== undefined && implementInput.type !== '') {
        implementUpdate.type = implementInput.type;
      }
      if (Object.keys(implementUpdate).length > 0) {
        updateData.implement = { update: implementUpdate as any };
      }
    }

    const shouldUpdateCuts = cut !== undefined || cuts !== undefined;

    if (shouldUpdateCuts) {
      const cutRecords: any[] = [];

      if (cuts !== undefined && cuts !== null && Array.isArray(cuts)) {
        for (const cutItem of cuts) {
          if (!cutItem.fileId) continue;
          const quantity = (cutItem as any).quantity || 1;
          const cutStatus = (cutItem as any).status || CUT_STATUS.PENDING;
          for (let i = 0; i < quantity; i++) {
            cutRecords.push({
              fileId: cutItem.fileId,
              type: cutItem.type as any,
              status: cutStatus as any,
              statusOrder: getCutStatusOrder(cutStatus),
              origin: cutItem.origin as any,
              reason: cutItem.reason ? (cutItem.reason as any) : null,
              parentCutId: cutItem.parentCutId || null,
            } as any);
          }
        }
      } else if (cut !== undefined && cut !== null) {
        if (cut.fileId) {
          const quantity = (cut as any).quantity || 1;
          const cutStatus = (cut as any).status || CUT_STATUS.PENDING;
          for (let i = 0; i < quantity; i++) {
            cutRecords.push({
              fileId: cut.fileId,
              type: cut.type as any,
              status: cutStatus as any,
              statusOrder: getCutStatusOrder(cutStatus),
              origin: cut.origin as any,
              reason: cut.reason ? (cut.reason as any) : null,
              parentCutId: cut.parentCutId || null,
            } as any);
          }
        }
      }

      if (cutRecords.length > 0) {
        // Use create-only (additive) when cuts array was provided.
        // The deleteMany+create pattern destroys existing cuts (including in-progress ones).
        // Callers that need to remove specific cuts should use removeCutIds instead.
        updateData.cuts = {
          create: cutRecords,
        };
      } else if (
        (cut === null && cuts === undefined) ||
        cuts === null ||
        (cuts !== undefined && cuts.length === 0)
      ) {
        updateData.cuts = { deleteMany: {} };
      }
    }

    const airbrushings = (extendedData as any).airbrushings;
    // The single-update SERVICE path handles airbrushing create/update itself
    // (painter validation, File→Layout resolution, per-entity changelog) and
    // delegates ONLY the notIn-delete to this mapper. The batch path has no such
    // service-layer airbrushing handling, so it opts into full create+update
    // here via the `_applyAirbrushingsFully` marker. Without the marker we keep
    // the historical delete-only behavior so single-update never double-creates.
    const applyAirbrushingsFully = (extendedData as any)._applyAirbrushingsFully === true;

    if (airbrushings !== undefined) {
      if (airbrushings === null || (Array.isArray(airbrushings) && airbrushings.length === 0)) {
        updateData.airbrushings = { deleteMany: {} };
      } else if (Array.isArray(airbrushings) && airbrushings.length > 0) {
        // A persisted airbrushing carries a real UUID id; a brand-new one sent by
        // the form has a temp id (`airbrushing-...`) or no id at all.
        const existingAirbrushings = airbrushings.filter(
          (item: any) =>
            item.id && typeof item.id === 'string' && !item.id.startsWith('airbrushing-'),
        );
        const newAirbrushings = airbrushings.filter(
          (item: any) =>
            !item.id || typeof item.id !== 'string' || item.id.startsWith('airbrushing-'),
        );
        const idsToKeep = existingAirbrushings.map((item: any) => item.id);

        if (!applyAirbrushingsFully) {
          // Single-update path: delete-only (notIn), service layer does the rest.
          if (idsToKeep.length > 0) {
            updateData.airbrushings = {
              deleteMany: { id: { notIn: idsToKeep } },
            };
            this.logger.log(
              `[mapUpdateFormDataToDatabaseUpdateInput] Airbrushings: keeping ${idsToKeep.length} existing, deleting others`,
            );
          }
        } else {
          // Batch path: full create + update + notIn-delete in one nested write.
          //
          // Build a scalar/relation create payload for a new airbrushing.
          // layouts: a NEW airbrushing has nothing to preserve, so connect the
          // Layout ids the form selected (mirrors the nested task-create path).
          // Without this, batch-created airbrushings silently dropped their
          // layouts. (Existing-airbrushing UPDATES below still leave layouts
          // untouched — resolving File→Layout there needs the service helper the
          // repository can't reach, so absence = preserve.)
          // Sem aerografista, nasce em cotação — mesma regra do caminho de criação.
          const buildCreate = (item: any) => {
            const status = resolveNewAirbrushingStatus(item.status, item.painterId);
            const quoting = status === AIRBRUSHING_STATUS.QUOTING;
            return {
              status,
              statusOrder: getAirbrushingStatusOrder(status),
              quotationOpenedAt: quoting ? new Date() : null,
              price:
                !quoting && item.price !== undefined && item.price !== null
                  ? Number(item.price)
                  : null,
              description: item.description || null,
              startDate: item.startDate || null,
              finishDate:
                computeExpectedFinishDate(
                  item.startDate,
                  item.executionTime,
                  item.executionTimeUnit,
                ) ??
                (item.finishDate || null),
              executionTime: item.executionTime ?? null,
              executionTimeUnit: item.executionTimeUnit ?? null,
              quotationOfferAmount: quoting ? (item.quotationOfferAmount ?? null) : null,
              quotationOfferExecutionTime: quoting
                ? (item.quotationOfferExecutionTime ?? null)
                : null,
              quotationOfferExecutionTimeUnit: quoting
                ? (item.quotationOfferExecutionTimeUnit ?? null)
                : null,
              startedAt: item.startedAt || null,
              finishedAt: item.finishedAt || null,
              paymentStatus: item.paymentStatus || 'PENDING',
              painter: !quoting && item.painterId ? { connect: { id: item.painterId } } : undefined,
              layouts:
                item.layoutIds && item.layoutIds.length > 0
                  ? { connect: item.layoutIds.map((aid: string) => ({ id: aid })) }
                  : undefined,
              receipts:
                item.receiptIds && item.receiptIds.length > 0
                  ? { connect: item.receiptIds.map((fid: string) => ({ id: fid })) }
                  : undefined,
              invoices:
                item.invoiceIds && item.invoiceIds.length > 0
                  ? { connect: item.invoiceIds.map((fid: string) => ({ id: fid })) }
                  : undefined,
            };
          };

          // Build a scalar/relation update payload for an existing airbrushing.
          // Only fields actually sent are written (absence = preserve). File
          // relations use `set` when explicitly provided (mirrors the service path).
          const buildUpdateData = (item: any) => {
            const d: any = {};
            if (item.status !== undefined) d.status = item.status || 'PENDING';
            if (item.price !== undefined) {
              d.price = item.price !== null ? Number(item.price) : null;
            }
            if (item.description !== undefined) d.description = item.description || null;
            if (item.startDate !== undefined) d.startDate = item.startDate || null;
            if (item.finishDate !== undefined) d.finishDate = item.finishDate || null;
            if (item.executionTime !== undefined) d.executionTime = item.executionTime ?? null;
            if (item.executionTimeUnit !== undefined) {
              d.executionTimeUnit = item.executionTimeUnit ?? null;
            }
            // Término previsto derivado quando o lote traz início + tempo juntos.
            if (item.startDate !== undefined && item.executionTime && item.executionTimeUnit) {
              d.finishDate = computeExpectedFinishDate(
                item.startDate,
                item.executionTime,
                item.executionTimeUnit,
              );
            }
            if (item.startedAt !== undefined) d.startedAt = item.startedAt || null;
            if (item.finishedAt !== undefined) d.finishedAt = item.finishedAt || null;
            if (item.paymentStatus !== undefined) d.paymentStatus = item.paymentStatus;
            if (item.painterId !== undefined) {
              d.painter = item.painterId
                ? { connect: { id: item.painterId } }
                : { disconnect: true };
            }
            if (item.receiptIds !== undefined) {
              d.receipts = { set: (item.receiptIds || []).map((fid: string) => ({ id: fid })) };
            }
            if (item.invoiceIds !== undefined) {
              d.invoices = { set: (item.invoiceIds || []).map((fid: string) => ({ id: fid })) };
            }
            return d;
          };

          const airbrushingsUpdate: any = {};
          // Delete only the airbrushings the form dropped (notIn the kept set).
          // When every submitted airbrushing is new there is nothing to keep, so
          // wipe the prior set before recreating.
          airbrushingsUpdate.deleteMany = idsToKeep.length > 0 ? { id: { notIn: idsToKeep } } : {};
          if (newAirbrushings.length > 0) {
            airbrushingsUpdate.create = newAirbrushings.map(buildCreate);
          }
          if (existingAirbrushings.length > 0) {
            airbrushingsUpdate.update = existingAirbrushings.map((item: any) => ({
              where: { id: item.id },
              data: buildUpdateData(item),
            }));
          }
          updateData.airbrushings = airbrushingsUpdate;
          this.logger.log(
            `[mapUpdateFormDataToDatabaseUpdateInput] Airbrushings (batch full): ${existingAirbrushings.length} update, ${newAirbrushings.length} create, deleting others`,
          );
        }
      }
    }

    this.logger.log(
      '[mapUpdateFormDataToDatabaseUpdateInput] Final updateData:',
      JSON.stringify(updateData, null, 2),
    );

    return updateData;
  }

  private processNestedInclude(value: any): any {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'object' && value !== null) {
      if ('include' in value) {
        const processedInclude: any = {};
        Object.keys(value.include).forEach(nestedKey => {
          processedInclude[nestedKey] = this.processNestedInclude(value.include[nestedKey]);
        });

        return {
          ...value,
          include: processedInclude,
        };
      }

      const processed: any = {};
      Object.keys(value).forEach(k => {
        processed[k] = this.processNestedInclude(value[k]);
      });
      return processed;
    }

    return value;
  }

  protected mapIncludeToDatabaseInclude(include?: TaskInclude): Prisma.TaskInclude | undefined {
    if (!include) {
      return this.getDefaultInclude();
    }

    this.logger.log(
      '[mapIncludeToDatabaseInclude] Input include:',
      JSON.stringify(include, null, 2),
    );

    const databaseInclude: any = { ...this.getDefaultInclude() };

    Object.keys(include).forEach(key => {
      const value = include[key as keyof TaskInclude];

      if (typeof value === 'boolean') {
        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = value;
        } else if (key === 'serviceOrders') {
          if (value === false) {
            databaseInclude.serviceOrders = false;
          }
        } else {
          if (value === false || !databaseInclude[key]) {
            databaseInclude[key] = value;
          }
        }
      } else if (typeof value === 'object' && value !== null && 'include' in value) {
        const processedValue = this.processNestedInclude(value);

        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = processedValue;
        } else if (key === 'serviceOrders') {
          const existingValue = databaseInclude.serviceOrders;
          if (existingValue && typeof existingValue === 'object' && 'include' in existingValue) {
            databaseInclude.serviceOrders = {
              ...existingValue,
              include: { ...existingValue.include, ...processedValue.include },
            };
          } else {
            databaseInclude.serviceOrders = processedValue;
          }
        } else {
          const existingValue = databaseInclude[key];
          if (existingValue && typeof existingValue === 'object' && 'include' in existingValue) {
            databaseInclude[key] = {
              ...existingValue,
              include: { ...existingValue.include, ...processedValue.include },
            };
          } else {
            databaseInclude[key] = processedValue;
          }
        }
      } else if (typeof value === 'object' && value !== null && 'select' in value) {
        // Handle objects with select (e.g., serviceOrders: { select: { id: true, type: true } })
        // Select replaces the default include entirely since it's more restrictive
        if (key === 'nfeReimbursements') {
          databaseInclude.invoiceReimbursements = value;
        } else {
          databaseInclude[key] = this.sanitizeSelectFields(key, value);
        }
      }
    });

    // ─── A COBERTURA DO FATURAMENTO ENTRA SEMPRE ─────────────────────────────
    //
    // O merge acima deixa o `customerConfigs` do CHAMADOR substituir o do padrão,
    // e é isso que a tela de Faturamento faz (ela pede cliente, parcelas e
    // responsável). Sem esta injeção, ela receberia as faturas sem a cobertura e
    // não teria como dizer de qual caminhão é cada uma — que é justamente o que
    // ela precisa mostrar. Um único ponto de injeção, no fim, para que nenhuma
    // tela futura possa esquecer.
    const quoteNode = databaseInclude.quote;
    if (quoteNode && typeof quoteNode === 'object') {
      const nested = (quoteNode.include ?? quoteNode.select) as Record<string, unknown> | undefined;
      if (nested && nested.customerConfigs !== undefined && nested.customerConfigs !== false) {
        nested.customerConfigs = withCoverageInclude(nested.customerConfigs);
      }
      // ─── E A COBERTURA DE CADA ARTE DE LAYOUT, pelo mesmo motivo ─────────
      //
      // A tela de Faturamento lê o orçamento por AQUI (`quote: { include: {
      // layoutFiles: true } }`), e num orçamento com layout por veículo a arte
      // sem `quoteLayoutTasks` não diz de qual caminhão é. `layoutScope` chega
      // sozinho quando o nó é `include` (escalar); num `select` à mão ele só vem
      // se pedido, então é pendurado junto.
      if (nested && nested.layoutFiles !== undefined && nested.layoutFiles !== false) {
        nested.layoutFiles = withLayoutCoverageInclude(nested.layoutFiles);
        if (quoteNode.select && !('layoutScope' in (quoteNode.select as object))) {
          (quoteNode.select as Record<string, unknown>).layoutScope = true;
        }
      }
    }

    this.logger.log(
      '[mapIncludeToDatabaseInclude] Output include for Prisma:',
      JSON.stringify(databaseInclude, null, 2),
    );

    return databaseInclude as Prisma.TaskInclude;
  }

  /**
   * Sanitizes select objects before passing to Prisma:
   * - ServiceOrder: maps `name` → `description` (ServiceOrder has no `name` field)
   *
   * G1: esta tradução está registrada em `DEPRECATED_QUERY_KEYS`
   * (`ServiceOrder.select.name`, handledBy este método) — a tabela é a única
   * lista de chaves que o Prisma não conhece; sem a linha, o G1 recusaria com
   * 400 o que aqui vira 200.
   */
  private sanitizeSelectFields(relationKey: string, value: any): any {
    if (!value || typeof value !== 'object' || !('select' in value)) return value;

    const select = { ...value.select };

    if (relationKey === 'serviceOrders') {
      // ServiceOrder has no `name` field — map to `description`
      if ('name' in select) {
        select.description = select.name;
        delete select.name;
      }
    }

    return { ...value, select };
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: TaskOrderBy,
  ): Prisma.TaskOrderByWithRelationInput | undefined {
    return orderBy as Prisma.TaskOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: TaskWhere): Prisma.TaskWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.TaskWhereInput;
  }

  protected getDefaultInclude(): Prisma.TaskInclude {
    return DEFAULT_TASK_INCLUDE;
  }

  // =====================
  // Transaction Methods
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: TaskCreateFormData,
    options?: CreateOptions<TaskInclude>,
  ): Promise<Task> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const quoteData = (data as any).quote;
      let createdPricingId: string | null = null;

      if (
        quoteData &&
        typeof quoteData === 'object' &&
        quoteData.services &&
        Array.isArray(quoteData.services) &&
        quoteData.services.length > 0
      ) {
        const calculatedSubtotal = quoteData.services.reduce(
          (sum: number, item: any) => sum + Number(item.amount || 0),
          0,
        );
        const subtotal =
          quoteData.subtotal !== undefined ? Number(quoteData.subtotal) : calculatedSubtotal;
        const total = quoteData.total !== undefined ? Number(quoteData.total) : calculatedSubtotal;

        const nextBudgetNumber = await allocateBudgetNumber(transaction);

        // Clone any implementMeasure File owned by another quote so the new quote owns an
        // INDEPENDENT copy — connecting the source ids would steal them (FK on File).
        const resolvedImplementMeasureIds =
          quoteData.layoutFileIds !== undefined
            ? await this.fileService.resolveLayoutFileIdsForQuote(
                transaction,
                null,
                quoteData.layoutFileIds ?? [],
              )
            : undefined;
        const layoutFileConnect =
          resolvedImplementMeasureIds !== undefined
            ? {
                layoutFiles: {
                  connect: resolvedImplementMeasureIds.map((fid: string) => ({ id: fid })),
                },
              }
            : {};

        const newQuote = await transaction.budget.create({
          data: {
            budgetNumber: nextBudgetNumber,
            subtotal,
            total,
            expiresAt: quoteData.expiresAt ? new Date(quoteData.expiresAt) : new Date(),
            status: quoteData.status || 'PENDING',
            // Persist the status sort key on create too — omitting it stored the
            // column @default(1) on every new quote (PENDING's real order is 8),
            // corrupting statusOrder-based sorting until the next update.
            statusOrder:
              TASK_QUOTE_STATUS_ORDER[(quoteData.status || 'PENDING') as TASK_QUOTE_STATUS],
            guaranteeYears: quoteData.guaranteeYears || null,
            customGuaranteeText: quoteData.customGuaranteeText || null,
            customForecastDays: quoteData.customForecastDays || null,
            simultaneousTasks: quoteData.simultaneousTasks ?? null,
            ...(quoteData.billingSplit && { billingSplit: quoteData.billingSplit }),
            ...layoutFileConnect,
            // ⚠️ OS PAGADORES NÃO NASCEM AQUI — ver `reconcileQuoteCustomerConfigs`
            // logo após a criação da tarefa.
            //
            // `customerConfigs` aninhado em `budget.create` é a forma de ANTES do
            // `Billing`: desde a migração que introduziu o faturamento como
            // entidade, `BudgetPayer.billingId` é OBRIGATÓRIO, e um pagador criado
            // por esta relação não tem faturamento a que pertencer. O Prisma
            // respondia "Argument `billing` is missing" e TODA criação de tarefa
            // com orçamento aninhado morria em 500 — o caminho de "criar a partir
            // de uma tarefa do histórico", que é justamente o que manda as fatias
            // já preenchidas.
            //
            // O pagador mora DENTRO de um faturamento, e o faturamento precisa da
            // cobertura (`BillingTask` → `Task`), que só existe depois que a
            // tarefa nasce. Por isso a reconciliação é feita lá, e não aqui.
            services: {
              create: quoteData.services.map((item: any) => ({
                description: item.description,
                observation: item.observation || null,
                amount: Number(item.amount || 0),
                ...(item.invoiceToCustomerId && {
                  invoiceToCustomer: { connect: { id: item.invoiceToCustomerId } },
                }),
              })),
            },
          },
        });

        createdPricingId = newQuote.id;

        // Os totais ficam para DEPOIS do vínculo com a tarefa: `recalcQuoteTotals`
        // conta os veículos do orçamento, e neste instante ele ainda não tem
        // nenhum — a tarefa nasce a seguir. Recalcular aqui gravaria
        // `vehicleCount: 1` e o total de um orçamento sem veículo.
      }

      if (createdPricingId) {
        createInput.quote = {
          connect: { id: createdPricingId },
        };
      }

      const result = await transaction.task.create({
        data: createInput,
        include: includeInput,
      });

      if (createdPricingId) {
        // ─── OS PAGADORES E OS FATURAMENTOS, agora que o veículo existe ─────
        //
        // Aqui, e não dentro do `budget.create`: o pagador pertence a um
        // `Billing`, o `Billing` declara quais veículos cobre, e o veículo acabou
        // de nascer na linha acima. `reconcileQuoteCustomerConfigs` é o MESMO
        // caminho que a edição usa — um código só para os dois, para que não
        // possam divergir de novo.
        //
        // `taskIds` é passado explicitamente: o vínculo tarefa↔orçamento acabou
        // de ser gravado nesta transação, e deixar a função ler do banco a
        // devolveria vazia num caminho ou outro conforme a visibilidade.
        if (Array.isArray(quoteData?.customerConfigs) && quoteData.customerConfigs.length > 0) {
          await reconcileQuoteCustomerConfigs(
            transaction,
            createdPricingId,
            quoteData.customerConfigs as any,
            { billingSplit: quoteData.billingSplit ?? null, taskIds: [result.id] },
          );
        }

        // O orçamento nasce ANTES da tarefa neste caminho (o id dele é o
        // `connect` da tarefa), então as faturas nasceram sem cobertura. Sem esta
        // chamada elas ficariam sem resposta para "de qual veículo é isto?" — e a
        // aritmética, que multiplica pelo que a fatura cobre, cairia no padrão.
        await resliceQuoteCoverage(transaction, createdPricingId);

        // Só agora os totais: `recalcQuoteTotals` conta os veículos e multiplica
        // por eles, e o veículo passou a existir nesta linha.
        await recalcQuoteTotals(transaction, createdPricingId);
      }

      // Task↔quote link now exists: materialize any quote layout file as an
      // APPROVED task layout.
      if (createdPricingId && quoteData?.layoutFileIds !== undefined) {
        await syncTaskLayoutsFromQuote(transaction, createdPricingId, undefined);
      }

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      super.logError('criar tarefa', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<TaskInclude>,
  ): Promise<Task | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.task.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      super.logError(`buscar tarefa por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<TaskInclude>,
  ): Promise<Task[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.task.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      super.logError('buscar tarefas por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<TaskOrderBy, TaskWhere, TaskInclude>,
  ): Promise<FindManyResult<Task>> {
    const queryOptions = (options as any) || {};
    const { where, orderBy, page = 1, include, select } = queryOptions;
    const take = queryOptions.take || queryOptions.limit || 20;
    const skip = Math.max(0, (page - 1) * take);

    const mappedWhere = this.mapWhereToDatabaseWhere(where);
    const countOptions = mappedWhere ? { where: mappedWhere } : undefined;

    // Prioritize explicit select over include and optimal query pattern
    const useProvidedSelect = select && Object.keys(select).length > 0;
    const queryPattern = useProvidedSelect ? { select } : this.getOptimalQueryPattern(options);

    // "Vencimento" can't be ordered by in SQL (see DUE_DATE_SORT_KEY) — sort the
    // whole matching set in memory, then paginate, so page 2 really continues page 1.
    const sortEntries = flattenOrderBy(orderBy);
    if (sortEntries.some(entry => entry.path === DUE_DATE_SORT_KEY)) {
      return this.findManyWithDueDateSort(transaction, {
        mappedWhere,
        sortEntries,
        queryPattern,
        useProvidedSelect,
        page,
        take,
        skip,
      });
    }

    const baseOrderBy = this.mapOrderByToDatabaseOrderBy(orderBy) || { statusOrder: 'asc' };
    // Always append id as tiebreaker to guarantee stable pagination when sort values are equal
    const stableOrderBy: any = Array.isArray(baseOrderBy)
      ? [...baseOrderBy, { id: 'asc' }]
      : [baseOrderBy, { id: 'asc' }];

    const [total, tasks] = await Promise.all([
      transaction.task.count(countOptions),
      transaction.task.findMany({
        where: mappedWhere,
        orderBy: stableOrderBy,
        skip,
        take,
        ...queryPattern,
      }),
    ]);

    if (total > 0 && tasks.length === 0 && skip === 0) {
      this.logger.warn(
        '[TaskRepository] WARNING: Count returned records but findMany returned empty!',
      );
    }

    // When using custom select, don't try to map the entity (just return as-is)
    return {
      data: useProvidedSelect
        ? (tasks as any[])
        : tasks.map(task => this.mapDatabaseEntityToEntity(task)),
      meta: super.calculatePagination(total, page, take),
    };
  }

  /**
   * findMany variant for sorts that include the computed "Vencimento" key
   * (DUE_DATE_SORT_KEY). Scans every matching task with a light select, sorts the
   * full set in memory honouring the requested sort priority, then hydrates only
   * the requested page with the caller's include/select.
   */
  private async findManyWithDueDateSort(
    transaction: PrismaTransaction,
    params: {
      mappedWhere: Prisma.TaskWhereInput | undefined;
      sortEntries: FlatSortEntry[];
      queryPattern: any;
      useProvidedSelect: boolean;
      page: number;
      take: number;
      skip: number;
    },
  ): Promise<FindManyResult<Task>> {
    const { mappedWhere, sortEntries, queryPattern, useProvidedSelect, page, take, skip } = params;

    const scanned = await transaction.task.findMany({
      where: mappedWhere,
      select: TASK_SELECT_DUE_DATE_SORT,
    });

    const rows = scanned.map(row => ({
      row,
      dueDate: resolveCurrentInstallmentDueDate(row),
    }));

    rows.sort((a, b) => {
      for (const entry of sortEntries) {
        const aValue =
          entry.path === DUE_DATE_SORT_KEY ? a.dueDate : resolveSortValue(a.row, entry.path);
        const bValue =
          entry.path === DUE_DATE_SORT_KEY ? b.dueDate : resolveSortValue(b.row, entry.path);

        const aNull = aValue === null || aValue === undefined;
        const bNull = bValue === null || bValue === undefined;
        if (aNull && bNull) continue;
        // Nulls last by default regardless of direction — a task without a due date
        // never outranks one that has it, in either direction.
        if (aNull || bNull) {
          const nullsFirst = entry.nulls === 'first';
          return aNull ? (nullsFirst ? -1 : 1) : nullsFirst ? 1 : -1;
        }

        const comparison = compareSortValues(aValue, bValue);
        if (comparison !== 0) return entry.direction === 'desc' ? -comparison : comparison;
      }
      // Stable tiebreaker, mirroring the id tiebreaker of the SQL-ordered path
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
    });

    const total = rows.length;
    const pageIds = rows.slice(skip, skip + take).map(item => item.row.id);

    if (pageIds.length === 0) {
      return { data: [], meta: super.calculatePagination(total, page, take) };
    }

    // Hydrating by id loses SQL ordering, so restore the in-memory order afterwards.
    const hydratePattern = queryPattern?.select
      ? { select: { ...queryPattern.select, id: true } }
      : queryPattern;

    const tasks = await transaction.task.findMany({
      where: { id: { in: pageIds } },
      ...hydratePattern,
    });

    const byId = new Map(tasks.map(task => [(task as any).id, task]));
    const ordered = pageIds.map(id => byId.get(id)).filter(Boolean) as any[];

    return {
      data: useProvidedSelect ? ordered : ordered.map(task => this.mapDatabaseEntityToEntity(task)),
      meta: super.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: TaskUpdateFormData,
    options?: UpdateOptions<TaskInclude>,
    userId?: string,
  ): Promise<Task> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data, userId);

      // A liberação segue o caminhão, não a previsão (ver utils/task-cleared.ts): se a
      // tarefa já tem data de entrada, o auto-unclear derivado de `forecastDate` acima
      // não pode revogá-la. Um `cleared` explícito no payload já venceu a derivação lá
      // dentro e não é tocado aqui. Data de entrada efetiva = a do payload quando ele a
      // traz (inclusive `null`, que é remover a entrada), senão a que está gravada.
      if (updateInput.cleared === false && (data as any).cleared === undefined) {
        const effectiveEntryDate =
          (data as any).entryDate !== undefined
            ? (data as any).entryDate
            : (
                await transaction.task.findUnique({
                  where: { id },
                  select: { entryDate: true },
                })
              )?.entryDate;

        if (hasEntered(effectiveEntryDate)) {
          updateInput.cleared = true;
        }
      }

      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const quoteData = (data as any).quote;
      // Quote whose layout files must be reconciled into APPROVED task layouts
      // once the task↔quote link is settled (set below in whichever branch runs).
      let quoteIdForLayoutSync: string | null = null;

      if (quoteData !== undefined && quoteData !== null) {
        const hasServices =
          typeof quoteData === 'object' &&
          Array.isArray(quoteData.services) &&
          quoteData.services.length > 0;
        const hasConfigs = typeof quoteData === 'object' && quoteData.customerConfigs !== undefined;
        const hasImplementMeasure =
          typeof quoteData === 'object' && quoteData.layoutFileIds !== undefined;
        const hasQuoteScalars =
          typeof quoteData === 'object' &&
          (quoteData.expiresAt !== undefined ||
            quoteData.status !== undefined ||
            quoteData.guaranteeYears !== undefined ||
            quoteData.customGuaranteeText !== undefined ||
            quoteData.customForecastDays !== undefined ||
            quoteData.simultaneousTasks !== undefined);

        // Decouple the quote-write decision from `services` presence. A config /
        // discount / implementMeasure / scalar-only edit (services stripped as no-ops
        // upstream) must still persist — gating the whole branch on
        // services.length>0 silently dropped discount-only edits (200 OK, change
        // vanished on reload).
        if (hasServices || hasConfigs || hasImplementMeasure || hasQuoteScalars) {
          const hasNewItems = hasServices && quoteData.services.some((item: any) => !item.id);

          const currentTask = await transaction.task.findUnique({
            where: { id },
            select: { quoteId: true },
          });

          // ── ESTA PORTA NÃO ALTERA O QUE MOVE DINHEIRO OU ASSINATURA ─────────
          //
          // `PUT /tasks/:id` aceitava um bloco `quote` aninhado que mudava status,
          // serviços e pagadores, refatiava a cobertura e recalculava totais — sem
          // nenhuma guarda do serviço de orçamento e sem `onQuoteContentChanged`.
          // Era o único ponto da API capaz de fazer alteração MATERIAL sem reavaliar
          // a coleta de assinaturas: o cliente assinava um PDF e o valor mudava
          // embaixo dele, com a assinatura continuando válida.
          //
          // A guarda vale para ALTERAR um orçamento que já existe. CRIAR um
          // orçamento a partir da tarefa continua podendo mandar serviços e
          // pagadores — é a única forma de o orçamento nascer com conteúdo, e
          // nesse instante não há assinatura nem faturamento para proteger.
          if (currentTask?.quoteId) {
            const forbiddenHere: string[] = [];
            if (typeof quoteData === 'object' && quoteData) {
              if (quoteData.status !== undefined) forbiddenHere.push('status');
              if (hasServices) forbiddenHere.push('serviços');
              if (hasConfigs) forbiddenHere.push('faturamentos');
              if ((quoteData as any).billingSplit !== undefined)
                forbiddenHere.push('forma de faturamento');

              // ── OS ESCALARES MATERIAIS TAMBÉM SÃO MATERIAIS ────────────────
              //
              // A guarda cobria status, serviços, pagadores e modo. Mas validade,
              // garantia, prazo e o LAYOUT de referência estão todos na
              // `materialProjection` do diff de assinatura — e passavam por aqui
              // sem reavaliar coleta nenhuma. Trocar o layout de um orçamento
              // ASSINADO por esta porta é exatamente o incidente do nº 973, pelos
              // fundos: a correção daquele dia mora no serviço de orçamento, e
              // nada aqui a chama.
              //
              // ⚠️ SÓ QUANDO MUDA DE VALOR. O formulário da tarefa reenvia o bloco
              // inteiro a cada gravação, então recusar pela PRESENÇA derrubaria
              // toda edição de tarefa que tenha orçamento. Compara-se com o que
              // está gravado: eco passa, mudança é redirecionada para a tela que
              // sabe invalidar.
              const atual = await transaction.budget.findUnique({
                where: { id: currentTask.quoteId },
                select: {
                  expiresAt: true,
                  guaranteeYears: true,
                  customGuaranteeText: true,
                  customForecastDays: true,
                  simultaneousTasks: true,
                  layoutScope: true,
                  layoutFiles: { select: { id: true } },
                },
              });
              const mudou = (novo: unknown, velho: unknown): boolean => {
                if (novo === undefined) return false;
                if (novo instanceof Date || velho instanceof Date) {
                  return new Date(novo as any).getTime() !== new Date(velho as any).getTime();
                }
                return (novo ?? null) !== (velho ?? null);
              };
              if (atual) {
                if (mudou((quoteData as any).expiresAt, atual.expiresAt))
                  forbiddenHere.push('validade');
                if (mudou((quoteData as any).guaranteeYears, atual.guaranteeYears))
                  forbiddenHere.push('garantia');
                if (mudou((quoteData as any).customGuaranteeText, atual.customGuaranteeText))
                  forbiddenHere.push('texto de garantia');
                if (mudou((quoteData as any).customForecastDays, atual.customForecastDays))
                  forbiddenHere.push('prazo de execução');
                if (mudou((quoteData as any).simultaneousTasks, atual.simultaneousTasks))
                  forbiddenHere.push('veículos simultâneos');
                if (hasImplementMeasure) {
                  const pedidos = [...((quoteData as any).layoutFileIds ?? [])].sort().join('|');
                  const gravados = atual.layoutFiles
                    .map(f => f.id)
                    .sort()
                    .join('|');
                  // LAYOUT POR VEÍCULO: a lista crua de ids não diz de qual
                  // caminhão cada arte é. Conjunto igual é o eco do formulário e
                  // passa SEM TOCAR em nada (ver `layoutEcho` abaixo); diferente
                  // é recusado com o endereço da única tela que atribui arte a
                  // veículo.
                  if (pedidos !== gravados && (atual as any).layoutScope === 'PER_VEHICLE') {
                    throw new BadRequestException(PER_VEHICLE_LEGACY_WRITE_MESSAGE);
                  }
                  if (pedidos !== gravados) forbiddenHere.push('layout de referência');
                }
              }
            }
            if (forbiddenHere.length > 0) {
              throw new BadRequestException(
                `Alteração de ${forbiddenHere.join(', ')} do orçamento não pode ser feita pela tarefa. ` +
                  'Use a tela de Orçamento (PUT /budgets/:id), que valida a transição, recalcula os ' +
                  'totais e reavalia as assinaturas já coletadas.',
              );
            }

            // Chegando aqui, `layoutFileIds` é o MESMO conjunto gravado (a guarda
            // acima recusa o resto). Num orçamento por veículo esse eco não
            // regrava nada — nem a relação, nem a galeria das tarefas: a
            // cobertura de cada arte fica exatamente como o comercial deixou.
            const layoutEchoOnPerVehicle =
              hasImplementMeasure &&
              (
                await transaction.budget.findUnique({
                  where: { id: currentTask.quoteId },
                  select: { layoutScope: true },
                })
              )?.layoutScope === 'PER_VEHICLE';

            // Clone any implementMeasure File owned by ANOTHER quote so this quote owns an
            // INDEPENDENT copy — a raw `set` of foreign ids would steal them.
            const resolvedImplementMeasureIds =
              hasImplementMeasure && !layoutEchoOnPerVehicle
                ? await this.fileService.resolveLayoutFileIdsForQuote(
                    transaction,
                    currentTask.quoteId,
                    quoteData.layoutFileIds ?? [],
                  )
                : undefined;
            const layoutFileUpdate =
              resolvedImplementMeasureIds !== undefined
                ? {
                    layoutFiles: {
                      set: resolvedImplementMeasureIds.map((fid: string) => ({ id: fid })),
                    },
                  }
                : {};

            await transaction.budget.update({
              where: { id: currentTask.quoteId },
              data: {
                expiresAt: quoteData.expiresAt ? new Date(quoteData.expiresAt) : undefined,
                status: quoteData.status || undefined,
                ...(quoteData.status && {
                  statusOrder: TASK_QUOTE_STATUS_ORDER[quoteData.status as TASK_QUOTE_STATUS],
                }),
                guaranteeYears:
                  quoteData.guaranteeYears !== undefined ? quoteData.guaranteeYears : undefined,
                customGuaranteeText:
                  quoteData.customGuaranteeText !== undefined
                    ? quoteData.customGuaranteeText
                    : undefined,
                customForecastDays:
                  quoteData.customForecastDays !== undefined
                    ? quoteData.customForecastDays
                    : undefined,
                simultaneousTasks:
                  quoteData.simultaneousTasks !== undefined
                    ? quoteData.simultaneousTasks
                    : undefined,
                ...layoutFileUpdate,
                // Services: rewrite ONLY when actually sent. Omitting them (a
                // config/implementMeasure-only edit) must never wipe the existing services.
                ...(hasServices && {
                  services: {
                    deleteMany: {},
                    create: quoteData.services.map((item: any, index: number) => ({
                      description: item.description,
                      observation: item.observation || null,
                      amount: Number(item.amount || 0),
                      position: index,
                      ...(item.invoiceToCustomerId && {
                        invoiceToCustomer: { connect: { id: item.invoiceToCustomerId } },
                      }),
                    })),
                  },
                }),
              },
            });

            if (hasImplementMeasure && !layoutEchoOnPerVehicle) {
              quoteIdForLayoutSync = currentTask.quoteId;
            }

            // Configs: non-destructive upsert by (quoteId, customerId) — preserves
            // issued Invoice/Installments and DB-owned fields (customerSignatureId,
            // paymentConfig) the task form never resends, and never
            // cascade-deletes an issued invoice.
            if (hasConfigs) {
              await reconcileQuoteCustomerConfigs(
                transaction,
                currentTask.quoteId,
                quoteData.customerConfigs as any,
              );
            }

            // Authoritative, discount-aware recompute from the persisted services +
            // configs — never trust the client-supplied subtotal/total.
            if (hasServices || hasConfigs) {
              await recalcQuoteTotals(transaction, currentTask.quoteId);
            }
          } else if (hasNewItems) {
            const nextBudgetNumber = await allocateBudgetNumber(transaction);

            const calculatedSubtotal = quoteData.services.reduce(
              (sum: number, item: any) => sum + Number(item.amount || 0),
              0,
            );

            // Clone any implementMeasure File owned by another quote so the new quote owns
            // an INDEPENDENT copy — connecting source ids would steal them.
            const resolvedImplementMeasureIds =
              quoteData.layoutFileIds !== undefined
                ? await this.fileService.resolveLayoutFileIdsForQuote(
                    transaction,
                    null,
                    quoteData.layoutFileIds ?? [],
                  )
                : undefined;
            const layoutFileConnect =
              resolvedImplementMeasureIds !== undefined
                ? {
                    layoutFiles: {
                      connect: resolvedImplementMeasureIds.map((fid: string) => ({ id: fid })),
                    },
                  }
                : {};

            const newQuote = await transaction.budget.create({
              data: {
                budgetNumber: nextBudgetNumber,
                subtotal: calculatedSubtotal,
                total: calculatedSubtotal,
                expiresAt: quoteData.expiresAt ? new Date(quoteData.expiresAt) : new Date(),
                status: quoteData.status || 'PENDING',
                statusOrder:
                  TASK_QUOTE_STATUS_ORDER[(quoteData.status || 'PENDING') as TASK_QUOTE_STATUS],
                guaranteeYears: quoteData.guaranteeYears || null,
                customGuaranteeText: quoteData.customGuaranteeText || null,
                customForecastDays: quoteData.customForecastDays || null,
                simultaneousTasks: quoteData.simultaneousTasks ?? null,
                ...(quoteData.billingSplit && { billingSplit: quoteData.billingSplit }),
                ...layoutFileConnect,
                // ⚠️ OS PAGADORES NÃO NASCEM AQUI — ver a nota gêmea no caminho de
                // criação. `BudgetPayer.billingId` é obrigatório desde que o
                // faturamento virou entidade, e aninhar `customerConfigs` em
                // `budget.create` pedia um pagador sem faturamento: "Argument
                // `billing` is missing", 500 na gravação inteira. A reconciliação
                // é feita abaixo, depois que a tarefa está vinculada.
                services: {
                  create: quoteData.services.map((item: any, index: number) => ({
                    description: item.description,
                    observation: item.observation || null,
                    amount: Number(item.amount || 0),
                    position: index,
                    ...(item.invoiceToCustomerId && {
                      invoiceToCustomer: { connect: { id: item.invoiceToCustomerId } },
                    }),
                  })),
                },
              },
            });

            // Recompute discount-aware totals from the freshly-created rows.
            // A COBERTURA vem antes: o vínculo com esta tarefa é gravado no
            // `task.update` logo abaixo, mas a tarefa JÁ EXISTE (estamos
            // atualizando), então basta declará-la aqui para que as faturas
            // nasçam cobrindo-a e os totais saiam certos de primeira.
            await transaction.task.update({ where: { id }, data: { quoteId: newQuote.id } });

            // Os pagadores e seus faturamentos, agora que o veículo pertence a
            // este orçamento — o mesmo caminho da edição, logo acima.
            if (Array.isArray(quoteData.customerConfigs) && quoteData.customerConfigs.length > 0) {
              await reconcileQuoteCustomerConfigs(
                transaction,
                newQuote.id,
                quoteData.customerConfigs as any,
                { billingSplit: quoteData.billingSplit ?? null, taskIds: [id] },
              );
            }

            await resliceQuoteCoverage(transaction, newQuote.id);
            await recalcQuoteTotals(transaction, newQuote.id);

            if (hasImplementMeasure) quoteIdForLayoutSync = newQuote.id;

            updateInput.quote = {
              connect: { id: newQuote.id },
            };
          }
        }
      }

      // ─── O VÍNCULO COM O ORÇAMENTO ESTÁ MUDANDO? ─────────────────────────
      //
      // Mover a tarefa para outro orçamento (ou desvinculá-la) muda a CONTAGEM
      // de veículos dos dois lados, e a contagem é o multiplicador de todo total
      // (`por veículo × N`). Sem recalcular os dois, o orçamento de onde a tarefa
      // saiu segue cobrando por ela e o que a recebeu não a cobra. Lido antes do
      // update porque depois o vínculo anterior já se foi.
      const linkChanging = (data as any).quoteId !== undefined;
      const previousQuoteId = linkChanging
        ? ((await transaction.task.findUnique({ where: { id }, select: { quoteId: true } }))
            ?.quoteId ?? null)
        : null;

      const result = await transaction.task.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      if (linkChanging) {
        const nextQuoteId = ((data as any).quoteId as string | null) ?? null;
        const affected = Array.from(
          new Set([previousQuoteId, nextQuoteId].filter((q): q is string => Boolean(q))),
        );
        for (const quoteId of affected) {
          // O orçamento pode ter sido apagado na mesma transação (relação
          // `SET NULL`): recalcular linha inexistente derrubaria a transação.
          const stillThere = await transaction.budget.count({ where: { id: quoteId } });
          if (stillThere === 0) continue;
          // A COBERTURA antes do total, e nos DOIS orçamentos.
          //
          // Mover uma tarefa não apaga a linha de cobertura dela: o `onDelete:
          // Cascade` de `BillingTask` dispara quando a TAREFA morre, não
          // quando ela troca de orçamento. Sem refatiar, a fatura do orçamento de
          // origem continuaria cobrando um caminhão que não é mais dela — e a do
          // destino não cobraria o que recebeu.
          await resliceQuoteCoverage(transaction, quoteId);
          await recalcQuoteTotals(transaction, quoteId);
          // E a cobertura de LAYOUT, nos dois lados: quem saiu perde a dele, quem
          // chegou não traz a do orçamento de onde veio — e, num orçamento por
          // veículo, fica descoberto até alguém atribuir.
          await pruneQuoteLayoutCoverage(transaction, quoteId);
        }
      }

      // Task↔quote link is now settled (existing quote, or the new one connected
      // via updateInput.quote above): materialize quote layout files as APPROVED
      // task layouts.
      if (quoteIdForLayoutSync) {
        await syncTaskLayoutsFromQuote(transaction, quoteIdForLayoutSync, undefined);
      }

      // Keep the yard position in sync with `cleared`. Read the *effective* value from
      // updateInput, not from `data` — `cleared` is also derived here from entryDate
      // (auto-clear) and forecastDate (auto-unclear), and those derivations must move
      // the truck too.
      if (typeof updateInput.cleared === 'boolean') {
        await syncTruckSpotWithCleared(transaction, id, updateInput.cleared);
      }

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      super.logError(`atualizar tarefa ${id}`, error, { data });
      throw error;
    }
  }

  /**
   * Exclui a tarefa e RECALCULA o orçamento que ela deixou.
   *
   * Desde o orçamento multitarefa, `Budget.total` é `por veículo × N` e
   * `vehicleCount` é esse N. Apagar um dos sessenta caminhões sem recalcular
   * deixava o orçamento afirmando sessenta veículos e cobrando por sessenta,
   * com cinquenta e nove no registro: o documento recalcula na renderização (lê
   * `tasks`), então o PDF passava a divergir do banco — e a fatura, o boleto e a
   * NFS-e seguem o banco.
   *
   * Aqui e não no serviço porque há dois caminhos de exclusão (unitária e em
   * lote, e a de lote passa por este mesmo método): um recálculo no serviço
   * cobriria um e não o outro.
   */
  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Task> {
    try {
      // Lido ANTES: depois do delete não há mais de onde tirar o vínculo.
      const before = await transaction.task.findUnique({
        where: { id },
        select: { quoteId: true },
      });

      const result = await transaction.task.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      if (before?.quoteId) {
        // O orçamento pode estar sendo apagado na MESMA transação (a relação é
        // `SET NULL`, então o delete dele não barra) — recalcular uma linha que
        // não existe mais estouraria a transação inteira por um efeito
        // secundário.
        const quoteStillThere = await transaction.budget.count({
          where: { id: before.quoteId },
        });
        if (quoteStillThere > 0) {
          // A cobertura da tarefa apagada some por cascata; o que sobra é o
          // orçamento com uma fatura a menos de veículo. Refatiar antes do total
          // é o que faz `JOINT` voltar a cobrir os que restaram em vez de manter
          // um grupo de N num orçamento de N−1.
          await resliceQuoteCoverage(transaction, before.quoteId);
          await recalcQuoteTotals(transaction, before.quoteId);
          // As linhas de layout do veículo apagado caem por cascata; a arte que
          // era SÓ dele sai do orçamento aqui (num orçamento por veículo, uma
          // arte sem veículo nenhum seria layout aprovado de ninguém).
          await pruneQuoteLayoutCoverage(transaction, before.quoteId);
        }
      }

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      super.logError(`deletar tarefa ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: TaskWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.task.count(whereInput ? { where: whereInput } : undefined);
    } catch (error) {
      super.logError('contar tarefas', error, { where });
      throw error;
    }
  }
}
