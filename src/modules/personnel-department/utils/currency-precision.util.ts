/**
 * Currency Precision Utility
 *
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH for all monetary rounding in the system.
 * ALL bonus calculations, payroll calculations, and financial operations MUST use these utilities
 * to ensure consistent results across:
 * - Payroll calculations
 * - Live payroll data
 * - Bonus simulations
 * - Performance level tables
 * - Database seed scripts
 * - API responses
 * - Frontend displays
 *
 * DO NOT use Math.round(), toFixed(), or any other rounding method directly.
 * ALWAYS use these utilities to ensure consistency.
 */

/**
 * Number of decimal places for all monetary values (Brazilian Real)
 * BRL supports 2 decimal places (cents)
 */
export const CURRENCY_DECIMAL_PLACES = 2;

/**
 * Multiplier for rounding calculations
 * 10^2 = 100 for 2 decimal places
 */
const ROUNDING_MULTIPLIER = Math.pow(10, CURRENCY_DECIMAL_PLACES);

/**
 * Round a monetary value to the standard currency precision
 *
 * This is the PRIMARY function for rounding ALL monetary values in the system.
 * Uses banker's rounding (round half to even) for fairness.
 *
 * @param value - The value to round
 * @returns The rounded value with exactly 2 decimal places
 *
 * @example
 * roundCurrency(123.456) // 123.46
 * roundCurrency(123.454) // 123.45
 * roundCurrency(123.455) // 123.46 (banker's rounding)
 */
export function roundCurrency(value: number): number {
  if (!isFinite(value) || isNaN(value)) {
    return 0;
  }

  // Use standard rounding (round half up)
  // This ensures consistency with Excel and spreadsheet calculations
  return Math.round(value * ROUNDING_MULTIPLIER) / ROUNDING_MULTIPLIER;
}

/**
 * Round an average or percentage value to 2 decimal places
 * Used for intermediate calculations like average tasks per user
 *
 * @param value - The value to round
 * @returns The rounded value with exactly 2 decimal places
 *
 * @example
 * roundAverage(4.123456) // 4.12
 * roundAverage(3.999) // 4.00
 */
export function roundAverage(value: number): number {
  if (!isFinite(value) || isNaN(value)) {
    return 0;
  }

  return Math.round(value * ROUNDING_MULTIPLIER) / ROUNDING_MULTIPLIER;
}

/**
 * Format a currency value for display (Brazilian Real)
 *
 * @param value - The value to format
 * @param includeSymbol - Whether to include the R$ symbol
 * @returns Formatted string like "R$ 1.234,56" or "1.234,56"
 *
 * @example
 * formatCurrency(1234.56) // "R$ 1.234,56"
 * formatCurrency(1234.56, false) // "1.234,56"
 */
export function formatCurrency(value: number, includeSymbol = true): string {
  const rounded = roundCurrency(value);

  const formatted = rounded.toLocaleString('pt-BR', {
    minimumFractionDigits: CURRENCY_DECIMAL_PLACES,
    maximumFractionDigits: CURRENCY_DECIMAL_PLACES,
  });

  return includeSymbol ? `R$ ${formatted}` : formatted;
}

/**
 * Ensure a value is exactly 2 decimal places for database storage
 * This prevents floating point precision issues in the database
 *
 * @param value - The value to normalize
 * @returns The value with exactly 2 decimal places
 *
 * @example
 * normalizeCurrencyForDB(123.456789) // 123.46
 * normalizeCurrencyForDB(100) // 100.00
 */
export function normalizeCurrencyForDB(value: number): number {
  return parseFloat(roundCurrency(value).toFixed(CURRENCY_DECIMAL_PLACES));
}

/**
 * Compare two currency values for equality
 * Handles floating point precision issues
 *
 * @param value1 - First value
 * @param value2 - Second value
 * @returns true if values are equal within currency precision
 *
 * @example
 * currencyEquals(123.45, 123.45) // true
 * currencyEquals(123.456, 123.457) // false
 * currencyEquals(123.454, 123.456) // true (both round to 123.45)
 */
export function currencyEquals(value1: number, value2: number): boolean {
  return roundCurrency(value1) === roundCurrency(value2);
}

/**
 * Sum an array of currency values with proper rounding
 * Rounds each value before summing to prevent accumulation of rounding errors
 *
 * @param values - Array of values to sum
 * @returns The sum with proper currency rounding
 *
 * @example
 * sumCurrency([123.45, 67.89, 12.34]) // 203.68
 */
export function sumCurrency(values: number[]): number {
  const sum = values.reduce((acc, val) => acc + roundCurrency(val), 0);
  return roundCurrency(sum);
}

/**
 * Calculate percentage of a currency value
 * Properly rounds the result
 *
 * @param value - The base value
 * @param percentage - The percentage (e.g., 10 for 10%)
 * @returns The calculated percentage value
 *
 * @example
 * calculatePercentage(1000, 10) // 100.00
 * calculatePercentage(1234.56, 7.5) // 92.59
 */
export function calculatePercentage(value: number, percentage: number): number {
  const result = (roundCurrency(value) * percentage) / 100;
  return roundCurrency(result);
}

/**
 * Validate that a value has correct currency precision
 * Used for data validation
 *
 * @param value - The value to validate
 * @returns true if value has at most 2 decimal places
 *
 * @example
 * isValidCurrencyPrecision(123.45) // true
 * isValidCurrencyPrecision(123.456) // false
 */
export function isValidCurrencyPrecision(value: number): boolean {
  if (!isFinite(value) || isNaN(value)) {
    return false;
  }

  const rounded = roundCurrency(value);
  return Math.abs(value - rounded) < Number.EPSILON;
}

/**
 * Get the difference between expected and actual values
 * Used for debugging calculation mismatches
 *
 * @param expected - Expected value
 * @param actual - Actual value
 * @returns Object with difference and percentage
 *
 * @example
 * getCurrencyDifference(100, 95)
 * // { difference: -5.00, percentageDifference: -5.00 }
 */
export function getCurrencyDifference(
  expected: number,
  actual: number,
): {
  difference: number;
  percentageDifference: number;
  isSignificant: boolean;
} {
  const diff = roundCurrency(actual - expected);
  const percentDiff = expected !== 0 ? roundCurrency((diff / expected) * 100) : 0;

  // Difference is significant if it's more than 0.01 (1 cent)
  const isSignificant = Math.abs(diff) > 0.01;

  return {
    difference: diff,
    percentageDifference: percentDiff,
    isSignificant,
  };
}
