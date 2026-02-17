import { ChangeLogService } from '../changelog.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../../constants';
import { serializeChangelogValue } from './serialize-changelog-value';
import { normalizeDescription } from '../../../../utils/task-pricing-service-order-sync';

interface PricingItemForDiff {
  id?: string;
  description: string;
  amount: number | string | { toNumber(): number }; // Supports Prisma Decimal
  observation?: string | null;
  shouldSync?: boolean;
  position?: number;
}

interface ItemDiffEntry {
  type: 'added' | 'removed' | 'updated';
  itemDescription: string;
  itemId?: string;
  field?: string;
  oldValue?: any;
  newValue?: any;
}

/**
 * Compare old and new pricing item arrays and produce per-item diff entries.
 * Matches items by normalized description (case-insensitive, trimmed).
 */
export function diffPricingItems(
  oldItems: PricingItemForDiff[],
  newItems: PricingItemForDiff[],
): ItemDiffEntry[] {
  const entries: ItemDiffEntry[] = [];

  // Build maps keyed by normalized description
  const oldMap = new Map<string, PricingItemForDiff>();
  for (const item of oldItems) {
    oldMap.set(normalizeDescription(item.description), item);
  }

  const newMap = new Map<string, PricingItemForDiff>();
  for (const item of newItems) {
    newMap.set(normalizeDescription(item.description), item);
  }

  // Check for removed and updated items
  for (const [normalizedDesc, oldItem] of oldMap) {
    const newItem = newMap.get(normalizedDesc);

    if (!newItem) {
      // Item was removed
      entries.push({
        type: 'removed',
        itemDescription: oldItem.description,
        itemId: oldItem.id,
        oldValue: {
          description: oldItem.description,
          amount: Number(oldItem.amount),
          observation: oldItem.observation || null,
          shouldSync: oldItem.shouldSync,
          position: oldItem.position,
        },
      });
      continue;
    }

    // Compare individual fields
    const oldAmount = Number(oldItem.amount);
    const newAmount = Number(newItem.amount);
    if (oldAmount !== newAmount) {
      entries.push({
        type: 'updated',
        itemDescription: oldItem.description,
        itemId: newItem.id || oldItem.id,
        field: 'amount',
        oldValue: oldAmount,
        newValue: newAmount,
      });
    }

    const oldObs = oldItem.observation || null;
    const newObs = newItem.observation || null;
    if (oldObs !== newObs) {
      entries.push({
        type: 'updated',
        itemDescription: oldItem.description,
        itemId: newItem.id || oldItem.id,
        field: 'observation',
        oldValue: oldObs,
        newValue: newObs,
      });
    }

    if (oldItem.shouldSync !== undefined && newItem.shouldSync !== undefined && oldItem.shouldSync !== newItem.shouldSync) {
      entries.push({
        type: 'updated',
        itemDescription: oldItem.description,
        itemId: newItem.id || oldItem.id,
        field: 'shouldSync',
        oldValue: oldItem.shouldSync,
        newValue: newItem.shouldSync,
      });
    }
  }

  // Check for added items
  for (const [normalizedDesc, newItem] of newMap) {
    if (!oldMap.has(normalizedDesc)) {
      entries.push({
        type: 'added',
        itemDescription: newItem.description,
        itemId: newItem.id,
        newValue: {
          description: newItem.description,
          amount: Number(newItem.amount),
          observation: newItem.observation || null,
          shouldSync: newItem.shouldSync,
          position: newItem.position,
        },
      });
    }
  }

  return entries;
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

/**
 * Log per-item changelog entries by diffing old and new item arrays.
 */
export async function logPricingItemChanges(params: {
  changeLogService: ChangeLogService;
  pricingId: string;
  oldItems: PricingItemForDiff[];
  newItems: PricingItemForDiff[];
  userId: string;
  triggeredBy: CHANGE_TRIGGERED_BY;
  transaction?: any;
}): Promise<void> {
  const { changeLogService, pricingId, oldItems, newItems, userId, triggeredBy, transaction } = params;
  const entries = diffPricingItems(oldItems, newItems);

  for (const entry of entries) {
    let action: CHANGE_ACTION;
    let field: string | null = null;
    let oldValue: any = null;
    let newValue: any = null;
    let reason: string;

    switch (entry.type) {
      case 'added':
        action = CHANGE_ACTION.CREATE;
        newValue = serializeChangelogValue(entry.newValue);
        reason = `Item '${entry.itemDescription}' adicionado ao orçamento`;
        break;
      case 'removed':
        action = CHANGE_ACTION.DELETE;
        oldValue = serializeChangelogValue(entry.oldValue);
        reason = `Item '${entry.itemDescription}' removido do orçamento`;
        break;
      case 'updated':
        action = CHANGE_ACTION.UPDATE;
        field = entry.field!;
        oldValue = serializeChangelogValue(entry.oldValue);
        newValue = serializeChangelogValue(entry.newValue);
        if (field === 'amount') {
          reason = `Item '${entry.itemDescription}' — valor atualizado de ${formatCurrency(entry.oldValue)} para ${formatCurrency(entry.newValue)}`;
        } else if (field === 'observation') {
          reason = `Item '${entry.itemDescription}' — observação atualizada`;
        } else {
          reason = `Item '${entry.itemDescription}' — ${field} atualizado`;
        }
        break;
    }

    await changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_PRICING_ITEM,
      entityId: pricingId,
      action,
      field,
      oldValue,
      newValue,
      userId,
      reason,
      triggeredBy,
      triggeredById: userId,
      transaction,
      metadata: {
        itemDescription: entry.itemDescription,
        itemId: entry.itemId || null,
      },
    });
  }
}
