// Seasonal factor pipeline (spec §6). Per-item curve when eligible, with
// shrinkage toward category mean; otherwise fall back to category → corpus → 1.0.

import {
  CONSUMPTION_DECAY_HALF_LIFE_MONTHS,
  CORPUS_MONTHLY_INDEX,
  SEASONALITY_MIN_MONTHS_FOR_ITEM_CURVE,
  SEASONALITY_MIN_TRAILING_NONZERO,
  SEASONALITY_SHRINKAGE_TARGET_MONTHS,
  SEASONALITY_SMOOTHING_WINDOW,
} from '@/constants/seasonality-config';

export { CONSUMPTION_DECAY_HALF_LIFE_MONTHS, CORPUS_MONTHLY_INDEX };

export type SeasonalCurve = readonly number[]; // length 12, index 0 = January

/** Computes the median of a sequence (ignoring zero entries). Returns 0 when
 *  the sequence is empty after filtering. */
function median(values: number[]): number {
  const nonzero = values.filter(v => v > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) return 0;
  const mid = Math.floor(nonzero.length / 2);
  return nonzero.length % 2 === 0
    ? (nonzero[mid - 1] + nonzero[mid]) / 2
    : nonzero[mid];
}

/** Applies a centered moving-average smoother of width SEASONALITY_SMOOTHING_WINDOW
 *  with circular Dec↔Jan wrap (spec §6.3). */
export function applySmoothing(curve: SeasonalCurve): number[] {
  const n = curve.length;
  const half = Math.floor(SEASONALITY_SMOOTHING_WINDOW / 2);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -half; k <= half; k++) {
      const idx = (i + k + n) % n;
      sum += curve[idx];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/** Blends a raw per-item curve toward the category prior with weight
 *  w = min(1, monthsAvailable / SEASONALITY_SHRINKAGE_TARGET_MONTHS) (spec §6.3). */
export function shrinkToCategoryMean(
  rawCurve: SeasonalCurve,
  monthsAvailable: number,
  categoryCurve: SeasonalCurve,
): number[] {
  const w = Math.min(1, monthsAvailable / SEASONALITY_SHRINKAGE_TARGET_MONTHS);
  return rawCurve.map((v, i) => w * v + (1 - w) * (categoryCurve[i] ?? 1));
}

/** Builds a per-item seasonal curve from a monthly-consumption history.
 *  `monthlyHistory[i]` is the consumption in month `i` of the lifetime window
 *  (chronological). Returns the smoothed, shrunk 12-element curve OR null if
 *  the eligibility gate (spec §6.2) fails. */
export function computeSeasonalProfile(
  monthlyHistory: ReadonlyArray<{ year: number; month: number; consumption: number }>,
  categoryCurve: SeasonalCurve,
): SeasonalCurve | null {
  const nonZeroMonths = monthlyHistory.filter(m => m.consumption > 0).length;
  if (nonZeroMonths < SEASONALITY_MIN_MONTHS_FOR_ITEM_CURVE) return null;

  const trailing = monthlyHistory.slice(-12);
  const trailingNonZero = trailing.filter(m => m.consumption > 0).length;
  if (trailingNonZero < SEASONALITY_MIN_TRAILING_NONZERO) return null;

  // Aggregate consumption by calendar month
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const row of monthlyHistory) {
    byMonth[row.month].push(row.consumption);
  }

  const monthMedians = byMonth.map(arr => median(arr));
  const overallMedian = median(monthMedians.filter(v => v > 0));
  if (overallMedian === 0) return null;

  const rawCurve = monthMedians.map(m => (m > 0 ? m / overallMedian : 1));
  const shrunk = shrinkToCategoryMean(rawCurve, nonZeroMonths, categoryCurve);
  return applySmoothing(shrunk);
}

interface SeasonalContext {
  /** Per-item curve, when eligible (spec §6.4 tier 1). */
  itemCurve?: SeasonalCurve | null;
  /** Per-category curve (spec §6.4 tier 2 — REGULAR only). */
  categoryCurve?: SeasonalCurve | null;
  /** Per-corpus fallback curve (spec §6.4 tier 3); defaults to CORPUS_MONTHLY_INDEX. */
  corpusCurve?: SeasonalCurve;
}

/** Resolves the seasonal factor for a calendar month using the fallback chain
 *  per-item → category → corpus → 1.0 (spec §6.4). */
export function resolveSeasonalFactor(date: Date, ctx: SeasonalContext = {}): number {
  const month = date.getMonth();
  if (ctx.itemCurve && ctx.itemCurve.length === 12) return ctx.itemCurve[month] ?? 1;
  if (ctx.categoryCurve && ctx.categoryCurve.length === 12) return ctx.categoryCurve[month] ?? 1;
  const corpus = ctx.corpusCurve ?? CORPUS_MONTHLY_INDEX;
  return corpus[month] ?? 1;
}

/** Blended factor over the months touched by a (now → now + days) window.
 *  Used by reorder-point and max-quantity projection (spec §10.2 + §13.1). */
export function blendedFactorAcrossDays(
  from: Date,
  days: number,
  ctx: SeasonalContext = {},
): number {
  if (days <= 0) return resolveSeasonalFactor(from, ctx);
  const samples: number[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(from);
    date.setDate(date.getDate() + d);
    samples.push(resolveSeasonalFactor(date, ctx));
  }
  return samples.reduce((sum, v) => sum + v, 0) / samples.length;
}

/** Exponential-decay weight for a month `monthsAgo` calendar months in the
 *  past, with the configured half-life (spec §2.5). */
export function decayWeight(monthsAgo: number): number {
  return Math.pow(0.5, monthsAgo / CONSUMPTION_DECAY_HALF_LIFE_MONTHS);
}
