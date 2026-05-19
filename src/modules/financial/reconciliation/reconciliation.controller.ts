import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Response, Request } from 'express';
import { promises as fs } from 'node:fs';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '@constants';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationImportService } from './reconciliation-import.service';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import { ReconciliationStatisticsService } from './reconciliation-statistics.service';
import { ManualXmlImportService } from './manual-xml-import.service';
import { ReconciliationAliasService } from './reconciliation-alias.service';
import {
  transactionsFilterSchema,
  TransactionsFilterDto,
} from './dto/transactions-filter.dto';
import {
  fiscalDocumentsFilterSchema,
  FiscalDocumentsFilterDto,
} from './dto/fiscal-documents-filter.dto';
import { statisticsFilterSchema, StatisticsFilterDto } from './dto/statistics-filter.dto';
import { manualMatchSchema, ManualMatchDto } from './dto/manual-match.dto';
import {
  ignoreTransactionSchema,
  IgnoreTransactionDto,
} from './dto/ignore-transaction.dto';
import {
  rerunMatchingSchema,
  RerunMatchingDto,
} from './dto/rerun-matching.dto';

@Controller('financial/reconciliation')
@Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
export class ReconciliationController {
  constructor(
    private readonly service: ReconciliationService,
    private readonly importService: ReconciliationImportService,
    private readonly matcher: ReconciliationMatcherService,
    private readonly stats: ReconciliationStatisticsService,
    private readonly xmlImport: ManualXmlImportService,
    private readonly aliases: ReconciliationAliasService,
  ) {}

  @Post('import')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'files', maxCount: 30 }], {
      ...multerConfig,
      limits: {
        ...multerConfig.limits,
        fileSize: 100 * 1024 * 1024, // 100 MB per file (ZIPs of bulk OFX exports)
      },
    }),
  )
  async importOfx(
    @UploadedFiles() body: { files?: Express.Multer.File[] },
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const files = body?.files ?? [];
    if (files.length === 0) {
      throw new BadRequestException('Envie ao menos um arquivo OFX ou ZIP');
    }
    return this.importService.importOfx(files, req.user?.id);
  }

  @Post('fiscal-documents/import')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'files', maxCount: 30 }], {
      ...multerConfig,
      limits: {
        ...multerConfig.limits,
        fileSize: 100 * 1024 * 1024, // 100 MB per file for bulk NF imports
      },
    }),
  )
  async importXml(
    @UploadedFiles() body: { files?: Express.Multer.File[] },
  ) {
    const files = body?.files ?? [];
    if (files.length === 0) {
      throw new BadRequestException('Envie ao menos um arquivo XML ou ZIP');
    }
    return this.xmlImport.importFiles(files);
  }

  @Get('transactions')
  @UsePipes(new ZodValidationPipe(transactionsFilterSchema))
  listTransactions(@Query() query: TransactionsFilterDto) {
    return this.service.listTransactions(query);
  }

  @Get('transactions/:id/candidates')
  getCandidates(@Param('id') id: string) {
    return this.service.getCandidates(id);
  }

  @Get('transactions/:id')
  getTransaction(@Param('id') id: string) {
    return this.service.getTransaction(id);
  }

  @Get('fiscal-documents/:id')
  getFiscalDocument(@Param('id') id: string) {
    return this.service.getFiscalDocument(id);
  }

  @Post('transactions/:id/match')
  @UsePipes(new ZodValidationPipe(manualMatchSchema))
  manualMatch(
    @Param('id') id: string,
    @Body() payload: ManualMatchDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.manualMatch(id, payload, req.user?.id);
  }

  @Post('transactions/:id/unmatch')
  unmatch(@Param('id') id: string, @Req() req: Request & { user?: { id?: string } }) {
    return this.service.unmatch(id, req.user?.id);
  }

  @Post('transactions/:id/ignore')
  @UsePipes(new ZodValidationPipe(ignoreTransactionSchema))
  ignore(@Param('id') id: string, @Body() payload: IgnoreTransactionDto) {
    return this.service.ignore(id, payload);
  }

  @Post('run')
  @UsePipes(new ZodValidationPipe(rerunMatchingSchema))
  async run(@Body() body: RerunMatchingDto) {
    if (body.dateStart && body.dateEnd) {
      const matched = await this.matcher.matchDateRange(
        new Date(body.dateStart),
        new Date(body.dateEnd),
      );
      return { matched };
    }
    if (body.transactionIds && body.transactionIds.length > 0) {
      let matched = 0;
      for (const id of body.transactionIds) {
        const tx = await this.matcher['prisma'].bankTransaction.findUnique({
          where: { id },
          select: {
            id: true,
            postedAt: true,
            amount: true,
            type: true,
            counterpartyCnpjCpf: true,
            counterpartyName: true,
            memo: true,
            bankSlipId: true,
            matchStatus: true,
          },
        });
        if (tx) {
          const ok = await this.matcher.matchTransaction(tx as any);
          if (ok) matched += 1;
        }
      }
      return { matched };
    }
    // Default: run for all UNMATCHED transactions (global re-run from transactions list)
    const matched = await this.matcher.matchAll();
    return { matched };
  }

  @Get('statistics')
  @UsePipes(new ZodValidationPipe(statisticsFilterSchema))
  getStatistics(@Query() query: StatisticsFilterDto) {
    return this.stats.getStatistics(query);
  }

  @Get('fiscal-documents')
  @UsePipes(new ZodValidationPipe(fiscalDocumentsFilterSchema))
  listFiscalDocuments(@Query() query: FiscalDocumentsFilterDto) {
    return this.service.listFiscalDocuments(query);
  }

  @Get('fiscal-documents/:accessKey/xml')
  async downloadXml(@Param('accessKey') accessKey: string, @Res() res: Response) {
    const file = await this.service.getFiscalDocumentXml(accessKey);
    const xml = await fs.readFile(file.path);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${accessKey}.xml"`,
    );
    res.send(xml);
  }

  // One-shot: replays the existing ReconciliationMatch history into the alias
  // table, so the learner starts with the institutional memory already encoded
  // in past matches. Idempotent — repeated calls just increment confirmedCount.
  @Post('aliases/backfill')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async backfillAliases(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Math.min(50000, Math.max(1, parseInt(limit, 10))) : 5000;
    return this.aliases.backfillFromHistory(parsedLimit);
  }
}
