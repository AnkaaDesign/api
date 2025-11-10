// packages/utils/src/measure.ts

import { MEASURE_UNIT, MEASURE_UNIT_LABELS } from '@constants';
import { formatNumber, roundToDecimals } from "./number";

// =====================
// Types and Interfaces
// =====================

export interface MeasureValue {
  value: number;
  unit: MEASURE_UNIT;
}

export interface MeasureConversionError {
  success: false;
  error: string;
}

export interface MeasureConversionSuccess {
  success: true;
  value: number;
  unit: MEASURE_UNIT;
}

export type MeasureConversionResult = MeasureConversionSuccess | MeasureConversionError;

export interface DensityCalculation {
  density: number;
  unit: string; // e.g., "kg/l", "g/ml"
}

export interface DensityCalculationError {
  success: false;
  error: string;
}

export interface DensityCalculationSuccess extends DensityCalculation {
  success: true;
}

export type DensityCalculationResult = DensityCalculationSuccess | DensityCalculationError;

// =====================
// Unit Categories
// =====================

export const WEIGHT_UNITS = [MEASURE_UNIT.GRAM, MEASURE_UNIT.KILOGRAM] as const;
export const VOLUME_UNITS = [MEASURE_UNIT.MILLILITER, MEASURE_UNIT.LITER] as const;
export const LENGTH_UNITS = [MEASURE_UNIT.MILLIMETER, MEASURE_UNIT.CENTIMETER, MEASURE_UNIT.METER] as const;
export const WIDTH_UNITS = [MEASURE_UNIT.MILLIMETER, MEASURE_UNIT.CENTIMETER, MEASURE_UNIT.METER] as const;
export const COUNT_UNITS = [MEASURE_UNIT.UNIT, MEASURE_UNIT.PAIR, MEASURE_UNIT.DOZEN, MEASURE_UNIT.HUNDRED, MEASURE_UNIT.THOUSAND] as const;
export const PACKAGING_UNITS = [MEASURE_UNIT.PACKAGE, MEASURE_UNIT.BOX, MEASURE_UNIT.ROLL, MEASURE_UNIT.SHEET, MEASURE_UNIT.SET] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number];
export type VolumeUnit = (typeof VOLUME_UNITS)[number];
export type LengthUnit = (typeof LENGTH_UNITS)[number];
export type WidthUnit = (typeof WIDTH_UNITS)[number];
export type CountUnit = (typeof COUNT_UNITS)[number];
export type PackagingUnit = (typeof PACKAGING_UNITS)[number];

// =====================
// Unit Conversion Constants
// =====================

// Weight conversions (base: grams)
const WEIGHT_CONVERSIONS = {
  [MEASURE_UNIT.GRAM]: 1,
  [MEASURE_UNIT.KILOGRAM]: 1000,
} as const;

// Volume conversions (base: milliliters)
const VOLUME_CONVERSIONS = {
  [MEASURE_UNIT.MILLILITER]: 1,
  [MEASURE_UNIT.LITER]: 1000,
} as const;

// Length conversions (base: millimeters)
const LENGTH_CONVERSIONS = {
  [MEASURE_UNIT.MILLIMETER]: 1,
  [MEASURE_UNIT.CENTIMETER]: 10,
  [MEASURE_UNIT.METER]: 1000,
  // Adding inch conversion (1 inch = 25.4 mm)
  INCH: 25.4,
} as const;

// Width conversions (base: millimeters) - same as length
const WIDTH_CONVERSIONS = {
  [MEASURE_UNIT.MILLIMETER]: 1,
  [MEASURE_UNIT.CENTIMETER]: 10,
  [MEASURE_UNIT.METER]: 1000,
  // Adding inch conversion (1 inch = 25.4 mm)
  INCH: 25.4,
} as const;

// Count conversions (base: units)
const COUNT_CONVERSIONS = {
  [MEASURE_UNIT.UNIT]: 1,
  [MEASURE_UNIT.PAIR]: 2,
  [MEASURE_UNIT.DOZEN]: 12,
  [MEASURE_UNIT.HUNDRED]: 100,
  [MEASURE_UNIT.THOUSAND]: 1000,
} as const;

// =====================
// Helper Functions
// =====================

export function isWeightUnit(unit: MEASURE_UNIT): unit is WeightUnit {
  return WEIGHT_UNITS.includes(unit as WeightUnit);
}

export function isVolumeUnit(unit: MEASURE_UNIT): unit is VolumeUnit {
  return VOLUME_UNITS.includes(unit as VolumeUnit);
}

export function isLengthUnit(unit: MEASURE_UNIT): unit is LengthUnit {
  return LENGTH_UNITS.includes(unit as LengthUnit);
}

export function isWidthUnit(unit: MEASURE_UNIT): unit is WidthUnit {
  return WIDTH_UNITS.includes(unit as WidthUnit);
}

export function isCountUnit(unit: MEASURE_UNIT): unit is CountUnit {
  return COUNT_UNITS.includes(unit as CountUnit);
}

export function isPackagingUnit(unit: MEASURE_UNIT): unit is PackagingUnit {
  return PACKAGING_UNITS.includes(unit as PackagingUnit);
}

export function getUnitCategory(unit: MEASURE_UNIT): string {
  if (isWeightUnit(unit)) return "weight";
  if (isVolumeUnit(unit)) return "volume";
  if (isLengthUnit(unit)) return "length";
  if (isWidthUnit(unit)) return "width";
  if (isCountUnit(unit)) return "count";
  if (isPackagingUnit(unit)) return "packaging";
  return "unknown";
}

export function areUnitsCompatible(fromUnit: MEASURE_UNIT, toUnit: MEASURE_UNIT): boolean {
  const fromCategory = getUnitCategory(fromUnit);
  const toCategory = getUnitCategory(toUnit);
  return fromCategory === toCategory && fromCategory !== "unknown" && fromCategory !== "packaging";
}

// =====================
// Main Conversion Function
// =====================

/**
 * Converts a value from one unit to another
 * Supports weight, volume, length, and count conversions
 * Also supports inches for length measurements
 */
export function convertUnits(value: number, fromUnit: MEASURE_UNIT | "INCH", toUnit: MEASURE_UNIT | "INCH"): MeasureConversionResult {
  if (value < 0) {
    return {
      success: false,
      error: "Valor não pode ser negativo",
    };
  }

  if (fromUnit === toUnit) {
    return {
      success: true,
      value: roundToDecimals(value, 4),
      unit: toUnit as MEASURE_UNIT,
    };
  }

  // Handle inch conversions for length
  if (fromUnit === "INCH" || toUnit === "INCH") {
    return convertWithInches(value, fromUnit, toUnit);
  }

  // Standard unit conversions
  if (!areUnitsCompatible(fromUnit as MEASURE_UNIT, toUnit as MEASURE_UNIT)) {
    return {
      success: false,
      error: `Não é possível converter de ${MEASURE_UNIT_LABELS[fromUnit as MEASURE_UNIT] || fromUnit} para ${MEASURE_UNIT_LABELS[toUnit as MEASURE_UNIT] || toUnit}`,
    };
  }

  let convertedValue: number;

  // Weight conversions
  if (isWeightUnit(fromUnit as MEASURE_UNIT) && isWeightUnit(toUnit as MEASURE_UNIT)) {
    const baseValue = value * WEIGHT_CONVERSIONS[fromUnit as WeightUnit];
    convertedValue = baseValue / WEIGHT_CONVERSIONS[toUnit as WeightUnit];
  }
  // Volume conversions
  else if (isVolumeUnit(fromUnit as MEASURE_UNIT) && isVolumeUnit(toUnit as MEASURE_UNIT)) {
    const baseValue = value * VOLUME_CONVERSIONS[fromUnit as VolumeUnit];
    convertedValue = baseValue / VOLUME_CONVERSIONS[toUnit as VolumeUnit];
  }
  // Length conversions
  else if (isLengthUnit(fromUnit as MEASURE_UNIT) && isLengthUnit(toUnit as MEASURE_UNIT)) {
    const baseValue = value * LENGTH_CONVERSIONS[fromUnit as LengthUnit];
    convertedValue = baseValue / LENGTH_CONVERSIONS[toUnit as LengthUnit];
  }
  // Width conversions (same as length)
  else if (isWidthUnit(fromUnit as MEASURE_UNIT) && isWidthUnit(toUnit as MEASURE_UNIT)) {
    const baseValue = value * WIDTH_CONVERSIONS[fromUnit as WidthUnit];
    convertedValue = baseValue / WIDTH_CONVERSIONS[toUnit as WidthUnit];
  }
  // Count conversions
  else if (isCountUnit(fromUnit as MEASURE_UNIT) && isCountUnit(toUnit as MEASURE_UNIT)) {
    const baseValue = value * COUNT_CONVERSIONS[fromUnit as CountUnit];
    convertedValue = baseValue / COUNT_CONVERSIONS[toUnit as CountUnit];
  } else {
    return {
      success: false,
      error: "Conversão não suportada",
    };
  }

  return {
    success: true,
    value: roundToDecimals(convertedValue, 4),
    unit: toUnit as MEASURE_UNIT,
  };
}

/**
 * Helper function to handle inch conversions
 */
function convertWithInches(value: number, fromUnit: MEASURE_UNIT | "INCH", toUnit: MEASURE_UNIT | "INCH"): MeasureConversionResult {
  // Convert from inches to metric
  if (fromUnit === "INCH") {
    const mmValue = value * LENGTH_CONVERSIONS.INCH;
    if (toUnit === MEASURE_UNIT.MILLIMETER) {
      return { success: true, value: roundToDecimals(mmValue, 4), unit: MEASURE_UNIT.MILLIMETER };
    }
    if (toUnit === MEASURE_UNIT.CENTIMETER) {
      return { success: true, value: roundToDecimals(mmValue / 10, 4), unit: MEASURE_UNIT.CENTIMETER };
    }
    if (toUnit === MEASURE_UNIT.METER) {
      return { success: true, value: roundToDecimals(mmValue / 1000, 4), unit: MEASURE_UNIT.METER };
    }
  }

  // Convert from metric to inches
  if (toUnit === "INCH") {
    let mmValue: number;
    if (fromUnit === MEASURE_UNIT.MILLIMETER) {
      mmValue = value;
    } else if (fromUnit === MEASURE_UNIT.CENTIMETER) {
      mmValue = value * 10;
    } else if (fromUnit === MEASURE_UNIT.METER) {
      mmValue = value * 1000;
    } else {
      return {
        success: false,
        error: `Não é possível converter de ${fromUnit} para polegadas`,
      };
    }

    const inchValue = mmValue / LENGTH_CONVERSIONS.INCH;
    return { success: true, value: roundToDecimals(inchValue, 4), unit: "INCH" as MEASURE_UNIT };
  }

  return {
    success: false,
    error: "Conversão com polegadas não suportada",
  };
}

// =====================
// Density Calculations
// =====================

/**
 * Calculates density from weight and volume measures
 * Used for paint formulas and material specifications
 */
export function calculateDensity(weightMeasure: MeasureValue, volumeMeasure: MeasureValue): DensityCalculationResult {
  if (!isWeightUnit(weightMeasure.unit)) {
    return {
      success: false,
      error: "Medida de peso deve usar unidade de peso (g ou kg)",
    };
  }

  if (!isVolumeUnit(volumeMeasure.unit)) {
    return {
      success: false,
      error: "Medida de volume deve usar unidade de volume (ml ou l)",
    };
  }

  if (volumeMeasure.value <= 0) {
    return {
      success: false,
      error: "Volume deve ser maior que zero",
    };
  }

  if (weightMeasure.value <= 0) {
    return {
      success: false,
      error: "Peso deve ser maior que zero",
    };
  }

  // Convert to standard units for density calculation
  const weightResult = convertUnits(weightMeasure.value, weightMeasure.unit, MEASURE_UNIT.KILOGRAM);
  const volumeResult = convertUnits(volumeMeasure.value, volumeMeasure.unit, MEASURE_UNIT.LITER);

  if (!weightResult.success) {
    return {
      success: false,
      error: `Erro na conversão de peso: ${(weightResult as MeasureConversionError).error}`,
    };
  }

  if (!volumeResult.success) {
    return {
      success: false,
      error: `Erro na conversão de volume: ${(volumeResult as MeasureConversionError).error}`,
    };
  }

  const density = weightResult.value / volumeResult.value;

  return {
    success: true,
    density: roundToDecimals(density, 4),
    unit: "kg/l",
  };
}

/**
 * Calculate density in grams per milliliter (common for paint formulas)
 */
export function calculateDensityInGramsMl(weightMeasure: MeasureValue, volumeMeasure: MeasureValue): DensityCalculationResult {
  if (!isWeightUnit(weightMeasure.unit)) {
    return {
      success: false,
      error: "Medida de peso deve usar unidade de peso (g ou kg)",
    };
  }

  if (!isVolumeUnit(volumeMeasure.unit)) {
    return {
      success: false,
      error: "Medida de volume deve usar unidade de volume (ml ou l)",
    };
  }

  if (volumeMeasure.value <= 0 || weightMeasure.value <= 0) {
    return {
      success: false,
      error: "Peso e volume devem ser maiores que zero",
    };
  }

  // Convert to grams and milliliters
  const weightResult = convertUnits(weightMeasure.value, weightMeasure.unit, MEASURE_UNIT.GRAM);
  const volumeResult = convertUnits(volumeMeasure.value, volumeMeasure.unit, MEASURE_UNIT.MILLILITER);

  if (!weightResult.success || !volumeResult.success) {
    return {
      success: false,
      error: "Erro na conversão de unidades",
    };
  }

  const density = weightResult.value / volumeResult.value;

  return {
    success: true,
    density: roundToDecimals(density, 4),
    unit: "g/ml",
  };
}

// =====================
// Measure Helper Functions
// =====================

/**
 * Helper to find a specific measure type from an array of measures
 * Useful when working with items that have multiple measurements
 */
export function getMeasureByType(measures: MeasureValue[], type: "weight" | "volume" | "length" | "width" | "count"): MeasureValue | null {
  return measures.find((measure) => getUnitCategory(measure.unit) === type) || null;
}

/**
 * Get the primary measure from an item's measureValue and measureUnit
 */
export function getPrimaryMeasure(measureValue: number | null, measureUnit: MEASURE_UNIT | null): MeasureValue | null {
  if (measureValue === null || measureUnit === null) {
    return null;
  }

  return {
    value: measureValue,
    unit: measureUnit,
  };
}

/**
 * Format a measure value with Brazilian conventions
 */
export function formatMeasure(measure: MeasureValue, includeUnit: boolean = true, decimals: number = 2): string {
  const formattedValue = formatNumber(roundToDecimals(measure.value, decimals));

  if (!includeUnit) {
    return formattedValue;
  }

  const unitLabel = MEASURE_UNIT_LABELS[measure.unit];
  return `${formattedValue} ${unitLabel}`;
}

/**
 * Format measure with full unit name (for reports and detailed views)
 */
export function formatMeasureVerbose(measure: MeasureValue, decimals: number = 2): string {
  const formattedValue = formatNumber(roundToDecimals(measure.value, decimals));

  let unitName = "";
  switch (measure.unit) {
    case MEASURE_UNIT.GRAM:
      unitName = measure.value === 1 ? "grama" : "gramas";
      break;
    case MEASURE_UNIT.KILOGRAM:
      unitName = measure.value === 1 ? "quilograma" : "quilogramas";
      break;
    case MEASURE_UNIT.MILLILITER:
      unitName = measure.value === 1 ? "mililitro" : "mililitros";
      break;
    case MEASURE_UNIT.LITER:
      unitName = measure.value === 1 ? "litro" : "litros";
      break;
    case MEASURE_UNIT.MILLIMETER:
      unitName = measure.value === 1 ? "milímetro" : "milímetros";
      break;
    case MEASURE_UNIT.CENTIMETER:
      unitName = measure.value === 1 ? "centímetro" : "centímetros";
      break;
    case MEASURE_UNIT.METER:
      unitName = measure.value === 1 ? "metro" : "metros";
      break;
    case MEASURE_UNIT.UNIT:
      unitName = measure.value === 1 ? "unidade" : "unidades";
      break;
    case MEASURE_UNIT.PAIR:
      unitName = measure.value === 1 ? "par" : "pares";
      break;
    case MEASURE_UNIT.DOZEN:
      unitName = measure.value === 1 ? "dúzia" : "dúzias";
      break;
    case MEASURE_UNIT.HUNDRED:
      unitName = measure.value === 1 ? "centena" : "centenas";
      break;
    case MEASURE_UNIT.THOUSAND:
      unitName = measure.value === 1 ? "milhar" : "milhares";
      break;
    default:
      unitName = MEASURE_UNIT_LABELS[measure.unit];
  }

  return `${formattedValue} ${unitName}`;
}

// =====================
// Validation Functions
// =====================

/**
 * Validate that two measures can be used together for density calculations
 */
export function validateDensityMeasures(weightMeasure: MeasureValue, volumeMeasure: MeasureValue): { valid: boolean; error?: string } {
  if (!isWeightUnit(weightMeasure.unit)) {
    return {
      valid: false,
      error: "Para calcular densidade, a primeira medida deve ser de peso (g ou kg)",
    };
  }

  if (!isVolumeUnit(volumeMeasure.unit)) {
    return {
      valid: false,
      error: "Para calcular densidade, a segunda medida deve ser de volume (ml ou l)",
    };
  }

  if (weightMeasure.value <= 0) {
    return {
      valid: false,
      error: "O peso deve ser maior que zero",
    };
  }

  if (volumeMeasure.value <= 0) {
    return {
      valid: false,
      error: "O volume deve ser maior que zero",
    };
  }

  return { valid: true };
}

/**
 * Validate measure combinations for specific use cases
 */
export function validateMeasureCombination(
  measures: MeasureValue[],
  requiredTypes: Array<"weight" | "volume" | "length" | "width" | "count">,
): { valid: boolean; error?: string; missing?: string[] } {
  const availableTypes = measures.map((m) => getUnitCategory(m.unit));
  const missing = requiredTypes.filter((type) => !availableTypes.includes(type));

  if (missing.length > 0) {
    const missingLabels = missing.map((type) => {
      switch (type) {
        case "weight":
          return "peso";
        case "volume":
          return "volume";
        case "length":
          return "comprimento";
        case "width":
          return "largura";
        case "count":
          return "quantidade";
        default:
          return type;
      }
    });

    return {
      valid: false,
      error: `Medidas obrigatórias faltando: ${missingLabels.join(", ")}`,
      missing: missingLabels,
    };
  }

  return { valid: true };
}

/**
 * Check if a measure value is within reasonable bounds for its unit
 */
export function validateMeasureRange(measure: MeasureValue): { valid: boolean; error?: string } {
  if (measure.value < 0) {
    return {
      valid: false,
      error: "Valor da medida não pode ser negativo",
    };
  }

  // Set reasonable maximum bounds for each unit type
  const maxValues: Partial<Record<MEASURE_UNIT, number>> = {
    // Weight units
    [MEASURE_UNIT.GRAM]: 1000000, // 1 ton in grams
    [MEASURE_UNIT.KILOGRAM]: 1000, // 1 ton

    // Volume units
    [MEASURE_UNIT.MILLILITER]: 1000000, // 1000 liters in ml
    [MEASURE_UNIT.LITER]: 1000, // 1000 liters
    [MEASURE_UNIT.CUBIC_CENTIMETER]: 1000000, // 1 cubic meter in cm³
    [MEASURE_UNIT.CUBIC_METER]: 1000, // 1000 cubic meters

    // Length units
    [MEASURE_UNIT.MILLIMETER]: 1000000, // 1 km in mm
    [MEASURE_UNIT.CENTIMETER]: 100000, // 1 km in cm
    [MEASURE_UNIT.METER]: 1000, // 1 km
    [MEASURE_UNIT.INCHES]: 40000, // ~1 km in inches

    // Thread pitch units
    [MEASURE_UNIT.THREAD_MM]: 100,
    [MEASURE_UNIT.THREAD_TPI]: 100,

    // Electrical units
    [MEASURE_UNIT.WATT]: 1000000,
    [MEASURE_UNIT.VOLT]: 10000,
    [MEASURE_UNIT.AMPERE]: 10000,

    // Area units
    [MEASURE_UNIT.SQUARE_CENTIMETER]: 1000000,
    [MEASURE_UNIT.SQUARE_METER]: 1000000,

    // Count and packaging units
    [MEASURE_UNIT.UNIT]: 1000000,
    [MEASURE_UNIT.PAIR]: 500000,
    [MEASURE_UNIT.DOZEN]: 100000,
    [MEASURE_UNIT.HUNDRED]: 10000,
    [MEASURE_UNIT.THOUSAND]: 1000,
    [MEASURE_UNIT.PACKAGE]: 10000,
    [MEASURE_UNIT.BOX]: 1000,
    [MEASURE_UNIT.ROLL]: 1000,
    [MEASURE_UNIT.SHEET]: 10000,
    [MEASURE_UNIT.SET]: 1000,
    [MEASURE_UNIT.SACK]: 1000,

    // PPE Size units
    [MEASURE_UNIT.P]: 10000,
    [MEASURE_UNIT.M]: 10000,
    [MEASURE_UNIT.G]: 10000,
    [MEASURE_UNIT.GG]: 10000,
    [MEASURE_UNIT.XG]: 10000,
  };

  const maxValue = maxValues[measure.unit];
  if (maxValue && measure.value > maxValue) {
    return {
      valid: false,
      error: `Valor muito alto para a unidade ${MEASURE_UNIT_LABELS[measure.unit]}. Máximo: ${formatNumber(maxValue)}`,
    };
  }

  return { valid: true };
}

// =====================
// Export utilities
// =====================

export const measureUtils = {
  // Conversion
  convertUnits,
  areUnitsCompatible,

  // Density calculations
  calculateDensity,
  calculateDensityInGramsMl,

  // Helpers
  getMeasureByType,
  getPrimaryMeasure,
  getUnitCategory,

  // Formatting
  formatMeasure,
  formatMeasureVerbose,

  // Validation
  validateDensityMeasures,
  validateMeasureCombination,
  validateMeasureRange,

  // Type checks
  isWeightUnit,
  isVolumeUnit,
  isLengthUnit,
  isWidthUnit,
  isCountUnit,
  isPackagingUnit,
};
