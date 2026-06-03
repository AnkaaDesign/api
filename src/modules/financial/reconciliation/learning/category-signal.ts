import {
  BankTransactionType,
  BankTransactionSubtype,
  ReconciliationStatus,
} from '@prisma/client';

/**
 * Shared contracts for the self-learning categorization layer.
 *
 * Every learner (counterparty / memo-token / NF-emitter / the legacy ladder)
 * emits zero or more {@link CategorySignal}s for a transaction; the
 * CategoryFusionService combines them into a single {@link FusedDecision}.
 *
 * NOTE (tsconfig is non-strict): these are hand-written interfaces for INTERNAL
 * value objects — never derive them from a `z.infer`, which would make every
 * field optional (`undefined extends T`).
 */

/** Identifies which learner produced a signal. Drives fusion trust weights. */
export enum LearningSource {
  // Learners.
  COUNTERPARTY = 'COUNTERPARTY', // CPF/CNPJ → category (memo-independent)
  COUNTERPARTY_IDENTITY = 'COUNTERPARTY_IDENTITY', // name → CNPJ identity
  MEMO_TOKEN = 'MEMO_TOKEN', // generalizing memo token-vote
  NF_EMITTER = 'NF_EMITTER', // emitter→category prior
  NF_LINE_DERIVED = 'NF_LINE_DERIVED', // upward-propagated NF line categories
  // Day-one fallback sources — the current precedence ladder re-expressed as
  // signals so behavior is identical before any learning accumulates.
  COUNTERPARTY_HARDCODE = 'COUNTERPARTY_HARDCODE',
  ALIAS = 'ALIAS',
  SUBTYPE = 'SUBTYPE',
  MEMO_REGEX = 'MEMO_REGEX',
  MARKETPLACE = 'MARKETPLACE',
}

/**
 * Static per-source trust weight applied to a signal's own confidence. Effective
 * evidence e = weight × confidence; a lone signal auto-applies when e ≥ 0.85.
 *
 * The deterministic day-one ladder rules (hardcode/subtype/memo-regex, emitted
 * at confidence 1.0) are weighted ≥0.9 so they keep auto-applying exactly as
 * before. The learned signals are weighted lower so a single uncertain
 * attestation only SUGGESTs until it is corroborated or repeatedly confirmed.
 */
export const SOURCE_WEIGHT: Record<LearningSource, number> = {
  [LearningSource.COUNTERPARTY_HARDCODE]: 1.0, // human-curated constant
  [LearningSource.ALIAS]: 0.95, // already decay-managed by aliasConfidence
  [LearningSource.SUBTYPE]: 0.9, // deterministic
  [LearningSource.MEMO_REGEX]: 0.9, // deterministic
  [LearningSource.COUNTERPARTY]: 0.9, // learned identity → category
  [LearningSource.NF_EMITTER]: 0.85,
  [LearningSource.NF_LINE_DERIVED]: 0.82,
  [LearningSource.MEMO_TOKEN]: 0.8, // learned token-vote (suggests until corroborated)
  [LearningSource.MARKETPLACE]: 0.5, // expects-NF only, never resolves
  [LearningSource.COUNTERPARTY_IDENTITY]: 0.0, // identity-only, never resolves a category
};

/** Coarse "family" of a source, for the conflict-margin tie-break in fusion. */
export type SignalFamily = 'IDENTITY' | 'TEXT' | 'NF' | 'OTHER';
export function signalFamily(source: LearningSource): SignalFamily {
  switch (source) {
    case LearningSource.COUNTERPARTY:
    case LearningSource.COUNTERPARTY_IDENTITY:
    case LearningSource.COUNTERPARTY_HARDCODE:
    case LearningSource.ALIAS:
      return 'IDENTITY';
    case LearningSource.MEMO_TOKEN:
    case LearningSource.MEMO_REGEX:
    case LearningSource.SUBTYPE:
      return 'TEXT';
    case LearningSource.NF_EMITTER:
    case LearningSource.NF_LINE_DERIVED:
      return 'NF';
    default:
      return 'OTHER';
  }
}

/**
 * The atom every learner emits. A learner may emit 0..n per transaction.
 * `confidence` is the learner's own calibrated, decay-adjusted belief (0..1).
 */
export interface CategorySignal {
  source: LearningSource;
  /** Target category. Absent ⇒ identity-only or expects-NF signal. */
  categoryId?: string;
  /** Counterparty identity the signal resolved/asserts (digits-only). */
  counterpartyCnpjCpf?: string;
  /** Decay-adjusted belief, 0..1. */
  confidence: number;
  /** Human-readable rationale, surfaced by the explain() endpoint. */
  provenance: string;
  /** True ⇒ if this wins, route to the NF scoring matcher instead of resolving. */
  expectsFiscalDocument?: boolean;
  /** Id of the concrete learned row, so a later reversal hits the right row. */
  ruleRef?: string;
}

export enum DecisionTier {
  AUTO_APPLY = 'AUTO_APPLY', // set category + reconcile if resolving
  SUGGEST = 'SUGGEST', // store suggestion, one-click confirm, do NOT reconcile
  ABSTAIN = 'ABSTAIN', // leave for manual / fall through to NF matcher
}

export interface FusedDecision {
  tier: DecisionTier;
  categoryId?: string;
  expectsFiscalDocument: boolean;
  /** Fused 0..1 confidence (agreement-boosted evidence score). */
  confidence: number;
  /** Winning category is a resolving (transaction-only) category. */
  shouldReconcile: boolean;
  /** Every signal that contributed, for explainability. */
  breakdown: CategorySignal[];
  /** Signals that voted for the winning category. */
  winners: CategorySignal[];
  /** Conflicting signals that lost (different categoryId). */
  conflicts: CategorySignal[];
  reason: string;
}

/**
 * Read model handed to each learner's collect()/reversal/confirmation hooks so
 * they need not re-query the transaction. Supersets the classifier's
 * ClassifierInput with the fields learners A/C need (name, amount).
 */
export interface ClassifierSignalInput {
  id: string;
  type: BankTransactionType;
  subtype: BankTransactionSubtype;
  memo: string | null;
  counterpartyCnpjCpf: string | null;
  counterpartyName: string | null;
  amount: number;
  reconciliationStatus: ReconciliationStatus;
}

/**
 * Implemented by every learner. The fusion spine only knows this interface, so
 * adding a learner never touches classify(). All methods are best-effort and
 * MUST NOT throw (wrap internals in try/catch) — a learner failure can never
 * break classification or the user's action.
 */
export interface CategoryLearner {
  readonly source: LearningSource;
  /** Emit signals for a transaction. */
  collect(tx: ClassifierSignalInput): Promise<CategorySignal[]>;
  /** A signal this learner produced was corrected — decay the backing row. */
  recordReversal(tx: ClassifierSignalInput, signal: CategorySignal): Promise<void>;
  /** A human confirmed/set this category — reinforce. */
  recordConfirmation(tx: ClassifierSignalInput, categoryId: string): Promise<void>;
}

/** DI token for the ordered learner array consumed by CategoryFusionService. */
export const CATEGORY_LEARNERS = 'CATEGORY_LEARNERS';
