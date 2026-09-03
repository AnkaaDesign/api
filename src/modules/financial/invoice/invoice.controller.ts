import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
  Logger,
  NotFoundException,
  BadRequestException,
  UsePipes,
} from '@nestjs/common';
import { Response } from 'express';
import { syncEmNegociacaoForTask } from '../../../utils/em-negociacao-sync';
import { InvoiceService } from './invoice.service';
import { InvoiceGenerationService } from './invoice-generation.service';
import { InvoiceAnalyticsService } from './invoice-analytics.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { FilesStorageService } from '@modules/common/file/services/files-storage.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { SicrediBoletoScheduler } from '@modules/integrations/sicredi/sicredi-boleto.scheduler';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import { TaskQuoteStatusCascadeService } from '@modules/production/task-quote/task-quote-status-cascade.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants/enums';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import {
  SECTOR_PRIVILEGES,
  BANK_SLIP_STATUS,
  INSTALLMENT_STATUS,
  INSTALLMENT_PAYMENT_METHOD,
  TASK_QUOTE_STATUS,
  TASK_QUOTE_STATUS_ORDER,
} from '@constants';
import type { InvoiceGetManyFormData } from '@types';
import { formatDueDateYMD, parseDueDateYMD, todayInSaoPauloAtNoonUtc } from '@utils/due-date.util';

/**
 * Controller for Invoice endpoints.
 * Handles invoice listing, detail views, cancellation,
 * boleto management, and NFS-e operations.
 */
@Controller('invoices')
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly invoiceGenerationService: InvoiceGenerationService,
    private readonly invoiceAnalyticsService: InvoiceAnalyticsService,
    private readonly prisma: PrismaService,
    private readonly sicrediService: SicrediService,
    private readonly sicrediBoletoScheduler: SicrediBoletoScheduler,
    private readonly municipalNfseService: ElotechOxyNfseService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
    private readonly dispatchService: NotificationDispatchService,
    private readonly filesStorageService: FilesStorageService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Emit task_quote.settled when a manual payment / due-date change settles the
   * whole quote. Best-effort — never breaks the request flow. The billing detail
   * deep link is keyed by taskId (/financeiro/orcamento/detalhes/:taskId).
   */
  private async dispatchTaskQuoteSettled(quoteId: string, taskId: string | null): Promise<void> {
    try {
      let label = quoteId.slice(-8).toUpperCase();
      if (taskId) {
        const task = await this.prisma.task.findUnique({
          where: { id: taskId },
          select: { name: true, serialNumber: true },
        });
        if (task?.serialNumber) {
          label = task.name ? `#${task.serialNumber} (${task.name})` : `#${task.serialNumber}`;
        } else if (task?.name) {
          label = task.name;
        }
      }
      await this.dispatchService.dispatchByConfiguration('task_quote.settled', 'system', {
        entityType: 'TaskQuote',
        entityId: taskId ?? quoteId,
        action: 'settled',
        data: { quoteLabel: label },
        overrides: {
          title: 'Pagamento Liquidado',
          body: `O orçamento ${label} foi totalmente liquidado. Todas as parcelas estão pagas.`,
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
      this.logger.error('Falha ao notificar liquidação de orçamento (task_quote.settled):', error);
    }
  }

  /**
   * Dispatch bank_slip.paid for a manually-paid installment. Mirrors the same key
   * + payload + deep link used by the Sicredi webhook/reconciliation paths.
   * Best-effort — never breaks the request flow.
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
          externalOperation: { select: { id: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const withdrawalId = invoice.externalOperation?.id ?? invoice.externalOperationId ?? null;
      const taskName = withdrawalId ? 'Operação Externa' : invoice.task?.name || 'N/A';
      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(paidAmount));
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(dueDate);

      const webUrl = withdrawalId
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : `/financeiro/faturamento/detalhes/${invoice.taskId}`;
      const mobileUrl = withdrawalId
        ? `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : `financial/${invoice.taskId}`;
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
          externalOperationId: withdrawalId || undefined,
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
   * Dispatch bank_slip.cancelled when a boleto is manually cancelled.
   * Best-effort — never breaks the request flow. Deep link keyed by taskId.
   */
  private async dispatchBankSlipCancelledNotification(
    invoiceId: string | null,
    nossoNumero: string | null,
  ): Promise<void> {
    try {
      let taskId: string | null = null;
      let withdrawalId: string | null = null;
      let customerName = 'N/A';
      let taskName = 'N/A';
      if (invoiceId) {
        const invoice = await this.prisma.invoice.findUnique({
          where: { id: invoiceId },
          include: {
            customer: { select: { fantasyName: true } },
            task: { select: { id: true, name: true } },
            externalOperation: { select: { id: true } },
          },
        });
        taskId = invoice?.task?.id ?? invoice?.taskId ?? null;
        withdrawalId = invoice?.externalOperation?.id ?? invoice?.externalOperationId ?? null;
        customerName = invoice?.customer?.fantasyName || 'N/A';
        taskName = withdrawalId ? 'Operação Externa' : invoice?.task?.name || 'N/A';
      }

      const refLabel = withdrawalId ? 'da operação externa' : `da tarefa ${taskName}`;
      const webUrl = withdrawalId
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : taskId
          ? `/financeiro/faturamento/detalhes/${taskId}`
          : undefined;
      const mobileUrl = !withdrawalId && taskId ? `financial/${taskId}` : undefined;

      await this.dispatchService.dispatchByConfiguration('bank_slip.cancelled', 'system', {
        entityType: 'BankSlip',
        entityId: taskId ?? withdrawalId ?? invoiceId ?? (nossoNumero || 'unknown'),
        action: 'cancelled',
        data: {
          customerName,
          taskName,
          nossoNumero: nossoNumero || 'N/A',
          invoiceId: invoiceId || undefined,
          taskId: taskId || undefined,
          externalOperationId: withdrawalId || undefined,
        },
        overrides: {
          title: 'Boleto Cancelado',
          body: `O boleto ${nossoNumero ? nossoNumero + ' ' : ''}${refLabel} (${customerName}) foi cancelado.`,
          relatedEntityType: 'BANK_SLIP',
          ...(webUrl ? { webUrl } : {}),
          ...(mobileUrl ? { mobileUrl } : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar cancelamento de boleto (bank_slip.cancelled):', error);
    }
  }

  // ─── Invoice CRUD ──────────────────────────────────────────────

  /**
   * GET /invoices
   * List invoices with filters (taskId, customerId, status) and pagination.
   */
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findMany(@Query() query: InvoiceGetManyFormData) {
    return this.invoiceService.findMany(query);
  }

  /**
   * GET /invoices/:id
   * Get a single invoice with installments, bank slips, and NFS-e.
   */
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceService.findById(id, {
      installments: { include: { bankSlip: { include: { pdfFile: true } } } },
      nfseDocuments: true,
      customer: true,
      task: true,
      createdBy: true,
    });
  }

  /**
   * GET /invoices/task/:taskId
   * Get all invoices for a specific task.
   */
  @Get('task/:taskId')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findByTaskId(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.invoiceService.findByTaskId(taskId);
  }

  /**
   * GET /invoices/customer/:customerId
   * Get all invoices for a specific customer.
   */
  @Get('customer/:customerId')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findByCustomerId(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.invoiceService.findByCustomerId(customerId);
  }

  // ─── Invoice Actions ───────────────────────────────────────────

  /**
   * PUT /invoices/:id/cancel
   * Cancel an invoice and all its children (installments, bank slips, NFS-e).
   * Also baixa any active/overdue/registering bank slips at Sicredi and cancels
   * any AUTHORIZED NFS-e at Elotech OXY before/after updating local state.
   */
  @Put(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async cancelInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() body: { reason?: string }) {
    // Collect bank slips that are live at Sicredi BEFORE we touch the DB.
    const eligibleStatuses = [
      BANK_SLIP_STATUS.ACTIVE,
      BANK_SLIP_STATUS.OVERDUE,
      BANK_SLIP_STATUS.REGISTERING,
    ];
    const installments = await this.prisma.installment.findMany({
      where: { invoiceId: id },
      select: { bankSlip: { select: { nossoNumero: true, status: true } } },
    });
    const nossoNumerosToCancel = installments
      .map(i => i.bankSlip)
      .filter(
        slip =>
          slip !== null &&
          slip.nossoNumero !== null &&
          !slip.nossoNumero.startsWith('TMP-') &&
          eligibleStatuses.includes(slip.status as any),
      )
      .map(slip => slip!.nossoNumero as string);

    // Collect AUTHORIZED NFS-e docs BEFORE cancelling — service leaves them AUTHORIZED in DB
    // (excluded from the updateMany) so they can be properly cancelled at Elotech here.
    const authorizedNfseDocs = await this.prisma.nfseDocument.findMany({
      where: { invoiceId: id, status: 'AUTHORIZED' },
      select: { id: true, nfseNumber: true },
    });

    // Cancel invoice and all children in the DB (source of truth)
    const result = await this.invoiceService.cancelInvoice(id, body.reason);

    // Best-effort baixa at Sicredi — errors are warned, never thrown
    if (nossoNumerosToCancel.length > 0) {
      const outcomes = await Promise.allSettled(
        nossoNumerosToCancel.map(nn => this.sicrediService.cancelBoleto(nn)),
      );
      outcomes.forEach((outcome, idx) => {
        if (outcome.status === 'rejected') {
          this.logger.warn(
            `[CANCEL_INVOICE] Failed to baixar boleto at Sicredi (nossoNumero=${nossoNumerosToCancel[idx]}): ${outcome.reason}`,
          );
        } else {
          this.logger.log(
            `[CANCEL_INVOICE] Baixado boleto at Sicredi (nossoNumero=${nossoNumerosToCancel[idx]})`,
          );
        }
      });
    }

    // Best-effort NFS-e cancellation at Elotech OXY — errors are warned, never thrown
    if (authorizedNfseDocs.length > 0) {
      const cancelReason = body.reason || 'Nota fiscal cancelada junto com a fatura.';
      const nfseOutcomes = await Promise.allSettled(
        authorizedNfseDocs.map(nfse =>
          this.municipalNfseService.cancelNfse(nfse.id, cancelReason, 1),
        ),
      );
      nfseOutcomes.forEach((outcome, idx) => {
        const numero = authorizedNfseDocs[idx].nfseNumber;
        if (outcome.status === 'rejected') {
          this.logger.warn(
            `[CANCEL_INVOICE] Failed to request NFS-e cancellation at Elotech (nfseNumber=${numero}): ${outcome.reason}`,
          );
        } else if (outcome.value?.cancelled) {
          this.logger.log(`[CANCEL_INVOICE] Cancelled NFS-e at Elotech (nfseNumber=${numero})`);
        } else if (outcome.value?.pending) {
          this.logger.warn(
            `[CANCEL_INVOICE] NFS-e ${numero} cancellation PENDING fiscal approval — still active at prefeitura. Reconciler will track it.`,
          );
        } else if (outcome.value?.rejected) {
          this.logger.warn(
            `[CANCEL_INVOICE] NFS-e ${numero} cancellation REJECTED: ${outcome.value.rejectionMessage}. Needs correction/resubmit.`,
          );
        }
      });
    }

    return result;
  }

  // ─── Boleto (Bank Slip) Endpoints ──────────────────────────────

  /**
   * POST /invoices/:installmentId/boleto/regenerate
   * Re-create a failed or errored boleto for an installment.
   */
  @Post(':installmentId/boleto/regenerate')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async regenerateBoleto(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() body: { newDueDate?: string },
  ) {
    const installmentWithBankSlip = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { bankSlip: true, invoice: true },
    });

    if (!installmentWithBankSlip) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }

    if (
      installmentWithBankSlip.status === INSTALLMENT_STATUS.PAID ||
      installmentWithBankSlip.status === INSTALLMENT_STATUS.CANCELLED
    ) {
      throw new BadRequestException('Não é possível gerar boleto para parcela paga ou cancelada.');
    }

    const bankSlip = installmentWithBankSlip.bankSlip;

    // CREATING is included deliberately: it means the slip was never registered at
    // Sicredi (it still carries a `TMP-` nossoNumero), usually because the inline
    // registration died mid-flight on a deploy or crash. Excluding it left the operator
    // with a parcela showing "Criando" forever and no button that would move it.
    // ACTIVE/OVERDUE/PAID stay excluded — those have a real boleto in the customer's
    // hands and must be cancelled, not silently replaced.
    if (
      bankSlip &&
      bankSlip.status !== BANK_SLIP_STATUS.ERROR &&
      bankSlip.status !== BANK_SLIP_STATUS.REJECTED &&
      bankSlip.status !== BANK_SLIP_STATUS.CANCELLED &&
      bankSlip.status !== BANK_SLIP_STATUS.CREATING
    ) {
      throw new BadRequestException(
        'Somente boletos com erro, rejeitados, cancelados ou ainda não registrados podem ser regenerados.',
      );
    }

    // Validate and resolve due date
    let resolvedDueDate = bankSlip?.dueDate ?? installmentWithBankSlip.dueDate;
    if (body?.newDueDate) {
      const newDate = parseDueDateYMD(body.newDueDate);
      // "Today" must be the São Paulo calendar day, not the server's — both sides are
      // noon-UTC calendar dates, so a date chosen for today always passes.
      const today = todayInSaoPauloAtNoonUtc();

      if (isNaN(newDate.getTime())) {
        throw new BadRequestException('Data de vencimento inválida.');
      }

      if (newDate < today) {
        throw new BadRequestException(
          'A nova data de vencimento deve ser igual ou posterior a hoje.',
        );
      }

      resolvedDueDate = newDate;
      await this.prisma.installment.update({
        where: { id: installmentId },
        data: { dueDate: newDate },
      });
    }

    if (bankSlip) {
      // Reset existing bank slip to CREATING so registerBankSlipsAtSicredi picks it up.
      await this.prisma.bankSlip.update({
        where: { id: bankSlip.id },
        data: {
          status: BANK_SLIP_STATUS.CREATING,
          nossoNumero: `TMP-${installmentId}`,
          barcode: null,
          digitableLine: null,
          pixQrCode: null,
          txid: null,
          pdfFileId: null,
          errorMessage: null,
          errorCount: 0,
          dueDate: resolvedDueDate,
        },
      });
    } else {
      // No bank slip record exists yet — create one now.
      await this.prisma.bankSlip.create({
        data: {
          installmentId,
          nossoNumero: `TMP-${installmentId}`,
          type: 'NORMAL',
          amount: Number(installmentWithBankSlip.amount),
          dueDate: resolvedDueDate,
          status: BANK_SLIP_STATUS.CREATING,
        },
      });
    }

    // Directly register at Sicredi instead of waiting for the scheduler
    const invoiceId = installmentWithBankSlip.invoiceId;
    if (invoiceId) {
      try {
        await this.invoiceGenerationService.registerBankSlipsAtSicredi([invoiceId]);
        this.logger.log(`[BOLETO] Regenerated boleto for installment ${installmentId}`);
      } catch (error) {
        this.logger.error(
          `[BOLETO] Failed to regenerate boleto for installment ${installmentId}: ${error}`,
        );
        // The bank slip is already in CREATING/ERROR state — scheduler will retry as fallback
      }
    }

    // If the regeneration also moved the due date, notify (mirrors bank_slip.due_date_changed).
    if (body?.newDueDate) {
      try {
        const oldDueDate = installmentWithBankSlip.dueDate
          ? new Date(installmentWithBankSlip.dueDate).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })
          : null;
        const newDueDateLabel = resolvedDueDate.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        });

        // Resolve the deep link — task-backed invoices link to the billing detail page
        // (keyed by taskId); withdrawal-backed invoices link to the withdrawal detail page.
        let taskIdForLink: string | null = null;
        let withdrawalIdForLink: string | null = null;
        if (invoiceId) {
          const invoiceForLink = await this.prisma.invoice.findUnique({
            where: { id: invoiceId },
            select: {
              externalOperationId: true,
              customerConfig: {
                select: {
                  quote: {
                    select: {
                      tasks: {
                        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                        select: { id: true },
                      },
                    },
                  },
                },
              },
            },
          });
          taskIdForLink = invoiceForLink?.customerConfig?.quote?.tasks?.[0]?.id ?? null;
          withdrawalIdForLink = invoiceForLink?.externalOperationId ?? null;
        }
        const webUrlForLink = withdrawalIdForLink
          ? `/estoque/operacoes-externas/detalhes/${withdrawalIdForLink}`
          : taskIdForLink
            ? `/financeiro/faturamento/detalhes/${taskIdForLink}`
            : undefined;
        // 'BankSlip' (BANKSLIP) auto-link requires data.taskId — which this
        // dispatch doesn't carry — so the deep link never fires. Supply both
        // url overrides explicitly (mobile mirrors the web destination).
        const mobileUrlForLink = withdrawalIdForLink
          ? `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalIdForLink}`
          : taskIdForLink
            ? `/(tabs)/financeiro/faturamento/detalhes/${taskIdForLink}`
            : undefined;

        const nossoNumeroLabel = bankSlip?.nossoNumero ?? 'novo boleto';

        await this.dispatchService.dispatchByConfiguration('bank_slip.due_date_changed', 'system', {
          entityType: 'BankSlip',
          entityId: taskIdForLink ?? withdrawalIdForLink ?? installmentId,
          action: 'due_date_changed',
          data: {
            nossoNumero: nossoNumeroLabel,
            oldDueDate,
            newDueDate: newDueDateLabel,
          },
          overrides: {
            title: 'Vencimento de Boleto Alterado',
            body: `A data de vencimento do boleto ${nossoNumeroLabel}${oldDueDate ? ` foi alterada de ${oldDueDate}` : ' foi alterada'} para ${newDueDateLabel}.`,
            relatedEntityType: 'BANK_SLIP',
            ...(webUrlForLink ? { webUrl: webUrlForLink } : {}),
            ...(mobileUrlForLink ? { mobileUrl: mobileUrlForLink } : {}),
          },
        });
      } catch (notifyErr) {
        this.logger.error(
          'Falha ao notificar alteração de vencimento na regeneração (bank_slip.due_date_changed):',
          notifyErr,
        );
      }
    }

    return { message: 'Boleto será recriado em instantes.' };
  }

  /**
   * PUT /invoices/:installmentId/boleto/cancel
   * Cancel an active boleto.
   */
  @Put(':installmentId/boleto/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async cancelBoleto(@Param('installmentId', ParseUUIDPipe) installmentId: string) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
    });

    if (!bankSlip) {
      throw new NotFoundException(`Boleto não encontrado para a parcela ${installmentId}.`);
    }

    if (bankSlip.status === BANK_SLIP_STATUS.PAID) {
      throw new BadRequestException('Não é possível cancelar um boleto já pago.');
    }

    if (bankSlip.status === BANK_SLIP_STATUS.CANCELLED) {
      throw new BadRequestException('Boleto já está cancelado.');
    }

    // Cancel boleto at Sicredi first (if it's active at the bank)
    if (
      bankSlip.nossoNumero &&
      (bankSlip.status === BANK_SLIP_STATUS.ACTIVE || bankSlip.status === BANK_SLIP_STATUS.OVERDUE)
    ) {
      try {
        await this.sicrediService.cancelBoleto(bankSlip.nossoNumero);
      } catch (error) {
        this.logger.warn(
          `Failed to cancel boleto at Sicredi (nossoNumero=${bankSlip.nossoNumero}): ${error}`,
        );
      }
    }

    // I30: cancelling a boleto voids the charge instrument. Cancel the slip AND the
    // installment together (atomically), then recompute the invoice and cascade. Without
    // cancelling the installment, a now-past-due PENDING/OVERDUE installment keeps counting
    // as overdue and the quote shows a spurious DUE even though the charge is gone. A PAID
    // installment is real financial history — never reverse it (the early guard above already
    // rejects cancelling a PAID boleto, but guard the installment write too).
    const installmentRow = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      select: { invoiceId: true, status: true },
    });

    await this.prisma.$transaction(async tx => {
      await tx.bankSlip.update({
        where: { id: bankSlip.id },
        data: { status: 'CANCELLED' },
      });

      if (installmentRow && installmentRow.status !== INSTALLMENT_STATUS.PAID) {
        await tx.installment.update({
          where: { id: installmentId },
          data: { status: INSTALLMENT_STATUS.CANCELLED },
        });
      }

      if (installmentRow?.invoiceId) {
        await this.invoiceService.recalcInvoicePaymentState(tx, installmentRow.invoiceId);
      }
    });

    // Reconverge the quote/withdrawal status now that this installment no longer counts.
    await this.sicrediBoletoScheduler.cascadeFromInstallment(installmentId);

    // Notify financial/admin/commercial that the boleto was manually cancelled.
    await this.dispatchBankSlipCancelledNotification(
      installmentRow?.invoiceId ?? null,
      bankSlip.nossoNumero,
    );

    return { message: 'Boleto cancelado com sucesso.' };
  }

  /**
   * PUT /invoices/:installmentId/boleto/sync-from-sicredi
   * Pull the current due date and seuNumero from Sicredi and update our records.
   * Use this after a due date or seuNumero was changed directly in Sicredi's portal
   * (e.g. after cancelling and regenerating an NF-e without regenerating the boleto).
   * The daily sync cron (9 AM SP) does this automatically, but this endpoint lets
   * you trigger it immediately for a single installment.
   */
  @Put(':installmentId/boleto/sync-from-sicredi')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async syncBoletoFromSicredi(@Param('installmentId', ParseUUIDPipe) installmentId: string) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      select: {
        id: true,
        nossoNumero: true,
        dueDate: true,
        seuNumero: true,
        status: true,
        installment: {
          select: {
            id: true,
            status: true,
            externalOperationId: true,
            customerConfig: { select: { quoteId: true } },
          },
        },
      },
    });

    if (!bankSlip) {
      throw new NotFoundException(`Boleto não encontrado para a parcela ${installmentId}.`);
    }

    if (
      bankSlip.status === BANK_SLIP_STATUS.PAID ||
      bankSlip.status === BANK_SLIP_STATUS.CANCELLED
    ) {
      throw new BadRequestException('Não é possível sincronizar um boleto já pago ou cancelado.');
    }

    if (
      !bankSlip.nossoNumero ||
      bankSlip.nossoNumero.startsWith('TMP-') ||
      bankSlip.nossoNumero.startsWith('ERR-')
    ) {
      throw new BadRequestException('Boleto ainda não foi registrado no Sicredi.');
    }

    const result = await this.sicrediBoletoScheduler.syncOneBankSlip(bankSlip);

    const messages: string[] = [];
    if (result.dueDateChanged && result.newDueDate) {
      const newDateLabel = result.newDueDate.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      });
      messages.push(`Data de vencimento atualizada para ${newDateLabel}`);
    }
    if (result.seuNumeroChanged) {
      messages.push('Seu Número atualizado');
    }
    if (messages.length === 0) {
      messages.push('Nenhuma alteração detectada — dados já estavam sincronizados');
    }

    return {
      message: messages.join('. ') + '.',
      dueDateChanged: result.dueDateChanged,
      seuNumeroChanged: result.seuNumeroChanged,
      ...(result.newDueDate ? { newDueDate: result.newDueDate.toISOString() } : {}),
    };
  }

  /**
   * Parse a client-supplied payment date for an installment settlement.
   *
   * `paidAt` is not cosmetic. Three subsystems key off it: reconciliation pulls
   * PAID parcelas whose paidAt falls within PAID_LINK_WINDOW_DAYS of a bank
   * credit's postedAt and then ranks candidates by distance from it
   * (receivable-match.service), invoice-analytics buckets cash-in / DSO /
   * avg-days-to-payment by it, and the nightly stale-paid sweep ages
   * paid-but-unreconciled items by it. Stamping `now` on a payment that landed
   * yesterday pushes the parcela a day away from its own bank line and can slide
   * it out of the match window entirely — which is exactly what this parameter
   * exists to fix.
   *
   * Rejected: unparseable input, and any date in the future (a forward-dated
   * settlement corrupts all three subsystems at once). NOT rejected: dates
   * before dueDate — paying early is legitimate, so there is no floor to check.
   */
  private parsePaidAt(raw: unknown): Date | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string' && !(raw instanceof Date)) {
      throw new BadRequestException('Data de pagamento inválida.');
    }
    const parsed = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Data de pagamento inválida.');
    }
    // Compare CALENDAR DAYS in BRT, not instants. paidAt is a date-granularity
    // concept and the web picker stamps 13:00 local on a date-only selection, so
    // an instant comparison against `now` would reject a payment marked today at
    // any time before 13:00 — the most ordinary case there is. Only a genuinely
    // later day is refused.
    if (this.brDateKey(parsed) > this.brDateKey(new Date())) {
      throw new BadRequestException('A data de pagamento não pode ser futura.');
    }
    return parsed;
  }

  /** Calendar day in BRT as a lexicographically sortable YYYY-MM-DD key. */
  private brDateKey(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  /** Payment date as DD/MM/AAAA in BRT — for audit trail text. */
  private formatPaidAtBR(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  /** True when two instants fall on different calendar days in BRT. */
  private isDifferentDayBR(a: Date, b: Date): boolean {
    return this.brDateKey(a) !== this.brDateKey(b);
  }

  /**
   * PUT /invoices/:installmentId/boleto/mark-paid
   * Cancel the boleto and mark the installment as paid via PIX/cash/other.
   */
  @Put(':installmentId/boleto/mark-paid')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async markBoletoAsPaid(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body()
    body: {
      paymentMethod: string;
      /** Date the money actually arrived. Defaults to now when omitted. */
      paidAt?: string | Date | null;
      receiptFileIds?: string[];
      observations?: string | null;
    },
    @UserId() userId?: string,
  ) {
    if (!body.paymentMethod) {
      throw new BadRequestException('Método de pagamento é obrigatório.');
    }
    // paymentMethod is now the InstallmentPaymentMethod enum — reject anything outside it
    // at the boundary so an invalid string can never reach the (enum-typed) column.
    const paymentMethod = body.paymentMethod as INSTALLMENT_PAYMENT_METHOD;
    if (!Object.values(INSTALLMENT_PAYMENT_METHOD).includes(paymentMethod)) {
      throw new BadRequestException(`Método de pagamento inválido: ${body.paymentMethod}.`);
    }
    if (body.receiptFileIds && !Array.isArray(body.receiptFileIds)) {
      throw new BadRequestException('receiptFileIds deve ser uma lista.');
    }

    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { bankSlip: true, invoice: true },
    });

    if (!installment) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }

    // Only an already-PAID installment is rejected. A CANCELLED installment may be
    // revived straight to PAID (e.g. the boleto was cancelled but the customer paid
    // by PIX/cash anyway) — the settlement writes below re-anchor it cleanly and
    // recalcInvoicePaymentState re-counts it (CANCELLED installments are excluded
    // from paidAmount, PAID ones are included).
    if (installment.status === INSTALLMENT_STATUS.PAID) {
      throw new BadRequestException(
        'Esta parcela já foi paga e não pode ser marcada como paga novamente.',
      );
    }

    // Cancel the bank slip at Sicredi if active
    if (
      installment.bankSlip &&
      installment.bankSlip.nossoNumero &&
      [BANK_SLIP_STATUS.ACTIVE, BANK_SLIP_STATUS.OVERDUE].includes(
        installment.bankSlip.status as any,
      )
    ) {
      try {
        await this.sicrediService.cancelBoleto(installment.bankSlip.nossoNumero);
      } catch (error) {
        this.logger.warn(
          `Failed to cancel boleto at Sicredi (nossoNumero=${installment.bankSlip.nossoNumero}): ${error}`,
        );
      }
    }

    // I29: wrap all three settlement writes (bank slip → CANCELLED, installment → PAID,
    // invoice recalc) in ONE $transaction so a crash mid-mark-paid can never leave the
    // installment PAID while the invoice/quote stays stale. The Sicredi HTTP cancel above
    // is intentionally OUTSIDE the transaction (network side-effect, best-effort).
    // The date the money arrived is NOT the date someone got around to typing the
    // baixa — a payment received yesterday and recorded today belongs to yesterday.
    // The Sicredi webhook path has always recorded the bank's real payment date
    // (`event.dataEvento`); this makes the manual path agree with it.
    const paidAt = this.parsePaidAt(body.paidAt) ?? new Date();
    const isBackdated = this.isDifferentDayBR(paidAt, new Date());
    await this.prisma.$transaction(async tx => {
      // Update bank slip to cancelled, store payment method in sicrediStatus for display
      if (installment.bankSlip && installment.bankSlip.status !== BANK_SLIP_STATUS.CANCELLED) {
        await tx.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: {
            status: BANK_SLIP_STATUS.CANCELLED,
            sicrediStatus: `PAID_${paymentMethod}`,
          },
        });
      }

      // Mark installment as paid
      await tx.installment.update({
        where: { id: installmentId },
        data: {
          status: INSTALLMENT_STATUS.PAID,
          paidAmount: installment.amount,
          paidAt,
          paymentMethod,
          observations: body.observations ?? undefined,
          ...(body.receiptFileIds && body.receiptFileIds.length > 0
            ? {
                receiptFiles: {
                  connect: body.receiptFileIds.map(id => ({ id })),
                },
              }
            : {}),
        },
      });

      // I29/I31: recompute invoice paidAmount + status via the single source of truth
      // (always writes paidAmount, Decimal-safe). No more hand-rolled derivation.
      if (installment.invoiceId) {
        await this.invoiceService.recalcInvoicePaymentState(tx, installment.invoiceId);
      }

      // Audit. This settlement asserts money arrived WITHOUT any bank line behind
      // it — no ReconciliationMatch is created here, because there is nothing yet
      // to point at. That is legitimate, but it must not be anonymous: 210
      // parcelas (R$1,78M) reached PAID through this endpoint with no recorded
      // actor and no ChangeLog row, so "who marked this paid, and why" was
      // unanswerable. The nightly stale-paid sweep now ages these; this row says
      // who created one.
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.INSTALLMENT,
        entityId: installmentId,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: installment.status,
        newValue: INSTALLMENT_STATUS.PAID,
        reason:
          `Baixa manual (${paymentMethod}) de R$ ${Number(installment.amount).toFixed(2)}` +
          ` recebida em ${this.formatPaidAtBR(paidAt)}` +
          (isBackdated ? ' (data retroativa informada na baixa)' : '') +
          (installment.bankSlip ? ' com cancelamento do boleto' : '') +
          '. Sem conciliação bancária no momento da baixa.',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId ?? null,
        userId: userId ?? null,
        transaction: tx,
        metadata: {
          paymentMethod,
          paidAt: paidAt.toISOString(),
          backdated: isBackdated,
          invoiceId: installment.invoiceId,
          bankSlipId: installment.bankSlip?.id ?? null,
          awaitingBankReconciliation: true,
        },
      });
    });

    if (installment.invoiceId) {
      // Notify that the boleto/installment was paid (manual PIX/cash/other path) —
      // mirrors the bank_slip.paid notification dispatched by the Sicredi webhook.
      await this.dispatchBankSlipPaidNotification(
        installment.invoiceId,
        installment.bankSlip?.id ?? installmentId,
        Number(installment.amount),
        installment.dueDate,
      );

      // I29: single source of truth for SETTLED / PARTIAL / DUE / UPCOMING (and external
      // operation LIQUIDATED) — replaces the hand-rolled per-path derivation. cascadeFromInstallment
      // resolves the correct anchor (invoice → quote, or external operation) and never throws.
      await this.sicrediBoletoScheduler.cascadeFromInstallment(installmentId);

      // Reconcile Em Negociação for the linked task (kept for symmetry with other paths).
      const invoiceForSync = await this.prisma.invoice.findUnique({
        where: { id: installment.invoiceId },
        select: { customerConfig: { select: { quoteId: true } } },
      });
      const syncQuoteId = invoiceForSync?.customerConfig?.quoteId;
      if (syncQuoteId) {
        const syncTask = await this.prisma.task.findFirst({
          where: { quoteId: syncQuoteId },
          select: { id: true },
        });
        if (syncTask) {
          await syncEmNegociacaoForTask(this.prisma, syncTask.id);
        }
      }
    }

    return { message: `Parcela marcada como paga via ${paymentMethod}.` };
  }

  /**
   * PUT /invoices/:installmentId/receipts
   * Edit the settlement record of an ALREADY-PAID installment: the receipt file
   * set (full desired list), the observations text, and the payment info itself
   * — `paymentMethod` (Forma) and `paidAt` (Pago em).
   *
   * The payment-info half exists because the baixa is typed by a human after the
   * fact: the parcela gets stamped with whatever was known at that moment, and
   * the correct date/method often surfaces later (the OFX arrives, the customer
   * says which account they used). Without this, a wrong `paidAt` was permanent
   * — and a wrong `paidAt` silently misfiles the parcela in reconciliation,
   * analytics and the stale-paid sweep. See parsePaidAt.
   *
   * Money is deliberately NOT editable here: amount/paidAmount/status stay put,
   * so nothing this endpoint writes can change what the invoice is owed. That
   * also means no recalcInvoicePaymentState is needed — neither paidAt nor
   * paymentMethod feeds it.
   */
  @Put(':installmentId/receipts')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async updateInstallmentReceipts(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body()
    body: {
      receiptFileIds?: string[];
      observations?: string | null;
      paymentMethod?: string | null;
      paidAt?: string | Date | null;
    },
    @UserId() userId?: string,
  ) {
    if (
      body.receiptFileIds === undefined &&
      body.observations === undefined &&
      body.paymentMethod === undefined &&
      body.paidAt === undefined
    ) {
      throw new BadRequestException(
        'Informe receiptFileIds, observations, paymentMethod e/ou paidAt para atualizar.',
      );
    }
    if (body.receiptFileIds !== undefined && !Array.isArray(body.receiptFileIds)) {
      throw new BadRequestException('receiptFileIds deve ser uma lista.');
    }

    // Same enum guard as the mark-paid boundary, so an invalid string can never
    // reach the (enum-typed) column through the edit path either.
    let paymentMethod: INSTALLMENT_PAYMENT_METHOD | undefined;
    if (body.paymentMethod !== undefined && body.paymentMethod !== null) {
      paymentMethod = body.paymentMethod as INSTALLMENT_PAYMENT_METHOD;
      if (!Object.values(INSTALLMENT_PAYMENT_METHOD).includes(paymentMethod)) {
        throw new BadRequestException(`Método de pagamento inválido: ${body.paymentMethod}.`);
      }
    }
    const paidAt = this.parsePaidAt(body.paidAt);

    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { bankSlip: true },
    });

    if (!installment) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }

    if (installment.status !== INSTALLMENT_STATUS.PAID) {
      throw new BadRequestException('Apenas parcelas pagas podem receber comprovante.');
    }

    const methodChanged =
      paymentMethod !== undefined && paymentMethod !== installment.paymentMethod;
    const paidAtChanged =
      paidAt !== undefined && paidAt.getTime() !== (installment.paidAt?.getTime() ?? NaN);

    await this.prisma.$transaction(async tx => {
      await tx.installment.update({
        where: { id: installmentId },
        data: {
          ...(body.observations !== undefined ? { observations: body.observations } : {}),
          ...(paymentMethod !== undefined ? { paymentMethod } : {}),
          ...(paidAt !== undefined ? { paidAt } : {}),
          ...(body.receiptFileIds !== undefined
            ? {
                receiptFiles: {
                  set: body.receiptFileIds.map(id => ({ id })),
                },
              }
            : {}),
        },
      });

      // Keep the slip's display marker in step with the method. mark-paid writes
      // `PAID_<method>` here, and billing-step-review still falls back to it when
      // the installment has no paymentMethod of its own — leaving it stale would
      // make the two disagree about how the parcela was paid.
      if (
        methodChanged &&
        installment.bankSlip &&
        installment.bankSlip.sicrediStatus?.startsWith('PAID_')
      ) {
        await tx.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: { sicrediStatus: `PAID_${paymentMethod}` },
        });
      }

      // Audit each corrected field separately — the ChangeLog is field-level, and
      // "who moved this payment to another date" has to stay answerable.
      if (paidAtChanged) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.INSTALLMENT,
          entityId: installmentId,
          action: CHANGE_ACTION.UPDATE,
          field: 'paidAt',
          oldValue: installment.paidAt,
          newValue: paidAt,
          reason:
            `Data de pagamento corrigida de ` +
            `${installment.paidAt ? this.formatPaidAtBR(installment.paidAt) : 'não informada'}` +
            ` para ${this.formatPaidAtBR(paidAt!)}.`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId ?? null,
          userId: userId ?? null,
          transaction: tx,
          metadata: { invoiceId: installment.invoiceId },
        });
      }

      if (methodChanged) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.INSTALLMENT,
          entityId: installmentId,
          action: CHANGE_ACTION.UPDATE,
          field: 'paymentMethod',
          oldValue: installment.paymentMethod,
          newValue: paymentMethod,
          reason:
            `Forma de pagamento corrigida de ` +
            `${installment.paymentMethod ?? 'não informada'} para ${paymentMethod}.`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId ?? null,
          userId: userId ?? null,
          transaction: tx,
          metadata: { invoiceId: installment.invoiceId },
        });
      }
    });

    // Move any receipt files that landed in a generic folder to the correct customer path.
    if (body.receiptFileIds?.length) {
      const installmentForMove = await this.prisma.installment.findUnique({
        where: { id: installmentId },
        select: {
          customerConfig: {
            select: { customer: { select: { fantasyName: true } } },
          },
        },
      });
      const customerName = installmentForMove?.customerConfig?.customer?.fantasyName;
      if (customerName) {
        for (const fileId of body.receiptFileIds) {
          await this.filesStorageService.moveFileToCustomerContext(
            fileId,
            'installmentReceipts',
            customerName,
          );
        }
      }
    }

    return { message: 'Parcela atualizada com sucesso.' };
  }

  /**
   * PUT /invoices/:installmentId/receipt  (legacy alias — singular form from pre-May-2026 clients)
   * Accepts the old single-file body { receiptFileId } and delegates to the plural handler.
   */
  @Put(':installmentId/receipt')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async updateInstallmentReceiptLegacy(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body()
    body: {
      receiptFileId?: string;
      receiptFileIds?: string[];
      observations?: string | null;
      paymentMethod?: string | null;
      paidAt?: string | Date | null;
    },
    @UserId() userId?: string,
  ) {
    const ids = body.receiptFileIds ?? (body.receiptFileId ? [body.receiptFileId] : undefined);
    return this.updateInstallmentReceipts(
      installmentId,
      {
        receiptFileIds: ids,
        observations: body.observations,
        paymentMethod: body.paymentMethod,
        paidAt: body.paidAt,
      },
      userId,
    );
  }

  /**
   * GET /invoices/:installmentId/receipts/:fileId/download
   * Download a single receipt file attached to an installment.
   */
  @Get(':installmentId/receipts/:fileId/download')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async downloadReceipt(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() res: Response,
  ) {
    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { receiptFiles: { where: { id: fileId } } },
    });

    if (!installment) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }

    const file = installment.receiptFiles[0];
    if (!file) {
      throw new NotFoundException('Comprovante não encontrado nesta parcela.');
    }

    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(file.path)) {
      throw new NotFoundException('Arquivo do comprovante não encontrado no servidor.');
    }

    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
    res.sendFile(path.resolve(file.path));
  }

  /**
   * PATCH /invoices/:installmentId/boleto/due-date
   * Change the due date of an overdue boleto.
   * Creates a new boleto at Sicredi with the new due date by using the PATCH data-vencimento endpoint.
   */
  @Put(':installmentId/boleto/due-date')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async changeBankSlipDueDate(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() body: { newDueDate: string },
    @UserId() userId?: string,
  ) {
    if (!body.newDueDate) {
      throw new BadRequestException('Nova data de vencimento é obrigatória.');
    }

    const newDate = parseDueDateYMD(body.newDueDate);
    // "Today" must be the São Paulo calendar day, not the server's — both sides are
    // noon-UTC calendar dates, so a date chosen for today always passes.
    const today = todayInSaoPauloAtNoonUtc();

    if (isNaN(newDate.getTime())) {
      throw new BadRequestException('Data de vencimento inválida.');
    }

    if (newDate < today) {
      throw new BadRequestException(
        'A nova data de vencimento deve ser igual ou posterior a hoje.',
      );
    }

    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { installment: true },
    });

    if (!bankSlip) {
      // Config com generateBankSlip=false (ex.: acerto entre empresas fora do boleto/NFS-e)
      // nunca cria BankSlip, mas a parcela é um recebível real e precisa poder ser reagendada.
      return this.changeInstallmentDueDateWithoutBoleto(
        installmentId,
        newDate,
        formatDueDateYMD(newDate),
      );
    }

    if (
      bankSlip.status !== BANK_SLIP_STATUS.OVERDUE &&
      bankSlip.status !== BANK_SLIP_STATUS.ACTIVE
    ) {
      throw new BadRequestException(
        'Somente boletos ativos ou vencidos podem ter a data de vencimento alterada.',
      );
    }

    if (!bankSlip.nossoNumero || bankSlip.nossoNumero.startsWith('TMP-')) {
      throw new BadRequestException('Boleto ainda não foi registrado no Sicredi.');
    }

    const formattedDate = formatDueDateYMD(newDate);

    try {
      await this.sicrediService.changeDueDate(bankSlip.nossoNumero, formattedDate);

      // Update local records
      await this.prisma.bankSlip.update({
        where: { id: bankSlip.id },
        data: {
          dueDate: newDate,
          status: 'ACTIVE',
          lastSyncAt: new Date(),
        },
      });

      await this.prisma.installment.update({
        where: { id: installmentId },
        data: {
          dueDate: newDate,
          status: 'PENDING',
        },
      });

      // Cascade TaskQuote status — due-date change can turn a DUE quote into UPCOMING
      const invoiceLink = await this.prisma.installment.findUnique({
        where: { id: installmentId },
        select: { invoiceId: true },
      });
      // Re-derive the quote status from the corrected dates. This delegates to the
      // shared cascade instead of recomputing inline: the copy that lived here compared
      // raw instants (so a parcela due TODAY read as overdue and pushed the quote to
      // "Vencido" on its own due date) and omitted BILLING_APPROVED from the statuses it
      // would act on. One implementation, one set of rules.
      if (invoiceLink?.invoiceId) {
        await this.cascadeService.cascadeFromInvoice(invoiceLink.invoiceId);
      }

      this.logger.log(
        `[BOLETO] Due date changed for installment ${installmentId}: nossoNumero=${bankSlip.nossoNumero}, newDate=${formattedDate}`,
      );

      // Notify financial/admin/commercial that the boleto due date changed.
      try {
        const oldDueDate = bankSlip.installment?.dueDate
          ? new Date(bankSlip.installment.dueDate).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })
          : null;
        const newDueDateLabel = newDate.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        });

        // Resolve the deep link — the billing detail route is keyed by taskId
        // (/financeiro/faturamento/detalhes/:taskId); withdrawal-backed invoices
        // link to the "Operação Externa" detail page instead.
        let taskIdForLink: string | null = null;
        let withdrawalIdForLink: string | null = null;
        if (invoiceLink?.invoiceId) {
          const invoiceForLink = await this.prisma.invoice.findUnique({
            where: { id: invoiceLink.invoiceId },
            select: {
              externalOperationId: true,
              customerConfig: {
                select: {
                  quote: {
                    select: {
                      tasks: {
                        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                        select: { id: true },
                      },
                    },
                  },
                },
              },
            },
          });
          taskIdForLink = invoiceForLink?.customerConfig?.quote?.tasks?.[0]?.id ?? null;
          withdrawalIdForLink = invoiceForLink?.externalOperationId ?? null;
        }
        const webUrlForLink = withdrawalIdForLink
          ? `/estoque/operacoes-externas/detalhes/${withdrawalIdForLink}`
          : taskIdForLink
            ? `/financeiro/faturamento/detalhes/${taskIdForLink}`
            : undefined;
        // 'BankSlip' (BANKSLIP) auto-link requires data.taskId — which this
        // dispatch doesn't carry — so the deep link never fires. Supply both
        // url overrides explicitly (mobile mirrors the web destination).
        const mobileUrlForLink = withdrawalIdForLink
          ? `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalIdForLink}`
          : taskIdForLink
            ? `/(tabs)/financeiro/faturamento/detalhes/${taskIdForLink}`
            : undefined;

        await this.dispatchService.dispatchByConfiguration(
          'bank_slip.due_date_changed',
          userId ?? 'system',
          {
            entityType: 'BankSlip',
            entityId: taskIdForLink ?? withdrawalIdForLink ?? bankSlip.id,
            action: 'due_date_changed',
            data: {
              nossoNumero: bankSlip.nossoNumero,
              oldDueDate,
              newDueDate: newDueDateLabel,
            },
            overrides: {
              title: 'Vencimento de Boleto Alterado',
              body: `A data de vencimento do boleto ${bankSlip.nossoNumero}${oldDueDate ? ` foi alterada de ${oldDueDate}` : ' foi alterada'} para ${newDueDateLabel}.`,
              relatedEntityType: 'BANK_SLIP',
              ...(webUrlForLink ? { webUrl: webUrlForLink } : {}),
              ...(mobileUrlForLink ? { mobileUrl: mobileUrlForLink } : {}),
            },
          },
        );
      } catch (notifyErr) {
        this.logger.error(
          'Falha ao notificar alteração de vencimento (bank_slip.due_date_changed):',
          notifyErr,
        );
      }

      return {
        message: 'Data de vencimento alterada com sucesso.',
        newDueDate: formattedDate,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[BOLETO] Failed to change due date for installment ${installmentId}: ${errMsg}`,
      );

      // For OVERDUE boletos, Sicredi often refuses date changes after the expiration window.
      // Fallback: cancel the boleto locally (best-effort baixa at Sicredi) so the user can
      // regenerate it with the desired due date instead of being stuck.
      if (bankSlip.status === BANK_SLIP_STATUS.OVERDUE) {
        if (bankSlip.nossoNumero && !bankSlip.nossoNumero.startsWith('TMP-')) {
          try {
            await this.sicrediService.cancelBoleto(bankSlip.nossoNumero);
          } catch (cancelErr) {
            this.logger.warn(
              `[BOLETO] Fallback baixa failed for overdue boleto ${bankSlip.nossoNumero}: ${cancelErr}`,
            );
          }
        }
        await this.prisma.bankSlip.update({
          where: { id: bankSlip.id },
          data: { status: 'CANCELLED' },
        });
        return {
          message:
            'O Sicredi não permite alterar a data de boletos muito vencidos. O boleto foi cancelado — use "Regenerar Boleto" para criar um novo com a data desejada.',
          fallback: 'CANCELLED',
        };
      }

      throw new BadRequestException(
        `Falha ao alterar data de vencimento no Sicredi. O boleto pode estar em um estado que não permite alteração (já baixado ou liquidado). Detalhes: ${errMsg}`,
      );
    }
  }

  /**
   * Altera o vencimento de uma parcela que nunca teve BankSlip (config com
   * generateBankSlip=false — acerto entre empresas fora do boleto/NFS-e). Sem Sicredi
   * envolvido: só move a data e deixa a cascata de status recalcular a partir dela.
   */
  private async changeInstallmentDueDateWithoutBoleto(
    installmentId: string,
    newDate: Date,
    formattedDate: string,
  ): Promise<{ message: string; newDueDate: string }> {
    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
    });
    if (!installment) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }
    if (
      installment.status === INSTALLMENT_STATUS.PAID ||
      installment.status === INSTALLMENT_STATUS.CANCELLED
    ) {
      throw new BadRequestException(
        'Não é possível alterar o vencimento de uma parcela paga ou cancelada.',
      );
    }

    await this.prisma.installment.update({
      where: { id: installmentId },
      data: { dueDate: newDate, status: INSTALLMENT_STATUS.PENDING },
    });

    // Mesma cascata que o caminho com boleto usa — recalcula o status do orçamento
    // a partir da nova data, tirando-o de "Vencido" quando ela está no futuro.
    await this.cascadeService.cascadeFromInstallment(installmentId);

    this.logger.log(
      `[INSTALLMENT] Due date changed (sem boleto) for installment ${installmentId}: newDate=${formattedDate}`,
    );

    return {
      message: 'Data de vencimento alterada com sucesso.',
      newDueDate: formattedDate,
    };
  }

  /**
   * GET /invoices/:installmentId/boleto/pdf
   * Download the boleto PDF for an installment.
   * If no local PDF exists, fetches directly from Sicredi using linhaDigitavel.
   */
  @Get(':installmentId/boleto/pdf')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async downloadBoletoPdf(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Res() res: Response,
  ) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { pdfFile: true },
    });

    if (!bankSlip) {
      throw new NotFoundException(`Boleto não encontrado para a parcela ${installmentId}.`);
    }

    // If we have a local PDF file, serve it
    if (bankSlip.pdfFile) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`);
      return res.sendFile(bankSlip.pdfFile.path);
    }

    // If boleto is paid/cancelled, Sicredi no longer serves the PDF
    if (bankSlip.status === 'PAID') {
      throw new NotFoundException(
        'Este boleto já foi pago. O PDF não está mais disponível no Sicredi.',
      );
    }

    if (bankSlip.status === 'CANCELLED') {
      throw new NotFoundException('Este boleto foi cancelado. O PDF não está mais disponível.');
    }

    // Otherwise, fetch from Sicredi on-the-fly using linhaDigitavel
    if (!bankSlip.digitableLine) {
      throw new NotFoundException(
        'PDF do boleto ainda não está disponível (linha digitável não encontrada).',
      );
    }

    try {
      const pdfBuffer = await this.sicrediService.downloadBoletoPdf(bankSlip.digitableLine);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`);
      return res.send(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Failed to fetch boleto PDF from Sicredi for installment ${installmentId}: ${error}`,
      );

      // Sicredi returns 404 for paid/processed boletos
      if ((bankSlip.status as string) === 'PAID' || error?.response?.status === 404) {
        throw new NotFoundException(
          'Este boleto já foi pago ou processado. O PDF não está mais disponível no Sicredi.',
        );
      }

      throw new NotFoundException('Não foi possível obter o PDF do boleto junto ao Sicredi.');
    }
  }

  // ─── NFS-e Endpoints ──────────────────────────────────────────

  /**
   * POST /invoices/:invoiceId/nfse/reconcile
   *
   * Unstick an NFS-e stranded in PROCESSING (or parked in ERROR) by reconciling it against
   * the prefeitura's live state.
   *
   * "Emitir" cannot rescue this state on purpose: `emitNfse` refuses a PROCESSING document
   * so it never double-emits, which leaves the invoice with no exit when the process died
   * mid-POST. This endpoint reads the live state instead — it links a note that already
   * exists, or rewinds the document to PENDING when nothing was minted, and refuses to
   * guess when two live notes tie. It never emits.
   */
  @Post(':invoiceId/nfse/reconcile')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
  async reconcileNfse(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    const doc = await this.prisma.nfseDocument.findFirst({
      where: { invoiceId, status: { notIn: ['CANCELLED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!doc) {
      throw new NotFoundException('Nenhum documento de NFS-e encontrado para esta fatura.');
    }

    const result = await this.municipalNfseService.reconcileStuckDocument(doc.id);

    this.logger.log(
      `[NFSE_RECONCILE] Invoice ${invoiceId} doc ${doc.id}: ${result.outcome} — ${result.message}`,
    );

    return {
      success: result.outcome !== 'AMBIGUOUS',
      message: result.message,
      data: result,
    };
  }

  /**
   * POST /invoices/:invoiceId/boletos/register
   *
   * Register this invoice's still-unregistered bank slips at Sicredi, now.
   *
   * Registration normally runs inline right after billing approval. If that call dies
   * mid-flight (deploy, restart, crash) the BankSlip is left at CREATING with a `TMP-`
   * nossoNumero — and `boleto/regenerate` rejects CREATING, so the operator had no way to
   * re-drive it. The scheduled sweep does pick CREATING up, but only within 5 days of the
   * due date, so a parcela due further out sat unregistered and invisible until then.
   */
  @Post(':invoiceId/boletos/register')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async registerInvoiceBoletos(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    const pending = await this.prisma.installment.findMany({
      where: {
        invoiceId,
        status: { in: [INSTALLMENT_STATUS.PENDING, INSTALLMENT_STATUS.OVERDUE] },
        bankSlip: { is: { status: { in: [BANK_SLIP_STATUS.CREATING, BANK_SLIP_STATUS.ERROR] } } },
      },
      select: { id: true, number: true },
    });

    if (pending.length === 0) {
      return {
        success: true,
        message: 'Nenhum boleto pendente de registro nesta fatura.',
        data: { registered: 0 },
      };
    }

    await this.invoiceGenerationService.registerBankSlipsAtSicredi([invoiceId]);

    const after = await this.prisma.installment.findMany({
      where: { id: { in: pending.map(p => p.id) } },
      select: {
        number: true,
        bankSlip: { select: { nossoNumero: true, status: true, errorMessage: true } },
      },
      orderBy: { number: 'asc' },
    });
    const registered = after.filter(a => a.bankSlip?.status === BANK_SLIP_STATUS.ACTIVE).length;
    const failed = after.filter(a => a.bankSlip?.status !== BANK_SLIP_STATUS.ACTIVE);

    this.logger.log(
      `[BOLETO_REGISTER_MANUAL] Invoice ${invoiceId}: ${registered}/${after.length} registered`,
    );

    // Finish what the interrupted approval could not: a quote stranded at
    // BILLING_APPROVED still reads "Faturamento Aprovado" even though its parcelas exist.
    // The cascade derives the real state ("A Vencer" / "Vencido" / …) from them.
    await this.cascadeService.cascadeFromInvoice(invoiceId);

    return {
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `${registered} boleto(s) registrado(s) no Sicredi.`
          : `${registered} de ${after.length} boleto(s) registrado(s). ` +
            `Falhou: ${failed.map(f => `parcela ${f.number} (${f.bankSlip?.errorMessage ?? f.bankSlip?.status})`).join('; ')}`,
      data: { registered, total: after.length },
    };
  }

  /**
   * POST /invoices/:invoiceId/nfse/emit
   * Manually trigger NFS-e emission for an invoice by creating a new NfseDocument entry.
   * Idempotency guard: prevents duplicate NfseDocument rows per invoice.
   */
  @Post(':invoiceId/nfse/emit')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async emitNfse(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    // Verify the invoice exists and is not cancelled
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        status: true,
        externalOperationId: true,
        // I21: the opt-out flag lives on the customerConfig (task-backed invoices) or on
        // the externalOperation itself (withdrawal-backed invoices). Load both.
        customerConfig: { select: { generateInvoice: true } },
        externalOperation: { select: { generateInvoice: true } },
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Fatura ${invoiceId} não encontrada.`);
    }

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Não é possível emitir NFS-e para uma fatura cancelada.');
    }

    // I21: respect the customer's opt-out. generateInvoice=false means the customer does
    // NOT want a municipal note emitted — reject instead of silently emitting one.
    const optedOut = invoice.externalOperationId
      ? invoice.externalOperation?.generateInvoice === false
      : invoice.customerConfig?.generateInvoice === false;
    if (optedOut) {
      throw new BadRequestException(
        'Este cliente está configurado para NÃO emitir NFS-e (geração de nota desabilitada). ' +
          'Ative a emissão de nota fiscal na configuração de faturamento antes de emitir.',
      );
    }

    // Check existing NFS-e state for this invoice
    const existingNfse = await this.prisma.nfseDocument.findFirst({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, nfseNumber: true },
    });

    if (existingNfse?.status === 'AUTHORIZED') {
      throw new BadRequestException(
        'NFS-e já está autorizada para esta fatura. Use o endpoint de cancelamento para cancelar a existente primeiro.',
      );
    }

    if (existingNfse?.status === 'PROCESSING') {
      throw new BadRequestException('Emissão de NFS-e já está em andamento para esta fatura.');
    }

    // PENDING or ERROR: reset the existing record instead of creating a new one.
    // H3c: the reset is ATOMIC (guarded by the current status) so a concurrent
    // request/sweep that already claimed the document to PROCESSING can never be
    // flipped back to PENDING mid-emission (which would allow a double emission).
    if (existingNfse && (existingNfse.status === 'PENDING' || existingNfse.status === 'ERROR')) {
      const reset = await this.prisma.nfseDocument.updateMany({
        where: { id: existingNfse.id, status: { in: ['PENDING', 'ERROR'] } },
        data: { status: 'PENDING', errorCount: 0, retryAfter: null },
      });
      if (reset.count !== 1) {
        throw new BadRequestException('Emissão de NFS-e já está em andamento para esta fatura.');
      }

      // Use targeted emission (bypasses NFSE_SCHEDULER_ENABLED guard) — fire-and-forget
      this.nfseEmissionScheduler.emitNfseForInvoices([invoiceId]).catch(err => {
        this.logger.warn(`[NFSE_EMIT] Immediate emission failed (scheduler will retry): ${err}`);
      });

      return {
        message: 'NFS-e será emitida em instantes.',
        nfseDocumentId: existingNfse.id,
      };
    }

    // No existing document: create a new NfseDocument entry with PENDING status
    const nfseDoc = await this.prisma.nfseDocument.create({
      data: {
        invoiceId,
        status: 'PENDING',
      },
    });

    // Use targeted emission (bypasses NFSE_SCHEDULER_ENABLED guard) — fire-and-forget
    this.nfseEmissionScheduler.emitNfseForInvoices([invoiceId]).catch(err => {
      this.logger.warn(`[NFSE_EMIT] Immediate emission failed (scheduler will retry): ${err}`);
    });

    return {
      message: 'NFS-e será emitida em instantes.',
      nfseDocumentId: nfseDoc.id,
    };
  }

  /**
   * PUT /invoices/:invoiceId/nfse/cancel
   * Cancel an authorized NFS-e document.
   * Accepts an optional nfseDocumentId to cancel a specific NFS-e;
   * otherwise cancels the latest AUTHORIZED NFS-e for the invoice.
   */
  @Put(':invoiceId/nfse/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async cancelNfse(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body()
    body: {
      reason?: string;
      reasonCode?: number;
      nfseDocumentId?: string;
      /** Number of the NF that replaces this one — required by the prefeitura for duplicity. */
      substituteNfseNumber?: number;
    },
  ) {
    // Find the specific NfseDocument to cancel
    let nfseDoc;
    if (body.nfseDocumentId) {
      nfseDoc = await this.prisma.nfseDocument.findUnique({
        where: { id: body.nfseDocumentId },
      });
    } else {
      // Find the latest AUTHORIZED (or previously-rejected) nfseDocument for this invoice
      nfseDoc = await this.prisma.nfseDocument.findFirst({
        where: { invoiceId, status: { in: ['AUTHORIZED', 'CANCEL_REJECTED'] } },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!nfseDoc) {
      throw new NotFoundException('NFS-e não encontrada para esta fatura.');
    }

    if (nfseDoc.status === 'CANCELLED') {
      throw new BadRequestException('NFS-e já está cancelada.');
    }

    // AUTHORIZED → first request; CANCEL_REJECTED → corrected re-submission;
    // CANCEL_REQUESTED → already pending (the service re-syncs and reports the live state).
    if (!['AUTHORIZED', 'CANCEL_REJECTED', 'CANCEL_REQUESTED'].includes(nfseDoc.status)) {
      throw new BadRequestException(
        'Somente NFS-e autorizadas ou com cancelamento rejeitado podem ter o cancelamento solicitado.',
      );
    }

    if (!body.reason?.trim()) {
      throw new BadRequestException('Motivo do cancelamento é obrigatório.');
    }

    const reasonCode = body.reasonCode ?? 1;

    try {
      const result = await this.municipalNfseService.cancelNfse(
        nfseDoc.id,
        body.reason.trim(),
        reasonCode,
        body.substituteNfseNumber ?? null,
      );

      // Report the REAL outcome honestly — the note may NOT be cancelled yet (or at all).
      let message: string;
      if (result.cancelled) {
        message = 'NFS-e cancelada com sucesso na prefeitura.';
      } else if (result.pending) {
        message =
          'Solicitação de cancelamento enviada. Aguardando aprovação do fiscal da prefeitura. ' +
          'A NFS-e permanece ATIVA até ser aprovada.';
      } else if (result.rejected) {
        message =
          `Cancelamento REJEITADO pela prefeitura: ${result.rejectionMessage ?? 'sem detalhes'}. ` +
          'Corrija o motivo (e informe a nota substituta, se aplicável) e reenvie.';
      } else {
        message = 'Solicitação de cancelamento processada.';
      }

      return { message, ...result };
    } catch (error) {
      const errMsg =
        (error as any)?.response?.data?.message ||
        (error instanceof Error ? error.message : String(error));
      this.logger.error(`Failed to request NFS-e cancellation for invoice ${invoiceId}: ${errMsg}`);
      throw new BadRequestException(`Falha ao solicitar cancelamento da NFS-e: ${errMsg}`);
    }
  }

  /**
   * GET /invoices/:invoiceId/nfse/pdf
   * Download the DANFSE PDF for an invoice's latest authorized NFS-e.
   * Fetches directly from Elotech OXY using elotechNfseId.
   */
  @Get(':invoiceId/nfse/pdf')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async downloadNfsePdf(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Res() res: Response,
  ) {
    // Find the latest authorized NFS-e for this invoice
    const nfseDoc = await this.prisma.nfseDocument.findFirst({
      where: { invoiceId, status: 'AUTHORIZED' },
      orderBy: { createdAt: 'desc' },
    });

    if (!nfseDoc) {
      throw new NotFoundException('NFS-e não encontrada para esta fatura.');
    }

    if (!nfseDoc.elotechNfseId) {
      throw new NotFoundException('PDF da NFS-e não disponível (NFS-e ainda não autorizada).');
    }

    try {
      const pdfBuffer = await this.municipalNfseService.getNfsePdf(nfseDoc.elotechNfseId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="nfse-${nfseDoc.elotechNfseId}.pdf"`);
      return res.send(pdfBuffer);
    } catch (error) {
      this.logger.error(`Failed to fetch NFS-e PDF for invoice ${invoiceId}: ${error}`);
      throw new NotFoundException('Não foi possível obter o PDF da NFS-e.');
    }
  }

  /**
   * GET /invoices/task/:taskId/nfse-history
   * Full NFS-e history for a task — every note ever linked to it, regardless of status
   * (authorized, cancellation-requested, rejected, cancelled) and including orphan notes
   * re-linked from Elotech whose invoice was removed. This is what the task quote page shows
   * so the NF is never "lost" from the task.
   */
  // ACCOUNTING entra aqui porque é o setor que mais precisa da trilha fiscal — e porque as
  // notificações de cancelamento (nfse.cancel_rejected / nfse.orphan_live) o levam para a
  // página de faturamento da tarefa, que sem este endpoint renderizaria o histórico vazio.
  @Get('task/:taskId/nfse-history')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async taskNfseHistory(@Param('taskId', ParseUUIDPipe) taskId: string) {
    const docs = await this.prisma.nfseDocument.findMany({
      where: { taskId },
      // Latest first. nfseNumber nulls (PENDING/ERROR, not yet emitted) sort last.
      orderBy: [{ nfseNumber: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        invoiceId: true,
        elotechNfseId: true,
        nfseNumber: true,
        status: true,
        errorMessage: true,
        cancelRequestStatus: true,
        cancelReason: true,
        cancelReasonCode: true,
        cancelRejectionMessage: true,
        cancelSubstituteNfseNumber: true,
        cancelRequestedAt: true,
        cancelResolvedAt: true,
        // Substituição: o front usa supersededByNfseNumber para pré-preencher a nota
        // substituta no reenvio do cancelamento — é o número que o fiscal exige.
        supersededByNfseDocumentId: true,
        supersededByNfseNumber: true,
        supersededAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Enrich with live Elotech values (valor / emissão / ISS / situação) so the NFS-e section
    // can render every note fully. One ranged query covers all of the task's notes.
    const numbers = docs.map(d => d.nfseNumber).filter((n): n is number => n != null);
    const elotechById = new Map<number, any>();
    if (numbers.length > 0) {
      try {
        const res = await this.municipalNfseService.listNfses({
          numeroDocumentoInicial: Math.min(...numbers),
          numeroDocumentoFinal: Math.max(...numbers),
          situacao: null,
          cpfCnpj: null,
          firstResult: 0,
          maxResult: 50,
        });
        for (const n of res.data) elotechById.set(n.id, n);
      } catch (err) {
        this.logger.warn(`taskNfseHistory: Elotech enrichment failed for task ${taskId}: ${err}`);
      }
    }

    return {
      taskId,
      total: docs.length,
      nfses: docs.map(d => {
        const e = d.elotechNfseId ? elotechById.get(d.elotechNfseId) : null;
        return {
          ...d,
          // invoiceId null = the note outlived its invoice (billing reverted) or was re-linked
          // from Elotech as an orphan. It is still real and active/cancelled at the prefeitura.
          isOrphan: d.invoiceId === null,
          dataEmissao: e?.dataEmissao ?? null,
          valorDoc: e?.valorDoc ?? null,
          valorISS: e?.valorISS ?? null,
          tomadorRazaoNome: e?.tomadorRazaoNome ?? null,
          cancelada: e?.cancelada ?? d.status === 'CANCELLED',
        };
      }),
    };
  }

  // =====================
  // Analytics Endpoints
  // =====================

  @Post('analytics/collection')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getCollectionAnalytics(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getCollectionAnalytics(filters);
    return { success: true, message: 'Análise de cobranças carregada', data };
  }

  @Post('analytics/bank-slips')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getBankSlipPerformance(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getBankSlipPerformance(filters);
    return { success: true, message: 'Desempenho de boletos carregado', data };
  }

  @Post('analytics/quote-funnel')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getQuoteFunnelAnalytics(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getQuoteFunnelAnalytics(filters);
    return { success: true, message: 'Funil de receita carregado', data };
  }

  @Post('analytics/receivables')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getReceivablesAnalytics(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getReceivablesAnalytics(filters);
    return { success: true, message: 'Análise de recebíveis carregada', data };
  }

  @Post('analytics/sicredi-webhooks')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getSicrediWebhookAnalytics(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getSicrediWebhookAnalytics(filters);
    return { success: true, message: 'Análise de webhooks Sicredi carregada', data };
  }

  @Post('analytics/nfse')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getNfseAnalytics(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getNfseAnalytics(filters);
    return { success: true, message: 'Análise de NFS-e carregada', data };
  }

  // =====================
  // PUBLIC ENDPOINTS
  // =====================

  /**
   * GET /invoices/public/:installmentId/boleto/pdf
   * Public endpoint to download the boleto PDF for an installment.
   * Validates the bank slip exists before serving.
   */
  @Get('public/:installmentId/boleto/pdf')
  @Public()
  async downloadBoletoPdfPublic(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Res() res: Response,
  ) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { pdfFile: true },
    });

    if (!bankSlip) {
      throw new NotFoundException('Boleto não encontrado.');
    }

    // If we have a local PDF file, serve it
    if (bankSlip.pdfFile) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(bankSlip.pdfFile.path);
    }

    // If boleto is paid/cancelled, PDF is no longer available
    if (bankSlip.status === 'PAID' || bankSlip.status === 'CANCELLED') {
      throw new NotFoundException('O PDF deste boleto não está mais disponível.');
    }

    // Fetch from Sicredi on-the-fly
    if (!bankSlip.digitableLine) {
      throw new NotFoundException('PDF do boleto ainda não está disponível.');
    }

    try {
      const pdfBuffer = await this.sicrediService.downloadBoletoPdf(bankSlip.digitableLine);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Failed to fetch public boleto PDF for installment ${installmentId}: ${error}`,
      );
      throw new NotFoundException('Não foi possível obter o PDF do boleto.');
    }
  }
}
