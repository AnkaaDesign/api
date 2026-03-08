import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TASK_PRICING_STATUS } from '@constants';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Service for cascading invoice/installment payment status changes
 * up to the TaskPricing level.
 *
 * Called after Sicredi webhook processes a payment or reversal.
 */
@Injectable()
export class TaskPricingStatusCascadeService {
  private readonly logger = new Logger(TaskPricingStatusCascadeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalculate and cascade TaskPricing status based on installment payment state.
   * Called from SicrediWebhookService after recalculateInvoice().
   *
   * Logic:
   * - All installments PAID → SETTLED
   * - Some installments PAID → PARTIAL
   * - No installments PAID but invoices exist → UPCOMING
   */
  async cascadeFromInvoice(invoiceId: string): Promise<void> {
    try {
      // Find the invoice and trace back to the TaskPricing
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customerConfig: {
            include: {
              pricing: true,
            },
          },
        },
      });

      if (!invoice?.customerConfig?.pricing) {
        this.logger.warn(
          `Cannot cascade status: invoice ${invoiceId} has no linked pricing`,
        );
        return;
      }

      const pricingId = invoice.customerConfig.pricing.id;
      await this.cascadeFromPricing(pricingId);
    } catch (error) {
      this.logger.error(
        `Error cascading status from invoice ${invoiceId}: ${error}`,
      );
    }
  }

  /**
   * Recalculate TaskPricing status from all its invoices/installments.
   */
  async cascadeFromPricing(pricingId: string): Promise<void> {
    try {
      const pricing = await this.prisma.taskPricing.findUnique({
        where: { id: pricingId },
        include: {
          customerConfigs: {
            include: {
              installments: true,
            },
          },
        },
      });

      if (!pricing) {
        this.logger.warn(`Pricing ${pricingId} not found for cascade`);
        return;
      }

      // Only cascade for pricings that are in UPCOMING, PARTIAL, or SETTLED state
      const cascadableStatuses = [
        TASK_PRICING_STATUS.UPCOMING,
        TASK_PRICING_STATUS.PARTIAL,
        TASK_PRICING_STATUS.SETTLED,
      ];
      if (!cascadableStatuses.includes(pricing.status as TASK_PRICING_STATUS)) {
        return;
      }

      // Collect all installments across all invoices
      const allInstallments = pricing.customerConfigs.flatMap(
        (config) => (config as any).installments || [],
      );

      if (allInstallments.length === 0) {
        return; // No installments, keep current status
      }

      const paidCount = allInstallments.filter(
        (inst) => inst.status === 'PAID',
      ).length;

      let newStatus: TASK_PRICING_STATUS;
      if (paidCount === allInstallments.length) {
        newStatus = TASK_PRICING_STATUS.SETTLED;
      } else if (paidCount > 0) {
        newStatus = TASK_PRICING_STATUS.PARTIAL;
      } else {
        newStatus = TASK_PRICING_STATUS.UPCOMING;
      }

      if (newStatus !== pricing.status) {
        const statusOrder: Record<string, number> = {
          [TASK_PRICING_STATUS.PENDING]: 1,
          [TASK_PRICING_STATUS.BUDGET_APPROVED]: 2,
          [TASK_PRICING_STATUS.VERIFIED]: 3,
          [TASK_PRICING_STATUS.INTERNAL_APPROVED]: 4,
          [TASK_PRICING_STATUS.UPCOMING]: 5,
          [TASK_PRICING_STATUS.PARTIAL]: 6,
          [TASK_PRICING_STATUS.SETTLED]: 7,
        };

        await this.prisma.taskPricing.update({
          where: { id: pricingId },
          data: {
            status: newStatus as any,
            statusOrder: statusOrder[newStatus] || 1,
          },
        });

        this.logger.log(
          `Cascaded TaskPricing ${pricingId} status: ${pricing.status} → ${newStatus}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error cascading pricing status for ${pricingId}: ${error}`,
      );
    }
  }
}
