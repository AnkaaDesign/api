import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  CategoryDecisionTier,
  Prisma,
  ReconciliationSource,
  ReconciliationStatus,
  TransactionCategoryKind,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionCategoryService, CategorySnapshot } from '../transaction-category.service';
import {
  CATEGORY_LEARNERS,
  CategoryLearner,
  CategorySignal,
  ClassifierSignalInput,
  DecisionTier,
  FusedDecision,
  LearningSource,
  SOURCE_WEIGHT,
  signalFamily,
} from './category-signal';

const AUTO_APPLY_THRESHOLD = 0.85;
const SUGGEST_THRESHOLD = 0.55;
const CONFLICT_MARGIN = 0.15;
const IDENTITY_OVERRIDE_FLOOR = 0.85;

/**
 * The spine. Collects CategorySignals from every learner, fuses them into one
 * decision (noisy-OR within a category + cross-learner agreement boost +
 * conflict-margin gate), and applies it under three tiers (AUTO_APPLY / SUGGEST
 * / ABSTAIN). One reversal path fans a correction out to whichever learners
 * contributed, so a single human fix propagates everywhere.
 *
 * Invariants: MANUAL categorySource is never overwritten by AUTO; a single AUTO
 * attestation contributes confidence 0 (learners enforce this) and is dropped
 * before grouping; every learner call is best-effort and never breaks the flow.
 */
@Injectable()
export class CategoryFusionService {
  private readonly logger = new Logger(CategoryFusionService.name);
  // Routes a signal's source → the learner that owns it, for reversal fan-out.
  private readonly bySource = new Map<LearningSource, CategoryLearner>();

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
    private readonly categories: TransactionCategoryService,
    @Inject(CATEGORY_LEARNERS) private readonly learners: CategoryLearner[],
  ) {
    for (const l of this.learners) {
      switch (l.source) {
        case LearningSource.COUNTERPARTY:
          this.bySource.set(LearningSource.COUNTERPARTY, l);
          this.bySource.set(LearningSource.COUNTERPARTY_IDENTITY, l);
          break;
        case LearningSource.MEMO_TOKEN:
          this.bySource.set(LearningSource.MEMO_TOKEN, l);
          break;
        case LearningSource.NF_EMITTER:
          this.bySource.set(LearningSource.NF_EMITTER, l);
          this.bySource.set(LearningSource.NF_LINE_DERIVED, l);
          break;
        case LearningSource.ALIAS: // the ladder learner
          for (const s of [
            LearningSource.ALIAS,
            LearningSource.SUBTYPE,
            LearningSource.MEMO_REGEX,
            LearningSource.MARKETPLACE,
            LearningSource.COUNTERPARTY_HARDCODE,
          ]) {
            this.bySource.set(s, l);
          }
          break;
        default:
          this.bySource.set(l.source, l);
      }
    }
  }

  /** Collect from every learner (best-effort) and fuse. No DB write. */
  async classify(tx: ClassifierSignalInput): Promise<FusedDecision> {
    const all: CategorySignal[] = [];
    for (const learner of this.learners) {
      try {
        const sig = await learner.collect(tx);
        if (sig?.length) all.push(...sig);
      } catch (err) {
        this.logger.warn(`Learner ${learner.source} failed on ${tx.id}: ${err}`);
      }
    }
    const snap = await this.categories.snapshot();
    return this.fuse(all, tx, snap);
  }

  fuse(
    signals: CategorySignal[],
    tx: ClassifierSignalInput,
    snap: CategorySnapshot,
  ): FusedDecision {
    // Group category-bearing signals with positive evidence.
    const groups = new Map<string, CategorySignal[]>();
    for (const s of signals) {
      if (!s.categoryId || s.confidence <= 0) continue;
      const g = groups.get(s.categoryId) ?? [];
      g.push(s);
      groups.set(s.categoryId, g);
    }

    if (groups.size === 0) {
      return this.expectsNfOrAbstain(signals, tx);
    }

    const scored = [...groups.entries()]
      .map(([categoryId, sigs]) => {
        // Noisy-OR of independent corroborating evidence, bounded in [0,1).
        const noisyOr =
          1 -
          sigs.reduce(
            (acc, s) => acc * (1 - clamp01(SOURCE_WEIGHT[s.source] * s.confidence)),
            1,
          );
        const distinct = new Set(sigs.map(s => s.source)).size;
        const boost = Math.min(1.3, 1 + 0.15 * (distinct - 1));
        return { categoryId, sigs, score: Math.min(0.99, noisyOr * boost) };
      })
      .sort((a, b) => b.score - a.score);

    const w = scored[0];
    const r = scored[1];

    let tier =
      w.score >= AUTO_APPLY_THRESHOLD
        ? DecisionTier.AUTO_APPLY
        : w.score >= SUGGEST_THRESHOLD
          ? DecisionTier.SUGGEST
          : DecisionTier.ABSTAIN;

    const conflicts = r ? r.sigs : [];
    if (r) {
      const margin = w.score - r.score;
      const wFam = family(w.sigs);
      const rFam = family(r.sigs);
      const identityWinner =
        wFam === 'IDENTITY' && rFam === 'TEXT' && maxConf(w.sigs) >= IDENTITY_OVERRIDE_FLOOR;
      if (margin < CONFLICT_MARGIN && wFam !== rFam && !identityWinner) {
        tier = demote(tier);
      }
    }

    const cat = snap.byId.get(w.categoryId);
    const expectsNf =
      tier !== DecisionTier.AUTO_APPLY &&
      (w.sigs.some(s => s.expectsFiscalDocument) || Boolean(tx.counterpartyCnpjCpf));

    return {
      tier,
      categoryId: w.categoryId,
      expectsFiscalDocument: expectsNf,
      confidence: w.score,
      shouldReconcile: tier === DecisionTier.AUTO_APPLY && Boolean(cat?.isResolving),
      breakdown: signals,
      winners: w.sigs,
      conflicts,
      reason: this.composeReason(w.sigs, conflicts, tier, w.score),
    };
  }

  private expectsNfOrAbstain(
    signals: CategorySignal[],
    tx: ClassifierSignalInput,
  ): FusedDecision {
    const expectsNf =
      signals.some(s => s.expectsFiscalDocument) || Boolean(tx.counterpartyCnpjCpf);
    return {
      tier: DecisionTier.ABSTAIN,
      categoryId: undefined,
      expectsFiscalDocument: expectsNf,
      confidence: 0,
      shouldReconcile: false,
      breakdown: signals,
      winners: [],
      conflicts: [],
      reason: expectsNf ? 'Default NF (contraparte identificada)' : 'Sem padrão identificável',
    };
  }

  private composeReason(
    winners: CategorySignal[],
    conflicts: CategorySignal[],
    tier: DecisionTier,
    score: number,
  ): string {
    const top = winners.map(w => w.provenance).join(' + ');
    const conf = `${Math.round(score * 100)}%`;
    if (tier === DecisionTier.SUGGEST && conflicts.length) {
      return `Sugestão (${conf}): ${top} — em conflito com ${conflicts.map(c => c.provenance).join(', ')}`;
    }
    return `${tier} (${conf}): ${top}`;
  }

  /**
   * Persists a decision. Respects the MANUAL-sacred / already-RECONCILED
   * invariants; AUTO_APPLY sets the tag + reconciles, SUGGEST stores a
   * suggestion without reconciling, ABSTAIN only updates the expects-NF flag.
   */
  async applyDecision(
    txId: string,
    decision: FusedDecision,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = prismaTx ?? this.prisma;
    const tx = await db.bankTransaction.findUnique({
      where: { id: txId },
      select: { reconciliationStatus: true, categorySource: true },
    });
    if (!tx) return;
    if (tx.reconciliationStatus === ReconciliationStatus.RECONCILED) return;
    if (tx.categorySource === ReconciliationSource.MANUAL) return;

    if (decision.tier === DecisionTier.AUTO_APPLY && decision.categoryId) {
      await db.bankTransaction.update({
        where: { id: txId },
        data: {
          expectsFiscalDocument: decision.expectsFiscalDocument,
          categorySource: ReconciliationSource.AUTO,
          classifiedAt: new Date(),
          suggestedCategoryId: null,
          suggestionConfidence: null,
          suggestionProvenance: Prisma.JsonNull,
          ...(decision.shouldReconcile
            ? {
                reconciliationStatus: ReconciliationStatus.RECONCILED,
                reconciliationSource: ReconciliationSource.AUTO,
              }
            : {}),
        },
      });
      await this.replaceAutoTag(db, txId, decision.categoryId);
      await this.writeProvenance(db, txId, decision, 'CLASSIFY');
      return;
    }

    if (decision.tier === DecisionTier.SUGGEST && decision.categoryId) {
      await db.bankTransaction.update({
        where: { id: txId },
        data: {
          classifiedAt: new Date(),
          expectsFiscalDocument: decision.expectsFiscalDocument,
          suggestedCategoryId: decision.categoryId,
          suggestionConfidence: Math.round(decision.confidence * 100),
          suggestionProvenance: decision.breakdown as unknown as Prisma.InputJsonValue,
        },
      });
      await this.writeProvenance(db, txId, decision, 'CLASSIFY');
      return;
    }

    // ABSTAIN: only the expects-NF flag (fallthrough parity).
    await db.bankTransaction.update({
      where: { id: txId },
      data: {
        classifiedAt: new Date(),
        expectsFiscalDocument: decision.expectsFiscalDocument,
      },
    });
  }

  /**
   * Back-fill a category onto a transaction from learned history (counterparty
   * rules / aliases / memo tokens) WITHOUT touching its reconciliation status.
   *
   * `applyDecision` deliberately refuses to categorize a RECONCILED row —
   * normally the category is decided before the match. But a transaction
   * reconciled via an NF/boleto match (or reconciled in an earlier run, before
   * its counterparty history existed) can end up RECONCILED yet uncategorized.
   * This closes exactly that gap: once a counterparty has been categorized a few
   * times, re-running "Verificar" applies that learned category to the older
   * reconciled transactions. Still sacrosanct: never overrides a MANUAL category,
   * never re-tags an already-categorized row, applies only at AUTO_APPLY
   * confidence, and never alters the match/reconciliation status.
   *
   * Returns true when a category was applied.
   */
  async backfillCategoryFromHistory(
    txId: string,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const db = prismaTx ?? this.prisma;
    const tx = await db.bankTransaction.findUnique({
      where: { id: txId },
      select: {
        categorySource: true,
        categories: { select: { categoryId: true }, take: 1 },
      },
    });
    if (!tx) return false;
    // Never override a human decision; never double-tag an already categorized tx.
    if (tx.categorySource === ReconciliationSource.MANUAL) return false;
    if (tx.categories.length > 0) return false;

    const input = await this.loadSignalInput(txId, db);
    if (!input) return false;
    const decision = await this.classify(input);
    if (decision.tier !== DecisionTier.AUTO_APPLY || !decision.categoryId) return false;

    await db.bankTransaction.update({
      where: { id: txId },
      data: {
        categorySource: ReconciliationSource.AUTO,
        classifiedAt: new Date(),
        suggestedCategoryId: null,
        suggestionConfidence: null,
        suggestionProvenance: Prisma.JsonNull,
        // reconciliationStatus intentionally untouched — this only categorizes.
      },
    });
    await this.replaceAutoTag(db, txId, decision.categoryId);
    await this.writeProvenance(db, txId, decision, 'CLASSIFY');
    return true;
  }

  /** Delete the single AUTO transaction-only tag and upsert the new one. */
  private async replaceAutoTag(
    db: Prisma.TransactionClient,
    txId: string,
    categoryId: string,
  ): Promise<void> {
    await db.bankTransactionCategory.deleteMany({
      where: {
        transactionId: txId,
        source: ReconciliationSource.AUTO,
        category: { kind: TransactionCategoryKind.TRANSACTION_ONLY },
      },
    });
    await db.bankTransactionCategory.upsert({
      where: { transactionId_categoryId: { transactionId: txId, categoryId } },
      create: { transactionId: txId, categoryId, source: ReconciliationSource.AUTO },
      update: { source: ReconciliationSource.AUTO },
    });
  }

  private async writeProvenance(
    db: Prisma.TransactionClient,
    txId: string,
    decision: FusedDecision,
    event: 'CLASSIFY' | 'CORRECTION' | 'REPLAY',
  ): Promise<void> {
    try {
      await db.categoryDecisionLog.create({
        data: {
          transactionId: txId,
          tier: decision.tier as unknown as CategoryDecisionTier,
          categoryId: decision.categoryId ?? null,
          confidence: Math.round(decision.confidence * 100),
          breakdown: decision.breakdown as unknown as Prisma.InputJsonValue,
          winners: decision.winners as unknown as Prisma.InputJsonValue,
          event,
        },
      });
    } catch (err) {
      this.logger.warn(`writeProvenance failed for ${txId}: ${err}`);
    }
  }

  /**
   * One reversal path. Decays the learners that backed the PRIOR decision (read
   * from the persisted log, so even now-stale rules are decayed) for categories
   * no longer chosen, then reinforces the learners for the new categories.
   */
  async recordCorrection(txId: string, newCategoryIds: string[]): Promise<void> {
    const tx = await this.loadSignalInput(txId);
    if (!tx) return;
    const prior = await this.prisma.categoryDecisionLog.findFirst({
      where: { transactionId: txId, event: { in: ['CLASSIFY', 'REPLAY'] } },
      orderBy: { createdAt: 'desc' },
    });
    const priorWinners: CategorySignal[] = Array.isArray(prior?.winners)
      ? (prior!.winners as unknown as CategorySignal[])
      : [];

    for (const sig of priorWinners) {
      if (sig.categoryId && newCategoryIds.includes(sig.categoryId)) continue;
      const learner = this.bySource.get(sig.source);
      if (!learner) continue;
      try {
        await learner.recordReversal(tx, sig);
      } catch (err) {
        this.logger.warn(`reversal ${sig.source} failed: ${err}`);
      }
    }
    for (const learner of this.learners) {
      for (const cid of newCategoryIds) {
        try {
          await learner.recordConfirmation(tx, cid);
        } catch (err) {
          this.logger.warn(`confirm ${learner.source} failed: ${err}`);
        }
      }
    }
  }

  /** "Why was this categorized?" — live recomputation + persisted history. */
  async explain(txId: string) {
    const tx = await this.loadSignalInput(txId);
    const decision = tx ? await this.classify(tx) : null;
    const persisted = await this.prisma.bankTransaction.findUnique({
      where: { id: txId },
      select: {
        categorySource: true,
        reconciliationStatus: true,
        suggestedCategoryId: true,
        suggestionConfidence: true,
      },
    });
    const history = await this.prisma.categoryDecisionLog.findMany({
      where: { transactionId: txId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { transactionId: txId, decision, persisted, history };
  }

  /**
   * Admin: list learned rules across the learners (counterparty / memo / emitter
   * / alias). `kind` narrows to one table; omitted returns a bounded set of each.
   */
  async listRules(kind?: string) {
    const take = 500;
    const wantsAll = !kind;
    const out: Record<string, unknown[]> = {};
    if (wantsAll || kind === 'counterparty') {
      out.counterparty = await this.prisma.counterpartyCategoryRule.findMany({
        take,
        orderBy: { confirmedCount: 'desc' },
        include: { category: { select: { id: true, name: true, slug: true } } },
      });
    }
    if (wantsAll || kind === 'memo') {
      out.memo = await this.prisma.memoTokenWeight.findMany({
        take,
        orderBy: { weight: 'desc' },
        include: { category: { select: { id: true, name: true, slug: true } } },
      });
    }
    if (wantsAll || kind === 'emitter') {
      out.emitter = await this.prisma.emitterCategoryPrior.findMany({
        take,
        orderBy: { confirmedCount: 'desc' },
        include: { category: { select: { id: true, name: true, slug: true } } },
      });
    }
    if (wantsAll || kind === 'alias') {
      out.alias = await this.prisma.reconciliationAlias.findMany({
        where: { categoryId: { not: null } },
        take,
        orderBy: { confirmedCount: 'desc' },
        include: { category: { select: { id: true, name: true, slug: true } } },
      });
    }
    return out;
  }

  /** Admin: soft-disable / re-enable a learned rule. Never hard-deletes. */
  async setRuleDisabled(kind: string, id: string, disabled: boolean) {
    const disabledAt = disabled ? new Date() : null;
    switch (kind) {
      case 'counterparty':
        return this.prisma.counterpartyCategoryRule.update({ where: { id }, data: { disabledAt } });
      case 'memo':
        return this.prisma.memoTokenWeight.update({ where: { id }, data: { disabledAt } });
      case 'emitter':
        return this.prisma.emitterCategoryPrior.update({ where: { id }, data: { disabledAt } });
      case 'alias':
        return this.prisma.reconciliationAlias.update({ where: { id }, data: { disabledAt } });
      default:
        throw new Error(`Unknown rule kind: ${kind}`);
    }
  }

  async loadSignalInput(
    txId: string,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<ClassifierSignalInput | null> {
    const db = prismaTx ?? this.prisma;
    const tx = await db.bankTransaction.findUnique({
      where: { id: txId },
      select: {
        id: true,
        type: true,
        subtype: true,
        memo: true,
        counterpartyCnpjCpf: true,
        counterpartyName: true,
        amount: true,
        reconciliationStatus: true,
      },
    });
    if (!tx) return null;
    return { ...tx, amount: Number(tx.amount) };
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function maxConf(sigs: CategorySignal[]): number {
  return sigs.reduce((m, s) => Math.max(m, s.confidence), 0);
}

function family(sigs: CategorySignal[]): string {
  // The family of the highest-confidence signal in the group.
  let best = sigs[0];
  for (const s of sigs) if (s.confidence > best.confidence) best = s;
  return signalFamily(best.source);
}

function demote(tier: DecisionTier): DecisionTier {
  if (tier === DecisionTier.AUTO_APPLY) return DecisionTier.SUGGEST;
  if (tier === DecisionTier.SUGGEST) return DecisionTier.ABSTAIN;
  return tier;
}
