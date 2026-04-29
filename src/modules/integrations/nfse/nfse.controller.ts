import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  ParseIntPipe,
  Logger,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { ElotechOxyNfseService } from './elotech-oxy-nfse.service';
import { ElotechOxyAuthService } from './elotech-oxy-auth.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';

@Controller('nfse')
export class NfseController {
  private readonly logger = new Logger(NfseController.name);

  constructor(
    private readonly elotechService: ElotechOxyNfseService,
    private readonly elotechAuth: ElotechOxyAuthService,
    private readonly prisma: PrismaService,
  ) {}

  private ensureConfigured() {
    if (!this.elotechAuth.isConfigured()) {
      throw new HttpException(
        'Elotech OXY credentials not configured. Set ELOTECH_OXY_USERNAME, ELOTECH_OXY_PASSWORD, and ELOTECH_OXY_EMPRESA_ID environment variables.',
        503,
      );
    }
  }

  /**
   * Sync local NfseDocument status with Elotech's actual status.
   * If Elotech says cancelled but local says AUTHORIZED, update local to CANCELLED.
   */
  private async syncCancelledStatuses(
    elotechItems: Array<{ id: number; cancelada?: boolean }>,
    localRefMap: Map<number, { id: string; status: string }>,
  ) {
    const updates: Promise<any>[] = [];
    for (const item of elotechItems) {
      const localRef = localRefMap.get(item.id);
      if (item.cancelada && localRef && localRef.status === 'AUTHORIZED') {
        this.logger.log(
          `Syncing NfseDocument ${localRef.id} to CANCELLED (elotechNfseId=${item.id})`,
        );
        updates.push(
          this.prisma.nfseDocument.update({
            where: { id: localRef.id },
            data: { status: 'CANCELLED' },
          }),
        );
      }
    }
    if (updates.length > 0) {
      await Promise.allSettled(updates);
    }
  }

  /**
   * GET /nfse
   * List NFSes from Elotech API, enriched with local invoice/task data.
   */
  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async list(
    @Query('dataEmissaoInicial') dataEmissaoInicial?: string,
    @Query('dataEmissaoFinal') dataEmissaoFinal?: string,
    @Query('situacao') situacao?: string,
    @Query('cpfCnpj') cpfCnpj?: string,
    @Query('numeroDocumentoInicial') numeroDocumentoInicial?: string,
    @Query('numeroDocumentoFinal') numeroDocumentoFinal?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.ensureConfigured();

    const pageNum = Number(page) || 1;
    const limitNum = Math.min(Number(limit) || 20, 50);
    const firstResult = (pageNum - 1) * limitNum;

    const result = await this.elotechService.listNfses({
      dataEmissaoInicial: dataEmissaoInicial || undefined,
      dataEmissaoFinal: dataEmissaoFinal || undefined,
      situacao: situacao ? Number(situacao) : null,
      cpfCnpj: cpfCnpj || null,
      numeroDocumentoInicial: numeroDocumentoInicial ? Number(numeroDocumentoInicial) : null,
      numeroDocumentoFinal: numeroDocumentoFinal ? Number(numeroDocumentoFinal) : null,
      firstResult,
      maxResult: limitNum,
    });

    // Enrich with local invoice/task data
    const elotechIds = result.data.map((n: any) => n.id);
    const localRefs =
      elotechIds.length > 0
        ? await this.prisma.nfseDocument.findMany({
            where: { elotechNfseId: { in: elotechIds } },
            include: {
              invoice: {
                include: {
                  task: { select: { id: true, name: true, serialNumber: true } },
                  customer: { select: { id: true, fantasyName: true } },
                },
              },
            },
          })
        : [];

    const refMap = new Map<number, (typeof localRefs)[0]>();
    for (const ref of localRefs) {
      if (ref.elotechNfseId) {
        refMap.set(ref.elotechNfseId, ref);
      }
    }

    // Sync cancelled statuses from Elotech to local DB (fire-and-forget)
    this.syncCancelledStatuses(
      result.data,
      new Map(
        localRefs
          .filter(r => r.elotechNfseId)
          .map(r => [r.elotechNfseId!, { id: r.id, status: r.status }]),
      ),
    ).catch(err => this.logger.error('Failed to sync cancelled statuses', err));

    const enrichedData = result.data.map((nfse: any) => {
      const localRef = refMap.get(nfse.id);
      // Use Elotech status as source of truth
      const effectiveStatus = nfse.cancelada ? 'CANCELLED' : localRef?.status || null;
      return {
        ...nfse,
        invoiceId: localRef?.invoice?.id || null,
        taskId: localRef?.invoice?.task?.id || null,
        taskName: localRef?.invoice?.task?.name || null,
        taskSerialNumber: localRef?.invoice?.task?.serialNumber || null,
        customerName: localRef?.invoice?.customer?.fantasyName || null,
        nfseDocumentId: localRef?.id || null,
        localStatus: effectiveStatus,
      };
    });

    return {
      data: enrichedData,
      total: result.totalDocumentos,
      page: pageNum,
      limit: limitNum,
    };
  }

  /**
   * GET /nfse/:elotechNfseId
   * Get detailed NFSe data from Elotech, with live status from list endpoint.
   */
  @Get(':elotechNfseId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async detail(@Param('elotechNfseId', ParseIntPipe) elotechNfseId: number) {
    this.ensureConfigured();
    const detail = await this.elotechService.getNfseDetail(elotechNfseId);

    // Use the document number to do a targeted list query for status
    const numeroNfse = detail?.formDadosNFSe?.numeroNfse;
    let elotechStatus: {
      cancelada: boolean;
      emitida: boolean;
      descricaoSituacao: string;
    } = { cancelada: false, emitida: true, descricaoSituacao: 'EMITIDA' };

    if (numeroNfse) {
      try {
        const targeted = await this.elotechService.listNfses({
          numeroDocumentoInicial: numeroNfse,
          numeroDocumentoFinal: numeroNfse,
          situacao: null,
          cpfCnpj: null,
          dataEmissaoInicial: undefined,
          dataEmissaoFinal: undefined,
          firstResult: 0,
          maxResult: 5,
        });
        const match = targeted.data.find((n: any) => n.id === elotechNfseId);
        if (match) {
          elotechStatus = {
            cancelada: !!match.cancelada,
            emitida: !!match.emitida,
            descricaoSituacao: match.descricaoSituacao || match.situacaoDescricao || 'EMITIDA',
          };
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch status for NFSe ${elotechNfseId}`, err);
      }
    }

    // Find local reference
    const localRef = await this.prisma.nfseDocument.findFirst({
      where: { elotechNfseId },
      include: {
        invoice: {
          include: {
            task: { select: { id: true, name: true, serialNumber: true } },
            customer: { select: { id: true, fantasyName: true } },
          },
        },
      },
    });

    // Sync cancelled status if needed
    if (elotechStatus.cancelada && localRef && localRef.status === 'AUTHORIZED') {
      this.prisma.nfseDocument
        .update({ where: { id: localRef.id }, data: { status: 'CANCELLED' } })
        .catch(err => this.logger.error('Failed to sync cancelled status in detail', err));
    }

    const effectiveStatus = elotechStatus.cancelada
      ? 'CANCELLED'
      : elotechStatus.emitida
        ? 'AUTHORIZED'
        : localRef?.status || null;

    return {
      ...detail,
      invoiceId: localRef?.invoice?.id || null,
      taskId: localRef?.invoice?.task?.id || null,
      taskName: localRef?.invoice?.task?.name || null,
      taskSerialNumber: localRef?.invoice?.task?.serialNumber || null,
      customerName: localRef?.invoice?.customer?.fantasyName || null,
      nfseDocumentId: localRef?.id || null,
      localStatus: effectiveStatus,
      cancelada: elotechStatus.cancelada,
      emitida: elotechStatus.emitida,
    };
  }

  /**
   * GET /nfse/:elotechNfseId/pdf
   * Download NFSe PDF from Elotech.
   */
  @Get(':elotechNfseId/pdf')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async pdf(@Param('elotechNfseId', ParseIntPipe) elotechNfseId: number, @Res() res: Response) {
    this.ensureConfigured();
    const pdfBuffer = await this.elotechService.getNfsePdf(elotechNfseId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="nfse-${elotechNfseId}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  }

  /**
   * GET /nfse/public/:elotechNfseId/pdf
   * Public endpoint to download NFSe PDF from Elotech.
   * Validates that the NFS-e document exists in our database before proxying.
   */
  @Get('public/:elotechNfseId/pdf')
  @Public()
  async publicPdf(
    @Param('elotechNfseId', ParseIntPipe) elotechNfseId: number,
    @Res() res: Response,
  ) {
    this.ensureConfigured();

    // Validate the NFSe exists in our DB (prevents arbitrary Elotech ID access)
    const nfseDoc = await this.prisma.nfseDocument.findFirst({
      where: { elotechNfseId, status: 'AUTHORIZED' },
    });

    if (!nfseDoc) {
      throw new NotFoundException('NFS-e não encontrada.');
    }

    const pdfBuffer = await this.elotechService.getNfsePdf(elotechNfseId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="nfse-${elotechNfseId}.pdf"`,
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'public, max-age=3600',
    });

    res.send(pdfBuffer);
  }
}
