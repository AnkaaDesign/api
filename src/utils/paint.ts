import ColorJS from 'colorjs.io';
import type { Paint, PaintFormula, PaintFormulaComponent, Item } from '@types';
import { PAINT_FINISH_LABELS, MEASURE_UNIT, MEASURE_TYPE } from '@constants';
import { PAINT_FINISH } from '@constants';

// =====================
// Helper functions for measures array
// =====================

/**
 * Get a measure of specific type from item's measures array
 */
export const getItemMeasureByType = (
  item: Item,
  measureType: MEASURE_TYPE,
): { value: number; unit: MEASURE_UNIT } | null => {
  if (!item.measures || item.measures.length === 0) {
    return null;
  }

  const measure = item.measures.find(m => m.measureType === measureType);
  if (!measure || measure.value === null || measure.unit === null) {
    return null;
  }
  return { value: measure.value, unit: measure.unit };
};

/**
 * Get any measure from item's measures array (fallback to first measure)
 */
export const getAnyMeasure = (item: Item): { value: number; unit: MEASURE_UNIT } | null => {
  if (!item.measures || item.measures.length === 0) {
    return null;
  }

  // Find the first measure with both value and unit
  const measure = item.measures.find(m => m.value !== null && m.unit !== null);
  if (!measure) {
    return null;
  }
  return { value: measure.value!, unit: measure.unit! };
};

export function isColorDark(hex: string): boolean {
  // Strip leading “#” and normalise 3-digit to 6-digit form
  let clean = hex.replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map(ch => ch + ch)
      .join('');
  }

  if (!/^[0-9a-f]{6}$/i.test(clean)) {
    throw new Error(`Invalid hex colour: ${hex}`);
  }

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  // YIQ perceived brightness formula
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness <= 128;
}

export function shadeColor(hex: string, percent: number): string {
  let color = hex.replace(/[^0-9a-f]/gi, '');
  if (color.length < 6) {
    color = color[0] + color[0] + color[1] + color[1] + color[2] + color[2];
  }

  const num = parseInt(color, 16);
  if (Number.isNaN(num)) return hex;

  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;

  r = Math.min(255, Math.max(0, r + (r * percent) / 100));
  g = Math.min(255, Math.max(0, g + (g * percent) / 100));
  b = Math.min(255, Math.max(0, b + (b * percent) / 100));

  return `#${(0x1000000 + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1)}`;
}

export function findSimilarColors(paints: Paint[], hex: string, threshold: number) {
  try {
    const refColor = new ColorJS(hex);

    const similarColors = paints.map(color => {
      const newColor = new ColorJS(color.hex);
      const difference = newColor.deltaE(refColor, '2000') + newColor.deltaE(refColor, '76') / 2;
      return { color, difference };
    });

    const filteredColors = similarColors.filter(({ difference }) => difference <= threshold);

    filteredColors.sort((a, b) => a.difference - b.difference);

    const data = filteredColors.map(({ color }) => color);
    const total = data.length;

    return { data, total };
  } catch (error) {
    console.error('Error finding similar colors:', error);
    return { data: [], total: 0 };
  }
}

export const formatPaintName = (paint: Paint): string => {
  const brandName = paint.paintBrand?.name || 'N/A';
  return `${paint.name} - ${brandName}`;
};

export const getPaintDisplayName = (paint: Paint): string => {
  const brandName = paint.paintBrand?.name || 'N/A';
  if (paint.manufacturer && paint.manufacturer !== brandName) {
    return `${paint.name} (${brandName} - ${paint.manufacturer})`;
  }
  return `${paint.name} (${brandName})`;
};

export const calculateFormulaComponentTotal = (components: Array<{ ratio: number }>): number => {
  return components.reduce((total, component) => total + component.ratio, 0);
};

/**
 * Calculate formula component total with unit conversion support
 * Useful when components have different units that need to be normalized
 */
export const calculateFormulaComponentTotalWithUnits = (
  components: Array<{ quantity: number; unit?: string }>,
  targetUnit?: string,
): { total: number; unit?: string; error?: string } => {
  if (components.length === 0) {
    return { total: 0 };
  }

  // Simple sum for quantity-based components (legacy function)
  const total = components.reduce((sum, component) => sum + component.quantity, 0);

  // If no units specified, fall back to simple sum
  if (!components.some(c => c.unit) || !targetUnit) {
    return {
      total,
      unit: targetUnit,
    };
  }

  // This would require measure utilities, but we'll keep it simple for now
  // In future implementations, this could use convertUnits from measure.ts
  return {
    total,
    unit: targetUnit,
    error: 'Conversão de unidades não implementada - use measure.convertUnits()',
  };
};

export const hasValidFormula = (paint: Paint): boolean => {
  return !!(paint.formulas && paint.formulas.length > 0);
};

// Paint type is now managed as a model in the database
// Use PaintType.name for the label

/**
 * Get human-readable label for paint finish
 */
export function getPaintFinishLabel(finish: PAINT_FINISH): string {
  return PAINT_FINISH_LABELS[finish] || finish;
}

// =====================
// Weight/Volume Calculation Utilities
// =====================

/**
 * Categorizes measure units by their type
 */
export const getMeasureType = (unit: MEASURE_UNIT): MEASURE_TYPE => {
  switch (unit) {
    case MEASURE_UNIT.GRAM:
    case MEASURE_UNIT.KILOGRAM:
      return MEASURE_TYPE.WEIGHT;
    case MEASURE_UNIT.MILLILITER:
    case MEASURE_UNIT.LITER:
      return MEASURE_TYPE.VOLUME;
    case MEASURE_UNIT.METER:
    case MEASURE_UNIT.CENTIMETER:
    case MEASURE_UNIT.MILLIMETER:
    case MEASURE_UNIT.INCHES:
      return MEASURE_TYPE.LENGTH;
    default:
      return MEASURE_TYPE.COUNT;
  }
};

/**
 * Converts weight values to grams (base weight unit)
 */
export const convertToGrams = (value: number, unit: MEASURE_UNIT): number => {
  switch (unit) {
    case MEASURE_UNIT.KILOGRAM:
      return value * 1000;
    case MEASURE_UNIT.GRAM:
      return value;
    default:
      throw new Error(`Cannot convert ${unit} to grams`);
  }
};

/**
 * Converts volume values to milliliters (base volume unit)
 */
export const convertToMilliliters = (value: number, unit: MEASURE_UNIT): number => {
  switch (unit) {
    case MEASURE_UNIT.LITER:
      return value * 1000;
    case MEASURE_UNIT.MILLILITER:
      return value;
    default:
      throw new Error(`Cannot convert ${unit} to milliliters`);
  }
};

/**
 * Converts grams to specified weight unit
 */
export const convertFromGrams = (grams: number, targetUnit: MEASURE_UNIT): number => {
  switch (targetUnit) {
    case MEASURE_UNIT.KILOGRAM:
      return grams / 1000;
    case MEASURE_UNIT.GRAM:
      return grams;
    default:
      throw new Error(`Cannot convert grams to ${targetUnit}`);
  }
};

/**
 * Converts milliliters to specified volume unit
 */
export const convertFromMilliliters = (ml: number, targetUnit: MEASURE_UNIT): number => {
  switch (targetUnit) {
    case MEASURE_UNIT.LITER:
      return ml / 1000;
    case MEASURE_UNIT.MILLILITER:
      return ml;
    default:
      throw new Error(`Cannot convert milliliters to ${targetUnit}`);
  }
};

/**
 * Calculates density from weight and volume (g/ml)
 */
export const calculatePaintDensity = (weightInGrams: number, volumeInMl: number): number => {
  if (volumeInMl <= 0) {
    throw new Error('Volume must be positive for density calculation');
  }
  return weightInGrams / volumeInMl;
};

/**
 * Validates if a density value is within acceptable range for paint
 * Typical paint densities range from 0.5 to 3.0 g/ml
 */
export const isValidPaintDensity = (density: number): boolean => {
  return density >= 0.5 && density <= 3.0;
};

/**
 * Validates if a price per liter is within acceptable range for paint
 * Typical paint prices range from R$ 5 to R$ 1000 per liter
 */
export const isValidPaintPrice = (pricePerLiter: number): boolean => {
  return pricePerLiter >= 5 && pricePerLiter <= 1000;
};

/**
 * Calculate item density from weight and volume measures with unit conversion
 * Returns density in g/ml
 */
export const calculateItemDensity = (
  weightValue: number,
  weightUnit: MEASURE_UNIT,
  volumeValue: number,
  volumeUnit: MEASURE_UNIT,
): { density: number; weightInGrams: number; volumeInMl: number; error?: string } => {
  // Convert weight to grams
  let weightInGrams = weightValue;
  if (weightUnit === MEASURE_UNIT.KILOGRAM) {
    weightInGrams = weightValue * 1000;
  } else if (weightUnit !== MEASURE_UNIT.GRAM) {
    return {
      density: 0,
      weightInGrams: 0,
      volumeInMl: 0,
      error: `Invalid weight unit: ${weightUnit}. Must be GRAM or KILOGRAM.`,
    };
  }

  // Convert volume to milliliters
  let volumeInMl = volumeValue;
  if (volumeUnit === MEASURE_UNIT.LITER) {
    volumeInMl = volumeValue * 1000;
  } else if (volumeUnit !== MEASURE_UNIT.MILLILITER) {
    return {
      density: 0,
      weightInGrams: 0,
      volumeInMl: 0,
      error: `Invalid volume unit: ${volumeUnit}. Must be MILLILITER or LITER.`,
    };
  }

  // Validate positive values
  if (weightInGrams <= 0 || volumeInMl <= 0) {
    return {
      density: 0,
      weightInGrams,
      volumeInMl,
      error: `Weight and volume must be positive. Got weight: ${weightInGrams}g, volume: ${volumeInMl}ml`,
    };
  }

  // Calculate density
  const density = weightInGrams / volumeInMl;

  return {
    density,
    weightInGrams,
    volumeInMl,
  };
};

/**
 * Calculates volume from weight and density
 */
export const calculateVolumeFromWeight = (weightInGrams: number, densityGPerMl: number): number => {
  if (densityGPerMl <= 0) {
    throw new Error('Density must be positive for volume calculation');
  }
  return weightInGrams / densityGPerMl;
};

/**
 * Calculates weight from volume and density
 */
export const calculateWeightFromVolume = (volumeInMl: number, densityGPerMl: number): number => {
  if (densityGPerMl <= 0) {
    throw new Error('Density must be positive for weight calculation');
  }
  return volumeInMl * densityGPerMl;
};

/**
 * Gets the component quantity in grams for formula calculations
 * Handles different item measure units and weight specifications
 */
export const getComponentWeightInGrams = (
  component: PaintFormulaComponent & { item?: Item },
  totalWeightInGrams: number,
): number => {
  if (!component.item) {
    throw new Error('Component item is required for weight calculation');
  }

  // Calculate component weight based on ratio and total weight
  const componentWeight = (totalWeightInGrams * component.ratio) / 100;

  return componentWeight;
};

/**
 * Validates that a component can be used in paint formulas
 * Checks for proper measure units and weight/density information
 */
export const validateComponentForFormula = (
  component: PaintFormulaComponent & { item?: Item },
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!component.item) {
    errors.push('Component must have an associated item');
    return { isValid: false, errors };
  }

  const item = component.item;

  // Check for basic ratio validation
  if (component.ratio <= 0) {
    errors.push('Component ratio must be positive');
  }

  // Check if we can determine weight for this item
  const weightMeasure = getItemMeasureByType(item, MEASURE_TYPE.WEIGHT);
  if (weightMeasure) {
    // Weight-based items are always valid
    return { isValid: errors.length === 0, errors };
  }

  // Check if any measure can be used for weight calculation
  const anyMeasure = getAnyMeasure(item);
  if (anyMeasure) {
    const measureType = getMeasureType(anyMeasure.unit);

    if (measureType === MEASURE_TYPE.WEIGHT) {
      // Direct weight measure is valid
      return { isValid: errors.length === 0, errors };
    } else if (anyMeasure.value > 0) {
      // Items with measure values can potentially be used
      return { isValid: errors.length === 0, errors };
    } else if (measureType === MEASURE_TYPE.VOLUME) {
      // Volume-based items need density information
      errors.push(
        `Volume-based item "${item.name}" requires density information or weight specification`,
      );
    } else {
      // Count-based items need weight specification
      errors.push(`Count-based item "${item.name}" requires weight specification in its measures`);
    }
  } else {
    errors.push(
      `Item "${item.name}" has no measures defined. At least one measure is required for formula calculations.`,
    );
  }

  return { isValid: errors.length === 0, errors };
};

/**
 * Calculates total component weight for a formula (ratios should sum to 100%)
 */
export const calculateFormulaComponentWeight = (
  components: Array<PaintFormulaComponent & { item?: Item }>,
  totalWeightInGrams: number,
): number => {
  return components.reduce((total, component) => {
    try {
      return total + getComponentWeightInGrams(component, totalWeightInGrams);
    } catch (error) {
      throw new Error(`Error calculating weight for component: ${(error as Error).message}`);
    }
  }, 0);
};

/**
 * Calculates component ratios within a formula
 */
export const calculateComponentRatios = (
  components: Array<PaintFormulaComponent & { item?: Item }>,
): Array<{ componentId: string; weight: number; ratio: number }> => {
  // With the new ratio-based system, ratios are already stored in components
  // This function now just formats the existing data
  return components.map(component => ({
    componentId: component.id,
    weight: 0, // Weight depends on production batch size, not stored here
    ratio: component.ratio,
  }));
};

/**
 * Scales formula components for a target production weight
 */
export const scaleFormulaForProduction = (
  components: Array<PaintFormulaComponent & { item?: Item }>,
  targetWeightGrams: number,
): Array<{
  componentId: string;
  itemId: string;
  itemName: string;
  originalQuantity: number;
  scaledWeight: number;
  requiredQuantity: number;
  measureUnit: string;
}> => {
  const ratios = calculateComponentRatios(components);

  return components.map(component => {
    const ratio = ratios.find(r => r.componentId === component.id);
    if (!ratio) {
      throw new Error(`Component ratio not found for ${component.id}`);
    }

    const scaledWeight = targetWeightGrams * (ratio.ratio / 100);
    const item = component.item!;

    let requiredQuantity = scaledWeight; // Default in grams
    let measureUnit = 'GRAM'; // Default unit

    // Try to get the appropriate measure for this item
    const weightMeasure = getItemMeasureByType(item, MEASURE_TYPE.WEIGHT);
    if (weightMeasure) {
      // Convert to item's weight unit
      requiredQuantity = convertFromGrams(scaledWeight, weightMeasure.unit);
      measureUnit = weightMeasure.unit;
    } else {
      // If no weight measure, try any measure
      const anyMeasure = getAnyMeasure(item);
      if (anyMeasure) {
        const measureType = getMeasureType(anyMeasure.unit);
        if (measureType === MEASURE_TYPE.WEIGHT) {
          requiredQuantity = convertFromGrams(scaledWeight, anyMeasure.unit);
          measureUnit = anyMeasure.unit;
        } else if (anyMeasure.value > 0) {
          // For items with non-weight measures, we need to find the weight per unit
          // from the item's weight measure if available, otherwise use the measure value
          const itemWeightMeasure = item.measures?.find(m => m.measureType === MEASURE_TYPE.WEIGHT);
          if (
            itemWeightMeasure &&
            itemWeightMeasure.value !== null &&
            itemWeightMeasure.unit !== null
          ) {
            // Calculate number of units needed based on weight per unit
            const weightPerUnit =
              itemWeightMeasure.unit === MEASURE_UNIT.KILOGRAM
                ? itemWeightMeasure.value * 1000
                : itemWeightMeasure.value;
            requiredQuantity = scaledWeight / weightPerUnit;
            measureUnit = 'UNIT'; // Number of units
          } else {
            // Fallback: assume the measure value represents weight per unit in grams
            requiredQuantity = scaledWeight / anyMeasure.value;
            measureUnit = anyMeasure.unit;
          }
        }
      }
    }

    return {
      componentId: component.id,
      itemId: item.id,
      itemName: item.name,
      originalQuantity: component.ratio, // Ratio represents the proportion of this component
      scaledWeight,
      requiredQuantity,
      measureUnit,
    };
  });
};

/**
 * Validates formula density consistency
 * Checks if the calculated density from components matches the formula density
 */
export const validateFormulaDensity = (
  formula: PaintFormula & { components?: Array<PaintFormulaComponent & { item?: Item }> },
  tolerancePercent: number = 5,
): {
  isValid: boolean;
  calculatedDensity?: number;
  densityDifference?: number;
  errors: string[];
} => {
  const errors: string[] = [];

  if (!formula.components || formula.components.length === 0) {
    errors.push('Formula must have components for density validation');
    return { isValid: false, errors };
  }

  if (!formula.density || formula.density <= 0) {
    errors.push('Formula must have a positive density value');
    return { isValid: false, errors };
  }

  try {
    // Calculate total weight from components using reference batch size
    const referenceBatchSize = 1000; // grams
    const totalWeight = calculateFormulaComponentWeight(formula.components, referenceBatchSize);

    // For paint formulas, we assume the volume can be calculated from weight and density
    // This is a simplified model - in reality, paint mixing can be more complex
    const calculatedVolume = calculateVolumeFromWeight(totalWeight, formula.density);
    const calculatedDensity = calculatePaintDensity(totalWeight, calculatedVolume);

    const densityDifference = Math.abs(calculatedDensity - formula.density);
    const toleranceValue = formula.density * (tolerancePercent / 100);

    if (densityDifference > toleranceValue) {
      errors.push(
        `Density mismatch: calculated ${calculatedDensity.toFixed(3)} g/ml, ` +
          `formula ${formula.density.toFixed(3)} g/ml ` +
          `(difference: ${densityDifference.toFixed(3)} g/ml, tolerance: ${toleranceValue.toFixed(3)} g/ml)`,
      );
    }

    return {
      isValid: errors.length === 0,
      calculatedDensity,
      densityDifference,
      errors,
    };
  } catch (error) {
    errors.push(`Error in density calculation: ${(error as Error).message}`);
    return { isValid: false, errors };
  }
};

/**
 * Estimates paint cost based on component prices and quantities
 */
export const calculateFormulaCost = (
  components: Array<PaintFormulaComponent & { item?: Item & { price?: Array<{ value: number }> } }>,
  weightInGrams: number,
): {
  totalCost: number;
  componentCosts: Array<{ itemName: string; cost: number; weight: number }>;
} => {
  const scaledComponents = scaleFormulaForProduction(components, weightInGrams);
  let totalCost = 0;
  const componentCosts: Array<{ itemName: string; cost: number; weight: number }> = [];

  scaledComponents.forEach(scaledComp => {
    const component = components.find(c => c.id === scaledComp.componentId);
    if (!component?.item) return;

    const item = component.item;
    const latestPrice = item.price?.[0]?.value || 0;

    if (latestPrice === 0) {
      console.warn(`No price found for item: ${item.name}`);
    }

    const componentCost = scaledComp.requiredQuantity * latestPrice;
    totalCost += componentCost;

    componentCosts.push({
      itemName: item.name,
      cost: componentCost,
      weight: scaledComp.scaledWeight,
    });
  });

  return { totalCost, componentCosts };
};

/**
 * Calculate paint volume needed based on coverage area and application thickness
 * Useful for estimating paint requirements
 */
export const calculatePaintVolumeNeeded = (
  coverageAreaM2: number,
  thicknessMicrons: number,
  efficiency: number = 0.9, // 90% efficiency by default
): { volumeInLiters: number; volumeInMilliliters: number } => {
  // Formula: Volume (L) = Area (m²) × Thickness (μm) × 0.001 / Efficiency
  const volumeInLiters = (coverageAreaM2 * thicknessMicrons * 0.001) / efficiency;

  return {
    volumeInLiters: Math.round(volumeInLiters * 1000) / 1000, // Round to 3 decimal places
    volumeInMilliliters: Math.round(volumeInLiters * 1000),
  };
};

/**
 * Calculate theoretical coverage from paint volume
 * Useful for determining how much area can be covered with available paint
 */
export const calculatePaintCoverage = (
  volumeInLiters: number,
  thicknessMicrons: number,
  efficiency: number = 0.9,
): number => {
  // Formula: Area (m²) = Volume (L) × Efficiency / (Thickness (μm) × 0.001)
  return (volumeInLiters * efficiency) / (thicknessMicrons * 0.001);
};
