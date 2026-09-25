import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BillingStatusCascadeService } from '@modules/financial/billing/billing-status-cascade.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import {
  TASK_QUOTE_STATUS,
  TASK_QUOTE_STATUS_ORDER,
  EXTERNAL_OPERATION_STATUS,
  EXTERNAL_OPERATION_STATUS_ORDER,
} from '@constants';
import { Decimal } from '@prisma/client/runtime/library';
import { isDueDateOverdue, todayInSaoPauloAtNoonUtc } from '@utils/due-date.util';
import { QUOTE_TASKS_ORDER_BY } from '@utils/quote-tasks';

/**
 * Service for cascading invoice/installment payment status changes
 * up to the Budget level.
 *
 * Called after Sicredi webhook processes a payment or reversal.
 */
@Injectable()
export class BudgetStatusCascadeService {
  private readonly logger = new Logger(BudgetStatusCascadeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly billingStatusCascade: BillingStatusCascadeService,
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
        // A TAREFA ÂNCORA — a primeira na ordem canônica, nunca a que o banco
        // devolver primeiro. Sem `orderBy` a escolha mudava entre duas leituras
        // do MESMO orçamento, e âncora que anda é como o mesmo orçamento passa a
        // apontar para implementos diferentes (rótulo, deep link, e o carimbo que a
        // migração vai ler).
      const task = await this.prisma.task.findFirst({
        where: { quoteId },
        select: { id: true, name: true, serialNumber: true },
        orderBy: QUOTE_TASKS_ORDER_BY,
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
        entityType: 'Budget',
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
   * Recalculate and cascade Budget status based on installment payment state.
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
      // Find the invoice and trace back to the Budget (or ExternalOperation)
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
   * Recalculate Budget status from all its invoices/installments.
   */
  /**
   * RECALCULA O ESTADO DAS COBRANÇAS DE UM ORÇAMENTO.
   *
   * Este método calculava o status do ORÇAMENTO a partir das parcelas — e era o
   * lugar onde o modelo antigo doía mais. Num orçamento faturado veículo a
   * veículo ele tinha de espremer N cobranças num campo só, e o resultado
   * dependia da ordem: uma fatia paga e outra vencida escreviam por cima uma da
   * outra.
   *
   * Agora ele delega: cada `Billing` recebe o seu estado, calculado das suas
   * próprias parcelas. O que sobrou aqui é o que é mesmo do ORÇAMENTO — o aviso
   * de contrato quitado, que só dispara quando TODAS as cobranças fecharam.
   */
  async cascadeFromQuote(quoteId: string): Promise<void> {
    try {
      const antesTodasPagas = await this.billingStatusCascade.isQuoteFullyPaid(quoteId);

      await this.billingStatusCascade.recomputeForQuote(quoteId);

      // O aviso de "Pagamento Liquidado" é do CONTRATO, não de uma cobrança: só
      // sai quando a última fecha, e só na transição — sem o `antesTodasPagas`
      // ele seria reemitido a cada cascata sobre um orçamento já quitado.
      const depoisTodasPagas = await this.billingStatusCascade.isQuoteFullyPaid(quoteId);
      if (!antesTodasPagas && depoisTodasPagas) {
        await this.dispatchSettledNotification(quoteId);
      }
    } catch (error) {
      this.logger.error(`Error cascading quote status for ${quoteId}: ${error}`);
    }
  }
}
