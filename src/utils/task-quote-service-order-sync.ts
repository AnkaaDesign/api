/**
 * Task Quote and Production Service Order Bidirectional Synchronization Utilities
 *
 * This module provides synchronization logic between TaskQuoteServices and
 * Production Service Orders. The sync is bidirectional and simplified:
 *
 * 1. Service Order (PRODUCTION) → Task Quote Item:
 *    - When a PRODUCTION service order is created/updated
 *    - Creates/updates a quote item with same description and observation
 *    - Amount defaults to 0 (can be updated later)
 *
 * 2. Task Quote Item → Service Order (PRODUCTION):
 *    - When a quote item is created/updated
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
 * Interface for a minimal quote item used in sync operations
 * Now includes observation field
 */
export interface SyncQuoteItem {
  id?: string;
  description: string;
  observation?: string | null;
  amount?: number | null;
}

/**
 * Interface for the result of syncing a service order to quote
 */
export interface ServiceOrderToQuoteResult {
  shouldCreateQuoteItem: boolean;
  shouldUpdateQuoteItem: boolean;
  existingQuoteItemId?: string;
  quoteItemDescription: string;
  quoteItemObservation: string | null;
  quoteItemAmount: number;
  reason: string;
}

/**
 * Interface for the result of syncing a quote item to service order
 */
export interface QuoteItemToServiceOrderResult {
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
export function areDescriptionsEqual(desc1: string | null, desc2: string | null): boolean {
  return normalizeDescription(desc1) === normalizeDescription(desc2);
}

/**
 * Returns a composite key combining description and observation for deduplication.
 * Needed because multiple items can share a description (e.g. "Outros") with different observations.
 */
export function makeDescObsKey(description: string | null, observation?: string | null): string {
  return `${normalizeDescription(description)}::${normalizeDescription(observation || '')}`;
}

/**
 * Finds the candidate (quote item or service order) that pairs with an item of the
 * given description + observation.
 *
 * Matching is observation-tolerant to avoid spawning duplicates when an observation
 * is added to / edited on ONE side after the pair was already created (e.g. someone
 * appends a paint color "(Prata)" to the quote items while the existing service
 * orders still have a blank observation). The rules, in priority order:
 *
 *   1. Exact description + observation match (a genuine 1:1 pair).
 *   2. Same description where EITHER side's observation is blank — the blank side
 *      simply hadn't been annotated yet, so it's the same line item.
 *
 * Two NON-empty differing observations are intentionally NOT matched: they are
 * distinct line items (e.g. "Outros (A)" vs "Outros (B)"), preserving the
 * multiple-items-same-description feature.
 */
export function findCounterpartByDescObs<
  T extends { description: string | null; observation?: string | null },
>(candidates: T[], description: string | null, observation?: string | null): T | undefined {
  const exact = candidates.find(
    c =>
      areDescriptionsEqual(c.description, description) &&
      areDescriptionsEqual(c.observation || '', observation || ''),
  );
  if (exact) return exact;

  const targetObsBlank = normalizeDescription(observation || '') === '';
  return candidates.find(
    c =>
      areDescriptionsEqual(c.description, description) &&
      (targetObsBlank || normalizeDescription(c.observation || '') === ''),
  );
}

/**
 * DEPRECATED: Kept for backwards compatibility
 * Now just returns the description as-is since we have separate observation field
 */
export function combineServiceOrderToQuoteDescription(
  description: string | null,
  _observation?: string | null,
): string {
  return (description || '').trim();
}

/**
 * DEPRECATED: Kept for backwards compatibility
 * Now just returns the description as-is since we have separate observation field
 */
export function splitQuoteToServiceOrderDescription(
  quoteDescription: string,
  _existingServiceOrders: SyncServiceOrder[],
): { description: string; observation: string | null } {
  return {
    description: quoteDescription.trim(),
    observation: null,
  };
}

/**
 * Determines what action to take when a PRODUCTION service order is created/updated.
 *
 * @param serviceOrder - The service order being created/updated
 * @param existingQuoteItems - Array of existing quote items for the task
 * @returns Result indicating what quote item action to take
 */
export function getServiceOrderToQuoteSync(
  serviceOrder: SyncServiceOrder,
  existingQuoteItems: SyncQuoteItem[],
): ServiceOrderToQuoteResult {
  // Only sync PRODUCTION type service orders
  if (serviceOrder.type !== SERVICE_ORDER_TYPE.PRODUCTION) {
    return {
      shouldCreateQuoteItem: false,
      shouldUpdateQuoteItem: false,
      quoteItemDescription: '',
      quoteItemObservation: null,
      quoteItemAmount: 0,
      reason: 'Apenas ordens de serviço do tipo PRODUÇÃO são sincronizadas com precificação',
    };
  }

  const description = (serviceOrder.description || '').trim();
  const observation = (serviceOrder.observation || '').trim() || null;

  if (!description) {
    return {
      shouldCreateQuoteItem: false,
      shouldUpdateQuoteItem: false,
      quoteItemDescription: '',
      quoteItemObservation: null,
      quoteItemAmount: 0,
      reason: 'Ordem de serviço sem descrição',
    };
  }

  // Match on description + observation, tolerating a blank observation on either
  // side so adding an annotation later doesn't spawn a duplicate. Two non-empty
  // differing observations stay distinct.
  const existingItem = findCounterpartByDescObs(existingQuoteItems, description, observation);

  if (existingItem) {
    return {
      shouldCreateQuoteItem: false,
      shouldUpdateQuoteItem: false,
      existingQuoteItemId: existingItem.id,
      quoteItemDescription: description,
      quoteItemObservation: existingItem.observation || null,
      quoteItemAmount: existingItem.amount || 0,
      reason: 'Item de precificação já existe com esta descrição e observação',
    };
  }

  // Create new quote item
  return {
    shouldCreateQuoteItem: true,
    shouldUpdateQuoteItem: false,
    quoteItemDescription: description,
    quoteItemObservation: observation,
    quoteItemAmount: 0,
    reason: 'Criando novo item de precificação para ordem de serviço de produção',
  };
}

/**
 * Determines what action to take when a quote item is created/updated.
 *
 * @param quoteItem - The quote item being created/updated
 * @param existingServiceOrders - Array of existing service orders for the task
 * @returns Result indicating what service order action to take
 */
export function getQuoteItemToServiceOrderSync(
  quoteItem: SyncQuoteItem,
  existingServiceOrders: SyncServiceOrder[],
): QuoteItemToServiceOrderResult {
  const description = (quoteItem.description || '').trim();
  const observation = (quoteItem.observation || '').trim() || null;

  if (!description) {
    return {
      shouldCreateServiceOrder: false,
      shouldUpdateServiceOrder: false,
      serviceOrderDescription: '',
      serviceOrderObservation: null,
      reason: 'Item de precificação sem descrição',
    };
  }

  // Check if a PRODUCTION service order with this exact description+observation already exists
  const productionOrders = existingServiceOrders.filter(
    so => so.type === SERVICE_ORDER_TYPE.PRODUCTION,
  );

  // Match on description + observation, tolerating a blank observation on either
  // side so adding an annotation later doesn't spawn a duplicate. Two non-empty
  // differing observations stay distinct.
  const existingOrder = findCounterpartByDescObs(productionOrders, description, observation);

  if (existingOrder) {
    return {
      shouldCreateServiceOrder: false,
      shouldUpdateServiceOrder: false,
      existingServiceOrderId: existingOrder.id,
      serviceOrderDescription: description,
      serviceOrderObservation: existingOrder.observation || null,
      reason: 'Ordem de serviço de produção já existe com esta descrição e observação',
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
 * Batch sync: Given a list of quote items and service orders,
 * returns the actions needed to sync them both ways.
 *
 * Important: This function only suggests creating items that don't already exist.
 * If an item was deleted, it won't be recreated because:
 * - We only check current items, not history
 * - Deleted items are not in the current list
 * - The match check will not find them, but since they don't exist on either side,
 *   no sync action will be triggered
 *
 * @param quoteItems - Current quote items
 * @param serviceOrders - Current service orders
 * @returns Object with arrays of items to create/update on both sides
 */
export function getBidirectionalSyncActions(
  quoteItems: SyncQuoteItem[],
  serviceOrders: SyncServiceOrder[],
): {
  quoteItemsToCreate: Array<{
    description: string;
    observation: string | null;
    amount: number;
    sourceServiceOrderId?: string;
  }>;
  quoteItemsToUpdate: Array<{
    id: string;
    description: string;
    observation: string | null;
    sourceServiceOrderId?: string;
  }>;
  serviceOrdersToCreate: Array<{
    description: string;
    observation: string | null;
    sourceQuoteItemId?: string;
  }>;
  serviceOrdersToUpdate: Array<{
    id: string;
    observation: string | null;
    sourceQuoteItemId?: string;
  }>;
} {
  const result = {
    quoteItemsToCreate: [] as Array<{
      description: string;
      observation: string | null;
      amount: number;
      sourceServiceOrderId?: string;
    }>,
    quoteItemsToUpdate: [] as Array<{
      id: string;
      description: string;
      observation: string | null;
      sourceServiceOrderId?: string;
    }>,
    serviceOrdersToCreate: [] as Array<{
      description: string;
      observation: string | null;
      sourceQuoteItemId?: string;
    }>,
    serviceOrdersToUpdate: [] as Array<{
      id: string;
      observation: string | null;
      sourceQuoteItemId?: string;
    }>,
  };

  // Track what's already been matched to avoid duplicates (keyed by description::observation)
  const matchedQuoteKeys = new Set<string>();
  const matchedServiceOrderIds = new Set<string>();

  // First pass: Service Orders → Quote Items
  for (const so of serviceOrders) {
    if (so.type !== SERVICE_ORDER_TYPE.PRODUCTION) continue;

    const syncResult = getServiceOrderToQuoteSync(so, quoteItems);

    if (syncResult.shouldCreateQuoteItem) {
      const key = makeDescObsKey(syncResult.quoteItemDescription, syncResult.quoteItemObservation);
      if (!matchedQuoteKeys.has(key)) {
        result.quoteItemsToCreate.push({
          description: syncResult.quoteItemDescription,
          observation: syncResult.quoteItemObservation,
          amount: syncResult.quoteItemAmount,
          sourceServiceOrderId: so.id,
        });
        matchedQuoteKeys.add(key);
      }
    } else if (syncResult.shouldUpdateQuoteItem && syncResult.existingQuoteItemId) {
      result.quoteItemsToUpdate.push({
        id: syncResult.existingQuoteItemId,
        description: syncResult.quoteItemDescription,
        observation: syncResult.quoteItemObservation,
        sourceServiceOrderId: so.id,
      });
      matchedQuoteKeys.add(makeDescObsKey(syncResult.quoteItemDescription, syncResult.quoteItemObservation));
    } else if (syncResult.existingQuoteItemId) {
      matchedQuoteKeys.add(makeDescObsKey(syncResult.quoteItemDescription, syncResult.quoteItemObservation));
      if (so.id) matchedServiceOrderIds.add(so.id);
    }
  }

  // Second pass: Quote Items → Service Orders
  for (const pi of quoteItems) {
    const key = makeDescObsKey(pi.description, pi.observation);

    // Skip if this quote item was already matched from a service order
    if (matchedQuoteKeys.has(key)) {
      continue;
    }

    const syncResult = getQuoteItemToServiceOrderSync(pi, serviceOrders);

    if (syncResult.shouldCreateServiceOrder) {
      result.serviceOrdersToCreate.push({
        description: syncResult.serviceOrderDescription,
        observation: syncResult.serviceOrderObservation,
        sourceQuoteItemId: pi.id,
      });
    } else if (syncResult.shouldUpdateServiceOrder && syncResult.existingServiceOrderId) {
      if (!matchedServiceOrderIds.has(syncResult.existingServiceOrderId)) {
        result.serviceOrdersToUpdate.push({
          id: syncResult.existingServiceOrderId,
          observation: syncResult.serviceOrderObservation,
          sourceQuoteItemId: pi.id,
        });
        matchedServiceOrderIds.add(syncResult.existingServiceOrderId);
      }
    }
  }

  return result;
}

/**
 * Helper function to check if a quote item matches a service order (by description+observation)
 */
export function isQuoteItemMatchingServiceOrder(
  quoteItem: SyncQuoteItem,
  serviceOrder: SyncServiceOrder,
): boolean {
  if (serviceOrder.type !== SERVICE_ORDER_TYPE.PRODUCTION) {
    return false;
  }

  return (
    areDescriptionsEqual(quoteItem.description, serviceOrder.description) &&
    areDescriptionsEqual(quoteItem.observation || '', serviceOrder.observation || '')
  );
}

/**
 * Helper functions for frontend sync (used in task-edit-form.tsx)
 * These are simplified versions that work with the form data
 */
export function getQuoteItemsToAddFromServiceOrders(
  serviceOrders: SyncServiceOrder[],
  existingQuoteItems: SyncQuoteItem[],
): Array<{ description: string; observation: string | null; amount: number }> {
  const result: Array<{
    description: string;
    observation: string | null;
    amount: number;
  }> = [];
  const existingKeys = new Set(
    existingQuoteItems.map(pi => makeDescObsKey(pi.description, pi.observation)),
  );

  for (const so of serviceOrders) {
    if (so.type !== SERVICE_ORDER_TYPE.PRODUCTION) continue;
    if (!so.description) continue;

    const key = makeDescObsKey(so.description, so.observation);
    if (!existingKeys.has(key)) {
      result.push({
        description: so.description.trim(),
        observation: so.observation?.trim() || null,
        amount: 0,
      });
      existingKeys.add(key);
    }
  }

  return result;
}

export function getServiceOrdersToAddFromQuoteItems(
  quoteItems: SyncQuoteItem[],
  existingServiceOrders: SyncServiceOrder[],
  _historicalDescriptions?: string[],
): Array<{ description: string; observation: string | null }> {
  const result: Array<{ description: string; observation: string | null }> = [];
  const existingKeys = new Set(
    existingServiceOrders
      .filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION)
      .map(so => makeDescObsKey(so.description, so.observation)),
  );

  for (const pi of quoteItems) {
    if (!pi.description) continue;

    const key = makeDescObsKey(pi.description, pi.observation);
    if (!existingKeys.has(key)) {
      result.push({
        description: pi.description.trim(),
        observation: pi.observation?.trim() || null,
      });
      existingKeys.add(key);
    }
  }

  return result;
}
