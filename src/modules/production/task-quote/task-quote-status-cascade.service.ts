import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TASK_QUOTE_STATUS } from '@constants';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Service for cascading invoice/installment payment status changes
 * up to the TaskQuote level.
 *
 * Called after Sicredi webhook processes a payment or reversal.
 */
@Injectable()
export class TaskQuoteStatusCascadeService {
  private readonly logger = new Logger(TaskQuoteStatusCascadeService.name);

  constructor(private readonly prisma: PrismaService) {}

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
        this.logger.warn(
          `Cannot cascade status: invoice ${invoiceId} has no linked quote`,
        );
        return;
      }

      const quoteId = invoice.customerConfig.quote.id;
      await this.cascadeFromQuote(quoteId);
    } catch (error) {
      this.logger.error(
        `Error cascading status from invoice ${invoiceId}: ${error}`,
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
        (config) => (config as any).installments || [],
      );

      if (allInstallments.length === 0) {
        return; // No installments, keep current status
      }

      const now = new Date();
      const paidCount = allInstallments.filter(
        (inst) => inst.status === 'PAID',
      ).length;
      const cancelledInstallments = allInstallments.filter(
        (inst) => inst.status === 'CANCELLED',
      );
      const activeInstallments = allInstallments.filter(
        (inst) => inst.status !== 'CANCELLED',
      );
      const overdueCount = allInstallments.filter(
        (inst) =>
          inst.status !== 'PAID' &&
          inst.status !== 'CANCELLED' &&
          new Date(inst.dueDate) < now,
      ).length;

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
        const statusOrder: Record<string, number> = {
          [TASK_QUOTE_STATUS.SETTLED]: 1,
          [TASK_QUOTE_STATUS.PARTIAL]: 2,
          [TASK_QUOTE_STATUS.UPCOMING]: 3,
          [TASK_QUOTE_STATUS.PENDING]: 4,
          [TASK_QUOTE_STATUS.BUDGET_APPROVED]: 5,
          [TASK_QUOTE_STATUS.VERIFIED_BY_FINANCIAL]: 6,
          [TASK_QUOTE_STATUS.BILLING_APPROVED]: 7,
          [TASK_QUOTE_STATUS.DUE]: 8,
        };

        await this.prisma.taskQuote.update({
          where: { id: quoteId },
          data: {
            status: newStatus as any,
            statusOrder: statusOrder[newStatus] || 1,
          },
        });

        this.logger.log(
          `Cascaded TaskQuote ${quoteId} status: ${quote.status} → ${newStatus}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error cascading quote status for ${quoteId}: ${error}`,
      );
    }
  }
}
