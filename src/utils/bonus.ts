// packages/utils/src/bonus.ts

// REMOVED: Incorrect hardcoded bonus matrix
// The correct bonus calculation is implemented in the API using polynomial-based algorithm
// from db:seed script and ExactBonusCalculationService

/**
 * Get position level from position name (1=junior, 2=pleno, 3=senior)
 * @param positionName The name of the position
 * @returns Position level (1, 2, or 3)
 */
export function getPositionLevel(positionName: string | null | undefined | any): number {
  if (!positionName || typeof positionName !== 'string') {
    return 1; // Default to Junior if no position name or not a string
  }
  const normalizedName = positionName.toLowerCase();

  if (normalizedName.includes('junior') ||
      normalizedName.includes('auxiliar') ||
      normalizedName.includes('estagiário') ||
      normalizedName.includes('trainee')) {
    return 1; // Junior
  } else if (normalizedName.includes('pleno') ||
             normalizedName.includes('médio') ||
             normalizedName.includes('analista') ||
             normalizedName.includes('especialista')) {
    return 2; // Pleno
  } else if (normalizedName.includes('senior') ||
             normalizedName.includes('coordenador') ||
             normalizedName.includes('gerente') ||
             normalizedName.includes('supervisor')) {
    return 3; // Senior
  } else {
    // Default to pleno (level 2) for unclear positions
    return 2;
  }
}

// REMOVED: calculateBonusAmount function - used incorrect hardcoded matrix calculation
// The correct bonus calculation is implemented in the API using polynomial-based algorithm

/**
 * Get the start date of a bonus/payroll period (day 26 of previous month)
 * Period runs from 26th of previous month to 25th of current month
 * @param year The year as number
 * @param month The month as number (1-12)
 * @returns Start date of the bonus period at 00:00:00.000
 */
export function getBonusPeriodStart(year: number, month: number): Date {
  if (month === 1) {
    return new Date(year - 1, 11, 26, 0, 0, 0, 0); // Dec 26 of previous year
  }
  return new Date(year, month - 2, 26, 0, 0, 0, 0); // Day 26 of previous month
}

/**
 * Get the end date of a bonus/payroll period (day 25 of current month)
 * Period runs from 26th of previous month to 25th of current month
 * @param year The year as number
 * @param month The month as number (1-12)
 * @returns End date of the bonus period at 23:59:59.999
 */
export function getBonusPeriodEnd(year: number, month: number): Date {
  return new Date(year, month - 1, 25, 23, 59, 59, 999); // Day 25 of current month
}

/**
 * Get the payroll period dates (same as bonus period: 26th to 25th)
 * @param year The year as number
 * @param month The month as number (1-12)
 * @returns Object with start and end dates
 */
export function getPayrollPeriod(year: number, month: number) {
  return {
    start: getBonusPeriodStart(year, month),
    end: getBonusPeriodEnd(year, month)
  };
}

/**
 * Calculate bonus/payroll period dates based on year and month
 * Period runs from day 26 of the previous month to day 25 of the current month
 * @param year The year as number
 * @param month The month as number (1-12)
 * @returns Object with startDate and endDate
 */
export function getBonusPeriod(year: number, month: number): { startDate: Date; endDate: Date } {
  return {
    startDate: getBonusPeriodStart(year, month),
    endDate: getBonusPeriodEnd(year, month),
  };
}

/**
 * Determine position category from position name
 * @param positionName The name of the position
 * @returns The position category
 */
export function getPositionCategory(positionName: string): 'junior' | 'pleno' | 'senior' {
  const normalizedName = positionName.toLowerCase();

  if (normalizedName.includes('junior') || normalizedName.includes('auxiliar') || normalizedName.includes('estagiário')) {
    return 'junior';
  } else if (normalizedName.includes('pleno') || normalizedName.includes('médio') || normalizedName.includes('analista')) {
    return 'pleno';
  } else if (normalizedName.includes('senior') || normalizedName.includes('coordenador') || normalizedName.includes('gerente')) {
    return 'senior';
  } else {
    // Default to pleno if unclear
    return 'pleno';
  }
}

/**
 * Check if a position is eligible for bonus based on its bonifiable flag
 * @param position Position object with bonifiable property
 * @returns true if eligible for bonus
 */
export function isPositionBonusEligible(position: { bonifiable?: boolean }): boolean {
  return position.bonifiable === true;
}

// REMOVED: getBonusCalculationDetails function - depended on incorrect calculateBonusAmount

// REMOVED: getAvailableMatrixKeys function - used incorrect BONUS_MATRIX

/**
 * Validate that performance level is in valid range
 * @param performanceLevel The performance level to validate
 * @returns true if valid (1-5), false otherwise
 */
export function isValidPerformanceLevel(performanceLevel: number): boolean {
  return performanceLevel >= 1 && performanceLevel <= 5 && Number.isInteger(performanceLevel);
}

/**
 * EXACT position factors from Position 9 (as percentages)
 * These are the exact values from the Excel spreadsheet
 */
const positionFactorsFromPosition9: Record<number, number> = {
  1: 0.0972,  // Position 1: 9.72% of Position 9
  2: 0.1932,  // Position 2: 19.32% of Position 9
  3: 0.3220,  // Position 3: 32.20% of Position 9
  4: 0.4609,  // Position 4: 46.09% of Position 9
  5: 0.5985,  // Position 5: 59.85% of Position 9
  6: 0.7210,  // Position 6: 72.10% of Position 9
  7: 0.8283,  // Position 7: 82.83% of Position 9
  8: 0.9205,  // Position 8: 92.05% of Position 9
};

/**
 * EXACT performance level multipliers from Excel
 */
const performanceMultipliers: Record<number, number> = {
  1: 1.0,   // Base value
  2: 2.0,   // Exactly 2x base
  3: 3.0,   // Exactly 3x base
  4: 3.5,   // Exactly 3.5x base
  5: 4.0,   // Exactly 4x base
};

/**
 * Get detailed position level (1-12) from position name
 * Junior: I, II, III, IV (positions 1-4)
 * Pleno: I, II, III, IV (positions 5-8)
 * Senior: I, II, III, IV (positions 9-12)
 */
function getDetailedPositionLevel(positionName: string): number {
  const normalized = positionName.toLowerCase().replace(/\s+/g, '').trim();

  // Junior levels (1-4) - Check longer strings first to avoid substring matching issues
  if (normalized.includes('junioriv') || normalized.includes('júnioriv')) return 4;
  if (normalized.includes('junioriii') || normalized.includes('júnioriii')) return 3;
  if (normalized.includes('juniorii') || normalized.includes('júniorii')) return 2;
  if (normalized.includes('juniori') || normalized.includes('júniori')) return 1;
  if (normalized === 'junior' || normalized === 'júnior') return 1;

  // Pleno levels (5-8) - Check longer strings first to avoid substring matching issues
  if (normalized.includes('plenoiv')) return 8;
  if (normalized.includes('plenoiii')) return 7;
  if (normalized.includes('plenoii')) return 6;
  if (normalized.includes('plenoi')) return 5;
  if (normalized === 'pleno') return 5;

  // Senior levels (9-12) - Check longer strings first to avoid substring matching issues
  if (normalized.includes('senioriv') || normalized.includes('sênioriv')) return 12;
  if (normalized.includes('senioriii') || normalized.includes('sênioriii')) return 11;
  if (normalized.includes('seniorii') || normalized.includes('sêniorii')) return 10;
  if (normalized.includes('seniori') || normalized.includes('sêniori')) return 9;
  if (normalized === 'senior' || normalized === 'sênior') return 11; // Default senior to III

  // Fallback based on category
  if (normalized.includes('junior') || normalized.includes('júnior') ||
      normalized.includes('auxiliar') || normalized.includes('estagiário')) {
    return 1;
  }
  if (normalized.includes('pleno')) {
    return 5;
  }
  if (normalized.includes('senior') || normalized.includes('sênior')) {
    return 11;
  }

  // Default to Pleno I
  return 5;
}

/**
 * Calculate EXACT position 11 base value using polynomial formula from Excel
 * Formula: (3.31*B1^5 - 61.07*B1^4 + 364.82*B1^3 - 719.54*B1^2 + 465.16*B1 - 3.24) * 40%
 */
function calculatePosition11Base(averageTasksPerUser: number): number {
  const b1 = averageTasksPerUser;
  const polynomial = (
    3.31 * Math.pow(b1, 5) -
    61.07 * Math.pow(b1, 4) +
    364.82 * Math.pow(b1, 3) -
    719.54 * Math.pow(b1, 2) +
    465.16 * b1 -
    3.24
  );
  return polynomial * 0.4; // 40% as per Excel formula
}

/**
 * Calculate cascade values for all positions based on EXACT Excel formulas
 */
function calculateCascadeValues(position11Base: number): Map<number, number> {
  const values = new Map<number, number>();

  values.set(11, position11Base); // Position 11: Base
  values.set(12, position11Base * 1.05); // Position 12: +5%
  values.set(10, position11Base * (1 - 0.0413)); // Position 10: -4.13%

  const position10 = values.get(10)!;
  const position9 = position10 * (1 - 0.055); // Position 9: Position 10 - 5.5%
  values.set(9, position9);

  // Positions 1-8 are calculated as EXACT percentages of Position 9
  for (let excelPos = 1; excelPos <= 8; excelPos++) {
    values.set(excelPos, position9 * positionFactorsFromPosition9[excelPos]);
  }

  return values;
}

/**
 * Calculate bonus for a specific position and performance level
 * Uses the EXACT polynomial-based algorithm from the Excel spreadsheet
 *
 * Task Quantity Calculation:
 * - Tasks quantity = fullCommissionTasks + (partialCommissionTasks * 0.5)
 * - Average per user = Total tasks quantity / Number of eligible users
 *
 * @param positionName The name of the position (e.g., "Junior I", "Pleno III", "Senior II")
 * @param performanceLevel The performance level (1-5)
 * @param averageTasksPerUser The average number of tasks per user (weighted by commission type)
 * @returns The calculated bonus amount
 */
export function calculateBonusForPosition(
  positionName: string,
  performanceLevel: number,
  averageTasksPerUser: number
): number {
  try {
    const positionLevel = getDetailedPositionLevel(positionName);
    const clampedPerformanceLevel = Math.max(1, Math.min(5, performanceLevel));
    const taskCount = Math.max(0, averageTasksPerUser);

    if (taskCount === 0) {
      return 0;
    }

    // Step 1: Calculate position 11 base value using polynomial
    const position11Base = calculatePosition11Base(taskCount);

    // Step 2: Get cascade values for all positions
    const cascadeValues = calculateCascadeValues(position11Base);

    // Step 3: Get base value for position (direct mapping)
    const positionBase = cascadeValues.get(positionLevel) || 0;

    // Step 4: Apply performance multiplier
    const performanceMultiplier = performanceMultipliers[clampedPerformanceLevel] || 1.0;
    const finalValue = positionBase * performanceMultiplier;

    return Math.round(finalValue * 100) / 100;
  } catch (error) {
    console.error('Error calculating bonus:', error);
    return 0;
  }
}

/**
 * Get the position category name from position level
 * @param positionLevel The position level (1, 2, or 3)
 * @returns Position category name
 */
export function getPositionCategoryName(positionLevel: number): string {
  switch (positionLevel) {
    case 1:
      return 'Junior';
    case 2:
      return 'Pleno';
    case 3:
      return 'Senior';
    default:
      return 'Unknown';
  }
}

/**
 * Count tasks from bonus tasks relation
 * @param tasks Array of tasks from bonus relation
 * @returns Number of tasks
 */
export function countBonusTasks(tasks?: any[]): number {
  return tasks?.length || 0;
}

// REMOVED: calculateBonusFromTasks function - depended on incorrect calculateBonusAmount

// =====================
// Discount Calculation Utilities
// =====================

export interface BonusDiscount {
  id: string;
  reason: string;
  percentage?: number;
  fixedValue?: number;
  order: number;
}

/**
 * Apply percentage discount to a bonus value
 * @param value The original bonus value
 * @param percentage The discount percentage (0-100)
 * @returns The discounted value
 */
export function applyPercentageDiscount(value: number, percentage: number): number {
  if (percentage <= 0) return value;
  if (percentage >= 100) return 0;

  const discountAmount = value * (percentage / 100);
  return Math.round((value - discountAmount) * 100) / 100;
}

/**
 * Apply fixed value discount to a bonus value
 * @param value The original bonus value
 * @param fixedValue The fixed discount amount
 * @returns The discounted value
 */
export function applyFixedValueDiscount(value: number, fixedValue: number): number {
  if (fixedValue <= 0) return value;

  const discountedValue = value - fixedValue;
  return Math.max(0, Math.round(discountedValue * 100) / 100);
}

/**
 * Apply multiple discounts to a bonus value in the correct order
 * Order: Percentage discounts first (applied to original value), then fixed value discounts
 * @param originalValue The original bonus value
 * @param discounts Array of discounts to apply, sorted by order
 * @returns Object with final value and breakdown of applied discounts
 */
export function applyDiscounts(
  originalValue: number,
  discounts: BonusDiscount[]
): {
  finalValue: number;
  totalPercentageDiscount: number;
  totalFixedDiscount: number;
  appliedDiscounts: Array<{
    id: string;
    reason: string;
    type: 'percentage' | 'fixed';
    amount: number;
    valueAfterDiscount: number;
  }>;
} {
  if (!discounts || discounts.length === 0) {
    return {
      finalValue: originalValue,
      totalPercentageDiscount: 0,
      totalFixedDiscount: 0,
      appliedDiscounts: [],
    };
  }

  // Sort discounts by order
  const sortedDiscounts = [...discounts].sort((a, b) => a.order - b.order);

  // Separate percentage and fixed discounts
  const percentageDiscounts = sortedDiscounts.filter(d => d.percentage !== undefined && d.percentage > 0);
  const fixedDiscounts = sortedDiscounts.filter(d => d.fixedValue !== undefined && d.fixedValue > 0);

  let currentValue = originalValue;
  let totalPercentageDiscount = 0;
  let totalFixedDiscount = 0;
  const appliedDiscounts: Array<{
    id: string;
    reason: string;
    type: 'percentage' | 'fixed';
    amount: number;
    valueAfterDiscount: number;
  }> = [];

  // Apply percentage discounts first
  for (const discount of percentageDiscounts) {
    const percentage = discount.percentage!;
    const discountAmount = currentValue * (percentage / 100);
    currentValue = applyPercentageDiscount(currentValue, percentage);
    totalPercentageDiscount += percentage;

    appliedDiscounts.push({
      id: discount.id,
      reason: discount.reason,
      type: 'percentage',
      amount: discountAmount,
      valueAfterDiscount: currentValue,
    });
  }

  // Then apply fixed value discounts
  for (const discount of fixedDiscounts) {
    const fixedValue = discount.fixedValue!;
    const previousValue = currentValue;
    currentValue = applyFixedValueDiscount(currentValue, fixedValue);
    const actualDiscount = previousValue - currentValue;
    totalFixedDiscount += actualDiscount;

    appliedDiscounts.push({
      id: discount.id,
      reason: discount.reason,
      type: 'fixed',
      amount: actualDiscount,
      valueAfterDiscount: currentValue,
    });
  }

  return {
    finalValue: currentValue,
    totalPercentageDiscount,
    totalFixedDiscount,
    appliedDiscounts,
  };
}

/**
 * Calculate the total discount amount from discounts
 * @param originalValue The original bonus value
 * @param discounts Array of discounts
 * @returns The total discount amount
 */
export function calculateTotalDiscount(originalValue: number, discounts: BonusDiscount[]): number {
  const result = applyDiscounts(originalValue, discounts);
  return originalValue - result.finalValue;
}

/**
 * Calculate bonus value with discounts applied
 * @param baseValue The calculated bonus amount from matrix
 * @param discounts Array of discounts to apply
 * @returns The final bonus value after discounts
 */
export function calculateFinalBonusValue(
  baseValue: number,
  discounts?: BonusDiscount[]
): number {
  if (!discounts || discounts.length === 0) {
    return baseValue;
  }

  const result = applyDiscounts(baseValue, discounts);
  return result.finalValue;
}

/**
 * Get discount breakdown for display purposes
 * @param originalValue The original bonus value
 * @param discounts Array of discounts
 * @returns Formatted breakdown of discounts
 */
export function getDiscountBreakdown(
  originalValue: number,
  discounts: BonusDiscount[]
): {
  originalValue: number;
  finalValue: number;
  totalDiscountAmount: number;
  discounts: Array<{
    reason: string;
    type: 'percentage' | 'fixed';
    displayValue: string;
    discountAmount: number;
  }>;
} {
  const result = applyDiscounts(originalValue, discounts);

  return {
    originalValue,
    finalValue: result.finalValue,
    totalDiscountAmount: originalValue - result.finalValue,
    discounts: result.appliedDiscounts.map(d => ({
      reason: d.reason,
      type: d.type,
      displayValue: d.type === 'percentage'
        ? `${(d.amount / originalValue * 100).toFixed(2)}%`
        : `R$ ${d.amount.toFixed(2)}`,
      discountAmount: d.amount,
    })),
  };
}

/**
 * Validate discount configuration
 * @param discount The discount to validate
 * @returns Validation result
 */
export function validateDiscount(discount: Partial<BonusDiscount>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!discount.reason || discount.reason.trim().length === 0) {
    errors.push('Motivo é obrigatório');
  }

  const hasPercentage = discount.percentage !== undefined && discount.percentage !== null;
  const hasFixedValue = discount.fixedValue !== undefined && discount.fixedValue !== null;

  if (!hasPercentage && !hasFixedValue) {
    errors.push('Deve ter percentual ou valor fixo');
  }

  if (hasPercentage && hasFixedValue) {
    errors.push('Não pode ter percentual e valor fixo ao mesmo tempo');
  }

  if (hasPercentage) {
    if (discount.percentage! < 0) {
      errors.push('Percentual não pode ser negativo');
    }
    if (discount.percentage! > 100) {
      errors.push('Percentual não pode ser maior que 100%');
    }
  }

  if (hasFixedValue && discount.fixedValue! < 0) {
    errors.push('Valor fixo não pode ser negativo');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// =====================
// Payroll Calculation Utilities
// =====================

export interface PayrollDiscount {
  percentage?: number;
  fixedValue?: number;
  calculationOrder: number;
}

/**
 * Calculate payroll discounts applied to base remuneration
 * Discounts are applied in order, with each subsequent discount calculated on the remaining amount
 * @param baseRemuneration The base salary amount
 * @param discounts Array of discounts to apply, ordered by calculationOrder
 * @returns Total discount amount
 */
export function calculatePayrollDiscounts(
  baseRemuneration: number,
  discounts: PayrollDiscount[]
): number {
  if (!discounts || discounts.length === 0 || baseRemuneration <= 0) {
    return 0;
  }

  // Sort discounts by order
  const sorted = [...discounts].sort((a, b) => a.calculationOrder - b.calculationOrder);

  let totalDiscount = 0;
  let remaining = baseRemuneration;

  for (const discount of sorted) {
    if (remaining <= 0) break;

    let discountAmount = 0;

    if (discount.percentage && discount.percentage > 0) {
      discountAmount = remaining * (discount.percentage / 100);
    } else if (discount.fixedValue && discount.fixedValue > 0) {
      discountAmount = Math.min(discount.fixedValue, remaining);
    }

    totalDiscount += discountAmount;
    remaining -= discountAmount;
  }

  return Math.round(totalDiscount * 100) / 100;
}

/**
 * Calculate net salary after all discounts and bonuses
 * @param baseRemuneration The base salary amount
 * @param discounts Array of discounts to apply
 * @param bonus Optional bonus amount to add
 * @returns Net salary amount
 */
export function calculateNetSalary(
  baseRemuneration: number,
  discounts: PayrollDiscount[],
  bonus?: number
): number {
  if (baseRemuneration <= 0) {
    return 0;
  }

  const totalDiscounts = calculatePayrollDiscounts(baseRemuneration, discounts);
  const bonusAmount = bonus && bonus > 0 ? bonus : 0;

  const netSalary = baseRemuneration + bonusAmount - totalDiscounts;

  return Math.max(0, Math.round(netSalary * 100) / 100);
}

/**
 * Get detailed breakdown of payroll calculation
 * @param baseRemuneration The base salary amount
 * @param discounts Array of discounts to apply
 * @param bonus Optional bonus amount to add
 * @returns Detailed breakdown of the payroll calculation
 */
export function getPayrollCalculationBreakdown(
  baseRemuneration: number,
  discounts: PayrollDiscount[],
  bonus?: number
): {
  baseRemuneration: number;
  bonusAmount: number;
  grossAmount: number;
  totalDiscounts: number;
  netSalary: number;
  discountDetails: Array<{
    order: number;
    type: 'percentage' | 'fixed';
    rate: number;
    amount: number;
    remainingAfterDiscount: number;
  }>;
} {
  const bonusAmount = bonus && bonus > 0 ? bonus : 0;
  const grossAmount = baseRemuneration + bonusAmount;

  // Calculate discounts with details
  const discountDetails: Array<{
    order: number;
    type: 'percentage' | 'fixed';
    rate: number;
    amount: number;
    remainingAfterDiscount: number;
  }> = [];

  if (discounts && discounts.length > 0) {
    const sorted = [...discounts].sort((a, b) => a.calculationOrder - b.calculationOrder);
    let remaining = baseRemuneration;

    for (const discount of sorted) {
      if (remaining <= 0) break;

      let discountAmount = 0;
      let type: 'percentage' | 'fixed' = 'fixed';
      let rate = 0;

      if (discount.percentage && discount.percentage > 0) {
        type = 'percentage';
        rate = discount.percentage;
        discountAmount = remaining * (discount.percentage / 100);
      } else if (discount.fixedValue && discount.fixedValue > 0) {
        type = 'fixed';
        rate = discount.fixedValue;
        discountAmount = Math.min(discount.fixedValue, remaining);
      }

      remaining -= discountAmount;

      discountDetails.push({
        order: discount.calculationOrder,
        type,
        rate,
        amount: Math.round(discountAmount * 100) / 100,
        remainingAfterDiscount: Math.round(remaining * 100) / 100,
      });
    }
  }

  const totalDiscounts = discountDetails.reduce((sum, detail) => sum + detail.amount, 0);
  const netSalary = calculateNetSalary(baseRemuneration, discounts, bonus);

  return {
    baseRemuneration: Math.round(baseRemuneration * 100) / 100,
    bonusAmount: Math.round(bonusAmount * 100) / 100,
    grossAmount: Math.round(grossAmount * 100) / 100,
    totalDiscounts: Math.round(totalDiscounts * 100) / 100,
    netSalary,
    discountDetails,
  };
}