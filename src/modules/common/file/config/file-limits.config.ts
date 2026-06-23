/**
 * File upload limits configuration by entity type and relationship
 * This configuration defines how many files can be uploaded for different entity types
 */

export interface FileLimitConfig {
  maxFiles: number;
  description: string;
}

/**
 * Entity-specific file upload limits
 * These limits are enforced when attaching files to entities
 */
export const ENTITY_FILE_LIMITS: Record<string, FileLimitConfig> = {
  // Task relationships
  taskArtworks: {
    maxFiles: 10,
    description: 'Máximo de 10 arquivos de arte por tarefa',
  },
  taskBaseFiles: {
    maxFiles: 30,
    description: 'Máximo de 30 arquivos base por tarefa',
  },
  taskBudgets: {
    maxFiles: 10,
    description: 'Máximo de 10 orçamentos por tarefa',
  },
  taskInvoices: {
    maxFiles: 10,
    description: 'Máximo de 10 notas fiscais por tarefa',
  },
  taskReceipts: {
    maxFiles: 10,
    description: 'Máximo de 10 recibos por tarefa',
  },
  taskBankSlips: {
    maxFiles: 10,
    description: 'Máximo de 10 boletos por tarefa',
  },

  // Customer relationships
  customerLogo: {
    maxFiles: 1,
    description: 'Máximo de 1 logo por cliente',
  },

  // Supplier relationships
  supplierLogo: {
    maxFiles: 1,
    description: 'Máximo de 1 logo por fornecedor',
  },

  // Observation relationships
  observations: {
    maxFiles: 20,
    description: 'Máximo de 20 arquivos por observação',
  },

  // Warning relationships
  warning: {
    maxFiles: 10,
    description: 'Máximo de 10 arquivos por advertência',
  },

  // Airbrushing relationships
  airbrushingReceipts: {
    maxFiles: 10,
    description: 'Máximo de 10 recibos por aerografia',
  },
  airbrushingInvoices: {
    maxFiles: 10,
    description: 'Máximo de 10 notas fiscais por aerografia',
  },
  airbrushingArtworks: {
    maxFiles: 10,
    description: 'Máximo de 10 arquivos de arte por aerografia',
  },

  // Order relationships
  orderReceipts: {
    maxFiles: 10,
    description: 'Máximo de 10 recibos por pedido',
  },

  // External withdrawal relationships
  externalOperationBudgets: {
    maxFiles: 10,
    description: 'Máximo de 10 orçamentos por operação externa',
  },
  externalOperationInvoices: {
    maxFiles: 10,
    description: 'Máximo de 10 notas fiscais por operação externa',
  },
  externalOperationReceipts: {
    maxFiles: 10,
    description: 'Máximo de 10 recibos por operação externa',
  },
};

/**
 * Get file limit for a specific entity relationship
 * @param relationshipField - The file relationship field (e.g., 'taskArtworks', 'orderBudgets')
 * @returns File limit configuration or default if not found
 */
export function getFileLimitForRelationship(relationshipField: string): FileLimitConfig {
  return (
    ENTITY_FILE_LIMITS[relationshipField] || {
      maxFiles: 10,
      description: 'Máximo de 10 arquivos',
    }
  );
}

/**
 * Validate if adding new files would exceed the limit
 * @param relationshipField - The file relationship field
 * @param currentFileCount - Current number of files attached
 * @param newFileCount - Number of new files being added
 * @returns { valid: boolean, message?: string }
 */
export function validateFileLimit(
  relationshipField: string,
  currentFileCount: number,
  newFileCount: number,
): { valid: boolean; message?: string } {
  const limit = getFileLimitForRelationship(relationshipField);
  const totalFiles = currentFileCount + newFileCount;

  if (totalFiles > limit.maxFiles) {
    return {
      valid: false,
      message: `${limit.description}. Atualmente: ${currentFileCount}, tentando adicionar: ${newFileCount}, total seria: ${totalFiles}`,
    };
  }

  return { valid: true };
}
