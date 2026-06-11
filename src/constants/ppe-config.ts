// PPE-pipeline parameters. The PpeDeliverySchedule / PpeDelivery tables are
// empty in production, so the cadence engine runs off these defaults rather
// than per-item schedule rows (see spec §3 and findings §B "PPE & TOOL").

import { PPE_TYPE } from './enums';

/** Default replenishment interval in months by PPE type (spec §3.2). */
export const PPE_DEFAULT_INTERVAL_MONTHS: Record<PPE_TYPE, number> = {
  [PPE_TYPE.SHIRT]: 6,
  [PPE_TYPE.PANTS]: 6,
  [PPE_TYPE.SHORT]: 6,
  [PPE_TYPE.SLEEVES]: 6,
  [PPE_TYPE.MASK]: 6,
  [PPE_TYPE.BOOTS]: 12,
  [PPE_TYPE.RAIN_BOOTS]: 24,
  [PPE_TYPE.GLOVES]: 3,
  [PPE_TYPE.OVERALL]: 6,
  [PPE_TYPE.OTHERS]: 3,
};

/** Headcount N per PPE type (spec §3.4). Production-floor PPE = 22,
 *  staff-wide uniform PPE = 27. */
export const PPE_HEADCOUNT: Record<PPE_TYPE, number> = {
  [PPE_TYPE.BOOTS]: 22,
  [PPE_TYPE.RAIN_BOOTS]: 22,
  [PPE_TYPE.GLOVES]: 22,
  [PPE_TYPE.SLEEVES]: 22,
  [PPE_TYPE.MASK]: 22,
  [PPE_TYPE.SHIRT]: 27,
  [PPE_TYPE.PANTS]: 27,
  [PPE_TYPE.SHORT]: 27,
  // Coveralls are production-floor PPE (painters), not staff-wide uniform.
  [PPE_TYPE.OVERALL]: 22,
  [PPE_TYPE.OTHERS]: 27,
};

/** Blend weights for final mc_PPE = predicted × W.predicted + hist × W.hist
 *  (spec §3.7). Predicted is favored because PPE history is lumpy. */
export const PPE_HIST_BLEND_WEIGHTS = { predicted: 0.7, hist: 0.3 } as const;

/** Inflation guard (spec §3.6): when historic consumption blows past
 *  the predicted formula, scale predicted up — but never more than 2×. */
export const PPE_INFLATION_RATIO_TRIGGER = 2;
export const PPE_INFLATION_CAP = 2;

/** Safety stock multipliers in reorder-point math (spec §11). */
export const PPE_SCHEDULED_SAFETY_MULTIPLIER = 0.25;
export const PPE_ON_DEMAND_SAFETY_MULTIPLIER = 0.2;
