// Aligned-depletion balancing (spec §10.2): normalize coverage across same-
// supplier basket items so they all run out around the same date.
//
// Inputs describe one candidate per item — `proposedQty` is the un-balanced
// quantity that another planner already computed (reorder-quantity logic).
// The helper picks a target depletion date (the latest among proposed
// quantities, bounded by each item's own lead-time floor) and trims each
// item's quantity so all items deplete near that date.
//
// Constraints (per spec):
//   - NEVER reduce the final basket quantity below what's needed to keep
//     stock above `reorderPoint` after the lead time elapses (lead-time
//     floor protection).
//   - NEVER exceed `maxQuantity` (headroom protection). When maxQuantity
//     is null, treat it as Infinity.
//
// The original `order-schedule.service.ts` block aligned to the MINIMUM
// coverage (trim long-coverage items down to the shortest). We preserve
// that behavior here because it matches the spec rationale: avoid
// over-ordering items that are already long-covered when a shorter-covered
// sibling forces an order anyway.

export interface BalanceDepletionInput {
  currentQty: number;
  proposedQty: number;
  dailyConsumption: number;
  maxQuantity: number | null;
  reorderPoint: number;
  leadTimeDays: number;
  /** Optional pending-receipt quantity that will arrive before depletion. */
  incomingQty?: number;
}

export interface BalanceDepletionResult extends BalanceDepletionInput {
  balancedQty: number;
  /** Projected coverage in days using the balanced quantity. */
  coverageDays: number;
}

/**
 * Trim each item's quantity so the basket depletes on approximately the
 * same date. Aligns to the MINIMUM coverage across the basket — items
 * with longer projected coverage get reduced; items at or below the
 * minimum are left alone.
 */
export function balanceDepletionAcrossItems(
  items: BalanceDepletionInput[],
): BalanceDepletionResult[] {
  if (items.length === 0) return [];

  // First pass: compute projected coverage assuming each item gets its
  // proposed quantity.
  const projected = items.map(it => {
    const incoming = it.incomingQty ?? 0;
    const totalUnits = it.currentQty + incoming + it.proposedQty;
    const coverage =
      it.dailyConsumption > 0 ? totalUnits / it.dailyConsumption : Number.POSITIVE_INFINITY;
    return { input: it, incoming, coverage };
  });

  // Ignore items whose coverage is Infinity (no consumption) when computing
  // the alignment target — they shouldn't anchor the basket.
  const finiteCoverages = projected
    .map(p => p.coverage)
    .filter(c => Number.isFinite(c));
  const target =
    finiteCoverages.length > 0
      ? Math.min(...finiteCoverages)
      : Number.POSITIVE_INFINITY;

  // Second pass: trim each item's proposed quantity to land near the target
  // coverage, but never below the lead-time floor and never above
  // maxQuantity.
  return projected.map(p => {
    const { input, incoming, coverage } = p;
    const { currentQty, proposedQty, dailyConsumption, maxQuantity, reorderPoint, leadTimeDays } =
      input;

    const maxCeiling = maxQuantity ?? Number.POSITIVE_INFINITY;

    // Items with no consumption or no proposed qty pass through unchanged
    // (still clamped to maxQuantity).
    if (dailyConsumption <= 0 || proposedQty <= 0 || !Number.isFinite(target)) {
      const passthrough = Math.max(0, Math.min(proposedQty, maxCeiling - currentQty - incoming));
      return {
        ...input,
        balancedQty: passthrough,
        coverageDays: coverage,
      };
    }

    // Target total units = target coverage × daily consumption.
    const targetTotal = target * dailyConsumption;
    const reducedProposed = Math.max(0, targetTotal - currentQty - incoming);

    // Lead-time floor: after `leadTimeDays` of depletion the remaining stock
    // (currentQty + incoming + balancedQty − leadTime×daily) must be ≥
    // reorderPoint. Solving: balancedQty ≥ reorderPoint + leadTime×daily −
    // currentQty − incoming.
    const ltFloor = Math.max(
      0,
      reorderPoint + leadTimeDays * dailyConsumption - currentQty - incoming,
    );

    // Aligned quantity cannot exceed the un-balanced proposed quantity —
    // we only ever trim down, never grow.
    const aligned = Math.min(proposedQty, Math.max(reducedProposed, ltFloor));

    // Final headroom clamp against maxQuantity.
    const headroom = Math.max(0, maxCeiling - currentQty - incoming);
    const balancedQty = Math.max(0, Math.min(aligned, headroom));

    const newCoverage =
      dailyConsumption > 0
        ? (currentQty + incoming + balancedQty) / dailyConsumption
        : Number.POSITIVE_INFINITY;

    return {
      ...input,
      balancedQty,
      coverageDays: newCoverage,
    };
  });
}
