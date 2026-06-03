import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  BankTransactionType,
  CounterpartyCategoryRule,
  CounterpartyProfile,
  LearnedRuleSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { nameFingerprint } from './text-normalization';
import {
  CategoryLearner,
  CategorySignal,
  ClassifierSignalInput,
  LearningSource,
} from './learning/category-signal';

/** Trust ordering between learned-rule provenances. Higher wins. */
function sourceRank(s: LearnedRuleSource): number {
  switch (s) {
    case LearnedRuleSource.MANUAL:
      return 2;
    case LearnedRuleSource.ADMIN_SEEDED:
      return 1;
    case LearnedRuleSource.AUTO:
    default:
      return 0;
  }
}

/** Strip everything but digits from a CPF/CNPJ. */
function digitsOnly(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '');
}

/**
 * The learnable replacement for the hardcoded COUNTERPARTY_CATEGORY_RULES.
 *
 * After a few confirmations on the same CPF/CNPJ, this learner auto-asserts a
 * category (memo-independent) and a stable counterparty identity (name→CNPJ),
 * so transactions whose memo is opaque still resolve from who paid/was paid.
 */
@Injectable()
export class CounterpartyLearningService implements CategoryLearner {
  readonly source = LearningSource.COUNTERPARTY;

  private readonly logger = new Logger(CounterpartyLearningService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Confidence model
  // ──────────────────────────────────────────────────────────────────────────

  private ruleConfidence(rule: CounterpartyCategoryRule): number {
    if (rule.disabledAt) return 0;
    switch (rule.source) {
      case LearnedRuleSource.MANUAL:
        return rule.confirmedCount >= 3 ? 1.0 : 0.9;
      case LearnedRuleSource.ADMIN_SEEDED:
        return 0.95;
      case LearnedRuleSource.AUTO:
      default:
        if (rule.confirmedCount >= 5) return 0.85;
        if (rule.confirmedCount >= 2) return 0.75;
        return 0; // a single AUTO observation never bootstraps an auto-apply.
    }
  }

  private profileConfidence(profile: CounterpartyProfile): number {
    if (profile.disabledAt) return 0;
    switch (profile.source) {
      case LearnedRuleSource.MANUAL:
        return profile.confirmedCount >= 3 ? 1.0 : 0.9;
      case LearnedRuleSource.ADMIN_SEEDED:
        return 0.95;
      case LearnedRuleSource.AUTO:
      default:
        if (profile.confirmedCount >= 5) return 0.85;
        if (profile.confirmedCount >= 2) return 0.75;
        return 0;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CategoryLearner.collect
  // ──────────────────────────────────────────────────────────────────────────

  async collect(tx: ClassifierSignalInput): Promise<CategorySignal[]> {
    try {
      const signals: CategorySignal[] = [];

      const cnpj = digitsOnly(tx.counterpartyCnpjCpf);
      if (cnpj) {
        const categorySignal = await this.resolveCategory(cnpj, tx.type);
        if (categorySignal) signals.push(categorySignal);
        return signals;
      }

      // No direct identity on the tx — try to recover it from the name.
      if (tx.counterpartyName) {
        const identity = await this.resolveIdentity(tx.counterpartyName);
        if (identity) {
          signals.push(identity);
          const recoveredCnpj = digitsOnly(identity.counterpartyCnpjCpf);
          if (recoveredCnpj) {
            const categorySignal = await this.resolveCategory(recoveredCnpj, tx.type);
            if (categorySignal) signals.push(categorySignal);
          }
        }
      }

      return signals;
    } catch (err) {
      this.logger.warn(
        `collect() failed for tx ${tx?.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /** CPF/CNPJ + txType → category signal (or null if none / not trusted). */
  async resolveCategory(
    cnpj: string,
    txType: BankTransactionType,
  ): Promise<CategorySignal | null> {
    const counterpartyCnpjCpf = digitsOnly(cnpj);
    if (!counterpartyCnpjCpf) return null;

    const rule = await this.prisma.counterpartyCategoryRule.findUnique({
      where: {
        counterpartyCnpjCpf_txType: {
          counterpartyCnpjCpf,
          txType,
        },
      },
    });
    if (!rule || rule.disabledAt) return null;

    const confidence = this.ruleConfidence(rule);
    if (confidence <= 0) return null;

    return {
      source: LearningSource.COUNTERPARTY,
      categoryId: rule.categoryId,
      counterpartyCnpjCpf,
      confidence,
      provenance: `counterparty ${counterpartyCnpjCpf} → category (${rule.source}, ${rule.confirmedCount}× confirmed)`,
      ruleRef: rule.id,
    };
  }

  /** Counterparty name → CNPJ identity signal (identity-only, no category). */
  async resolveIdentity(name: string): Promise<CategorySignal | null> {
    const fingerprint = nameFingerprint(name);
    if (!fingerprint) return null;

    const profiles = await this.prisma.counterpartyProfile.findMany({
      where: { nameFingerprint: fingerprint, disabledAt: null },
      take: 2,
      orderBy: [{ confirmedCount: 'desc' }],
    });
    if (profiles.length === 0) return null;

    // Rank by source trust first, then by confirmation count.
    const ranked = [...profiles].sort((a, b) => {
      const rankDiff = sourceRank(b.source) - sourceRank(a.source);
      if (rankDiff !== 0) return rankDiff;
      return b.confirmedCount - a.confirmedCount;
    });

    const top = ranked[0];
    const runnerUp = ranked[1];

    // Ambiguity guard: a genuine second contender on a different identity at the
    // same trust tier with comparable evidence makes the fingerprint unsafe.
    if (
      runnerUp &&
      runnerUp.counterpartyCnpjCpf !== top.counterpartyCnpjCpf &&
      sourceRank(runnerUp.source) === sourceRank(top.source) &&
      runnerUp.confirmedCount * 2 > top.confirmedCount
    ) {
      return null;
    }

    const confidence = this.profileConfidence(top);
    if (confidence <= 0) return null;

    const counterpartyCnpjCpf = digitsOnly(top.counterpartyCnpjCpf);
    if (!counterpartyCnpjCpf) return null;

    return {
      source: LearningSource.COUNTERPARTY_IDENTITY,
      counterpartyCnpjCpf,
      confidence,
      provenance: `name "${top.displayName || name}" → counterparty ${counterpartyCnpjCpf} (${top.source}, ${top.confirmedCount}× confirmed)`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reinforcement / decay
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Persist what we learned from an observation. Writes BOTH the CPF→category
   * rule (when cnpj + categoryId present) and the name→CNPJ identity profile
   * (when fingerprint + cnpj present). Best-effort: never throws.
   */
  async record(opts: {
    counterpartyCnpjCpf: string | null;
    counterpartyName: string | null;
    txType: BankTransactionType;
    categoryId?: string | null;
    source: LearnedRuleSource;
    prismaTx?: Prisma.TransactionClient;
  }): Promise<void> {
    const db: Prisma.TransactionClient | PrismaService = opts.prismaTx || this.prisma;
    const now = new Date();

    try {
      const cnpj = digitsOnly(opts.counterpartyCnpjCpf);

      // (a) CPF/CNPJ → category rule.
      if (cnpj && opts.categoryId) {
        const existing = await db.counterpartyCategoryRule.findUnique({
          where: {
            counterpartyCnpjCpf_txType: {
              counterpartyCnpjCpf: cnpj,
              txType: opts.txType,
            },
          },
        });

        if (!existing) {
          await db.counterpartyCategoryRule.create({
            data: {
              counterpartyCnpjCpf: cnpj,
              txType: opts.txType,
              categoryId: opts.categoryId,
              source: opts.source,
              confirmedCount: 1,
              rejectedCount: 0,
              firstObservedAt: now,
              lastConfirmedAt: now,
            },
          });
        } else if (existing.categoryId === opts.categoryId) {
          // Same category: reinforce. A MANUAL confirmation also heals a row
          // that had drifted to AUTO and clears any soft-disable.
          const healToManual = opts.source === LearnedRuleSource.MANUAL;
          await db.counterpartyCategoryRule.update({
            where: { id: existing.id },
            data: {
              confirmedCount: { increment: 1 },
              lastConfirmedAt: now,
              disabledAt: null,
              ...(healToManual && existing.source !== LearnedRuleSource.MANUAL
                ? { source: LearnedRuleSource.MANUAL }
                : {}),
            },
          });
        } else {
          // Different category for the same (cnpj, txType).
          if (opts.source === LearnedRuleSource.MANUAL) {
            // A human override is authoritative: overwrite and reset counters.
            await db.counterpartyCategoryRule.update({
              where: { id: existing.id },
              data: {
                categoryId: opts.categoryId,
                source: LearnedRuleSource.MANUAL,
                confirmedCount: 1,
                rejectedCount: 0,
                firstObservedAt: now,
                lastConfirmedAt: now,
                disabledAt: null,
              },
            });
          } else {
            // An AUTO observation disagreeing with the stored category is a
            // rejection of that stored rule, not a takeover.
            await this.applyRuleRejection(db, existing);
          }
        }
      }

      // (b) name → CPF/CNPJ identity profile.
      const fingerprint = nameFingerprint(opts.counterpartyName);
      if (fingerprint && cnpj) {
        await db.counterpartyProfile.upsert({
          where: {
            nameFingerprint_counterpartyCnpjCpf: {
              nameFingerprint: fingerprint,
              counterpartyCnpjCpf: cnpj,
            },
          },
          create: {
            nameFingerprint: fingerprint,
            counterpartyCnpjCpf: cnpj,
            displayName: opts.counterpartyName,
            source: opts.source,
            confirmedCount: 1,
            rejectedCount: 0,
            firstObservedAt: now,
            lastConfirmedAt: now,
          },
          update: {
            confirmedCount: { increment: 1 },
            lastConfirmedAt: now,
            disabledAt: null,
            ...(opts.counterpartyName ? { displayName: opts.counterpartyName } : {}),
            ...(opts.source === LearnedRuleSource.MANUAL
              ? { source: LearnedRuleSource.MANUAL }
              : {}),
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `record() failed (cnpj=${opts.counterpartyCnpjCpf}, txType=${opts.txType}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * A signal this learner produced was corrected. Decay the backing rule (and
   * the identity profile that resolved the CNPJ). Best-effort: never throws.
   */
  async recordReversal(tx: ClassifierSignalInput, signal: CategorySignal): Promise<void> {
    try {
      const cnpj = digitsOnly(signal.counterpartyCnpjCpf || tx.counterpartyCnpjCpf);
      if (!cnpj) return;

      if (signal.categoryId) {
        const rule = await this.prisma.counterpartyCategoryRule.findUnique({
          where: {
            counterpartyCnpjCpf_txType: {
              counterpartyCnpjCpf: cnpj,
              txType: tx.type,
            },
          },
        });
        // Only penalize the rule if it actually asserted the reversed category.
        if (rule && rule.categoryId === signal.categoryId) {
          await this.applyRuleRejection(this.prisma, rule);
        }
      }

      // Decay the identity profile that maps this name to this CNPJ.
      const fingerprint = nameFingerprint(tx.counterpartyName);
      if (fingerprint) {
        const profile = await this.prisma.counterpartyProfile.findUnique({
          where: {
            nameFingerprint_counterpartyCnpjCpf: {
              nameFingerprint: fingerprint,
              counterpartyCnpjCpf: cnpj,
            },
          },
        });
        if (profile) {
          const nextRejected = profile.rejectedCount + 1;
          const shouldDisable =
            profile.source !== LearnedRuleSource.MANUAL &&
            nextRejected >= 2 &&
            nextRejected > profile.confirmedCount;
          await this.prisma.counterpartyProfile.update({
            where: { id: profile.id },
            data: {
              rejectedCount: nextRejected,
              ...(shouldDisable ? { disabledAt: new Date() } : {}),
            },
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `recordReversal() failed for tx ${tx?.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** A human confirmed/set this category — reinforce as a MANUAL observation. */
  async recordConfirmation(tx: ClassifierSignalInput, categoryId: string): Promise<void> {
    await this.record({
      counterpartyCnpjCpf: tx.counterpartyCnpjCpf,
      counterpartyName: tx.counterpartyName,
      txType: tx.type,
      categoryId,
      source: LearnedRuleSource.MANUAL,
    });
  }

  /**
   * Soft-disable a learned rule once rejections clearly outweigh confirmations.
   * MANUAL rules are never auto-disabled — only a human can override them.
   */
  private async applyRuleRejection(
    db: Prisma.TransactionClient | PrismaService,
    rule: CounterpartyCategoryRule,
  ): Promise<void> {
    const nextRejected = rule.rejectedCount + 1;
    const shouldDisable =
      rule.source !== LearnedRuleSource.MANUAL &&
      nextRejected >= 2 &&
      nextRejected > rule.confirmedCount;

    await db.counterpartyCategoryRule.update({
      where: { id: rule.id },
      data: {
        rejectedCount: nextRejected,
        ...(shouldDisable ? { disabledAt: new Date() } : {}),
      },
    });
  }
}
