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
 *
 * v3-proportional-2026-08: a fórmula em si não mudou — mudou o que alimenta
 * `averageTasksPerUser` (B1). O divisor deixou de ser a contagem inteira de
 * elegíveis no instante da consulta e passou a ser o headcount médio do
 * período (Σ dias_úteis_elegíveis / dias_úteis_do_período), e o mesmo peso
 * prorrateia o valor individual. Linhas gravadas antes desta versão têm
 * `eligibilityWeight = 1` por default e um divisor inteiro.
 *
 * v5-window-monotonic-2026-08: duas mudanças.
 *
 * 1. B1 passa a ser o AGREGADO DA JANELA de cada pessoa — `tarefas ponderadas
 *    concluídas enquanto ela esteve ÷ colaboradores ativos naquela janela` —
 *    tomado CRU, sem normalizar para um mês cheio. Por consequência o
 *    prorrateio temporal sai do valor: o tempo já está dentro do numerador
 *    (uma janela curta viu menos tarefas), e multiplicar de novo pelos dias o
 *    aplicaria duas vezes. `absenceFactor` continua multiplicando — é outro
 *    eixo (afastamento médico) e não pode sumir junto. Ver `BonusWindowStatsService`.
 *
 * 2. A quíntica ganhou ENVELOPE MONOTÔNICO — ela virava para baixo em dois
 *    trechos de [0, 6] e ali produzir mais pagava menos. Ver `polyMonotone`.
 */
export const BONUS_CALCULATION_VERSION = 'v5-window-monotonic-2026-08';

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

/**
 * Prefixo de máximos da quíntica sobre [0, ceil], em passo fino.
 *
 * Construído uma vez no carregamento a partir dos PRÓPRIOS coeficientes — não é
 * uma constante mágica. Se o polinômio for reajustado um dia, o envelope
 * acompanha sozinho.
 */
const MONOTONE_STEP = 0.001;
const MONOTONE_MAX_B1 = 6; // = DEFAULT_BONUS_CONFIG.ceil; B1 é clampado antes
const MONOTONE_PREFIX: number[] = (() => {
  const n = Math.round(MONOTONE_MAX_B1 / MONOTONE_STEP) + 1;
  const prefix = new Array<number>(n);
  let running = -Infinity;
  for (let i = 0; i < n; i++) {
    running = Math.max(running, poly(i * MONOTONE_STEP));
    prefix[i] = running;
  }
  return prefix;
})();

/**
 * A quíntica com ENVELOPE MONOTÔNICO: nunca desce.
 *
 * POR QUE EXISTE
 * --------------
 * O polinômio ajustado vira para baixo em DOIS trechos de [0, 6], e nos dois
 * PRODUZIR MAIS PAGA MENOS:
 *
 *   • vale profundo entre B1 ≈ 0,48 e ≈ 1,96 — `poly(0,48) = 91,4` contra
 *     `poly(1,43) = 21,8`, uma queda de 76%;
 *   • ombro raso a partir de B1 ≈ 5,81 até o teto 6,0.
 *
 * Isso ficou inofensivo enquanto B1 era um número único do período (2,1 a 3,9,
 * sempre no ramo crescente). Com o B1 da v5 medido na JANELA de cada pessoa,
 * quem trabalhou parte do mês cai dentro do vale, e o resultado era visível e
 * indefensável: alguém com 13 dias e 23,5 tarefas ponderadas na janela recebia
 * R$ 0,87 a MAIS que alguém com 3 dias e 1,0 ponderada.
 *
 * O envelope é o máximo corrente da própria curva: onde ela desceria, o valor
 * fica travado no último pico até ela voltar a subir acima dele. Efeito
 * colateral aceito: platôs nos dois trechos — abaixo de um certo patamar o
 * bônus deixa de diferenciar, o que é muito melhor que diferenciar ao
 * contrário.
 *
 * NÃO TOCA NENHUM PERÍODO JÁ PAGO: 06/2026 fechou com B1 2,25 e 07/2026 com
 * 2,69, os dois no ramo crescente, onde envelope e curva original coincidem.
 */
function polyMonotone(b1: number): number {
  const clamped = Math.min(Math.max(0, b1), MONOTONE_MAX_B1);
  const i = Math.floor(clamped / MONOTONE_STEP);
  // `poly(clamped)` entra no máximo para que o valor EXATO no ponto pedido
  // nunca fique abaixo do que a curva original entrega ali.
  return Math.max(poly(clamped), MONOTONE_PREFIX[Math.min(i, MONOTONE_PREFIX.length - 1)]);
}

function polyBase(b1: number, pscale: number, ceil: number): number {
  const clamped = Math.min(Math.max(0, b1), ceil);
  return polyMonotone(clamped) * pscale;
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
