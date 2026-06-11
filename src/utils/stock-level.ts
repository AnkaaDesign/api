// Single source of truth for the stock-level band classifier (spec §15).
// FIXED_TARGET items short-circuit to OPTIMAL/CRITICAL/OUT_OF_STOCK. Open
// orders projected to arrive within the lead-time window count toward the
// effective quantity used for classification — an item with rp=10, qty=2, and
// a 1-day-lead order in flight is OPTIMAL/LOW, not CRITICAL.

import { STOCK_LEVEL } from '@/constants/enums';
import {
  STOCK_LEVEL_LOW_MULTIPLIER,
  getFixedTarget,
  isFixedTarget,
} from '@/constants/inventory-config';

export interface DetermineStockLevelInput {
  quantity: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  hasActiveOrder: boolean;
  stockModel: string | null;
  fixedTargetQuantity?: number | null;
  /** Units already ordered and projected to arrive within the lead-time
   *  window. When provided, classification uses `quantity + incomingOrderedQuantity`
   *  as the effective stock. Pre-filtered by the caller (typically: open
   *  OrderItems on orders not yet RECEIVED/CANCELLED, with forecast/expected
   *  arrival on or before `now + leadTime + buffer`). */
  incomingOrderedQuantity?: number;
}

/** Classifies an item's stock state per spec §15. Open orders arriving within
 *  the lead-time window count toward the effective quantity used for the
 *  CRITICAL/LOW/OPTIMAL bands. Hard-floor checks (negative-stock, out-of-stock)
 *  use the physical `quantity` only — an empty shelf is empty regardless of
 *  what's in the pipeline. */
export function determineStockLevel(input: DetermineStockLevelInput): STOCK_LEVEL {
  const { quantity, reorderPoint, maxQuantity } = input;
  const incoming = Math.max(0, input.incomingOrderedQuantity ?? 0);

  if (!Number.isFinite(quantity)) return STOCK_LEVEL.OPTIMAL;

  // Fixed-target short-circuit (spec §15.2). These items don't use the
  // consumption-driven rp/max model — they hold a fixed target on the shelf
  // and ignore incoming. They reorder only once they run out:
  //   qty>=target OPTIMAL, 0<qty<target CRITICAL, qty<=0 OUT_OF_STOCK.
  if (isFixedTarget(input)) {
    if (quantity <= 0) return STOCK_LEVEL.OUT_OF_STOCK;
    return quantity < getFixedTarget(input) ? STOCK_LEVEL.CRITICAL : STOCK_LEVEL.OPTIMAL;
  }

  // Negative / out-of-stock are PHYSICAL — incoming doesn't fill an empty shelf.
  if (quantity < 0) return STOCK_LEVEL.NEGATIVE_STOCK;
  if (quantity === 0) return STOCK_LEVEL.OUT_OF_STOCK;

  // No signal yet (no consumption history → mc=0 → rp=0 and max=0): we cannot
  // classify CRITICAL/LOW/OVERSTOCKED, so default to OPTIMAL until data exists.
  const hasReorderSignal = reorderPoint !== null && reorderPoint > 0;
  const hasMaxSignal = maxQuantity !== null && maxQuantity > 0;
  if (!hasReorderSignal && !hasMaxSignal) return STOCK_LEVEL.OPTIMAL;

  // Effective stock = physical + arriving-soon. Used for rp/max band checks.
  const effective = quantity + incoming;

  if (hasReorderSignal && effective <= (reorderPoint as number)) return STOCK_LEVEL.CRITICAL;
  if (
    hasReorderSignal &&
    effective <= (reorderPoint as number) * STOCK_LEVEL_LOW_MULTIPLIER
  )
    return STOCK_LEVEL.LOW;
  // OVERSTOCKED uses PHYSICAL quantity — an order arriving later shouldn't flip
  // an already-overstocked item further into overstock noise.
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
