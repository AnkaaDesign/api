import { z } from 'zod';

/**
 * List of all fields that can be copied between tasks
 */
export const COPYABLE_TASK_FIELDS = [
  'all', // Special field to copy all supported fields
  // Simple fields
  'name',
  'details',
  'term',
  'entryDate',
  'forecastDate',
  'commission',
  'negotiatingWith',
  // Reference IDs
  'customerId',
  'invoiceToId',
  'pricingId',
  'paintId',
  // Shared file IDs (many-to-many relations)
  'artworkIds',
  'baseFileIds',
  'logoPaintIds',
  // Individual resources (creates new records)
  'cuts',
  'airbrushings',
  'serviceOrders',
  // Truck and related
  'truck',
  'layouts',
  // Other relations
  'observation',
] as const;

/**
 * Type for copyable task fields
 */
export type CopyableTaskField = (typeof COPYABLE_TASK_FIELDS)[number];

/**
 * Zod schema for task copy request validation
 */
export const taskCopyFromSchema = z.object({
  sourceTaskId: z.string().uuid('ID da tarefa de origem inválido'),
  fields: z
    .array(z.enum(COPYABLE_TASK_FIELDS))
    .min(1, 'Selecione pelo menos um campo para copiar'),
});

/**
 * Form data type inferred from the schema
 */
export type TaskCopyFromFormData = z.infer<typeof taskCopyFromSchema>;
