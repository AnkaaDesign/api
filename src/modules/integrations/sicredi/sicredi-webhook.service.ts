import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { TaskQuoteStatusCascadeService } from '@modules/production/task-quote/task-quote-status-cascade.service';
import { WebhookEventDto } from './dto';
import { Decimal } from '@prisma/client/runtime/library';

// Thrown when the webhook references a nossoNumero that does not exist in our DB
// (pre-migration boletos, manual boletos outside the system). Retrying will never
// help, so the caller skips the retry increment and sets retryCount to MAX immediately.
class PermanentWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentWebhookError';
  }
}

// Per Sicredi docs section 15 + webhook contract response — all liquidation event types
const LIQUIDATION_MOVEMENTS = [
  'LIQUIDACAO_PIX',
  'LIQUIDACAO_REDE',
  'LIQUIDACAO_COMPE_H5',
  'LIQUIDACAO_COMPE_H6',
  'LIQUIDACAO_COMPE_H8',
  'LIQUIDACAO_CARTORIO',
  'AVISO_PAGAMENTO_COMPE',
];

// Per Sicredi docs — only REDE can be reversed
const REVERSAL_MOVEMENTS = ['ESTORNO_LIQUIDACAO_REDE'];

/**
 * Parse Sicredi date format.
 * Sicredi sends dates as arrays: [YYYY, MM, DD, HH, mm, ss, nanoseconds]
 * or sometimes as ISO strings.
 */
function parseSicrediDate(value: number[] | string | null | undefined): Date | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    // [YYYY, MM, DD, HH, mm, ss, nanoseconds] — month is 1-based from Sicredi
    // Sicredi sends Brazilian time (BRT = UTC-3). Construct as UTC with the 3-hour offset
    // so the stored timestamp is correct in UTC regardless of server locale.
    const [year, month, day, hours = 0, minutes = 0, seconds = 0] = value;
    return new Date(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}-03:00`,
    );
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
 * Parse Sicredi monetary value — sent as string e.g. "101.01"
 */
function parseSicrediDecimal(value: string | number | null | undefined): Decimal | null {
  if (value == null) return null;
  const str = String(value);
  if (!str || str === '0') return new Decimal(0);
  return new Decimal(str);
}

@Injectable()
export class SicrediWebhookService {
  private readonly logger = new Logger(SicrediWebhookService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
    private readonly notificationDispatchService: NotificationDispatchService,
  ) {}

  async processEvent(payload: WebhookEventDto): Promise<void> {
    const { idEventoWebhook, nossoNumero, movimento } = payload;

    this.logger.log(
      `Processing webhook event: ${idEventoWebhook} - nossoNumero: ${nossoNumero} - movimento: ${movimento}`,
    );
    this.logger.log(`Webhook payload: ${JSON.stringify(payload)}`);

    // Check idempotency: skip if already processed or currently being processed
    const existingEvent = await this.prismaService.sicrediWebhookEvent.findUnique({
      where: { idEventoWebhook },
    });

    if (existingEvent && existingEvent.status === 'PROCESSED') {
      this.logger.warn(`Webhook event ${idEventoWebhook} already processed, skipping`);
      return;
    }

    if (existingEvent && existingEvent.status === 'PROCESSING') {
      this.logger.warn(
        `Webhook event ${idEventoWebhook} is currently being processed, skipping duplicate`,
      );
      return;
    }

    // Parse date and monetary values from Sicredi format
    const dataEvento = parseSicrediDate(payload.dataEvento);
    const dataPrevisaoPagamento = parseSicrediDate(payload.dataPrevisaoPagamento);
    const valorLiquidacao = parseSicrediDecimal(payload.valorLiquidacao);
    const valorDesconto = parseSicrediDecimal(payload.valorDesconto);
    const valorJuros = parseSicrediDecimal(payload.valorJuros);
    const valorMulta = parseSicrediDecimal(payload.valorMulta);
    const valorAbatimento = parseSicrediDecimal(payload.valorAbatimento);

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
        valorLiquidacao,
        valorDesconto,
        valorJuros,
        valorMulta,
        valorAbatimento,
        dataEvento,
        dataPrevisaoPagamento,
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
        await this.handleLiquidation({
          nossoNumero: event.nossoNumero,
          valorLiquidacao: valorLiquidacao ?? event.valorLiquidacao,
          valorDesconto: valorDesconto ?? event.valorDesconto,
          valorJuros: valorJuros ?? event.valorJuros,
          valorMulta: valorMulta ?? event.valorMulta,
          valorAbatimento: valorAbatimento ?? event.valorAbatimento,
        });
      } else if (REVERSAL_MOVEMENTS.includes(movimento)) {
        await this.handleReversal({ nossoNumero: event.nossoNumero });
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

      const isPermanent = error instanceof PermanentWebhookError;
      await this.prismaService.sicrediWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
          // Permanent failures (e.g. nossoNumero not in DB) will never succeed on retry —
          // set retryCount past the MAX threshold so the retry scheduler skips them.
          retryCount: isPermanent ? { set: 10 } : { increment: 1 },
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
      // Permanent failure — retrying will never resolve a missing BankSlip.
      // Caller will skip future retries by setting retryCount to MAX immediately.
      throw new PermanentWebhookError(`BankSlip not found for nossoNumero: ${nossoNumero}`);
    }

    // Skip if already PAID or locally CANCELLED (idempotent — prevents double-processing
    // and processing payments for bank slips cancelled after Sicredi was never notified)
    if (bankSlip.status === 'PAID' || bankSlip.status === 'CANCELLED') {
      this.logger.log(
        `BankSlip ${bankSlip.id} is ${bankSlip.status}, skipping liquidation`,
      );
      return;
    }

    const paidAmount = event.valorLiquidacao
      ? new Decimal(event.valorLiquidacao.toString())
      : bankSlip.amount;
    const now = new Date();

    await this.prismaService.$transaction(async tx => {
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
          paymentMethod: 'BANK_SLIP',
        },
      });

      // Recalculate Invoice paidAmount and status
      await this.recalculateInvoice(tx, bankSlip.installment.invoiceId);
    });

    // Cascade TaskQuote status (UPCOMING → PARTIAL → SETTLED)
    await this.cascadeService.cascadeFromInvoice(bankSlip.installment.invoiceId);

    this.logger.log(
      `Liquidation handled for nossoNumero: ${nossoNumero}, paidAmount: ${paidAmount}`,
    );

    // Dispatch push notification for boleto payment
    await this.dispatchBankSlipPaidNotification(bankSlip, paidAmount, nossoNumero);
  }

  private async dispatchBankSlipPaidNotification(
    bankSlip: { id: string; dueDate: Date; installment: { invoiceId: string } },
    paidAmount: Decimal,
    nossoNumero: string,
  ): Promise<void> {
    try {
      // Fetch invoice with customer and task details for the notification
      const invoice = await this.prismaService.invoice.findUnique({
        where: { id: bankSlip.installment.invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true, serialNumber: true } },
        },
      });

      if (!invoice) {
        this.logger.warn(
          `Cannot dispatch bank_slip.paid notification: Invoice ${bankSlip.installment.invoiceId} not found`,
        );
        return;
      }

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskName = invoice.task?.name || 'N/A';
      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(paidAmount));
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(bankSlip.dueDate);

      // Build deep link URLs (faturamento page expects task ID)
      const webUrl = `/financeiro/faturamento/detalhes/${invoice.taskId}`;
      const mobileUrl = `financial/${invoice.taskId}`;
      const actionUrl = JSON.stringify({
        web: webUrl,
        mobile: mobileUrl,
      });

      await this.notificationDispatchService.dispatchByConfiguration('bank_slip.paid', 'system', {
        entityType: 'Financial',
        entityId: invoice.id,
        action: 'paid',
        data: {
          customerName,
          taskName,
          paidAmount: formattedAmount,
          dueDate: formattedDueDate,
          invoiceId: invoice.id,
          bankSlipId: bankSlip.id,
          taskId: invoice.taskId,
        },
        overrides: {
          actionUrl,
          webUrl,
        },
      });

      this.logger.log(
        `Bank slip paid notification dispatched for nossoNumero: ${nossoNumero}, customer: ${customerName}`,
      );
    } catch (error) {
      // Don't let notification failures break the webhook processing
      this.logger.error(
        `Failed to dispatch bank_slip.paid notification for nossoNumero: ${nossoNumero}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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
      throw new PermanentWebhookError(`BankSlip not found for nossoNumero: ${nossoNumero}`);
    }

    await this.prismaService.$transaction(async tx => {
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

    // Cascade TaskQuote status (SETTLED → PARTIAL → UPCOMING)
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
      return {
        success: false,
        error: `Event ${eventId} is not in FAILED status (current: ${event.status})`,
      };
    }

    // Atomic claim: only one worker may transition FAILED → PROCESSING for this event.
    // Prevents a concurrent inbound webhook retry from racing with the scheduler on the
    // same idEventoWebhook (and thus the same nossoNumero in handleLiquidation).
    const claim = await this.prismaService.sicrediWebhookEvent.updateMany({
      where: { id: event.id, status: 'FAILED' },
      data: {
        status: 'PROCESSING',
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

    if (claim.count === 0) {
      this.logger.warn(
        `[WEBHOOK_RETRY] Event ${event.idEventoWebhook} already claimed by another worker, skipping`,
      );
      return {
        success: false,
        error: 'Event already claimed by another worker',
      };
    }

    this.logger.log(
      `[WEBHOOK_RETRY] Retrying event ${event.idEventoWebhook} (attempt ${event.retryCount + 1})`,
    );

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

      const isPermanent = error instanceof PermanentWebhookError;
      await this.prismaService.sicrediWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          errorMessage,
          retryCount: isPermanent ? { set: 10 } : { increment: 1 },
        },
      });

      return { success: false, error: errorMessage };
    }
  }

  private async recalculateInvoice(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    invoiceId: string,
  ): Promise<void> {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    // Never overwrite a CANCELLED invoice — cancelInvoice owns that state
    if (invoice.status === 'CANCELLED') {
      this.logger.log(`Invoice ${invoiceId} is CANCELLED, skipping recalculation`);
      return;
    }

    const installments = await tx.installment.findMany({ where: { invoiceId } });

    // Null-guard: paidAmount is nullable in the schema (0 on creation, but defensive)
    const totalPaid = installments.reduce(
      (sum, inst) => sum.add(inst.paidAmount ?? new Decimal(0)),
      new Decimal(0),
    );

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
      data: { paidAmount: totalPaid, status },
    });

    this.logger.log(`Invoice ${invoiceId} recalculated: paidAmount=${totalPaid}, status=${status}`);
  }
}
