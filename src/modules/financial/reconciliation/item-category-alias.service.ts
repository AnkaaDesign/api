import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ItemCategoryAlias, ItemCategoryAliasSource, Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { descriptionFingerprint } from './text-normalization';

const AMBIGUITY_GUARD_RATIO = 2;
const ALIAS_DISABLE_REQUIRED_REJECTIONS = 2;

/**
 * Learns and serves (NF line description fingerprint → category) pairs — the
 * categorizer's analogue of ReconciliationAliasService. Two learning sources:
 *   - AUTO_CODE: a line resolved deterministically via a uniCode hit. Recording
 *     its fingerprint lets the SAME product categorize later even when the code
 *     isn't in the text (e.g. a different supplier's description).
 *   - MANUAL: a human set/corrected the category. Strongest signal; upgrades
 *     provenance and clears soft-disable.
 *
 * Safety mirrors the match alias learner: resolve() skips disabled rows and
 * refuses ambiguous fingerprints (two different categories within 2×); AUTO_CODE
 * rows soft-disable after repeated rejections; MANUAL rows are never auto-disabled.
 */
@Injectable()
export class ItemCategoryAliasService {
  private readonly logger = new Logger(ItemCategoryAliasService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
  ) {}

  /** Loads all enabled aliases and resolves each fingerprint to its single best
   * category (with the ambiguity guard applied). Used to build the in-memory map
   * the classifier consults per line — avoids a query per NF line. */
  async buildResolvedMap(): Promise<Map<string, { categoryId: string; confidence: number }>> {
    const aliases = await this.prisma.itemCategoryAlias.findMany({
      where: { disabledAt: null },
    });
    const byFp = new Map<string, ItemCategoryAlias[]>();
    for (const a of aliases) {
      const arr = byFp.get(a.descriptionFingerprint) ?? [];
      arr.push(a);
      byFp.set(a.descriptionFingerprint, arr);
    }
    const out = new Map<string, { categoryId: string; confidence: number }>();
    for (const [fp, list] of byFp) {
      const resolved = this.pickBest(list);
      if (resolved) out.set(fp, resolved);
    }
    return out;
  }

  private pickBest(
    list: ItemCategoryAlias[],
  ): { categoryId: string; confidence: number } | null {
    if (list.length === 0) return null;
    const ranked = [...list].sort((a, b) => {
      const ra = sourceRank(a.source);
      const rb = sourceRank(b.source);
      if (ra !== rb) return rb - ra;
      return b.confirmedCount - a.confirmedCount;
    });
    const top = ranked[0];
    const runnerUp = ranked[1];
    // Ambiguity guard: a different category close behind the leader → don't resolve.
    if (
      runnerUp &&
      runnerUp.categoryId !== top.categoryId &&
      sourceRank(runnerUp.source) === sourceRank(top.source) &&
      runnerUp.confirmedCount * AMBIGUITY_GUARD_RATIO > top.confirmedCount
    ) {
      return null;
    }
    return { categoryId: top.categoryId, confidence: aliasConfidence(top) };
  }

  /** Records a confirmed (fingerprint → category) pair. Idempotent on the unique
   * key. Best-effort — callers must never let alias writes break their flow. */
  async record(opts: {
    description: string | null;
    categoryId: string;
    source: ItemCategoryAliasSource;
    prismaTx?: Prisma.TransactionClient;
  }): Promise<void> {
    const fp = descriptionFingerprint(opts.description);
    if (!fp) return;
    const db = opts.prismaTx ?? this.prisma;
    const now = new Date();
    try {
      await db.itemCategoryAlias.upsert({
        where: {
          descriptionFingerprint_categoryId: {
            descriptionFingerprint: fp,
            categoryId: opts.categoryId,
          },
        },
        create: {
          descriptionFingerprint: fp,
          categoryId: opts.categoryId,
          source: opts.source,
          confirmedCount: 1,
          lastConfirmedAt: now,
        },
        update: {
          confirmedCount: { increment: 1 },
          lastConfirmedAt: now,
          // Manual confirmations upgrade provenance and clear soft-disable.
          ...(opts.source === ItemCategoryAliasSource.MANUAL
            ? { source: ItemCategoryAliasSource.MANUAL, disabledAt: null, rejectedCount: 0 }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record item-category alias: ${err}`);
    }
  }

  /** Records a rejection of a learned (fingerprint → category) mapping — e.g.
   * when a user changes a line away from a previously-learned category. AUTO_CODE
   * rows soft-disable after crossing the rejection threshold; MANUAL never does. */
  async recordReversal(opts: {
    description: string | null;
    categoryId: string;
    prismaTx?: Prisma.TransactionClient;
  }): Promise<void> {
    const fp = descriptionFingerprint(opts.description);
    if (!fp) return;
    const db = opts.prismaTx ?? this.prisma;
    const existing = await db.itemCategoryAlias.findUnique({
      where: {
        descriptionFingerprint_categoryId: {
          descriptionFingerprint: fp,
          categoryId: opts.categoryId,
        },
      },
    });
    if (!existing) return;
    const nextRejected = existing.rejectedCount + 1;
    const shouldDisable =
      existing.source !== ItemCategoryAliasSource.MANUAL &&
      nextRejected >= ALIAS_DISABLE_REQUIRED_REJECTIONS &&
      nextRejected > existing.confirmedCount;
    await db.itemCategoryAlias.update({
      where: { id: existing.id },
      data: {
        rejectedCount: nextRejected,
        ...(shouldDisable ? { disabledAt: new Date() } : {}),
      },
    });
  }
}

function sourceRank(s: ItemCategoryAliasSource): number {
  switch (s) {
    case ItemCategoryAliasSource.MANUAL:
      return 2;
    case ItemCategoryAliasSource.ADMIN_SEEDED:
      return 1;
    case ItemCategoryAliasSource.AUTO_CODE:
      return 0;
    default:
      return 0;
  }
}

function aliasConfidence(alias: ItemCategoryAlias): number {
  // A learned human correction is near-authoritative; a deterministic code-hit
  // is strong; both stay below the live uniCode tier (100).
  if (alias.source === ItemCategoryAliasSource.MANUAL) {
    return alias.confirmedCount >= 2 ? 97 : 95;
  }
  if (alias.source === ItemCategoryAliasSource.ADMIN_SEEDED) return 92;
  // AUTO_CODE
  return alias.confirmedCount >= 3 ? 90 : 86;
}
