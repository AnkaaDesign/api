import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { TaskQuoteStatusCascadeService } from './task-quote-status-cascade.service';

/**
 * Scheduler for task quote payment reminders.
 * Runs daily at 8 AM to check for Installments due yesterday
 * and notify FINANCIAL/ADMIN users to charge the customer.
 */
@Injectable()
export class TaskQuotePaymentScheduler {
  private readonly logger = new Logger(TaskQuotePaymentScheduler.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
  ) {}

  @Cron('0 8 * * *', {
    name: 'task-quote-payment-reminder',
    timeZone: 'America/Sao_Paulo',
  })
  async checkPaymentReminders(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('Skipping task-quote payment reminder in non-production env');
      return;
    }

    if (this.isProcessing) {
      this.logger.warn('Payment reminder check already in progress, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      this.logger.log('Starting task quote payment reminder check...');

      // Compute "yesterday" by São Paulo wall-clock — the cron fires at 8 AM SP.
      // Brazil abolished DST in 2019, so SP is constant UTC-3 year-round.
      // We derive YYYY-MM-DD from the SP-localized "now", then build the UTC
      // Date instances corresponding to SP-midnight and SP-end-of-day.
      const SP_OFFSET = '-03:00';
      const spDateParts = new Date().toLocaleString('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }); // en-CA yields "YYYY-MM-DD"
      const todaySP = new Date(`${spDateParts}T00:00:00${SP_OFFSET}`);
      const startOfYesterday = new Date(todaySP);
      startOfYesterday.setUTCDate(startOfYesterday.getUTCDate() - 1);
      const endOfYesterday = new Date(todaySP.getTime() - 1); // 23:59:59.999 SP yesterday

      // Find all installments due yesterday from active quotes
      const dueInstallments = await this.prisma.installment.findMany({
        where: {
          dueDate: {
            gte: startOfYesterday,
            lte: endOfYesterday,
          },
          customerConfig: {
            quote: {
              status: { in: ['UPCOMING', 'DUE', 'PARTIAL'] },
              task: { status: { not: 'CANCELLED' } },
            },
          },
        },
        include: {
          customerConfig: {
            include: {
              quote: {
                include: {
                  task: {
                    select: {
                      id: true,
                      name: true,
                      serialNumber: true,
                      status: true,
                    },
                  },
                },
              },
              customer: {
                select: {
                  id: true,
                  fantasyName: true,
                  cnpj: true,
                },
              },
            },
          },
        },
      });

      let notificationsSent = 0;
      const affectedQuoteIds = new Set<string>();

      for (const installment of dueInstallments) {
        const config = installment.customerConfig;
        const quote = config.quote;
        const task = quote.task;

        if (!task) continue;

        affectedQuoteIds.add(quote.id);

        // Count total installments for this config
        const totalInstallments = await this.prisma.installment.count({
          where: { customerConfigId: config.id },
        });

        const installmentLabel =
          totalInstallments === 1
            ? 'Parcela única'
            : `Parcela ${installment.number}/${totalInstallments}`;

        const dueDate = installment.dueDate.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        });

        await this.dispatchService.dispatchByConfiguration('task_quote.payment_due', 'system', {
          entityType: 'TaskQuote',
          entityId: quote.id,
          action: 'payment_due',
          data: {
            taskName: task.name,
            serialNumber: task.serialNumber,
            customerName: config.customer.fantasyName || 'N/A',
            installmentLabel,
            dueDate,
            totalAmount: quote.total.toString(),
            budgetNumber: quote.budgetNumber,
          },
        });

        notificationsSent++;
      }

      // Cascade status for each affected quote (may transition to DUE)
      for (const quoteId of affectedQuoteIds) {
        try {
          await this.cascadeService.cascadeFromQuote(quoteId);
        } catch (cascadeError) {
          this.logger.error(`Error cascading status for quote ${quoteId}: ${cascadeError}`);
        }
      }

      this.logger.log(
        `Payment reminder check completed. ${notificationsSent} notification(s) sent. ${affectedQuoteIds.size} quote(s) cascaded.`,
      );
    } catch (error) {
      this.logger.error('Error during payment reminder check:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}
