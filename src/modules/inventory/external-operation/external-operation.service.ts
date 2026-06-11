// external-operation.service.ts

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ExternalOperationRepository } from './repositories/external-operation/external-operation.repository';
import { ExternalOperationItemRepository } from './repositories/external-operation-item/external-operation-item.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  ExternalOperationBatchCreateResponse,
  ExternalOperationBatchDeleteResponse,
  ExternalOperationBatchUpdateResponse,
  ExternalOperationCreateResponse,
  ExternalOperationDeleteResponse,
  ExternalOperationGetManyResponse,
  ExternalOperationGetUniqueResponse,
  ExternalOperationUpdateResponse,
} from '../../../types';
import { UpdateData } from '../../../types';
import {
  ExternalOperationCreateFormData,
  ExternalOperationUpdateFormData,
  ExternalOperationGetManyFormData,
  ExternalOperationBatchCreateFormData,
  ExternalOperationBatchUpdateFormData,
  ExternalOperationBatchDeleteFormData,
  ExternalOperationInclude,
} from '../../../schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { ItemService } from '@modules/inventory/item/item.service';
import { ItemRepository } from '@modules/inventory/item/repositories/item/item.repository';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import { ActivityRepository } from '@modules/inventory/activity/repositories/activity.repository';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { InvoiceGenerationService } from '@modules/financial/invoice/invoice-generation.service';
import { FileService } from '@modules/common/file/file.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import {
  CHANGE_TRIGGERED_BY,
  ACTIVITY_REASON,
  ACTIVITY_OPERATION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  EXTERNAL_OPERATION_STATUS,
  EXTERNAL_OPERATION_STATUS_ORDER,
  EXTERNAL_OPERATION_TYPE,
  PAYMENT_CONDITION,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
  INVOICE_STATUS,
  NFSE_STATUS,
  SECTOR_PRIVILEGES,
} from '../../../constants';

@Injectable()
export class ExternalOperationService {
  private readonly logger = new Logger(ExternalOperationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly externalOperationRepository: ExternalOperationRepository,
    private readonly externalOperationItemRepository: ExternalOperationItemRepository,
    private readonly itemService: ItemService,
    private readonly itemRepository: ItemRepository,
    private readonly activityService: ActivityService,
    private readonly activityRepository: ActivityRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly dispatchService: NotificationDispatchService,
    @Inject(forwardRef(() => InvoiceGenerationService))
    private readonly invoiceGenerationService: InvoiceGenerationService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
    private readonly sicrediService: SicrediService,
    private readonly elotechNfseService: ElotechOxyNfseService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Persist uploaded invoice/receipt files (multipart uploads) and link them to the
   * operation's M:N File relations. Mirrors the airbrushing upload pattern.
   */
  private async persistUploadedFiles(
    tx: PrismaTransaction,
    externalOperationId: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
    userId?: string,
  ): Promise<void> {
    if (!files) return;
    const invoiceUploads = files.invoices ?? [];
    const receiptUploads = files.receipts ?? [];
    if (invoiceUploads.length === 0 && receiptUploads.length === 0) return;

    for (const file of invoiceUploads) {
      const fileRecord = await this.fileService.createFromUploadWithTransaction(
        tx,
        file,
        'externalOperationInvoices',
        userId,
        { entityId: externalOperationId, entityType: 'EXTERNAL_OPERATION' },
      );
      await tx.file.update({
        where: { id: fileRecord.id },
        data: { externalOperationInvoices: { connect: { id: externalOperationId } } },
      });
    }

    for (const file of receiptUploads) {
      const fileRecord = await this.fileService.createFromUploadWithTransaction(
        tx,
        file,
        'externalOperationReceipts',
        userId,
        { entityId: externalOperationId, entityType: 'EXTERNAL_OPERATION' },
      );
      await tx.file.update({
        where: { id: fileRecord.id },
        data: { externalOperationReceipts: { connect: { id: externalOperationId } } },
      });
    }
  }

  /**
   * Build the deep-link path for an external withdrawal detail screen.
   * Both web and mobile share the same route shape (see constants/routes.ts).
   */
  private buildExternalOperationDeepLink(id: string): string {
    return `/estoque/operacoes-externas/detalhes/${id}`;
  }

  /**
   * Validate external withdrawal data
   */
  private async externalOperationValidation(
    data: Partial<ExternalOperationCreateFormData | ExternalOperationUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
    userPrivilege?: string,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    const isUpdate = !!existingId;

    // FINANCIAL may update billing/status fields but NOT the operation's items —
    // item editing is restricted to WAREHOUSE/ADMIN (see external-operation-items controller)
    if (
      isUpdate &&
      userPrivilege === SECTOR_PRIVILEGES.FINANCIAL &&
      'items' in data &&
      data.items !== undefined
    ) {
      throw new ForbiddenException(
        'Setor financeiro não tem permissão para alterar os itens da operação externa',
      );
    }

    // Validate required fields for creation
    if (!isUpdate) {
      const createType = ('type' in data ? data.type : undefined) ?? EXTERNAL_OPERATION_TYPE.RETURNABLE;
      const createCustomerId = 'customerId' in data ? data.customerId : undefined;

      // CHARGEABLE operations are billed to a customer — the customer is mandatory at create.
      if (createType === EXTERNAL_OPERATION_TYPE.CHARGEABLE && !createCustomerId) {
        throw new BadRequestException('Cliente é obrigatório para operações externas cobráveis');
      }

      // Every operation needs at least one identifier: a customer OR a responsible name.
      if (
        !createCustomerId &&
        (!data.withdrawerName || data.withdrawerName.trim().length === 0)
      ) {
        throw new BadRequestException(
          'Informe um cliente ou o nome do responsável pela retirada',
        );
      }
      const createItems = 'items' in data ? (data.items ?? []) : [];
      const createServices = 'services' in data ? (data.services ?? []) : [];

      if (createType === EXTERNAL_OPERATION_TYPE.CHARGEABLE) {
        // CHARGEABLE: at least one item OR service is required
        if (createItems.length + createServices.length === 0) {
          throw new BadRequestException(
            'Adicione pelo menos um item ou serviço para retiradas cobráveis',
          );
        }
      } else {
        // Non-CHARGEABLE: items required, services forbidden
        if (createItems.length === 0) {
          throw new BadRequestException('Pelo menos um item deve ser retirado');
        }
        if (createServices.length > 0) {
          throw new BadRequestException(
            'Serviços só podem ser adicionados em retiradas do tipo Cobrável',
          );
        }
      }

      // Validate maximum items per withdrawal
      if (createItems.length > 100) {
        throw new BadRequestException('Máximo de 100 itens por operação');
      }
    }

    // Validate services payload (create and update)
    if ('services' in data && data.services !== undefined) {
      if (data.services.length > 100) {
        throw new BadRequestException('Máximo de 100 serviços por operação');
      }
      for (const service of data.services) {
        if (!service.description || service.description.trim().length === 0) {
          throw new BadRequestException('Descrição do serviço é obrigatória');
        }
        if (service.description.length > 500) {
          throw new BadRequestException(
            'Descrição do serviço deve ter no máximo 500 caracteres',
          );
        }
        if (!Number.isFinite(service.amount) || service.amount <= 0) {
          throw new BadRequestException('Valor do serviço deve ser maior que zero');
        }
        if (service.amount > 999999.99) {
          throw new BadRequestException('Valor do serviço excede o limite máximo permitido');
        }
        if (service.amount !== Math.round(service.amount * 100) / 100) {
          throw new BadRequestException('Valor do serviço deve ter no máximo 2 casas decimais');
        }
      }
    }

    // Validate withdrawerName format (null = clearing the field, validated as a
    // customer-or-name presence rule in the create/update branches)
    if (data.withdrawerName !== undefined && data.withdrawerName !== null) {
      const trimmedName = data.withdrawerName.trim();

      if (trimmedName.length === 0) {
        throw new BadRequestException('Nome do retirador não pode ser vazio');
      }
      if (trimmedName.length < 2) {
        throw new BadRequestException('Nome do retirador deve ter pelo menos 2 caracteres');
      }
      if (trimmedName.length > 200) {
        throw new BadRequestException('Nome do retirador deve ter no máximo 200 caracteres');
      }

      // Validate name format (basic validation)
      if (!/^[a-zA-ZÀ-ÿ\s\-'.]+$/.test(trimmedName)) {
        throw new BadRequestException('Nome do retirador contém caracteres inválidos');
      }
    }

    // Validate file references with enhanced logging
    const fileIds: string[] = [];

    if (data.invoiceIds && data.invoiceIds.length > 0) {
      fileIds.push(...data.invoiceIds);
    }
    if (data.receiptIds && data.receiptIds.length > 0) {
      fileIds.push(...data.receiptIds);
    }

    for (const fileId of fileIds) {
      if (fileId) {
        const file = await transaction.file.findUnique({
          where: { id: fileId },
          select: { id: true, filename: true },
        });

        if (!file) {
          // Log file validation failure
          if (existingId) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'fileIds',
              oldValue: null,
              newValue: fileId,
              reason: `Falha na validação: Arquivo não encontrado (ID: ${fileId})`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
          }
          throw new NotFoundException(`Arquivo não encontrado (ID: ${fileId})`);
        } else {
          // Log successful file attachment validation
          if (existingId) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'fileIds',
              oldValue: null,
              newValue: { id: file.id, filename: file.filename },
              reason: `Arquivo validado: ${file.filename}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
          }
        }
      }
    }

    // Validate that the withdrawal is not being updated after a certain period (e.g., 30 days)
    if (isUpdate) {
      const existingWithdrawal = await transaction.externalOperation.findUnique({
        where: { id: existingId },
        select: {
          createdAt: true,
          status: true,
          type: true,
          withdrawerName: true,
          customerId: true,
          generateInvoice: true,
          generateBankSlip: true,
          paymentCondition: true,
          paymentConfig: true,
          services: { select: { description: true, amount: true, position: true } },
          items: { select: { itemId: true, withdrawedQuantity: true, price: true } },
        },
      });

      if (existingWithdrawal) {
        const daysSinceCreation = Math.floor(
          (new Date().getTime() - existingWithdrawal.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysSinceCreation > 30) {
          throw new BadRequestException('Operação não pode ser alterada após 30 dias da criação');
        }

        // Keep at least one identifier after the update: a customer OR a responsible name.
        const effectiveCustomerId =
          'customerId' in data && data.customerId !== undefined
            ? data.customerId
            : existingWithdrawal.customerId;
        const effectiveWithdrawerName =
          data.withdrawerName !== undefined
            ? data.withdrawerName
            : existingWithdrawal.withdrawerName;
        if (
          !effectiveCustomerId &&
          (!effectiveWithdrawerName || effectiveWithdrawerName.trim().length === 0)
        ) {
          throw new BadRequestException(
            'Informe um cliente ou o nome do responsável pela retirada',
          );
        }

        // Services are only allowed for CHARGEABLE withdrawals (effective type after this update)
        const effectiveType = ('type' in data ? data.type : undefined) ?? existingWithdrawal.type;
        if (
          'services' in data &&
          (data.services?.length ?? 0) > 0 &&
          effectiveType !== EXTERNAL_OPERATION_TYPE.CHARGEABLE
        ) {
          throw new BadRequestException(
            'Serviços só podem ser adicionados em retiradas do tipo Cobrável',
          );
        }

        // After leaving PENDING, items/services/customer/type/billing config are LOCKED.
        // Only notes, status and file attachments may change.
        if (existingWithdrawal.status !== EXTERNAL_OPERATION_STATUS.PENDING) {
          const lockedFieldLabels: Record<string, string> = {
            withdrawerName: 'nome do retirador',
            type: 'tipo',
            customerId: 'cliente',
            generateInvoice: 'emissão de nota fiscal',
            generateBankSlip: 'emissão de boleto',
            paymentCondition: 'condição de pagamento',
            paymentConfig: 'configuração de pagamento',
            services: 'serviços',
            items: 'itens',
          };

          const normalizeServices = (
            services: Array<{ description: string; amount: any; position: number | null }> = [],
          ) =>
            JSON.stringify(
              services.map(s => ({
                description: s.description,
                amount: Number(s.amount),
                position: s.position ?? 0,
              })),
            );

          const normalizeItems = (
            items: Array<{ itemId: string; withdrawedQuantity: number; price: any }> = [],
          ) =>
            JSON.stringify(
              items
                .map(i => ({
                  itemId: i.itemId,
                  withdrawedQuantity: i.withdrawedQuantity,
                  price: i.price === null || i.price === undefined ? null : Number(i.price),
                }))
                .sort((a, b) => a.itemId.localeCompare(b.itemId)),
            );

          const changedLockedFields: string[] = [];
          for (const field of Object.keys(lockedFieldLabels)) {
            const newValue = (data as Record<string, any>)[field];
            if (newValue === undefined) continue;

            if (field === 'items') {
              const incoming = normalizeItems(newValue as any[]);
              const current = normalizeItems(existingWithdrawal.items as any[]);
              if (incoming !== current) changedLockedFields.push(field);
              continue;
            }

            if (field === 'services') {
              const incoming = normalizeServices(
                (newValue as any[]).map((s, index) => ({
                  description: s.description,
                  amount: s.amount,
                  position: s.position ?? index,
                })),
              );
              const current = normalizeServices(existingWithdrawal.services as any[]);
              if (incoming !== current) changedLockedFields.push(field);
              continue;
            }

            if (field === 'paymentConfig') {
              if (
                JSON.stringify(newValue ?? null) !==
                JSON.stringify(existingWithdrawal.paymentConfig ?? null)
              ) {
                changedLockedFields.push(field);
              }
              continue;
            }

            const currentValue = (existingWithdrawal as Record<string, any>)[field];
            if (newValue !== (currentValue ?? null) && newValue !== currentValue) {
              changedLockedFields.push(field);
            }
          }

          if (changedLockedFields.length > 0) {
            const labels = changedLockedFields.map(f => lockedFieldLabels[f]).join(', ');
            throw new BadRequestException(
              `Após sair do status Pendente, apenas observações, status e arquivos podem ser alterados. Campos bloqueados: ${labels}`,
            );
          }
        }

        // Per-item validation on update (stock availability + CHARGEABLE price rules).
        // Item changes are only reachable while PENDING — the lock above rejects them
        // afterwards (resubmitting an identical array passes the lock and is harmless).
        if ('items' in data && data.items !== undefined) {
          if (data.items.length > 100) {
            throw new BadRequestException('Máximo de 100 itens por operação');
          }
          for (const itemData of data.items) {
            await this.externalOperationItemValidation(
              {
                itemId: itemData.itemId,
                quantity: itemData.withdrawedQuantity,
                price: itemData.price ?? null,
              },
              effectiveType,
              tx,
              existingId,
            );
          }
        }

        // Composition rules against the effective (post-update) state — only when the
        // payload actually touches items/services/type (status-only updates skip this
        // so legacy rows can still transition)
        const touchesComposition =
          ('items' in data && data.items !== undefined) ||
          ('services' in data && data.services !== undefined) ||
          ('type' in data && data.type !== undefined && data.type !== existingWithdrawal.type);

        if (touchesComposition) {
          const effectiveItems =
            'items' in data && data.items !== undefined ? data.items : existingWithdrawal.items;
          const effectiveServices =
            'services' in data && data.services !== undefined
              ? data.services
              : existingWithdrawal.services;

          if (effectiveType === EXTERNAL_OPERATION_TYPE.CHARGEABLE) {
            // CHARGEABLE: at least one item OR service, and all items must be priced
            if (effectiveItems.length + effectiveServices.length === 0) {
              throw new BadRequestException(
                'Adicione pelo menos um item ou serviço para retiradas cobráveis',
              );
            }
            if (
              effectiveItems.some(
                (item: { price: any }) => item.price === null || item.price === undefined,
              )
            ) {
              throw new BadRequestException(
                'Todos os itens selecionados devem ter preço definido',
              );
            }
          } else if (effectiveItems.length === 0) {
            // Non-CHARGEABLE: items required
            throw new BadRequestException('Pelo menos um item deve ser retirado');
          }
        }
      }
    }

    // Validate type and quote logic
    if (!isUpdate && 'type' in data && data.type === 'CHARGEABLE' && 'items' in data) {
      // If items are chargeable, validate that all items have prices
      for (const item of data.items || []) {
        if (item.price === null || item.price === undefined || item.price < 0) {
          throw new BadRequestException('Preço é obrigatório para itens cobráveis');
        }
      }
    }

    // Validate status if provided
    if (data.status !== undefined) {
      if (
        !Object.values(EXTERNAL_OPERATION_STATUS).includes(
          data.status as EXTERNAL_OPERATION_STATUS,
        )
      ) {
        // Log validation failure
        if (existingId) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
            entityId: existingId,
            action: CHANGE_ACTION.UPDATE,
            field: 'status',
            oldValue: null,
            newValue: data.status,
            reason: `Falha na validação: Status inválido '${data.status}'`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: existingId,
            transaction: tx,
            userId: null,
          });
        }
        throw new BadRequestException('Status de operação externa inválido');
      }

      // Validate status transitions for updates
      if (isUpdate && existingId) {
        const existingWithdrawal = await transaction.externalOperation.findUnique({
          where: { id: existingId },
          select: { status: true, type: true },
        });

        if (existingWithdrawal && existingWithdrawal.status !== data.status) {
          // Billing-state transitions (CHARGED fires the NFS-e/boleto pipeline,
          // LIQUIDATED settles it) are restricted to ADMIN/FINANCIAL actors.
          // Internal calls (no privilege threaded) are not gated.
          if (
            userPrivilege !== undefined &&
            (data.status === EXTERNAL_OPERATION_STATUS.CHARGED ||
              data.status === EXTERNAL_OPERATION_STATUS.LIQUIDATED) &&
            userPrivilege !== SECTOR_PRIVILEGES.ADMIN &&
            userPrivilege !== SECTOR_PRIVILEGES.FINANCIAL
          ) {
            throw new ForbiddenException(
              'Apenas administradores ou o setor financeiro podem marcar operações externas como Cobrado ou Liquidado',
            );
          }

          try {
            // Validate status transition based on type
            this.validateStatusTransition(
              existingWithdrawal.status as EXTERNAL_OPERATION_STATUS,
              data.status as EXTERNAL_OPERATION_STATUS,
              existingWithdrawal.type,
            );

            // Log successful status transition validation
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'status_transition',
              oldValue: existingWithdrawal.status,
              newValue: data.status,
              reason: `Validação de transição de status aprovada: ${existingWithdrawal.status} → ${data.status}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
          } catch (error) {
            // Log failed status transition validation
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
              entityId: existingId,
              action: CHANGE_ACTION.UPDATE,
              field: 'status_transition',
              oldValue: existingWithdrawal.status,
              newValue: data.status,
              reason: `Falha na validação de transição de status: ${existingWithdrawal.status} → ${data.status} - ${error.message}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: existingId,
              transaction: tx,
              userId: null,
            });
            throw error;
          }
        }
      }
    }
  }

  /**
   * Validate status transition for external withdrawal based on type
   */
  private validateStatusTransition(
    fromStatus: EXTERNAL_OPERATION_STATUS,
    toStatus: EXTERNAL_OPERATION_STATUS,
    type: string,
  ): void {
    // Type-specific valid transitions
    const validTransitions: Record<
      string,
      Record<EXTERNAL_OPERATION_STATUS, EXTERNAL_OPERATION_STATUS[]>
    > = {
      RETURNABLE: {
        [EXTERNAL_OPERATION_STATUS.PENDING]: [
          EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED,
          EXTERNAL_OPERATION_STATUS.FULLY_RETURNED,
          EXTERNAL_OPERATION_STATUS.CANCELLED,
        ],
        [EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED]: [
          EXTERNAL_OPERATION_STATUS.FULLY_RETURNED,
          EXTERNAL_OPERATION_STATUS.CANCELLED,
        ],
        [EXTERNAL_OPERATION_STATUS.FULLY_RETURNED]: [], // Final state
        [EXTERNAL_OPERATION_STATUS.CANCELLED]: [], // Final state
        [EXTERNAL_OPERATION_STATUS.CHARGED]: [],
        [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: [],
        [EXTERNAL_OPERATION_STATUS.DELIVERED]: [],
      },
      CHARGEABLE: {
        [EXTERNAL_OPERATION_STATUS.PENDING]: [
          EXTERNAL_OPERATION_STATUS.CHARGED,
          // LIQUIDATED intentionally NOT reachable from PENDING — it is automatic
          // after CHARGED (billing settle); direct PENDING→LIQUIDATED would settle
          // without any invoice.
          EXTERNAL_OPERATION_STATUS.CANCELLED,
        ],
        [EXTERNAL_OPERATION_STATUS.CHARGED]: [
          EXTERNAL_OPERATION_STATUS.LIQUIDATED,
          EXTERNAL_OPERATION_STATUS.CANCELLED,
        ],
        [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: [], // Final state
        [EXTERNAL_OPERATION_STATUS.CANCELLED]: [], // Final state
        [EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED]: [],
        [EXTERNAL_OPERATION_STATUS.FULLY_RETURNED]: [],
        [EXTERNAL_OPERATION_STATUS.DELIVERED]: [],
      },
      COMPLIMENTARY: {
        [EXTERNAL_OPERATION_STATUS.PENDING]: [
          EXTERNAL_OPERATION_STATUS.DELIVERED,
          EXTERNAL_OPERATION_STATUS.CANCELLED,
        ],
        [EXTERNAL_OPERATION_STATUS.DELIVERED]: [], // Final state
        [EXTERNAL_OPERATION_STATUS.CANCELLED]: [], // Final state
        [EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED]: [],
        [EXTERNAL_OPERATION_STATUS.FULLY_RETURNED]: [],
        [EXTERNAL_OPERATION_STATUS.CHARGED]: [],
        [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: [],
      },
    };

    const typeTransitions = validTransitions[type];
    if (!typeTransitions) {
      throw new BadRequestException(`Tipo de operação inválido: ${type}`);
    }

    const allowedTransitions = typeTransitions[fromStatus];

    if (!allowedTransitions || !allowedTransitions.includes(toStatus)) {
      const statusLabels: Record<EXTERNAL_OPERATION_STATUS, string> = {
        [EXTERNAL_OPERATION_STATUS.PENDING]: 'Pendente',
        [EXTERNAL_OPERATION_STATUS.CANCELLED]: 'Cancelado',
        [EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED]: 'Parcialmente Devolvido',
        [EXTERNAL_OPERATION_STATUS.FULLY_RETURNED]: 'Totalmente Devolvido',
        [EXTERNAL_OPERATION_STATUS.CHARGED]: 'Cobrado',
        [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: 'Liquidado',
        [EXTERNAL_OPERATION_STATUS.DELIVERED]: 'Entregue',
      };

      throw new BadRequestException(
        `Transição de status inválida para o tipo ${type}: não é possível alterar de "${statusLabels[fromStatus]}" para "${statusLabels[toStatus]}"`,
      );
    }
  }

  // =====================
  // BILLING (Operações Externas — invoice/NFS-e/boleto pipeline)
  // =====================

  /**
   * Billing is configured ⇔ CHARGEABLE + customer + at least one emission flag.
   */
  private isBillingConfigured(withdrawal: {
    type: string;
    customerId?: string | null;
    generateInvoice?: boolean | null;
    generateBankSlip?: boolean | null;
  }): boolean {
    return (
      withdrawal.type === EXTERNAL_OPERATION_TYPE.CHARGEABLE &&
      !!withdrawal.customerId &&
      (!!withdrawal.generateInvoice || !!withdrawal.generateBankSlip)
    );
  }

  /**
   * Preflight validation for the PENDING → CHARGED transition with billing configured.
   * Runs INSIDE the update transaction so a failure blocks the status flip.
   */
  private async validateBillingTransition(
    tx: PrismaTransaction,
    withdrawalId: string,
    effective: {
      customerId: string;
      generateInvoice: boolean;
      generateBankSlip: boolean;
      paymentCondition?: string | null;
      paymentConfig?: any | null;
    },
  ): Promise<void> {
    const withdrawal = await tx.externalOperation.findUnique({
      where: { id: withdrawalId },
      include: {
        items: { select: { price: true, withdrawedQuantity: true } },
        services: { select: { amount: true } },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Operação externa não encontrada');
    }

    // At least one priced item or service; all items must be priced
    if (withdrawal.items.length + withdrawal.services.length === 0) {
      throw new BadRequestException(
        'Adicione pelo menos um item ou serviço antes de cobrar a operação externa',
      );
    }
    if (withdrawal.items.some(item => item.price === null || item.price === undefined)) {
      throw new BadRequestException(
        'Todos os itens devem ter preço definido para gerar a cobrança',
      );
    }

    // Total must be positive, otherwise no installment can be generated
    const totalAmount =
      withdrawal.items.reduce(
        (sum, item) => sum + Number(item.price ?? 0) * item.withdrawedQuantity,
        0,
      ) + withdrawal.services.reduce((sum, service) => sum + Number(service.amount), 0);
    if (totalAmount <= 0) {
      throw new BadRequestException(
        'O valor total da operação externa deve ser maior que zero para gerar a cobrança',
      );
    }

    // Customer preflight (boleto payer data)
    const customer = await tx.customer.findUnique({
      where: { id: effective.customerId },
      select: {
        id: true,
        fantasyName: true,
        corporateName: true,
        cnpj: true,
        cpf: true,
        state: true,
        city: true,
        zipCode: true,
        address: true,
        neighborhood: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Cliente não encontrado para o faturamento');
    }

    const cleanedCnpj = (customer.cnpj ?? '').replace(/\D/g, '');
    const cleanedCpf = (customer.cpf ?? '').replace(/\D/g, '');
    const hasValidDocument = cleanedCnpj.length === 14 || cleanedCpf.length === 11;
    if (!hasValidDocument) {
      throw new BadRequestException(
        'O cliente precisa ter CNPJ (14 dígitos) ou CPF (11 dígitos) válido para gerar o faturamento',
      );
    }

    if (!customer.fantasyName && !customer.corporateName) {
      throw new BadRequestException(
        'O cliente precisa ter nome fantasia ou razão social cadastrados para gerar o faturamento',
      );
    }

    // Elotech preflight — full address required for NFS-e emission
    if (effective.generateInvoice) {
      const missing: string[] = [];
      if (!customer.state) missing.push('estado');
      if (!customer.city) missing.push('cidade');
      if (!customer.zipCode) missing.push('CEP');
      if (!customer.address) missing.push('endereço');
      if (!customer.neighborhood) missing.push('bairro');
      if (missing.length > 0) {
        throw new BadRequestException(
          `Para emissão de NFS-e o cliente precisa ter os seguintes dados cadastrados: ${missing.join(', ')}`,
        );
      }
    }

    // paymentCondition/paymentConfig must resolve to at least one installment
    const config = effective.paymentConfig;
    const configResolves =
      !!config && (config.type === 'CASH' || config.type === 'INSTALLMENTS');
    const validConditions = Object.values(PAYMENT_CONDITION).filter(
      condition => condition !== PAYMENT_CONDITION.CUSTOM,
    ) as string[];
    const conditionResolves =
      !!effective.paymentCondition && validConditions.includes(effective.paymentCondition);

    if (!configResolves && !conditionResolves) {
      throw new BadRequestException(
        'Defina uma condição de pagamento válida (à vista ou parcelado) para gerar a cobrança',
      );
    }
  }

  /**
   * Billing pipeline — runs AFTER the PENDING → CHARGED transition commits
   * (mirror of TaskQuoteService.internalApprove). Each stage is best-effort:
   * failures are logged and never revert the withdrawal status — the NFS-e and
   * bank slip schedulers (plus the manual /generate-billing endpoint) recover.
   */
  private async runBillingPipeline(
    withdrawalId: string,
    userId: string,
    options?: { rethrowInvoiceErrors?: boolean },
  ): Promise<void> {
    this.logger.log(
      `[EW_BILLING] Starting billing pipeline for external withdrawal ${withdrawalId} (user ${userId})`,
    );

    const withdrawal = await this.prisma.externalOperation.findUnique({
      where: { id: withdrawalId },
      select: { id: true, generateInvoice: true, generateBankSlip: true },
    });
    if (!withdrawal) {
      this.logger.warn(`[EW_BILLING] Withdrawal ${withdrawalId} not found — pipeline aborted`);
      return;
    }

    // Stage 1: generate invoice + installments (+ CREATING bank slips, PENDING NFS-e doc)
    let invoiceIds: string[] = [];
    try {
      invoiceIds = await this.invoiceGenerationService.generateInvoicesForExternalOperation(
        withdrawalId,
        userId,
        new Date(),
      );
      this.logger.log(
        `[EW_BILLING] Invoice generation complete: ${invoiceIds.length} invoice(s) [${invoiceIds.join(', ')}]`,
      );
    } catch (error) {
      this.logger.warn(
        `[EW_BILLING] Invoice generation failed for withdrawal ${withdrawalId}: ${error instanceof Error ? error.message : error}`,
      );
      if (options?.rethrowInvoiceErrors) {
        throw error;
      }
      return;
    }

    if (invoiceIds.length === 0) {
      this.logger.warn(
        `[EW_BILLING] No invoices generated for withdrawal ${withdrawalId}. Check billing configuration.`,
      );
      return;
    }

    // Stage 2: emit NFS-e FIRST (awaited) so the NFS-e number is available for seuNumero
    if (withdrawal.generateInvoice) {
      try {
        this.logger.log(
          `[EW_BILLING] Emitting NFS-e for ${invoiceIds.length} invoice(s) before registering bank slips...`,
        );
        await this.nfseEmissionScheduler.emitNfseForInvoices(invoiceIds);
      } catch (nfseError) {
        this.logger.warn(`[EW_BILLING] NFS-e emission error: ${nfseError}`);
      }
    }

    // Stage 3: register boletos only for invoices that are ready:
    //   (a) generateInvoice=false — no NFS-e required
    //   (b) generateInvoice=true  — NFS-e is now AUTHORIZED
    // Failed/blocked ones keep their bank slips in CREATING; the scheduler retries later.
    if (withdrawal.generateBankSlip) {
      try {
        let readyForBoleto: string[];
        if (withdrawal.generateInvoice) {
          const authorizedNfse = await this.prisma.nfseDocument.findMany({
            where: { invoiceId: { in: invoiceIds }, status: NFSE_STATUS.AUTHORIZED },
            select: { invoiceId: true },
          });
          readyForBoleto = [
            ...new Set(
              authorizedNfse
                .map(nfse => nfse.invoiceId)
                .filter((id): id is string => !!id),
            ),
          ];
        } else {
          readyForBoleto = invoiceIds;
        }

        const blockedCount = invoiceIds.length - readyForBoleto.length;
        if (blockedCount > 0) {
          this.logger.warn(
            `[EW_BILLING] ${blockedCount} invoice(s) skipped bank slip registration (NFS-e not yet authorized). Bank slip scheduler will retry after NFS-e succeeds.`,
          );
        }

        if (readyForBoleto.length > 0) {
          this.logger.log(
            `[EW_BILLING] Registering bank slips at Sicredi for ${readyForBoleto.length} invoice(s)...`,
          );
          await this.invoiceGenerationService.registerBankSlipsAtSicredi(readyForBoleto);
        }
      } catch (boletoError) {
        this.logger.warn(
          `[EW_BILLING] Some bank slips failed to register at Sicredi (will be retried by scheduler): ${boletoError}`,
        );
      }
    }

    // Stage 4: mark when the billing pipeline ran
    try {
      await this.prisma.externalOperation.update({
        where: { id: withdrawalId },
        data: { billedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `[EW_BILLING] Failed to set billedAt for withdrawal ${withdrawalId}: ${error}`,
      );
    }

    this.logger.log(
      `[EW_BILLING] Billing pipeline finished for external withdrawal ${withdrawalId}`,
    );
  }

  /**
   * CHARGED → CANCELLED post-commit hook — best-effort cancellation of billing artifacts.
   * Cancels active/overdue boletos at Sicredi and AUTHORIZED NFS-e at Elotech, then marks
   * BankSlips/Installments/Invoice as CANCELLED locally (never deletes financial records).
   * Never blocks the status change on integration failure.
   */
  private async cancelBillingArtifacts(withdrawalId: string): Promise<void> {
    this.logger.log(
      `[EW_BILLING_CANCEL] Cancelling billing artifacts for external withdrawal ${withdrawalId}`,
    );

    try {
      // Best-effort baixa at Sicredi for active/overdue registered boletos
      const activeSlips = await this.prisma.bankSlip.findMany({
        where: {
          installment: { externalOperationId: withdrawalId },
          status: { in: [BANK_SLIP_STATUS.ACTIVE, BANK_SLIP_STATUS.OVERDUE] },
          nossoNumero: { not: null },
        },
        select: { id: true, nossoNumero: true },
      });

      if (activeSlips.length > 0) {
        const outcomes = await Promise.allSettled(
          activeSlips
            .filter(slip => slip.nossoNumero && !slip.nossoNumero.startsWith('TMP-'))
            .map(slip => this.sicrediService.cancelBoleto(slip.nossoNumero!)),
        );
        outcomes.forEach((outcome, i) => {
          if (outcome.status === 'rejected') {
            this.logger.warn(
              `[EW_BILLING_CANCEL] Failed to baixar boleto ${activeSlips[i]?.nossoNumero} at Sicredi: ${outcome.reason}`,
            );
          } else {
            this.logger.log(
              `[EW_BILLING_CANCEL] Baixado boleto ${activeSlips[i]?.nossoNumero} at Sicredi`,
            );
          }
        });
      }

      // Best-effort cancel at Elotech for AUTHORIZED NFS-e
      const authorizedNfses = await this.prisma.nfseDocument.findMany({
        where: {
          invoice: { externalOperationId: withdrawalId },
          status: NFSE_STATUS.AUTHORIZED,
          elotechNfseId: { not: null },
        },
        select: { id: true, nfseNumber: true, elotechNfseId: true },
      });

      if (authorizedNfses.length > 0) {
        const outcomes = await Promise.allSettled(
          authorizedNfses.map(nfse =>
            this.elotechNfseService.cancelNfse(
              nfse.id,
              'Cancelamento automático por cancelamento da operação externa.',
              1,
            ),
          ),
        );
        outcomes.forEach((outcome, i) => {
          const nfse = authorizedNfses[i];
          if (outcome.status === 'rejected') {
            this.logger.warn(
              `[EW_BILLING_CANCEL] Failed to cancel NFS-e #${nfse?.nfseNumber} (elotechId=${nfse?.elotechNfseId}) at Elotech: ${outcome.reason}. Must be cancelled manually at Elotech OXY portal.`,
            );
          } else {
            this.logger.log(`[EW_BILLING_CANCEL] Cancelled NFS-e #${nfse?.nfseNumber} at Elotech`);
          }
        });
      }

      // Mark local records as CANCELLED (do NOT delete)
      await this.prisma.$transaction(async tx => {
        await tx.bankSlip.updateMany({
          where: {
            installment: { externalOperationId: withdrawalId },
            status: { notIn: [BANK_SLIP_STATUS.PAID, BANK_SLIP_STATUS.CANCELLED] },
          },
          data: { status: BANK_SLIP_STATUS.CANCELLED },
        });
        await tx.installment.updateMany({
          where: {
            externalOperationId: withdrawalId,
            status: { notIn: [INSTALLMENT_STATUS.PAID, INSTALLMENT_STATUS.CANCELLED] },
          },
          data: { status: INSTALLMENT_STATUS.CANCELLED },
        });
        await tx.invoice.updateMany({
          where: {
            externalOperationId: withdrawalId,
            status: { not: INVOICE_STATUS.CANCELLED },
          },
          data: { status: INVOICE_STATUS.CANCELLED },
        });
      });

      this.logger.log(
        `[EW_BILLING_CANCEL] Billing artifacts cancelled for external withdrawal ${withdrawalId}`,
      );
    } catch (error) {
      this.logger.error(
        `[EW_BILLING_CANCEL] Error cancelling billing artifacts for withdrawal ${withdrawalId}: ${error}`,
      );
    }
  }

  /**
   * CHARGED → LIQUIDATED (manual settle) post-commit hook — mirror of quote settleManually.
   * Cancels open boletos at Sicredi (best-effort), marks unpaid installments as PAID
   * (paymentMethod MANUAL) and the invoice as PAID.
   */
  private async settleBillingManually(withdrawalId: string, userId?: string): Promise<void> {
    this.logger.log(
      `[EW_BILLING_SETTLE] Manually settling billing for external withdrawal ${withdrawalId} (user ${userId ?? 'system'})`,
    );

    try {
      const slipsToCancelAtSicredi: Array<{ id: string; nossoNumero: string }> = [];

      await this.prisma.$transaction(async tx => {
        const installments = await tx.installment.findMany({
          where: {
            externalOperationId: withdrawalId,
            status: { notIn: [INSTALLMENT_STATUS.PAID, INSTALLMENT_STATUS.CANCELLED] },
          },
          include: { bankSlip: true },
        });

        const now = new Date();

        for (const installment of installments) {
          // Cancel open bank slips locally; remote Sicredi cancellation is fired below.
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

          // Mark installment as PAID (manual settlement)
          await tx.installment.update({
            where: { id: installment.id },
            data: {
              status: INSTALLMENT_STATUS.PAID,
              paidAmount: installment.amount,
              paidAt: now,
              paymentMethod: 'MANUAL',
            },
          });
        }

        // Mark the billing invoice as PAID
        await tx.invoice.updateMany({
          where: {
            externalOperationId: withdrawalId,
            status: { not: INVOICE_STATUS.CANCELLED },
          },
          data: { status: INVOICE_STATUS.PAID },
        });
      });

      // Best-effort baixa at Sicredi after the local transaction commits
      if (slipsToCancelAtSicredi.length > 0) {
        const outcomes = await Promise.allSettled(
          slipsToCancelAtSicredi.map(slip => this.sicrediService.cancelBoleto(slip.nossoNumero)),
        );
        outcomes.forEach((outcome, i) => {
          if (outcome.status === 'rejected') {
            this.logger.warn(
              `[EW_BILLING_SETTLE] Failed to baixar boleto ${slipsToCancelAtSicredi[i]?.nossoNumero} at Sicredi: ${outcome.reason}`,
            );
          } else {
            this.logger.log(
              `[EW_BILLING_SETTLE] Baixado boleto ${slipsToCancelAtSicredi[i]?.nossoNumero} at Sicredi`,
            );
          }
        });
      }

      this.logger.log(
        `[EW_BILLING_SETTLE] Manual settlement complete for external withdrawal ${withdrawalId}`,
      );
    } catch (error) {
      this.logger.error(
        `[EW_BILLING_SETTLE] Error settling billing for withdrawal ${withdrawalId}: ${error}`,
      );
    }
  }

  /**
   * Manual (re)trigger of the billing pipeline — recovery path for CHARGED withdrawals
   * whose pipeline failed (or legacy rows charged before the billing feature existed).
   */
  async generateBilling(id: string, userId: string): Promise<ExternalOperationUpdateResponse> {
    const withdrawal = await this.prisma.externalOperation.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        customerId: true,
        generateInvoice: true,
        generateBankSlip: true,
        paymentCondition: true,
        paymentConfig: true,
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Operação externa não encontrada');
    }

    if (withdrawal.type !== EXTERNAL_OPERATION_TYPE.CHARGEABLE) {
      throw new BadRequestException(
        'Apenas operações externas do tipo Cobrável podem gerar faturamento',
      );
    }

    if (withdrawal.status !== EXTERNAL_OPERATION_STATUS.CHARGED) {
      throw new BadRequestException(
        'O faturamento só pode ser gerado quando a operação externa está no status Cobrado',
      );
    }

    if (!this.isBillingConfigured(withdrawal)) {
      throw new BadRequestException(
        'Faturamento não configurado: selecione um cliente e habilite a emissão de nota fiscal e/ou boleto',
      );
    }

    const activeInvoice = await this.prisma.invoice.findFirst({
      where: { externalOperationId: id, status: { not: INVOICE_STATUS.CANCELLED } },
      select: { id: true },
    });
    if (activeInvoice) {
      throw new BadRequestException(
        'Já existe uma fatura ativa para esta operação externa. Cancele-a antes de gerar o faturamento novamente',
      );
    }

    // Same preflight as the PENDING → CHARGED transition (customer/payment data)
    await this.validateBillingTransition(this.prisma as unknown as PrismaTransaction, id, {
      customerId: withdrawal.customerId!,
      generateInvoice: !!withdrawal.generateInvoice,
      generateBankSlip: !!withdrawal.generateBankSlip,
      paymentCondition: withdrawal.paymentCondition,
      paymentConfig: withdrawal.paymentConfig,
    });

    try {
      await this.runBillingPipeline(id, userId, { rethrowInvoiceErrors: true });
    } catch (error) {
      this.logger.error(`Erro ao gerar faturamento da operação externa ${id}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Erro ao gerar faturamento: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
    }

    const refreshed = await this.externalOperationRepository.findById(id, {
      include: {
        customer: true,
        services: true,
        items: { include: { item: true } },
        billingInvoice: {
          include: {
            installments: { include: { bankSlip: true } },
            nfseDocuments: true,
          },
        },
      } as ExternalOperationInclude,
    });

    return {
      success: true,
      message: 'Faturamento gerado com sucesso',
      data: refreshed!,
    };
  }

  /**
   * Validate external withdrawal item data
   */
  private async externalOperationItemValidation(
    data: {
      itemId: string;
      quantity: number;
      price: number | null;
    },
    type: string,
    tx?: PrismaTransaction,
    existingWithdrawalId?: string,
  ): Promise<{ item: any }> {
    const transaction = tx || this.prisma;

    // Validate required fields
    if (!data.itemId) {
      throw new BadRequestException('ID do item é obrigatório');
    }

    // Validate quantity
    if (data.quantity === undefined || data.quantity === null) {
      throw new BadRequestException('Quantidade é obrigatória');
    }

    if (!Number.isFinite(data.quantity)) {
      throw new BadRequestException('Quantidade deve ser um número válido');
    }

    if (!Number.isInteger(data.quantity)) {
      throw new BadRequestException('Quantidade deve ser um número inteiro');
    }

    if (data.quantity <= 0) {
      throw new BadRequestException('Quantidade deve ser maior que zero');
    }

    if (data.quantity > 9999) {
      throw new BadRequestException('Quantidade máxima por item é 9999');
    }

    // Validate unit price only if items won't be returned
    if (type === 'CHARGEABLE') {
      if (data.price === undefined || data.price === null) {
        throw new BadRequestException('Preço é obrigatório para itens que não serão devolvidos');
      }

      if (!Number.isFinite(data.price)) {
        throw new BadRequestException('Preço deve ser um número válido');
      }

      if (data.price < 0) {
        throw new BadRequestException('Preço não pode ser negativo');
      }

      if (data.price > 999999.99) {
        throw new BadRequestException('Preço excede o limite máximo permitido');
      }

      // Validate precision (max 2 decimal places)
      if (data.price !== Math.round(data.price * 100) / 100) {
        throw new BadRequestException('Preço deve ter no máximo 2 casas decimais');
      }
    }

    // Validate item exists and get details
    const item = await transaction.item.findUnique({
      where: { id: data.itemId },
      include: {
        category: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        } as any,
      },
    });

    if (!item) {
      throw new NotFoundException(`Item não encontrado`);
    }

    // Calculate available quantity considering:
    // 1. Current stock
    // 2. Pending borrows
    // 3. Other external withdrawals (if updating)

    // Get total unreturned borrows
    const unreturnedBorrows = await transaction.borrow.aggregate({
      where: {
        itemId: data.itemId,
        returnedAt: null,
      },
      _sum: {
        quantity: true,
      },
    });
    const totalBorrowed = unreturnedBorrows._sum?.quantity ?? 0;

    // Since we now create OUTBOUND activities and decrease stock immediately when creating withdrawals,
    // we don't need to count other withdrawals - the stock already reflects them
    // We only need to count borrowed items that don't affect stock directly

    // Calculate truly available quantity
    const availableQuantity = item.quantity - totalBorrowed;

    // Check if item has enough available quantity
    if (availableQuantity < data.quantity) {
      const details: string[] = [];
      if (totalBorrowed > 0) {
        details.push(`${totalBorrowed} emprestado(s)`);
      }

      throw new BadRequestException(
        `Estoque insuficiente para o item "${item.name}". ` +
          `Disponível: ${availableQuantity}, Solicitado: ${data.quantity}. ` +
          `Estoque atual: ${item.quantity}${details.length > 0 ? ', ' + details.join(', ') : ''}`,
      );
    }

    // Warn if stock will be low after withdrawal
    const remainingAfterWithdrawal = availableQuantity - data.quantity;
    if (item.reorderPoint && remainingAfterWithdrawal <= item.reorderPoint) {
      console.warn(
        `AVISO: Item "${item.name}" ficará com estoque baixo após a retirada. ` +
          `Disponível após retirada: ${remainingAfterWithdrawal}, Ponto de reposição: ${item.reorderPoint}`,
      );
    }

    // Validate price consistency only if not returning
    if (type === 'CHARGEABLE' && data.price !== null && item.prices && item.prices.length > 0) {
      const currentPrice = item.prices[0]?.value ?? 0;
      const priceDifference = Math.abs(data.price - currentPrice);
      const priceVariationPercent = (priceDifference / currentPrice) * 100;

      // Warn if price varies more than 20% from current price
      if (priceVariationPercent > 20) {
        console.warn(
          `AVISO: Preço informado (R$ ${data.price.toFixed(2)}) ` +
            `varia ${priceVariationPercent.toFixed(1)}% do preço atual do item (R$ ${currentPrice.toFixed(2)})`,
        );
      }
    }

    return { item };
  }

  // =====================
  // EXTERNAL WITHDRAWAL OPERATIONS
  // =====================

  /**
   * Buscar muitas operações externas com filtros
   */
  async findMany(
    query: ExternalOperationGetManyFormData,
  ): Promise<ExternalOperationGetManyResponse> {
    try {
      const result = await this.externalOperationRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Operações externas carregadas com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar operações externas:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar operações externas. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar uma operação externa por ID
   */
  async findById(
    id: string,
    include?: ExternalOperationInclude,
  ): Promise<ExternalOperationGetUniqueResponse> {
    try {
      const externalOperation = await this.externalOperationRepository.findById(id, { include });

      if (!externalOperation) {
        throw new NotFoundException('Operação externa não encontrada');
      }

      return {
        success: true,
        data: externalOperation,
        message: 'Operação externa carregada com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar operação externa por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar operação externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar nova operação externa
   */
  async create(
    data: ExternalOperationCreateFormData,
    include?: ExternalOperationInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalOperationCreateResponse> {
    try {
      // C1: created operations are ALWAYS PENDING — stock movements and the billing
      // pipeline only fire on status transitions (hard override; schema enforces too).
      data = { ...data, status: EXTERNAL_OPERATION_STATUS.PENDING };

      const externalOperation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate external withdrawal data
        await this.externalOperationValidation(data, undefined, tx);

        // Validate type field (default to RETURNABLE)
        const type = data.type ?? EXTERNAL_OPERATION_TYPE.RETURNABLE;

        const validatedItems: Array<{
          itemId: string;
          withdrawedQuantity: number;
          price: number | null;
        }> = [];

        // Validate all items before creating anything
        if (data.items && data.items.length > 0) {
          for (const itemData of data.items) {
            const validation = await this.externalOperationItemValidation(
              {
                itemId: itemData.itemId,
                quantity: itemData.withdrawedQuantity,
                price: itemData.price ?? null,
              },
              type,
              tx,
            );
            validatedItems.push({
              itemId: itemData.itemId,
              withdrawedQuantity: itemData.withdrawedQuantity,
              price: type !== 'CHARGEABLE' ? null : (itemData.price ?? null),
            });
          }
        }

        // Criar a operação externa
        const newWithdrawal = await this.externalOperationRepository.createWithTransaction(
          tx,
          {
            ...data,
            type,
            items: undefined, // Remover itens dos dados principais
          },
          { include },
        );

        // Criar itens se fornecidos (já validados)
        if (validatedItems.length > 0) {
          for (const validatedItem of validatedItems) {
            // Buscar item novamente para atualização
            const item = await tx.item.findUnique({ where: { id: validatedItem.itemId } });
            if (!item) {
              throw new NotFoundException(`Item com ID ${validatedItem.itemId} não encontrado`);
            }

            // Criar item da operação
            // Stock is NOT decreased here - only when the withdrawal is delivered (status change from PENDING)
            // This allows cancelling/deleting withdrawals without affecting stock
            await this.externalOperationItemRepository.createWithTransaction(tx, {
              externalOperationId: newWithdrawal.id,
              itemId: validatedItem.itemId,
              withdrawedQuantity: validatedItem.withdrawedQuantity,
              price: validatedItem.price,
            });
          }
        }

        // Persist uploaded files (multipart) and link them to the operation
        await this.persistUploadedFiles(tx, newWithdrawal.id, files, userId);

        // Registrar no changelog usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
          entityId: newWithdrawal.id,
          action: CHANGE_ACTION.CREATE,
          entity: newWithdrawal,
          reason: `Operação externa criada para ${data.withdrawerName || 'cliente'}`,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Retornar com itens incluídos
        return await this.externalOperationRepository.findByIdWithTransaction(
          tx,
          newWithdrawal.id,
          { include },
        );
      });

      // Notify warehouse/admin that a new external withdrawal was created.
      // Best-effort: never break the creation flow.
      try {
        if (externalOperation) {
          const deepLink = this.buildExternalOperationDeepLink(externalOperation.id);
          const withdrawerName = externalOperation.withdrawerName || 'Retirante';
          await this.dispatchService.dispatchByConfiguration(
            'external_operation.created',
            userId || 'system',
            {
              entityType: 'ExternalOperation',
              entityId: externalOperation.id,
              action: 'created',
              data: {
                withdrawerName,
              },
              overrides: {
                title: 'Nova Operação Externa',
                body: `Uma nova operação externa foi registrada para ${withdrawerName}.`,
                webUrl: deepLink,
                mobileUrl: deepLink,
                relatedEntityType: 'EXTERNAL_OPERATION',
              },
            },
          );
        }
      } catch (error) {
        this.logger.error('Erro ao emitir notificação de operação externa criada:', error);
      }

      return {
        success: true,
        message: 'Operação externa criada com sucesso',
        data: externalOperation!,
      };
    } catch (error) {
      this.logger.error('Erro ao criar operação externa:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      // Preserve the original error message for better debugging
      const errorMessage =
        error instanceof Error ? error.message : 'Erro desconhecido ao criar operação externa';
      throw new InternalServerErrorException(`Erro ao criar operação externa: ${errorMessage}`);
    }
  }

  /**
   * Atualizar operação externa
   */
  async update(
    id: string,
    data: ExternalOperationUpdateFormData,
    include?: ExternalOperationInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
    userPrivilege?: string,
  ): Promise<ExternalOperationUpdateResponse> {
    try {
      // Captured for post-commit notification emit (full-return).
      let becameFullyReturned = false;
      // Captured for post-commit billing hooks (PENDING→CHARGED, CHARGED→CANCELLED, CHARGED→LIQUIDATED).
      let shouldRunBillingPipeline = false;
      let shouldCancelBilling = false;
      let shouldSettleBilling = false;
      // Captured for post-commit status notification (transitions INTO CHARGED/LIQUIDATED/CANCELLED).
      let statusNotificationTarget: EXTERNAL_OPERATION_STATUS | null = null;

      const updatedWithdrawal = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar retirada existente
        const existingWithdrawal = await this.externalOperationRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingWithdrawal) {
          throw new NotFoundException('Operação externa não encontrada');
        }

        if (
          data.status === EXTERNAL_OPERATION_STATUS.FULLY_RETURNED &&
          existingWithdrawal.status !== EXTERNAL_OPERATION_STATUS.FULLY_RETURNED
        ) {
          becameFullyReturned = true;
        }

        // Validate external withdrawal data
        await this.externalOperationValidation(data, id, tx, userPrivilege);

        // Mirror create semantics: non-CHARGEABLE withdrawals never persist item prices
        if (
          data.items !== undefined &&
          (data.type ?? existingWithdrawal.type) !== EXTERNAL_OPERATION_TYPE.CHARGEABLE
        ) {
          data = {
            ...data,
            items: data.items.map(item => ({ ...item, price: null })),
          };
        }

        // Detect billing-relevant status transitions (hooks fire AFTER the commit)
        if (data.status && existingWithdrawal.status !== data.status) {
          if (
            data.status === EXTERNAL_OPERATION_STATUS.CHARGED ||
            data.status === EXTERNAL_OPERATION_STATUS.LIQUIDATED ||
            data.status === EXTERNAL_OPERATION_STATUS.CANCELLED
          ) {
            statusNotificationTarget = data.status as EXTERNAL_OPERATION_STATUS;
          }

          const effectiveBilling = {
            type: data.type ?? existingWithdrawal.type,
            customerId: data.customerId !== undefined ? data.customerId : existingWithdrawal.customerId,
            generateInvoice:
              data.generateInvoice !== undefined
                ? data.generateInvoice
                : existingWithdrawal.generateInvoice,
            generateBankSlip:
              data.generateBankSlip !== undefined
                ? data.generateBankSlip
                : existingWithdrawal.generateBankSlip,
            paymentCondition:
              data.paymentCondition !== undefined
                ? data.paymentCondition
                : existingWithdrawal.paymentCondition,
            paymentConfig:
              data.paymentConfig !== undefined
                ? data.paymentConfig
                : existingWithdrawal.paymentConfig,
          };

          if (
            existingWithdrawal.status === EXTERNAL_OPERATION_STATUS.PENDING &&
            data.status === EXTERNAL_OPERATION_STATUS.CHARGED &&
            this.isBillingConfigured(effectiveBilling)
          ) {
            const activeInvoice = await tx.invoice.findFirst({
              where: { externalOperationId: id, status: { not: INVOICE_STATUS.CANCELLED } },
              select: { id: true },
            });
            if (!activeInvoice) {
              // Preflight runs INSIDE the transaction — failure blocks the status flip.
              // NOTE: the new items/services from this same request aren't persisted yet
              // at this point, so the preflight below runs after the repository update.
              shouldRunBillingPipeline = true;
            }
          }

          if (
            existingWithdrawal.status === EXTERNAL_OPERATION_STATUS.CHARGED &&
            data.status === EXTERNAL_OPERATION_STATUS.CANCELLED
          ) {
            shouldCancelBilling = true;
          }

          if (
            existingWithdrawal.status === EXTERNAL_OPERATION_STATUS.CHARGED &&
            data.status === EXTERNAL_OPERATION_STATUS.LIQUIDATED
          ) {
            shouldSettleBilling = true;
          }
        }

        // Concurrency claim (M3): atomically assert the status we validated against is
        // still the current one before applying side effects. Two concurrent transitions
        // (e.g. double FULLY_RETURNED) would otherwise both pass validation and
        // double-apply stock movements/billing hooks.
        if (data.status && data.status !== existingWithdrawal.status) {
          const claim = await tx.externalOperation.updateMany({
            where: { id, status: existingWithdrawal.status as any },
            data: {
              status: data.status as any,
              statusOrder:
                EXTERNAL_OPERATION_STATUS_ORDER[data.status as EXTERNAL_OPERATION_STATUS] || 1,
            },
          });
          if (claim.count !== 1) {
            throw new BadRequestException(
              'A operação externa foi alterada por outra operação simultânea. Recarregue e tente novamente',
            );
          }
        }

        // Atualizar a retirada
        const updatedWithdrawal = await this.externalOperationRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Persist uploaded files (multipart) and link them to the operation
        await this.persistUploadedFiles(tx, id, files, userId);

        // Billing preflight for PENDING → CHARGED (after the update so this request's
        // items/services/customer edits are already persisted). Throwing here rolls
        // back the whole transaction and blocks the status flip.
        if (shouldRunBillingPipeline) {
          await this.validateBillingTransition(tx, id, {
            customerId: (data.customerId !== undefined
              ? data.customerId
              : existingWithdrawal.customerId)!,
            generateInvoice: !!(data.generateInvoice !== undefined
              ? data.generateInvoice
              : existingWithdrawal.generateInvoice),
            generateBankSlip: !!(data.generateBankSlip !== undefined
              ? data.generateBankSlip
              : existingWithdrawal.generateBankSlip),
            paymentCondition:
              data.paymentCondition !== undefined
                ? data.paymentCondition
                : existingWithdrawal.paymentCondition,
            paymentConfig:
              data.paymentConfig !== undefined
                ? data.paymentConfig
                : existingWithdrawal.paymentConfig,
          });
        }

        // Handle OUTBOUND activity creation when status changes FROM PENDING to a delivered state
        // This is when items actually leave the stock
        if (data.status && existingWithdrawal.status !== data.status) {
          const isDeliveredStatus =
            data.status !== EXTERNAL_OPERATION_STATUS.PENDING &&
            data.status !== EXTERNAL_OPERATION_STATUS.CANCELLED;

          if (
            existingWithdrawal.status === EXTERNAL_OPERATION_STATUS.PENDING &&
            isDeliveredStatus
          ) {
            // Get withdrawal items for OUTBOUND creation
            const withdrawalWithItemsForOutbound =
              await this.externalOperationRepository.findByIdWithTransaction(tx, id, {
                include: { items: true },
              });

            if (
              withdrawalWithItemsForOutbound?.items &&
              withdrawalWithItemsForOutbound.items.length > 0
            ) {
              for (const item of withdrawalWithItemsForOutbound.items) {
                // Create OUTBOUND activity - items are now leaving the stock
                await tx.activity.create({
                  data: {
                    itemId: item.itemId,
                    quantity: item.withdrawedQuantity,
                    operation: ACTIVITY_OPERATION.OUTBOUND,
                    reason: ACTIVITY_REASON.EXTERNAL_OPERATION,
                    reasonOrder: 6, // External withdrawal
                    userId: null, // No user - this is for external people
                  },
                });

                // Update item stock - decrease quantity
                const currentItemForOutbound = await tx.item.findUnique({
                  where: { id: item.itemId },
                });

                if (currentItemForOutbound) {
                  // M2: re-validate availability at delivery time — never clamp to 0,
                  // which would silently hide an oversell.
                  if (currentItemForOutbound.quantity < item.withdrawedQuantity) {
                    throw new BadRequestException(
                      `Estoque insuficiente para entregar o item "${currentItemForOutbound.name}". ` +
                        `Disponível: ${currentItemForOutbound.quantity}, necessário: ${item.withdrawedQuantity}`,
                    );
                  }
                  const newQuantity = currentItemForOutbound.quantity - item.withdrawedQuantity;

                  await tx.item.update({
                    where: { id: item.itemId },
                    data: { quantity: newQuantity },
                  });

                  // Log the stock update
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.ITEM,
                    entityId: item.itemId,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'quantity',
                    oldValue: currentItemForOutbound.quantity,
                    newValue: newQuantity,
                    reason: `Estoque atualizado - Operação externa entregue`,
                    triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION,
                    triggeredById: id,
                    transaction: tx,
                    userId: userId || null,
                  });
                }
              }
            }
          }
        }

        // Handle stock return when status changes to FULLY_RETURNED or PARTIALLY_RETURNED
        console.log(`[UPDATE METHOD] Checking status change:`, {
          withdrawalId: id,
          dataStatus: data.status,
          existingStatus: existingWithdrawal.status,
          type: existingWithdrawal.type,
          statusChanged: existingWithdrawal.status !== data.status,
          isReturnStatus:
            data.status === EXTERNAL_OPERATION_STATUS.FULLY_RETURNED ||
            data.status === EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED,
          shouldProcessReturn:
            data.status &&
            existingWithdrawal.type === 'RETURNABLE' &&
            existingWithdrawal.status !== data.status &&
            (data.status === EXTERNAL_OPERATION_STATUS.FULLY_RETURNED ||
              data.status === EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED),
        });

        if (
          data.status &&
          existingWithdrawal.type === 'RETURNABLE' &&
          existingWithdrawal.status !== data.status &&
          (data.status === EXTERNAL_OPERATION_STATUS.FULLY_RETURNED ||
            data.status === EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED)
        ) {
          console.log(`[UPDATE METHOD] Processing return for status change to ${data.status}`);
          // Validate status transition
          this.validateStatusTransition(
            existingWithdrawal.status as EXTERNAL_OPERATION_STATUS,
            data.status as EXTERNAL_OPERATION_STATUS,
            existingWithdrawal.type,
          );

          // Get withdrawal items
          const withdrawalWithItems =
            await this.externalOperationRepository.findByIdWithTransaction(tx, id, {
              include: { items: true },
            });

          if (withdrawalWithItems?.items && withdrawalWithItems.items.length > 0) {
            console.log(
              `[UPDATE METHOD] Processing ${withdrawalWithItems.items.length} items for return`,
            );

            for (const item of withdrawalWithItems.items) {
              // Calculate how much is still to be returned (avoid double-counting)
              const alreadyReturned = item.returnedQuantity || 0;
              const stillToReturn = item.withdrawedQuantity - alreadyReturned;

              // For FULLY_RETURNED, return remaining quantity only
              // For PARTIALLY_RETURNED, we don't automatically return anything
              const returnedQuantity =
                data.status === EXTERNAL_OPERATION_STATUS.FULLY_RETURNED ? stillToReturn : 0;

              // Update the withdrawal item's returnedQuantity field
              if (data.status === EXTERNAL_OPERATION_STATUS.FULLY_RETURNED && stillToReturn > 0) {
                await tx.externalOperationItem.update({
                  where: { id: item.id },
                  data: { returnedQuantity: item.withdrawedQuantity },
                });
              }

              if (returnedQuantity > 0) {
                console.log(
                  `[UPDATE METHOD] Processing return for item ${item.itemId}, already returned: ${alreadyReturned}, still to return: ${stillToReturn}, returning now: ${returnedQuantity}`,
                );

                // Create inbound activity for the return
                // Using Prisma directly (bypassing ActivityService)
                await tx.activity.create({
                  data: {
                    itemId: item.itemId,
                    quantity: returnedQuantity,
                    operation: ACTIVITY_OPERATION.INBOUND,
                    reason: ACTIVITY_REASON.EXTERNAL_OPERATION_RETURN,
                    reasonOrder: 7, // External withdrawal return
                    userId: null, // No user - this is for external people
                  },
                });

                // Update item stock manually since we're bypassing the activity service
                const currentItem = await tx.item.findUnique({
                  where: { id: item.itemId },
                });

                if (currentItem) {
                  const newQuantity = currentItem.quantity + returnedQuantity;

                  console.log(
                    `[UPDATE METHOD] Updating stock for item ${item.itemId}: ${currentItem.quantity} -> ${newQuantity}`,
                  );

                  await tx.item.update({
                    where: { id: item.itemId },
                    data: { quantity: newQuantity },
                  });

                  // Log the stock update
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.ITEM,
                    entityId: item.itemId,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'quantity',
                    oldValue: currentItem.quantity,
                    newValue: newQuantity,
                    reason: `Estoque atualizado - Devolução de operação externa`,
                    triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_RETURN,
                    triggeredById: id,
                    transaction: tx,
                    userId: userId || null,
                  });
                }
              }
            }
          }
        }

        // Rastrear mudanças em campos específicos — only fields that actually exist
        // on the ExternalOperation model (M8: phantom fields removed)
        const fieldsToTrack = [
          'withdrawerName',
          // "status" is handled separately with status_transition for better context
          // "statusOrder" is internal and shouldn't be tracked
          'type',
          'notes',
          // Billing fields
          'customerId',
          'generateInvoice',
          'generateBankSlip',
          'paymentCondition',
          'paymentConfig',
          'services',
          'billedAt',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
          entityId: id,
          oldEntity: existingWithdrawal,
          newEntity: updatedWithdrawal,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedWithdrawal;
      });

      // Notify when the withdrawal was fully returned. Best-effort.
      if (becameFullyReturned) {
        await this.emitExternalOperationReturned(updatedWithdrawal, userId);
      }

      // Post-commit billing hooks (best-effort — never revert the status change)
      if (shouldRunBillingPipeline) {
        await this.runBillingPipeline(id, userId || 'system');
      }
      if (shouldCancelBilling) {
        await this.cancelBillingArtifacts(id);
      }
      if (shouldSettleBilling) {
        await this.settleBillingManually(id, userId);
      }

      // Notify on transitions INTO CHARGED/LIQUIDATED/CANCELLED. Best-effort,
      // after the billing hooks so the notification reflects the settled state.
      if (statusNotificationTarget) {
        await this.emitExternalOperationStatusChanged(id, statusNotificationTarget, userId);
      }

      return {
        success: true,
        message: 'Operação externa atualizada com sucesso',
        data: updatedWithdrawal,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar operação externa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      // Preserve the original error message for better debugging
      const errorMessage =
        error instanceof Error ? error.message : 'Erro desconhecido ao atualizar operação externa';
      throw new InternalServerErrorException(`Erro ao atualizar operação externa: ${errorMessage}`);
    }
  }

  /**
   * Excluir operação externa
   */
  async delete(id: string, userId?: string): Promise<ExternalOperationDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const withdrawal = await this.externalOperationRepository.findByIdWithTransaction(tx, id, {
          include: { items: true },
        });

        if (!withdrawal) {
          throw new NotFoundException('Operação externa não encontrada');
        }

        // C4: deleting a CHARGED/LIQUIDATED operation would cascade-destroy
        // Invoice/Installments/BankSlips/NfseDocuments while boletos stay live at
        // Sicredi and the NFS-e stays authorized at Elotech.
        if (
          withdrawal.status === EXTERNAL_OPERATION_STATUS.CHARGED ||
          withdrawal.status === EXTERNAL_OPERATION_STATUS.LIQUIDATED
        ) {
          throw new BadRequestException(
            'Não é possível excluir uma operação externa Cobrada ou Liquidada — cancele a operação antes de excluí-la',
          );
        }

        // Only restore stock if the withdrawal was actually delivered (not PENDING or CANCELLED)
        // If items were never delivered, stock was never decremented, so nothing to restore
        const wasDelivered =
          withdrawal.status !== EXTERNAL_OPERATION_STATUS.PENDING &&
          withdrawal.status !== EXTERNAL_OPERATION_STATUS.CANCELLED;

        if (wasDelivered && withdrawal.items && withdrawal.items.length > 0) {
          for (const withdrawalItem of withdrawal.items) {
            const item = await tx.item.findUnique({ where: { id: withdrawalItem.itemId } });
            if (item) {
              // Calculate how much to restore: withdrawn quantity minus already returned quantity
              // Some items may have already been returned (INBOUND created), so we only restore what's still out
              const alreadyReturned = withdrawalItem.returnedQuantity || 0;
              const quantityToRestore = withdrawalItem.withdrawedQuantity - alreadyReturned;

              if (quantityToRestore > 0) {
                const newQuantity = item.quantity + quantityToRestore;
                await tx.item.update({
                  where: { id: withdrawalItem.itemId },
                  data: { quantity: newQuantity },
                });

                // Criar atividade para rastrear a restauração
                await this.activityRepository.createWithTransaction(tx, {
                  itemId: withdrawalItem.itemId,
                  quantity: quantityToRestore,
                  operation: ACTIVITY_OPERATION.INBOUND,
                  reason: ACTIVITY_REASON.EXTERNAL_OPERATION,
                  userId: userId || null,
                });

                // Registrar restauração do estoque
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ITEM,
                  entityId: withdrawalItem.itemId,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'quantity',
                  oldValue: item.quantity,
                  newValue: newQuantity,
                  reason: 'Estoque restaurado - Exclusão de operação externa',
                  triggeredBy: CHANGE_TRIGGERED_BY.EXTERNAL_OPERATION_DELETE,
                  triggeredById: id,
                  transaction: tx,
                  userId: userId || null,
                });
              }
            }
          }
        }

        // Registrar exclusão usando helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: withdrawal,
          reason: 'Operação externa excluída',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.externalOperationRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Operação externa excluída com sucesso',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir operação externa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir operação externa. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplas operações externas
   */
  async batchCreate(
    data: ExternalOperationBatchCreateFormData,
    include?: ExternalOperationInclude,
    userId?: string,
  ): Promise<ExternalOperationBatchCreateResponse<ExternalOperationCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = {
          success: [] as any[],
          failed: [] as any[],
          totalCreated: 0,
          totalFailed: 0,
        };

        // Process each withdrawal individually to capture detailed errors
        for (let index = 0; index < data.externalOperations.length; index++) {
          // C1: batch-created operations are ALWAYS PENDING (hard override)
          const withdrawalData = {
            ...data.externalOperations[index],
            status: EXTERNAL_OPERATION_STATUS.PENDING,
          };

          try {
            // Get additional context for better error messages
            let itemNames: string[] = [];
            if (withdrawalData.items && withdrawalData.items.length > 0) {
              const itemIds = withdrawalData.items.map(item => item.itemId);
              const items = await this.itemRepository.findByIdsWithTransaction(tx, itemIds);
              itemNames = items.map(item => item.name);
            }

            // C5: run the SAME validation pipeline as the single create path
            await this.externalOperationValidation(withdrawalData, undefined, tx);

            const type = withdrawalData.type ?? EXTERNAL_OPERATION_TYPE.RETURNABLE;
            if (withdrawalData.items && withdrawalData.items.length > 0) {
              for (const itemData of withdrawalData.items) {
                await this.externalOperationItemValidation(
                  {
                    itemId: itemData.itemId,
                    quantity: itemData.withdrawedQuantity,
                    price: itemData.price ?? null,
                  },
                  type,
                  tx,
                );
              }

              // Mirror create(): non-CHARGEABLE operations never persist item prices
              if (type !== EXTERNAL_OPERATION_TYPE.CHARGEABLE) {
                withdrawalData.items = withdrawalData.items.map(item => ({
                  ...item,
                  price: null,
                }));
              }
            }

            // Create withdrawal
            const created = await this.externalOperationRepository.createWithTransaction(
              tx,
              { ...withdrawalData, type },
              { include },
            );

            // Log successful creation with enhanced context
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: `Operação externa criada em lote - Retirador: ${withdrawalData.withdrawerName || 'N/A'}, Itens: ${itemNames.join(', ') || 'N/A'}`,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            // Add success with detailed info
            const successWithDetails = {
              ...created,
              withdrawerName: withdrawalData.withdrawerName,
              itemNames: itemNames.join(', '),
              status: 'success' as const,
            };

            batchResult.success.push(successWithDetails);
            batchResult.totalCreated++;
          } catch (error: any) {
            // Get item names for error context
            let itemNames: string[] = [];
            if (withdrawalData.items && withdrawalData.items.length > 0) {
              try {
                const itemIds = withdrawalData.items.map(item => item.itemId);
                const items = await this.itemRepository.findByIdsWithTransaction(tx, itemIds);
                itemNames = items.map(item => item.name);
              } catch {
                // If we can't get item names, continue without them
              }
            }

            // Preserve detailed error information with context
            batchResult.failed.push({
              index,
              error: error.message || 'Erro ao criar operação externa',
              errorCode: error.constructor?.name || 'UNKNOWN_ERROR',
              data: {
                ...withdrawalData,
                withdrawerName: withdrawalData.withdrawerName,
                itemNames: itemNames.join(', ') || 'Itens desconhecidos',
              },
              status: 'failed' as const,
            });
            batchResult.totalFailed++;
            this.logger.warn(
              `Erro ao criar operação externa ${index} (${withdrawalData.withdrawerName}):`,
              error.message,
            );
          }
        }

        // Log batch operation summary
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
          entityId: 'batch_operation',
          action: CHANGE_ACTION.CREATE,
          field: 'batch_summary',
          oldValue: null,
          newValue: {
            totalProcessed: data.externalOperations.length,
            totalSuccess: batchResult.totalCreated,
            totalFailed: batchResult.totalFailed,
            operation: 'batch_create',
            timestamp: new Date().toISOString(),
          },
          reason: `Operação em lote concluída: ${batchResult.totalCreated} criadas, ${batchResult.totalFailed} falharam`,
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
          triggeredById: 'batch_operation',
          transaction: tx,
          userId: userId || null,
        });

        return batchResult;
      });

      // Notify per created operation (post-commit) — mirrors the single create
      // path's external_operation.created dispatch. Best-effort: never break the batch.
      for (const created of result.success) {
        try {
          const deepLink = this.buildExternalOperationDeepLink(created.id);
          const withdrawerName = created.withdrawerName || 'Retirante';
          await this.dispatchService.dispatchByConfiguration(
            'external_operation.created',
            userId || 'system',
            {
              entityType: 'ExternalOperation',
              entityId: created.id,
              action: 'created',
              data: {
                withdrawerName,
              },
              overrides: {
                title: 'Nova Operação Externa',
                body: `Uma nova operação externa foi registrada para ${withdrawerName}.`,
                webUrl: deepLink,
                mobileUrl: deepLink,
                relatedEntityType: 'EXTERNAL_OPERATION',
              },
            },
          );
        } catch (error) {
          this.logger.error(
            'Erro ao emitir notificação de operação externa criada (lote):',
            error,
          );
        }
      }

      const successMessage =
        result.totalCreated === 1
          ? '1 operação externa criada com sucesso'
          : `${result.totalCreated} operações externas criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert to BatchOperationResult format with enhanced details
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na criação em lote:', error);

      // Always try to return partial results for validation errors
      if (
        error.message?.includes('insuficiente') ||
        error.message?.includes('Invalid') ||
        error.message?.includes('não encontrado') ||
        error.message?.includes('validation') ||
        error.message?.includes('deve ter preço')
      ) {
        // Return as successful response but with failed items
        return {
          success: true, // Important: Keep as true so frontend shows the modal
          message: 'Operação processada com erros de validação',
          data: {
            success: [],
            failed: [
              {
                index: 0,
                error: error.message,
                errorCode: error.constructor?.name || 'VALIDATION_ERROR',
                data: {} as ExternalOperationCreateFormData,
              },
            ],
            totalProcessed: 1,
            totalSuccess: 0,
            totalFailed: 1,
          },
        };
      }

      // Only throw generic error for unexpected system errors
      throw new InternalServerErrorException(
        'Erro ao criar operações externas em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar múltiplas operações externas
   *
   * C2: delegates per-entity to the SAME single-update logic (update()) so batch
   * updates go through validation, locked-field enforcement, status-transition
   * gates, stock movements and the billing pipeline — collecting per-item
   * success/failure like the other batch endpoints.
   */
  async batchUpdate(
    data: ExternalOperationBatchUpdateFormData,
    include?: ExternalOperationInclude,
    userId?: string,
    userPrivilege?: string,
  ): Promise<ExternalOperationBatchUpdateResponse<ExternalOperationUpdateFormData>> {
    try {
      const success: any[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        errorCode?: string;
        data: any;
      }> = [];

      for (let index = 0; index < data.externalOperations.length; index++) {
        const { id, data: updateData } = data.externalOperations[index];
        try {
          const response = await this.update(
            id,
            updateData,
            include,
            userId,
            undefined,
            userPrivilege,
          );
          success.push(response.data);
        } catch (error: any) {
          failed.push({
            index,
            id,
            error: error?.message || 'Erro ao atualizar operação externa',
            errorCode: error?.constructor?.name || 'UNKNOWN_ERROR',
            data: { ...updateData, id },
          });
          this.logger.warn(
            `Erro ao atualizar operação externa ${id} (lote):`,
            error?.message,
          );
        }
      }

      const successMessage =
        success.length === 1
          ? '1 operação externa atualizada com sucesso'
          : `${success.length} operações externas atualizadas com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar operações externas em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir múltiplas operações externas
   *
   * C3: stock is only restored for operations that were actually delivered
   * (status not PENDING/CANCELLED) and only for the still-out quantity
   * (withdrawedQuantity - returnedQuantity) — same rules as the single delete().
   * C4: CHARGED/LIQUIDATED operations cannot be deleted (billing artifacts).
   */
  async batchDelete(
    data: ExternalOperationBatchDeleteFormData,
    userId?: string,
  ): Promise<ExternalOperationBatchDeleteResponse> {
    try {
      const indexById = new Map(data.externalOperationIds.map((id, index) => [id, index]));

      const { deleteResult, blocked } = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // Buscar retiradas antes de excluir para o changelog
          const withdrawals = await this.externalOperationRepository.findByIdsWithTransaction(
            tx,
            data.externalOperationIds,
            {
              include: { items: true },
            },
          );

          const blocked: Array<{
            index: number;
            id: string;
            error: string;
            errorCode: string;
            data: any;
          }> = [];
          const deletableIds: string[] = [];

          // Restaurar estoque e registrar exclusões
          for (const withdrawal of withdrawals) {
            // C4: never delete operations with live billing artifacts
            if (
              withdrawal.status === EXTERNAL_OPERATION_STATUS.CHARGED ||
              withdrawal.status === EXTERNAL_OPERATION_STATUS.LIQUIDATED
            ) {
              blocked.push({
                index: indexById.get(withdrawal.id) ?? 0,
                id: withdrawal.id,
                error:
                  'Não é possível excluir uma operação externa Cobrada ou Liquidada — cancele a operação antes de excluí-la',
                errorCode: 'BadRequestException',
                data: { id: withdrawal.id },
              });
              continue;
            }

            // C3: only restore stock when the operation was actually delivered —
            // PENDING/CANCELLED operations never decremented stock.
            const wasDelivered =
              withdrawal.status !== EXTERNAL_OPERATION_STATUS.PENDING &&
              withdrawal.status !== EXTERNAL_OPERATION_STATUS.CANCELLED;

            if (wasDelivered && withdrawal.items && withdrawal.items.length > 0) {
              for (const withdrawalItem of withdrawal.items) {
                const item = await tx.item.findUnique({ where: { id: withdrawalItem.itemId } });
                if (item) {
                  // Restore only what is still out (already-returned units are back in stock)
                  const alreadyReturned = withdrawalItem.returnedQuantity || 0;
                  const quantityToRestore = withdrawalItem.withdrawedQuantity - alreadyReturned;

                  if (quantityToRestore > 0) {
                    const newQuantity = item.quantity + quantityToRestore;
                    await tx.item.update({
                      where: { id: withdrawalItem.itemId },
                      data: { quantity: newQuantity },
                    });

                    // Criar atividade para rastrear a restauração
                    await this.activityRepository.createWithTransaction(tx, {
                      itemId: withdrawalItem.itemId,
                      quantity: quantityToRestore,
                      operation: ACTIVITY_OPERATION.INBOUND,
                      reason: ACTIVITY_REASON.EXTERNAL_OPERATION,
                      userId: userId || null,
                    });

                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.ITEM,
                      entityId: withdrawalItem.itemId,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'quantity',
                      oldValue: item.quantity,
                      newValue: newQuantity,
                      reason: 'Estoque restaurado - Exclusão em lote de operação externa',
                      triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
                      triggeredById: withdrawal.id,
                      transaction: tx,
                      userId: userId || null,
                    });
                  }
                }
              }
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.EXTERNAL_OPERATION,
              entityId: withdrawal.id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: withdrawal,
              reason: 'Operação externa excluída em lote',
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              transaction: tx,
            });

            deletableIds.push(withdrawal.id);
          }

          const deleteResult =
            deletableIds.length > 0
              ? await this.externalOperationRepository.deleteManyWithTransaction(tx, deletableIds)
              : { success: [], failed: [], totalDeleted: 0, totalFailed: 0 };

          return { deleteResult, blocked };
        },
      );

      const totalFailed = deleteResult.totalFailed + blocked.length;
      const successMessage =
        deleteResult.totalDeleted === 1
          ? '1 operação externa excluída com sucesso'
          : `${deleteResult.totalDeleted} operações externas excluídas com sucesso`;
      const failureMessage = totalFailed > 0 ? `, ${totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: deleteResult.success,
        failed: [
          ...blocked,
          ...deleteResult.failed.map((error: any, index: number) => ({
            index: error.index || index,
            id: error.id,
            error: error.error,
            errorCode: error.errorCode,
            data: error.data,
          })),
        ],
        totalProcessed: deleteResult.totalDeleted + totalFailed,
        totalSuccess: deleteResult.totalDeleted,
        totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir operações externas em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Emit external_operation.returned when a withdrawal is fully returned.
   * Best-effort: never breaks the business flow.
   */
  private async emitExternalOperationReturned(
    withdrawal: { id: string; withdrawerName?: string | null } | null | undefined,
    userId?: string,
  ): Promise<void> {
    try {
      if (!withdrawal) {
        return;
      }
      const deepLink = this.buildExternalOperationDeepLink(withdrawal.id);
      const withdrawerName = withdrawal.withdrawerName || 'Retirante';
      await this.dispatchService.dispatchByConfiguration(
        'external_operation.returned',
        userId || 'system',
        {
          entityType: 'ExternalOperation',
          entityId: withdrawal.id,
          action: 'returned',
          data: {
            withdrawerName,
          },
          overrides: {
            title: 'Operação Externa Devolvida',
            body: `A operação externa de ${withdrawerName} foi totalmente devolvida.`,
            webUrl: deepLink,
            mobileUrl: deepLink,
            relatedEntityType: 'EXTERNAL_OPERATION',
          },
        },
      );
    } catch (error) {
      this.logger.error('Erro ao emitir notificação de operação externa devolvida:', error);
    }
  }

  /**
   * Emit billing-status notifications when an external operation transitions
   * INTO CHARGED, LIQUIDATED or CANCELLED. Sector-routed via the config row's
   * allowedSectors. Best-effort: never breaks the business flow.
   *
   * Config keys:
   * - external_operation.charged
   * - external_operation.liquidated
   * - external_operation.cancelled
   */
  private async emitExternalOperationStatusChanged(
    id: string,
    newStatus: EXTERNAL_OPERATION_STATUS,
    userId?: string,
  ): Promise<void> {
    try {
      const configKeyByStatus: Partial<Record<EXTERNAL_OPERATION_STATUS, string>> = {
        [EXTERNAL_OPERATION_STATUS.CHARGED]: 'external_operation.charged',
        [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: 'external_operation.liquidated',
        [EXTERNAL_OPERATION_STATUS.CANCELLED]: 'external_operation.cancelled',
      };
      const actionByStatus: Partial<Record<EXTERNAL_OPERATION_STATUS, string>> = {
        [EXTERNAL_OPERATION_STATUS.CHARGED]: 'charged',
        [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: 'liquidated',
        [EXTERNAL_OPERATION_STATUS.CANCELLED]: 'cancelled',
      };
      const configKey = configKeyByStatus[newStatus];
      if (!configKey) {
        return;
      }

      // Re-read post-commit so customer/items/services reflect the committed state.
      const operation = await this.prisma.externalOperation.findUnique({
        where: { id },
        include: {
          customer: { select: { fantasyName: true, corporateName: true } },
          items: { select: { price: true, withdrawedQuantity: true } },
          services: { select: { amount: true } },
        },
      });
      if (!operation) {
        return;
      }

      const deepLink = this.buildExternalOperationDeepLink(id);
      const withdrawerName = operation.withdrawerName || 'Retirante';
      const customerName =
        operation.customer?.fantasyName || operation.customer?.corporateName || null;
      // Same total formula as the billing preflight: priced items + service amounts.
      const totalAmount =
        operation.items.reduce(
          (sum, item) => sum + Number(item.price ?? 0) * item.withdrawedQuantity,
          0,
        ) + operation.services.reduce((sum, service) => sum + Number(service.amount ?? 0), 0);
      const amountText =
        totalAmount > 0
          ? ` no valor de ${totalAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
          : '';
      const customerText = customerName ? ` (cliente: ${customerName})` : '';

      const overridesByStatus: Partial<
        Record<EXTERNAL_OPERATION_STATUS, { title: string; body: string }>
      > = {
        [EXTERNAL_OPERATION_STATUS.CHARGED]: {
          title: 'Operação externa cobrada',
          body: `A operação externa de ${withdrawerName}${customerText} foi cobrada${amountText}.`,
        },
        [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: {
          title: 'Operação externa liquidada',
          body: `Operação externa de ${withdrawerName}${customerText} liquidada — pagamento quitado.`,
        },
        [EXTERNAL_OPERATION_STATUS.CANCELLED]: {
          title: 'Operação externa cancelada',
          body: `A operação externa de ${withdrawerName}${customerText} foi cancelada.`,
        },
      };
      const { title, body } = overridesByStatus[newStatus]!;

      await this.dispatchService.dispatchByConfiguration(configKey, userId || 'system', {
        entityType: 'ExternalOperation',
        entityId: id,
        action: actionByStatus[newStatus]!,
        data: {
          withdrawerName,
          customerName: customerName ?? '',
          totalAmount: totalAmount > 0 ? totalAmount.toFixed(2) : '',
          statusLabel: this.getStatusLabel(newStatus),
        },
        overrides: {
          title,
          body,
          webUrl: deepLink,
          mobileUrl: deepLink,
          relatedEntityType: 'EXTERNAL_OPERATION',
        },
      });
    } catch (error) {
      this.logger.error(
        `Erro ao emitir notificação de status (${newStatus}) da operação externa ${id}:`,
        error,
      );
    }
  }

  /**
   * Get status label in Portuguese
   */
  private getStatusLabel(status: EXTERNAL_OPERATION_STATUS): string {
    const labels: Record<EXTERNAL_OPERATION_STATUS, string> = {
      [EXTERNAL_OPERATION_STATUS.PENDING]: 'Pendente',
      [EXTERNAL_OPERATION_STATUS.PARTIALLY_RETURNED]: 'Parcialmente Devolvido',
      [EXTERNAL_OPERATION_STATUS.FULLY_RETURNED]: 'Totalmente Devolvido',
      [EXTERNAL_OPERATION_STATUS.CHARGED]: 'Cobrado',
      [EXTERNAL_OPERATION_STATUS.CANCELLED]: 'Cancelado',
      [EXTERNAL_OPERATION_STATUS.LIQUIDATED]: 'Liquidado',
      [EXTERNAL_OPERATION_STATUS.DELIVERED]: 'Entregue',
    };
    return labels[status] || status;
  }
}
