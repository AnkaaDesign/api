// packages/utils/src/bonus.ts
//
// Period helpers, live-ID utilities, eligibility checks, and discount math.
// The bonus calculation algorithm itself lives in
// modules/human-resources/bonus/bonus-calculation.service.ts (salary-based
// logistic). This file MUST NOT contain any position-name parsing or
// hardcoded position-level cascades — that fragility is gone for good.

// =====================
// Period Detection Utilities (5th day rule)
// =====================

/**
 * Get the current payroll/bonus period based on the 5th day rule.
 *
 * The rule is: The "current" period only changes after the 5th of the month.
 * - Before day 5 (1st-5th): Current period is the PREVIOUS month
 * - After day 5 (6th-31st): Current period is the CURRENT month
 *
 * This is because:
 * - Bonus/Payroll period runs from 26th to 25th
 * - Payment happens on the 5th
 * - Until payment, we're still in the "previous" period
 *
 * @param referenceDate Optional date to calculate from (defaults to now)
 * @returns Object with year, month for the current period
 */
export function getCurrentPeriod(referenceDate?: Date): { year: number; month: number } {
  const now = referenceDate || new Date();
  const currentDay = now.getDate();
  const currentMonth = now.getMonth() + 1; // JS months are 0-indexed
  const currentYear = now.getFullYear();

  // If we're on or before the 5th, we're still in the previous month's period
  if (currentDay <= 5) {
    if (currentMonth === 1) {
      // January 1-5: Previous period is December of previous year
      return { year: currentYear - 1, month: 12 };
    }
    return { year: currentYear, month: currentMonth - 1 };
  }

  // After the 5th, we're in the current month's period
  return { year: currentYear, month: currentMonth };
}

/**
 * Check if a given year/month represents the "current" period.
 * Uses the 5th day rule to determine what "current" means.
 *
 * @param year The year to check
 * @param month The month to check (1-12)
 * @param referenceDate Optional date to calculate from (defaults to now)
 * @returns true if the given year/month is the current period
 */
export function isCurrentPeriod(year: number, month: number, referenceDate?: Date): boolean {
  const current = getCurrentPeriod(referenceDate);
  return year === current.year && month === current.month;
}

/**
 * Check if a filter includes the current period.
 * This is used to determine if live calculation should be performed.
 *
 * @param filterYear Year from filter (optional)
 * @param filterMonths Array of months from filter (optional)
 * @param referenceDate Optional date to calculate from (defaults to now)
 * @returns true if the filter includes the current period
 */
export function filterIncludesCurrentPeriod(
  filterYear?: number,
  filterMonths?: number[],
  referenceDate?: Date,
): boolean {
  const current = getCurrentPeriod(referenceDate);

  // If no filter specified, we're showing all data (including current)
  if (!filterYear && (!filterMonths || filterMonths.length === 0)) {
    return true;
  }

  // If year is specified but doesn't match, current period is not included
  if (filterYear && filterYear !== current.year) {
    return false;
  }

  // If months are specified, check if current month is in the list
  if (filterMonths && filterMonths.length > 0) {
    return filterMonths.includes(current.month);
  }

  // Year matches and no month filter, so current period is included
  return true;
}

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
    end: getBonusPeriodEnd(year, month),
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

// =====================
// Composite ID Utilities for Live Bonuses/Payrolls
// =====================

/**
 * Parse a composite live bonus/payroll ID
 * Format: live-{userId}-{year}-{month}
 * Example: live-550e8400-e29b-41d4-a716-446655440000-2024-11
 *
 * @param id The composite ID to parse
 * @returns Object with userId, year, month or null if invalid
 */
export function parseLiveId(id: string): { userId: string; year: number; month: number } | null {
  if (!id || !id.startsWith('live-')) {
    return null;
  }

  const parts = id.replace('live-', '').split('-');
  if (parts.length < 7) {
    // UUID has 5 parts, plus year and month = 7 parts minimum
    return null;
  }

  const month = parseInt(parts[parts.length - 1], 10);
  const year = parseInt(parts[parts.length - 2], 10);
  const userId = parts.slice(0, -2).join('-');

  // Validate month and year
  if (isNaN(month) || isNaN(year) || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return null;
  }

  // Validate userId is a UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return null;
  }

  return { userId, year, month };
}

/**
 * Create a composite live ID for bonuses/payrolls
 * @param userId The user's UUID
 * @param year The year (2000-2100)
 * @param month The month (1-12)
 * @returns Composite ID in format: live-{userId}-{year}-{month}
 */
export function createLiveId(userId: string, year: number, month: number): string {
  return `live-${userId}-${year}-${month}`;
}

/**
 * Check if an ID is a live calculation ID (not a database UUID)
 * @param id The ID to check
 * @returns True if it's a live ID, false otherwise
 */
export function isLiveId(id: string): boolean {
  return id?.startsWith('live-') ?? false;
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
 * Count tasks from bonus tasks relation
 * @param tasks Array of tasks from bonus relation
 * @returns Number of tasks
 */
export function countBonusTasks(tasks?: any[]): number {
  return tasks?.length || 0;
}

// =====================
// Discount Calculation Utilities
// =====================

export interface BonusDiscount {
  id: string;
  reference: string;
  percentage?: number;
  value?: number;
  calculationOrder: number;
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
  discounts: BonusDiscount[],
): {
  finalValue: number;
  totalPercentageDiscount: number;
  totalFixedDiscount: number;
  appliedDiscounts: Array<{
    id: string;
    reference: string;
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
  const sortedDiscounts = [...discounts].sort((a, b) => a.calculationOrder - b.calculationOrder);

  // Separate percentage and fixed discounts
  const percentageDiscounts = sortedDiscounts.filter(
    d => d.percentage !== undefined && d.percentage > 0,
  );
  const fixedDiscounts = sortedDiscounts.filter(d => d.value !== undefined && d.value > 0);

  let currentValue = originalValue;
  let totalPercentageDiscount = 0;
  let totalFixedDiscount = 0;
  const appliedDiscounts: Array<{
    id: string;
    reference: string;
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
      reference: discount.reference,
      type: 'percentage',
      amount: discountAmount,
      valueAfterDiscount: currentValue,
    });
  }

  // Then apply fixed value discounts
  for (const discount of fixedDiscounts) {
    const fixedVal = discount.value!;
    const previousValue = currentValue;
    currentValue = applyFixedValueDiscount(currentValue, fixedVal);
    const actualDiscount = previousValue - currentValue;
    totalFixedDiscount += actualDiscount;

    appliedDiscounts.push({
      id: discount.id,
      reference: discount.reference,
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
export function calculateFinalBonusValue(baseValue: number, discounts?: BonusDiscount[]): number {
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
  discounts: BonusDiscount[],
): {
  originalValue: number;
  finalValue: number;
  totalDiscountAmount: number;
  discounts: Array<{
    reference: string;
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
      reference: d.reference,
      type: d.type,
      displayValue:
        d.type === 'percentage'
          ? `${((d.amount / originalValue) * 100).toFixed(2)}%`
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

  if (!discount.reference || discount.reference.trim().length === 0) {
    errors.push('Motivo é obrigatório');
  }

  const hasPercentage = discount.percentage !== undefined && discount.percentage !== null;
  const hasFixedValue = discount.value !== undefined && discount.value !== null;

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

  if (hasFixedValue && discount.value! < 0) {
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
  percentage?: number | null;
  value?: number | null;
  reference?: string;
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
  discounts: PayrollDiscount[],
): number {
  if (!discounts || discounts.length === 0 || baseRemuneration <= 0) {
    return 0;
  }

  let totalDiscount = 0;
  let remaining = baseRemuneration;

  for (const discount of discounts) {
    if (remaining <= 0) break;

    let discountAmount = 0;

    if (discount.percentage && discount.percentage > 0) {
      discountAmount = remaining * (discount.percentage / 100);
    } else if (discount.value && discount.value > 0) {
      discountAmount = Math.min(discount.value, remaining);
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
  bonus?: number,
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
  bonus?: number,
): {
  baseRemuneration: number;
  bonusAmount: number;
  grossAmount: number;
  totalDiscounts: number;
  netSalary: number;
  discountDetails: Array<{
    reference: string;
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
    reference: string;
    type: 'percentage' | 'fixed';
    rate: number;
    amount: number;
    remainingAfterDiscount: number;
  }> = [];

  if (discounts && discounts.length > 0) {
    let remaining = baseRemuneration;

    for (const discount of discounts) {
      if (remaining <= 0) break;

      let discountAmount = 0;
      let type: 'percentage' | 'fixed' = 'fixed';
      let rate = 0;

      if (discount.percentage && discount.percentage > 0) {
        type = 'percentage';
        rate = discount.percentage;
        discountAmount = remaining * (discount.percentage / 100);
      } else if (discount.value && discount.value > 0) {
        type = 'fixed';
        rate = discount.value;
        discountAmount = Math.min(discount.value, remaining);
      }

      remaining -= discountAmount;

      discountDetails.push({
        reference: discount.reference || 'Desconto',
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
