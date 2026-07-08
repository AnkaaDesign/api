import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  FiscalDocumentOperation,
  Prisma,
  ReconciliationAdjustmentReason as AdjustmentReason,
  ReconciliationAliasSource,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionsFilterDto } from './dto/transactions-filter.dto';
import { FiscalDocumentsFilterDto } from './dto/fiscal-documents-filter.dto';
import { ManualMatchDto } from './dto/manual-match.dto';
import { OffBankResolutionDto } from './dto/off-bank-resolution.dto';
import { IgnoreTransactionDto } from './dto/ignore-transaction.dto';
import { ChangeCategoryDto } from './dto/change-category.dto';
import { ChangeItemCategoryDto } from './dto/change-item-category.dto';
import { ClassifyBatchDto } from './dto/classify-batch.dto';
import {
  ReconciliationMatcherService,
  RECON_ADVISORY_LOCK_KEY,
  TOP_MATCH_SCORE_BADGE_FLOOR,
} from './reconciliation-matcher.service';
import { ReconciliationClassifierService } from './reconciliation-classifier.service';
import { TransactionCategoryService } from './transaction-category.service';
import { ItemCategoryClassifierService } from './item-category-classifier.service';
import { ReconciliationAliasService, inferCounterpartyCnpj } from './reconciliation-alias.service';
import { CounterpartyLearningService } from './counterparty-learning.service';
import { MemoCategoryLearnerService } from './memo-category-learner.service';
import { FiscalDerivedLearnerService } from './fiscal-derived-learner.service';
import { RecurrenceLearnerService } from './recurrence-learner.service';
import { CategoryFusionService } from './learning/category-fusion.service';
import { OrderService } from '../../inventory/order/order.service';
import { LearnedRuleSource } from '@prisma/client';
import { memoFingerprint } from './text-normalization';

// Categories included on every transaction list/detail response.
const CATEGORY_INCLUDE = {
  categories: {
    include: {
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          kind: true,
          color: true,
          isResolving: true,
          isRecurring: true,
          // Chart-of-accounts rollup (grupo contábil) — surfaced in the Extrato
          // category column and on the transaction detail page.
          accountingType: true,
        },
      },
    },
  },
} satisfies Prisma.BankTransactionInclude;

/**
 * Receivable installment context shown on a reconciled inflow — parcela, NF
 * total and cliente/tarefa — so the detail page can say what a CREDIT settled.
 * Shared by both the direct (installment) and boleto (bankSlip → installment)
 * match paths.
 */
const INSTALLMENT_RECEIVABLE_SELECT = {
  id: true,
  number: true,
  dueDate: true,
  amount: true,
  paidAmount: true,
  paidAt: true,
  status: true,
  invoice: {
    select: {
      id: true,
      totalAmount: true,
      status: true,
      customer: { select: { id: true, fantasyName: true, corporateName: true, cnpj: true } },
      task: { select: { id: true, name: true, serialNumber: true } },
      installments: { select: { id: true } },
    },
  },
  // Faturamento (task-quote) receivables have no Invoice row — they hang off a
  // TaskQuoteCustomerConfig instead. Selected so normalizeInstallmentInvoice()
  // below can synthesize the same shape the detail page reads off `invoice`.
  customerConfig: {
    select: {
      id: true,
      total: true,
      customer: { select: { id: true, fantasyName: true, corporateName: true, cnpj: true } },
      quote: { select: { task: { select: { id: true, name: true, serialNumber: true } } } },
      _count: { select: { installments: true } },
    },
  },
} satisfies Prisma.InstallmentSelect;

type InstallmentReceivable = Prisma.InstallmentGetPayload<{ select: typeof INSTALLMENT_RECEIVABLE_SELECT }>;

/**
 * Normalizes a receivable installment onto a single `invoice`-shaped view,
 * regardless of whether it's backed by a classic Invoice or a Faturamento
 * TaskQuoteCustomerConfig — so the detail page can read `installment.invoice`
 * without caring which source it came from (mirrors the fallback pattern in
 * receivable-match.service.ts / receivables.service.ts).
 */
function normalizeInstallmentInvoice(inst: InstallmentReceivable) {
  const { customerConfig, invoice, ...rest } = inst;
  if (invoice) {
    return {
      ...rest,
      invoice: {
        id: invoice.id,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
        customer: invoice.customer,
        task: invoice.task,
        installmentsCount: invoice.installments.length,
      },
    };
  }
  if (customerConfig) {
    return {
      ...rest,
      invoice: {
        id: customerConfig.id,
        totalAmount: customerConfig.total,
        status: rest.status,
        customer: customerConfig.customer,
        task: customerConfig.quote?.task ?? null,
        installmentsCount: customerConfig._count.installments,
      },
    };
  }
  return { ...rest, invoice: null };
}

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
    private readonly counterpartyLearning: CounterpartyLearningService,
    private readonly memoLearner: MemoCategoryLearnerService,
    private readonly fiscalLearner: FiscalDerivedLearnerService,
    private readonly recurrenceLearner: RecurrenceLearnerService,
    private readonly fusion: CategoryFusionService,
    private readonly orderService: OrderService,
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
      if (filters.dateFrom)
        (where.postedAt as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      if (filters.dateTo) (where.postedAt as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
    }
    if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
      where.amount = {};
      if (filters.amountMin !== undefined)
        (where.amount as Prisma.DecimalFilter).gte = filters.amountMin;
      if (filters.amountMax !== undefined)
        (where.amount as Prisma.DecimalFilter).lte = filters.amountMax;
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
            where: { reversedAt: null },
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

  async getCandidates(transactionId: string, search?: string) {
    const candidates = await this.matcher.getCandidatesForTransaction(transactionId, { search });
    // Keep the stored topMatchScore fresh so the Extrato list badge matches what
    // the detail page shows. The score is a snapshot written at import/daily-job
    // time and goes stale as NFs are imported/matched elsewhere; recomputing it
    // here (on the actual candidate query, no extra work) is the cheapest way to
    // converge the two views. Only for a real (non-search) fetch of an unresolved
    // transaction, best-effort, never blocking the response.
    if (!search) {
      // Badge only a genuinely promising candidate. The candidate list now
      // includes weak proximity notes (so the user can still try a manual
      // reconciliation on intermediary-routed boletos), but those must not light
      // up the extrato — keep the chip gated at the badge floor.
      const best = candidates.length ? candidates[0].confidence : null;
      const top = best != null && best >= TOP_MATCH_SCORE_BADGE_FLOOR ? Math.round(best) : null;
      this.prisma.bankTransaction
        .updateMany({
          where: {
            id: transactionId,
            reconciliationStatus: {
              in: [ReconciliationStatus.PENDING, ReconciliationStatus.PARTIAL],
            },
          },
          data: { topMatchScore: top },
        })
        .catch(() => undefined);
    }
    return candidates;
  }

  /**
   * Reverse of {@link getCandidates}: candidate bank transactions that could
   * settle the given fiscal document, for conciliating from the NF side. Thin
   * passthrough — the matcher owns the scoring/proximity logic and has no side
   * effects here (unlike getCandidates, which refreshes topMatchScore).
   */
  getTransactionCandidatesForFiscalDocument(fiscalDocumentId: string) {
    return this.matcher.getTransactionCandidatesForFiscalDocument(fiscalDocumentId);
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
          where: { reversedAt: null },
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
                // Purchase-order codes (#Ped:) so "Notas vinculadas" can show
                // the order number next to each NF and group the NFs of one
                // order settled by this single transaction.
                orderCodes: { select: { code: true }, orderBy: { code: 'asc' } },
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
              select: {
                id: true,
                nossoNumero: true,
                paidAmount: true,
                // Boleto liquidation (Sicredi) matches link via the slip; the
                // receivable it settled hangs off the slip's installment.
                installment: { select: INSTALLMENT_RECEIVABLE_SELECT },
              },
            },
            // Receivable (entrada) matches link a CREDIT to an Installment.
            // Nest invoice → customer/task so the detail page can show what
            // the credit was conciliated against (parcela, NF, cliente).
            installment: { select: INSTALLMENT_RECEIVABLE_SELECT },
          },
        },
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    return {
      ...tx,
      matches: tx.matches.map(m => ({
        ...m,
        installment: m.installment ? normalizeInstallmentInvoice(m.installment) : m.installment,
        bankSlip: m.bankSlip
          ? {
              ...m.bankSlip,
              installment: m.bankSlip.installment
                ? normalizeInstallmentInvoice(m.bankSlip.installment)
                : m.bankSlip.installment,
            }
          : m.bankSlip,
      })),
    };
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
        // Purchase-order codes parsed from infCpl (#Ped:) — shown on the NF
        // detail and used by order-group reconciliation.
        orderCodes: { select: { code: true }, orderBy: { code: 'asc' } },
        // Billing link for SAIDA (emitted) notes — the faturamento/orçamento the
        // note was generated from. The detail page surfaces it as "Orçamento /
        // Faturamento" instead of a (never-existing) bank transaction.
        nfseDocument: {
          select: { id: true, invoiceId: true, taskId: true, nfseNumber: true },
        },
        matches: {
          where: { reversedAt: null },
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

    // Re-derive the category tags of every transaction matched to this NF so the
    // change is reflected wherever those tags are read (notably the Extrato list
    // CATEGORIA column, which renders BankTransactionCategory — not the item's
    // own category). deriveForTransaction skips transactions the user has
    // categorized manually at the transaction level. Best-effort.
    const linkedMatches = await this.prisma.reconciliationMatch.findMany({
      where: { fiscalDocumentId: item.fiscalDocumentId, reversedAt: null },
      select: { transactionId: true },
    });
    for (const txId of new Set(linkedMatches.map(m => m.transactionId))) {
      await this.itemCategoryClassifier
        .deriveForTransaction(txId)
        .catch(() => undefined);
    }

    return this.getFiscalDocument(item.fiscalDocumentId);
  }

  async manualMatch(transactionId: string, payload: ManualMatchDto, userId: string | undefined) {
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
        counterpartyName: true,
        ownerCnpj: true,
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    const txAmount = Math.abs(Number(tx.amount));

    // Sum allocations or fall back to equal split
    const allocByDoc = new Map<string, number>();
    // Per-note shortfall write-off (paid LESS than the note): amount + reason.
    const adjByDoc = new Map<string, { amount: number; reason: AdjustmentReason }>();
    if (payload.allocations && payload.allocations.length > 0) {
      for (const a of payload.allocations) {
        allocByDoc.set(a.fiscalDocumentId, a.amount);
        // Signed: positive = discount (paid less), negative = surcharge (paid more).
        if (a.adjustmentReason && a.adjustmentAmount && Math.abs(a.adjustmentAmount) > 0.005) {
          adjByDoc.set(a.fiscalDocumentId, {
            amount: a.adjustmentAmount,
            reason: a.adjustmentReason,
          });
        }
      }
    } else {
      const split = txAmount / payload.fiscalDocumentIds.length;
      for (const id of payload.fiscalDocumentIds) allocByDoc.set(id, split);
    }
    const sum = [...allocByDoc.values()].reduce((a, b) => a + b, 0);
    // The part of the payment NOT backed by an NF (frete, seguro estendido,
    // taxas de marketplace…) can be RESOLVED with a reason instead of a category
    // tag. When a reason is given, the remainder counts as accounted-for, so an
    // NF worth LESS than the payment still fully reconciles — instead of
    // stranding it as PARTIAL. No reason → the remainder stays open (PARTIAL).
    const REMAINDER_LABELS: Record<string, string> = {
      FRETE: 'Frete',
      SEGURO: 'Seguro',
      TAXAS: 'Taxas',
      ITEM_SEM_NOTA: 'Item sem nota',
      OUTROS: 'Outros',
    };
    const remainder = Number((txAmount - sum).toFixed(2));
    const remainderResolved = payload.remainderReason != null && remainder > 0.05;
    // Reject only OVER-allocation (NF worth more than the payment is never
    // valid). Under-coverage is allowed: the remainder is either resolved by a
    // reason (→ RECONCILED) or left open (→ PARTIAL).
    if (sum > txAmount + 0.05) {
      throw new BadRequestException(
        `Soma das alocações (R$${sum.toFixed(2)}) excede o valor da transação (R$${txAmount.toFixed(2)})`,
      );
    }

    const keepDocIds = [...allocByDoc.keys()];

    // When the remainder is resolved by a reason, fold a human-readable note
    // ("Restante R$316,00 → Frete") into the match/transaction notes so the
    // reason is visible without a category tag.
    const matchNotes = remainderResolved
      ? [
          payload.notes,
          `Restante R$${remainder.toFixed(2)} → ${REMAINDER_LABELS[payload.remainderReason!]}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : payload.notes;

    const updated = await this.prisma.$transaction(async tx2 => {
      // Serialize against the auto-matcher and other manual matches so the
      // over-allocation guard below is a race-free check-then-write.
      await tx2.$executeRaw`SELECT pg_advisory_xact_lock(${RECON_ADVISORY_LOCK_KEY})`;

      // Over-allocation guard: an NF may legitimately be split across several
      // transactions (installments/parcelas), but the cumulative allocation
      // across ALL of them must never exceed the NF total. Sum the non-reversed
      // allocations already pointing at each NF from OTHER transactions and
      // reject if adding this transaction's allocation would push it past the
      // NF total. Runs inside the locked transaction to close the TOCTOU window.
      const docs = await tx2.fiscalDocument.findMany({
        where: { id: { in: keepDocIds } },
        select: { id: true, totalValue: true, nfNumber: true },
      });
      const totalById = new Map(docs.map(d => [d.id, Number(d.totalValue)]));
      const otherMatches = await tx2.reconciliationMatch.findMany({
        where: {
          fiscalDocumentId: { in: keepDocIds },
          reversedAt: null,
          transactionId: { not: transactionId },
        },
        select: { fiscalDocumentId: true, allocatedAmount: true, adjustmentAmount: true },
      });
      const otherAllocById = new Map<string, number>();
      for (const m of otherMatches) {
        if (!m.fiscalDocumentId) continue;
        // "Already settled" by other transactions = what they paid PLUS what they
        // wrote off (a prior discount slice), so a note can't be over-settled.
        otherAllocById.set(
          m.fiscalDocumentId,
          (otherAllocById.get(m.fiscalDocumentId) ?? 0) +
            Number(m.allocatedAmount) +
            Number(m.adjustmentAmount ?? 0),
        );
      }
      for (const [docId, amount] of allocByDoc) {
        const docTotal = totalById.get(docId);
        if (docTotal == null) continue;
        const already = otherAllocById.get(docId) ?? 0;
        const adjustment = adjByDoc.get(docId)?.amount ?? 0;
        // Paid slice + written-off slice together must not exceed the note total.
        if (already + amount + adjustment > docTotal + 0.05) {
          const nf = docs.find(d => d.id === docId);
          const label = nf?.nfNumber ? `NF ${nf.nfNumber}` : 'A nota fiscal';
          const extra = adjustment > 0 ? ` + desconto R$${adjustment.toFixed(2)}` : '';
          throw new BadRequestException(
            `${label} já possui R$${already.toFixed(2)} alocados em outras transações; ` +
              `alocar mais R$${amount.toFixed(2)}${extra} excederia o total da nota ` +
              `(R$${docTotal.toFixed(2)})`,
          );
        }
      }

      // Drop any prior matches NOT in the new payload, so re-matching with a
      // different/smaller set can't leave stale (double-counted) matches behind.
      await tx2.reconciliationMatch.deleteMany({
        where: { transactionId, fiscalDocumentId: { notIn: keepDocIds } },
      });
      for (const [fiscalDocumentId, amount] of allocByDoc) {
        const adj = adjByDoc.get(fiscalDocumentId);
        await tx2.reconciliationMatch.upsert({
          where: { transactionId_fiscalDocumentId: { transactionId, fiscalDocumentId } },
          create: {
            transactionId,
            fiscalDocumentId,
            allocatedAmount: amount,
            adjustmentAmount: adj?.amount ?? null,
            adjustmentReason: adj?.reason ?? null,
            matchType: ReconciliationMatchType.MANUAL,
            confidenceScore: 100,
            matchedByUserId: userId ?? null,
            notes: matchNotes,
          },
          update: {
            allocatedAmount: amount,
            // Re-saving without a reason clears any prior write-off on this note.
            adjustmentAmount: adj?.amount ?? null,
            adjustmentReason: adj?.reason ?? null,
            matchType: ReconciliationMatchType.MANUAL,
            matchedByUserId: userId ?? null,
            notes: matchNotes,
            reversedAt: null,
            reversedById: null,
          },
        });
      }

      return tx2.bankTransaction.update({
        where: { id: transactionId },
        data: {
          // Status reflects COVERAGE. The NF(s) cover the payment in full
          // (RECONCILED), OR they cover it partially but the non-NF remainder is
          // resolved by a reason (frete/seguro/taxas → also RECONCILED). Only an
          // under-covered tx with an UNRESOLVED remainder stays PARTIAL. Keeps
          // manual matches consistent with the auto order-group/subset passes and
          // avoids stats double-counting PARTIAL as both "pending" and "matched".
          reconciliationStatus:
            Math.abs(sum - txAmount) <= 0.05 || remainderResolved
              ? ReconciliationStatus.RECONCILED
              : ReconciliationStatus.PARTIAL,
          reconciliationSource: ReconciliationSource.MANUAL,
          expectsFiscalDocument: true,
          categorySource: ReconciliationSource.MANUAL,
          // Tx is now reconciled — drop the stale best-candidate score so the
          // list badge stops showing "Pendente · NN%".
          topMatchScore: null,
        },
        include: { matches: true },
      });
    });

    await this.captureAliasesForMatch(tx, [...allocByDoc.keys()]);
    // Derive item categories from the freshly-linked NF(s).
    await this.itemCategoryClassifier.deriveForTransaction(transactionId);
    // Learn emitter→category priors + per-counterparty recurrence from the
    // confirmed match. Best-effort — never blocks the match action.
    await this.fiscalLearner
      .learnFromTransaction(transactionId, { manual: true })
      .catch(err => this.logger.warn(`fiscal learnFromTransaction failed: ${err}`));

    // Auto-settle boleto order installments for any NF that was just reconciled.
    // Best-effort and outside the match transaction — never blocks the match.
    for (const [fiscalDocumentId, allocated] of allocByDoc.entries()) {
      await this.orderService
        .settleInstallmentsForFiscalDocument(fiscalDocumentId, allocated, userId)
        .catch(err =>
          this.logger.warn(`settleInstallmentsForFiscalDocument failed: ${err}`),
        );
    }

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
      counterpartyName: string | null;
      ownerCnpj: string | null;
    },
    fiscalDocumentIds: string[],
  ): Promise<void> {
    if (fiscalDocumentIds.length === 0) return;
    try {
      const docs = await this.prisma.fiscalDocument.findMany({
        where: { id: { in: fiscalDocumentIds } },
        select: { emitCnpj: true, destCnpj: true, destCpf: true },
      });
      for (const doc of docs) {
        const counterparty = tx.counterpartyCnpjCpf || inferCounterpartyCnpj(doc, tx.ownerCnpj);
        if (!counterparty) continue;
        // Memo alias needs a memo; counterparty identity does not.
        if (tx.memo) {
          await this.aliasService.recordMatchSuccess({
            memo: tx.memo,
            txType: tx.type,
            counterpartyCnpjCpf: counterparty,
            source: ReconciliationAliasSource.MANUAL_MATCH,
          });
        }
        // Learn the name→CNPJ identity (no category here — a match confirms who,
        // not what). AUTO-sourced so it can never bootstrap a category alone.
        await this.counterpartyLearning.record({
          counterpartyCnpjCpf: counterparty,
          counterpartyName: tx.counterpartyName,
          txType: tx.type,
          source: LearnedRuleSource.AUTO,
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
        const cp = tx.counterpartyCnpjCpf || inferCounterpartyCnpj(m.fiscalDocument, tx.ownerCnpj);
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
        // Only clear AUTO-derived item categories. Items the user hand-set
        // (categorySource=MANUAL) must survive an un-match.
        where: {
          fiscalDocumentId: { in: matchedDocIds },
          categorySource: ReconciliationSource.AUTO,
        },
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

  /**
   * Unmatches a fiscal document from EVERY transaction it's linked to (the
   * NF-side counterpart of `unmatch`). This is the escape hatch for installments
   * (one NF settled by several transactions): undoing a single transaction would
   * otherwise leave the NF partially linked and invisible to re-matching
   * (`matches: { none: {} }`), so a "reset this NF" action is the clean recovery.
   *
   * A transaction may also be linked to OTHER NFs (one payment → several NFs), so
   * we remove only the (tx, this-NF) links and RECOMPUTE each affected
   * transaction's status from its remaining non-reversed matches — never blindly
   * resetting a transaction that still has other valid links.
   */
  /**
   * Close a received note WITHOUT a bank transaction (credit-card / bonificação /
   * no-payment), or clear that resolution (`resolution: null`). A MANUAL override
   * of the import-time auto-detection: source=MANUAL so it's distinguishable and
   * a later re-import never clobbers it. Rejected while the note still has a live
   * bank match — desvincule first.
   */
  async setOffBankResolution(
    fiscalDocumentId: string,
    payload: OffBankResolutionDto,
    userId: string | undefined,
  ) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
      select: {
        id: true,
        matches: { where: { reversedAt: null }, select: { id: true } },
      },
    });
    if (!doc) throw new NotFoundException('Nota fiscal não encontrada');

    if (payload.resolution) {
      if (doc.matches.length > 0) {
        throw new BadRequestException(
          'A nota já possui vínculo bancário; desvincule antes de marcá-la como sem transação.',
        );
      }
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDocumentId },
        data: {
          offBankResolution: payload.resolution,
          offBankResolvedAt: new Date(),
          offBankResolutionSource: ReconciliationSource.MANUAL,
          offBankResolvedById: userId ?? null,
          offBankResolutionNotes: payload.notes ?? null,
        },
      });
    } else {
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDocumentId },
        data: {
          offBankResolution: null,
          offBankResolvedAt: null,
          offBankResolutionSource: null,
          offBankResolvedById: null,
          offBankResolutionNotes: null,
        },
      });
    }
    return this.getFiscalDocument(fiscalDocumentId);
  }

  async unmatchFiscalDocument(fiscalDocumentId: string, userId: string | undefined) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
      select: { emitCnpj: true, destCnpj: true, destCpf: true },
    });
    if (!doc) throw new NotFoundException('Nota fiscal não encontrada');

    const matches = await this.prisma.reconciliationMatch.findMany({
      where: { fiscalDocumentId, reversedAt: null },
      include: {
        transaction: {
          select: {
            id: true,
            memo: true,
            type: true,
            amount: true,
            counterpartyCnpjCpf: true,
            ownerCnpj: true,
          },
        },
      },
    });
    if (matches.length === 0) return this.getFiscalDocument(fiscalDocumentId);

    // Snapshot (memo → counterparty) pairs to reverse in the alias learner, and
    // the distinct affected transactions to recompute afterwards.
    const reversals: Array<{
      memo: string | null;
      txType: import('@prisma/client').BankTransactionType;
      cp: string;
    }> = [];
    const txById = new Map<string, (typeof matches)[number]['transaction']>();
    for (const m of matches) {
      if (!m.transaction) continue;
      txById.set(m.transactionId, m.transaction);
      if (m.transaction.memo) {
        const cp =
          m.transaction.counterpartyCnpjCpf || inferCounterpartyCnpj(doc, m.transaction.ownerCnpj);
        if (cp) reversals.push({ memo: m.transaction.memo, txType: m.transaction.type, cp });
      }
    }

    await this.prisma.$transaction(async tx2 => {
      // Serialize against the auto-matcher / manual matches so the per-tx status
      // recompute below sees a consistent set of remaining matches.
      await tx2.$executeRaw`SELECT pg_advisory_xact_lock(${RECON_ADVISORY_LOCK_KEY})`;

      await tx2.reconciliationMatch.updateMany({
        where: { fiscalDocumentId, reversedAt: null },
        data: { reversedAt: new Date(), reversedById: userId ?? null },
      });
      await tx2.reconciliationMatch.deleteMany({ where: { fiscalDocumentId } });

      // AUTO item-categories derived from this NF are no longer justified.
      await tx2.fiscalDocumentItem.updateMany({
        where: { fiscalDocumentId, categorySource: ReconciliationSource.AUTO },
        data: { categoryId: null, categoryConfidence: null, categorySource: null },
      });

      // Recompute each affected transaction from its REMAINING (non-reversed)
      // matches: fully covered → RECONCILED, partly → PARTIAL, none → PENDING.
      for (const t of txById.values()) {
        if (!t) continue;
        const remaining = await tx2.reconciliationMatch.findMany({
          where: { transactionId: t.id, reversedAt: null },
          select: { allocatedAmount: true },
        });
        if (remaining.length === 0) {
          await tx2.bankTransactionCategory.deleteMany({
            where: { transactionId: t.id, source: ReconciliationSource.AUTO },
          });
          await tx2.bankTransaction.update({
            where: { id: t.id },
            data: {
              reconciliationStatus: ReconciliationStatus.PENDING,
              reconciliationSource: null,
            },
          });
        } else {
          const allocated = remaining.reduce((s, r) => s + Number(r.allocatedAmount), 0);
          const txAmount = Math.abs(Number(t.amount));
          await tx2.bankTransaction.update({
            where: { id: t.id },
            data: {
              reconciliationStatus:
                Math.abs(allocated - txAmount) <= 0.05
                  ? ReconciliationStatus.RECONCILED
                  : ReconciliationStatus.PARTIAL,
            },
          });
        }
      }
    });

    for (const r of reversals) {
      try {
        await this.aliasService.recordReversal({
          memo: r.memo,
          txType: r.txType,
          counterpartyCnpjCpf: r.cp,
        });
      } catch (err) {
        this.logger.warn(`Failed to record alias reversal: ${err}`);
      }
    }

    return this.getFiscalDocument(fiscalDocumentId);
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
        counterpartyName: true,
        postedAt: true,
        amount: true,
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
    const txOnlyCat = chosen.find(c => c!.isResolving);
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

    // Learn the memo-independent counterparty → category rule (the learnable
    // replacement for the hardcoded pró-labore/aluguel CPF map) + the name→CNPJ
    // identity. Fires even without a memo — that is the whole point.
    if (payload.saveAlias && aliasCategory) {
      await this.counterpartyLearning
        .record({
          counterpartyCnpjCpf: tx.counterpartyCnpjCpf,
          counterpartyName: tx.counterpartyName,
          txType: tx.type,
          categoryId: aliasCategory.id,
          source: LearnedRuleSource.MANUAL,
        })
        .catch(err => this.logger.warn(`counterparty learn failed: ${err}`));
    }

    // Learn the generalizing memo token-vote model for a resolving category
    // (DARF/folha/tarifa). Needs only the memo — no CNPJ required, which is why
    // tax/payroll memos (often CNPJ-less) can finally learn.
    if (txOnlyCat && tx.memo) {
      await this.memoLearner
        .learnFromConfirmation(tx.memo, txOnlyCat.id, LearnedRuleSource.MANUAL)
        .catch(err => this.logger.warn(`memo learn failed: ${err}`));
    }

    // Record a recurrence observation for a resolving (transaction-only)
    // category set WITHOUT an NF (rent/pró-labore PIX) — the match-completion
    // path handles the NF case. Keyed by CNPJ/CPF when known, else memo.
    if (txOnlyCat) {
      const key = (tx.counterpartyCnpjCpf || '').replace(/\D/g, '') || memoFingerprint(tx.memo);
      if (key) {
        await this.recurrenceLearner
          .recordCadence({
            counterpartyKey: key,
            counterpartyLabel: tx.counterpartyName,
            categoryId: txOnlyCat.id,
            transactionId,
            occurredAt: tx.postedAt,
            amount: Number(tx.amount),
          })
          .catch(err => this.logger.warn(`recurrence recordCadence failed: ${err}`));
      }
    }

    // Train the item-category learner from this human correction (no-op unless
    // unambiguous — single item-derived/service category on a single-line NF).
    await this.itemCategoryClassifier
      .learnFromManual(
        transactionId,
        chosen.map(c => ({ id: c!.id, kind: c!.kind as string })),
      )
      .catch(err => this.logger.warn(`learnFromManual failed: ${err}`));

    // Unified feedback: decay whatever the prior auto-decision relied on for
    // categories the user did NOT choose, and reinforce the new ones across all
    // learners. One correction fixes the future everywhere.
    await this.fusion
      .recordCorrection(transactionId, ids)
      .catch(err => this.logger.warn(`fusion.recordCorrection failed: ${err}`));

    return this.getTransaction(transactionId);
  }

  /**
   * Inbox of stored SUGGEST-tier proposals: pending transactions the learning
   * layer categorized with medium confidence, awaiting a one-click confirm.
   */
  async listSuggestions() {
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        suggestedCategoryId: { not: null },
        reconciliationStatus: ReconciliationStatus.PENDING,
      },
      orderBy: [{ suggestionConfidence: 'desc' }, { postedAt: 'desc' }],
      take: 200,
      include: {
        ...CATEGORY_INCLUDE,
        suggestedCategory: {
          select: { id: true, name: true, slug: true, kind: true, color: true, isResolving: true },
        },
      },
    });
    return rows;
  }

  /**
   * Promote a stored suggestion to a MANUAL category (one click). Reuses
   * changeCategory so the same learning/reconcile/correction path runs, then
   * clears the now-consumed suggestion.
   */
  async confirmSuggestion(transactionId: string, userId: string | undefined) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { suggestedCategoryId: true },
    });
    if (!tx?.suggestedCategoryId) {
      throw new BadRequestException('Nenhuma sugestão pendente para esta transação');
    }
    const result = await this.changeCategory(
      transactionId,
      { categoryIds: [tx.suggestedCategoryId], saveAlias: true },
      userId,
    );
    await this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        suggestedCategoryId: null,
        suggestionConfidence: null,
        suggestionProvenance: Prisma.JsonNull,
      },
    });
    return result;
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
      if (payload.dateFrom)
        (where.postedAt as Prisma.DateTimeFilter).gte = new Date(payload.dateFrom);
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
      if (payload.dateFrom)
        (where.postedAt as Prisma.DateTimeFilter).gte = new Date(payload.dateFrom);
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

  /**
   * Back-fill categories onto RECONCILED-but-uncategorized transactions from
   * learned counterparty/alias history. Runs after the matcher in the "Verificar"
   * pipeline so that, as the history grows, transactions that were reconciled
   * (e.g. matched to an NF before their counterparty had ever been categorized)
   * pick up the learned category automatically — no manual step. Only touches
   * rows with no category tag at all; NF-item and MANUAL categories are left
   * alone (the fusion primitive double-guards MANUAL).
   */
  async backfillCategoriesFromHistory(payload: {
    transactionIds?: string[];
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{ processed: number; categorized: number }> {
    const where: Prisma.BankTransactionWhereInput = {
      reconciliationStatus: ReconciliationStatus.RECONCILED,
      categories: { none: {} },
    };
    if (payload.transactionIds?.length) where.id = { in: payload.transactionIds };
    if (payload.dateFrom || payload.dateTo) {
      where.postedAt = {};
      if (payload.dateFrom)
        (where.postedAt as Prisma.DateTimeFilter).gte = new Date(payload.dateFrom);
      if (payload.dateTo) (where.postedAt as Prisma.DateTimeFilter).lte = new Date(payload.dateTo);
    }
    const txs = await this.prisma.bankTransaction.findMany({ where, select: { id: true } });
    let categorized = 0;
    for (const t of txs) {
      const applied = await this.fusion
        .backfillCategoryFromHistory(t.id)
        .catch(() => false);
      if (applied) categorized += 1;
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
        // Complementary info (infNFe/infAdic/infCpl) free text, e.g. an order
        // number, "Vend", or any note the supplier stamped on the NF.
        { infCpl: { contains: filters.search, mode: 'insensitive' } },
        // Normalized #Ped: order codes (so "C44304" matches even with spacing).
        { orderCodes: { some: { code: { contains: filters.search, mode: 'insensitive' } } } },
      ];
    }
    if (filters.dateFrom || filters.dateTo) {
      where.issueDate = {};
      if (filters.dateFrom)
        (where.issueDate as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      if (filters.dateTo) (where.issueDate as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
    }
    if (filters.valueMin !== undefined || filters.valueMax !== undefined) {
      where.totalValue = {};
      if (filters.valueMin !== undefined)
        (where.totalValue as Prisma.DecimalFilter).gte = filters.valueMin;
      if (filters.valueMax !== undefined)
        (where.totalValue as Prisma.DecimalFilter).lte = filters.valueMax;
    }
    if (filters.hasMatch !== undefined) {
      // "Vinculada" is direction-aware: ENTRADA notes link via a non-reversed
      // bank ReconciliationMatch, while SAIDA (emitted) notes can never get a
      // bank match — their link is the NfseDocument → Invoice/Task (faturamento).
      // So the filter must accept EITHER condition, scoped by operationType, and
      // its inverse for "não vinculadas".
      const linkedCondition: Prisma.FiscalDocumentWhereInput = {
        OR: [
          {
            operationType: FiscalDocumentOperation.ENTRADA,
            // Linked = settled by a bank match OR closed off-bank (credit-card /
            // bonificação / no-payment). Both count as "resolved" for the
            // Pendentes/Vinculadas split.
            OR: [
              { matches: { some: { reversedAt: null } } },
              { offBankResolvedAt: { not: null } },
            ],
          },
          {
            operationType: FiscalDocumentOperation.SAIDA,
            nfseDocument: {
              OR: [{ invoiceId: { not: null } }, { taskId: { not: null } }],
            },
          },
        ],
      };
      if (filters.hasMatch) {
        where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), linkedCondition];
      } else {
        where.NOT = [
          ...(Array.isArray(where.NOT) ? where.NOT : where.NOT ? [where.NOT] : []),
          linkedCondition,
        ];
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.fiscalDocument.findMany({
        where,
        orderBy: { [filters.sortBy]: filters.sortDir },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: {
          matches: {
            where: { reversedAt: null },
            select: {
              id: true,
              transaction: { select: { id: true, postedAt: true, amount: true } },
            },
          },
          // SAIDA (emitted) docs surface their billing link so the web can show
          // the faturamento/orçamento it was generated from instead of a (never-
          // existing) bank transaction.
          nfseDocument: {
            select: { id: true, invoiceId: true, taskId: true, nfseNumber: true },
          },
        },
      }),
      this.prisma.fiscalDocument.count({ where }),
    ]);
    // Single source of truth for "vinculada": ENTRADA → has an open bank match;
    // SAIDA → its NfseDocument carries an Invoice/Task (faturamento) link.
    const data = rows.map(doc => ({
      ...doc,
      linked:
        doc.operationType === FiscalDocumentOperation.ENTRADA
          ? doc.matches.length > 0 || doc.offBankResolvedAt != null
          : doc.nfseDocument?.invoiceId != null || doc.nfseDocument?.taskId != null,
    }));
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
