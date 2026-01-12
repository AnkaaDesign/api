import { STOCK_LEVEL } from '@constants';

/**
 * Determines the stock level based on quantity, reorder point, and active order status
 *
 * Thresholds (inclusive boundaries):
 * - CRITICAL: quantity <= 90% of reorder point
 * - LOW: 90% < quantity <= 110% of reorder point
 * - OPTIMAL: 110% < quantity <= max quantity (or no max)
 * - OVERSTOCKED: quantity > max quantity
 *
 * When hasActiveOrder is true, thresholds are adjusted by 1.5x to reduce urgency
 *
 * @param quantity Current stock quantity
 * @param reorderPoint Minimum stock level that triggers reorder (null if not configured)
 * @param maxQuantity Maximum stock level (null if not configured)
 * @param hasActiveOrder Whether there's an active order (status != CREATED)
 * @returns The appropriate stock level
 */
export function determineStockLevel(
  quantity: number,
  reorderPoint: number | null,
  maxQuantity: number | null,
  hasActiveOrder: boolean,
): STOCK_LEVEL {
  // Validate input
  if (!Number.isFinite(quantity)) {
    // For invalid quantities, default to OPTIMAL to avoid false alerts
    return STOCK_LEVEL.OPTIMAL;
  }

  // Handle negative stock
  if (quantity < 0) {
    return STOCK_LEVEL.NEGATIVE_STOCK;
  }

  // Handle zero stock
  if (quantity === 0) {
    return STOCK_LEVEL.OUT_OF_STOCK;
  }

  // If no reorder point is configured, we can't calculate thresholds
  if (reorderPoint === null) {
    return STOCK_LEVEL.OPTIMAL;
  }

  // Adjust thresholds if there's an active order (less urgency)
  const adjustmentFactor = hasActiveOrder ? 1.5 : 1;
  const adjustedCriticalThreshold = reorderPoint * 0.9 * adjustmentFactor;
  const adjustedLowThreshold = reorderPoint * 1.1 * adjustmentFactor;

  // Check critical level (inclusive boundary)
  if (quantity <= adjustedCriticalThreshold) {
    return STOCK_LEVEL.CRITICAL;
  }

  // Check low level (inclusive boundary)
  if (quantity <= adjustedLowThreshold) {
    return STOCK_LEVEL.LOW;
  }

  // Check overstocked
  if (maxQuantity !== null && quantity > maxQuantity) {
    return STOCK_LEVEL.OVERSTOCKED;
  }

  // Otherwise, stock is optimal
  return STOCK_LEVEL.OPTIMAL;
}

/**
 * Returns the Tailwind CSS color class for a given stock level
 * @param level The stock level
 * @returns Tailwind color class
 */
export function getStockLevelColor(level: STOCK_LEVEL): string {
  switch (level) {
    case STOCK_LEVEL.NEGATIVE_STOCK:
      return 'text-red-700 bg-red-100';
    case STOCK_LEVEL.OUT_OF_STOCK:
      return 'text-red-600 bg-red-50';
    case STOCK_LEVEL.CRITICAL:
      return 'text-orange-600 bg-orange-50';
    case STOCK_LEVEL.LOW:
      return 'text-yellow-600 bg-yellow-50';
    case STOCK_LEVEL.OPTIMAL:
      return 'text-green-600 bg-green-50';
    case STOCK_LEVEL.OVERSTOCKED:
      return 'text-blue-600 bg-blue-50';
    default:
      return 'text-gray-600 bg-gray-50';
  }
}

/**
 * Returns only the text color class for a given stock level (without background)
 * @param level The stock level
 * @returns Tailwind text color class
 */
export function getStockLevelTextColor(level: STOCK_LEVEL): string {
  switch (level) {
    case STOCK_LEVEL.NEGATIVE_STOCK:
      return 'text-neutral-500';
    case STOCK_LEVEL.OUT_OF_STOCK:
      return 'text-red-600';
    case STOCK_LEVEL.CRITICAL:
      return 'text-orange-500';
    case STOCK_LEVEL.LOW:
      return 'text-yellow-500';
    case STOCK_LEVEL.OPTIMAL:
      return 'text-green-600';
    case STOCK_LEVEL.OVERSTOCKED:
      return 'text-purple-600';
    default:
      return 'text-neutral-500';
  }
}

/**
 * Returns icon information for a given stock level
 * @param level The stock level
 * @returns Object with icon name and rotation
 */
export function getStockLevelIcon(level: STOCK_LEVEL): { name: string; rotation?: number } {
  switch (level) {
    case STOCK_LEVEL.NEGATIVE_STOCK:
      return { name: 'exclamation-triangle', rotation: 0 };
    case STOCK_LEVEL.OUT_OF_STOCK:
      return { name: 'package-off', rotation: 0 };
    case STOCK_LEVEL.CRITICAL:
      return { name: 'alert-circle', rotation: 0 };
    case STOCK_LEVEL.LOW:
      return { name: 'trending-down', rotation: 0 };
    case STOCK_LEVEL.OPTIMAL:
      return { name: 'check-circle', rotation: 0 };
    case STOCK_LEVEL.OVERSTOCKED:
      return { name: 'trending-up', rotation: 0 };
    default:
      return { name: 'help-circle', rotation: 0 };
  }
}

/**
 * Checks if the stock level is in a healthy state
 * @param level The stock level
 * @returns true if stock is healthy (OPTIMAL or OVERSTOCKED)
 */
export function isStockHealthy(level: STOCK_LEVEL): boolean {
  return level === STOCK_LEVEL.OPTIMAL || level === STOCK_LEVEL.OVERSTOCKED;
}

/**
 * Gets the priority level based on stock level (for sorting or alerts)
 * @param level The stock level
 * @returns Priority number (lower is more urgent)
 */
export function getStockLevelPriority(level: STOCK_LEVEL): number {
  switch (level) {
    case STOCK_LEVEL.NEGATIVE_STOCK:
      return 1;
    case STOCK_LEVEL.OUT_OF_STOCK:
      return 2;
    case STOCK_LEVEL.CRITICAL:
      return 3;
    case STOCK_LEVEL.LOW:
      return 4;
    case STOCK_LEVEL.OPTIMAL:
      return 5;
    case STOCK_LEVEL.OVERSTOCKED:
      return 6;
    default:
      return 999;
  }
}

/**
 * Gets a descriptive message for the stock level
 * @param level The stock level
 * @param quantity The current quantity
 * @param reorderPoint The reorder point (if configured)
 * @returns A descriptive message in Portuguese
 */
export function getStockLevelMessage(
  level: STOCK_LEVEL,
  quantity: number,
  reorderPoint: number | null,
): string {
  switch (level) {
    case STOCK_LEVEL.NEGATIVE_STOCK:
      return `Estoque negativo (${quantity}). Verifique possíveis erros de lançamento.`;
    case STOCK_LEVEL.OUT_OF_STOCK:
      return 'Item sem estoque. Necessário reposição urgente.';
    case STOCK_LEVEL.CRITICAL:
      return reorderPoint !== null
        ? `Estoque crítico. Quantidade (${quantity}) está em ou abaixo de 90% do ponto de pedido (${reorderPoint}).`
        : `Estoque crítico com ${quantity} unidades.`;
    case STOCK_LEVEL.LOW:
      return reorderPoint !== null
        ? `Estoque baixo. Quantidade (${quantity}) está entre 90% e 110% do ponto de pedido (${reorderPoint}).`
        : `Estoque baixo com ${quantity} unidades.`;
    case STOCK_LEVEL.OPTIMAL:
      return `Estoque em nível adequado com ${quantity} unidades.`;
    case STOCK_LEVEL.OVERSTOCKED:
      return `Excesso de estoque com ${quantity} unidades. Considere revisar os níveis máximos.`;
    default:
      return `Nível de estoque desconhecido.`;
  }
}
