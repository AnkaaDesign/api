import { Prisma, ReconciliationStatus } from '@prisma/client';

/**
 * Allocation tolerance in BRL. A transaction whose live allocations land within
 * this distance of its own value counts as fully covered.
 *
 * This used to be hand-inlined at six call sites with three different values
 * (0.05 here, a scaled aggregateTolerance() in the receivable matcher, a Decimal
 * one-sided comparison in the installment settler). The divergence meant the
 * same coverage could read RECONCILED on one path and PARTIAL on another.
 */
export const ALLOCATION_TOLERANCE = 0.05;

/**
 * The anchor a match points at. Coverage is measured PER KIND, never across
 * kinds — see the note on {@link computeReconciliationStatus}.
 */
export type AllocationAnchorKind =
  | 'fiscalDocument'
  | 'bankSlip'
  | 'installment'
  | 'orderInstallment'
  | 'recurrentOccurrence'
  | 'airbrushing'
  | 'payroll';

export interface AllocationInput {
  amount: number | Prisma.Decimal;
  kind: AllocationAnchorKind;
}

export interface ReconciliationStatusInputs {
  /** Transaction value. Sign is ignored — coverage is compared in absolute terms. */
  txAmount: number | Prisma.Decimal;
  /** Every non-reversed match on this transaction, with the anchor it points at. */
  allocations: AllocationInput[];
  /**
   * True when the uncovered remainder is explained by a reason (frete, seguro,
   * taxas, item sem nota). Set by manualMatch's remainderReason. Previously this
   * was honoured by manualMatch but DROPPED by unmatchFiscalDocument's recompute,
   * so un-linking one NF from a multi-NF transaction silently demoted a
   * legitimately-RECONCILED row to PARTIAL.
   */
  remainderResolved?: boolean;
  /**
   * True when the transaction carries at least one TransactionCategory with
   * isResolving = true. Such a transaction is self-justifying (bank fee, DARF,
   * payroll, pró-labore) and is RECONCILED with no match row at all.
   */
  hasResolvingCategory?: boolean;
}

/**
 * The single definition of what reconciliationStatus means.
 *
 * Precedence: a live match always wins over a resolving category — a transaction
 * backed by an actual document is reconciled on that basis, not on a tag.
 */
export function computeReconciliationStatus(
  input: ReconciliationStatusInputs,
): ReconciliationStatus {
  const txAbs = Math.abs(Number(input.txAmount));
  // Coverage is the LARGEST single anchor kind, matching `deriveSettlement`.
  //
  // This used to sum across kinds, and the two functions therefore disagreed on
  // what "covered" means. A supplier payment legitimately carries both the order
  // parcela it settles and the NF that documents it: those are parallel
  // DESCRIPTIONS of one payment, not two slices of it, so adding them reported
  // 2× coverage. Harmless while both were complete, but it also meant a payment
  // half-covered by an NF and half-covered by an unrelated obligation summed to
  // "fully reconciled" — the one case where it silently hides a real gap.
  const byKind = new Map<AllocationAnchorKind, number>();
  for (const a of input.allocations) {
    byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + Number(a.amount));
  }
  const allocated = byKind.size > 0 ? Math.max(...byKind.values()) : 0;

  if (input.allocations.length > 0) {
    // Fully covered (or over-covered — over-allocation is prevented at write
    // time; if one slips through, coverage is still complete).
    if (allocated >= txAbs - ALLOCATION_TOLERANCE) return ReconciliationStatus.RECONCILED;
    // Under-covered, but the gap is accounted for.
    if (input.remainderResolved) return ReconciliationStatus.RECONCILED;
    return ReconciliationStatus.PARTIAL;
  }

  if (input.hasResolvingCategory) return ReconciliationStatus.RECONCILED;

  return ReconciliationStatus.PENDING;
}

/**
 * Loads a transaction's live matches and resolving tags and returns the status it
 * should have, together with the flags that must move with it.
 *
 * `expectsFiscalDocument` is derived here rather than left to each caller. It had
 * drifted into four incompatible meanings across its writers and was never
 * re-evaluated after the initial classification, which is why 19 transactions sat
 * RECONCILED-by-category while still flagged as expecting a document they would
 * never get.
 */
/**
 * Which anchor a match points at. Exactly one FK is set per match; the order
 * here only decides the label for a malformed row carrying more than one.
 */
export function anchorKindOf(m: {
  fiscalDocumentId?: string | null;
  bankSlipId?: string | null;
  installmentId?: string | null;
  orderInstallmentId?: string | null;
  recurrentOccurrenceId?: string | null;
  airbrushingId?: string | null;
  payrollMonthSettlementId?: string | null;
}): AllocationAnchorKind {
  if (m.fiscalDocumentId) return 'fiscalDocument';
  if (m.bankSlipId) return 'bankSlip';
  if (m.installmentId) return 'installment';
  if (m.orderInstallmentId) return 'orderInstallment';
  if (m.recurrentOccurrenceId) return 'recurrentOccurrence';
  if (m.airbrushingId) return 'airbrushing';
  return 'payroll';
}

export async function deriveTransactionState(
  db: Prisma.TransactionClient,
  transactionId: string,
  opts: { remainderResolved?: boolean } = {},
): Promise<{
  status: ReconciliationStatus;
  expectsFiscalDocument: boolean;
  hasLiveMatch: boolean;
  hasResolvingCategory: boolean;
}> {
  const tx = await db.bankTransaction.findUnique({
    where: { id: transactionId },
    select: { amount: true, counterpartyCnpjCpf: true },
  });
  if (!tx) throw new Error(`BankTransaction ${transactionId} not found`);

  const [matches, resolvingTags] = await Promise.all([
    db.reconciliationMatch.findMany({
      where: { transactionId, reversedAt: null },
      select: {
        allocatedAmount: true,
        remainderReason: true,
        fiscalDocumentId: true,
        bankSlipId: true,
        installmentId: true,
        orderInstallmentId: true,
        recurrentOccurrenceId: true,
        airbrushingId: true,
        payrollMonthSettlementId: true,
      },
    }),
    db.bankTransactionCategory.count({
      where: { transactionId, category: { isResolving: true } },
    }),
  ]);

  const hasResolvingCategory = resolvingTags > 0;
  // A surviving match that carries a remainder reason still explains the
  // uncovered slice of the payment, so the transaction stays reconciled.
  const remainderResolved =
    opts.remainderResolved ?? matches.some(m => m.remainderReason !== null);
  const status = computeReconciliationStatus({
    txAmount: tx.amount,
    allocations: matches.map(m => ({ amount: m.allocatedAmount, kind: anchorKindOf(m) })),
    remainderResolved,
    hasResolvingCategory,
  });

  // An NF is expected when the row is backed by a fiscal document, or when it is
  // still open against an identified counterparty. A resolving category settles
  // the question in the negative — that is the whole point of the category.
  const hasFiscalMatch = matches.some(m => m.fiscalDocumentId !== null);
  const expectsFiscalDocument = hasFiscalMatch
    ? true
    : hasResolvingCategory
      ? false
      : Boolean(tx.counterpartyCnpjCpf);

  return {
    status,
    expectsFiscalDocument,
    hasLiveMatch: matches.length > 0,
    hasResolvingCategory,
  };
}
