import { ENTITY_TYPE } from '@constants';

// Define interfaces for file relationship operations
interface EntityReference {
  id: string;
  [key: string]: unknown;
}

interface FileWithRelationships {
  [key: string]: EntityReference | EntityReference[] | unknown;
}

/**
 * Maps file relationship fields to their corresponding entity types and human-readable descriptions
 */
export const FILE_RELATIONSHIP_MAP = {
  // Task relationships
  taskArtworks: { entityType: ENTITY_TYPE.TASK, description: "artes da tarefa" },
  taskBudgets: { entityType: ENTITY_TYPE.TASK, description: "orçamento da tarefa" },
  taskInvoices: { entityType: ENTITY_TYPE.TASK, description: "nota fiscal da tarefa" },
  taskReceipts: { entityType: ENTITY_TYPE.TASK, description: "recibo da tarefa" },
  taskCuts: { entityType: ENTITY_TYPE.CUT, description: "cortes da tarefa" },

  // Customer relationships
  customerLogo: { entityType: ENTITY_TYPE.CUSTOMER, description: "logo do cliente" },

  // Supplier relationships
  supplierLogo: { entityType: ENTITY_TYPE.SUPPLIER, description: "logo do fornecedor" },

  // Observation relationships
  observations: { entityType: ENTITY_TYPE.OBSERVATION, description: "arquivos da observação" },

  // Warning relationships
  warning: { entityType: ENTITY_TYPE.WARNING, description: "arquivos da advertência" },

  // Airbrushing relationships
  airbrushingReceipts: { entityType: ENTITY_TYPE.AIRBRUSHING, description: "recibo da aerografia" },
  airbrushingInvoices: { entityType: ENTITY_TYPE.AIRBRUSHING, description: "nota fiscal da aerografia" },

  // Order relationships
  orderBudgets: { entityType: ENTITY_TYPE.ORDER, description: "orçamento do pedido" },
  orderInvoices: { entityType: ENTITY_TYPE.ORDER, description: "nota fiscal do pedido" },
  orderReceipts: { entityType: ENTITY_TYPE.ORDER, description: "recibo do pedido" },

  // External withdrawal relationships
  externalWithdrawalBudgets: { entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL, description: "orçamento da retirada externa" },
  externalWithdrawalInvoices: { entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL, description: "nota fiscal da retirada externa" },
  externalWithdrawalReceipts: { entityType: ENTITY_TYPE.EXTERNAL_WITHDRAWAL, description: "recibo da retirada externa" },
} as const;

export type FileRelationshipField = keyof typeof FILE_RELATIONSHIP_MAP;

/**
 * Detects file relationship changes between old and new file states
 * @param oldFile - The previous state of the file
 * @param newFile - The new state of the file
 * @returns Array of detected relationship changes
 */
export function detectFileRelationshipChanges(
  oldFile: FileWithRelationships,
  newFile: FileWithRelationships,
): Array<{
  field: FileRelationshipField;
  entityType: ENTITY_TYPE;
  action: "attached" | "detached";
  entityId: string;
  description: string;
}> {
  const changes: Array<{
    field: FileRelationshipField;
    entityType: ENTITY_TYPE;
    action: "attached" | "detached";
    entityId: string;
    description: string;
  }> = [];

  // Check each relationship field
  for (const [field, config] of Object.entries(FILE_RELATIONSHIP_MAP)) {
    const oldRelations = oldFile?.[field] || [];
    const newRelations = newFile?.[field] || [];

    // Convert to arrays if not already
    const oldArray = Array.isArray(oldRelations) ? oldRelations : [oldRelations].filter(Boolean);
    const newArray = Array.isArray(newRelations) ? newRelations : [newRelations].filter(Boolean);

    // Get IDs
    const oldIds = new Set(oldArray.map((item: EntityReference | string) => (typeof item === 'object' ? item?.id : item)).filter(Boolean));
    const newIds = new Set(newArray.map((item: EntityReference | string) => (typeof item === 'object' ? item?.id : item)).filter(Boolean));

    // Find attachments (new IDs not in old)
    for (const id of newIds) {
      if (!oldIds.has(id)) {
        changes.push({
          field: field as FileRelationshipField,
          entityType: config.entityType,
          action: "attached",
          entityId: id,
          description: config.description,
        });
      }
    }

    // Find detachments (old IDs not in new)
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        changes.push({
          field: field as FileRelationshipField,
          entityType: config.entityType,
          action: "detached",
          entityId: id,
          description: config.description,
        });
      }
    }
  }

  return changes;
}

/**
 * Generates a human-readable description for a file relationship change
 * @param change - The relationship change details
 * @param fileName - The name of the file
 * @returns Human-readable description in Portuguese
 */
export function getFileRelationshipChangeDescription(
  change: {
    action: "attached" | "detached";
    description: string;
    entityId: string;
  },
  fileName: string,
): string {
  const actionText = change.action === "attached" ? "anexado a" : "removido de";
  return `Arquivo "${fileName}" foi ${actionText} ${change.description}`;
}

/**
 * Groups relationship changes by entity type for batch logging
 * @param changes - Array of relationship changes
 * @returns Changes grouped by entity type
 */
export function groupFileRelationshipChangesByEntity(
  changes: Array<{
    field: FileRelationshipField;
    entityType: ENTITY_TYPE;
    action: "attached" | "detached";
    entityId: string;
    description: string;
  }>,
): Record<ENTITY_TYPE, typeof changes> {
  const grouped: Record<string, typeof changes> = {};

  for (const change of changes) {
    if (!grouped[change.entityType]) {
      grouped[change.entityType] = [];
    }
    grouped[change.entityType].push(change);
  }

  return grouped as Record<ENTITY_TYPE, typeof changes>;
}

/**
 * Checks if a file update contains only relationship changes
 * @param updateData - The update data object
 * @returns true if only relationship fields are being updated
 */
export function isOnlyRelationshipUpdate(updateData: Record<string, unknown>): boolean {
  const relationshipFields = new Set(Object.keys(FILE_RELATIONSHIP_MAP));
  const updateFields = Object.keys(updateData);

  // Check if all update fields are relationship fields
  return updateFields.length > 0 && updateFields.every((field) => relationshipFields.has(field));
}

/**
 * Extracts entity IDs from file relationship data
 * @param file - The file object with relationships
 * @returns Map of entity types to their IDs
 */
export function extractFileRelationshipIds(file: FileWithRelationships): Map<ENTITY_TYPE, Set<string>> {
  const entityIdMap = new Map<ENTITY_TYPE, Set<string>>();

  for (const [field, config] of Object.entries(FILE_RELATIONSHIP_MAP)) {
    const relations = file?.[field];
    if (!relations) continue;

    const entityType = config.entityType;
    if (!entityIdMap.has(entityType)) {
      entityIdMap.set(entityType, new Set());
    }

    const entityIds = entityIdMap.get(entityType)!;
    const relArray = Array.isArray(relations) ? relations : [relations];

    for (const rel of relArray) {
      if (rel?.id) {
        entityIds.add(rel.id);
      } else if (typeof rel === "string") {
        entityIds.add(rel);
      }
    }
  }

  return entityIdMap;
}
