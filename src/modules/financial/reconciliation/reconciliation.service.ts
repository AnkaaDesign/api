import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReconciliationAliasSource,
  ReconciliationCategory,
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
import { ClassifyBatchDto } from './dto/classify-batch.dto';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import {
  ReconciliationClassifierService,
  SELF_JUSTIFYING_CATEGORIES,
} from './reconciliation-classifier.service';
import {
  ReconciliationAliasService,
  inferCounterpartyCnpj,
} from './reconciliation-alias.service';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: ReconciliationMatcherService,
    private readonly aliasService: ReconciliationAliasService,
    private readonly classifier: ReconciliationClassifierService,
  ) {}

  async listTransactions(filters: TransactionsFilterDto) {
    const where: Prisma.BankTransactionWhereInput = {};
    if (filters.reconciliationStatus) {
      where.reconciliationStatus = Array.isArray(filters.reconciliationStatus)
        ? { in: filters.reconciliationStatus }
        : filters.reconciliationStatus;
    }
    if (filters.category) {
      where.category = Array.isArray(filters.category)
        ? { in: filters.category }
        : filters.category;
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
          },
        },
      },
    });
    if (!doc) throw new NotFoundException('Nota fiscal não encontrada');
    return doc;
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

    const updated = await this.prisma.$transaction(async tx2 => {
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
          category: ReconciliationCategory.NF,
          categorySource: ReconciliationSource.MANUAL,
        },
        include: { matches: true },
      });
    });

    await this.captureAliasesForMatch(tx, [...allocByDoc.keys()]);
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

    const updated = await this.prisma.$transaction(async tx2 => {
      await tx2.reconciliationMatch.updateMany({
        where: { transactionId },
        data: { reversedAt: new Date(), reversedById: userId ?? null },
      });
      await tx2.reconciliationMatch.deleteMany({ where: { transactionId } });
      return tx2.bankTransaction.update({
        where: { id: transactionId },
        data: {
          reconciliationStatus: ReconciliationStatus.PENDING,
          reconciliationSource: null,
          // Reset category so the classifier re-evaluates on next run; the user
          // un-matched intentionally, so we drop NF and let regex/alias decide.
          category: ReconciliationCategory.UNCLASSIFIED,
          categorySource: null,
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
   * Sets a category manually. For self-justifying categories the status flips
   * to RECONCILED (with source=MANUAL). For NF, status returns to PENDING so
   * the matcher can pick it up. Optionally records an alias for future imports.
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
        matches: { select: { id: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');

    const isSelfJustifying = SELF_JUSTIFYING_CATEGORIES.has(payload.category);
    const becomesNF = payload.category === ReconciliationCategory.NF;

    // If the transaction has live NF matches and the new category isn't NF,
    // refuse — the user should unmatch first to avoid an inconsistent record.
    if (!becomesNF && tx.matches.length > 0) {
      throw new BadRequestException(
        'Desfaça os vínculos com NF antes de alterar a categoria desta transação',
      );
    }

    const updated = await this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        category: payload.category,
        categorySource: ReconciliationSource.MANUAL,
        classifiedAt: new Date(),
        ...(isSelfJustifying
          ? {
              reconciliationStatus: ReconciliationStatus.RECONCILED,
              reconciliationSource: ReconciliationSource.MANUAL,
            }
          : becomesNF
            ? {
                // Reset to PENDING so the matcher can pick it up.
                reconciliationStatus: ReconciliationStatus.PENDING,
                reconciliationSource: null,
              }
            : {}),
        ...(payload.notes ? { ignoredReason: payload.notes } : {}),
      },
    });

    if (payload.saveAlias && tx.memo && tx.counterpartyCnpjCpf) {
      await this.aliasService
        .recordMatchSuccess({
          memo: tx.memo,
          txType: tx.type,
          counterpartyCnpjCpf: tx.counterpartyCnpjCpf,
          source: ReconciliationAliasSource.MANUAL_MATCH,
          category: payload.category,
        })
        .catch(err => this.logger.warn(`Failed to save category alias: ${err}`));
    }

    return updated;
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
    if (payload.category) where.category = payload.category;
    if (payload.dateFrom || payload.dateTo) {
      where.postedAt = {};
      if (payload.dateFrom) (where.postedAt as Prisma.DateTimeFilter).gte = new Date(payload.dateFrom);
      if (payload.dateTo) (where.postedAt as Prisma.DateTimeFilter).lte = new Date(payload.dateTo);
    }
    return this.classifier.classifyBatch(Object.keys(where).length ? where : undefined);
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
