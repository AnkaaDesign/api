import { ChangeLogService } from '../changelog.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../../constants';
import { serializeChangelogValue } from './serialize-changelog-value';
import { normalizeDescription } from '../../../../utils/task-quote-service-order-sync';

interface QuoteServiceForDiff {
  id?: string;
  description: string;
  amount: number | string | { toNumber(): number }; // Supports Prisma Decimal
  observation?: string | null;
  shouldSync?: boolean;
  position?: number;
}

interface ServiceDiffEntry {
  type: 'added' | 'removed' | 'updated';
  serviceDescription: string;
  serviceId?: string;
  field?: string;
  oldValue?: any;
  newValue?: any;
}

/**
 * Compare old and new pricing service arrays and produce per-service diff entries.
 * Matches services by normalized description (case-insensitive, trimmed).
 */
export function diffQuoteServices(
  oldServices: QuoteServiceForDiff[],
  newServices: QuoteServiceForDiff[],
): ServiceDiffEntry[] {
  const entries: ServiceDiffEntry[] = [];

  // Build maps keyed by normalized description
  const oldMap = new Map<string, QuoteServiceForDiff>();
  for (const service of oldServices) {
    oldMap.set(normalizeDescription(service.description), service);
  }

  const newMap = new Map<string, QuoteServiceForDiff>();
  for (const service of newServices) {
    newMap.set(normalizeDescription(service.description), service);
  }

  // Check for removed and updated services
  for (const [normalizedDesc, oldService] of oldMap) {
    const newService = newMap.get(normalizedDesc);

    if (!newService) {
      // Service was removed
      entries.push({
        type: 'removed',
        serviceDescription: oldService.description,
        serviceId: oldService.id,
        oldValue: {
          description: oldService.description,
          amount: Number(oldService.amount),
          observation: oldService.observation || null,
          shouldSync: oldService.shouldSync,
          position: oldService.position,
        },
      });
      continue;
    }

    // Compare individual fields
    const oldAmount = Number(oldService.amount);
    const newAmount = Number(newService.amount);
    if (oldAmount !== newAmount) {
      entries.push({
        type: 'updated',
        serviceDescription: oldService.description,
        serviceId: newService.id || oldService.id,
        field: 'amount',
        oldValue: oldAmount,
        newValue: newAmount,
      });
    }

    const oldObs = oldService.observation || null;
    const newObs = newService.observation || null;
    if (oldObs !== newObs) {
      entries.push({
        type: 'updated',
        serviceDescription: oldService.description,
        serviceId: newService.id || oldService.id,
        field: 'observation',
        oldValue: oldObs,
        newValue: newObs,
      });
    }

    if (oldService.shouldSync !== undefined && newService.shouldSync !== undefined && oldService.shouldSync !== newService.shouldSync) {
      entries.push({
        type: 'updated',
        serviceDescription: oldService.description,
        serviceId: newService.id || oldService.id,
        field: 'shouldSync',
        oldValue: oldService.shouldSync,
        newValue: newService.shouldSync,
      });
    }
  }

  // Check for added services
  for (const [normalizedDesc, newService] of newMap) {
    if (!oldMap.has(normalizedDesc)) {
      entries.push({
        type: 'added',
        serviceDescription: newService.description,
        serviceId: newService.id,
        newValue: {
          description: newService.description,
          amount: Number(newService.amount),
          observation: newService.observation || null,
          shouldSync: newService.shouldSync,
          position: newService.position,
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
 * Log per-service changelog entries by diffing old and new service arrays.
 */
export async function logQuoteServiceChanges(params: {
  changeLogService: ChangeLogService;
  quoteId: string;
  oldServices: QuoteServiceForDiff[];
  newServices: QuoteServiceForDiff[];
  userId: string;
  triggeredBy: CHANGE_TRIGGERED_BY;
  transaction?: any;
}): Promise<void> {
  const { changeLogService, quoteId, oldServices, newServices, userId, triggeredBy, transaction } = params;
  const entries = diffQuoteServices(oldServices, newServices);

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
        reason = `Serviço '${entry.serviceDescription}' adicionado ao orçamento`;
        break;
      case 'removed':
        action = CHANGE_ACTION.DELETE;
        oldValue = serializeChangelogValue(entry.oldValue);
        reason = `Serviço '${entry.serviceDescription}' removido do orçamento`;
        break;
      case 'updated':
        action = CHANGE_ACTION.UPDATE;
        field = entry.field!;
        oldValue = serializeChangelogValue(entry.oldValue);
        newValue = serializeChangelogValue(entry.newValue);
        if (field === 'amount') {
          reason = `Serviço '${entry.serviceDescription}' — valor atualizado de ${formatCurrency(entry.oldValue)} para ${formatCurrency(entry.newValue)}`;
        } else if (field === 'observation') {
          reason = `Serviço '${entry.serviceDescription}' — observação atualizada`;
        } else {
          reason = `Serviço '${entry.serviceDescription}' — ${field} atualizado`;
        }
        break;
    }

    await changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_QUOTE_SERVICE,
      entityId: quoteId,
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
        serviceDescription: entry.serviceDescription,
        serviceId: entry.serviceId || null,
      },
    });
  }
}

// Backward compatibility aliases
export const diffQuoteItems = diffQuoteServices;
export const logQuoteItemChanges = logQuoteServiceChanges;
