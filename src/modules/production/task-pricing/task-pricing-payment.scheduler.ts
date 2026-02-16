import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { PaymentCondition } from '@prisma/client';

/**
 * Scheduler for task pricing payment reminders.
 * Runs daily at 8 AM to check for installments due yesterday
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

  /**
   * Calculate all installment due dates for a given payment condition.
   * Returns an array of { date, installmentNumber, totalInstallments }.
   */
  private getInstallmentDueDates(
    paymentCondition: PaymentCondition,
    downPaymentDate: Date,
  ): { date: Date; installmentNumber: number; totalInstallments: number }[] {
    const installmentCountMap: Record<string, number> = {
      CASH: 1,
      INSTALLMENTS_2: 2,
      INSTALLMENTS_3: 3,
      INSTALLMENTS_4: 4,
      INSTALLMENTS_5: 5,
      INSTALLMENTS_6: 6,
      INSTALLMENTS_7: 7,
    };

    const totalInstallments = installmentCountMap[paymentCondition];
    if (!totalInstallments) return [];

    const dates: { date: Date; installmentNumber: number; totalInstallments: number }[] = [];

    for (let i = 0; i < totalInstallments; i++) {
      const date = new Date(downPaymentDate);
      date.setDate(date.getDate() + i * 20);
      dates.push({
        date,
        installmentNumber: i + 1,
        totalInstallments,
      });
    }

    return dates;
  }

  /**
   * Check if two dates are the same calendar day (UTC).
   */
  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }

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

      const pricings = await this.prisma.taskPricing.findMany({
        where: {
          status: 'APPROVED',
          paymentCondition: { notIn: ['CUSTOM'] },
          downPaymentDate: { not: null },
        },
        include: {
          tasks: {
            where: { status: { not: 'CANCELLED' } },
            select: {
              id: true,
              name: true,
              serialNumber: true,
              status: true,
            },
          },
          invoicesToCustomers: {
            select: {
              id: true,
              fantasyName: true,
            },
          },
        },
      });

      let notificationsSent = 0;

      for (const pricing of pricings) {
        if (!pricing.downPaymentDate || !pricing.paymentCondition) continue;
        if (pricing.tasks.length === 0) continue;

        const installments = this.getInstallmentDueDates(
          pricing.paymentCondition,
          pricing.downPaymentDate,
        );

        for (const installment of installments) {
          if (!this.isSameDay(installment.date, yesterday)) continue;

          const customerNames = pricing.invoicesToCustomers
            .map((c) => c.fantasyName)
            .join(', ');

          for (const task of pricing.tasks) {
            const installmentLabel = installment.totalInstallments === 1
              ? 'Parcela unica'
              : `Parcela ${installment.installmentNumber}/${installment.totalInstallments}`;

            const dueDate = installment.date.toLocaleDateString('pt-BR', {
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
                  customerName: customerNames || 'N/A',
                  installmentLabel,
                  dueDate,
                  totalAmount: pricing.total.toString(),
                  budgetNumber: pricing.budgetNumber,
                },
              },
            );

            notificationsSent++;
          }
        }
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
