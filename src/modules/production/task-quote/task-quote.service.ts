// api/src/modules/production/task-quote/task-quote.service.ts

import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskQuoteRepository } from './repositories/task-quote.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { InvoiceGenerationService } from '@modules/financial/invoice/invoice-generation.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import type {
  TaskQuoteCreateFormData,
  TaskQuoteUpdateFormData,
  TaskQuoteGetManyFormData,
} from '@schemas/task-quote';
import type {
  TaskQuoteGetManyResponse,
  TaskQuoteGetUniqueResponse,
  TaskQuoteCreateResponse,
  TaskQuoteUpdateResponse,
  TaskQuoteDeleteResponse,
  TaskQuoteBatchCreateResponse,
  TaskQuoteBatchUpdateResponse,
  TaskQuoteBatchDeleteResponse,
  TaskQuote,
} from '@types';
import {
  TASK_QUOTE_STATUS,
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_LOG_ACTION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
  INVOICE_STATUS,
} from '@constants';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { CHANGE_TRIGGERED_BY } from '@constants';
import { logQuoteServiceChanges } from '@modules/common/changelog/utils/quote-service-changelog';
import { serializeChangelogValue } from '@modules/common/changelog/utils/serialize-changelog-value';
import { trackAndLogFieldChanges } from '@modules/common/changelog/utils/changelog-helpers';
import { normalizeDescription } from '@utils';
import { SERVICE_ORDER_TYPE, SERVICE_ORDER_STATUS } from '@constants';
import { TASK_QUOTE_STATUS_ORDER } from '@constants';
import {
  getQuoteItemToServiceOrderSync,
  type SyncServiceOrder,
} from '../../../utils/task-quote-service-order-sync';
import { getServiceOrderStatusOrder } from '../../../utils/sortOrder';
import { syncEmNegociacaoForTask } from '../../../utils/em-negociacao-sync';

/**
 * Compute the discount amount for a customer config based on its discount type, value, and subtotal.
 */
function computeConfigDiscount(
  subtotal: number,
  discountType?: string,
  discountValue?: number | null,
): number {
  if (!discountType || discountType === 'NONE' || !discountValue) return 0;
  if (discountType === 'PERCENTAGE')
    return Math.round(((subtotal * discountValue) / 100) * 100) / 100;
  if (discountType === 'FIXED_VALUE') return Math.min(discountValue, subtotal);
  return 0;
}

/**
 * Service for managing TaskQuote entities
 * Handles CRUD operations, status management, and business logic
 */
@Injectable()
export class TaskQuoteService {
  private readonly logger = new Logger(TaskQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskQuoteRepository: TaskQuoteRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject(forwardRef(() => InvoiceGenerationService))
    private readonly invoiceGenerationService: InvoiceGenerationService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
    private readonly sicrediService: SicrediService,
  ) {}

  /**
   * Find many quotes with filtering, pagination, and sorting
   */
  async findMany(query: TaskQuoteGetManyFormData): Promise<TaskQuoteGetManyResponse> {
    try {
      const result = await this.taskQuoteRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Orçamentos carregados com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error finding task quotes:', error);
      throw new InternalServerErrorException('Erro ao carregar orçamentos.');
    }
  }

  /**
   * Find unique quote by ID
   */
  async findUnique(id: string, include?: any): Promise<TaskQuoteGetUniqueResponse> {
    try {
      const quote = await this.taskQuoteRepository.findById(id, include);

      if (!quote) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      return {
        success: true,
        data: quote,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding task quote ${id}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Find quote by task ID
   */
  async findByTaskId(taskId: string): Promise<TaskQuoteGetUniqueResponse> {
    try {
      const quote = await this.taskQuoteRepository.findByTaskId(taskId);

      // Return null data when no quote exists (not an error - task may not have a quote yet)
      if (!quote) {
        return {
          success: true,
          data: null,
          message: 'Nenhum orçamento encontrado para esta tarefa.',
        };
      }

      return {
        success: true,
        data: quote,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding quote for task ${taskId}:`, error);
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Create new quote
   */
  async create(data: TaskQuoteCreateFormData, userId: string): Promise<TaskQuoteCreateResponse> {
    try {
      // Validate task exists; load responsibles so we can default the budget responsible
      const task = await this.prisma.task.findUnique({
        where: { id: data.taskId },
        include: { responsibles: { select: { id: true, role: true }, orderBy: { createdAt: 'asc' } } },
      });

      if (!task) {
        throw new BadRequestException('Tarefa não encontrada.');
      }

      // Default each customerConfig's responsibleId to the best task responsible if missing.
      // Priority: OWNER > first by createdAt (matches the public budget page display logic).
      const taskResponsibles = (task as any).responsibles ?? [];
      const ownerResp = taskResponsibles.find((r: any) => r.role === 'OWNER');
      const defaultResponsibleId = (ownerResp ?? taskResponsibles[0])?.id || null;
      if (defaultResponsibleId) {
        for (const config of data.customerConfigs) {
          if (!config.responsibleId) {
            config.responsibleId = defaultResponsibleId;
          }
        }
      }

      // Validate customerConfigs customer IDs
      const customerIds = data.customerConfigs.map(c => c.customerId);
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true },
      });

      if (customers.length !== customerIds.length) {
        throw new BadRequestException(
          'Um ou mais clientes selecionados para faturamento não foram encontrados.',
        );
      }

      // NOTE: Each task has its own independent quote record.
      // When copying a quote (e.g. via copyFromTask), a new TaskQuote is created as a deep copy.

      // Validate services exist
      if (!data.services || data.services.length === 0) {
        throw new BadRequestException('Pelo menos um serviço é obrigatório.');
      }

      // Compute per-customer totals from global customer discount
      const isSingleConfig = data.customerConfigs.length === 1;
      for (const config of data.customerConfigs) {
        const assignedServices = (data.services || []).filter(
          s =>
            s.invoiceToCustomerId === config.customerId ||
            (isSingleConfig && !s.invoiceToCustomerId),
        );
        const subtotal = assignedServices.reduce((sum, s) => sum + (s.amount || 0), 0);
        const discount = computeConfigDiscount(
          subtotal,
          (config as any).discountType,
          (config as any).discountValue,
        );
        const total = Math.max(0, subtotal - discount);
        config.subtotal = Math.round(subtotal * 100) / 100;
        config.total = Math.round(total * 100) / 100;
      }

      // Compute aggregate subtotal/total from customerConfigs
      const aggregateSubtotal = data.customerConfigs.reduce((sum, c) => sum + (c.subtotal || 0), 0);
      const aggregateTotal = data.customerConfigs.reduce((sum, c) => sum + (c.total || 0), 0);

      // Create quote with items in transaction
      const quote = await this.prisma.$transaction(async tx => {
        // Get next budget number (auto-increment)
        const maxBudgetNumber = await tx.taskQuote.aggregate({
          _max: { budgetNumber: true },
        });
        const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

        const newQuote = await tx.taskQuote.create({
          data: {
            budgetNumber: nextBudgetNumber,
            subtotal: aggregateSubtotal,
            total: aggregateTotal,
            expiresAt: data.expiresAt,
            status: data.status || TASK_QUOTE_STATUS.PENDING,
            statusOrder:
              TASK_QUOTE_STATUS_ORDER[
                (data.status || TASK_QUOTE_STATUS.PENDING) as TASK_QUOTE_STATUS
              ] ?? 8,
            // Guarantee Terms
            guaranteeYears: data.guaranteeYears || null,
            customGuaranteeText: data.customGuaranteeText || null,
            // Layout File
            ...(data.layoutFileId && {
              layoutFile: { connect: { id: data.layoutFileId } },
            }),
            simultaneousTasks: data.simultaneousTasks || null,
            customForecastDays: data.customForecastDays || null,
            // Customer Configs (per-customer billing) — always at least 1
            customerConfigs: {
              create: data.customerConfigs.map(config => ({
                customer: { connect: { id: config.customerId } },
                subtotal: config.subtotal || 0,
                total: config.total || 0,
                discountType: (config as any).discountType || 'NONE',
                discountValue: (config as any).discountValue ?? null,
                discountReference: (config as any).discountReference || null,
                customPaymentText: config.customPaymentText || null,
                generateInvoice:
                  config.generateInvoice !== undefined ? config.generateInvoice : true,
                generateBankSlip:
                  config.generateBankSlip !== undefined ? config.generateBankSlip : true,
                orderNumber: (config as any).orderNumber || null,
                ...(config.responsibleId && {
                  responsible: { connect: { id: config.responsibleId } },
                }),
                paymentCondition: config.paymentCondition || null,
                paymentConfig: (config as any).paymentConfig ?? null,
              })),
            },
            services: {
              create: data.services.map((service, index) => ({
                amount: service.amount || 0,
                description: service.description || '',
                observation: service.observation || null,
                position: index,
                ...(service.invoiceToCustomerId && {
                  invoiceToCustomer: { connect: { id: service.invoiceToCustomerId } },
                }),
              })),
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
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
          },
        });

        // Installments are now created at BILLING_APPROVED time, not at quote creation

        // Connect the task to this quote (one-to-one via Task.quoteId FK)
        await tx.task.update({
          where: { id: data.taskId },
          data: { quoteId: newQuote.id },
        });

        // Log change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: newQuote.id,
          action: CHANGE_ACTION.CREATE,
          userId,
          reason: 'Criação de orçamento',
          newValue: serializeChangelogValue({
            id: newQuote.id,
            budgetNumber: nextBudgetNumber,
            subtotal: data.subtotal,
            total: data.total,
            status: data.status || TASK_QUOTE_STATUS.PENDING,
            services: data.services.map(service => ({
              description: service.description,
              amount: service.amount,
              observation: service.observation || null,
            })),
          }),
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          transaction: tx,
        });

        // =====================================================================
        // SYNC: Task Quote Services → Production Service Orders
        // When quote services are created, automatically create corresponding
        // PRODUCTION service orders for each service that doesn't already exist
        // =====================================================================
        try {
          const existingServiceOrders = await tx.serviceOrder.findMany({
            where: { taskId: data.taskId },
            select: { id: true, description: true, observation: true, type: true },
          });

          const existingSOs: SyncServiceOrder[] = existingServiceOrders.map((so: any) => ({
            id: so.id,
            description: so.description,
            observation: so.observation,
            type: so.type,
          }));

          for (let i = 0; i < data.services.length; i++) {
            const service = data.services[i];
            if (!service.description) continue;

            const syncResult = getQuoteItemToServiceOrderSync(
              { description: service.description, observation: service.observation || null },
              existingSOs,
            );

            if (syncResult.shouldCreateServiceOrder) {
              this.logger.log(
                `[QUOTE→SO SYNC] Creating PRODUCTION service order: "${syncResult.serviceOrderDescription}" for quote service`,
              );

              await tx.serviceOrder.create({
                data: {
                  description: syncResult.serviceOrderDescription,
                  observation: syncResult.serviceOrderObservation,
                  status: SERVICE_ORDER_STATUS.PENDING as any,
                  statusOrder: getServiceOrderStatusOrder(SERVICE_ORDER_STATUS.PENDING),
                  type: SERVICE_ORDER_TYPE.PRODUCTION as any,
                  position: i,
                  task: { connect: { id: data.taskId } },
                  createdBy: { connect: { id: userId } },
                },
              });

              // Add to existing SOs to prevent duplicates within the same batch
              existingSOs.push({
                description: syncResult.serviceOrderDescription,
                observation: syncResult.serviceOrderObservation,
                type: SERVICE_ORDER_TYPE.PRODUCTION,
              });
            }
          }
        } catch (syncError) {
          this.logger.error('[QUOTE→SO SYNC] Error during sync:', syncError);
          // Don't throw - sync errors shouldn't block quote creation
        }

        return tx.taskQuote.findUnique({
          where: { id: newQuote.id },
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
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
                installments: { orderBy: { number: 'asc' } },
                responsible: { select: { id: true, name: true, role: true } },
                customerSignature: true,
              },
            },
          },
        });
      });

      return {
        success: true,
        data: quote as any,
        message: 'Orçamento criado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error creating task quote:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Erro ao criar orçamento.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Material-change detection
  //
  // The budget detail form on web/mobile always re-submits the full quote
  // (customerConfigs + services + scalar fields), even when the user only
  // changed a Task field like truck.plate. Without filtering, every save
  // would trip STATUS_LOCKED at BILLING_APPROVED+, run the destructive
  // customerConfigs delete+recreate, and auto-revert status on no-op
  // resubmissions. We canonicalize both sides and pass through only fields
  // the caller actually changed.
  // ─────────────────────────────────────────────────────────────────────────

  private canonicalizeCustomerConfig(config: any): string {
    return JSON.stringify({
      customerId: config.customerId ?? null,
      subtotal: Number(config.subtotal ?? 0).toFixed(2),
      total: Number(config.total ?? 0).toFixed(2),
      discountType: config.discountType ?? 'NONE',
      discountValue:
        config.discountValue != null ? Number(config.discountValue).toFixed(2) : null,
      discountReference: config.discountReference ?? null,
      paymentCondition: config.paymentCondition ?? null,
      customPaymentText: config.customPaymentText ?? null,
      generateInvoice: config.generateInvoice !== false,
      generateBankSlip: config.generateBankSlip !== false,
      orderNumber: config.orderNumber ?? null,
      responsibleId: config.responsibleId ?? null,
      paymentConfig: config.paymentConfig ?? null,
    });
  }

  private customerConfigsMateriallyChanged(existing: any[], incoming: any[]): boolean {
    if (!Array.isArray(incoming)) return false;
    if ((existing?.length ?? 0) !== incoming.length) return true;
    const a = (existing || []).map(c => this.canonicalizeCustomerConfig(c)).sort();
    const b = incoming.map(c => this.canonicalizeCustomerConfig(c)).sort();
    return a.some((v, i) => v !== b[i]);
  }

  private canonicalizeService(service: any): string {
    return JSON.stringify({
      description: (service.description ?? '').trim(),
      amount: Number(service.amount ?? 0).toFixed(2),
      observation: service.observation ?? null,
      invoiceToCustomerId: service.invoiceToCustomerId ?? null,
    });
  }

  private servicesMateriallyChanged(existing: any[], incoming: any[]): boolean {
    if (!Array.isArray(incoming)) return false;
    if ((existing?.length ?? 0) !== incoming.length) return true;
    const a = (existing || []).map(s => this.canonicalizeService(s)).sort();
    const b = incoming.map(s => this.canonicalizeService(s)).sort();
    return a.some((v, i) => v !== b[i]);
  }

  private isScalarChanged(existing: any, incoming: any): boolean {
    if (incoming === undefined) return false;
    if (existing === incoming) return false;
    if (existing == null && incoming == null) return false;
    // Prisma Decimal compared against number
    if (existing && typeof existing === 'object' && 'toNumber' in existing) {
      return Number(existing) !== Number(incoming);
    }
    if (existing instanceof Date || incoming instanceof Date) {
      const a = existing ? new Date(existing as any).getTime() : null;
      const b = incoming ? new Date(incoming as any).getTime() : null;
      return a !== b;
    }
    return existing !== incoming;
  }

  /**
   * Return a copy of `data` with no-op fields stripped (where the incoming
   * value is structurally equal to the existing one). Internal callers may
   * pass `_internal = true` on update() to bypass this filter.
   */
  private filterToMaterialChanges(
    existing: any,
    data: TaskQuoteUpdateFormData,
  ): TaskQuoteUpdateFormData {
    const filtered: any = {};
    for (const key of Object.keys(data)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      if (key === 'customerConfigs') {
        if (this.customerConfigsMateriallyChanged(existing.customerConfigs || [], value)) {
          filtered[key] = value;
        }
      } else if (key === 'services') {
        if (this.servicesMateriallyChanged(existing.services || [], value)) {
          filtered[key] = value;
        }
      } else {
        if (this.isScalarChanged((existing as any)[key], value)) {
          filtered[key] = value;
        }
      }
    }
    return filtered as TaskQuoteUpdateFormData;
  }

  /**
   * Detect whether the (already-filtered) update touches money-affecting
   * fields. Used to drive auto-revert-to-PENDING when value changes happen
   * after BUDGET_APPROVED.
   */
  private hasValueAffectingChange(
    existing: any,
    data: TaskQuoteUpdateFormData,
  ): boolean {
    if (data.services !== undefined) return true;
    if (Array.isArray(data.customerConfigs)) {
      const existingByCustomer = new Map(
        (existing.customerConfigs || []).map((c: any) => [c.customerId, c]),
      );
      for (const incoming of data.customerConfigs as any[]) {
        const prev: any = existingByCustomer.get(incoming.customerId);
        if (!prev) return true; // new customer added → value change
        if (this.isScalarChanged(prev.subtotal, incoming.subtotal)) return true;
        if (this.isScalarChanged(prev.total, incoming.total)) return true;
        if (this.isScalarChanged(prev.discountType, incoming.discountType ?? 'NONE'))
          return true;
        if (
          this.isScalarChanged(
            prev.discountValue,
            incoming.discountValue ?? null,
          )
        )
          return true;
      }
      // Customer was removed?
      const incomingIds = new Set(
        (data.customerConfigs as any[]).map(c => c.customerId),
      );
      for (const prev of existing.customerConfigs || []) {
        if (!incomingIds.has(prev.customerId)) return true;
      }
    }
    return false;
  }

  /**
   * Update existing quote.
   * @param _internal When true (called from updateStatus/internalApprove), relaxes the
   *   status-change guard for locked quotes. External callers must use the dedicated
   *   status-update endpoints for all post-billing status transitions.
   */
  async update(
    id: string,
    data: TaskQuoteUpdateFormData,
    userId: string,
    _internal = false,
  ): Promise<TaskQuoteUpdateResponse> {
    try {
      const existing = await this.taskQuoteRepository.findById(id, {
        include: {
          services: { orderBy: { position: 'asc' } },
          customerConfigs: true,
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      const currentStatus = (existing as any).status as TASK_QUOTE_STATUS;

      // ─────────────────────────────────────────────────────────────────────
      // Strip no-op fields before any validation or write.
      //
      // The budget detail form re-submits the full quote snapshot on every
      // save (including when the user only edited a Task field like
      // truck.plate). Without this filter, those no-op resubmissions would
      // trip STATUS_LOCKED, run the destructive customerConfigs
      // delete+recreate, and emit spurious changelogs. Internal callers
      // (updateStatus, internalApprove, revertBilling, …) pass _internal
      // to skip this — they assert their writes deliberately.
      // ─────────────────────────────────────────────────────────────────────
      if (!_internal) {
        data = this.filterToMaterialChanges(existing, data);
        if (Object.keys(data).length === 0) {
          return {
            success: true,
            data: existing as any,
            message: 'Nenhuma alteração detectada.',
          };
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Auto-revert quote status when value-affecting fields change.
      //
      // Editing the deal value (services list, customerConfig money fields)
      // invalidates the customer/commercial approval. Per workflow, the
      // quote returns to PENDING so the deal is re-confirmed downstream.
      // The edit itself is NEVER blocked — only the status is flipped.
      //
      // BILLING_APPROVED+ is excluded: STATUS_LOCKED below throws on money
      // fields, forcing the user through revertBilling() first.
      // The caller can override by setting data.status explicitly.
      // ─────────────────────────────────────────────────────────────────────
      const VALUE_REVERTABLE_STATUSES: TASK_QUOTE_STATUS[] = [
        TASK_QUOTE_STATUS.BUDGET_APPROVED,
        TASK_QUOTE_STATUS.COMMERCIAL_APPROVED,
      ];
      if (
        !_internal &&
        data.status === undefined &&
        VALUE_REVERTABLE_STATUSES.includes(currentStatus) &&
        this.hasValueAffectingChange(existing, data)
      ) {
        this.logger.log(
          `[Quote Update] Auto-reverting quote ${id} from ${currentStatus} → PENDING due to value-affecting edits`,
        );
        (data as any).status = TASK_QUOTE_STATUS.PENDING;
      }

      // ─────────────────────────────────────────────────────────────────────
      // Guard: lock pricing/customer/payment edits once the quote is locked-in
      // ─────────────────────────────────────────────────────────────────────
      const STATUS_LOCKED: TASK_QUOTE_STATUS[] = [
        TASK_QUOTE_STATUS.BILLING_APPROVED,
        TASK_QUOTE_STATUS.UPCOMING,
        TASK_QUOTE_STATUS.DUE,
        TASK_QUOTE_STATUS.PARTIAL,
        TASK_QUOTE_STATUS.SETTLED,
      ];
      // BILLING_APPROVED must go through internalApprove() — never a raw update() call.
      // This applies regardless of current status so it can never be smuggled in.
      if (data.status === TASK_QUOTE_STATUS.BILLING_APPROVED) {
        throw new BadRequestException(
          'A aprovação de faturamento deve ser realizada pelo endpoint dedicado.',
        );
      }
      const SAFE_AFTER_BILLING_FIELDS = new Set<string>([
        'expiresAt',
        'customGuaranteeText',
        'layoutFileId',
        'status',
        'guaranteeYears',
        'customForecastDays',
        'simultaneousTasks',
      ]);
      if (STATUS_LOCKED.includes(currentStatus)) {
        for (const key of Object.keys(data)) {
          // Ignore explicit undefined entries — only reject if the caller actually intends a change.
          if ((data as any)[key] === undefined) continue;
          if (!SAFE_AFTER_BILLING_FIELDS.has(key)) {
            throw new BadRequestException(
              'Após aprovação para faturamento, este campo não pode ser alterado. Solicite o cancelamento do orçamento para editá-lo.',
            );
          }
          // Status changes on locked quotes must come through updateStatus() — never external PUT.
          if (key === 'status' && !_internal) {
            throw new BadRequestException(
              'Use o endpoint de atualização de status para alterar o status do orçamento.',
            );
          }
        }
      }

      // Validate customerConfigs customer IDs if provided
      if (data.customerConfigs && data.customerConfigs.length > 0) {
        const customerIds = data.customerConfigs.map(c => c.customerId);
        const customers = await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true },
        });

        if (customers.length !== customerIds.length) {
          throw new BadRequestException(
            'Um ou mais clientes selecionados para faturamento não foram encontrados.',
          );
        }

        // Default each customerConfig's responsibleId to the best task responsible if missing.
        // Priority: OWNER > first by createdAt (mirrors create() and the public budget page).
        // The TaskQuote↔Task relation lives on Task.quoteId — query via that side.
        const taskWithResp = await this.prisma.task.findFirst({
          where: { quoteId: id },
          include: { responsibles: { select: { id: true, role: true }, orderBy: { createdAt: 'asc' } } },
        });
        const taskWithRespList = (taskWithResp as any)?.responsibles ?? [];
        const ownerRespForUpdate = taskWithRespList.find((r: any) => r.role === 'OWNER');
        const defaultResponsibleId = (ownerRespForUpdate ?? taskWithRespList[0])?.id || null;
        if (defaultResponsibleId) {
          for (const config of data.customerConfigs) {
            if (!config.responsibleId) {
              config.responsibleId = defaultResponsibleId;
            }
          }
        }
      }

      // Compute per-customer totals from global customer discount
      if (data.customerConfigs && data.customerConfigs.length > 0 && data.services) {
        const isSingleConfig = data.customerConfigs.length === 1;
        for (const config of data.customerConfigs) {
          const assignedServices = data.services.filter(
            s =>
              s.invoiceToCustomerId === config.customerId ||
              (isSingleConfig && !s.invoiceToCustomerId),
          );
          const subtotal = assignedServices.reduce((sum, s) => sum + (s.amount || 0), 0);
          const discount = computeConfigDiscount(
            subtotal,
            (config as any).discountType,
            (config as any).discountValue,
          );
          const total = Math.max(0, subtotal - discount);
          config.subtotal = Math.round(subtotal * 100) / 100;
          config.total = Math.round(total * 100) / 100;
        }
      }

      // Compute aggregate subtotal/total from customerConfigs if provided
      const computeAggregates = data.customerConfigs && data.customerConfigs.length > 0;
      const aggregateSubtotal = computeAggregates
        ? data.customerConfigs!.reduce((sum, c) => sum + (c.subtotal || 0), 0)
        : undefined;
      const aggregateTotal = computeAggregates
        ? data.customerConfigs!.reduce((sum, c) => sum + (c.total || 0), 0)
        : undefined;

      // Update quote with items in transaction
      const updated = await this.prisma.$transaction(async tx => {
        const updatedQuote = await tx.taskQuote.update({
          where: { id },
          data: {
            ...(aggregateSubtotal !== undefined && { subtotal: aggregateSubtotal }),
            ...(aggregateTotal !== undefined && { total: aggregateTotal }),
            ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt }),
            ...(data.status !== undefined && {
              status: data.status,
              statusOrder: this.getStatusOrder(data.status as TASK_QUOTE_STATUS),
            }),
            // Guarantee Terms
            ...(data.guaranteeYears !== undefined && { guaranteeYears: data.guaranteeYears }),
            ...(data.customGuaranteeText !== undefined && {
              customGuaranteeText: data.customGuaranteeText,
            }),
            // Layout File
            ...(data.layoutFileId !== undefined && {
              layoutFile: data.layoutFileId
                ? { connect: { id: data.layoutFileId } }
                : { disconnect: true },
            }),
            ...(data.simultaneousTasks !== undefined && {
              simultaneousTasks: data.simultaneousTasks,
            }),
            ...(data.customForecastDays !== undefined && {
              customForecastDays: data.customForecastDays,
            }),
            ...(data.services && {
              services: {
                deleteMany: {},
                create: data.services.map((service, index) => ({
                  amount: service.amount || 0,
                  description: service.description || '',
                  observation: service.observation || null,
                  position: index,
                  ...(service.invoiceToCustomerId && {
                    invoiceToCustomer: { connect: { id: service.invoiceToCustomerId } },
                  }),
                })),
              },
            }),
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
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
          },
        });

        // Track individual field changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: id,
          oldEntity: existing,
          newEntity: updatedQuote,
          fieldsToTrack: [
            'subtotal',
            'total',
            'expiresAt',
            'status',
            'guaranteeYears',
            'customGuaranteeText',
            'layoutFileId',
            'customForecastDays',
            'budgetNumber',
            'simultaneousTasks',
          ],
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
          transaction: tx,
        });

        // Handle customerConfigs changes
        if (data.customerConfigs !== undefined) {
          // Guard: prevent destructive customerConfig changes when there are real financial obligations
          const existingConfigIds = ((existing as any).customerConfigs || []).map((c: any) => c.id);
          if (existingConfigIds.length > 0) {
            const blockingInvoices = await tx.invoice.findMany({
              where: {
                customerConfigId: { in: existingConfigIds },
                status: { not: 'CANCELLED' },
              },
              include: {
                installments: {
                  include: { bankSlip: { select: { status: true } } },
                },
                nfseDocuments: { select: { status: true } },
              },
            });

            for (const inv of blockingInvoices) {
              const hasActiveBankSlip = inv.installments.some(
                (inst: any) => inst.bankSlip && !['CANCELLED'].includes(inst.bankSlip.status),
              );
              const hasPaidInstallment = inv.installments.some(
                (inst: any) => inst.status === 'PAID',
              );
              const hasActiveNfse = inv.nfseDocuments.some(
                (nfse: any) => nfse.status === 'AUTHORIZED',
              );

              if (hasActiveBankSlip || hasPaidInstallment || hasActiveNfse) {
                throw new BadRequestException(
                  'Não é possível alterar as configurações de clientes enquanto houver boletos ativos, parcelas pagas ou notas fiscais autorizadas. Cancele-os primeiro.',
                );
              }

              // Auto-cancel invoices that have no active obligations but are still marked as ACTIVE
              if (inv.status !== 'CANCELLED') {
                await tx.invoice.update({
                  where: { id: inv.id },
                  data: { status: 'CANCELLED' },
                });
              }
            }

            // If invoices were auto-cancelled, revert quote status to BUDGET_APPROVED
            // so financial can re-verify before regenerating invoices/boletos/NFS-e
            if (blockingInvoices.length > 0) {
              const billingStatuses = [
                TASK_QUOTE_STATUS.COMMERCIAL_APPROVED,
                TASK_QUOTE_STATUS.BILLING_APPROVED,
                TASK_QUOTE_STATUS.UPCOMING,
                TASK_QUOTE_STATUS.DUE,
                TASK_QUOTE_STATUS.PARTIAL,
              ];
              if (billingStatuses.includes((existing as any).status)) {
                await tx.taskQuote.update({
                  where: { id },
                  data: {
                    status: TASK_QUOTE_STATUS.BUDGET_APPROVED,
                    statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.BUDGET_APPROVED),
                  },
                });
              }
            }
          }

          // Delete existing configs (cascades to installments) and recreate
          await tx.taskQuoteCustomerConfig.deleteMany({ where: { quoteId: id } });
          if (data.customerConfigs.length > 0) {
            await tx.taskQuoteCustomerConfig.createMany({
              data: data.customerConfigs.map(config => ({
                quoteId: id,
                customerId: config.customerId,
                subtotal: config.subtotal || 0,
                total: config.total || 0,
                discountType: (config as any).discountType || 'NONE',
                discountValue: (config as any).discountValue ?? null,
                discountReference: (config as any).discountReference || null,
                customPaymentText: config.customPaymentText || null,
                generateInvoice:
                  config.generateInvoice !== undefined ? config.generateInvoice : true,
                generateBankSlip:
                  config.generateBankSlip !== undefined ? config.generateBankSlip : true,
                orderNumber: (config as any).orderNumber || null,
                responsibleId: config.responsibleId || null,
                paymentCondition: config.paymentCondition || null,
                paymentConfig: (config as any).paymentConfig ?? null,
              })),
            });

            // Installments are now created at BILLING_APPROVED time, not at quote update
          }

          // Clear orphaned service assignments: if a customer was removed from configs,
          // any services assigned to that customer via invoiceToCustomerId should be set to null
          const validCustomerIds = data.customerConfigs.map(c => c.customerId);
          await tx.taskQuoteService.updateMany({
            where: {
              quoteId: id,
              invoiceToCustomerId: {
                notIn: validCustomerIds.length > 0 ? validCustomerIds : ['__none__'],
                not: null,
              },
            },
            data: {
              invoiceToCustomerId: null,
            },
          });

          // Log customer configs change — compare by customerId to detect actual customer changes
          const oldConfigs = (existing as any).customerConfigs || [];
          const oldConfigIds =
            oldConfigs
              .map((c: any) => c.customerId)
              .sort()
              .join(', ') || 'Nenhum';
          const newConfigIds =
            data.customerConfigs
              .map((c: any) => c.customerId)
              .sort()
              .join(', ') || 'Nenhum';
          // Use names for human-readable log values
          const oldConfigNames =
            oldConfigs.map((c: any) => c.customer?.fantasyName || c.customerId).join(', ') ||
            'Nenhum';
          const newConfigNames =
            data.customerConfigs.map((c: any) => c.customerId).join(', ') || 'Nenhum';

          if (oldConfigIds !== newConfigIds) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_QUOTE,
              entityId: id,
              action: CHANGE_LOG_ACTION.UPDATE as any,
              field: 'customerConfigs',
              oldValue: oldConfigNames,
              newValue: newConfigNames,
              userId: userId || '',
              reason: 'Atualização de configurações de clientes para faturamento',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }
        }

        // Track quote services changes (per-service granular tracking)
        if (data.services !== undefined) {
          const oldServices = (existing as any).services || [];
          const newServices = (updatedQuote as any).services || [];

          // Log per-service changes (added, removed, field updates)
          await logQuoteServiceChanges({
            changeLogService: this.changeLogService,
            quoteId: id,
            oldServices,
            newServices,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          // Also keep a bulk snapshot for backward compatibility (field: 'services_snapshot')
          const formatService = (service: any) =>
            `${service.description || ''}: R$ ${Number(service.amount || 0).toFixed(2)}`;
          const oldServicesSummary = oldServices.map(formatService).sort();
          const newServicesSummary = newServices.map(formatService).sort();
          const servicesChanged =
            oldServicesSummary.length !== newServicesSummary.length ||
            oldServicesSummary.some((s: string, i: number) => s !== newServicesSummary[i]);

          if (servicesChanged) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_QUOTE,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'services_snapshot',
              oldValue: serializeChangelogValue({
                count: oldServices.length,
                services: oldServices.map((service: any) => ({
                  description: service.description,
                  amount: Number(service.amount),
                  observation: service.observation,
                })),
              }),
              newValue: serializeChangelogValue({
                count: newServices.length,
                services: newServices.map((service: any) => ({
                  description: service.description,
                  amount: Number(service.amount),
                  observation: service.observation,
                })),
              }),
              userId: userId || '',
              reason: 'Atualização dos serviços do orçamento (snapshot)',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }

          // Fix R$ 0,00 snapshot: update quoteId changelog when real amounts are set
          const allOldAmountsZero = oldServices.every(
            (service: any) => Number(service.amount) === 0,
          );
          const anyNewAmountNonZero = newServices.some(
            (service: any) => Number(service.amount) > 0,
          );

          if (allOldAmountsZero && anyNewAmountNonZero) {
            const updatedWithTask = await tx.taskQuote.findUnique({
              where: { id },
              include: {
                task: { select: { id: true } },
                services: { orderBy: { position: 'asc' } },
              },
            });

            const taskRef = updatedWithTask?.task;
            if (taskRef) {
              const quoteIdLog = await tx.changeLog.findFirst({
                where: { entityType: 'TASK', entityId: taskRef.id, field: 'quoteId' },
                orderBy: { createdAt: 'desc' },
              });
              if (quoteIdLog) {
                const realSnapshot = serializeChangelogValue({
                  id,
                  budgetNumber: (updatedWithTask as any).budgetNumber,
                  subtotal: (updatedWithTask as any).subtotal,
                  total: (updatedWithTask as any).total,
                  status: (updatedWithTask as any).status,
                  services: updatedWithTask!.services.map(service => ({
                    description: service.description,
                    amount: Number(service.amount),
                    observation: service.observation,
                  })),
                });
                await tx.changeLog.update({
                  where: { id: quoteIdLog.id },
                  data: { newValue: realSnapshot },
                });
              }
            }
          }
        }

        // =====================================================================
        // CASCADE DELETE: When quote services are removed, delete the
        // corresponding PRODUCTION service orders
        // =====================================================================
        if (data.services !== undefined) {
          const oldServices = (existing as any).services || [];
          const newServices = (updatedQuote as any).services || [];

          // Build set of normalized descriptions in the new services
          const newDescriptions = new Set(
            newServices.map((s: any) => normalizeDescription(s.description)),
          );

          // Find descriptions that were removed (in old but not in new)
          const descriptionsToDelete = new Set<string>();

          for (const oldSvc of oldServices) {
            const normalized = normalizeDescription(oldSvc.description);
            if (!normalized) continue;
            if (!newDescriptions.has(normalized)) {
              // Service was removed from quote
              descriptionsToDelete.add(normalized);
            }
          }

          if (descriptionsToDelete.size > 0) {
            // Get the task ID for this quote
            const quoteWithTask = await tx.taskQuote.findUnique({
              where: { id },
              select: { task: { select: { id: true } } },
            });
            const taskId = quoteWithTask?.task?.id;

            if (taskId) {
              // Find matching PRODUCTION service orders
              const productionSOs = await tx.serviceOrder.findMany({
                where: {
                  taskId,
                  type: SERVICE_ORDER_TYPE.PRODUCTION,
                },
              });

              for (const so of productionSOs) {
                const soNormalized = normalizeDescription(so.description);
                if (descriptionsToDelete.has(soNormalized)) {
                  this.logger.log(
                    `[Quote Update] Deleting service order ${so.id} (${so.description}) — quote service removed`,
                  );
                  await tx.serviceOrder.delete({
                    where: { id: so.id },
                  });
                }
              }
            }
          }

          // =====================================================================
          // SYNC CREATE: When new quote services are added, create corresponding
          // PRODUCTION service orders
          // =====================================================================
          try {
            const quoteWithTask = await tx.taskQuote.findUnique({
              where: { id },
              select: { task: { select: { id: true } } },
            });
            const taskId = quoteWithTask?.task?.id;

            if (taskId) {
              const existingServiceOrders = await tx.serviceOrder.findMany({
                where: { taskId },
                select: { id: true, description: true, observation: true, type: true },
              });

              const existingSOs: SyncServiceOrder[] = existingServiceOrders.map((so: any) => ({
                id: so.id,
                description: so.description,
                observation: so.observation,
                type: so.type,
              }));

              const newServices = (updatedQuote as any).services || [];

              for (let i = 0; i < newServices.length; i++) {
                const service = newServices[i];
                if (!service.description) continue;

                const syncResult = getQuoteItemToServiceOrderSync(
                  { description: service.description, observation: service.observation || null },
                  existingSOs,
                );

                if (syncResult.shouldCreateServiceOrder) {
                  this.logger.log(
                    `[QUOTE→SO SYNC] Creating PRODUCTION service order: "${syncResult.serviceOrderDescription}" for updated quote service`,
                  );

                  await tx.serviceOrder.create({
                    data: {
                      description: syncResult.serviceOrderDescription,
                      observation: syncResult.serviceOrderObservation,
                      status: SERVICE_ORDER_STATUS.PENDING as any,
                      statusOrder: getServiceOrderStatusOrder(SERVICE_ORDER_STATUS.PENDING),
                      type: SERVICE_ORDER_TYPE.PRODUCTION as any,
                      position: service.position ?? i,
                      task: { connect: { id: taskId } },
                      createdBy: { connect: { id: userId } },
                    },
                  });

                  // Add to existing SOs to prevent duplicates within the same batch
                  existingSOs.push({
                    description: syncResult.serviceOrderDescription,
                    observation: syncResult.serviceOrderObservation,
                    type: SERVICE_ORDER_TYPE.PRODUCTION,
                  });
                }
              }
            }
          } catch (syncError) {
            this.logger.error('[QUOTE→SO SYNC] Error during update sync:', syncError);
            // Don't throw - sync errors shouldn't block quote update
          }
        }

        return tx.taskQuote.findUnique({
          where: { id },
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
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
                installments: { orderBy: { number: 'asc' } },
                responsible: { select: { id: true, name: true, role: true } },
                customerSignature: true,
              },
            },
          },
        });
      });

      // Reconcile the "Em Negociação" SO whenever this update changed the
      // quote status (explicit caller status, or the auto-revert-to-PENDING
      // branch above triggered by value-affecting edits) OR the layoutFile —
      // uploading/clearing a layout flips the "has artwork" check.
      if (data.status !== undefined || (data as any).layoutFileId !== undefined) {
        const task = await this.prisma.task.findFirst({
          where: { quoteId: id },
          select: { id: true },
        });
        if (task) {
          await syncEmNegociacaoForTask(this.prisma, task.id, userId);
        }
      }

      return {
        success: true,
        data: updated as any,
        message: 'Orçamento atualizado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating task quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar orçamento.');
    }
  }

  /**
   * Delete quote
   */
  async delete(id: string, userId: string): Promise<TaskQuoteDeleteResponse> {
    try {
      const existing = await this.prisma.taskQuote.findUnique({
        where: { id },
        include: {
          services: { orderBy: { position: 'asc' } },
          task: { select: { id: true } },
          customerConfigs: { select: { id: true, customerId: true } },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Guard: cannot delete a quote that has live financial artifacts (invoices, bank slips,
      // NFS-e). Deleting would orphan records at Sicredi/Elotech and cascade-delete DB rows
      // that are referenced by external systems. Cancel all invoices first.
      const POST_BILLING_STATUSES: TASK_QUOTE_STATUS[] = [
        TASK_QUOTE_STATUS.BILLING_APPROVED,
        TASK_QUOTE_STATUS.UPCOMING,
        TASK_QUOTE_STATUS.DUE,
        TASK_QUOTE_STATUS.PARTIAL,
        TASK_QUOTE_STATUS.SETTLED,
      ];
      if (POST_BILLING_STATUSES.includes((existing as any).status as TASK_QUOTE_STATUS)) {
        throw new BadRequestException(
          'Não é possível deletar um orçamento com faturamento ativo. Cancele todas as faturas antes de deletar.',
        );
      }

      // Store the full quote data for changelog (enables rollback restoration)
      const quoteSnapshot = {
        id: existing.id,
        budgetNumber: existing.budgetNumber,
        subtotal: existing.subtotal,
        total: existing.total,
        expiresAt: existing.expiresAt,
        status: existing.status,
        guaranteeYears: existing.guaranteeYears,
        customGuaranteeText: existing.customGuaranteeText,
        customForecastDays: existing.customForecastDays,
        simultaneousTasks: existing.simultaneousTasks,
        layoutFileId: existing.layoutFileId,
        services: existing.services.map(service => ({
          description: service.description,
          amount: service.amount,
          observation: service.observation,
          position: service.position,
        })),
        customerConfigIds: existing.customerConfigs.map(c => c.customerId),
      };

      const taskId = existing.task?.id;

      await this.prisma.$transaction(async tx => {
        // Nullify quoteId on the associated task before deleting
        if (taskId) {
          await tx.task.update({
            where: { id: taskId },
            data: { quoteId: null },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: taskId,
            action: CHANGE_ACTION.UPDATE,
            field: 'quoteId',
            oldValue: quoteSnapshot,
            newValue: null,
            userId,
            reason: 'Orçamento removido (exclusão do orçamento)',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            transaction: tx,
          });
        }

        await tx.taskQuote.delete({ where: { id } });

        // Log the quote deletion itself
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldValue: quoteSnapshot,
          userId,
          reason: 'Exclusão de orçamento',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Orçamento deletado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error deleting task quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Erro ao deletar orçamento.');
    }
  }

  /**
   * Update quote status (approve/reject/cancel)
   */
  async updateStatus(
    id: string,
    status: TASK_QUOTE_STATUS,
    userId: string,
  ): Promise<TaskQuoteUpdateResponse> {
    try {
      const existing = await this.taskQuoteRepository.findById(id);

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Validate status transition
      this.validateStatusTransition(existing.status as TASK_QUOTE_STATUS, status);

      // Manual SETTLED: auto-cancel open bank slips and mark installments as paid
      if (status === TASK_QUOTE_STATUS.SETTLED) {
        await this.settleManually(id);
      } else {
        // Validate prerequisites for the target status
        await this.validateStatusPrerequisites(id, existing.status as TASK_QUOTE_STATUS, status);
      }

      // Update status — pass _internal=true to bypass the external-call guard
      const updated = await this.update(id, { status }, userId, true);

      // Reconcile the "Em Negociação" COMMERCIAL ServiceOrder. Best-effort:
      // never throws into the caller's flow.
      const task = await this.prisma.task.findFirst({
        where: { quoteId: id },
        select: { id: true },
      });
      if (task) {
        await syncEmNegociacaoForTask(this.prisma, task.id, userId);
      }

      return {
        success: true,
        data: updated.data,
        message: `Orçamento ${this.getStatusLabel(status)} com sucesso.`,
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating quote status ${id}:`, error);
      throw error;
    }
  }

  /**
   * Settle a quote manually — auto-cancels open bank slips and marks all installments as PAID.
   * Used when payment was received via PIX, cash, or other non-boleto means.
   */
  private async settleManually(quoteId: string): Promise<void> {
    // Track bank slips that need to be cancelled at Sicredi (after the local transaction commits)
    const slipsToCancelAtSicredi: Array<{ id: string; nossoNumero: string }> = [];

    await this.prisma.$transaction(async tx => {
      // Find all installments for this quote that aren't already PAID or CANCELLED
      const installments = await tx.installment.findMany({
        where: {
          customerConfig: { quoteId },
          status: { notIn: [INSTALLMENT_STATUS.PAID, 'CANCELLED' as any] },
        },
        include: {
          bankSlip: true,
        },
      });

      const now = new Date();

      for (const installment of installments) {
        // Cancel active/overdue bank slips locally; remote Sicredi cancellation is fired below.
        if (
          installment.bankSlip &&
          ![BANK_SLIP_STATUS.PAID, BANK_SLIP_STATUS.CANCELLED].includes(
            installment.bankSlip.status as BANK_SLIP_STATUS,
          )
        ) {
          await tx.bankSlip.update({
            where: { id: installment.bankSlip.id },
            data: { status: BANK_SLIP_STATUS.CANCELLED },
          });

          // Queue for Sicredi-side cancellation only if the boleto was actually registered
          // (nossoNumero is truthy and not a temporary placeholder like "TMP-<installmentId>").
          if (
            installment.bankSlip.nossoNumero &&
            !installment.bankSlip.nossoNumero.startsWith('TMP-')
          ) {
            slipsToCancelAtSicredi.push({
              id: installment.bankSlip.id,
              nossoNumero: installment.bankSlip.nossoNumero,
            });
          }
        }

        // Mark installment as PAID
        await tx.installment.update({
          where: { id: installment.id },
          data: {
            status: INSTALLMENT_STATUS.PAID,
            paidAmount: installment.amount,
            paidAt: now,
          },
        });
      }

      // Update all invoices for this quote to PAID
      const invoices = await tx.invoice.findMany({
        where: {
          customerConfig: { quoteId },
          status: { not: INVOICE_STATUS.CANCELLED },
        },
        include: {
          installments: { select: { amount: true, paidAmount: true } },
        },
      });

      for (const invoice of invoices) {
        // Use actual paidAmount when available (webhook payments may differ from face value
        // due to Sicredi fines/interest). Fall back to face-value amount for installments
        // being settled now (paidAmount not yet recorded).
        const totalPaid = invoice.installments.reduce((sum, inst) => {
          const paid = Number(inst.paidAmount ?? 0);
          return sum + (paid > 0 ? paid : Number(inst.amount));
        }, 0);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: INVOICE_STATUS.PAID,
            paidAmount: totalPaid,
          },
        });
      }
    });

    // Fire Sicredi cancellations AFTER the local transaction commits.
    // We don't block the manual settlement on Sicredi failures — if the bank is down or rejects,
    // we persist the failure on the BankSlip.errorMessage so a future retry job (sicredi-boleto.scheduler)
    // can pick them up. The slip is already marked CANCELLED locally so the customer-facing UI is correct
    // even if the remote cancellation hasn't propagated yet.
    if (slipsToCancelAtSicredi.length > 0) {
      this.logger.log(
        `[SETTLE_MANUALLY] Firing Sicredi cancellation for ${slipsToCancelAtSicredi.length} bank slip(s) on quote ${quoteId}...`,
      );

      const results = await Promise.allSettled(
        slipsToCancelAtSicredi.map(slip =>
          this.sicrediService
            .cancelBoleto(slip.nossoNumero)
            .then(() => ({ slip, ok: true as const }))
            .catch(err => ({ slip, ok: false as const, err })),
        ),
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          // Should not happen since we catch above, but guard anyway.
          this.logger.error(
            `[SETTLE_MANUALLY] Unexpected promise rejection during Sicredi cancellation: ${result.reason}`,
          );
          continue;
        }

        const value = result.value as
          | { slip: { id: string; nossoNumero: string }; ok: true }
          | { slip: { id: string; nossoNumero: string }; ok: false; err: unknown };
        if (value.ok === true) {
          this.logger.log(
            `[SETTLE_MANUALLY] Sicredi cancellation OK for nossoNumero=${value.slip.nossoNumero}`,
          );
        } else {
          const err = value.err;
          const reason = err instanceof Error ? err.message : String(err ?? 'unknown error');
          this.logger.warn(
            `[SETTLE_MANUALLY] Sicredi cancellation FAILED for nossoNumero=${value.slip.nossoNumero}: ${reason}. ` +
              `Slip is CANCELLED locally; needs retry by sicredi-boleto scheduler.`,
          );

          // Persist failure on the slip so a retry job can pick it up. Schema has no dedicated
          // "needs cancellation retry" flag, so we encode it in errorMessage with a stable prefix.
          try {
            await this.prisma.bankSlip.update({
              where: { id: value.slip.id },
              data: {
                errorMessage: `Cancellation failed at Sicredi: ${reason}`,
              },
            });
          } catch (persistErr) {
            this.logger.error(
              `[SETTLE_MANUALLY] Failed to persist cancellation error on slip ${value.slip.id}: ${persistErr}`,
            );
          }
        }
      }
    }

    this.logger.log(
      `[SETTLE_MANUALLY] Quote ${quoteId} settled manually. All installments marked as PAID, open bank slips cancelled.`,
    );
  }

  /**
   * Customer approves the budget
   */
  async budgetApprove(id: string, userId: string): Promise<TaskQuoteUpdateResponse> {
    return this.updateStatus(id, TASK_QUOTE_STATUS.BUDGET_APPROVED, userId);
  }

  /**
   * Commercial approves the quote
   */
  async commercialApprove(id: string, userId: string): Promise<TaskQuoteUpdateResponse> {
    return this.updateStatus(id, TASK_QUOTE_STATUS.COMMERCIAL_APPROVED, userId);
  }

  /**
   * Manually reconcile the "Em Negociação" SO for the task tied to this quote.
   * Recovery path: a task can land in a stuck state if a status change happened
   * before the sync logic existed (or before a bug fix). This endpoint replays
   * the reconciliation without requiring a status transition.
   */
  async syncEmNegociacao(
    id: string,
    userId: string,
  ): Promise<{ success: true; message: string }> {
    const task = await this.prisma.task.findFirst({
      where: { quoteId: id },
      select: { id: true },
    });
    if (!task) {
      throw new NotFoundException(`Tarefa para o orçamento ${id} não encontrada.`);
    }
    await syncEmNegociacaoForTask(this.prisma, task.id, userId);
    return { success: true, message: 'Em Negociação reconciliada.' };
  }

  /**
   * Commercial/admin final approval — triggers invoice + NFS-e generation
   */
  async internalApprove(id: string, userId: string): Promise<TaskQuoteUpdateResponse> {
    this.logger.log(
      `[INTERNAL_APPROVE] Starting internal approval for quote ${id} by user ${userId}`,
    );

    // 1. Validate the quote exists and prerequisites are met
    const existing = await this.taskQuoteRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
    }
    this.validateStatusTransition(
      existing.status as TASK_QUOTE_STATUS,
      TASK_QUOTE_STATUS.BILLING_APPROVED,
    );
    await this.validateStatusPrerequisites(
      id,
      existing.status as TASK_QUOTE_STATUS,
      TASK_QUOTE_STATUS.BILLING_APPROVED,
    );

    // Capture billing approval time now — used as the base date for installment due date calculation.
    // "First payment in N days" counts from this moment, not from task.finishedAt.
    const approvalDate = new Date();

    // 2. Atomically claim the status transition (prevents concurrent approvals)
    // Only one request can win: the one that finds status=COMMERCIAL_APPROVED and sets it to BILLING_APPROVED
    const claimed = await this.prisma.taskQuote.updateMany({
      where: { id, status: TASK_QUOTE_STATUS.COMMERCIAL_APPROVED },
      data: {
        status: TASK_QUOTE_STATUS.BILLING_APPROVED,
        statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.BILLING_APPROVED),
        // billingApprovedAt exists in schema.prisma but the generated Prisma client is stale;
        // cast to satisfy the type checker until `prisma generate` is rerun.
        billingApprovedAt: approvalDate,
      } as any,
    });
    if (claimed.count === 0) {
      throw new BadRequestException(
        'O orçamento não está mais no status Aprovado pelo Comercial. Pode ter sido aprovado por outra requisição simultânea.',
      );
    }

    this.logger.log(
      `[INTERNAL_APPROVE] Status atomically claimed to BILLING_APPROVED for quote ${id}`,
    );

    // Trigger invoice generation and auto-transition to UPCOMING
    // If anything fails, revert status back to COMMERCIAL_APPROVED so the user can retry
    try {
      const task = await this.prisma.task.findFirst({
        where: { quoteId: id },
        select: { id: true, name: true, serialNumber: true },
      });

      this.logger.log(
        `[INTERNAL_APPROVE] Task lookup result: ${task ? `found task ${task.id} (${task.name} #${task.serialNumber})` : 'NO TASK FOUND'}`,
      );

      if (!task) {
        throw new InternalServerErrorException(
          `Nenhuma tarefa encontrada para o orçamento ${id}. Não é possível gerar faturas.`,
        );
      }

      this.logger.log(`[INTERNAL_APPROVE] Triggering invoice generation for task ${task.id}...`);
      const invoiceIds = await this.invoiceGenerationService.generateInvoicesForTask(
        task.id,
        userId,
        approvalDate,
      );
      this.logger.log(
        `[INTERNAL_APPROVE] Invoice generation complete: ${invoiceIds.length} invoice(s) created [${invoiceIds.join(', ')}]`,
      );

      if (invoiceIds.length === 0) {
        throw new InternalServerErrorException(
          `Nenhuma fatura foi gerada para o orçamento ${id}. Verifique a configuração de faturamento.`,
        );
      }

      // Emit NfSe FIRST (awaited) so the NfSe number is available for seuNumero on the bank slip.
      // For invoices with generateInvoice=false no NfseDocument exists, so this is a no-op for them.
      this.logger.log(
        `[INTERNAL_APPROVE] Emitting NfSe for ${invoiceIds.length} invoice(s) before registering bank slips...`,
      );
      try {
        await this.nfseEmissionScheduler.emitNfseForInvoices(invoiceIds);
      } catch (nfseError) {
        this.logger.warn(`[INTERNAL_APPROVE] NfSe emission error: ${nfseError}`);
      }

      // Only register bank slips for invoices that are ready:
      //   (a) generateInvoice=false — no NFS-e required, seuNumero uses truck plate
      //   (b) generateInvoice=true  — NFS-e is now AUTHORIZED
      // Invoices in (b) that failed NFS-e keep their bank slips in CREATING state.
      // The bank slip scheduler picks them up once the NFS-e scheduler retries and authorizes.
      const [authorizedNfse, noNfseRequired] = await Promise.all([
        this.prisma.nfseDocument.findMany({
          where: { invoiceId: { in: invoiceIds }, status: 'AUTHORIZED' },
          select: { invoiceId: true },
        }),
        this.prisma.invoice.findMany({
          where: {
            id: { in: invoiceIds },
            customerConfig: { generateInvoice: false },
          },
          select: { id: true },
        }),
      ]);
      const readyForBoleto = [
        ...new Set([
          ...authorizedNfse.map(n => n.invoiceId),
          ...noNfseRequired.map(i => i.id),
        ]),
      ];
      const blockedCount = invoiceIds.length - readyForBoleto.length;
      if (blockedCount > 0) {
        this.logger.warn(
          `[INTERNAL_APPROVE] ${blockedCount} invoice(s) skipped bank slip registration (NFS-e not yet authorized). Bank slip scheduler will retry after NFS-e succeeds.`,
        );
      }

      // Register bank slips AFTER NfSe — buildSeuNumero will find authorized NfseDocument.
      if (readyForBoleto.length > 0) {
        this.logger.log(
          `[INTERNAL_APPROVE] Registering bank slips at Sicredi for ${readyForBoleto.length} invoice(s)...`,
        );
        try {
          await this.invoiceGenerationService.registerBankSlipsAtSicredi(readyForBoleto);
        } catch (boletoError) {
          this.logger.warn(
            `[INTERNAL_APPROVE] Some bank slips failed to register at Sicredi (will be retried by scheduler): ${boletoError}`,
          );
        }
      }

      // Auto-transition to UPCOMING after successful invoice generation
      this.logger.log(`[INTERNAL_APPROVE] Auto-transitioning quote ${id} to UPCOMING...`);
      await this.update(id, { status: TASK_QUOTE_STATUS.UPCOMING } as any, userId, true);
      this.logger.log(`[INTERNAL_APPROVE] Quote ${id} transitioned to UPCOMING successfully`);
    } catch (error) {
      this.logger.error(
        `[INTERNAL_APPROVE] Failed during invoice generation/transition for quote ${id}: ${error}`,
      );
      if (error instanceof Error) {
        this.logger.error(`[INTERNAL_APPROVE] Stack trace: ${error.stack}`);
      }

      // Revert status back to COMMERCIAL_APPROVED so the quote is not stuck at BILLING_APPROVED
      // Uses direct prisma update to bypass status transition validation (BILLING_APPROVED → COMMERCIAL_APPROVED is not normally allowed)
      try {
        this.logger.warn(
          `[INTERNAL_APPROVE] Rolling back quote ${id} status from BILLING_APPROVED to COMMERCIAL_APPROVED...`,
        );
        await this.prisma.taskQuote.update({
          where: { id },
          data: {
            status: TASK_QUOTE_STATUS.COMMERCIAL_APPROVED,
            statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.COMMERCIAL_APPROVED),
          },
        });
        this.logger.warn(
          `[INTERNAL_APPROVE] Rollback successful — quote ${id} reverted to COMMERCIAL_APPROVED`,
        );
      } catch (rollbackError) {
        this.logger.error(
          `[INTERNAL_APPROVE] CRITICAL: Failed to rollback quote ${id} status to COMMERCIAL_APPROVED: ${rollbackError}`,
        );
      }

      // Propagate the error to the client
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Falha ao gerar faturas para o orçamento. O status foi revertido para Aprovado pelo Comercial. Erro: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const refreshed = await this.taskQuoteRepository.findById(id);
    return {
      success: true,
      data: refreshed as any,
      message: 'Faturamento do orçamento aprovado com sucesso.',
    };
  }

  /**
   * Revert billing approval — undo internalApprove when all bank slips and NFS-e are cancelled.
   * Deletes the invoices (cascading installments, bank slips, NFS-e docs) and reverts the
   * quote status back to COMMERCIAL_APPROVED so the operator can re-approve after corrections.
   */
  async revertBillingApproval(id: string, userId: string): Promise<TaskQuoteUpdateResponse> {
    this.logger.log(`[REVERT_BILLING] Starting revert billing for quote ${id} by user ${userId}`);

    const existing = await this.taskQuoteRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Orçamento ${id} não encontrado.`);
    }

    const revertableStatuses = [
      TASK_QUOTE_STATUS.BILLING_APPROVED,
      TASK_QUOTE_STATUS.UPCOMING,
      TASK_QUOTE_STATUS.DUE,
      TASK_QUOTE_STATUS.PARTIAL,
    ] as string[];

    if (!revertableStatuses.includes(existing.status)) {
      throw new BadRequestException(
        `Não é possível reverter o faturamento no status "${existing.status}". ` +
          `O orçamento precisa estar em Faturamento Aprovado, A Vencer, Vencido ou Pago Parcialmente.`,
      );
    }

    const task = await this.prisma.task.findFirst({
      where: { quoteId: id },
      select: { id: true },
    });
    if (!task) throw new NotFoundException(`Tarefa para o orçamento ${id} não encontrada.`);

    // Verify all bank slips are cancelled
    const activeSlips = await this.prisma.bankSlip.findMany({
      where: {
        installment: { invoice: { taskId: task.id } },
        status: { not: 'CANCELLED' },
      },
      select: { id: true, status: true },
    });
    if (activeSlips.length > 0) {
      throw new BadRequestException(
        `Existem ${activeSlips.length} boleto(s) não cancelado(s). ` +
          `Cancele todos os boletos antes de reverter o faturamento.`,
      );
    }

    // Verify all NFS-e docs are cancelled or error (not authorized/processing)
    const activeNfses = await this.prisma.nfseDocument.findMany({
      where: {
        invoice: { taskId: task.id },
        status: { in: ['AUTHORIZED', 'PROCESSING', 'PENDING'] },
      },
      select: { id: true, status: true },
    });
    if (activeNfses.length > 0) {
      throw new BadRequestException(
        `Existem NFS-e(s) não cancelada(s) (${activeNfses.map(n => n.status).join(', ')}). ` +
          `Cancele todas as NFS-e antes de reverter o faturamento.`,
      );
    }

    // Verify no installment has been paid
    const paidInstallments = await this.prisma.installment.findMany({
      where: {
        invoice: { taskId: task.id },
        status: { in: ['PAID'] },
      },
      select: { id: true },
    });
    if (paidInstallments.length > 0) {
      throw new BadRequestException(
        `Existem ${paidInstallments.length} parcela(s) paga(s). Não é possível reverter um faturamento com pagamentos registrados.`,
      );
    }

    await this.prisma.$transaction(async tx => {
      // Delete installments (cascades bank slips via FK)
      await tx.installment.deleteMany({ where: { invoice: { taskId: task.id } } });
      // Delete invoices (cascades NfseDocument via FK)
      await tx.invoice.deleteMany({ where: { taskId: task.id } });
      // Revert quote status
      await tx.taskQuote.update({
        where: { id },
        data: {
          status: TASK_QUOTE_STATUS.COMMERCIAL_APPROVED,
          statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.COMMERCIAL_APPROVED),
        },
      });
    });

    this.logger.log(
      `[REVERT_BILLING] Quote ${id} reverted to COMMERCIAL_APPROVED. Invoices/installments/bank slips deleted.`,
    );

    // Direct prisma write above bypasses updateStatus — reconcile explicitly.
    // Status moves stay within ≥ BUDGET_APPROVED so this is usually a no-op
    // for Em Negociação, but kept for symmetry with other status-change paths.
    await syncEmNegociacaoForTask(this.prisma, task.id, userId);

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_QUOTE,
      entityId: id,
      action: CHANGE_ACTION.ROLLBACK,
      field: 'status',
      oldValue: existing.status,
      newValue: TASK_QUOTE_STATUS.COMMERCIAL_APPROVED,
      reason: 'Faturamento revertido pelo operador',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId,
      userId,
    });

    const refreshed = await this.taskQuoteRepository.findById(id);
    return {
      success: true,
      data: refreshed as any,
      message: 'Faturamento revertido com sucesso. O orçamento retornou para Aprovado pelo Comercial.',
    };
  }

  /**
   * Get approved price for a task
   */
  async getApprovedPriceForTask(taskId: string): Promise<number> {
    const quote = await this.taskQuoteRepository.findApprovedByTaskId(taskId);
    return quote?.total || 0;
  }

  /**
   * Find expired quotes and optionally mark them
   */
  async findAndMarkExpired(): Promise<TaskQuote[]> {
    try {
      const expired = await this.taskQuoteRepository.findExpired();

      this.logger.log(`Found ${expired.length} expired quotes`);

      return expired;
    } catch (error: unknown) {
      this.logger.error('Error finding expired quotes:', error);
      throw new InternalServerErrorException('Erro ao buscar orçamentos expirados.');
    }
  }

  /**
   * Find suggestion: most recent quote matching task name, customer, truck category, and implement type.
   * All four fields must match exactly.
   */
  async findSuggestion(params: {
    name: string;
    customerId: string;
    category: string;
    implementType: string;
  }) {
    try {
      const suggestion = await this.taskQuoteRepository.findSuggestion(params);

      if (!suggestion) {
        return {
          success: true,
          data: null,
          message: 'Nenhuma sugestão encontrada.',
        };
      }

      return {
        success: true,
        data: suggestion,
        message: 'Sugestão encontrada com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error finding suggestion:', error);
      throw new InternalServerErrorException('Erro ao buscar sugestão.');
    }
  }

  // =====================
  // PUBLIC METHODS (No Authentication Required)
  // =====================

  /**
   * Find quote for public view (customer budget page)
   * Only returns data if quote is not expired (unless ignoreExpiration is true)
   * @param id - Quote ID
   * @param ignoreExpiration - If true, returns quote even if expired (for authenticated users)
   */
  async findPublic(id: string, ignoreExpiration = false): Promise<TaskQuoteGetUniqueResponse> {
    try {
      // Public-facing select clause — DB-layer enforcement (preferred over post-fetch masking).
      // Sensitive fields explicitly NOT selected: BankSlip.barcode/linhaDigitavel/pixQrCode/
      // nossoNumero/sicrediStatus/errorMessage/liquidationData/pdfFileId, NfseDocument numbering
      // and URLs, responsibleUser (entire user record), createdById/updatedById, internal status reasons.
      const quote = await this.prisma.taskQuote.findUnique({
        where: { id },
        select: {
          id: true,
          subtotal: true,
          total: true,
          expiresAt: true,
          status: true,
          guaranteeYears: true,
          customGuaranteeText: true,
          customForecastDays: true,
          simultaneousTasks: true,
          budgetNumber: true,
          createdAt: true,
          updatedAt: true,
          layoutFile: {
            select: { id: true, filename: true, originalName: true, mimetype: true, size: true },
          },
          services: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              description: true,
              observation: true,
              amount: true,
              position: true,
              invoiceToCustomer: {
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true },
              },
            },
          },
          customerConfigs: {
            select: {
              id: true,
              subtotal: true,
              total: true,
              discountType: true,
              discountValue: true,
              discountReference: true,
              customPaymentText: true,
              generateInvoice: true,
              generateBankSlip: true,
              orderNumber: true,
              paymentCondition: true,
              paymentConfig: true,
              responsible: {
                select: { id: true, name: true, role: true },
              },
              customer: {
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true },
              },
              customerSignature: {
                select: { id: true, filename: true, originalName: true, mimetype: true },
              },
              installments: {
                orderBy: { number: 'asc' },
                select: {
                  id: true,
                  number: true,
                  amount: true,
                  dueDate: true,
                  status: true,
                  // Bank slip: ONLY surface non-sensitive presentation fields. No barcode/PIX/
                  // nossoNumero/sicrediStatus/errorMessage/liquidationData/pdfFileId.
                  bankSlip: {
                    select: {
                      id: true,
                      status: true,
                      dueDate: true,
                      amount: true,
                      type: true,
                    },
                  },
                },
              },
              // Invoice: public-relevant status fields plus the AUTHORIZED NFSe ids
              // so the dossier page can render the NFSe PDFs from /nfse/public/:id/pdf.
              invoice: {
                select: {
                  id: true,
                  status: true,
                  totalAmount: true,
                  paidAmount: true,
                  nfseDocuments: {
                    where: { status: 'AUTHORIZED', elotechNfseId: { not: null } },
                    select: { id: true, status: true, elotechNfseId: true, nfseNumber: true },
                  },
                },
              },
            },
          },
          task: {
            select: {
              id: true,
              name: true,
              serialNumber: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              customer: {
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true },
              },
              responsibles: {
                select: { id: true, name: true, role: true },
                orderBy: { createdAt: 'asc' },
              },
              truck: {
                select: { id: true, plate: true, chassisNumber: true, category: true, implementType: true },
              },
              serviceOrders: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  description: true,
                  status: true,
                  type: true,
                  position: true,
                  startedAt: true,
                  finishedAt: true,
                  checkinFiles: { select: { id: true, filename: true, originalName: true } },
                  checkoutFiles: { select: { id: true, filename: true, originalName: true } },
                },
              },
            },
          },
        },
      });

      if (!quote) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if quote is expired (skip check if user is authenticated)
      const now = new Date();
      if (!ignoreExpiration && new Date(quote.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou e não está mais disponível para visualização.',
        );
      }

      return {
        success: true,
        data: quote as any,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding public quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Upload customer signature for quote (public endpoint)
   * Only allows upload if quote is not expired
   */
  async uploadCustomerSignature(
    id: string,
    file: Express.Multer.File,
    customerConfigId?: string,
  ): Promise<TaskQuoteUpdateResponse> {
    try {
      const quote = await this.prisma.taskQuote.findUnique({
        where: { id },
        include: {
          customerConfigs: {
            include: { customerSignature: true },
          },
        },
      });

      if (!quote) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if quote is expired
      const now = new Date();
      if (new Date(quote.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou. Não é possível enviar a assinatura.',
        );
      }

      // Find the target customer config
      const targetConfig = customerConfigId
        ? quote.customerConfigs.find(c => c.id === customerConfigId)
        : quote.customerConfigs[0];

      if (!targetConfig) {
        throw new BadRequestException('Configuração de cliente não encontrada.');
      }

      // Create file record for signature
      const signatureFile = await this.prisma.file.create({
        data: {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          path: file.path,
          size: file.size,
        },
      });

      // Update customer config with signature
      await this.prisma.taskQuoteCustomerConfig.update({
        where: { id: targetConfig.id },
        data: {
          customerSignatureId: signatureFile.id,
        },
      });

      // Delete old signature file if it exists
      if (targetConfig.customerSignature) {
        await this.prisma.file
          .delete({
            where: { id: targetConfig.customerSignature.id },
          })
          .catch(() => {
            // Ignore errors when deleting old file
          });
      }

      // Re-fetch the full quote
      const updated = await this.prisma.taskQuote.findUnique({
        where: { id },
        include: {
          services: true,
          layoutFile: true,
          customerConfigs: {
            include: {
              customer: { select: { id: true, fantasyName: true, cnpj: true } },
              customerSignature: true,
              responsible: true,
            },
          },
          task: {
            include: {
              customer: true,
            },
          },
        },
      });

      // Log signature changelog
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK_QUOTE,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'customerSignatureId',
        oldValue: targetConfig.customerSignatureId || null,
        newValue: signatureFile.id,
        userId: null,
        reason: 'Assinatura do cliente enviada',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
        triggeredById: null,
      });

      this.logger.log(`Customer signature uploaded for quote ${id}, config ${targetConfig.id}`);

      return {
        success: true,
        data: updated as any,
        message: 'Assinatura enviada com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error uploading signature for quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao enviar assinatura.');
    }
  }

  /**
   * Validate status transition
   * @private
   */
  private validateStatusTransition(
    currentStatus: TASK_QUOTE_STATUS,
    newStatus: TASK_QUOTE_STATUS,
  ): void {
    if (currentStatus === newStatus) {
      throw new BadRequestException(`O status já é ${currentStatus}`);
    }

    // Explicit allowlist for manual status changes via the /status endpoint.
    //
    // Scheduler-driven cascades (UPCOMING↔DUE↔PARTIAL on installment events)
    // bypass this via direct prisma.taskQuote.update — the scheduler is the
    // authoritative source for those transitions. This allowlist covers
    // operator-initiated overrides (admin corrections, chargebacks, manual
    // re-cycles when the scheduler hasn't caught up or made a wrong call).
    //
    // Mirrors web/src/utils/permissions/quote-permissions.ts VALID_TRANSITIONS
    // exactly — drift here breaks the UI (advertised transitions returning 400).
    // Additional: COMMERCIAL_APPROVED → PENDING is allowed so the cancel/reject
    // button works for the most common cancellation point (customer cancels
    // before billing); from BILLING_APPROVED onward, operators must use
    // /revert-billing first (which gates on bank-slip + NFS-e cleanup).
    const ALLOWED: Record<TASK_QUOTE_STATUS, TASK_QUOTE_STATUS[]> = {
      [TASK_QUOTE_STATUS.PENDING]:             [TASK_QUOTE_STATUS.BUDGET_APPROVED],
      [TASK_QUOTE_STATUS.BUDGET_APPROVED]:     [TASK_QUOTE_STATUS.PENDING, TASK_QUOTE_STATUS.COMMERCIAL_APPROVED],
      [TASK_QUOTE_STATUS.COMMERCIAL_APPROVED]: [TASK_QUOTE_STATUS.PENDING, TASK_QUOTE_STATUS.BUDGET_APPROVED, TASK_QUOTE_STATUS.BILLING_APPROVED],
      // BILLING_APPROVED → SETTLED covers prepayment edge cases (customer pays
      // before installments are tracked) and lets operators settle quotes that
      // got stuck at BILLING_APPROVED when internalApprove's auto-transition to
      // UPCOMING failed mid-flow. settleManually marks any existing installments
      // PAID and cancels open boletos, so the cleanup is safe regardless of
      // entry status.
      [TASK_QUOTE_STATUS.BILLING_APPROVED]:    [TASK_QUOTE_STATUS.UPCOMING, TASK_QUOTE_STATUS.SETTLED],
      [TASK_QUOTE_STATUS.UPCOMING]:            [TASK_QUOTE_STATUS.PARTIAL, TASK_QUOTE_STATUS.DUE, TASK_QUOTE_STATUS.BILLING_APPROVED, TASK_QUOTE_STATUS.SETTLED],
      [TASK_QUOTE_STATUS.DUE]:                 [TASK_QUOTE_STATUS.PARTIAL, TASK_QUOTE_STATUS.SETTLED, TASK_QUOTE_STATUS.UPCOMING],
      [TASK_QUOTE_STATUS.PARTIAL]:             [TASK_QUOTE_STATUS.SETTLED, TASK_QUOTE_STATUS.DUE, TASK_QUOTE_STATUS.UPCOMING],
      // SETTLED → PARTIAL handles chargeback/estorno (payment reversed after a
      // previously settled invoice). Mirrors the web comment at
      // quote-permissions.ts:73-76.
      [TASK_QUOTE_STATUS.SETTLED]:             [TASK_QUOTE_STATUS.PARTIAL],
    };

    const allowed = ALLOWED[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Transição de status inválida: ${currentStatus} → ${newStatus}.`,
      );
    }
  }

  /**
   * Validate prerequisites for a status transition.
   * Ensures required data exists before allowing certain status changes.
   * @private
   */
  private async validateStatusPrerequisites(
    quoteId: string,
    currentStatus: TASK_QUOTE_STATUS,
    newStatus: TASK_QUOTE_STATUS,
  ): Promise<void> {
    const transition = `${currentStatus}->${newStatus}`;

    switch (transition) {
      case `${TASK_QUOTE_STATUS.PENDING}->${TASK_QUOTE_STATUS.BUDGET_APPROVED}`:
      case `${TASK_QUOTE_STATUS.BUDGET_APPROVED}->${TASK_QUOTE_STATUS.COMMERCIAL_APPROVED}`: {
        // Must have at least one customerConfig with total > 0
        const configs = await this.prisma.taskQuoteCustomerConfig.findMany({
          where: { quoteId },
          select: { total: true },
        });

        if (configs.length === 0) {
          throw new BadRequestException(
            'É necessário ter pelo menos uma configuração de cliente antes de avançar o status.',
          );
        }

        const hasPositiveTotal = configs.some(c => Number(c.total) > 0);
        if (!hasPositiveTotal) {
          throw new BadRequestException(
            'Pelo menos uma configuração de cliente deve ter um valor total maior que zero.',
          );
        }
        break;
      }

      case `${TASK_QUOTE_STATUS.COMMERCIAL_APPROVED}->${TASK_QUOTE_STATUS.BILLING_APPROVED}`: {
        // Each customerConfig must have valid paymentCondition or paymentConfig; task must be finished
        const configs = await this.prisma.taskQuoteCustomerConfig.findMany({
          where: { quoteId },
          select: {
            id: true,
            customerId: true,
            paymentCondition: true,
            paymentConfig: true,
            customPaymentText: true,
            customer: {
              select: {
                fantasyName: true,
                corporateName: true,
                cnpj: true,
                cpf: true,
                address: true,
                addressNumber: true,
                neighborhood: true,
                city: true,
                state: true,
                zipCode: true,
              },
            },
          },
        });

        if (configs.length === 0) {
          throw new BadRequestException(
            'É necessário ter pelo menos uma configuração de cliente antes de aprovar internamente.',
          );
        }

        // Check that the task is finished (finishedAt is set) — needed for installment due date calculation
        const taskForValidation = await this.prisma.task.findFirst({
          where: { quoteId },
          select: { finishedAt: true },
        });

        if (!taskForValidation?.finishedAt) {
          throw new BadRequestException(
            'A tarefa precisa estar finalizada para aprovar o faturamento. A data de finalização é usada para calcular os vencimentos das parcelas.',
          );
        }

        // Validate services: none may have negative amounts
        const services = await this.prisma.taskQuoteService.findMany({
          where: { quoteId },
          select: { id: true, description: true, amount: true, invoiceToCustomerId: true },
        });

        const negativeAmountServices = services.filter(s => Number(s.amount) < 0);
        if (negativeAmountServices.length > 0) {
          throw new BadRequestException(
            `Os seguintes serviços possuem valor negativo: ${negativeAmountServices.map(s => `"${s.description}"`).join(', ')}. Os serviços não podem ter valor negativo para faturamento.`,
          );
        }

        // Multi-customer: all services must have invoiceToCustomerId
        if (configs.length >= 2) {
          const unassigned = services.filter(s => !s.invoiceToCustomerId);
          if (unassigned.length > 0) {
            throw new BadRequestException(
              `Os seguintes serviços não possuem cliente atribuído: ${unassigned.map(s => `"${s.description}"`).join(', ')}. Quando há múltiplos clientes, todos os serviços devem ter um cliente selecionado.`,
            );
          }
        }

        for (const config of configs) {
          const customerName =
            config.customer?.fantasyName || config.customer?.corporateName || 'Cliente';
          const isCustomPayment = config.paymentCondition === 'CUSTOM';
          const hasPaymentConfig = !!(config as any).paymentConfig;

          if (!config.paymentCondition && !hasPaymentConfig) {
            throw new BadRequestException(
              `A condição de pagamento não foi definida para o cliente "${customerName}".`,
            );
          }

          // Custom payment uses free-text description
          if (isCustomPayment) {
            if (!config.customPaymentText?.trim()) {
              throw new BadRequestException(
                `O cliente "${customerName}" possui condição de pagamento personalizada, mas não tem o texto de pagamento preenchido.`,
              );
            }
            continue;
          }

          // Validate customer NFS-e required fields
          const c = config.customer;
          if (!c) continue;
          const missing: string[] = [];
          if (!c.cnpj && !c.cpf) missing.push('CNPJ ou CPF');
          if (!c.fantasyName?.trim()) missing.push('Nome Fantasia');
          if (!c.corporateName?.trim()) missing.push('Razão Social');
          if (!c.address?.trim()) missing.push('Logradouro');
          if (!c.addressNumber?.trim()) missing.push('Número');
          if (!c.neighborhood?.trim()) missing.push('Bairro');
          if (!c.city?.trim()) missing.push('Cidade');
          if (!c.state?.trim()) missing.push('Estado');
          if (!c.zipCode?.trim()) missing.push('CEP');
          if (missing.length > 0) {
            throw new BadRequestException(
              `O cliente "${customerName}" possui dados incompletos para emissão de NFS-e. Campos faltantes: ${missing.join(', ')}.`,
            );
          }
        }

        // Sum-divergence check: warn (but don't block) when sum(config.total) != quote.total.
        // This can happen legitimately due to discounts or manual adjustments, so we only log.
        // A hard block would prevent intentional partial-invoicing or courtesy adjustments.
        {
          const configTotals = await this.prisma.taskQuoteCustomerConfig.findMany({
            where: { quoteId },
            select: { total: true },
          });
          const sumConfigTotals = configTotals.reduce((acc, c) => acc + Number(c.total), 0);
          const quoteRecord = await this.prisma.taskQuote.findUnique({
            where: { id: quoteId },
            select: { total: true },
          });
          const quoteTotal = Number(quoteRecord?.total ?? 0);
          const diff = Math.abs(sumConfigTotals - quoteTotal);
          if (diff > 0.02) {
            this.logger.warn(
              `[BILLING_APPROVE] Sum of customerConfig totals (${sumConfigTotals.toFixed(2)}) differs from quote.total (${quoteTotal.toFixed(2)}) by ${diff.toFixed(2)} for quoteId=${quoteId}. This may be intentional (discounts/adjustments) but verify before proceeding.`,
            );
          }
        }
        break;
      }

      case `${TASK_QUOTE_STATUS.UPCOMING}->${TASK_QUOTE_STATUS.PARTIAL}`: {
        // At least one installment must be PAID
        const paidCount = await this.prisma.installment.count({
          where: {
            customerConfig: { quoteId },
            status: INSTALLMENT_STATUS.PAID,
          },
        });

        if (paidCount === 0) {
          throw new BadRequestException(
            'É necessário que pelo menos uma parcela esteja paga para marcar como parcialmente pago.',
          );
        }
        break;
      }

      case `${TASK_QUOTE_STATUS.PARTIAL}->${TASK_QUOTE_STATUS.SETTLED}`: {
        // ALL installments must be PAID
        const unpaidCount = await this.prisma.installment.count({
          where: {
            customerConfig: { quoteId },
            status: { not: INSTALLMENT_STATUS.PAID },
          },
        });

        if (unpaidCount > 0) {
          throw new BadRequestException(
            `Ainda existem ${unpaidCount} parcela(s) não paga(s). Todas as parcelas devem estar pagas para liquidar o orçamento.`,
          );
        }
        break;
      }

      case `${TASK_QUOTE_STATUS.SETTLED}->${TASK_QUOTE_STATUS.PARTIAL}`: {
        // At least one installment must NOT be PAID (reversal scenario)
        const nonPaidCount = await this.prisma.installment.count({
          where: {
            customerConfig: { quoteId },
            status: { not: INSTALLMENT_STATUS.PAID },
          },
        });

        if (nonPaidCount === 0) {
          throw new BadRequestException(
            'Todas as parcelas estão pagas. Para reverter para parcial, é necessário que pelo menos uma parcela não esteja paga.',
          );
        }
        break;
      }

      // BILLING_APPROVED -> UPCOMING: automatic (done by internalApprove), no extra checks
      default:
        break;
    }
  }

  /**
   * Get Portuguese label for status
   * @private
   */
  private getStatusLabel(status: TASK_QUOTE_STATUS): string {
    const labels: Record<string, string> = {
      [TASK_QUOTE_STATUS.PENDING]: 'salvo como pendente',
      [TASK_QUOTE_STATUS.BUDGET_APPROVED]: 'orçamento aprovado pelo cliente',
      [TASK_QUOTE_STATUS.COMMERCIAL_APPROVED]: 'aprovado pelo comercial',
      [TASK_QUOTE_STATUS.BILLING_APPROVED]: 'faturamento aprovado',
      [TASK_QUOTE_STATUS.UPCOMING]: 'com parcelas a vencer',
      [TASK_QUOTE_STATUS.DUE]: 'com parcelas vencidas',
      [TASK_QUOTE_STATUS.PARTIAL]: 'parcialmente pago',
      [TASK_QUOTE_STATUS.SETTLED]: 'liquidado',
    };

    return labels[status] || 'atualizado';
  }

  /**
   * Get sort order for a given status
   */
  private getStatusOrder(status: TASK_QUOTE_STATUS): number {
    return TASK_QUOTE_STATUS_ORDER[status] || 1;
  }

  /**
   * Convert paymentCondition + finishedAt + total into installment records.
   * Due dates are calculated from task.finishedAt:
   * - CASH_5: 1 payment, 5 days from finishedAt
   * - CASH_40: 1 payment, 40 days from finishedAt
   * - INSTALLMENTS_N: first at 5 days from finishedAt, subsequent +20 days each
   */
  generateInstallmentsFromCondition(
    paymentCondition: string | null,
    finishedAt: Date,
    total: number,
  ): { number: number; dueDate: Date; amount: number }[] {
    this.logger.log(
      `[INSTALLMENTS] generateInstallmentsFromCondition: condition=${paymentCondition}, finishedAt=${finishedAt}, total=${total}`,
    );

    // Validate total: must be a finite positive number
    if (!Number.isFinite(total) || total <= 0) {
      this.logger.log(`[INSTALLMENTS] Skipping: total is invalid (${total})`);
      return [];
    }

    if (!paymentCondition || paymentCondition === 'CUSTOM') {
      this.logger.log(`[INSTALLMENTS] Skipping: condition is ${paymentCondition}`);
      return [];
    }

    const baseDate = new Date(finishedAt);

    // CASH_5: single payment, 5 days from finishedAt
    if (paymentCondition === 'CASH_5') {
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + 5);
      return [{ number: 1, dueDate, amount: total }];
    }

    // CASH_40: single payment, 40 days from finishedAt
    if (paymentCondition === 'CASH_40') {
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + 40);
      return [{ number: 1, dueDate, amount: total }];
    }

    // INSTALLMENTS_N: first at 5 days, subsequent +20 days each
    const conditionMap: Record<string, number> = {
      INSTALLMENTS_2: 2,
      INSTALLMENTS_3: 3,
      INSTALLMENTS_4: 4,
      INSTALLMENTS_5: 5,
      INSTALLMENTS_6: 6,
      INSTALLMENTS_7: 7,
    };

    const totalInstallments = conditionMap[paymentCondition] || 1;

    // Use integer math (cents) to avoid floating point rounding errors
    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / totalInstallments);
    const installmentAmount = baseCents / 100;

    const installments: { number: number; dueDate: Date; amount: number }[] = [];
    for (let i = 0; i < totalInstallments; i++) {
      const dueDate = new Date(baseDate);
      // First installment: 5 days from finishedAt; subsequent: +20 days each
      dueDate.setDate(dueDate.getDate() + 5 + i * 20);

      // Put remainder on the LAST installment so sum equals exactly the total
      const isLast = i === totalInstallments - 1;
      const amount = isLast
        ? (totalCents - baseCents * (totalInstallments - 1)) / 100
        : installmentAmount;

      installments.push({
        number: i + 1,
        dueDate,
        amount,
      });
    }

    return installments;
  }
}
