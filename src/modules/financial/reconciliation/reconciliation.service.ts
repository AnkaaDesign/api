import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReconciliationAliasSource,
  ReconciliationMatchStatus,
  ReconciliationMatchType,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionsFilterDto } from './dto/transactions-filter.dto';
import { FiscalDocumentsFilterDto } from './dto/fiscal-documents-filter.dto';
import { StatementsFilterDto } from './dto/statements-filter.dto';
import { ManualMatchDto } from './dto/manual-match.dto';
import { IgnoreTransactionDto } from './dto/ignore-transaction.dto';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
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
  ) {}

  async listStatements(filters: StatementsFilterDto) {
    const where: Prisma.BankStatementWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;
    if (filters.dateFrom || filters.dateTo) {
      where.periodStart = {};
      if (filters.dateFrom) (where.periodStart as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      if (filters.dateTo) (where.periodStart as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
    }
    const [data, total] = await Promise.all([
      this.prisma.bankStatement.findMany({
        where,
        orderBy: { [filters.sortBy]: filters.sortDir },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: { uploadedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.bankStatement.count({ where }),
    ]);

    // matchedCount on BankStatement is a denormalized counter set during import
    // and can drift after manual match/unmatch/ignore. Always recompute it from
    // actual transaction statuses so the UI shows the truth.
    const ids = data.map(s => s.id);
    const matchedByStatement = ids.length
      ? await this.computeMatchedCountsByStatement(ids)
      : new Map<string, number>();

    return {
      data: data.map(s => ({ ...s, matchedCount: matchedByStatement.get(s.id) ?? 0 })),
      meta: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
    };
  }

  async getStatement(id: string) {
    const statement = await this.prisma.bankStatement.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        rawFile: true,
      },
    });
    if (!statement) throw new NotFoundException('Extrato não encontrado');
    const counts = await this.prisma.bankTransaction.groupBy({
      by: ['matchStatus'],
      where: { statementId: id },
      _count: { _all: true },
    });
    const matchedCount = counts
      .filter(
        c =>
          c.matchStatus === ReconciliationMatchStatus.AUTO_MATCHED ||
          c.matchStatus === ReconciliationMatchStatus.MANUAL_MATCHED,
      )
      .reduce((sum, c) => sum + c._count._all, 0);
    return { ...statement, matchedCount, statusCounts: counts };
  }

  /**
   * Recompute `matchedCount` from authoritative transaction states for the
   * given statements. AUTO_MATCHED + MANUAL_MATCHED count as matched. IGNORED
   * and PARTIAL do not — they're either resolved-but-not-matched or in-progress.
   */
  private async computeMatchedCountsByStatement(
    statementIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.bankTransaction.groupBy({
      by: ['statementId'],
      where: {
        statementId: { in: statementIds },
        matchStatus: {
          in: [
            ReconciliationMatchStatus.AUTO_MATCHED,
            ReconciliationMatchStatus.MANUAL_MATCHED,
          ],
        },
      },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const id of statementIds) map.set(id, 0);
    for (const r of rows) map.set(r.statementId, r._count._all);
    return map;
  }

  private async refreshStatementMatchedCount(statementId: string | null | undefined) {
    if (!statementId) return;
    const map = await this.computeMatchedCountsByStatement([statementId]);
    const matched = map.get(statementId) ?? 0;
    await this.prisma.bankStatement.update({
      where: { id: statementId },
      data: { matchedCount: matched },
    });
  }

  async listTransactions(filters: TransactionsFilterDto) {
    const where: Prisma.BankTransactionWhereInput = {};
    if (filters.statementId) where.statementId = filters.statementId;
    if (filters.matchStatus) where.matchStatus = filters.matchStatus;
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
          statement: { select: { id: true, periodStart: true, periodEnd: true } },
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
   * roundtrip: matched fiscal documents + linked bank slips + the source
   * statement. Required so deep links (?txId=…) can hydrate even when the
   * referenced row isn't on the current list page.
   */
  async getTransaction(transactionId: string) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: {
        statement: {
          select: { id: true, periodStart: true, periodEnd: true, bankName: true, ownerCnpj: true },
        },
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
   * matched transactions (and their statements) so the modal can show
   * date, amount, confidence and rationale per linked transaction.
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
                statementId: true,
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
    // Pull memo/type + statement.ownerCnpj up front: we need them both for the
    // allocation math and for the alias learning step below.
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        amount: true,
        statementId: true,
        memo: true,
        type: true,
        counterpartyCnpjCpf: true,
        statement: { select: { ownerCnpj: true } },
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
          matchStatus:
            payload.fiscalDocumentIds.length > 1
              ? ReconciliationMatchStatus.PARTIAL
              : ReconciliationMatchStatus.MANUAL_MATCHED,
        },
        include: { matches: true },
      });
    });

    await this.refreshStatementMatchedCount(tx.statementId);
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
      statement?: { ownerCnpj: string } | null;
    },
    fiscalDocumentIds: string[],
  ): Promise<void> {
    if (!tx.memo || fiscalDocumentIds.length === 0) return;
    try {
      const docs = await this.prisma.fiscalDocument.findMany({
        where: { id: { in: fiscalDocumentIds } },
        select: { emitCnpj: true, destCnpj: true, destCpf: true },
      });
      const ownerCnpj = tx.statement?.ownerCnpj ?? null;
      for (const doc of docs) {
        const counterparty =
          tx.counterpartyCnpjCpf || inferCounterpartyCnpj(doc, ownerCnpj);
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
        statement: { select: { ownerCnpj: true } },
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
          inferCounterpartyCnpj(m.fiscalDocument, tx.statement?.ownerCnpj ?? null);
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
          matchStatus: ReconciliationMatchStatus.UNMATCHED,
          bankSlipId: null,
        },
        include: { matches: true },
      });
    });
    await this.refreshStatementMatchedCount(tx.statementId);

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
      select: { id: true, statementId: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    const updated = await this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        matchStatus: ReconciliationMatchStatus.IGNORED,
        ignoredReason: payload.reason,
      },
    });
    await this.refreshStatementMatchedCount(tx.statementId);
    return updated;
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
