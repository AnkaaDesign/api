// PPE pipeline (spec §3, §11). Uses default replenishment intervals because
// the PpeDeliverySchedule + PpeDelivery tables are empty in production.

import { PPE_DELIVERY_MODE, PPE_TYPE } from '@/constants/enums';
import {
  PPE_DEFAULT_INTERVAL_MONTHS,
  PPE_HEADCOUNT,
  PPE_HIST_BLEND_WEIGHTS,
  PPE_INFLATION_CAP,
  PPE_INFLATION_RATIO_TRIGGER,
  PPE_ON_DEMAND_SAFETY_MULTIPLIER,
  PPE_SCHEDULED_SAFETY_MULTIPLIER,
} from '@/constants/ppe-config';

export interface PpeItemLike {
  ppeType: PPE_TYPE | null;
  ppeStandardQuantity: number | null; // default 1
  ppeDeliveryMode: PPE_DELIVERY_MODE | null;
  ppeSize?: string | null;
}

export interface PpeMonthlyConsumptionInput {
  item: PpeItemLike;
  /** Distribution count of users wearing the item's ppeSize (numerator);
   *  zero if the item is multi-size — w_size collapses to 1 then. */
  matchingSizeUserCount?: number;
  /** Total users having a PpeSize record for this ppeType. Denominator for
   *  w_size — zero falls back to 1. */
  totalSizedUserCount?: number;
  /** Sum of PPE_DELIVERY + PRODUCTION_USAGE OUTBOUND quantities in the trailing
   *  12 months (spec §3.5). */
  histTrailing12mo?: number;
}

export interface PpeMonthlyConsumptionResult {
  monthlyConsumption: number;
  predicted: number;
  histAvg: number;
}

/** mc_PPE = 0.7 × predicted + 0.3 × hist_avg (spec §3.7), with inflation
 *  guard when historic blows past prediction (spec §3.6). */
export function predictPpeMonthlyConsumption(
  input: PpeMonthlyConsumptionInput,
): PpeMonthlyConsumptionResult {
  const { item } = input;
  if (!item.ppeType) {
    return { monthlyConsumption: 0, predicted: 0, histAvg: 0 };
  }

  const N = PPE_HEADCOUNT[item.ppeType];
  const s = item.ppeStandardQuantity ?? 1;
  const I_m = PPE_DEFAULT_INTERVAL_MONTHS[item.ppeType];
  const wSize =
    item.ppeSize && input.totalSizedUserCount && input.totalSizedUserCount > 0
      ? (input.matchingSizeUserCount ?? 0) / input.totalSizedUserCount
      : 1;

  let predicted = (N * s * wSize) / I_m;
  const histAvg = (input.histTrailing12mo ?? 0) / 12;

  if (predicted > 0 && histAvg > PPE_INFLATION_RATIO_TRIGGER * predicted) {
    predicted = predicted * Math.min(PPE_INFLATION_CAP, histAvg / predicted);
  }

  const mc =
    PPE_HIST_BLEND_WEIGHTS.predicted * predicted + PPE_HIST_BLEND_WEIGHTS.hist * histAvg;
  return { monthlyConsumption: round2(mc), predicted, histAvg };
}

export interface PpeReorderPointInput {
  item: PpeItemLike;
  monthlyConsumption: number;
  leadTimeDays: number;
  matchingSizeUserCount?: number;
  totalSizedUserCount?: number;
}

/** PPE reorder-point by delivery mode (spec §11). */
export function calculatePpeReorderPoint(input: PpeReorderPointInput): number {
  const { item, monthlyConsumption, leadTimeDays } = input;
  if (!item.ppeType) return 0;
  const mode = item.ppeDeliveryMode ?? PPE_DELIVERY_MODE.SCHEDULED;
  const N = PPE_HEADCOUNT[item.ppeType];
  const s = item.ppeStandardQuantity ?? 1;
  const wSize =
    item.ppeSize && input.totalSizedUserCount && input.totalSizedUserCount > 0
      ? (input.matchingSizeUserCount ?? 0) / input.totalSizedUserCount
      : 1;
  const LT_m = leadTimeDays / 30;

  const scheduledRp = Math.ceil(
    monthlyConsumption * LT_m + Math.max(1, N * s * wSize * PPE_SCHEDULED_SAFETY_MULTIPLIER),
  );
  const onDemandRp = Math.ceil(Math.max(N * s * PPE_ON_DEMAND_SAFETY_MULTIPLIER, monthlyConsumption * LT_m));

  switch (mode) {
    case PPE_DELIVERY_MODE.SCHEDULED:
      return scheduledRp;
    case PPE_DELIVERY_MODE.ON_DEMAND:
      return onDemandRp;
    case PPE_DELIVERY_MODE.BOTH:
      return Math.max(scheduledRp, onDemandRp);
    default:
      return scheduledRp;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
