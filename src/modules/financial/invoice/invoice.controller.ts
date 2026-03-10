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
import { NfseService } from '@modules/integrations/nfse/nfse.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES, BANK_SLIP_STATUS, NFSE_STATUS } from '@constants';
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
    private readonly nfseService: NfseService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
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
      nfseDocument: { include: { pdfFile: true } },
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
      throw new NotFoundException(
        'Não foi possível obter o PDF do boleto junto ao Sicredi.',
      );
    }
  }

  // ─── NFS-e Endpoints ──────────────────────────────────────────

  /**
   * POST /invoices/:invoiceId/nfse/emit
   * Manually trigger NFS-e emission for an invoice.
   */
  @Post(':invoiceId/nfse/emit')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async emitNfse(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    // NFSe Nacional disabled: Ibiporã still uses municipal emission.
    throw new BadRequestException(
      'Emissão de NFS-e Nacional desabilitada. O município ainda utiliza emissão municipal.',
    );
  }

  /**
   * PUT /invoices/:invoiceId/nfse/cancel
   * Cancel an authorized NFS-e document.
   */
  @Put(':invoiceId/nfse/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async cancelNfse(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: { reason?: string },
  ) {
    // NFSe Nacional disabled: Ibiporã still uses municipal emission.
    throw new BadRequestException(
      'Cancelamento de NFS-e Nacional desabilitado. O município ainda utiliza emissão municipal.',
    );
  }

  /**
   * GET /invoices/:invoiceId/nfse/pdf
   * Download the DANFSE PDF for an invoice's NFS-e.
   */
  @Get(':invoiceId/nfse/pdf')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async downloadNfsePdf(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Res() res: Response,
  ) {
    // NFSe Nacional disabled: Ibiporã still uses municipal emission.
    throw new BadRequestException(
      'Download de NFS-e Nacional desabilitado. O município ainda utiliza emissão municipal.',
    );
  }
}
