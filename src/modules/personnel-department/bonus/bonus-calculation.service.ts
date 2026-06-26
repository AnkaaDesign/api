// bonus-calculation.service.ts
//
// SINGLE SOURCE OF TRUTH for the salary-based bonus calculation.
//
// Algorithm (must match bonus-simulator.html exactly):
//   x(s)     = (ln(s) − ln(sMin)) / (ln(sMax) − ln(sMin))
//   S(v)     = 1 / (1 + exp(−k·(v − x₀)))
//   ratio(s) = piso + (1 − piso) · (S(x) − S(0)) / (S(1) − S(0))
//   anchor   = polyBase(B1, pscale, ceil) · 1.05
//   poly(B1) = 3.31·B1⁵ − 61.07·B1⁴ + 364.82·B1³ − 719.54·B1² + 465.16·B1 − 3.24
//   polyBase = poly(min(max(0, B1), ceil)) · pscale
//   bonus    = anchor · ratio · (1 + adjustment) · perfMult
//
// This service is intentionally pure: no DB access, no I/O. Salary range and
// salary value are passed in by the orchestration layer. This guarantees:
//   • Deterministic, trivially-testable
//   • Identical results in API, web simulator, and mobile simulator
//     (the latter two call this service through POST /bonus/simulate)
//   • Reproducibility — every saved bonus snapshots the params used.

import { Injectable, Logger } from '@nestjs/common';
import { roundCurrency } from '../../../utils/currency-precision.util';

// ============================================================
// Version & default parameters
// ============================================================

/**
 * Bumped whenever the formula or default parameters change.
 * Stored on each saved Bonus row so historical bonuses remain
 * reproducible even if the formula evolves.
 */
export const BONUS_CALCULATION_VERSION = 'v2-logistic-2026-04';

/**
 * Default parameters — match bonus-simulator.html page 1 defaults.
 */
export const DEFAULT_BONUS_CONFIG = {
  /** Logistic slope. */
  k: 3.5,
  /** Logistic center (0 = lowest salary, 1 = highest). */
  x0: 0.26,
  /** Floor: minimum bonus ratio (fraction of anchor) at the lowest salary. */
  piso: 0.075,
  /** Ceiling height: scale factor on the polynomial (legacy = 0.40). */
  pscale: 0.4,
  /** Ceiling position: B1 value beyond which the curve flattens. */
  ceil: 6,
  /** Global adjustment as a fraction (0 = no change, 0.05 = +5%). */
  adjustment: 0,
} as const;

/**
 * Performance level multipliers — matches HTML simulator and legacy.
 */
export const PERFORMANCE_MULTIPLIERS: Readonly<Record<number, number>> = Object.freeze({
  1: 1.0,
  2: 2.0,
  3: 3.0,
  4: 3.5,
  5: 4.0,
});

/**
 * Polynomial coefficient for the legacy anchor markup (Senior IV +5%).
 * Kept as a named constant so its origin is clear.
 */
const ANCHOR_MARKUP = 1.05;

// ============================================================
// Types
// ============================================================

export interface BonusConfig {
  k: number;
  x0: number;
  piso: number;
  pscale: number;
  ceil: number;
  adjustment: number;
}

export interface SalaryRange {
  min: number;
  max: number;
}

export interface BonusCalculationInput {
  /** Monthly salary of the user (positive number). */
  salary: number;
  /** Performance level 1–5; values outside range produce 0 bonus. */
  performanceLevel: number;
  /**
   * B1 — period weighted average tasks per eligible user.
   * Negative or NaN coerces to 0; values above `config.ceil` are clamped.
   */
  averageTasksPerUser: number;
  /** Min and max salary across all eligible positions (fixed pool, not period-dependent). */
  salaryRange: SalaryRange;
  /** Optional overrides (used by simulator). Falls back to DEFAULT_BONUS_CONFIG. */
  config?: Partial<BonusConfig>;
}

export interface BonusCalculationBreakdown {
  /** Final bonus in BRL (rounded to 2 decimals). */
  bonus: number;
  /** Base bonus before performance multiplier (rounded). */
  baseBonus: number;
  /** Anchor value (polyBase · 1.05) before ratio is applied. */
  anchor: number;
  /** Bonus ratio in [piso, 1] applied to anchor. */
  ratio: number;
  /** Logistic-normalized salary position in [0, 1]. */
  x: number;
  /** S(0), S(1) — useful for charting / debugging. */
  S0: number;
  S1: number;
  /** Performance multiplier used (e.g., 1.0, 2.0, 3.0, 3.5, 4.0). */
  performanceMultiplier: number;
  /** The clamped B1 actually fed into the polynomial (after min/max). */
  clampedB1: number;
  /** Effective config (defaults merged with overrides). */
  config: BonusConfig;
}

// ============================================================
// Pure helpers (mirror bonus-simulator.html exactly)
// ============================================================

function poly(b1: number): number {
  return (
    3.31 * Math.pow(b1, 5) -
    61.07 * Math.pow(b1, 4) +
    364.82 * Math.pow(b1, 3) -
    719.54 * Math.pow(b1, 2) +
    465.16 * b1 -
    3.24
  );
}

function polyBase(b1: number, pscale: number, ceil: number): number {
  const clamped = Math.min(Math.max(0, b1), ceil);
  return poly(clamped) * pscale;
}

function logistic(v: number, k: number, x0: number): number {
  return 1 / (1 + Math.exp(-k * (v - x0)));
}

function resolveConfig(overrides?: Partial<BonusConfig>): BonusConfig {
  return {
    k: overrides?.k ?? DEFAULT_BONUS_CONFIG.k,
    x0: overrides?.x0 ?? DEFAULT_BONUS_CONFIG.x0,
    piso: overrides?.piso ?? DEFAULT_BONUS_CONFIG.piso,
    pscale: overrides?.pscale ?? DEFAULT_BONUS_CONFIG.pscale,
    ceil: overrides?.ceil ?? DEFAULT_BONUS_CONFIG.ceil,
    adjustment: overrides?.adjustment ?? DEFAULT_BONUS_CONFIG.adjustment,
  };
}

// ============================================================
// Service
// ============================================================

@Injectable()
export class BonusCalculationService {
  private readonly logger = new Logger(BonusCalculationService.name);

  /**
   * Calculate bonus for a single salary. Pure, deterministic.
   */
  calculate(input: BonusCalculationInput): BonusCalculationBreakdown {
    const config = resolveConfig(input.config);
    const { salary, performanceLevel, averageTasksPerUser, salaryRange } = input;

    const clampedB1 = Math.min(Math.max(0, averageTasksPerUser || 0), config.ceil);
    const anchor = polyBase(clampedB1, config.pscale, config.ceil) * ANCHOR_MARKUP;

    const performanceMultiplier =
      PERFORMANCE_MULTIPLIERS[performanceLevel as keyof typeof PERFORMANCE_MULTIPLIERS] ?? 0;

    // Degenerate cases — match HTML behavior to the cent.
    if (anchor <= 0 || performanceMultiplier <= 0 || !Number.isFinite(salary) || salary <= 0) {
      return {
        bonus: 0,
        baseBonus: 0,
        anchor: roundCurrency(Math.max(0, anchor)),
        ratio: 0,
        x: 0,
        S0: 0,
        S1: 0,
        performanceMultiplier,
        clampedB1,
        config,
      };
    }

    const { min: sMin, max: sMax } = salaryRange;

    // Single-position degeneracy — bonus equals anchor · floor.
    if (!(sMax > sMin)) {
      const baseBonus = anchor * config.piso * (1 + config.adjustment);
      const finalBonus = baseBonus * performanceMultiplier;
      return {
        bonus: roundCurrency(finalBonus),
        baseBonus: roundCurrency(baseBonus),
        anchor: roundCurrency(anchor),
        ratio: config.piso,
        x: 0,
        S0: 0,
        S1: 0,
        performanceMultiplier,
        clampedB1,
        config,
      };
    }

    const x = (Math.log(salary) - Math.log(sMin)) / (Math.log(sMax) - Math.log(sMin));
    const S0 = logistic(0, config.k, config.x0);
    const S1 = logistic(1, config.k, config.x0);

    // Degenerate logistic (extreme k or x0) — fall back to floor.
    if (Math.abs(S1 - S0) < 1e-9) {
      const baseBonus = anchor * config.piso * (1 + config.adjustment);
      const finalBonus = baseBonus * performanceMultiplier;
      return {
        bonus: roundCurrency(finalBonus),
        baseBonus: roundCurrency(baseBonus),
        anchor: roundCurrency(anchor),
        ratio: config.piso,
        x,
        S0,
        S1,
        performanceMultiplier,
        clampedB1,
        config,
      };
    }

    const Sx = logistic(x, config.k, config.x0);
    const ratio = config.piso + (1 - config.piso) * ((Sx - S0) / (S1 - S0));

    const baseBonus = anchor * ratio * (1 + config.adjustment);
    const finalBonus = baseBonus * performanceMultiplier;

    return {
      bonus: roundCurrency(Math.max(0, finalBonus)),
      baseBonus: roundCurrency(Math.max(0, baseBonus)),
      anchor: roundCurrency(anchor),
      ratio,
      x,
      S0,
      S1,
      performanceMultiplier,
      clampedB1,
      config,
    };
  }

  /**
   * Convenience for orchestration layers that only need the final bonus value.
   */
  calculateBonus(input: BonusCalculationInput): number {
    return this.calculate(input).bonus;
  }

  /**
   * Calculate for many users in one pass — used by the /bonus/simulate
   * endpoint and by BonusService when computing a full period.
   */
  calculateMany<T extends { salary: number; performanceLevel: number }>(
    users: ReadonlyArray<T>,
    averageTasksPerUser: number,
    salaryRange: SalaryRange,
    config?: Partial<BonusConfig>,
  ): Array<T & { calculation: BonusCalculationBreakdown }> {
    return users.map(user => ({
      ...user,
      calculation: this.calculate({
        salary: user.salary,
        performanceLevel: user.performanceLevel,
        averageTasksPerUser,
        salaryRange,
        config,
      }),
    }));
  }

  /**
   * Snapshot of the parameters used for a calculation — stored on the
   * Bonus row's `calculationParams` JSON column for audit / reproducibility.
   */
  buildParamsSnapshot(args: {
    salary: number;
    salaryRange: SalaryRange;
    averageTasksPerUser: number;
    config?: Partial<BonusConfig>;
  }): {
    version: string;
    salary: number;
    salaryRange: SalaryRange;
    averageTasksPerUser: number;
    config: BonusConfig;
  } {
    return {
      version: BONUS_CALCULATION_VERSION,
      salary: args.salary,
      salaryRange: { min: args.salaryRange.min, max: args.salaryRange.max },
      averageTasksPerUser: args.averageTasksPerUser,
      config: resolveConfig(args.config),
    };
  }
}
