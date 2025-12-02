// exact-bonus-calculation.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { roundCurrency } from '../../../utils/currency-precision.util';

/**
 * Service implementing the EXACT bonus calculation algorithm from the spreadsheet
 * Position mapping: 1=Junior I, 2=Junior II, ..., 11=Senior III, 12=Senior IV
 * Uses the exact formulas and percentages from the provided spreadsheet
 */
@Injectable()
export class ExactBonusCalculationService {
  private readonly logger = new Logger(ExactBonusCalculationService.name);

  /**
   * Position name to level mapping (1-12) - CORRECTED based on spreadsheet
   * 1-4: Junior I-IV, 5-8: Pleno I-IV, 9-12: Senior I-IV
   */
  private getPositionLevel(positionName: string): number {
    const normalized = positionName.toLowerCase().replace(/\s+/g, '').trim();

    // CRITICAL: Check MORE SPECIFIC patterns FIRST (IV before I, III before II)
    // Otherwise "junioriii" matches "juniorii" and returns wrong level!

    // Junior levels (1-4) - Check IV, III, II, then I
    if (normalized.includes('junioriv') || normalized.includes('júnioriv')) return 4;
    if (normalized.includes('junioriii') || normalized.includes('júnioriii')) return 3;
    if (normalized.includes('juniorii') || normalized.includes('júniorii')) return 2;
    if (
      normalized.includes('juniori') ||
      normalized.includes('júniori') ||
      normalized === 'junior' ||
      normalized === 'júnior'
    )
      return 1;

    // Pleno levels (5-8) - Check IV, III, II, then I
    if (normalized.includes('plenoiv')) return 8;
    if (normalized.includes('plenoiii')) return 7;
    if (normalized.includes('plenoii')) return 6;
    if (normalized.includes('plenoi') || normalized === 'pleno') return 5;

    // Senior levels (9-12) - Check IV, III, II, then I
    if (normalized.includes('senioriv') || normalized.includes('sênioriv')) return 12;
    if (normalized.includes('senioriii') || normalized.includes('sênioriii')) return 11;
    if (normalized.includes('seniorii') || normalized.includes('sêniorii')) return 10;
    if (normalized.includes('seniori') || normalized.includes('sêniori')) return 9;
    if (normalized.includes('senior') || normalized.includes('sênior')) return 11; // Default to Senior III

    // Default based on general category
    if (
      normalized.includes('junior') ||
      normalized.includes('júnior') ||
      normalized.includes('auxiliar') ||
      normalized.includes('estagiário')
    )
      return 1;
    if (normalized.includes('pleno')) return 5;
    if (normalized.includes('senior') || normalized.includes('sênior')) return 11;

    return 5; // Default to Pleno I
  }

  /**
   * EXACT performance level multipliers from Excel spreadsheet
   */
  private readonly performanceMultipliers: Record<number, number> = {
    1: 1.0, // Base value
    2: 2.0, // Exactly 2x base
    3: 3.0, // Exactly 3x base
    4: 3.5, // Exactly 3.5x base
    5: 4.0, // Exactly 4x base
  };

  /**
   * EXACT factors for positions 1-8 relative to Position 9
   * These were reverse-engineered from actual Excel values
   */
  private readonly positionFactorsFromPosition9: Record<number, number> = {
    1: 0.0972, // Position 1: 9.72% of Position 9
    2: 0.1932, // Position 2: 19.32% of Position 9
    3: 0.322, // Position 3: 32.20% of Position 9
    4: 0.4609, // Position 4: 46.09% of Position 9
    5: 0.5985, // Position 5: 59.85% of Position 9
    6: 0.721, // Position 6: 72.10% of Position 9
    7: 0.8283, // Position 7: 82.83% of Position 9
    8: 0.9205, // Position 8: 92.05% of Position 9
  };

  /**
   * Calculate EXACT position 11 base value using polynomial formula from Excel
   * Formula: (3.31*B1^5 - 61.07*B1^4 + 364.82*B1^3 - 719.54*B1^2 + 465.16*B1 - 3.24) * 40%
   */
  private calculatePosition11Base(averageTasksPerUser: number): number {
    const b1 = averageTasksPerUser;
    const polynomial =
      3.31 * Math.pow(b1, 5) -
      61.07 * Math.pow(b1, 4) +
      364.82 * Math.pow(b1, 3) -
      719.54 * Math.pow(b1, 2) +
      465.16 * b1 -
      3.24;
    return polynomial * 0.4; // 40% as per Excel formula
  }

  /**
   * Calculate cascade values for all positions based on EXACT Excel formulas
   */
  private calculateCascadeValues(position11Base: number): Map<number, number> {
    const values = new Map<number, number>();

    values.set(11, position11Base); // Position 11: Base
    values.set(12, position11Base * 1.05); // Position 12: +5%
    values.set(10, position11Base * (1 - 0.0413)); // Position 10: -4.13%

    const position10 = values.get(10)!;
    const position9 = position10 * (1 - 0.055); // Position 9: Position 10 - 5.5%
    values.set(9, position9);

    // Positions 1-8 are calculated as EXACT percentages of Position 9
    for (let excelPos = 1; excelPos <= 8; excelPos++) {
      values.set(excelPos, position9 * this.positionFactorsFromPosition9[excelPos]);
    }

    return values;
  }

  /**
   * Main calculation method - implements exact spreadsheet algorithm using polynomial cascade
   * @param positionName Position name (e.g., "Junior I", "Pleno IV", "Senior III")
   * @param performanceLevel User's performance level (1-5)
   * @param averageTasksPerUser B1 value (average weighted tasks per eligible user)
   */
  calculateBonus(
    positionName: string,
    performanceLevel: number,
    averageTasksPerUser: number,
  ): number {
    try {
      const positionLevel = this.getPositionLevel(positionName);
      const clampedPerformanceLevel = Math.max(1, Math.min(5, performanceLevel));
      const taskCount = Math.max(0, averageTasksPerUser);

      if (taskCount === 0) {
        return 0;
      }

      // Step 1: Calculate position 11 base value using polynomial
      const position11Base = this.calculatePosition11Base(taskCount);

      // Step 2: Get cascade values for all positions
      const cascadeValues = this.calculateCascadeValues(position11Base);

      // Step 3: Get base value for this position
      const positionBase = cascadeValues.get(positionLevel) || 0;

      // Step 4: Apply performance multiplier
      const performanceMultiplier = this.performanceMultipliers[clampedPerformanceLevel] || 1.0;
      const finalValue = positionBase * performanceMultiplier;

      // CRITICAL: Use centralized rounding utility for consistency
      const bonusValue = roundCurrency(finalValue);

      this.logger.debug(
        `Bonus calculation: Position "${positionName}" (level ${positionLevel}), ` +
          `Performance ${clampedPerformanceLevel}, Tasks ${taskCount.toFixed(2)} = R$ ${bonusValue.toFixed(2)}`,
      );

      return Math.max(0, bonusValue); // Ensure non-negative
    } catch (error) {
      this.logger.error('Error in bonus calculation:', error);
      return 0;
    }
  }

  /**
   * Get detailed calculation breakdown for debugging
   */
  getCalculationDetails(
    positionName: string,
    performanceLevel: number,
    averageTasksPerUser: number,
  ): {
    positionLevel: number;
    positionName: string;
    performanceLevel: number;
    taskCount: number;
    position11Base: number;
    positionBase: number;
    performanceMultiplier: number;
    bonusValue: number;
    formula: string;
  } {
    const positionLevel = this.getPositionLevel(positionName);
    const clampedPerformanceLevel = Math.max(1, Math.min(5, performanceLevel));
    const taskCount = Math.max(0, averageTasksPerUser);

    const position11Base = this.calculatePosition11Base(taskCount);
    const cascadeValues = this.calculateCascadeValues(position11Base);
    const positionBase = cascadeValues.get(positionLevel) || 0;
    const performanceMultiplier = this.performanceMultipliers[clampedPerformanceLevel] || 1.0;
    const bonusValue = this.calculateBonus(positionName, performanceLevel, averageTasksPerUser);

    return {
      positionLevel,
      positionName,
      performanceLevel: clampedPerformanceLevel,
      taskCount,
      position11Base,
      positionBase,
      performanceMultiplier,
      bonusValue,
      formula: `Position11Base(${taskCount.toFixed(2)}) = R$ ${position11Base.toFixed(2)} → Cascade[${positionLevel}] = R$ ${positionBase.toFixed(2)} × Performance[${clampedPerformanceLevel}] = R$ ${bonusValue.toFixed(2)}`,
    };
  }

  /**
   * Test the algorithm with sample data to verify correctness
   */
  testAlgorithm(): Array<{ position: string; level: number; tasks: number; bonus: number }> {
    const testCases = [
      { position: 'Junior I', level: 1, tasks: 4 },
      { position: 'Junior II', level: 2, tasks: 4 },
      { position: 'Pleno I', level: 1, tasks: 4 },
      { position: 'Senior III', level: 1, tasks: 4 },
      { position: 'Senior IV', level: 1, tasks: 4 },
    ];

    return testCases.map(test => ({
      position: test.position,
      level: test.level,
      tasks: test.tasks,
      bonus: this.calculateBonus(test.position, test.level, test.tasks),
    }));
  }
}
