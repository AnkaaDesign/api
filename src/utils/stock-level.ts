// Single source of truth for the stock-level band classifier (spec §15).
// TOOL items short-circuit to OPTIMAL/OUT_OF_STOCK. Active pending orders
// surface as a UI overlay, not a threshold shift.

import { ITEM_CATEGORY_TYPE, STOCK_LEVEL } from '@/constants/enums';
import { STOCK_LEVEL_LOW_MULTIPLIER } from '@/constants/inventory-config';

export interface DetermineStockLevelInput {
  quantity: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  hasActiveOrder: boolean;
  categoryType: ITEM_CATEGORY_TYPE | null;
}

/** Classifies an item's stock state per spec §15. Active orders do NOT shift
 *  thresholds — the caller surfaces a "pedido em aberto" badge separately. */
export function determineStockLevel(input: DetermineStockLevelInput): STOCK_LEVEL {
  const { quantity, reorderPoint, maxQuantity, categoryType } = input;

  if (!Number.isFinite(quantity)) return STOCK_LEVEL.OPTIMAL;

  // TOOL short-circuit (spec §15.2).
  if (categoryType === ITEM_CATEGORY_TYPE.TOOL) {
    return quantity > 0 ? STOCK_LEVEL.OPTIMAL : STOCK_LEVEL.OUT_OF_STOCK;
  }

  // Negative-stock / out-of-stock checks apply uniformly.
  if (quantity < 0) return STOCK_LEVEL.NEGATIVE_STOCK;
  if (quantity === 0) return STOCK_LEVEL.OUT_OF_STOCK;

  // No signal yet (no consumption history → mc=0 → rp=0 and max=0): we cannot
  // classify CRITICAL/LOW/OVERSTOCKED, so default to OPTIMAL until data exists.
  const hasReorderSignal = reorderPoint !== null && reorderPoint > 0;
  const hasMaxSignal = maxQuantity !== null && maxQuantity > 0;
  if (!hasReorderSignal && !hasMaxSignal) return STOCK_LEVEL.OPTIMAL;

  if (hasReorderSignal && quantity <= (reorderPoint as number)) return STOCK_LEVEL.CRITICAL;
  if (
    hasReorderSignal &&
    quantity <= (reorderPoint as number) * STOCK_LEVEL_LOW_MULTIPLIER
  )
    return STOCK_LEVEL.LOW;
  if (hasMaxSignal && quantity > (maxQuantity as number)) return STOCK_LEVEL.OVERSTOCKED;
  return STOCK_LEVEL.OPTIMAL;
}

// ===== Render-only helpers (kept on the API for parity / dashboard usage) =====

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

export function getStockLevelIcon(level: STOCK_LEVEL): { name: string; rotation?: number } {
  switch (level) {
    case STOCK_LEVEL.NEGATIVE_STOCK:
      return { name: 'exclamation-triangle' };
    case STOCK_LEVEL.OUT_OF_STOCK:
      return { name: 'package-off' };
    case STOCK_LEVEL.CRITICAL:
      return { name: 'alert-circle' };
    case STOCK_LEVEL.LOW:
      return { name: 'trending-down' };
    case STOCK_LEVEL.OPTIMAL:
      return { name: 'check-circle' };
    case STOCK_LEVEL.OVERSTOCKED:
      return { name: 'trending-up' };
    default:
      return { name: 'help-circle' };
  }
}

export function isStockHealthy(level: STOCK_LEVEL): boolean {
  return level === STOCK_LEVEL.OPTIMAL || level === STOCK_LEVEL.OVERSTOCKED;
}

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
        ? `Estoque crítico. Quantidade (${quantity}) está em ou abaixo do ponto de pedido (${reorderPoint}).`
        : `Estoque crítico com ${quantity} unidades.`;
    case STOCK_LEVEL.LOW:
      return reorderPoint !== null
        ? `Estoque baixo. Quantidade (${quantity}) está logo acima do ponto de pedido (${reorderPoint}).`
        : `Estoque baixo com ${quantity} unidades.`;
    case STOCK_LEVEL.OPTIMAL:
      return `Estoque em nível adequado com ${quantity} unidades.`;
    case STOCK_LEVEL.OVERSTOCKED:
      return `Excesso de estoque com ${quantity} unidades. Considere revisar os níveis máximos.`;
    default:
      return 'Nível de estoque desconhecido.';
  }
}
