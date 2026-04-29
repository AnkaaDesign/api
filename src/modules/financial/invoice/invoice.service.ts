import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import type {
  Invoice,
  InvoiceInclude,
  InvoiceGetManyFormData,
  InvoiceGetManyResponse,
} from '@types';
import { INVOICE_STATUS, INSTALLMENT_STATUS, BANK_SLIP_STATUS, NFSE_STATUS } from '@constants';

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
  ) {}

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
