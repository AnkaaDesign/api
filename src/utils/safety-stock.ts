// Layered safety-stock calculation. Replaces the flat "(1 + safetyFactor)"
// multiplier used by spec §10 with a context-aware computation:
//
//   Layer 1 — Statistical (≥6 months of monthly history)
//     Industry-standard formula: SS = z × σ_daily × √leadTimeDays
//     where z is the per-ABC service-level (A = 1.96, B = 1.645, C = 1.28).
//     σ_daily is the stddev of monthly consumption normalized to per-day.
//     Items that are genuinely erratic get more safety automatically; items
//     that are stable get less. The ABC class only sets the *target service
//     level*, not the raw safety multiplier.
//
//   Layer 2 — Low-data matrix (3–5 months of history)
//     Falls back to a percentage-of-cycle-stock formula with values BUMPED
//     above the long-term matrix (ABC_XYZ_MATRIX_LOWDATA in inventory-config).
//     Acknowledges that with <6 months we can't trust σ — the bumped values
//     protect against unseen variability until enough data accumulates.
//
//   Layer 3 — Unclassified (<3 months OR no ABC/XYZ)
//     Uses UNCLASSIFIED_LOWDATA factor (0.30). New or very-new items get
//     generous safety until classification can run.
//
// The result is a number of units (not a fraction). Caller adds it to the
// cycle-stock (avgDaily × leadTime × seasonal) to get the reorderPoint.

import { ABC_CATEGORY, XYZ_CATEGORY } from '@/constants/enums';
import {
  ABC_XYZ_MATRIX_LOWDATA,
  AbcXyzKey,
  SafetyTargetCell,
  STATISTICAL_LAYER_MIN_MONTHS,
  UNCLASSIFIED_LOWDATA,
  Z_BY_ABC,
} from '@/constants/inventory-config';
import { applyTrendAdjustment } from './stock-health';

export type SafetyStockLayer =
  | 'STATISTICAL'        // Layer 1 — z × σ × √LT
  | 'LOW_DATA_MATRIX'    // Layer 2 — bumped %-of-cycle
  | 'UNCLASSIFIED';      // Layer 3 — flat 30%

export interface SafetyStockInput {
  monthlyConsumption: number;
  leadTimeDays: number;
  abcCategory: ABC_CATEGORY | null;
  xyzCategory: XYZ_CATEGORY | null;
  /** Trailing monthly history (oldest first). Used for σ in Layer 1 and
   *  data-availability counting for layer selection. */
  monthlyHistory: ReadonlyArray<number>;
  /** Signed percent change of last-3 vs prior-3 months (spec §13.2).
   *  Applied only in Layer 2 (Layer 1 already captures variability via σ). */
  trendPercent?: number;
  /** Months-of-data threshold override (tests, mainly). */
  minMonthsForStatistical?: number;
}

export interface SafetyStockResult {
  /** Safety stock in units (always ≥ 0). Add to cycle stock to get rp. */
  safetyStock: number;
  /** Which layer produced the result — surfaced in UI breakdown. */
  layer: SafetyStockLayer;
  /** Effective safety factor as a fraction of cycle stock — useful for the
   *  UI to display "X% safety" alongside the absolute number. */
  effectiveSafetyFactor: number;
  /** Components used in the calculation, for traceability. */
  components: {
    z?: number;
    dailyStddev?: number;
    sigmaMonthly?: number;
    safetyFactor?: number;
    monthsAvailable: number;
  };
}

/** Standard deviation (population, divide by N) of a numeric series. */
function stddev(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const variance = xs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / xs.length;
  return Math.sqrt(variance);
}

export function calculateSafetyStock(input: SafetyStockInput): SafetyStockResult {
  const avgDaily = input.monthlyConsumption / 30;
  const cycleStock = avgDaily * input.leadTimeDays;
  const monthsAvailable = input.monthlyHistory.filter(v => v > 0).length;
  const minMonths = input.minMonthsForStatistical ?? STATISTICAL_LAYER_MIN_MONTHS;

  // Layer 1 — statistical (z × σ × √LT)
  if (monthsAvailable >= minMonths && input.abcCategory !== null) {
    const z = Z_BY_ABC[input.abcCategory] ?? Z_BY_ABC.DEFAULT;
    const sigmaMonthly = stddev(input.monthlyHistory);
    const dailyStddev = sigmaMonthly / 30;
    const ss = z * dailyStddev * Math.sqrt(input.leadTimeDays);
    return {
      safetyStock: Math.max(0, ss),
      layer: 'STATISTICAL',
      effectiveSafetyFactor: cycleStock > 0 ? ss / cycleStock : 0,
      components: { z, dailyStddev, sigmaMonthly, monthsAvailable },
    };
  }

  // Layer 2 — low-data matrix (3–5 months)
  if (monthsAvailable >= 3 && input.abcCategory && input.xyzCategory) {
    const key = `${input.abcCategory}${input.xyzCategory}` as AbcXyzKey;
    const cell: SafetyTargetCell =
      ABC_XYZ_MATRIX_LOWDATA[key] ?? UNCLASSIFIED_LOWDATA;
    const adjustedSF = applyTrendAdjustment(cell.safetyFactor, input.trendPercent ?? 0);
    const ss = cycleStock * adjustedSF;
    return {
      safetyStock: Math.max(0, ss),
      layer: 'LOW_DATA_MATRIX',
      effectiveSafetyFactor: adjustedSF,
      components: { safetyFactor: adjustedSF, monthsAvailable },
    };
  }

  // Layer 3 — unclassified / very-new items
  const ss = cycleStock * UNCLASSIFIED_LOWDATA.safetyFactor;
  return {
    safetyStock: Math.max(0, ss),
    layer: 'UNCLASSIFIED',
    effectiveSafetyFactor: UNCLASSIFIED_LOWDATA.safetyFactor,
    components: { safetyFactor: UNCLASSIFIED_LOWDATA.safetyFactor, monthsAvailable },
  };
}
