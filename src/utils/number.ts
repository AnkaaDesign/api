// packages/utils/src/number.ts

// =====================
// Currency Formatting
// =====================

export const formatCurrency = (value: number, locale: string = "pt-BR", currency: string = "BRL"): string => {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency,
  }).format(value);
};

export const formatCurrencyCompact = (value: number, locale: string = "pt-BR"): string => {
  if (value >= 1000000000) {
    return `R$ ${(value / 1000000000).toFixed(1)}B`;
  } else if (value >= 1000000) {
    return `R$ ${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `R$ ${(value / 1000).toFixed(1)}K`;
  }
  return formatCurrency(value, locale);
};

export const formatCurrencyWithoutSymbol = (value: number, locale: string = "pt-BR"): string => {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const parseCurrency = (value: string): number => {
  // Remove currency symbols and convert to number
  const cleanValue = value
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const number = parseFloat(cleanValue);
  return isNaN(number) ? 0 : number;
};

// =====================
// Number Formatting
// =====================

export const formatNumber = (value: number, locale: string = "pt-BR"): string => {
  return new Intl.NumberFormat(locale).format(value);
};

export const formatNumberWithDecimals = (value: number, decimals: number = 2, locale: string = "pt-BR"): string => {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

export const formatPercentage = (value: number, decimals: number = 1, locale: string = "pt-BR"): string => {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value / 100);
};

export const formatNumberCompact = (value: number, locale: string = "pt-BR"): string => {
  if (value >= 1000000000) {
    return `${(value / 1000000000).toFixed(1)}B`;
  } else if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return formatNumber(value, locale);
};

export const formatOrdinal = (value: number, locale: string = "pt-BR"): string => {
  if (locale === "pt-BR") {
    return `${value}º`;
  }

  // English ordinals
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = value % 100;
  const suffix = suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0];
  return `${value}${suffix}`;
};

// =====================
// Number Validation
// =====================

export const isValidNumber = (value: unknown): value is number => {
  return typeof value === "number" && !isNaN(value) && isFinite(value);
};

export const isPositiveNumber = (value: number): boolean => {
  return isValidNumber(value) && value > 0;
};

export const isNegativeNumber = (value: number): boolean => {
  return isValidNumber(value) && value < 0;
};

export const isInteger = (value: number): boolean => {
  return isValidNumber(value) && Number.isInteger(value);
};

export const isInRange = (value: number, min: number, max: number): boolean => {
  return isValidNumber(value) && value >= min && value <= max;
};

export const validateNumberRange = (value: number, min?: number, max?: number, fieldName: string = "Valor"): string[] => {
  const errors: string[] = [];

  if (!isValidNumber(value)) {
    errors.push(`${fieldName} deve ser um número válido`);
    return errors;
  }

  if (min !== undefined && value < min) {
    errors.push(`${fieldName} deve ser maior ou igual a ${formatNumber(min)}`);
  }

  if (max !== undefined && value > max) {
    errors.push(`${fieldName} deve ser menor ou igual a ${formatNumber(max)}`);
  }

  return errors;
};

// =====================
// Number Parsing
// =====================

export const parseNumber = (value: string, locale: string = "pt-BR"): number => {
  if (!value || typeof value !== "string") return 0;

  let cleanValue = value.trim();

  if (locale === "pt-BR") {
    // Brazilian format: 1.234.567,89
    cleanValue = cleanValue
      .replace(/\./g, "") // Remove thousands separators
      .replace(",", "."); // Replace decimal comma with dot
  } else {
    // US format: 1,234,567.89
    cleanValue = cleanValue.replace(/,/g, ""); // Remove thousands separators
  }

  const number = parseFloat(cleanValue);
  return isNaN(number) ? 0 : number;
};

export const parseInteger = (value: string): number => {
  const number = parseInt(value, 10);
  return isNaN(number) ? 0 : number;
};

export const parsePercentage = (value: string): number => {
  const cleanValue = value.replace("%", "").trim();
  const number = parseNumber(cleanValue);
  return number;
};

// =====================
// Mathematical Operations
// =====================

export const roundToDecimals = (value: number, decimals: number = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

export const ceilToDecimals = (value: number, decimals: number = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.ceil(value * factor) / factor;
};

export const floorToDecimals = (value: number, decimals: number = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
};

export const calculatePercentage = (value: number, total: number): number => {
  if (total === 0) return 0;
  return roundToDecimals((value / total) * 100, 2);
};

export const calculatePercentageChange = (oldValue: number, newValue: number): number => {
  if (oldValue === 0) return newValue > 0 ? 100 : 0;
  return roundToDecimals(((newValue - oldValue) / oldValue) * 100, 2);
};

export const calculateAverage = (numbers: number[]): number => {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, num) => acc + num, 0);
  return roundToDecimals(sum / numbers.length, 2);
};

export const calculateMedian = (numbers: number[]): number => {
  if (numbers.length === 0) return 0;

  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
};

export const calculateSum = (numbers: number[]): number => {
  return numbers.reduce((acc, num) => acc + num, 0);
};

export const calculateMin = (numbers: number[]): number => {
  return Math.min(...numbers);
};

export const calculateMax = (numbers: number[]): number => {
  return Math.max(...numbers);
};

export const calculateRange = (numbers: number[]): { min: number; max: number; range: number } => {
  const min = calculateMin(numbers);
  const max = calculateMax(numbers);
  return { min, max, range: max - min };
};

// =====================
// Financial Calculations
// =====================

export const calculateTax = (value: number, taxRate: number): number => {
  return roundToDecimals(value * (taxRate / 100), 2);
};

export const calculateWithTax = (value: number, taxRate: number): number => {
  return roundToDecimals(value * (1 + taxRate / 100), 2);
};

export const calculateWithoutTax = (valueWithTax: number, taxRate: number): number => {
  return roundToDecimals(valueWithTax / (1 + taxRate / 100), 2);
};

export const calculateDiscount = (originalValue: number, discountPercentage: number): number => {
  return roundToDecimals(originalValue * (discountPercentage / 100), 2);
};

export const calculateDiscountedValue = (originalValue: number, discountPercentage: number): number => {
  return roundToDecimals(originalValue * (1 - discountPercentage / 100), 2);
};

export const calculateMarkup = (cost: number, markupPercentage: number): number => {
  return roundToDecimals(cost * (markupPercentage / 100), 2);
};

export const calculateSellingPrice = (cost: number, markupPercentage: number): number => {
  return roundToDecimals(cost * (1 + markupPercentage / 100), 2);
};

export const calculateProfit = (sellingPrice: number, cost: number): number => {
  return roundToDecimals(sellingPrice - cost, 2);
};

export const calculateProfitMargin = (sellingPrice: number, cost: number): number => {
  if (sellingPrice === 0) return 0;
  const profit = calculateProfit(sellingPrice, cost);
  return roundToDecimals((profit / sellingPrice) * 100, 2);
};

export const calculateMarkupFromMargin = (marginPercentage: number): number => {
  if (marginPercentage >= 100) return Infinity;
  return roundToDecimals((marginPercentage / (100 - marginPercentage)) * 100, 2);
};

export const calculateMarginFromMarkup = (markupPercentage: number): number => {
  return roundToDecimals((markupPercentage / (100 + markupPercentage)) * 100, 2);
};

// =====================
// Interest Calculations
// =====================

export const calculateSimpleInterest = (principal: number, rate: number, time: number): number => {
  return roundToDecimals(principal * (rate / 100) * time, 2);
};

export const calculateCompoundInterest = (principal: number, rate: number, time: number, compoundingFrequency: number = 1): number => {
  const amount = principal * Math.pow(1 + rate / 100 / compoundingFrequency, compoundingFrequency * time);
  return roundToDecimals(amount - principal, 2);
};

export const calculateMonthlyPayment = (principal: number, annualRate: number, years: number): number => {
  const monthlyRate = annualRate / 100 / 12;
  const numberOfPayments = years * 12;

  if (monthlyRate === 0) {
    return principal / numberOfPayments;
  }

  const payment = (principal * (monthlyRate * Math.pow(1 + monthlyRate, numberOfPayments))) / (Math.pow(1 + monthlyRate, numberOfPayments) - 1);

  return roundToDecimals(payment, 2);
};

// =====================
// Statistical Functions
// =====================

export const calculateStandardDeviation = (numbers: number[]): number => {
  if (numbers.length === 0) return 0;

  const avg = calculateAverage(numbers);
  const squaredDifferences = numbers.map((num) => Math.pow(num - avg, 2));
  const avgSquaredDiff = calculateAverage(squaredDifferences);

  return roundToDecimals(Math.sqrt(avgSquaredDiff), 2);
};

export const calculateVariance = (numbers: number[]): number => {
  const stdDev = calculateStandardDeviation(numbers);
  return roundToDecimals(Math.pow(stdDev, 2), 2);
};

export const calculateZScore = (value: number, mean: number, standardDeviation: number): number => {
  if (standardDeviation === 0) return 0;
  return roundToDecimals((value - mean) / standardDeviation, 2);
};

export const calculatePercentile = (numbers: number[], percentile: number): number => {
  if (numbers.length === 0) return 0;

  const sorted = [...numbers].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);

  if (Number.isInteger(index)) {
    return sorted[index];
  }

  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

// =====================
// Number Sequences
// =====================

export const generateRange = (start: number, end: number, step: number = 1): number[] => {
  const range: number[] = [];

  if (step > 0) {
    for (let i = start; i <= end; i += step) {
      range.push(i);
    }
  } else if (step < 0) {
    for (let i = start; i >= end; i += step) {
      range.push(i);
    }
  }

  return range;
};

export const generateArithmeticSequence = (firstTerm: number, commonDifference: number, numberOfTerms: number): number[] => {
  const sequence: number[] = [];

  for (let i = 0; i < numberOfTerms; i++) {
    sequence.push(firstTerm + i * commonDifference);
  }

  return sequence;
};

export const generateGeometricSequence = (firstTerm: number, commonRatio: number, numberOfTerms: number): number[] => {
  const sequence: number[] = [];

  for (let i = 0; i < numberOfTerms; i++) {
    sequence.push(firstTerm * Math.pow(commonRatio, i));
  }

  return sequence;
};

// =====================
// Utility Functions
// =====================

export const randomBetween = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

export const randomIntBetween = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const fibonacci = (n: number): number => {
  if (n <= 1) return n;

  let a = 0,
    b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }

  return b;
};

export const factorial = (n: number): number => {
  if (n <= 1) return 1;

  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
};

export const gcd = (a: number, b: number): number => {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return Math.abs(a);
};

export const lcm = (a: number, b: number): number => {
  return Math.abs(a * b) / gcd(a, b);
};

// =====================
// Export all utilities
// =====================

export const numberUtils = {
  // Currency
  formatCurrency,
  formatCurrencyCompact,
  formatCurrencyWithoutSymbol,
  parseCurrency,

  // Number formatting
  formatNumber,
  formatNumberWithDecimals,
  formatPercentage,
  formatNumberCompact,
  formatOrdinal,

  // Validation
  isValidNumber,
  isPositiveNumber,
  isNegativeNumber,
  isInteger,
  isInRange,
  validateNumberRange,
  // Parsing
  parseNumber,
  parseInteger,
  parsePercentage,

  // Math operations
  roundToDecimals,
  ceilToDecimals,
  floorToDecimals,

  calculatePercentage,
  calculatePercentageChange,
  calculateAverage,
  calculateMedian,
  calculateSum,
  calculateMin,
  calculateMax,
  calculateRange,

  // Financial
  calculateTax,
  calculateWithTax,
  calculateWithoutTax,
  calculateDiscount,
  calculateDiscountedValue,
  calculateMarkup,
  calculateSellingPrice,
  calculateProfit,
  calculateProfitMargin,
  calculateMarkupFromMargin,
  calculateMarginFromMarkup,

  // Interest
  calculateSimpleInterest,
  calculateCompoundInterest,
  calculateMonthlyPayment,

  // Statistics
  calculateStandardDeviation,
  calculateVariance,
  calculateZScore,
  calculatePercentile,

  // Sequences
  generateRange,
  generateArithmeticSequence,
  generateGeometricSequence,

  // Utilities
  randomBetween,
  randomIntBetween,
  fibonacci,
  factorial,
  gcd,
  lcm,
};
