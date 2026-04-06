import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
  Logger,
  NotFoundException,
  BadRequestException,
  UsePipes,
} from '@nestjs/common';
import { Response } from 'express';
import { InvoiceService } from './invoice.service';
import { InvoiceGenerationService } from './invoice-generation.service';
import { InvoiceAnalyticsService } from './invoice-analytics.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { SECTOR_PRIVILEGES, BANK_SLIP_STATUS, INSTALLMENT_STATUS, TASK_QUOTE_STATUS, TASK_QUOTE_STATUS_ORDER } from '@constants';
import type { InvoiceGetManyFormData } from '@types';

/**
 * Parse a YYYY-MM-DD string into a Date at noon UTC.
 * This prevents timezone shifts — noon UTC is the same calendar day in every timezone.
 */
function parseDateNoonUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/**
 * Format a Date to YYYY-MM-DD using UTC components (timezone-safe).
 */
function formatDateUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Controller for Invoice endpoints.
 * Handles invoice listing, detail views, cancellation,
 * boleto management, and NFS-e operations.
 */
@Controller('invoices')
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly invoiceGenerationService: InvoiceGenerationService,
    private readonly invoiceAnalyticsService: InvoiceAnalyticsService,
    private readonly prisma: PrismaService,
    private readonly sicrediService: SicrediService,
    private readonly municipalNfseService: ElotechOxyNfseService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
  ) {}

  // ─── Invoice CRUD ──────────────────────────────────────────────

  /**
   * GET /invoices
   * List invoices with filters (taskId, customerId, status) and pagination.
   */
  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findMany(@Query() query: InvoiceGetManyFormData) {
    return this.invoiceService.findMany(query);
  }

  /**
   * GET /invoices/:id
   * Get a single invoice with installments, bank slips, and NFS-e.
   */
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceService.findById(id, {
      installments: { include: { bankSlip: { include: { pdfFile: true } } } },
      nfseDocuments: true,
      customer: true,
      task: true,
      createdBy: true,
    });
  }

  /**
   * GET /invoices/task/:taskId
   * Get all invoices for a specific task.
   */
  @Get('task/:taskId')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  async findByTaskId(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.invoiceService.findByTaskId(taskId);
  }

  /**
   * GET /invoices/customer/:customerId
   * Get all invoices for a specific customer.
   */
  @Get('customer/:customerId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findByCustomerId(
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.invoiceService.findByCustomerId(customerId);
  }

  // ─── Invoice Actions ───────────────────────────────────────────

  /**
   * PUT /invoices/:id/cancel
   * Cancel an invoice and all its children (installments, bank slips, NFS-e).
   */
  @Put(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async cancelInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.invoiceService.cancelInvoice(id, body.reason);
  }

  // ─── Boleto (Bank Slip) Endpoints ──────────────────────────────

  /**
   * POST /invoices/:installmentId/boleto/regenerate
   * Re-create a failed or errored boleto for an installment.
   */
  @Post(':installmentId/boleto/regenerate')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async regenerateBoleto(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() body: { newDueDate?: string },
  ) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { installment: { include: { invoice: true } } },
    });

    if (!bankSlip) {
      throw new NotFoundException(
        `Boleto não encontrado para a parcela ${installmentId}.`,
      );
    }

    if (
      bankSlip.status !== BANK_SLIP_STATUS.ERROR &&
      bankSlip.status !== BANK_SLIP_STATUS.REJECTED &&
      bankSlip.status !== BANK_SLIP_STATUS.CANCELLED
    ) {
      throw new BadRequestException(
        'Somente boletos com erro, rejeitados ou cancelados podem ser regenerados.',
      );
    }

    // If a new due date is provided, update the installment due date
    let resolvedDueDate = bankSlip.dueDate;
    if (body?.newDueDate) {
      const newDate = parseDateNoonUTC(body.newDueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (isNaN(newDate.getTime())) {
        throw new BadRequestException('Data de vencimento inválida.');
      }

      if (newDate < today) {
        throw new BadRequestException(
          'A nova data de vencimento deve ser igual ou posterior a hoje.',
        );
      }

      resolvedDueDate = newDate;
      await this.prisma.installment.update({
        where: { id: installmentId },
        data: { dueDate: newDate },
      });
    }

    // Reset bank slip to CREATING so registerBankSlipsAtSicredi picks it up.
    // nossoNumero is a required @unique field — use TMP-{installmentId} placeholder.
    await this.prisma.bankSlip.update({
      where: { id: bankSlip.id },
      data: {
        status: BANK_SLIP_STATUS.CREATING,
        nossoNumero: `TMP-${installmentId}`,
        barcode: null,
        digitableLine: null,
        pixQrCode: null,
        txid: null,
        pdfFileId: null,
        errorMessage: null,
        errorCount: 0,
        dueDate: resolvedDueDate,
      },
    });

    // Directly register at Sicredi instead of waiting for the scheduler
    const invoiceId = bankSlip.installment?.invoiceId;
    if (invoiceId) {
      try {
        await this.invoiceGenerationService.registerBankSlipsAtSicredi([invoiceId]);
        this.logger.log(`[BOLETO] Regenerated boleto for installment ${installmentId}`);
      } catch (error) {
        this.logger.error(`[BOLETO] Failed to regenerate boleto for installment ${installmentId}: ${error}`);
        // The bank slip is already in CREATING/ERROR state — scheduler will retry as fallback
      }
    }

    return { message: 'Boleto será recriado em instantes.' };
  }

  /**
   * PUT /invoices/:installmentId/boleto/cancel
   * Cancel an active boleto.
   */
  @Put(':installmentId/boleto/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async cancelBoleto(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
  ) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
    });

    if (!bankSlip) {
      throw new NotFoundException(
        `Boleto não encontrado para a parcela ${installmentId}.`,
      );
    }

    if (bankSlip.status === BANK_SLIP_STATUS.PAID) {
      throw new BadRequestException(
        'Não é possível cancelar um boleto já pago.',
      );
    }

    if (bankSlip.status === BANK_SLIP_STATUS.CANCELLED) {
      throw new BadRequestException('Boleto já está cancelado.');
    }

    // Cancel boleto at Sicredi first (if it's active at the bank)
    if (
      bankSlip.nossoNumero &&
      (bankSlip.status === BANK_SLIP_STATUS.ACTIVE ||
        bankSlip.status === BANK_SLIP_STATUS.OVERDUE)
    ) {
      try {
        await this.sicrediService.cancelBoleto(bankSlip.nossoNumero);
      } catch (error) {
        this.logger.warn(
          `Failed to cancel boleto at Sicredi (nossoNumero=${bankSlip.nossoNumero}): ${error}`,
        );
      }
    }

    await this.prisma.bankSlip.update({
      where: { id: bankSlip.id },
      data: { status: 'CANCELLED' },
    });

    return { message: 'Boleto cancelado com sucesso.' };
  }

  /**
   * PUT /invoices/:installmentId/boleto/mark-paid
   * Cancel the boleto and mark the installment as paid via PIX/cash/other.
   */
  @Put(':installmentId/boleto/mark-paid')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async markBoletoAsPaid(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() body: { paymentMethod: string; receiptFileId?: string },
  ) {
    if (!body.paymentMethod) {
      throw new BadRequestException('Método de pagamento é obrigatório.');
    }

    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { bankSlip: true, invoice: true },
    });

    if (!installment) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }

    if (installment.status === INSTALLMENT_STATUS.PAID) {
      throw new BadRequestException('Parcela já está paga.');
    }

    // Cancel the bank slip at Sicredi if active
    if (
      installment.bankSlip &&
      installment.bankSlip.nossoNumero &&
      [BANK_SLIP_STATUS.ACTIVE, BANK_SLIP_STATUS.OVERDUE].includes(
        installment.bankSlip.status as any,
      )
    ) {
      try {
        await this.sicrediService.cancelBoleto(installment.bankSlip.nossoNumero);
      } catch (error) {
        this.logger.warn(
          `Failed to cancel boleto at Sicredi (nossoNumero=${installment.bankSlip.nossoNumero}): ${error}`,
        );
      }
    }

    // Update bank slip to cancelled, store payment method in sicrediStatus for display
    if (installment.bankSlip && installment.bankSlip.status !== BANK_SLIP_STATUS.CANCELLED) {
      await this.prisma.bankSlip.update({
        where: { id: installment.bankSlip.id },
        data: {
          status: BANK_SLIP_STATUS.CANCELLED,
          sicrediStatus: `PAID_${body.paymentMethod}`,
        },
      });
    }

    // Mark installment as paid
    const now = new Date();
    await this.prisma.installment.update({
      where: { id: installmentId },
      data: {
        status: INSTALLMENT_STATUS.PAID,
        paidAmount: installment.amount,
        paidAt: now,
        paymentMethod: body.paymentMethod,
        receiptFileId: body.receiptFileId || null,
      },
    });

    // Recalculate invoice status
    if (installment.invoiceId) {
      const allInstallments = await this.prisma.installment.findMany({
        where: { invoiceId: installment.invoiceId },
      });
      const allPaid = allInstallments.every(
        (i) => i.id === installmentId || i.status === INSTALLMENT_STATUS.PAID || i.status === 'CANCELLED',
      );
      const paidAmount = allInstallments.reduce((sum, i) => {
        if (i.id === installmentId) return sum + Number(installment.amount);
        if (i.status === INSTALLMENT_STATUS.PAID) return sum + Number(i.paidAmount);
        return sum;
      }, 0);

      await this.prisma.invoice.update({
        where: { id: installment.invoiceId },
        data: {
          status: allPaid ? 'PAID' : 'PARTIALLY_PAID',
          paidAmount,
        },
      });

      // Cascade: recalculate task quote status based on all installments
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: installment.invoiceId },
        select: { customerConfig: { select: { quoteId: true } } },
      });
      if (invoice?.customerConfig?.quoteId) {
        const quoteId = invoice.customerConfig.quoteId;
        const allQuoteInstallments = await this.prisma.installment.findMany({
          where: { customerConfig: { quoteId }, status: { not: 'CANCELLED' } },
          select: { status: true },
        });
        const allPaidOrSettled = allQuoteInstallments.every(i => i.status === INSTALLMENT_STATUS.PAID);
        const somePaid = allQuoteInstallments.some(i => i.status === INSTALLMENT_STATUS.PAID);

        if (allPaidOrSettled) {
          await this.prisma.taskQuote.update({
            where: { id: quoteId },
            data: { status: 'SETTLED', statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.SETTLED] },
          });
        } else if (somePaid) {
          await this.prisma.taskQuote.update({
            where: { id: quoteId },
            data: { status: 'PARTIAL', statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.PARTIAL] },
          });
        }
      }
    }

    return { message: `Parcela marcada como paga via ${body.paymentMethod}.` };
  }

  /**
   * PUT /invoices/:installmentId/receipt
   * Attach or update a payment receipt on any paid installment.
   */
  @Put(':installmentId/receipt')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async updateInstallmentReceipt(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() body: { receiptFileId: string },
  ) {
    if (!body.receiptFileId) {
      throw new BadRequestException('ID do comprovante é obrigatório.');
    }

    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
    });

    if (!installment) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }

    if (installment.status !== INSTALLMENT_STATUS.PAID) {
      throw new BadRequestException('Apenas parcelas pagas podem receber comprovante.');
    }

    await this.prisma.installment.update({
      where: { id: installmentId },
      data: { receiptFileId: body.receiptFileId },
    });

    return { message: 'Comprovante atualizado com sucesso.' };
  }

  /**
   * GET /invoices/:installmentId/receipt/download
   * Download the payment receipt file for an installment.
   */
  @Get(':installmentId/receipt/download')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async downloadReceipt(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Res() res: Response,
  ) {
    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { receiptFile: true },
    });

    if (!installment) {
      throw new NotFoundException(`Parcela ${installmentId} não encontrada.`);
    }

    if (!installment.receiptFile) {
      throw new NotFoundException('Nenhum comprovante anexado a esta parcela.');
    }

    const file = installment.receiptFile;
    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(file.path)) {
      throw new NotFoundException('Arquivo do comprovante não encontrado no servidor.');
    }

    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
    res.sendFile(path.resolve(file.path));
  }

  /**
   * PATCH /invoices/:installmentId/boleto/due-date
   * Change the due date of an overdue boleto.
   * Creates a new boleto at Sicredi with the new due date by using the PATCH data-vencimento endpoint.
   */
  @Put(':installmentId/boleto/due-date')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async changeBankSlipDueDate(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() body: { newDueDate: string },
  ) {
    if (!body.newDueDate) {
      throw new BadRequestException('Nova data de vencimento é obrigatória.');
    }

    const newDate = parseDateNoonUTC(body.newDueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(newDate.getTime())) {
      throw new BadRequestException('Data de vencimento inválida.');
    }

    if (newDate < today) {
      throw new BadRequestException(
        'A nova data de vencimento deve ser igual ou posterior a hoje.',
      );
    }

    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { installment: true },
    });

    if (!bankSlip) {
      throw new NotFoundException(
        `Boleto não encontrado para a parcela ${installmentId}.`,
      );
    }

    if (bankSlip.status !== BANK_SLIP_STATUS.OVERDUE && bankSlip.status !== BANK_SLIP_STATUS.ACTIVE) {
      throw new BadRequestException(
        'Somente boletos ativos ou vencidos podem ter a data de vencimento alterada.',
      );
    }

    if (!bankSlip.nossoNumero || bankSlip.nossoNumero.startsWith('TMP-')) {
      throw new BadRequestException(
        'Boleto ainda não foi registrado no Sicredi.',
      );
    }

    const formattedDate = formatDateUTC(newDate);

    try {
      await this.sicrediService.changeDueDate(bankSlip.nossoNumero, formattedDate);

      // Update local records
      await this.prisma.bankSlip.update({
        where: { id: bankSlip.id },
        data: {
          dueDate: newDate,
          status: 'ACTIVE',
          lastSyncAt: new Date(),
        },
      });

      await this.prisma.installment.update({
        where: { id: installmentId },
        data: {
          dueDate: newDate,
          status: 'PENDING',
        },
      });

      this.logger.log(
        `[BOLETO] Due date changed for installment ${installmentId}: nossoNumero=${bankSlip.nossoNumero}, newDate=${formattedDate}`,
      );

      return {
        message: 'Data de vencimento alterada com sucesso.',
        newDueDate: formattedDate,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[BOLETO] Failed to change due date for installment ${installmentId}: ${errMsg}`,
      );
      throw new BadRequestException(
        `Falha ao alterar data de vencimento no Sicredi. O boleto pode estar em um estado que não permite alteração (já baixado ou liquidado). Detalhes: ${errMsg}`,
      );
    }
  }

  /**
   * GET /invoices/:installmentId/boleto/pdf
   * Download the boleto PDF for an installment.
   * If no local PDF exists, fetches directly from Sicredi using linhaDigitavel.
   */
  @Get(':installmentId/boleto/pdf')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async downloadBoletoPdf(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Res() res: Response,
  ) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { pdfFile: true },
    });

    if (!bankSlip) {
      throw new NotFoundException(
        `Boleto não encontrado para a parcela ${installmentId}.`,
      );
    }

    // If we have a local PDF file, serve it
    if (bankSlip.pdfFile) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`,
      );
      return res.sendFile(bankSlip.pdfFile.path);
    }

    // If boleto is paid/cancelled, Sicredi no longer serves the PDF
    if (bankSlip.status === 'PAID') {
      throw new NotFoundException(
        'Este boleto já foi pago. O PDF não está mais disponível no Sicredi.',
      );
    }

    if (bankSlip.status === 'CANCELLED') {
      throw new NotFoundException(
        'Este boleto foi cancelado. O PDF não está mais disponível.',
      );
    }

    // Otherwise, fetch from Sicredi on-the-fly using linhaDigitavel
    if (!bankSlip.digitableLine) {
      throw new NotFoundException(
        'PDF do boleto ainda não está disponível (linha digitável não encontrada).',
      );
    }

    try {
      const pdfBuffer = await this.sicrediService.downloadBoletoPdf(
        bankSlip.digitableLine,
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`,
      );
      return res.send(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Failed to fetch boleto PDF from Sicredi for installment ${installmentId}: ${error}`,
      );

      // Sicredi returns 404 for paid/processed boletos
      if ((bankSlip.status as string) === 'PAID' || error?.response?.status === 404) {
        throw new NotFoundException(
          'Este boleto já foi pago ou processado. O PDF não está mais disponível no Sicredi.',
        );
      }

      throw new NotFoundException(
        'Não foi possível obter o PDF do boleto junto ao Sicredi.',
      );
    }
  }

  // ─── NFS-e Endpoints ──────────────────────────────────────────

  /**
   * POST /invoices/:invoiceId/nfse/emit
   * Manually trigger NFS-e emission for an invoice by creating a new NfseDocument entry.
   */
  @Post(':invoiceId/nfse/emit')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async emitNfse(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    // Create a new NfseDocument entry with PENDING status
    const nfseDoc = await this.prisma.nfseDocument.create({
      data: {
        invoiceId,
        status: 'PENDING',
      },
    });

    // Trigger emission immediately (fire-and-forget, scheduler is fallback)
    this.nfseEmissionScheduler.emitPendingNfses().catch((err) => {
      this.logger.warn(`[NFSE_EMIT] Immediate emission failed (scheduler will retry): ${err}`);
    });

    return {
      message: 'NFS-e será emitida em instantes.',
      nfseDocumentId: nfseDoc.id,
    };
  }

  /**
   * PUT /invoices/:invoiceId/nfse/cancel
   * Cancel an authorized NFS-e document.
   * Accepts an optional nfseDocumentId to cancel a specific NFS-e;
   * otherwise cancels the latest AUTHORIZED NFS-e for the invoice.
   */
  @Put(':invoiceId/nfse/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async cancelNfse(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: { reason?: string; reasonCode?: number; nfseDocumentId?: string },
  ) {
    // Find the specific NfseDocument to cancel
    let nfseDoc;
    if (body.nfseDocumentId) {
      nfseDoc = await this.prisma.nfseDocument.findUnique({
        where: { id: body.nfseDocumentId },
      });
    } else {
      // Find the latest AUTHORIZED nfseDocument for this invoice
      nfseDoc = await this.prisma.nfseDocument.findFirst({
        where: { invoiceId, status: 'AUTHORIZED' },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!nfseDoc) {
      throw new NotFoundException('NFS-e não encontrada para esta fatura.');
    }

    if (nfseDoc.status === 'CANCELLED') {
      throw new BadRequestException('NFS-e já está cancelada.');
    }

    if (nfseDoc.status !== 'AUTHORIZED') {
      throw new BadRequestException(
        'Somente NFS-e autorizadas podem ser canceladas.',
      );
    }

    if (!body.reason?.trim()) {
      throw new BadRequestException(
        'Motivo do cancelamento é obrigatório.',
      );
    }

    const reasonCode = body.reasonCode ?? 1;

    try {
      const result = await this.municipalNfseService.cancelNfse(
        nfseDoc.id,
        body.reason.trim(),
        reasonCode,
      );
      return {
        message: 'NFS-e cancelada com sucesso.',
        ...result,
      };
    } catch (error) {
      const errMsg =
        (error as any)?.response?.data?.message ||
        (error instanceof Error ? error.message : String(error));
      this.logger.error(
        `Failed to cancel NFS-e for invoice ${invoiceId}: ${errMsg}`,
      );
      throw new BadRequestException(
        `Falha ao cancelar NFS-e: ${errMsg}`,
      );
    }
  }

  /**
   * GET /invoices/:invoiceId/nfse/pdf
   * Download the DANFSE PDF for an invoice's latest authorized NFS-e.
   * Fetches directly from Elotech OXY using elotechNfseId.
   */
  @Get(':invoiceId/nfse/pdf')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async downloadNfsePdf(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Res() res: Response,
  ) {
    // Find the latest authorized NFS-e for this invoice
    const nfseDoc = await this.prisma.nfseDocument.findFirst({
      where: { invoiceId, status: 'AUTHORIZED' },
      orderBy: { createdAt: 'desc' },
    });

    if (!nfseDoc) {
      throw new NotFoundException('NFS-e não encontrada para esta fatura.');
    }

    if (!nfseDoc.elotechNfseId) {
      throw new NotFoundException(
        'PDF da NFS-e não disponível (NFS-e ainda não autorizada).',
      );
    }

    try {
      const pdfBuffer = await this.municipalNfseService.getNfsePdf(
        nfseDoc.elotechNfseId,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="nfse-${nfseDoc.elotechNfseId}.pdf"`,
      );
      return res.send(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Failed to fetch NFS-e PDF for invoice ${invoiceId}: ${error}`,
      );
      throw new NotFoundException(
        'Não foi possível obter o PDF da NFS-e.',
      );
    }
  }

  // =====================
  // Analytics Endpoints
  // =====================

  @Post('analytics/collection')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  async getCollectionAnalytics(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getCollectionAnalytics(filters);
    return { success: true, message: 'Análise de cobranças carregada', data };
  }

  @Post('analytics/bank-slips')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  async getBankSlipPerformance(@Body() filters: any) {
    const data = await this.invoiceAnalyticsService.getBankSlipPerformance(filters);
    return { success: true, message: 'Desempenho de boletos carregado', data };
  }

  // =====================
  // PUBLIC ENDPOINTS
  // =====================

  /**
   * GET /invoices/public/:installmentId/boleto/pdf
   * Public endpoint to download the boleto PDF for an installment.
   * Validates the bank slip exists before serving.
   */
  @Get('public/:installmentId/boleto/pdf')
  @Public()
  async downloadBoletoPdfPublic(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Res() res: Response,
  ) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { pdfFile: true },
    });

    if (!bankSlip) {
      throw new NotFoundException('Boleto não encontrado.');
    }

    // If we have a local PDF file, serve it
    if (bankSlip.pdfFile) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(bankSlip.pdfFile.path);
    }

    // If boleto is paid/cancelled, PDF is no longer available
    if (bankSlip.status === 'PAID' || bankSlip.status === 'CANCELLED') {
      throw new NotFoundException('O PDF deste boleto não está mais disponível.');
    }

    // Fetch from Sicredi on-the-fly
    if (!bankSlip.digitableLine) {
      throw new NotFoundException('PDF do boleto ainda não está disponível.');
    }

    try {
      const pdfBuffer = await this.sicrediService.downloadBoletoPdf(bankSlip.digitableLine);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="boleto-${bankSlip.nossoNumero}.pdf"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(pdfBuffer);
    } catch (error) {
      this.logger.error(`Failed to fetch public boleto PDF for installment ${installmentId}: ${error}`);
      throw new NotFoundException('Não foi possível obter o PDF do boleto.');
    }
  }
}
