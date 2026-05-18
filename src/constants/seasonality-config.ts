// Seasonality parameters for monthlyConsumption / reorderPoint projection.
// Algorithm lives in src/utils/seasonality.ts (Phase 3 deliverable); this file
// owns only the calibrated constants and the corpus fallback curve.

/** Exponential-decay half-life applied to per-month consumption weights
 *  during mc aggregation (spec §2.5). */
export const CONSUMPTION_DECAY_HALF_LIFE_MONTHS = 2;

/** Shrinkage target: per-item seasonal factor is blended with the category
 *  prior with weight `w = min(1, monthsWithData / 24)` (spec §6.3). */
export const SEASONALITY_SHRINKAGE_TARGET_MONTHS = 24;

/** Minimum lifetime non-zero months required to compute a per-item curve
 *  (spec §6.2). Below this we fall back to the category / corpus prior. */
export const SEASONALITY_MIN_MONTHS_FOR_ITEM_CURVE = 18;

/** Companion gate: minimum non-zero months in trailing 12 (spec §6.2). */
export const SEASONALITY_MIN_TRAILING_NONZERO = 6;

/** Width of the centered moving-average smoother applied to the raw factor
 *  curve (spec §6.3). Circular over Dec↔Jan. */
export const SEASONALITY_SMOOTHING_WINDOW = 3;

/** Corpus-mean fallback curve, index 0 = January, 11 = December.
 *  Used when neither per-item nor category prior is available
 *  (spec §6.4, fallback tier 3). Calibrated from workshop history. */
export const CORPUS_MONTHLY_INDEX: readonly number[] = [
  0.7,  // January   — vacation recovery
  0.85, // February  — Carnival ramp
  0.95, // March
  1.0,  // April
  1.0,  // May
  1.0,  // June
  1.0,  // July
  1.05, // August
  1.1,  // September
  1.15, // October
  1.15, // November  — pre-holiday push
  0.75, // December  — collective vacation
];

/** Resolves the seasonal factor for a calendar month. If `customFactors` is
 *  a full 12-element curve (per-item or per-category), it wins; otherwise we
 *  fall back to the corpus curve, finally 1.0 if neither shape matches. */
export function getSeasonalFactor(month: number, customFactors?: number[] | null): number {
  const curve =
    customFactors && customFactors.length === 12 ? customFactors : CORPUS_MONTHLY_INDEX;
  return curve[month] ?? 1.0;
}
