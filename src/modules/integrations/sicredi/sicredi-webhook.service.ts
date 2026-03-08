import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskPricingStatusCascadeService } from '@modules/production/task-pricing/task-pricing-status-cascade.service';
import { WebhookEventDto } from './dto';
import { Decimal } from '@prisma/client/runtime/library';

const LIQUIDATION_MOVEMENTS = [
  'LIQUIDACAO_NORMAL',
  'LIQUIDACAO_BANCO',
  'LIQUIDACAO_CARTORIO',
  'LIQUIDACAO_REDE',
];

const REVERSAL_MOVEMENTS = [
  'ESTORNO_LIQUIDACAO_REDE',
  'ESTORNO_LIQUIDACAO_NORMAL',
  'ESTORNO_LIQUIDACAO_BANCO',
  'ESTORNO_LIQUIDACAO_CARTORIO',
];

@Injectable()
export class SicrediWebhookService {
  private readonly logger = new Logger(SicrediWebhookService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cascadeService: TaskPricingStatusCascadeService,
  ) {}

  async processEvent(payload: WebhookEventDto): Promise<void> {
    const { idEventoWebhook, nossoNumero, movimento } = payload;

    this.logger.log(
      `Processing webhook event: ${idEventoWebhook} - nossoNumero: ${nossoNumero} - movimento: ${movimento}`,
    );

    // Check idempotency: skip if already processed or currently being processed
    const existingEvent = await this.prismaService.sicrediWebhookEvent.findUnique({
      where: { idEventoWebhook },
    });

    if (existingEvent && existingEvent.status === 'PROCESSED') {
      this.logger.warn(`Webhook event ${idEventoWebhook} already processed, skipping`);
      return;
    }

    if (existingEvent && existingEvent.status === 'PROCESSING') {
      this.logger.warn(`Webhook event ${idEventoWebhook} is currently being processed, skipping duplicate`);
      return;
    }

    // Store the event
    const event = await this.prismaService.sicrediWebhookEvent.upsert({
      where: { idEventoWebhook },
      update: {
        status: 'PROCESSING',
        rawPayload: payload as any,
        updatedAt: new Date(),
      },
      create: {
        idEventoWebhook,
        nossoNumero,
        movimento,
        valorLiquidacao: payload.valorLiquidacao ?? null,
        valorDesconto: payload.valorDesconto ?? null,
        valorJuros: payload.valorJuros ?? null,
        valorMulta: payload.valorMulta ?? null,
        valorAbatimento: payload.valorAbatimento ?? null,
        dataEvento: payload.dataEvento ? new Date(payload.dataEvento) : null,
        dataPrevisaoPagamento: payload.dataPrevisaoPagamento
          ? new Date(payload.dataPrevisaoPagamento)
          : null,
        agencia: payload.agencia ?? null,
        posto: payload.posto ?? null,
        beneficiario: payload.beneficiario ?? null,
        carteira: payload.carteira ?? null,
        rawPayload: payload as any,
        status: 'PROCESSING',
      },
    });

    try {
      if (LIQUIDATION_MOVEMENTS.includes(movimento)) {
        await this.handleLiquidation(event);
      } else if (REVERSAL_MOVEMENTS.includes(movimento)) {
        await this.handleReversal(event);
      } else {
        this.logger.warn(`Unknown movimento type: ${movimento} for event ${idEventoWebhook}`);
      }

      // Mark event as processed
      await this.prismaService.sicrediWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });

      this.logger.log(`Webhook event ${idEventoWebhook} processed successfully`);
    } catch (error) {
      this.logger.error(`Failed to process webhook event ${idEventoWebhook}`, error);

      await this.prismaService.sicrediWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
          retryCount: { increment: 1 },
        },
      });

      throw error;
    }
  }

  private async handleLiquidation(event: {
    nossoNumero: string;
    valorLiquidacao: Decimal | null;
    valorDesconto: Decimal | null;
    valorJuros: Decimal | null;
    valorMulta: Decimal | null;
    valorAbatimento: Decimal | null;
  }): Promise<void> {
    const { nossoNumero } = event;

    this.logger.log(`Handling liquidation for nossoNumero: ${nossoNumero}`);

    // Find the BankSlip by nossoNumero
    const bankSlip = await this.prismaService.bankSlip.findUnique({
      where: { nossoNumero },
      include: {
        installment: {
          include: {
            invoice: true,
          },
        },
      },
    });

    if (!bankSlip) {
      throw new Error(`BankSlip not found for nossoNumero: ${nossoNumero}`);
    }

    const paidAmount = event.valorLiquidacao
      ? new Decimal(event.valorLiquidacao.toString())
      : bankSlip.amount;
    const now = new Date();

    await this.prismaService.$transaction(async (tx) => {
      // Update BankSlip to PAID
      await tx.bankSlip.update({
        where: { id: bankSlip.id },
        data: {
          status: 'PAID',
          paidAmount,
          paidAt: now,
          liquidationData: {
            valorLiquidacao: event.valorLiquidacao?.toString() ?? null,
            valorDesconto: event.valorDesconto?.toString() ?? null,
            valorJuros: event.valorJuros?.toString() ?? null,
            valorMulta: event.valorMulta?.toString() ?? null,
            valorAbatimento: event.valorAbatimento?.toString() ?? null,
          },
        },
      });

      // Update Installment to PAID
      await tx.installment.update({
        where: { id: bankSlip.installmentId },
        data: {
          status: 'PAID',
          paidAmount,
          paidAt: now,
        },
      });

      // Recalculate Invoice paidAmount and status
      await this.recalculateInvoice(tx, bankSlip.installment.invoiceId);
    });

    // Cascade TaskPricing status (UPCOMING → PARTIAL → SETTLED)
    await this.cascadeService.cascadeFromInvoice(bankSlip.installment.invoiceId);

    this.logger.log(`Liquidation handled for nossoNumero: ${nossoNumero}`);
  }

  private async handleReversal(event: { nossoNumero: string }): Promise<void> {
    const { nossoNumero } = event;

    this.logger.log(`Handling reversal for nossoNumero: ${nossoNumero}`);

    const bankSlip = await this.prismaService.bankSlip.findUnique({
      where: { nossoNumero },
      include: {
        installment: {
          include: {
            invoice: true,
          },
        },
      },
    });

    if (!bankSlip) {
      throw new Error(`BankSlip not found for nossoNumero: ${nossoNumero}`);
    }

    await this.prismaService.$transaction(async (tx) => {
      // Reverse BankSlip back to ACTIVE
      await tx.bankSlip.update({
        where: { id: bankSlip.id },
        data: {
          status: 'ACTIVE',
          paidAmount: null,
          paidAt: null,
          liquidationData: null,
        },
      });

      // Reverse Installment back to PENDING
      await tx.installment.update({
        where: { id: bankSlip.installmentId },
        data: {
          status: 'PENDING',
          paidAmount: new Decimal(0),
          paidAt: null,
        },
      });

      // Recalculate Invoice paidAmount and status
      await this.recalculateInvoice(tx, bankSlip.installment.invoiceId);
    });

    // Cascade TaskPricing status (SETTLED → PARTIAL → UPCOMING)
    await this.cascadeService.cascadeFromInvoice(bankSlip.installment.invoiceId);

    this.logger.log(`Reversal handled for nossoNumero: ${nossoNumero}`);
  }

  async retryFailedEvent(eventId: string): Promise<{ success: boolean; error?: string }> {
    const event = await this.prismaService.sicrediWebhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return { success: false, error: `Event ${eventId} not found` };
    }

    if (event.status !== 'FAILED') {
      return { success: false, error: `Event ${eventId} is not in FAILED status (current: ${event.status})` };
    }

    this.logger.log(
      `[WEBHOOK_RETRY] Retrying event ${event.idEventoWebhook} (attempt ${event.retryCount + 1})`,
    );

    // Reset status to PROCESSING
    await this.prismaService.sicrediWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSING',
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

    try {
      if (LIQUIDATION_MOVEMENTS.includes(event.movimento)) {
        await this.handleLiquidation(event);
      } else if (REVERSAL_MOVEMENTS.includes(event.movimento)) {
        await this.handleReversal(event);
      } else {
        this.logger.warn(
          `[WEBHOOK_RETRY] Unknown movimento type: ${event.movimento} for event ${event.idEventoWebhook}`,
        );
      }

      // Mark event as processed
      await this.prismaService.sicrediWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });

      this.logger.log(
        `[WEBHOOK_RETRY] Event ${event.idEventoWebhook} processed successfully on retry`,
      );

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[WEBHOOK_RETRY] Retry failed for event ${event.idEventoWebhook}: ${errorMessage}`,
      );

      await this.prismaService.sicrediWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          errorMessage,
          retryCount: { increment: 1 },
        },
      });

      return { success: false, error: errorMessage };
    }
  }

  private async recalculateInvoice(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    invoiceId: string,
  ): Promise<void> {
    // Fetch all installments for the invoice
    const installments = await tx.installment.findMany({
      where: { invoiceId },
    });

    // Sum paid amounts
    const totalPaid = installments.reduce(
      (sum, inst) => sum.add(inst.paidAmount),
      new Decimal(0),
    );

    // Get invoice total
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });

    // Determine status
    let status: 'PAID' | 'PARTIALLY_PAID' | 'ACTIVE';
    if (totalPaid.gte(invoice.totalAmount)) {
      status = 'PAID';
    } else if (totalPaid.gt(0)) {
      status = 'PARTIALLY_PAID';
    } else {
      status = 'ACTIVE';
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: totalPaid,
        status,
      },
    });

    this.logger.log(
      `Invoice ${invoiceId} recalculated: paidAmount=${totalPaid}, status=${status}`,
    );
  }
}
