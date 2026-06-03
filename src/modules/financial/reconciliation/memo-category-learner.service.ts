import { Injectable, Logger } from '@nestjs/common';
import { LearnedRuleSource, Prisma, TransactionCategoryKind } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionCategoryService } from './transaction-category.service';
import { memoLearnTokens, MEMO_UBIQUITOUS_TOKENS } from './text-normalization';
import {
  CategoryLearner,
  CategorySignal,
  ClassifierSignalInput,
  LearningSource,
} from './learning/category-signal';

// Lexicon is rebuilt at most every 5 minutes; manual edits invalidate eagerly.
const LEXICON_TTL_MS = 5 * 60_000;
// Effective weight a (token,category) pair must reach before it votes at all —
// below this it's a single noisy confirmation, not a pattern.
const MIN_EVIDENCE = 2;
// Below this fused confidence the memo signal is too weak to emit.
const MIN_CONFIDENCE = 0.45;
// At/above this the memo signal is treated as strong (callers/fusion may
// auto-apply); kept as a documented threshold mirroring the item lexicon.
const STRONG_CONFIDENCE = 0.75;
// Each confirmation reinforces a token by this much.
const LEARN_INCREMENT = 1;
// Each reversal decays the (token,wrongCategory) pair by this much. >1 so a
// single correction outweighs a single stray confirmation.
const REVERSAL_DECAY = 1.5;

/**
 * Token→category lexicon held in memory. Mirrors the item-category lexicon's
 * shape so the scoring math is identical:
 *   tokens: token → (categoryId → effective weight)
 *   df:     token → number of distinct categories it votes for (document freq)
 *   catCount: distinct categories present, used for the IDF denominator scale
 */
interface MemoLexicon {
  tokens: Map<string, Map<string, number>>;
  df: Map<string, number>;
  catCount: number;
}

/**
 * Generalizing memo→category learner (token-vote model). Where the legacy memo
 * matcher needs an exact regex, this learns INDIVIDUAL memo tokens so a brand-new
 * variant — e.g. a DARF with a code never seen before — auto-classifies once a
 * couple of its surviving tokens have been confirmed elsewhere.
 *
 * Directly mirrors {@link ItemCategoryClassifierService}'s buildLexicon /
 * scoreFromLexicon: per-token IDF-weighted votes, winner = argmax, confidence =
 * purity scaled by token coverage. The only structural difference is the corpus
 * is the persisted MemoTokenWeight table (confirmations/reversals) rather than
 * the live inventory item set.
 *
 * Emits at most ONE {@link CategorySignal} per transaction. All public hooks are
 * best-effort and never throw — a learner failure must not break classification
 * or a user action.
 */
@Injectable()
export class MemoCategoryLearnerService implements CategoryLearner {
  private readonly logger = new Logger(MemoCategoryLearnerService.name);
  readonly source = LearningSource.MEMO_TOKEN;

  private lexicon: MemoLexicon | null = null;
  private lexiconLoadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: TransactionCategoryService,
  ) {}

  /** Drops the cached lexicon so the next classify() rebuilds from the table. */
  invalidate(): void {
    this.lexicon = null;
    this.lexiconLoadedAt = 0;
  }

  private async buildLexicon(force = false): Promise<MemoLexicon> {
    const now = Date.now();
    if (!force && this.lexicon && now - this.lexiconLoadedAt < LEXICON_TTL_MS) {
      return this.lexicon;
    }
    const rows = await this.prisma.memoTokenWeight.findMany({
      where: { disabledAt: null },
      select: { token: true, categoryId: true, weight: true, negWeight: true },
    });
    const lex: MemoLexicon = {
      tokens: new Map(),
      df: new Map(),
      catCount: 0,
    };
    const cats = new Set<string>();
    for (const row of rows) {
      // Net evidence after reversals; ignore pairs that haven't cleared the bar.
      const eff = Math.max(0, row.weight - row.negWeight);
      if (eff < MIN_EVIDENCE) continue;
      let m = lex.tokens.get(row.token);
      if (!m) {
        m = new Map();
        lex.tokens.set(row.token, m);
      }
      m.set(row.categoryId, eff);
      lex.df.set(row.token, (lex.df.get(row.token) ?? 0) + 1);
      cats.add(row.categoryId);
    }
    lex.catCount = cats.size;
    this.lexicon = lex;
    this.lexiconLoadedAt = now;
    return lex;
  }

  /**
   * Classifies a memo into a single {@link CategorySignal}. Returns a
   * zero-confidence "no signal" CategorySignal when nothing fires (no tokens, no
   * lexicon hits, below threshold, or the winning category is missing / not a
   * resolving TRANSACTION_ONLY category).
   *
   * Scoring (identical shape to the item lexicon): per matched token, vote for
   * each category by its effective weight times the token's IDF; ubiquitous
   * tokens (pix/ted/pagamento) are down-weighted ×0.25. winner = argmax;
   * purity = best/total; coverage = matched/totalTokens; confidence =
   * purity·(0.55 + 0.45·coverage).
   */
  async classify(memo: string | null | undefined): Promise<CategorySignal> {
    const none: CategorySignal = {
      source: this.source,
      confidence: 0,
      provenance: 'memo-learner: no signal',
    };

    const tokens = memoLearnTokens(memo);
    if (tokens.length === 0) return none;

    const lex = await this.buildLexicon();
    if (lex.tokens.size === 0) return none;

    const N = lex.catCount || 1;
    const idf = (t: string): number => {
      let v = Math.log((N + 1) / ((lex.df.get(t) ?? 0) + 1)) + 1;
      if (MEMO_UBIQUITOUS_TOKENS.has(t)) v *= 0.25;
      return v;
    };

    const catScores = new Map<string, number>();
    const votingTokens: string[] = [];
    let matched = 0;
    let total = 0;
    for (const tok of tokens) {
      const m = lex.tokens.get(tok);
      if (!m) continue;
      matched += 1;
      votingTokens.push(tok);
      const w = idf(tok);
      for (const [catId, eff] of m) {
        const contribution = eff * w;
        catScores.set(catId, (catScores.get(catId) ?? 0) + contribution);
        total += contribution;
      }
    }
    if (matched === 0 || total === 0) return none;

    let bestCat: string | null = null;
    let bestScore = 0;
    for (const [catId, s] of catScores) {
      if (s > bestScore) {
        bestScore = s;
        bestCat = catId;
      }
    }
    if (!bestCat) return none;

    const purity = bestScore / total;
    const coverage = matched / tokens.length;
    const confidence = Math.min(1, purity * (0.55 + 0.45 * coverage));
    if (confidence < MIN_CONFIDENCE) return none;

    // Only a resolving transaction-only category may be asserted from a memo —
    // item-derived / service categories are NF enrichment, never memo-resolved.
    const snap = await this.categories.snapshot();
    const cat = snap.byId.get(bestCat);
    if (!cat || cat.kind !== TransactionCategoryKind.TRANSACTION_ONLY) return none;

    const p = purity.toFixed(2);
    return {
      source: this.source,
      categoryId: cat.id,
      confidence,
      provenance: `memo-learner: ${votingTokens.join(', ')} (${matched}/${tokens.length} tok, p=${p})`,
    };
  }

  // ----- CategoryLearner ----------------------------------------------------

  async collect(tx: ClassifierSignalInput): Promise<CategorySignal[]> {
    try {
      const sig = await this.classify(tx.memo);
      return sig.categoryId && sig.confidence > 0 ? [sig] : [];
    } catch (err) {
      this.logger.warn(`memo collect failed for ${tx.id}: ${err}`);
      return [];
    }
  }

  async recordReversal(tx: ClassifierSignalInput, signal: CategorySignal): Promise<void> {
    await this.applyReversal(tx.memo, signal.categoryId);
  }

  async recordConfirmation(tx: ClassifierSignalInput, categoryId: string): Promise<void> {
    await this.learnFromConfirmation(tx.memo, categoryId, LearnedRuleSource.MANUAL);
  }

  // ----- learning writes ----------------------------------------------------

  /**
   * Reinforces every surviving token of `memo` toward `categoryId`. Each token's
   * MemoTokenWeight is upserted (weight += LEARN_INCREMENT, confirmedCount += 1)
   * and the global MemoTokenStat totalCount is bumped. A MANUAL confirmation also
   * promotes the row's source to MANUAL and clears any prior auto-disable.
   *
   * Only transaction-only categories are learnable from memos (memos never
   * resolve item-derived/service categories). Best-effort — never throws.
   */
  async learnFromConfirmation(
    memo: string | null | undefined,
    categoryId: string,
    source: LearnedRuleSource = LearnedRuleSource.MANUAL,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      const tokens = Array.from(new Set(memoLearnTokens(memo)));
      if (tokens.length === 0) return;

      const snap = await this.categories.snapshot();
      const cat = snap.byId.get(categoryId);
      if (!cat || cat.kind !== TransactionCategoryKind.TRANSACTION_ONLY) return;

      const db = prismaTx ?? this.prisma;
      const isManual = source === LearnedRuleSource.MANUAL;
      const now = new Date();
      for (const token of tokens) {
        await db.memoTokenWeight.upsert({
          where: { token_categoryId: { token, categoryId } },
          create: {
            token,
            categoryId,
            source,
            weight: LEARN_INCREMENT,
            confirmedCount: 1,
            firstObservedAt: now,
            lastConfirmedAt: now,
          },
          update: {
            weight: { increment: LEARN_INCREMENT },
            confirmedCount: { increment: 1 },
            lastConfirmedAt: now,
            // A human confirmation overrides an auto-classified row: take it
            // MANUAL and lift any prior auto-disable.
            ...(isManual ? { source: LearnedRuleSource.MANUAL, disabledAt: null } : {}),
          },
        });
        await db.memoTokenStat.upsert({
          where: { token },
          create: { token, totalCount: 1 },
          update: { totalCount: { increment: 1 } },
        });
      }
      this.invalidate();
    } catch (err) {
      this.logger.warn(`memo learnFromConfirmation failed for ${categoryId}: ${err}`);
    }
  }

  /**
   * Decays every surviving token of `memo` away from a wrongly-asserted category.
   * For each (token, wrongCategoryId) row: negWeight += REVERSAL_DECAY,
   * rejectedCount += 1. An AUTO row is auto-disabled once the negative evidence
   * overtakes its positive weight AND it has been rejected at least twice — a
   * MANUAL/admin row is never auto-disabled (only a human can unlearn it).
   * Best-effort — never throws.
   */
  private async applyReversal(
    memo: string | null | undefined,
    wrongCategoryId: string | undefined,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      if (!wrongCategoryId) return;
      const tokens = Array.from(new Set(memoLearnTokens(memo)));
      if (tokens.length === 0) return;

      const db = prismaTx ?? this.prisma;
      for (const token of tokens) {
        const existing = await db.memoTokenWeight.findUnique({
          where: { token_categoryId: { token, categoryId: wrongCategoryId } },
          select: { weight: true, negWeight: true, rejectedCount: true, source: true },
        });
        if (!existing) continue;
        const nextNeg = existing.negWeight + REVERSAL_DECAY;
        const nextRejected = existing.rejectedCount + 1;
        const shouldDisable =
          existing.source === LearnedRuleSource.AUTO &&
          nextNeg > existing.weight &&
          nextRejected >= 2;
        await db.memoTokenWeight.update({
          where: { token_categoryId: { token, categoryId: wrongCategoryId } },
          data: {
            negWeight: nextNeg,
            rejectedCount: nextRejected,
            ...(shouldDisable ? { disabledAt: new Date() } : {}),
          },
        });
      }
      this.invalidate();
    } catch (err) {
      this.logger.warn(`memo applyReversal failed for ${wrongCategoryId}: ${err}`);
    }
  }
}
