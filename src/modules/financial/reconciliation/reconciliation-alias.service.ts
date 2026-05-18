import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  BankTransactionType,
  Prisma,
  ReconciliationAlias,
  ReconciliationAliasSource,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { memoFingerprint } from './text-normalization';

const AMBIGUITY_GUARD_RATIO = 2;
const ALIAS_DISABLE_REQUIRED_REJECTIONS = 2;

/**
 * Learns and serves (OFX memo fingerprint → counterparty CNPJ/CPF) pairs
 * harvested from confirmed reconciliation matches. Designed to be the only
 * surface that touches `ReconciliationAlias` — everything else goes through
 * resolve()/recordMatchSuccess()/recordReversal().
 *
 * Safety properties:
 *   - resolve() never returns a disabled alias.
 *   - resolve() never returns an alias if there's another alias for the same
 *     (fingerprint, txType) within AMBIGUITY_GUARD_RATIO of the top one's
 *     confirmedCount — surfacing both candidates is the matcher's job, not
 *     ours.
 *   - aliasConfidence() returns 0 (no boost) for single-attestation AUTO
 *     aliases, so the system never bootstraps off its own auto-matches.
 *   - recordReversal() never disables a MANUAL_MATCH-sourced alias; humans
 *     own those rows.
 */
@Injectable()
export class ReconciliationAliasService {
  private readonly logger = new Logger(ReconciliationAliasService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
  ) {}

  /**
   * Looks up the best alias for an OFX transaction. Returns null when the
   * memo doesn't fingerprint, when no alias exists, when the top alias is
   * disabled, or when the top two aliases are too close to call.
   */
  async resolve(
    memo: string | null,
    txType: BankTransactionType,
  ): Promise<ReconciliationAlias | null> {
    const fp = memoFingerprint(memo);
    if (!fp) return null;

    const aliases = await this.prisma.reconciliationAlias.findMany({
      where: {
        memoFingerprint: fp,
        txType,
        disabledAt: null,
      },
      orderBy: [
        // Prefer manual provenance before raw count — a single human confirmation
        // outweighs three auto-matches.
        { source: 'asc' }, // ADMIN_SEEDED < AUTO_MATCH < MANUAL_MATCH alphabetically? Check enum below.
        { confirmedCount: 'desc' },
      ],
      take: 2,
    });

    if (aliases.length === 0) return null;

    // The orderBy on source above sorts alphabetically (ADMIN_SEEDED, AUTO_MATCH,
    // MANUAL_MATCH). We actually want MANUAL_MATCH first; redo the ranking in
    // code so it's clearly correct regardless of enum string ordering.
    aliases.sort((a, b) => {
      const ra = sourceRank(a.source);
      const rb = sourceRank(b.source);
      if (ra !== rb) return rb - ra; // higher rank first
      return b.confirmedCount - a.confirmedCount;
    });

    const top = aliases[0];
    const runnerUp = aliases[1];

    // Ambiguity guard: two aliases for the same fingerprint that map to
    // different CNPJs, with the runner-up close enough to the leader, mean
    // we shouldn't auto-resolve. Same CNPJ on both → not ambiguous.
    if (
      runnerUp &&
      runnerUp.counterpartyCnpjCpf !== top.counterpartyCnpjCpf &&
      sourceRank(runnerUp.source) === sourceRank(top.source) &&
      runnerUp.confirmedCount * AMBIGUITY_GUARD_RATIO > top.confirmedCount
    ) {
      return null;
    }

    return top;
  }

  /**
   * 0..1 multiplier applied to the CNPJ component of the score when the
   * effective CNPJ came from this alias instead of from the OFX memo itself.
   * Designed to never reward a single auto-match with full credit — without
   * this, the system would loop-amplify any one-off mistake.
   */
  aliasConfidence(alias: ReconciliationAlias): number {
    if (alias.disabledAt) return 0;
    if (alias.source === ReconciliationAliasSource.MANUAL_MATCH) {
      if (alias.confirmedCount >= 3) return 1.0;
      return 0.9;
    }
    if (alias.source === ReconciliationAliasSource.ADMIN_SEEDED) {
      return 0.95;
    }
    // AUTO_MATCH — needs sustained confirmation to be trusted.
    if (alias.confirmedCount >= 5) return 0.85;
    if (alias.confirmedCount >= 2) return 0.75;
    return 0; // single auto-only attestation never auto-promotes
  }

  /**
   * Records a confirmed (memo → counterparty) pair. Idempotent on the
   * (fingerprint, cnpj, txType) tuple — repeated calls increment confirmedCount.
   * A MANUAL_MATCH confirmation also clears disabledAt and decrements
   * rejectedCount toward zero (humans override prior auto-reversals).
   *
   * Wrap callers in try/catch — alias writes must never break the user's
   * actual match action.
   */
  async recordMatchSuccess(opts: {
    memo: string | null;
    txType: BankTransactionType;
    counterpartyCnpjCpf: string;
    source: ReconciliationAliasSource;
    prismaTx?: Prisma.TransactionClient;
  }): Promise<ReconciliationAlias | null> {
    const fp = memoFingerprint(opts.memo);
    if (!fp) return null;
    const counterparty = (opts.counterpartyCnpjCpf || '').replace(/\D/g, '');
    if (!counterparty) return null;

    const db = opts.prismaTx ?? this.prisma;
    const now = new Date();

    return db.reconciliationAlias.upsert({
      where: {
        memoFingerprint_counterpartyCnpjCpf_txType: {
          memoFingerprint: fp,
          counterpartyCnpjCpf: counterparty,
          txType: opts.txType,
        },
      },
      create: {
        memoFingerprint: fp,
        counterpartyCnpjCpf: counterparty,
        txType: opts.txType,
        source: opts.source,
        confirmedCount: 1,
        rejectedCount: 0,
        firstObservedAt: now,
        lastConfirmedAt: now,
      },
      update: {
        confirmedCount: { increment: 1 },
        lastConfirmedAt: now,
        // Manual confirmations upgrade provenance and clear soft-disable.
        // Auto confirmations never downgrade an existing manual record.
        ...(opts.source === ReconciliationAliasSource.MANUAL_MATCH
          ? {
              source: ReconciliationAliasSource.MANUAL_MATCH,
              disabledAt: null,
              rejectedCount: { decrement: 1 },
            }
          : {}),
      },
    });
  }

  /**
   * Records a rejection. Caller MUST pass the same fingerprint/counterparty
   * triple that the original recordMatchSuccess used — typically derived from
   * the BankTransaction memo and the ReconciliationMatch.fiscalDocument the
   * user is reversing.
   *
   * AUTO_MATCH-sourced aliases get soft-disabled when their rejection count
   * crosses ALIAS_DISABLE_REQUIRED_REJECTIONS AND exceeds confirmedCount.
   * MANUAL_MATCH aliases are tracked but never auto-disabled.
   */
  async recordReversal(opts: {
    memo: string | null;
    txType: BankTransactionType;
    counterpartyCnpjCpf: string;
    prismaTx?: Prisma.TransactionClient;
  }): Promise<void> {
    const fp = memoFingerprint(opts.memo);
    if (!fp) return;
    const counterparty = (opts.counterpartyCnpjCpf || '').replace(/\D/g, '');
    if (!counterparty) return;

    const db = opts.prismaTx ?? this.prisma;
    const existing = await db.reconciliationAlias.findUnique({
      where: {
        memoFingerprint_counterpartyCnpjCpf_txType: {
          memoFingerprint: fp,
          counterpartyCnpjCpf: counterparty,
          txType: opts.txType,
        },
      },
    });
    if (!existing) return;

    const nextRejected = existing.rejectedCount + 1;
    const shouldDisable =
      existing.source !== ReconciliationAliasSource.MANUAL_MATCH &&
      nextRejected >= ALIAS_DISABLE_REQUIRED_REJECTIONS &&
      nextRejected > existing.confirmedCount;

    await db.reconciliationAlias.update({
      where: { id: existing.id },
      data: {
        rejectedCount: nextRejected,
        ...(shouldDisable ? { disabledAt: new Date() } : {}),
      },
    });
  }

  /**
   * Walks historical ReconciliationMatch rows that have a fiscalDocument
   * attached and replays them into aliases. Used as a one-time admin
   * operation after deployment to bootstrap the table from production data.
   *
   * Returns counts so the caller can show progress in the UI.
   */
  async backfillFromHistory(limit = 5000): Promise<{
    processed: number;
    aliasesCreated: number;
    aliasesUpdated: number;
    skipped: number;
  }> {
    const matches = await this.prisma.reconciliationMatch.findMany({
      where: {
        fiscalDocumentId: { not: null },
        reversedAt: null,
      },
      orderBy: { matchedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        matchedByUserId: true,
        transaction: {
          select: {
            id: true,
            memo: true,
            type: true,
            counterpartyCnpjCpf: true,
            statement: { select: { ownerCnpj: true } },
          },
        },
        fiscalDocument: {
          select: {
            id: true,
            emitCnpj: true,
            destCnpj: true,
            destCpf: true,
          },
        },
      },
    });

    let aliasesCreated = 0;
    let aliasesUpdated = 0;
    let skipped = 0;
    for (const m of matches) {
      if (!m.transaction || !m.fiscalDocument) {
        skipped += 1;
        continue;
      }
      const counterparty =
        m.transaction.counterpartyCnpjCpf ||
        inferCounterpartyCnpj(
          m.fiscalDocument,
          m.transaction.statement?.ownerCnpj ?? null,
        );
      if (!counterparty) {
        skipped += 1;
        continue;
      }
      try {
        const before = await this.prisma.reconciliationAlias.findUnique({
          where: {
            memoFingerprint_counterpartyCnpjCpf_txType: {
              memoFingerprint: memoFingerprint(m.transaction.memo) ?? '',
              counterpartyCnpjCpf: counterparty.replace(/\D/g, ''),
              txType: m.transaction.type,
            },
          },
          select: { id: true },
        });
        const result = await this.recordMatchSuccess({
          memo: m.transaction.memo,
          txType: m.transaction.type,
          counterpartyCnpjCpf: counterparty,
          source: m.matchedByUserId
            ? ReconciliationAliasSource.MANUAL_MATCH
            : ReconciliationAliasSource.AUTO_MATCH,
        });
        if (!result) {
          skipped += 1;
        } else if (before) {
          aliasesUpdated += 1;
        } else {
          aliasesCreated += 1;
        }
      } catch (err) {
        this.logger.warn(`Backfill failed for match ${m.id}: ${err}`);
        skipped += 1;
      }
    }

    return {
      processed: matches.length,
      aliasesCreated,
      aliasesUpdated,
      skipped,
    };
  }
}

function sourceRank(s: ReconciliationAliasSource): number {
  // Higher = more authoritative. MANUAL_MATCH outranks ADMIN_SEEDED outranks AUTO_MATCH.
  switch (s) {
    case ReconciliationAliasSource.MANUAL_MATCH:
      return 2;
    case ReconciliationAliasSource.ADMIN_SEEDED:
      return 1;
    case ReconciliationAliasSource.AUTO_MATCH:
      return 0;
    default:
      return 0;
  }
}

/**
 * Given a FiscalDocument and the bank-statement owner's CNPJ, returns the
 * "other" party's identifier — i.e. the counterparty. Used by alias capture
 * for manual matches where the OFX side didn't have a parseable CNPJ.
 */
export function inferCounterpartyCnpj(
  doc: {
    emitCnpj: string;
    destCnpj?: string | null;
    destCpf?: string | null;
  },
  ownerCnpj: string | null,
): string | null {
  const ownerDigits = (ownerCnpj || '').replace(/\D/g, '');
  const emitDigits = (doc.emitCnpj || '').replace(/\D/g, '');
  const destCnpjDigits = (doc.destCnpj || '').replace(/\D/g, '');
  const destCpfDigits = (doc.destCpf || '').replace(/\D/g, '');

  if (!ownerDigits) {
    // Unknown owner — best-effort: prefer destCnpj/destCpf when emitCnpj looks
    // like a supplier (i.e., not the owner). Without an owner we can't know
    // which side is us, so bail.
    return null;
  }

  if (emitDigits === ownerDigits) {
    return destCnpjDigits || destCpfDigits || null;
  }
  if (destCnpjDigits === ownerDigits || destCpfDigits === ownerDigits) {
    return emitDigits || null;
  }
  // Neither side is the owner — possibly a third-party receipt. Skip alias
  // capture to avoid learning a wrong mapping.
  return null;
}
