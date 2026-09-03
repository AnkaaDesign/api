import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import {
  TASK_QUOTE_STATUS,
  TASK_QUOTE_STATUS_ORDER,
  EXTERNAL_OPERATION_STATUS,
  EXTERNAL_OPERATION_STATUS_ORDER,
} from '@constants';
import { Decimal } from '@prisma/client/runtime/library';
import { syncEmNegociacaoForTask } from '../../../utils/em-negociacao-sync';
import { isDueDateOverdue, todayInSaoPauloAtNoonUtc } from '@utils/due-date.util';

/**
 * Service for cascading invoice/installment payment status changes
 * up to the TaskQuote level.
 *
 * Called after Sicredi webhook processes a payment or reversal.
 */
@Injectable()
export class TaskQuoteStatusCascadeService {
  private readonly logger = new Logger(TaskQuoteStatusCascadeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Best-effort human label for a quote — uses the linked task serial/name when
   * available, falling back to the short quote id. Also returns the linked task
   * id so notification deep links (keyed by taskId) can be built. Never throws.
   */
  private async buildQuoteLabel(
    quoteId: string,
  ): Promise<{ label: string; taskId: string | null }> {
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
   * Emit task_quote.settled when a cascade lands a quote on SETTLED.
   * Best-effort — never breaks the cascade flow.
   */
  private async dispatchSettledNotification(quoteId: string): Promise<void> {
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
        `Falha ao notificar liquidação de orçamento (task_quote.settled) para ${quoteId}:`,
        error,
      );
    }
  }

  /**
   * Recalculate and cascade TaskQuote status based on installment payment state.
   * Called from SicrediWebhookService after recalculateInvoice().
   *
   * Logic:
   * - All active installments PAID → SETTLED
   * - At least one installment overdue (past due date, not paid, not cancelled) → DUE
   * - Some installments PAID, none overdue → PARTIAL
   * - No installments PAID, none overdue → UPCOMING
   */
  /**
   * Cascade from an installment, resolving the correct anchor. Non-boleto
   * receivables (ENTRADA conciliation) may hang directly off a customerConfig or
   * externalOperation with NO invoice, in which case cascadeFromInvoice has
   * nothing to trace. This picks the right entry point: invoice when present,
   * else the quote (via customerConfig) or the external operation. Never throws.
   */
  async cascadeFromInstallment(installmentId: string): Promise<void> {
    try {
      const inst = await this.prisma.installment.findUnique({
        where: { id: installmentId },
        select: {
          invoiceId: true,
          externalOperationId: true,
          customerConfig: { select: { quoteId: true } },
        },
      });
      if (!inst) return;
      if (inst.invoiceId) {
        await this.cascadeFromInvoice(inst.invoiceId);
      } else if (inst.externalOperationId) {
        await this.cascadeFromExternalOperation(inst.externalOperationId);
      } else if (inst.customerConfig?.quoteId) {
        await this.cascadeFromQuote(inst.customerConfig.quoteId);
      }
    } catch (error) {
      this.logger.error(`Error cascading from installment ${installmentId}: ${error}`);
    }
  }

  async cascadeFromInvoice(invoiceId: string): Promise<void> {
    try {
      // Find the invoice and trace back to the TaskQuote (or ExternalOperation)
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customerConfig: {
            include: {
              quote: true,
            },
          },
        },
      });

      // Withdrawal-backed invoices ("Operação Externa") cascade to the withdrawal status instead.
      if (invoice?.externalOperationId) {
        await this.cascadeFromExternalOperation(invoice.externalOperationId);
        return;
      }

      if (!invoice?.customerConfig?.quote) {
        this.logger.warn(`Cannot cascade status: invoice ${invoiceId} has no linked quote`);
        return;
      }

      const quoteId = invoice.customerConfig.quote.id;
      await this.cascadeFromQuote(quoteId);
    } catch (error) {
      this.logger.error(`Error cascading status from invoice ${invoiceId}: ${error}`);
    }
  }

  /**
   * Cascade installment payment state up to an ExternalOperation ("Operação Externa").
   *
   * Only acts on withdrawals currently in CHARGED status: when every active
   * (non-CANCELLED) installment is PAID, the withdrawal becomes LIQUIDATED.
   * Partial payments / overdue states are reflected on the invoice level only —
   * the withdrawal state machine has no intermediate payment statuses.
   * Never throws — payment processing must not break on cascade failures.
   */
  async cascadeFromExternalOperation(externalOperationId: string): Promise<void> {
    try {
      const withdrawal = await this.prisma.externalOperation.findUnique({
        where: { id: externalOperationId },
        include: { installments: true },
      });

      if (!withdrawal) {
        this.logger.warn(`External withdrawal ${externalOperationId} not found for cascade`);
        return;
      }

      // Only CHARGED withdrawals can be auto-liquidated by payments.
      if (withdrawal.status !== EXTERNAL_OPERATION_STATUS.CHARGED) {
        return;
      }

      const activeInstallments = withdrawal.installments.filter(
        inst => inst.status !== 'CANCELLED',
      );

      if (activeInstallments.length === 0) {
        return; // Nothing to evaluate — keep current status
      }

      const allPaid = activeInstallments.every(inst => inst.status === 'PAID');
      if (!allPaid) {
        return;
      }

      // Idempotent claim (M3): only flip CHARGED → LIQUIDATED when the row is STILL
      // CHARGED. Concurrent payment webhooks would otherwise both pass the read
      // above and double-fire the settled notifications.
      const claim = await this.prisma.externalOperation.updateMany({
        where: { id: externalOperationId, status: EXTERNAL_OPERATION_STATUS.CHARGED as any },
        data: {
          status: EXTERNAL_OPERATION_STATUS.LIQUIDATED as any,
          statusOrder: EXTERNAL_OPERATION_STATUS_ORDER[EXTERNAL_OPERATION_STATUS.LIQUIDATED] || 1,
        },
      });

      if (claim.count !== 1) {
        this.logger.log(
          `ExternalOperation ${externalOperationId} already cascaded by another process, skipping`,
        );
        return;
      }

      this.logger.log(
        `Cascaded ExternalOperation ${externalOperationId} status: ${withdrawal.status} → ${EXTERNAL_OPERATION_STATUS.LIQUIDATED}`,
      );

      // Notify when the withdrawal becomes fully settled via cascade (mirrors the
      // task_quote.settled key emitted for quote settlement). Only fired by the
      // process that won the claim above.
      await this.dispatchWithdrawalSettledNotification(externalOperationId);
    } catch (error) {
      this.logger.error(
        `Error cascading status for external withdrawal ${externalOperationId}: ${error}`,
      );
    }
  }

  /**
   * Emit a settled notification when a cascade lands an external withdrawal on LIQUIDATED.
   * Best-effort — never breaks the cascade flow.
   */
  private async dispatchWithdrawalSettledNotification(withdrawalId: string): Promise<void> {
    try {
      let label = withdrawalId.slice(-8).toUpperCase();
      try {
        const withdrawal = await this.prisma.externalOperation.findUnique({
          where: { id: withdrawalId },
          select: { withdrawerName: true },
        });
        if (withdrawal?.withdrawerName) label = withdrawal.withdrawerName;
      } catch {
        // ignore — fall through to id fragment
      }

      await this.dispatchService.dispatchByConfiguration('task_quote.settled', 'system', {
        entityType: 'ExternalOperation',
        entityId: withdrawalId,
        action: 'settled',
        data: { quoteLabel: label, externalOperationId: withdrawalId },
        overrides: {
          title: 'Pagamento Liquidado',
          body: `A operação externa ${label} foi totalmente liquidada. Todas as parcelas estão pagas.`,
          relatedEntityType: 'EXTERNAL_OPERATION',
          webUrl: `/estoque/operacoes-externas/detalhes/${withdrawalId}`,
          mobileUrl: `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalId}`,
        },
      });

      // Also fire the dedicated external_operation.liquidated key so its own
      // audience (ADMIN/FINANCIAL config) learns about the auto-liquidation.
      await this.dispatchService.dispatchByConfiguration(
        'external_operation.liquidated',
        'system',
        {
          entityType: 'ExternalOperation',
          entityId: withdrawalId,
          action: 'liquidated',
          data: { operationLabel: label, externalOperationId: withdrawalId },
          overrides: {
            title: 'Operação Externa Liquidada',
            body: `Operação externa ${label} liquidada — pagamento quitado.`,
            relatedEntityType: 'EXTERNAL_OPERATION',
            webUrl: `/estoque/operacoes-externas/detalhes/${withdrawalId}`,
            mobileUrl: `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalId}`,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Falha ao notificar liquidação de operação externa para ${withdrawalId}:`,
        error,
      );
    }
  }

  /**
   * Recalculate TaskQuote status from all its invoices/installments.
   */
  async cascadeFromQuote(quoteId: string): Promise<void> {
    try {
      const quote = await this.prisma.taskQuote.findUnique({
        where: { id: quoteId },
        include: {
          customerConfigs: {
            include: {
              installments: {
                include: {
                  // Bank slip status is needed to tell a genuinely-overdue installment
                  // apart from one whose charge instrument (boleto) was CANCELLED.
                  bankSlip: { select: { status: true } },
                },
              },
            },
          },
        },
      });

      if (!quote) {
        this.logger.warn(`Quote ${quoteId} not found for cascade`);
        return;
      }

      // Cascade for quotes already in the receivables lifecycle, PLUS BILLING_APPROVED.
      //
      // BILLING_APPROVED belongs here because it is meant to be transient: `internalApprove`
      // generates the invoice, registers the boletos and only THEN flips the quote to
      // UPCOMING ("A Vencer"). If the process dies in between — a deploy, a restart, a
      // Sicredi timeout — the quote is left reading "Faturamento Aprovado" forever, with
      // installments already issued and nothing able to move it: this guard used to skip
      // it, so no cascade, no recovery, no button. Including it lets any later cascade
      // finish the transition the interrupted approval never got to.
      const cascadableStatuses = [
        TASK_QUOTE_STATUS.BILLING_APPROVED,
        TASK_QUOTE_STATUS.UPCOMING,
        TASK_QUOTE_STATUS.DUE,
        TASK_QUOTE_STATUS.PARTIAL,
        TASK_QUOTE_STATUS.SETTLED,
      ];
      if (!cascadableStatuses.includes(quote.status as TASK_QUOTE_STATUS)) {
        return;
      }

      // Collect all installments across all customer configs
      const allInstallments = quote.customerConfigs.flatMap(
        config => (config as any).installments || [],
      );

      if (allInstallments.length === 0) {
        return; // No installments, keep current status
      }

      const today = todayInSaoPauloAtNoonUtc();
      const paidCount = allInstallments.filter(inst => inst.status === 'PAID').length;
      const cancelledInstallments = allInstallments.filter(inst => inst.status === 'CANCELLED');
      const activeInstallments = allInstallments.filter(inst => inst.status !== 'CANCELLED');
      // A past-due installment that is neither PAID nor CANCELLED is money still
      // owed, full stop.
      //
      // This used to also skip an installment whose boleto was CANCELLED, on the
      // reasoning that "the charge no longer exists". That conflates two opposite
      // situations. When a charge is genuinely abandoned, `cancelBoleto` cancels
      // the INSTALLMENT too, and the `status === 'CANCELLED'` test above already
      // excludes it. When only the rail changes — the customer will pay by PIX,
      // so `markBoletoAsPaid` cancels the slip — the debt is still owed, and if
      // that payment never arrives the parcela stays open. Skipping those made
      // the quote report "a vencer" forever: RKO budget 273 sat at UPCOMING with
      // three parcelas and R$13.850,60 unpaid, 104 days past the first due date.
      const overdueCount = allInstallments.filter(inst => {
        if (inst.status === 'PAID' || inst.status === 'CANCELLED') return false;
        // Calendar-day comparison in SP: a parcela due TODAY is not overdue. Comparing raw
        // instants flipped the quote to DUE at 09:00 SP on the parcela's own due date
        // (stored noon UTC), before the customer could possibly have missed it.
        return isDueDateOverdue(new Date(inst.dueDate), today);
      }).length;

      // Guard: if all installments were cancelled (e.g. after invoice cancellation)
      // there is nothing to evaluate — keep the current status unchanged.
      if (activeInstallments.length === 0) {
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // LIQUIDADO EXIGE QUE TUDO ESTEJA FATURADO
      // ═══════════════════════════════════════════════════════════════════════
      //
      // ⚠️ Sem esta guarda, o faturamento veículo a veículo produz o pior erro
      // possível nesta tela. Cenário medido no orçamento do Marquespan (sessenta
      // caminhões, R$ 730.224,00, `PER_TASK`):
      //
      //   · o caminhão 1 é entregue e faturado → 4 parcelas de R$ 3.042,60;
      //   · o cliente paga as quatro;
      //   · os caminhões 2 a 60 ainda não foram faturados, então não têm parcela;
      //   · `paidCount (4) === activeInstallments.length (4)`  ⇒  **SETTLED**.
      //
      // O orçamento se declararia LIQUIDADO com R$ 718.053,60 ainda a faturar, o
      // aviso de "Pagamento Liquidado" iria para o comercial e o financeiro, e o
      // registro sairia de toda tela de cobrança. Uma fatia paga não é um
      // contrato quitado.
      //
      // A pergunta que decide é: TODAS as fatias já foram faturadas? Em `JOINT`
      // existe uma fatia só e a resposta é sim desde a primeira aprovação, então
      // nada muda para os orçamentos de sempre.
      const configsList = quote.customerConfigs ?? [];
      const everySliceBilled =
        configsList.length > 0 && configsList.every(c => !!(c as any).billingApprovedAt);
      // COMPATIBILIDADE: orçamento anterior a esta feature tem
      // `billingApprovedAt` nulo em TODA configuração — a coluna acabou de
      // nascer. Sem este ramo, todo orçamento já liquidado voltaria de SETTLED
      // para PARTIAL na primeira cascata que rodasse depois do deploy. O marcador
      // que aqueles têm é o do ORÇAMENTO.
      const noSliceMarkers = configsList.every(c => !(c as any).billingApprovedAt);
      const fullyBilled =
        everySliceBilled || (noSliceMarkers && !!(quote as any).billingApprovedAt);

      let newStatus: TASK_QUOTE_STATUS;
      if (paidCount === activeInstallments.length && fullyBilled) {
        newStatus = TASK_QUOTE_STATUS.SETTLED;
      } else if (overdueCount > 0) {
        newStatus = TASK_QUOTE_STATUS.DUE;
      } else if (paidCount > 0) {
        newStatus = TASK_QUOTE_STATUS.PARTIAL;
      } else {
        newStatus = TASK_QUOTE_STATUS.UPCOMING;
      }

      if (newStatus !== quote.status) {
        await this.prisma.taskQuote.update({
          where: { id: quoteId },
          data: {
            status: newStatus as any,
            statusOrder: TASK_QUOTE_STATUS_ORDER[newStatus as TASK_QUOTE_STATUS] || 1,
          },
        });

        this.logger.log(`Cascaded TaskQuote ${quoteId} status: ${quote.status} → ${newStatus}`);

        // Reconcile Em Negociação. Cascades stay within ≥ BUDGET_APPROVED so this
        // is normally a no-op, but kept for symmetry with other status paths.
        // Reconcilia "Em Negociação" em TODAS as tarefas do orçamento: a O.S. é
        // por tarefa, e num orçamento de sessenta caminhões reconciliar só a
        // primeira deixaria as outras cinquenta e nove com a O.S. de negociação
        // aberta depois de o contrato estar fechado.
        const quoteTaskRows = await this.prisma.task.findMany({
          where: { quoteId },
          select: { id: true },
        });
        for (const t of quoteTaskRows) {
          await syncEmNegociacaoForTask(this.prisma, t.id);
        }

        // Notify when the quote becomes fully settled via cascade (webhook/reconciliation
        // payment paths). Mirrors the task_quote.settled key emitted by manual settlement.
        if (newStatus === TASK_QUOTE_STATUS.SETTLED) {
          await this.dispatchSettledNotification(quoteId);
        }
      }
    } catch (error) {
      this.logger.error(`Error cascading quote status for ${quoteId}: ${error}`);
    }
  }
}
