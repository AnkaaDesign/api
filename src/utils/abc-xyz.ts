// ABC + XYZ classification (spec §7, §8). Run nightly across all REGULAR/PPE
// items with monthlyConsumption > 0; TOOL items always classify as null.

import { ABC_CATEGORY, XYZ_CATEGORY } from '@/constants/enums';

export interface AbcInput {
  itemId: string;
  monthlyConsumption: number;
  unitPrice: number;
  eligible: boolean; // false for TOOL, low-data, etc.
}

export interface AbcAssignment {
  itemId: string;
  category: ABC_CATEGORY | null;
  order: number | null; // rank within class (1 = highest-value)
}

/** Pareto 70/20/10 on monthlyConsumption × unitPrice (spec §7.1).
 *  Items with `eligible=false` or zero value classify as null. */
export function classifyAbc(items: ReadonlyArray<AbcInput>): AbcAssignment[] {
  const ranked = items
    .map(i => ({
      itemId: i.itemId,
      value: i.eligible && i.monthlyConsumption > 0 ? i.monthlyConsumption * i.unitPrice : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const totalValue = ranked.reduce((sum, r) => sum + r.value, 0);
  const result: AbcAssignment[] = [];

  if (totalValue === 0) {
    for (const r of ranked) {
      result.push({ itemId: r.itemId, category: null, order: null });
    }
    return result;
  }

  let cumulative = 0;
  let counters = { A: 0, B: 0, C: 0 };
  for (const r of ranked) {
    if (r.value === 0) {
      result.push({ itemId: r.itemId, category: null, order: null });
      continue;
    }
    cumulative += r.value;
    const cumFrac = cumulative / totalValue;
    let category: ABC_CATEGORY;
    if (cumFrac <= 0.7) category = ABC_CATEGORY.A;
    else if (cumFrac <= 0.9) category = ABC_CATEGORY.B;
    else category = ABC_CATEGORY.C;
    counters[category]++;
    result.push({ itemId: r.itemId, category, order: counters[category] });
  }
  return result;
}

export interface XyzInput {
  itemId: string;
  /** Trailing 12 working-day-normalized monthly consumption values, oldest
   *  first. Months with zero consumption may be omitted but the array length
   *  should reflect the non-zero count. */
  trailingMonthlyConsumption: number[];
  eligible: boolean;
}

export interface XyzAssignment {
  itemId: string;
  category: XYZ_CATEGORY | null;
  order: number | null; // rank within class (1 = lowest CV / most predictable)
  coefficientOfVariation: number | null;
}

/** Workshop-tuned thresholds X < 1.0 / Y 1.0–1.7 / Z > 1.7 (spec §8.2).
 *  Items with fewer than 6 non-zero monthly observations classify as null. */
export function classifyXyz(items: ReadonlyArray<XyzInput>): XyzAssignment[] {
  const enriched = items.map(i => {
    if (!i.eligible || i.trailingMonthlyConsumption.length < 6) {
      return { itemId: i.itemId, cv: null as number | null };
    }
    const xs = i.trailingMonthlyConsumption;
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    if (mean === 0) return { itemId: i.itemId, cv: null };
    const variance = xs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / xs.length;
    const cv = Math.sqrt(variance) / mean;
    return { itemId: i.itemId, cv };
  });

  const byClass = new Map<XYZ_CATEGORY, Array<{ itemId: string; cv: number }>>([
    [XYZ_CATEGORY.X, []],
    [XYZ_CATEGORY.Y, []],
    [XYZ_CATEGORY.Z, []],
  ]);
  const nullItems: string[] = [];

  for (const r of enriched) {
    if (r.cv === null) {
      nullItems.push(r.itemId);
      continue;
    }
    let cat: XYZ_CATEGORY;
    if (r.cv < 1.0) cat = XYZ_CATEGORY.X;
    else if (r.cv <= 1.7) cat = XYZ_CATEGORY.Y;
    else cat = XYZ_CATEGORY.Z;
    byClass.get(cat)!.push({ itemId: r.itemId, cv: r.cv });
  }

  // Rank within class ascending by CV (lower CV = more predictable = lower order)
  const out: XyzAssignment[] = [];
  for (const [category, members] of byClass) {
    members.sort((a, b) => a.cv - b.cv);
    members.forEach((m, idx) => {
      out.push({ itemId: m.itemId, category, order: idx + 1, coefficientOfVariation: m.cv });
    });
  }
  for (const itemId of nullItems) {
    out.push({ itemId, category: null, order: null, coefficientOfVariation: null });
  }
  return out;
}
