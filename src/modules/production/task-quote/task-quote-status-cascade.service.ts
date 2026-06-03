import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { TASK_QUOTE_STATUS, TASK_QUOTE_STATUS_ORDER } from '@constants';
import { Decimal } from '@prisma/client/runtime/library';
import { syncEmNegociacaoForTask } from '../../../utils/em-negociacao-sync';

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
  async cascadeFromInvoice(invoiceId: string): Promise<void> {
    try {
      // Find the invoice and trace back to the TaskQuote
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
   * Recalculate TaskQuote status from all its invoices/installments.
   */
  async cascadeFromQuote(quoteId: string): Promise<void> {
    try {
      const quote = await this.prisma.taskQuote.findUnique({
        where: { id: quoteId },
        include: {
          customerConfigs: {
            include: {
              installments: true,
            },
          },
        },
      });

      if (!quote) {
        this.logger.warn(`Quote ${quoteId} not found for cascade`);
        return;
      }

      // Only cascade for quotes that are in UPCOMING, DUE, PARTIAL, or SETTLED state
      const cascadableStatuses = [
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

      const now = new Date();
      const paidCount = allInstallments.filter(inst => inst.status === 'PAID').length;
      const cancelledInstallments = allInstallments.filter(inst => inst.status === 'CANCELLED');
      const activeInstallments = allInstallments.filter(inst => inst.status !== 'CANCELLED');
      const overdueCount = allInstallments.filter(
        inst =>
          inst.status !== 'PAID' && inst.status !== 'CANCELLED' && new Date(inst.dueDate) < now,
      ).length;

      // Guard: if all installments were cancelled (e.g. after invoice cancellation)
      // there is nothing to evaluate — keep the current status unchanged.
      if (activeInstallments.length === 0) {
        return;
      }

      let newStatus: TASK_QUOTE_STATUS;
      if (paidCount === activeInstallments.length) {
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
        const task = await this.prisma.task.findFirst({
          where: { quoteId },
          select: { id: true },
        });
        if (task) {
          await syncEmNegociacaoForTask(this.prisma, task.id);
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
