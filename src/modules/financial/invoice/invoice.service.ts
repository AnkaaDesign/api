import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import { syncEmNegociacaoForTask } from '../../../utils/em-negociacao-sync';
import type {
  Invoice,
  InvoiceInclude,
  InvoiceGetManyFormData,
  InvoiceGetManyResponse,
} from '@types';
import {
  INVOICE_STATUS,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
  NFSE_STATUS,
  TASK_QUOTE_STATUS,
  TASK_QUOTE_STATUS_ORDER,
} from '@constants';

/**
 * Service for managing Invoice entities.
 * Handles CRUD operations, cancellation, and payment status recalculation.
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Emit invoice.cancelled to FINANCIAL/COMMERCIAL/ADMIN after an invoice is cancelled.
   * Best-effort — never breaks the cancellation flow. Deep link keyed by taskId.
   */
  private async dispatchInvoiceCancelledNotification(
    invoiceId: string,
    reason?: string,
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true, serialNumber: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskName = invoice.task?.name || 'N/A';
      const taskId = invoice.task?.id ?? invoice.taskId ?? null;

      const webUrl = taskId ? `/financeiro/faturamento/detalhes/${taskId}` : undefined;
      const mobileUrl = taskId ? `financial/${taskId}` : undefined;

      await this.dispatchService.dispatchByConfiguration('invoice.cancelled', 'system', {
        entityType: 'Invoice',
        entityId: taskId ?? invoice.id,
        action: 'cancelled',
        data: {
          customerName,
          taskName,
          reason: reason || 'Não especificado',
          invoiceId: invoice.id,
          taskId: taskId || undefined,
        },
        overrides: {
          title: 'Fatura Cancelada',
          body: `A fatura da tarefa ${taskName} (${customerName}) foi cancelada.${reason ? `\nMotivo: ${reason}` : ''}`,
          relatedEntityType: 'INVOICE',
          ...(webUrl ? { webUrl } : {}),
          ...(mobileUrl ? { mobileUrl } : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar cancelamento de fatura (invoice.cancelled):', error);
    }
  }

  /**
   * Find many invoices with filtering, pagination, and sorting.
   */
  async findMany(query: InvoiceGetManyFormData): Promise<InvoiceGetManyResponse> {
    try {
      const result = await this.invoiceRepository.findMany({
        page: query.page,
        limit: query.limit,
        orderBy: query.orderBy,
        where: {
          ...(query.where || {}),
          ...(query.taskId && { taskId: query.taskId }),
          ...(query.customerId && { customerId: query.customerId }),
          ...(query.status && { status: query.status }),
        },
        include: query.include,
      });

      return {
        data: result.data,
        meta: result.meta,
      };
    } catch (error: unknown) {
      this.logger.error('Error finding invoices', error);
      throw error;
    }
  }

  /**
   * Find a single invoice by ID.
   * @throws NotFoundException if not found
   */
  async findById(id: string, include?: InvoiceInclude): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findById(id, include);

    if (!invoice) {
      throw new NotFoundException(`Fatura com ID ${id} não encontrada.`);
    }

    return invoice;
  }

  /**
   * Find all invoices for a given task.
   */
  async findByTaskId(taskId: string, include?: InvoiceInclude): Promise<Invoice[]> {
    return this.invoiceRepository.findByTaskId(taskId, include);
  }

  /**
   * Find all invoices for a given customer.
   */
  async findByCustomerId(customerId: string, include?: InvoiceInclude): Promise<Invoice[]> {
    return this.invoiceRepository.findByCustomerId(customerId, include);
  }

  /**
   * Cancel an invoice and all its children (installments, bank slips, NFS-e).
   * @param id - Invoice UUID
   * @param reason - Optional cancellation reason stored in notes
   * @throws NotFoundException if invoice not found
   * @throws BadRequestException if invoice is already cancelled or fully paid
   */
  async cancelInvoice(id: string, reason?: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findById(id);

    if (!invoice) {
      throw new NotFoundException(`Fatura com ID ${id} não encontrada.`);
    }

    if (invoice.status === INVOICE_STATUS.CANCELLED) {
      throw new BadRequestException('Fatura já está cancelada.');
    }

    if (invoice.status === INVOICE_STATUS.PAID) {
      throw new BadRequestException('Não é possível cancelar uma fatura totalmente paga.');
    }

    // Use a transaction to cancel invoice + all children atomically
    await this.prisma.$transaction(async tx => {
      // Cancel all installments that aren't already paid
      await tx.installment.updateMany({
        where: {
          invoiceId: id,
          status: { not: 'PAID' },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Cancel all bank slips that aren't already paid
      await tx.bankSlip.updateMany({
        where: {
          installment: {
            invoiceId: id,
          },
          status: { notIn: ['PAID', 'CANCELLED'] },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Cancel all NFS-e documents for this invoice that aren't already cancelled/authorized
      await tx.nfseDocument.updateMany({
        where: {
          invoiceId: id,
          status: { notIn: ['CANCELLED', 'AUTHORIZED'] },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Cancel the invoice itself
      await tx.invoice.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          ...(reason && { notes: reason }),
        },
      });
    });

    // Check for AUTHORIZED NFS-e docs that require manual cancellation at Elotech
    const authorizedNfse = await this.prisma.nfseDocument.findMany({
      where: { invoiceId: id, status: 'AUTHORIZED' },
      select: { id: true, nfseNumber: true, elotechNfseId: true },
    });
    if (authorizedNfse.length > 0) {
      for (const nfse of authorizedNfse) {
        this.logger.warn(
          `Invoice ${id} cancelled — NFS-e #${nfse.nfseNumber} (Elotech ID: ${nfse.elotechNfseId}) requires manual cancellation at Elotech OXY`,
        );
      }
      // Append a note on the invoice so the record itself carries the warning
      const nfseWarning = authorizedNfse
        .map(nfse => `NFS-e #${nfse.nfseNumber} pendente cancelamento no Elotech`)
        .join('; ');
      const existing = await this.prisma.invoice.findUnique({
        where: { id },
        select: { notes: true },
      });
      const updatedNotes = existing?.notes
        ? `${existing.notes} | ${nfseWarning}`
        : nfseWarning;
      await this.prisma.invoice.update({
        where: { id },
        data: { notes: updatedNotes },
      });
    }

    // After cancelling all invoice artifacts, revert the linked TaskQuote to COMMERCIAL_APPROVED
    // if every invoice for that quote is now cancelled. This lets the user re-approve billing
    // (e.g., after correcting customer data) without the quote getting stuck in a post-billing
    // status with no live financial documents.
    try {
      const invoiceWithConfig = await this.prisma.invoice.findUnique({
        where: { id },
        select: {
          customerConfig: {
            select: { quote: { select: { id: true, status: true } } },
          },
        },
      });
      const quote = invoiceWithConfig?.customerConfig?.quote;
      const revertableStatuses = ['BILLING_APPROVED', 'UPCOMING', 'DUE', 'PARTIAL'];
      if (quote && revertableStatuses.includes(quote.status as string)) {
        const nonCancelledCount = await this.prisma.invoice.count({
          where: { customerConfig: { quoteId: quote.id }, status: { not: 'CANCELLED' } },
        });
        if (nonCancelledCount === 0) {
          await this.prisma.taskQuote.update({
            where: { id: quote.id },
            data: {
              status: TASK_QUOTE_STATUS.COMMERCIAL_APPROVED as any,
              statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.COMMERCIAL_APPROVED],
            },
          });
          this.logger.log(
            `Reverted TaskQuote ${quote.id} to COMMERCIAL_APPROVED — all invoices cancelled`,
          );

          // Reconcile Em Negociação. Status stays ≥ BUDGET_APPROVED so this is
          // usually a no-op, but kept for symmetry with other status paths.
          const task = await this.prisma.task.findFirst({
            where: { quoteId: quote.id },
            select: { id: true },
          });
          if (task) {
            await syncEmNegociacaoForTask(this.prisma, task.id);
          }
        }
      }
    } catch (revertError) {
      this.logger.warn(
        `Failed to revert TaskQuote status after invoice cancellation: ${revertError}`,
      );
    }

    // Notify FINANCIAL/COMMERCIAL/ADMIN that the invoice was cancelled.
    await this.dispatchInvoiceCancelledNotification(id, reason);

    // Return the updated invoice
    return this.findById(id);
  }

  /**
   * Recalculate the paidAmount and status of an invoice based on its installments.
   * Called after a payment is recorded or a boleto is liquidated.
   */
  async updateInvoicePaymentStatus(invoiceId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        installments: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Fatura com ID ${invoiceId} não encontrada.`);
    }

    // Sum paidAmount across all installments
    const paidAmount = invoice.installments.reduce((sum, inst) => sum + Number(inst.paidAmount), 0);

    // Determine new status based on payments
    const allPaid = invoice.installments.every(
      inst => inst.status === 'PAID' || inst.status === 'CANCELLED',
    );
    const hasPaidInstallments = invoice.installments.some(inst => inst.status === 'PAID');
    const allCancelled = invoice.installments.every(inst => inst.status === 'CANCELLED');

    let newStatus: string;

    if (allCancelled) {
      newStatus = INVOICE_STATUS.CANCELLED;
    } else if (allPaid) {
      newStatus = INVOICE_STATUS.PAID;
    } else if (hasPaidInstallments || paidAmount > 0) {
      newStatus = INVOICE_STATUS.PARTIALLY_PAID;
    } else {
      newStatus = INVOICE_STATUS.ACTIVE;
    }

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount,
        status: newStatus as any,
      },
    });

    return this.findById(invoiceId);
  }
}
