/**
 * Task Pricing and Production Service Order Bidirectional Synchronization Utilities
 *
 * This module provides synchronization logic between TaskPricingItems and
 * Production Service Orders. The sync is bidirectional and simplified:
 *
 * 1. Service Order (PRODUCTION) → Task Pricing Item:
 *    - When a PRODUCTION service order is created/updated
 *    - Creates/updates a pricing item with same description and observation
 *    - Amount defaults to 0 (can be updated later)
 *
 * 2. Task Pricing Item → Service Order (PRODUCTION):
 *    - When a pricing item is created/updated
 *    - Creates a service order with same description and observation
 *
 * Key Features:
 * - Description and observation are now separate fields (no combining/splitting)
 * - Duplicate prevention by description matching
 * - Delete tracking: deleted items won't be recreated by sync
 */

import { SERVICE_ORDER_TYPE } from '../constants/enums';

/**
 * Interface for a minimal service order used in sync operations
 */
export interface SyncServiceOrder {
  id?: string;
  description: string | null;
  observation?: string | null;
  type: SERVICE_ORDER_TYPE | string;
}

/**
 * Interface for a minimal pricing item used in sync operations
 * Now includes observation field
 */
export interface SyncPricingItem {
  id?: string;
  description: string;
  observation?: string | null;
  amount?: number | null;
}

/**
 * Interface for the result of syncing a service order to pricing
 */
export interface ServiceOrderToPricingResult {
  shouldCreatePricingItem: boolean;
  shouldUpdatePricingItem: boolean;
  existingPricingItemId?: string;
  pricingItemDescription: string;
  pricingItemObservation: string | null;
  pricingItemAmount: number;
  reason: string;
}

/**
 * Interface for the result of syncing a pricing item to service order
 */
export interface PricingItemToServiceOrderResult {
  shouldCreateServiceOrder: boolean;
  shouldUpdateServiceOrder: boolean;
  existingServiceOrderId?: string;
  serviceOrderDescription: string;
  serviceOrderObservation: string | null;
  reason: string;
}

/**
 * Normalizes a description for comparison purposes.
 * Converts to lowercase and removes extra whitespace.
 */
export function normalizeDescription(description: string | null): string {
  if (!description) return '';
  return description.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Checks if two descriptions are equivalent (case-insensitive, normalized whitespace).
 */
export function areDescriptionsEqual(
  desc1: string | null,
  desc2: string | null,
): boolean {
  return normalizeDescription(desc1) === normalizeDescription(desc2);
}

/**
 * DEPRECATED: Kept for backwards compatibility
 * Now just returns the description as-is since we have separate observation field
 */
export function combineServiceOrderToPricingDescription(
  description: string | null,
  _observation?: string | null,
): string {
  return (description || '').trim();
}

/**
 * DEPRECATED: Kept for backwards compatibility
 * Now just returns the description as-is since we have separate observation field
 */
export function splitPricingToServiceOrderDescription(
  pricingDescription: string,
  _existingServiceOrders: SyncServiceOrder[],
): { description: string; observation: string | null } {
  return {
    description: pricingDescription.trim(),
    observation: null,
  };
}

/**
 * Determines what action to take when a PRODUCTION service order is created/updated.
 *
 * @param serviceOrder - The service order being created/updated
 * @param existingPricingItems - Array of existing pricing items for the task
 * @returns Result indicating what pricing item action to take
 */
export function getServiceOrderToPricingSync(
  serviceOrder: SyncServiceOrder,
  existingPricingItems: SyncPricingItem[],
): ServiceOrderToPricingResult {
  // Only sync PRODUCTION type service orders
  if (serviceOrder.type !== SERVICE_ORDER_TYPE.PRODUCTION) {
    return {
      shouldCreatePricingItem: false,
      shouldUpdatePricingItem: false,
      pricingItemDescription: '',
      pricingItemObservation: null,
      pricingItemAmount: 0,
      reason:
        'Apenas ordens de serviço do tipo PRODUÇÃO são sincronizadas com precificação',
    };
  }

  const description = (serviceOrder.description || '').trim();
  const observation = (serviceOrder.observation || '').trim() || null;

  if (!description) {
    return {
      shouldCreatePricingItem: false,
      shouldUpdatePricingItem: false,
      pricingItemDescription: '',
      pricingItemObservation: null,
      pricingItemAmount: 0,
      reason: 'Ordem de serviço sem descrição',
    };
  }

  // Check if a pricing item with this exact description already exists
  const existingItem = existingPricingItems.find((item) =>
    areDescriptionsEqual(item.description, description),
  );

  if (existingItem) {
    // Check if observation needs to be updated
    const observationChanged = !areDescriptionsEqual(
      existingItem.observation || '',
      observation || '',
    );

    if (observationChanged && observation) {
      return {
        shouldCreatePricingItem: false,
        shouldUpdatePricingItem: true,
        existingPricingItemId: existingItem.id,
        pricingItemDescription: description,
        pricingItemObservation: observation,
        pricingItemAmount: existingItem.amount || 0,
        reason: 'Atualizando observação do item de precificação existente',
      };
    }

    return {
      shouldCreatePricingItem: false,
      shouldUpdatePricingItem: false,
      existingPricingItemId: existingItem.id,
      pricingItemDescription: description,
      pricingItemObservation: existingItem.observation || null,
      pricingItemAmount: existingItem.amount || 0,
      reason: 'Item de precificação já existe com esta descrição',
    };
  }

  // Create new pricing item
  return {
    shouldCreatePricingItem: true,
    shouldUpdatePricingItem: false,
    pricingItemDescription: description,
    pricingItemObservation: observation,
    pricingItemAmount: 0,
    reason: 'Criando novo item de precificação para ordem de serviço de produção',
  };
}

/**
 * Determines what action to take when a pricing item is created/updated.
 *
 * @param pricingItem - The pricing item being created/updated
 * @param existingServiceOrders - Array of existing service orders for the task
 * @returns Result indicating what service order action to take
 */
export function getPricingItemToServiceOrderSync(
  pricingItem: SyncPricingItem,
  existingServiceOrders: SyncServiceOrder[],
): PricingItemToServiceOrderResult {
  const description = (pricingItem.description || '').trim();
  const observation = (pricingItem.observation || '').trim() || null;

  if (!description) {
    return {
      shouldCreateServiceOrder: false,
      shouldUpdateServiceOrder: false,
      serviceOrderDescription: '',
      serviceOrderObservation: null,
      reason: 'Item de precificação sem descrição',
    };
  }

  // Check if a PRODUCTION service order with this exact description already exists
  const productionOrders = existingServiceOrders.filter(
    (so) => so.type === SERVICE_ORDER_TYPE.PRODUCTION,
  );

  const existingOrder = productionOrders.find((so) =>
    areDescriptionsEqual(so.description, description),
  );

  if (existingOrder) {
    // Check if observation needs to be updated
    const observationChanged = !areDescriptionsEqual(
      existingOrder.observation || '',
      observation || '',
    );

    if (observationChanged && observation) {
      return {
        shouldCreateServiceOrder: false,
        shouldUpdateServiceOrder: true,
        existingServiceOrderId: existingOrder.id,
        serviceOrderDescription: description,
        serviceOrderObservation: observation,
        reason: 'Atualizando observação da ordem de serviço existente',
      };
    }

    return {
      shouldCreateServiceOrder: false,
      shouldUpdateServiceOrder: false,
      existingServiceOrderId: existingOrder.id,
      serviceOrderDescription: description,
      serviceOrderObservation: existingOrder.observation || null,
      reason: 'Ordem de serviço de produção já existe com esta descrição',
    };
  }

  // Create new service order
  return {
    shouldCreateServiceOrder: true,
    shouldUpdateServiceOrder: false,
    serviceOrderDescription: description,
    serviceOrderObservation: observation,
    reason: 'Criando nova ordem de serviço de produção para item de precificação',
  };
}

/**
 * Batch sync: Given a list of pricing items and service orders,
 * returns the actions needed to sync them both ways.
 *
 * Important: This function only suggests creating items that don't already exist.
 * If an item was deleted, it won't be recreated because:
 * - We only check current items, not history
 * - Deleted items are not in the current list
 * - The match check will not find them, but since they don't exist on either side,
 *   no sync action will be triggered
 *
 * @param pricingItems - Current pricing items
 * @param serviceOrders - Current service orders
 * @returns Object with arrays of items to create/update on both sides
 */
export function getBidirectionalSyncActions(
  pricingItems: SyncPricingItem[],
  serviceOrders: SyncServiceOrder[],
): {
  pricingItemsToCreate: Array<{
    description: string;
    observation: string | null;
    amount: number;
    sourceServiceOrderId?: string;
  }>;
  pricingItemsToUpdate: Array<{
    id: string;
    description: string;
    observation: string | null;
    sourceServiceOrderId?: string;
  }>;
  serviceOrdersToCreate: Array<{
    description: string;
    observation: string | null;
    sourcePricingItemId?: string;
  }>;
  serviceOrdersToUpdate: Array<{
    id: string;
    observation: string | null;
    sourcePricingItemId?: string;
  }>;
} {
  const result = {
    pricingItemsToCreate: [] as Array<{
      description: string;
      observation: string | null;
      amount: number;
      sourceServiceOrderId?: string;
    }>,
    pricingItemsToUpdate: [] as Array<{
      id: string;
      description: string;
      observation: string | null;
      sourceServiceOrderId?: string;
    }>,
    serviceOrdersToCreate: [] as Array<{
      description: string;
      observation: string | null;
      sourcePricingItemId?: string;
    }>,
    serviceOrdersToUpdate: [] as Array<{
      id: string;
      observation: string | null;
      sourcePricingItemId?: string;
    }>,
  };

  // Track what's already been matched to avoid duplicates
  const matchedPricingDescriptions = new Set<string>();
  const matchedServiceOrderIds = new Set<string>();

  // First pass: Service Orders → Pricing Items
  for (const so of serviceOrders) {
    if (so.type !== SERVICE_ORDER_TYPE.PRODUCTION) continue;

    const syncResult = getServiceOrderToPricingSync(so, pricingItems);

    if (syncResult.shouldCreatePricingItem) {
      const normalizedDesc = normalizeDescription(
        syncResult.pricingItemDescription,
      );
      if (!matchedPricingDescriptions.has(normalizedDesc)) {
        result.pricingItemsToCreate.push({
          description: syncResult.pricingItemDescription,
          observation: syncResult.pricingItemObservation,
          amount: syncResult.pricingItemAmount,
          sourceServiceOrderId: so.id,
        });
        matchedPricingDescriptions.add(normalizedDesc);
      }
    } else if (
      syncResult.shouldUpdatePricingItem &&
      syncResult.existingPricingItemId
    ) {
      result.pricingItemsToUpdate.push({
        id: syncResult.existingPricingItemId,
        description: syncResult.pricingItemDescription,
        observation: syncResult.pricingItemObservation,
        sourceServiceOrderId: so.id,
      });
      matchedPricingDescriptions.add(
        normalizeDescription(syncResult.pricingItemDescription),
      );
    } else if (syncResult.existingPricingItemId) {
      matchedPricingDescriptions.add(
        normalizeDescription(syncResult.pricingItemDescription),
      );
      if (so.id) matchedServiceOrderIds.add(so.id);
    }
  }

  // Second pass: Pricing Items → Service Orders
  for (const pi of pricingItems) {
    const normalizedDesc = normalizeDescription(pi.description);

    // Skip if this pricing item was already matched from a service order
    if (matchedPricingDescriptions.has(normalizedDesc)) {
      continue;
    }

    const syncResult = getPricingItemToServiceOrderSync(pi, serviceOrders);

    if (syncResult.shouldCreateServiceOrder) {
      result.serviceOrdersToCreate.push({
        description: syncResult.serviceOrderDescription,
        observation: syncResult.serviceOrderObservation,
        sourcePricingItemId: pi.id,
      });
    } else if (
      syncResult.shouldUpdateServiceOrder &&
      syncResult.existingServiceOrderId
    ) {
      if (!matchedServiceOrderIds.has(syncResult.existingServiceOrderId)) {
        result.serviceOrdersToUpdate.push({
          id: syncResult.existingServiceOrderId,
          observation: syncResult.serviceOrderObservation,
          sourcePricingItemId: pi.id,
        });
        matchedServiceOrderIds.add(syncResult.existingServiceOrderId);
      }
    }
  }

  return result;
}

/**
 * Helper function to check if a pricing item description matches a service order
 */
export function isPricingItemMatchingServiceOrder(
  pricingItem: SyncPricingItem,
  serviceOrder: SyncServiceOrder,
): boolean {
  if (serviceOrder.type !== SERVICE_ORDER_TYPE.PRODUCTION) {
    return false;
  }

  return areDescriptionsEqual(pricingItem.description, serviceOrder.description);
}

/**
 * Helper functions for frontend sync (used in task-edit-form.tsx)
 * These are simplified versions that work with the form data
 */
export function getPricingItemsToAddFromServiceOrders(
  serviceOrders: SyncServiceOrder[],
  existingPricingItems: SyncPricingItem[],
): Array<{ description: string; observation: string | null; amount: number }> {
  const result: Array<{
    description: string;
    observation: string | null;
    amount: number;
  }> = [];
  const existingDescriptions = new Set(
    existingPricingItems.map((pi) => normalizeDescription(pi.description)),
  );

  for (const so of serviceOrders) {
    if (so.type !== SERVICE_ORDER_TYPE.PRODUCTION) continue;
    if (!so.description) continue;

    const normalizedDesc = normalizeDescription(so.description);
    if (!existingDescriptions.has(normalizedDesc)) {
      result.push({
        description: so.description.trim(),
        observation: so.observation?.trim() || null,
        amount: 0,
      });
      existingDescriptions.add(normalizedDesc);
    }
  }

  return result;
}

export function getServiceOrdersToAddFromPricingItems(
  pricingItems: SyncPricingItem[],
  existingServiceOrders: SyncServiceOrder[],
  _historicalDescriptions?: string[],
): Array<{ description: string; observation: string | null }> {
  const result: Array<{ description: string; observation: string | null }> = [];
  const existingDescriptions = new Set(
    existingServiceOrders
      .filter((so) => so.type === SERVICE_ORDER_TYPE.PRODUCTION)
      .map((so) => normalizeDescription(so.description)),
  );

  for (const pi of pricingItems) {
    if (!pi.description) continue;

    const normalizedDesc = normalizeDescription(pi.description);
    if (!existingDescriptions.has(normalizedDesc)) {
      result.push({
        description: pi.description.trim(),
        observation: pi.observation?.trim() || null,
      });
      existingDescriptions.add(normalizedDesc);
    }
  }

  return result;
}
