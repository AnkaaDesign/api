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
} from '@nestjs/common';
import { Response } from 'express';
import { InvoiceService } from './invoice.service';
import { InvoiceGenerationService } from './invoice-generation.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES, BANK_SLIP_STATUS } from '@constants';
import type { InvoiceGetManyFormData } from '@types';

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
    private readonly prisma: PrismaService,
    private readonly sicrediService: SicrediService,
    private readonly municipalNfseService: ElotechOxyNfseService,
  ) {}

  // ─── Invoice CRUD ──────────────────────────────────────────────

  /**
   * GET /invoices
   * List invoices with filters (taskId, customerId, status) and pagination.
   */
  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async findMany(@Query() query: InvoiceGetManyFormData) {
    return this.invoiceService.findMany(query);
  }

  /**
   * GET /invoices/:id
   * Get a single invoice with installments, bank slips, and NFS-e.
   */
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async regenerateBoleto(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
  ) {
    const bankSlip = await this.prisma.bankSlip.findUnique({
      where: { installmentId },
      include: { installment: true },
    });

    if (!bankSlip) {
      throw new NotFoundException(
        `Boleto não encontrado para a parcela ${installmentId}.`,
      );
    }

    if (
      bankSlip.status !== BANK_SLIP_STATUS.ERROR &&
      bankSlip.status !== BANK_SLIP_STATUS.REJECTED
    ) {
      throw new BadRequestException(
        'Somente boletos com erro ou rejeitados podem ser regenerados.',
      );
    }

    // Reset the bank slip to ERROR status with errorCount=0 so the scheduler picks it up
    await this.prisma.bankSlip.update({
      where: { id: bankSlip.id },
      data: {
        status: 'ERROR',
        errorMessage: 'Regeneration requested',
        errorCount: 0,
      },
    });

    return { message: 'Boleto será recriado em instantes.' };
  }

  /**
   * PUT /invoices/:installmentId/boleto/cancel
   * Cancel an active boleto.
   */
  @Put(':installmentId/boleto/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
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
   * GET /invoices/:installmentId/boleto/pdf
   * Download the boleto PDF for an installment.
   * If no local PDF exists, fetches directly from Sicredi using linhaDigitavel.
   */
  @Get(':installmentId/boleto/pdf')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
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
      if (bankSlip.status === 'PAID' || error?.response?.status === 404) {
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async emitNfse(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    // Create a new NfseDocument entry with PENDING status
    const nfseDoc = await this.prisma.nfseDocument.create({
      data: {
        invoiceId,
        status: 'PENDING',
      },
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
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
}
