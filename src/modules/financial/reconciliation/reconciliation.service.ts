import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReconciliationAliasSource,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionsFilterDto } from './dto/transactions-filter.dto';
import { FiscalDocumentsFilterDto } from './dto/fiscal-documents-filter.dto';
import { ManualMatchDto } from './dto/manual-match.dto';
import { IgnoreTransactionDto } from './dto/ignore-transaction.dto';
import { ChangeCategoryDto } from './dto/change-category.dto';
import { ChangeItemCategoryDto } from './dto/change-item-category.dto';
import { ClassifyBatchDto } from './dto/classify-batch.dto';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import { ReconciliationClassifierService } from './reconciliation-classifier.service';
import { TransactionCategoryService } from './transaction-category.service';
import { ItemCategoryClassifierService } from './item-category-classifier.service';
import {
  ReconciliationAliasService,
  inferCounterpartyCnpj,
} from './reconciliation-alias.service';

// Categories included on every transaction list/detail response.
const CATEGORY_INCLUDE = {
  categories: {
    include: {
      category: {
        select: { id: true, name: true, slug: true, kind: true, color: true, isResolving: true, isRecurring: true },
      },
    },
  },
} satisfies Prisma.BankTransactionInclude;

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: ReconciliationMatcherService,
    private readonly aliasService: ReconciliationAliasService,
    private readonly classifier: ReconciliationClassifierService,
    private readonly categories: TransactionCategoryService,
    private readonly itemCategoryClassifier: ItemCategoryClassifierService,
  ) {}

  async listTransactions(filters: TransactionsFilterDto) {
    const where: Prisma.BankTransactionWhereInput = {};
    if (filters.reconciliationStatus) {
      where.reconciliationStatus = Array.isArray(filters.reconciliationStatus)
        ? { in: filters.reconciliationStatus }
        : filters.reconciliationStatus;
    }
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      const ids = filters.categoryIds;
      if (filters.categoryMatch === 'all') {
        // Transaction must carry every requested category.
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          ...ids.map(id => ({ categories: { some: { categoryId: id } } })),
        ];
      } else {
        where.categories = { some: { categoryId: { in: ids } } };
      }
    }
    if (filters.expectsFiscalDocument !== undefined) {
      where.expectsFiscalDocument = filters.expectsFiscalDocument;
    }
    if (filters.categorySource) {
      // Filter by provenance of the assigned category tags.
      where.categories = {
        ...(where.categories as Prisma.BankTransactionCategoryListRelationFilter),
        some: {
          ...((where.categories as { some?: object })?.some ?? {}),
          source: filters.categorySource,
        },
      };
    }
    if (filters.reconciliationSource) where.reconciliationSource = filters.reconciliationSource;
    if (filters.matchType) {
      // Filters to transactions whose latest non-reversed match has this type.
      // Useful for stats drill-down (e.g. "show me all FUZZY matches I should audit").
      where.matches = { some: { matchType: filters.matchType, reversedAt: null } };
    }
    if (filters.type) where.type = filters.type;
    if (filters.subtype) where.subtype = filters.subtype;
    if (filters.counterparty) {
      where.OR = [
        { counterpartyName: { contains: filters.counterparty, mode: 'insensitive' } },
        { counterpartyCnpjCpf: { contains: filters.counterparty } },
      ];
    }
    if (filters.search) {
      where.OR = [
        ...(where.OR ?? []),
        { memo: { contains: filters.search, mode: 'insensitive' } },
        { fitId: { contains: filters.search } },
      ];
    }
    if (filters.dateFrom || filters.dateTo) {
      where.postedAt = {};
      if (filters.dateFrom) (where.postedAt as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      if (filters.dateTo) (where.postedAt as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
    }
    if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
      where.amount = {};
      if (filters.amountMin !== undefined) (where.amount as Prisma.DecimalFilter).gte = filters.amountMin;
      if (filters.amountMax !== undefined) (where.amount as Prisma.DecimalFilter).lte = filters.amountMax;
    }
    const [data, total] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        orderBy: { [filters.sortBy]: filters.sortDir },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: {
          ...CATEGORY_INCLUDE,
          matches: {
            include: {
              fiscalDocument: {
                select: {
                  id: true,
                  accessKey: true,
                  docType: true,
                  totalValue: true,
                  emitName: true,
                  emitCnpj: true,
                  issueDate: true,
                },
              },
              bankSlip: { select: { id: true, nossoNumero: true, paidAmount: true } },
            },
          },
        },
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
    };
  }

  async getCandidates(transactionId: string) {
    return this.matcher.getCandidatesForTransaction(transactionId);
  }

  /**
   * Single-transaction fetch with everything the detail modal needs in one
   * roundtrip: matched fiscal documents + linked bank slips. Required so deep
   * links (?txId=…) can hydrate even when the referenced row isn't on the
   * current list page.
   */
  async getTransaction(transactionId: string) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: {
        ...CATEGORY_INCLUDE,
        matches: {
          include: {
            fiscalDocument: {
              select: {
                id: true,
                accessKey: true,
                docType: true,
                operationType: true,
                issueDate: true,
                totalValue: true,
                emitCnpj: true,
                emitName: true,
                destCnpj: true,
                destCpf: true,
                destName: true,
                nfNumber: true,
                status: true,
                items: {
                  orderBy: { createdAt: 'asc' },
                  select: {
                    id: true,
                    code: true,
                    description: true,
                    quantity: true,
                    unit: true,
                    unitValue: true,
                    totalValue: true,
                    ncm: true,
                    cfop: true,
                    categoryId: true,
                    categoryConfidence: true,
                    categorySource: true,
                    category: { select: { id: true, name: true, slug: true, color: true } },
                  },
                },
              },
            },
            bankSlip: {
              select: { id: true, nossoNumero: true, paidAmount: true },
            },
          },
        },
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    return tx;
  }

  /**
   * Single-fiscal-document fetch used by the NF detail modal. Includes the
   * matched transactions so the modal can show date, amount, confidence and
   * rationale per linked transaction.
   */
  async getFiscalDocument(fiscalDocumentId: string) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
      include: {
        matches: {
          include: {
            transaction: {
              select: {
                id: true,
                postedAt: true,
                amount: true,
                type: true,
                memo: true,
                counterpartyName: true,
                counterpartyCnpjCpf: true,
                bankCode: true,
                bankName: true,
                accountNumber: true,
              },
            },
          },
        },
        // Service/product lines for the NF detail modal. Ordered by creation
        // so NFe `det` lines preserve the SEFAZ-issued sequence.
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            code: true,
            description: true,
            quantity: true,
            unit: true,
            unitValue: true,
            totalValue: true,
            ncm: true,
            cfop: true,
            cest: true,
            ean: true,
            cst: true,
            discount: true,
            freight: true,
            taxes: true,
            categoryId: true,
            categoryConfidence: true,
            categorySource: true,
            category: { select: { id: true, name: true, slug: true, color: true } },
          },
        },
      },
    });
    if (!doc) throw new NotFoundException('Nota fiscal não encontrada');
    return doc;
  }

  /**
   * Sets (or clears) the category of a single NF line item. Marks the item
   * categorySource = MANUAL so the auto-classifier never overwrites the human's
   * choice. Returns the re-hydrated fiscal document so the detail page refreshes.
   */
  async changeItemCategory(
    itemId: string,
    payload: ChangeItemCategoryDto,
    _userId: string | undefined,
  ) {
    const item = await this.prisma.fiscalDocumentItem.findUnique({
      where: { id: itemId },
      select: { id: true, description: true, fiscalDocumentId: true },
    });
    if (!item) throw new NotFoundException('Item da nota fiscal não encontrado');

    if (payload.categoryId) {
      const snap = await this.categories.snapshot();
      if (!snap.byId.get(payload.categoryId)) {
        throw new BadRequestException('Categoria informada não existe');
      }
    }

    await this.prisma.fiscalDocumentItem.update({
      where: { id: itemId },
      data: {
        categoryId: payload.categoryId,
        categorySource: payload.categoryId ? ReconciliationSource.MANUAL : null,
        categoryConfidence: payload.categoryId ? 100 : null,
      },
    });

    // Best-effort learning: a manual item→category mapping is the cleanest
    // possible training signal. Never block the response on it.
    if (payload.saveAlias && payload.categoryId) {
      await this.itemCategoryClassifier
        .recordItemAlias(item.description, payload.categoryId)
        .catch(() => undefined);
    }

    return this.getFiscalDocument(item.fiscalDocumentId);
  }

  async manualMatch(
    transactionId: string,
    payload: ManualMatchDto,
    userId: string | undefined,
  ) {
    // Pull memo/type/ownerCnpj up front: we need them for the allocation math
    // and for the alias learning step below.
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        amount: true,
        memo: true,
        type: true,
        counterpartyCnpjCpf: true,
        ownerCnpj: true,
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    const txAmount = Math.abs(Number(tx.amount));

    // Sum allocations or fall back to equal split
    const allocByDoc = new Map<string, number>();
    if (payload.allocations && payload.allocations.length > 0) {
      for (const a of payload.allocations) allocByDoc.set(a.fiscalDocumentId, a.amount);
    } else {
      const split = txAmount / payload.fiscalDocumentIds.length;
      for (const id of payload.fiscalDocumentIds) allocByDoc.set(id, split);
    }
    const sum = [...allocByDoc.values()].reduce((a, b) => a + b, 0);
    if (Math.abs(sum - txAmount) > 0.05) {
      throw new BadRequestException(
        `Soma das alocações (R$${sum.toFixed(2)}) difere do valor da transação (R$${txAmount.toFixed(2)})`,
      );
    }

    const keepDocIds = [...allocByDoc.keys()];
    const updated = await this.prisma.$transaction(async tx2 => {
      // Drop any prior matches NOT in the new payload, so re-matching with a
      // different/smaller set can't leave stale (double-counted) matches behind.
      await tx2.reconciliationMatch.deleteMany({
        where: { transactionId, fiscalDocumentId: { notIn: keepDocIds } },
      });
      for (const [fiscalDocumentId, amount] of allocByDoc) {
        await tx2.reconciliationMatch.upsert({
          where: { transactionId_fiscalDocumentId: { transactionId, fiscalDocumentId } },
          create: {
            transactionId,
            fiscalDocumentId,
            allocatedAmount: amount,
            matchType: ReconciliationMatchType.MANUAL,
            confidenceScore: 100,
            matchedByUserId: userId ?? null,
            notes: payload.notes,
          },
          update: {
            allocatedAmount: amount,
            matchType: ReconciliationMatchType.MANUAL,
            matchedByUserId: userId ?? null,
            notes: payload.notes,
            reversedAt: null,
            reversedById: null,
          },
        });
      }
      return tx2.bankTransaction.update({
        where: { id: transactionId },
        data: {
          reconciliationStatus:
            payload.fiscalDocumentIds.length > 1
              ? ReconciliationStatus.PARTIAL
              : ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.MANUAL,
          expectsFiscalDocument: true,
          categorySource: ReconciliationSource.MANUAL,
        },
        include: { matches: true },
      });
    });

    await this.captureAliasesForMatch(tx, [...allocByDoc.keys()]);
    // Derive item categories from the freshly-linked NF(s).
    await this.itemCategoryClassifier.deriveForTransaction(transactionId);
    return updated;
  }

  /**
   * Records a MANUAL_MATCH alias for each (memo → counterparty CNPJ) pair the
   * user just confirmed. Failures here are logged but never propagated — alias
   * learning is best-effort metadata, not part of the user's match action.
   */
  private async captureAliasesForMatch(
    tx: {
      memo: string | null;
      type: import('@prisma/client').BankTransactionType;
      counterpartyCnpjCpf: string | null;
      ownerCnpj: string | null;
    },
    fiscalDocumentIds: string[],
  ): Promise<void> {
    if (!tx.memo || fiscalDocumentIds.length === 0) return;
    try {
      const docs = await this.prisma.fiscalDocument.findMany({
        where: { id: { in: fiscalDocumentIds } },
        select: { emitCnpj: true, destCnpj: true, destCpf: true },
      });
      for (const doc of docs) {
        const counterparty =
          tx.counterpartyCnpjCpf || inferCounterpartyCnpj(doc, tx.ownerCnpj);
        if (!counterparty) continue;
        await this.aliasService.recordMatchSuccess({
          memo: tx.memo,
          txType: tx.type,
          counterpartyCnpjCpf: counterparty,
          source: ReconciliationAliasSource.MANUAL_MATCH,
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to capture alias on manual match: ${err}`);
    }
  }

  async unmatch(transactionId: string, userId: string | undefined) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: {
        matches: {
          include: {
            fiscalDocument: {
              select: { emitCnpj: true, destCnpj: true, destCpf: true },
            },
          },
        },
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    if (tx.matches.length === 0) return tx;

    // Snapshot the (memo → counterparty) pairs being reversed so the alias
    // learner can decrement / disable the entries that helped create them.
    // We do this before the transaction since alias updates aren't critical
    // to the user action and we don't want to roll them into the same TX.
    const reversedCounterparties: string[] = [];
    if (tx.memo) {
      for (const m of tx.matches) {
        if (!m.fiscalDocument) continue;
        const cp =
          tx.counterpartyCnpjCpf ||
          inferCounterpartyCnpj(m.fiscalDocument, tx.ownerCnpj);
        if (cp) reversedCounterparties.push(cp);
      }
    }
    const matchedDocIds = tx.matches
      .map(m => m.fiscalDocumentId)
      .filter((id): id is string => Boolean(id));

    const updated = await this.prisma.$transaction(async tx2 => {
      await tx2.reconciliationMatch.updateMany({
        where: { transactionId },
        data: { reversedAt: new Date(), reversedById: userId ?? null },
      });
      await tx2.reconciliationMatch.deleteMany({ where: { transactionId } });
      // The NF link is gone, so the AUTO item-derived category tags it produced
      // are no longer justified. Drop them; MANUAL tags the user set stay.
      await tx2.bankTransactionCategory.deleteMany({
        where: { transactionId, source: ReconciliationSource.AUTO },
      });
      await tx2.fiscalDocumentItem.updateMany({
        where: { fiscalDocumentId: { in: matchedDocIds } },
        data: { categoryId: null, categoryConfidence: null, categorySource: null },
      });
      return tx2.bankTransaction.update({
        where: { id: transactionId },
        data: {
          reconciliationStatus: ReconciliationStatus.PENDING,
          reconciliationSource: null,
          // Still expects an NF — user un-matched intentionally; the matcher can
          // retry on the next run.
          bankSlipId: null,
        },
        include: { matches: true },
      });
    });

    for (const counterparty of reversedCounterparties) {
      try {
        await this.aliasService.recordReversal({
          memo: tx.memo,
          txType: tx.type,
          counterpartyCnpjCpf: counterparty,
        });
      } catch (err) {
        this.logger.warn(`Failed to record alias reversal: ${err}`);
      }
    }

    return updated;
  }

  async ignore(transactionId: string, payload: IgnoreTransactionDto) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    return this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: ReconciliationStatus.IGNORED,
        reconciliationSource: ReconciliationSource.MANUAL,
        ignoredReason: payload.reason,
      },
    });
  }

  /**
   * Sets the MANUAL category tags of a transaction. `categoryIds` is the full
   * authoritative set the user wants: tags not in it are removed, AUTO tags in
   * it are promoted to MANUAL, new ones are created. If any assigned category
   * is `isResolving` (a transaction-only category like Aluguel), the
   * transaction is marked RECONCILED without needing an NF — otherwise the
   * status is left as-is (item-derived categories never resolve on their own).
   * Optionally records an alias so future imports auto-classify.
   */
  async changeCategory(
    transactionId: string,
    payload: ChangeCategoryDto,
    userId: string | undefined,
  ) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        memo: true,
        type: true,
        counterpartyCnpjCpf: true,
        reconciliationStatus: true,
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');

    const ids = [...new Set(payload.categoryIds)];
    const snap = await this.categories.snapshot();
    const chosen = ids.map(id => snap.byId.get(id)).filter(Boolean);
    if (chosen.length !== ids.length) {
      throw new BadRequestException('Uma ou mais categorias informadas não existem');
    }
    const hasResolving = chosen.some(c => c!.isResolving);
    // Per-category amount split (only meaningful when >1 category). Categories
    // without an entry store null → the stats fallback handles them.
    const allocMap = new Map(
      (payload.allocations ?? []).map(a => [a.categoryId, a.allocatedAmount]),
    );

    await this.prisma.$transaction(async db => {
      // Drop tags no longer wanted.
      await db.bankTransactionCategory.deleteMany({
        where: { transactionId, categoryId: { notIn: ids.length ? ids : ['__none__'] } },
      });
      // Upsert the wanted set as MANUAL (converts AUTO tags to MANUAL).
      for (const id of ids) {
        const allocatedAmount = allocMap.has(id) ? allocMap.get(id)! : null;
        await db.bankTransactionCategory.upsert({
          where: { transactionId_categoryId: { transactionId, categoryId: id } },
          create: {
            transactionId,
            categoryId: id,
            source: ReconciliationSource.MANUAL,
            assignedById: userId ?? null,
            allocatedAmount,
          },
          update: {
            source: ReconciliationSource.MANUAL,
            assignedById: userId ?? null,
            confidence: null,
            allocatedAmount,
          },
        });
      }
      await db.bankTransaction.update({
        where: { id: transactionId },
        data: {
          categorySource: ReconciliationSource.MANUAL,
          classifiedAt: new Date(),
          ...(hasResolving
            ? {
                reconciliationStatus: ReconciliationStatus.RECONCILED,
                reconciliationSource: ReconciliationSource.MANUAL,
              }
            : {}),
        },
      });
    });

    // Persist an alias for the first resolving (transaction-only) category so
    // future imports with the same memo auto-classify.
    const aliasCategory = chosen.find(c => c!.isResolving) ?? chosen[0];
    if (payload.saveAlias && aliasCategory && tx.memo && tx.counterpartyCnpjCpf) {
      await this.aliasService
        .recordMatchSuccess({
          memo: tx.memo,
          txType: tx.type,
          counterpartyCnpjCpf: tx.counterpartyCnpjCpf,
          source: ReconciliationAliasSource.MANUAL_MATCH,
          categoryId: aliasCategory.id,
        })
        .catch(err => this.logger.warn(`Failed to save category alias: ${err}`));
    }

    // Train the item-category learner from this human correction (no-op unless
    // unambiguous — single item-derived/service category on a single-line NF).
    await this.itemCategoryClassifier
      .learnFromManual(
        transactionId,
        chosen.map(c => ({ id: c!.id, kind: c!.kind as string })),
      )
      .catch(err => this.logger.warn(`learnFromManual failed: ${err}`));

    return this.getTransaction(transactionId);
  }

  /**
   * Batch-classify transactions matching an optional filter. Used by the
   * "Reclassificar" admin action on the transactions list.
   */
  async classifyBatch(payload: ClassifyBatchDto) {
    const where: Prisma.BankTransactionWhereInput = {};
    if (payload.transactionIds && payload.transactionIds.length > 0) {
      where.id = { in: payload.transactionIds };
    }
    if (payload.reconciliationStatus) where.reconciliationStatus = payload.reconciliationStatus;
    if (payload.dateFrom || payload.dateTo) {
      where.postedAt = {};
      if (payload.dateFrom) (where.postedAt as Prisma.DateTimeFilter).gte = new Date(payload.dateFrom);
      if (payload.dateTo) (where.postedAt as Prisma.DateTimeFilter).lte = new Date(payload.dateTo);
    }
    return this.classifier.classifyBatch(Object.keys(where).length ? where : undefined);
  }

  /**
   * (Re)derives item categories for matched transactions in scope. Used by the
   * "Recategorizar" action and after bulk operations. Only touches transactions
   * that have a non-reversed fiscal-document match (item categories require an NF).
   */
  async categorize(payload: {
    transactionIds?: string[];
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{ processed: number; categorized: number }> {
    const where: Prisma.BankTransactionWhereInput = {
      matches: { some: { reversedAt: null, fiscalDocumentId: { not: null } } },
      // Skip transactions the user has manually categorized — auto-derivation
      // must not re-add guesses over a human decision.
      categories: { none: { source: ReconciliationSource.MANUAL } },
    };
    if (payload.transactionIds?.length) where.id = { in: payload.transactionIds };
    if (payload.dateFrom || payload.dateTo) {
      where.postedAt = {};
      if (payload.dateFrom) (where.postedAt as Prisma.DateTimeFilter).gte = new Date(payload.dateFrom);
      if (payload.dateTo) (where.postedAt as Prisma.DateTimeFilter).lte = new Date(payload.dateTo);
    }
    const txs = await this.prisma.bankTransaction.findMany({ where, select: { id: true } });
    let categorized = 0;
    for (const t of txs) {
      const n = await this.itemCategoryClassifier.deriveForTransaction(t.id);
      if (n > 0) categorized += 1;
    }
    return { processed: txs.length, categorized };
  }

  async listFiscalDocuments(filters: FiscalDocumentsFilterDto) {
    const where: Prisma.FiscalDocumentWhereInput = {};
    if (filters.docType) where.docType = filters.docType;
    if (filters.operationType) where.operationType = filters.operationType;
    if (filters.status) where.status = filters.status;
    if (filters.emitCnpj) where.emitCnpj = filters.emitCnpj;
    if (filters.destCnpj) where.destCnpj = filters.destCnpj;
    if (filters.search) {
      where.OR = [
        { accessKey: { contains: filters.search } },
        { emitName: { contains: filters.search, mode: 'insensitive' } },
        { destName: { contains: filters.search, mode: 'insensitive' } },
        { nfNumber: { contains: filters.search } },
      ];
    }
    if (filters.dateFrom || filters.dateTo) {
      where.issueDate = {};
      if (filters.dateFrom) (where.issueDate as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      if (filters.dateTo) (where.issueDate as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
    }
    if (filters.valueMin !== undefined || filters.valueMax !== undefined) {
      where.totalValue = {};
      if (filters.valueMin !== undefined) (where.totalValue as Prisma.DecimalFilter).gte = filters.valueMin;
      if (filters.valueMax !== undefined) (where.totalValue as Prisma.DecimalFilter).lte = filters.valueMax;
    }
    if (filters.hasMatch !== undefined) {
      if (filters.hasMatch) where.matches = { some: {} };
      else where.matches = { none: {} };
    }

    const [data, total] = await Promise.all([
      this.prisma.fiscalDocument.findMany({
        where,
        orderBy: { [filters.sortBy]: filters.sortDir },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: {
          matches: {
            select: {
              id: true,
              transaction: { select: { id: true, postedAt: true, amount: true } },
            },
          },
        },
      }),
      this.prisma.fiscalDocument.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
    };
  }

  async getFiscalDocumentXml(accessKey: string) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { accessKey },
      include: { rawXmlFile: true },
    });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado');
    if (!doc.rawXmlFile) throw new NotFoundException('XML não armazenado para este documento');
    return doc.rawXmlFile;
  }
}
