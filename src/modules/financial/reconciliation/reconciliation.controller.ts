import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
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
import { TransactionCategoryService } from './transaction-category.service';
import { CategoryFusionService } from './learning/category-fusion.service';
import { RecurrenceLearnerService } from './recurrence-learner.service';
import { OutflowForecastService } from './outflow-forecast.service';
import {
  listCategoriesQuerySchema,
  ListCategoriesQueryDto,
  createCategorySchema,
  CreateCategoryDto,
  updateCategorySchema,
  UpdateCategoryDto,
} from './dto/transaction-category.dto';
import {
  categorizeSchema,
  CategorizeDto,
  forecastQuerySchema,
  ForecastQueryDto,
} from './dto/categorize.dto';
import {
  outflowForecastQuerySchema,
  OutflowForecastQueryDto,
} from './dto/outflow-forecast.dto';
import { transactionsFilterSchema, TransactionsFilterDto } from './dto/transactions-filter.dto';
import {
  fiscalDocumentsFilterSchema,
  FiscalDocumentsFilterDto,
} from './dto/fiscal-documents-filter.dto';
import { statisticsFilterSchema, StatisticsFilterDto } from './dto/statistics-filter.dto';
import { manualMatchSchema, ManualMatchDto } from './dto/manual-match.dto';
import { ignoreTransactionSchema, IgnoreTransactionDto } from './dto/ignore-transaction.dto';
import { rerunMatchingSchema, RerunMatchingDto } from './dto/rerun-matching.dto';
import { changeCategorySchema, ChangeCategoryDto } from './dto/change-category.dto';
import { changeItemCategorySchema, ChangeItemCategoryDto } from './dto/change-item-category.dto';
import { classifyBatchSchema, ClassifyBatchDto } from './dto/classify-batch.dto';

@Controller('financial/reconciliation')
@Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
export class ReconciliationController {
  constructor(
    private readonly service: ReconciliationService,
    private readonly importService: ReconciliationImportService,
    private readonly matcher: ReconciliationMatcherService,
    private readonly stats: ReconciliationStatisticsService,
    private readonly xmlImport: ManualXmlImportService,
    private readonly aliases: ReconciliationAliasService,
    private readonly categories: TransactionCategoryService,
    private readonly fusion: CategoryFusionService,
    private readonly recurrence: RecurrenceLearnerService,
    private readonly outflowForecast: OutflowForecastService,
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
  async importXml(@UploadedFiles() body: { files?: Express.Multer.File[] }) {
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
  getCandidates(@Param('id') id: string, @Query('search') search?: string) {
    return this.service.getCandidates(id, search);
  }

  @Get('transactions/:id')
  getTransaction(@Param('id') id: string) {
    return this.service.getTransaction(id);
  }

  @Get('fiscal-documents/:id')
  getFiscalDocument(@Param('id') id: string) {
    return this.service.getFiscalDocument(id);
  }

  // Reverse of `transactions/:id/candidates`: candidate bank transactions that
  // could settle this fiscal document, so the user can conciliate from the NF
  // side. Same class-wide @Roles (ADMIN/FINANCIAL/ACCOUNTING) apply.
  @Get('fiscal-documents/:id/transaction-candidates')
  getTransactionCandidates(@Param('id') id: string) {
    return this.service.getTransactionCandidatesForFiscalDocument(id);
  }

  @Post('fiscal-documents/:id/unmatch')
  unmatchFiscalDocument(@Param('id') id: string, @Req() req: Request & { user?: { id?: string } }) {
    return this.service.unmatchFiscalDocument(id, req.user?.id);
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

  /**
   * Single "Reconciliar" pipeline: classify first (auto-reconciles
   * transaction-only categories like Tarifa/Folha/Tributo/...), then run the NF
   * scoring matcher on whatever still expects a fiscal document. The matcher, on
   * a successful link, also derives the NF's item categories.
   *
   * Returns both stages so the UI can summarize "X classificadas · Y conciliadas".
   */
  @Post('run')
  @UsePipes(new ZodValidationPipe(rerunMatchingSchema))
  async run(@Body() body: RerunMatchingDto) {
    const classified = await this.service.classifyBatch({
      transactionIds: body.transactionIds,
      dateFrom: body.dateStart,
      dateTo: body.dateEnd,
    });

    let matched: number;
    let bridged = 0;
    if (body.dateStart && body.dateEnd) {
      const start = new Date(body.dateStart);
      const end = new Date(body.dateEnd);
      matched = await this.matcher.matchDateRange(start, end);
      bridged = await this.matcher.bridgeBoletoCredits({ start, end });
    } else if (body.transactionIds && body.transactionIds.length > 0) {
      matched = await this.matcher.matchByIds(body.transactionIds);
      bridged = await this.matcher.bridgeBoletoCredits({ ids: body.transactionIds });
    } else {
      // Global re-run for all PENDING transactions expecting a fiscal document.
      matched = await this.matcher.matchAll();
      bridged = await this.matcher.bridgeBoletoCredits();
    }
    // Boleto liquidations are bridged to their PAID slip alongside NF matching.
    matched += bridged;
    // Single "Verificar" pipeline also (re)derives item categories over the same
    // scope, so one action classifies, matches AND categorizes.
    const categorized = await this.service.categorize({
      transactionIds: body.transactionIds,
      dateFrom: body.dateStart,
      dateTo: body.dateEnd,
    });
    // STAGE 4: back-fill categories on reconciled-but-uncategorized transactions
    // from learned counterparty/alias history. A tx matched to an NF (or matched
    // in an earlier run) before its counterparty was ever categorized ends up
    // RECONCILED without a category; now that the history exists, apply it. Folded
    // into the "categorizadas" count the UI already shows.
    const backfilled = await this.service.backfillCategoriesFromHistory({
      transactionIds: body.transactionIds,
      dateFrom: body.dateStart,
      dateTo: body.dateEnd,
    });
    return {
      classified,
      matched,
      categorized: categorized.categorized + backfilled.categorized,
    };
  }

  // ----- taxonomy (categories) --------------------------------------------

  @Get('categories')
  @UsePipes(new ZodValidationPipe(listCategoriesQuerySchema))
  listCategories(@Query() query: ListCategoriesQueryDto) {
    return this.categories.list(query);
  }

  @Post('categories')
  @UsePipes(new ZodValidationPipe(createCategorySchema))
  createCategory(@Body() payload: CreateCategoryDto) {
    return this.categories.create(payload);
  }

  @Post('categories/:id')
  @UsePipes(new ZodValidationPipe(updateCategorySchema))
  updateCategory(@Param('id') id: string, @Body() payload: UpdateCategoryDto) {
    return this.categories.update(id, payload);
  }

  @Post('categories/:id/delete')
  deleteCategory(@Param('id') id: string) {
    return this.categories.remove(id);
  }

  // Re-run the fuzzy item categorizer over matched transactions in scope.
  @Post('categorize')
  @UsePipes(new ZodValidationPipe(categorizeSchema))
  categorize(@Body() payload: CategorizeDto) {
    return this.service.categorize(payload);
  }

  // Composite "Previsão de Saídas" (spec §4.3): open orders + scheduled orders,
  // approximate taxes (3-month average), payroll aggregate (with bonus) and the
  // recurring forecast — composed server-side so payroll stays aggregate-only.
  @Get('outflow-forecast')
  @UsePipes(new ZodValidationPipe(outflowForecastQuerySchema))
  getOutflowForecast(@Query() query: OutflowForecastQueryDto) {
    return this.outflowForecast.forecast(query.reference);
  }

  // Recurring monthly payables view.
  @Get('recurring/forecast')
  @UsePipes(new ZodValidationPipe(forecastQuerySchema))
  forecast(@Query() query: ForecastQueryDto) {
    return this.categories.forecast(new Date(query.from), new Date(query.to));
  }

  @Post('transactions/:id/category')
  @UsePipes(new ZodValidationPipe(changeCategorySchema))
  changeCategory(
    @Param('id') id: string,
    @Body() payload: ChangeCategoryDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.changeCategory(id, payload, req.user?.id);
  }

  @Post('fiscal-documents/items/:id/category')
  @UsePipes(new ZodValidationPipe(changeItemCategorySchema))
  changeItemCategory(
    @Param('id') id: string,
    @Body() payload: ChangeItemCategoryDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.changeItemCategory(id, payload, req.user?.id);
  }

  @Post('classify')
  @UsePipes(new ZodValidationPipe(classifyBatchSchema))
  classify(@Body() payload: ClassifyBatchDto) {
    return this.service.classifyBatch(payload);
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
    let xml: Buffer;
    try {
      xml = await fs.readFile(file.path);
    } catch (error: any) {
      // The File row may reference a path that no longer exists on disk
      // (e.g. restored DB without the uploads volume). Surface as 404, not 500.
      if (error?.code === 'ENOENT') {
        throw new NotFoundException('Arquivo XML não encontrado no armazenamento.');
      }
      throw error;
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${accessKey}.xml"`);
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

  // ----- self-learning layer ----------------------------------------------

  // "Why was this categorized?" — live fused decision + per-learner confidence
  // breakdown + the persisted decision history.
  @Get('transactions/:id/explain')
  explain(@Param('id') id: string) {
    return this.fusion.explain(id);
  }

  // Inbox of medium-confidence SUGGEST-tier proposals awaiting one-click confirm.
  @Get('suggestions')
  listSuggestions() {
    return this.service.listSuggestions();
  }

  // Promote a stored suggestion to a MANUAL category (one click → also trains).
  @Post('transactions/:id/suggestion/confirm')
  confirmSuggestion(
    @Param('id') id: string,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.confirmSuggestion(id, req.user?.id);
  }

  // Learned per-counterparty cadence + expected-amount forecast with anomaly
  // flags (distinct from the static isRecurring forecast above).
  @Get('recurring/learned-forecast')
  learnedForecast(@Query('reference') reference?: string) {
    return this.recurrence.forecast(reference ? new Date(reference) : new Date());
  }

  // Admin: list learned rules across the counterparty/memo/emitter learners.
  @Get('learned-rules')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  listLearnedRules(@Query('kind') kind?: string) {
    return this.fusion.listRules(kind);
  }

  // Admin: soft-disable a learned rule (sets disabledAt; never hard-deletes).
  @Post('learned-rules/:kind/:id/disable')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  disableLearnedRule(@Param('kind') kind: string, @Param('id') id: string) {
    return this.fusion.setRuleDisabled(kind, id, true);
  }

  @Post('learned-rules/:kind/:id/enable')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  enableLearnedRule(@Param('kind') kind: string, @Param('id') id: string) {
    return this.fusion.setRuleDisabled(kind, id, false);
  }
}
