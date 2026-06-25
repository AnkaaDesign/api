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
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { TaskQuoteRepository } from './repositories/task-quote.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { InvoiceGenerationService } from '@modules/financial/invoice/invoice-generation.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { FileService } from '@modules/common/file/file.service';
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
  TASK_QUOTE_STATUS_LABELS,
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
import { recalcQuoteTotals } from '../../../utils/task-quote-totals';
import { reconcileQuoteCustomerConfigs } from '../../../utils/task-quote-customer-config-sync';
import {
  QUOTE_STATUS_LOCKED,
  QUOTE_VALUE_REVERTABLE_STATUSES,
  QUOTE_SAFE_AFTER_BILLING_FIELDS,
  validateQuoteStatusChangeRole,
} from './task-quote.guards';

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
    private readonly fileService: FileService,
    @Inject(forwardRef(() => InvoiceGenerationService))
    private readonly invoiceGenerationService: InvoiceGenerationService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
    private readonly sicrediService: SicrediService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly elotechNfseService: ElotechOxyNfseService,
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
        // In single-config, all services belong to the one customer regardless of invoiceToCustomerId.
        // This handles customer replacements where services may still carry the old customer's ID.
        const assignedServices = isSingleConfig
          ? (data.services || [])
          : (data.services || []).filter(s => s.invoiceToCustomerId === config.customerId);
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

      // Compute aggregate subtotal/total from customerConfigs. In multi-config,
      // services not assigned to any customer belong to no config above, so fold
      // their amounts into the aggregate (no discount) — mirrors recalcQuoteTotals.
      let aggregateSubtotal = data.customerConfigs.reduce((sum, c) => sum + (c.subtotal || 0), 0);
      let aggregateTotal = data.customerConfigs.reduce((sum, c) => sum + (c.total || 0), 0);
      if (!isSingleConfig) {
        const unassignedSum = (data.services || [])
          .filter(s => !s.invoiceToCustomerId)
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        const unassignedRounded = Math.round(unassignedSum * 100) / 100;
        aggregateSubtotal = Math.round((aggregateSubtotal + unassignedRounded) * 100) / 100;
        aggregateTotal = Math.round((aggregateTotal + unassignedRounded) * 100) / 100;
      }

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
            // Layout Files (max 2) — clone any File owned by another quote (FK on File).
            ...(data.layoutFileIds !== undefined && {
              layoutFiles: {
                connect: (
                  await this.fileService.resolveLayoutFileIdsForQuote(
                    tx,
                    null,
                    data.layoutFileIds ?? [],
                    userId,
                  )
                ).map((fid: string) => ({ id: fid })),
              },
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
            layoutFiles: { orderBy: { createdAt: 'asc' } },
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
            layoutFiles: { orderBy: { createdAt: 'asc' } },
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
   * @param actorPrivilege Sector privilege of the acting user (threaded from the
   *   controller). Used to role-gate explicit status changes through the generic
   *   update so they enforce the same per-stage roles as the dedicated /status
   *   endpoints. Ignored for internal callers.
   */
  async update(
    id: string,
    data: TaskQuoteUpdateFormData,
    userId: string,
    _internal = false,
    actorPrivilege?: string,
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

      // Whether the CLIENT explicitly sent a status in THIS request. Captured
      // BEFORE filterToMaterialChanges, which strips a status equal to the
      // current one. Pinning a status — even the current value — is the caller
      // signalling "keep this status", and MUST suppress the value-edit
      // auto-revert below. Otherwise editing a price on an approved quote while
      // pinning its own status is still reverted to PENDING (the no-op status is
      // stripped, the revert then sees `data.status === undefined`).
      const clientProvidedStatus = data.status !== undefined;

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
      if (
        !_internal &&
        !clientProvidedStatus &&
        QUOTE_VALUE_REVERTABLE_STATUSES.includes(currentStatus) &&
        this.hasValueAffectingChange(existing, data)
      ) {
        this.logger.log(
          `[Quote Update] Auto-reverting quote ${id} from ${currentStatus} → PENDING due to value-affecting edits`,
        );
        (data as any).status = TASK_QUOTE_STATUS.PENDING;
      }

      // ─────────────────────────────────────────────────────────────────────
      // Role-gate EXPLICIT status changes through the generic update so they
      // enforce the same per-stage roles as the dedicated /status endpoints.
      // Pinning the current status (no-op) was stripped by
      // filterToMaterialChanges above and is intentionally NOT gated — pinning
      // is the designed escape to keep approval while editing values.
      // ─────────────────────────────────────────────────────────────────────
      if (
        !_internal &&
        clientProvidedStatus &&
        data.status !== undefined &&
        data.status !== currentStatus
      ) {
        validateQuoteStatusChangeRole(data.status as TASK_QUOTE_STATUS, actorPrivilege);
        // I41: also enforce the status-machine allowlist on the generic update()
        // path — not just the dedicated /status endpoint. Without this, a manual
        // PUT with a status body could jump the machine (e.g. PENDING → DUE).
        // Internal cascades/schedulers pass _internal=true and skip this guard.
        this.validateStatusTransition(currentStatus, data.status as TASK_QUOTE_STATUS);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Guard: lock pricing/customer/payment edits once the quote is locked-in
      // ─────────────────────────────────────────────────────────────────────
      // BILLING_APPROVED must go through internalApprove() — never a raw update() call.
      // This applies regardless of current status so it can never be smuggled in.
      if (data.status === TASK_QUOTE_STATUS.BILLING_APPROVED) {
        throw new BadRequestException(
          'A aprovação de faturamento deve ser realizada pelo endpoint dedicado.',
        );
      }
      if (QUOTE_STATUS_LOCKED.includes(currentStatus)) {
        for (const key of Object.keys(data)) {
          // Ignore explicit undefined entries — only reject if the caller actually intends a change.
          if ((data as any)[key] === undefined) continue;
          if (!QUOTE_SAFE_AFTER_BILLING_FIELDS.has(key)) {
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
      if (data.customerConfigs && data.customerConfigs.length > 0) {
        // When services weren't edited (stripped by filterToMaterialChanges), fall back to the
        // existing DB services so totals are recomputed against the new customer/discount.
        const servicesToUse = data.services ?? (existing as any).services ?? [];
        const isSingleConfig = data.customerConfigs.length === 1;
        for (const config of data.customerConfigs) {
          // In single-config, all services belong to the one customer regardless of invoiceToCustomerId.
          // This handles customer replacements where services may still carry the old customer's ID.
          const assignedServices = isSingleConfig
            ? servicesToUse
            : servicesToUse.filter((s: any) => s.invoiceToCustomerId === config.customerId);
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

      // Compute aggregate subtotal/total from customerConfigs if provided. In
      // multi-config, fold unassigned-service amounts (no config = no discount)
      // into the aggregate so it matches recalcQuoteTotals. servicesToUse is the
      // same source the per-config loop summed above (data.services ?? existing).
      const computeAggregates = data.customerConfigs && data.customerConfigs.length > 0;
      let aggregateSubtotal = computeAggregates
        ? data.customerConfigs!.reduce((sum, c) => sum + (c.subtotal || 0), 0)
        : undefined;
      let aggregateTotal = computeAggregates
        ? data.customerConfigs!.reduce((sum, c) => sum + (c.total || 0), 0)
        : undefined;
      if (computeAggregates && data.customerConfigs!.length >= 2) {
        const servicesForAggregate = data.services ?? (existing as any).services ?? [];
        const unassignedSum = servicesForAggregate
          .filter((s: any) => !s.invoiceToCustomerId)
          .reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
        const unassignedRounded = Math.round(unassignedSum * 100) / 100;
        aggregateSubtotal = Math.round(((aggregateSubtotal || 0) + unassignedRounded) * 100) / 100;
        aggregateTotal = Math.round(((aggregateTotal || 0) + unassignedRounded) * 100) / 100;
      }

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
            // Layout Files (max 2) — `set` replaces the relation wholesale ([] clears).
            // Clone any File currently owned by ANOTHER quote so bulk-applying one
            // layout to N quotes gives each an INDEPENDENT copy (FK lives on File).
            ...(data.layoutFileIds !== undefined && {
              layoutFiles: {
                set: (
                  await this.fileService.resolveLayoutFileIdsForQuote(
                    tx,
                    id,
                    data.layoutFileIds ?? [],
                    userId,
                  )
                ).map((fid: string) => ({ id: fid })),
              },
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
            layoutFiles: { orderBy: { createdAt: 'asc' } },
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
          },
        });

        // Derive the layout file id-list so changelog tracks it as ONE field
        // (the relation itself is an array of File objects).
        const oldEntityForTracking = {
          ...(existing as any),
          layoutFileIds: ((existing as any).layoutFiles || []).map((f: any) => f.id),
        };
        const newEntityForTracking = {
          ...(updatedQuote as any),
          layoutFileIds: ((updatedQuote as any).layoutFiles || []).map((f: any) => f.id),
        };

        // Track individual field changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: id,
          oldEntity: oldEntityForTracking,
          newEntity: newEntityForTracking,
          fieldsToTrack: [
            'subtotal',
            'total',
            'expiresAt',
            'status',
            'guaranteeYears',
            'customGuaranteeText',
            'layoutFileIds',
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
          // Reconcile by (quoteId, customerId) WITHOUT destroy-and-recreate:
          // updates existing rows in place (so issued Invoice/Installments and
          // DB-owned fields — customerSignatureId/orderNumber/paymentConfig —
          // survive), creates new customers, deletes only removed ones (blocking
          // on live financial obligations). Replaces the former deleteMany +
          // createMany, which silently wiped the signature and could cascade-
          // delete an issued invoice. Installments stay created at
          // BILLING_APPROVED time, not here.
          const { cancelledInvoices } = await reconcileQuoteCustomerConfigs(
            tx,
            id,
            data.customerConfigs as any,
          );

          // If a removed customer's stale invoice was auto-cancelled and the
          // quote was already in a billing status, revert it to BUDGET_APPROVED
          // so financial re-verifies before regenerating invoices/boletos/NFS-e.
          if (cancelledInvoices) {
            const billingStatuses = [
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

          // Composite key: description + observation combined
          const makeKey = (desc: string | null, obs: string | null): string =>
            `${normalizeDescription(desc)}|${normalizeDescription(obs)}`;

          // Build set of composite keys in the new services
          const newKeys = new Set(
            newServices.map((s: any) => makeKey(s.description, s.observation)),
          );

          // Find composite keys that were removed (in old but not in new)
          const keysToDelete = new Set<string>();

          for (const oldSvc of oldServices) {
            const key = makeKey(oldSvc.description, oldSvc.observation);
            if (key.startsWith('|')) continue; // empty description, skip
            if (!newKeys.has(key)) {
              // Service was removed from quote
              keysToDelete.add(key);
            }
          }

          if (keysToDelete.size > 0) {
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
                const soKey = makeKey(so.description, so.observation);
                if (keysToDelete.has(soKey)) {
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

        // Authoritative, discount-aware recompute of per-config + aggregate
        // totals from the now-persisted services + configs. Single source of
        // truth — runs whenever services OR configs changed, so a services-only
        // edit (configs stripped by filterToMaterialChanges) never leaves
        // subtotal/total stale (the "detail ≠ wizard" + mis-billed-invoice bug).
        if (data.services !== undefined || data.customerConfigs !== undefined) {
          await recalcQuoteTotals(tx, id);
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
            layoutFiles: { orderBy: { createdAt: 'asc' } },
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
      // branch above triggered by value-affecting edits) OR the layout files —
      // uploading/clearing a layout flips the "has artwork" check.
      if (data.status !== undefined || (data as any).layoutFileIds !== undefined) {
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
          layoutFiles: { select: { id: true } },
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
        layoutFileIds: ((existing as any).layoutFiles || []).map((f: any) => f.id),
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
        await this.settleManually(id, userId);
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

      // Generic status route (PUT /:id/status) can advance a quote to the approval
      // state directly (bypassing budgetApprove). When that happens, notify the NEXT
      // approver (financial) that billing approval is pending. The dedicated approve
      // method emits its own *_approved key; this covers the generic path.
      if (status === TASK_QUOTE_STATUS.BUDGET_APPROVED) {
        await this.dispatchApprovalPendingNotification(id, status, userId);
      } else if (status === TASK_QUOTE_STATUS.SETTLED) {
        // Manual SETTLED via the generic route — task_quote.settled + bank_slip.paid
        // are already emitted inside settleManually(); nothing more to do here.
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
  private async settleManually(quoteId: string, userId: string): Promise<void> {
    // If this quote has no installments yet (e.g. BUDGET_APPROVED → SETTLED, skipping
    // BILLING_APPROVED), generate invoices+installments now so the settlement has a financial record.
    const existingInstallmentCount = await this.prisma.installment.count({
      where: { customerConfig: { quoteId } },
    });

    if (existingInstallmentCount === 0) {
      const task = await this.prisma.task.findFirst({
        where: { quoteId },
        select: { id: true, finishedAt: true },
      });

      // Can only auto-generate a financial record from a FINISHED task. Without one
      // there is nothing legitimate to settle.
      if (!task?.id || !task.finishedAt) {
        throw new BadRequestException(
          'Não é possível liquidar este orçamento: a tarefa ainda não foi concluída e ' +
            'não há parcelas a quitar. Conclua a tarefa (ou aprove o faturamento) antes de liquidar.',
        );
      }

      const generatedInvoiceIds = await this.invoiceGenerationService.generateInvoicesForTask(
        task.id,
        userId,
        new Date(),
        { skipBankSlips: true, skipNfse: true },
      );
      if (generatedInvoiceIds.length > 0) {
        this.logger.log(
          `[SETTLE_MANUALLY] Pre-generated ${generatedInvoiceIds.length} invoice(s) for quote ${quoteId} before settlement (no prior installments found).`,
        );
      }

      // Verify a real financial basis now exists. Generation can no-op (e.g. missing
      // paymentCondition/config) and leave zero installments — settling in that state
      // would mark the quote SETTLED with NO financial record. Block it.
      const installmentsAfterGen = await this.prisma.installment.count({
        where: { customerConfig: { quoteId } },
      });
      if (installmentsAfterGen === 0) {
        throw new BadRequestException(
          'Não é possível liquidar este orçamento: nenhuma parcela foi gerada ' +
            '(condição de pagamento ausente ou inválida). Configure o faturamento antes de liquidar.',
        );
      }
    }

    // Track bank slips that need to be cancelled at Sicredi (after the local transaction commits)
    const slipsToCancelAtSicredi: Array<{ id: string; nossoNumero: string }> = [];

    // Track installments marked PAID in this settlement so we can emit bank_slip.paid
    // notifications AFTER the transaction commits (mirrors the webhook/reconciliation path).
    const paidNow: Array<{
      invoiceId: string | null;
      bankSlipId: string | null;
      amount: number;
      dueDate: Date;
    }> = [];

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

        paidNow.push({
          invoiceId: installment.invoiceId ?? null,
          bankSlipId: installment.bankSlip?.id ?? null,
          amount: Number(installment.amount),
          dueDate: installment.dueDate,
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

    // Notify bank_slip.paid per installment settled (mirrors the Sicredi webhook path),
    // then task_quote.settled once for the whole quote. Best-effort — never breaks settlement.
    for (const paid of paidNow) {
      if (!paid.invoiceId) continue;
      await this.dispatchBankSlipPaidNotification(
        paid.invoiceId,
        paid.bankSlipId ?? paid.invoiceId,
        paid.amount,
        paid.dueDate,
      );
    }
    await this.dispatchTaskQuoteSettledNotification(quoteId);
  }

  /**
   * Dispatch bank_slip.paid for a manually-settled installment. Mirrors the key +
   * payload + deep link used by the Sicredi webhook/reconciliation paths.
   * Best-effort — never breaks the settlement flow.
   */
  private async dispatchBankSlipPaidNotification(
    invoiceId: string,
    bankSlipId: string,
    paidAmount: number,
    dueDate: Date,
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true, serialNumber: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskName = invoice.task?.name || 'N/A';
      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(paidAmount));
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(dueDate);

      // Billing detail pages (web AND the mobile faturamento screen) are keyed
      // by the TASK id, so build all links from it. The old `financial/:taskId`
      // mobile route was unparseable on mobile.
      const webUrl = `/financeiro/faturamento/detalhes/${invoice.taskId}`;
      const mobileUrl = `/(tabs)/financeiro/faturamento/detalhes/${invoice.taskId}`;
      const actionUrl = JSON.stringify({ web: webUrl, mobile: mobileUrl });

      await this.dispatchService.dispatchByConfiguration('bank_slip.paid', 'system', {
        entityType: 'Financial',
        entityId: invoice.id,
        action: 'paid',
        data: {
          customerName,
          taskName,
          paidAmount: formattedAmount,
          dueDate: formattedDueDate,
          invoiceId: invoice.id,
          bankSlipId,
          taskId: invoice.taskId,
        },
        overrides: {
          actionUrl,
          webUrl,
        },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao notificar pagamento de boleto (bank_slip.paid) para fatura ${invoiceId}:`,
        error,
      );
    }
  }

  /**
   * Dispatch task_quote.approval_pending to the next approver when a quote advances
   * to an approval state via the generic status route. Best-effort — never throws.
   */
  private async dispatchApprovalPendingNotification(
    quoteId: string,
    newStatus: TASK_QUOTE_STATUS,
    userId: string,
  ): Promise<void> {
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(quoteId);

      // After the budget is approved the only remaining approval is billing
      // (the separate commercial double-check step was removed).
      const nextStep = 'aprovação de faturamento';

      await this.dispatchService.dispatchByConfiguration(
        'task_quote.approval_pending',
        userId,
        {
          entityType: 'TaskQuote',
          entityId: taskId ?? quoteId,
          action: 'approval_pending',
          data: { quoteLabel, nextStep },
          overrides: {
            title: 'Aprovação Pendente',
            body: `O orçamento ${quoteLabel} aguarda ${nextStep}.`,
            relatedEntityType: 'TASK_QUOTE',
            ...(taskId
              ? {
                  webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                  mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
                }
              : {}),
          },
        },
      );
    } catch (error) {
      this.logger.error(
        'Falha ao notificar aprovação pendente (task_quote.approval_pending):',
        error,
      );
    }
  }

  /**
   * Dispatch task_quote.settled when a quote is settled manually.
   * Best-effort — never breaks the settlement flow.
   */
  private async dispatchTaskQuoteSettledNotification(quoteId: string): Promise<void> {
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(quoteId);
      await this.dispatchService.dispatchByConfiguration('task_quote.settled', 'system', {
        entityType: 'TaskQuote',
        entityId: taskId ?? quoteId,
        action: 'settled',
        data: { quoteLabel },
        overrides: {
          title: 'Pagamento Liquidado',
          body: `O orçamento ${quoteLabel} foi totalmente liquidado. Todas as parcelas estão pagas.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        'Falha ao notificar liquidação de orçamento (task_quote.settled):',
        error,
      );
    }
  }

  /**
   * Commercial approves the budget.
   *
   * This is the single commercial approval gate. Once the budget is approved
   * (blue "Orçamento Aprovado" badge) the commercial sector is done — there is
   * no separate second commercial double-check. As soon as the linked task is
   * COMPLETED, financial can approve billing directly from this state.
   */
  async budgetApprove(id: string, userId: string): Promise<TaskQuoteUpdateResponse> {
    const result = await this.updateStatus(id, TASK_QUOTE_STATUS.BUDGET_APPROVED, userId);

    // Budget approved -> notify financial that, once the task is completed, billing can be approved.
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(id);
      await this.dispatchService.dispatchByConfiguration('task_quote.budget_approved', userId, {
        entityType: 'TaskQuote',
        entityId: taskId ?? id,
        action: 'budget_approved',
        data: { quoteLabel },
        overrides: {
          title: 'Orçamento Aprovado',
          body: `O orçamento ${quoteLabel} foi aprovado. Assim que a tarefa for concluída, o faturamento poderá ser aprovado.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar aprovação de orçamento (task_quote.budget_approved):', error);
    }

    return result;
  }

  /** Best-effort human label for a quote — uses the linked task serial/name when
   *  available, falling back to the short quote id. Also returns the linked task
   *  id so notification deep links (keyed by taskId) can be built. Never throws. */
  private async buildQuoteLabel(quoteId: string): Promise<{ label: string; taskId: string | null }> {
    try {
      const task = await this.prisma.task.findFirst({
        where: { quoteId },
        select: { id: true, name: true, serialNumber: true },
      });
      if (task?.serialNumber) {
        return {
          label: task.name ? `#${task.serialNumber} (${task.name})` : `#${task.serialNumber}`,
          taskId: task.id,
        };
      }
      if (task?.name) return { label: task.name, taskId: task.id };
      if (task?.id) return { label: quoteId.slice(-8).toUpperCase(), taskId: task.id };
    } catch {
      // ignore — fall through to id
    }
    return { label: quoteId.slice(-8).toUpperCase(), taskId: null };
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
    // Only one request can win: the one that finds status=BUDGET_APPROVED and sets it to BILLING_APPROVED.
    // (The separate COMMERCIAL_APPROVED double-check step was removed — billing is approved directly
    //  from the budget-approved state once the task is completed.)
    const claimed = await this.prisma.taskQuote.updateMany({
      where: { id, status: TASK_QUOTE_STATUS.BUDGET_APPROVED },
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
        'O orçamento não está mais no status Orçamento Aprovado. Pode ter sido aprovado por outra requisição simultânea.',
      );
    }

    this.logger.log(
      `[INTERNAL_APPROVE] Status atomically claimed to BILLING_APPROVED for quote ${id}`,
    );

    // Trigger invoice generation and auto-transition to UPCOMING
    // If anything fails, revert status back to BUDGET_APPROVED so the user can retry
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

      // Revert status back to BUDGET_APPROVED so the quote is not stuck at BILLING_APPROVED
      // Uses direct prisma update to bypass status transition validation (BILLING_APPROVED → BUDGET_APPROVED is not normally allowed)
      try {
        this.logger.warn(
          `[INTERNAL_APPROVE] Rolling back quote ${id} status from BILLING_APPROVED to BUDGET_APPROVED...`,
        );
        await this.prisma.taskQuote.update({
          where: { id },
          data: {
            status: TASK_QUOTE_STATUS.BUDGET_APPROVED,
            statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.BUDGET_APPROVED),
          },
        });
        this.logger.warn(
          `[INTERNAL_APPROVE] Rollback successful — quote ${id} reverted to BUDGET_APPROVED`,
        );
      } catch (rollbackError) {
        this.logger.error(
          `[INTERNAL_APPROVE] CRITICAL: Failed to rollback quote ${id} status to BUDGET_APPROVED: ${rollbackError}`,
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
        `Falha ao gerar faturas para o orçamento. O status foi revertido para Orçamento Aprovado. Erro: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const refreshed = await this.taskQuoteRepository.findById(id);

    // Billing approved (invoices + NFS-e emitted) -> notify commercial/financial/admin.
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(id);
      await this.dispatchService.dispatchByConfiguration('task_quote.billing_approved', userId, {
        entityType: 'TaskQuote',
        entityId: taskId ?? id,
        action: 'billing_approved',
        data: { quoteLabel },
        overrides: {
          title: 'Faturamento Aprovado',
          body: `O faturamento do orçamento ${quoteLabel} foi aprovado e as faturas foram geradas.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar faturamento aprovado (task_quote.billing_approved):', error);
    }

    return {
      success: true,
      data: refreshed as any,
      message: 'Faturamento do orçamento aprovado com sucesso.',
    };
  }

  /**
   * Revert billing approval — undo internalApprove when all bank slips and NFS-e are cancelled.
   * Deletes the invoices (cascading installments, bank slips, NFS-e docs) and reverts the
   * quote status back to BUDGET_APPROVED so the operator can re-approve after corrections.
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

    // Collect active bank slips to baixar at Sicredi (best-effort, before deleting records)
    const activeSlips = await this.prisma.bankSlip.findMany({
      where: {
        installment: { invoice: { taskId: task.id } },
        status: { notIn: ['CANCELLED', 'PAID'] },
        nossoNumero: { not: null },
      },
      select: { id: true, nossoNumero: true, status: true },
    });

    // Collect NFS-e that are still ACTIVE at the prefeitura to cancel at Elotech before
    // deleting records. AUTHORIZED and CANCEL_REJECTED notes are both live (a rejected
    // cancellation means the note was NOT cancelled).
    const authorizedNfses = await this.prisma.nfseDocument.findMany({
      where: {
        invoice: { taskId: task.id },
        status: { in: ['AUTHORIZED', 'CANCEL_REJECTED'] },
        elotechNfseId: { not: null },
      },
      select: { id: true, nfseNumber: true, elotechNfseId: true },
    });

    // Block ONLY if an emission is genuinely in flight (PROCESSING/PENDING) — reverting mid-
    // emission could race a note into existence after we delete its record. A CANCEL_REQUESTED
    // note does NOT block: it survives the revert linked to the task (invoiceId→null) and the
    // reconciler keeps tracking it, so there is no deadlock.
    const pendingNfses = await this.prisma.nfseDocument.findMany({
      where: {
        invoice: { taskId: task.id },
        status: { in: ['PROCESSING', 'PENDING'] },
      },
      select: { id: true, status: true },
    });
    if (pendingNfses.length > 0) {
      throw new BadRequestException(
        `Existem NFS-e(s) em emissão (${pendingNfses.map(n => n.status).join(', ')}). ` +
          `Aguarde a conclusão da emissão antes de reverter o faturamento.`,
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

    // Attempt to cancel active NFS-e at Elotech (best-effort). We do NOT block the revert when a
    // cancellation can't complete: the note survives the revert linked to the task (invoiceId is
    // set null by FK SetNull, taskId is kept), so it is never lost or orphaned. This deliberately
    // avoids the deadlock where the prefeitura rejects a duplicate-cancellation demanding the
    // SUBSTITUTE NF number — which only exists after re-billing, which needs the revert to happen
    // first. The flow becomes: revert → re-bill (new NF) → cancel the old note citing the new one
    // as substituta. Any note left active is logged and stays visible/cancellable on the task.
    if (authorizedNfses.length > 0) {
      const nfseOutcomes = await Promise.allSettled(
        authorizedNfses.map(n =>
          this.elotechNfseService.cancelNfse(
            n.id,
            'Cancelamento automático por reversão de faturamento.',
            1,
          ),
        ),
      );
      nfseOutcomes.forEach((outcome, i) => {
        const nfse = authorizedNfses[i];
        if (outcome.status === 'fulfilled' && outcome.value?.cancelled) {
          this.logger.log(`[REVERT_BILLING] Cancelled NFS-e #${nfse.nfseNumber} at Elotech`);
        } else {
          const detail =
            outcome.status === 'rejected'
              ? outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason)
              : outcome.value?.rejected
                ? `rejeitada: ${outcome.value.rejectionMessage ?? 'sem detalhes'}`
                : outcome.value?.pending
                  ? 'aguardando aprovação do fiscal'
                  : 'não confirmada';
          this.logger.warn(
            `[REVERT_BILLING] NFS-e #${nfse.nfseNumber} segue ATIVA (${detail}). ` +
              `Permanece vinculada à tarefa; cancele-a citando a nova NF como substituta após refaturar.`,
          );
        }
      });
    }

    // Best-effort baixa at Sicredi for all active/overdue bank slips
    if (activeSlips.length > 0) {
      const slipOutcomes = await Promise.allSettled(
        activeSlips
          .filter(s => s.nossoNumero && !s.nossoNumero.startsWith('TMP-'))
          .map(s => this.sicrediService.cancelBoleto(s.nossoNumero!)),
      );
      slipOutcomes.forEach((outcome, i) => {
        if (outcome.status === 'rejected') {
          this.logger.warn(
            `[REVERT_BILLING] Failed to baixar boleto ${activeSlips[i].nossoNumero} at Sicredi: ${outcome.reason}`,
          );
        } else {
          this.logger.log(
            `[REVERT_BILLING] Baixado boleto ${activeSlips[i].nossoNumero} at Sicredi`,
          );
        }
      });
    }

    await this.prisma.$transaction(async tx => {
      // Delete installments (cascades bank slips via FK)
      await tx.installment.deleteMany({ where: { invoice: { taskId: task.id } } });
      // Delete invoices. NfseDocuments are NOT cascaded — their invoiceId is set null (FK
      // SetNull) and they remain linked to the task as permanent NFS-e history. Only notes
      // confirmed CANCELLED at the prefeitura reach this point (the guard above blocks revert
      // while any note is still active), so no active fiscal document is ever stranded.
      await tx.invoice.deleteMany({ where: { taskId: task.id } });
      // Revert quote status. Clear billingApprovedAt too — leaving the timestamp set
      // while the status drops below BILLING_APPROVED desyncs status/timestamp and
      // skews avgSalesCycleDays. (billingApprovedAt exists in schema.prisma but the
      // generated Prisma client is stale; cast to satisfy the type checker.)
      await tx.taskQuote.update({
        where: { id },
        data: {
          status: TASK_QUOTE_STATUS.BUDGET_APPROVED,
          statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.BUDGET_APPROVED),
          billingApprovedAt: null,
        } as any,
      });
    });

    this.logger.log(
      `[REVERT_BILLING] Quote ${id} reverted to BUDGET_APPROVED. Invoices/installments/bank slips deleted.`,
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
      newValue: TASK_QUOTE_STATUS.BUDGET_APPROVED,
      reason: 'Faturamento revertido pelo operador',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId,
      userId,
    });

    const refreshed = await this.taskQuoteRepository.findById(id);
    return {
      success: true,
      data: refreshed as any,
      message: 'Faturamento revertido com sucesso. O orçamento retornou para Orçamento Aprovado.',
    };
  }

  /**
   * Cancel a quote because its task was cancelled. Sets the quote to CANCELLED
   * and tears down any billing it produced (delete invoices/installments, baixa
   * active boletos at Sicredi, cancel active NFS-e at Elotech) — mirroring
   * revertBillingApproval but ending at CANCELLED instead of BUDGET_APPROVED, and
   * accepting ANY non-cancelled source status (a draft quote simply flips to
   * CANCELLED with no fiscal records to tear down).
   *
   * Refuses (throws) when an installment is already PAID or an NFS-e emission is
   * in flight — those represent real money / in-flight state and must be handled
   * manually. Idempotent: a no-op if the quote is already CANCELLED.
   *
   * Called from the task-cancel cascade POST-commit (external Sicredi/Elotech
   * calls cannot run inside the task's transaction).
   */
  async cancelForTaskCancellation(id: string, userId: string): Promise<void> {
    const existing = await this.taskQuoteRepository.findById(id);
    if (!existing) {
      this.logger.warn(`[CANCEL_QUOTE] Quote ${id} not found; nothing to cancel.`);
      return;
    }
    if (existing.status === TASK_QUOTE_STATUS.CANCELLED) {
      return; // idempotent
    }

    const task = await this.prisma.task.findFirst({
      where: { quoteId: id },
      select: { id: true },
    });
    const taskId = task?.id ?? null;

    if (taskId) {
      // In-flight NFS-e emission blocks teardown (could race a note into existence
      // after we delete its record).
      const pendingNfses = await this.prisma.nfseDocument.findMany({
        where: { invoice: { taskId }, status: { in: ['PROCESSING', 'PENDING'] } },
        select: { id: true, status: true },
      });
      if (pendingNfses.length > 0) {
        throw new BadRequestException(
          `Existem NFS-e(s) em emissão (${pendingNfses.map(n => n.status).join(', ')}). ` +
            `Aguarde a conclusão da emissão antes de cancelar o orçamento.`,
        );
      }

      // Real money received → cannot silently cancel; needs manual estorno.
      const paidInstallments = await this.prisma.installment.findMany({
        where: { invoice: { taskId }, status: { in: ['PAID'] } },
        select: { id: true },
      });
      if (paidInstallments.length > 0) {
        throw new BadRequestException(
          `Existem ${paidInstallments.length} parcela(s) paga(s). Não é possível cancelar um ` +
            `orçamento com pagamentos registrados — trate o estorno manualmente.`,
        );
      }

      // Best-effort cancel active NFS-e at Elotech (AUTHORIZED / CANCEL_REJECTED
      // are both still live at the prefeitura). A note left active is logged and
      // stays linked to the task (invoiceId→null) — never lost.
      const authorizedNfses = await this.prisma.nfseDocument.findMany({
        where: {
          invoice: { taskId },
          status: { in: ['AUTHORIZED', 'CANCEL_REJECTED'] },
          elotechNfseId: { not: null },
        },
        select: { id: true, nfseNumber: true },
      });
      if (authorizedNfses.length > 0) {
        const outcomes = await Promise.allSettled(
          authorizedNfses.map(n =>
            this.elotechNfseService.cancelNfse(
              n.id,
              'Cancelamento automático por cancelamento da tarefa.',
              1,
            ),
          ),
        );
        outcomes.forEach((o, i) => {
          if (!(o.status === 'fulfilled' && o.value?.cancelled)) {
            this.logger.warn(
              `[CANCEL_QUOTE] NFS-e #${authorizedNfses[i].nfseNumber} segue ATIVA após ` +
                `cancelamento da tarefa; permanece vinculada à tarefa — cancele-a manualmente se necessário.`,
            );
          }
        });
      }

      // Best-effort baixa of active boletos at Sicredi.
      const activeSlips = await this.prisma.bankSlip.findMany({
        where: {
          installment: { invoice: { taskId } },
          status: { notIn: ['CANCELLED', 'PAID'] },
          nossoNumero: { not: null },
        },
        select: { nossoNumero: true },
      });
      if (activeSlips.length > 0) {
        await Promise.allSettled(
          activeSlips
            .filter(s => s.nossoNumero && !s.nossoNumero.startsWith('TMP-'))
            .map(s => this.sicrediService.cancelBoleto(s.nossoNumero!)),
        );
      }
    }

    await this.prisma.$transaction(async tx => {
      if (taskId) {
        // Delete installments (cascades bank slips) + invoices. NfseDocuments are
        // NOT cascaded — invoiceId is SetNull and they remain linked to the task
        // as permanent fiscal history.
        await tx.installment.deleteMany({ where: { invoice: { taskId } } });
        await tx.invoice.deleteMany({ where: { taskId } });
      }
      await tx.taskQuote.update({
        where: { id },
        data: {
          status: TASK_QUOTE_STATUS.CANCELLED,
          statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.CANCELLED),
          billingApprovedAt: null,
        } as any,
      });
    });

    if (taskId) {
      await syncEmNegociacaoForTask(this.prisma, taskId, userId);
    }

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_QUOTE,
      entityId: id,
      action: CHANGE_ACTION.UPDATE,
      field: 'status',
      oldValue: existing.status,
      newValue: TASK_QUOTE_STATUS.CANCELLED,
      reason: 'Orçamento cancelado automaticamente pelo cancelamento da tarefa',
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
      triggeredById: userId,
      userId,
    });

    this.logger.log(
      `[CANCEL_QUOTE] Quote ${id} cancelled (was ${existing.status}) after task cancellation.`,
    );
  }

  /**
   * Update only the orderNumber field on a CustomerConfig.
   * Bypasses the financial obligation guard — orderNumber is metadata only
   * and does not affect invoices, installments, or bank slips.
   */
  async updateCustomerConfigOrderNumber(
    quoteId: string,
    customerId: string,
    orderNumber: string | null,
  ): Promise<{ message: string }> {
    const config = await this.prisma.taskQuoteCustomerConfig.findUnique({
      where: { quoteId_customerId: { quoteId, customerId } },
    });

    if (!config) {
      throw new NotFoundException('Configuração de cliente não encontrada para este orçamento.');
    }

    await this.prisma.taskQuoteCustomerConfig.update({
      where: { id: config.id },
      data: { orderNumber: orderNumber || null },
    });

    return { message: 'Número do pedido atualizado com sucesso.' };
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
          layoutFiles: {
            orderBy: { createdAt: 'asc' },
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
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true, cpf: true },
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
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true, cpf: true },
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
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true, cpf: true },
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

      // Security (A10): the public link carries no dedicated access token (the
      // unguessable quote UUID is the capability), so the strongest available
      // server-side check is a STATUS gate — signatures are only accepted while
      // the quote is actually awaiting the customer's approval (PENDING) or
      // re-signing right after it (BUDGET_APPROVED). From BILLING_APPROVED
      // onward the deal is internally locked and an anonymous signature upload
      // must not alter it.
      const signatureAllowedStatuses: TASK_QUOTE_STATUS[] = [
        TASK_QUOTE_STATUS.PENDING,
        TASK_QUOTE_STATUS.BUDGET_APPROVED,
      ];
      if (!signatureAllowedStatuses.includes(quote.status as TASK_QUOTE_STATUS)) {
        throw new BadRequestException(
          'Este orçamento não está aguardando assinatura do cliente.',
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
          layoutFiles: { orderBy: { createdAt: 'asc' } },
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
    // Human-readable PT-BR labels for user-facing messages (never leak raw enums).
    const label = (s: TASK_QUOTE_STATUS) => TASK_QUOTE_STATUS_LABELS[s] ?? s;

    if (currentStatus === newStatus) {
      throw new BadRequestException(`O status já é "${label(currentStatus)}".`);
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
    // Additional: BUDGET_APPROVED → PENDING is allowed so the cancel/reject
    // button works for the most common cancellation point (customer cancels
    // before billing); from BILLING_APPROVED onward, operators must use
    // /revert-billing first (which gates on bank-slip + NFS-e cleanup).
    //
    // The separate COMMERCIAL_APPROVED double-check step was removed: the budget
    // is approved once (blue "Orçamento Aprovado"), and once the task is COMPLETED
    // billing is approved directly from BUDGET_APPROVED → BILLING_APPROVED.
    // BUDGET_APPROVED → SETTLED covers "direct" quotes (orçamento direto) paid
    // upfront with no billing/installment phase — the FINANCIAL sector settles
    // them without generating invoices/boletos. settleManually has no installments
    // to clean up in that case, so it's safe.
    const ALLOWED: Record<TASK_QUOTE_STATUS, TASK_QUOTE_STATUS[]> = {
      [TASK_QUOTE_STATUS.PENDING]:             [TASK_QUOTE_STATUS.BUDGET_APPROVED, TASK_QUOTE_STATUS.CANCELLED],
      [TASK_QUOTE_STATUS.BUDGET_APPROVED]:     [TASK_QUOTE_STATUS.PENDING, TASK_QUOTE_STATUS.BILLING_APPROVED, TASK_QUOTE_STATUS.SETTLED, TASK_QUOTE_STATUS.CANCELLED],
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
      // Terminal — a quote is cancelled when its task is cancelled. Re-quoting
      // creates a new quote rather than transitioning out of CANCELLED.
      [TASK_QUOTE_STATUS.CANCELLED]:           [],
    };

    const allowed = ALLOWED[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Não é possível alterar o status de "${label(currentStatus)}" para "${label(newStatus)}".`,
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
      case `${TASK_QUOTE_STATUS.PENDING}->${TASK_QUOTE_STATUS.BUDGET_APPROVED}`: {
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

      case `${TASK_QUOTE_STATUS.BUDGET_APPROVED}->${TASK_QUOTE_STATUS.BILLING_APPROVED}`: {
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
      [TASK_QUOTE_STATUS.BUDGET_APPROVED]: 'orçamento aprovado',
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
