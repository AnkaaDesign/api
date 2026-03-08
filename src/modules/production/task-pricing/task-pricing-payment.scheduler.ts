import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';

/**
 * Scheduler for task pricing payment reminders.
 * Runs daily at 8 AM to check for Installments due yesterday
 * and notify FINANCIAL/ADMIN users to charge the customer.
 */
@Injectable()
export class TaskPricingPaymentScheduler {
  private readonly logger = new Logger(TaskPricingPaymentScheduler.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  @Cron('0 8 * * *', {
    name: 'task-pricing-payment-reminder',
    timeZone: 'America/Sao_Paulo',
  })
  async checkPaymentReminders(): Promise<void> {
    if (this.isProcessing) {
      this.logger.warn('Payment reminder check already in progress, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      this.logger.log('Starting task pricing payment reminder check...');

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Start of yesterday and start of today for range query
      const startOfYesterday = new Date(yesterday);
      startOfYesterday.setUTCHours(0, 0, 0, 0);
      const endOfYesterday = new Date(yesterday);
      endOfYesterday.setUTCHours(23, 59, 59, 999);

      // Find all installments due yesterday from active pricings
      const dueInstallments = await this.prisma.installment.findMany({
        where: {
          dueDate: {
            gte: startOfYesterday,
            lte: endOfYesterday,
          },
          customerConfig: {
            pricing: {
              status: { in: ['UPCOMING', 'PARTIAL'] },
              task: { status: { not: 'CANCELLED' } },
            },
          },
        },
        include: {
          customerConfig: {
            include: {
              pricing: {
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

      for (const installment of dueInstallments) {
        const config = installment.customerConfig;
        const pricing = config.pricing;
        const task = pricing.task;

        if (!task) continue;

        // Count total installments for this config
        const totalInstallments = await this.prisma.installment.count({
          where: { customerConfigId: config.id },
        });

        const installmentLabel = totalInstallments === 1
          ? 'Parcela única'
          : `Parcela ${installment.number}/${totalInstallments}`;

        const dueDate = installment.dueDate.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        });

        await this.dispatchService.dispatchByConfiguration(
          'task_pricing.payment_due',
          'system',
          {
            entityType: 'TaskPricing',
            entityId: pricing.id,
            action: 'payment_due',
            data: {
              taskName: task.name,
              serialNumber: task.serialNumber,
              customerName: config.customer.fantasyName || 'N/A',
              installmentLabel,
              dueDate,
              totalAmount: pricing.total.toString(),
              budgetNumber: pricing.budgetNumber,
            },
          },
        );

        notificationsSent++;
      }

      this.logger.log(
        `Payment reminder check completed. ${notificationsSent} notification(s) sent.`,
      );
    } catch (error) {
      this.logger.error('Error during payment reminder check:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}
